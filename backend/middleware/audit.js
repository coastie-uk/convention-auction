const db = require('../db');

const { logLevels, log } = require('../logger');
const { getAuditActor } = require('../users');
const auditTypes = ['item', 'bidder', 'payment', 'auction', 'database','server'];

let stmtGetItemAuditInfo;
let stmtGetBidderAuctionId;
let stmtGetPaymentAuctionId;
let stmtGetAuctionShortName;
let lastConnectionId = null;

function prepareStatements() {
    stmtGetItemAuditInfo = db.prepare(
        `SELECT i.auction_id, i.description, a.short_name
           FROM items i
           LEFT JOIN auctions a ON a.id = i.auction_id
          WHERE i.id = ?`
    );
    stmtGetBidderAuctionId = db.prepare(
        'SELECT auction_id FROM bidders WHERE id = ?'
    );
    stmtGetPaymentAuctionId = db.prepare(
        `SELECT b.auction_id
           FROM payments p
           JOIN bidders b ON b.id = p.bidder_id
          WHERE p.id = ?`
    );
    stmtGetAuctionShortName = db.prepare(
        'SELECT short_name FROM auctions WHERE id = ?'
    );
    lastConnectionId = typeof db.getConnectionId === 'function' ? db.getConnectionId() : lastConnectionId;
}

function ensureStatements() {
    if (!stmtGetItemAuditInfo) {
        prepareStatements();
        return;
    }
    if (typeof db.getConnectionId === 'function') {
        const currentId = db.getConnectionId();
        if (currentId !== lastConnectionId) {
            prepareStatements();
        }
    }
}

//--------------------------------------------------------------------------
// Helper to record audit events
//--------------------------------------------------------------------------
function audit(user, action, type, id, details = {}) {
    ensureStatements();
    if (!auditTypes.includes(type)) {
        log(logLevels.WARN, `Audit log: unknown type '${type}'`);
        
    }
    if ((type === 'item' || type === 'bidder' || type === 'payment') && details && typeof details === 'object') {
        try {
            if (type === 'item' && (details.auction_id === undefined || details.description === undefined || details.auction_short_name === undefined)) {
                const row = stmtGetItemAuditInfo.get(id);
                if (row) {
                    if (details.auction_id === undefined) details.auction_id = row.auction_id;
                    if (details.description === undefined) details.description = row.description;
                    if (details.auction_short_name === undefined) details.auction_short_name = row.short_name;
                }
            } else if (type === 'bidder' && (details.auction_id === undefined || details.auction_short_name === undefined)) {
                const row = stmtGetBidderAuctionId.get(id);
                if (row) {
                    if (details.auction_id === undefined) details.auction_id = row.auction_id;
                    if (details.auction_short_name === undefined && row.auction_id !== null && row.auction_id !== undefined) {
                        const auction = stmtGetAuctionShortName.get(row.auction_id);
                        if (auction) details.auction_short_name = auction.short_name;
                    }
                }
            } else if (type === 'payment' && (details.auction_id === undefined || details.auction_short_name === undefined)) {
                const row = stmtGetPaymentAuctionId.get(id);
                if (row) {
                    if (details.auction_id === undefined) details.auction_id = row.auction_id;
                    if (details.auction_short_name === undefined && row.auction_id !== null && row.auction_id !== undefined) {
                        const auction = stmtGetAuctionShortName.get(row.auction_id);
                        if (auction) details.auction_short_name = auction.short_name;
                    }
                }
            }
        } catch (err) {
            log(logLevels.WARN, `Audit log lookup failed: ${err.message}`);
        }
    }
    try {
        db.run(
            `INSERT INTO audit_log (user, action, object_type, object_id, details)
           VALUES (?,?,?,?,?)`,
            [user, action, type, id, JSON.stringify(details)]
        );
    } catch (err) {
        log(logLevels.ERROR, `Failed to record audit event: ${err.message}`);
    }
}


  // helper to recompute balance and set audit status on items
function recomputeBalanceAndAudit(bidder_id, req) {

    if (req === null || req === undefined) {
      req = { user: { username: 'system', role: 'system', auditUser: 'system' } };
    }

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
      `SELECT i.id, i.item_number, i.description, i.hammer_price, b.paddle_number 
        FROM items i
        LEFT JOIN bidders b ON b.id = i.winning_bidder_id
        WHERE winning_bidder_id = ?
      `,
      [bidder_id]
    );
   if (balance <= 0) {
     items.forEach(it => {
       audit(getAuditActor(req), 'paid in full', 'item', it.id, { paddle: it.paddle_number, item_number: it.item_number, price: it.hammer_price, balance: balance, description: it.description });
     })
   }
   else if (balance > 0) {
     items.forEach(it => {
       audit(getAuditActor(req), 'part paid', 'item', it.id, { paddle: it.paddle_number, item_number: it.item_number, price: it.hammer_price, balance: balance, description: it.description });
     })
   }
   return balance;
  }


module.exports = { audit, recomputeBalanceAndAudit, auditTypes };
