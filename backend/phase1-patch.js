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
const { checkAuctionState } = require('./middleware/checkAuctionState');
const { authenticateRole } = require('./middleware/authenticateRole');
const { CASH_ENABLED, MANUAL_CARD_ENABLED, PAYPAL_ENABLED, SUMUP_WEB_ENABLED, SUMUP_CARD_PRESENT_ENABLED, CURRENCY, SUMUP_CALLBACK_SUCCESS, SUMUP_RETURN_URL } = require('./config');

const { logLevels, logFromRequest, log } = require('./logger');
const { json } = require('body-parser');
const { sanitiseText } = require('./middleware/sanitiseText');
const { audit, recomputeBalanceAndAudit } = require('./middleware/audit');
const { block } = require('sharp');
const { getAuditActor } = require('./users');

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

  const derivePaymentStatus = (lotsTotal, paymentsTotal) => {
    const lots = Number(lotsTotal || 0);
    const paid = Number(paymentsTotal || 0);
    if (paid <= 0) return 'not_paid';
    if (paid >= lots && lots > 0) return 'paid_in_full';
    return 'part_paid';
  };

  const buildBidderFingerprint = (items) => items
    .slice()
    .sort((a, b) => Number(a.rowid) - Number(b.rowid))
    .map(item => `${item.rowid}:${item.lot}:${item.price ?? ''}`)
    .join('|');

  const getAuctionStatus = (auctionId) => {
    const row = db.get('SELECT status FROM auctions WHERE id = ?', [auctionId]);
    return row?.status || null;
  };

  const getLiveFeedPayload = (auctionId, includeUnsold) => {
    const auctionStatus = getAuctionStatus(auctionId);
    if (!auctionStatus) {
      const error = new Error('Auction not found');
      error.statusCode = 404;
      throw error;
    }

    const sold = db.all(`
      SELECT i.id,
             i.item_number AS lot,
             i.description,
             i.winning_bidder_id AS bidder_id,
             b.paddle_number AS bidder,
             i.hammer_price  AS price,
             i.ROWID         AS rowid,
             i.last_bid_update,
             i.collected_at,
             i.test_item,
             i.test_bid,
             i.photo
        FROM items i
        LEFT JOIN bidders b ON b.id = i.winning_bidder_id
       WHERE i.auction_id = ? AND i.hammer_price IS NOT NULL
       ORDER BY i.last_bid_update DESC, i.ROWID DESC
    `, [auctionId]);

    const unsold = includeUnsold
      ? db.all(`
          SELECT i.id,
                 i.item_number AS lot,
                 i.description,
                 i.photo,
                 NULL            AS bidder_id,
                 NULL            AS bidder,
                 NULL            AS price,
                 i.ROWID         AS rowid,
                 NULL            AS last_bid_update,
                 NULL            AS collected_at,
                 1               AS unsold
            FROM items i
           WHERE i.auction_id = ? AND i.hammer_price IS NULL
           ORDER BY i.item_number
        `, [auctionId])
      : [];

    const bidderRows = db.all(`
      SELECT b.id AS bidder_id,
             b.paddle_number AS bidder,
             IFNULL(b.name, '') AS name,
             b.ready_for_collection,
             b.ready_fingerprint,
             b.ready_updated_at,
             IFNULL(SUM(i.hammer_price), 0) AS lots_total,
             IFNULL(SUM(CASE WHEN i.collected_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS collected_count,
             IFNULL(COUNT(i.id), 0) AS item_count,
             IFNULL(p.payments_total, 0) AS payments_total,
             p.last_paid_at
        FROM bidders b
        LEFT JOIN items i
               ON i.winning_bidder_id = b.id
              AND i.auction_id = b.auction_id
              AND i.hammer_price IS NOT NULL
        LEFT JOIN (
          SELECT bidder_id,
                 SUM(amount) AS payments_total,
                 MAX(created_at) AS last_paid_at
            FROM payments
           GROUP BY bidder_id
        ) p ON p.bidder_id = b.id
       WHERE b.auction_id = ?
       GROUP BY b.id
       HAVING COUNT(i.id) > 0 OR IFNULL(p.payments_total, 0) > 0
       ORDER BY b.paddle_number
    `, [auctionId]);

    const soldByBidder = new Map();
    sold.forEach(item => {
      const bidderId = Number(item.bidder_id);
      if (!Number.isFinite(bidderId)) return;
      if (!soldByBidder.has(bidderId)) soldByBidder.set(bidderId, []);
      soldByBidder.get(bidderId).push(item);
    });

    const bidders = bidderRows.map(row => {
      const items = soldByBidder.get(Number(row.bidder_id)) || [];
      const fingerprint = buildBidderFingerprint(items);
      const lotsTotal = Number(row.lots_total || 0);
      const paymentsTotal = Number(row.payments_total || 0);
      return {
        bidder_id: row.bidder_id,
        bidder: row.bidder,
        name: row.name,
        ready_for_collection: Boolean(row.ready_for_collection),
        ready_fingerprint: row.ready_fingerprint || '',
        ready_updated_at: row.ready_updated_at || null,
        lots_total: lotsTotal,
        payments_total: paymentsTotal,
        payment_status: derivePaymentStatus(lotsTotal, paymentsTotal),
        last_paid_at: row.last_paid_at || null,
        item_count: Number(row.item_count || 0),
        collected_count: Number(row.collected_count || 0),
        all_collected: Number(row.item_count || 0) > 0 && Number(row.collected_count || 0) === Number(row.item_count || 0),
        can_collect: auctionStatus === 'settlement' && paymentsTotal > 0,
        current_fingerprint: fingerprint
      };
    });

    return {
      auction_id: auctionId,
      auction_status: auctionStatus,
      sold,
      unsold,
      bidders
    };
  };

   liveFeed.get('/live/:auctionId', authenticateRole(["admin", "cashier"]), (req, res) => {
   const id   = Number(req.params.auctionId);
 const include_unsold  = req.query.unsold === 'true';
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'auction_id required' });
    }
  try {
    res.json(getLiveFeedPayload(id, include_unsold));
  } catch (error) {
    logFromRequest(req, logLevels.ERROR, `Failed to fetch live feed for auction ${id}: ${error.message}`);
    res.status(error.statusCode || 500).json({ error: `Failed to fetch live feed for auction ${id}: ${error.message}` });
  }
  });

  liveFeed.post('/live/:auctionId/bidders/:bidderId/ready', authenticateRole(["admin", "cashier"]), (req, res) => {
    const auctionId = Number(req.params.auctionId);
    const bidderId = Number(req.params.bidderId);
    const ready = Boolean(req.body?.ready);
    const fingerprint = ready ? String(req.body?.fingerprint || '') : null;

    if (!Number.isInteger(auctionId) || auctionId <= 0 || !Number.isInteger(bidderId) || bidderId <= 0) {
      return res.status(400).json({ error: 'auctionId and bidderId required' });
    }

    const bidder = db.get('SELECT id FROM bidders WHERE id = ? AND auction_id = ?', [bidderId, auctionId]);
    if (!bidder) return res.status(404).json({ error: 'Bidder not found for this auction' });

    db.run(`
      UPDATE bidders
         SET ready_for_collection = ?,
             ready_fingerprint = ?,
             ready_updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
       WHERE id = ? AND auction_id = ?
    `, [ready ? 1 : 0, fingerprint, bidderId, auctionId]);

    audit(getAuditActor(req), ready ? 'ready_for_collection' : 'ready_cleared', 'bidder', bidderId, {
      auction_id: auctionId,
      ready,
      fingerprint: fingerprint || ''
    });

    logFromRequest(req, logLevels.INFO, `Bidder ${bidderId} marked as ${ready ? 'ready for collection' : 'not ready'} for auction ${auctionId}`);

    res.json({
      ok: true,
      bidder_id: bidderId,
      ready_for_collection: ready,
      ready_fingerprint: fingerprint || ''
    });
  });

  liveFeed.post('/live/:auctionId/items/:itemId/collection', authenticateRole(["admin", "cashier"]), (req, res) => {
    const auctionId = Number(req.params.auctionId);
    const itemId = Number(req.params.itemId);
    const collected = Boolean(req.body?.collected);

    if (!Number.isInteger(auctionId) || auctionId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ error: 'auctionId and itemId required' });
    }

    const auctionStatus = getAuctionStatus(auctionId);
    if (!auctionStatus) return res.status(404).json({ error: 'Auction not found' });

    const item = db.get(`
      SELECT i.id, i.item_number, i.winning_bidder_id AS bidder_id, b.paddle_number AS bidder
        FROM items i
        LEFT JOIN bidders b ON b.id = i.winning_bidder_id
       WHERE i.id = ? AND i.auction_id = ? AND i.hammer_price IS NOT NULL
    `, [itemId, auctionId]);
    if (!item) return res.status(404).json({ error: 'Sold item not found for this auction' });

    const paymentSummary = db.get(`
      SELECT IFNULL(SUM(amount), 0) AS payments_total
        FROM payments
       WHERE bidder_id = ?
    `, [item.bidder_id]) || { payments_total: 0 };

    if (auctionStatus !== 'settlement' || Number(paymentSummary.payments_total || 0) <= 0) {
      return res.status(400).json({ error: 'Collection can only be updated in settlement after payment has been recorded' });
    }

    db.run(`
      UPDATE items
         SET collected_at = CASE WHEN ? = 1 THEN strftime('%Y-%m-%d %H:%M:%S', 'now') ELSE NULL END
       WHERE id = ? AND auction_id = ?
    `, [collected ? 1 : 0, itemId, auctionId]);

    if (collected) {
      const payload = getLiveFeedPayload(auctionId, false);
      const bidderSummary = payload.bidders.find(row => Number(row.bidder_id) === Number(item.bidder_id));
      db.run(`
        UPDATE bidders
           SET ready_for_collection = 1,
               ready_fingerprint = ?,
               ready_updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND auction_id = ?
      `, [bidderSummary?.current_fingerprint || '', item.bidder_id, auctionId]);
    }

    audit(getAuditActor(req), collected ? 'item_collected' : 'item_uncollected', 'item', itemId, {
      auction_id: auctionId,
      bidder: item.bidder,
      bidder_id: item.bidder_id
    });

    logFromRequest(req, logLevels.INFO, `Item collection updated for auction ${auctionId}, item ${itemId}, collected=${collected}`);

    res.json({ ok: true, item_id: itemId, collected });
  });

  liveFeed.post('/live/:auctionId/bidders/:bidderId/collect-all', authenticateRole(["admin", "cashier"]), (req, res) => {
    const auctionId = Number(req.params.auctionId);
    const bidderId = Number(req.params.bidderId);

    if (!Number.isInteger(auctionId) || auctionId <= 0 || !Number.isInteger(bidderId) || bidderId <= 0) {
      return res.status(400).json({ error: 'auctionId and bidderId required' });
    }

    const auctionStatus = getAuctionStatus(auctionId);
    if (!auctionStatus) return res.status(404).json({ error: 'Auction not found' });

    const bidder = db.get('SELECT paddle_number FROM bidders WHERE id = ? AND auction_id = ?', [bidderId, auctionId]);
    if (!bidder) return res.status(404).json({ error: 'Bidder not found for this auction' });

    const paymentSummary = db.get(`
      SELECT IFNULL(SUM(amount), 0) AS payments_total
        FROM payments
       WHERE bidder_id = ?
    `, [bidderId]) || { payments_total: 0 };

    if (auctionStatus !== 'settlement' || Number(paymentSummary.payments_total || 0) <= 0) {
      return res.status(400).json({ error: 'Collection can only be updated in settlement after payment has been recorded' });
    }

    db.run(`
      UPDATE items
         SET collected_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
       WHERE auction_id = ? AND winning_bidder_id = ? AND hammer_price IS NOT NULL
    `, [auctionId, bidderId]);

    const payload = getLiveFeedPayload(auctionId, false);
    const bidderSummary = payload.bidders.find(row => Number(row.bidder_id) === Number(bidderId));
    db.run(`
      UPDATE bidders
         SET ready_for_collection = 1,
             ready_fingerprint = ?,
             ready_updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
       WHERE id = ? AND auction_id = ?
    `, [bidderSummary?.current_fingerprint || '', bidderId, auctionId]);

    audit(getAuditActor(req), 'bidder_collected_all', 'bidder', bidderId, {
      auction_id: auctionId,
      bidder: bidder.paddle_number
    });

    logFromRequest(req, logLevels.INFO, `All items marked collected for auction ${auctionId}, bidder ${bidder.paddle_number} (${bidderId})`);

    res.json({ ok: true, bidder_id: bidderId });
  });

  liveFeed.get('/live/:auctionId/uncollected.csv', authenticateRole(["admin", "cashier"]), (req, res) => {
    const auctionId = Number(req.params.auctionId);
    if (!Number.isInteger(auctionId) || auctionId <= 0) {
      return res.status(400).json({ error: 'auctionId required' });
    }

    try {
      const rows = db.all(`
        SELECT b.paddle_number AS paddle_number,
               i.item_number AS lot,
               REPLACE(IFNULL(i.description, ''), ',', ' ') AS description,
               IFNULL(i.hammer_price, 0) AS price,
               IFNULL(p.payments_total, 0) AS payments_total,
               CASE
                 WHEN IFNULL(p.payments_total, 0) <= 0 THEN 'not_paid'
                 WHEN IFNULL(p.payments_total, 0) >= IFNULL(l.lots_total, 0) AND IFNULL(l.lots_total, 0) > 0 THEN 'paid_in_full'
                 ELSE 'part_paid'
               END AS payment_status
          FROM items i
          JOIN bidders b ON b.id = i.winning_bidder_id
          LEFT JOIN (
            SELECT winning_bidder_id AS bidder_id, SUM(hammer_price) AS lots_total
              FROM items
             WHERE auction_id = ? AND hammer_price IS NOT NULL
             GROUP BY winning_bidder_id
          ) l ON l.bidder_id = b.id
          LEFT JOIN (
            SELECT bidder_id, SUM(amount) AS payments_total
              FROM payments
             GROUP BY bidder_id
          ) p ON p.bidder_id = b.id
         WHERE i.auction_id = ?
           AND i.hammer_price IS NOT NULL
           AND i.collected_at IS NULL
         ORDER BY b.paddle_number, i.item_number
      `, [auctionId, auctionId]);

      const header = 'paddle_number,lot,description,price,payments_total,payment_status\n';
      const csv = header + rows.map(row => [
        row.paddle_number,
        row.lot,
        row.description,
        row.price,
        row.payments_total,
        row.payment_status
      ].join(',')).join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="uncollected_auction_${auctionId}.csv"`);
      res.end('\uFEFF' + csv);
    } catch (error) {
      logFromRequest(req, logLevels.ERROR, `Failed to export uncollected CSV for auction ${auctionId}: ${error.message}`);
      res.status(500).json({ error: `Failed to export uncollected CSV for auction ${auctionId}: ${error.message}` });
    }
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
             IFNULL(i.lots_total, 0) AS lots_total,
             IFNULL(p.payments_total, 0) AS payments_total
        FROM bidders b
        LEFT JOIN (
          SELECT winning_bidder_id AS bidder_id,
                 SUM(CASE WHEN hammer_price IS NULL THEN 0 ELSE hammer_price END) AS lots_total
            FROM items
           WHERE auction_id = ?
           GROUP BY winning_bidder_id
        ) i ON i.bidder_id = b.id
        LEFT JOIN (
          SELECT bidder_id, SUM(amount) AS payments_total
            FROM payments
           GROUP BY bidder_id
        ) p ON p.bidder_id = b.id
       WHERE b.auction_id = ?
         AND (i.bidder_id IS NOT NULL OR p.payments_total IS NOT NULL)
       ORDER BY b.paddle_number
    `,[id, id]);
    rows.forEach(r => {
      r.balance = (r.lots_total || 0) - (r.payments_total || 0);
    });
    res.json(rows);
  });

  //--------------------------------------------------------------------------
  // API to fetch the enabled payment methods
  //--------------------------------------------------------------------------
  settlement.get('/payment-methods', authenticateRole(['cashier', 'maintenance']), (req, res) => {
 //   logFromRequest(req, logLevels.DEBUG, `Payment methods requested`);
    try {
      return res.json({ paymentMethods });

    } catch (error) {
      logFromRequest(req, logLevels.ERROR, `Failed to fetch payment methods: ${error.message}`);
      res.status(500).json({ error: `Failed to fetch payment methods: ${error.message}` });
    }
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
      [bidder_id, amount, method, sanitisedNote, getAuditActor(req), CURRENCY]
    );
    audit(getAuditActor(req), 'payment', 'bidder', bidder_id, { amount, method, paddle: bidderRow.paddle_number, note: sanitisedNote });
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
      return res.status(400).json({ error: 'Reason Required' });
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
  getAuditActor(req),                              // created_by
  original.provider || 'unknown',                   // provider (schema NOT NULL)
  original.currency || 'GBP',                       // currency (schema NOT NULL)
  original.id,                                     // reverses_payment_id
  reason                                           // reversal_reason
);

