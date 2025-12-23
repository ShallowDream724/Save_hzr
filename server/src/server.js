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
app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST', 'PUT'], allowedHeaders: ['Content-Type', 'Authorization', 'If-Match'] }));

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

  const current = db.prepare('SELECT version FROM libraries WHERE user_id = ?').get(req.user.userId);
  const currentVersion = current ? current.version : 0;
  if (expected !== null && !Number.isNaN(expected) && expected !== currentVersion) {
    return res.status(409).json({ error: 'version conflict', version: currentVersion });
  }

  const payload = JSON.stringify(data);
  const nextVersion = currentVersion ? currentVersion + 1 : 1;
  const updatedAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO libraries (user_id, data_json, version, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      data_json = excluded.data_json,
      version = excluded.version,
      updated_at = excluded.updated_at
  `);
  stmt.run(req.user.userId, payload, nextVersion, updatedAt);
  return res.json({ ok: true, version: nextVersion, updatedAt });
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
