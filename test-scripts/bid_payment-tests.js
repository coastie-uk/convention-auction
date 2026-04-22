#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { initFramework } = require("./api-test-framework");

const configCandidates = [
  path.join(__dirname, "..", "config.json"),
  path.join(__dirname, "..", "backend", "config.json")
];
const configPath = configCandidates.find((candidate) => fs.existsSync(candidate));
if (!configPath) {
  throw new Error("Unable to locate config.json (checked project root and backend/).");
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const baseUrl = (process.env.BASE_URL || `http://localhost:${config.PORT}`).replace(/\/$/, "");
const bootstrapUsername = (process.env.TEST_BOOTSTRAP_USERNAME || process.env.ROOT_USERNAME || "testuser").trim().toLowerCase();
const bootstrapPassword =
  process.env.TEST_BOOTSTRAP_PASSWORD ||
  process.env.ROOT_PASSWORD ||
  process.env.MAINTENANCE_PASSWORD ||
  process.env.ADMIN_PASSWORD || "testpassword";
const logFilePath = process.env.LOG_FILE || path.join(__dirname, "bid_payment-tests.log");

if (!bootstrapPassword) {
  throw new Error(
    "Missing bootstrap password. Set ROOT_PASSWORD or TEST_BOOTSTRAP_PASSWORD before running bid/payment tests."
  );
}

const userSeed = Date.now().toString(36);
const managedUsers = {
  admin: {
    username: `pt_admin_${userSeed}`,
    password: `PtAdmin_${userSeed}_A1!`,
    roles: ["admin"],
    permissions: ["admin_bidding", "live_feed"]
  },
  maintenance: {
    username: `pt_maint_${userSeed}`,
    password: `PtMaint_${userSeed}_M1!`,
    roles: ["maintenance"],
    permissions: ["manage_users"]
  },
  cashier: {
    username: `pt_cash_${userSeed}`,
    password: `PtCash_${userSeed}_C1!`,
    roles: ["cashier"],
    permissions: ["live_feed"]
  },
  adminNoBid: {
    username: `pt_admin_plain_${userSeed}`,
    password: `PtAdminPlain_${userSeed}_P1!`,
    roles: ["admin"],
    permissions: []
  }
};

const framework = initFramework({
  baseUrl,
  logFilePath,
  loginRole: "maintenance",
  loginUsername: bootstrapUsername,
  loginPassword: bootstrapPassword
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
  adminNoBid: null,
  maintenance: null,
  cashier: null
};

const testData = {
  auctionPublicId: null,
  auctionId: null,
  auctionShortName: null,
  item1: null,
  item2: null,
  item3: null,
  autoSettleAuctionId: null,
  autoSettleAuctionPublicId: null,
  autoSettleAuctionShortName: null,
  autoSettleItemId: null,
  bidderId: null,
  paymentId: null,
  reversalPaymentId: null,
  auction2Id: null,
  auction2PublicId: null,
  auction2ShortName: null,
  auction2Item1: null,
  auction2BidderId: null,
  moveAuctionId: null,
  moveAuctionShortName: null,
  moveItemSuccess: null,
  moveItemTargetState: null,
  isolationBidderId: null,
  isolationPaddle: null,
  sumupIntentId: null,
  sumupHostedIntentId: null,
  sumupFailIntentId: null,
  sumupBidderId: null,
  sumupAuctionId: null,
  sumupStartingPaymentsTotal: null,
  sumupAmountMinor: null,
  sumupOutstandingMinor: null,
  sumupPaymentsAfterSuccess: null,
  bidderNameAuctionId: null,
  bidderNameAuctionPublicId: null,
  bidderNameAuctionShortName: null,
  bidderNameItem1: null,
  bidderNameItem2: null,
  bidderNameItem3: null,
  bidderNameBidderId: null,
  bidderNameUnwonBidderId: null
};

async function maintenanceRequest(pathname, body) {
  return fetchJson(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance || context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body || {})
  });
}

async function ensureManagedUser(user) {
  const create = await maintenanceRequest("/maintenance/users", {
    username: user.username,
    password: user.password,
    roles: user.roles,
    permissions: user.permissions || []
  });

  if (create.res.status === 201) return;

  if (create.res.status !== 409) {
    throw new Error(`Unable to create ${user.username}: ${create.text || create.res.status}`);
  }

  const roleUpdate = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(user.username)}/access`, {
    method: "PATCH",
    headers: authHeaders(tokens.maintenance || context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ roles: user.roles, permissions: user.permissions || [] })
  });
  await expectStatus(roleUpdate.res, 200);

  const passwordUpdate = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(user.username)}/password`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance || context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ newPassword: user.password })
  });
  await expectStatus(passwordUpdate.res, 200);
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

