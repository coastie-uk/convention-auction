/**
 * @file        maintenance.js
 * @description Provides maintenance functions which are called by the maintenance GUI
 * @author      Chris Staples
 * @license     GPL3
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Parser } = require("@json2csv/plainjs");
const { exec } = require("child_process");
const router = express.Router();
const { CONFIG_IMG_DIR, SAMPLE_DIR, UPLOAD_DIR, DB_PATH, DB_NAME, BACKUP_DIR, MAX_UPLOADS, allowedExtensions, MAX_AUCTIONS, OUTPUT_DIR, LOG_LEVEL, PPTX_CONFIG_DIR, LOG_DIR, LOG_NAME, PASSWORD_MIN_LENGTH } = require('./config');

const { validateJsonPaths } = require('./middleware/json-path-validator');

const upload = multer({ dest: UPLOAD_DIR });
const sharp = require("sharp");
const db = require('./db');
// const CONFIG_PATH = path.join(__dirname, "./pptx-config/pptxConfig.json");
// const CARD_PATH = path.join(__dirname, "./pptx-config/cardConfig.json");
const archiver = require("archiver");
// const logFilePath = path.join(__dirname, 'server.log');
const logFilePath = path.join(LOG_DIR, LOG_NAME);
const logLines = 500;
// const CONFIG_PATHS = {
//   pptx: './pptx-config/pptxConfig.json',
//   card: './pptx-config/cardConfig.json'
// };

const CONFIG_PATHS = {
  pptx: path.join(PPTX_CONFIG_DIR, 'pptxConfig.json'),
  card: path.join(PPTX_CONFIG_DIR, 'cardConfig.json')
};

const { audit, auditTypes } = require('./middleware/audit');
const bcrypt = require('bcryptjs');
const maintenanceRoutes = require('./maintenance');
const { logLevels, setLogLevel, logFromRequest, createLogger, log } = require('./logger');

const checkAuctionState = require('./middleware/checkAuctionState')(
  db, { ttlSeconds: 2 }   // optional – default is 5
);

const allowedStatuses = ["setup", "locked", "live", "settlement", "archived"];



if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

// const CONFIG_IMG_DIR = path.join(__dirname, "resources");
if (!fs.existsSync(CONFIG_IMG_DIR)) fs.mkdirSync(CONFIG_IMG_DIR);

//--------------------------------------------------------------------------
// POST /backup
// API to backup database file to a folder on the server
//--------------------------------------------------------------------------

router.post("/backup", (req, res) => {
  const backupPath = path.join(BACKUP_DIR, `auction_backup_${Date.now()}.db`);
  const databaseFile = path.join(DB_PATH, DB_NAME);
  fs.copyFileSync(databaseFile, backupPath);
  res.json({ message: "Backup created", path: backupPath });
  logFromRequest(req, logLevels.INFO, `Database backup created ${backupPath}`);
});

//--------------------------------------------------------------------------
// GET /download-db
// API to download full DB
//--------------------------------------------------------------------------

router.get("/download-db", (req, res) => {
  res.download(path.join(DB_PATH, DB_NAME));
});

//--------------------------------------------------------------------------
// POST /restore
// API to restore full DB from an uploaded copy
//--------------------------------------------------------------------------

// router.post("/restore", async (req, res) => {
//   try {
//     await awaitMiddleware(upload.single('backup'))(req, res);

//     fs.copyFileSync(req.file.path, DB_PATH);
//     fs.unlinkSync(req.file.path);
//     res.json({ message: "Database restored." });
//     logFromRequest(req, logLevels.INFO, `Database restored`);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

const Database = require("better-sqlite3");

router.post("/restore", async (req, res) => {
  try {
    await awaitMiddleware(upload.single("backup"))(req, res);

    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const filePath = req.file.path;

    //  Try opening the uploaded DB
    try {
      const testDB = new Database(filePath, { readonly: true });
      testDB.pragma("user_version"); // simple test query
      testDB.close();
    } catch (dbErr) {
      fs.unlinkSync(filePath);
          logFromRequest(req, logLevels.ERROR, `Database restore failed. mot a database`);
        return res.status(400).json({ error: "Uploaded file is not a valid SQLite database." });
    }

    //  Valid DB – restore it
    fs.copyFileSync(filePath, path.join(DB_PATH, DB_NAME));
    fs.unlinkSync(filePath);

    logFromRequest(req, logLevels.INFO, `Database restored`);
    res.json({ message: "Database restored." });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


//--------------------------------------------------------------------------
// POST /reset
// API to reset auction (clear items, bids, payments). Requires explicit password
//--------------------------------------------------------------------------

router.post("/reset", checkAuctionState(['setup', 'archived']), (req, res) => {
  const { auction_id, password } = req.body;

  if (!auction_id || !password) {
    return res.status(400).json({ error: "Missing auction_id or password" });
  }

  try {
    const mPassword = db.prepare("SELECT password FROM passwords WHERE role = 'maintenance'").get();
    if (!mPassword || !bcrypt.compareSync(password, mPassword.password)) {
      logFromRequest(req, logLevels.WARN, `Incorrect maintenance password attempt for auction reset`);
      return res.status(401).json({ error: "Incorrect maintenance password" });
    }
  } catch (err) {
    return res.status(500).json({ error: "Error verifying password" });
  }

  try {
  //  db.pragma('defer_foreign_keys = ON');
    const result = db.transaction(id => {

      // Payment intents
      const delIntents = db.prepare(`DELETE FROM payment_intents WHERE bidder_id IN (SELECT id FROM bidders WHERE auction_id = ?)`).run(id).changes;
      
      /* payments */
      const delPay = db.prepare(`DELETE FROM payments WHERE bidder_id IN (SELECT id FROM bidders WHERE auction_id = ?)`).run(id).changes;

      /* items */
      const delItems = db.prepare(`DELETE FROM items WHERE auction_id = ?`).run(id).changes;

      /* bidders */
      const delBidders = db.prepare(`DELETE FROM bidders WHERE auction_id = ?`).run(id).changes;

      return { payment_intents: delIntents, payments: delPay, items: delItems, bidders: delBidders };
    })(auction_id);         // <-- execute the transaction

    res.json({
      ok: true,
      auction_id: auction_id,
      deleted: result        // { payments: n, items: n, bidders: n }
    });
    logFromRequest(req, logLevels.INFO, `Auction ${auction_id} has been reset. Removed: ${result.items} items, ${result.bidders} bidders, ${result.payments} payments, ${result.payment_intents} payment intents. `);
    audit(req.user.role, 'reset auction', 'auction', auction_id, { deleted: result  });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Reset failed' });
  }
 // db.pragma('defer_foreign_keys = OFF');
})

//--------------------------------------------------------------------------
// GET /export
// API to export items, bidders, and payments to CSV
//--------------------------------------------------------------------------

