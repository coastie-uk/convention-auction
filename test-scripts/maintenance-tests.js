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
const allowRestart = process.env.ALLOW_RESTART === "true";
const allowDeleteLastAuction = process.env.ALLOW_DELETE_LAST_AUCTION === "true";
const logFilePath = process.env.LOG_FILE || path.join(__dirname, "maintenance-tests.log");

if (!bootstrapPassword) {
  throw new Error(
    "Missing bootstrap password. Set ROOT_PASSWORD or TEST_BOOTSTRAP_PASSWORD before running maintenance tests."
  );
}

const userSeed = Date.now().toString(36);
const managedUsers = {
  lifecycle: {
    username: `mt_user_${userSeed}`,
    password: `MtUser_${userSeed}_U1!`,
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
  skipTest,
  run,
  authHeaders,
  fetchJson,
  expectStatus
} = framework;

context.testAuctionShortName = null;
context.testAuctionFullName = null;
context.testAuctionId = null;
context.auctionCount = null;
context.pptxConfig = null;
context.slipConfig = null;
context.resourceFilename = null;
context.dbBackupBuffer = null;
context.managedUser = managedUsers.lifecycle;

// async function updateAuctionStatus(auctionId, status) {
//   const { res, json, text } = await fetchJson(`${baseUrl}/auctions/update-status`, {
//     method: "POST",
//     headers: authHeaders(context.token, { "Content-Type": "application/json" }),
//     body: JSON.stringify({ auction_id: auctionId, status })
//   });

//   if (res.status !== 200) {
//     throw new Error(`Failed to update auction status: ${res.status} ${text || JSON.stringify(json)}`);
//   }
// }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

async function updateAuctionStatus(auctionId, status) {
  const { res, json, text } = await fetchJson(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: auctionId, status })
  });
   await sleep(3000);
  await expectStatus(res, 200);
  const okText = text === "" || text === "OK";
  assert.ok((json && json.message) || okText, "Unexpected status update response");
}

addTest("M-001","maintenance/backup success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/backup`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 200);
  assert.ok(json && json.path, `Unexpected backup response: ${text}`);
});

addTest("M-002","maintenance/backup failure unauthenticated", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/backup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
});

addTest("M-003","maintenance/download-db success", async () => {
  const res = await fetch(`${baseUrl}/maintenance/download-db`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  const buffer = await res.arrayBuffer();
  assert.ok(buffer.byteLength > 0, "Downloaded DB is empty");
  context.dbBackupBuffer = buffer;
});

addTest("M-004","maintenance/download-db failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/download-db`);
  await expectStatus(res, 403);
});

addTest("M-005","maintenance/restore failure missing file", async () => {
  const form = new FormData();
  const res = await fetch(`${baseUrl}/maintenance/restore`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  await expectStatus(res, 400);
});

addTest("M-006","maintenance/restore success", async () => {
  assert.ok(context.dbBackupBuffer, "Missing DB backup buffer");
  const form = new FormData();
  form.append("backup", new Blob([context.dbBackupBuffer]), "auction_restore.db");
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/restore`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected restore response: ${text}`);
});

addTest("M-007","maintenance/auctions/create failure missing short_name", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/auctions/create`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ full_name: "Missing Short Name" })
  });
  await expectStatus(res, 400);
});

addTest("M-008","maintenance/auctions/create success", async () => {
  const stamp = Date.now();
  context.testAuctionShortName = `test_${stamp}`;
  context.testAuctionFullName = `Test Auction ${stamp}`;

  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/auctions/create`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      short_name: context.testAuctionShortName,
      full_name: context.testAuctionFullName,
      logo: "default_logo.png"
    })
  });
  await expectStatus(res, 201);
  assert.ok(json && json.message, `Unexpected create response: ${text}`);
});

addTest("M-009","maintenance/auctions/list success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/auctions/list`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 200);
  assert.ok(Array.isArray(json), `Unexpected list response: ${text}`);
  const found = json.find(a => a.short_name === context.testAuctionShortName);
  assert.ok(found, "Test auction not found in list");
  context.testAuctionId = found.id;
  context.auctionCount = json.length;
});

addTest("M-010","maintenance/auctions/list failure unauthenticated", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/auctions/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
});

