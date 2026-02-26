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
  process.env.ADMIN_PASSWORD || 
  "testpassword";
const logFilePath = process.env.LOG_FILE || path.join(__dirname, "backend-tests.log");

if (!bootstrapPassword) {
  throw new Error(
    "Missing bootstrap password. Set ROOT_PASSWORD or TEST_BOOTSTRAP_PASSWORD before running backend tests."
  );
}

const userSeed = Date.now().toString(36);
const managedUsers = {
  admin: {
    username: `bt_admin_${userSeed}`,
    password: `BtAdmin_${userSeed}_A1!`,
    roles: ["admin"]
  },
  maintenance: {
    username: `bt_maint_${userSeed}`,
    password: `BtMaint_${userSeed}_M1!`,
    roles: ["maintenance"]
  },
  cashier: {
    username: `bt_cash_${userSeed}`,
    password: `BtCash_${userSeed}_C1!`,
    roles: ["cashier"]
  },
  slideshow: {
    username: `bt_show_${userSeed}`,
    password: `BtShow_${userSeed}_L1!`,
    roles: ["slideshow"]
  },
  selfService: {
    username: `bt_self_${userSeed}`,
    password: `BtSelf_${userSeed}_S1!`,
    roles: ["cashier"]
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
  bootstrap: null,
  admin: null,
  maintenance: null,
  cashier: null,
  selfService: null,
  slideshow: null
};

const testData = {
  auctionPublicId: null,
  auctionId: null,
  auctionShortName: null,
  itemA: null,
  itemB: null,
  deleteItem: null,
  photoItem: null,
  allSlipItemIds: []
};

  // Sleep function that returns a promise
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

async function waitForAuctionStatus(expected, timeoutMs = 15000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "<none>";
  while (Date.now() < deadline) {
    const { res, json, text } = await fetchJson(`${baseUrl}/auction-status`, {
      method: "POST",
      headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
      body: JSON.stringify({ auction_id: testData.auctionId })
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

async function attemptLoginWith(username, role, password) {
  return fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, role, password })
  });
}

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
    roles: user.roles
  });

  if (create.res.status === 201) return;

  if (create.res.status !== 409) {
    throw new Error(`Unable to create ${user.username}: ${create.text || create.res.status}`);
  }

  const roleUpdate = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(user.username)}/roles`, {
    method: "PATCH",
    headers: authHeaders(tokens.maintenance || context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ roles: user.roles })
  });
  await expectStatus(roleUpdate.res, 200);

  const passwordUpdate = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(user.username)}/password`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance || context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ newPassword: user.password })
  });
  await expectStatus(passwordUpdate.res, 200);
}

async function setAuctionStatus(status) {
  const { res, json, text } = await fetchJson(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId, status })
  });
  await expectStatus(res, 200);
  const okText = text === "" || text === "OK";
  assert.ok((json && json.message) || okText, "Unexpected status update response");
  await waitForAuctionStatus(status);
  await sleep(1000);
}

