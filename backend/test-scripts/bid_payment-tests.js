#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { initFramework } = require("./api-test-framework");

const configPath = path.join(__dirname, "..", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const baseUrl = (process.env.BASE_URL || `http://localhost:${config.PORT}`).replace(/\/$/, "");
const adminPassword = process.env.ADMIN_PASSWORD || "a1234";
const maintenancePassword = process.env.MAINTENANCE_PASSWORD || "m1234";
const cashierPassword = process.env.CASHIER_PASSWORD || "c1234";
const logFilePath = process.env.LOG_FILE || path.join(__dirname, "bid_payment-tests.log");

const framework = initFramework({
  baseUrl,
  logFilePath,
  loginRole: "cashier",
  loginPassword: cashierPassword
});

const {
  context,
  addTest,
  skipTest,
  run,
  authHeaders,
  fetchJson,
  expectStatus,
  loginAs
} = framework;

const { FormData, Blob } = globalThis;
if (!FormData || !Blob) {
  throw new Error("FormData/Blob not available. Use Node 18+.");
}

const tokens = {
  admin: null,
  maintenance: null
};

const testData = {
  auctionPublicId: null,
  auctionId: null,
  auctionShortName: null,
  item1: null,
  item2: null,
  item3: null,
  bidderId: null,
  paymentId: null,
  auction2Id: null,
  auction2PublicId: null,
  auction2ShortName: null,
  auction2Item1: null,
  auction2BidderId: null,
  isolationBidderId: null,
  isolationPaddle: null,
  sumupIntentId: null,
  sumupFailIntentId: null,
  sumupBlocked: false,
  sumupBidderId: null,
  sumupAuctionId: null,
  sumupStartingPaymentsTotal: null,
  sumupAmountMinor: null,
  sumupOutstandingMinor: null,
  sumupPaymentsAfterSuccess: null
};

async function maintenanceRequest(pathname, body) {
  return fetchJson(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify(body || {})
  });
}

// async function setAuctionStatusFor(auctionId, status) {
//   const { res, json, text } = await fetchJson(`${baseUrl}/auctions/update-status`, {
//     method: "POST",
//     headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
//     body: JSON.stringify({ auction_id: auctionId, status })
//   });
//   await sleep(3000);
//   await expectStatus(res, 200);
//     const okText = text === "" || text === "OK";
//   assert.ok((json && json.message) || okText, "Unexpected status update response");
// }

 // Sleep function that returns a promise
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

async function setAuctionStatusFor(auctionId, status) {
  const { res, json, text } = await fetchJson(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: auctionId, status })
  });
  await expectStatus(res, 200);
  const okText = text === "" || text === "OK";
  assert.ok((json && json.message) || okText, "Unexpected status update response");
  await waitForAuctionStatus(auctionId, status);
  await sleep(1000);
}

async function waitForAuctionStatus(auctionId, expected, timeoutMs = 15000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "<none>";
  while (Date.now() < deadline) {
    const { res, json, text } = await fetchJson(`${baseUrl}/auction-status`, {
      method: "POST",
      headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
      body: JSON.stringify({ auction_id: auctionId })
    });
    if (res.status === 200 && json && typeof json.status === "string") {
      lastStatus = json.status;
      if (json.status === expected) {
        return;
      }
    } else {
      lastStatus = text || "<no response>";
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for auction status "${expected}", last="${lastStatus}"`);
}



// async function setAuctionStatus(status) {
//   return setAuctionStatusFor(testData.auctionId, status);
// }

  // Sleep function that returns a promise
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

async function waitForLog(snippet, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let lastLog = "";
  while (Date.now() < deadline) {
    const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/logs`, {
      headers: authHeaders(tokens.maintenance)
    });
    await expectStatus(res, 200);
    lastLog = json?.log || text || "";
    if (lastLog.includes(snippet)) {
      return;
    }
    await sleep(150);
  }
  assert.ok(lastLog.includes(snippet), `Log did not include "${snippet}"`);
}

