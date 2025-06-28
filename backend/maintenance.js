// maintenance.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Parser } = require("@json2csv/plainjs");
const { exec } = require("child_process");
const router = express.Router();
const upload = multer({ dest: "uploads/" });
const sharp = require("sharp");
const db = require('./db');
const { CONFIG_IMG_DIR, SAMPLE_DIR, UPLOAD_DIR, DB_PATH, BACKUP_DIR, MAX_UPLOADS, allowedExtensions, MAX_AUCTIONS, LOG_LEVEL } = require('./config');
const CONFIG_PATH = path.join(__dirname, "./pptx-config/pptxConfig.json");
const CARD_PATH = path.join(__dirname, "./pptx-config/cardConfig.json");
const archiver = require("archiver");

const logFilePath = path.join(__dirname, 'server.log'); 
const logLines = 500;

const CONFIG_PATHS = {
  pptx: './pptx-config/pptxConfig.json',
  card: './pptx-config/cardConfig.json'
};

const maintenanceRoutes = require('./maintenance');
const {
    logLevels,
    setLogLevel,
    logFromRequest,
    createLogger,
    log
  } = require('./logger');

setLogLevel(logLevels.DEBUG);

const checkAuctionState = require('./middleware/checkAuctionState')(
    db, { ttlSeconds: 2 }   // optional – default is 5
 );


if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

// const CONFIG_IMG_DIR = path.join(__dirname, "resources");
if (!fs.existsSync(CONFIG_IMG_DIR)) fs.mkdirSync(CONFIG_IMG_DIR);


// Backup database file
router.post("/backup", (req, res) => {
  const backupPath = path.join(BACKUP_DIR, `auction_backup_${Date.now()}.db`);
  fs.copyFileSync(DB_PATH, backupPath);
  res.json({ message: "Backup created", path: backupPath });
  logFromRequest(req, logLevels.INFO, `Database backup created ${backupPath}`);
});

// Download full DB
router.get("/download-db", (req, res) => {
  res.download(DB_PATH);
});