async function createItem({ publicId, description, contributor, artist, notes, photo }) {
  const form = new FormData();
  form.append("description", description);
  form.append("contributor", contributor);
  if (artist) form.append("artist", artist);
  if (notes) form.append("notes", notes);
  if (photo) {
    form.append("photo", photo.blob, photo.filename);
  }
  const { res, json, text } = await fetchJson(`${baseUrl}/auctions/${publicId}/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 200);
  assert.ok(json && json.id, `Create item failed: ${text}`);
  return json.id;
}

addTest("B-001","setup: login all roles", async () => {
  tokens.bootstrap = context.token;
  tokens.maintenance = context.token;

  await ensureManagedUser(managedUsers.admin);
  await ensureManagedUser(managedUsers.maintenance);
  await ensureManagedUser(managedUsers.cashier);
  await ensureManagedUser(managedUsers.slideshow);
  await ensureManagedUser(managedUsers.selfService);

  tokens.maintenance = await loginAs("maintenance", managedUsers.maintenance.password, managedUsers.maintenance.username);
  tokens.cashier = await loginAs("cashier", managedUsers.cashier.password, managedUsers.cashier.username);
  tokens.slideshow = await loginAs("slideshow", managedUsers.slideshow.password, managedUsers.slideshow.username);
  tokens.selfService = await loginAs("cashier", managedUsers.selfService.password, managedUsers.selfService.username);
  tokens.admin = await loginAs("admin", managedUsers.admin.password, managedUsers.admin.username);
  context.token = tokens.admin;
});

addTest("B-001a","setup: login slideshow role directly", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: managedUsers.slideshow.username,
      role: "slideshow",
      password: managedUsers.slideshow.password
    })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.token, "Slideshow login failed");
  tokens.slideshow = json.token;
});

addTest("B-002","setup: create auction and items", async () => {
  const stamp = Date.now();
  testData.auctionShortName = `test_backend_${stamp}`;
  const { res, json, text } = await maintenanceRequest("/maintenance/auctions/create", {
    short_name: testData.auctionShortName,
    full_name: `Backend Test Auction ${stamp}`,
    logo: "default_logo.png"
  });
  await expectStatus(res, 201);
  assert.ok(json && json.message, `Auction create failed: ${text}`);

  const list = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(list.res, 200);
  const found = list.json.find(a => a.short_name === testData.auctionShortName);
  assert.ok(found, "Created auction not found");
  
  testData.auctionId = found.id;
  //public id needed for add item calls
  testData.auctionPublicId = found.public_id;
console.log(`Created test auction id=${testData.auctionId} public_id=${testData.auctionPublicId}`);

  await maintenanceRequest("/maintenance/auctions/set-admin-state-permission", {
    auction_id: testData.auctionId,
    admin_can_change_state: true
  });

 await setAuctionStatus("setup");

  testData.itemA = await createItem({
    publicId: testData.auctionPublicId,
    description: "Backend Test Item A",
    contributor: "Contributor A",
    artist: "Artist A",
    notes: "Notes A"
  });
  testData.itemB = await createItem({
    publicId: testData.auctionPublicId,
    description: "Backend Test Item B",
    contributor: "Contributor B",
    artist: "Artist B",
    notes: "Notes B"
  });

   testData.deleteItem = await createItem({
    publicId: testData.auctionPublicId,
    description: "Delete Item",
    contributor: "Delete Contributor"
  });

  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
  const photoBlob = new Blob([Buffer.from(pngBase64, "base64")], { type: "image/png" });
  testData.photoItem = await createItem({
    publicId: testData.auctionPublicId,
    description: "Backend Photo Item",
    contributor: "Contributor Photo",
    artist: "Artist Photo",
    notes: "Notes Photo",
    photo: { blob: photoBlob, filename: `photo_${Date.now()}.png` }
  });
}, { timeout: 10000 });

// /login
addTest("B-003","POST /login success admin", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: managedUsers.admin.username,
      role: "admin",
      password: managedUsers.admin.password
    })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.token, "Missing token");
});

addTest("B-004","POST /login failure missing password", async () => {
  const { res } = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: managedUsers.admin.username, role: "admin" })
  });
  await expectStatus(res, 400);
});

addTest("B-005","POST /login failure invalid password", async () => {
  const { res } = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: managedUsers.admin.username, role: "admin", password: "wrong" })
  });
  await expectStatus(res, 403);
});

addTest("B-006","POST /login failure missing role", async () => {
  const { res } = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: managedUsers.admin.username, password: managedUsers.admin.password })
  });
  await expectStatus(res, 400);
});

addTest("B-006a","POST /login failure missing username", async () => {
  const { res } = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "admin", password: managedUsers.admin.password })
  });
  await expectStatus(res, 400);
});

addTest("B-006b","POST /login failure invalid username format", async () => {
  const { res } = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Invalid User", role: "admin", password: managedUsers.admin.password })
  });
  await expectStatus(res, 400);
});

addTest("B-006c","POST /login failure invalid role value", async () => {
  const { res } = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: managedUsers.admin.username, role: "nope", password: managedUsers.admin.password })
  });
  await expectStatus(res, 400);
});

addTest("B-006d","POST /login failure valid user with unassigned role", async () => {
  const { res, json } = await attemptLoginWith(managedUsers.admin.username, "maintenance", managedUsers.admin.password);
  await expectStatus(res, 403);
  assert.equal(json?.error, "Role not assigned to this user");
});

addTest("B-006e","POST /change-password failure wrong current password", async () => {
  const { res } = await fetchJson(`${baseUrl}/change-password`, {
    method: "POST",
    headers: authHeaders(tokens.selfService, { "Content-Type": "application/json" }),
    body: JSON.stringify({ currentPassword: "not-correct", newPassword: `${managedUsers.selfService.password}_new` })
  });
  await expectStatus(res, 403);
});

addTest("B-006f","POST /change-password failure short new password", async () => {
  const { res } = await fetchJson(`${baseUrl}/change-password`, {
    method: "POST",
    headers: authHeaders(tokens.selfService, { "Content-Type": "application/json" }),
    body: JSON.stringify({ currentPassword: managedUsers.selfService.password, newPassword: "1234" })
  });
  await expectStatus(res, 400);
});

addTest("B-006g","POST /change-password success and login with new password", async () => {
  const nextPassword = `${managedUsers.selfService.password}_new`;
  const { res } = await fetchJson(`${baseUrl}/change-password`, {
    method: "POST",
    headers: authHeaders(tokens.selfService, { "Content-Type": "application/json" }),
    body: JSON.stringify({ currentPassword: managedUsers.selfService.password, newPassword: nextPassword })
  });
  await expectStatus(res, 200);

  const oldLogin = await attemptLoginWith(managedUsers.selfService.username, "cashier", managedUsers.selfService.password);
  await expectStatus(oldLogin.res, 403);

  const newLogin = await attemptLoginWith(managedUsers.selfService.username, "cashier", nextPassword);
  await expectStatus(newLogin.res, 200);
  assert.ok(newLogin.json && newLogin.json.token, "Expected login token with updated password");

  const revert = await fetchJson(`${baseUrl}/change-password`, {
    method: "POST",
    headers: authHeaders(newLogin.json.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ currentPassword: nextPassword, newPassword: managedUsers.selfService.password })
  });
  await expectStatus(revert.res, 200);
});

// /validate
addTest("B-007","POST /validate success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: context.token })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.token, "Missing token");
});

addTest("B-008","POST /validate failure missing token", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
});

addTest("B-009","POST /validate failure invalid token", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "invalid.token.value" })
  });
  await expectStatus(res, 403);
});

addTest("B-010","POST /validate failure malformed token", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: 1234 })
  });
  await expectStatus(res, 403);
});

// /slideshow-auth (legacy route disabled)
addTest("B-011","GET /slideshow-auth disabled route", async () => {
  const res = await fetch(`${baseUrl}/slideshow-auth`);
  await expectStatus(res, 404);
});

// /auctions/:auctionId/newitem
addTest("B-015","POST /auctions/:auctionId/newitem success", async () => {
  await setAuctionStatus("setup");
  const form = new FormData();
  form.append("description", "Backend New Item");
  form.append("contributor", "Contributor New");
  form.append("artist", "Artist New");
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 200);
  assert.ok(json && json.id, "Missing item id");
});

addTest("B-015a","POST /auctions/:auctionId/newitem failure invalid photo extension", async () => {
  await setAuctionStatus("setup");
  const form = new FormData();
  form.append("description", "Backend New Item Invalid Photo");
  form.append("contributor", "Contributor Invalid Photo");
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
  const photoBlob = new Blob([Buffer.from(pngBase64, "base64")], { type: "image/png" });
  form.append("photo", photoBlob, `photo_${Date.now()}.txt`);
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 400);
  assert.ok(json && json.error, "Expected invalid image error payload");
});

addTest("B-016","POST /auctions/:auctionId/newitem failure missing auction_id", async () => {
  const form = new FormData();
  form.append("description", "Missing Auction");
  form.append("contributor", "Contributor");
  const { res } = await fetchJson(`${baseUrl}/auctions/0/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 400);
});