async function waitForIntentStatus(intentId, expectedStatus, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const { res, json } = await fetchJson(`${baseUrl}/payments/intents/${intentId}`, {
      headers: authHeaders(context.token)
    });
    await expectStatus(res, 200);
    lastStatus = json?.status || null;
    if (lastStatus === expectedStatus) {
      return json;
    }
    await sleep(100);
  }
  assert.equal(lastStatus, expectedStatus, `Intent ${intentId} status did not reach ${expectedStatus}`);
}

async function getBidderSummary(auctionId, bidderId) {
  const { res, json } = await fetchJson(`${baseUrl}/settlement/bidders/${bidderId}?auction_id=${auctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  return json;
}

async function createItem(auctionPublicId, description) {
  const form = new FormData();
  form.append("description", description);
  form.append("contributor", "Phase1 Contributor");
  form.append("artist", "Phase1 Artist");
  const { res, json, text } = await fetchJson(`${baseUrl}/auctions/${auctionPublicId}/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 200);
  assert.ok(json && json.id, `Create item failed: ${text}`);
  return json.id;
}

addTest("P-001","setup: login other roles", async () => {
  tokens.admin = await loginAs("admin", adminPassword);
  tokens.maintenance = await loginAs("maintenance", maintenancePassword);
});

addTest("P-002","setup: create auction and items", async () => {
  const stamp = Date.now();
  testData.auctionShortName = `test_phase1_${stamp}`;
  const { res, json } = await maintenanceRequest("/maintenance/auctions/create", {
    short_name: testData.auctionShortName,
    full_name: `Phase1 Test Auction ${stamp}`,
    logo: "default_logo.png"
  });
  await expectStatus(res, 201);
  assert.ok(json && json.message, "Auction create failed");

  const list = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(list.res, 200);
  const found = list.json.find(a => a.short_name === testData.auctionShortName);
  assert.ok(found, "Created auction not found");
  testData.auctionId = found.id;
  testData.auctionPublicId = found.public_id;



  await maintenanceRequest("/maintenance/auctions/set-admin-state-permission", {
    auction_id: testData.auctionId,
    admin_can_change_state: true
  });

   await setAuctionStatusFor(testData.auctionId, "setup");

  testData.item1 = await createItem(testData.auctionPublicId, "Phase1 Item 1");
  testData.item2 = await createItem(testData.auctionPublicId, "Phase1 Item 2");
  testData.item3 = await createItem(testData.auctionPublicId, "Phase1 Item 3");
});

// /cashier/live/:auctionId
addTest("P-003","GET /cashier/live/:auctionId success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/cashier/live/${testData.auctionId}?unsold=true`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(Array.isArray(json), "Expected array");
});

addTest("P-004","GET /cashier/live/:auctionId failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/cashier/live/${testData.auctionId}`);
  await expectStatus(res, 403);
});

addTest("P-005","GET /cashier/live/:auctionId failure invalid auction id", async () => {
  const res = await fetch(`${baseUrl}/cashier/live/abc`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("P-006","GET /cashier/live/:auctionId failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/cashier/live/${testData.auctionId}`, {
    headers: authHeaders(tokens.maintenance)
  });
  await expectStatus(res, 403);
});

// /settlement/bidders
addTest("P-007","GET /settlement/bidders success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/settlement/bidders?auction_id=${testData.auctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(Array.isArray(json), "Expected array");
});

addTest("P-008","GET /settlement/bidders failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/settlement/bidders?auction_id=${testData.auctionId}`);
  await expectStatus(res, 403);
});

addTest("P-009","GET /settlement/bidders failure invalid auction_id", async () => {
  const res = await fetch(`${baseUrl}/settlement/bidders?auction_id=abc`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("P-010","GET /settlement/bidders failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/settlement/bidders?auction_id=${testData.auctionId}`, {
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 403);
});

// /settlement/payment-methods
addTest("P-011","GET /settlement/payment-methods success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/settlement/payment-methods`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && json.cash, "Missing payment methods");
});

