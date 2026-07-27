/**
 * @file        backend.js
 * @description Backend main file. Handles core operations
 * @author      Chris Staples
 * @license     GPL3
 */

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { v4: uuidv4 } = require('uuid');
var strftime = require('strftime');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();
const { logLevels, setLogLevel, logFromRequest, createLogger, log } = require('./logger');

log('General', logLevels.INFO, '~~ Starting up Auction backend ~~');
log('Logger', logLevels.INFO, `Logging framework initialized. `);

const { audit, auditTypes } = require('./middleware/audit');
const { sanitiseText } = require('./middleware/sanitiseText');
const {
  ROLE_LIST,
  PERMISSION_LIST,
  normaliseUsername,
  isValidUsername,
  getUserByUsername,
  shapeUserAccess,
  getPrimaryRole,
  getLandingPath,
  setUserPassword,
  setUserPreferences,
  getAuditActor,
  getSessionInvalidBeforeValue,
  normaliseUserPreferences
} = require('./users');


// const VALID_ROLES = new Set(['admin', 'maintenance', 'cashier', 'slideshow']);
const allowedStatuses = ["setup", "locked", "live", "settlement", "archived"];

const {
    CONFIG_IMG_DIR,
    UPLOAD_DIR,
    allowedExtensions,
    SECRET_KEY,
    PORT,
    HOST,
    TRUSTED_PROXIES,
    DEPLOYMENT_MODE,
    LOG_LEVEL,
    MAX_ITEMS,
    PPTX_CONFIG_DIR,
    OUTPUT_DIR,
    CURRENCY_SYMBOL,
    RATE_LIMIT_WINDOW,
    RATE_LIMIT_MAX,
    ITEM_PHOTO_MAX_BYTES,
    LOGIN_LOCKOUT_AFTER,
    LOGIN_IP_LOCKOUT_AFTER,
    LOGIN_LOCKOUT,
    PASSWORD_MIN_LENGTH,
    ALLOWED_ORIGINS,
    ENABLE_CORS
} = require('./config');

const allowedExtensionsSet = new Set(allowedExtensions.map((ext) => ext.toLowerCase()));

const {
  authenticateSession,
  authenticateRole,
  authenticateAccess,
  resolveSession,
  hasValidCsrf,
  SESSION_COOKIE_NAME
} = require('./middleware/authenticateRole');

const maintenanceRoutes = require('./maintenance');
const messaging = require('./messaging');
const { roundCurrency, SETTLEMENT_AMOUNT_SQL } = require('./payment-utils');



const sessionTime = 12 * 60 * 60; // 12 hours

const { api: paymentsApi, paymentProcessorVer } = require('./payments');

const submissionRateLimiter = new RateLimiterMemory({
  points: RATE_LIMIT_MAX,
  duration: RATE_LIMIT_WINDOW,
  blockDuration: RATE_LIMIT_WINDOW
});
const loginPairLimiter = new RateLimiterMemory({
  points: LOGIN_LOCKOUT_AFTER,
  duration: LOGIN_LOCKOUT,
  blockDuration: LOGIN_LOCKOUT
});
const loginIpLimiter = new RateLimiterMemory({
  points: LOGIN_IP_LOCKOUT_AFTER,
  duration: LOGIN_LOCKOUT,
  blockDuration: LOGIN_LOCKOUT
});

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

async function checkRateLimit(req) {
  try {
    await submissionRateLimiter.consume(getClientIp(req));
    return { limited: false };
  } catch (rate) {
    return { limited: true, retryAfterMs: Number(rate?.msBeforeNext || RATE_LIMIT_WINDOW * 1000) };
  }
}

function getLockoutKey(req, username) {
  return `${getClientIp(req)}::${username || 'unknown'}`;
}

const ADMIN_ITEM_STATUS_LABELS = Object.freeze({
  not_sold: 'Not sold',
  sold_unpaid: 'Sold and not paid',
  part_paid: 'Part paid',
  paid_in_full: 'Paid in full',
  collected: 'Item collected'
});

const ACTIVE_ITEM_WHERE = "COALESCE(is_deleted, 0) = 0";

function isItemDeleted(item) {
  return Number(item?.is_deleted || 0) === 1;
}

function getAdminItemStatus(item) {
  const isSold = item?.hammer_price != null && item?.winning_bidder_id != null;
  if (!isSold) {
    return {
      status_code: 'not_sold',
      status_label: ADMIN_ITEM_STATUS_LABELS.not_sold
    };
  }

  if (item?.collected_at) {
    return {
      status_code: 'collected',
      status_label: ADMIN_ITEM_STATUS_LABELS.collected
    };
  }

  const lotsTotal = roundCurrency(item?.bidder_lots_total || 0) || 0;
  const paymentsTotal = roundCurrency(item?.payments_total || 0) || 0;

  if (!(lotsTotal > 0) || paymentsTotal <= 0) {
    return {
      status_code: 'sold_unpaid',
      status_label: ADMIN_ITEM_STATUS_LABELS.sold_unpaid
    };
  }

  if (paymentsTotal >= lotsTotal) {
    return {
      status_code: 'paid_in_full',
      status_label: ADMIN_ITEM_STATUS_LABELS.paid_in_full
    };
  }

  return {
    status_code: 'part_paid',
    status_label: ADMIN_ITEM_STATUS_LABELS.part_paid
  };
}

function getItemEditState(item, auctionStatus) {
  const normalizedStatus = String(auctionStatus || '').toLowerCase();

  if (isItemDeleted(item)) {
    return {
      can_edit: false,
      edit_block_reason: 'Deleted items are read-only. Restore the item before editing it.'
    };
  }

  if (normalizedStatus !== 'setup' && normalizedStatus !== 'locked') {
    return {
      can_edit: false,
      edit_block_reason: `Items can only be edited while the auction is in setup or locked. Current state: ${normalizedStatus || 'unknown'}.`
    };
  }

  if (item?.winning_bidder_id != null || item?.hammer_price != null) {
    return {
      can_edit: false,
      edit_block_reason: 'Item has a bid and cannot be edited.'
    };
  }

  return {
    can_edit: true,
    edit_block_reason: null
  };
}

async function isLoginLockedOut(req, username) {
  const pair = await loginPairLimiter.get(getLockoutKey(req, username));
  const ip = await loginIpLimiter.get(getClientIp(req));
  const blocked = [pair, ip].filter((entry) => entry && entry.remainingPoints <= 0);
  if (!blocked.length) return { locked: false };
  return { locked: true, retryAfterMs: Math.max(...blocked.map((entry) => Number(entry.msBeforeNext || 0))) };
}

async function recordLoginFailure(req, username) {
  await Promise.allSettled([
    loginPairLimiter.consume(getLockoutKey(req, username)),
    loginIpLimiter.consume(getClientIp(req))
  ]);
}

async function clearLoginFailures(req, username) {
  await loginPairLimiter.delete(getLockoutKey(req, username));
}

function buildSessionUser(user, { includePreferences = false } = {}) {
  const access = shapeUserAccess(user || {});
  const sessionUser = {
    username: user?.username || null,
    role: getPrimaryRole(access),
    roles: access.roles,
    permissions: access.permissions,
    session_invalid_before: getSessionInvalidBeforeValue(user),
    is_root: access.is_root
  };

  if (includePreferences) {
    sessionUser.preferences = normaliseUserPreferences(user?.preferences);
  }

  return sessionUser;
}

function issueSessionToken(user, { scope = 'operator' } = {}) {
  return jwt.sign({
    username: user?.username,
    session_invalid_before: getSessionInvalidBeforeValue(user),
    session_scope: scope,
    csrf_token: crypto.randomBytes(32).toString('base64url')
  }, SECRET_KEY, { algorithm: 'HS256', expiresIn: sessionTime });
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: sessionTime * 1000
  };
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });
}

function buildSessionResponse(user, decoded) {
  const scopedUser = decoded?.session_scope === 'slideshow'
    ? {
        ...user,
        roles: shapeUserAccess(user).roles.includes('slideshow') ? ['slideshow'] : [],
        permissions: [],
        is_root: 0
      }
    : user;
  return {
    csrf_token: decoded?.csrf_token || null,
    session_scope: decoded?.session_scope || 'operator',
    currency: CURRENCY_SYMBOL,
    landing_path: getLandingPath(scopedUser),
    versions: {
      backend: backendVersion,
      schema: schemaVersion,
      payment_processor: paymentProcessorVer,
      deployment_mode: DEPLOYMENT_MODE,
      database_id: db.getMetadataValue('database_id'),
      database_created_at: db.getMetadataValue('database_created_at'),
      database_created_by_backend_version: db.getMetadataValue('database_created_by_backend_version'),
      restored_at: db.getMetadataValue('restored_at'),
      restored_from_backup_id: db.getMetadataValue('restored_from_backup_id'),
      restored_from_database_id: db.getMetadataValue('restored_from_database_id'),
      last_started_at: db.getMetadataValue('last_started_at')
    },
    user: buildSessionUser(scopedUser, { includePreferences: true })
  };
}