router.get("/export", (req, res) => {
  try {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `auction_export_${timestamp}.zip`;
    const archive = archiver("zip", { zlib: { level: 9 } });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    archive.on("warning", (err) => {
      console.warn("Export archive warning:", err.message);
    });
    archive.on("error", (err) => {
      console.error("Export archive error:", err.message);
      if (!res.headersSent) {
        res.status(500);
      }
      res.end();
    });

    archive.pipe(res);

    const tables = [
      { table: "auctions", filename: "auctions.csv" },
      { table: "items", filename: "items.csv" },
      { table: "bidders", filename: "bidders.csv" },
      { table: "payment_intents", filename: "payment_intents.csv" },
      { table: "payments", filename: "payments.csv" }
    ];

    const metadata = {
      exported_at: now.toISOString(),
      schema_version: db.schemaVersion,
      db_name: DB_NAME,
      tables: []
    };

    for (const entry of tables) {
      const fields = db.prepare(`PRAGMA table_info(${entry.table})`).all().map(row => row.name);
      const rows = db.prepare(`SELECT * FROM ${entry.table}`).all();
      const parser = new Parser({ fields });
      const csv = parser.parse(rows);

      archive.append('\uFEFF' + csv, { name: entry.filename });
      metadata.tables.push({
        table: entry.table,
        filename: entry.filename,
        rows: rows.length,
        fields
      });
    }

    archive.append(JSON.stringify(metadata, null, 2), { name: "metadata.json" });
    archive.finalize();
    logFromRequest(req, logLevels.INFO, "Bulk CSV export archive complete");
  } catch (err) {
    console.error("Export failed:", err.message);
    res.status(500).json({ error: "Export failed" });
  }
});


//--------------------------------------------------------------------------
// POST /import
// API to Import items from simplified CSV (retaining existing data)
//--------------------------------------------------------------------------

router.post("/import", async (req, res) => {
  logFromRequest(req, logLevels.INFO, "Bulk CSV import requested");

  try {

      await awaitMiddleware(upload.single('csv'))(req, res);

    // ── 1. Read CSV ──────────────────────────────────────────────────────────
    const csv = fs.readFileSync(req.file.path, "utf-8");
    const lines = csv.split("\n").filter(Boolean);
    const headers = lines.shift().split(",").map(h => h.trim().toLowerCase());

    const expected = ["description", "artist", "contributor", "notes", "auction_id"];
    if (!expected.every(h => headers.includes(h))) {
      return res
        .status(400)
        .json({ error: "CSV must contain description, artist, contributor, notes, and auction_id columns." });
    }

    // ── 2. Parse rows → objects  ─────────────────────────────────────────────
    const items = lines.map(line => {
      const cols = line.split(",").map(v => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, cols[i] || ""]));
    });

    if (items.length === 0) {
      return res.status(400).json({ error: "CSV contains no data rows." });
    }

    // ── 3. Validate auction IDs in one go  ───────────────────────────────────
    const auctionIds = [...new Set(items.map(r => Number(r.auction_id)))];
    const validAuctionId = new Set(
      db.prepare("SELECT id FROM auctions WHERE id IN (" + auctionIds.map(() => "?").join(",") + ")")
        .all(...auctionIds)
        .map(r => r.id)
    );

    const invalid = auctionIds.filter(id => !validAuctionId.has(id));
    if (invalid.length) {
      return res
        .status(400)
        .json({ error: `Auction id(s) not found: ${invalid.join(", ")}` });
    }

    // ── 4. Prepare helpers  ──────────────────────────────────────────────────
    const nextItemStmt = db.prepare(
      "SELECT IFNULL(MAX(item_number),0)+1 AS next FROM items WHERE auction_id = ?"
    );
    const insertStmt = db.prepare(
      `INSERT INTO items
         (item_number, description, artist, contributor, notes, auction_id, date)
       VALUES
         (@item_number, @description, @artist, @contributor, @notes, @auction_id,
          strftime('%d-%m-%Y %H:%M','now'))`
    );

    // keep a local counter per auction to avoid N queries inside the loop
    const nextNumber = Object.fromEntries(
      auctionIds.map(id => [id, nextItemStmt.get(id).next])
    );

    // ── 5. Transactional bulk insert  ────────────────────────────────────────
    const insertMany = db.transaction(list => {
      for (const row of list) {
        const aid = Number(row.auction_id);
        insertStmt.run({
          ...row,
          auction_id: aid,
          item_number: nextNumber[aid]++
        });
      }
    });
    insertMany(items);

    res.json({ message: `${items.length} rows imported.` });
    logFromRequest(
      req,
      logLevels.INFO,
      `Bulk CSV import completed for ${items.length} items`
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
    logFromRequest(req, logLevels.ERROR, `Bulk CSV import failed: ${err.message}`);
  } finally {
    // clean up temp upload
    try { fs.unlinkSync(req.file.path); } catch { }
  }
});

//--------------------------------------------------------------------------
// GET /photo-report
// API to get a Photo storage report
//--------------------------------------------------------------------------

router.get("/photo-report", (req, res) => {
 // const files = fs.readdirSync("./uploads");
  const files = fs.readdirSync( UPLOAD_DIR );
  const totalSize = files.reduce((sum, file) => sum + fs.statSync(path.join(UPLOAD_DIR, file)).size, 0);
  res.json({ count: files.length, totalSize });
  logFromRequest(req, logLevels.INFO, `${files.length} photos stored, ${totalSize / 1024 / 1024} occupied`);
});

//--------------------------------------------------------------------------
// GET /check-integrity
// API to do some basic database checks. Mostly deprecated by database engine protections.......
//--------------------------------------------------------------------------