async function getLiveFeed(auctionId, options = {}) {
  const includeUnsold = options.includeUnsold === true;
  const token = options.token || context.token;
  const suffix = includeUnsold ? "?unsold=true" : "";
  const { res, json, text } = await fetchJson(`${baseUrl}/cashier/live/${auctionId}${suffix}`, {
    headers: authHeaders(token)
  });
  return { res, json, text };
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
  tokens.maintenance = context.token;
  await ensureManagedUser(managedUsers.admin);
  await ensureManagedUser(managedUsers.adminNoBid);
  await ensureManagedUser(managedUsers.maintenance);
  await ensureManagedUser(managedUsers.cashier);

  tokens.admin = await loginAs("admin", managedUsers.admin.password, managedUsers.admin.username);
  tokens.adminNoBid = await loginAs("admin", managedUsers.adminNoBid.password, managedUsers.adminNoBid.username);
  tokens.maintenance = await loginAs("maintenance", managedUsers.maintenance.password, managedUsers.maintenance.username);
  tokens.cashier = await loginAs("cashier", managedUsers.cashier.password, managedUsers.cashier.username);
  context.token = tokens.cashier;
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
  const { res, json } = await getLiveFeed(testData.auctionId, { includeUnsold: true });
  await expectStatus(res, 200);
  assert.equal(json?.auction_id, testData.auctionId);
  assert.ok(typeof json?.auction_status === "string", "Expected auction_status");
  assert.ok(Array.isArray(json?.sold), "Expected sold array");
  assert.ok(Array.isArray(json?.unsold), "Expected unsold array");
  assert.ok(Array.isArray(json?.bidders), "Expected bidders array");
});