function authenticatePreferencesRequest(req, res, next) {
  return authenticateSession(req, res, next);
}


// collect up version info
const { version } = require('./package.json'); // get version from package.json
const backendVersion = version || 'Unknown';
const { schemaVersion } = require('./db'); // get schema version from db.js

const db = require('./db');

const { checkAuctionState } = require('./middleware/checkAuctionState')
const { registerExportRoutes } = require('./export-routes');
// (

//     { ttlSeconds: 2 }
// );

log('General', logLevels.INFO, `Backend version: ${backendVersion}, DB schema version: ${schemaVersion}, deployment mode: ${DEPLOYMENT_MODE}`);
log('General', logLevels.INFO, `Payment processor: ${paymentProcessorVer}`);

setLogLevel(LOG_LEVEL.toUpperCase());

app.disable('x-powered-by');
app.set('trust proxy', TRUSTED_PROXIES);
app.use(helmet({
  contentSecurityPolicy: false,
  strictTransportSecurity: false
}));

//--------------------------------------------------------------------------
// CORS
// Needed if the frontend and backend are separated
//--------------------------------------------------------------------------
if (ENABLE_CORS) {
const allowedOrigins = Array.isArray(ALLOWED_ORIGINS)
  ? Array.from(new Set(ALLOWED_ORIGINS))
  : [];
if (allowedOrigins.length === 0) {
  throw new Error('ENABLE_CORS requires at least one explicit ALLOWED_ORIGINS entry');
}
const corsOptions = {
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    return allowedOrigins.includes(origin)
      ? callback(null, true)
      : callback(new Error('Not allowed by CORS'));
  }
};
log('General', logLevels.INFO, `CORS enabled. Allowed origins: ${allowedOrigins.join(', ')}`);
app.use(cors(corsOptions));
} else {
    log('General', logLevels.INFO, 'CORS is disabled.');
}



// Then generic parsers and other routes
app.use(express.json({ limit: '100kb' }));

app.use((err, req, res, next) => {
  // Body parser error for invalid JSON
  if (err && err.type === 'entity.parse.failed') {
    logFromRequest(req, logLevels.WARN, `Invalid JSON payload: ${err.message}`);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  if (err && err.message === 'Not allowed by CORS') {
    logFromRequest(req, logLevels.WARN, `CORS rejected origin: ${req.headers.origin || 'unknown'}`);
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }

  return next(err);
});

app.use(express.urlencoded({ extended: true, limit: '100kb', parameterLimit: 100 }));

// Lightweight readiness endpoint for service managers and container health
// checks. It intentionally exposes no version, path, or database metadata.
app.get('/healthz', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (typeof db.isMaintenanceLocked === 'function' && db.isMaintenanceLocked()) {
      return res.status(503).json({ status: 'maintenance' });
    }
    db.prepare('SELECT 1 AS ready').get();
    return res.json({ status: 'ok' });
  } catch (error) {
    log('Health', logLevels.ERROR, `Readiness check failed: ${error.message}`);
    return res.status(503).json({ status: 'unavailable' });
  }
});

app.use((req, res, next) => {
  if (req.path && req.path.startsWith('/maintenance')) {
    return next();
  }
  if (typeof db.isMaintenanceLocked === 'function' && db.isMaintenanceLocked()) {
    return res.status(503).json({ error: 'Database maintenance in progress' });
  }
  return next();
});

// Must come after body parsers
require('./phase1-patch')(app);

const messagingAccess = authenticateAccess({
    roles: ['admin', 'maintenance', 'cashier'],
    permissions: ['live_feed']
});

app.get('/messages/status', messagingAccess, messaging.handleStatus);
app.get('/messages/users', messagingAccess, messaging.handleUsers);
app.get('/messages/thread/:username', messagingAccess, messaging.handleThread);
app.post('/messages', messagingAccess, messaging.handleSend);
app.post('/messages/:id/acknowledge', messagingAccess, messaging.handleAcknowledge);
app.get('/messages/items', messagingAccess, messaging.handleItems);


// Mount API
app.use(paymentsApi);


// Multer storage setup for file uploads
const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}.jpg`;
        cb(null, uniqueName);
    },
});
function itemPhotoFileFilter(_req, file, callback) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const allowedMimeTypes = new Set(['image/jpeg', 'image/png']);
  if (!allowedExtensionsSet.has(extension) || !allowedMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
    const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname);
    error.message = 'Only JPEG and PNG item photos are accepted';
    return callback(error);
  }
  return callback(null, true);
}
const upload = multer({
    storage: storage,
    limits: {
      fileSize: ITEM_PHOTO_MAX_BYTES,
      files: 1,
      fields: 4,
      parts: 6,
      fieldNameSize: 64,
      fieldSize: 4096
    },
    fileFilter: itemPhotoFileFilter
});
const adminUpload = multer({
  storage,
  limits: {
    fileSize: ITEM_PHOTO_MAX_BYTES,
    files: 1,
    fields: 6,
    parts: 8,
    fieldNameSize: 64,
    fieldSize: 4096
  },
  fileFilter: itemPhotoFileFilter
});


// Ensure OUTPUT_DIR exists - This one specifically as it's used for temporary output files)

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true, mode: 0o755 });
}

//--------------------------------------------------------------------------
// POST /validate
// Validate the HttpOnly cookie session and return current account metadata.
//--------------------------------------------------------------------------

app.post('/validate', async (req, res) => {
  try {
    const session = resolveSession(req);
    req.session = session;
    return res.json(buildSessionResponse(session.currentUser, session.decoded));
  } catch (error) {
    clearSessionCookie(res);
    return res.status(error.status || 403).json({
      error: error.message,
      ...(error.reason ? { reason: error.reason } : {})
    });
  }
})

//--------------------------------------------------------------------------
// POST /login
// Login route. Checks pw and returns a jwt
// Also returns currency symbol + version data (as this route is the entry point to all users)
//--------------------------------------------------------------------------
app.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const normalizedUsername = normaliseUsername(username);

    if (!normalizedUsername || !password) {
        logFromRequest(req, logLevels.ERROR, `Missing login fields`);
        return res.status(400).json({ error: "Username and password are required" });
    }

    if (!isValidUsername(normalizedUsername)) {
        logFromRequest(req, logLevels.WARN, `Invalid username format: ${normalizedUsername}`);
        return res.status(400).json({ error: "Invalid username format" });
    }

    const lockout = await isLoginLockedOut(req, normalizedUsername);
    if (lockout.locked) {
        const retryAfterSeconds = Math.ceil(lockout.retryAfterMs / 1000);
        res.set('Retry-After', retryAfterSeconds.toString());
        logFromRequest(req, logLevels.WARN, `Login locked out for ${normalizedUsername} from ${getClientIp(req)}`);
        return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
    }

    const user = getUserByUsername(normalizedUsername);
    if (!user || !user.password) {
      logFromRequest(req, logLevels.WARN, `Invalid credentials for ${normalizedUsername}`);
      await recordLoginFailure(req, normalizedUsername);
      return res.status(403).json({ error: "Invalid username or password" });
    }

    const stored = user.password;
    const isHash = typeof stored === 'string' && stored.startsWith('$2');

    const handleSuccess = async () => {
      const currentUser = getUserByUsername(normalizedUsername);
      const token = issueSessionToken(currentUser);
      const decoded = jwt.decode(token);
      setSessionCookie(res, token);
      await clearLoginFailures(req, normalizedUsername);
      res.json(buildSessionResponse(currentUser, decoded));
      logFromRequest(req, logLevels.INFO, `User "${user.username}" logged in`);
    };

    if (isHash) {
      try {
        const match = await bcrypt.compare(password, stored);
        if (!match) {
          logFromRequest(req, logLevels.WARN, `Invalid credentials for ${normalizedUsername}`);
          await recordLoginFailure(req, normalizedUsername);
          return res.status(403).json({ error: "Invalid username or password" });
        }
        return handleSuccess();
      } catch (_error) {
        return res.status(500).json({ error: 'Login failed' });
      }
    }

    // Legacy plaintext user entries are upgraded after successful login.
    if (stored !== password) {
      logFromRequest(req, logLevels.WARN, `Invalid credentials for ${normalizedUsername}`);
      await recordLoginFailure(req, normalizedUsername);
      return res.status(403).json({ error: "Invalid username or password" });
    }

    const hashed = bcrypt.hashSync(password, 12);
    try {
      setUserPassword(user.username, hashed);
      logFromRequest(req, logLevels.INFO, `Upgraded plaintext password to bcrypt for user ${user.username}`);
    } catch (uErr) {
      logFromRequest(req, logLevels.ERROR, `Failed to upgrade plaintext password for ${user.username}: ${uErr.message}`);
    }

    return handleSuccess();
});

app.post('/logout', authenticateSession, (req, res) => {
  clearSessionCookie(res);
  return res.status(204).end();
});

app.post('/session/kiosk', authenticateSession, (req, res) => {
  const currentUser = req.session.currentUser;
  if (!shapeUserAccess(currentUser).roles.includes('slideshow')) {
    return res.status(403).json({ error: 'Slideshow access is required' });
  }
  const token = issueSessionToken(currentUser, { scope: 'slideshow' });
  const decoded = jwt.decode(token);
  setSessionCookie(res, token);
  return res.json(buildSessionResponse(currentUser, decoded));
});

app.post('/preferences', authenticatePreferencesRequest, (req, res) => {
  const username = req.user?.username;
  if (!username) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const preferences = normaliseUserPreferences(req.body?.preferences);
    const result = setUserPreferences(username, preferences);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ preferences });
  } catch (error) {
    logFromRequest(req, logLevels.ERROR, `Failed to save preferences for ${username}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to save preferences' });
  }
});

