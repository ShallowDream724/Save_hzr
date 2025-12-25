const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function openDb() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'app.db');
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch (_) {}
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS libraries (
      user_id INTEGER PRIMARY KEY,
      data_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_revisions (
      user_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      saved_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, version),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_archives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- AI async import jobs (robust background processing)
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      book_id TEXT,
      type TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      progress_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      book_id TEXT,
      model TEXT NOT NULL,
      kind TEXT NOT NULL,
      idx INTEGER NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      delayed_until TEXT,
      input_path TEXT,
      input_mime TEXT,
      result_json TEXT,
      error TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES ai_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (job_id, idx)
    );

    -- AI conversations (separate from libraries JSON; multi-device sync)
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      scope TEXT NOT NULL,
      book_id TEXT,
      chapter_id TEXT,
      question_id TEXT,
      question_key TEXT,
      title TEXT,
      model_pref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content_text TEXT NOT NULL,
      content_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Lightweight migrations (safe to re-run).
  // Device metadata is used to label archives/revisions without storing IP.
  try { db.exec(`ALTER TABLE library_archives ADD COLUMN device_id TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE library_archives ADD COLUMN device_label TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE library_revisions ADD COLUMN device_id TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE library_revisions ADD COLUMN device_label TEXT`); } catch (_) {}

  // AI indexes (safe to re-run)
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_created ON ai_jobs(user_id, created_at DESC)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_status ON ai_jobs(user_id, status)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_job_items_job ON ai_job_items(job_id, idx)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_job_items_sched ON ai_job_items(model, status, delayed_until, created_at)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_created ON ai_messages(conversation_id, created_at)`); } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated ON ai_conversations(user_id, updated_at DESC)`); } catch (_) {}

  // Unique "question conversation" reuse (partial unique indexes)
  // Prefer stable question_id triplet when available; otherwise fall back to question_key.
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_conversations_question_key ON ai_conversations(user_id, question_key) WHERE question_key IS NOT NULL`); } catch (_) {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_conversations_question_triplet ON ai_conversations(user_id, book_id, chapter_id, question_id) WHERE scope='question' AND question_id IS NOT NULL`); } catch (_) {}

  return db;
}

module.exports = { openDb };