addTest("M-011","maintenance/auctions/set-admin-state-permission failure missing auction_id", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/auctions/set-admin-state-permission`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ admin_can_change_state: true })
  });
  await expectStatus(res, 400);
});

addTest("M-012","maintenance/auctions/set-admin-state-permission success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/auctions/set-admin-state-permission`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId, admin_can_change_state: true })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected response: ${text}`);
});

addTest("M-013","maintenance/export success", async () => {
  const res = await fetch(`${baseUrl}/maintenance/export`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  const contentType = res.headers.get("content-type") || "";
  assert.ok(contentType.includes("application/zip"), `Unexpected content-type: ${contentType}`);
  await res.arrayBuffer();
});

addTest("M-014","maintenance/export failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/export`);
  await expectStatus(res, 403);
});

addTest("M-015","maintenance/import failure invalid headers", async () => {
  const form = new FormData();
  const csv = "description,artist\nBad Row,Missing Columns\n";
  form.append("csv", new Blob([csv], { type: "text/csv" }), "bad.csv");
  const res = await fetch(`${baseUrl}/maintenance/import`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  await expectStatus(res, 400);
});

addTest("M-016","maintenance/import success", async () => {
  const form = new FormData();
  const csv = [
    "description,artist,contributor,notes,auction_id",
    `Test Item,Artist Name,Contributor Name,Notes,${context.testAuctionId}`
  ].join("\n");
  form.append("csv", new Blob([csv], { type: "text/csv" }), "items.csv");
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/import`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected import response: ${text}`);
});

addTest("M-017","maintenance/photo-report success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/photo-report`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && typeof json.count === "number", `Unexpected response: ${text}`);
});

addTest("M-018","maintenance/photo-report failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/photo-report`);
  await expectStatus(res, 403);
});

addTest("M-019","maintenance/check-integrity success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/check-integrity`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && typeof json.total === "number", `Unexpected response: ${text}`);
});

addTest("M-020","maintenance/check-integrity failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/check-integrity`);
  await expectStatus(res, 403);
});

addTest("M-021","maintenance/users list success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/users`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(Array.isArray(json?.users), `Unexpected users response: ${text}`);
  assert.ok(Array.isArray(json?.roles), "Roles metadata missing");
});

addTest("M-021a","maintenance/users list failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/users`);
  await expectStatus(res, 403);
});

addTest("M-021b","maintenance/users create failure invalid username", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ username: "Bad User", password: "ValidPassword1!", roles: ["cashier"] })
  });
  await expectStatus(res, 400);
});

addTest("M-021c","maintenance/users create failure short password", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ username: context.managedUser.username, password: "1234", roles: ["cashier"] })
  });
  await expectStatus(res, 400);
});

addTest("M-021d","maintenance/users create failure missing roles", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      username: context.managedUser.username,
      password: context.managedUser.password,
      roles: []
    })
  });
  await expectStatus(res, 400);
});

addTest("M-021e","maintenance/users create success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/users`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      username: context.managedUser.username,
      password: context.managedUser.password,
      roles: context.managedUser.roles
    })
  });
  await expectStatus(res, 201);
  assert.ok(json && json.message, `Unexpected create response: ${text}`);
});

addTest("M-021f","maintenance/users create failure duplicate username", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      username: context.managedUser.username,
      password: context.managedUser.password,
      roles: context.managedUser.roles
    })
  });
  await expectStatus(res, 409);
});

addTest("M-021g","maintenance/users/:username/roles failure invalid username", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users/Bad User/roles`, {
    method: "PATCH",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ roles: ["admin"] })
  });
  await expectStatus(res, 400);
});

addTest("M-021h","maintenance/users/:username/roles failure missing roles", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(context.managedUser.username)}/roles`, {
    method: "PATCH",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ roles: [] })
  });
  await expectStatus(res, 400);
});

addTest("M-021i","maintenance/users/:username/roles failure missing user", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users/no_such_user_${userSeed}/roles`, {
    method: "PATCH",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ roles: ["admin"] })
  });
  await expectStatus(res, 404);
});

addTest("M-021j","maintenance/users/:username/roles success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(context.managedUser.username)}/roles`, {
    method: "PATCH",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ roles: ["cashier", "maintenance"] })
  });
  await expectStatus(res, 200);
  assert.ok(json && Array.isArray(json.user?.roles), `Unexpected role update response: ${text}`);
  assert.ok(json.user.roles.includes("maintenance"), "Expected maintenance role after update");
});

