/**
 * Authentication / authorisation helpers.
 */

const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../config');
const { logFromRequest, logLevels } = require('../logger');
const {
  ROLE_LIST,
  ROLE_SET,
  PERMISSION_LIST,
  PERMISSION_SET
} = require('../auth-constants');
const {
  shapeUserAccess,
  getPrimaryRole,
  getUserByUsername,
  isSessionTokenCurrent
} = require('../users');

const VALID_ROLES = new Set(ROLE_LIST);
const VALID_PERMISSIONS = new Set(PERMISSION_LIST);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAcceptedValues(input, validSet, label) {
  const values = Array.isArray(input) ? [...input] : [input];
  values.forEach((value) => {
    if (!validSet.has(value)) {
      throw new TypeError(`Invalid ${label} "${value}" supplied`);
    }
  });
  return new Set(values);
}

function attachDecodedUser(req, decoded) {
  const username = typeof decoded?.username === 'string'
    ? decoded.username
    : (typeof decoded?.role === 'string' ? decoded.role : 'unknown');
  const access = shapeUserAccess(decoded || {});

  req.user = {
    ...decoded,
    username,
    roles: access.roles,
    permissions: access.permissions,
    is_root: access.is_root,
    role: getPrimaryRole(access),
    auditUser: username
  };

  return req.user;
}

function authenticateSession(req, res, next) {
  const token = req.headers.authorization;

  if (!token || typeof token !== 'string') {
    logFromRequest(req, logLevels.ERROR, 'No JWT supplied in Authorization header');
    sleep(1000).then(() => res.status(403).json({ error: 'Access denied' }));
    return;
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      logFromRequest(req, logLevels.DEBUG, `Invalid token – ${err.name}…`);
      return res.status(403).json({ error: 'Session expired' });
    }

    const currentUser = getUserByUsername(decoded?.username || '');
    if (!currentUser) {
      return res.status(403).json({ error: 'Session expired' });
    }
    if (!isSessionTokenCurrent(currentUser, decoded)) {
      logFromRequest(req, logLevels.INFO, `Session invalidated for ${currentUser.username}`);
      return res.status(403).json({ error: 'Session invalidated', reason: 'remote_logout' });
    }

    attachDecodedUser(req, decoded);
    return next();
  });
}

function authenticateRole(acceptedRoles) {
  const roleSet = normalizeAcceptedValues(acceptedRoles, VALID_ROLES, 'role');

  return [
    authenticateSession,
    (req, res, next) => {
      if (req.user.roles.some((role) => roleSet.has(role))) {
        return next();
      }

      logFromRequest(
        req,
        logLevels.WARN,
        `Role mismatch. Allowed: ${[...roleSet].join(', ')}, token roles: ${req.user.roles.join(', ')}`
      );
      return res.status(403).json({ error: 'Unauthorized' });
    }
  ];
}

function authenticatePermission(acceptedPermissions) {
  const permissionSet = normalizeAcceptedValues(acceptedPermissions, VALID_PERMISSIONS, 'permission');

  return [
    authenticateSession,
    (req, res, next) => {
      if (req.user.permissions.some((permission) => permissionSet.has(permission))) {
        return next();
      }

      logFromRequest(
        req,
        logLevels.WARN,
        `Permission mismatch. Allowed: ${[...permissionSet].join(', ')}, token permissions: ${req.user.permissions.join(', ')}`
      );
      return res.status(403).json({ error: 'Unauthorized' });
    }
  ];
}

function authenticateAccess({ roles = [], permissions = [] } = {}) {
  const roleSet = new Set(normalizeAcceptedValues(roles, VALID_ROLES, 'role'));
  const permissionSet = new Set(normalizeAcceptedValues(permissions, VALID_PERMISSIONS, 'permission'));

  return [
    authenticateSession,
    (req, res, next) => {
      const hasRole = [...roleSet].length === 0 || req.user.roles.some((role) => roleSet.has(role));
      const hasPermission = [...permissionSet].length === 0 || req.user.permissions.some((permission) => permissionSet.has(permission));

      if ((roleSet.size > 0 && hasRole) || (permissionSet.size > 0 && hasPermission)) {
        return next();
      }

      logFromRequest(
        req,
        logLevels.WARN,
        `Access mismatch. Allowed roles: ${[...roleSet].join(', ') || 'none'}, allowed permissions: ${[...permissionSet].join(', ') || 'none'}`
      );
      return res.status(403).json({ error: 'Unauthorized' });
    }
  ];
}

module.exports = {
  authenticateSession,
  authenticateRole,
  authenticatePermission,
  authenticateAccess,
  attachDecodedUser,
  VALID_ROLES,
  VALID_PERMISSIONS
};