router.get("/check-integrity", (req, res) => {
  logFromRequest(req, logLevels.DEBUG, `Running integrity checks`);

  db.all("SELECT * FROM items", [], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });

    const missingPhotoItemIds = new Set();
    for (const item of items) {
      if (item.photo && !fs.existsSync(path.join(UPLOAD_DIR, item.photo))) {
        missingPhotoItemIds.add(item.id);
      }
    }

    // Find items with missing or invalid auction_id
    db.all("SELECT id FROM auctions", [], (err, auctions) => {
      if (err) return res.status(500).json({ error: err.message });

      const validAuctionIds = new Set(auctions.map(a => a.id));
      const orphanedItems = items.filter(item => !validAuctionIds.has(item.auction_id));

      // Optional: Check for missing required fields
      const invalidFields = items.filter(item =>
        !item.description?.trim() || !item.contributor?.trim() || !item.item_number
      );

      db.all("SELECT * FROM bidders", [], (err, bidders) => {
        if (err) return res.status(500).json({ error: err.message });

        const bidderById = new Map(bidders.map(b => [b.id, b]));

        db.all("SELECT * FROM payments", [], (err, payments) => {
          if (err) return res.status(500).json({ error: err.message });

          const paymentById = new Map(payments.map(p => [p.id, p]));

          const invalidItemDetails = items.map(item => {
            const issues = [];

            if (missingPhotoItemIds.has(item.id)) {
              issues.push("Missing photo");
            }
            if (!validAuctionIds.has(item.auction_id)) {
              issues.push("Invalid auction ID");
            }
            if (!item.description?.trim()) {
              issues.push("Missing description");
            }
            if (!item.contributor?.trim()) {
              issues.push("Missing contributor");
            }
            if (!item.item_number) {
              issues.push("Missing item number");
            }
            if (item.winning_bidder_id) {
              const winningBidder = bidderById.get(item.winning_bidder_id);
              if (!winningBidder) {
                issues.push("Invalid winning bidder");
              } else if (winningBidder.auction_id && winningBidder.auction_id !== item.auction_id) {
                issues.push("Winning bidder auction mismatch");
              }
            }
            if (item.hammer_price != null) {
              if (Number.isNaN(Number(item.hammer_price)) || Number(item.hammer_price) <= 0) {
                issues.push("Invalid hammer price");
              }
              if (!item.winning_bidder_id) {
                issues.push("Hammer price without winning bidder");
              }
            } else if (item.winning_bidder_id) {
              issues.push("Winning bidder without hammer price");
            }

            if (issues.length === 0) return null;

            return {
              id: item.id,
              auction_id: item.auction_id,
              description: item.description,
              contributor: item.contributor,
              photo: item.photo,
              item_number: item.item_number,
              winning_bidder_id: item.winning_bidder_id,
              hammer_price: item.hammer_price,
              issues
            };
          }).filter(Boolean);

          const invalidBidderDetails = bidders.map(bidder => {
            const issues = [];

            if (!validAuctionIds.has(bidder.auction_id)) {
              issues.push("Invalid auction ID");
            }
            if (!bidder.name?.trim()) {
              issues.push("Missing name");
            }
            if (!Number.isFinite(bidder.paddle_number) || bidder.paddle_number <= 0) {
              issues.push("Invalid paddle number");
            }

            if (issues.length === 0) return null;

            return {
              id: bidder.id,
              auction_id: bidder.auction_id,
              paddle_number: bidder.paddle_number,
              name: bidder.name,
              issues
            };
          }).filter(Boolean);

          const invalidPaymentDetails = payments.map(payment => {
            const issues = [];

            if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
              issues.push("Invalid amount");
            }
            if (payment.reverses_payment_id) {
              if (!paymentById.has(payment.reverses_payment_id)) {
                issues.push("Invalid reversal target");
              } else if (payment.reverses_payment_id === payment.id) {
                issues.push("Self-referencing reversal");
              }
              if (Number.isFinite(payment.amount) && payment.amount > 0) {
                issues.push("Reversal with positive amount");
              }
            }

            if (issues.length === 0) return null;

            return {
              id: payment.id,
              bidder_id: payment.bidder_id,
              amount: payment.amount,
              method: payment.method,
              reverses_payment_id: payment.reverses_payment_id,
              provider: payment.provider,
              provider_txn_id: payment.provider_txn_id,
              intent_id: payment.intent_id,
              currency: payment.currency,
              issues
            };
          }).filter(Boolean);

          res.json({
            total: items.length,
            invalidItems: invalidItemDetails,
            bidderTotal: bidders.length,
            invalidBidders: invalidBidderDetails,
            paymentTotal: payments.length,
            invalidPayments: invalidPaymentDetails
          });

          const logChunks = [];
          if (invalidItemDetails.length > 0) {
            const itemLines = invalidItemDetails.map(item =>
              `Item ID ${item.id} (Auction ${item.auction_id}) Issues: ${item.issues.join(", ")}`
            ).join(" | ");
            logChunks.push(`Items: ${itemLines}`);
          }
          if (invalidBidderDetails.length > 0) {
            const bidderLines = invalidBidderDetails.map(bidder =>
              `Bidder ID ${bidder.id} (Auction ${bidder.auction_id}) Issues: ${bidder.issues.join(", ")}`
            ).join(" | ");
            logChunks.push(`Bidders: ${bidderLines}`);
          }
          if (invalidPaymentDetails.length > 0) {
            const paymentLines = invalidPaymentDetails.map(payment =>
              `Payment ID ${payment.id} (Bidder ${payment.bidder_id}) Issues: ${payment.issues.join(", ")}`
            ).join(" | ");
            logChunks.push(`Payments: ${paymentLines}`);
          }

          if (logChunks.length > 0) {
            logFromRequest(
              req,
              logLevels.WARN,
              `Integrity check flagged issues: ${logChunks.join(" || ")}`
            );
          } else {
            logFromRequest(req, logLevels.INFO, `Integrity check complete, no errors found`);
          }
        });
      });
    });
  });
});
//--------------------------------------------------------------------------
// Remove invalid items API (disabled as this only had limited usecase)
//--------------------------------------------------------------------------

// router.post("/check-integrity/delete", (req, res) => {
//   const { ids } = req.body;
//   if (!Array.isArray(ids) || ids.length === 0) {
//     logFromRequest(req, logLevels.ERROR, `No item IDs provided for deletion`);
//     return res.status(400).json({ error: "No item IDs provided for deletion" });
//   }

//   const placeholders = ids.map(() => "?").join(",");
//   db.run(`DELETE FROM items WHERE id IN (${placeholders})`, ids, function (err) {
//     if (err) return res.status(500).json({ error: err.message });
//     res.json({ message: `Deleted ${this.changes} invalid item(s).` });
//     logFromRequest(req, logLevels.WARN, `Deleted ${this.changes} invalid item(s).`);

//   });
// });

//--------------------------------------------------------------------------
// POST /change-password
// API to change passwords
//--------------------------------------------------------------------------

router.post("/change-password", (req, res) => {
  const { role, newPassword } = req.body;
  const allowedRoles = ["admin", "cashier", "maintenance"];

  if (!role || !allowedRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role." });
  }

  if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
  }

  // Hash the password before storing
  const hashed = bcrypt.hashSync(newPassword, 12);

  db.run(
    `UPDATE passwords SET password = ? WHERE role = ?`,
    [hashed, role],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Role not found." });

      logFromRequest(req, logLevels.INFO, `Password changed for role: ${role}`);
      audit(req.user.role, 'change password', 'server', null, { changed_role: role });
      res.json({ message: `Password for ${role} updated.` });
    }
  );
});

//--------------------------------------------------------------------------
// POST /restart
// API to Restart the server
//--------------------------------------------------------------------------

router.post("/restart", (req, res) => {
  res.json({ message: "Restarting server..." });
  logFromRequest(req, logLevels.INFO, `Server restart requested`);
  setTimeout(() => {
    exec("pm2 restart auction", (err) => {
      if (err) console.log("Restart failed:", err);
    });
  }, 1000);
});

//--------------------------------------------------------------------------
// GET /logs
// API to get recent server logs
//--------------------------------------------------------------------------


