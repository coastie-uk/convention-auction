/**
 * @file        server-management.js
 * @description Small utility for password reset, audit maintenance, database reset, and root-only user reset.
 * @author      Chris Staples
 * @license     GPL3
 */

const readline = require("readline");
const bcrypt = require('bcryptjs');
const db = require('./db');
const { audit } = require('./middleware/audit');
const { log, logLevels } = require('./logger');
const { PASSWORD_MIN_LENGTH } = require('./config');
const { getUserByUsername, setUserPassword, normaliseUsername, ROOT_USERNAME } = require('./users');

const linuxusername = process.env.USER || 'Unknown';

// Set up prompt interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to set a user password
function setMaintenancePassword() {
  rl.question("Enter username to reset (default: root): ", (usernameInput) => {
    const targetUsername = normaliseUsername(usernameInput) || 'root';
    const user = getUserByUsername(targetUsername);
    if (!user) {
      console.log(`ERROR: User "${targetUsername}" not found.`);
      showMenu();
      return;
    }

    rl.question(`Enter new password for "${targetUsername}": `, (newPassword) => {

      if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
        console.log(`ERROR: Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
        showMenu();
        return;
      }

      rl.question("Confirm new password: ", (confirmPassword) => {
        if (newPassword !== confirmPassword) {
          console.log("ERROR: Passwords do not match.");
          showMenu();
        }
        else updateMaintenancePassword(targetUsername, newPassword);
      });
    });
  });
  showMenu();
}

function updateMaintenancePassword(username, newPassword) {
  // Update password in database

  // Hash password before storing
  const hashed = bcrypt.hashSync(newPassword, 12);

  try {
    const result = setUserPassword(username, hashed);
    if (!result || result.changes === 0) {
      log("Server", logLevels.ERROR, `User ${username} not found.`);
    } else {
      log("Server", logLevels.INFO, `Password updated successfully for ${username}.`);
      audit('system', 'change password', 'server', null, { changed_user: username, method: 'server-management.js', user: linuxusername });
    }
  } catch (err) {
    log("Server", logLevels.ERROR, `Error updating password for ${username}: ${err.message}`);
  }
  showMenu();
};

function clearAuditLog() {
  rl.question("Are you sure you want to clear the audit log? This action cannot be undone. Type `clear` to proceed: ", (answer) => {
    const response = String(answer || "").trim().toLowerCase();
    if (response === "clear") {

      try {
         db.pragma('foreign_keys = OFF');
        const clearAuditLogTx = db.transaction(() => {
          db.prepare("DELETE FROM audit_log").run();
          db.prepare("DELETE FROM sqlite_sequence WHERE name = 'audit_log'").run();
        });
        clearAuditLogTx();
         db.pragma('foreign_keys = ON');
        log("Server", logLevels.INFO, "Audit log cleared successfully.");
        audit('system', 'clear audit log', 'server', null, { method: 'server-management.js', user: linuxusername });

        showMenu();
        return;
      }
      catch (err) {
        log("Server", logLevels.ERROR, `Error clearing audit log: ${err.message}`);
        showMenu();
        return;
      }

    } else {
      console.log("Audit log clear operation cancelled.");
      showMenu();}
  });
  showMenu();
}

function resetDatabase(counters = false) {
  rl.question(`This will clear the database. ${counters ? ' and reset all counters' : ''}  This action cannot be undone. Type \`reset\` to proceed: `, (answer) => {
    const response = String(answer || "").trim().toLowerCase();
    if (response === "reset") {
      // TODO delete all data from all tables except passwords and audit_log
      try {
        db.pragma('foreign_keys = OFF');
        db.prepare("DELETE FROM bidders").run();
        db.prepare("DELETE FROM auctions").run();
        db.prepare("DELETE FROM items").run();
        db.prepare("DELETE FROM payment_intents").run();
        db.prepare("DELETE FROM payments").run();
        if (counters) {
          db.prepare("DELETE FROM sqlite_sequence").run();
          log("Server", logLevels.INFO, "Database counters reset.");
          audit('system', 'reset database counters', 'server', null, { method: 'server-management.js', user: linuxusername });
        }
        db.pragma('foreign_keys = ON');
      } catch (err) {
        log("Server", logLevels.ERROR, `Error resetting database: ${err.message}`);
        db.pragma('foreign_keys = ON');
        showMenu();
        return;
      }
      log("Server", logLevels.INFO, "Database reset to initial state.");
      audit('system', 'reset database', 'server', null, { method: 'server-management.js', user: linuxusername });
      showMenu();
      return;
    }
    console.log("Database reset operation cancelled.");
    showMenu();
  });
}

function removeAllNonRootUsers() {
  rl.question(`This will delete all users except "${ROOT_USERNAME}". Type \`delete\` to proceed: `, (answer) => {
    const response = String(answer || "").trim().toLowerCase();
    if (response === "delete") {
      try {
        const result = db.prepare("DELETE FROM users WHERE lower(username) <> lower(?)").run(ROOT_USERNAME);
        log("Server", logLevels.INFO, `Deleted ${result.changes} non-root user(s).`);
        audit('system', 'remove non-root users', 'server', null, {
          method: 'server-management.js',
          user: linuxusername,
          removed_count: result.changes,
          root_username: ROOT_USERNAME
        });
      } catch (err) {
        log("Server", logLevels.ERROR, `Error removing non-root users: ${err.message}`);
      }
    } else {
      console.log("User removal operation cancelled.");
    }
    showMenu();
  });
}

// Display menu and handle user input


function showMenu() {
  console.log("\n==============================");
  console.log("Server Maintenance Tasks:");
  console.log("1) Set user password");
  console.log("2) Clear database audit log");
  console.log("3) Reset database");
  console.log("4) Reset database including counters");
  console.log(`5) Remove all users except "${ROOT_USERNAME}"`);

  console.log("6) Exit");
  console.log("==============================\n");
  rl.question("Select an option: ", (answer) => {
    const choice = String(answer || "").trim();
    if (choice === "1") {
      setMaintenancePassword();
      showMenu();
    }
    if (choice === "2") {
      clearAuditLog();
      showMenu();
    }
    if (choice === "3") {
      console.log("Resetting database to initial state...");
      resetDatabase();
    
        showMenu();
      };
    if (choice === "4") {
      resetDatabase(true);
      showMenu();
    }

    if (choice === "5") {
      removeAllNonRootUsers();
      showMenu();
    }

    if (choice === "6") {
      rl.close();
      db.close();
      process.exit(0);
    }
    console.log("ERROR: Invalid option.");
    showMenu();
  });
}


showMenu();
