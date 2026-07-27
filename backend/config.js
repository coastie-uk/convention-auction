/**
 * @file        config.js
 * @description Sets up configuration from config.json and .env
 * @author      Chris Staples
 * @license     GPL3
 */


const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
// const { logLevels, log } = require('./logger');

dotenv.config(); // read .env if present

// get SECRET KEY from .env
// const SECRET_KEY = process.env.SECRET_KEY;

const explicitEnvPath = process.env.MANEBID_ENV_FILE || process.env.AUCTION_ENV_FILE;
const ENV_PATH = explicitEnvPath || '/etc/manebid/manebid.env';

// An explicitly selected file may contain credentials other than SECRET_KEY,
// so always load it. Runtime environment variables still win because dotenv's
// override option defaults to false. Preserve the existing systemd behaviour by
// not probing the default file when SECRET_KEY is already supplied directly.
if (explicitEnvPath || !process.env.SECRET_KEY) {
  try {
    // Basic sanity: file exists and is readable
    fs.accessSync(ENV_PATH, fs.constants.R_OK);
    dotenv.config({ path: ENV_PATH });
 //   log('config', logLevels.INFO, `loaded env from ${ENV_PATH}`);
    console.info(`[config] loaded env from ${ENV_PATH}`);
  } catch (e) {
    console.error(`[config] WARN: could not read ${ENV_PATH}: ${e.message}`);
 //   log('config', logLevels.WARN, `could not read ${ENV_PATH}: ${e.message}`);
  }
}


const SECRET_KEY = process.env.SECRET_KEY;

// Basic sanity check for length of key
if (!SECRET_KEY || SECRET_KEY.trim().length < 16) {
 // log('config', logLevels.ERROR, 'FATAL: SECRET_KEY missing/too short in environment (.env).');
 console.error('[config] FATAL: SECRET_KEY missing/too short in environment (.env).');
  process.exit(1);
}

const SUMUP_WEB_ENABLED = parseBoolEnv('SUMUP_WEB_ENABLED', false);
const SUMUP_CARD_PRESENT_ENABLED = parseBoolEnv('SUMUP_CARD_PRESENT_ENABLED', false);

// SumUp uses these credentials for hosted checkout creation and for
// server-side verification/finalisation of both hosted and app payments.
requireGroupIfEnabled(SUMUP_WEB_ENABLED || SUMUP_CARD_PRESENT_ENABLED, 'SumUp Payments', [
  'SUMUP_API_KEY',
  'SUMUP_MERCHANT_CODE'
]);

requireGroupIfEnabled(SUMUP_WEB_ENABLED, 'SumUp Web Payments', [
  'SUMUP_RETURN_URL'
]);

requireGroupIfEnabled(SUMUP_CARD_PRESENT_ENABLED, 'SumUp Card-Present Payments', [
  'SUMUP_AFFILIATE_KEY',
  'SUMUP_APP_ID',
  'SUMUP_CALLBACK_SUCCESS',
  'SUMUP_CALLBACK_FAIL'
]);

// Load config.json (needed for all other settings). Container deployments mount
// a read-only, non-secret config and select it with MANEBID_CONFIG_FILE; existing
// installations continue to use the config beside this module.
const jsonPath = path.resolve(
  process.env.MANEBID_CONFIG_FILE || path.join(__dirname, 'config.json')
);
if (!fs.existsSync(jsonPath)) {
 console.error('[config] FATAL: config.json not found:', jsonPath);
 // log('config', logLevels.ERROR, `FATAL: config.json not found: ${jsonPath}`);
  process.exit(1);
}