router.get("/logs", (req, res) => {
  fs.readFile(logFilePath, 'utf8', (err, data) => {
    if (err) {
      logFromRequest(req, logLevels.ERROR, `Log file read error: ${err}`);

      return res.status(500).json({ error: "Failed to retrieve logs." });
    }

    const lines = data.split('\n').filter(Boolean); // Remove empty lines
    const trimmed = lines.slice(-logLines);

    const startupMarker = "starting up";
    const reversedIndex = [...trimmed].reverse().findIndex(line =>
      line.toLowerCase().includes(startupMarker)
    );

    const startIndex = reversedIndex >= 0 ? trimmed.length - reversedIndex - 1 : -1;
    const filtered = startIndex >= 0 ? trimmed.slice(startIndex).join("\n") : trimmed.join("\n");

    res.json({ log: filtered });
  });
});

//--------------------------------------------------------------------------
// GET /download-full
// API to download a zip file containing the database and all images
//--------------------------------------------------------------------------

router.get("/download-full", (req, res) => {
  logFromRequest(req, logLevels.DEBUG, `Full download requested`);
  const archive = archiver("zip", { zlib: { level: 9 } });

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19); // e.g. 2024-04-10T14-33-58
  const filename = `auction_backup_${timestamp}.zip`;


  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);



  archive.pipe(res);

  // Add DB file
  archive.file(path.join(DB_PATH, DB_NAME));

  // Add referenced photos
  db.all("SELECT photo FROM items WHERE photo IS NOT NULL", [], (err, rows) => {
    if (err) {
      archive.append(`Error reading DB: ${err.message}`, { name: "error.txt" });
      archive.finalize();
      return;
    }

    const usedPhotos = new Set(rows.map(r => r.photo));
    for (const filename of usedPhotos) {
      const filePath = path.join(UPLOAD_DIR, filename);
      if (fs.existsSync(filePath)) {
//        archive.file(filePath, { name: `uploads/${filename}` });
        archive.file(filePath, { name: path.join(UPLOAD_DIR, filename) });

      }
    }


    // Include additional image resources from CONFIG_IMG_DIR
    const extraResources = fs.readdirSync(CONFIG_IMG_DIR).filter(f =>
      [".jpg", ".jpeg", ".png"].includes(path.extname(f).toLowerCase())
    );

    for (const resource of extraResources) {
      const resourcePath = path.join(CONFIG_IMG_DIR, resource);
      if (fs.existsSync(resourcePath)) {
        archive.file(resourcePath, { name: `resources/${resource}` });
      }
    }


    archive.finalize();
    logFromRequest(req, logLevels.INFO, `Full download generated`);

  });
});

//--------------------------------------------------------------------------
// GET /orphan-photos
// API to find photos without an owner
//--------------------------------------------------------------------------


router.get("/orphan-photos", (req, res) => {
  db.all(`SELECT photo FROM items WHERE photo IS NOT NULL`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const usedPhotos = new Set();
    rows.forEach(row => {
      if (row.photo) {
        usedPhotos.add(row.photo);
        usedPhotos.add("preview_" + row.photo);
      }
    });

    const allFiles = fs.readdirSync(UPLOAD_DIR);
    const orphaned = allFiles.filter(file => !usedPhotos.has(file));

    logFromRequest(req, logLevels.INFO, `${orphaned.length} orphan photos found`);
    res.json({ count: orphaned.length, orphaned });
  });
});


router.post("/cleanup-orphan-photos", (req, res) => {
  db.all(`SELECT photo FROM items WHERE photo IS NOT NULL`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // Track both original and preview filenames
    const usedFiles = new Set();
    rows.forEach(row => {
      if (row.photo) {
        usedFiles.add(row.photo);
        usedFiles.add("preview_" + row.photo);
      }
    });

    const allFiles = fs.readdirSync(UPLOAD_DIR);
    const orphaned = allFiles.filter(file => !usedFiles.has(file));
    const orphanSize = orphaned.reduce((sum, file) => sum + fs.statSync(path.join(UPLOAD_DIR, file)).size, 0);
    const orphanSizeMb = (orphanSize / 1024 / 1024).toFixed(2);

    let deleted = 0;
    orphaned.forEach(file => {
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, file));
        deleted++;
      } catch (e) {
        logFromRequest(req, logLevels.ERROR, `Failed to delete ${file}: ` + e.message);
      }
    });

    res.json({ message: `Deleted ${deleted} orphaned file(s). Recovered ${orphanSizeMb} Mb.`, orphaned });
    logFromRequest(req, logLevels.INFO, `${deleted} orphan photos deleted. Recovered ${orphanSizeMb} Mb.`);
  });
});

// Simple shuffle function
// function shuffleArray(arr) {
//   return arr.map(value => ({ value, sort: Math.random() }))
//     .sort((a, b) => a.sort - b.sort)
//     .map(({ value }) => value);
// }

function getNextItemNumber(auction_id, callback) {
  db.get(`SELECT MAX(item_number) + 1 AS next FROM items WHERE auction_id = ?`, [auction_id], (err, row) => {
    if (err) return callback(err);
    const itemNumber = row?.next || 1;
    callback(null, itemNumber);
  });
}

function getNextItemNumberAsync(auction_id) {
  return new Promise((resolve, reject) => {
    getNextItemNumber(auction_id, (err, itemNumber) => {
      if (err) reject(err);
      else resolve(itemNumber);
    });
  });
}

//--------------------------------------------------------------------------
// POST /generate-test-data
// API to generate test items based on sample-items.json
//--------------------------------------------------------------------------


