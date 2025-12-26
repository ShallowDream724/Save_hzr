const fs = require('fs');
const path = require('path');

const { TokenBucket } = require('./tokenBucket');
const { isoNow } = require('./time');
const { emitJob } = require('./events');
const { newId } = require('./ids');
const { extractPageBundle, finalizeImportJob } = require('./geminiClient');

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(String(raw || ''));
  } catch (_) {
    return fallback;
  }
}

function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}

function validateBundle(bundle, expectedPageIndex) {
  if (!bundle || typeof bundle !== 'object') return 'bundle must be object';
  if (Number(bundle.pageIndex) !== Number(expectedPageIndex)) return 'pageIndex mismatch';

  // Models sometimes omit optional fields; normalize for robust downstream logic.
  if (bundle.head === undefined) bundle.head = null;
  if (bundle.chapterTitleCandidate === undefined) bundle.chapterTitleCandidate = '';
  if (bundle.warnings === undefined) bundle.warnings = [];

  if (!Array.isArray(bundle.questions)) return 'questions must be array';
  if (!bundle.tail || typeof bundle.tail !== 'object') return 'tail must be object';
  if (bundle.head !== null && typeof bundle.head !== 'object') return 'head must be null or object';
  if (!isNonEmptyString(bundle.tail.kind) || (bundle.tail.kind !== 'complete' && bundle.tail.kind !== 'fragment')) {
    return 'tail.kind invalid';
  }
  return null;
}

function validateFinalizeOutput(out) {
  if (!out || typeof out !== 'object') return 'output must be object';
  if (!Array.isArray(out.pages)) return 'pages must be array';
  for (const p of out.pages) {
    if (!p || typeof p !== 'object') return 'page must be object';
    if (!Number.isFinite(Number(p.pageIndex))) return 'page.pageIndex invalid';
    if (!isNonEmptyString(p.title)) return 'page.title required';
    if (!Array.isArray(p.questions)) return 'page.questions must be array';
    for (const q of p.questions) {
      if (!q || typeof q !== 'object') return 'question must be object';
      if (q.id !== undefined && q.id !== null && typeof q.id !== 'string' && typeof q.id !== 'number') return 'question.id must be string|number';
      if (typeof q.text !== 'string') return 'question.text must be string';
      if (!Array.isArray(q.options)) return 'question.options must be array';
      for (const o of q.options) {
        if (!o || typeof o !== 'object') return 'option must be object';
        if (typeof o.label !== 'string' || typeof o.content !== 'string') return 'option.label/content must be string';
      }
      if (typeof q.answer !== 'string') return 'question.answer must be string';
      if (q.explanation !== undefined && typeof q.explanation !== 'string') return 'question.explanation must be string';
      if (q.knowledgeTitle !== undefined && typeof q.knowledgeTitle !== 'string') return 'question.knowledgeTitle must be string';
      if (q.knowledge !== undefined && typeof q.knowledge !== 'string') return 'question.knowledge must be string';
    }
  }
  if (out.warnings !== undefined && !Array.isArray(out.warnings)) return 'warnings must be array';
  return null;
}

function computeRetryDelayMs(attempt, isRateLimited) {
  // attempt is 1..3; next attempt will be attempt+1
  const base = isRateLimited ? 30_000 : 10_000;
  const factor = Math.pow(2, Math.max(0, Number(attempt) - 1)); // 1->1x, 2->2x
  const jitter = Math.floor(Math.random() * 1500);
  const max = isRateLimited ? 8 * 60_000 : 3 * 60_000;
  const delay = base * factor + jitter;
  return Math.min(max, Math.max(5_000, delay));
}

function getImportConfig() {
  const proRpm = Number(process.env.AI_IMPORT_PRO_RPM || 10);
  const flashRpm = Number(process.env.AI_IMPORT_FLASH_RPM || 20);
  const minStartIntervalMs = Number(process.env.AI_IMPORT_MIN_START_INTERVAL_MS || 1000);

  return {
    tickMs: Number(process.env.AI_IMPORT_TICK_MS || 250),
    minStartIntervalMs,
    models: {
      pro: {
        rpm: proRpm,
        maxInFlight: Number(process.env.AI_IMPORT_PRO_MAX_IN_FLIGHT || proRpm),
      },
      flash: {
        rpm: flashRpm,
        maxInFlight: Number(process.env.AI_IMPORT_FLASH_MAX_IN_FLIGHT || flashRpm),
      },
    },
  };
}