addTest("P-012","GET /settlement/payment-methods failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/settlement/payment-methods`);
  await expectStatus(res, 403);
});

addTest("P-013","GET /settlement/payment-methods failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/settlement/payment-methods`, {
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 403);
});

addTest("P-014","GET /settlement/payment-methods failure invalid token", async () => {
  const res = await fetch(`${baseUrl}/settlement/payment-methods`, {
    headers: authHeaders("badtoken")
  });
  await expectStatus(res, 403);
});


// /lots/:itemid/finalize
addTest("P-015","POST /lots/:itemid/finalize failure wrong state", async () => {
   await setAuctionStatusFor(testData.auctionId, "setup");
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item1}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 101, price: 50, auctionId: testData.auctionId })
  });
  await expectStatus(res, 400);
});

addTest("P-016","POST /lots/:itemid/finalize failure missing params", async () => {
   await setAuctionStatusFor(testData.auctionId, "live");
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item1}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 400);
});

addTest("P-017","POST /lots/:itemid/finalize success", async () => {
  await setAuctionStatusFor(testData.auctionId, "live");
  const { res, json } = await fetchJson(`${baseUrl}/lots/${testData.item1}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 101, price: 50, auctionId: testData.auctionId })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.ok, "Finalize failed");
  testData.bidderId = json.bidder_id;
});

addTest("P-018","POST /lots/:itemid/finalize failure already finalized", async () => {
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item1}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 101, price: 50, auctionId: testData.auctionId })
  });
  await expectStatus(res, 500);
});

addTest("P-019","POST /lots/:itemid/finalize failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/lots/${testData.item2}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paddle: 102, price: 60, auctionId: testData.auctionId })
  });
  await expectStatus(res, 403);
});

// /lots/:id/undo
addTest("P-020","POST /lots/:id/undo failure item not found", async () => {
  const { res } = await fetchJson(`${baseUrl}/lots/999999/undo`, {
    method: "POST",
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 400);
});

addTest("P-021","POST /lots/:id/undo success", async () => {
   await setAuctionStatusFor(testData.auctionId, "live");
  const finalize = await fetchJson(`${baseUrl}/lots/${testData.item2}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 202, price: 70, auctionId: testData.auctionId })
  });
  await expectStatus(finalize.res, 200);

  const { res, json } = await fetchJson(`${baseUrl}/lots/${testData.item2}/undo`, {
    method: "POST",
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 200);
  assert.ok(json && json.ok, "Undo failed");
});

addTest("P-022","POST /lots/:id/undo failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/lots/${testData.item1}/undo`, {
    method: "POST"
  });
  await expectStatus(res, 403);
});

addTest("P-023","POST /lots/:id/undo failure wrong state", async () => {
   await setAuctionStatusFor(testData.auctionId, "setup");
   await sleep(3000);
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item1}/undo`, {
    method: "POST",
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 400);
   await setAuctionStatusFor(testData.auctionId, "live");
});

// /settlement/payment/:auctionId
addTest("P-024","POST /settlement/payment/:auctionId failure wrong state", async () => {
   await setAuctionStatusFor(testData.auctionId, "live");
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.bidderId, amount: 10, method: "cash" })
  });
  await expectStatus(res, 400);
});

addTest("P-025","POST /settlement/payment/:auctionId failure missing params", async () => {
   await setAuctionStatusFor(testData.auctionId, "settlement");
   await sleep(3000);
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 400);
});

addTest("P-026","POST /settlement/payment/:auctionId failure invalid method", async () => {
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.bidderId, amount: 10, method: "bad-method" })
  });
  await expectStatus(res, 400);
});

addTest("P-027","POST /settlement/payment/:auctionId failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bidder_id: testData.bidderId, amount: 10, method: "cash" })
  });
  await expectStatus(res, 403);
});

addTest("P-028","POST /settlement/payment/:auctionId success", async () => {
   await setAuctionStatusFor(testData.auctionId, "settlement");
   await new Promise((resolve) => setTimeout(resolve, 2500));
  const { res, json } = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.bidderId, amount: 10, method: "cash" })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.ok, "Payment failed");
});

// /settlement/bidders/:bidderid
addTest("P-029","GET /settlement/bidders/:bidderid success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/settlement/bidders/${testData.bidderId}?auction_id=${testData.auctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && json.id, "Missing bidder data");
  const latestPayment = json.payments?.[json.payments.length - 1];
  if (latestPayment) {
    testData.paymentId = latestPayment.id;
  }
  assert.ok(testData.paymentId, "Missing payment id from bidder data");
});

addTest("P-030","GET /settlement/bidders/:bidderid failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/settlement/bidders/${testData.bidderId}?auction_id=${testData.auctionId}`);
  await expectStatus(res, 403);
});