let json;
try {
  json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
 console.error('[config] FATAL: config.json is not valid JSON:', e.message);
 // log('config', logLevels.ERROR, `FATAL: config.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

// make sure secret is not still in config.json (i.e. previous config style)
if (Object.prototype.hasOwnProperty.call(json, 'SECRET_KEY')) {
 // log('config', logLevels.ERROR, 'FATAL: SECRET_KEY found in config.json. This is a vulnrabiliy. Remove it and put it in .env only.');
  console.error('[config] FATAL: SECRET_KEY found in config.json. This is a vulnrabiliy. Remove it and put it in .env only.');
  process.exit(1);
}

// Validate required fields in config.json
function reqStr(obj, key, minLen = 1, maxLen = Infinity) {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`Missing/invalid string: ${key}`);
  }
  if (v.length < minLen || v.length > maxLen) {
    throw new Error(`String ${key} length is out of bounds: ${minLen} <= ${v.length} <= ${maxLen}`);
  }
  return v;
}
function reqNum(obj, key, min = -Infinity, max = Infinity ) {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Missing/invalid number: ${key}`);
  }
  if (v < min || v > max) {
    throw new Error(`Number ${key} is out of bounds: ${min} <= ${v} <= ${max}`);
  }
  return v;
}

function optBool(obj, key, defaultValue = false) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return defaultValue;
  const v = obj[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  throw new Error(`Invalid boolean: ${key}`);
}

function optNum(obj, key, defaultValue, min = -Infinity, max = Infinity) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return defaultValue;
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Invalid number: ${key}`);
  }
  if (v < min || v > max) {
    throw new Error(`Number ${key} is out of bounds: ${min} <= ${v} <= ${max}`);
  }
  return v;
}

function optMegabytes(obj, mbKey, bytesKey, defaultMb, minMb = 1, maxMb = Infinity) {
  if (Object.prototype.hasOwnProperty.call(obj, mbKey)) {
    const v = optNum(obj, mbKey, defaultMb, minMb, maxMb);
    if (!Number.isInteger(v)) {
      throw new Error(`Number ${mbKey} must be an integer number of megabytes`);
    }
    return v * 1024 * 1024;
  }
  return optNum(obj, bytesKey, defaultMb * 1024 * 1024, minMb * 1024 * 1024, maxMb * 1024 * 1024);
}

function optStr(obj, key, defaultValue, minLen = 1, maxLen = Infinity) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return defaultValue;
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`Invalid string: ${key}`);
  }
  if (v.length < minLen || v.length > maxLen) {
    throw new Error(`String ${key} length is out of bounds: ${minLen} <= ${v.length} <= ${maxLen}`);
  }
  return v;
}

function optEnum(obj, key, defaultValue, allowedValues) {
  const value = optStr(obj, key, defaultValue);
  if (!allowedValues.includes(value)) {
    throw new Error(`Invalid ${key}: expected one of ${allowedValues.join(', ')}`);
  }
  return value;
}

function optTrustedProxies(obj) {
  if (!Object.prototype.hasOwnProperty.call(obj, 'TRUSTED_PROXIES')) {
    return ['loopback'];
  }

  const value = obj.TRUSTED_PROXIES;
  if (Number.isInteger(value) && value >= 0 && value <= 10) {
    return value;
  }
  if (Array.isArray(value)) {
    const proxies = value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (proxies.length > 0 && proxies.length === value.length) {
      return proxies;
    }
  }
  throw new Error('Invalid TRUSTED_PROXIES: expected a non-empty string list or an integer from 0 to 10');
}