router.post("/generate-test-data", checkAuctionState(['setup']), async (req, res) => {
  const count = parseInt(req.body.count, 10);
  const { auction_id } = req.body;
  if (!count || count < 1 || count > 1000 || !auction_id) {
    logFromRequest(req, logLevels.ERROR, `Invalid number of test items requested, or no auction id`);
    return res.status(400).json({ error: "Please enter a valid count (1–1000) and auction" });

  }
  logFromRequest(req, logLevels.INFO, `Request to generate ${count} items for ID ${auction_id}`);

  const samplePath = path.join(__dirname, "sample-items.json");
  const photos = fs.readdirSync(SAMPLE_DIR).filter(f => f.endsWith(".jpg"));

  if (!fs.existsSync(samplePath)) {
    logFromRequest(req, logLevels.ERROR, `Test item JSON file not found`);
    return res.status(500).json({ error: "Sample JSON not found." });
  }

  if (photos.length === 0) {
    logFromRequest(req, logLevels.ERROR, `No test item photos found`);
    return res.status(500).json({ error: "No sample photos available." });
  }


  let sampleData;
  try {
    sampleData = JSON.parse(fs.readFileSync(samplePath, "utf-8"));
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Test item JSON failed to parse`);
    return res.status(500).json({ error: "Failed to parse sample JSON." });
  }


  function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  const items = Array.from({ length: count }, () => ({
    description: getRandom(sampleData.descriptions),
    contributor: getRandom(sampleData.contributors),
    artist: getRandom(sampleData.artists),
    notes: getRandom(sampleData.notes)
  }));

  const stmt = db.prepare(`INSERT INTO items (description, contributor, artist, notes, photo, auction_id, item_number, date, test_item) VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%d-%m-%Y %H:%M', 'now'), '1')`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    //   const srcPath = path.join(SAMPLE_DIR, photos[i % photos.length]);
    const srcPath = path.join(SAMPLE_DIR, photos[Math.floor(Math.random() * photos.length)]);

    const baseFilename = `sample_${Date.now()}_${i}.jpg`;
    const resizedFilename = `resized_${baseFilename}`;
    const previewFilename = `preview_resized_${baseFilename}`;

    // const resizedPath = path.join(__dirname, "uploads", resizedFilename);
    // const previewPath = path.join(__dirname, "uploads", previewFilename);

    const resizedPath = path.join(UPLOAD_DIR, resizedFilename);
    const previewPath = path.join(UPLOAD_DIR, previewFilename);

    try {
      await sharp(srcPath)
        .resize(1600, 1600, { fit: 'inside' })
        .jpeg({ quality: 90 })
        .toFile(resizedPath);

      await sharp(srcPath)
        .resize(300, 300, { fit: 'inside' })
        .jpeg({ quality: 70 })
        .toFile(previewPath);
    } catch (err) {
      logFromRequest(req, logLevels.ERROR, `Image processing failed for ${srcPath}:` + err.message);
      continue;
    }



    let itemNumber;
    try {
      itemNumber = await getNextItemNumberAsync(auction_id);
    } catch (err) {
      return res.status(500).json({ error: "Database error getting item number" });
    }

    const taggedNote = `[TEST DATA] ${item.notes || ""}`;
    const result = stmt.run(item.description, item.contributor, item.artist, taggedNote.trim(), resizedFilename, auction_id, itemNumber);

    const itemId = result.lastInsertRowid;

    audit(req.user.role, 'new item (test)', 'item', itemId, { description: item.description, initial_number: itemNumber });

  }


  stmt.finalize();
  res.json({ message: `${items.length} randomized test item(s) inserted.` });
  logFromRequest(req, logLevels.INFO, `${items.length} Test items added to auction ${auction_id}`);

});

//--------------------------------------------------------------------------
// GET /get-pptx-config/:name
// POST /save-pptx-config/:name
// POST /pptx-config/reset
//
// API trio to get, save and reset to default, the pptx configs
//--------------------------------------------------------------------------



router.get('/get-pptx-config/:name', (req, res) => {
  const file = CONFIG_PATHS[req.params.name];
  if (!file) {
    logFromRequest(req, logLevels.ERROR, `Unexpected file read requested`);
    return res.status(400).json({ error: 'Invalid config name' });
  }
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) {
      logFromRequest(req, logLevels.ERROR, `Unable to read config`);
      return res.status(500).json({ error: 'Unable to read config' });
    }
    res.type('application/json').send(data);
  });
});

// router.post('/save-pptx-config/:name', (req, res) => {
//   const file = CONFIG_PATHS[req.params.name];
//   if (!file) {
//     logFromRequest(req, logLevels.WARN, `Unexpected file write requested`);
//     return res.status(400).json({ error: `Invalid config name ${req.params.name}` });
//   }
//   let json;
//   try {
//     json = JSON.stringify(req.body, null, 2);
//   } catch (err) {
//     logFromRequest(req, logLevels.WARN, `PPTX config rejected, invalid JSON`);

//     return res.status(400).json({ error: 'Invalid JSON' });
//   }

//   fs.writeFile(file, json, 'utf8', err => {
//     if (err) return res.status(500).json({ error: 'Unable to save config' });
//     res.json({ message: 'Configuration updated successfully.' });
//     logFromRequest(req, logLevels.INFO, `PPTX config file ${file} updated`);

//   });
// });

router.post('/save-pptx-config/:name', async (req, res) => {
  const file = CONFIG_PATHS[req.params.name];
  if (!file) {
    logFromRequest(req, logLevels.WARN, `Unexpected file write requested`);
    return res.status(400).json({ error: `Invalid config name ${req.params.name}` });
  }

  // ensure we have a parsed JSON object
  if (!req.body || typeof req.body !== 'object') {
    logFromRequest(req, logLevels.WARN, `PPTX config rejected, missing/invalid JSON body`);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    // 🔒 validate JSON paths BEFORE saving
    const { ok, errors, normalizedJson } = await validateJsonPaths(req.body, {
      baseImgDir: CONFIG_IMG_DIR,
      allowedExtensions: allowedExtensions,
      requireExistence: true,   // set false if you allow references that will exist later
      contentSniff: true,       // uses sharp under the hood to confirm it's a real image
      // Narrow to expected keys to reduce false positives (adjust to your schema):
      checkOnlyKeys: ['image', 'images', 'thumbnail', 'background', 'path'],
      checkKeysRegex: [/image/i, /thumb/i, /background/i, /photo/i, /^background$/i, /path/i],
      outputStyle: 'absolute',
    });

    
    if (!ok) {
      // Log a concise summary…
      logFromRequest(
        req,
        logLevels.WARN,
        `PPTX config rejected: ${errors.length} validation error(s)`
      );

      // …and log each exact failure with structured context
      errors.forEach((e, idx) => {
        logFromRequest(
          req,
          logLevels.WARN,
          `Path validation failed [${idx + 1}/${errors.length}] at ${e.jsonPath}: ${e.error}; value="${preview(e.value)}"`
        );
      });

      return res.status(400).json({ error: `PPTX Template validation failed with ${errors.length} error(s)`, details: errors });
    }

    // save the sanitized JSON produced by the validator (normalized POSIX paths, etc.)
    const json = JSON.stringify(normalizedJson, null, 2);

    fs.writeFile(file, json, 'utf8', (err) => {
      if (err) {
        logFromRequest(req, logLevels.ERROR, `Unable to save config: ${err.message}`);
        return res.status(500).json({ error: 'Unable to save config' });
      }
      res.json({ message: 'Configuration updated successfully.' });
      logFromRequest(req, logLevels.INFO, `PPTX config file ${file} updated`);
    });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Unhandled error in save-pptx-config: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }

// helper to avoid log spam / secrets leakage
function preview(str, max = 180) {
  if (typeof str !== 'string') return String(str);
  const clean = str.replace(/\s+/g, ' ').slice(0, max);
  return clean + (str.length > max ? '…' : '');
}

});

