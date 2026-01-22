/**
 * @file        phase1-patch.js
 * @description Phase 1 upgrade patch. Adds in bid recording functions and payment functions for manual payments.
 * @author      Chris Staples
 * @license     GPL3
 */

// Usage (in backend.js **AFTER** the authenticateRole function is declared):
//   require('./phase1-patch')(app, authenticateRole);

const express = require('express');
const db       = require('./db');
const checkAuctionState = require('./middleware/checkAuctionState')(
    db, { ttlSeconds: 2 }   
 );
const { authenticateRole } = require('./middleware/authenticateRole');
const { CASH_ENABLED, MANUAL_CARD_ENABLED, PAYPAL_ENABLED, SUMUP_WEB_ENABLED, SUMUP_CARD_PRESENT_ENABLED, CURRENCY, SUMUP_CALLBACK_SUCCESS, SUMUP_RETURN_URL } = require('./config');

const { logLevels, logFromRequest, log } = require('./logger');
const { json } = require('body-parser');
const { sanitiseText } = require('./middleware/sanitiseText');
const { audit, recomputeBalanceAndAudit } = require('./middleware/audit');


// Prepare payment methods object - this is static at runtime

const paymentMethods = Object.freeze(JSON.parse(JSON.stringify({
  'cash': {
    enabled: CASH_ENABLED,
    label: 'Cash',
    url: null
  },
  'card-manual': {
    enabled: MANUAL_CARD_ENABLED,
    label: 'Card (manual)',
    url: null
  },
  'paypal-manual': {
    enabled: PAYPAL_ENABLED,
    label: 'PayPal (manual)',
    url: null
  },
  'sumup-web': {
    enabled: SUMUP_WEB_ENABLED,
    label: 'SumUp Web checkout',
    url: SUMUP_RETURN_URL

  },
  'sumup-app': {
    enabled: SUMUP_CARD_PRESENT_ENABLED,
    label: 'SumUp App',
    url: SUMUP_CALLBACK_SUCCESS
  },

})));