// Restore DB
router.post("/restore", upload.single("backup"), (req, res) => {
  try {
    fs.copyFileSync(req.file.path, DB_PATH);
    fs.unlinkSync(req.file.path);
    res.json({ message: "Database restored." });
    logFromRequest(req, logLevels.INFO, `Database restored`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

 // Reset auction (clear items, bids, payments)
 // Requires explicit password

router.post("/reset", checkAuctionState(['setup','archived']), (req, res) => {
  const { auction_id, password } = req.body;

  if (!auction_id || !password) {
    return res.status(400).json({ error: "Missing auction_id or password" });
  }

  db.get("SELECT password FROM passwords WHERE role = 'maintenance'", [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row || row.password !== password) {
      return res.status(401).json({ error: "Incorrect maintenance password" });
    }
  })

  try {
    const result = db.transaction(id => {
      /* payments */
      const delPay = db.prepare(`DELETE FROM payments WHERE bidder_id IN (SELECT id FROM bidders WHERE auction_id = ?)`).run(id).changes;

      /* items */
      const delItems = db.prepare(`DELETE FROM items WHERE auction_id = ?`).run(id).changes;

      /* bidders */
      const delBidders = db.prepare(`DELETE FROM bidders WHERE auction_id = ?`).run(id).changes;

      /* (optional) auction shell itself */
      // const delAuction = db.prepare(`DELETE FROM auctions WHERE id = ?`).run(id).changes;

      return { payments: delPay, items: delItems, bidders: delBidders };
    })(auction_id);         // <-- execute the transaction

    res.json({
      ok: true,
      auction_id: auction_id,
      deleted: result        // { payments: n, items: n, bidders: n }
    });
    logFromRequest(req, logLevels.INFO, `Auction ${auction_id} has been reset. Removed: ${result.items} items, ${result.bidders} bidders, ${result.payments} payments`);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Purge failed' });
  }
})



// Export items to CSV
router.get("/export", (req, res) => {
  db.all("SELECT * FROM items", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const parser = new Parser();
    const csv = parser.parse(rows);
    const filePath = path.join(__dirname, "outputs", "bulk_export.csv");
    fs.writeFileSync(filePath, csv);
    res.download(filePath);
    logFromRequest(req, logLevels.INFO, `Bulk CSV export complete`);
  });
});




// Import items from simplified CSV (retaining existing data)

router.post("/import", upload.single("csv"), (req, res) => {
  logFromRequest(req, logLevels.INFO, "Bulk CSV import requested");

  try {
    // ── 1. Read CSV ──────────────────────────────────────────────────────────
    const csv     = fs.readFileSync(req.file.path, "utf-8");
    const lines   = csv.split("\n").filter(Boolean);
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
    const auctionIds     = [...new Set(items.map(r => Number(r.auction_id)))];
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
          auction_id : aid,
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
    try { fs.unlinkSync(req.file.path); } catch {}
  }
});


// Photo storage report
router.get("/photo-report", (req, res) => {
  const files = fs.readdirSync("./uploads");
  const totalSize = files.reduce((sum, file) => sum + fs.statSync(path.join("./uploads", file)).size, 0);
  res.json({ count: files.length, totalSize });
  logFromRequest(req, logLevels.INFO, `${files.length} photos stored, ${totalSize/1024/1024} occupied`);
});


router.get("/check-integrity", (req, res) => {
  logFromRequest(req, logLevels.DEBUG, `Running integrity checks`);

  db.all("SELECT * FROM items", [], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });

    // Map of existing photo filenames
    const missingPhotos = items.filter(item => item.photo && !fs.existsSync(path.join(__dirname, "uploads", item.photo)));

    // Find items with missing or invalid auction_id
    db.all("SELECT id FROM auctions", [], (err, auctions) => {
      if (err) return res.status(500).json({ error: err.message });

      const validAuctionIds = new Set(auctions.map(a => a.id));
      const orphanedItems = items.filter(item => !validAuctionIds.has(item.auction_id));

      // Optional: Check for missing required fields
      const invalidFields = items.filter(item =>
        !item.description?.trim() || !item.contributor?.trim() || !item.item_number
      );

      // Build list of unique invalid item IDs
      const invalidItemIds = new Set([
        ...missingPhotos.map(i => i.id),
        ...orphanedItems.map(i => i.id),
        ...invalidFields.map(i => i.id)
      ]);

      const invalidItemDetails = items.map(item => {
        const issues = [];
      
        if (item.photo && !fs.existsSync(path.join(__dirname, "uploads", item.photo))) {
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
      
        if (issues.length === 0) return null;
      
        return {
          id: item.id,
          auction_id: item.auction_id,
          description: item.description,
          contributor: item.contributor,
          photo: item.photo,
          item_number: item.item_number,
          issues
        };
      }).filter(Boolean);
      
      res.json({
        total: items.length,
        invalidItems: invalidItemDetails
      });

      // Log all invalid items with details
if (invalidItemDetails.length > 0) {
  const logLines = invalidItemDetails.map(item => {
    return `Item ID ${item.id} (Auction ${item.auction_id}) Issues: ${item.issues.join(", ")}`;
  }).join(" | ");

  logFromRequest(req, logLevels.WARN,  `Integrity check flagged ${invalidItemDetails.length} invalid item(s): ${logLines}`);
}
else {
  logFromRequest(req, logLevels.INFO,  `Integrity check complete, no errors found`);

}
    });
  });
});