router.post("/pptx-config/reset", (req, res) => {
  const { configType } = req.body;

  if (!configType || !["pptx", "card"].includes(configType)) {
    logFromRequest(req, logLevels.ERROR, `Invalid config type:` + configType);
    return res.status(400).json({ error: "Invalid config type." });
  }

  // const defaultPath = path.join(__dirname, `./pptx-config/${configType}Config.default.json`);
  // const livePath = path.join(__dirname, `./pptx-config/${configType}Config.json`);

  const defaultPath = path.join(__dirname, `default.${configType}Config.json`);
  const livePath = path.join(PPTX_CONFIG_DIR, `${configType}Config.json`);
console.log(livePath);
  try {
    if (!fs.existsSync(defaultPath)) {
      logFromRequest(req, logLevels.ERROR, `Default config not found:` + defaultPath);

      return res.status(500).json({ error: "Default config not found." });

    }

    fs.copyFileSync(defaultPath, livePath);
    logFromRequest(req, logLevels.INFO, `Reset ${configType}Config.json to default.`);
    res.json({ message: `${configType}Config.json reset to default.` });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Error resetting config:` + err.message);

    res.status(500).json({ error: "Failed to reset config." });
  }
});

//--------------------------------------------------------------------------
// POST /auctions/delete
// API to delete auctions. Includes database full reset on final delete
//--------------------------------------------------------------------------


router.post("/auctions/delete", (req, res) => {
  const { auction_id } = req.body;

  if (!auction_id) {
    return res.status(400).json({ error: "Missing auction_id" });
  }

  // Step 1: Check if auction has items
  db.get("SELECT COUNT(*) AS count FROM items WHERE auction_id = ?", [auction_id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    if (result.count > 0) {
      logFromRequest(req, logLevels.WARN, `Can't delete - Auction ${auction_id} contains items`);
      return res.status(400).json({ error: "Cannot delete auction with associated items." });
    }

    // Step 2: Delete the auction
    db.run("DELETE FROM auctions WHERE id = ?", [auction_id], function (err) {
      if (err) {
        logFromRequest(req, logLevels.ERROR, `Delete auction error` + err.message);
        
        return res.status(500).json({ error: err.message });
      }
      
      audit(req.user.role, 'delete auction', 'auction', auction_id, {});
      // Step 3: Check how many auctions remain
      db.get("SELECT COUNT(*) AS count FROM auctions", [], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        // clearup on last auction delete
        if (result.count === 0) {

          try {
            logFromRequest(req, logLevels.INFO, `Deleting last auction. Resetiing database`);

            const deleteBatch = db.transaction(() => {

              db.prepare("DELETE FROM auctions").run();
              logFromRequest(req, logLevels.DEBUG, `Auctions table cleared`);
              

              db.prepare("DELETE FROM bidders").run();
              logFromRequest(req, logLevels.DEBUG, `Bidders table cleared`);

              db.prepare("DELETE FROM items").run();
              logFromRequest(req, logLevels.DEBUG, `items table cleared`);

              db.prepare("DELETE FROM payments").run();
              logFromRequest(req, logLevels.DEBUG, `Payments table cleared`);

              db.prepare("DELETE FROM sqlite_sequence WHERE name = 'auctions'").run();
              logFromRequest(req, logLevels.DEBUG, `Auction ID counter reset`);

              db.prepare("DELETE FROM sqlite_sequence WHERE name = 'bidders'").run();
              logFromRequest(req, logLevels.DEBUG, `Bidder ID counter reset`);

              db.prepare("DELETE FROM sqlite_sequence WHERE name = 'payments'").run();
              logFromRequest(req, logLevels.DEBUG, `Payment ID counter reset`);


              db.prepare("DELETE FROM sqlite_sequence WHERE name = 'items'").run();
              logFromRequest(req, logLevels.DEBUG, `Item ID counter reset`);

            });

            deleteBatch(); // execute the transaction

            res.json({ message: "Database reset actions completed successfully." });
            audit(req.user.role, 'reset database', 'database', null, { reason: 'last auction deleted' });

          } catch (err) {
            logFromRequest(req, logLevels.ERROR, `Reset failed: ${err.message}`);
            res.status(500).json({ error: "Reset failed", details: err.message });
          }

        } else {
          // The normal case.....
          logFromRequest(req, logLevels.INFO, `Auction ${auction_id} deleted`);
          audit(req.user.role, 'delete auction', 'auction', auction_id, {});
          return res.json({ message: "Auction deleted." });
        }
      });
    });
  });
});

//--------------------------------------------------------------------------
// POST /auctions/create
// API to add an auction
//--------------------------------------------------------------------------

router.post("/auctions/create", (req, res) => {
  const { short_name, full_name, logo } = req.body;

  // 1. Validate input
  if (!short_name || !full_name)
    return res.status(400).json({ error: "Missing short_name or full_name" });



  if (/\s/.test(short_name))
    return res.status(400).json({ error: "Short name must not contain spaces." });

  try {
    // 2. Uniqueness check (sync)
    const existing = db.get(
      "SELECT id FROM auctions WHERE short_name = ?",
      [short_name.trim()]
    );
    if (existing)
      return res
        .status(400)
        .json({ error: "Short name must be unique. This one already exists." });


    db.get("SELECT COUNT(*) AS count FROM auctions", [], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      if (row.count >= MAX_AUCTIONS) {
        logFromRequest(req, logLevels.WARN, `Auction limit reached. Maximum allowed is ${MAX_AUCTIONS}.`);

        return res.status(400).json({ error: `Cannot create more than ${MAX_AUCTIONS} auctions.` });
      }
    })

    // 3. Insert (remember: params go in ONE array)
    const result = db.run(
      "INSERT INTO auctions (short_name, full_name, logo) VALUES (?, ?, ?)",
      [short_name.trim().toLowerCase(), full_name.trim(), logo || "default_logo.png"]
    );
    const NewId = result.lastInsertRowid;
    logFromRequest(req, logLevels.INFO, `Created new auction Id ${NewId} ${short_name} with logo: ${logo}`);
    audit(req.user.role, 'create auction', 'auction', NewId, { short_name: short_name.trim().toLowerCase(), full_name: full_name.trim(), logo });
    res.json({ message: "Auction created." });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Create auction error: ${err}`);
    res.status(500).json({ error: "Could not create auction" });
  }
});

//--------------------------------------------------------------------------
// POST /auctions/list
// API to list auctions
//--------------------------------------------------------------------------

router.post("/auctions/list", async (req, res) => {
  // logFromRequest(req, logLevels.DEBUG, `Auction list (maint) requested`);

  const sql = `
    SELECT a.id, a.short_name, a.full_name, a.logo, a.status, a.admin_can_change_state,
           COUNT(i.id) AS item_count
    FROM auctions a
    LEFT JOIN items i ON i.auction_id = a.id
    GROUP BY a.id
    ORDER BY a.id
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {

      logFromRequest(req, logLevels.ERROR, `Failed to retrieve auction: ${err}`);

      return res.status(500).json({ error: "Failed to retrieve auctions" });
    }
    res.json(rows);
  });
});

//--------------------------------------------------------------------------
// POST /resources/upload
// API to upload image assets
//--------------------------------------------------------------------------


