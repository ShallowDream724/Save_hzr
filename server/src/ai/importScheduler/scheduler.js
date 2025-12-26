const { TokenBucket } = require('../tokenBucket');
const { isoNow } = require('../time');
const { emitJob } = require('../events');
const { newId } = require('../ids');
const { extractPageBundle, finalizeImportJob } = require('../geminiClient');

const {
  safeJsonParse,
  isNonEmptyString,
  computeRetryDelayMs,
  getImportConfig,
  buildUploadsRoot,
} = require('./helpers');
const { validateBundle, validateFinalizeOutput } = require('./validation');
const { finalizeBundlesToChapters } = require('./stitching');
const {
  updateJobProgress,
  ensureJobActive,
  normalizeJobRow,
  normalizeItemRow,
  recomputeJobProgress,
} = require('./progress');

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

