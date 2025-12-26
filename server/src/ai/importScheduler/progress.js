const { isoNow } = require('../time');
const { getImportConfig, safeJsonParse } = require('./helpers');

function computeEtaMinutes({ rpm, minStartIntervalMs, avgDurationSec, aheadItems, ownItems }) {
  const minIntervalSec = Math.max(0.001, minStartIntervalMs / 1000);
  const perMin = Math.max(1e-6, rpm);
  const waitStartSec = Math.max(0, Math.ceil((aheadItems / perMin) * 60));

  // With token bucket burst, <=rpm items can start at minIntervalSec spacing when queue is free.
  const ownStartSpanSec = Math.max(0, (Math.max(0, ownItems - 1)) * minIntervalSec);
  const etaSec = waitStartSec + ownStartSpanSec + Math.max(0, Number(avgDurationSec) || 0);
  const etaMin = Math.ceil(etaSec / 60);
  return { etaMin: Number.isFinite(etaMin) ? etaMin : 0 };
}

function estimateAvgDurationSec(db, model) {
  try {
    const row = db
      .prepare(
        `
        SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400.0) AS avgSec
        FROM ai_job_items
        WHERE model = ?
          AND kind = 'extract'
          AND status = 'succeeded'
          AND started_at IS NOT NULL
          AND finished_at IS NOT NULL
          AND finished_at >= datetime('now', '-2 days')
      `
      )
      .get(model);
    const v = row && row.avgSec ? Number(row.avgSec) : NaN;
    if (!Number.isFinite(v) || v <= 1) return model === 'pro' ? 120 : 70;
    return Math.min(600, Math.max(15, v));
  } catch (_) {
    return model === 'pro' ? 120 : 70;
  }
}

function computeQueueStatsForJob(db, job) {
  const model = job.model;
  const jobCreatedAt = String(job.created_at || '');
  const aheadJobsRow = db
    .prepare(
      `
      SELECT COUNT(*) AS n
      FROM ai_jobs
      WHERE model = ?
        AND created_at < ?
        AND status IN ('queued','running','finalizing','writing')
    `
    )
    .get(model, jobCreatedAt);
  const aheadJobs = Number(aheadJobsRow && aheadJobsRow.n) || 0;

  const aheadUsersRow = db
    .prepare(
      `
      SELECT COUNT(DISTINCT user_id) AS n
      FROM ai_jobs
      WHERE model = ?
        AND created_at < ?
        AND status IN ('queued','running','finalizing','writing')
    `
    )
    .get(model, jobCreatedAt);
  const aheadUsers = Number(aheadUsersRow && aheadUsersRow.n) || 0;

  const aheadItemsRow = db
    .prepare(
      `
      SELECT COUNT(*) AS n
      FROM ai_job_items i
      JOIN ai_jobs j ON j.id = i.job_id
      WHERE j.model = ?
        AND j.created_at < ?
        AND i.kind = 'extract'
        AND i.status IN ('queued','running','retry_wait')
    `
    )
    .get(model, jobCreatedAt);
  const aheadItems = Number(aheadItemsRow && aheadItemsRow.n) || 0;

  const ownItemsRow = db
    .prepare(
      `
      SELECT COUNT(*) AS n
      FROM ai_job_items
      WHERE job_id = ?
        AND kind = 'extract'
    `
    )
    .get(job.id);
  const ownItems = Number(ownItemsRow && ownItemsRow.n) || 0;

  return { aheadJobs, aheadUsers, aheadItems, ownItems };
}

function recomputeJobProgress(db, jobId) {
  const job = db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(jobId);
  if (!job) return null;

  const totals = db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN kind='extract' THEN 1 ELSE 0 END) AS totalExtract,
        SUM(CASE WHEN kind='extract' AND status='succeeded' THEN 1 ELSE 0 END) AS okExtract,
        SUM(CASE WHEN kind='extract' AND status='failed' THEN 1 ELSE 0 END) AS failExtract,
        SUM(CASE WHEN kind='extract' AND status IN ('queued','retry_wait') THEN 1 ELSE 0 END) AS queuedExtract,
        SUM(CASE WHEN kind='extract' AND status='running' THEN 1 ELSE 0 END) AS runningExtract
      FROM ai_job_items
      WHERE job_id = ?
    `
    )
    .get(jobId);

  const totalPages = Number(totals && totals.totalExtract) || 0;
  const okPages = Number(totals && totals.okExtract) || 0;
  const failedPages = Number(totals && totals.failExtract) || 0;
  const queuedPages = Number(totals && totals.queuedExtract) || 0;
  const runningPages = Number(totals && totals.runningExtract) || 0;
  const donePages = okPages + failedPages;

  const { aheadJobs, aheadUsers, aheadItems, ownItems } = computeQueueStatsForJob(db, job);
  const cfg = getImportConfig();
  const modelCfg = cfg.models[job.model] || { rpm: 10 };
  const avgDurationSec = estimateAvgDurationSec(db, job.model);
  const { etaMin } = computeEtaMinutes({
    rpm: modelCfg.rpm,
    minStartIntervalMs: cfg.minStartIntervalMs,
    avgDurationSec,
    aheadItems,
    ownItems,
  });

  const progress = {
    status: job.status,
    totalPages,
    donePages,
    okPages,
    failedPages,
    queuedPages,
    runningPages,
    aheadUsers,
    aheadJobs,
    aheadItems,
    etaMin,
    updatedAt: isoNow(),
  };

  return progress;
}

function updateJobProgress(db, jobId) {
  const progress = recomputeJobProgress(db, jobId);
  if (!progress) return;
  const now = isoNow();
  db.prepare('UPDATE ai_jobs SET progress_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(progress), now, jobId);
}

function ensureJobActive(db, userId) {
  return db
    .prepare(
      `
      SELECT id, status
      FROM ai_jobs
      WHERE user_id = ?
        AND type = 'book_import'
        AND status IN ('queued','running','finalizing','writing')
      ORDER BY created_at DESC
      LIMIT 1
    `
    )
    .get(userId);
}

function normalizeJobRow(job) {
  return {
    id: job.id,
    type: job.type,
    model: job.model,
    status: job.status,
    bookId: job.book_id || null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    progress: safeJsonParse(job.progress_json, null),
    result: job.result_json ? safeJsonParse(job.result_json, null) : null,
    error: job.error || null,
  };
}

function normalizeItemRow(row) {
  return {
    id: row.id,
    idx: row.idx,
    kind: row.kind,
    status: row.status,
    attempt: row.attempt,
    delayedUntil: row.delayed_until,
    error: row.error || null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result_json ? safeJsonParse(row.result_json, null) : null,
  };
}

module.exports = {
  recomputeJobProgress,
  updateJobProgress,
  ensureJobActive,
  normalizeJobRow,
  normalizeItemRow,
  estimateAvgDurationSec,
  computeEtaMinutes,
};