addTest("P-031","GET /settlement/bidders/:bidderid failure missing auction_id", async () => {
  const { res } = await fetchJson(`${baseUrl}/settlement/bidders/${testData.bidderId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("P-032","GET /settlement/bidders/:bidderid failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/settlement/bidders/${testData.bidderId}?auction_id=${testData.auctionId}`, {
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 403);
});

// /settlement/payment/:payid/reverse
addTest("P-033","POST /settlement/payment/:payid/reverse failure missing reason", async () => {
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/${testData.paymentId}/reverse`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ amount: 1 })
  });
  await expectStatus(res, 400);
});

addTest("P-034","POST /settlement/payment/:payid/reverse failure invalid id", async () => {
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/abc/reverse`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ reason: "bad" })
  });
  await expectStatus(res, 400);
});

addTest("P-035","POST /settlement/payment/:payid/reverse failure amount exceeds remaining", async () => {
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/${testData.paymentId}/reverse`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ reason: "too much", amount: 9999 })
  });
  await expectStatus(res, 400);
});

addTest("P-036","POST /settlement/payment/:payid/reverse success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/settlement/payment/${testData.paymentId}/reverse`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ reason: "test reversal", amount: 1, auction_id: testData.auctionId })
  });
  await expectStatus(res, 201);
  assert.ok(json && json.ok, "Reversal failed");
});

addTest("P-037","POST /settlement/payment/:payid/reverse failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/settlement/payment/${testData.paymentId}/reverse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "noauth" })
  });
  await expectStatus(res, 403);
});

// /settlement/export.csv
addTest("P-038","GET /settlement/export.csv success", async () => {
  const res = await fetch(`${baseUrl}/settlement/export.csv?auction_id=${testData.auctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  await res.arrayBuffer();
});

addTest("P-039","GET /settlement/export.csv failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/settlement/export.csv?auction_id=${testData.auctionId}`);
  await expectStatus(res, 403);
});

addTest("P-040","GET /settlement/export.csv failure missing auction_id", async () => {
  const res = await fetch(`${baseUrl}/settlement/export.csv`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("P-041","GET /settlement/export.csv failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/settlement/export.csv?auction_id=${testData.auctionId}`, {
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 403);
});

// /settlement/summary
addTest("P-042","GET /settlement/summary success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/settlement/summary?auction_id=${testData.auctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && json.auction_id, "Missing summary");
});

addTest("P-043","GET /settlement/summary failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/settlement/summary?auction_id=${testData.auctionId}`);
  await expectStatus(res, 403);
});

