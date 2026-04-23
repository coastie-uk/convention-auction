const db = require('./db');
const { audit } = require('./middleware/audit');
const { getAuditActor } = require('./users');

const SUMMARY_MODE = 'summary';
const VERBOSE_MODE = 'verbose';
const RECOVERY_PADDLE_START = 900000;
const SQLITE_SENTINEL = 2147483647;

function normaliseMode(mode) {
  return mode === SUMMARY_MODE ? SUMMARY_MODE : VERBOSE_MODE;
}

function asPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function asPositiveNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function toInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  return numeric;
}

function buildContext() {
  const auctions = db.all(`
    SELECT id, short_name, full_name, status
    FROM auctions
    ORDER BY id ASC
  `);
  const items = db.all(`
    SELECT id, auction_id, item_number, description, contributor, artist, photo,
           winning_bidder_id, hammer_price, collected_at, last_bid_update,
           COALESCE(is_deleted, 0) AS is_deleted
    FROM items
    ORDER BY id ASC
  `);
  const bidders = db.all(`
    SELECT id, auction_id, paddle_number, name, ready_for_collection, ready_fingerprint, ready_updated_at
    FROM bidders
    ORDER BY id ASC
  `);
  const payments = db.all(`
    SELECT id, bidder_id, amount, donation_amount, method, note, reverses_payment_id,
           provider, provider_txn_id, intent_id, currency
    FROM payments
    ORDER BY id ASC
  `);
  const paymentIntents = db.all(`
    SELECT intent_id, bidder_id, amount_minor, donation_minor, status, channel,
           sumup_checkout_id, created_at, expires_at, note
    FROM payment_intents
    ORDER BY intent_id ASC
  `);

  const auctionsById = new Map(auctions.map((auction) => [Number(auction.id), auction]));
  const itemsByAuctionId = new Map();
  const activeItemsByAuctionId = new Map();
  const biddersById = new Map(bidders.map((bidder) => [Number(bidder.id), bidder]));
  const biddersByAuctionId = new Map();
  const paymentsById = new Map(payments.map((payment) => [Number(payment.id), payment]));
  const paymentIntentsById = new Map(paymentIntents.map((intent) => [String(intent.intent_id), intent]));
  const soldItemCountsByBidderId = new Map();

  for (const item of items) {
    const auctionId = toInteger(item.auction_id);
    if (auctionId !== null) {
      if (!itemsByAuctionId.has(auctionId)) itemsByAuctionId.set(auctionId, []);
      itemsByAuctionId.get(auctionId).push(item);
      if (Number(item.is_deleted || 0) !== 1) {
        if (!activeItemsByAuctionId.has(auctionId)) activeItemsByAuctionId.set(auctionId, []);
        activeItemsByAuctionId.get(auctionId).push(item);
      }
    }

    const bidderId = toInteger(item.winning_bidder_id);
    const hammerPrice = asPositiveNumber(item.hammer_price);
    const bidder = bidderId !== null ? biddersById.get(bidderId) : null;
    if (Number(item.is_deleted || 0) !== 1 && bidder && hammerPrice !== null && toInteger(bidder.auction_id) === auctionId) {
      soldItemCountsByBidderId.set(bidderId, (soldItemCountsByBidderId.get(bidderId) || 0) + 1);
    }
  }

  for (const bidder of bidders) {
    const auctionId = toInteger(bidder.auction_id);
    if (auctionId !== null) {
      if (!biddersByAuctionId.has(auctionId)) biddersByAuctionId.set(auctionId, []);
      biddersByAuctionId.get(auctionId).push(bidder);
    }
  }

  return {
    auctions,
    items,
    bidders,
    payments,
    paymentIntents,
    auctionsById,
    itemsByAuctionId,
    activeItemsByAuctionId,
    biddersById,
    biddersByAuctionId,
    paymentsById,
    paymentIntentsById,
    soldItemCountsByBidderId
  };
}

function createCheck({ code, title, priority, severity }) {
  return {
    code,
    title,
    priority,
    severity,
    status: 'pass',
    problem_count: 0,
    fixable_count: 0,
    problems: []
  };
}

function addProblem(check, problem) {
  check.status = 'fail';
  check.problem_count += 1;
  if (problem.fixable) {
    check.fixable_count += 1;
  }
  check.problems.push(problem);
}

