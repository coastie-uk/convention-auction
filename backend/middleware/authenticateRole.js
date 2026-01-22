// auth.js
/**
 * Authentication / authorisation helpers.
 */

const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../config');
const { logFromRequest, logLevels } = require('../logger');

/**
 * Central list of valid roles.
 * Keep this in one place so backends & tests stay in sync.
 */
const VALID_ROLES = new Set(['admin', 'maintenance', 'cashier', 'slideshow']);

  // Sleep function that returns a promise
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }



/**
 * Express middleware factory that validates a JWT **and** authorisation role.
 *
 * @param {string | Iterable<string>} acceptedRoles – either:
 *        • a single role string  e.g. "admin"                      (previous behaviour)  
 *        • an iterable of roles   e.g. ["admin", "cashier"]
 *
 * @returns {import('express').RequestHandler}
 */
function authenticateRole(acceptedRoles) {
    // ------------- parameter normalisation & validation -------------
    const roleList = Array.isArray(acceptedRoles)
        ? [...acceptedRoles]                       // copy to avoid surprises
        : [acceptedRoles];                         // preserve backward compatibility

    // defensive input checks – fail fast on bad config
    roleList.forEach(role => {
        if (!VALID_ROLES.has(role)) {
            const msg = `authenticateRole(): invalid role "${role}" supplied`;
            // Prefer throwing during app start-up so a bad route fails loudly
            /* istanbul ignore next */               // easier testing
            throw new TypeError(msg);
        }
    });

    const roleSet = new Set(roleList);           // O(1) look-ups later

    // ------------------ actual middleware ------------------
    return function authenticateRoleMw(req, res, next) {
        const token = req.headers['authorization'];

        if (!token) {
            logFromRequest(req, logLevels.ERROR, 'No JWT supplied in Authorization header');
            sleep(1000).then(() => {  // mitigate brute-force attacks
                return res.status(403).json({ error: 'Access denied' });
            });
            return;
        }

        // Verify token & role
        if (typeof token !== 'string') {
            logFromRequest(req, logLevels.DEBUG, 'Malformed Authorization header (not a string)');
            sleep(1000).then(() => {  // mitigate brute-force attacks
                return res.status(403).json({ error: 'Access denied' });
            });
            return;
        }

        jwt.verify(token, SECRET_KEY, (err, decoded) => {
            if (err) {
                logFromRequest(
                    req,
                    logLevels.DEBUG,
                    `Invalid token – ${err.name}…`
                );
                return res.status(403).json({ error: 'Session expired' });
            }

            if (!roleSet.has(decoded.role)) {
                logFromRequest(
                    req,
                    logLevels.WARN,
                    `Role mismatch. Allowed: ${[...roleSet].join(', ')}, got ${decoded.role}`
                );
                return res.status(403).json({ error: 'Unauthorized' });
            }

            // Success – attach user to request and continue
            req.user = decoded;
            next();
        });
    };
}

module.exports = {
  authenticateRole,
  VALID_ROLES,  // optional, but handy for tests or other modules
};