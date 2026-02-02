/**
 * @file        db.js
 * @description Database support function. Includes db schema and wrapper to support transition from sqlite3 to better-sqlite3.
 * @author      Chris Staples
 * @license     GPL3
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const schemaVersion = '2.3'; 
const { logLevels, log } = require('./logger');
const bcrypt = require('bcryptjs');
const {
    DB_PATH,
    DB_NAME
} = require('./config');

// Schema Version history
// 1.0   Initial version using sqlite3. Items only
// 1.1   Switch to better-sqlite3. Add passwords table
// 2.0   Adds auctions, bidders, payments and audit tables to align with convention-auction 1.0
// 2.1   Add admin_can_change_state to auctions table
// 2.2  Add payment_intents table and additional payments columns for SumUp integration
// 2.3  Adds reversals

let dbPath = path.join(DB_PATH, DB_NAME);
if (DB_PATH === ".") {

  log('General', logLevels.WARN, 'Using relative directory for database path; this is not recommended for production use.');
  // get the absolute path
  dbPath = path.resolve(DB_NAME);
}
  
const isNewDatabase = !fs.existsSync(dbPath);
if (isNewDatabase) {
  log('General', logLevels.WARN, `Database file not found; creating new database at ${dbPath}`);
} else {
  log('General', logLevels.INFO, 'Using existing database at ' + dbPath);
}

let db = new Database(dbPath);
let connectionId = 1;
let maintenanceLock = false;

let existingSchemaVersion = null;
try {
  const row = db.prepare("SELECT value FROM metadata WHERE data = 'schema_version'").get();
  if (row && row.value != null) {
    existingSchemaVersion = String(row.value);
  }
} catch (e) {
  existingSchemaVersion = null;
}

if(existingSchemaVersion !== schemaVersion || isNewDatabase)
{
  log(
    'General',
    logLevels.WARN,
    `Schema version missing or mismatched (db=${existingSchemaVersion ?? 'missing'}, expected=${schemaVersion}); Running DB setup`
  );


// Initial schema setup


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



    // Pending SumUp (and future) payment requests the server creates
    db.exec(`CREATE TABLE IF NOT EXISTS payment_intents (
      intent_id TEXT PRIMARY KEY,
      bidder_id INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL,       -- pence, to avoid floating issues
      currency TEXT NOT NULL DEFAULT 'GBP',
      channel TEXT NOT NULL DEFAULT 'app', -- 'app' (SumUp app) | 'hosted' (optional)
      status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','expired','cancelled')),
      sumup_checkout_id TEXT,              -- only for hosted flow (optional)
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      FOREIGN KEY (bidder_id) REFERENCES bidders(id)
    )`);

      db.exec("CREATE TABLE IF NOT EXISTS metadata (data TEXT UNIQUE NOT NULL, value TEXT)");


  } catch (err) {
    log('General', logLevels.ERROR, `Database error: ${err.message}`);
  }

  // Modifications to existing tables for schema version upgrades - Try to add columns/indexes, ignore errors if they already exist

  // 2.2 - 2.3: Add reversals to payments table (deprecates delete payment)
  try { db.exec("ALTER TABLE payments ADD COLUMN reverses_payment_id INTEGER"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE payments ADD COLUMN reversal_reason TEXT"); } catch (e) { /* already exists */ }
  try { db.exec("CREATE INDEX IF NOT EXISTS ix_payments_reverses_payment_id ON payments(reverses_payment_id)"); } catch (e) { /* already exists */ }
  try { db.exec("CREATE INDEX IF NOT EXISTS ix_payments_bidder_created_at ON payments(bidder_id, created_at)"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE auctions ADD COLUMN public_id TEXT"); } catch (e) { /* already exists */ }
  try { db.exec("CREATE TABLE IF NOT EXISTS metadata (data TEXT UNIQUE NOT NULL, value TEXT)"); } catch (e) { }


  // 2.1 -> 2.2: Add payment provider metadata to payments table
  try { db.exec("ALTER TABLE payments ADD COLUMN provider TEXT not null default 'unknown'"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE payments ADD COLUMN provider_txn_id TEXT"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE payments ADD COLUMN intent_id TEXT"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE payments ADD COLUMN currency TEXT"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE payments ADD COLUMN raw_payload TEXT"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE payments ADD COLUMN FOREIGN KEY (intent_id) REFERENCES payment_intents(intent_id)"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE payment_intents ADD COLUMN note TEXT"); } catch (e) { /* already exists */ }


  // These are critical to prevent duplicate payment records for the same provider transaction - SumUp may send multiple notifications for the same payment
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_payments_txn ON payments(provider, provider_txn_id)`); } catch (e) { /* already exists */ }
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_payments_intent ON payments(provider, intent_id)`); } catch (e) { /* already exists */ }


  // 2.0 -> 2.1 Add admin_state_change
  try { db.exec("ALTER TABLE auctions ADD COLUMN admin_can_change_state INTEGER NOT NULL DEFAULT 0; -- 0=false, 1=true"); } catch (e) { /* already exists */ }

  // one-time default passwords (stored as bcrypt hashes)
  const defaultPasswords = [
    { role: "admin",       password: "admin123" },
    { role: "maintenance", password: "maint123" },
    { role: "cashier",     password: "cashier123" }
  ];

  const insertPwd = db.prepare(
    "INSERT OR IGNORE INTO passwords (role, password) VALUES (?, ?)"
  );

  for (const { role, password } of defaultPasswords) {
    // Hash defaults synchronously at startup with a reasonable cost factor
    const hashed = bcrypt.hashSync(password, 12);
    insertPwd.run(role, hashed);
  }

  // Ensure any existing plaintext passwords are upgraded to bcrypt hashes.
  try {
    const rows = db.prepare('SELECT role, password FROM passwords').all();
    for (const r of rows) {
      const p = r.password || '';
      if (typeof p === 'string' && !p.startsWith('$2')) {
        // Likely plaintext; hash and update
        try {
          const h = bcrypt.hashSync(p, 12);
          db.prepare('UPDATE passwords SET password = ? WHERE role = ?').run(h, r.role);
          log('General', logLevels.INFO, `Upgraded plaintext password to bcrypt for role ${r.role}`);
        } catch (e) {
          log('General', logLevels.ERROR, `Failed to hash password for role ${r.role}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    log('General', logLevels.ERROR, `Password migration check failed: ${e.message}`);
  }

  try {
    const updateSchema = db.prepare("UPDATE metadata SET value = ? WHERE data = 'schema_version'");
    const result = updateSchema.run(schemaVersion);
    if (result.changes === 0) {
      db.prepare("INSERT INTO metadata (data, value) VALUES ('schema_version', ?)").run(schemaVersion);
    }
  } catch (e) {
    log('General', logLevels.ERROR, `Failed to write schema version metadata: ${e.message}`);
  }
} else {
    log('General', logLevels.INFO, `Database schema version is current, skipping DB setup`);


}

log('General', logLevels.INFO, 'Database opened');



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
  schemaVersion,
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

  pragma(statement) {
    try {
      db.pragma(statement);
    } catch (e) {
      log('DB', logLevels.ERROR, `PRAGMA error: ${e.message}`);
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
  close    : () => db.close(),
  reopen({ skipClose = false } = {}) {
    if (!skipClose) {
      try {
        db.close();
        log('DB', logLevels.INFO, "Database closed");
      } catch (e) {
        log('DB', logLevels.WARN, `DB close during reopen failed: ${e.message}`);
      }
    }
    db = new Database(dbPath);
    connectionId += 1;
            log('DB', logLevels.INFO, "database connection re-established. ID=" + connectionId);

  },
  getConnectionId() {
    return connectionId;
  },
  setMaintenanceLock(value) {
    maintenanceLock = Boolean(value);
  },
  isMaintenanceLocked() {
    return maintenanceLock;
  }
};
