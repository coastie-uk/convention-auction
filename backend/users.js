/**
 * @file        users.js
 * @description User account helpers (username/password + multi-role authorisation).
 */

const db = require('./db');
const { ROLE_LIST, ROLE_SET, ROOT_USERNAME } = require('./auth-constants');

const USERNAME_REGEX = /^[a-z0-9._-]{3,64}$/;

function normaliseUsername(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isValidUsername(value) {
  return USERNAME_REGEX.test(normaliseUsername(value));
}

function parseRoles(raw) {
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
  const source = Array.isArray(inputRoles) ? inputRoles : parseRoles(inputRoles);
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

function asUser(row, { includePassword = false } = {}) {
  if (!row) return null;

  const username = normaliseUsername(row.username || '');
  const isRoot = Number(row.is_root) === 1 || username === ROOT_USERNAME;
  const roles = isRoot ? [...ROLE_LIST] : normaliseRoles(row.roles);

  const mapped = {
    username: row.username,
    roles,
    is_root: isRoot ? 1 : 0,
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
    SELECT username, password, roles, is_root, created_at, updated_at
    FROM users
    WHERE lower(username) = lower(?)
  `).get(normalized);

  return asUser(row, { includePassword: true });
}

function listUsers() {
  const rows = db.prepare(`
    SELECT username, roles, is_root, created_at, updated_at
    FROM users
    ORDER BY is_root DESC, username COLLATE NOCASE ASC
  `).all();

  return rows.map((row) => asUser(row));
}

function listUsersWithPasswords() {
  const rows = db.prepare(`
    SELECT username, password, roles, is_root, created_at, updated_at
    FROM users
    ORDER BY username COLLATE NOCASE ASC
  `).all();

  return rows.map((row) => asUser(row, { includePassword: true }));
}

function userHasRole(user, role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!ROLE_SET.has(normalizedRole)) return false;
  if (!user) return false;
  if (Number(user.is_root) === 1) return true;
  return Array.isArray(user.roles) && user.roles.includes(normalizedRole);
}

function createUser({ username, passwordHash, roles, isRoot = false }) {
  const normalizedUsername = normaliseUsername(username);
  if (!isValidUsername(normalizedUsername)) {
    throw new Error('invalid_username');
  }

  const isRootUser = Boolean(isRoot) || normalizedUsername === ROOT_USERNAME;
  const normalizedRoles = isRootUser ? [...ROLE_LIST] : normaliseRoles(roles);
  if (!isRootUser && normalizedRoles.length === 0) {
    throw new Error('roles_required');
  }

  const info = db.prepare(`
    INSERT INTO users (username, password, roles, is_root, created_at, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%S', 'now'), strftime('%Y-%m-%d %H:%M:%S', 'now'))
  `).run(normalizedUsername, passwordHash, JSON.stringify(normalizedRoles), isRootUser ? 1 : 0);

  return info;
}

function updateUserRoles(username, roles) {
  const normalizedUsername = normaliseUsername(username);
  if (!normalizedUsername) return { changes: 0 };

  if (normalizedUsername === ROOT_USERNAME) {
    return db.prepare(`
      UPDATE users
      SET roles = ?, is_root = 1, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
      WHERE lower(username) = lower(?)
    `).run(JSON.stringify(ROLE_LIST), ROOT_USERNAME);
  }

  const normalizedRoles = normaliseRoles(roles);
  if (normalizedRoles.length === 0) {
    throw new Error('roles_required');
  }

  return db.prepare(`
    UPDATE users
    SET roles = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
    WHERE lower(username) = lower(?)
  `).run(JSON.stringify(normalizedRoles), normalizedUsername);
}

function setUserPassword(username, passwordHash) {
  const normalizedUsername = normaliseUsername(username);
  if (!normalizedUsername) return { changes: 0 };

  return db.prepare(`
    UPDATE users
    SET password = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
    WHERE lower(username) = lower(?)
  `).run(passwordHash, normalizedUsername);
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
  normaliseUsername,
  isValidUsername,
  normaliseRoles,
  getUserByUsername,
  listUsers,
  createUser,
  updateUserRoles,
  setUserPassword,
  deleteUser,
  userHasRole,
  getUsersForRole,
  getAuditActor
};
