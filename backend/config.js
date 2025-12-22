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

const ENV_PATH = process.env.AUCTION_ENV_FILE || '/etc/auction/auction.env';

// Only load the file if SECRET_KEY isn't already set by the runtime (e.g., systemd)
if (!process.env.SECRET_KEY) {
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

requireGroupIfEnabled(SUMUP_WEB_ENABLED, 'SumUp Web Payments', [
  'SUMUP_API_KEY',
  'SUMUP_MERCHANT_CODE',
  'SUMUP_RETURN_URL'
]);

// SumUp: card-present via deep link
const SUMUP_CARD_PRESENT_ENABLED = parseBoolEnv('SUMUP_CARD_PRESENT_ENABLED', false);

requireGroupIfEnabled(SUMUP_CARD_PRESENT_ENABLED, 'SumUp Card-Present Payments', [
  'SUMUP_AFFILIATE_KEY',
  'SUMUP_APP_ID',
  'SUMUP_CALLBACK_SUCCESS',
  'SUMUP_CALLBACK_FAIL'
]);

// Load config.json (needed for all other settings)
const jsonPath = path.join(__dirname, 'config.json');
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
function reqStr(obj, key) {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`Missing/invalid string: ${key}`);
  }
  return v;
}
function reqNum(obj, key) {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Missing/invalid number: ${key}`);
  }
  return v;
}



let cfg;
try {

  const DB_PATH        = reqStr(json, 'DB_PATH');         // e.g., "/var/auction"
  const DB_NAME        = reqStr(json, 'DB_NAME');         // e.g., "auction.db"
  const UPLOAD_DIR     = reqStr(json, 'UPLOAD_DIR');      // e.g., "uploads"
  const BACKUP_DIR     = reqStr(json, 'BACKUP_DIR');      // e.g., "backups"
  const CONFIG_IMG_DIR = reqStr(json, 'CONFIG_IMG_DIR');  // e.g., "resources"
  const SAMPLE_DIR     = reqStr(json, 'SAMPLE_DIR');      // e.g., "sample-assets"
  const MAX_UPLOADS    = reqNum(json, 'MAX_UPLOADS');
  const MAX_AUCTIONS   = reqNum(json, 'MAX_AUCTIONS');
  const MAX_ITEMS      = reqNum(json, 'MAX_ITEMS');
  const allowedExtensions = json.allowedExtensions;
  const LOG_LEVEL      = reqStr(json, 'LOG_LEVEL');
  const PORT           = reqNum(json, 'PORT'); 
  const PPTX_CONFIG_DIR = reqStr(json, 'PPTX_CONFIG_DIR'); // e.g., "pptx-config"
  const LOG_DIR      = reqStr(json, 'LOG_DIR');         // e.g., "logs"
  const LOG_NAME      = reqStr(json, 'LOG_NAME');         // e.g., "server.log"
  const OUTPUT_DIR      = reqStr(json, 'OUTPUT_DIR');         // e.g., "output"
  const CURRENCY_SYMBOL = reqStr(json, 'CURRENCY_SYMBOL'); // e.g., "£"
  

  cfg = {
    // secret (env)
    SECRET_KEY,

    // runtime & non-secrets (from JSON)
    PORT,
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
    CURRENCY_SYMBOL,

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

    SUMUP_APP_INDIRECT_ENABLED: parseBoolEnv('SUMUP_APP_INDIRECT_ENABLED', false),

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
    PORT: config.PORT,
    LOG_LEVEL: config.LOG_LEVEL,
    DB_PATH: path.resolve(config.DB_PATH),
    UPLOAD_DIR: path.resolve(config.UPLOAD_DIR),
    BACKUP_DIR: path.resolve(config.BACKUP_DIR),
    CONFIG_IMG_DIR: path.resolve(config.CONFIG_IMG_DIR),
    SAMPLE_DIR: path.resolve(config.SAMPLE_DIR),
    MAX_UPLOADS: config.MAX_UPLOADS,
    MAX_AUCTIONS: config.MAX_AUCTIONS,
    MAX_ITEMS: config.MAX_ITEMS,
    allowedExtensions: config.allowedExtensions,
    PPTX_CONFIG_DIR: path.resolve(config.PPTX_CONFIG_DIR),
    LOG_DIR: path.resolve(config.LOG_DIR),
    LOG_NAME: config.LOG_NAME,
    OUTPUT_DIR: path.resolve(config.OUTPUT_DIR)

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