addTest("B-016a","POST /auctions/:auctionId/newitem failure invalid public_id", async () => {
  const form = new FormData();
  form.append("description", "Missing Auction");
  form.append("contributor", "Contributor");
  const { res, json } = await fetchJson(`${baseUrl}/auctions/not-a-real-id/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 400);
  assert.ok(json && json.error, "Expected error payload");
});

addTest("B-017","POST /auctions/:auctionId/newitem failure missing fields", async () => {
  const form = new FormData();
  form.append("description", "Missing Contributor");
  const { res } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 400);
});

addTest("B-017b","POST /auctions/:auctionId/newitem failure whitespace in required fields", async () => {
  const form = new FormData();
  form.append("description", "                      ");
    form.append("contributor", "               ");
  const { res } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 400);
});

addTest("B-018","POST /auctions/:auctionId/newitem failure locked auction without admin", async () => {
  await setAuctionStatus("locked");
  const form = new FormData();
  form.append("description", "Locked Item");
  form.append("contributor", "Contributor Locked");
  const { res } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 403);
  assert.ok(res, "Expected forbidden response");
});

// addTest("B-018a","POST /auctions/:auctionId/newitem public rate limit", async () => {
//   await setAuctionStatus("setup");
//   await sleep(1000);
//   const maxAttempts = Number.isFinite(config.RATE_LIMIT_MAX) ? config.RATE_LIMIT_MAX : 5;
//   for (let i = 0; i < maxAttempts + 10; i += 1) {
//     const form = new FormData();
//     form.append("description", `Rate limit item ${Date.now()}-${i}`);
//     form.append("contributor", "Contributor Rate Limit");
//     const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/newitem`, {
//       method: "POST",
//       body: form
//     });
//     if (res.status === 429) {
//       assert.ok(json && typeof json.error === "string" && json.error.includes("Too many submissions"), "Expected rate limit response");
//       break;
//     }
//   }

//   await sleep(3000);
// });

addTest("B-018b","POST /auctions/:auctionId/newitem admin bypasses rate limit", async () => {

  const adminForm = new FormData();
  adminForm.append("description", `Admin bypass rate limit ${Date.now()}`);
  adminForm.append("contributor", "Contributor Admin");
  const { res, json, text } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/newitem`, {
    method: "POST",
    headers: authHeaders(tokens.admin),
    body: adminForm
  });
  await expectStatus(res, 200);
  assert.ok(json && json.id, `Admin bypass failed: ${text}`);
});

addTest("B-018c","POST /auctions/:auctionId/newitem admin wrong credentials", async () => {

  const adminForm = new FormData();
  adminForm.append("description", `Admin bypass rate limit ${Date.now()}`);
  adminForm.append("contributor", "Contributor Admin");
  const { res, json, text } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/newitem`, {
    method: "POST",
    headers: authHeaders('randcomtokenvalue'),
    body: adminForm
  });
  await expectStatus(res, 403);
  // assert.ok(json && json.error, `Expected error payload: ${text}`);
});


// /auctions/:auctionId/items
addTest("B-019","GET /auctions/:auctionId/items success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && Array.isArray(json.items), "Missing items list");
});

addTest("B-020","GET /auctions/:auctionId/items failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items`);
  await expectStatus(res, 403);
});

addTest("B-021","GET /auctions/:auctionId/items failure invalid auction id", async () => {
  const res = await fetch(`${baseUrl}/auctions/abc/items`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("B-022","GET /auctions/:auctionId/items failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items`, {
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(res, 403);
});

// /auctions/:auctionId/items/:id/update
addTest("B-023","POST /auctions/:auctionId/items/:id/update success", async () => {
  await setAuctionStatus("setup");
  const form = new FormData();
  form.append("description", "Updated Description");
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.itemA}/update`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, "Missing update message");
});

addTest("B-024","POST /auctions/:auctionId/items/:id/update failure unauthenticated", async () => {
  const form = new FormData();
  form.append("description", "No Auth Update");
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.itemA}/update`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 403);
});

addTest("B-025","POST /auctions/:auctionId/items/:id/update failure item not found", async () => {
  const form = new FormData();
  form.append("description", "Missing Item");
  const { res } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/999999/update`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  await expectStatus(res, 400);
});

addTest("B-025a","POST /auctions/:auctionId/items/:id/update failure item/auction mismatch", async () => {
  const badAuctionId = testData.auctionId + 9999;
  const form = new FormData();
  form.append("description", "Mismatch");
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${badAuctionId}/items/${testData.itemA}/update`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  await expectStatus(res, 400);
  assert.ok(json && json.error, "Expected error payload");
});

addTest("B-026","POST /auctions/:auctionId/items/:id/update failure wrong state", async () => {
  await setAuctionStatus("live");
  await sleep(1000);
  const form = new FormData();
  form.append("description", "Wrong State");
  const { res } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.itemA}/update`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  await expectStatus(res, 400);

});

// /items/:id delete
addTest("B-027","DELETE /items/:id success", async () => {
  await setAuctionStatus("setup");
  await sleep(1000);
  const tempItemId = testData.deleteItem;
  const { res, json } = await fetchJson(`${baseUrl}/items/${tempItemId}`, {
    method: "DELETE",
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, "Missing delete message");
});

addTest("B-028","DELETE /items/:id failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/items/${testData.itemA}`, {
    method: "DELETE"
  });
  await expectStatus(res, 403);
});