router.post("/check-integrity/delete", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    logFromRequest(req, logLevels.ERROR,  `No item IDs provided for deletion`);
    return res.status(400).json({ error: "No item IDs provided for deletion" });
  }

  const placeholders = ids.map(() => "?").join(",");
  db.run(`DELETE FROM items WHERE id IN (${placeholders})`, ids, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Deleted ${this.changes} invalid item(s).` });
    logFromRequest(req, logLevels.WARN, `Deleted ${this.changes} invalid item(s).`);

  });
});


router.post("/change-password", (req, res) => {
  const { role, newPassword } = req.body;
  const allowedRoles = ["admin", "cashier", "maintenance"];

  if (!role || !allowedRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role." });
  }

  if (!newPassword || newPassword.length < 5) {
    return res.status(400).json({ error: "Invalid password." });
  }

  db.run(
    `UPDATE passwords SET password = ? WHERE role = ?`,
    [newPassword, role],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Role not found." });

      logFromRequest(req, `Password changed for role: ${role}`);
      res.json({ message: `Password for ${role} updated.` });
    }
  );
});


// Restart the server
router.post("/restart", (req, res) => {
  res.json({ message: "Restarting server..." });
  logFromRequest(req, logLevels.INFO, `Server restart requested`);
  setTimeout(() => {
    exec("pm2 restart auction", (err) => {
      if (err) console.log("Restart failed:", err);
    });
  }, 1000);
});

// Get recent server logs



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

// Change the admin password
// Maintainter password can only be set from the command line
router.post("/change-password", (req, res) => {
  const { newPassword } = req.body;
  const role = "admin"; // fixed to admin only

  if (!newPassword || newPassword.length < 5) {
    return res.status(400).json({ error: "Minimum length: 5" });
  }

  db.run(
    `UPDATE passwords SET password = ? WHERE role = ?`,
    [newPassword, role],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Admin role not found" });
      res.json({ message: "Admin password updated" });
      logFromRequest(req, logLevels.INFO, `Password for ${role} updated`);
    }
  );
});



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
  archive.file(DB_PATH, { name: "auction.db" });
  
  // Add referenced photos
  db.all("SELECT photo FROM items WHERE photo IS NOT NULL", [], (err, rows) => {
    if (err) {
      archive.append(`Error reading DB: ${err.message}`, { name: "error.txt" });
      archive.finalize();
      return;
    }

    const usedPhotos = new Set(rows.map(r => r.photo));
    for (const filename of usedPhotos) {
      const filePath = path.join(__dirname, "uploads", filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: `uploads/${filename}` });
      }
    }

    // res.writeHead(200, {
    //   'Content-Disposition': 'attachment; filename=' + filename,
    //   'Content-Type': 'application/zip'
    // });

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

    let deleted = 0;
    orphaned.forEach(file => {
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, file));
        deleted++;
      } catch (e) {
        logFromRequest(req, logLevels.ERROR, `Failed to delete ${file}: ` + e.message);
      }
    });

    res.json({ message: `Deleted ${deleted} orphaned file(s).`, orphaned });
    logFromRequest(req, logLevels.INFO, `${deleted} orphan photos deleted`);
  });
});




// Simple shuffle function
function shuffleArray(arr) {
  return arr.map(value => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value);
}

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

    const resizedPath = path.join(__dirname, "uploads", resizedFilename);
    const previewPath = path.join(__dirname, "uploads", previewFilename);

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

router.post('/save-pptx-config/:name', (req, res) => {
  const file = CONFIG_PATHS[req.params.name];
  if (!file) {
    logFromRequest(req, logLevels.WARN, `Unexpected file write requested`);
    return res.status(400).json({ error: `Invalid config name ${req.params.name}` });
  }
  let json;
  try {
      json = JSON.stringify(req.body, null, 2);
  } catch (err) {
    logFromRequest(req, logLevels.WARN, `PPTX config rejected, invalid JSON`);

      return res.status(400).json({ error: 'Invalid JSON' });
  }

  fs.writeFile(file, json, 'utf8', err => {
      if (err) return res.status(500).json({ error: 'Unable to save config' });
      res.json({ message: 'Configuration updated successfully.' });
      logFromRequest(req, logLevels.INFO, `PPTX config file ${file} updated`);

  });
});

router.post("/pptx-config/reset", (req, res) => {
  const { configType } = req.body;

  if (!configType || !["pptx", "card"].includes(configType)) {
    logFromRequest(req, logLevels.ERROR,`Invalid config type:` + configType);
    return res.status(400).json({ error: "Invalid config type." });
  }

  const defaultPath = path.join(__dirname, `./pptx-config/${configType}Config.default.json`);
  const livePath = path.join(__dirname, `./pptx-config/${configType}Config.json`);

  try {
    if (!fs.existsSync(defaultPath)) {
      logFromRequest(req, logLevels.ERROR,`Default config not found:` + defaultPath);

      return res.status(500).json({ error: "Default config not found." });
      
    }

    fs.copyFileSync(defaultPath, livePath);
    logFromRequest(req, logLevels.INFO,`Reset ${configType}Config.json to default.`);
    res.json({ message: `${configType}Config.json reset to default.` });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR,`Error resetting config:` + err.message);

    res.status(500).json({ error: "Failed to reset config." });
  }
});


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
      // Step 3: Check how many auctions remain
      db.get("SELECT COUNT(*) AS count FROM auctions", [], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        // clearup on last auction delete
        if (result.count === 0) {

          try {
            logFromRequest(req, logLevels.INFO, `Deleting last auction. Resetiing database`);

            const deleteBatch = db.transaction(() => {


              db.prepare("DELETE FROM audit_log").run();
              logFromRequest(req, logLevels.DEBUG, `Audit log cleared`);

              db.prepare("DELETE FROM auctions").run();
              logFromRequest(req, logLevels.DEBUG, `Auctions tablecleared`);

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

          } catch (err) {
            logFromRequest(req, logLevels.ERROR, `Reset failed: ${err.message}`);
            res.status(500).json({ error: "Reset failed", details: err.message });
          }

        } else {
          // The normal case.....
          logFromRequest(req, logLevels.INFO, `Auction ${auction_id} deleted`);
          return res.json({ message: "Auction deleted." });
        }
      });
    });
  });
});

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
    db.run(
      "INSERT INTO auctions (short_name, full_name, logo) VALUES (?, ?, ?)",
      [short_name.trim().toLowerCase(), full_name.trim(), logo || "default_logo.png"]
    );

    logFromRequest(req, logLevels.INFO,`Created new auction: ${short_name} with logo: ${logo}`);
    res.json({ message: "Auction created." });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Create auction error: ${err}`);
    res.status(500).json({ error: "Could not create auction" });
  }
});


