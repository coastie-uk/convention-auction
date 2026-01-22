/**
 * @file        checkAuctionState.js
 * @description Validates that an auction is in one of the allowed states
 * @author      Chris Staples
 * @license     GPL3
 */
/**
 * Middleware: checkAuctionState  ➜  better‑sqlite3 + in‑memory TTL cache
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
 * This flavour is **synchronous** (better‑sqlite3) **and** keeps a tiny
 * per‑process cache so hot endpoints (e.g. bidding) rarely hit SQLite.
 *
 * ▸ Default TTL = 5 s – tweak via the factory’s third argument.
 * ▸ Mutation code **must** `cache.del(auctionId)` after changing
 *   `auctions.state`; otherwise the old state may linger for up to TTL seconds.
 *
 * Usage:
 * ```js
 * const Database = require('better-sqlite3');
 * const db       = new Database('./auction.db', { fileMustExist: true });
 * const logger   = require('../lib/logger');
 *
 * const checkAuctionState = require('./middleware/checkAuctionState')(
 *   db,
 *   logger,
 *   { ttlSeconds: 5 }   // optional – default is 5
 * );
 *
 * router.post(
 *   '/auctions/:auctionId/bid',
 *   checkAuctionState(['OPEN', 'IN_PROGRESS']),
 *   bidController.placeBid,
 * );
 * ```
 *
 * To invalidate after state‑changing commands:
 * ```js
 * auctionStateCache.del(auctionId);  // exported helper (see bottom)
 * ```
 * ---------------------------------------------------------------------------
 */

/* eslint-disable node/no-sync */
const NodeCache = require('node-cache');

/**
 * Factory that injects the shared better‑sqlite3 Database instance **and**
 * sets up a per‑process NodeCache.
 *
 * @param {import('better-sqlite3').Database} db – open Database connection.
 * @param {object} [options]
 * @param {number} [options.ttlSeconds=5] – positive int seconds for cache TTL.
 * @param {NodeCache} [options.cache]      – supply a pre‑built cache (tests).
 */
module.exports = (db, options = {}) => {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('checkAuctionState: a better-sqlite3 Database instance is required');
  }

  const {
    ttlSeconds = 5,
    cache: injectedCache,
  } = options;

  if (ttlSeconds <= 0) {
    throw new Error('ttlSeconds must be > 0');
  }

  const {
    logLevels,
    setLogLevel,
    logFromRequest,
    createLogger,
    log
  } = require('../logger');

  // Single cache instance per process (or use the injected one, e.g. for tests)
  const auctionStateCache =
    injectedCache ||
    new NodeCache({ stdTTL: ttlSeconds, checkperiod: Math.max(1, Math.floor(ttlSeconds / 2)) });

  // Prepared statements stay cached for the lifetime of the process.
  const stmtGetAuction = db.prepare('SELECT id, status FROM auctions WHERE id = ?');
  // const stmtGetItemAuction = db.prepare('SELECT auction_id FROM items WHERE item_number = ?');
  const stmtGetItemAuction = db.prepare('SELECT auction_id FROM items WHERE id = ?');
  const stmtCheckConsistency = db.prepare('SELECT auction_id FROM items WHERE id = ? AND auction_id = ?');


  /**
   * @param {string[]} allowedStates – list of permissible states for the route.
   * @returns {import('express').RequestHandler}
   */
  function checkAuctionState(allowedStates) {
    if (!Array.isArray(allowedStates) || allowedStates.length === 0) {
      throw new Error('CAS: allowedStates must be a non-empty array');
    }

    // Normalise to upper‑case strings for comparison
    const allowed = allowedStates.map((s) => String(s).toUpperCase());

    return function (req, res, next) {
      try {
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
          const auctionRow = db.prepare('SELECT id FROM auctions WHERE public_id = ?').get(paramPublicId);

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

        /* 4️⃣ Try cache first (hot path) */
        let auction = auctionStateCache.get(auctionId);

        /* 5️⃣ Hit DB on cache miss */
        if (!auction) {
          auction = stmtGetAuction.get(auctionId);

          if (!auction) {
            //       console.log(`Auction #${auctionId} not found`);
            logFromRequest(req, logLevels.ERROR, `CAS: Auction #${auctionId} not found`);

            return res.status(400).json({ error: 'Auction not found' });
          }

          auctionStateCache.set(auctionId, auction);
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

  /*
   * Expose a helper to mutate/invalidate cache externally (e.g., after UPDATE)
   *   const { checkAuctionState, auctionStateCache } = require(...);
   *   auctionStateCache.del(auctionId);
   */
  checkAuctionState.auctionStateCache = auctionStateCache;

  return checkAuctionState;
};