router.post("/resources/upload", async (req, res) => {

try {

        await awaitMiddleware(upload.array("images", MAX_UPLOADS))(req, res);

  if (!req.files || req.files.length === 0) {
    logFromRequest(req, logLevels.ERROR, `No files uploaded`);
    return res.status(400).json({ error: "No files uploaded" });
  }

  const currentFiles = fs.readdirSync(CONFIG_IMG_DIR).filter(f =>
    allowedExtensions.includes(path.extname(f).toLowerCase())
  );

  const remainingSlots = MAX_UPLOADS - currentFiles.length;
  if (remainingSlots <= 0) {
    logFromRequest(req, logLevels.ERROR, `Upload rejected: Max image resources reached (${MAX_UPLOADS}).`);
    return res.status(400).json({ error: "Maximum number of image resources already stored." });
  }

  const incoming = req.files.slice(0, remainingSlots);
  const rejected = req.files.slice(remainingSlots);

  const savedFiles = [];

  for (const file of incoming) {

    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      logFromRequest(req, logLevels.WARN, `Rejected file "${file.originalname}": invalid ext`);

      fs.unlinkSync(file.path);
      continue;
    }

    // Step 2: Content validation using sharp
    let isValidImage = true;
    try {
      await sharp(file.path).metadata(); // throws if not a valid image
    } catch (err) {
      console.warn(`Rejected file "${file.originalname}": invalid image`);
      logFromRequest(req, logLevels.WARN, `Rejected file "${file.originalname}": invalid image`);

      fs.unlinkSync(file.path);
      isValidImage = false;
    }
    if (!isValidImage) continue;

    const safeName = file.originalname.replace(/[^a-z0-9_\-.]/gi, "_");
    const destPath = path.join(CONFIG_IMG_DIR, safeName);
    if (!destPath.startsWith(CONFIG_IMG_DIR)) {
      fs.unlinkSync(file.path);
      continue;
    }

    fs.renameSync(file.path, destPath);
    savedFiles.push(safeName);
  }

  // Clean up any rejected files
  for (const file of rejected) {
    fs.unlinkSync(file.path);
  }

  res.json({
    message: `Uploaded ${savedFiles.length} file(s).`,
    saved: savedFiles,
    rejected: rejected.map(f => f.originalname)
  });
  if (savedFiles.length > 0) {
    logFromRequest(req, logLevels.INFO, `Uploaded ${savedFiles.length} image resource(s): ${savedFiles.join(", ")}`);
  }
  } catch {
          logFromRequest(req, logLevels.ERROR, "Error editing: " + err.message);
        res.status(500).json({ error: err.message });

  
  }
});

//--------------------------------------------------------------------------
// GET /resources
// API to get a list of image assets
//--------------------------------------------------------------------------

