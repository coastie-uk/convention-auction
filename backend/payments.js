// payments.js
// Payment processing via SumUp
// Supports both app deep-link payments and hosted checkouts with webhook and callback handling, and server-side verification.

const paymentProcessorVer = 'SumUp_1.0.0(2025-12-21)';

const express = require('express');
const crypto = require('node:crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { logLevels, logFromRequest, log } = require('./logger');
const { request } = require('undici');
const { authenticateRole } = require('./middleware/authenticateRole');
const { sanitiseText } = require('./middleware/sanitiseText');
const {
  SUMUP_WEB_ENABLED,
  SUMUP_API_KEY,
  SUMUP_MERCHANT_CODE,
  SUMUP_RETURN_URL,
  SUMUP_CARD_PRESENT_ENABLED,
  SUMUP_AFFILIATE_KEY,
  SUMUP_APP_ID,
  SUMUP_CALLBACK_SUCCESS,
  SUMUP_CALLBACK_FAIL,
  PAYMENT_TTL_MIN,
  SUMUP_APP_INDIRECT_ENABLED,
  CURRENCY
} = require('./config');

const toPounds = (minor) => (minor / 100).toFixed(2);

// --- Create Intent (cashier starts payment) ---
const api = express.Router();
api.use(express.json());

const posInt = (x) => Number.isInteger(x) && x > 0;


// API to create a payment intent
// supports three channels: 'hosted' (desktop/QR), 'app' (direct app), 'app-ind' (indirect app via payment request)

api.post('/payments/intents', authenticateRole("cashier"), async (req, res) => {
  try {
   expireStaleIntents();
    const { bidder_id, amount_minor, currency, channel, note } = req.body || {};
    if (!posInt(bidder_id) || !posInt(amount_minor)) return res.status(400).json({ error: 'invalid parameters' });
    const sanitisedNote = sanitiseText(note, 100);
    
    // Check that the requested amount does not exceed the bidder's outstanding balance
    const sums = db.prepare(`
      SELECT
        IFNULL((SELECT SUM(hammer_price) FROM items WHERE winning_bidder_id = ?), 0) AS lots_total,
        IFNULL((SELECT SUM(amount) FROM payments WHERE bidder_id = ?), 0) AS payments_total
    `).get(bidder_id, bidder_id);
    const outstanding_minor = Math.max(0, Math.round((sums.lots_total - sums.payments_total) * 100));
    logFromRequest(req, logLevels.DEBUG, `Bidder ${bidder_id} outstanding amount=${outstanding_minor}, amount requested=${amount_minor}`);
    if (amount_minor > outstanding_minor) {
      logFromRequest(req, logLevels.WARN, `Intent amount exceeds outstanding: bidder=${bidder_id} amount_minor=${amount_minor} outstanding_minor=${outstanding_minor}`);
      return res.status(400).json({ error: 'Amount requested exceeds outstanding', outstanding_minor });
    }

    const intentId = uuidv4();

    const expiresAt = new Date(Date.now() + PAYMENT_TTL_MIN * 60 * 1000).toISOString();
 //   const chan = (channel === 'hosted') ? 'hosted' : (channel === 'app-ind' ? 'app-ind' : 'app');
if (channel !== 'hosted' && channel !== 'app' && channel !== 'app-ind' ) {
      logFromRequest(req, logLevels.WARN, `Attempt to create SumUp payment with invalid channel: ${channel}`);
      return res.status(400).json({ error: `Invalid channel specified: ${channel}` });
    }

    //check if the requested channel is enabled in config
    if (channel === 'hosted' && !SUMUP_WEB_ENABLED || channel === 'app' && !SUMUP_CARD_PRESENT_ENABLED || (channel === 'app-ind' && !SUMUP_APP_INDIRECT_ENABLED)) {
      logFromRequest(req, logLevels.WARN, `Attempt to create SumUp payment with disabled channel: ${channel}`);
      return res.status(503).json({ error: `Requested payment method SumUp-${channel} is disabled` });
    }


    db.prepare(`
      INSERT INTO payment_intents (intent_id, bidder_id, amount_minor, currency, status, channel, expires_at, note)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(intentId, bidder_id, amount_minor, CURRENCY, channel, expiresAt, sanitisedNote);

    const payload = { intent_id: intentId, amount_minor, currency: CURRENCY };

    if (channel === 'app' || channel === 'app-ind') {
      const title = `Bidder ${bidder_id}`;
      payload.deep_link = buildDeepLink({
        amount_minor, currency: CURRENCY, title, external_reference: intentId
      });
    } else {
      const description = `Bidder ${bidder_id}`;
      const hc = await createHostedCheckout({
        amount_minor, currency: CURRENCY, checkout_reference: intentId, description
      });
      if (hc) {
        db.prepare('UPDATE payment_intents SET sumup_checkout_id=? WHERE intent_id=?')
          .run(hc.checkout_id, intentId);
        payload.hosted_link = hc.url;
      }
    }

    logFromRequest(req, logLevels.INFO, `Intent created ${intentId} bidder=${bidder_id} amount_minor=${amount_minor} channel=${channel}`);
    res.status(201).json(payload);
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `intent_create_error ${err.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// --- Poll status (UI fallback while waiting) ---
api.get('/payments/intents/:id', authenticateRole("cashier"), (req, res) => {
  try {
    const row = db.prepare(`
      SELECT intent_id, bidder_id, amount_minor, currency, status, channel, sumup_checkout_id, expires_at
      FROM payment_intents WHERE intent_id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `intent_get_error ${err.message}`);
    
    res.status(500).json({ error: 'internal_error' });
  }
});

// --- Webhook for hosted checkouts ---
// This is a server-to-server notification from SumUp when the checkout status changes.
// MUST be reachable from the public internet over HTTPS using valid TLS certs (not self-signed).
// See: https://developer.sumup.com/docs/hosted-checkout/webhooks/

api.post('/payments/sumup/webhook', async (req, res) => {
  logFromRequest(req, logLevels.DEBUG, `Sumup webhook received ${JSON.stringify(req.body)}`);
  

  try {
    // Minimal shape (hosted): { id: "<checkout_id>", ... }
    const checkoutId = req.body?.id;
    res.status(200).end(); // ACK fast to SumUp as per their docs

    if (!checkoutId) {
      logFromRequest(req, logLevels.INFO, 'webhook_missing_checkout_id');
      return;
    }
    // Link back to our intent via stored checkout id
    const row = db.prepare('SELECT intent_id FROM payment_intents WHERE sumup_checkout_id=?').get(checkoutId);
    if (!row?.intent_id) {
      logFromRequest(req, logLevels.WARN, `webhook_unlinked_checkout id=${checkoutId}`);
      return;
    }
    await verifyAndFinalizeIntent(row.intent_id, { raw: req.body, source: 'webhook' });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `webhook_error ${err.message}`);
  }
});


// API for handling both success and fail callbacks from SumUp app deep-link UX
// Testing indicates that SumUp will sometimes call the success endpoint under failure conditions (!!), so we treat them the same and interpret the status param.

api.get('/payments/sumup/callback/success', handleSumupAppCallback);
api.get('/payments/sumup/callback/fail', handleSumupAppCallback);

function handleSumupAppCallback(req, res) {
  var status = readStatus(req.query);          // 'success' | 'failed' | 'invalidstate' | ''
  const foreignTxId = readForeignTxId(req.query);
  const txCode = readTxCode(req.query);
  const failure = readFailureInfo(req.query);

  logFromRequest(req, logLevels.INFO,
    `sumup_app_callback endpoint=${req.path} status=${status} foreign_tx=${foreignTxId} tx_code=${txCode} failure=${JSON.stringify(failure)}`);

  // Test point: force success even if SumUp says otherwise (e.g. if transaction cancelled on POS)
  // status = `success`;

  if (!foreignTxId) {
    logFromRequest(req, logLevels.WARN,
      `SumUp app callback missing foreign tx ID. endpoint=${req.path}`);
  } else if (status === 'success') {
    // Happy path: fire-and-forget verification/finalisation
    verifyAndFinalizeIntent(foreignTxId, {
      raw: req.query,
      source: 'app-callback'
    }).catch(err => {
      logFromRequest(req, logLevels.ERROR,
        `SumUp app callback verify error intent=${foreignTxId} err=${err.message}`);
    });
  } else if (status) {
    // Any non-success status: mark intent as failed (if still pending)
    db.prepare(`
      UPDATE payment_intents
      SET status = 'failed'
      WHERE intent_id = ? AND status = 'pending'
    `).run(foreignTxId);

    logFromRequest(req, logLevels.INFO,
      `SumUp app callback mark failed intent=${foreignTxId} status=${status} cause=${failure.cause || ''} msg=${failure.message || ''}`);
  }

  // Opens a simple page that attempts to close itself after showing status
  // This should work as the window was opened by window.open from our front-end.

  res.type('html').send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Closing…</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 2rem;
      background: #f5f5f5;
      color: #222;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      box-sizing: border-box;
      text-align: center;
    }

    .box {
      background: #fff;
      border-radius: 8px;
      padding: 1.5rem 2rem;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      max-width: 420px;
      width: 100%;
    }

    h1 {
      margin-top: 0;
      margin-bottom: 0.5rem;
      font-size: 1.4rem;
    }

    p {
      margin: 0.4rem 0;
    }

    #closeButton {
      margin-top: 1.2rem;
      padding: 0.6rem 1.4rem;
      border-radius: 4px;
      border: 1px solid #0074d9;
      background: #0074d9;
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
    }

    #closeButton:disabled {
      opacity: 0.6;
      cursor: default;
    }

    #fallback-msg {
      margin-top: 0.8rem;
      font-size: 0.9rem;
      color: #666;
      display: none;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>SumUp Payment</h1>
    <p>SumUp replied with status: <strong>${status || 'unknown'}</strong>.</p>
    <p>This window will close automatically in a moment.</p>
    <p>If it doesn’t, you can close it manually using the button below.</p>

    <button id="closeButton">Close this tab now</button>
    <p id="fallback-msg">
      Your browser blocked automatic closing. Please close this tab manually if it remains open.
    </p>
  </div>

  <script>
    (function () {
      "use strict";

      const AUTO_CLOSE_DELAY_MS = 5000;
      const closeButton   = document.getElementById("closeButton");
      const fallbackMsg   = document.getElementById("fallback-msg");

      /**
       * Try to close the window. This will only work reliably if the window/tab
       * was opened by script (e.g. via window.open).
       */
      function attemptClose(trigger) {
        try {
          console.log("Attempting to close window (trigger:", trigger + ")");

          window.close();

          setTimeout(() => {
            // If we're still running here, assume the close was blocked.
            // We can’t *detect* it directly, so we just offer guidance.
            fallbackMsg.style.display = "block";
            closeButton.disabled = true;
          }, 500);
        } catch (err) {
          console.error("Error attempting to close window:", err);
          fallbackMsg.style.display = "block";
        }
      }

      // Auto-close after a delay
      window.addEventListener("load", () => {
        setTimeout(() => attemptClose("auto-timeout"), AUTO_CLOSE_DELAY_MS);
      });

      // Manual close via button
      closeButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        attemptClose("manual-button");
      });
    })();
  </script>
</body>
</html>
`
  );
}

// Utility: normalise status from query string
function readStatus(query) {
  return (query['smp-status'] ||
    query['smpt-status'] ||   // some older / buggy implementations
    query['status'] ||
    '').toLowerCase();
}

function readForeignTxId(query) {
  return query['foreign-tx-id'] || query['foreign_tx_id'] || null;
}

function readTxCode(query) {
  return query['smp-tx-code'] || query['smp_tx_code'] || null;
}

function readFailureInfo(query) {
  return {
    cause: query['smp-failure-cause'] || query['smp_failure_cause'] || null,
    message: query['smp-message'] || query['smp_message'] || null,
  };
}


// --- Verification (server-to-server) then finalize into payments table ---
async function verifyAndFinalizeIntent(intentId, { raw = null, source = 'manual' } = {}) {
  const intent = db.prepare('SELECT * FROM payment_intents WHERE intent_id=?').get(intentId);
  if (!intent || intent.status !== 'pending') return;

  // Expiry guard
  if (intent.expires_at && new Date(intent.expires_at) < new Date()) {
    db.prepare(`UPDATE payment_intents SET status='expired' WHERE intent_id=? AND status='pending'`).run(intentId);
    return;
  }

  // For hosted: fetch checkout status from API (PENDING|FAILED|PAID).

  let latest = null;
  if (intent.channel === 'hosted') {
    const list = await getCheckoutsByReference(intent.intent_id);
    latest = Array.isArray(list) ? list.slice(-1)[0] : null;
    if (!latest) {
      logFromRequest(req, logLevels.WARN, `No SumUp checkout found for intent=${intentId}`);
      return;
    }
    if (latest.status === 'PENDING') return; // keep waiting
    if (latest.status === 'FAILED') {
      db.prepare(`UPDATE payment_intents SET status='failed' WHERE intent_id=? AND status='pending'`).run(intentId);
      return;
    }
    if (latest.status !== 'PAID') return;
  }

  // If we're here, we're marking success.
  const amount = Number(toPounds(intent.amount_minor));
  const createdBy = (source === 'webhook') ? 'sumup-web' : 'sumup-app';
  const providerTxn = latest?.transactions?.[0]?.id || crypto.randomUUID();



  const t = db.transaction(() => {

    // Check payment isn't already finalised (e.g. duplicate webhook from SumUp)
    // Sunmup sometimes sends multiple notifications for the same checkout/payment.

    const existing = db.prepare(`
      SELECT id FROM payments
      WHERE provider = 'sumup' AND intent_id = ?
    `).get(intent.intent_id);

    if (existing && existing.id) {
      log("Payment", logLevels.DEBUG, `Duplicate payment intent finalization ignored: intent=${intent.intent_id}`);
      // Already created a payment for this intent; nothing more to do.
      return;
    }

    // Write to payments table
    // const r = db.prepare(`
    //   INSERT INTO payments (bidder_id, amount, method, note, created_by, provider, provider_txn_id, intent_id, payment_id, raw_payload)
    //   VALUES (?, ?, 'card', ?, ?, 'sumup', ?, ?, ?, ?)
    // `).run(intent.bidder_id, amount, ``, createdBy, providerTxn, intent.intent_id, r.lastInsertRowid, raw ? JSON.stringify(raw) : (latest ? JSON.stringify(latest) : null));

    const r = db.prepare(`
      INSERT INTO payments (bidder_id, amount, method, note, created_by, provider, provider_txn_id, intent_id, raw_payload, currency)
      VALUES (?, ?, ? , ?, 'cashier', 'sumup', ?, ?, ?, ?)
    `).run(intent.bidder_id, amount, createdBy, intent.note, providerTxn, intent.intent_id, raw ? JSON.stringify(raw) : (latest ? JSON.stringify(latest) : null), CURRENCY);

    // Store provider metadata linking to payments.id (for audit/idempotency)
    // db.prepare(`
    //   INSERT OR IGNORE INTO provider_payments (provider, provider_txn_id, intent_id, payment_id, raw_payload)
    //   VALUES ('sumup', ?, ?, ?, ?)
    // `).run(providerTxn, intent.intent_id, r.lastInsertRowid, raw ? JSON.stringify(raw) : (latest ? JSON.stringify(latest) : null));

    // Mark intent done
    db.prepare(`UPDATE payment_intents SET status = 'succeeded' WHERE intent_id=?`).run(intent.intent_id);
      log("Payment", logLevels.INFO, `Payment intent finalized: intent=${intent.intent_id}, amount=${intent.amount_minor}`);

  });

  t();

}


// Helper functions to create SumUp payment links and hosted checkouts.
// Built as per sumup developer docs.

function buildDeepLink({ amount_minor, currency, title, external_reference }) {
  const q = new URLSearchParams({
    amount: toPounds(amount_minor),
    currency,
    'affiliate-key': SUMUP_AFFILIATE_KEY,
  });
  q.set('app-id', SUMUP_APP_ID); // optional
  if (title) q.set('title', title);
  q.set('callbacksuccess', SUMUP_CALLBACK_SUCCESS);
  q.set('callbackfail', SUMUP_CALLBACK_FAIL);
  if (external_reference) q.set('foreign-tx-id', external_reference);

  log("Payment", logLevels.DEBUG, `Deep link generated: sumupmerchant://pay/1.0?${q.toString()}`);
  return `sumupmerchant://pay/1.0?${q.toString()}`;
}

// Desktop/QR (requires API key + merchant)
async function createHostedCheckout({ amount_minor, currency, checkout_reference, description }) {
  if (!SUMUP_API_KEY || !SUMUP_MERCHANT_CODE) return null; // silently disable if not configured
  const body = {
    amount: Number(toPounds(amount_minor)),
    currency,
    merchant_code: SUMUP_MERCHANT_CODE,
    checkout_reference,
    description,
    hosted_checkout: { enabled: true },
    return_url: SUMUP_RETURN_URL
  };


  const { body: res } = await request('https://api.sumup.com/v0.1/checkouts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUMUP_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data?.hosted_checkout_url || !data?.id) throw new Error('Invalid SumUp checkout response');
  return { url: data.hosted_checkout_url, checkout_id: data.id };
}

async function getCheckoutsByReference(checkout_reference) {
  if (!SUMUP_API_KEY) return [];
  const url = `https://api.sumup.com/v0.1/checkouts?checkout_reference=${encodeURIComponent(checkout_reference)}`;
  const { body } = await request(url, { headers: { Authorization: `Bearer ${SUMUP_API_KEY}` } });
  return body.json(); // array, status in ['PENDING','FAILED','PAID']
}

// --- Expire stale intents ---
function expireStaleIntents() {
  const stmt = db.prepare(`
    UPDATE payment_intents
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at < datetime('now')
  `);
  const info = stmt.run();
  if (info.changes > 0) {
    log('Payments', logLevels.INFO, `Set ${info.changes} stale payment intents to expired`);
  }
}



module.exports = { api, paymentProcessorVer, verifyAndFinalizeIntent };
