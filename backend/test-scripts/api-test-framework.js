#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const util = require("util");

function initFramework(options) {
  const {
    baseUrl,
    logFilePath,
    loginPath = "/login",
    loginRole = "maintenance",
    loginPassword,
    loginHeaders = { "Content-Type": "application/json" },
    timeoutMs = 10000,
    additionalDetail = true
  } = options;

  const { FormData, Blob } = globalThis;
  if (!FormData || !Blob || !globalThis.fetch) {
    throw new Error("This framework requires Node 18+ with fetch, FormData, and Blob.");
  }

    const argv = process.argv.slice(2);

    const summaryOnly = argv.includes("--summary-only") || argv.includes("-s");

  

  const logPath = logFilePath || path.join(__dirname, "api-tests.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  function writeLog(level, message, isError = false, toConsole = true) {
    const line = `[${new Date().toISOString()}] ${level} ${message}\n`;
    if (toConsole) {
      if (isError) {
        process.stderr.write(line);
      } else {
        process.stdout.write(line);
      }
    }
    logStream.write(line);
  }

  console.log = (...args) => writeLog("INFO", util.format(...args));
  console.error = (...args) => writeLog("ERROR", util.format(...args), true);

  const context = {
    token: null,
    baseUrl,
    lastResponse: null
  };

  function authHeaders(token, extra = {}) {
    return { Authorization: token, ...extra };
  }

  async function fetchJson(url, options) {
    const method = (options && options.method) ? options.method : "GET";
    const res = await fetch(url, options);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    res._bodyText = text;
    res._bodyJson = json;
    res._request = { method, url };
    context.lastResponse = { status: res.status, json, text, method, url };
    return { res, json, text };
  }

  async function expectStatus(res, expected) {
    if (!context.lastResponse || context.lastResponse.status !== res.status) {
      const request = res._request || {};
      context.lastResponse = {
        status: res.status,
        json: res._bodyJson || null,
        text: res._bodyText || "",
        method: request.method,
        url: request.url
      };
    }
    if (res.status === expected) return;
    let detail = res._bodyText || "";
    if (!detail) {
      try {
        detail = await res.text();
      } catch {
        detail = "";
      }
    }
    const snippet = detail ? detail.slice(0, 500) : "<no body>";
    const err = new Error(`Expected status ${expected}, got ${res.status}. Response: ${snippet}`);
    err.response = { status: res.status, body: snippet };
    throw err;
  }

  const tests = [];
  function addTest(idOrName, nameOrFn, fnOrOpts, maybeOpts) {
    let id;
    let name;
    let fn;
    let opts;

    if (typeof nameOrFn === "function") {
      id = String(tests.length + 1).padStart(3, "0");
      name = idOrName;
      fn = nameOrFn;
      opts = fnOrOpts || {};
    } else {
      id = String(idOrName);
      name = nameOrFn;
      fn = fnOrOpts;
      opts = maybeOpts || {};
    }

    const { skip = false, timeout = timeoutMs } = opts;
    tests.push({ id, name, fn, skip, timeout });
  }

  function skipTest(reason) {
    const err = new Error(reason);
    err.__skip = true;
    throw err;
  }

  function listTests() {
    tests.forEach(t => {
      console.log(`${t.id} ${t.name}`);
    });
  }

  function selectTestsByArg() {
    const argv = process.argv.slice(2);
    const listOnly = argv.includes("--list") || argv.includes("-l");
    const testIndex = argv.findIndex(arg => arg === "--test" || arg === "-t");
    const filter = testIndex >= 0 ? argv[testIndex + 1] : null;

    if (listOnly) {
      listTests();
      process.exit(0);
    }

    if (!filter) return tests;

    const normalizedFilter = String(filter);
    const idMatches = tests.filter(t =>
      String(t.id) === normalizedFilter ||
      String(t.id).replace(/^0+/, "") === normalizedFilter
    );
    if (idMatches.length) return idMatches;

    const normalized = String(filter).toLowerCase();
    return tests.filter(t => t.name.toLowerCase().includes(normalized));
  }

  async function login() {
    context.token = await loginAs(loginRole, loginPassword);
  }

  async function loginAs(role, password) {
    const { res, json, text } = await fetchJson(`${baseUrl}${loginPath}`, {
      method: "POST",
      headers: loginHeaders,
      body: JSON.stringify({ role, password })
    });

    if (res.status !== 200 || !json || !json.token) {
      tests.forEach(test => {
        test.skip = true;
      });
      const reason = text ? text.slice(0, 200) : `status=${res.status}`;
      console.error(`Login failed for role ${role}; skipping remaining tests. ${reason}`);
      return null;
    }

    return json.token;
  }

  async function run() {
    await login();
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    const selected = selectTestsByArg();
    if (selected.length === 0) {
      console.log("No matching tests found.");
      return;
    }
    
var failedTests="";

    for (const test of selected) {
      var responseString = "";
      
      context.lastResponse = null;
      if (test.skip) {
        skipped++;
        responseString = `SKIP ${test.id} ${test.name}`;
        writeLog("INFO", responseString, false, !summaryOnly);
        continue;
      }
      try {
        await Promise.race([
          test.fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${test.timeout}ms`)), test.timeout)
          )
        ]);
        passed++;
        responseString = `PASS ${test.id} ${test.name}`;
        // console.log(`PASS ${test.id} ${test.name}`);
      } catch (err) {
        if (err.__skip) {
          skipped++;
          responseString = `SKIP ${test.id} ${test.name}: ${err.message}`;
          // console.log(`SKIP ${test.id} ${test.name}: ${err.message}`);
        } else {
          failed++;
          failedTests += `${test.id} ${test.name} || `;
          responseString = `FAIL ${test.id} ${test.name}: ${err.message}`;
          // console.error(`FAIL ${test.id} ${test.name}: ${err.message}`);
        }
      } finally {
        if (additionalDetail) {
          const detail = context.lastResponse;
          if (detail) {
            const body = detail.json ? JSON.stringify(detail.json) : (detail.text || "");
            const method = detail.method || "<unknown>";
            const url = detail.url || "<unknown>";
            responseString += ` | ${method} ${url} status=${detail.status} body=${body.substring(0, 100)}`;
            // console.log(`DETAIL ${test.id} ${test.name}: status=${detail.status} body=${body.substring(0, 200)}`);
          } else {
            responseString += ` | status=<none> body=<none>`;
            // console.log(`DETAIL ${test.id} ${test.name}: status=<none> body=<none>`);
          }
        }
      }
    if (!summaryOnly) {
      console.log(responseString);
    } else {
      writeLog("INFO", responseString, false, false);
    }
    }
console.log("\n==================== Summary ===================="); 
    console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log(`Failed tests: ${failedTests}`);
    console.log(`Detailed log written to ${logPath}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  }

  return {
    context,
    addTest,
    skipTest,
    run,
    authHeaders,
    fetchJson,
    expectStatus,
    loginAs,
    listTests
  };
}

module.exports = { initFramework };