addTest("B-029","DELETE /items/:id failure item not found", async () => {
  const { res } = await fetchJson(`${baseUrl}/items/999999`, {
    method: "DELETE",
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("B-030","DELETE /items/:id failure wrong state", async () => {
  await setAuctionStatus("live");
  const { res } = await fetchJson(`${baseUrl}/items/${testData.itemA}`, {
    method: "DELETE",
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
  await setAuctionStatus("setup");
});

// /generate-pptx
addTest("B-031","POST /generate-pptx success", async () => {
  const res = await fetch(`${baseUrl}/generate-pptx`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 200);
  await res.arrayBuffer();
});

addTest("B-032","POST /generate-pptx failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/generate-pptx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

addTest("B-033","POST /generate-pptx failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/generate-pptx`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

addTest("B-034","POST /generate-pptx failure invalid token", async () => {
  const res = await fetch(`${baseUrl}/generate-pptx`, {
    method: "POST",
    headers: authHeaders("badtoken", { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

// /generate-cards
addTest("B-035","POST /generate-cards success", async () => {
  const res = await fetch(`${baseUrl}/generate-cards`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 200);
  await res.arrayBuffer();
});

addTest("B-036","POST /generate-cards failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/generate-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

addTest("B-037","POST /generate-cards failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/generate-cards`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

addTest("B-038","POST /generate-cards failure invalid token", async () => {
  const res = await fetch(`${baseUrl}/generate-cards`, {
    method: "POST",
    headers: authHeaders("badtoken", { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

// /auctions/:auctionId/items/:id/print-slip
addTest("B-038a","GET /auctions/:auctionId/items/:id/print-slip success", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.itemA}/print-slip`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  const contentType = res.headers.get("content-type") || "";
  assert.ok(contentType.includes("application/pdf"), `Unexpected content-type: ${contentType}`);
  const idsHeader = (res.headers.get("x-slip-item-ids") || "").trim();
  assert.ok(idsHeader.length > 0, "Expected X-Slip-Item-Ids header");
  assert.ok(idsHeader.split(",").map((v) => Number(v)).includes(testData.itemA), "Expected printed item id in X-Slip-Item-Ids");
  const buffer = await res.arrayBuffer();
  assert.ok(buffer.byteLength > 0, "Slip PDF is empty");

  const { res: itemsRes, json: itemsJson } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(itemsRes, 200);
  const printedItem = Array.isArray(itemsJson?.items)
    ? itemsJson.items.find((row) => row.id === testData.itemA)
    : null;
  assert.ok(printedItem, "Printed item not found in item list");
  assert.ok(!printedItem.last_print, "Expected last_print to remain unchanged before confirmation");
});

addTest("B-038aa","POST /auctions/:auctionId/items/confirm-slip-print success single item", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/confirm-slip-print`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ item_ids: [testData.itemA] })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.updated_count === 1, "Expected one updated item");

  const { res: itemsRes, json: itemsJson } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(itemsRes, 200);
  const printedItem = Array.isArray(itemsJson?.items)
    ? itemsJson.items.find((row) => row.id === testData.itemA)
    : null;
  assert.ok(printedItem, "Printed item not found in item list after confirmation");
  assert.ok(printedItem.last_print, "Expected last_print to be set after confirmation");
});

addTest("B-038b","GET /auctions/:auctionId/items/:id/print-slip failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.itemA}/print-slip`);
  await expectStatus(res, 403);
});

addTest("B-038c","GET /auctions/:auctionId/items/:id/print-slip failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.itemA}/print-slip`, {
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(res, 403);
});

addTest("B-038d","GET /auctions/:auctionId/items/print-slip scope=needs-print success", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/print-slip?scope=needs-print`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  const contentType = res.headers.get("content-type") || "";
  assert.ok(contentType.includes("application/pdf"), `Unexpected content-type: ${contentType}`);
  const idsHeader = (res.headers.get("x-slip-item-ids") || "").trim();
  assert.ok(idsHeader.length > 0, "Expected X-Slip-Item-Ids header for needs-print");
  const buffer = await res.arrayBuffer();
  assert.ok(buffer.byteLength > 0, "Needs-print PDF is empty");
});

addTest("B-038e","GET /auctions/:auctionId/items/print-slip scope=all success", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/print-slip?scope=all`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  const contentType = res.headers.get("content-type") || "";
  assert.ok(contentType.includes("application/pdf"), `Unexpected content-type: ${contentType}`);
  const idsHeader = (res.headers.get("x-slip-item-ids") || "").trim();
  assert.ok(idsHeader.length > 0, "Expected X-Slip-Item-Ids header for all scope");
  testData.allSlipItemIds = idsHeader
    .split(",")
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  assert.ok(testData.allSlipItemIds.length > 0, "Expected at least one printable item id");
  const buffer = await res.arrayBuffer();
  assert.ok(buffer.byteLength > 0, "All-items slip PDF is empty");
});

addTest("B-038ea","POST /auctions/:auctionId/items/confirm-slip-print success batch", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/confirm-slip-print`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ item_ids: testData.allSlipItemIds })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.updated_count === testData.allSlipItemIds.length, "Expected all batch ids to be updated");
});

addTest("B-038f","GET /auctions/:auctionId/items/print-slip scope=needs-print no matches", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/print-slip?scope=needs-print`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
  assert.ok(json && json.error, "Expected error payload for empty needs-print scope");
});

addTest("B-038g","GET /auctions/:auctionId/items/print-slip scope=all failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/print-slip?scope=all`);
  await expectStatus(res, 403);
});

addTest("B-038h","GET /auctions/:auctionId/items/print-slip scope=all failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/print-slip?scope=all`, {
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(res, 403);
});

addTest("B-038i","GET /auctions/:auctionId/items/print-slip failure invalid scope", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/print-slip?scope=invalid-scope`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
  assert.ok(json && json.error, "Expected error payload for invalid scope");
});

addTest("B-038j","POST /auctions/:auctionId/items/confirm-slip-print failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/confirm-slip-print`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: [testData.itemA] })
  });
  await expectStatus(res, 403);
});

addTest("B-038k","POST /auctions/:auctionId/items/confirm-slip-print failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/confirm-slip-print`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ item_ids: [testData.itemA] })
  });
  await expectStatus(res, 403);
});

addTest("B-038l","POST /auctions/:auctionId/items/confirm-slip-print failure invalid payload", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/confirm-slip-print`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ item_ids: [] })
  });
  await expectStatus(res, 400);
  assert.ok(json && json.error, "Expected error payload for invalid confirmation payload");
});

addTest("B-038m","POST /auctions/:auctionId/items/reset-slip-print success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/reset-slip-print`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 200);
  assert.ok(json && Number.isInteger(json.updated_count), "Expected updated_count integer");

  const { res: itemsRes, json: itemsJson } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(itemsRes, 200);
  const items = Array.isArray(itemsJson?.items) ? itemsJson.items : [];
  assert.ok(items.length > 0, "Expected auction items to exist");
  const anyPrinted = items.some((row) => row.last_print != null && String(row.last_print).trim() !== "");
  assert.equal(anyPrinted, false, "Expected all item last_print values to be cleared");
});

addTest("B-038n","POST /auctions/:auctionId/items/reset-slip-print failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/reset-slip-print`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
});