addTest("P-003a","bidder names API and exports", async () => {
  const stamp = Date.now();
  testData.bidderNameAuctionShortName = `test_phase1_names_${stamp}`;
  const createAuction = await maintenanceRequest("/maintenance/auctions/create", {
    short_name: testData.bidderNameAuctionShortName,
    full_name: `Phase1 Bidder Names Auction ${stamp}`,
    logo: "default_logo.png"
  });
  await expectStatus(createAuction.res, 201);

  const list = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(list.res, 200);
  const found = list.json.find(a => a.short_name === testData.bidderNameAuctionShortName);
  assert.ok(found, "Bidder-name auction not found");
  testData.bidderNameAuctionId = found.id;
  testData.bidderNameAuctionPublicId = found.public_id;

  await maintenanceRequest("/maintenance/auctions/set-admin-state-permission", {
    auction_id: testData.bidderNameAuctionId,
    admin_can_change_state: true
  });

  testData.bidderNameItem1 = await createItem(testData.bidderNameAuctionPublicId, "Bidder Name Item 1");
  testData.bidderNameItem2 = await createItem(testData.bidderNameAuctionPublicId, "Bidder Name Item 2");
  testData.bidderNameItem3 = await createItem(testData.bidderNameAuctionPublicId, "Bidder Name Item 3");
  await setAuctionStatusFor(testData.bidderNameAuctionId, "live");

  const finalize1 = await fetchJson(`${baseUrl}/lots/${testData.bidderNameItem1}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 701, price: 11, bidderName: "Ada Lovelace", auctionId: testData.bidderNameAuctionId })
  });
  await expectStatus(finalize1.res, 200);
  testData.bidderNameBidderId = finalize1.json.bidder_id;

  const lookup1 = await fetchJson(`${baseUrl}/auctions/${testData.bidderNameAuctionId}/bidders/lookup?paddle_number=701`, {
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(lookup1.res, 200);
  assert.equal(lookup1.json?.bidder?.name, "Ada Lovelace");

  const finalize2 = await fetchJson(`${baseUrl}/lots/${testData.bidderNameItem2}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 701, price: 12, bidderName: "", auctionId: testData.bidderNameAuctionId })
  });
  await expectStatus(finalize2.res, 200);
  const lookupAfterEmpty = await fetchJson(`${baseUrl}/auctions/${testData.bidderNameAuctionId}/bidders/lookup?paddle_number=701`, {
    headers: authHeaders(tokens.admin)
  });
  assert.equal(lookupAfterEmpty.json?.bidder?.name, "Ada Lovelace");

  const updateNoBidPermission = await fetchJson(`${baseUrl}/auctions/${testData.bidderNameAuctionId}/bidders/${testData.bidderNameBidderId}`, {
    method: "PATCH",
    headers: authHeaders(tokens.adminNoBid, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: "Grace Hopper" })
  });
  await expectStatus(updateNoBidPermission.res, 200);
  assert.equal(updateNoBidPermission.json?.bidder?.name, "Grace Hopper");

  const cashierUpdate = await fetchJson(`${baseUrl}/auctions/${testData.bidderNameAuctionId}/bidders/${testData.bidderNameBidderId}`, {
    method: "PATCH",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: "Grace Brewster Hopper" })
  });
  await expectStatus(cashierUpdate.res, 200);

  const unwon = await fetchJson(`${baseUrl}/auctions/${testData.bidderNameAuctionId}/bidders`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle_number: 702, name: "Unwon Bidder" })
  });
  await expectStatus(unwon.res, 201);
  testData.bidderNameUnwonBidderId = unwon.json.bidder.id;

  const bidderList = await fetchJson(`${baseUrl}/auctions/${testData.bidderNameAuctionId}/bidders`, {
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(bidderList.res, 200);
  assert.ok(bidderList.json.bidders.some(b => b.paddle_number === 702 && b.name === "Unwon Bidder"));

  const wrongRole = await fetchJson(`${baseUrl}/auctions/${testData.bidderNameAuctionId}/bidders`, {
    headers: authHeaders(tokens.maintenance)
  });
  await expectStatus(wrongRole.res, 403);
  const unauthenticated = await fetch(`${baseUrl}/auctions/${testData.bidderNameAuctionId}/bidders`);
  await expectStatus(unauthenticated, 403);

  const settlementDetail = await fetchJson(`${baseUrl}/settlement/bidders/${testData.bidderNameBidderId}?auction_id=${testData.bidderNameAuctionId}`, {
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(settlementDetail.res, 200);
  assert.equal(settlementDetail.json.bidder_name, "Grace Brewster Hopper");

  const live = await getLiveFeed(testData.bidderNameAuctionId, { token: tokens.cashier });
  await expectStatus(live.res, 200);
  assert.ok(live.json.sold.some(row => row.bidder_name === "Grace Brewster Hopper"));
  assert.ok(live.json.bidders.some(row => row.bidder_name === "Grace Brewster Hopper"));

  const settlementCsv = await fetch(`${baseUrl}/settlement/export.csv?auction_id=${testData.bidderNameAuctionId}`, {
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(settlementCsv, 200);
  assert.match(await settlementCsv.text(), /Grace Brewster Hopper/);

  const itemCsv = await fetch(`${baseUrl}/export-csv`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.bidderNameAuctionId, selection_mode: "all" })
  });
  await expectStatus(itemCsv, 200);
  assert.match(await itemCsv.text(), /bidder_name/);

  const uncollectedCsv = await fetch(`${baseUrl}/cashier/live/${testData.bidderNameAuctionId}/uncollected.csv`, {
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(uncollectedCsv, 200);
  assert.match(await uncollectedCsv.text(), /Grace Brewster Hopper/);

  await setAuctionStatusFor(testData.bidderNameAuctionId, "archived");
  const archivedUpdate = await fetchJson(`${baseUrl}/auctions/${testData.bidderNameAuctionId}/bidders/${testData.bidderNameBidderId}`, {
    method: "PATCH",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: "Blocked" })
  });
  await expectStatus(archivedUpdate.res, 400);
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
  assert.ok(json && json.paymentMethods, "Missing payment methods");
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

addTest("P-016a","POST /lots/:itemid/finalize failure invalid item id", async () => {
  await setAuctionStatusFor(testData.auctionId, "live");
  const { res } = await fetchJson(`${baseUrl}/lots/0/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 101, price: 50, auctionId: testData.auctionId })
  });
  await expectStatus(res, 400);
});

addTest("P-016b","POST /lots/:itemid/finalize failure invalid paddle", async () => {
  await setAuctionStatusFor(testData.auctionId, "live");
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item2}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 101.5, price: 50, auctionId: testData.auctionId })
  });
  await expectStatus(res, 400);
});

addTest("P-016c","POST /lots/:itemid/finalize failure non-positive price", async () => {
  await setAuctionStatusFor(testData.auctionId, "live");
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item2}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 102, price: 0, auctionId: testData.auctionId })
  });
  await expectStatus(res, 400);
});

addTest("P-016d","POST /lots/:itemid/finalize failure price with more than 2dp", async () => {
  await setAuctionStatusFor(testData.auctionId, "live");
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item2}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 102, price: 50.123, auctionId: testData.auctionId })
  });
  await expectStatus(res, 400);
});

addTest("P-016e","POST /lots/:itemid/finalize failure missing admin_bidding permission", async () => {
  await setAuctionStatusFor(testData.auctionId, "live");
  const { res } = await fetchJson(`${baseUrl}/lots/${testData.item2}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.adminNoBid, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 102, price: 50, auctionId: testData.auctionId })
  });
  await expectStatus(res, 403);
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

addTest("P-0190","setup: create single-lot auction for auto-settlement", async () => {
  const stamp = Date.now();
  testData.autoSettleAuctionShortName = `test_phase1_autosettle_${stamp}`;
  const { res, json } = await maintenanceRequest("/maintenance/auctions/create", {
    short_name: testData.autoSettleAuctionShortName,
    full_name: `Phase1 Auto-Settlement Auction ${stamp}`,
    logo: "default_logo.png"
  });
  await expectStatus(res, 201);
  assert.ok(json && json.message, "Auto-settlement auction create failed");

  const list = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(list.res, 200);
  const found = list.json.find(a => a.short_name === testData.autoSettleAuctionShortName);
  assert.ok(found, "Auto-settlement auction not found");
  testData.autoSettleAuctionId = found.id;
  testData.autoSettleAuctionPublicId = found.public_id;

  await maintenanceRequest("/maintenance/auctions/set-admin-state-permission", {
    auction_id: testData.autoSettleAuctionId,
    admin_can_change_state: true
  });
  await setAuctionStatusFor(testData.autoSettleAuctionId, "setup");
  testData.autoSettleItemId = await createItem(testData.autoSettleAuctionPublicId, "Phase1 Auto-Settlement Item");
});

addTest("P-0191","POST /lots/:itemid/finalize auto-transitions final lot auction to settlement", async () => {
  await setAuctionStatusFor(testData.autoSettleAuctionId, "live");
  const { res, json } = await fetchJson(`${baseUrl}/lots/${testData.autoSettleItemId}/finalize`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paddle: 901, price: 25, auctionId: testData.autoSettleAuctionId })
  });
  await expectStatus(res, 200);
  assert.equal(json?.auction_status, "settlement");

  await waitForAuctionStatus(testData.autoSettleAuctionId, "settlement");
  const stateCheck = await fetchJson(`${baseUrl}/auction-status`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.autoSettleAuctionId })
  });
  await expectStatus(stateCheck.res, 200);
  assert.equal(stateCheck.json?.status, "settlement");
});