audit(getAuditActor(req), 'payment_reversal', 'bidder', original.bidder_id, {
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
    if (!Number.isInteger(itemId) || itemId <= 0) return res.status(400).json({ error: 'Invalid item id' });
    if (!Number.isInteger(Number(paddle)) || Number(paddle) <= 0) return res.status(400).json({ error: 'Invalid paddle' });
    if (!/^\d+(\.\d{1,2})?$/.test(String(price)) || Number(price) <= 0) return res.status(400).json({ error: 'Invalid price' });
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
     SET winning_bidder_id = ?,
         hammer_price = ?,
         last_bid_update = strftime('%Y-%m-%d %H:%M:%S', 'now')
   WHERE id = ?
     AND hammer_price IS NULL          -- ← only if not finalised yet
`);

const info = stmt.run(bidder.id, price, itemId);

if (info.changes === 0) {
  // nothing updated → someone else already finalised this lot
  throw new Error('This lot has already been recorded by another user.');
}

//    db.run(`UPDATE items SET winning_bidder_id = ?, hammer_price = ? WHERE id = ?`, [bidder.id, price, itemId]);
    audit(getAuditActor(req), 'finalize', 'item', itemId, { paddle_no: paddle, price });
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



    // audit entry for traceability
    audit(getAuditActor(req), 'auto_settlement', 'auction', auctionId, {
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
  // Updated to allow undo but not it would cause negative balance if payment exists
  // Original version simply blocked undos if payment existed
  //--------------------------------------------------------------------------


  sales.post('/:id/undo', authenticateRole('admin'), checkAuctionState(['live', 'settlement']), (req, res) => {
    const itemId = Number(req.params.id);

    if (!itemId || isNaN(itemId)) return res.status(400).json({ error: 'item # required' });
    try {
      const row = db.get(`SELECT winning_bidder_id, hammer_price FROM items WHERE id = ?`, [itemId]);
      if (!row) return res.status(400).json({ error: 'Item not found' });

      const paid = db.get(`SELECT 1 FROM payments WHERE bidder_id = ? LIMIT 1`, [row.winning_bidder_id]);

      // Check if undoing the bid would result in a negative balance
      if (paid) {
        const sums = db.get(`
          SELECT
            IFNULL((SELECT SUM(hammer_price) FROM items WHERE winning_bidder_id = ?), 0) AS lots_total,
            IFNULL((SELECT SUM(amount) FROM payments WHERE bidder_id = ?), 0) AS payments_total
        `, [row.winning_bidder_id, row.winning_bidder_id]);
        const newBalance = (sums.lots_total || 0) - (row.hammer_price || 0) - (sums.payments_total || 0);
        if (Number(newBalance) < 0) {
          logFromRequest(req, logLevels.WARN, `Cannot retract bid for item ${itemId} by bidder ${row.winning_bidder_id} - would result in negative balance`);
          return res.status(400).json({ error: `Undo would result in bidder negative balance. Issue a refund of ${CURRENCY} ${Math.abs(newBalance)} and retry` });
        }
      }

      db.run(`
        UPDATE items
           SET winning_bidder_id = NULL,
               hammer_price = NULL,
               last_bid_update = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ?
      `, [itemId]);
      if (paid) {
        logFromRequest(req, logLevels.INFO, `Bid retracted for item ${itemId} by bidder ${row.winning_bidder_id} but payment exists`);
        audit(getAuditActor(req), 'undo-bid', 'item', itemId, { item: itemId, bidder: row.winning_bidder_id, note: 'Payment exists for bidder' });
        return res.json({ ok: true, message: 'Bid retracted but payment exists - Verify cashier totals' });
      }

      logFromRequest(req, logLevels.INFO, `Bid retracted for item ${itemId} by bidder ${row.winning_bidder_id}`);
      audit(getAuditActor(req), 'undo-bid', 'item', itemId, { item: itemId, bidder: row.winning_bidder_id });
      return res.json({ ok: true, message: 'Bid retracted' });
    } catch (error) {
      logFromRequest(req, logLevels.ERROR, `Failed to retract bid for item ${itemId}: ${error.message}`);

      res.status(500).json({ error: `Failed to retract bid for item ${itemId}: ${error.message}` });
    }
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
      SELECT item_number, description, hammer_price, test_item, test_bid, photo
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
             IFNULL((SELECT SUM(i.hammer_price) FROM items i WHERE i.winning_bidder_id = b.id AND i.auction_id = ?), 0) AS lots_total,
             IFNULL((SELECT SUM(amount) FROM payments p WHERE p.bidder_id = b.id),0) AS payments_total
        FROM bidders b
       WHERE b.id = ? AND b.auction_id = ?
    GROUP BY b.id`, [auctionId, id, auctionId]);

   // console.log(summary.lots_total)
const lotsTotal = Number(summary.lots_total || 0);
const paymentsTotal = Number(summary.payments_total || 0);
  const balance = (lotsTotal) - (paymentsTotal);

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