addTest("M-021k","maintenance/users/:username/password failure short password", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(context.managedUser.username)}/password`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ newPassword: "1234" })
  });
  await expectStatus(res, 400);
});

addTest("M-021l","maintenance/users/:username/password failure missing user", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users/no_such_user_${userSeed}/password`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ newPassword: "ValidPassword1!" })
  });
  await expectStatus(res, 404);
});

addTest("M-021m","maintenance/users/:username/password success", async () => {
  const nextPassword = `${context.managedUser.password}_next`;
  const { res: updateRes } = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(context.managedUser.username)}/password`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ newPassword: nextPassword })
  });
  await expectStatus(updateRes, 200);

  const loginAfter = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: context.managedUser.username,
      role: "maintenance",
      password: nextPassword
    })
  });
  await expectStatus(loginAfter.res, 200);
  assert.ok(loginAfter.json?.token, "Expected user to authenticate with updated password");
  context.managedUser.password = nextPassword;
});

addTest("M-021n","maintenance/users/:username delete failure self-delete", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(bootstrapUsername)}`, {
    method: "DELETE",
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("M-021o","maintenance/users/:username delete failure root from non-root account", async () => {
  const guardUsername = `mt_guard_${userSeed}`;
  const guardPassword = `MtGuard_${userSeed}_G1!`;

  const createGuard = await fetchJson(`${baseUrl}/maintenance/users`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ username: guardUsername, password: guardPassword, roles: ["maintenance"] })
  });
  if (createGuard.res.status !== 201 && createGuard.res.status !== 409) {
    throw new Error(`Failed to prepare guard user: ${createGuard.text || createGuard.res.status}`);
  }
  if (createGuard.res.status === 409) {
    const patchGuard = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(guardUsername)}/roles`, {
      method: "PATCH",
      headers: authHeaders(context.token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ roles: ["maintenance"] })
    });
    await expectStatus(patchGuard.res, 200);

    const pwGuard = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(guardUsername)}/password`, {
      method: "POST",
      headers: authHeaders(context.token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ newPassword: guardPassword })
    });
    await expectStatus(pwGuard.res, 200);
  }

  const guardLogin = await fetchJson(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: guardUsername, role: "maintenance", password: guardPassword })
  });
  await expectStatus(guardLogin.res, 200);
  assert.ok(guardLogin.json?.token, "Guard user login failed");

  const { res, json } = await fetchJson(`${baseUrl}/maintenance/users/root`, {
    method: "DELETE",
    headers: authHeaders(guardLogin.json.token)
  });
  await expectStatus(res, 400);
  assert.equal(json?.error, "The root user cannot be deleted.");
});

addTest("M-021p","maintenance/users/:username delete failure missing user", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/users/no_such_user_${userSeed}`, {
    method: "DELETE",
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 404);
});

addTest("M-022","maintenance/users/:username delete success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/users/${encodeURIComponent(context.managedUser.username)}`, {
    method: "DELETE",
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected delete response: ${text}`);
});

addTest("M-022a","maintenance/change-password disabled route", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/change-password`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ username: context.managedUser.username, newPassword: "abcdefghi" })
  });
  await expectStatus(res, 404);
});

addTest("M-023","maintenance/get-pptx-config success", async () => {
  const { res, text } = await fetchJson(`${baseUrl}/maintenance/get-pptx-config/pptx`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  context.pptxConfig = JSON.parse(text);
  assert.ok(context.pptxConfig && typeof context.pptxConfig === "object", "PPTX config not parsed");
});

addTest("M-024","maintenance/get-pptx-config failure invalid name", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/get-pptx-config/invalid`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("M-024a","maintenance/get-slip-config success", async () => {
  const { res, text } = await fetchJson(`${baseUrl}/maintenance/get-pptx-config/slip`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  context.slipConfig = JSON.parse(text);
  assert.ok(context.slipConfig && typeof context.slipConfig === "object", "Slip config not parsed");
});

addTest("M-025","maintenance/save-pptx-config failure invalid JSON", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/save-pptx-config/pptx`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify("not an object")
  });
  await expectStatus(res, 400);
});