addTest("P-019a","setup: create target auction for bid edit protections", async () => {
  const stamp = Date.now();
  testData.moveAuctionShortName = `test_phase1_move_${stamp}`;
  const { res, json } = await maintenanceRequest("/maintenance/auctions/create", {
    short_name: testData.moveAuctionShortName,
    full_name: `Phase1 Move Target Auction ${stamp}`,
    logo: "default_logo.png"
  });
  await expectStatus(res, 201);
  assert.ok(json && json.message, "Move target auction create failed");

  const list = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(list.res, 200);
  const found = list.json.find(a => a.short_name === testData.moveAuctionShortName);
  assert.ok(found, "Move target auction not found");
  testData.moveAuctionId = found.id;

  await maintenanceRequest("/maintenance/auctions/set-admin-state-permission", {
    auction_id: testData.moveAuctionId,
    admin_can_change_state: true
  });

  await setAuctionStatusFor(testData.auctionId, "setup");
  await setAuctionStatusFor(testData.moveAuctionId, "setup");
  testData.moveItemSuccess = await createItem(testData.auctionPublicId, "Phase1 Move Success Item");
  testData.moveItemTargetState = await createItem(testData.auctionPublicId, "Phase1 Move Target-State Item");
});

addTest("P-019b","POST /auctions/:auctionId/items/:id/update blocked for finalized item in setup", async () => {
  await setAuctionStatusFor(testData.auctionId, "setup");
  const form = new FormData();
  form.append("description", "Attempt edit finalized item");
  const { res, json, text } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.item1}/update`, {
    method: "POST",
    headers: authHeaders(tokens.admin),
    body: form
  });
  await expectStatus(res, 400);
  assert.ok(json?.error || text, "Expected edit block error response");
});

addTest("P-019c","POST /auctions/:auctionId/items/:id/move-auction/:targetAuctionId blocked for finalized item in setup", async () => {

  await setAuctionStatusFor(testData.moveAuctionId, "setup");
  const { res, json, text } = await fetchJson(
    `${baseUrl}/auctions/${testData.auctionId}/items/${testData.item1}/move-auction/${testData.moveAuctionId}`,
    {
      method: "POST",
      headers: authHeaders(tokens.admin)
    }
  );
  await expectStatus(res, 400);
  assert.ok(json?.error || text, "Expected move block error response");
});

addTest("P-019d","DELETE /items/:id blocked for finalized item in setup", async () => {

  const { res, json, text } = await fetchJson(`${baseUrl}/items/${testData.item1}`, {
    method: "DELETE",
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 400);
  assert.ok(json?.error || text, "Expected delete block error response");
  await setAuctionStatusFor(testData.auctionId, "live");
});

addTest("P-019e","POST /auctions/:auctionId/items/:id/move-auction/:targetAuctionId failure unauthenticated", async () => {
  await setAuctionStatusFor(testData.auctionId, "setup");
  await setAuctionStatusFor(testData.moveAuctionId, "setup");
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.moveItemSuccess}/move-auction/${testData.moveAuctionId}`, {
    method: "POST"
  });
  await expectStatus(res, 403);
});

addTest("P-019f","POST /auctions/:auctionId/items/:id/move-auction/:targetAuctionId failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.moveItemSuccess}/move-auction/${testData.moveAuctionId}`, {
    method: "POST",
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(res, 403);
});