addTest("B-038o","POST /auctions/:auctionId/items/reset-slip-print failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/reset-slip-print`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
});

addTest("B-038p","POST /auctions/:auctionId/items/reset-slip-print failure invalid auction id", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auctions/abc/items/reset-slip-print`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 400);
  assert.ok(json && json.error, "Expected error payload for invalid auction id");
});

// /export-csv
addTest("B-039","POST /export-csv success", async () => {
  const res = await fetch(`${baseUrl}/export-csv`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 200);
  await res.arrayBuffer();
});

addTest("B-040","POST /export-csv failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/export-csv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

addTest("B-041","POST /export-csv failure missing auction_id", async () => {
  const { res } = await fetchJson(`${baseUrl}/export-csv`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 400);
});

addTest("B-042","POST /export-csv failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/export-csv`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

// /rotate-photo
addTest("B-043","POST /rotate-photo success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/rotate-photo`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: testData.photoItem, direction: "left" })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, "Missing rotate message");
});

addTest("B-044","POST /rotate-photo failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/rotate-photo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: testData.photoItem, direction: "left" })
  });
  await expectStatus(res, 403);
});

addTest("B-045","POST /rotate-photo failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/rotate-photo`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: testData.photoItem, direction: "left" })
  });
  await expectStatus(res, 403);
});

