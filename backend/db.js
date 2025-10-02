/**
 * @file        db.js
 * @description Database support function. Includes db schema and wrapper to support transition from sqlite3 to better-sqlite3.
 * @author      Chris Staples
 * @license     GPL3
 */

const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, 'auction.db'));

const { logLevels, log } = require('./logger');

try {

    db.exec(`CREATE TABLE IF NOT EXISTS auctions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        short_name TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        created_at TEXT DEFAULT (strftime('%d-%m-%Y %H:%M','now')),
        logo TEXT,
        status TEXT DEFAULT 'setup'
        )`);

    db.exec(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT,
        contributor TEXT,
        artist TEXT,
        photo TEXT,
        date TEXT,
        notes TEXT,
        mod_date TEXT,
        item_number INTEGER,
        auction_id INTEGER REFERENCES auctions(id),
        test_item INTEGER,
        test_bid INTEGER,
        winning_bidder_id INTEGER, 
        hammer_price REAL
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS passwords (
        role TEXT PRIMARY KEY,
        password TEXT NOT NULL
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS bidders (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        paddle_number INTEGER NOT NULL,
        name          TEXT,
        created_at    TEXT DEFAULT (strftime('%Y-%m-%d %H:%M', 'now')),
        auction_id INTEGER
      )`);

    db.exec(`CREATE TABLE IF NOT EXISTS payments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        bidder_id   INTEGER NOT NULL,
        amount      REAL    NOT NULL,
        method      TEXT    NOT NULL DEFAULT 'cash',
        note        TEXT,
        created_by  TEXT,
        created_at  TEXT DEFAULT (strftime('%Y-%m-%d %H:%M', 'now')),
        FOREIGN KEY (bidder_id) REFERENCES bidders(id)
      )`);

    db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user        TEXT,
        action      TEXT,
        object_type TEXT,
        object_id   INTEGER,
        details     TEXT,
        created_at  TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
      )`);

    // create uniqueness on (auction_id, paddle_number)
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_bidder_auction_paddle ON bidders(auction_id, paddle_number)");

    // Add admin_state_change
    db.exec("ALTER TABLE auctions ADD COLUMN admin_can_change_state INTEGER NOT NULL DEFAULT 0; -- 0=false, 1=true");

// one-time default passwords
const defaultPasswords = [
  { role: "admin",       password: "a1234" },
  { role: "maintenance", password: "m1234" },
  { role: "cashier",     password: "c1234" }
];

const insertPwd = db.prepare(
  "INSERT OR IGNORE INTO passwords (role, password) VALUES (?, ?)"
);

for (const { role, password } of defaultPasswords) {
  insertPwd.run(role, password);      
}

log('General', logLevels.INFO, 'Database opened');

} catch (err) {
    log('General', logLevels.ERROR, `Database error: ${err.message}`);
}

// ──────────────────────────────────────────────────────────────
// Performance / concurrency tuning
db.pragma('journal_mode = WAL');   // enables write-ahead logging
db.pragma('synchronous = NORMAL'); // (optional) good combo with WAL
db.pragma('busy_timeout = 5000');  // (optional) wait 5 s if DB is locked
// ──────────────────────────────────────────────────────────────

// Helper to fake the old callback signature
function callCb(cb, err, rowsOrInfo) {
  if (typeof cb === 'function') {
    if (rowsOrInfo && typeof rowsOrInfo === 'object') {
      // emulate sqlite3's this.{lastID,changes} binding
      const ctx = {
        lastID : rowsOrInfo.lastInsertRowid,
        changes: rowsOrInfo.changes
      };
      cb.call(ctx, err, rowsOrInfo.rows ?? rowsOrInfo);   // keep row list for .all/.get
    } else {
      cb.call({}, err);
    }
  }
}

module.exports = {
  /** run() – INSERT / UPDATE / DELETE */
  run(sql, params = [], cb) {
    try {
      const info = db.prepare(sql).run(...params);
      callCb(cb, null, info);
      return info;
    } catch (e) {
      callCb(cb, e);
      throw e;
    }
  },

  /** get() – single row */
  get(sql, params = [], cb) {
    try {
      const row = db.prepare(sql).get(...params);
      callCb(cb, null, row);
      return row;
    } catch (e) {
      callCb(cb, e);
      throw e;
    }
  },

  /** all() – multiple rows */
  all(sql, params = [], cb) {
    try {
      const rows = db.prepare(sql).all(...params);
      callCb(cb, null, rows);
      return rows;
    } catch (e) {
      callCb(cb, e);
      throw e;
    }
  },

  /** expose the underlying driver  */
  // prepare  : (...args) => db.prepare(...args),


prepare  : (...args) => {
const stmt = db.prepare(...args);

    // ---- compatibility shim ---------------------------------
    // old sqlite3 statements had .finalize(); many places call it
    if (typeof stmt.finalize !== 'function') {
      stmt.finalize = () => { /* no-op for better-sqlite3 */ };
    }
    // ----------------------------------------------------------

    return stmt;
  },

  transaction : (...args) => db.transaction(...args),
  close    : () => db.close()
};
