// -----------------------------
// Phase 1 Implementation Patch – v1.1
// -----------------------------
// Adds in finalise and payment functions
//
// Usage (in backend.js **AFTER** the authenticateRole function is declared):
//   require('./phase1-patch')(app, authenticateRole);
// ---------------------------------------------------------------------------

const express = require('express');
const db       = require('./db');
// const {
//   logLevels,
//   log
// } = require('./logger');

const checkAuctionState = require('./middleware/checkAuctionState')(
    db, { ttlSeconds: 2 }   // optional – default is 5
 );


const { CONFIG_IMG_DIR, SAMPLE_DIR, UPLOAD_DIR, DB_PATH, BACKUP_DIR, MAX_UPLOADS, allowedExtensions, MAX_AUCTIONS, LOG_LEVEL } = require('./config');

const {
    logLevels,
    setLogLevel,
    logFromRequest,
    createLogger,
    log
  } = require('./logger');

setLogLevel(logLevels.DEBUG);

const validLogLevels = ["DEBUG", "INFO", "WARN", "ERROR"];
const normalizedLevel = LOG_LEVEL.toUpperCase();
if (validLogLevels.includes(normalizedLevel)) {
    setLogLevel(normalizedLevel);
    log('Logger', logLevels.INFO, `Log level set to ${normalizedLevel}`);

} else {
    log('Logger', logLevels.WARN, `Invalid LOG_LEVEL ${LOG_LEVEL} in config. Defaulting to INFO.`);
    setLogLevel("INFO");
}

module.exports = function phase1Patch (app, authenticateRole) {
  if (typeof authenticateRole !== 'function') {
    throw new TypeError('phase1-patch: authenticateRole function must be passed in');
  }

  //--------------------------------------------------------------------------
  // Schema updates
  //--------------------------------------------------------------------------
  try { db.run("ALTER TABLE auctions ADD COLUMN status TEXT DEFAULT 'setup'"); } catch (_) {}
  try { db.run("ALTER TABLE items ADD COLUMN winning_bidder_id INTEGER"); }  catch (_) {}
  try { db.run("ALTER TABLE items ADD COLUMN hammer_price REAL"); }        catch (_) {}

  try { db.run(`CREATE TABLE IF NOT EXISTS bidders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    paddle_number INTEGER NOT NULL,
    name          TEXT,
    created_at    TEXT DEFAULT (strftime('%Y-%m-%d %H:%M', 'now'))
  )`); } catch (_) {}

    // Isolate bidders between auctions
    // add auction_id column if missing
try { db.run("ALTER TABLE bidders ADD COLUMN auction_id INTEGER"); } catch (_) {}

 try {  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bidder_id   INTEGER NOT NULL,
    amount      REAL    NOT NULL,
    method      TEXT    NOT NULL DEFAULT 'cash',
    note        TEXT,
    created_by  TEXT,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%d %H:%M', 'now')),
    FOREIGN KEY (bidder_id) REFERENCES bidders(id)
  )`); } catch (_) {}

 try {  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user        TEXT,
    action      TEXT,
    object_type TEXT,
    object_id   INTEGER,
    details     TEXT,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
  )`); } catch (_) {}

