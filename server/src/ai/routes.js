const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const { newId } = require('./ids');
const { isoNow } = require('./time');
const { onJob } = require('./events');
const {
  createOrReuseConversation,
  listConversations,
  getConversation,
  getMessages,
  streamConversationReply,
  safeJsonParse,
} = require('./chatService');

function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}

function sanitizeFilename(name) {
  const base = String(name || 'file').replace(/[^\w.\-]+/g, '_');
  return base.length > 120 ? base.slice(0, 120) : base;
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {}
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (_) {}
}

function cleanupUploadedFiles(files) {
  try {
    const list = Array.isArray(files) ? files : [];
    for (const f of list) {
      if (f && f.path) rmrf(path.dirname(f.path));
    }
  } catch (_) {}
}

function buildUploadMiddleware(uploadsRoot) {
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const userId = req.user && req.user.userId ? String(req.user.userId) : 'anonymous';
      if (!req._aiUploadId) req._aiUploadId = newId('upl');
      const dir = path.join(uploadsRoot, userId, '_tmp', req._aiUploadId);
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      const safe = sanitizeFilename(path.basename(file.originalname || 'image', ext));
      cb(null, `${Date.now()}_${safe}${ext}`);
    },
  });

  return multer({
    storage,
    limits: {
      files: 9,
      fileSize: Number(process.env.AI_IMPORT_MAX_FILE_SIZE_BYTES || 20 * 1024 * 1024),
    },
  });
}

function normalizeJob(jobRow, normalizeJobRow, recomputeProgress) {
  const out = normalizeJobRow(jobRow);
  if (typeof recomputeProgress === 'function') {
    const p = recomputeProgress(out.id);
    if (p) out.progress = p;
  }
  return out;
}

function normalizeItems(rows, normalizeItemRow) {
  return rows.map(normalizeItemRow);
}

function getJobForUser(db, userId, jobId) {
  return db.prepare('SELECT * FROM ai_jobs WHERE id=? AND user_id=?').get(jobId, userId);
}

function listJobsForUser(db, userId, bookId) {
  if (bookId) {
    return db
      .prepare('SELECT * FROM ai_jobs WHERE user_id=? AND book_id=? ORDER BY created_at DESC LIMIT 50')
      .all(userId, bookId);
  }
  return db.prepare('SELECT * FROM ai_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(userId);
}

function listJobItems(db, jobId) {
  return db.prepare('SELECT * FROM ai_job_items WHERE job_id=? ORDER BY idx ASC').all(jobId);
}

function userHasBook(db, userId, bookId) {
  try {
    const row = db.prepare('SELECT data_json FROM libraries WHERE user_id = ?').get(userId);
    if (!row || !row.data_json) return false;
    const data = safeJsonParse(row.data_json, null);
    if (!data || typeof data !== 'object') return false;
    const books = Array.isArray(data.books) ? data.books : [];
    return books.some((b) => b && typeof b.id === 'string' && b.id === bookId);
  } catch (_) {
    return false;
  }
}

function createImportJob({ db, userId, bookId, model, noteText, files, uploadsRoot }) {
  const now = isoNow();
  const jobId = newId('job');
  const jobDir = path.join(uploadsRoot, String(userId), jobId);
  ensureDir(jobDir);

  const movedFiles = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = path.extname(f.originalname || '') || '';
      const target = path.join(jobDir, `${String(i).padStart(2, '0')}${ext || '.bin'}`);
      fs.renameSync(f.path, target);
      movedFiles.push({ idx: i, path: target, mime: f.mimetype || 'application/octet-stream', originalName: f.originalname || '' });
    }
  } finally {
    // Clean temp dir parent
    try {
      const tmpDir = path.dirname(files[0].path);
      const tmpRoot = path.dirname(tmpDir);
      // Remove only this upload folder
      rmrf(tmpDir);
      // Best-effort cleanup of empty _tmp
      try {
        if (fs.existsSync(tmpRoot) && fs.readdirSync(tmpRoot).length === 0) rmrf(tmpRoot);
      } catch (_) {}
    } catch (_) {}
  }

  const payload = {
    bookId,
    model,
    noteText: noteText || '',
    images: movedFiles.map((x) => ({ idx: x.idx, mime: x.mime, originalName: x.originalName })),
  };

  const progress = {
    status: 'queued',
    totalPages: movedFiles.length,
    donePages: 0,
    okPages: 0,
    failedPages: 0,
    queuedPages: movedFiles.length,
    runningPages: 0,
    aheadUsers: 0,
    aheadJobs: 0,
    aheadItems: 0,
    etaMin: 0,
    updatedAt: now,
  };

  db.prepare(
    `
    INSERT INTO ai_jobs (id, user_id, book_id, type, model, status, payload_json, progress_json, created_at, updated_at)
    VALUES (?, ?, ?, 'book_import', ?, 'queued', ?, ?, ?, ?)
  `
  ).run(jobId, userId, bookId, model, JSON.stringify(payload), JSON.stringify(progress), now, now);

  const insertItem = db.prepare(
    `
    INSERT INTO ai_job_items (id, job_id, user_id, book_id, model, kind, idx, status, attempt, delayed_until, input_path, input_mime, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'extract', ?, 'queued', 1, NULL, ?, ?, ?, ?)
  `
  );

  for (const mf of movedFiles) {
    insertItem.run(newId('item'), jobId, userId, bookId, model, mf.idx, mf.path, mf.mime, now, now);
  }

  return jobId;
}

