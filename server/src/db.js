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
  `);

  return db;
}

module.exports = { openDb };