// re-create uniqueness on (auction_id, paddle_number)
db.run("DROP INDEX IF EXISTS idx_bidders_paddle");
db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_bidder_auction_paddle ON bidders(auction_id, paddle_number)");


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

  //--------------------------------------------------------------------------
  // Live Feed (Read only)
  //--------------------------------------------------------------------------
  const liveFeed = express.Router();

   liveFeed.get('/live/:auctionId', authenticateRole(["admin", "cashier"]), (req, res) => {
   const id   = Number(req.params.auctionId);
 const include_unsold  = req.query.unsold === 'true';

  // liveFeed.post('/live', authenticateRole(["admin", "cashier"]), (req, res) => {
  //   const { auction_id: id, include_unsold } = req.body || {};
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'auction_id required' });
    }
  
    // sold lots
    const sold = db.all(`
      SELECT i.item_number AS lot,
             i.description,
             b.paddle_number AS bidder,
             i.hammer_price  AS price,
             i.ROWID         AS rowid,
             i.test_item,
             i.test_bid
        FROM items i
        LEFT JOIN bidders b ON b.id = i.winning_bidder_id
       WHERE i.auction_id = ? AND i.hammer_price IS NOT NULL
       ORDER BY b.paddle_number DESC, i.item_number DESC`, [id]);
  
    // optionally unsold
    const unsold = include_unsold
      ? db.all(`
          SELECT i.item_number AS lot,
                 i.description,
                 NULL            AS paddle,
                 NULL            AS price,
                 i.ROWID         AS rowid,
                 1               AS unsold
            FROM items i
           WHERE i.auction_id = ? AND i.hammer_price IS NULL
           ORDER BY i.item_number`, [id])
      : [];
  
    res.json([...sold, ...unsold]);          // sold first, unsold after
  });
  

  //--------------------------------------------------------------------------
  // Settlement (bidder summary + payments)
  //--------------------------------------------------------------------------
  const settlement = express.Router();

  settlement.get('/bidders', authenticateRole('cashier'), (req, res) => {

    const id = Number(req.query.auction_id);

    // guard clause: must be a positive integer
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'auction_id query param required' });
    }
    
    const rows = db.all(`
      SELECT b.id, b.paddle_number, b.name,
             SUM(CASE WHEN i.hammer_price IS NULL THEN 0 ELSE i.hammer_price END) AS lots_total,
             IFNULL((SELECT SUM(amount) FROM payments p WHERE p.bidder_id = b.id),0) AS payments_total
        FROM bidders b
   LEFT JOIN items i ON i.winning_bidder_id = b.id
   WHERE i.auction_id = ?
    GROUP BY b.id
      ORDER BY b.paddle_number
    `,[id]);
    rows.forEach(r => {
      r.balance = (r.lots_total || 0) - (r.payments_total || 0);
    });
    res.json(rows);
  });


  // record a payment

 settlement.post('/payment/:auctionId', authenticateRole('cashier'), checkAuctionState(['settlement']), (req, res) => {
 const auction_id   = Number(req.params.auctionId);
const {bidder_id, amount, method = 'cash', note = '' } = req.body;


  // settlement.post('/payment', authenticateRole('cashier'), (req, res) => {
  //   const { auction_id, bidder_id, amount, method = 'cash', note = '' } = req.body;
    if (!bidder_id || !amount) return res.status(400).json({ error: 'Missing params' });

    db.run(`INSERT INTO payments (bidder_id, amount, method, note, created_by)
            VALUES (?,?,?,?,?)`,
      [bidder_id, amount, method, note, req.user.role]
    );
    audit(req.user.role, 'payment', 'bidder', bidder_id, { amount, method });
    logFromRequest(req, logLevels.INFO, `${method} payment by bidder ${bidder_id} for ${amount} recorded`);

  /* 2️⃣  recompute balance */
  const sums = db.get(
    `SELECT
         (SELECT SUM(hammer_price)
            FROM items
           WHERE winning_bidder_id = ?) AS lots_total,
         (SELECT SUM(amount)
            FROM payments
           WHERE bidder_id = ?)        AS paid_total`,
    [bidder_id, bidder_id]
  );

  const balance = (sums.lots_total || 0) - (sums.paid_total || 0);

  /* 3️⃣  if fully paid, audit every lot => “item paid” */

    const items = db.all(
      `SELECT i.id, b.paddle_number 
        FROM items i
        LEFT JOIN bidders b ON b.id = i.winning_bidder_id
        WHERE winning_bidder_id = ?
      `,
      [bidder_id]
    );
   if (balance <= 0) {
     items.forEach(it => {
       audit(req.user.role, 'paid in full', 'item', it.id, { bidder: it.paddle_number });
     })
   }
   else if (balance > 0) {
     items.forEach(it => {
       audit(req.user.role, 'part paid', 'item', it.id, { bidder: it.paddle_number });
     })
   }
 res.json({ ok: true, balance });
    });
  
 



  // DELETE /api/settlement/payment/:id  → remove a mistaken payment
  // auctionId provided in the request body to feed checkAuctionState
