/**
 * @file        checkAuctionState.js
 * @description Validates that an auction is in one of the allowed states
 * @author      Chris Staples
 * @license     GPL3
 */
/**
 * Middleware: checkAuctionState
 * ---------------------------------------------------------------------------
 * Validates that an auction is in one of the allowed states **before** letting
 * the request proceed.
 *
 * Identifier precedence (first match wins):
 *   1. `req.params.auctionId`
 *   2. `req.body.auctionId`
 *   3. `req.params.itemNumber`  → resolves auction via the `items` table
 * 
 * Where both auction and id appear, a check is made that the item belongs in the auction
 *
 * ---------------------------------------------------------------------------
 */
const db = require('../db');

  const {
    logLevels,
    setLogLevel,
    logFromRequest,
    createLogger,
    log
  } = require('../logger');

  // Prepared statements stay cached until the DB connection is reopened.
  let stmtGetAuction;
  let stmtGetItemAuction;
  let stmtCheckConsistency;
  let stmtGetAuctionByPublicId;
  let lastConnectionId = null;

  function prepareStatements() {
    stmtGetAuction = db.prepare('SELECT id, status FROM auctions WHERE id = ?');
    stmtGetItemAuction = db.prepare('SELECT auction_id FROM items WHERE id = ?');
    stmtCheckConsistency = db.prepare('SELECT auction_id FROM items WHERE id = ? AND auction_id = ?');
    stmtGetAuctionByPublicId = db.prepare('SELECT id FROM auctions WHERE public_id = ?');
    lastConnectionId = typeof db.getConnectionId === 'function' ? db.getConnectionId() : lastConnectionId;
  }

  function ensureStatements() {
    if (!stmtGetAuction) {
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



  function checkAuctionState(allowedStates) {
    if (!Array.isArray(allowedStates) || allowedStates.length === 0) {
      throw new Error('CAS: allowedStates must be a non-empty array');
    }

    // Normalise to upper‑case strings for comparison
    const allowed = allowedStates.map((s) => String(s).toUpperCase());

    return function (req, res, next) {
      try {
        ensureStatements();

        /* 1️⃣ Extract possible identifiers */

        const { auctionId: paramAuctionId, id } = req.params ?? {};
        const { auctionId: bodyAuctionId } = req.body ?? {};

        // Sometimes we used this form too.....
        const { auction_id: bodyAuctionIdAlt } = req.body ?? {};

        const { publicId: paramPublicId } = req.params ?? {};

        // set auction id from the inputs
        let auctionId = paramAuctionId || bodyAuctionId || bodyAuctionIdAlt;

        // if both item ID and auction have showed up, check that the item actually belongs to the auction
        if (auctionId && id) {
          const itemValid = stmtCheckConsistency.get(id, auctionId);

          if (!itemValid) {
            logFromRequest(req, logLevels.ERROR, `CAS: Item #${id} is not part of auction ${auctionId}`);
            return res.status(400).json({ error: 'Item and auction mismatch' });
          }
          auctionId = itemValid.auction_id;
        }

        /* 2️⃣ Resolve via itemNumber → auction_id (if needed) */
        else if (!auctionId && id) {
          logFromRequest(req, logLevels.DEBUG, `CAS: Looking up item #${id} to get aucton ID`);
          const itemRow = stmtGetItemAuction.get(id);

          if (!itemRow) {
            logFromRequest(req, logLevels.ERROR, `CAS: Item #${id} not found whilst resolving auction id`);
            return res.status(400).json({ error: 'Item not found' });
          }
          logFromRequest(req, logLevels.DEBUG, `CAS: Resolved item #${id} to auction id ${itemRow.auction_id}`);
          auctionId = itemRow.auction_id;
        }
        // 2️⃣ Resolve via public ID → auction_id (if needed)
        else if (!auctionId && paramPublicId) {
          logFromRequest(req, logLevels.DEBUG, `CAS: Looking up auction with public id ${paramPublicId} to get auction ID`);
          const auctionRow = stmtGetAuctionByPublicId.get(paramPublicId);

          if (!auctionRow) {
            logFromRequest(req, logLevels.ERROR, `CAS: Auction with public id ${paramPublicId} not found whilst resolving auction id`);
            return res.status(400).json({ error: 'Auction not found' });
          }
          logFromRequest(req, logLevels.DEBUG, `CAS: Resolved public id ${paramPublicId} to auction id ${auctionRow.id}`);
          auctionId = auctionRow.id;
        }

        /* 3️⃣ Validate we have an ID */
        else if (!auctionId) {
          logFromRequest(req, logLevels.ERROR, `CAS: Unable to determine auction id from request`);
          return res.status(400).json({ error: 'Auction identifier missing' });
        }

          let auction = stmtGetAuction.get(auctionId);
          if (!auction) {
            //       console.log(`Auction #${auctionId} not found`);
            logFromRequest(req, logLevels.ERROR, `CAS: Auction #${auctionId} not found`);

            return res.status(400).json({ error: 'Auction not found' });
          }

        /* 6️⃣ Check state compliance */
        const currentState = String(auction.status).toUpperCase();
        if (!allowed.includes(currentState)) {
          // console.log(
          //   `Auction #${auctionId} is ${currentState}; requires one of ${allowed.join(', ')}`
          // );
          logFromRequest(req, logLevels.WARN, `CAS: Action blocked: Auction #${auctionId} state is ${currentState}; requires one of ${allowed.join(', ')}`);

          return res.status(400).json({
            error: `Operation requires auction to be in state(s): ${allowed.join(', ')}`,
          });
        }

        /* 7️⃣ All good – stash auction for downstream handlers and continue */
        logFromRequest(req, logLevels.DEBUG, `CAS: State check passed for auction #${auctionId} (state ${currentState})`);


        req.auction = auction;
        return next();
      } catch (err) {
        logFromRequest(req, logLevels.ERROR, `CAS: checkAuctionState middleware error` + err);

        //    console.log('checkAuctionState middleware error', err);
        return next(err);
      }
    };
  }
module.exports = { checkAuctionState };

