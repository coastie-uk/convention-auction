/**
 * @file        db.js
 * @description Database support function. Includes db schema and wrapper to support transition from sqlite3 to better-sqlite3.
 * @author      Chris Staples
 * @license     GPL3
 */
const linuxusername = process.env.USER || "Unknown";

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { version: backendVersion = 'Unknown' } = require('./package.json');
const schemaVersion = '3.0';
const { logLevels, log } = require('./logger');
const bcrypt = require('bcryptjs');
const { ROLE_LIST, PERMISSION_LIST, ROOT_USERNAME } = require('./auth-constants');
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
// 2.4  Adds username-based users with multi-role permissions
// 2.5  Adds items.last_print for item slip print tracking, add seconds to timekstamps
// 3.0  Adds items.last_slide_export and items.last_card_export for export tracking, Adds items.last_bid_update for authoritative bid/retract ordering. Adds bidder ready state/fingerprint and item collection tracking for live feed. Adds donation tracking columns for cashier payments and SumUp intents
//      Adds users.permissions for shared-login capability permissions
//      Adds users.session_invalid_before for remote session invalidation
//      Adds users.preferences for persisted per-user UI preferences
//      Adds soft-delete metadata to items

 

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

function parseSchemaVersion(version) {
  if (version == null) return null;
  const match = String(version).trim().match(/^(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    raw: String(version).trim(),
    major: Number(match[1]),
    minor: Number(match[2])
  };
}

function compareSchemaVersions(left, right) {
  const a = parseSchemaVersion(left);
  const b = parseSchemaVersion(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major - b.major;
  return a.minor - b.minor;
}

let existingSchemaVersion = null;
try {
  const row = db.prepare("SELECT value FROM metadata WHERE data = 'schema_version'").get();
  if (row && row.value != null) {
    existingSchemaVersion = String(row.value);
  }
} catch (e) {
  existingSchemaVersion = null;
}

const parsedExistingSchema = parseSchemaVersion(existingSchemaVersion);
const parsedCurrentSchema = parseSchemaVersion(schemaVersion);
const schemaComparison = existingSchemaVersion == null ? null : compareSchemaVersions(existingSchemaVersion, schemaVersion);

if (schemaComparison != null && schemaComparison > 0) {
  log(
    'General',
    logLevels.WARN,
    `Database schema version (${existingSchemaVersion}) is newer than application schema version (${schemaVersion}). This may cause issues.`
  );
}

function createSchema() {
  db.exec(`CREATE TABLE IF NOT EXISTS auctions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        short_name TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        created_at TEXT DEFAULT (strftime('%d-%m-%Y %H:%M:%S','now','localtime')),
        logo TEXT,
        public_id TEXT,
        admin_can_change_state INTEGER NOT NULL DEFAULT 0,
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
        last_print TEXT,
        last_slide_export TEXT,
        last_card_export TEXT,
        last_bid_update TEXT,
        collected_at TEXT,
        text_mod_date TEXT,
        item_number INTEGER,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        deleted_by TEXT,
        auction_id INTEGER REFERENCES auctions(id),
        test_item INTEGER,
        test_bid INTEGER,
        winning_bidder_id INTEGER, 
        hammer_price REAL
    )`);

  db.exec(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY COLLATE NOCASE,
        password TEXT NOT NULL,
        roles TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]',
        preferences TEXT NOT NULL DEFAULT '{}',
        session_invalid_before INTEGER NOT NULL DEFAULT 0,
        is_root INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
        updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
    )`);

  db.exec(`CREATE TABLE IF NOT EXISTS bidders (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        paddle_number INTEGER NOT NULL,
        name          TEXT,
        ready_for_collection INTEGER NOT NULL DEFAULT 0,
        ready_fingerprint TEXT,
        ready_updated_at TEXT,
        created_at    TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
        auction_id INTEGER
      )`);

  db.exec(`CREATE TABLE IF NOT EXISTS payments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        bidder_id   INTEGER NOT NULL,
        amount      REAL    NOT NULL,
        donation_amount REAL NOT NULL DEFAULT 0,
        method      TEXT    NOT NULL DEFAULT 'cash',
        note        TEXT,
        created_by  TEXT,
        provider    TEXT    NOT NULL DEFAULT 'unknown',
        provider_txn_id TEXT,
        intent_id   TEXT,
        currency    TEXT,
        raw_payload TEXT,
        reverses_payment_id INTEGER,
        reversal_reason TEXT,
        created_at  TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')),
        FOREIGN KEY (bidder_id) REFERENCES bidders(id),
        FOREIGN KEY (intent_id) REFERENCES payment_intents(intent_id)
      )`);

  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user        TEXT,
        action      TEXT,
        object_type TEXT,
        object_id   INTEGER,
        details     TEXT,
        created_at  TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
      )`);

  // Pending SumUp (and future) payment requests the server creates
  db.exec(`CREATE TABLE IF NOT EXISTS payment_intents (
      intent_id TEXT PRIMARY KEY,
      bidder_id INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL,       -- pence, to avoid floating issues
      donation_minor INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      currency TEXT NOT NULL DEFAULT 'GBP',
      channel TEXT NOT NULL DEFAULT 'app', -- 'app' (SumUp app) | 'hosted' (optional)
      status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','expired','cancelled')),
      sumup_checkout_id TEXT,              -- only for hosted flow (optional)
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      expires_at TEXT,
      note TEXT,
      FOREIGN KEY (bidder_id) REFERENCES bidders(id)
    )`);

  db.exec("CREATE TABLE IF NOT EXISTS metadata (data TEXT UNIQUE NOT NULL, value TEXT)");

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_bidder_auction_paddle ON bidders(auction_id, paddle_number)");
  db.exec("CREATE INDEX IF NOT EXISTS ix_payments_reverses_payment_id ON payments(reverses_payment_id)");
  db.exec("CREATE INDEX IF NOT EXISTS ix_payments_bidder_created_at ON payments(bidder_id, created_at)");

  // These are critical to prevent duplicate payment records for the same provider transaction.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_payments_txn ON payments(provider, provider_txn_id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_payments_intent ON payments(provider, intent_id)");

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_single_root ON users(is_root) WHERE is_root = 1");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username_nocase ON users(username COLLATE NOCASE)");
}