addTest("B-046","POST /rotate-photo failure invalid item", async () => {
  const { res } = await fetchJson(`${baseUrl}/rotate-photo`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: 999999, direction: "left" })
  });
  await expectStatus(res, 500);
});

// /auctions/:auctionId/slideshow-items
addTest("B-047","GET /auctions/:publicId/slideshow-items success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/slideshow-items`, {
    headers: authHeaders(tokens.slideshow)
  });
  await expectStatus(res, 200);
  assert.ok(Array.isArray(json), "Expected array");
});

addTest("B-048","GET /auctions/:publicId/slideshow-items failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionPublicId}/slideshow-items`);
  await expectStatus(res, 403);
});

addTest("B-049","GET /auctions/:publicId/slideshow-items failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionPublicId}/slideshow-items`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 403);
});

addTest("B-050","GET /auctions/:publicId/slideshow-items failure invalid auction_id text", async () => {
  const res = await fetch(`${baseUrl}/auctions/abc/slideshow-items`, {
    headers: authHeaders(tokens.slideshow)
  });
  await expectStatus(res, 400);
});

addTest("B-050a","GET /auctions/:publicId/slideshow-items failure invalid auction_id number", async () => {
  const res = await fetch(`${baseUrl}/auctions/0/slideshow-items`, {
    headers: authHeaders(tokens.slideshow)
  });
  await expectStatus(res, 400);
});