let cfg;
try {

  const DB_PATH        = reqStr(json, 'DB_PATH');         // e.g., "/var/lib/manebid"
  const DB_NAME        = reqStr(json, 'DB_NAME', 1, 100);         // e.g., "manebid.db"
  const UPLOAD_DIR     = reqStr(json, 'UPLOAD_DIR');      // e.g., "uploads"
  const BACKUP_DIR     = reqStr(json, 'BACKUP_DIR');      // e.g., "backups"
  const CONFIG_IMG_DIR = reqStr(json, 'CONFIG_IMG_DIR');  // e.g., "resources"
  const SAMPLE_DIR     = reqStr(json, 'SAMPLE_DIR');      // e.g., "sample-assets"
  const MAX_UPLOADS    = reqNum(json, 'MAX_UPLOADS', 1, 1000);               // e.g., 100
  const MAX_AUCTIONS   = reqNum(json, 'MAX_AUCTIONS', 1, 100);               // e.g., 50
  const MAX_ITEMS      = reqNum(json, 'MAX_ITEMS', 1, 10000);               // e.g., 2000
  const allowedExtensions = json.allowedExtensions;
  const LOG_LEVEL      = reqStr(json, 'LOG_LEVEL', 3, 10);         // e.g., "INFO"
  const PORT           = reqNum(json, 'PORT', 1, 65535);               // e.g., 3000
  const HOST           = optStr(json, 'HOST', '127.0.0.1', 1, 255);
  const TRUSTED_PROXIES = optTrustedProxies(json);
  const DEPLOYMENT_MODE = parseDeploymentMode(process.env.MANEBID_DEPLOYMENT_MODE);
  const PPTX_CONFIG_DIR = reqStr(json, 'PPTX_CONFIG_DIR'); // e.g., "pptx-config"
  const LOG_DIR      = reqStr(json, 'LOG_DIR');         // e.g., "logs"
  const LOG_NAME      = reqStr(json, 'LOG_NAME');         // e.g., "server.log"
  const OUTPUT_DIR      = reqStr(json, 'OUTPUT_DIR');         // e.g., "output"
  const APPLICATION_PATH = optStr(json, 'APPLICATION_PATH', path.resolve(__dirname, '..'), 1, 4096);
  const CURRENCY_SYMBOL = reqStr(json, 'CURRENCY_SYMBOL', 1, 3); // e.g., "£"
  const PASSWORD_MIN_LENGTH = reqNum(json, 'PASSWORD_MIN_LENGTH', 5, 100); // e.g., 5
  const RATE_LIMIT_WINDOW = reqNum(json, 'RATE_LIMIT_WINDOW', 1, 86400); // in seconds
  const RATE_LIMIT_MAX = reqNum(json, 'RATE_LIMIT_MAX', 1, 1000);
  const ITEM_PHOTO_MAX_BYTES = optMegabytes(json, 'ITEM_PHOTO_MAX_MB', 'ITEM_PHOTO_MAX_BYTES', 10, 1, 50);
  const RESOURCE_IMAGE_MAX_BYTES = optMegabytes(json, 'RESOURCE_IMAGE_MAX_MB', 'RESOURCE_IMAGE_MAX_BYTES', 10, 1, 50);
  const RESOURCE_UPLOAD_MAX_FILES = optNum(json, 'RESOURCE_UPLOAD_MAX_FILES', Math.min(20, MAX_UPLOADS), 1, MAX_UPLOADS);
  const BACKUP_UPLOAD_MAX_BYTES = optMegabytes(json, 'BACKUP_UPLOAD_MAX_MB', 'BACKUP_UPLOAD_MAX_BYTES', 512, 1, 16 * 1024);
  const BACKUP_ARCHIVE_MAX_EXPANDED_BYTES = optMegabytes(json, 'BACKUP_ARCHIVE_MAX_EXPANDED_MB', 'BACKUP_ARCHIVE_MAX_EXPANDED_BYTES', 2048, 1, 64 * 1024);
  const BACKUP_ARCHIVE_MAX_ENTRY_BYTES = Object.prototype.hasOwnProperty.call(json, 'BACKUP_ARCHIVE_MAX_ENTRY_MB')
    ? optMegabytes(
      json,
      'BACKUP_ARCHIVE_MAX_ENTRY_MB',
      'BACKUP_ARCHIVE_MAX_ENTRY_BYTES',
      Math.min(512, BACKUP_ARCHIVE_MAX_EXPANDED_BYTES / 1024 / 1024),
      1,
      BACKUP_ARCHIVE_MAX_EXPANDED_BYTES / 1024 / 1024
    )
    : optNum(
    json,
    'BACKUP_ARCHIVE_MAX_ENTRY_BYTES',
    Math.min(512 * 1024 * 1024, BACKUP_ARCHIVE_MAX_EXPANDED_BYTES),
    1024,
    BACKUP_ARCHIVE_MAX_EXPANDED_BYTES
  );
  const BACKUP_ARCHIVE_MAX_ENTRIES = optNum(json, 'BACKUP_ARCHIVE_MAX_ENTRIES', 10000, 1, 100000);
  const LOGIN_LOCKOUT_AFTER = reqNum(json, 'LOGIN_LOCKOUT_AFTER', 1, 1000);
  const LOGIN_IP_LOCKOUT_AFTER = optNum(json, 'LOGIN_IP_LOCKOUT_AFTER', 40, 1, 10000);
  const LOGIN_LOCKOUT = reqNum(json, 'LOGIN_LOCKOUT', 1, 86400); // in seconds
  const SERVICE_NAME = reqStr(json, 'SERVICE_NAME', 1, 100); // e.g., "Auction_Backend"
  const RESTART_MODE = optEnum(json, 'RESTART_MODE', 'service', ['service', 'exit']);
  const MESSAGING_ENABLED = optBool(json, 'MESSAGING_ENABLED', true);
  const MESSAGING_MAX_MESSAGES = optNum(json, 'MESSAGING_MAX_MESSAGES', 1000, 1, 100000);
  const MESSAGING_MAX_CACHE_BYTES = optNum(json, 'MESSAGING_MAX_CACHE_BYTES', 1024 * 1024, 1024, 50 * 1024 * 1024);
  const MESSAGING_MAX_MESSAGE_CHARS = optNum(json, 'MESSAGING_MAX_MESSAGE_CHARS', 500, 1, 5000);
  const MESSAGING_OPEN_POLL_MS = optNum(json, 'MESSAGING_OPEN_POLL_MS', 3000, 1000, 60000);
  const MESSAGING_PRESENCE_TTL_MS = optNum(json, 'MESSAGING_PRESENCE_TTL_MS', 90000, 5000, 3600000);
  const MESSAGING_PERSISTENCE_FILE = optStr(json, 'MESSAGING_PERSISTENCE_FILE', path.join(DB_PATH, 'operator-messages.json'));
  const ALLOWED_ORIGINS = Array.isArray(json.ALLOWED_ORIGINS)
    ? json.ALLOWED_ORIGINS
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v !== '')
    : [];
  const ENABLE_CORS = Boolean(json.ENABLE_CORS);
  cfg = {
    // secret (env)
    SECRET_KEY,

    // runtime & non-secrets (from JSON)
    PORT,
    HOST,
    TRUSTED_PROXIES,
    DEPLOYMENT_MODE,
    LOG_LEVEL,
    DB_PATH,
    DB_NAME,
    UPLOAD_DIR,
    BACKUP_DIR,
    CONFIG_IMG_DIR,
    SAMPLE_DIR,
    MAX_UPLOADS,
    MAX_AUCTIONS,
    MAX_ITEMS,
    allowedExtensions,
    PPTX_CONFIG_DIR,
    LOG_DIR,
    LOG_NAME,
    OUTPUT_DIR,
    APPLICATION_PATH,
    CURRENCY_SYMBOL,
    PASSWORD_MIN_LENGTH,
    RATE_LIMIT_WINDOW,
    RATE_LIMIT_MAX,
    ITEM_PHOTO_MAX_BYTES,
    RESOURCE_IMAGE_MAX_BYTES,
    RESOURCE_UPLOAD_MAX_FILES,
    BACKUP_UPLOAD_MAX_BYTES,
    BACKUP_ARCHIVE_MAX_EXPANDED_BYTES,
    BACKUP_ARCHIVE_MAX_ENTRY_BYTES,
    BACKUP_ARCHIVE_MAX_ENTRIES,
    LOGIN_LOCKOUT_AFTER,
    LOGIN_IP_LOCKOUT_AFTER,
    LOGIN_LOCKOUT,
    SERVICE_NAME,
    RESTART_MODE,
    MESSAGING_ENABLED,
    MESSAGING_MAX_MESSAGES,
    MESSAGING_MAX_CACHE_BYTES,
    MESSAGING_MAX_MESSAGE_CHARS,
    MESSAGING_OPEN_POLL_MS,
    MESSAGING_PRESENCE_TTL_MS,
    MESSAGING_PERSISTENCE_FILE,
    ALLOWED_ORIGINS,
    ENABLE_CORS,

  // SumUp – web (hosted payments)
    SUMUP_WEB_ENABLED,
    SUMUP_API_KEY: process.env.SUMUP_API_KEY || null,
    SUMUP_MERCHANT_CODE: process.env.SUMUP_MERCHANT_CODE || null,
    SUMUP_RETURN_URL: process.env.SUMUP_RETURN_URL || null,

    // SumUp – card-present (deep link)
    SUMUP_CARD_PRESENT_ENABLED,
    SUMUP_AFFILIATE_KEY: process.env.SUMUP_AFFILIATE_KEY || null,
    SUMUP_APP_ID: process.env.SUMUP_APP_ID || null,
    SUMUP_CALLBACK_SUCCESS: process.env.SUMUP_CALLBACK_SUCCESS || null,
    SUMUP_CALLBACK_FAIL: process.env.SUMUP_CALLBACK_FAIL || null,
    PAYMENT_TTL_MIN: Number(process.env.PAYMENT_INTENT_TTL_MINUTES || 20),

    CURRENCY: validateSumupCurrency(process.env.CURRENCY, 'GBP'),

    //other payment method toggles
    CASH_ENABLED: parseBoolEnv('CASH_PAYMENT_ENABLED', true),
    MANUAL_CARD_ENABLED: parseBoolEnv('MANUAL_CARD_PAYMENT_ENABLED', true),
    PAYPAL_ENABLED: parseBoolEnv('PAYPAL_PAYMENT_ENABLED', false)
  };
} catch (e) {
  console.error('[config] FATAL:', e.message);
  process.exit(1);
}