addTest("M-026","maintenance/save-pptx-config success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/save-pptx-config/pptx`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify(context.pptxConfig)
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected response: ${text}`);
});

addTest("M-026a","maintenance/save-slip-config success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/save-pptx-config/slip`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify(context.slipConfig)
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected response: ${text}`);
});

addTest("M-027","maintenance/pptx-config/reset failure invalid configType", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/pptx-config/reset`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ configType: "nope" })
  });
  await expectStatus(res, 400);
});

addTest("M-028","maintenance/pptx-config/reset success (restores)", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/pptx-config/reset`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ configType: "pptx" })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected reset response: ${text}`);

  const { res: res2 } = await fetchJson(`${baseUrl}/maintenance/save-pptx-config/pptx`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify(context.pptxConfig)
  });
  await expectStatus(res2, 200);
});

addTest("M-028a","maintenance/pptx-config/reset success for slip", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/pptx-config/reset`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ configType: "slip" })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected reset response: ${text}`);

  const { res: res2 } = await fetchJson(`${baseUrl}/maintenance/save-pptx-config/slip`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify(context.slipConfig)
  });
  await expectStatus(res2, 200);
});

addTest("M-029","maintenance/resources list success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/resources`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && Array.isArray(json.files), `Unexpected response: ${text}`);
});

addTest("M-030","maintenance/resources list failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/resources`);
  await expectStatus(res, 403);
});

addTest("M-031","maintenance/resources upload failure no files", async () => {
  const form = new FormData();
  const res = await fetch(`${baseUrl}/maintenance/resources/upload`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  await expectStatus(res, 400);
});

addTest("M-032","maintenance/resources upload success", async () => {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAwMB/6W5fXcAAAAASUVORK5CYII=";
  const fileName = `test_resource_${Date.now()}.png`;
  const form = new FormData();
  form.append("images", new Blob([Buffer.from(pngBase64, "base64")], { type: "image/png" }), fileName);

  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/resources/upload`, {
    method: "POST",
    headers: authHeaders(context.token),
    body: form
  });
  if (res.status === 400 && text.includes("Maximum number of image resources")) {
    skipTest("Resource upload skipped: MAX_UPLOADS reached.");
  }
  await expectStatus(res, 200);
  assert.ok(json && Array.isArray(json.saved), `Unexpected upload response: ${text}`);
  context.resourceFilename = fileName;
});

addTest("M-033","maintenance/resources delete failure invalid filename", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/resources/delete`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ filename: "../bad.png" })
  });
  await expectStatus(res, 400);
});

addTest("M-034","maintenance/resources delete success", async () => {
  if (!context.resourceFilename) {
    skipTest("Resource delete skipped: no uploaded filename.");
  }
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/resources/delete`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ filename: context.resourceFilename })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected delete response: ${text}`);
});

addTest("M-035","maintenance/orphan-photos success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/orphan-photos`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && typeof json.count === "number", `Unexpected response: ${text}`);
});

addTest("M-036","maintenance/orphan-photos failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/orphan-photos`);
  await expectStatus(res, 403);
});

addTest("M-037","maintenance/generate-test-data failure invalid count", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/generate-test-data`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId, count: 0 })
  });
  await expectStatus(res, 400);
});

addTest("M-038","maintenance/generate-test-data success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/generate-test-data`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId, count: 1 })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected response: ${text}`);
});

addTest("M-039","maintenance/update auction status to live", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId, status: "live" })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected response: ${text}`);
});

addTest("M-040","maintenance/update auction status to invalid", async () => {
  const { res } = await fetchJson(`${baseUrl}/auctions/update-status`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId, status: "nope" })
  });
  await expectStatus(res, 400);
}); 

addTest("M-041","maintenance/generate-bids failure invalid input", async () => {
await updateAuctionStatus(context.testAuctionId, "live");


  const { res } = await fetchJson(`${baseUrl}/maintenance/generate-bids`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId, num_bids: "nope" })
  });
  await expectStatus(res, 400);
});

addTest("M-042","maintenance/generate-bids success", async () => {
  await updateAuctionStatus(context.testAuctionId, "live");
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/generate-bids`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId, num_bids: 1, num_bidders: 1 })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected response: ${text}`);
});