addTest("P-019g","POST /auctions/:auctionId/items/:id/move-auction/:targetAuctionId failure missing target auction", async () => {
  const { res } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.moveItemSuccess}/move-auction/999999999`, {
    method: "POST",
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(res, 400);
});

addTest("P-019h","POST /auctions/:auctionId/items/:id/move-auction/:targetAuctionId success", async () => {
  const { res, json } = await fetchJson(
    `${baseUrl}/auctions/${testData.auctionId}/items/${testData.moveItemSuccess}/move-auction/${testData.moveAuctionId}`,
    {
      method: "POST",
      headers: authHeaders(tokens.admin)
    }
  );
  await expectStatus(res, 200);
  assert.ok(json && json.message, "Expected move success response");

  const sourceItems = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items`, {
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(sourceItems.res, 200);
  const sourceList = Array.isArray(sourceItems.json) ? sourceItems.json : sourceItems.json?.items;
  assert.ok(Array.isArray(sourceList), "Expected source items array");
  assert.ok(!sourceList.some((row) => Number(row.id) === Number(testData.moveItemSuccess)), "Moved item still present in source auction");

  const targetItems = await fetchJson(`${baseUrl}/auctions/${testData.moveAuctionId}/items`, {
    headers: authHeaders(tokens.admin)
  });
  await expectStatus(targetItems.res, 200);
  const targetList = Array.isArray(targetItems.json) ? targetItems.json : targetItems.json?.items;
  assert.ok(Array.isArray(targetList), "Expected target items array");
  assert.ok(targetList.some((row) => Number(row.id) === Number(testData.moveItemSuccess)), "Moved item not found in target auction");
});

addTest("P-019i","POST /auctions/:auctionId/items/:id/move-auction/:targetAuctionId failure same target auction", async () => {
  const { res } = await fetchJson(
    `${baseUrl}/auctions/${testData.moveAuctionId}/items/${testData.moveItemSuccess}/move-auction/${testData.moveAuctionId}`,
    {
      method: "POST",
      headers: authHeaders(tokens.admin)
    }
  );
  await expectStatus(res, 400);
});

addTest("P-019j","POST /auctions/:auctionId/items/:id/move-auction/:targetAuctionId failure target wrong state", async () => {
  await setAuctionStatusFor(testData.moveAuctionId, "live");
  const { res } = await fetchJson(
    `${baseUrl}/auctions/${testData.auctionId}/items/${testData.moveItemTargetState}/move-auction/${testData.moveAuctionId}`,
    {
      method: "POST",
      headers: authHeaders(tokens.admin)
    }
  );
  await expectStatus(res, 400);
  await setAuctionStatusFor(testData.moveAuctionId, "setup");
  await setAuctionStatusFor(testData.auctionId, "live");
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

addTest("P-029a","GET /cashier/live/:auctionId returns bidder payment and ready fields", async () => {
  const { res, json } = await getLiveFeed(testData.auctionId, { includeUnsold: true });
  await expectStatus(res, 200);
  assert.equal(json?.auction_status, "settlement");

  const soldItem = json.sold.find((row) => Number(row.id) === Number(testData.item1));
  assert.ok(soldItem, "Expected finalized item in sold list");
  assert.equal(Number(soldItem.bidder_id), Number(testData.bidderId));
  assert.equal(soldItem.collected_at, null);
  assert.ok(soldItem.last_bid_update, "Expected last_bid_update on sold item");

  const bidder = json.bidders.find((row) => Number(row.bidder_id) === Number(testData.bidderId));
  assert.ok(bidder, "Expected bidder summary in live feed");
  assert.equal(bidder.payment_status, "part_paid");
  assert.equal(Number(bidder.payments_total), 10);
  assert.equal(bidder.ready_for_collection, false);
  assert.equal(bidder.can_collect, true);
  assert.ok(typeof bidder.current_fingerprint === "string" && bidder.current_fingerprint.length > 0, "Expected bidder fingerprint");
  assert.ok(bidder.last_paid_at, "Expected last_paid_at after payment");
});

addTest("P-029b","POST /cashier/live/:auctionId/bidders/:bidderId/ready success", async () => {
  const firstFeed = await getLiveFeed(testData.auctionId);
  await expectStatus(firstFeed.res, 200);
  const bidder = firstFeed.json.bidders.find((row) => Number(row.bidder_id) === Number(testData.bidderId));
  assert.ok(bidder, "Expected bidder in live feed");

  const { res, json } = await fetchJson(`${baseUrl}/cashier/live/${testData.auctionId}/bidders/${testData.bidderId}/ready`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ ready: true, fingerprint: bidder.current_fingerprint })
  });
  await expectStatus(res, 200);
  assert.equal(json?.ready_for_collection, true);
  assert.equal(json?.ready_fingerprint, bidder.current_fingerprint);

  const after = await getLiveFeed(testData.auctionId);
  await expectStatus(after.res, 200);
  const updated = after.json.bidders.find((row) => Number(row.bidder_id) === Number(testData.bidderId));
  assert.equal(updated?.ready_for_collection, true);
  assert.equal(updated?.ready_fingerprint, bidder.current_fingerprint);
  assert.ok(updated?.ready_updated_at, "Expected ready_updated_at after ready set");
});

addTest("P-029c","POST /cashier/live/:auctionId/items/:itemId/collection fails outside settlement", async () => {
  await setAuctionStatusFor(testData.auctionId, "live");
  const { res, json, text } = await fetchJson(`${baseUrl}/cashier/live/${testData.auctionId}/items/${testData.item1}/collection`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ collected: true })
  });
  await expectStatus(res, 400);
  assert.ok((json?.error || text || "").includes("settlement"), "Expected settlement gating error");
  await setAuctionStatusFor(testData.auctionId, "settlement");
});