// 5) Freeze & safe log
const config = Object.freeze(cfg);
if (config.LOG_LEVEL === 'DEBUG') {
//  log('config', logLevels.DEBUG, 'loaded', {

  console.info('[config] loaded', {
    CONFIG_PATH: jsonPath,
    PORT: config.PORT,
    DB_PATH: path.resolve(config.DB_PATH),
    UPLOAD_DIR: path.resolve(config.UPLOAD_DIR),
    BACKUP_DIR: path.resolve(config.BACKUP_DIR),
    CONFIG_IMG_DIR: path.resolve(config.CONFIG_IMG_DIR),
    SAMPLE_DIR: path.resolve(config.SAMPLE_DIR),
    PPTX_CONFIG_DIR: path.resolve(config.PPTX_CONFIG_DIR),
    LOG_DIR: path.resolve(config.LOG_DIR),
    LOG_NAME: config.LOG_NAME,
    OUTPUT_DIR: path.resolve(config.OUTPUT_DIR),
    APPLICATION_PATH: path.resolve(config.APPLICATION_PATH)

});
}

function parseBoolEnv(name, defaultValue = false) {
  const raw = process.env[name];

  if (raw === undefined) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  throw new Error(
    `Invalid boolean value for ${name}: "${raw}". Expected true/false/1/0/yes/no/on/off.`
  );
}