router.get("/resources", (req, res) => {
  try {
    const files = fs.readdirSync(CONFIG_IMG_DIR)
      .filter(f => allowedExtensions.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fullPath = path.join(CONFIG_IMG_DIR, f);
        let size = 0;

        try {
          size = fs.statSync(fullPath).size;
        } catch {
          size = null; // file might've been deleted in between
        }

        return { name: f, size };
      });

    //   logFromRequest(req, logLevels.DEBUG, `Listed image resources (${files.length} file(s)).`);
    res.json({ files });

  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Error listing resource files:` + err.message);
    res.status(500).json({ error: "Failed to list resource files." });
  }
});

//--------------------------------------------------------------------------
// POST /resources/DELETE
// API to delete image assets. Blocks delete of things which are being used
//--------------------------------------------------------------------------

router.post("/resources/delete", (req, res) => {
  const { filename } = req.body;
  if (!filename || filename.includes("..")) {
    logFromRequest(req, logLevels.ERROR, `Invalid filename: ${filename}`);
    return res.status(400).json({ error: "Invalid filename" });
  }

  // Prevent deletion of default logo
  if (filename === "default_logo.png") {
    logFromRequest(req, logLevels.WARN, `Blocked deleting default logo file ${filename}`);
    return res.status(400).json({ error: "Cannot delete the default logo." });
  }

  const filePath = path.join(CONFIG_IMG_DIR, filename);
  if (!filePath.startsWith(CONFIG_IMG_DIR) || !fs.existsSync(filePath)) {
    logFromRequest(req, logLevels.WARN, `File not found ${filename}`);
    return res.status(404).json({ error: "File not found" });
  }

  // Check if any auctions are using this logo
  db.get("SELECT COUNT(*) AS count FROM auctions WHERE logo = ?", [filename], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    if (row.count > 0) {
      logFromRequest(req, logLevels.WARN, `Blocked deleting file in use ${filename}`);

      return res.status(400).json({ error: `Cannot delete. ${row.count} auction(s) are using this logo.` });
    }

    // Check if PPTX configs reference the file
    try {
      // const pptxConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      // const cardConfig = JSON.parse(fs.readFileSync(CARD_PATH, "utf-8"));

      const pptxConfig = JSON.parse(fs.readFileSync(CONFIG_PATHS[pptx], "utf-8"));
      const cardConfig = JSON.parse(fs.readFileSync(CONFIG_PATHS[card], "utf-8"));

      const pptxRefs = JSON.stringify(pptxConfig).includes(filename);
      const cardRefs = JSON.stringify(cardConfig).includes(filename);

      if (pptxRefs || cardRefs) {
        logFromRequest(req, logLevels.WARN, `Blocked deleting file in use ${filename}`);
        return res.status(400).json({ error: "Cannot delete. File is referenced in PPTX config files." });
      }
    } catch (configError) {
      console.error("Error reading config files:", configError.message);
      logFromRequest(req, logLevels.ERROR, `Error reading config files:` + configError.message);
      return res.status(500).json({ error: "Server error checking config files." });
    }

    // If passed all checks, delete the file
    fs.unlinkSync(filePath);
    logFromRequest(req, logLevels.INFO, `Deleted resource file: ${filename}`);
    res.json({ message: `Deleted ${filename}` });
  });
});




//--------------------------------------------------------------------------
// POST /auctions/set-admin-state-permission
// API to update the "admin can set state" permission on the auction
//--------------------------------------------------------------------------

router.post('/auctions/set-admin-state-permission', async (req, res) => {
  const { auction_id, admin_can_change_state } = req.body;
  const enabled = !!admin_can_change_state ? 1 : 0;

  logFromRequest(req, logLevels.DEBUG, `Admin state control for ${auction_id} to: ${admin_can_change_state}`);


  if (!auction_id) {

    return res.status(400).json({ error: "Missing auction ID." });
  }

// Check if this has already been set to the requested value
  const auction = db.prepare(`SELECT admin_can_change_state FROM auctions WHERE id = ?`).get(auction_id);
  logFromRequest(req, logLevels.DEBUG, `State control: requested ${enabled}, current ${auction.admin_can_change_state}`);
  if (!auction) {
    return res.status(400).json({ error: "Auction not found." });
  }
 else if (auction.admin_can_change_state === enabled) {
  //logFromRequest(req, logLevels.DEBUG, `No change needed for auction ${auction_id} admin state control.`);

  }

  try {

    db.run(`UPDATE auctions SET admin_can_change_state = ? WHERE id = ?`, [enabled, auction_id]);

    logFromRequest(req, logLevels.INFO, `Updated admin state control for auction ${auction_id} set to: ${enabled}`);
    audit(req.user.role, 'auction settings', 'auction', auction_id, { admin_can_change_state: enabled });
    return res.json({ message: `Auction ${auction_id} admin state control updated` });

  } catch (err) {
    logger.error({ err, auction_id, body: req.body }, 'set-admin-state-permission failed');
    return res.status(500).json({ error: 'Internal error' });
  }
});

//--------------------------------------------------------------------------
// POST /generate-bids
// API to generate random bids. #bidders and #bids are both configurable
//--------------------------------------------------------------------------

router.post("/generate-bids", checkAuctionState(['live', 'settlement']), (req, res) => {
  const { auction_id, num_bids, num_bidders } = req.body;

  if (!auction_id || !Number.isInteger(num_bids) || !Number.isInteger(num_bidders)) {
    return res.status(400).json({ error: "Missing or invalid input." });
  }

  // Step 1: get items without bids
  db.all("SELECT id, description FROM items WHERE auction_id = ? AND winning_bidder_id IS NULL", [auction_id], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });

    const availableItems = items.map(i => i.id);
    if (availableItems.length === 0) return res.status(400).json({ error: "No items without bids." });

    if (num_bids < 1 || num_bids > availableItems.length) {
      return res.status(400).json({ error: `Number of bids must be between 1 and ${availableItems.length}` });
    }

    const shuffledItems = availableItems.sort(() => 0.5 - Math.random()).slice(0, num_bids);
    const bidders = [];

    while (bidders.length < num_bidders) {
      const paddle = Math.floor(Math.random() * 150) + 1;
      if (bidders.find(b => b.paddle === paddle)) continue;

      let existing = db.prepare('SELECT id FROM bidders WHERE paddle_number = ? AND auction_id = ?')
        .get(paddle, auction_id);

      if (!existing) {
        const info = db.prepare('INSERT INTO bidders (paddle_number, auction_id) VALUES (?, ?)')
          .run(paddle, auction_id);
        existing = { id: info.lastInsertRowid };
      }

      bidders.push({ id: existing.id, paddle });
    }

    const logLines = [];


    for (const itemId of shuffledItems) {
      const selected = bidders[Math.floor(Math.random() * bidders.length)];
      const price = Math.floor(Math.random() * 500) + 10;
      const testBid = 1;

      db.prepare('UPDATE items SET winning_bidder_id = ?, hammer_price = ?, test_bid = ? WHERE id = ?')
        .run(selected.id, price, testBid, itemId);

      logLines.push(`Item ${itemId} → Paddle ${selected.paddle} → £${price}`);
      audit(req.user.role, 'finalize (test)', 'item', itemId, {  bidder: selected.paddle, price, description: items.find(i => i.id === itemId)?.description || ''  });

    }
    logFromRequest(req, logLevels.INFO, `Generated ${num_bids} test bid(s) for auction ${auction_id}:\n` + logLines.join("\n"));
    res.json({ message: `${num_bids} bids added to auction ${auction_id}` });

  });
});

//--------------------------------------------------------------------------
// POST /delete-test-bids
// API to delete all test bids from a specific auction, and prunes unused bidders
//--------------------------------------------------------------------------

router.post("/delete-test-bids", checkAuctionState(['live', 'settlement']), (req, res) => {
  const { auction_id } = req.body;

  if (!auction_id) {
    return res.status(400).json({ error: "Missing auction ID." });
  }

  try {
    // Clear test bids from the items table
    const result = db.prepare(`
      UPDATE items
      SET winning_bidder_id = NULL,
          hammer_price = NULL,
          test_bid = NULL
      WHERE auction_id = ? AND test_bid = 1
    `).run(auction_id);

    // Remove unused bidders
    const deleted = db.prepare(`
      DELETE FROM bidders
      WHERE auction_id = ?
        AND id NOT IN (SELECT winning_bidder_id FROM items WHERE auction_id = ? AND winning_bidder_id IS NOT NULL)
    `).run(auction_id, auction_id);

    logFromRequest(req, logLevels.INFO, `Deleted ${result.changes} test bid(s) and ${deleted.changes} unreferenced bidder(s) from auction ${auction_id}`);
    audit(req.user.role, 'delete test bids', 'auction', auction_id, { test_bids_deleted: result.changes, bidders_deleted: deleted.changes });
    res.json({
      message: `Removed ${result.changes} test bids and ${deleted.changes} unused bidders.`
    });
  } catch (err) {
    console.error("Error deleting test bids:", err.message);
    res.status(500).json({ error: "Failed to delete test bids." });
  }
});

//--------------------------------------------------------------------------
// GET /audit-log
// API to view audit log with item details
//--------------------------------------------------------------------------

router.get("/audit-log", (req, res) => {
  const { object_id, object_type } = req.query;

if ((object_type && !auditTypes.includes(object_type)) || (object_id && isNaN(Number(object_id)))) {
    return res.status(400).json({ error: "Invalid filter settings." });
  }

 logFromRequest(req, logLevels.DEBUG, `Audit log requested. Filter - object_id: ${object_id || 'none'}, object_type: ${object_type || 'none'}`); 

  let query = `
  SELECT 
  audit_log.*, 
  items.auction_id, 
  items.item_number, 
  auctions.short_name
FROM audit_log
LEFT JOIN items ON audit_log.object_type = 'item' AND audit_log.object_id = items.id
LEFT JOIN auctions ON audit_log.object_type = 'item' AND items.auction_id = auctions.id
    `


  const params = [];
  if (Number(object_id)) {
    query += ` WHERE audit_log.object_id = ?`;
    params.push(object_id);
  }

  if (object_type) {
    query += object_id ? ` AND audit_log.object_type = ?` : ` WHERE audit_log.object_type = ?`;
    params.push(object_type);
  }

  query += ` ORDER BY audit_log.created_at DESC`;


  try {
    const rows = db.prepare(query).all(...params);

    res.json({ logs: rows });
  } catch (err) {
    console.error("Error fetching audit log:", err.message);
    res.status(500).json({ error: "Failed to retrieve audit log." });
  }
});

//--------------------------------------------------------------------------
// GET /audit-log/export
// API to Export audit log to CSV
//--------------------------------------------------------------------------

router.get("/audit-log/export", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        audit_log.*, 
        items.auction_id, 
        items.description, 
        items.item_number
      FROM audit_log
      LEFT JOIN items ON audit_log.object_id = items.id
      ORDER BY audit_log.created_at DESC
    `).all();

    const header = Object.keys(rows[0] || {}).join(",");
    const csvData = rows.map(row => {
      return Object.values(row).map(v => {
        return typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(",");
    });

    const csvContent = [header, ...csvData].join("\n");

    res.setHeader("Content-Disposition", "attachment; filename=audit_log.csv");
    //   res.setHeader("Content-Type", "text/csv");
    //    res.send(csvContent);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.end('\uFEFF' + csvContent);

  } catch (err) {
    console.error("Error exporting audit log:", err.message);
    res.status(500).send("Failed to export CSV.");
  }
});


function awaitMiddleware(middleware) {
  return (req, res) =>
    new Promise((resolve, reject) => {
      middleware(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
}

module.exports = router;
