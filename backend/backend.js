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
const app = express();
const fsp = require('fs').promises;
const db = require('./db');


// const VALID_ROLES = new Set(['admin', 'maintenance', 'cashier', 'slideshow']);
const allowedStatuses = ["setup", "locked", "live", "settlement", "archived"];

const {
    CONFIG_IMG_DIR,
    SAMPLE_DIR,
    UPLOAD_DIR,
    DB_PATH,
    BACKUP_DIR,
    MAX_UPLOADS,
    allowedExtensions,
    SECRET_KEY,
    PORT,
    LOG_LEVEL,
    MAX_ITEMS,
    PPTX_CONFIG_DIR,
    OUTPUT_DIR,
    CURRENCY_SYMBOL
} = require('./config');

const { authenticateRole } = require('./middleware/authenticateRole');

const maintenanceRoutes = require('./maintenance');
const { logLevels, setLogLevel, logFromRequest, createLogger, log } = require('./logger');
const checkAuctionState = require('./middleware/checkAuctionState')(
    db,
    { ttlSeconds: 2 }
);
const { api: paymentsApi, paymentProcessorVer } = require('./payments');


// collect up version info
const { version } = require('./package.json'); // get version from package.json
const backendVersion = version || 'Unknown';
const { schemaVersion } = require('./db'); // get schema version from db.js



log('General', logLevels.INFO, `Backend version: ${backendVersion}, DB schema version: ${schemaVersion}`);
log('General', logLevels.INFO, `Payment processor: ${paymentProcessorVer}`);

setLogLevel(LOG_LEVEL.toUpperCase());

//--------------------------------------------------------------------------
// CORS
// Needed if the frontend and backend are separated
//--------------------------------------------------------------------------

// Add CORS headers before the routes are defined
// app.use(function (req, res, next) {

//    res.setHeader('Access-Control-Allow-Origin', '*'); // Either this OR a specific origin list
//    res.setHeader('Access-Control-Allow-Origin', 'https://example.co.uk');
//     res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
//     res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
//     res.setHeader('Access-Control-Allow-Credentials', true);
//     next();
// });

// Define the CORS options
// const corsOptions = {
//     credentials: true,
//     origin: ['http://localhost:3000', 'http://localhost:80', 'https://example.co.uk', ] // Whitelist the domains you want to allow
// };

// Enable CORS
// app.use(cors(corsOptions)); // Use the cors middleware with your options


// Then generic parsers and other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));

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
// get /version
// API to get the backend and schema versions
//--------------------------------------------------------------------------

app.get('/version', (_req, res) => {
  res.json({
    backend: backendVersion,
    schema: schemaVersion,
  });
});

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
        res.json({ token });
        logFromRequest(req, logLevels.DEBUG, `Token validated successfully`);


    });
})

//--------------------------------------------------------------------------
// POST /login
// Login route. Checks pw and returns a jwt
// Also returns currency symbol (as this route is the entry point to all users)
//--------------------------------------------------------------------------

app.post('/login', (req, res) => {
    const { password, role } = req.body;
    if (!password || !role) {
        logFromRequest(req, logLevels.ERROR, `No password provided`);
        return res.status(400).json({ error: "Password required" });
    }

    db.get(`SELECT password FROM passwords WHERE role = ?`, [role], (err, row) => {

        if (err) return res.status(500).json({ error: err.message });
        if (!row || row.password !== password) {
            logFromRequest(req, logLevels.WARN, `Invalid password for role ${role} entered`);
            return res.status(401).json({ error: "Invalid password" });
        }
        const token = jwt.sign({ role }, SECRET_KEY, { expiresIn: "8h" });
        res.json({ token, currency: CURRENCY_SYMBOL });

        logFromRequest(req, logLevels.INFO, `User with role "${role}" logged in`);
        logFromRequest(req, logLevels.DEBUG, `full Token: ${token}....`);

    });
});

//--------------------------------------------------------------------------
// GET /slideshow-auth
// Allows admin to retrieve slideshow credentials
//--------------------------------------------------------------------------

app.get('/slideshow-auth', authenticateRole("admin"), (req, res) => {
    const role = 'slideshow';
    const token = jwt.sign({ role }, SECRET_KEY, { expiresIn: "8h" });
    res.json({ token });
});

// Get the next item number for a given auction ID
function getNextItemNumber(auction_id, callback) {
    db.get(`SELECT MAX(item_number) + 1 AS next FROM items WHERE auction_id = ?`, [auction_id], (err, row) => {
        if (err) return callback(err);
        const itemNumber = row?.next || 1;
        callback(null, itemNumber);
    });
}