addTest("P-044","GET /settlement/summary failure missing auction_id", async () => {
  const res = await fetch(`${baseUrl}/settlement/summary`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("P-045","GET /settlement/summary failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/settlement/summary?auction_id=${testData.auctionId}`, {
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 403);
});

// /lots/:id/undo fail payments exist negative balance (after payment)
addTest("P-046","POST /lots/:id/undo fail cause -ve balance", async () => {
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item1}/undo`, {
    method: "POST",
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 400);
});

// refund 9 to allow undo
addTest("P-046a","POST /settlement/payment/:payid/reverse to allow undo success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/settlement/payment/${testData.paymentId}/reverse`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ reason: "test reversal", amount: 9, auction_id: testData.auctionId })
  });
  await expectStatus(res, 201);
  assert.ok(json && json.ok, "Reversal failed");
});

// /lots/:id/undo should now pass
addTest("P-064b","POST /lots/:id/undo success payments exist ", async () => {
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item1}/undo`, {
    method: "POST",
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 200);
});

addTest("P-047","setup: create secondary auction for isolation tests", async () => {
  const stamp = Date.now();
  testData.auction2ShortName = `test_phase1_iso_${stamp}`;
  const { res, json } = await maintenanceRequest("/maintenance/auctions/create", {
    short_name: testData.auction2ShortName,
    full_name: `Phase1 Isolation Auction ${stamp}`,
    logo: "default_logo.png"
  });
  await expectStatus(res, 201);
  assert.ok(json && json.message, "Secondary auction create failed");

  const list = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(list.res, 200);
  const found = list.json.find(a => a.short_name === testData.auction2ShortName);
  assert.ok(found, "Secondary auction not found");
  testData.auction2Id = found.id;
  testData.auction2PublicId = found.public_id;


  await maintenanceRequest("/maintenance/auctions/set-admin-state-permission", {
    auction_id: testData.auction2Id,
    admin_can_change_state: true
  });

   await setAuctionStatusFor(testData.auction2Id, "setup");
  testData.auction2Item1 = await createItem(testData.auction2PublicId, "Phase1 Isolation Item 1");
});

addTest("P-048","finalize same paddle in two auctions", async () => {
  testData.isolationPaddle = 555;
   await setAuctionStatusFor(testData.auctionId, "live");
   await setAuctionStatusFor(testData.auction2Id, "live");

  const finalize1 = await fetchJson(`${baseUrl}/lots/${testData.item3}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: testData.isolationPaddle, price: 40, auctionId: testData.auctionId })
  });
  await expectStatus(finalize1.res, 200);
  assert.ok(finalize1.json && finalize1.json.ok, "Finalize auction1 failed");
  testData.isolationBidderId = finalize1.json.bidder_id;

  const finalize2 = await fetchJson(`${baseUrl}/lots/${testData.auction2Item1}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: testData.isolationPaddle, price: 60, auctionId: testData.auction2Id })
  });
  await expectStatus(finalize2.res, 200);
  assert.ok(finalize2.json && finalize2.json.ok, "Finalize auction2 failed");
  testData.auction2BidderId = finalize2.json.bidder_id;
  assert.notStrictEqual(testData.isolationBidderId, testData.auction2BidderId, "Bidder IDs should be isolated per auction");
});

addTest("P-049","settlement bidders totals isolate per auction", async () => {
  await setAuctionStatusFor(testData.auctionId, "settlement");
  await setAuctionStatusFor(testData.auction2Id, "settlement");

  const list1 = await fetchJson(`${baseUrl}/settlement/bidders?auction_id=${testData.auctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(list1.res, 200);
  const bidder1 = list1.json.find(b => b.paddle_number === testData.isolationPaddle);
  assert.ok(bidder1, "Missing bidder in auction1 settlement list");
  assert.equal(bidder1.lots_total, 40);
  assert.equal(bidder1.payments_total, 0);
  assert.equal(bidder1.balance, 40);

  const list2 = await fetchJson(`${baseUrl}/settlement/bidders?auction_id=${testData.auction2Id}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(list2.res, 200);
  const bidder2 = list2.json.find(b => b.paddle_number === testData.isolationPaddle);
  assert.ok(bidder2, "Missing bidder in auction2 settlement list");
  assert.equal(bidder2.lots_total, 60);
  assert.equal(bidder2.payments_total, 0);
  assert.equal(bidder2.balance, 60);
  assert.notStrictEqual(bidder1.id, bidder2.id, "Settlement bidder IDs should be isolated per auction");
});

addTest("P-050","settlement payment math and isolation", async () => {
  const pay1 = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.isolationBidderId, amount: 10, method: "cash" })
  });
  await expectStatus(pay1.res, 200);
  assert.ok(pay1.json && pay1.json.ok, "Auction1 payment failed");
  assert.equal(pay1.json.balance, 30);

  const bidderAfterPay1 = await fetchJson(`${baseUrl}/settlement/bidders/${testData.isolationBidderId}?auction_id=${testData.auctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(bidderAfterPay1.res, 200);
  assert.equal(bidderAfterPay1.json.payments_total, 10);
  assert.equal(bidderAfterPay1.json.balance, 30);

  const overpay = await fetchJson(`${baseUrl}/settlement/payment/${testData.auction2Id}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.auction2BidderId, amount: 61, method: "cash" })
  });
  await expectStatus(overpay.res, 400);
  assert.equal(overpay.json?.outstanding, 60);

  const pay2 = await fetchJson(`${baseUrl}/settlement/payment/${testData.auction2Id}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.auction2BidderId, amount: 20, method: "cash" })
  });
  await expectStatus(pay2.res, 200);
  assert.ok(pay2.json && pay2.json.ok, "Auction2 payment failed");
  assert.equal(pay2.json.balance, 40);

  const bidderAfterPay2 = await fetchJson(`${baseUrl}/settlement/bidders/${testData.isolationBidderId}?auction_id=${testData.auctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(bidderAfterPay2.res, 200);
  assert.equal(bidderAfterPay2.json.balance, 30);
});

// /payments/*
addTest("P-051","payments setup: bidder and settlement state", async () => {
  await setAuctionStatusFor(testData.auction2Id, "settlement");
  const bidder = await fetchJson(`${baseUrl}/settlement/bidders/${testData.auction2BidderId}?auction_id=${testData.auction2Id}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(bidder.res, 200);
  testData.sumupBidderId = testData.auction2BidderId;
  testData.sumupAuctionId = testData.auction2Id;
  testData.sumupStartingPaymentsTotal = bidder.json.payments_total;
  testData.sumupOutstandingMinor = Math.max(0, Math.round((bidder.json.balance || 0) * 100));
});