app.get('/preferences', authenticatePreferencesRequest, (req, res) => {
  const username = req.user?.username;
  if (!username) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const user = getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ preferences: normaliseUserPreferences(user.preferences) });
  } catch (error) {
    logFromRequest(req, logLevels.ERROR, `Failed to read preferences for ${username}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to load preferences' });
  }
});

//--------------------------------------------------------------------------
// POST /change-password
// Authenticated users can change their own password.
//--------------------------------------------------------------------------
app.post('/change-password', authenticateAccess({ roles: ROLE_LIST, permissions: PERMISSION_LIST }), async (req, res) => {
  const username = req.user?.username;
  const { currentPassword, newPassword } = req.body || {};

  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing password fields' });
  }

  if (String(newPassword).length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
  }

  try {
    const user = getUserByUsername(username);
    if (!user || !user.password) {
      return res.status(403).json({ error: 'Invalid password' });
    }

    const stored = user.password;
    const isHash = typeof stored === 'string' && stored.startsWith('$2');
    const matches = isHash
      ? bcrypt.compareSync(currentPassword, stored)
      : stored === currentPassword;

    if (!matches) {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }

    const hashed = bcrypt.hashSync(newPassword, 12);
    const result = setUserPassword(username, hashed);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    audit(getAuditActor(req), 'change own password', 'server', null, { username });
    logFromRequest(req, logLevels.INFO, `Self-service password change for ${username}`);
    clearSessionCookie(res);

    return res.json({ message: 'Password updated. Please sign in again.' });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Self-service password change failed for ${username}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

// Get the next item number for a given auction ID
function getNextItemNumber(auction_id, callback) {
    db.get(`SELECT MAX(item_number) + 1 AS next FROM items WHERE auction_id = ? AND ${ACTIVE_ITEM_WHERE}`, [auction_id], (err, row) => {
        if (err) return callback(err);
        const itemNumber = row?.next || 1;
        callback(null, itemNumber);
    });
}

//--------------------------------------------------------------------------
// POST /auctions/:auctionId/newitem
// API to handle item submission
// This a a public route but uses checkAuctionState to ensure auction is accepting submissions
//--------------------------------------------------------------------------
// notable difference: uses :publicId not :auctionId - conversion handled in checkAuctionState

app.post('/auctions/:publicId/newitem', checkAuctionState(['setup', 'locked', 'live']), async (req, res) => {
  let originalPath = null;
  const derivativePaths = [];
  let keepDerivatives = false;
  try {
    let isAdmin = false;
    if (req.get('X-CSRF-Token')) {
      const session = resolveSession(req);
      if (!hasValidCsrf(req, session.decoded) || !session.user.roles.includes('admin')) {
        return res.status(403).json({ error: 'Not authorised' });
      }
      req.session = session;
      isAdmin = true;
    }

    if (!isAdmin) {
      const rateLimit = await checkRateLimit(req);
      if (rateLimit.limited) {
        const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000);
        res.set('Retry-After', retryAfterSeconds.toString());
        logFromRequest(req, logLevels.WARN, `Item submission rate limit exceeded from IP ${getClientIp(req)}`);
        return res.status(429).json({ error: `Too many submissions. Please try again in ${retryAfterSeconds} seconds.` });
      }
    }

    await awaitMiddleware(upload.single('photo'))(req, res);
    originalPath = req.file?.path || null;

    const auctionId = Number(req.auction?.id);
    const auction = db.prepare('SELECT status FROM auctions WHERE id = ?').get(auctionId);
    if (!auctionId || !auction) {
      return res.status(400).json({ error: 'Auction not found' });
    }
    if (auction.status !== 'setup' && !isAdmin) {
      return res.status(403).json({ error: 'This auction is not currently accepting submissions.' });
    }

    const itemCount = db.prepare('SELECT COUNT(*) AS count FROM items').get().count;
    if (itemCount >= MAX_ITEMS) {
      return res.status(400).json({ error: 'Server item limit reached' });
    }

    const sanitisedDescription = sanitiseText(req.body?.description, 1024);
    const sanitisedContributor = sanitiseText(req.body?.contributor, 512);
    const sanitisedArtist = sanitiseText(req.body?.artist, 512);
    const sanitisedNotes = sanitiseText(req.body?.notes, 1024);
    if (!sanitisedDescription || !sanitisedContributor) {
      return res.status(400).json({ error: 'Missing item description or contributor' });
    }

    let photoPath = null;
    if (req.file) {
      const metadata = await sharp(req.file.path).metadata();
      if (!['jpeg', 'png'].includes(metadata.format)) {
        return res.status(400).json({ error: 'Invalid image upload' });
      }
      const resizedName = `resized_${req.file.filename}`;
      const previewName = `preview_resized_${req.file.filename}`;
      const resizedPath = path.join(UPLOAD_DIR, resizedName);
      const previewPath = path.join(UPLOAD_DIR, previewName);
      derivativePaths.push(resizedPath, previewPath);
      await sharp(req.file.path).resize(2000, 2000, { fit: 'inside' }).jpeg({ quality: 90 }).toFile(resizedPath);
      await sharp(req.file.path).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 70 }).toFile(previewPath);
      photoPath = resizedName;
    }

    const itemNumber = db.prepare(`
      SELECT COALESCE(MAX(item_number), 0) + 1 AS next
      FROM items WHERE auction_id = ? AND ${ACTIVE_ITEM_WHERE}
    `).get(auctionId).next;
    const result = db.prepare(`
      INSERT INTO items (item_number, description, contributor, artist, notes, photo, auction_id, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime'))
    `).run(itemNumber, sanitisedDescription, sanitisedContributor, sanitisedArtist, sanitisedNotes, photoPath, auctionId);

    keepDerivatives = true;
    logFromRequest(req, logLevels.INFO, `Item ${result.lastInsertRowid} stored for auction ${auctionId} as item #${itemNumber}`);
    audit(isAdmin ? getAuditActor(req) : 'public', 'new item', 'item', result.lastInsertRowid, {
      description: sanitisedDescription,
      initial_number: itemNumber
    });
    return res.json({
      id: result.lastInsertRowid,
      sanitisedDescription,
      sanitisedContributor,
      sanitisedArtist,
      photo: photoPath
    });
  } catch (error) {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: error.message });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: error.message });
    }
    logFromRequest(req, logLevels.ERROR, `Item submission failed: ${error.message}`);
    return res.status(400).json({ error: 'Item submission failed' });
  } finally {
    if (originalPath) {
      fs.rmSync(originalPath, { force: true });
    }
    if (!keepDerivatives) {
      derivativePaths.forEach((filePath) => fs.rmSync(filePath, { force: true }));
    }
  }
});

//--------------------------------------------------------------------------
// GET /auctions/:auctionId/items
// API to get all auction items. Accepts optional sort and direction
//--------------------------------------------------------------------------