//--------------------------------------------------------------------------
// POST /auctions/:auctionId/newitem
// API to handle item submission
//--------------------------------------------------------------------------

app.post('/auctions/:auctionId/newitem', checkAuctionState(['setup', 'locked']), async (req, res) => {
    //    logFromRequest(req, logLevels.DEBUG, `Request received`);
    try {

    await awaitMiddleware(upload.single('photo'))(req, res);


        // Check item count first
        db.get("SELECT COUNT(*) AS count FROM items", [], (err, row) => {
            if (err) return res.status(500).json({ error: "Database error." });

            if (row.count >= MAX_ITEMS) {
                logFromRequest(req, logLevels.WARN, `Item limit reached. Maximum allowed is ${MAX_ITEMS}.`);
                return res.status(400).json({ error: `Server item limit reached` });
            }

            let photoPath = req.file ? req.file.filename : null;
            const { description, contributor, artist, notes } = req.body;
            const auth = req.header(`Authorization`);
            const auction_id = Number(req.params.auctionId);

            logFromRequest(req, logLevels.DEBUG, `New item being added to auction id ${auction_id}`);

            if (!auction_id) {
                logFromRequest(req, logLevels.ERROR, `Missing auction ID`);
                return res.status(400).json({ error: "Missing auction ID" });

            } else if (!description || !contributor) {
                logFromRequest(req, logLevels.ERROR, `Missing item description or contributor`);
                return res.status(400).json({ error: "Missing item description or contributor" });
            }

            // See if we were called from the admin page - if so, they sent a token
            var is_admin = false;
            if (auth) {

                jwt.verify(auth, SECRET_KEY, (err, decoded) => {
                    if (!err) {
                        is_admin = true;
                        logFromRequest(req, logLevels.DEBUG, `Add req has provided admin credentials`);
                    }
                })
            }


            // Check that the auction is active
            db.get("SELECT status FROM auctions WHERE id = ?", [auction_id], async (err, row) => {
                if (err) {
                    logFromRequest(req, logLevels.ERROR, `Error checking auction status ${err.message}`);
                    return res.status(500).json({ error: "Database error" });
                }

                if (!row) {
                    return res.status(404).json({ error: "Auction not found" });
                }

                // checkAuctionState() has already checked for scenarios which shouldn't happen, so the test here is simpler
                if (row.status === "locked" && is_admin === false) {

                    logFromRequest(req, logLevels.WARN, `Public submission rejected. Auction ${auction_id} is locked`);
                    return res.status(403).json({ error: "This auction is not currently accepting submissions." });
                }



                if (photoPath) {
                    // const resizedPath = `./uploads/resized_${photoPath}`;
                    // const previewPath = `./uploads/preview_resized_${photoPath}`;

                    const resizedPath = path.join(UPLOAD_DIR, `resized_${photoPath}`);
                    const previewPath = path.join(UPLOAD_DIR, `preview_resized_${photoPath}`);

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

                }


                // get the next item number
                getNextItemNumber(auction_id, (err, itemNumber) => {
                    if (err) {
                        return res.status(500).json({ error: "Database error" });
                    }

                    db.run(`INSERT INTO items (item_number, description, contributor, artist, notes, photo, auction_id, date) VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%d-%m-%Y %H:%M', 'now'))`,
                        [itemNumber, description, contributor, artist, notes, photoPath, auction_id],
                        function (err) {
                            if (err) {
                                logFromRequest(req, logLevels.ERROR, `Database error ${err.message}`);
                                return res.status(500).json({ error: err.message });

                            }
                            res.json({ id: this.lastID, description, contributor, artist, photo: photoPath });
                            logFromRequest(req, logLevels.INFO, `Item ${this.lastID} stored for auction ${auction_id} as item #${itemNumber}`);
                            const user = is_admin ? "admin" : "public";
                            audit(user, 'new item', 'item', this.lastID, { description: description, initial_number: itemNumber });

                        }
                    );
                })
            });
        })

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
    const target_auction_id = req.body.target_auction_id;

    logFromRequest(req, logLevels.DEBUG, `Request received to update item ${id}`);

try {
    
  await awaitMiddleware(upload.single('photo'))(req, res);

    db.get('SELECT photo, auction_id FROM items WHERE id = ?', [id], async (err, row) => {
        if (err) {
            logFromRequest(req, logLevels.ERROR, `Update: Error ${err.message}`);
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            logFromRequest(req, logLevels.ERROR, `Update: Item not found`);
            return res.status(404).json({ error: 'Item not found' });
        }

        let photoPath = row.photo;

        // Process new photo
        if (req.file) {
            let targetFilename = row.photo?.startsWith("resized_") ? row.photo : `resized_${uuidv4()}.jpg`;

            // const resizedPath = `./uploads/${targetFilename}`;
            // const previewPath = `./uploads/preview_${targetFilename}`;

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

        const fields = ["description", "contributor", "artist", "notes"];
        fields.forEach(field => {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                params.push(req.body[field]);
            }
        });

        // Always update photo if processed
        if (req.file) {
            updates.push("photo = ?");
            params.push(photoPath);
        }

        // Always update mod_date
        updates.push("mod_date = strftime('%d-%m-%Y %H:%M', 'now')");

        const oldAuctionId = row.auction_id;
        const newAuctionId = parseInt(target_auction_id);

        if (!isNaN(newAuctionId) && newAuctionId !== oldAuctionId) {
            logFromRequest(req, logLevels.DEBUG, `Moving ${id} from auction ${oldAuctionId} to auction ${newAuctionId}`);
            db.get("SELECT MAX(item_number) + 1 AS next FROM items WHERE auction_id = ?", [newAuctionId], (err2, result) => {
                if (err2) {
                    logFromRequest(req, logLevels.ERROR, `Update: Error getting next item number → ${err2.message}`);
                    return res.status(500).json({ error: err2.message });
                }

                const newNumber = result?.next || 1;
                updates.push("auction_id = ?");
                updates.push("item_number = ?");
                params.push(newAuctionId, newNumber);
                const sql = `UPDATE items SET ${updates.join(", ")} WHERE id = ?`;
                params.push(id);

                logFromRequest(req, logLevels.DEBUG, `Updating fields for item ${id}: ${updates.map(u => u.split(" = ")[0]).join(", ")}`);

                db.run(sql, params, function (err3) {
                    if (err3) {
                        logFromRequest(req, logLevels.ERROR, `Database error: ` + err3.message);
                        return res.status(500).json({ error: err3.message });
                    }

                    logFromRequest(req, logLevels.INFO, `Moved ${id} from auction ${oldAuctionId} to ${newAuctionId}`);

                    renumberAuctionItems(oldAuctionId, (err4, count) => {
                        if (err4) {
                            logFromRequest(req, logLevels.ERROR, `Renumber failed for old auction ${oldAuctionId}: ${err4.message}`);
                            return res.status(500).json({ error: err4.message });
                        }
                        logFromRequest(req, logLevels.DEBUG, `Renumbered ${count} items in old auction ${oldAuctionId}`);
                    });
                    audit(req.user.role, 'moved auction', 'item', id, { old_auction: oldAuctionId, new_auction: newAuctionId, new_no: newNumber });

                    res.json({ message: 'Item moved and updated', item_number: newNumber, photo: photoPath });
                });
            });
        } else {
            // No auction move
            const sql = `UPDATE items SET ${updates.join(", ")} WHERE id = ?`;
            params.push(id);
            logFromRequest(req, logLevels.INFO, `Updating fields for item ${id}: ${updates.map(u => u.split(" = ")[0]).join(", ")}`);

            db.run(sql, params, function (err5) {
                if (err5) {
                    logFromRequest(req, logLevels.ERROR, `Update failed: ${err5.message}`);
                    return res.status(500).json({ error: err5.message });
                }
                res.json({ message: 'Item updated', photo: photoPath });
                logFromRequest(req, logLevels.INFO, `Update item completed for ${id}`);
                audit(req.user.role, 'updated', 'item', id, {});

            });
        }
    });
}
catch {
        logFromRequest(req, logLevels.ERROR, "Error editing: " + err.message);
        res.status(500).json({ error: err.message });
}

});

//--------------------------------------------------------------------------
// DELETE /items/:id
// API to delete an item, including photos
//--------------------------------------------------------------------------

app.delete('/items/:id', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), (req, res) => {
    const { id } = req.params;

    logFromRequest(req, logLevels.DEBUG, `Delete: Request Recieved for ${id}`);

    db.get('SELECT photo, auction_id FROM items WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Item not found' });
        }

        if (row.photo) {
      //      const photoPath = `./uploads/${row.photo}`;
            const photoPath = path.join(UPLOAD_DIR, row.photo);
            if (fs.existsSync(photoPath)) {
                fs.unlinkSync(photoPath);
            }

     //       const oldPreviewPath = `./uploads/preview_${row.photo}`;
            const oldPreviewPath = path.join(UPLOAD_DIR, `preview_${row.photo}`);
            if (fs.existsSync(oldPreviewPath)) {
                fs.unlinkSync(oldPreviewPath);
            }
        }

        db.run('DELETE FROM items WHERE id = ?', [id], function (err) {
            if (err) {
                logFromRequest(req, logLevels.ERROR, `Delete: error ${err.message}`);
                return res.status(500).json({ error: err.message });
            }

            logFromRequest(req, logLevels.INFO, `Deleted item ${id}`);

            renumberAuctionItems(row.auction_id, (err, count) => {
                if (err) {
                    logFromRequest(req, logLevels.ERROR, `Failed to renumber items after delete:` + err.message);

                } else {
                    logFromRequest(req, logLevels.INFO, `Renumbered ${count} items in auction ${row.auction_id} after deletion`);
                }
            });

            res.json({ message: 'Item deleted' });
        });
    });
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

        const rows = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM items WHERE auction_id = ? ORDER BY item_number ASC', [auction_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

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

        const rows = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM items WHERE auction_id = ? ORDER BY item_number ASC', [auction_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

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
    db.all(`
        
        SELECT 
         i.*,
        b.paddle_number
        FROM items i
        LEFT JOIN bidders b ON b.id = i.winning_bidder_id
        WHERE i.auction_id = ?
        ORDER BY i.item_number ASC;`
        , [auction_id], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

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
});