function createProblem({
  code,
  severity,
  entityType,
  entityId,
  auctionId = null,
  message,
  details = {},
  fixable = false,
  fixAction = null
}) {
  return {
    code,
    severity,
    entity_type: entityType,
    entity_id: entityId,
    auction_id: auctionId,
    message,
    details,
    fixable,
    fix_action: fixAction
  };
}

function getSqliteMessage(row) {
  if (!row || typeof row !== 'object') return '';
  const firstValue = Object.values(row)[0];
  return String(firstValue ?? '');
}

function summariseCounts(problems) {
  const counts = { error: 0, warning: 0 };
  for (const problem of problems) {
    if (problem.severity === 'warning') {
      counts.warning += 1;
    } else {
      counts.error += 1;
    }
  }
  return counts;
}

function collectIntegrityChecks(mode = VERBOSE_MODE) {
  const normalisedMode = normaliseMode(mode);
  const ctx = buildContext();
  const checks = [];
  const problems = [];
  const addCheck = (check) => {
    checks.push(check);
    problems.push(...check.problems);
  };

  const missingAuctionCheck = createCheck({
    code: 'item_missing_auction',
    title: 'Items linked to missing auctions',
    priority: 'workflow',
    severity: 'error'
  });
  for (const item of ctx.items) {
    const auctionId = toInteger(item.auction_id);
    if (auctionId === null || !ctx.auctionsById.has(auctionId)) {
      addProblem(missingAuctionCheck, createProblem({
        code: 'item_missing_auction',
        severity: 'error',
        entityType: 'item',
        entityId: Number(item.id),
        auctionId,
        message: `Item ${item.id} references auction ${item.auction_id}, which does not exist.`,
        details: {
          item_number: item.item_number,
          description: item.description || ''
        }
      }));
    }
  }
  addCheck(missingAuctionCheck);

  const invalidItemNumberCheck = createCheck({
    code: 'item_number_invalid',
    title: 'Items with invalid item numbers',
    priority: 'workflow',
    severity: 'error'
  });
  const sequenceCheck = createCheck({
    code: 'item_number_sequence_broken',
    title: 'Auctions with broken item numbering sequences',
    priority: 'workflow',
    severity: 'error'
  });

  for (const auction of ctx.auctions) {
    const auctionId = Number(auction.id);
    const items = ctx.activeItemsByAuctionId.get(auctionId) || [];
    const invalidItems = items.filter((item) => asPositiveInteger(item.item_number) === null);
    for (const item of invalidItems) {
      addProblem(invalidItemNumberCheck, createProblem({
        code: 'item_number_invalid',
        severity: 'error',
        entityType: 'item',
        entityId: Number(item.id),
        auctionId,
        message: `Item ${item.id} has invalid item number ${item.item_number}.`,
        details: {
          item_number: item.item_number,
          description: item.description || ''
        },
        fixable: true,
        fixAction: {
          type: 'renumber_auction_items',
          auction_id: auctionId
        }
      }));
    }

    if (items.length === 0) continue;

    const rawNumbers = items.map((item) => asPositiveInteger(item.item_number));
    const validNumbers = rawNumbers.filter((value) => value !== null).sort((a, b) => a - b);
    const duplicates = [];
    const duplicateTracker = new Set();
    for (let index = 1; index < validNumbers.length; index += 1) {
      if (validNumbers[index] === validNumbers[index - 1] && !duplicateTracker.has(validNumbers[index])) {
        duplicateTracker.add(validNumbers[index]);
        duplicates.push(validNumbers[index]);
      }
    }
    const missingNumbers = [];
    for (let expected = 1; expected <= items.length; expected += 1) {
      if (!validNumbers.includes(expected)) missingNumbers.push(expected);
    }
    const hasSequenceProblem = invalidItems.length > 0 || duplicates.length > 0 || missingNumbers.length > 0;
    if (!hasSequenceProblem) continue;

    addProblem(sequenceCheck, createProblem({
      code: 'item_number_sequence_broken',
      severity: 'error',
      entityType: 'auction',
      entityId: auctionId,
      auctionId,
      message: `Auction ${auction.short_name || auctionId} has gaps or duplicates in item numbering.`,
      details: {
        duplicate_numbers: duplicates,
        missing_numbers: missingNumbers,
        item_count: items.length
      },
      fixable: true,
      fixAction: {
        type: 'renumber_auction_items',
        auction_id: auctionId
      }
    }));
  }
  addCheck(invalidItemNumberCheck);
  addCheck(sequenceCheck);

  const salePairCheck = createCheck({
    code: 'item_sale_pair_broken',
    title: 'Sold items with broken bidder or hammer pairing',
    priority: 'workflow',
    severity: 'error'
  });
  const bidderMismatchCheck = createCheck({
    code: 'item_bidder_auction_mismatch',
    title: 'Sold items linked to bidders from another auction',
    priority: 'workflow',
    severity: 'error'
  });
  const collectedWithoutSaleCheck = createCheck({
    code: 'item_collected_without_sale',
    title: 'Collected items without a valid sale',
    priority: 'workflow',
    severity: 'error'
  });
  const deletedWithSaleCheck = createCheck({
    code: 'deleted_item_has_sale_or_collection',
    title: 'Deleted items with sale or collection data',
    priority: 'workflow',
    severity: 'error'
  });

  for (const item of ctx.items) {
    const itemId = Number(item.id);
    const auctionId = toInteger(item.auction_id);
    const auctionExists = auctionId !== null && ctx.auctionsById.has(auctionId);
    const bidderId = toInteger(item.winning_bidder_id);
    const bidder = bidderId !== null ? ctx.biddersById.get(bidderId) : null;
    const hammerPrice = asPositiveNumber(item.hammer_price);
    const hasAnyHammer = item.hammer_price !== null && item.hammer_price !== undefined && String(item.hammer_price) !== '';
    const hasValidSale = bidder && hammerPrice !== null && toInteger(bidder.auction_id) === auctionId;

    if (hammerPrice !== null && (!bidderId || !bidder)) {
      addProblem(salePairCheck, createProblem({
        code: 'item_sale_pair_broken',
        severity: 'error',
        entityType: 'item',
        entityId: itemId,
        auctionId,
        message: bidderId
          ? `Item ${itemId} has hammer price ${item.hammer_price} but bidder ${item.winning_bidder_id} is missing.`
          : `Item ${itemId} has hammer price ${item.hammer_price} without a winning bidder.`,
        details: {
          winning_bidder_id: item.winning_bidder_id,
          hammer_price: item.hammer_price,
          description: item.description || ''
        },
        fixable: auctionExists,
        fixAction: auctionExists
          ? {
              type: 'relink_item_with_recovery_bidder',
              item_id: itemId,
              auction_id: auctionId
            }
          : null
      }));
    } else if (bidderId && !hasValidSale && !bidder) {
      addProblem(salePairCheck, createProblem({
        code: 'item_sale_pair_broken',
        severity: 'error',
        entityType: 'item',
        entityId: itemId,
        auctionId,
        message: `Item ${itemId} has bidder ${item.winning_bidder_id} but does not have a valid hammer price.`,
        details: {
          winning_bidder_id: item.winning_bidder_id,
          hammer_price: item.hammer_price,
          description: item.description || ''
        }
      }));
    } else if (bidderId && bidder && hammerPrice === null && hasAnyHammer) {
      addProblem(salePairCheck, createProblem({
        code: 'item_sale_pair_broken',
        severity: 'error',
        entityType: 'item',
        entityId: itemId,
        auctionId,
        message: `Item ${itemId} has bidder ${item.winning_bidder_id} but invalid hammer price ${item.hammer_price}.`,
        details: {
          winning_bidder_id: item.winning_bidder_id,
          hammer_price: item.hammer_price,
          description: item.description || ''
        }
      }));
    } else if (bidderId && bidder && hammerPrice === null && !hasAnyHammer) {
      addProblem(salePairCheck, createProblem({
        code: 'item_sale_pair_broken',
        severity: 'error',
        entityType: 'item',
        entityId: itemId,
        auctionId,
        message: `Item ${itemId} has bidder ${item.winning_bidder_id} but no hammer price.`,
        details: {
          winning_bidder_id: item.winning_bidder_id,
          hammer_price: item.hammer_price,
          description: item.description || ''
        }
      }));
    }

    if (bidder && auctionId !== null && toInteger(bidder.auction_id) !== auctionId) {
      addProblem(bidderMismatchCheck, createProblem({
        code: 'item_bidder_auction_mismatch',
        severity: 'error',
        entityType: 'item',
        entityId: itemId,
        auctionId,
        message: `Item ${itemId} belongs to auction ${auctionId} but bidder ${bidder.id} belongs to auction ${bidder.auction_id}.`,
        details: {
          winning_bidder_id: bidder.id,
          bidder_auction_id: bidder.auction_id,
          hammer_price: item.hammer_price,
          description: item.description || ''
        },
        fixable: auctionExists && hammerPrice !== null,
        fixAction: auctionExists && hammerPrice !== null
          ? {
              type: 'relink_item_with_recovery_bidder',
              item_id: itemId,
              auction_id: auctionId
            }
          : null
      }));
    }

    if (item.collected_at && !hasValidSale) {
      addProblem(collectedWithoutSaleCheck, createProblem({
        code: 'item_collected_without_sale',
        severity: 'error',
        entityType: 'item',
        entityId: itemId,
        auctionId,
        message: `Item ${itemId} is marked collected without a valid completed sale.`,
        details: {
          collected_at: item.collected_at,
          winning_bidder_id: item.winning_bidder_id,
          hammer_price: item.hammer_price
        },
        fixable: true,
        fixAction: {
          type: 'clear_item_collection',
          item_id: itemId
        }
      }));
    }

    if (Number(item.is_deleted || 0) === 1 && (bidderId !== null || hasAnyHammer || item.collected_at)) {
      addProblem(deletedWithSaleCheck, createProblem({
        code: 'deleted_item_has_sale_or_collection',
        severity: 'error',
        entityType: 'item',
        entityId: itemId,
        auctionId,
        message: `Deleted item ${itemId} still has sale or collection data.`,
        details: {
          winning_bidder_id: item.winning_bidder_id,
          hammer_price: item.hammer_price,
          collected_at: item.collected_at
        }
      }));
    }
  }
  addCheck(salePairCheck);
  addCheck(bidderMismatchCheck);
  addCheck(collectedWithoutSaleCheck);
  addCheck(deletedWithSaleCheck);

  const liveCompleteCheck = createCheck({
    code: 'auction_live_but_complete',
    title: 'Live auctions with no unsold items',
    priority: 'workflow',
    severity: 'error'
  });
  for (const auction of ctx.auctions) {
    const auctionId = Number(auction.id);
    const items = ctx.activeItemsByAuctionId.get(auctionId) || [];
    const unsoldCount = items.filter((item) => item.hammer_price === null || item.hammer_price === undefined).length;
    if (String(auction.status) === 'live' && items.length > 0 && unsoldCount === 0) {
      addProblem(liveCompleteCheck, createProblem({
        code: 'auction_live_but_complete',
        severity: 'error',
        entityType: 'auction',
        entityId: auctionId,
        auctionId,
        message: `Auction ${auction.short_name || auctionId} is still live even though all items have hammer prices.`,
        details: {
          status: auction.status,
          item_count: items.length
        },
        fixable: true,
        fixAction: {
          type: 'set_auction_settlement',
          auction_id: auctionId
        }
      }));
    }
  }
  addCheck(liveCompleteCheck);

  const readyCheck = createCheck({
    code: 'bidder_ready_without_sold_items',
    title: 'Ready bidders without sold items',
    priority: 'workflow',
    severity: 'error'
  });
  for (const bidder of ctx.bidders) {
    const bidderId = Number(bidder.id);
    if (Number(bidder.ready_for_collection) === 1 && (ctx.soldItemCountsByBidderId.get(bidderId) || 0) === 0) {
      addProblem(readyCheck, createProblem({
        code: 'bidder_ready_without_sold_items',
        severity: 'error',
        entityType: 'bidder',
        entityId: bidderId,
        auctionId: toInteger(bidder.auction_id),
        message: `Bidder ${bidderId} is marked ready for collection but has no sold items in this auction.`,
        details: {
          paddle_number: bidder.paddle_number,
          ready_fingerprint: bidder.ready_fingerprint || ''
        },
        fixable: true,
        fixAction: {
          type: 'clear_bidder_ready',
          bidder_id: bidderId,
          auction_id: toInteger(bidder.auction_id)
        }
      }));
    }
  }
  addCheck(readyCheck);

  const paymentMissingBidderCheck = createCheck({
    code: 'payment_missing_bidder',
    title: 'Payments linked to missing bidders',
    priority: 'workflow',
    severity: 'error'
  });
  const paymentIntentMismatchCheck = createCheck({
    code: 'payment_intent_bidder_mismatch',
    title: 'Payments whose bidder disagrees with the payment intent',
    priority: 'workflow',
    severity: 'error'
  });
  const paymentReversalCheck = createCheck({
    code: 'payment_reversal_invalid',
    title: 'Invalid payment reversal chains',
    priority: 'workflow',
    severity: 'error'
  });
  const missingIntentBidderCheck = createCheck({
    code: 'payment_intent_missing_bidder',
    title: 'Payment intents linked to missing bidders',
    priority: 'workflow',
    severity: 'error'
  });

  for (const payment of ctx.payments) {
    const paymentId = Number(payment.id);
    const bidderId = toInteger(payment.bidder_id);
    const bidder = bidderId !== null ? ctx.biddersById.get(bidderId) : null;
    const intentId = payment.intent_id ? String(payment.intent_id) : null;
    const intent = intentId ? ctx.paymentIntentsById.get(intentId) : null;
    const intentBidderId = intent ? toInteger(intent.bidder_id) : null;
    const intentBidder = intentBidderId !== null ? ctx.biddersById.get(intentBidderId) : null;

    if (!bidder) {
      addProblem(paymentMissingBidderCheck, createProblem({
        code: 'payment_missing_bidder',
        severity: 'error',
        entityType: 'payment',
        entityId: paymentId,
        auctionId: intentBidder ? toInteger(intentBidder.auction_id) : null,
        message: `Payment ${paymentId} references missing bidder ${payment.bidder_id}.`,
        details: {
          bidder_id: payment.bidder_id,
          intent_id: payment.intent_id || null,
          amount: payment.amount
        },
        fixable: Boolean(intent && intentBidder),
        fixAction: intent && intentBidder
          ? {
              type: 'relink_payment_bidder',
              payment_id: paymentId,
              bidder_id: intentBidderId
            }
          : null
      }));
    }

    if (intent && intentBidderId !== null && bidderId !== null && bidderId !== intentBidderId) {
      addProblem(paymentIntentMismatchCheck, createProblem({
        code: 'payment_intent_bidder_mismatch',
        severity: 'error',
        entityType: 'payment',
        entityId: paymentId,
        auctionId: intentBidder ? toInteger(intentBidder.auction_id) : null,
        message: `Payment ${paymentId} points to bidder ${payment.bidder_id} but intent ${intent.intent_id} points to bidder ${intent.bidder_id}.`,
        details: {
          bidder_id: payment.bidder_id,
          intent_id: intent.intent_id,
          intent_bidder_id: intent.bidder_id
        },
        fixable: Boolean(intentBidder),
        fixAction: intentBidder
          ? {
              type: 'relink_payment_bidder',
              payment_id: paymentId,
              bidder_id: intentBidderId
            }
          : null
      }));
    }

    if (payment.reverses_payment_id !== null && payment.reverses_payment_id !== undefined) {
      const targetId = toInteger(payment.reverses_payment_id);
      const reversalTarget = targetId !== null ? ctx.paymentsById.get(targetId) : null;
      const reasons = [];
      if (!reversalTarget) reasons.push('missing_target');
      if (targetId === paymentId) reasons.push('self_reference');
      if (Number(payment.amount) > 0) reasons.push('positive_reversal_amount');
      if (reasons.length > 0) {
        addProblem(paymentReversalCheck, createProblem({
          code: 'payment_reversal_invalid',
          severity: 'error',
          entityType: 'payment',
          entityId: paymentId,
          auctionId: bidder ? toInteger(bidder.auction_id) : null,
          message: `Payment ${paymentId} has an invalid reversal definition.`,
          details: {
            reverses_payment_id: payment.reverses_payment_id,
            reasons
          }
        }));
      }
    }
  }

  for (const intent of ctx.paymentIntents) {
    const bidderId = toInteger(intent.bidder_id);
    if (bidderId === null || !ctx.biddersById.has(bidderId)) {
      addProblem(missingIntentBidderCheck, createProblem({
        code: 'payment_intent_missing_bidder',
        severity: 'error',
        entityType: 'payment_intent',
        entityId: String(intent.intent_id),
        auctionId: null,
        message: `Payment intent ${intent.intent_id} references missing bidder ${intent.bidder_id}.`,
        details: {
          bidder_id: intent.bidder_id,
          status: intent.status,
          channel: intent.channel
        }
      }));
    }
  }
  addCheck(paymentMissingBidderCheck);
  addCheck(paymentIntentMismatchCheck);
  addCheck(paymentReversalCheck);
  addCheck(missingIntentBidderCheck);

  const duplicatePaddleCheck = createCheck({
    code: 'duplicate_bidder_paddle',
    title: 'Duplicate bidder paddles inside an auction',
    priority: 'warning',
    severity: 'warning'
  });
  const paddleGroups = new Map();
  for (const bidder of ctx.bidders) {
    const auctionId = toInteger(bidder.auction_id);
    const paddleNumber = asPositiveInteger(bidder.paddle_number);
    if (auctionId === null || paddleNumber === null) continue;
    const key = `${auctionId}:${paddleNumber}`;
    if (!paddleGroups.has(key)) paddleGroups.set(key, []);
    paddleGroups.get(key).push(Number(bidder.id));
  }
  for (const [key, bidderIds] of paddleGroups.entries()) {
    if (bidderIds.length < 2) continue;
    const [auctionId, paddleNumber] = key.split(':').map((value) => Number(value));
    addProblem(duplicatePaddleCheck, createProblem({
      code: 'duplicate_bidder_paddle',
      severity: 'warning',
      entityType: 'auction',
      entityId: auctionId,
      auctionId,
      message: `Auction ${auctionId} has duplicate paddle number ${paddleNumber}.`,
      details: {
        paddle_number: paddleNumber,
        bidder_ids: bidderIds
      }
    }));
  }
  addCheck(duplicatePaddleCheck);

  const duplicateProviderCheck = createCheck({
    code: 'duplicate_provider_payment_ref',
    title: 'Duplicate provider payment references',
    priority: 'warning',
    severity: 'warning'
  });
  const providerGroups = new Map();
  const registerProviderDuplicate = (provider, refValue, refType, paymentId) => {
    const normalisedProvider = String(provider || '').trim();
    const normalisedRef = String(refValue || '').trim();
    if (!normalisedProvider || !normalisedRef) return;
    const key = `${refType}:${normalisedProvider}:${normalisedRef}`;
    if (!providerGroups.has(key)) providerGroups.set(key, []);
    providerGroups.get(key).push(paymentId);
  };
  for (const payment of ctx.payments) {
    registerProviderDuplicate(payment.provider, payment.provider_txn_id, 'provider_txn_id', Number(payment.id));
    registerProviderDuplicate(payment.provider, payment.intent_id, 'intent_id', Number(payment.id));
  }
  for (const [key, paymentIds] of providerGroups.entries()) {
    if (paymentIds.length < 2) continue;
    const [refType, provider, refValue] = key.split(':');
    addProblem(duplicateProviderCheck, createProblem({
      code: 'duplicate_provider_payment_ref',
      severity: 'warning',
      entityType: 'payment',
      entityId: paymentIds[0],
      auctionId: null,
      message: `Provider ${provider} has duplicate ${refType} reference ${refValue}.`,
      details: {
        provider,
        reference_type: refType,
        reference_value: refValue,
        payment_ids: paymentIds
      }
    }));
  }
  addCheck(duplicateProviderCheck);

  const quickCheck = createCheck({
    code: 'sqlite_quick_check',
    title: 'SQLite quick_check',
    priority: 'engine',
    severity: 'error'
  });
  const quickRows = db.all('PRAGMA quick_check');
  const quickMessages = quickRows.map(getSqliteMessage).filter(Boolean);
  const quickFailures = quickMessages.filter((message) => message.toLowerCase() !== 'ok');
  for (const message of quickFailures) {
    addProblem(quickCheck, createProblem({
      code: 'sqlite_quick_check',
      severity: 'error',
      entityType: 'database',
      entityId: 0,
      message: `SQLite quick_check reported: ${message}`,
      details: { result: message }
    }));
  }
  addCheck(quickCheck);

  if (normalisedMode === VERBOSE_MODE) {
    const integrityCheck = createCheck({
      code: 'sqlite_integrity_check',
      title: 'SQLite integrity_check',
      priority: 'engine',
      severity: 'error'
    });
    const integrityRows = db.all('PRAGMA integrity_check');
    const integrityMessages = integrityRows.map(getSqliteMessage).filter(Boolean);
    const integrityFailures = integrityMessages.filter((message) => message.toLowerCase() !== 'ok');
    for (const message of integrityFailures) {
      addProblem(integrityCheck, createProblem({
        code: 'sqlite_integrity_check',
        severity: 'error',
        entityType: 'database',
        entityId: 0,
        message: `SQLite integrity_check reported: ${message}`,
        details: { result: message }
      }));
    }
    addCheck(integrityCheck);

    const foreignKeyCheck = createCheck({
      code: 'sqlite_foreign_key_check',
      title: 'SQLite foreign_key_check',
      priority: 'engine',
      severity: 'warning'
    });
    const foreignKeyRows = db.all('PRAGMA foreign_key_check');
    for (const row of foreignKeyRows) {
      addProblem(foreignKeyCheck, createProblem({
        code: 'sqlite_foreign_key_check',
        severity: 'warning',
        entityType: 'database',
        entityId: 0,
        message: `SQLite foreign_key_check reported a violation in table ${row.table}.`,
        details: row
      }));
    }
    addCheck(foreignKeyCheck);
  }

  const problemsBySeverity = summariseCounts(problems);
  const fixableProblemCount = problems.filter((problem) => problem.fixable).length;
  const hasProblems = problems.length > 0;
  const summaryText = hasProblems
    ? `Integrity check found ${problems.length} problem(s): ${problemsBySeverity.error} error(s), ${problemsBySeverity.warning} warning(s).`
    : 'Integrity check found no problems.';

  const result = {
    ok: true,
    mode: normalisedMode,
    has_problems: hasProblems,
    problem_count: problems.length,
    problems_by_severity: problemsBySeverity,
    fixable_problem_count: fixableProblemCount,
    check_count: checks.length,
    summary_text: summaryText
  };

  if (normalisedMode === VERBOSE_MODE) {
    result.checks = checks;
    result.problems = problems;
  }

  return result;
}

