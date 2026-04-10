/**
 * @file        users.js
 * @description User account helpers (username/password + multi-role authorisation).
 */

const db = require('./db');
const {
  ROLE_LIST,
  ROLE_SET,
  PERMISSION_LIST,
  PERMISSION_SET,
  ROOT_USERNAME
} = require('./auth-constants');

const USERNAME_REGEX = /^[a-z0-9._-]{3,64}$/;
const VIEW_PRIORITY = Object.freeze([
  { key: 'admin', path: '/admin/index.html', role: 'admin' },
  { key: 'cashier', path: '/cashier/index.html', role: 'cashier' },
  { key: 'maintenance', path: '/maint/index.html', role: 'maintenance' },
  { key: 'live_feed', path: '/cashier/live-feed.html', permission: 'live_feed' },
  { key: 'slideshow', path: '/slideshow/index.html', role: 'slideshow' }
]);

function normaliseUsername(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isValidUsername(value) {
  return USERNAME_REGEX.test(normaliseUsername(value));
}

function parseJsonOrDelimitedList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch (_err) {
    // Fallback for older comma-delimited role strings.
  }

  return trimmed.split(',');
}

function normaliseRoles(inputRoles) {
  const source = Array.isArray(inputRoles) ? inputRoles : parseJsonOrDelimitedList(inputRoles);
  const result = [];
  const seen = new Set();

  for (const role of source) {
    const normalized = String(role || '').trim().toLowerCase();
    if (!ROLE_SET.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalisePermissions(inputPermissions, roles = []) {
  const source = Array.isArray(inputPermissions) ? inputPermissions : parseJsonOrDelimitedList(inputPermissions);
  const result = [];
  const seen = new Set();
  const normalizedRoles = normaliseRoles(roles);
  const canBid = normalizedRoles.includes('admin');
  const canManageUsers = normalizedRoles.includes('maintenance');

  for (const permission of source) {
    const normalized = String(permission || '').trim().toLowerCase();
    if (!PERMISSION_SET.has(normalized) || seen.has(normalized)) continue;
    if (normalized === 'admin_bidding' && !canBid) continue;
    if (normalized === 'manage_users' && !canManageUsers) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function shapeUserAccess({ roles, permissions, is_root: isRoot }) {
  const root = Number(isRoot) === 1 || isRoot === true;
  if (root) {
    return {
      roles: [...ROLE_LIST],
      permissions: [...PERMISSION_LIST],
      is_root: 1
    };
  }

  const normalizedRoles = normaliseRoles(roles);
  const normalizedPermissions = normalisePermissions(permissions, normalizedRoles);

  return {
    roles: normalizedRoles,
    permissions: normalizedPermissions,
    is_root: 0
  };
}

function getPrimaryRole(access) {
  const roles = Array.isArray(access?.roles) ? access.roles : [];
  const firstAllowed = VIEW_PRIORITY.find((view) => view.role && roles.includes(view.role));
  return firstAllowed?.role || roles[0] || null;
}

function userCanAccessView(user, viewKey) {
  if (!user) return false;
  const access = shapeUserAccess(user);
  const view = VIEW_PRIORITY.find((entry) => entry.key === viewKey);
  if (!view) return false;
  if (view.role) return access.roles.includes(view.role);
  if (view.permission) return access.permissions.includes(view.permission);
  return false;
}

function getLandingPath(user) {
  const target = VIEW_PRIORITY.find((view) => userCanAccessView(user, view.key));
  return target?.path || '/login.html';
}

function getSessionInvalidBeforeValue(user) {
  const rawValue = Number(user?.session_invalid_before);
  return Number.isFinite(rawValue) && rawValue > 0 ? Math.trunc(rawValue) : 0;
}

function isSessionTokenCurrent(user, tokenPayload) {
  const currentValue = getSessionInvalidBeforeValue(user);
  const tokenValue = getSessionInvalidBeforeValue(tokenPayload);
  return tokenValue >= currentValue;
}

function asUser(row, { includePassword = false } = {}) {
  if (!row) return null;

  const username = normaliseUsername(row.username || '');
  const isRoot = Number(row.is_root) === 1 || username === ROOT_USERNAME;
  const access = shapeUserAccess({
    roles: row.roles,
    permissions: row.permissions,
    is_root: isRoot ? 1 : 0
  });

  const mapped = {
    username: row.username,
    roles: access.roles,
    permissions: access.permissions,
    session_invalid_before: getSessionInvalidBeforeValue(row),
    is_root: access.is_root,
    created_at: row.created_at,
    updated_at: row.updated_at
  };

  if (includePassword) mapped.password = row.password;
  return mapped;
}

function getUserByUsername(username) {
  const normalized = normaliseUsername(username);
  if (!normalized) return null;

  const row = db.prepare(`
    SELECT username, password, roles, permissions, session_invalid_before, is_root, created_at, updated_at
    FROM users
    WHERE lower(username) = lower(?)
  `).get(normalized);

  return asUser(row, { includePassword: true });
}

function listUsers() {
  const rows = db.prepare(`
    SELECT username, roles, permissions, session_invalid_before, is_root, created_at, updated_at
    FROM users
    ORDER BY is_root DESC, username COLLATE NOCASE ASC
  `).all();

  return rows.map((row) => asUser(row));
}

function listUsersWithPasswords() {
  const rows = db.prepare(`
    SELECT username, password, roles, permissions, session_invalid_before, is_root, created_at, updated_at
    FROM users
    ORDER BY username COLLATE NOCASE ASC
  `).all();

  return rows.map((row) => asUser(row, { includePassword: true }));
}

function userHasRole(user, role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!ROLE_SET.has(normalizedRole)) return false;
  if (!user) return false;
  return shapeUserAccess(user).roles.includes(normalizedRole);
}

function userHasPermission(user, permission) {
  const normalizedPermission = String(permission || '').trim().toLowerCase();
  if (!PERMISSION_SET.has(normalizedPermission)) return false;
  if (!user) return false;
  return shapeUserAccess(user).permissions.includes(normalizedPermission);
}

function createUser({ username, passwordHash, roles, permissions = [], isRoot = false }) {
  const normalizedUsername = normaliseUsername(username);
  if (!isValidUsername(normalizedUsername)) {
    throw new Error('invalid_username');
  }

  const isRootUser = Boolean(isRoot) || normalizedUsername === ROOT_USERNAME;
  const access = shapeUserAccess({
    roles: isRootUser ? ROLE_LIST : roles,
    permissions: isRootUser ? PERMISSION_LIST : permissions,
    is_root: isRootUser ? 1 : 0
  });
  const normalizedRoles = access.roles;
  if (!isRootUser && normalizedRoles.length === 0 && access.permissions.length === 0) {
    throw new Error('access_required');
  }

  const info = db.prepare(`
    INSERT INTO users (username, password, roles, permissions, session_invalid_before, is_root, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'), strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
  `).run(
    normalizedUsername,
    passwordHash,
    JSON.stringify(normalizedRoles),
    JSON.stringify(access.permissions),
    isRootUser ? 1 : 0
  );

  return info;
}

function updateUserRoles(username, roles) {
  const existing = getUserByUsername(username);
  return updateUserAccess(username, {
    roles,
    permissions: existing?.permissions || []
  });
}

function updateUserAccess(username, { roles, permissions = [] }) {
  const normalizedUsername = normaliseUsername(username);
  if (!normalizedUsername) return { changes: 0 };

  if (normalizedUsername === ROOT_USERNAME) {
    return db.prepare(`
      UPDATE users
      SET roles = ?, permissions = ?, is_root = 1, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
      WHERE lower(username) = lower(?)
    `).run(JSON.stringify(ROLE_LIST), JSON.stringify(PERMISSION_LIST), ROOT_USERNAME);
  }

  const access = shapeUserAccess({ roles, permissions, is_root: 0 });
  if (access.roles.length === 0 && access.permissions.length === 0) {
    throw new Error('access_required');
  }

  return db.prepare(`
    UPDATE users
    SET roles = ?, permissions = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
    WHERE lower(username) = lower(?)
  `).run(JSON.stringify(access.roles), JSON.stringify(access.permissions), normalizedUsername);
}

function setUserPassword(username, passwordHash) {
  const normalizedUsername = normaliseUsername(username);
  if (!normalizedUsername) return { changes: 0 };

  return db.prepare(`
    UPDATE users
    SET password = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
    WHERE lower(username) = lower(?)
  `).run(passwordHash, normalizedUsername);
}

function invalidateUserSessions(username) {
  const normalizedUsername = normaliseUsername(username);
  if (!normalizedUsername) return { changes: 0 };

  return db.prepare(`
    UPDATE users
    SET session_invalid_before = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
    WHERE lower(username) = lower(?)
  `).run(Date.now(), normalizedUsername);
}

function deleteUser(username) {
  const normalizedUsername = normaliseUsername(username);
  if (!normalizedUsername) return { changes: 0 };
  if (normalizedUsername === ROOT_USERNAME) {
    throw new Error('root_cannot_be_deleted');
  }

  return db.prepare(`
    DELETE FROM users
    WHERE lower(username) = lower(?)
  `).run(normalizedUsername);
}

function getUsersForRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!ROLE_SET.has(normalizedRole)) return [];
  return listUsersWithPasswords().filter((user) => userHasRole(user, normalizedRole));
}

function getAuditActor(req) {
  if (!req || typeof req !== 'object') return 'system';
  return req.user?.auditUser || req.user?.username || req.user?.role || 'system';
}

module.exports = {
  ROLE_LIST,
  ROLE_SET,
  ROOT_USERNAME,
  PERMISSION_LIST,
  PERMISSION_SET,
  VIEW_PRIORITY,
  normaliseUsername,
  isValidUsername,
  normaliseRoles,
  normalisePermissions,
  shapeUserAccess,
  getPrimaryRole,
  userCanAccessView,
  getLandingPath,
  getUserByUsername,
  listUsers,
  createUser,
  updateUserRoles,
  updateUserAccess,
  setUserPassword,
  invalidateUserSessions,
  deleteUser,
  userHasRole,
  userHasPermission,
  getSessionInvalidBeforeValue,
  isSessionTokenCurrent,
  getUsersForRole,
  getAuditActor
};
