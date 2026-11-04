// #996 — Lost-items database (SQLite)
// Creates the database file and tables on first run, and exposes helper
// functions the rest of the app uses. Verification answers are never stored
// in plain text: they are normalized and hashed with scrypt + a per-item salt.

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'lostfound.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    title                 TEXT    NOT NULL,
    description           TEXT    NOT NULL,
    location_found        TEXT,
    photo_path            TEXT,
    verification_question TEXT    NOT NULL,
    answer_hash           TEXT    NOT NULL,
    answer_salt           TEXT    NOT NULL,
    poster_email          TEXT    NOT NULL,
    status                TEXT    NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'claimed')),
    created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS claims (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id        INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    claimant_name  TEXT    NOT NULL,
    claimant_email TEXT    NOT NULL,
    correct        INTEGER NOT NULL CHECK (correct IN (0, 1)),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
  CREATE INDEX IF NOT EXISTS idx_claims_item  ON claims(item_id, claimant_email);
`);

// --- answer hashing -------------------------------------------------------

// "  Blue Sticker! " and "blue sticker" should count as the same answer.
function normalizeAnswer(answer) {
  return String(answer).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function hashAnswer(answer, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(normalizeAnswer(answer), salt, 64).toString('hex');
  return { hash, salt };
}

function answerMatches(answer, hash, salt) {
  const attempt = Buffer.from(hashAnswer(answer, salt).hash, 'hex');
  const stored = Buffer.from(hash, 'hex');
  return attempt.length === stored.length && crypto.timingSafeEqual(attempt, stored);
}

// --- items ---------------------------------------------------------------

// Public columns only — the answer hash/salt and poster email never leave the DB.
const PUBLIC_COLS = `id, title, description, location_found, photo_path,
                     verification_question, status, created_at`;

function createItem({ title, description, location_found, photo_path,
                      verification_question, verification_answer, poster_email }) {
  const { hash, salt } = hashAnswer(verification_answer);
  const info = db.prepare(`
    INSERT INTO items (title, description, location_found, photo_path,
                       verification_question, answer_hash, answer_salt, poster_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, description, location_found || null, photo_path || null,
         verification_question, hash, salt, poster_email);
  return getItem(info.lastInsertRowid);
}

function listItems({ status = 'open', q } = {}) {
  let sql = `SELECT ${PUBLIC_COLS} FROM items WHERE status = ?`;
  const params = [status];
  if (q) {
    // Escape LIKE wildcards so a search for "%" or "_" is taken literally.
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    sql += ` AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`;
    params.push(like, like);
  }
  return db.prepare(sql + ' ORDER BY created_at DESC, id DESC').all(...params);
}

function getItem(id) {
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM items WHERE id = ?`).get(id);
}

// --- claims (#997) -------------------------------------------------------

const MAX_ATTEMPTS = 3; // wrong answers allowed per email per item

function failedAttempts(itemId, email) {
  return db.prepare(`SELECT COUNT(*) AS n FROM claims
                     WHERE item_id = ? AND claimant_email = ? AND correct = 0`)
           .get(itemId, email).n;
}

// Returns { ok, reason?, attemptsLeft?, posterEmail? }
const submitClaim = db.transaction(({ itemId, name, email, answer }) => {
  const row = db.prepare(`SELECT * FROM items WHERE id = ?`).get(itemId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'open') return { ok: false, reason: 'already_claimed' };

  const used = failedAttempts(itemId, email);
  if (used >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts', attemptsLeft: 0 };

  const correct = answerMatches(answer, row.answer_hash, row.answer_salt);
  db.prepare(`INSERT INTO claims (item_id, claimant_name, claimant_email, correct)
              VALUES (?, ?, ?, ?)`).run(itemId, name, email, correct ? 1 : 0);

  if (!correct) {
    return { ok: false, reason: 'wrong_answer', attemptsLeft: MAX_ATTEMPTS - used - 1 };
  }
  db.prepare(`UPDATE items SET status = 'claimed' WHERE id = ?`).run(itemId);
  return { ok: true, posterEmail: row.poster_email };
});

module.exports = { db, createItem, listItems, getItem, submitClaim,
                   normalizeAnswer, MAX_ATTEMPTS };