addTest("P-051a","POST /settlement/payment/:auctionId bidder mismatch no payment", async () => {
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.sumupBidderId, amount: 1, method: "cash" })
  });
  await expectStatus(res, 400);
  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.payments_total, before.payments_total);
});

addTest("P-051b","POST /settlement/payment/:auctionId overpay no payment", async () => {
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  const overpayAmount = (before.balance || 0) + 1;
  if (overpayAmount <= 1) {
    return skipTest("No outstanding balance available for overpay test.");
  }
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/${testData.sumupAuctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.sumupBidderId, amount: overpayAmount, method: "cash" })
  });
  await expectStatus(res, 400);
  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.payments_total, before.payments_total);
});

addTest("P-052","POST /payments/intents failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: 100,
      channel: "app"
    })
  });
  await expectStatus(res, 403);
});

addTest("P-053","POST /payments/intents failure wrong role", async () => {
  const { res } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: 100,
      channel: "app"
    })
  });
  await expectStatus(res, 403);
});

addTest("P-054a","Set non-default cashier password", async () => {
  const tempPassword = `${cashierPassword}_temp`;
  const { res: res1 } = await fetchJson(`${baseUrl}/maintenance/change-password`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ role: "cashier", newPassword: tempPassword })
  });
  await expectStatus(res1, 200);

});