function registerAiRoutes(app, { db, authMiddleware, importScheduler }) {
  const router = express.Router();
  const upload = buildUploadMiddleware(importScheduler.uploadsRoot);

  router.post('/book-import', authMiddleware, upload.array('images', 9), (req, res) => {
    const userId = req.user.userId;

    const active = importScheduler.ensureJobActive(userId);
    if (active && active.id) {
      // Reject additional jobs while one is active.
      // Cleanup newly uploaded temp files to avoid leaks.
      cleanupUploadedFiles(req.files);
      return res.status(409).json({ error: 'import job already active', jobId: active.id, reused: true });
    }

    const bookId = req.body && typeof req.body.bookId === 'string' ? req.body.bookId.trim() : '';
    const model = req.body && typeof req.body.model === 'string' ? req.body.model.trim() : 'flash';
    const noteText = req.body && typeof req.body.noteText === 'string' ? req.body.noteText : '';

    if (!isNonEmptyString(bookId)) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ error: 'bookId required' });
    }
    if (model !== 'flash' && model !== 'pro') {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ error: 'model must be flash|pro' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) { cleanupUploadedFiles(req.files); return res.status(400).json({ error: 'images[] required' }); }
    if (files.length > 9) { cleanupUploadedFiles(req.files); return res.status(400).json({ error: 'max 9 images' }); }

    if (!userHasBook(db, userId, bookId)) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ error: 'book not found in cloud library (enable sync & upload first)' });
    }

    try {
      const jobId = createImportJob({
        db,
        userId,
        bookId,
        model,
        noteText,
        files,
        uploadsRoot: importScheduler.uploadsRoot,
      });
      return res.json({ jobId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ error: 'server error', message: msg });
    }
  });

  router.get('/jobs', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const bookId = req.query && typeof req.query.bookId === 'string' ? req.query.bookId.trim() : '';
    const rows = listJobsForUser(db, userId, bookId || null);
    return res.json({
      items: rows.map((r) => normalizeJob(r, importScheduler.normalizeJobRow, importScheduler.recomputeJobProgress)),
    });
  });

  router.get('/jobs/:jobId', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const jobId = String(req.params.jobId || '');
    const job = getJobForUser(db, userId, jobId);
    if (!job) return res.status(404).json({ error: 'not found' });
    const items = listJobItems(db, jobId);
    return res.json({
      job: normalizeJob(job, importScheduler.normalizeJobRow, importScheduler.recomputeJobProgress),
      items: normalizeItems(items, importScheduler.normalizeItemRow),
    });
  });

  router.get('/jobs/:jobId/events', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const jobId = String(req.params.jobId || '');
    const job = getJobForUser(db, userId, jobId);
    if (!job) return res.status(404).end();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();

    const sendSnapshot = () => {
      const j = getJobForUser(db, userId, jobId);
      if (!j) return;
      const items = listJobItems(db, jobId);
      const payload = {
        job: normalizeJob(j, importScheduler.normalizeJobRow, importScheduler.recomputeJobProgress),
        items: normalizeItems(items, importScheduler.normalizeItemRow),
      };
      res.write(`event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    sendSnapshot();

    const off = onJob(jobId, () => {
      try {
        sendSnapshot();
      } catch (_) {}
    });

    const keepAlive = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 15_000);

    const periodic = setInterval(() => {
      try {
        sendSnapshot();
      } catch (_) {}
    }, 5_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      clearInterval(periodic);
      off();
    });
  });

  // ---- Conversations (chat) ----
  router.post('/conversations', authMiddleware, (req, res) => {
    try {
      const r = createOrReuseConversation(db, req.user.userId, req.body);
      return res.json(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = e && e.name === 'BadRequest' ? 400 : 500;
      return res.status(code).json({ error: 'server error', message: msg });
    }
  });

  router.get('/conversations', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const scope = req.query && typeof req.query.scope === 'string' ? req.query.scope.trim() : null;
    const bookId = req.query && typeof req.query.bookId === 'string' ? req.query.bookId.trim() : null;
    const rows = listConversations(db, userId, { scope, bookId });
    const items = rows.map((c) => ({
      id: c.id,
      scope: c.scope,
      bookId: c.book_id || null,
      chapterId: c.chapter_id || null,
      questionId: c.question_id || null,
      questionKey: c.question_key || null,
      title: c.title || null,
      modelPref: c.model_pref || 'flash',
      updatedAt: c.updated_at,
      lastMessageAt: c.last_message_at,
      createdAt: c.created_at,
    }));
    return res.json({ items });
  });

  router.get('/conversations/:id', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const id = String(req.params.id || '');
    const conv = getConversation(db, userId, id);
    if (!conv) return res.status(404).json({ error: 'not found' });
    const msgs = getMessages(db, userId, id, 300);
    return res.json({
      conversation: {
        id: conv.id,
        scope: conv.scope,
        bookId: conv.book_id || null,
        chapterId: conv.chapter_id || null,
        questionId: conv.question_id || null,
        questionKey: conv.question_key || null,
        title: conv.title || null,
        modelPref: conv.model_pref || 'flash',
        updatedAt: conv.updated_at,
        lastMessageAt: conv.last_message_at,
        createdAt: conv.created_at,
      },
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.content_text,
        json: m.content_json ? safeJsonParse(m.content_json, null) : null,
        createdAt: m.created_at,
      })),
    });
  });

  router.post('/conversations/:id/messages/stream', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const id = String(req.params.id || '');
    const userMessage = req.body && typeof req.body.userMessage === 'string' ? req.body.userMessage : '';
    const selectedText = req.body && typeof req.body.selectedText === 'string' ? req.body.selectedText : '';
    const modelPref = req.body && (req.body.modelPref === 'pro' || req.body.modelPref === 'flash') ? req.body.modelPref : null;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await streamConversationReply({
        db,
        userId,
        conversationId: id,
        userMessage,
        selectedText,
        modelPref,
        onDelta: (text) => send('delta', { text }),
      });
      send('done', { ok: true });
      res.end();
    } catch (e) {
      const name = e && e.name ? String(e.name) : 'Error';
      const msg = e instanceof Error ? e.message : String(e);
      const status =
        name === 'RateLimited' ? 429 :
        name === 'BadRequest' ? 400 :
        name === 'NotFound' ? 404 :
        name === 'NetworkError' ? 502 :
        500;
      send('error', { error: name, message: msg });
      res.statusCode = status;
      res.end();
    }
  });

  app.use('/api/ai', router);
}

module.exports = { registerAiRoutes };