settlement.delete('/payment/:pay_id', authenticateRole('cashier'), checkAuctionState(['settlement']), (req, res) => {
  const payId = Number(req.params.pay_id);
  if (!payId) return res.status(400).json({ error: 'Bad id' });

  // look up the row for audit purposes
  const row = db.get(`SELECT bidder_id, amount, method FROM payments WHERE id = ?`, [payId]);
  if (!row) return res.status(404).json({ error: 'Payment not found' });

  // simple delete (Phase 1 lets cashiers fix typos)
  db.run(`DELETE FROM payments WHERE id = ?`, [payId]);

  // audit entry
  audit(req.user.role, 'delete_payment', 'bidder', row.bidder_id, {
    deleted_payment_id: payId,
    amount: row.amount,
    method: row.method
  });
      logFromRequest(req, logLevels.INFO, `Payment by bidder ${row.bidder_id} removed for item ${payId}`);


  res.json({ ok: true });
});


  settlement.get('/export.csv', authenticateRole('cashier'), (req, res) => {
    const auctionId = Number(req.query.auction_id);
    if (!auctionId) return res.status(400).json({ error:'auction_id required' });
    const rows = db.all(`
      SELECT b.paddle_number, IFNULL(b.name,'') AS name,             
             GROUP_CONCAT(i.item_number || ':' || i.description, '|')  AS lots_won,
             SUM(i.hammer_price) AS lots_total,
             IFNULL((SELECT SUM(amount) FROM payments p WHERE p.bidder_id = b.id),0) AS payments_total
        FROM bidders b
   LEFT JOIN items i ON i.winning_bidder_id = b.id
   WHERE b.auction_id = ?
    GROUP BY b.id`,[auctionId]);

    const header = 'paddle_number,name,lots_won,lots_total,payments_total,balance_due\n';
    const csv = header + rows.map(r => {
      const balance = (r.lots_total || 0) - (r.payments_total || 0);
      return [r.paddle_number, r.name, r.lots_won || '', r.lots_total || 0, r.payments_total || 0, balance].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="settlement_auction_${auctionId}.csv"`);

    res.end('\uFEFF' + csv);
  });

  //--------------------------------------------------------------------------
  // Finalize Lot + Undo endpoints (admin)
  //--------------------------------------------------------------------------
  const sales = express.Router();

  sales.post('/:id/finalize', authenticateRole('admin'), checkAuctionState(['live', 'settlement']), (req, res) => {
    const itemId = Number(req.params.id);
    const { paddle, price, auctionId } = req.body;
    if (!paddle || !price || !auctionId) return res.status(400).json({ error: 'Missing paddle or price or auction id' });

    let bidder = db.get('SELECT id FROM bidders WHERE paddle_number = ? AND auction_id = ?', [paddle, auctionId]);
    if (!bidder) {
      const info = db.run('INSERT INTO bidders (paddle_number, auction_id) VALUES (?, ?)', [paddle, auctionId]);
      
      bidder = { id: info.lastInsertRowid };
    }

    db.run(`UPDATE items SET winning_bidder_id = ?, hammer_price = ? WHERE id = ?`, [bidder.id, price, itemId]);
    audit(req.user.role, 'finalize', 'item', itemId, { bidder: paddle, price });
    logFromRequest(req, logLevels.INFO, `Bid recorded for auction ${auctionId}, bidder ${paddle}, item ${itemId}, price ${price}`);

  /* -----------------------------------------------------------
     Auto-transition: are there still unsold lots?
  ----------------------------------------------------------- */
  const remaining = db.get(
    `SELECT COUNT(*) AS cnt
       FROM items
      WHERE auction_id = ?
        AND hammer_price IS NULL`,
    [auctionId]
  ).cnt;

  if (remaining === 0) {
    // flip to settlement
    db.run(`UPDATE auctions SET status = 'settlement' WHERE id = ?`, [auctionId]);

    // clear the auction state cache
    checkAuctionState.auctionStateCache.del(auctionId);

    // audit entry for traceability
    audit(req.user.role, 'auto_settlement', 'auction', auctionId, {
      reason: 'all lots sold via finalize endpoint'
    });
    logFromRequest(req, logLevels.INFO, `All lots sold in auction ${auctionId}, setting state to settlement`);

  }

 //   res.json({ ok: true, bidder_id: bidder.id });
 
  res.json({
    ok: true,
    bidder_id: bidder.id,
    auction_status: remaining === 0 ? 'settlement' : 'live'
  });


  });

  sales.post('/:id/undo', authenticateRole('admin'), (req, res) => {
    const itemId = Number(req.params.id);
    const row = db.get(`SELECT winning_bidder_id FROM items WHERE id = ?`, [itemId]);
    if (!row) return res.status(404).json({ error: 'Item not found' });

    const paid = db.get(`SELECT 1 FROM payments WHERE bidder_id = ? LIMIT 1`, [row.winning_bidder_id]);
    if (paid) {
       logFromRequest(req, logLevels.WARN, `Bid retract failed for item ${itemId} by bidder ${row.winning_bidder_id} - Payment exists`);
      return res.status(409).json({ error: 'Cannot undo – payments exist' });
    }
    db.run(`UPDATE items SET winning_bidder_id = NULL, hammer_price = NULL WHERE id = ?`, [itemId]);
    audit(req.user.role, 'undo-bid', 'item', itemId);

    logFromRequest(req, logLevels.INFO, `Bid retracted for item ${itemId} by bidder ${row.winning_bidder_id}`);

    res.json({ ok: true });
  });

  // GET /api/settlement/bidders/:id  -> full detail
settlement.get('/bidders/:id', authenticateRole('cashier'), (req, res) => {
  const id = Number(req.params.id);
  const auctionId = Number(req.query.auction_id);           // NEW

if (!auctionId || !id) return res.status(400).json({ error: 'item # and auction_id required' });

// this shouldn't be needed, but since were taking payment, lets be certain....
  const bidder = db.get(`
    SELECT * FROM bidders WHERE id = ? AND auction_id = ?`,
    [id, auctionId] );
   if (!bidder) return res.status(404).json({ error: 'Bidder not found for this auction' });

  const lots = db.all(`
      SELECT item_number, description, hammer_price, test_item, test_bid
        FROM items
       WHERE winning_bidder_id = ? AND auction_id = ?
       ORDER BY item_number`, [id, auctionId]);

  const payments = db.all(`
      SELECT id, amount, method, note, created_at
        FROM payments
       WHERE bidder_id = ?
       ORDER BY id`, [id]);

  const summary = db.get(`
      SELECT b.id, b.paddle_number,
             SUM(i.hammer_price)               AS lots_total,
             IFNULL((SELECT SUM(amount) FROM payments p WHERE p.bidder_id = b.id),0) AS payments_total
        FROM bidders b
   LEFT JOIN items i ON i.winning_bidder_id = b.id
       WHERE b.id = ? AND i.auction_id =?
    GROUP BY b.id`, [id, auctionId]);

   // console.log(summary.lots_total)

  const balance = (summary.lots_total || 0) - (summary.payments_total || 0);

  res.json({ ...summary, lots, payments, balance });
});

// GET /api/settlement/summary?auction_id=17
settlement.get('/summary', authenticateRole('cashier'), (req, res) => {
  const aid = Number(req.query.auction_id);
  if (!aid) return res.status(400).json({ error: 'auction_id required' });

  // 1. Total hammer price
  const { total } = db.get(
    `SELECT SUM(hammer_price) AS total FROM items WHERE auction_id = ?`,
    [aid]
  ) || { total: 0 };

  // 2. Payments grouped by method
  const rows = db.all(`
      SELECT method, SUM(amount) AS amt
        FROM payments p
        JOIN bidders b ON b.id = p.bidder_id
       WHERE b.auction_id = ?
       GROUP BY method`, [aid]);

  const breakdown = rows.reduce((m,r)=>(m[r.method]=r.amt, m), {cash:0,card:0,paypal:0,sumup:0});
  const paidTotal = Object.values(breakdown).reduce((a,b)=>a+b,0);

  res.json({
    auction_id: aid,
    lots_total: total || 0,
    payments_total: paidTotal,
    breakdown,
    balance: (total || 0) - paidTotal
  });
});



  //--------------------------------------------------------------------------
  // 6.  Mount routers under /api
  //--------------------------------------------------------------------------
  app.use('/cashier', liveFeed);
  app.use('/settlement', settlement);
  app.use('/lots', sales);

  log('Phase1', logLevels.INFO, 'Phase 1 patch v1.1 loaded (routes & schema ready)');
};
