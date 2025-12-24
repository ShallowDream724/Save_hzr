const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');

const { openDb } = require('./db');
const { signToken, authMiddleware } = require('./auth');
const { validateUsername, validatePassword } = require('./validators');

const app = express();
const db = openDb();

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: false }));

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'X-Force'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/register', (req, res) => {
  const username = req.body && req.body.username;
  const password = req.body && req.body.password;

  const uErr = validateUsername(username);
  if (uErr) return res.status(400).json({ error: uErr });
  const pErr = validatePassword(password);
  if (pErr) return res.status(400).json({ error: pErr });

  const u = username.trim();
  const hash = bcrypt.hashSync(password, 10);

  try {
    const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    const info = stmt.run(u, hash);
    const token = signToken({ userId: info.lastInsertRowid, username: u });
    return res.json({ token });
  } catch (err) {
    if (String(err && err.message).includes('UNIQUE')) return res.status(409).json({ error: 'username taken' });
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const username = req.body && req.body.username;
  const password = req.body && req.body.password;

  const uErr = validateUsername(username);
  if (uErr) return res.status(400).json({ error: uErr });
  if (typeof password !== 'string') return res.status(400).json({ error: 'password required' });

  const u = username.trim();
  const row = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(u);
  if (!row) return res.status(401).json({ error: 'invalid credentials' });

  const ok = bcrypt.compareSync(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const token = signToken({ userId: row.id, username: u });
  return res.json({ token });
});