addTest("P-054","POST /payments/intents success", async () => {
  if (testData.sumupOutstandingMinor < 1) {
    return skipTest("No outstanding balance available for SumUp intent tests.");
  }
  const amountMinor = Math.min(testData.sumupOutstandingMinor, 1000);
  const { res, json, text } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: amountMinor,
      channel: "app",
      note: "phase1 sumup intent"
    })
  });

  await expectStatus(res, 201);
  assert.ok(json && json.intent_id, `Missing intent id: ${text}`);
  assert.ok(json.deep_link, "Missing deep link for app intent");
  testData.sumupIntentId = json.intent_id;
  testData.sumupAmountMinor = amountMinor;
});



addTest("P-055","POST /payments/intents failure missing auction id", async () => {
  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  const { res } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      bidder_id: testData.sumupBidderId,
      amount_minor: 100,
      channel: "app"
    })
  });
  await expectStatus(res, 400);
});

addTest("P-056","POST /payments/intents failure wrong state", async () => {
  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  await setAuctionStatusFor(testData.sumupAuctionId, "live");
  await sleep(3000);
  const { res } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: 100,
      channel: "app"
    })
  });
  await expectStatus(res, 400);
  await setAuctionStatusFor(testData.sumupAuctionId, "settlement");
  await sleep(3000);
});

addTest("P-057","POST /payments/intents failure invalid params", async () => {
  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  const { res } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: 0,
      amount_minor: 0,
      channel: "app"
    })
  });
  await expectStatus(res, 400);
});

addTest("P-058","POST /payments/intents failure invalid channel", async () => {
  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  const { res } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: 100,
      channel: "nope"
    })
  });
  await expectStatus(res, 400);
});

addTest("P-059","POST /payments/intents failure amount exceeds outstanding", async () => {
  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  const amountMinor = testData.sumupOutstandingMinor + 1;
  const { res, json } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: amountMinor,
      channel: "app"
    })
  });
  await expectStatus(res, 400);
  assert.equal(json?.outstanding_minor, testData.sumupOutstandingMinor);
});

addTest("P-060","GET /payments/intents/:id success", async () => {
  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  if (!testData.sumupIntentId) {
    return skipTest("No SumUp intent available.");
  }
  const { res, json } = await fetchJson(`${baseUrl}/payments/intents/${testData.sumupIntentId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.equal(json.intent_id, testData.sumupIntentId);
  assert.equal(json.status, "pending");
});

addTest("P-061","GET /payments/intents/:id failure not found", async () => {
  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  const { res } = await fetchJson(`${baseUrl}/payments/intents/00000000-0000-0000-0000-000000000000`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("P-062","GET /payments/intents/:id failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/payments/intents/00000000-0000-0000-0000-000000000000`);
  await expectStatus(res, 403);
});

addTest("P-063","POST /payments/sumup/webhook missing checkout id no payment", async () => {
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  await fetchJson(`${baseUrl}/payments/sumup/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.payments_total, before.payments_total);
});

addTest("P-064","POST /payments/sumup/webhook unlinked checkout no payment", async () => {
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  const checkoutId = `test_checkout_${Date.now()}`;
  await fetchJson(`${baseUrl}/payments/sumup/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: checkoutId })
  });
  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.payments_total, before.payments_total);
});

addTest("P-065","GET /payments/sumup/callback/success missing foreign id no payment", async () => {
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  await fetch(`${baseUrl}/payments/sumup/callback/success?status=success&smp-tx-code=test`);
  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.payments_total, before.payments_total);
});



