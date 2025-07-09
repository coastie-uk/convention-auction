/**
 * @file        logger.js
 * @description Basic logging framework. Supports 4 loglevels and log rotation
 * @author      Chris Staples
 * @license     GPL3
 */

const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'server.log');
const archiveDir = path.join(__dirname, 'logs'); // store rotated logs here

if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
}

const logLevels = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const MAX_LOG_SIZE_MB = 3;

let currentLogLevel = logLevels.INFO;

function setLogLevel(level) {
  if (typeof level === 'string') {
    const upper = level.toUpperCase();
    if (logLevels[upper] !== undefined) {
      currentLogLevel = logLevels[upper];
    } else {
      throw new Error(`Invalid log level string: ${level}`);
    }
  } else if (typeof level === 'number') {
    if (Object.values(logLevels).includes(level)) {
      currentLogLevel = level;
    } else {
      throw new Error(`Invalid log level number: ${level}`);
    }
  } else {
    throw new Error(`Unsupported log level type: ${typeof level}`);
  }
}

function getLevelName(levelValue) {
  return Object.keys(logLevels).find(key => logLevels[key] === levelValue);
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || // if behind proxy
    req.socket?.remoteAddress || 
    req.connection?.remoteAddress || 
    'unknown'
  );
}

function log(api, severityValue, message, ip = 'unknown') {
 // console.log(`Severity value: ${severityValue}, current log level ${currentLogLevel}`)
  if (severityValue < currentLogLevel) return;

  const timestamp = new Date().toISOString();
  const severity = getLevelName(severityValue);
  const entry = `[${timestamp}] [${severity}] [${ip}] [${api}] ${message}`;

  checkAndRotateLogIfNeeded();

  console.log(entry);
  fs.appendFile(logFilePath, entry + '\n', (err) => {
    if (err) console.error(`[LOGGER ERROR] Failed to write to log file: ${err.message}`);
  });
}

function logFromRequest(req, severityValue, message) {
  const endpoint = req.originalUrl || req.url;
  const ip = getClientIp(req);
  log(endpoint, severityValue, message, ip);
}

function createLogger(severityValue = logLevels.INFO) {
  return function (req, res, next) {
    const ip = getClientIp(req);
    log(req.originalUrl || req.url, severityValue, `${req.method} ${req.originalUrl}`, ip);
    next();
  };
}


function rotateLogs() {
  if (!fs.existsSync(logFilePath)) {
    console.log("No server.log to rotate.");
    return;
  }

  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // safe filename
  const archivePath = path.join(archiveDir, `server-${timestamp}.log`);

  fs.renameSync(logFilePath, archivePath); // archive the current log
  fs.writeFileSync(logFilePath, '');       // create a fresh log file

  console.log(`Log rotated to ${archivePath}`);
}


function checkAndRotateLogIfNeeded() {
  const stats = fs.existsSync(logFilePath) && fs.statSync(logFilePath);
  if (stats && stats.size > MAX_LOG_SIZE_MB * 1024 * 1024) {
    rotateLogs();
  }
}

module.exports = {
  logLevels,
  setLogLevel,
  logFromRequest,
  createLogger,
  log
};
