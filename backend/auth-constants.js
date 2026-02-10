/**
 * Shared auth constants.
 */

const ROLE_LIST = Object.freeze(['admin', 'maintenance', 'cashier', 'slideshow']);
const ROOT_USERNAME = 'root';

module.exports = {
  ROLE_LIST,
  ROLE_SET: new Set(ROLE_LIST),
  ROOT_USERNAME
};