app.get('/auctions/:auctionId/items', authenticateRole("admin"), (req, res) => {
    const auction_id = Number(req.params.auctionId);
    const sort = (req.query.sort || "asc").toUpperCase();
    const field = req.query.field || "item_number";
    const showDeleted = String(req.query.show_deleted || "").toLowerCase() === "true";

    const allowedFields = {
        item_number: "i.item_number",
        paddle_number: "b.paddle_number",
        hammer_price: "i.hammer_price",
        description: "i.description",
        contributor: "i.contributor",
        artist: "i.artist"
    };
    const sortField = allowedFields[field] || allowedFields.item_number;
    const sortOrder = sort.toUpperCase() === "DESC" ? "DESC" : "ASC";
    const deletedFilter = showDeleted ? "" : `AND ${ACTIVE_ITEM_WHERE.replaceAll("is_deleted", "i.is_deleted")}`;

    if (!auction_id) {
        return res.status(400).json({ error: "Missing auction_id" });
    }

    const LIST_ITEMS_SQL = `
    SELECT i.id,
           i.item_number,
           i.description,
           i.contributor,
           i.artist,
           i.notes,
           i.photo,
           i.hammer_price,
           i.winning_bidder_id,
           i.collected_at,
           b.paddle_number AS paddle_no,
           IFNULL(b.name, '') AS bidder_name,
           IFNULL(lots.lots_total, 0) AS bidder_lots_total,
           IFNULL(payments.payments_total, 0) AS payments_total,
           i.test_item,
           i.test_bid,
           i.date,
           i.mod_date,
           i.text_mod_date,
           i.last_print,
           COALESCE(i.is_deleted, 0) AS is_deleted,
           i.deleted_at,
           i.deleted_by
    FROM items   i
    LEFT JOIN bidders b ON b.id = i.winning_bidder_id
    LEFT JOIN (
      SELECT sold.winning_bidder_id AS bidder_id,
             SUM(sold.hammer_price) AS lots_total
        FROM items sold
       WHERE sold.auction_id = ?
         AND COALESCE(sold.is_deleted, 0) = 0
         AND sold.hammer_price IS NOT NULL
         AND sold.winning_bidder_id IS NOT NULL
       GROUP BY sold.winning_bidder_id
    ) lots ON lots.bidder_id = i.winning_bidder_id
    LEFT JOIN (
      SELECT bidder_id,
             SUM(${SETTLEMENT_AMOUNT_SQL}) AS payments_total
        FROM payments
       GROUP BY bidder_id
    ) payments ON payments.bidder_id = i.winning_bidder_id
    WHERE i.auction_id = ?
      ${deletedFilter}
    ORDER BY COALESCE(i.is_deleted, 0) ASC, ${sortField} COLLATE NOCASE ${sortOrder}, i.item_number ${sortOrder}
  `;

    try {
        const stmt = db.prepare(LIST_ITEMS_SQL);
        const items = stmt.all(auction_id, auction_id).map((item) => ({
            ...item,
            ...getAdminItemStatus(item)
        }));
        let totals;

        try {
            totals = db.prepare(`
                SELECT 
                    COUNT(*) AS item_count,
                    SUM(CASE WHEN i.hammer_price IS NOT NULL THEN 1 ELSE 0 END) AS items_with_bids,
                    SUM(i.hammer_price) AS hammer_total
                FROM items i
                WHERE i.auction_id = ?
                  AND COALESCE(i.is_deleted, 0) = 0
            `).get(auction_id);

        } catch (err) {
            console.error("Error calculating item totals:", err);
            return res.status(500).json({ error: "Failed to calculate auction totals." });
        }


        res.json({ items, totals });

    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Error fetching items ${err.message}`);
        res.status(500).json({ error: "Failed to load items." + err.message });
    }


});

//--------------------------------------------------------------------------
// GET /auctions/:auctionId/items/:id
// API to get full saved item details for the edit/view screen
//--------------------------------------------------------------------------

app.get('/auctions/:auctionId(\\d+)/items/:id(\\d+)', authenticateRole("admin"), (req, res) => {
    const auction_id = Number(req.params.auctionId);
    const id = Number(req.params.id);

    if (!auction_id || !id) {
        return res.status(400).json({ error: "Missing auction_id or item id" });
    }

    try {
        const row = db.prepare(`
            SELECT i.*,
                   a.status AS auction_status,
                   b.paddle_number AS paddle_no
              FROM items i
              LEFT JOIN auctions a ON a.id = i.auction_id
              LEFT JOIN bidders b ON b.id = i.winning_bidder_id
             WHERE i.id = ?
        `).get(id);

        if (!row) {
            return res.status(404).json({ error: "Item not found" });
        }

        if (Number(row.auction_id) !== auction_id) {
            return res.status(400).json({ error: "Item auction ID mismatch" });
        }

        const { can_edit, edit_block_reason } = getItemEditState(row, row.auction_status);

        res.json({
            ...row,
            can_edit,
            edit_block_reason
        });
    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Error fetching item ${id}: ${err.message}`);
        res.status(500).json({ error: "Failed to load item details." });
    }
});

//--------------------------------------------------------------------------
// POST /auctions/:auctionId/items/:id/update
// API to update an item, including photo. Includes moving an item to a new auction
//--------------------------------------------------------------------------

app.post('/auctions/:auctionId/items/:id/update', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), async (req, res) => {
    const auction_id = Number(req.params.auctionId);
    const id = Number(req.params.id);

    logFromRequest(req, logLevels.DEBUG, `Request received to update item ${id}`);

try {
    
  await awaitMiddleware(adminUpload.single('photo'))(req, res);
  if (req.file?.path) {
    res.once('finish', () => fs.rmSync(req.file.path, { force: true }));
  }

    db.get('SELECT photo, auction_id, description, contributor, artist, notes, winning_bidder_id, hammer_price, is_deleted FROM items WHERE id = ?', [id], async (err, row) => {
        if (err) {
            logFromRequest(req, logLevels.ERROR, `Update: Error ${err.message}`);
            return res.status(500).json({ error: err.message });
        }
        else if (!row) {
            logFromRequest(req, logLevels.ERROR, `Update: Item not found`);
            return res.status(400).json({ error: 'Item not found' });
        }
        else if (row.auction_id !== req.auction.id) {
            logFromRequest(req, logLevels.ERROR, `Update: Item ${id} auction ID mismatch. Item is in auction ${row.auction_id}, request is for auction ${req.auction.id}`);
            return res.status(400).json({ error: "Item auction ID mismatch" });
        }
        else if (isItemDeleted(row)) {
            logFromRequest(req, logLevels.WARN, `Edit blocked: item ${id} is deleted`);
            return res.status(400).json({ error: "Deleted items cannot be edited. Restore the item first." });
        }
        else if (row.winning_bidder_id != null || row.hammer_price != null) {
                 logFromRequest(req, logLevels.WARN, `Edit blocked: item ${id} has bids`);
                return res.status(400).json({ error: "Item has a bid and cannot be edited" });
            }


        let photoPath = row.photo;

        // Process new photo
        if (req.file) {
           const targetFilename = `resized_${uuidv4()}.jpg`;

           const resizedPath = path.join(UPLOAD_DIR, targetFilename);
           const previewPath = path.join(UPLOAD_DIR, `preview_${targetFilename}`);

            try {

                await sharp(req.file.path).metadata(); // Will throw if not an image


                await sharp(req.file.path)
                    .resize(2500, 2500, { fit: 'inside' })
                    .jpeg({ quality: 90 })
                    .toFile(resizedPath);

                await sharp(req.file.path)
                    .resize(400, 400, { fit: 'inside' })
                    .jpeg({ quality: 70 })
                    .toFile(previewPath);

                photoPath = targetFilename;
                logFromRequest(req, logLevels.INFO, `Photo updated → ${targetFilename}`);

            } catch (err) {
                logFromRequest(req, logLevels.ERROR, `Image procesing failed`);

                fs.rmSync(req.file.path, { force: true });
                fs.rmSync(resizedPath, { force: true });
                fs.rmSync(previewPath, { force: true });
                res.status(400).json({ error: 'Invalid image file' });
                return;
            }
        }

        // Only collect fields that are provided (and not undefined/null)
        const updates = [];
        const params = [];
        let textFieldsChanged = false;
        // For each field, check if it's provided and different from current value. If so, add to updates (minimize DB writes)
        const fields = ["description", "contributor", "artist", "notes"];
        const fieldMaxLengths = {
            description: 1024,
            contributor: 512,
            artist: 512,
            notes: 1024
        };
        fields.forEach(field => {
            if (req.body[field] !== undefined && req.body[field] !== null) {
                const sanitisedValue = sanitiseText(req.body[field], fieldMaxLengths[field]);
                if (sanitisedValue === row[field]) return;
                updates.push(`${field} = ?`);
                params.push(sanitisedValue);
                textFieldsChanged = true;
            }
        });

        // Always update photo if processed
        if (req.file) {
            updates.push("photo = ?");
            params.push(photoPath);
        }

        // Always update text_mod_date if any text fields changed
        if (textFieldsChanged) {
            logFromRequest(req, logLevels.DEBUG, `Text fields changed for item ${id}, updating text_mod_date`);
            updates.push("text_mod_date = strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime')");
        }

        // For each field, check if it's provided and different from current value. If so, add to updates (minimize DB writes)
        // update mod_date if there are any updates
        if (updates.length > 0) {
            const updateSummaryForLog = updates.map((u, i) => `${u.split('=')[0].trim()}: ${params[i]}`).join(", ");
            logFromRequest(req, logLevels.DEBUG, `updates and values: ${updateSummaryForLog}, photo: ${req.file ? photoPath : 'no file'}`);

            updates.push("mod_date = strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime')");
            const sql = `UPDATE items SET ${updates.join(", ")} WHERE id = ?`;
            params.push(id);

            logFromRequest(req, logLevels.DEBUG, `Executing SQL: ${sql} with params ${JSON.stringify(params)}`);

            db.run(sql, params, function (err5) {
                if (err5) {
                    logFromRequest(req, logLevels.ERROR, `Update failed: ${err5.message}`);
                    if (req.file) {
                        fs.rmSync(path.join(UPLOAD_DIR, photoPath), { force: true });
                        fs.rmSync(path.join(UPLOAD_DIR, `preview_${photoPath}`), { force: true });
                    }
                    return res.status(500).json({ error: "Database error" });
                }
                if (req.file && row.photo && row.photo !== photoPath) {
                    fs.rmSync(path.join(UPLOAD_DIR, row.photo), { force: true });
                    fs.rmSync(path.join(UPLOAD_DIR, `preview_${row.photo}`), { force: true });
                }
                res.json({ message: 'Item updated', photo: photoPath });
                logFromRequest(req, logLevels.INFO, `Update item completed for ${id}`);
                audit(getAuditActor(req), 'updated', 'item', id, { changes: updateSummaryForLog, photo_updated: !!req.file });

            });
        } else {
            res.json({ message: 'No changes found', photo: photoPath });
            logFromRequest(req, logLevels.INFO, `No changes detected for item ${id}`);
        }
    }
    );
    }
    catch (err) {
        logFromRequest(req, logLevels.ERROR, "Error editing: " + err.message);
        if (req.file?.path) fs.rmSync(req.file.path, { force: true });
        if (err instanceof multer.MulterError) {
            return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
        }
        res.status(500).json({ error: "Failed to update item" });
    }

});