function listRenumberRows(auctionId) {
  db.run(
    `UPDATE items
        SET item_number = NULL
      WHERE auction_id = ?
        AND COALESCE(is_deleted, 0) = 1
        AND item_number IS NOT NULL`,
    [auctionId]
  );
  return db.all(
    `SELECT id, item_number
     FROM items
     WHERE auction_id = ?
       AND COALESCE(is_deleted, 0) = 0
     ORDER BY COALESCE(item_number, ?), id`,
    [auctionId, SQLITE_SENTINEL]
  );
}

function renumberAuctionItems(auctionId) {
  const rows = listRenumberRows(auctionId);
  const updateStmt = db.prepare('UPDATE items SET item_number = ? WHERE id = ?');
  rows.forEach((row, index) => {
    updateStmt.run(index + 1, row.id);
  });
  return rows.length;
}

function nextRecoveryPaddle(auctionId) {
  const row = db.get(
    'SELECT MAX(paddle_number) AS max_paddle FROM bidders WHERE auction_id = ? AND paddle_number >= ?',
    [auctionId, RECOVERY_PADDLE_START]
  );
  const currentMax = asPositiveInteger(row?.max_paddle);
  return currentMax !== null ? currentMax + 1 : RECOVERY_PADDLE_START;
}

function createRecoveryBidderForItem(itemId, auctionId) {
  const item = db.get(
    'SELECT id, description FROM items WHERE id = ? AND auction_id = ?',
    [itemId, auctionId]
  );
  if (!item) {
    throw new Error(`Cannot create recovery bidder for missing item ${itemId} in auction ${auctionId}.`);
  }
  const paddleNumber = nextRecoveryPaddle(auctionId);
  const name = `[Recovered] Missing bidder for item ${itemId}`;
  const info = db.run(
    `INSERT INTO bidders (paddle_number, name, auction_id, created_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))`,
    [paddleNumber, name, auctionId]
  );
  return {
    bidder_id: Number(info.lastInsertRowid),
    paddle_number: paddleNumber,
    name
  };
}

