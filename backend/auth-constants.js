/**
 * Shared auth constants.
 */

const ROLE_LIST = Object.freeze(['admin', 'maintenance', 'cashier', 'slideshow']);
const PERMISSION_LIST = Object.freeze(['live_feed', 'admin_bidding', 'manage_users']);
const ROOT_USERNAME = 'root';

module.exports = {
  ROLE_LIST,
  ROLE_SET: new Set(ROLE_LIST),
  PERMISSION_LIST,
  PERMISSION_SET: new Set(PERMISSION_LIST),
  ROOT_USERNAME
};