function ensureUploadDir(rootDir) {
  try {
    fs.mkdirSync(rootDir, { recursive: true });
  } catch (_) {}
}

function buildUploadsRoot() {
  const base = process.env.AI_UPLOADS_DIR
    ? path.resolve(process.env.AI_UPLOADS_DIR)
    : path.resolve(__dirname, '..', '..', '..', 'data', 'ai_uploads');
  ensureUploadDir(base);
  return base;
}

function computeEtaMinutes({ nowMs, rpm, minStartIntervalMs, avgDurationSec, aheadItems, ownItems }) {
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
    nowMs: Date.now(),
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

function mergeTailHead(prevTail, nextHead) {
  const tailFrag = prevTail && prevTail.kind === 'fragment' ? prevTail.fragment : null;
  const headFrag = nextHead && typeof nextHead === 'object' ? nextHead : null;
  const merged = {
    sourceRefs: [],
    id: null,
    text: '',
    options: [],
    answer: '',
  };

  if (tailFrag) {
    merged.sourceRefs.push(tailFrag.sourceRef || { pageIndex: null, kind: 'tail' });
    if (typeof tailFrag.id === 'string' || typeof tailFrag.id === 'number') merged.id = tailFrag.id;
    if (typeof tailFrag.text === 'string') merged.text += tailFrag.text.trim();
    if (Array.isArray(tailFrag.options)) merged.options.push(...tailFrag.options);
    if (typeof tailFrag.answer === 'string') merged.answer = tailFrag.answer;
  }

  if (headFrag) {
    merged.sourceRefs.push(headFrag.sourceRef || { pageIndex: null, kind: 'head' });
    if ((merged.id === null || merged.id === undefined) && (typeof headFrag.id === 'string' || typeof headFrag.id === 'number')) merged.id = headFrag.id;
    if (typeof headFrag.text === 'string') {
      const t = headFrag.text.trim();
      if (t) merged.text = merged.text ? `${merged.text}\n${t}` : t;
    }
    if (Array.isArray(headFrag.options)) merged.options.push(...headFrag.options);
    if (typeof headFrag.answer === 'string' && !merged.answer) merged.answer = headFrag.answer;
  }

  // de-dupe options by label (keep first)
  const seen = new Set();
  const opts = [];
  for (const opt of merged.options) {
    const label = opt && typeof opt.label === 'string' ? opt.label.trim() : '';
    if (!label || seen.has(label)) continue;
    seen.add(label);
    opts.push({ label, content: typeof opt.content === 'string' ? opt.content : '' });
  }
  merged.options = opts;

  return merged;
}

function finalizeBundlesToChapters({ jobId, bundles }) {
  const sorted = [...bundles].sort((a, b) => Number(a.pageIndex) - Number(b.pageIndex));
  const warnings = [];

  if (sorted.length > 0 && sorted[0].head) {
    warnings.push({ pageIndex: sorted[0].pageIndex, message: 'First page returned a head fragment; dropped.' });
  }

  const pageResults = sorted.map((b) => ({
    pageIndex: Number(b.pageIndex),
    title: isNonEmptyString(b.chapterTitleCandidate) ? b.chapterTitleCandidate.trim() : `AI导入 第${Number(b.pageIndex) + 1}页`,
    questions: Array.isArray(b.questions) ? [...b.questions] : [],
    tail: b.tail,
    head: b.head,
  }));

  // Apply tail/head stitching rules.
  for (let i = 0; i < pageResults.length; i++) {
    const cur = pageResults[i];
    const next = pageResults[i + 1] || null;

    const tail = cur.tail;
    const isAdjacent = !!(next && Number(next.pageIndex) === Number(cur.pageIndex) + 1);
    const nextHead = isAdjacent && next ? next.head : null;

    if (i === pageResults.length - 1) {
      if (tail && tail.kind === 'complete' && tail.question) {
        cur.questions.push(tail.question);
      } else if (tail && tail.kind === 'fragment') {
        warnings.push({ pageIndex: cur.pageIndex, message: 'Last page tail is fragment; dropped.' });
      }
      break;
    }

    if (!isAdjacent) {
      // There is a gap (failed/missing pages). Never stitch across it.
      if (tail && tail.kind === 'complete' && tail.question) {
        cur.questions.push(tail.question);
      } else if (tail && tail.kind === 'fragment') {
        warnings.push({ pageIndex: cur.pageIndex, message: 'Tail is fragment but next page is not adjacent; dropped.' });
      }
      if (next && next.head) {
        warnings.push({ pageIndex: next.pageIndex, message: 'Page has head fragment but previous page is missing; dropped.' });
        next.head = null;
      }
      continue;
    }

    if (nextHead) {
      if (tail && tail.kind === 'fragment') {
        const merged = mergeTailHead(tail, nextHead);
        cur.questions.push({
          sourceRef: { pageIndex: cur.pageIndex, localIndex: cur.questions.length },
          id: merged.id,
          text: merged.text || '',
          options: merged.options || [],
          answer: merged.answer || '',
          explanation: '',
          knowledgeTitle: '',
          knowledge: '',
          ai: { mergedFrom: merged.sourceRefs },
        });
      } else {
        warnings.push({ pageIndex: cur.pageIndex, message: 'Next page has head but current tail is not fragment; skipped merge.' });
        if (tail && tail.kind === 'complete' && tail.question) cur.questions.push(tail.question);
      }
      // nextHead is consumed by merge or dropped; do not carry into next page.
      next.head = null;
    } else {
      if (tail && tail.kind === 'complete' && tail.question) {
        cur.questions.push(tail.question);
      } else if (tail && tail.kind === 'fragment') {
        warnings.push({ pageIndex: cur.pageIndex, message: 'Tail is fragment but next page has no head; deferred to finalize (dropped for now).' });
      }
    }
  }

  // Assign stable display IDs per chapter (1..n)
  for (const page of pageResults) {
    const qs = Array.isArray(page.questions) ? page.questions : [];
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      q.id = typeof q.id === 'string' || typeof q.id === 'number' ? q.id : i + 1;
      q.__ai = true;
      q.ai = q.ai || { jobId, pageIndex: page.pageIndex };
    }
  }

  return { pages: pageResults, warnings };
}

