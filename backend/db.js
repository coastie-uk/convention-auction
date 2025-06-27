// db.js
const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, 'auction.db'));

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

  /** expose the underlying driver when you really need it */
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