//--------------------------------------------------------------------------
// POST /auctions/:auctionId/items/:id/move
// API to move an item to a new auction
//--------------------------------------------------------------------------

app.post('/auctions/:auctionId/items/:id/move-auction/:targetAuctionId', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), (req, res) => {
    const id = Number(req.params.id);
    const target_auction_id = req.params.targetAuctionId;
    const newAuctionId = parseInt(target_auction_id);

    if (!target_auction_id || isNaN(parseInt(target_auction_id))) {
        logFromRequest(req, logLevels.ERROR, `Move: Missing or invalid target auction ID: ` + target_auction_id);
        return res.status(400).json({ error: "Missing or invalid target auction ID" });
    }

    logFromRequest(req, logLevels.DEBUG, `Request received to move item ${id} to auction ${newAuctionId}`);
    try {
            // get current auction ID from req set by checkAuctionState
            const oldAuctionId = Number(req.auction.id);

            if (!oldAuctionId || isNaN(oldAuctionId) || oldAuctionId !== Number(req.params.auctionId)) {
                logFromRequest(req, logLevels.ERROR, `Move: Missing or bad current auction ID. Request: ${req.params.auctionId} Item is: ${oldAuctionId}`);
                return res.status(400).json({ error: "Missing or bad current auction ID" });
            }
 
            if (newAuctionId === oldAuctionId) {
                return res.status(400).json({ error: "Item is already in the target auction" });
            }
            
            // Moving an item with bids messes up our data integrity - block it
            const itemBidState = db.get("SELECT winning_bidder_id, hammer_price, is_deleted FROM items WHERE id = ?", [id]);
            if (!itemBidState) {
                return res.status(400).json({ error: "Item not found" });
            }
            if (isItemDeleted(itemBidState)) {
                logFromRequest(req, logLevels.WARN, `Move blocked: item ${id} is deleted`);
                return res.status(400).json({ error: "Deleted items cannot be moved. Restore the item first." });
            }
            if (itemBidState?.winning_bidder_id != null || itemBidState?.hammer_price != null) {
                logFromRequest(req, logLevels.WARN, `Move blocked: item ${id} has bids`);
                return res.status(400).json({ error: "Item has bids and cannot be moved" });
            }
            // target auction must be in setup or locked state
            // let targetAuction = checkAuctionState.auctionStateCache?.get(newAuctionId);
            // if (!targetAuction) {
              let  targetAuction = db.get("SELECT id, status FROM auctions WHERE id = ?", [newAuctionId]);
                // if (targetAuction) {
                //    checkAuctionState.auctionStateCache?.set(newAuctionId, targetAuction);
                // }
            // }

            if (!targetAuction) {
                logFromRequest(req, logLevels.ERROR, `Move: Target auction ${newAuctionId} not found`);
                return res.status(400).json({ error: "Target auction not found" });
            }

            const targetState = String(targetAuction.status).toLowerCase();
            if (targetState !== "setup" && targetState !== "locked") {
                logFromRequest(req, logLevels.WARN, `Move blocked: target auction ${newAuctionId} state is ${targetAuction.status}`);
                return res.status(400).json({ error: "Target auction must be in setup or locked state" });
            }

            logFromRequest(req, logLevels.DEBUG, `Moving ${id} from auction ${oldAuctionId} to auction ${newAuctionId}`);
            db.get(`SELECT MAX(item_number) + 1 AS next FROM items WHERE auction_id = ? AND ${ACTIVE_ITEM_WHERE}`, [newAuctionId], (err2, result) => {
                if (err2) {
                    logFromRequest(req, logLevels.ERROR, `Update: Error getting next item number → ${err2.message}`);
                    return res.status(500).json({ error: err2.message });
                }
                const newNumber = result?.next || 1;
                db.run("UPDATE items SET mod_date = strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime'), text_mod_date = strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime'), auction_id = ?, item_number = ? WHERE id = ?",
                    [newAuctionId, newNumber, id],
                    function (err3) {
                        if (err3) {
                            logFromRequest(req, logLevels.ERROR, `Database error: ` + err3.message);
                            return res.status(500).json({ error: err3.message });
                        }

                        logFromRequest(req, logLevels.INFO, `Moved item ${id} from auction ${oldAuctionId} to ${newAuctionId}`);

                        renumberAuctionItems(oldAuctionId, (err4, count) => {
                            if (err4) {
                                logFromRequest(req, logLevels.ERROR, `Renumber failed for old auction ${oldAuctionId}: ${err4.message}`);
                                return res.status(500).json({ error: err4.message });
                            }
                            logFromRequest(req, logLevels.DEBUG, `Renumbered ${count} items in old auction ${oldAuctionId}`);
                        });
                        audit(getAuditActor(req), 'moved auction', 'item', id, { old_auction: oldAuctionId, new_auction: newAuctionId, new_no: newNumber });

                        res.json({ message: `Item moved to auction ${newAuctionId}`, item_number: newNumber });
                    });
            });


  
    }
    catch (err) {
        logFromRequest(req, logLevels.ERROR, "Error moving: " + err.message);
        res.status(500).json({ error: err.message });
    }
});


//--------------------------------------------------------------------------
// DELETE /items/:id
// API to soft-delete an item. Photos are retained until purge.
//--------------------------------------------------------------------------