//--------------------------------------------------------------------------
// POST /rotate-photo
// API to rotate a photo
//--------------------------------------------------------------------------


app.post('/rotate-photo', authenticateRole("admin"), async (req, res) => {
    const { id, direction } = req.body;
    logFromRequest(req, logLevels.DEBUG, `Rotate Request for item ${id} (${direction})`);

    db.get('SELECT photo FROM items WHERE id = ?', [id], async (err, row) => {
        if (err || !row) {
            return res.status(500).json({ error: 'Photo not found' });
        }

        const photoFilename = row.photo;
     //   const photoPath = `./uploads/${photoFilename}`;
        const photoPath = path.join(UPLOAD_DIR, photoFilename);
     //   const previewPath = `./uploads/preview_${photoFilename}`;
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
            db.run(`UPDATE items SET mod_date = strftime('%d-%m-%Y %H:%M', 'now') WHERE id = ?`, [id], function (err) {
                if (err) {
                    logFromRequest(req, logLevels.ERROR, `Rotate: Failed to update mod_date:` + err.message);

                    return res.status(500).json({ error: "Rotation succeeded but failed to update modification time." });
                }

                res.json({ message: 'Image rotated' });
                logFromRequest(req, logLevels.INFO, `Rotate: ${photoFilename} rotated ${angle} degrees`);
            });

        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Image rotation failed for item ${id}: ${error.message}`);
            res.status(500).json({ error: 'Rotation failed' });
        }
    });
});

//--------------------------------------------------------------------------
// GET /auctions/:auctionId/slideshow-items
// API to fetch items with photos only. Used for slideshow display
// return only items that have an associated photo
//--------------------------------------------------------------------------

app.get('/auctions/:auctionId/slideshow-items', authenticateRole("slideshow"), (req, res) => {
    const auction_id = Number(req.params.auctionId);

    if (!auction_id || isNaN(Number(auction_id))) {
        logFromRequest(req, logLevels.ERROR, "Missing or invalid auction ID");
        return res.status(400).json({ error: "Missing or invalid auction_id" });
    }

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
// GET /config/pptx
// API to get current pptx config
//--------------------------------------------------------------------------

app.get('/config/pptx', authenticateRole("maintenance"), (req, res) => {
    logFromRequest(req, logLevels.DEBUG, `Current PPTX config requested`);
    fs.readFile('./pptxConfig.json', 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Unable to read config' });
        res.type('application/json').send(data);
    });
});

//--------------------------------------------------------------------------
// POST /config/pptx
// API to save pptx config
//--------------------------------------------------------------------------

app.post('/config/pptx', authenticateRole("maintenance"), (req, res) => {
    try {
        const newConfig = JSON.stringify(req.body, null, 2); // Pretty print
        fs.writeFile('./pptxConfig.json', newConfig, 'utf8', err => {
            if (err) {
                logFromRequest(req, logLevels.ERROR, `PPTX config save failed` + err);
                return res.status(500).json({ error: 'Unable to save config' });
            }
            res.json({ message: 'Configuration updated successfully' });
            logFromRequest(req, logLevels.INFO, `PPTX config updated`);
        });
    } catch (err) {
        res.status(400).json({ error: 'Invalid JSON' });
        logFromRequest(req, logLevels.ERROR, `Invalid JSON in file` + err);

    }
});

//--------------------------------------------------------------------------
// POST /validate-auction
// API to check whether the publically entered auction id exists and is active
//--------------------------------------------------------------------------

app.post("/validate-auction", async (req, res) => {
    const { short_name } = req.body;
    logFromRequest(req, logLevels.DEBUG, `Auction name received: ${short_name}`);


    if (!short_name) {
        logFromRequest(req, logLevels.ERROR, `No auction name received`);
        return res.status(400).json({ valid: false, error: "Auction name required" });
    }

    try {

        db.get('SELECT id, short_name, full_name, status, logo FROM auctions WHERE short_name = ?', [short_name.toLowerCase()], async (err, row) => {
            if (err) {
                logFromRequest(req, logLevels.ERROR, `Error ${err}`);

                return res.status(500).json({ error: err.message });
            }
            if (!row) {
                logFromRequest(req, logLevels.WARN, `Auction name "${short_name}" not in database`);
                return res.status(403).json({ error: "Auction name not found" });
            }

            res.json({ valid: true, id: row.id, short_name: row.short_name, full_name: row.full_name, status: row.status, logo: row.logo });
        }
        )
    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Auction validation error: ${err}`);
        res.status(500).json({ valid: false, error: "Internal error" });
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

    let sql = "SELECT id, short_name, full_name, status, admin_can_change_state FROM auctions";
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
        if (!rows.length) return res.status(404).json({ error: "Auction empty" });

        const movingIdx = rows.findIndex(r => r.id === id);
        if (movingIdx === -1) return res.status(404).json({ error: "Item not found" });

        // 2. build new order
        const remaining = rows.filter(r => r.id !== id);
        const insertPos = afterId
            ? remaining.findIndex(r => r.id === afterId) + 1
            : 0;

        if (insertPos === 0 && afterId) return res.status(404).json({ error: "after_id not found" });

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
// GET /items/:id/history
// API to get the audit logs. Accpets an optional item ID
//--------------------------------------------------------------------------

app.get("/items/:id/history", authenticateRole(["admin", "maintenance"]), (req, res) => {
    const itemId = parseInt(req.params.id, 10);

    try {
        const stmt = db.prepare(`
            SELECT created_at, action, user, details
            FROM audit_log
            WHERE object_id = ?
            ORDER BY created_at DESC
        `);
        const rows = stmt.all(itemId);
        res.json(rows);
    } catch (err) {
        console.error("Audit fetch error:", err);
        res.status(500).json({ error: "Failed to fetch audit history" });
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
// API to record audit events
//--------------------------------------------------------------------------
function audit(user, action, type, id, details = {}) {
    db.run(
        `INSERT INTO audit_log (user, action, object_type, object_id, details)
       VALUES (?,?,?,?,?)`,
        [user, action, type, id, JSON.stringify(details)]
    );
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
        const auction = await db.get(`SELECT id, admin_can_change_state FROM auctions WHERE id = ?`, [auction_id]);

        // If admin, check auction settings
        const role = req.user?.role;
        if ((role === "admin" && auction.admin_can_change_state === 0)) {
            logFromRequest(req, logLevels.ERROR, `${role} is not allowed to change state of ${auction_id}`);

            return res.status(403).json({ error: 'State change not allowed. Check auction settings' });
        }

        const normalizedStatus = status.toLowerCase();

        if (!allowedStatuses.includes(normalizedStatus)) {
            return res.status(400).json({ error: `Invalid status: "${status}"` });
        }

        db.run("UPDATE auctions SET status = ? WHERE id = ?", [normalizedStatus, auction_id], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            logFromRequest(req, logLevels.INFO, `Updated status for auction ${auction_id} to: ${normalizedStatus}`);
// TODO fix auction state change audit entry
            audit(role, 'state change', 'auction', "0", { auction: auction_id, new_state: normalizedStatus });
            // clear the auction state cache
            checkAuctionState.auctionStateCache.del(auction_id);
            res.json({ message: `Auction ${auction_id} status updated to ${normalizedStatus}` });
        });

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