function startImportScheduler({ db, patchLibrary }) {
  const cfg = getImportConfig();
  const modelState = {};
  for (const model of Object.keys(cfg.models)) {
    const m = cfg.models[model];
    modelState[model] = {
      model,
      rpm: m.rpm,
      maxInFlight: m.maxInFlight,
      minStartIntervalMs: cfg.minStartIntervalMs,
      bucket: new TokenBucket({ capacity: m.rpm, refillPerSec: m.rpm / 60 }),
      inFlight: 0,
      lastStartMs: 0,
      runningTick: false,
    };
  }

  const timer = setInterval(() => {
    for (const model of Object.keys(modelState)) tickModel(modelState[model]).catch(() => {});
  }, cfg.tickMs);

  const reconcileTimer = setInterval(() => {
    try {
      const rows = db
        .prepare(
          `
          SELECT id
          FROM ai_jobs
          WHERE status IN ('queued','running','finalizing')
          ORDER BY created_at ASC
          LIMIT 100
        `
        )
        .all();
      for (const r of rows) {
        if (r && r.id) maybeAdvanceJob(r.id);
      }
    } catch (_) {}
  }, 2000);

  function stop() {
    clearInterval(timer);
    clearInterval(reconcileTimer);
  }

  async function tickModel(state) {
    if (state.runningTick) return;
    state.runningTick = true;
    try {
      state.bucket.refill();
      if (state.inFlight >= state.maxInFlight) return;
      if (Date.now() - state.lastStartMs < state.minStartIntervalMs) return;
      if (!state.bucket.tryConsume(1)) return;

      const nowIso = isoNow();
      const item = db
        .prepare(
          `
          SELECT i.*, j.payload_json AS job_payload_json
          FROM ai_job_items i
          JOIN ai_jobs j ON j.id = i.job_id
          WHERE i.model = ?
            AND i.kind IN ('extract','finalize')
            AND i.status IN ('queued','retry_wait')
            AND (i.delayed_until IS NULL OR i.delayed_until <= ?)
            AND j.status IN ('queued','running','finalizing')
          ORDER BY j.created_at ASC, i.job_id ASC, i.idx ASC
          LIMIT 1
        `
        )
        .get(state.model, nowIso);

      if (!item) {
        state.bucket.refund(1);
        return;
      }

      const startAt = isoNow();
      db.prepare(
        `
        UPDATE ai_job_items
        SET status='running', started_at=?, updated_at=?
        WHERE id=? AND status IN ('queued','retry_wait')
      `
      ).run(startAt, startAt, item.id);

      db.prepare(
        `
        UPDATE ai_jobs
        SET status=CASE WHEN status='queued' THEN 'running' ELSE status END,
            updated_at=?
        WHERE id=?
      `
      ).run(startAt, item.job_id);

      updateJobProgress(db, item.job_id);
      emitJob(item.job_id);

      state.inFlight += 1;
      state.lastStartMs = Date.now();

      void runItem(state.model, item).finally(() => {
        state.inFlight = Math.max(0, state.inFlight - 1);
      });
    } finally {
      state.runningTick = false;
    }
  }

  async function runItem(model, item) {
    if (item.kind === 'finalize') return runFinalizeItem(model, item);
    return runExtractItem(model, item);
  }

  async function runExtractItem(model, item) {
    const jobPayload = safeJsonParse(item.job_payload_json, {});
    const noteText = isNonEmptyString(jobPayload.noteText) ? jobPayload.noteText : '';

    try {
      const args = await extractPageBundle({
        model,
        pageIndex: item.idx,
        noteText,
        imagePath: item.input_path,
        mimeType: item.input_mime,
      });

      const err = validateBundle(args, item.idx);
      if (err) {
        const e = new Error(`Bad bundle: ${err}`);
        e.name = 'BadModelOutput';
        throw e;
      }

      const now = isoNow();
      db.prepare(
        `
        UPDATE ai_job_items
        SET status='succeeded', result_json=?, error=NULL, finished_at=?, updated_at=?
        WHERE id=?
      `
      ).run(JSON.stringify(args), now, now, item.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const is429 = msg.includes('429') || msg.toLowerCase().includes('rate');
      const attempt = Number(item.attempt) || 1;
      const now = isoNow();

      if (attempt >= 3) {
        db.prepare(
          `
          UPDATE ai_job_items
          SET status='failed', error=?, finished_at=?, updated_at=?
          WHERE id=?
        `
        ).run(msg, now, now, item.id);
      } else {
        const delayMs = computeRetryDelayMs(attempt, is429);
        const delayedUntil = new Date(Date.now() + delayMs).toISOString();
        db.prepare(
          `
          UPDATE ai_job_items
          SET status='retry_wait', attempt=?, error=?, delayed_until=?, updated_at=?
          WHERE id=?
        `
        ).run(attempt + 1, msg, delayedUntil, now, item.id);
      }
    } finally {
      updateJobProgress(db, item.job_id);
      emitJob(item.job_id);
      maybeAdvanceJob(item.job_id);
    }
  }

  async function runFinalizeItem(model, item) {
    const job = db.prepare('SELECT * FROM ai_jobs WHERE id=?').get(item.job_id);
    const jobPayload = safeJsonParse(job && job.payload_json, {});
    const noteText = isNonEmptyString(jobPayload.noteText) ? jobPayload.noteText : '';

    try {
      const succeeded = db
        .prepare(
          `
          SELECT idx, result_json
          FROM ai_job_items
          WHERE job_id=?
            AND kind='extract'
            AND status='succeeded'
          ORDER BY idx ASC
        `
        )
        .all(item.job_id);

      const bundles = succeeded
        .map((r) => safeJsonParse(r.result_json, null))
        .filter((x) => x && typeof x === 'object');

      const { pages, warnings } = finalizeBundlesToChapters({ jobId: item.job_id, bundles });

      // Compact input to reduce token usage: keep only the essential fields.
      const compactPages = pages.map((p) => ({
        pageIndex: p.pageIndex,
        title: p.title,
        questions: (Array.isArray(p.questions) ? p.questions : []).map((q) => ({
          id: q && (typeof q.id === 'string' || typeof q.id === 'number') ? q.id : '',
          text: typeof q.text === 'string' ? q.text : '',
          options: Array.isArray(q.options)
            ? q.options.map((o) => ({ label: typeof o.label === 'string' ? o.label : '', content: typeof o.content === 'string' ? o.content : '' }))
            : [],
          answer: typeof q.answer === 'string' ? q.answer : '',
          explanation: typeof q.explanation === 'string' ? q.explanation : '',
          knowledgeTitle: typeof q.knowledgeTitle === 'string' ? q.knowledgeTitle : '',
          knowledge: typeof q.knowledge === 'string' ? q.knowledge : '',
        })),
        warnings: warnings.filter((w) => w && Number(w.pageIndex) === Number(p.pageIndex)).map((w) => w.message),
      }));

      const args = await finalizeImportJob({ model, pages: compactPages, noteText });
      const outErr = validateFinalizeOutput(args);
      if (outErr) {
        const e = new Error(`Bad finalize output: ${outErr}`);
        e.name = 'BadModelOutput';
        throw e;
      }

      const now = isoNow();
      db.prepare(
        `
        UPDATE ai_job_items
        SET status='succeeded', result_json=?, error=NULL, finished_at=?, updated_at=?
        WHERE id=?
      `
      ).run(JSON.stringify(args), now, now, item.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const is429 = msg.includes('429') || msg.toLowerCase().includes('rate');
      const attempt = Number(item.attempt) || 1;
      const now = isoNow();

      if (attempt >= 3) {
        db.prepare(
          `
          UPDATE ai_job_items
          SET status='failed', error=?, finished_at=?, updated_at=?
          WHERE id=?
        `
        ).run(msg, now, now, item.id);
      } else {
        const delayMs = computeRetryDelayMs(attempt, is429);
        const delayedUntil = new Date(Date.now() + delayMs).toISOString();
        db.prepare(
          `
          UPDATE ai_job_items
          SET status='retry_wait', attempt=?, error=?, delayed_until=?, updated_at=?
          WHERE id=?
        `
        ).run(attempt + 1, msg, delayedUntil, now, item.id);
      }
    } finally {
      updateJobProgress(db, item.job_id);
      emitJob(item.job_id);
      maybeAdvanceJob(item.job_id);
    }
  }

  function maybeAdvanceJob(jobId) {
    const job = db.prepare('SELECT * FROM ai_jobs WHERE id=?').get(jobId);
    if (!job) return;
    if (!['queued', 'running', 'finalizing'].includes(job.status)) return;

    const pending = db
      .prepare(
        `
        SELECT COUNT(*) AS n
        FROM ai_job_items
        WHERE job_id=?
          AND kind='extract'
          AND status IN ('queued','retry_wait','running')
      `
      )
      .get(jobId);
    const nPending = Number(pending && pending.n) || 0;
    if (nPending > 0) return;

    const finalizeItem = db
      .prepare(`SELECT * FROM ai_job_items WHERE job_id=? AND kind='finalize' ORDER BY created_at DESC LIMIT 1`)
      .get(jobId);

    // If extraction finished and no finalize item yet, enqueue finalize.
    if (!finalizeItem) {
      const now = isoNow();
      db.prepare(`UPDATE ai_jobs SET status='finalizing', updated_at=? WHERE id=? AND status IN ('queued','running')`).run(now, jobId);
      try {
        db.prepare(
          `
          INSERT INTO ai_job_items (id, job_id, user_id, book_id, model, kind, idx, status, attempt, delayed_until, input_path, input_mime, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'finalize', ?, 'queued', 1, NULL, NULL, NULL, ?, ?)
        `
        ).run(newId('item'), jobId, job.user_id, job.book_id, job.model, 1000000, now, now);
      } catch (_) {}

      updateJobProgress(db, jobId);
      emitJob(jobId);
      return;
    }

    // Wait until finalize is done (or failed).
    if (['queued', 'running', 'retry_wait'].includes(finalizeItem.status)) return;

    // Acquire write lock.
    const now = isoNow();
    const info = db
      .prepare(`UPDATE ai_jobs SET status='writing', updated_at=? WHERE id=? AND status IN ('finalizing','queued','running')`)
      .run(now, jobId);
    if (!info.changes) return;

    try {
      const succeeded = db
        .prepare(
          `
          SELECT idx, result_json
          FROM ai_job_items
          WHERE job_id=?
            AND kind='extract'
            AND status='succeeded'
          ORDER BY idx ASC
        `
        )
        .all(jobId);

      const bundles = succeeded
        .map((r) => safeJsonParse(r.result_json, null))
        .filter((x) => x && typeof x === 'object');

      const det = finalizeBundlesToChapters({ jobId, bundles });
      const detWarnings = det.warnings || [];

      let pagesToWrite = det.pages;
      let finalizeWarnings = [];
      if (finalizeItem.status === 'succeeded' && finalizeItem.result_json) {
        const out = safeJsonParse(finalizeItem.result_json, null);
        if (out && Array.isArray(out.pages)) {
          pagesToWrite = out.pages;
          finalizeWarnings = Array.isArray(out.warnings) ? out.warnings : [];
        } else {
          finalizeWarnings = ['Finalize returned invalid structure; used deterministic merge output.'];
        }
      } else if (finalizeItem.status === 'failed') {
        finalizeWarnings = [`Finalize failed: ${finalizeItem.error || 'unknown error'}`];
      }

      const jobPayload = safeJsonParse(job && job.payload_json, {});
      const bookMeta = jobPayload && typeof jobPayload.bookMeta === 'object' ? jobPayload.bookMeta : null;

      const patchSummary = patchLibrary({
        userId: job.user_id,
        bookId: job.book_id,
        jobId: jobId,
        pages: pagesToWrite,
        bookMeta,
      });

      const finalNow = isoNow();
      const failedRows = db
        .prepare(`SELECT idx, error FROM ai_job_items WHERE job_id=? AND kind='extract' AND status='failed' ORDER BY idx ASC`)
        .all(jobId);
      const nFail = Array.isArray(failedRows) ? failedRows.length : 0;

      const result = {
        insertedChapters: patchSummary && patchSummary.insertedChapters ? patchSummary.insertedChapters : [],
        warnings: [...detWarnings, ...finalizeWarnings],
        failedPages: nFail,
        failedPageIndices: failedRows.map((r) => r.idx),
        finalize: { status: finalizeItem.status },
      };

      db.prepare(`UPDATE ai_jobs SET status=?, result_json=?, error=NULL, updated_at=? WHERE id=?`).run(
        nFail > 0 || finalizeItem.status === 'failed' ? 'done_with_errors' : 'done',
        JSON.stringify(result),
        finalNow,
        jobId
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const finalNow = isoNow();
      db.prepare(`UPDATE ai_jobs SET status='failed', error=?, updated_at=? WHERE id=?`).run(msg, finalNow, jobId);
    } finally {
      updateJobProgress(db, jobId);
      emitJob(jobId);
    }
  }

  return {
    stop,
    ensureJobActive: (userId) => ensureJobActive(db, userId),
    normalizeJobRow,
    normalizeItemRow,
    recomputeJobProgress: (jobId) => recomputeJobProgress(db, jobId),
    uploadsRoot: buildUploadsRoot(),
  };
}

module.exports = { startImportScheduler };
