/**
 * @file        logger.js
 * @description Basic logging framework. Supports 4 loglevels and log rotation
 * @author      Chris Staples
 * @license     GPL3
 */

const fs = require('fs');
const path = require('path');
const { LOG_LEVEL, LOG_DIR, LOG_NAME } = require('./config');
const logFilePath = path.join(LOG_DIR, LOG_NAME);
const archiveDir = path.join(LOG_DIR); // store rotated logs here

if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
}

const logLevels = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const MAX_LOG_SIZE_MB = 1;

// default to INFO if setLogLevel not called
let currentLogLevel = logLevels.INFO;
log('Logger', logLevels.INFO, `Logging initialised`);


// Set the current log level
function setLogLevel(level) {
  if (typeof level === 'string') {
    const upper = level.toUpperCase();
    if (logLevels[upper] !== undefined) {
      currentLogLevel = logLevels[upper];
      log('Logger', logLevels.INFO, `Log level set to ${upper}`);
    } else {
      currentLogLevel = logLevels.INFO;
      throw new Error(`Invalid log level string: ${level}, defaulting to INFO`);
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
// Get log level name from value
function getLevelName(levelValue) {
  return Object.keys(logLevels).find(key => logLevels[key] === levelValue);
}

// Extract client IP from request
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || // if behind proxy
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

// Main logging function
function log(api, severityValue, message, ip = 'unknown') {
  // console.log(`Severity value: ${severityValue}, current log level ${currentLogLevel}`)
  if (severityValue < currentLogLevel) return;

  // Build the log entry
  const timestamp = new Date().toISOString();
  const severity = getLevelName(severityValue);
  const entry = `[${timestamp}] [${severity}] [${ip}] [${api}] ${message}`;

  checkAndRotateLogIfNeeded();

  console.log(entry);
  fs.appendFile(logFilePath, entry + '\n', (err) => {
    if (err) console.error(`[LOGGER ERROR] Failed to write to log file: ${err.message}`);
  });
}
// Log from an Express request
function logFromRequest(req, severityValue, message) {
  const endpoint = req.originalUrl || req.url;
  const ip = getClientIp(req);
  log(endpoint, severityValue, message, ip);
}
//  Express middleware to log each request
function createLogger(severityValue = logLevels.INFO) {
  return function (req, res, next) {
    const ip = getClientIp(req);
    log(req.originalUrl || req.url, severityValue, `${req.method} ${req.originalUrl}`, ip);
    next();
  };
}

//  Rotate logs if they exceed max size
function rotateLogs() {
  if (!fs.existsSync(logFilePath)) {
    //    console.log("No server.log to rotate.");
    log('Logger', logLevels.ERROR, `No server.log to rotate.`);
    return;
  }

  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // safe filename
  const archivePath = path.join(archiveDir, `server-${timestamp}.log`);

  fs.renameSync(logFilePath, archivePath); // archive the current log
  fs.writeFileSync(logFilePath, '');       // create a fresh log file

  //  console.log(`Log rotated to ${archivePath}`);
  log('Logger', logLevels.INFO, `Log rotated to ${archivePath}`);
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
