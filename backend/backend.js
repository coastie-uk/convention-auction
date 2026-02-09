/**
 * @file        backend.js
 * @description Backend main file. Handles core operations
 * @author      Chris Staples
 * @license     GPL3
 */

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const pptxgen = require('pptxgenjs');
const { Parser } = require('@json2csv/plainjs');
const bodyParser = require('body-parser');
var strftime = require('strftime');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();
const fsp = require('fs').promises;
const { audit, auditTypes } = require('./middleware/audit');
const { sanitiseText } = require('./middleware/sanitiseText');


// const VALID_ROLES = new Set(['admin', 'maintenance', 'cashier', 'slideshow']);
const allowedStatuses = ["setup", "locked", "live", "settlement", "archived"];

const {
    CONFIG_IMG_DIR,
    UPLOAD_DIR,
    allowedExtensions,
    SECRET_KEY,
    PORT,
    LOG_LEVEL,
    MAX_ITEMS,
    PPTX_CONFIG_DIR,
    OUTPUT_DIR,
    CURRENCY_SYMBOL,
    RATE_LIMIT_WINDOW,
    RATE_LIMIT_MAX,
    LOGIN_LOCKOUT_AFTER,
    LOGIN_LOCKOUT,
    ALLOWED_ORIGINS,
    ENABLE_CORS
} = require('./config');

const allowedExtensionsSet = new Set(allowedExtensions.map((ext) => ext.toLowerCase()));

const { authenticateRole } = require('./middleware/authenticateRole');

const maintenanceRoutes = require('./maintenance');
const { logLevels, setLogLevel, logFromRequest, createLogger, log } = require('./logger');

log('General', logLevels.INFO, '~~ Starting up Auction backend ~~');
log('Logger', logLevels.INFO, `Logging framework initialized. `);

const sessionTime = 12 * 60 * 60; // 12 hours

const { api: paymentsApi, paymentProcessorVer } = require('./payments');

const loginRateState = new Map();
const loginLockoutState = new Map();

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function checkRateLimit(req) {
   // log('RateLimit', logLevels.DEBUG, `Checking rate limit for IP ${getClientIp(req)}, current state: ${JSON.stringify([...loginRateState])}, config: max ${RATE_LIMIT_MAX} per ${RATE_LIMIT_WINDOW}s`);
  const ip = getClientIp(req);
  const now = Date.now();
  let entry = loginRateState.get(ip);

  if (!entry || now - entry.windowStart >= (RATE_LIMIT_WINDOW * 1000)) {
    entry = { windowStart: now, count: 0 };
  }

  entry.count += 1;
  loginRateState.set(ip, entry);

  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfterMs = entry.windowStart + (RATE_LIMIT_WINDOW * 1000) - now;
    return { limited: true, retryAfterMs: Math.max(retryAfterMs, 0) };
  }

  return { limited: false };
}

function getLockoutKey(req, role) {
  return `${getClientIp(req)}::${role || 'unknown'}`;
}

function isLoginLockedOut(req, role) {
  const now = Date.now();
  const key = getLockoutKey(req, role);
  const entry = loginLockoutState.get(key);

  if (!entry) return { locked: false };
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }

  if (entry.lockedUntil && entry.lockedUntil <= now) {
    loginLockoutState.set(key, { failures: 0, lockedUntil: 0 });
  }

  return { locked: false };
}

function recordLoginFailure(req, role) {
  const now = Date.now();
  const key = getLockoutKey(req, role);
  let entry = loginLockoutState.get(key);

  if (!entry || (entry.lockedUntil && entry.lockedUntil <= now)) {
    entry = { failures: 0, lockedUntil: 0 };
  }

  entry.failures += 1;

  if (entry.failures >= LOGIN_LOCKOUT_AFTER) {
    entry.lockedUntil = now + (LOGIN_LOCKOUT * 1000);
    entry.failures = 0;
  }

  loginLockoutState.set(key, entry);
}

function clearLoginFailures(req, role) {
  loginLockoutState.delete(getLockoutKey(req, role));
}


// collect up version info
const { version } = require('./package.json'); // get version from package.json
const backendVersion = version || 'Unknown';
const { schemaVersion } = require('./db'); // get schema version from db.js

const db = require('./db');

const { checkAuctionState } = require('./middleware/checkAuctionState')
// (

//     { ttlSeconds: 2 }
// );

log('General', logLevels.INFO, `Backend version: ${backendVersion}, DB schema version: ${schemaVersion}`);
log('General', logLevels.INFO, `Payment processor: ${paymentProcessorVer}`);

setLogLevel(LOG_LEVEL.toUpperCase());

//--------------------------------------------------------------------------
// CORS
// Needed if the frontend and backend are separated
//--------------------------------------------------------------------------
if (ENABLE_CORS) {
const allowedOrigins = Array.isArray(ALLOWED_ORIGINS)
  ? Array.from(new Set(ALLOWED_ORIGINS))
  : [];
const corsOptions = {
  credentials: true,
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0) {
      return callback(null, true);
    }
    return allowedOrigins.includes(origin)
      ? callback(null, true)
      : callback(new Error('Not allowed by CORS'));
  }
};
log('General', logLevels.INFO, `CORS enabled. Allowed origins: ${allowedOrigins.join(', ')}`);
app.use(cors(corsOptions));
} else {
    log('General', logLevels.INFO, 'CORS is disabled.');
}



// Then generic parsers and other routes
app.use(express.json());

app.use((err, req, res, next) => {
  // Body parser error for invalid JSON
  if (err && err.type === 'entity.parse.failed') {
    logFromRequest(req, logLevels.WARN, `Invalid JSON payload: ${err.message}`);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  if (err && err.message === 'Not allowed by CORS') {
    logFromRequest(req, logLevels.WARN, `CORS rejected origin: ${req.headers.origin || 'unknown'}`);
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }

  return next(err);
});

app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  if (req.path && req.path.startsWith('/maintenance')) {
    return next();
  }
  if (typeof db.isMaintenanceLocked === 'function' && db.isMaintenanceLocked()) {
    return res.status(503).json({ error: 'Database maintenance in progress' });
  }
  return next();
});

// Must come after body parsers
require('./phase1-patch')(app);


// Mount API
app.use(paymentsApi);


