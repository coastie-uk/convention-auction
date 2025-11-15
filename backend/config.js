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
    OUTPUT_DIR
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

module.exports = config;