app.delete('/items/:id', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), (req, res) => {
    const itemId = Number(req.params.id);

    logFromRequest(req, logLevels.DEBUG, `Delete: Request Recieved for ${itemId}`);

    try {
        const row = db.get('SELECT description, item_number, auction_id, winning_bidder_id, hammer_price, is_deleted FROM items WHERE id = ?', [itemId]);
        if (!row) {
            logFromRequest(req, logLevels.ERROR, `Delete: Item id ${itemId} not found`);
            return res.status(400).json({ error: 'Item not found' });
        }
        else if (row.winning_bidder_id != null || row.hammer_price != null) {
            logFromRequest(req, logLevels.WARN, `Delete blocked: item ${itemId} has bids`);
            return res.status(400).json({ error: "Item has bids and cannot be deleted" });
        }
        else if (isItemDeleted(row)) {
            logFromRequest(req, logLevels.WARN, `Delete blocked: item ${itemId} is already deleted`);
            return res.status(400).json({ error: "Item is already deleted" });
        }
        else if (row.auction_id !== req.auction.id) {
            logFromRequest(req, logLevels.ERROR, `Delete: Item ${itemId} auction ID mismatch. Item is in auction ${row.auction_id}, request is for auction ${req.auction.id}`);
            return res.status(400).json({ error: "Item auction ID mismatch" });
        }

        db.run(`
            UPDATE items
               SET is_deleted = 1,
                   deleted_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'),
                   deleted_by = ?,
                   item_number = NULL,
                   mod_date = strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime')
             WHERE id = ?
        `, [getAuditActor(req), itemId]);

        logFromRequest(req, logLevels.INFO, `Soft-deleted item ${itemId} from auction ${row.auction_id}. Description: ${row.description}`);

        renumberAuctionItems(row.auction_id, (err, count) => {
            if (err) {
                logFromRequest(req, logLevels.ERROR, `Failed to renumber items after soft delete:` + err.message);
            } else {
                logFromRequest(req, logLevels.INFO, `Renumbered ${count} active items in auction ${row.auction_id} after soft deletion`);
            }
        });
        audit(getAuditActor(req), 'soft delete', 'item', itemId, {
            auction_id: row.auction_id,
            description: row.description,
            previous_item_number: row.item_number
        });
        res.json({ message: 'Item deleted' });
    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Delete: error ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

//--------------------------------------------------------------------------
// POST /items/:id/restore
// Restore a soft-deleted item to the end of its auction.
//--------------------------------------------------------------------------

app.post('/items/:id/restore', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), (req, res) => {
    const itemId = Number(req.params.id);

    try {
        const row = db.get('SELECT id, description, auction_id, winning_bidder_id, hammer_price, is_deleted FROM items WHERE id = ?', [itemId]);
        if (!row) {
            logFromRequest(req, logLevels.ERROR, `Restore: Item id ${itemId} not found`);
            return res.status(400).json({ error: 'Item not found' });
        }
        if (row.auction_id !== req.auction.id) {
            logFromRequest(req, logLevels.ERROR, `Restore: Item ${itemId} auction ID mismatch. Item is in auction ${row.auction_id}, request is for auction ${req.auction.id}`);
            return res.status(400).json({ error: "Item auction ID mismatch" });
        }
        if (!isItemDeleted(row)) {
            logFromRequest(req, logLevels.WARN, `Restore blocked: item ${itemId} is not deleted`);
            return res.status(400).json({ error: "Item is not deleted" });
        }
        if (row.winning_bidder_id != null || row.hammer_price != null) {
            logFromRequest(req, logLevels.WARN, `Restore blocked: item ${itemId} has bids`);
            return res.status(400).json({ error: "Deleted item has bids and cannot be restored" });
        }

        getNextItemNumber(row.auction_id, (err, newNumber) => {
            if (err) {
                logFromRequest(req, logLevels.ERROR, `Restore: failed to calculate next item number: ${err.message}`);
                return res.status(500).json({ error: "Database error" });
            }

            db.run(`
                UPDATE items
                   SET is_deleted = 0,
                       deleted_at = NULL,
                       deleted_by = NULL,
                       item_number = ?,
                       mod_date = strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime')
                 WHERE id = ?
            `, [newNumber, itemId], function (updateErr) {
                if (updateErr) {
                    logFromRequest(req, logLevels.ERROR, `Restore: error ${updateErr.message}`);
                    return res.status(500).json({ error: updateErr.message });
                }

                logFromRequest(req, logLevels.INFO, `Restored item ${itemId} to auction ${row.auction_id} as item #${newNumber}`);
                audit(getAuditActor(req), 'restore', 'item', itemId, {
                    auction_id: row.auction_id,
                    description: row.description,
                    restored_item_number: newNumber
                });
                return res.json({ message: 'Item restored', item_number: newNumber });
            });
        });
    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Restore: error ${err.message}`);
        return res.status(500).json({ error: err.message });
    }
});

registerExportRoutes({
    app,
    db,
    fsp: fs.promises,
    audit,
    getAuditActor,
    authenticateRole,
    checkAuctionState,
    allowedStatuses,
    log,
    logLevels,
    logFromRequest,
    PPTX_CONFIG_DIR,
    OUTPUT_DIR,
    UPLOAD_DIR
});

//--------------------------------------------------------------------------
// POST /rotate-photo
// API to rotate a photo
//--------------------------------------------------------------------------


// app.post('/rotate-photo', authenticateRole("admin"), async (req, res) => {
//     const { id, direction } = req.body;
//     logFromRequest(req, logLevels.DEBUG, `Rotate Request for item ${id} (${direction})`);

//     if (direction !== 'left' && direction !== 'right') {
//         return res.status(400).json({ error: 'Invalid rotation direction' });
//     }

//     try {
//         const row = db.prepare(`
//             SELECT i.photo,
//                    i.winning_bidder_id,
//                    i.hammer_price,
//                    i.is_deleted,
//                    a.status AS auction_status
//               FROM items i
//               LEFT JOIN auctions a ON a.id = i.auction_id
//              WHERE i.id = ?
//         `).get(Number(id));

//         if (!row || !row.photo) {
//             return res.status(404).json({ error: 'Photo not found' });
//         }

//         const { can_edit, edit_block_reason } = getItemEditState(row, row.auction_status);
//         if (!can_edit) {
//             logFromRequest(req, logLevels.WARN, `Rotate blocked: item ${id} cannot be edited (${edit_block_reason})`);
//             return res.status(400).json({ error: edit_block_reason });
//         }

//         const photoFilename = row.photo;
//         const photoPath = path.join(UPLOAD_DIR, photoFilename);
//         const previewPath = path.join(UPLOAD_DIR, `preview_${photoFilename}`);
//         const angle = direction === 'left' ? -90 : 90;

//         await sharp(photoPath)
//             .rotate(angle)
//             .toFile(photoPath + '.tmp');
//         fs.renameSync(photoPath + '.tmp', photoPath);

//         await sharp(previewPath)
//             .rotate(angle)
//             .toFile(previewPath + '.tmp');
//         fs.renameSync(previewPath + '.tmp', previewPath);

//         db.prepare(`UPDATE items SET mod_date = strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime') WHERE id = ?`).run(Number(id));
//         res.json({ message: 'Image rotated' });
//         logFromRequest(req, logLevels.INFO, `Rotate: ${photoFilename} rotated ${angle} degrees`);
//     } catch (error) {
//         logFromRequest(req, logLevels.ERROR, `Image rotation failed for item ${id}: ${error.message}`);
//         res.status(500).json({ error: 'Rotation failed' });
//     }
// });

//--------------------------------------------------------------------------
// GET /auctions/:auctionId/slideshow-items
// API to fetch items with photos only. Used for slideshow display
// return only items that have an associated photo
// Uses :publicId not :auctionId - conversion handled in checkAuctionState
//--------------------------------------------------------------------------

app.get('/auctions/:publicId/slideshow-items', authenticateRole("slideshow"), checkAuctionState(['setup', 'locked', 'live','settlement','archived']), (req, res) => {
    const auction_id = Number(req.auction.id);


    try {
        const rows = db.all(
            `SELECT id,
                description,
                contributor,
                artist,
                photo,
                mod_date
           FROM items
          WHERE photo IS NOT NULL
            AND photo <> ''
            AND auction_id = ?
            AND ${ACTIVE_ITEM_WHERE}`,
            [Number(auction_id)]          // one array of bind values
        );

        res.json(rows);                 // rows are ready immediately
    } catch (err) {
        logFromRequest(req, logLevels.ERROR, "Error fetching list: " + err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/slideshow/auctions', authenticateRole("slideshow"), (req, res) => {
    try {
        const auctions = db.prepare(`
          SELECT public_id, full_name
          FROM auctions
          ORDER BY full_name COLLATE NOCASE ASC
        `).all();
        return res.json(auctions);
    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Failed to list slideshow auctions: ${err.message}`);
        return res.status(500).json({ error: "Failed to retrieve auctions" });
    }
});

//--------------------------------------------------------------------------
// POST /validate-auction
// API to check whether the publically entered auction short name exists and is active
// This is a public endpoint and does not expose auction IDs
//--------------------------------------------------------------------------

app.post("/validate-auction", async (req, res) => {
    const { short_name } = req.body;
    if (!short_name || typeof short_name !== 'string'|| short_name.trim() === ''|| short_name.length > 64) {
        logFromRequest(req, logLevels.ERROR, `No or bad auction name received`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return res.status(400).json({ valid: false, error: "Invalid auction name" });
    }
    const sanitised_short_name = sanitiseText(short_name, 64);
    logFromRequest(req, logLevels.DEBUG, `Auction name received: ${short_name}`);

    try {

        db.get('SELECT id, short_name, full_name, status, logo, public_id FROM auctions WHERE short_name = ?', [sanitised_short_name.toLowerCase()], async (err, row) => {
            if (err) {
                logFromRequest(req, logLevels.ERROR, `Error ${err}`);

                return res.status(500).json({ error: `Validation error` });
            }
            else if (!row) {
                logFromRequest(req, logLevels.WARN, `Auction name "${short_name}" not in database`);
                //delay response to hinder brute-force attempts
                await new Promise(resolve => setTimeout(resolve, 2000));
                return res.status(400).json({ valid: false, error: "Auction name not found" });
            }
                // admin override to support slideshow function
            else if (row.status !== `setup`) {
                logFromRequest(req, logLevels.INFO, `Auction "${short_name}" not active (status: ${row.status})`);
                return res.status(400).json({
                    valid: false,
                    code: "not_accepting_submissions",
                    error: "This auction is not currently accepting submissions",
                    short_name: row.short_name,
                    full_name: row.full_name
                });
            }

            logFromRequest(req, logLevels.INFO, `Auction "${short_name}" exists and accepting submissions`);

            res.json({ valid: true, short_name: row.short_name, full_name: row.full_name, logo: row.logo, public_id: row.public_id });
        }
        )
    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Auction validation error: ${err}`);
        res.status(500).json({ valid: false, error: "Validation error" });
    }
});


// -----------------------------------------------------------------------------
// POST /list-auctions
// Optional body parameter:  { status : "live" | "settlement" | ... }
// – If `status` is omitted, returm all
// – If `status` is supplied, only auctions with that status are returned.
// -----------------------------------------------------------------------------
app.post("/list-auctions", authenticateAccess({ roles: ["maintenance", "admin", "cashier"], permissions: ["live_feed"] }), async (req, res) => {
    //    logFromRequest(req, logLevels.DEBUG, "Auction list (admin) requested");

    const status = req.body?.status;             // undefined if not sent
    const allowedStatuses = ["setup", "locked", "live", "settlement", "archived"]; // update if needed

    if (status !== undefined && !allowedStatuses.includes(status)) {
        logFromRequest(req, logLevels.WARN,
            `Rejected list-auctions request with invalid status '${status}'`);
        return res.status(400).json({ error: "Invalid status parameter" });
    }

    let sql = "SELECT id, short_name, full_name, status, admin_can_change_state, public_id FROM auctions";
    const params = [];
    if (status !== undefined) {           // filter only when caller asked for it
        sql += " WHERE status = ?";
        params.push(status);
    }


    try {
        const stmt = db.prepare(sql);
        const auctions = stmt.all(params);

        res.json(auctions);

    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Failed to get auction list: ${err.message}`);
        return res.status(500).json({ error: "Failed to retrieve auctions" });

    }

});

function parseOptionalPositiveId(value) {
    if (value === undefined || value === null || value === "" || value === "null") {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return Number.NaN;
    }

    return parsed;
}

async function cloneItemPhoto(photoFilename) {
    if (!photoFilename) return null;

    const clonedFilename = `resized_${uuidv4()}${path.extname(photoFilename) || ".jpg"}`;
    const sourcePhotoPath = path.join(UPLOAD_DIR, photoFilename);
    const sourcePreviewPath = path.join(UPLOAD_DIR, `preview_${photoFilename}`);
    const clonedPhotoPath = path.join(UPLOAD_DIR, clonedFilename);
    const clonedPreviewPath = path.join(UPLOAD_DIR, `preview_${clonedFilename}`);

    if (!fs.existsSync(sourcePhotoPath)) {
        throw new Error(`Source photo not found for duplicated item: ${photoFilename}`);
    }

    fs.copyFileSync(sourcePhotoPath, clonedPhotoPath);

    try {
        if (fs.existsSync(sourcePreviewPath)) {
            fs.copyFileSync(sourcePreviewPath, clonedPreviewPath);
        } else {
            await sharp(sourcePhotoPath)
                .resize(400, 400, { fit: 'inside' })
                .jpeg({ quality: 70 })
                .toFile(clonedPreviewPath);
        }

        return clonedFilename;
    } catch (err) {
        if (fs.existsSync(clonedPhotoPath)) fs.unlinkSync(clonedPhotoPath);
        if (fs.existsSync(clonedPreviewPath)) fs.unlinkSync(clonedPreviewPath);
        throw err;
    }
}

function deleteClonedItemPhoto(photoFilename) {
    if (!photoFilename) return;

    const photoPath = path.join(UPLOAD_DIR, photoFilename);
    const previewPath = path.join(UPLOAD_DIR, `preview_${photoFilename}`);

    if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
    if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
}

//--------------------------------------------------------------------------
// POST /auctions/:auctionId/items/:id/move-after/:after_id
// API to move an item so it appears directly after another one,
// or duplicate it there when req.body.copy is true
//--------------------------------------------------------------------------

app.post('/auctions/:auctionId/items/:id/move-after/:after_id', authenticateRole("admin"), checkAuctionState(['setup', 'locked']), async (req, res) => {
    const auctionId = Number(req.params.auctionId);
    const id = Number(req.params.id);
    const afterId = parseOptionalPositiveId(req.params.after_id);
    const shouldCopy = req.body?.copy === true || req.body?.copy === "true";

    if (!id || !auctionId || Number.isNaN(afterId)) {
        return res.status(400).json({ error: "Missing or invalid ids" });
    }

    let clonedPhotoFilename = null;

    try {
        const sourceItem = db.get(
            `SELECT id, description, contributor, artist, notes, photo, auction_id, test_item
             FROM items
             WHERE id = ? AND auction_id = ? AND ${ACTIVE_ITEM_WHERE}`,
            [id, auctionId]
        );
        if (!sourceItem) return res.status(400).json({ error: "Item not found" });

        const rows = db.all(
            `SELECT id FROM items WHERE auction_id = ? AND ${ACTIVE_ITEM_WHERE} ORDER BY item_number ASC`,
            [auctionId]
        );
        if (!rows.length) return res.status(400).json({ error: "Auction empty" });

        const orderedIds = rows.map(row => row.id);
        if (!orderedIds.includes(id)) return res.status(400).json({ error: "Item not found" });
        if (afterId !== null && !orderedIds.includes(afterId)) return res.status(400).json({ error: "after_id not found" });

        const renumber = db.prepare("UPDATE items SET item_number = ? WHERE id = ?");

        if (shouldCopy) {
            clonedPhotoFilename = await cloneItemPhoto(sourceItem.photo);

            const insertPos = afterId === null
                ? 0
                : orderedIds.findIndex(itemId => itemId === afterId) + 1;
            const reordered = [
                ...orderedIds.slice(0, insertPos),
                "__NEW_COPY__",
                ...orderedIds.slice(insertPos)
            ];

            const duplicateItem = db.prepare(`
                INSERT INTO items (
                    description,
                    contributor,
                    artist,
                    photo,
                    date,
                    notes,
                    mod_date,
                    text_mod_date,
                    item_number,
                    auction_id,
                    test_item
                ) VALUES (
                    ?,
                    ?,
                    ?,
                    ?,
                    strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime'),
                    ?,
                    strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime'),
                    strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime'),
                    ?,
                    ?,
                    ?
                )
            `);

            const copyAndRenumber = db.transaction(list => {
                const insertInfo = duplicateItem.run(
                    sourceItem.description ? `${sourceItem.description} (copy)` : "(copy)",
                    sourceItem.contributor,
                    sourceItem.artist,
                    clonedPhotoFilename,
                    sourceItem.notes,
                    rows.length + 1,
                    auctionId,
                    sourceItem.test_item ?? null
                );
                const newId = Number(insertInfo.lastInsertRowid);

                list.forEach((itemId, idx) => {
                    renumber.run(idx + 1, itemId === "__NEW_COPY__" ? newId : itemId);
                });

                return newId;
            });

            const newId = copyAndRenumber(reordered);
            clonedPhotoFilename = null;

            logFromRequest(
                req,
                logLevels.INFO,
                `Duplicated item ${id} as ${newId} after ${afterId} in auction ${auctionId}`
            );
            audit(getAuditActor(req), 'duplicated', 'item', newId, {
                source_item: id,
                auction_id: auctionId,
                after_id: afterId
            });

            return res.json({ message: `Item "${sourceItem.description}" duplicated`, id: newId });
        }

        if (afterId === id) return res.status(400).json({ error: "Cannot move item after itself" });

        const remaining = orderedIds.filter(itemId => itemId !== id);
        const insertPos = afterId === null
            ? 0
            : remaining.findIndex(itemId => itemId === afterId) + 1;

        if (insertPos === 0 && afterId !== null) return res.status(400).json({ error: "after_id not found" });

        const reordered = [
            ...remaining.slice(0, insertPos),
            id,
            ...remaining.slice(insertPos)
        ];

        const moveAndRenumber = db.transaction(list => {
            list.forEach((itemId, idx) => renumber.run(idx + 1, itemId));
        });
        moveAndRenumber(reordered);

        logFromRequest(
            req,
            logLevels.INFO,
            `Moved item ${id} to after ${afterId} in auction ${auctionId}`
        );
        res.json({ message: "Item moved and renumbered" });
    } catch (err) {
        if (clonedPhotoFilename) {
            deleteClonedItemPhoto(clonedPhotoFilename);
        }
        logFromRequest(req, logLevels.ERROR, `Failed to move/copy item ${id} in auction ${auctionId}: ${err.message}`);
        res.status(500).json({ error: "Failed to update item numbers" });
    }
}
);



function renumberAuctionItems(auctionId, callback) {
    try {
        db.run(
            `UPDATE items SET item_number = NULL WHERE auction_id = ? AND COALESCE(is_deleted, 0) = 1 AND item_number IS NOT NULL`,
            [auctionId]
        );
    } catch (err) {
        log('Renumber', logLevels.ERROR, `Renumber: Failed to clear deleted item numbers for auction ${auctionId}:` + err);
        return callback(err);
    }

    db.all(
        `SELECT id FROM items WHERE auction_id = ? AND ${ACTIVE_ITEM_WHERE} ORDER BY item_number ASC`,
        [auctionId],
        (err, rows) => {
            if (err) {
                log('Renumber', logLevels.ERROR, `Renumber: Failed to fetch items for auction ${auctionId}:` + err);

                return callback(err);
            }

            let updatesCompleted = 0;
            let errorOccurred = false;

            rows.forEach((row, index) => {
                const newNumber = index + 1;

                db.run(
                    "UPDATE items SET item_number = ? WHERE id = ?",
                    [newNumber, row.id],
                    function (updateErr) {
                        if (updateErr && !errorOccurred) {
                            errorOccurred = true;
                            log('Renumber', logLevels.ERROR, `Renumber: Failed to update item ${row.id}:` + updateErr);

                            return callback(updateErr);
                        }

                        updatesCompleted++;
                        if (updatesCompleted === rows.length && !errorOccurred) {
                            log('Renumber', logLevels.DEBUG, `Renumber: Completed for auction ${auctionId}`);
                            return callback(null, rows.length);
                        }
                    }
                );
            });

            // Handle empty auctions
            if (rows.length === 0) {
                return callback(null, 0);
            }
        }
    );
}

//--------------------------------------------------------------------------
// POST /auction-status
// API to get the status of an auction
//--------------------------------------------------------------------------

app.post('/auction-status', authenticateRole('admin'), (req, res) => {
    const id = Number(req.body.auction_id);
    const row = id
        ? db.get('SELECT status FROM auctions WHERE id = ?', [id])
        : db.get('SELECT status FROM auctions ORDER BY id DESC LIMIT 1');
    res.json({ status: row ? row.status : 'live' });
});


//--------------------------------------------------------------------------
// GET /audit-log
// API to view audit log with item details
// Used by admin for item history and maintenance for general audit
//--------------------------------------------------------------------------

app.get("/audit-log", authenticateRole(["admin", "maintenance"]), (req, res) => {
  const { object_id, object_type } = req.query;

if ((object_type && !auditTypes.includes(object_type)) || (object_id && isNaN(Number(object_id)))) {
    return res.status(400).json({ error: "Invalid filter settings." });
  }

 logFromRequest(req, logLevels.DEBUG, `Audit log requested. Filter - object_id: ${object_id || 'none'}, object_type: ${object_type || 'none'}`); 

  let query = `
  SELECT 
  audit_log.*, 
  items.auction_id, 
  items.item_number, 
  auctions.short_name
FROM audit_log
LEFT JOIN items ON audit_log.object_type = 'item' AND audit_log.object_id = items.id
LEFT JOIN auctions ON audit_log.object_type = 'item' AND items.auction_id = auctions.id
    `


  const params = [];
  if (Number(object_id)) {
    query += ` WHERE audit_log.object_id = ?`;
    params.push(object_id);
  }

  if (object_type) {
    query += object_id ? ` AND audit_log.object_type = ?` : ` WHERE audit_log.object_type = ?`;
    params.push(object_type);
  }

  query += ` ORDER BY audit_log.created_at DESC`;


  try {
    const rows = db.prepare(query).all(...params);

    res.json({ logs: rows });
  } catch (err) {
    console.error("Error fetching audit log:", err.message);
    res.status(500).json({ error: "Failed to retrieve audit log." });
  }
});


function awaitMiddleware(middleware) {
  return (req, res) =>
    new Promise((resolve, reject) => {
      middleware(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
}



//--------------------------------------------------------------------------
// POST /auctions/update-status
// API to update the status of an auction
// Usable by admin user provided that required flag has been set
//--------------------------------------------------------------------------


app.post("/auctions/update-status", authenticateRole(["admin", "maintenance"]), async (req, res) => {
    const { auction_id, status } = req.body;

    if (!auction_id || typeof status !== "string") {
        return res.status(400).json({ error: "Missing auction ID or invalid status." });
    }

    try {
        const auction = await db.get(`SELECT id, status, admin_can_change_state, short_name FROM auctions WHERE id = ?`, [auction_id]);

        // If admin, check auction settings
        const role = req.user?.role;
        const hasMaintenanceRole = Array.isArray(req.user?.roles) && req.user.roles.includes('maintenance');
        if ((role === "admin" && !hasMaintenanceRole && auction.admin_can_change_state === 0)) {
            logFromRequest(req, logLevels.ERROR, `${role} is not allowed to change state of ${auction_id}`);

            return res.status(403).json({ error: 'State change not allowed. Check auction settings' });
        }

        const normalizedStatus = status.toLowerCase();

        // Check if the auction is already in the requested status - We seem to get duplicate requests
        if (auction.status === normalizedStatus) {
            return res.sendStatus(200).end();
        }

        if (!allowedStatuses.includes(normalizedStatus)) {
            return res.status(400).json({ error: `Invalid status: "${status}"` });
        }

        db.run("UPDATE auctions SET status = ? WHERE id = ?", [normalizedStatus, auction_id], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            logFromRequest(req, logLevels.INFO, `Updated status for auction ${auction_id} ${auction.short_name} to: ${normalizedStatus}`);
            audit(getAuditActor(req), 'state change', 'auction', auction_id, { auction: auction_id, name: auction.short_name, new_state: normalizedStatus });
            // clear the auction state cache
       //     checkAuctionState.auctionStateCache.del(auction_id);
            res.json({ message: `Auction ${auction_id} ${auction.short_name} status updated to ${normalizedStatus}` });
        });

    } catch (err) {
        logFromRequest(req, logLevels.ERROR, `Status update for auction ${auction_id} failed:` + err);
        return res.status(500).json({ error: `Status update for auction ${auction_id} failed` });
    }


});

// Serve uploaded images
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static( UPLOAD_DIR ));
app.use('/resources', express.static(CONFIG_IMG_DIR));

// Mount maintenance features (role protected)
app.use('/maintenance', authenticateRole("maintenance"), (req, res, next) => {
    req.originalUrl = req.baseUrl + req.url; // Ensure proper route prefixing
    maintenanceRoutes(req, res, next);
});

// Start the server
const server = app.listen(PORT, HOST, () => {
    log('General', logLevels.INFO, `Server startup complete and listening on ${HOST}:${PORT}`);
});

let shutdownStarted = false;

function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  log('General', logLevels.INFO, `Received ${signal}; shutting down`);

  let finished = false;
  const finish = (exitCode) => {
    if (finished) return;
    finished = true;
    try {
      messaging.shutdown();
    } catch (error) {
      console.error(`[shutdown] Failed to flush messaging persistence: ${error.message}`);
      exitCode = 1;
    }
    try {
      db.close();
    } catch (error) {
      console.error(`[shutdown] Failed to close database: ${error.message}`);
      exitCode = 1;
    }
    process.exit(exitCode);
  };

  const forceTimer = setTimeout(() => {
    console.error('[shutdown] Graceful shutdown timed out; closing active connections');
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    finish(1);
  }, 10000);

  server.close(() => {
    clearTimeout(forceTimer);
    finish(0);
  });
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
      log('General', logLevels.ERROR, `❌ Port ${PORT} is already in use. Please stop the other process or use a different port.`);
      process.exit(1);
  } else {
    console.error('❌ Server error:', err);
    log('General', logLevels.ERROR, `❌ Server error:`+ err);

    process.exit(1);
  }
});

app.use((err, req, res, next) => {
    console.error("Unhandled error:", err.message || err);
    res.status(500).json({ error: "Server error" });
});