// Multer storage setup for file uploads
const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}.jpg`;
        cb(null, uniqueName);
    },
});
const upload = multer({
    storage: storage,
    limits: { fileSize: (20000000) /* bytes */ }
});


// Ensure OUTPUT_DIR exists - This one specifically as it's used for temporary output files)

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true, mode: 0o755 });
}

//--------------------------------------------------------------------------
// POST /validate
// API to validate token. Used to check if stored session is valid
//--------------------------------------------------------------------------

app.post('/validate', async (req, res) => {
    const { token } = req.body;
    if (!token) {
        logFromRequest(req, logLevels.ERROR, `Token not provided`);

        return res.status(403).json({ error: "No stored session" });
    }
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            logFromRequest(req, logLevels.INFO, `Token invalid. session expired`);
            return res.status(403).json({ error: "Session expired" });
        }
        req.user = decoded;
        res.json({ token, versions: 
            { backend: backendVersion, schema: schemaVersion, payment_processor: paymentProcessorVer } });
        logFromRequest(req, logLevels.DEBUG, `Token validated successfully`);


    });
})

//--------------------------------------------------------------------------
// POST /login
// Login route. Checks pw and returns a jwt
// Also returns currency symbol + version data (as this route is the entry point to all users)
//--------------------------------------------------------------------------
app.post('/login', (req, res) => {

    const { password, role } = req.body;
    if (!password || !role) {
        logFromRequest(req, logLevels.ERROR, `No password provided`);
        return res.status(400).json({ error: "Password required" });
    }

    const lockout = isLoginLockedOut(req, role);
    if (lockout.locked) {
        const retryAfterSeconds = Math.ceil(lockout.retryAfterMs / 1000);
        res.set('Retry-After', retryAfterSeconds.toString());
        logFromRequest(req, logLevels.WARN, `Login locked out for role ${role} from ${getClientIp(req)}`);
        return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
    }

    let row;
    try {
        row = db.get(`SELECT password FROM passwords WHERE role = ?`, [role]);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }

    if (!row || !row.password) {
        logFromRequest(req, logLevels.WARN, `Invalid password for role ${role} entered`);
        recordLoginFailure(req, role);
        return res.status(403).json({ error: "Invalid password" });
    }

    const stored = row.password;

    // If the stored password looks like a bcrypt hash, compare with bcrypt
    const isHash = typeof stored === 'string' && stored.startsWith('$2');

    const handleSuccess = () => {
        const token = jwt.sign({ role }, SECRET_KEY, { expiresIn: sessionTime });
        res.json({
            token,
            currency: CURRENCY_SYMBOL,
            versions:
                { backend: backendVersion, schema: schemaVersion, payment_processor: paymentProcessorVer }
        });

        logFromRequest(req, logLevels.INFO, `User with role "${role}" logged in`);
        logFromRequest(req, logLevels.DEBUG, `full Token: ${token}....`);
    };

    if (isHash) {
        bcrypt.compare(password, stored, (bErr, match) => {
            if (bErr) return res.status(500).json({ error: bErr.message });
            if (!match) {
                logFromRequest(req, logLevels.WARN, `Invalid password for role ${role} entered`);
                recordLoginFailure(req, role);
                return res.status(403).json({ error: "Invalid password" });
            }
            clearLoginFailures(req, role);
            return handleSuccess();
        });
    } else {
        // legacy plaintext entry - validate then upgrade to hashed password
        if (stored !== password) {
            logFromRequest(req, logLevels.WARN, `Invalid password for role ${role} entered`);
            recordLoginFailure(req, role);
            return res.status(403).json({ error: "Invalid password" });
        }

        // upgrade - hash and store
        const hashed = bcrypt.hashSync(password, 12);
        try {
            db.run(`UPDATE passwords SET password = ? WHERE role = ?`, [hashed, role]);
            logFromRequest(req, logLevels.INFO, `Upgraded plaintext password to bcrypt for role ${role}`);
        } catch (uErr) {
            logFromRequest(req, logLevels.ERROR, `Failed to upgrade plaintext password for ${role}: ${uErr.message}`);
        }
        clearLoginFailures(req, role);
        return handleSuccess();
    }
});

//--------------------------------------------------------------------------
// GET /slideshow-auth
// Allows admin to retrieve slideshow credentials
//--------------------------------------------------------------------------

app.get('/slideshow-auth', authenticateRole("admin"), (req, res) => {
    const role = 'slideshow';
    const token = jwt.sign({ role }, SECRET_KEY, { expiresIn: sessionTime });
    res.json({ token });
});

// Get the next item number for a given auction ID
function getNextItemNumber(auction_id) {
    const row = db.get(`SELECT MAX(item_number) + 1 AS next FROM items WHERE auction_id = ?`, [auction_id]);
    return row?.next || 1;
}

//--------------------------------------------------------------------------
// POST /auctions/:auctionId/newitem
// API to handle item submission
// This a a public route but uses checkAuctionState to ensure auction is accepting submissions
//--------------------------------------------------------------------------
// notable difference: uses :publicId not :auctionId - conversion handled in checkAuctionState

app.post('/auctions/:publicId/newitem', checkAuctionState(['setup', 'locked']), async (req, res) => {
    //    logFromRequest(req, logLevels.DEBUG, `Request received`);
    try {
        const auth = req.header(`Authorization`);
        let is_admin = false;
        if (auth) {
            try {
                jwt.verify(auth, SECRET_KEY);
                is_admin = true;
                logFromRequest(req, logLevels.DEBUG, `New item request (admin) passed check`);
            } catch (err) {
                return res.status(403).json({ error: "Not authorised" });
            }
        }

        if (!is_admin) {
            const rateLimit = checkRateLimit(req);
            if (rateLimit.limited) {
                const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000);
                res.set('Retry-After', retryAfterSeconds.toString());
                logFromRequest(req, logLevels.WARN, `Item submission rate limit exceeded from IP ${getClientIp(req)} (max ${RATE_LIMIT_MAX} per ${RATE_LIMIT_WINDOW}s)`);
                return res.status(429).json({ error: "Too many submissions. Please try again in " + retryAfterSeconds.toString() + " seconds." }); // 429 Too Many Requests
            }
        }

        await awaitMiddleware(upload.single('photo'))(req, res);


        const row = db.get("SELECT COUNT(*) AS count FROM items");
        if (row.count >= MAX_ITEMS) {
            logFromRequest(req, logLevels.WARN, `Item limit reached. Maximum allowed is ${MAX_ITEMS}.`);
            return res.status(400).json({ error: `Server item limit reached` });
        }

        let photoPath = req.file ? req.file.filename : null;
        const { description, contributor, artist, notes } = req.body;
        // auction_id is set in req by checkAuctionState
        const auction_id = req.auction.id;

        logFromRequest(req, logLevels.DEBUG, `New item being added to auction id ${auction_id}`);

        logFromRequest(req, logLevels.DEBUG, `Auction identified as ${req.auction.id} from checkAuctionState`);

        const sanitisedDescription = sanitiseText(description, 1024);
        const sanitisedContributor = sanitiseText(contributor, 512);
        const sanitisedArtist = sanitiseText(artist, 512);
        const sanitisedNotes = sanitiseText(notes, 1024);

        if (!auction_id) {
            logFromRequest(req, logLevels.ERROR, `Missing auction ID`);
            return res.status(400).json({ error: "Missing auction ID" });

        } else if (!sanitisedDescription || !sanitisedContributor) {
            logFromRequest(req, logLevels.ERROR, `Missing item description or contributor`);
            return res.status(400).json({ error: "Missing item description or contributor" });
        }

        // Check that the auction is active
        const auctionRow = db.get("SELECT status FROM auctions WHERE id = ?", [auction_id]);
        if (!auctionRow) {
            return res.status(400).json({ error: "Auction not found" });
        }

        // checkAuctionState() has already checked for scenarios which shouldn't happen, so the test here is simpler
        if (auctionRow.status === "locked" && is_admin === false) {
            logFromRequest(req, logLevels.WARN, `Public submission rejected. Auction ${auction_id} is locked`);
            return res.status(403).json({ error: "This auction is not currently accepting submissions." });
        }

        if (photoPath) {
            // const resizedPath = `./uploads/resized_${photoPath}`;
            // const previewPath = `./uploads/preview_resized_${photoPath}`;

            const resizedPath = path.join(UPLOAD_DIR, `resized_${photoPath}`);
            const previewPath = path.join(UPLOAD_DIR, `preview_resized_${photoPath}`);

            const fileExtension = path.extname(req.file?.originalname || photoPath).toLowerCase();
            if (!allowedExtensionsSet.has(fileExtension)) {
                logFromRequest(req, logLevels.ERROR, `Invalid image extension: ${fileExtension}`);
                return res.status(400).json({ error: "Invalid image upload" });
            }

            try {
                await sharp(req.file.path).metadata(); // Will throw if not an image

                await sharp(req.file.path)
                    .resize(2000, 2000, {
                        fit: 'inside',
                    })
                    .jpeg({ quality: 90 })
                    .toFile(resizedPath);

                await sharp(req.file.path)
                    .resize(400, 400, {
                        fit: 'inside'
                    })
                    .jpeg({ quality: 70 })
                    .toFile(previewPath);

                fs.unlinkSync(req.file.path);
                photoPath = `resized_${photoPath}`;
                logFromRequest(req, logLevels.INFO, `Photo captured and saved`);
            } catch (err) {
                logFromRequest(req, logLevels.ERROR, `Photo processing failed: ${err.message}`);
                return res.status(400).json({ error: "Invalid image upload" });
            }
        }

        // get the next item number
        const itemNumber = getNextItemNumber(auction_id);
        const result = db.run(`INSERT INTO items (item_number, description, contributor, artist, notes, photo, auction_id, date) VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%d-%m-%Y %H:%M', 'now'))`,
            [itemNumber, sanitisedDescription, sanitisedContributor, sanitisedArtist, sanitisedNotes, photoPath, auction_id]
        );
        res.json({ id: result.lastInsertRowid, sanitisedDescription, sanitisedContributor, sanitisedArtist, photo: photoPath });
        logFromRequest(req, logLevels.INFO, `Item ${result.lastInsertRowid} stored for auction ${auction_id} as item #${itemNumber}`);
        const user = is_admin ? "admin" : "public";
        audit(user, 'new item', 'item', result.lastInsertRowid, { description: sanitisedDescription, initial_number: itemNumber });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