app.get('/api/library', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT data_json, version, updated_at FROM libraries WHERE user_id = ?').get(req.user.userId);
  if (!row) return res.json({ data: null, version: 0, updatedAt: null });

  try {
    return res.json({ data: JSON.parse(row.data_json), version: row.version, updatedAt: row.updated_at });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/library', authMiddleware, (req, res) => {
  const data = req.body && req.body.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data required' });

  const expected = req.headers['if-match'] ? Number(req.headers['if-match']) : null;
  const force = (req.query && String(req.query.force) === '1') || String(req.headers['x-force'] || '') === '1';

  const current = db.prepare('SELECT data_json, version FROM libraries WHERE user_id = ?').get(req.user.userId);
  const currentVersion = current ? current.version : 0;
  if (!force && expected !== null && !Number.isNaN(expected) && expected !== currentVersion) {
    return res.status(409).json({ error: 'version conflict', version: currentVersion });
  }

  const payload = JSON.stringify(data);
  const nextVersion = currentVersion ? currentVersion + 1 : 1;
  const updatedAt = new Date().toISOString();

  const tx = db.transaction(() => {
    // If force overwrite, keep a copy of the old cloud data as an archive (no popups on client).
    if (force && current && current.data_json) {
      const name = `冲突自动备份 ${updatedAt}`;
      db.prepare('INSERT INTO library_archives (user_id, name, data_json, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.userId, name, current.data_json, updatedAt);
    }

    db.prepare(`
      INSERT INTO libraries (user_id, data_json, version, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        data_json = excluded.data_json,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(req.user.userId, payload, nextVersion, updatedAt);

    // Autosave snapshot every 5 minutes (by last snapshot time).
    const last = db.prepare('SELECT saved_at FROM library_revisions WHERE user_id = ? ORDER BY version DESC LIMIT 1')
      .get(req.user.userId);

    const FIVE_MIN = 5 * 60 * 1000;
    const lastMs = last && last.saved_at ? Date.parse(String(last.saved_at)) : NaN;
    const shouldSnapshot = !Number.isFinite(lastMs) || (Date.now() - lastMs) >= FIVE_MIN;

    if (shouldSnapshot) {
      db.prepare('INSERT OR IGNORE INTO library_revisions (user_id, version, data_json, saved_at) VALUES (?, ?, ?, ?)')
        .run(req.user.userId, nextVersion, payload, updatedAt);

      // Keep the newest 3 revisions.
      const rows = db.prepare('SELECT version FROM library_revisions WHERE user_id = ? ORDER BY version DESC').all(req.user.userId);
      if (rows.length > 3) {
        const toDelete = rows.slice(3).map((r) => r.version);
        const del = db.prepare('DELETE FROM library_revisions WHERE user_id = ? AND version = ?');
        for (const v of toDelete) del.run(req.user.userId, v);
      }
    }
  });

  try {
    tx();
    return res.json({ ok: true, version: nextVersion, updatedAt, forced: !!force });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/revisions', authMiddleware, (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query && req.query.limit) || 20));
  const items = db.prepare('SELECT version, saved_at FROM library_revisions WHERE user_id = ? ORDER BY version DESC LIMIT ?')
    .all(req.user.userId, limit)
    .map((r) => ({ version: r.version, savedAt: r.saved_at }));
  return res.json({ items });
});

app.post('/api/revisions/:version/restore', authMiddleware, (req, res) => {
  const version = Number(req.params.version);
  if (!Number.isFinite(version) || version <= 0) return res.status(400).json({ error: 'bad version' });

  const rev = db.prepare('SELECT data_json, saved_at FROM library_revisions WHERE user_id = ? AND version = ?')
    .get(req.user.userId, version);
  if (!rev) return res.status(404).json({ error: 'not found' });

  const current = db.prepare('SELECT version FROM libraries WHERE user_id = ?').get(req.user.userId);
  const nextVersion = (current ? current.version : 0) + 1;
  const updatedAt = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO libraries (user_id, data_json, version, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        data_json = excluded.data_json,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(req.user.userId, rev.data_json, nextVersion, updatedAt);
  });

  try {
    tx();
    return res.json({ ok: true, version: nextVersion, updatedAt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/archives', authMiddleware, (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query && req.query.limit) || 50));
  const items = db.prepare('SELECT id, name, created_at FROM library_archives WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(req.user.userId, limit)
    .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  return res.json({ items });
});

app.post('/api/archives', authMiddleware, (req, res) => {
  const name = (req.body && typeof req.body.name === 'string' && req.body.name.trim()) ? req.body.name.trim() : null;
  const data = (req.body && req.body.data && typeof req.body.data === 'object') ? req.body.data : null;

  let payload = null;
  if (data) payload = JSON.stringify(data);
  if (!payload) {
    const row = db.prepare('SELECT data_json FROM libraries WHERE user_id = ?').get(req.user.userId);
    if (!row) return res.status(400).json({ error: 'no library to archive' });
    payload = row.data_json;
  }

  const createdAt = new Date().toISOString();
  const archiveName = name || `手动存档 ${createdAt}`;
  const info = db.prepare('INSERT INTO library_archives (user_id, name, data_json, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.userId, archiveName, payload, createdAt);

  return res.json({ ok: true, id: info.lastInsertRowid, createdAt });
});

app.delete('/api/archives/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad id' });

  const info = db.prepare('DELETE FROM library_archives WHERE user_id = ? AND id = ?').run(req.user.userId, id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  return res.json({ ok: true });
});

app.post('/api/archives/:id/restore', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad id' });

  const row = db.prepare('SELECT data_json, name FROM library_archives WHERE user_id = ? AND id = ?').get(req.user.userId, id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const current = db.prepare('SELECT version FROM libraries WHERE user_id = ?').get(req.user.userId);
  const nextVersion = (current ? current.version : 0) + 1;
  const updatedAt = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO libraries (user_id, data_json, version, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        data_json = excluded.data_json,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(req.user.userId, row.data_json, nextVersion, updatedAt);

    return res.json({ ok: true, version: nextVersion, updatedAt, restoredFrom: { id, name: row.name } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

// Static UI: serve the app from /public (bundled in Dockerfile from /web)
const publicDirFromEnv = process.env.PUBLIC_DIR ? path.resolve(process.env.PUBLIC_DIR) : null;
const publicDirCandidates = [
  publicDirFromEnv,
  path.join(__dirname, '..', 'public'),
  path.join(__dirname, '..', '..', 'web'),
].filter(Boolean);

let publicDir = publicDirCandidates[0];
for (const candidate of publicDirCandidates) {
  try {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      publicDir = candidate;
      break;
    }
  } catch (_) {}
}
publicDir = path.resolve(publicDir);

app.use(express.static(publicDir));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Save_hzr listening on :${port} (static: ${publicDir})`);
});