addTest("P-029d","POST /cashier/live/:auctionId/items/:itemId/collection success auto-marks bidder ready", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/cashier/live/${testData.auctionId}/items/${testData.item1}/collection`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ collected: true })
  });
  await expectStatus(res, 200);
  assert.equal(json?.ok, true);
  assert.equal(json?.item_id, testData.item1);
  assert.equal(json?.collected, true);

  const feed = await getLiveFeed(testData.auctionId);
  await expectStatus(feed.res, 200);
  const soldItem = feed.json.sold.find((row) => Number(row.id) === Number(testData.item1));
  const bidder = feed.json.bidders.find((row) => Number(row.bidder_id) === Number(testData.bidderId));
  assert.ok(soldItem?.collected_at, "Expected collected_at after collection");
  assert.equal(bidder?.ready_for_collection, true);
  assert.equal(bidder?.all_collected, true);
  assert.equal(Number(bidder?.collected_count), 1);
  assert.equal(bidder?.ready_fingerprint, bidder?.current_fingerprint);
});

addTest("P-029e","GET /cashier/live/:auctionId/uncollected.csv excludes collected items", async () => {
  const res = await fetch(`${baseUrl}/cashier/live/${testData.auctionId}/uncollected.csv`, {
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(res, 200);
  const body = await res.text();
  assert.match(body, /paddle_number,bidder_name,lot,description,price,payments_total,payment_status/);
  assert.ok(!body.includes("Phase1 Item 1"), "Collected item should not appear in uncollected CSV");
});

addTest("P-029f","POST /cashier/live/:auctionId/bidders/:bidderId/collect-all success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/cashier/live/${testData.auctionId}/bidders/${testData.bidderId}/collect-all`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 200);
  assert.equal(json?.ok, true);
  assert.equal(json?.bidder_id, testData.bidderId);
});

addTest("P-029g","POST /cashier/live/:auctionId/items/:itemId/collection can uncollect and keep later tests stable", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/cashier/live/${testData.auctionId}/items/${testData.item1}/collection`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ collected: false })
  });
  await expectStatus(res, 200);
  assert.equal(json?.collected, false);

  const readyClear = await fetchJson(`${baseUrl}/cashier/live/${testData.auctionId}/bidders/${testData.bidderId}/ready`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ ready: false })
  });
  await expectStatus(readyClear.res, 200);

  const feed = await getLiveFeed(testData.auctionId);
  await expectStatus(feed.res, 200);
  const soldItem = feed.json.sold.find((row) => Number(row.id) === Number(testData.item1));
  const bidder = feed.json.bidders.find((row) => Number(row.bidder_id) === Number(testData.bidderId));
  assert.equal(soldItem?.collected_at, null);
  assert.equal(bidder?.ready_for_collection, false);
  assert.equal(bidder?.all_collected, false);
  assert.equal(Number(bidder?.collected_count), 0);
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
  testData.reversalPaymentId = json.reversal_id;
});

addTest("P-036a","POST /settlement/payment/:payid/reverse failure cannot reverse reversal", async () => {
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/${testData.reversalPaymentId}/reverse`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ reason: "no reversal of reversal", auction_id: testData.auctionId })
  });
  await expectStatus(res, 400);
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
  assert.ok(Object.prototype.hasOwnProperty.call(json, "donations_total"), "Missing donations_total");
  assert.ok(Object.prototype.hasOwnProperty.call(json, "expected_grand_total"), "Missing expected_grand_total");
  assert.ok(Object.prototype.hasOwnProperty.call(json, "current_grand_total"), "Missing current_grand_total");
  assert.ok(json.breakdown && typeof json.breakdown === "object", "Missing breakdown");
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

addTest("P-050a","settlement manual donation requires full balance payment", async () => {
  const partialWithDonation = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.isolationBidderId, amount: 5, donation_amount: 2, method: "cash" })
  });
  await expectStatus(partialWithDonation.res, 400);
  assert.match(partialWithDonation.json?.error || "", /Donation requires/i);
});

addTest("P-050b","settlement manual donation records separately from paid balance", async () => {
  const donateWithFinalPayment = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.isolationBidderId, amount: 30, donation_amount: 5, method: "cash", note: "extra support" })
  });
  await expectStatus(donateWithFinalPayment.res, 200);
  assert.equal(donateWithFinalPayment.json?.balance, 0);

  const bidder = await getBidderSummary(testData.auctionId, testData.isolationBidderId);
  assert.equal(bidder.payments_total, 40);
  assert.equal(bidder.donations_total, 5);
  assert.equal(bidder.balance, 0);
  assert.equal(Number(bidder.payments[bidder.payments.length - 1].amount), 35);
  assert.equal(Number(bidder.payments[bidder.payments.length - 1].donation_amount), 5);
});