function migrateSchemaWithinV3(existingVersion) {
  const parsed = parseSchemaVersion(existingVersion);
  if (!parsed || parsed.major !== parsedCurrentSchema.major) {
    return;
  }

  // Placeholder for future 3.x migrations.
  if (parsed.minor < 0) {
    log('General', logLevels.INFO, 'Running 3.x schema migrations');

    recordStartupAudit("Database migrated within v3", {
      method: "db.js migrateSchemaWithinV3",
      user: linuxusername,
      from_version: existingVersion,
      to_version: schemaVersion
    });
  }
}

function writeSchemaVersion() {
  try {
    const updateSchema = db.prepare("UPDATE metadata SET value = ? WHERE data = 'schema_version'");
    const result = updateSchema.run(schemaVersion);
    if (result.changes === 0) {
      db.prepare("INSERT INTO metadata (data, value) VALUES ('schema_version', ?)").run(schemaVersion);
    }
  } catch (e) {
    log('General', logLevels.ERROR, `Failed to write schema version metadata: ${e.message}`);
  }
}

function writeCreationMetadata() {
  try {
    const insertMetadata = db.prepare("INSERT OR IGNORE INTO metadata (data, value) VALUES (?, ?)");
    insertMetadata.run('database_created_at', new Date().toISOString());
    insertMetadata.run('database_created_by_backend_version', String(backendVersion || 'Unknown'));
  } catch (e) {
    log('General', logLevels.ERROR, `Failed to write database creation metadata: ${e.message}`);
  }
}

function insertMetadataIfMissing(key, value) {
  try {
    db.prepare("INSERT OR IGNORE INTO metadata (data, value) VALUES (?, ?)").run(key, value);
  } catch (e) {
    log('General', logLevels.ERROR, `Failed to insert metadata "${key}": ${e.message}`);
  }
}

function setMetadataValue(key, value) {
  try {
    db.prepare(`
      INSERT INTO metadata (data, value) VALUES (?, ?)
      ON CONFLICT(data) DO UPDATE SET value = excluded.value
    `).run(key, value);
  } catch (e) {
    log('General', logLevels.ERROR, `Failed to set metadata "${key}": ${e.message}`);
  }
}

function getMetadataValue(key) {
  try {
    const row = db.prepare("SELECT value FROM metadata WHERE data = ?").get(key);
    return row?.value ?? null;
  } catch (e) {
    log('General', logLevels.ERROR, `Failed to read metadata "${key}": ${e.message}`);
    return null;
  }
}