addTest("P-066","GET /payments/sumup/callback/fail updates intent", async () => {
  await setAuctionStatusFor(testData.sumupAuctionId, "settlement");

  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  const amountMinor = Math.min(testData.sumupOutstandingMinor, 1000);
  if (amountMinor < 1) {
    return skipTest("No outstanding balance available for SumUp intent tests.");
  }
  const create = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: amountMinor,
      channel: "app",
      note: "phase1 sumup fail intent"
    })
  });
  if (create.res.status === 403) {
    testData.sumupBlocked = true;
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  await expectStatus(create.res, 201);
  testData.sumupFailIntentId = create.json.intent_id;
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);

  const res = await fetch(`${baseUrl}/payments/sumup/callback/fail?status=failed&foreign-tx-id=${testData.sumupFailIntentId}`);
  await expectStatus(res, 200);

  const check = await fetchJson(`${baseUrl}/payments/intents/${testData.sumupFailIntentId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(check.res, 200);
  assert.equal(check.json.status, "failed");
  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.payments_total, before.payments_total);
});

addTest("P-067","GET /payments/sumup/callback/success unknown foreign id no payment", async () => {
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  const unknownId = "00000000-0000-0000-0000-000000000000";
  await fetch(`${baseUrl}/payments/sumup/callback/success?status=success&foreign-tx-id=${unknownId}`);
  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.payments_total, before.payments_total);
});

addTest("P-068","GET /payments/sumup/callback/success finalizes intent", async () => {
  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  if (!testData.sumupIntentId) {
    return skipTest("No SumUp intent available.");
  }
  const res = await fetch(`${baseUrl}/payments/sumup/callback/success?status=success&foreign-tx-id=${testData.sumupIntentId}`);
  await expectStatus(res, 200);

  await waitForIntentStatus(testData.sumupIntentId, "succeeded", 3000);
  const bidder = await fetchJson(`${baseUrl}/settlement/bidders/${testData.sumupBidderId}?auction_id=${testData.sumupAuctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(bidder.res, 200);
  const expectedPayments = Number((testData.sumupStartingPaymentsTotal + testData.sumupAmountMinor / 100).toFixed(2));
  assert.ok(Math.abs(bidder.json.payments_total - expectedPayments) < 0.01, "Payments total did not include SumUp payment");
  testData.sumupPaymentsAfterSuccess = bidder.json.payments_total;
});

addTest("P-069","GET /payments/sumup/callback/success duplicate no payment", async () => {
  if (testData.sumupBlocked) {
    return skipTest("SumUp intents blocked by default cashier password.");
  }
  if (!testData.sumupIntentId || testData.sumupPaymentsAfterSuccess == null) {
    return skipTest("No SumUp intent available.");
  }
  await fetch(`${baseUrl}/payments/sumup/callback/success?status=success&foreign-tx-id=${testData.sumupIntentId}`);
  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.payments_total, testData.sumupPaymentsAfterSuccess);
});

addTest("P-070","maintenance/set default cashier password", async () => {

    const { res: res2 } = await fetchJson(`${baseUrl}/maintenance/change-password`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ role: "cashier", newPassword: "c1234" })
  });
  sleep(1000); // wait for password change to propagate
  await expectStatus(res2, 200);
}); 





addTest("P-071","POST /payments/intents default-password block", async () => {
  await setAuctionStatusFor(testData.sumupAuctionId, "settlement");
  if (testData.sumupOutstandingMinor < 1) {
    return skipTest("No outstanding balance available for SumUp intent tests.");
  }
  const amountMinor = Math.min(testData.sumupOutstandingMinor, 1000);
  const { res, json, text } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: amountMinor,
      channel: "app",
      note: "phase1 sumup intent"
    })
  });
  // await expectStatus(res, 403);

    if (res.status === 403) {
    assert.ok(json?.error?.includes("default cashier password") || text.includes("default cashier password"),
      "Unexpected SumUp intent rejection");

    return;
  }

  assert.ok(json && json.intent_id, `Missing intent id: ${text}`);
  assert.ok(json.deep_link, "Missing deep link for app intent");
  testData.sumupIntentId = json.intent_id;
  testData.sumupAmountMinor = amountMinor;
});

addTest("P-072","maintenance/set cashier password", async () => {

    const { res: res2 } = await fetchJson(`${baseUrl}/maintenance/change-password`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ role: "cashier", newPassword: cashierPassword })
  });
  await expectStatus(res2, 200);
}); 

run().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