addTest("P-050c","settlement blocks item payment once balance is zero but allows donation-only", async () => {
  const blockedPayment = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.isolationBidderId, amount: 1, method: "cash" })
  });
  await expectStatus(blockedPayment.res, 400);
  assert.match(blockedPayment.json?.error || "", /No payment is due|Amount requested exceeds outstanding/i);
  assert.equal(Number(blockedPayment.json?.outstanding ?? 0), 0);

  const donationOnly = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.isolationBidderId, amount: 0, donation_amount: 2, method: "cash" })
  });
  await expectStatus(donationOnly.res, 200);

  const bidder = await getBidderSummary(testData.auctionId, testData.isolationBidderId);
  assert.equal(bidder.payments_total, 40);
  assert.equal(bidder.donations_total, 7);
  assert.equal(bidder.balance, 0);
});

addTest("P-050d","refunds reduce lot payments before donations", async () => {
  const before = await getBidderSummary(testData.auctionId, testData.isolationBidderId);
  const donationPayment = before.payments.find((payment) => Number(payment.donation_amount) === 5 && Number(payment.amount) === 35);
  assert.ok(donationPayment, "Expected a mixed payment with donation");

  const partialRefund = await fetchJson(`${baseUrl}/settlement/payment/${donationPayment.id}/reverse`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ amount: 10, reason: "partial lots refund", auction_id: testData.auctionId })
  });
  await expectStatus(partialRefund.res, 201);
  assert.equal(Number(partialRefund.json?.refunded_donation || 0), 0);

  const after = await getBidderSummary(testData.auctionId, testData.isolationBidderId);
  assert.equal(after.payments_total, 30);
  assert.equal(after.donations_total, 7);
  assert.equal(after.balance, 10);
});

addTest("P-050e","refunds only reduce donation after lot payment is exhausted", async () => {
  const before = await getBidderSummary(testData.auctionId, testData.isolationBidderId);
  const donationPayment = before.payments.find((payment) => Number(payment.donation_amount) === 5 && Number(payment.amount) === 35);
  assert.ok(donationPayment, "Expected a mixed payment with donation");

  const finalRefund = await fetchJson(`${baseUrl}/settlement/payment/${donationPayment.id}/reverse`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ amount: 25, reason: "refund remaining mixed payment", auction_id: testData.auctionId })
  });
  await expectStatus(finalRefund.res, 201);
  assert.equal(Number(finalRefund.json?.refunded_donation || 0), 5);

  const after = await getBidderSummary(testData.auctionId, testData.isolationBidderId);
  assert.equal(after.payments_total, 10);
  assert.equal(after.donations_total, 2);
  assert.equal(after.balance, 30);
});

addTest("P-050f","auction summary totals reflect payments donations and grand totals", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/settlement/summary?auction_id=${testData.auctionId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.equal(Number(json.lots_total), 40);
  assert.equal(Number(json.payments_total), 10);
  assert.equal(Number(json.donations_total), 2);
  assert.equal(Number(json.current_grand_total), 12);
  assert.equal(Number(json.expected_grand_total), 42);
  const breakdownPaymentsTotal = Object.values(json.breakdown || {}).reduce(
    (sum, entry) => sum + Number(entry?.payments_total || 0),
    0
  );
  const breakdownDonationsTotal = Object.values(json.breakdown || {}).reduce(
    (sum, entry) => sum + Number(entry?.donations_total || 0),
    0
  );
  assert.equal(Number(breakdownPaymentsTotal.toFixed(2)), 10);
  assert.equal(Number(breakdownDonationsTotal.toFixed(2)), 2);
  assert.equal(Number(json.breakdown.cash?.donations_total || 0), 7);
  assert.equal(Number(json.breakdown['cash (Refund)']?.donations_total || 0), -5);
});

addTest("P-050g","live feed payment status ignores donations", async () => {
  const { res, json } = await getLiveFeed(testData.auctionId, { includeUnsold: true });
  await expectStatus(res, 200);
  const bidder = json.bidders.find((row) => Number(row.bidder_id) === Number(testData.isolationBidderId));
  assert.ok(bidder, "Expected isolation bidder in live feed");
  assert.equal(Number(bidder.payments_total), 10);
  assert.equal(bidder.payment_status, "part_paid");
  assert.equal(bidder.can_collect, true);
});

addTest("P-050h","manual payment rejects negative donation amount", async () => {
  const before = await getBidderSummary(testData.auctionId, testData.isolationBidderId);
  const { res } = await fetchJson(`${baseUrl}/settlement/payment/${testData.auctionId}`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ bidder_id: testData.isolationBidderId, amount: 0, donation_amount: -1, method: "cash" })
  });
  await expectStatus(res, 400);
  const after = await getBidderSummary(testData.auctionId, testData.isolationBidderId);
  assert.equal(after.payments_total, before.payments_total);
  assert.equal(after.donations_total, before.donations_total);
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