// /validate-auction
addTest("B-058","POST /validate-auction success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/validate-auction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ short_name: testData.auctionShortName })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.valid, "Auction not valid");
});

addTest("B-059","POST /validate-auction failure missing short_name", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate-auction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  await expectStatus(res, 400);
});

addTest("B-060","POST /validate-auction failure unknown short_name", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate-auction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ short_name: "does_not_exist" })
  });
  await expectStatus(res, 400);
});

addTest("B-060b","POST /validate-auction failure bad auth", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate-auction`, {
    method: "POST",
    headers: authHeaders("blah", { "Content-Type": "application/json" }),
    body: JSON.stringify({ short_name: testData.auctionShortName })
  });
  await expectStatus(res, 403);
});
  

addTest("B-061","POST /validate-auction failure empty short_name", async () => {

  const { res } = await fetchJson(`${baseUrl}/validate-auction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ short_name: "" })
  });
  await expectStatus(res, 400);
});

//TODO add test for short name OK but auction not in setup state 
addTest("B-061a","POST /validate-auction failure short name OK but auction not in setup state", async () => {
  await setAuctionStatus("locked");
  await sleep(1000);
  const { res } = await fetchJson(`${baseUrl}/validate-auction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ short_name: testData.auctionShortName })
  });
  await expectStatus(res, 400);
});

addTest("B-061b","POST /validate-auction pass auth override", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate-auction`, {
    method: "POST",
    headers: authHeaders(tokens.admin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ short_name: testData.auctionShortName })
  });
  await expectStatus(res, 200);
});

addTest("B-061c","POST /validate-auction failure auth override with cashier token", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate-auction`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ short_name: testData.auctionShortName })
  });
  await expectStatus(res, 403);
});



// /list-auctions
addTest("B-062","POST /list-auctions success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 200);
  assert.ok(Array.isArray(json), "Expected array");
});

addTest("B-063","POST /list-auctions failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
});

addTest("B-063a","POST /list-auctions failure unauthenticated error payload", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
  assert.equal(json?.error, "Access denied");
});

addTest("B-064","POST /list-auctions failure invalid status", async () => {
  const { res } = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ status: "invalid" })
  });
  await expectStatus(res, 400);
});

addTest("B-065","POST /list-auctions failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(tokens.slideshow, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
});

addTest("B-065a","POST /list-auctions failure invalid token error payload", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders("badtoken", { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
  assert.equal(json?.error, "Session expired");
});

// /auctions/:auctionId/items/:id/move-after/:after_id
addTest("B-066","POST /auctions/:auctionId/items/:id/move-after/:after_id success", async () => {
  await setAuctionStatus("setup");
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.itemA}/move-after/${testData.itemB}`, {
    method: "POST",
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, "Missing move response");
});

addTest("B-067","POST /auctions/:auctionId/items/:id/move-after/:after_id failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.itemA}/move-after/${testData.itemB}`, {
    method: "POST"
  });
  await expectStatus(res, 403);
});