function parseDeploymentMode(value) {
  const normalized = String(value || 'native').trim().toLowerCase();
  if (normalized === 'native' || normalized === 'docker') {
    return normalized;
  }
  throw new Error(
    `Invalid MANEBID_DEPLOYMENT_MODE "${value}". Expected "native" or "docker".`
  );
}

function validateSumupCurrency(value, defaultValue) {
  if (value === undefined || value === null || value.toString().trim() === '') {
    return defaultValue;
  }

  const normalized = value.toString().trim().toUpperCase();
  const allowed = new Set([
    'BGN',
    'BRL',
    'CHF',
    'CLP',
    'CZK',
    'DKK',
    'EUR',
    'GBP',
    'HUF',
    'NOK',
    'PLN',
    'SEK',
    'USD'
  ]);

  if (!allowed.has(normalized)) {
    throw new Error(
      `Invalid SUMUP_CURRENCY "${value}". Expected one of: ${Array.from(allowed).join(', ')}.`
    );
  }

  return normalized;
}

/**
 * If a feature group is enabled, ensure all required env vars are present and non-empty.
 *
 * @param {boolean} enabled
 * @param {string} groupName        Human-readable group name (for error messages)
 * @param {string[]} requiredEnvKeys List of env var names to check
 */
function requireGroupIfEnabled(enabled, groupName, requiredEnvKeys) {
  if (!enabled) return;

  const missing = requiredEnvKeys.filter((key) => {
    const v = process.env[key];
    return v === undefined || v === null || v.toString().trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Configuration error: ${groupName} is enabled but the following environment variables are missing or empty: ${missing.join(
        ', '
      )}`
    );
  }
}



module.exports = config;