addTest("P-051c","POST /payments/intents bidder/auction mismatch no payment intent", async () => {
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  const mismatchAmountMinor = Math.max(1, Math.min(testData.sumupOutstandingMinor, 100));
  const { res } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.auctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: mismatchAmountMinor,
      channel: "app"
    })
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
  const tempPassword = `${managedUsers.cashier.password}_temp`;
  const { res: res1 } = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(managedUsers.cashier.username)}/password`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ newPassword: tempPassword })
  });
  await expectStatus(res1, 200);
  managedUsers.cashier.password = tempPassword;
  tokens.cashier = await loginAs("cashier", managedUsers.cashier.password, managedUsers.cashier.username);
  context.token = tokens.cashier;
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

addTest("P-054b","POST /payments/intents hosted channel coverage", async () => {
  if (testData.sumupOutstandingMinor < 1) {
    return skipTest("No outstanding balance available for SumUp hosted intent tests.");
  }
  const amountMinor = Math.min(testData.sumupOutstandingMinor, 200);
  const { res, json, text } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: amountMinor,
      channel: "hosted",
      note: "phase1 sumup hosted intent"
    })
  });
  if (res.status === 503) {
    return skipTest(`Hosted SumUp disabled in this environment: ${text || json?.error || "503"}`);
  }
  await expectStatus(res, 201);
  assert.ok(json && json.intent_id, `Missing hosted intent id: ${text}`);
  testData.sumupHostedIntentId = json.intent_id;
});

addTest("P-054c","GET /payments/intents/:id success hosted intent", async () => {
  if (!testData.sumupHostedIntentId) {
    return skipTest("No hosted SumUp intent available.");
  }
  const { res, json } = await fetchJson(`${baseUrl}/payments/intents/${testData.sumupHostedIntentId}`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.equal(json.intent_id, testData.sumupHostedIntentId);
  assert.equal(json.channel, "hosted");
  assert.equal(json.status, "pending");
});

addTest("P-054d","GET /payments/sumup/callback/fail marks hosted intent failed", async () => {
  if (!testData.sumupHostedIntentId) {
    return skipTest("No hosted SumUp intent available.");
  }
  const res = await fetch(`${baseUrl}/payments/sumup/callback/fail?status=failed&foreign-tx-id=${testData.sumupHostedIntentId}`);
  await expectStatus(res, 200);
  await waitForIntentStatus(testData.sumupHostedIntentId, "failed", 3000);
});



addTest("P-055","POST /payments/intents failure missing auction id", async () => {
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

addTest("P-059a","POST /payments/intents failure donation without full balance payment", async () => {
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  if ((before.balance || 0) < 2) {
    return skipTest("No sufficient outstanding balance available for SumUp partial-donation validation.");
  }
  const { res, json } = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: Math.round((before.balance - 1) * 100),
      donation_minor: 100,
      channel: "app"
    })
  });
  await expectStatus(res, 400);
  assert.match(json?.error || "", /Donation requires/i);
});

addTest("P-060","GET /payments/intents/:id success", async () => {
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
  if (!testData.sumupIntentId || testData.sumupPaymentsAfterSuccess == null) {
    return skipTest("No SumUp intent available.");
  }
  await fetch(`${baseUrl}/payments/sumup/callback/success?status=success&foreign-tx-id=${testData.sumupIntentId}`);
  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.payments_total, testData.sumupPaymentsAfterSuccess);
});

addTest("P-069a","GET /payments/sumup/callback/success finalizes full-balance payment with donation", async () => {
  const before = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  const outstandingMinor = Math.max(0, Math.round((before.balance || 0) * 100));
  if (outstandingMinor < 1) {
    return skipTest("No outstanding balance available for SumUp donation finalization.");
  }

  const create = await fetchJson(`${baseUrl}/payments/intents`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      auction_id: testData.sumupAuctionId,
      bidder_id: testData.sumupBidderId,
      amount_minor: outstandingMinor,
      donation_minor: 250,
      channel: "app",
      note: "phase1 sumup donation"
    })
  });
  await expectStatus(create.res, 201);
  assert.equal(create.json?.donation_minor, 250);

  const callback = await fetch(`${baseUrl}/payments/sumup/callback/success?status=success&foreign-tx-id=${create.json.intent_id}`);
  await expectStatus(callback, 200);
  await waitForIntentStatus(create.json.intent_id, "succeeded", 3000);

  const after = await getBidderSummary(testData.sumupAuctionId, testData.sumupBidderId);
  assert.equal(after.balance, 0);
  assert.ok(Math.abs(Number(after.payments_total) - Number(before.lots_total)) < 0.01, "SumUp full-balance payment did not settle lots");
  assert.ok(Math.abs(Number(after.donations_total) - (Number(before.donations_total || 0) + 2.5)) < 0.01, "SumUp donation total did not update");
  const latestPayment = after.payments[after.payments.length - 1];
  assert.ok(latestPayment, "Expected latest SumUp payment");
  assert.ok(Math.abs(Number(latestPayment.amount) - ((outstandingMinor + 250) / 100)) < 0.01, "SumUp gross payment amount mismatch");
  assert.ok(Math.abs(Number(latestPayment.donation_amount) - 2.5) < 0.01, "SumUp payment donation amount mismatch");
});

run().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