addTest("M-043","maintenance/delete-test-bids failure missing auction_id", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/delete-test-bids`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 400);
});

addTest("M-044","maintenance/delete-test-bids success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/delete-test-bids`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected response: ${text}`);
});

addTest("M-044a","change state to setup", async () => {
await updateAuctionStatus(context.testAuctionId, "setup");

await sleep(2500);
});

addTest("M-045","maintenance/reset failure wrong password", async () => {

  const { res } = await fetchJson(`${baseUrl}/maintenance/reset`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId, password: "badpass" })
  });
  await expectStatus(res, 403);
});

addTest("M-045a","change state to archived", async () => {
await updateAuctionStatus(context.testAuctionId, "archived");

await sleep(2500);

});

addTest("M-046","maintenance/reset success", async () => {

  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/reset`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId, password: bootstrapPassword })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.ok, `Unexpected response: ${text}`);
});

addTest("M-047","maintenance/cleanup-orphan-photos success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/cleanup-orphan-photos`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected response: ${text}`);
});

addTest("M-048","maintenance/cleanup-orphan-photos failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/cleanup-orphan-photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
});

addTest("M-049","maintenance/download-full success", async () => {
  const res = await fetch(`${baseUrl}/maintenance/download-full`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  const contentType = res.headers.get("content-type") || "";
  assert.ok(contentType.includes("application/zip"), `Unexpected content-type: ${contentType}`);
  await res.arrayBuffer();
});

addTest("M-050","maintenance/download-full failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/download-full`);
  await expectStatus(res, 403);
});

addTest("M-051","maintenance/audit-log failure invalid filter", async () => {
  const res = await fetch(`${baseUrl}/audit-log?object_type=invalid`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 400);
});

addTest("M-051b","maintenance/audit-log success with filter", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/audit-log?object_type=item`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
    assert.ok(json && Array.isArray(json.logs), `Unexpected response: ${text}`);

});

addTest("M-051c","maintenance/audit-log success with full filter", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/audit-log?object_type=auction&object_id=1`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
    assert.ok(json && Array.isArray(json.logs), `Unexpected response: ${text}`);

});

addTest("M-052","maintenance/audit-log success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/audit-log`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && Array.isArray(json.logs), `Unexpected response: ${text}`);
});

addTest("M-053","maintenance/audit-log/export success", async () => {
  const res = await fetch(`${baseUrl}/maintenance/audit-log/export`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  const contentType = res.headers.get("content-type") || "";
  assert.ok(contentType.includes("text/csv"), `Unexpected content-type: ${contentType}`);
  await res.arrayBuffer();
});

addTest("M-054","maintenance/audit-log/export failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/audit-log/export`);
  await expectStatus(res, 403);
});

addTest("M-055","maintenance/logs success", async () => {
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/logs`, {
    headers: authHeaders(context.token)
  });
  await expectStatus(res, 200);
  assert.ok(json && typeof json.log === "string", `Unexpected response: ${text}`);
});

addTest("M-056","maintenance/logs failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/logs`);
  await expectStatus(res, 403);
});

addTest("M-057","maintenance/auctions/delete failure missing auction_id", async () => {
  const { res } = await fetchJson(`${baseUrl}/maintenance/auctions/delete`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({})
  });
  await expectStatus(res, 400);
});

addTest("M-058","maintenance/auctions/delete success", async () => {
  if (context.auctionCount <= 1 && !allowDeleteLastAuction) {
    skipTest("Refusing to delete the last auction. Set ALLOW_DELETE_LAST_AUCTION=true to override.");
  }
  const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/auctions/delete`, {
    method: "POST",
    headers: authHeaders(context.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ auction_id: context.testAuctionId })
  });
  await expectStatus(res, 200);
  assert.ok(json && json.message, `Unexpected delete response: ${text}`);
});

addTest("M-059",
  "maintenance/restart success",
  async () => {
    const { res, json, text } = await fetchJson(`${baseUrl}/maintenance/restart`, {
      method: "POST",
      headers: authHeaders(context.token, { "Content-Type": "application/json" }),
      body: JSON.stringify({})
    });
    await expectStatus(res, 200);
    assert.ok(json && json.message, `Unexpected restart response: ${text}`);
  },
  { skip: !allowRestart }
);

addTest("M-060","maintenance/restart failure unauthenticated", async () => {
  const res = await fetch(`${baseUrl}/maintenance/restart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  await expectStatus(res, 403);
});

run().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