router.post("/auctions/list", async (req, res) => {
 // logFromRequest(req, logLevels.DEBUG, `Auction list (maint) requested`);

    const sql = `
    SELECT a.id, a.short_name, a.full_name, a.logo, a.status,
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


// router.post("/auctions/set-status", async (req, res) => {

//   const { id, is_active } = req.body;


//   if (typeof id !== "number" || typeof is_active !== "boolean") {
//     return res.status(400).json({ error: "Missing or invalid auction ID or status" });
//   }

//   try {
//     // db.run("UPDATE auctions SET is_active = ? WHERE id = ?", is_active ? 1 : 0, id);
//     db.run("UPDATE auctions SET is_active = ? WHERE id = ?", [is_active ? 1 : 0, id]);
//     res.json({ message: `Auction ${is_active ? "activated" : "deactivated"}` });
//     logFromRequest(req, logLevels.INFO, `Auction ${id} set to ${is_active ? "activated" : "deactivated"}`);
//   } catch (err) {
//     logFromRequest(req, logLevels.ERROR, `Toggle auction status error: ${err}`);

//     res.status(500).json({ error: "Failed to update auction status" });
//   }
// });

// const allowedExtensions = [".jpg", ".jpeg", ".png"];
// const MAX_UPLOADS = 20;


router.post("/resources/upload", upload.array("images", MAX_UPLOADS), async (req, res) => {
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
});

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
      const pptxConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      const cardConfig = JSON.parse(fs.readFileSync(CARD_PATH, "utf-8"));

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


router.post("/auctions/update-status", (req, res) => {
  const { auction_id, status } = req.body;
  const allowedStatuses = ["setup", "locked", "live", "settlement", "archived"];

  if (!auction_id || typeof status !== "string") {
    return res.status(400).json({ error: "Missing auction ID or invalid status." });
  }

  const normalizedStatus = status.toLowerCase();

  if (!allowedStatuses.includes(normalizedStatus)) {
    return res.status(400).json({ error: `Invalid status: "${status}"` });
  }

  db.run("UPDATE auctions SET status = ? WHERE id = ?", [normalizedStatus, auction_id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    logFromRequest(req, logLevels.INFO, `Updated status for auction ${auction_id} to: ${normalizedStatus}`);
    // clear the auction state cache
    checkAuctionState.auctionStateCache.del(auction_id);
    res.json({ message: `Auction ${auction_id} status updated to ${normalizedStatus}` });
  });
});

router.post("/generate-bids", checkAuctionState(['live','settlement']), (req, res) => {
  const { auction_id, num_bids, num_bidders } = req.body;

  if (!auction_id || !Number.isInteger(num_bids) || !Number.isInteger(num_bidders)) {
    return res.status(400).json({ error: "Missing or invalid input." });
  }

  // Step 1: get items without bids
  db.all("SELECT id FROM items WHERE auction_id = ? AND winning_bidder_id IS NULL", [auction_id], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });

    const availableItems = items.map(i => i.id);
    if (availableItems.length === 0) return res.status(400).json({ error: "No items without bids." });

    if (num_bids < 1 || num_bids > availableItems.length) {
      return res.status(400).json({ error: `Number of bids must be between 1 and ${availableItems.length}` });
    }
    
  //  if (num_bids > availableItems.length) { num_bids = availableItems.length; }

    // db.all("SELECT id FROM bidders WHERE auction_id = ?", [auction_id], (err, bidders) => {
    //   if (err) return res.status(500).json({ error: err.message });

    //   const availableBidders = bidders.map(b => b.id);
    //   if (availableBidders.length === 0 && num_bidders < 1) return res.status(400).json({ error: "No bidders in auction." });

   
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
    audit(req.user.role, 'finalize (test)', 'item', itemId, { bidder: selected.paddle, price });

}

logFromRequest(req, logLevels.INFO, `Generated ${num_bids} test bid(s) for auction ${auction_id}:\n` + logLines.join("\n"));

     //   logFromRequest(req, logLevels.INFO, `Generated ${num_bids} test bids using dynamic bidders for auction ${auction_id}`);
        res.json({ message: `${num_bids} bids added to auction ${auction_id}` });
  
 //   });
  });
});

// Deletes all test bids from a specific auction, and prunes unused bidders
router.post("/delete-test-bids", checkAuctionState(['live','settlement']), (req, res) => {
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
    res.json({
      message: `Removed ${result.changes} test bids and ${deleted.changes} unused bidders.`
    });
  } catch (err) {
    console.error("Error deleting test bids:", err.message);
    res.status(500).json({ error: "Failed to delete test bids." });
  }
});

// View audit log with item details
router.get("/audit-log", (req, res) => {
  const { object_id } = req.query;

  let query = `
  SELECT 
  audit_log.*, 
  items.auction_id, 
  items.description, 
  items.item_number, 
  auctions.short_name
FROM audit_log
LEFT JOIN items ON audit_log.object_id = items.id
LEFT JOIN auctions ON items.auction_id = auctions.id

    `

  const params = [];
  if (object_id) {
    query += ` WHERE audit_log.object_id = ?`;
    params.push(object_id);
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

// Export audit log to CSV
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
    res.setHeader("Content-Type", "text/csv");
    res.send(csvContent);
  } catch (err) {
    console.error("Error exporting audit log:", err.message);
    res.status(500).send("Failed to export CSV.");
  }
});

  //--------------------------------------------------------------------------
  // Record audit events
  //--------------------------------------------------------------------------
  function audit (user, action, type, id, details = {}) {
    db.run(
      `INSERT INTO audit_log (user, action, object_type, object_id, details)
       VALUES (?,?,?,?,?)`,
      [user, action, type, id, JSON.stringify(details)]
    );
  }

module.exports = router;