//--------------------------------------------------------------------------
// GET /auctions/:auctionId/items
// API to get all auction items. Accepts optional sort and direction
//--------------------------------------------------------------------------

app.get('/auctions/:auctionId/items', authenticateRole("admin"), (req, res) => {
    const auction_id = Number(req.params.auctionId);
    const sort = (req.query.sort || "asc").toUpperCase();
    const field = req.query.field || "item_number";

    const allowedFields = ["item_number", "paddle_number", "hammer_price", "description", "contributor", "artist"];
    const sortField = allowedFields.includes(field) ? field : "item_number";
    const sortOrder = sort.toUpperCase() === "DESC" ? "DESC" : "ASC";

    if (!auction_id) {
        return res.status(400).json({ error: "Missing auction_id" });
    }

    const LIST_ITEMS_SQL = `
    SELECT i.id,
           i.item_number,
           i.description,
           i.contributor,
           i.artist,
           i.notes,
           i.photo,
           i.hammer_price,
           b.paddle_number AS paddle_no,
           i.test_item,
           i.test_bid,
           i.date,
           i.mod_date
    FROM items   i
    LEFT JOIN bidders b ON b.id = i.winning_bidder_id
    WHERE i.auction_id = ?
    ORDER BY ${sortField} COLLATE NOCASE ${sortOrder}, item_number ${sortOrder}
  `;

    try {
        const stmt = db.prepare(LIST_ITEMS_SQL);
        const items = stmt.all(auction_id);

        try {
            totals = db.prepare(`
                SELECT 
                    COUNT(*) AS item_count,
                    SUM(CASE WHEN i.hammer_price IS NOT NULL THEN 1 ELSE 0 END) AS items_with_bids,
                    SUM(i.hammer_price) AS hammer_total
                FROM items i
                WHERE i.auction_id = ?
            `).get(auction_id);

        } catch (err) {
            console.error("Error calculating item totals:", err);
            return res.status(500).json({ error: "Failed to calculate auction totals." });
        }


        res.json({ items, totals });

    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Error fetching items ${err.message}`);
        res.status(500).json({ error: "Failed to load items." + err.message });
    }


});

//--------------------------------------------------------------------------
// POST /auctions/:auctionId/items/:id/update
// API to update an item, including photo. Includes moving an item to a new auction
//--------------------------------------------------------------------------

app.post('/auctions/:auctionId/items/:id/update', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), async (req, res) => {
    const auction_id = Number(req.params.auctionId);
    const id = Number(req.params.id);

    logFromRequest(req, logLevels.DEBUG, `Request received to update item ${id}`);

	try {
	  await awaitMiddleware(upload.single('photo'))(req, res);

	    const row = db.get('SELECT photo, auction_id, description, contributor, artist, notes, winning_bidder_id, hammer_price FROM items WHERE id = ?', [id]);
	    if (!row) {
	        logFromRequest(req, logLevels.ERROR, `Update: Item not found`);
	        return res.status(400).json({ error: 'Item not found' });
	    }
	    if (row.auction_id !== req.auction.id) {
	        logFromRequest(req, logLevels.ERROR, `Update: Item ${id} auction ID mismatch. Item is in auction ${row.auction_id}, request is for auction ${req.auction.id}`);
	        return res.status(400).json({ error: "Item auction ID mismatch" });
	    }
	    if (row.winning_bidder_id != null || row.hammer_price != null) {
	        logFromRequest(req, logLevels.WARN, `Edit blocked: item ${id} has bids`);
	        return res.status(400).json({ error: "Item has a bid and cannot be edited" });
	    }


	    let photoPath = row.photo;

        // Process new photo
        if (req.file) {
            let targetFilename = row.photo?.startsWith("resized_") ? row.photo : `resized_${uuidv4()}.jpg`;

           const resizedPath = path.join(UPLOAD_DIR, targetFilename);
           const previewPath = path.join(UPLOAD_DIR, `preview_${targetFilename}`);

            try {

                await sharp(req.file.path).metadata(); // Will throw if not an image


                await sharp(req.file.path)
                    .resize(2000, 2000, { fit: 'inside' })
                    .jpeg({ quality: 90 })
                    .toFile(resizedPath);

                await sharp(req.file.path)
                    .resize(400, 400, { fit: 'inside' })
                    .jpeg({ quality: 70 })
                    .toFile(previewPath);

                fs.unlinkSync(req.file.path);

                if (row.photo && row.photo !== targetFilename) {
                    // const oldFull = `./uploads/${row.photo}`;
                    // const oldPreview = `./uploads/preview_${row.photo}`;

                    const oldFull = path.join(UPLOAD_DIR, row.photo);
                    const oldPreview = path.join(UPLOAD_DIR, `preview_${row.photo}`);


                    if (fs.existsSync(oldFull)) fs.unlinkSync(oldFull);
                    if (fs.existsSync(oldPreview)) fs.unlinkSync(oldPreview);
                }

                photoPath = targetFilename;
                logFromRequest(req, logLevels.INFO, `Photo updated → ${targetFilename}`);

            } catch (err) {
                logFromRequest(req, logLevels.ERROR, `Image procesing failed`);

                fs.unlinkSync(req.file.path); // cleanup
                res.status(400).json({ error: 'Invalid image file' });
                return;
            }
        }

        // Only collect fields that are provided (and not undefined/null)
        const updates = [];
        const params = [];

        // For each field, check if it's provided and different from current value. If so, add to updates (minimize DB writes)
        const fields = ["description", "contributor", "artist", "notes"];
        fields.forEach(field => {
            if (req.body[field] !== undefined && req.body[field] !== null && req.body[field] !== row[field]) {
                updates.push(`${field} = ?`);
                params.push(req.body[field]);
            }
        });

        // Always update photo if processed
        if (req.file) {
            updates.push("photo = ?");
            params.push(photoPath);
        }


        // For each field, check if it's provided and different from current value. If so, add to updates (minimize DB writes)
        // update mod_date if there are any updates
	    if (updates.length > 0) {
	        const updateSummary = JSON.stringify(updates) + " / " + JSON.stringify(params);
	        logFromRequest(req, logLevels.DEBUG, `updates and values: ${updateSummary}, photo: ${req.file ? photoPath : 'no file'}`);
	        updates.push("mod_date = strftime('%d-%m-%Y %H:%M', 'now')");
	        const sql = `UPDATE items SET ${updates.join(", ")} WHERE id = ?`;
	        params.push(id);

	        db.run(sql, params);
	        res.json({ message: 'Item updated', photo: photoPath });
	        logFromRequest(req, logLevels.INFO, `Update item completed for ${id}`);
	        audit(req.user.role, 'updated', 'item', id, { changes: updateSummary, photo_updated: !!req.file });
	    } else {
	        res.json({ message: 'No changes found', photo: photoPath });
	        logFromRequest(req, logLevels.INFO, `No changes detected for item ${id}`);
	    }
	    }
	    catch (err) {
	        logFromRequest(req, logLevels.ERROR, "Error editing: " + err.message);
	        res.status(500).json({ error: err.message });
	    }

});

//--------------------------------------------------------------------------
// POST /auctions/:auctionId/items/:id/move
// API to move an item to a new auction
//--------------------------------------------------------------------------

app.post('/auctions/:auctionId/items/:id/move-auction/:targetAuctionId', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), (req, res) => {
    const id = Number(req.params.id);
    const target_auction_id = req.params.targetAuctionId;
    const newAuctionId = parseInt(target_auction_id);

    if (!target_auction_id || isNaN(parseInt(target_auction_id))) {
        logFromRequest(req, logLevels.ERROR, `Move: Missing or invalid target auction ID: ` + target_auction_id);
        return res.status(400).json({ error: "Missing or invalid target auction ID" });
    }

    logFromRequest(req, logLevels.DEBUG, `Request received to move item ${id} to auction ${newAuctionId}`);
    try {
            // get current auction ID from req set by checkAuctionState
            const oldAuctionId = Number(req.auction.id);

            if (!oldAuctionId || isNaN(oldAuctionId) || oldAuctionId !== Number(req.params.auctionId)) {
                logFromRequest(req, logLevels.ERROR, `Move: Missing or bad current auction ID. Request: ${req.params.auctionId} Item is: ${oldAuctionId}`);
                return res.status(400).json({ error: "Missing or bad current auction ID" });
            }
 
            if (newAuctionId === oldAuctionId) {
                return res.status(400).json({ error: "Item is already in the target auction" });
            }
            
            // Moving an item with bids messes up our data integrity - block it
            const itemBidState = db.get("SELECT winning_bidder_id, hammer_price FROM items WHERE id = ?", [id]);
            if (itemBidState?.winning_bidder_id != null || itemBidState?.hammer_price != null) {
                logFromRequest(req, logLevels.WARN, `Move blocked: item ${id} has bids`);
                return res.status(400).json({ error: "Item has bids and cannot be moved" });
            }
            // target auction must be in setup or locked state
            // let targetAuction = checkAuctionState.auctionStateCache?.get(newAuctionId);
            // if (!targetAuction) {
              let  targetAuction = db.get("SELECT id, status FROM auctions WHERE id = ?", [newAuctionId]);
                // if (targetAuction) {
                //    checkAuctionState.auctionStateCache?.set(newAuctionId, targetAuction);
                // }
            // }

            if (!targetAuction) {
                logFromRequest(req, logLevels.ERROR, `Move: Target auction ${newAuctionId} not found`);
                return res.status(400).json({ error: "Target auction not found" });
            }

            const targetState = String(targetAuction.status).toLowerCase();
            if (targetState !== "setup" && targetState !== "locked") {
                logFromRequest(req, logLevels.WARN, `Move blocked: target auction ${newAuctionId} state is ${targetAuction.status}`);
                return res.status(400).json({ error: "Target auction must be in setup or locked state" });
            }

            logFromRequest(req, logLevels.DEBUG, `Moving ${id} from auction ${oldAuctionId} to auction ${newAuctionId}`);
            const result = db.get("SELECT MAX(item_number) + 1 AS next FROM items WHERE auction_id = ?", [newAuctionId]);
            const newNumber = result?.next || 1;
            db.run("UPDATE items SET mod_date = strftime('%d-%m-%Y %H:%M', 'now'), auction_id = ?, item_number = ? WHERE id = ?",
                [newAuctionId, newNumber, id]
            );

            logFromRequest(req, logLevels.INFO, `Moved item ${id} from auction ${oldAuctionId} to ${newAuctionId}`);

            renumberAuctionItems(oldAuctionId, (err4, count) => {
                if (err4) {
                    logFromRequest(req, logLevels.ERROR, `Renumber failed for old auction ${oldAuctionId}: ${err4.message}`);
                    return res.status(500).json({ error: err4.message });
                }
                logFromRequest(req, logLevels.DEBUG, `Renumbered ${count} items in old auction ${oldAuctionId}`);
            });
            audit(req.user.role, 'moved auction', 'item', id, { old_auction: oldAuctionId, new_auction: newAuctionId, new_no: newNumber });

            res.json({ message: `Item moved to auction ${newAuctionId}`, item_number: newNumber });


  
    }
    catch (err) {
        logFromRequest(req, logLevels.ERROR, "Error moving: " + err.message);
        res.status(500).json({ error: err.message });
    }
});


//--------------------------------------------------------------------------
// DELETE /items/:id
// API to delete an item, including photos
//--------------------------------------------------------------------------

app.delete('/items/:id', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), (req, res) => {
    const { id: itemId } = req.params;

    logFromRequest(req, logLevels.DEBUG, `Delete: Request Recieved for ${itemId}`);

    try {

    const row = db.get('SELECT description, photo, auction_id, winning_bidder_id, hammer_price FROM items WHERE id = ?', [itemId]);
    if (!row) {
        logFromRequest(req, logLevels.ERROR, `Delete: Item id ${itemId} not found`);
        return res.status(400).json({ error: 'Item not found' });
    }
    if (row.winning_bidder_id != null || row.hammer_price != null) {
        logFromRequest(req, logLevels.WARN, `Delete blocked: item ${itemId} has bids`);
        return res.status(400).json({ error: "Item has bids and cannot be deleted" });
    }
    if (row.auction_id !== req.auction.id) {
        logFromRequest(req, logLevels.ERROR, `Delete: Item ${itemId} auction ID mismatch. Item is in auction ${row.auction_id}, request is for auction ${req.auction.id}`);
        return res.status(400).json({ error: "Item auction ID mismatch" });
    }

    if (row.photo) {
        const photoPath = path.join(UPLOAD_DIR, row.photo);
        if (fs.existsSync(photoPath)) {
            fs.unlinkSync(photoPath);
        }

        const oldPreviewPath = path.join(UPLOAD_DIR, `preview_${row.photo}`);
        if (fs.existsSync(oldPreviewPath)) {
            fs.unlinkSync(oldPreviewPath);
        }
    }

    db.run('DELETE FROM items WHERE id = ?', [itemId]);

    logFromRequest(req, logLevels.INFO, `Deleted item ${itemId} from auction ${row.auction_id}. Description: ${row.description}`);

    renumberAuctionItems(row.auction_id, (err, count) => {
        if (err) {
            logFromRequest(req, logLevels.ERROR, `Failed to renumber items after delete:` + err.message);

        } else {
            logFromRequest(req, logLevels.INFO, `Renumbered ${count} items in auction ${row.auction_id} after deletion`);
        }
    });
    audit(req.user.role, 'delete', 'item', itemId, { auction_id: row.auction_id, description: row.description });
    res.json({ message: 'Item deleted' });
} catch (err) {
        logFromRequest(req, logLevels.ERROR, `Delete: error ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

//--------------------------------------------------------------------------
// POST /generate-pptx
// API to generate PowerPoint presentation for all items using a master slide template
//--------------------------------------------------------------------------

app.post('/generate-pptx', authenticateRole("admin"), async (req, res) => {
    const { auction_id } = req.body;
    logFromRequest(req, logLevels.DEBUG, 'Slide generation started for auction ' + auction_id);

    try {

       // const configPath = path.join(__dirname, './pptx-config/pptxConfig.json');
        const configPath = path.join(PPTX_CONFIG_DIR, 'pptxConfig.json');
                const configData = await fsp.readFile(configPath, 'utf-8');
        const config = JSON.parse(configData);

        const rows = db.all('SELECT * FROM items WHERE auction_id = ? ORDER BY item_number ASC', [auction_id]);

        let pptx = new pptxgen();

        //define the slide master
        pptx.defineSlideMaster(config.masterSlide);

        logFromRequest(req, logLevels.DEBUG, `Slides: starting generation`);

        for (const item of rows) {
            let slide = pptx.addSlide({ masterName: "AUCTION_MASTER" });
            slide.addText(`Item # ${item.item_number} of ${rows.length}`, config.idStyle);
            slide.addText(item.description, config.descriptionStyle);
            slide.addText(`Donated by: ${item.contributor}`, config.contributorStyle);
            slide.addText(`Creator: ${item.artist}`, config.artistStyle);

            if (item.photo) {
          //      const imgPath = `./uploads/${item.photo}`;
                const imgPath = path.join(UPLOAD_DIR, item.photo);
                if (fs.existsSync(imgPath)) {
                    const metadata = await sharp(imgPath).metadata();
                    const aspectRatio = metadata.width / metadata.height;

                    const imgWidth = config.imageWidth;
                    const imgHeight = imgWidth / aspectRatio;

                    slide.addImage({
                        path: imgPath,
                        x: config.imageX ?? 0.2,
                        y: config.imageY ?? 0.2,
                        w: imgWidth,
                        h: imgHeight,
                        sizing: {
                            type: config.sizing?.type || 'contain',
                            w: config.sizing?.w || imgWidth,
                            h: config.sizing?.h || imgHeight
                        }
                    });
                }
            }
        }

     //   const filePath = './outputs/auction_presentation.pptx';
        const filePath = path.join(OUTPUT_DIR, 'auction_presentation.pptx');
        await pptx.writeFile({ fileName: filePath });

        logFromRequest(req, logLevels.INFO, 'Slide file created for auction ' + auction_id);

        res.download(filePath);
    } catch (error) {
        res.status(500).json({ error: error.message });
        logFromRequest(req, logLevels.ERROR, `slide gen for auction ${auction_id} failed: ` + error.message);

    }
});

//--------------------------------------------------------------------------
// POST /generate-cards
// API to generate item cards
//--------------------------------------------------------------------------

app.post('/generate-cards', authenticateRole("admin"), async (req, res) => {
    const { auction_id } = req.body;

    logFromRequest(req, logLevels.DEBUG, `Req received for auction ${auction_id}`);

    try {

   //     const configPath = path.join(__dirname, './pptx-config/cardConfig.json');
        const configPath = path.join(PPTX_CONFIG_DIR, 'cardConfig.json');

        const configData = await fsp.readFile(configPath, 'utf-8');
        const cardconfig = JSON.parse(configData);

        const rows = db.all('SELECT * FROM items WHERE auction_id = ? ORDER BY item_number ASC', [auction_id]);

        let pptx = new pptxgen();

        //define the slide master
        // pptx.defineSlideMaster({
        //     title: "CARD_MASTER",
        //     background: { color: "FFFFFF" },
        //     objects: [
        //         //   { line: { x: 3.5, y: 1.0, w: 6.0, line: { color: "0088CC", width: 5 } } },
        //         //   { rect: { x: 0.0, y: 5.3, w: "100%", h: 0.75, fill: { color: "F1F1F1" } } },
        //         //   { text: { text: "Test text", options: { x: 3.0, y: 5.3, w: 5.5, h: 0.75 } } },
        //         //   { image: { x: 0, y: 4.2, w: "100%", h: 1.5, path: "slide-banner-new.jpg" } },
        //         { image: { x: 4.6, y: 3.0, w: 0.8, h: 0.8, path: "logo.png" } },
        //     ],
        //     //   slideNumber: { x: 0.3, y: "80%" },
        // });
        pptx.defineSlideMaster(cardconfig.masterSlide);

        // Define page size as a6
        pptx.defineLayout({ name: 'A6', width: 5.8, height: 4.1 });
        pptx.layout = 'A6'
        logFromRequest(req, logLevels.DEBUG, `Cards: starting generation`);

        for (const item of rows) {
            let slide = pptx.addSlide({ masterName: "CARD_MASTER" });
            slide.addText(`Item no: ${item.item_number}`, cardconfig.idStyle);
            slide.addText(item.description, cardconfig.descriptionStyle);
            slide.addText(`Donated by: ${item.contributor}`, cardconfig.contributorStyle);
            slide.addText(`Creator: ${item.artist}`, cardconfig.artistStyle);
        }

    //    const filePath = './outputs/auction_cards.pptx';
    const filePath = path.join(OUTPUT_DIR, 'auction_cards.pptx');

        await pptx.writeFile({ fileName: filePath });
        logFromRequest(req, logLevels.INFO, 'Item cards generated for auction ' + auction_id);

        res.download(filePath);
    } catch (error) {
        res.status(500).json({ error: error.message });
        logFromRequest(req, logLevels.ERROR, `card gen for auction ${auction_id} failed: ` + error.message);


    }
});

//--------------------------------------------------------------------------
// POST /export-csv
// API to export all items from the selected auction to CSV
//--------------------------------------------------------------------------

app.post('/export-csv', authenticateRole("admin"), (req, res) => {
    const { auction_id } = req.body;

    if (!auction_id) {
        return res.status(400).json({ error: "Missing auction_id" });
    }
    logFromRequest(req, logLevels.INFO, 'CSV export requested for auction ' + auction_id);
    const rows = db.all(`
        
        SELECT 
         i.*,
        b.paddle_number
        FROM items i
        LEFT JOIN bidders b ON b.id = i.winning_bidder_id
        WHERE i.auction_id = ?
        ORDER BY i.item_number ASC;`
        , [auction_id]);

    const parser = new Parser({ fields: ['id', 'description', 'contributor', 'artist', 'photo', 'date', 'notes', 'mod_date', 'auction_id', 'item_number', 'paddle_number', 'hammer_price'] });
    const csv = parser.parse(rows);
    //    const filePath = './outputs/auction_data.csv';
    const filePath = path.join(OUTPUT_DIR, 'auction_data.csv');
    fs.writeFileSync(filePath, csv);
    logFromRequest(req, logLevels.INFO, 'CSV file generated for auction ' + auction_id);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader("Content-Disposition", `attachment; filename=auction_${auction_id}_items.csv`);
    res.end('\uFEFF' + csv);
});

//--------------------------------------------------------------------------
// POST /rotate-photo
// API to rotate a photo
//--------------------------------------------------------------------------


app.post('/rotate-photo', authenticateRole("admin"), async (req, res) => {
    const { id, direction } = req.body;
    logFromRequest(req, logLevels.DEBUG, `Rotate Request for item ${id} (${direction})`);

    let row;
    try {
        row = db.get('SELECT photo FROM items WHERE id = ?', [id]);
    } catch (err) {
        return res.status(500).json({ error: 'Photo not found' });
    }
    if (!row) {
        return res.status(500).json({ error: 'Photo not found' });
    }

    const photoFilename = row.photo;
    const photoPath = path.join(UPLOAD_DIR, photoFilename);
    const previewPath = path.join(UPLOAD_DIR, `preview_${photoFilename}`);
    const angle = direction === 'left' ? -90 : 90;

    try {
        // Rotate main image
        await sharp(photoPath)
            .rotate(angle)
            .toFile(photoPath + '.tmp');
        fs.renameSync(photoPath + '.tmp', photoPath);

        // Rotate preview
        await sharp(previewPath)
            .rotate(angle)
            .toFile(previewPath + '.tmp');
        fs.renameSync(previewPath + '.tmp', previewPath);

        // Update mod_date after rotation
        db.run(`UPDATE items SET mod_date = strftime('%d-%m-%Y %H:%M', 'now') WHERE id = ?`, [id]);

        res.json({ message: 'Image rotated' });
        logFromRequest(req, logLevels.INFO, `Rotate: ${photoFilename} rotated ${angle} degrees`);

    } catch (error) {
        logFromRequest(req, logLevels.ERROR, `Image rotation failed for item ${id}: ${error.message}`);
        res.status(500).json({ error: 'Rotation failed' });
    }
});

//--------------------------------------------------------------------------
// GET /auctions/:auctionId/slideshow-items
// API to fetch items with photos only. Used for slideshow display
// return only items that have an associated photo
// Uses :publicId not :auctionId - conversion handled in checkAuctionState
//--------------------------------------------------------------------------

app.get('/auctions/:publicId/slideshow-items', authenticateRole("slideshow"), checkAuctionState(['setup', 'locked', 'live','settlement','archive']), (req, res) => {
    const auction_id = Number(req.auction.id);


    try {
        const rows = db.all(
            `SELECT id,
                description,
                contributor,
                artist,
                photo,
                mod_date
           FROM items
          WHERE photo IS NOT NULL
            AND photo <> ''
            AND auction_id = ?`,
            [Number(auction_id)]          // one array of bind values
        );

        res.json(rows);                 // rows are ready immediately
    } catch (err) {
        logFromRequest(req, logLevels.ERROR, "Error fetching list: " + err.message);
        res.status(500).json({ error: err.message });
    }
});

//--------------------------------------------------------------------------
// POST /validate-auction
// API to check whether the publically entered auction short name exists and is active
// This is a public endpoint and does not expose auction IDs
// It also accepts an auth token to allow bypass of the state check - This is needed for the slideshow
//--------------------------------------------------------------------------

app.post("/validate-auction", async (req, res) => {
    const { short_name } = req.body;
    const auth = req.header(`Authorization`);
    if (!short_name || typeof short_name !== 'string'|| short_name.trim() === ''|| short_name.length > 64) {
        logFromRequest(req, logLevels.ERROR, `No or bad auction name received`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return res.status(400).json({ valid: false, error: "Invalid auction name" });
    }
    const sanitised_short_name = sanitiseText(short_name, 64);
    logFromRequest(req, logLevels.DEBUG, `Auction name received: ${short_name}`);

    let is_admin = false;
    if (auth) {
        try {
            jwt.verify(auth, SECRET_KEY);
            is_admin = true;
            logFromRequest(req, logLevels.DEBUG, `Validate admin bypass accepted`);
        } catch (err) {
            return res.status(403).json({ error: "Not authorised" });
        }
    }

    try {

        const row = db.get('SELECT id, short_name, full_name, status, logo, public_id FROM auctions WHERE short_name = ?', [sanitised_short_name.toLowerCase()]);
        if (!row) {
            logFromRequest(req, logLevels.WARN, `Auction name "${short_name}" not in database`);
            //delay response to hinder brute-force attempts
            await new Promise(resolve => setTimeout(resolve, 2000));
            return res.status(400).json({ valid: false, error: "Auction name not found" });
        }
        // admin override to support slideshow function
        if (row.status !== `setup` && !is_admin) {
            logFromRequest(req, logLevels.WARN, `Auction "${short_name}" not active (status: ${row.status})`);
            return res.status(400).json({ valid: false, error: "This auction is not currently accepting submissions" });
        }

        if (!is_admin) logFromRequest(req, logLevels.INFO, `Auction "${short_name}" exists and accepting submissions`);
        if (is_admin) logFromRequest(req, logLevels.INFO, `Auction "${short_name}" exists - state check ignored as valid auth supplied`);

        res.json({ valid: true, short_name: row.short_name, full_name: row.full_name, logo: row.logo, public_id: row.public_id });
    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Auction validation error: ${err}`);
        res.status(500).json({ valid: false, error: "Validation error" });
    }
});


// -----------------------------------------------------------------------------
// POST /list-auctions
// Optional body parameter:  { status : "live" | "settlement" | ... }
// – If `status` is omitted, returm all
// – If `status` is supplied, only auctions with that status are returned.
// -----------------------------------------------------------------------------
app.post("/list-auctions", authenticateRole(["maintenance", "admin", "cashier"]), async (req, res) => {
    //    logFromRequest(req, logLevels.DEBUG, "Auction list (admin) requested");

    const status = req.body?.status;             // undefined if not sent
    const allowedStatuses = ["setup", "locked", "live", "settlement", "archived"]; // update if needed

    if (status !== undefined && !allowedStatuses.includes(status)) {
        logFromRequest(req, logLevels.WARN,
            `Rejected list-auctions request with invalid status '${status}'`);
        return res.status(400).json({ error: "Invalid status parameter" });
    }

    let sql = "SELECT id, short_name, full_name, status, admin_can_change_state, public_id FROM auctions";
    const params = [];
    if (status !== undefined) {           // filter only when caller asked for it
        sql += " WHERE status = ?";
        params.push(status);
    }


    try {
        const stmt = db.prepare(sql);
        const auctions = stmt.all(params);

        res.json(auctions);

    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Failed to get auction list: ${err.message}`);
        return res.status(500).json({ error: "Failed to retrieve auctions" });

    }

});

//--------------------------------------------------------------------------
// POST /auctions/:auctionId/items/:id/move-after/:after_id
// API to move an item so it appears directly after another one (or to top if after_id null)
//--------------------------------------------------------------------------

app.post('/auctions/:auctionId/items/:id/move-after/:after_id', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), (req, res) => {
    const auctionId = Number(req.params.auctionId);
    const id = Number(req.params.id);
    const afterId = req.params.after_id ? Number(req.params.after_id) : null;

    if (!id || !auctionId)
        return res.status(400).json({ error: "Missing or invalid ids" });

    try {
        // 1. fetch current list (ordered)
        const rows = db.all(
            "SELECT id FROM items WHERE auction_id = ? ORDER BY item_number ASC",
            [auctionId]
        );
        if (!rows.length) return res.status(400).json({ error: "Auction empty" });

        const movingIdx = rows.findIndex(r => r.id === id);
        if (movingIdx === -1) return res.status(400).json({ error: "Item not found" });

        // 2. build new order
        const remaining = rows.filter(r => r.id !== id);
        const insertPos = afterId
            ? remaining.findIndex(r => r.id === afterId) + 1
            : 0;

        if (insertPos === 0 && afterId) return res.status(400).json({ error: "after_id not found" });

        const reordered = [
            ...remaining.slice(0, insertPos),
            { id },                              // moving item
            ...remaining.slice(insertPos)
        ];

        // 3. renumber in a single transaction
        const update = db.prepare("UPDATE items SET item_number = ? WHERE id = ?");
        const renumber = db.transaction(list => {
            list.forEach((item, idx) => update.run(idx + 1, item.id));
        });
        renumber(reordered);

        logFromRequest(
            req,
            logLevels.INFO,
            `Moved item ${id} to after ${afterId} in auction ${auctionId}`
        );
        res.json({ message: "Item moved and renumbered" });
    } catch (err) {
        res.status(500).json({ error: "Failed to update item numbers" });
    }
}
);



function renumberAuctionItems(auctionId, callback) {
    db.all(
        "SELECT id FROM items WHERE auction_id = ? ORDER BY item_number ASC",
        [auctionId],
        (err, rows) => {
            if (err) {
                log('Renumber', logLevels.ERROR, `Renumber: Failed to fetch items for auction ${auctionId}:` + err);

                return callback(err);
            }

            let updatesCompleted = 0;
            let errorOccurred = false;

            rows.forEach((row, index) => {
                const newNumber = index + 1;

                db.run(
                    "UPDATE items SET item_number = ? WHERE id = ?",
                    [newNumber, row.id],
                    function (updateErr) {
                        if (updateErr && !errorOccurred) {
                            errorOccurred = true;
                            log('Renumber', logLevels.ERROR, `Renumber: Failed to update item ${row.id}:` + updateErr);

                            return callback(updateErr);
                        }

                        updatesCompleted++;
                        if (updatesCompleted === rows.length && !errorOccurred) {
                            log('Renumber', logLevels.DEBUG, `Renumber: Completed for auction ${auctionId}`);
                            return callback(null, rows.length);
                        }
                    }
                );
            });

            // Handle empty auctions
            if (rows.length === 0) {
                return callback(null, 0);
            }
        }
    );
}

//--------------------------------------------------------------------------
// POST /auction-status
// API to get the status of an auction
//--------------------------------------------------------------------------

app.post('/auction-status', authenticateRole('admin'), (req, res) => {
    const id = Number(req.body.auction_id);
    const row = id
        ? db.get('SELECT status FROM auctions WHERE id = ?', [id])
        : db.get('SELECT status FROM auctions ORDER BY id DESC LIMIT 1');
    res.json({ status: row ? row.status : 'live' });
});


//--------------------------------------------------------------------------
// GET /audit-log
// API to view audit log with item details
// Used by admin for item history and maintenance for general audit
//--------------------------------------------------------------------------

app.get("/audit-log", authenticateRole(["admin", "maintenance"]), (req, res) => {
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


function awaitMiddleware(middleware) {
  return (req, res) =>
    new Promise((resolve, reject) => {
      middleware(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
}



//--------------------------------------------------------------------------
// POST /auctions/update-status
// API to update the status of an auction
// Usable by admin user provided that required flag has been set
//--------------------------------------------------------------------------


app.post("/auctions/update-status", authenticateRole(["admin", "maintenance"]), async (req, res) => {
    const { auction_id, status } = req.body;

    if (!auction_id || typeof status !== "string") {
        return res.status(400).json({ error: "Missing auction ID or invalid status." });
    }

    try {
        const auction = await db.get(`SELECT id, status, admin_can_change_state, short_name FROM auctions WHERE id = ?`, [auction_id]);

        // If admin, check auction settings
        const role = req.user?.role;
        if ((role === "admin" && auction.admin_can_change_state === 0)) {
            logFromRequest(req, logLevels.ERROR, `${role} is not allowed to change state of ${auction_id}`);

            return res.status(403).json({ error: 'State change not allowed. Check auction settings' });
        }

        const normalizedStatus = status.toLowerCase();

        // Check if the auction is already in the requested status - We seem to get duplicate requests
        if (auction.status === normalizedStatus) {
            return res.sendStatus(200).end();
        }

        if (!allowedStatuses.includes(normalizedStatus)) {
            return res.status(400).json({ error: `Invalid status: "${status}"` });
        }

        db.run("UPDATE auctions SET status = ? WHERE id = ?", [normalizedStatus, auction_id]);

        logFromRequest(req, logLevels.INFO, `Updated status for auction ${auction_id} ${auction.short_name} to: ${normalizedStatus}`);
        audit(role, 'state change', 'auction', auction_id, { auction: auction_id, name: auction.short_name, new_state: normalizedStatus });
        // clear the auction state cache
        //     checkAuctionState.auctionStateCache.del(auction_id);
        res.json({ message: `Auction ${auction_id} ${auction.short_name} status updated to ${normalizedStatus}` });

    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Status update for auction ${auction_id} failed:` + err);
        return res.status(500).json({ error: `Status update for auction ${auction_id} failed` });
    }


});

// Serve uploaded images
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static( UPLOAD_DIR ));
app.use('/resources', express.static(CONFIG_IMG_DIR));

// Mount maintenance features (role protected)
app.use('/maintenance', authenticateRole("maintenance"), (req, res, next) => {
    req.originalUrl = req.baseUrl + req.url; // Ensure proper route prefixing
    maintenanceRoutes(req, res, next);
});

// Start the server
const server = app.listen(PORT, () => {
    log('General', logLevels.INFO, 'Server startup complete and listening on port ' + PORT);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
      log('General', logLevels.ERROR, `❌ Port ${port} is already in use. Please stop the other process or use a different port.`);
      process.exit(1);
  } else {
    console.error('❌ Server error:', err);
    log('General', logLevels.ERROR, `❌ Server error:`+ err);

    process.exit(1);
  }
});

app.use((err, req, res, next) => {
    console.error("Unhandled error:", err.message || err);
    res.status(500).json({ error: "Server error" });
});