module.exports = function phase1Patch (app) {


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

  //--------------------------------------------------------------------------
  // API to fetch the enabled payment methods
  //--------------------------------------------------------------------------
  settlement.get('/payment-methods', authenticateRole(['cashier','maintenance']), (req, res) => {
  logFromRequest(req, logLevels.DEBUG, `Payment methods requested`);
    res.json(paymentMethods);
  });

  //--------------------------------------------------------------------------
  // Settlement (record paymeny) for non-hosted payments
  //--------------------------------------------------------------------------


  settlement.post('/payment/:auctionId', authenticateRole('cashier'), checkAuctionState(['settlement']), (req, res) => {
    const auction_id = Number(req.params.auctionId);
    const { bidder_id, amount, method = 'cash', note = '' } = req.body;
    const sanitisedNote = sanitiseText(note, 100);
    // acceptable methods (manual methods only here, SumUp handled elsewhere)
    const manualPaymentMethods = ['cash', 'card-manual', 'paypal-manual'];
    if (!manualPaymentMethods.includes(method)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }

    if (!bidder_id || !amount || !auction_id) {
      return res.status(400).json({ error: 'Missing params' });
    }
    // check if the requested method is enabled in config
    if (CASH_ENABLED === false && method === 'cash' || MANUAL_CARD_ENABLED === false && method === 'card-manual' || PAYPAL_ENABLED === false && method === 'paypal-manual') {
      logFromRequest(req, logLevels.WARN, `Attempt to create manual payment with disabled method ${method}`);
      return res.status(503).json({ error: `Requested payment method ${method} disabled` });
    }

    // verify that the bidder belongs to the auction and fetch paddle number
    const bidderRow = db.get(`SELECT paddle_number FROM bidders WHERE id = ? AND auction_id = ?`, [bidder_id, auction_id]);
    if (!bidderRow) {
      logFromRequest(req, logLevels.ERROR, `Bidder ${bidder_id} not found in auction ${auction_id} whilst recording payment`);
      return res.status(400).json({ error: 'Bidder not found for this auction' });
    }

    // Check that the requested amount does not exceed the bidder's outstanding balance
    const sums2 = db.prepare(`
      SELECT
        IFNULL((SELECT SUM(hammer_price) FROM items WHERE winning_bidder_id = ?), 0) AS lots_total,
        IFNULL((SELECT SUM(amount) FROM payments WHERE bidder_id = ?), 0) AS payments_total
    `).get(bidder_id, bidder_id);
    const outstanding = Math.max(0, Math.round((sums2.lots_total - sums2.payments_total)));
    logFromRequest(req, logLevels.DEBUG, `Bidder ${bidder_id} paddle number ${bidderRow.paddle_number} outstanding amount=${outstanding}, amount requested=${amount}`);
    if (amount > outstanding) {
      logFromRequest(req, logLevels.WARN, `Intent amount exceeds outstanding: bidder=${bidder_id} paddle number=${bidderRow.paddle_number} amount=${amount} outstanding=${outstanding}`);
      return res.status(400).json({ error: 'Amount requested exceeds outstanding', outstanding});
    }

try {

    db.run(`INSERT INTO payments (bidder_id, amount, method, note, created_by, currency)
            VALUES (?,?,?,?,?,?)`,
      [bidder_id, amount, method, sanitisedNote, req.user.role, CURRENCY]
    );
    audit(req.user.role, 'payment', 'bidder', bidder_id, { amount, method, paddle: bidderRow.paddle_number, note: sanitisedNote });
    logFromRequest(req, logLevels.INFO, `${method} payment by bidder ${bidder_id} for ${amount} recorded`);

  /* 2️⃣  recompute balance */
  const balance = recomputeBalanceAndAudit(bidder_id, req);

 res.json({ ok: true, balance });
    
} catch (error) {
    logFromRequest(req, logLevels.ERROR, `Failed to record payment for bidder ${bidder_id}: ${error.message}`);

    res.status(500).json({ error: `Failed to record payment for bidder ${bidder_id}: ${error.message}` });
}
  });

  //--------------------------------------------------------------------------
  // Settlement (payment reversal)
  // auctionId provided in the request body to feed checkAuctionState

  // POST /payments/:id/reverse
  // Body: { amount?: number, reason?: string, note?: string }
  // - amount: optional, defaults to full remaining amount
  // - reason: required
  // - note: optional free text
  //--------------------------------------------------------------------------



settlement.post('/payment/:payid/reverse', authenticateRole(['cashier', 'admin']), checkAuctionState(['settlement']), (req, res) => {
  try {
    const originalId = Number(req.params.payid);
    if (!Number.isInteger(originalId) || originalId <= 0) {
      return res.status(400).json({ error: 'invalid_payment_id' });
    }

    const body = req.body || {};
    const requestedAmount = body.amount != null ? Number(body.amount) : null;

  
    const reason = sanitiseText(body.reason, 255); 
    const extraNote = sanitiseText(body.note, 255);

    if (!reason) {
      return res.status(400).json({ error: 'reason_required' });
    }

    const getOriginal = db.prepare(`
      SELECT id, bidder_id, amount, method, note, created_by, created_at,
             provider, provider_txn_id, intent_id, currency
      FROM payments
      WHERE id = ?
    `);


    const getReversedTotal = db.prepare(`
      SELECT COALESCE(SUM(-amount), 0) AS reversed_total
      FROM payments
      WHERE reverses_payment_id = ?
    `);

    const insertReversal = db.prepare(`
  INSERT INTO payments (
    bidder_id,
    amount,
    method,
    note,
    created_by,
    provider,
    currency,
    reverses_payment_id,
    reversal_reason
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

    const tx = db.transaction(() => {
      const original = getOriginal.get(originalId);
      if (!original) {
        return { error: 'not_found' };
      }

      // Don’t allow reversing a reversal (or a negative adjustment)
      if (!(original.amount > 0)) {
        return { error: 'cannot_reverse_non_positive_payment' };
      }

      const reversed = getReversedTotal.get(originalId);
      const reversedTotal = Number(reversed?.reversed_total || 0);
        logFromRequest(req, logLevels.DEBUG, `Original payment amount=${original.amount}, already reversed total=${reversedTotal}`);
      const remaining = Number(original.amount) - reversedTotal;
      // remaining should not go negative; but guard anyway
      const remainingSafe = remaining < 0 ? 0 : remaining;

      // Determine refund amount
      const refundAmount =
        requestedAmount == null ? remainingSafe : requestedAmount;

      if (!(refundAmount > 0)) {
        return { error: 'invalid_amount' };
      }
      if (refundAmount > remainingSafe + 1e-9) { // small float guard
        return { error: 'amount_exceeds_remaining', remaining: remainingSafe };
      }

      const reversalNote = `Refund of ${original.currency || ''} ${refundAmount} against ID #${original.id}. Reason: ${reason}` + (extraNote ? ` | note=${extraNote}` : '');
      logFromRequest(req, logLevels.DEBUG, `reversal note: ${reversalNote}`);

const methodString = original.method + ' (Refund)';
const info = insertReversal.run(

  original.bidder_id,                              // bidder_id
  -refundAmount,                                   // amount (negative)
  methodString,                                    // method
  reversalNote,                                    // note
  req.user.role,                                   // created_by
  original.provider || 'unknown',                   // provider (schema NOT NULL)
  original.currency || 'GBP',                       // currency (schema NOT NULL)
  original.id,                                     // reverses_payment_id
  reason                                           // reversal_reason
);

audit(req.user.role, 'payment_reversal', 'bidder', original.bidder_id, {
  original_payment_id: original.id,
  reversal_payment_id: info.lastInsertRowid,
  amount: refundAmount,
  reason
});

logFromRequest(req, logLevels.DEBUG, `Reversal inserted with id=${info.lastInsertRowid}`);
      return {
        ok: true,
        reversal_id: Number(info.lastInsertRowid),
        original_id: original.id,
        bidder_id: original.bidder_id,
        refunded: refundAmount,
        remaining: remainingSafe - refundAmount
      };
    });

    const result = tx();

    if (result?.error === 'not_found') {
      return res.status(400).json({ error: 'Payment not found' });
    }
    if (result?.error === 'cannot_reverse_non_positive_payment') {
      return res.status(400).json({ error: 'Cannot reverse non-positive payment' });
    }
    if (result?.error === 'invalid_amount') {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (result?.error === 'amount_exceeds_remaining') {
      return res.status(400).json({ error: 'Amount exceeds remaining', remaining: result.remaining });
    }
    if (!result?.ok) {
      return res.status(500).json({ error: 'Reverse payment failed' });
    }

    logFromRequest(req, logLevels.INFO,
      `payment_reversed original=${result.original_id} reversal=${result.reversal_id} bidder=${result.bidder_id} refunded=${result.refunded}`
    );

    return res.status(201).json(result);

  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Payment reverse error ${err}`);
    return res.status(500).json({ error: 'Payment reverse error' });
  }
});


  //--------------------------------------------------------------------------
  // Settlement (create csv summary)
  //--------------------------------------------------------------------------


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
  // Finalize Lot - record bid (admin)
  //--------------------------------------------------------------------------
  const sales = express.Router();

  sales.post('/:itemid/finalize', authenticateRole('admin'), checkAuctionState(['live', 'settlement']), (req, res) => {
    const itemId = Number(req.params.itemid);
    const { paddle, price, auctionId } = req.body;
    if (!paddle || !price || !auctionId) return res.status(400).json({ error: 'Missing paddle or price or auction id' });

// Get the bidder ID if they exist, otherwise create a new entry for them
try {
    let bidder = db.get('SELECT id FROM bidders WHERE paddle_number = ? AND auction_id = ?', [paddle, auctionId]);
    if (!bidder) {
      const info = db.run('INSERT INTO bidders (paddle_number, auction_id) VALUES (?, ?)', [paddle, auctionId]);
      
      bidder = { id: info.lastInsertRowid };
    }

const stmt = db.prepare(`
  UPDATE items
     SET winning_bidder_id = ?, hammer_price = ?
   WHERE id = ?
     AND hammer_price IS NULL          -- ← only if not finalised yet
`);

const info = stmt.run(bidder.id, price, itemId);

if (info.changes === 0) {
  // nothing updated → someone else already finalised this lot
  throw new Error('This lot has already been recorded by another user.');
}

//    db.run(`UPDATE items SET winning_bidder_id = ?, hammer_price = ? WHERE id = ?`, [bidder.id, price, itemId]);
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

          } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Failed to record bid for item ${itemId}: ${error.message}`);

            res.status(500).json({ error: `Failed to record bid for item ${itemId}: ${error.message}` });
        }


  });

  //--------------------------------------------------------------------------
  // Undo/retract bid (admin)
  // Checks for payment by bidder
  //--------------------------------------------------------------------------


  sales.post('/:id/undo', authenticateRole('admin'), checkAuctionState(['live', 'settlement']), (req, res) => {
    const itemId = Number(req.params.id);
    const row = db.get(`SELECT winning_bidder_id FROM items WHERE id = ?`, [itemId]);
    if (!row) return res.status(400).json({ error: 'Item not found' });

    const paid = db.get(`SELECT 1 FROM payments WHERE bidder_id = ? LIMIT 1`, [row.winning_bidder_id]);
    if (paid) {
       logFromRequest(req, logLevels.WARN, `Bid retract failed for item ${itemId} by bidder ${row.winning_bidder_id} - Payment exists`);
      return res.status(400).json({ error: 'Cannot undo – payments exist' });
    }
    db.run(`UPDATE items SET winning_bidder_id = NULL, hammer_price = NULL WHERE id = ?`, [itemId]);
    audit(req.user.role, 'undo-bid', 'item', itemId);

    logFromRequest(req, logLevels.INFO, `Bid retracted for item ${itemId} by bidder ${row.winning_bidder_id}`);

    res.json({ ok: true });
  });

  //--------------------------------------------------------------------------
  // Settlement - retrieve items the bidder won
  //--------------------------------------------------------------------------
settlement.get('/bidders/:bidderid', authenticateRole('cashier'), (req, res) => {
  const id = Number(req.params.bidderid);
  const auctionId = Number(req.query.auction_id);           // NEW

if (!auctionId || !id) return res.status(400).json({ error: 'item # and auction_id required' });

// this shouldn't be needed, but since were taking payment, lets be certain....
  const bidder = db.get(`
    SELECT * FROM bidders WHERE id = ? AND auction_id = ?`,
    [id, auctionId] );
   if (!bidder) return res.status(400).json({ error: 'Bidder not found for this auction' });

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

  //--------------------------------------------------------------------------
  // Settlement - Generate a £ summary by payment method
  //--------------------------------------------------------------------------
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
  //   Mount routers under /api
  //--------------------------------------------------------------------------
  app.use('/cashier', liveFeed);
  app.use('/settlement', settlement);
  app.use('/lots', sales);


};