function recordStartupAudit(action, details = {}) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user, action, object_type, object_id, details, created_at)
      VALUES (?, ?, 'server', NULL, ?, strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
    `).run('system', action, JSON.stringify(details));
  } catch (e) {
    log('General', logLevels.ERROR, `Failed to record startup audit event: ${e.message}`);
  }
}

if (isNewDatabase) {
  log(
    'General',
    logLevels.WARN,
    `Schema version missing or mismatched (db=${existingSchemaVersion ?? 'missing'}, expected=${schemaVersion}); Running DB setup`
  );

  try {
    createSchema();
  } catch (err) {
    log('General', logLevels.ERROR, `Database error: ${err.message}`);
    throw err;
  }
} else if (!parsedExistingSchema) {
  const error = new Error(
    `Unsupported database schema: existing database at ${dbPath} does not report a valid schema_version metadata value. Only 3.x databases are supported by this backend.`
  );
  log('General', logLevels.ERROR, error.message);
  throw error;
} else if (parsedExistingSchema.major < parsedCurrentSchema.major) {
  const error = new Error(
    `Unsupported database schema version ${existingSchemaVersion} at ${dbPath}. Automatic upgrade from 2.x or earlier is not supported.`
  );
  log('General', logLevels.ERROR, error.message);
  throw error;
} else if (schemaComparison < 0) {
  log(
    'General',
    logLevels.WARN,
    `Schema version mismatch within supported range (db=${existingSchemaVersion}, expected=${schemaVersion}); Running DB setup`
  );

  try {
    migrateSchemaWithinV3(existingSchemaVersion);
    createSchema();
  } catch (err) {
    log('General', logLevels.ERROR, `Database migration error: ${err.message}`);
    throw err;
  }
} else {
  log('General', logLevels.INFO, `Database schema version is current, skipping DB setup`);
}


  // 2.4: Move to username-based accounts with multi-role permissions.
  const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);

   const ensureHashedPassword = (password, label) => {
    const text = String(password || '');
    if (!text) return null;
    if (isBcryptHash(text)) return text;
    const hashed = bcrypt.hashSync(text, 12);
    log('General', logLevels.INFO, `Upgraded plaintext password to bcrypt for ${label}`);
    return hashed;
  };

  try {
  

    // Root is canonical and unique.
    db.prepare('UPDATE users SET is_root = 0 WHERE lower(username) <> ?').run(ROOT_USERNAME);

    db.prepare(`UPDATE users SET permissions = COALESCE(NULLIF(TRIM(permissions), ''), '[]')`).run();

    const rootRow = db.prepare('SELECT rowid, password FROM users WHERE lower(username) = ?').get(ROOT_USERNAME);
    if (!rootRow) {
      const rootPassword = crypto.randomBytes(18).toString('base64url');
      const rootHash = bcrypt.hashSync(rootPassword, 12);
      db.prepare(`
        INSERT INTO users (username, password, roles, permissions, session_invalid_before, is_root, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, 1, strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'), strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
      `).run(ROOT_USERNAME, rootHash, JSON.stringify(ROLE_LIST), JSON.stringify(PERMISSION_LIST));

      log('General', logLevels.WARN, 'Created default root account with full permissions.');
      log('General', logLevels.WARN, `Initial root password (shown once): ${rootPassword}`);
      console.warn(`[security] Initial ${ROOT_USERNAME} password (shown once): ${rootPassword}`);
    } else {
      const rootHash = ensureHashedPassword(rootRow.password, ROOT_USERNAME);
      if (rootHash) {
        db.prepare(`
          UPDATE users
          SET username = ?, password = ?, roles = ?, permissions = ?, is_root = 1, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
          WHERE rowid = ?
        `).run(ROOT_USERNAME, rootHash, JSON.stringify(ROLE_LIST), JSON.stringify(PERMISSION_LIST), rootRow.rowid);
      }
    }
  } catch (e) {
    log('General', logLevels.ERROR, `User account migration failed: ${e.message}`);
  }

if (isNewDatabase || (schemaComparison != null && schemaComparison < 0)) {
  writeSchemaVersion();
  if (isNewDatabase) {
    writeCreationMetadata();
  }
  recordStartupAudit("Database created", {
    method: "db.js",
    user: linuxusername,
    schema_version: schemaVersion
  });
}

insertMetadataIfMissing('database_id', crypto.randomUUID());
setMetadataValue('last_started_at', new Date().toISOString());

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
  getMetadataValue,
  insertMetadataIfMissing,
  setMetadataValue,
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