addTest("B-068","POST /auctions/:auctionId/items/:id/move-after/:after_id failure invalid ids", async () => {
  const { res } = await fetchJson(`${baseUrl}/auctions/0/items/0/move-after/0`, {
    method: "POST",
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("B-069","POST /auctions/:auctionId/items/:id/move-after/:after_id failure after_id not found", async () => {
  const { res } = await fetchJson(`${baseUrl}/auctions/${testData.auctionId}/items/${testData.itemA}/move-after/999999`, {
    method: "POST",
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

// /auction-status
addTest("B-070","POST /auction-status success", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/auction-status`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.status, "Missing status");
});

addTest("B-071","POST /auction-status failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/auction-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

addTest("B-072","POST /auction-status failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/auction-status`, {
    method: "POST",
    headers: authHeaders(tokens.cashier, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

addTest("B-073","POST /auction-status failure invalid token", async () => {
  const res = await fetch(`${baseUrl}/auction-status`, {
    method: "POST",
    headers: authHeaders("badtoken", { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId })
  });
  await expectStatus(res, 403);
});

// /items/:id/history ->> Now changed to audit endpoint
addTest("B-074","GET /audit_log (item history) success", async () => {
    const { res, json } = await fetchJson(`${baseUrl}/audit-log?object_id=${testData.itemA}&object_type=item`, {
  // const { res, json } = await fetchJson(`${baseUrl}/items/${testData.itemA}/history`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(Array.isArray(json.logs), "Expected array");
});

addTest("B-075","GET /audit_log (item history) failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/audit-log?object_id=${testData.itemA}&object_type=item`);
  await expectStatus(res, 403);
});

addTest("B-076","GET /audit_log (item history) failure wrong role", async () => {
  const res = await fetch(`${baseUrl}/audit-log?object_id=${testData.itemA}&object_type=item`, {
    headers: authHeaders(tokens.cashier)
  });
  await expectStatus(res, 403);
});

addTest("B-077","GET /audit_log (item history) failure invalid token", async () => {
  const res = await fetch(`${baseUrl}/audit-log?object_id=${testData.itemA}&object_type=item`, {
    headers: authHeaders("badtoken")
  });
  await expectStatus(res, 403);
});

// /auctions/update-status
addTest("B-078","POST /auctions/update-status success (maintenance)", async () => {
  const { res } = await fetchJson(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId, status: "setup" })
  });
  await expectStatus(res, 200);
});

addTest("B-079","POST /auctions/update-status failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auction_id: testData.auctionId, status: "setup" })
  });
  await expectStatus(res, 403);
});

addTest("B-080","POST /auctions/update-status failure missing auction_id", async () => {
  const { res } = await fetchJson(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ status: "setup" })
  });
  await expectStatus(res, 400);
});

addTest("B-081","POST /auctions/update-status failure invalid status", async () => {
  const { res } = await fetchJson(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId, status: "invalid" })
  });
  await expectStatus(res, 400);
});

addTest("B-082","POST /auctions/update-status failure admin not allowed", async () => {
  await maintenanceRequest("/maintenance/auctions/set-admin-state-permission", {
    auction_id: testData.auctionId,
    admin_can_change_state: false
  });
  const { res } = await fetchJson(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: testData.auctionId, status: "setup" })
  });
  await expectStatus(res, 403);
  await maintenanceRequest("/maintenance/auctions/set-admin-state-permission", {
    auction_id: testData.auctionId,
    admin_can_change_state: true
  });
});

addTest("B-083","POST /login failure malformed JSON body", async () => {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{\"role\":\"admin\",\"password\":"
  });
  await expectStatus(res, 400);
});

addTest("B-083a","POST /login lockout after repeated failures", async () => {
  const lockoutAfter = Number.isFinite(config.LOGIN_LOCKOUT_AFTER) ? config.LOGIN_LOCKOUT_AFTER : 5;
  for (let i = 0; i < lockoutAfter; i += 1) {
    await attemptLoginWith(managedUsers.admin.username, "admin", "wrong-password");
  
  }
  const { res, json } = await attemptLoginWith(managedUsers.admin.username, "admin", "wrong-password");
  await expectStatus(res, 429);
  assert.ok(json && typeof json.error === "string" && json.error.includes("Too many failed attempts"), "Expected lockout response");
});


addTest("B-084","POST /validate failure unreasonable token length", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "x".repeat(10000) })
  });
  await expectStatus(res, 403);
});

addTest("B-085","POST /list-auctions failure unreasonable status length", async () => {
  const { res } = await fetchJson(`${baseUrl}/list-auctions`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ status: "x".repeat(5000) })
  });
  await expectStatus(res, 400);
});

addTest("B-086","POST /validate-auction failure unreasonable short_name length", async () => {
  const { res } = await fetchJson(`${baseUrl}/validate-auction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ short_name: "x".repeat(300) })
  });
  await expectStatus(res, 400);
});

addTest("B-087","POST /maintenance/generate-bids failure missing auction id", async () => {
  const { res, json } = await fetchJson(`${baseUrl}/maintenance/generate-bids`, {
    method: "POST",
    headers: authHeaders(tokens.maintenance, { "Content-Type": "application/json" }),
    body: JSON.stringify({ num_bids: 1, num_bidders: 1 })
  });
  await expectStatus(res, 400);
  assert.ok(json && json.error, "Expected error payload");
});

// /auctions/:auctionId/newitem
addTest("B-088","POST /auctions/:auctionId/newitem rate limit reset", async () => {
//  await sleep(30000); // Wait to ensure rate limit window has passed.
  
  await setAuctionStatus("setup");
  const form = new FormData();
  form.append("description", "Backend New Item");
  form.append("contributor", "Contributor New");
  form.append("artist", "Artist New");
  const { res, json } = await fetchJson(`${baseUrl}/auctions/${testData.auctionPublicId}/newitem`, {
    method: "POST",
    body: form
  });
  await expectStatus(res, 200);
  assert.ok(json && json.id, "Missing item id");
});

run().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