function buildFixActions(verboseResult) {
  const actions = [];
  const seen = new Set();

  for (const problem of verboseResult.problems || []) {
    if (!problem.fixable || !problem.fix_action) continue;
    const fixAction = problem.fix_action;
    const key = `${fixAction.type}:${fixAction.auction_id ?? ''}:${fixAction.item_id ?? ''}:${fixAction.bidder_id ?? ''}:${fixAction.payment_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push(fixAction);
  }

  return actions;
}

function applyIntegrityFixes(req) {
  const initialVerbose = collectIntegrityChecks(VERBOSE_MODE);
  const actions = buildFixActions(initialVerbose);
  const appliedFixes = [];
  const auditUser = getAuditActor(req);

  if (actions.length > 0) {
    const transaction = db.transaction((fixActions) => {
      for (const action of fixActions) {
        if (action.type === 'renumber_auction_items') {
          const changed = renumberAuctionItems(action.auction_id);
          appliedFixes.push({
            type: action.type,
            auction_id: action.auction_id,
            message: `Renumbered ${changed} item(s) in auction ${action.auction_id}.`
          });
          audit(auditUser, 'integrity renumber items', 'auction', action.auction_id, {
            auction_id: action.auction_id,
            item_count: changed
          });
          continue;
        }

        if (action.type === 'relink_item_with_recovery_bidder') {
          const item = db.get(
            'SELECT id, auction_id, winning_bidder_id, hammer_price FROM items WHERE id = ?',
            [action.item_id]
          );
          if (!item) continue;
          const recovery = createRecoveryBidderForItem(action.item_id, action.auction_id);
          db.run(
            'UPDATE items SET winning_bidder_id = ? WHERE id = ?',
            [recovery.bidder_id, action.item_id]
          );
          appliedFixes.push({
            type: action.type,
            item_id: action.item_id,
            auction_id: action.auction_id,
            bidder_id: recovery.bidder_id,
            message: `Created recovery bidder ${recovery.paddle_number} and relinked item ${action.item_id}.`
          });
          audit(auditUser, 'integrity recovery bidder', 'bidder', recovery.bidder_id, {
            auction_id: action.auction_id,
            paddle_number: recovery.paddle_number,
            source_item_id: action.item_id
          });
          audit(auditUser, 'integrity relink item bidder', 'item', action.item_id, {
            auction_id: action.auction_id,
            previous_winning_bidder_id: item.winning_bidder_id,
            new_winning_bidder_id: recovery.bidder_id,
            hammer_price: item.hammer_price
          });
          continue;
        }

        if (action.type === 'clear_item_collection') {
          db.run('UPDATE items SET collected_at = NULL WHERE id = ?', [action.item_id]);
          appliedFixes.push({
            type: action.type,
            item_id: action.item_id,
            message: `Cleared collected_at for item ${action.item_id}.`
          });
          audit(auditUser, 'integrity clear item collection', 'item', action.item_id, {
            item_id: action.item_id
          });
          continue;
        }

        if (action.type === 'set_auction_settlement') {
          db.run(`UPDATE auctions SET status = 'settlement' WHERE id = ?`, [action.auction_id]);
          appliedFixes.push({
            type: action.type,
            auction_id: action.auction_id,
            message: `Moved auction ${action.auction_id} to settlement.`
          });
          audit(auditUser, 'integrity set settlement', 'auction', action.auction_id, {
            auction_id: action.auction_id,
            status: 'settlement'
          });
          continue;
        }

        if (action.type === 'clear_bidder_ready') {
          db.run(
            `UPDATE bidders
             SET ready_for_collection = 0,
                 ready_fingerprint = NULL,
                 ready_updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
             WHERE id = ?`,
            [action.bidder_id]
          );
          appliedFixes.push({
            type: action.type,
            bidder_id: action.bidder_id,
            auction_id: action.auction_id,
            message: `Cleared ready-for-collection state for bidder ${action.bidder_id}.`
          });
          audit(auditUser, 'integrity clear bidder ready', 'bidder', action.bidder_id, {
            bidder_id: action.bidder_id,
            auction_id: action.auction_id
          });
          continue;
        }

        if (action.type === 'relink_payment_bidder') {
          const payment = db.get('SELECT bidder_id, intent_id FROM payments WHERE id = ?', [action.payment_id]);
          if (!payment) continue;
          db.run('UPDATE payments SET bidder_id = ? WHERE id = ?', [action.bidder_id, action.payment_id]);
          appliedFixes.push({
            type: action.type,
            payment_id: action.payment_id,
            bidder_id: action.bidder_id,
            message: `Relinked payment ${action.payment_id} to bidder ${action.bidder_id}.`
          });
          audit(auditUser, 'integrity relink payment bidder', 'payment', action.payment_id, {
            payment_id: action.payment_id,
            previous_bidder_id: payment.bidder_id,
            new_bidder_id: action.bidder_id,
            intent_id: payment.intent_id || null
          });
        }
      }
    });

    transaction(actions);
  }

  const rerun = collectIntegrityChecks(VERBOSE_MODE);
  return {
    ok: true,
    applied_fixes: appliedFixes,
    applied_fix_count: appliedFixes.length,
    remaining_problem_count: rerun.problem_count,
    rerun
  };
}

module.exports = {
  SUMMARY_MODE,
  VERBOSE_MODE,
  RECOVERY_PADDLE_START,
  collectIntegrityChecks,
  applyIntegrityFixes
};
