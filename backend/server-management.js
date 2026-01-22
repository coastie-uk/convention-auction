/**
 * @file        server-management.js
 * @description Small utility to 1) set the maintenance password in case a lockout occurs and 2) clear the audit log 
 * @author      Chris Staples
 * @license     GPL3
 */

const readline = require("readline");
const bcrypt = require('bcryptjs');
const db = require('./db');
const { audit } = require('./middleware/audit');
const { log, logLevels } = require('./logger');
const { PASSWORD_MIN_LENGTH } = require('./config');

const linuxusername = process.env.USER || 'Unknown';

// Set up prompt interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to set maintenance password
function setMaintenancePassword() {
  rl.question("Enter new maintenance password: ", (newPassword) => {

    if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
      console.log(`ERROR: Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      showMenu();
    }
    rl.question("Confirm new maintenance password: ", (confirmPassword) => {
      if (newPassword !== confirmPassword) {
        console.log("ERROR: Passwords do not match.");
        showMenu();
      }
      else updateMaintenancePassword(newPassword);
    });
  });
  showMenu();
}

function updateMaintenancePassword(newPassword) {
  // Update password in database

  // Hash password before storing
  const hashed = bcrypt.hashSync(newPassword, 12);

  db.run(
    `UPDATE passwords SET password = ? WHERE role = 'maintenance'`,
    [hashed],
    function (err) {
      if (err) {
        log("Server", logLevels.ERROR, `Error updating maintenance password: ${err.message}`);
      } else if (this.changes === 0) {
        log("Server", logLevels.INFO, "Maintenance role not found. Inserting new maintenance password.");
        db.run(
          `INSERT INTO passwords (role, password) VALUES ('maintenance', ?)`,
          [hashed],
          (err) => {
            if (err) {
              log("Server", logLevels.ERROR, `Error inserting maintenance password: ${err.message}`);
            } else {
              log("Server", logLevels.INFO, "Maintenance password inserted successfully.");
            }
          }
        );
      } else {
        log("Server", logLevels.INFO, "Maintenance password updated successfully.");
        audit('system', 'change password', 'server', null, { changed_role: 'maintenance', method: 'server-management.js', user: linuxusername });
      }
    }
  );
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

function resetDatabase() {

    rl.question("Are you sure you want to reset the database? This action cannot be undone. Type `reset` to proceed: ", (answer) => {
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
  db.pragma('foreign_keys = ON');
  }
  catch (err) {
    log("Server", logLevels.ERROR, `Error resetting database: ${err.message}`);
    db.pragma('foreign_keys = ON');
    showMenu();
    return;
  }
  log("Server", logLevels.INFO, "Database reset to initial state.");
  
  audit('system', 'reset database', 'server', null, { method: 'server-management.js', user: linuxusername });
  showMenu();
}
     else {
      console.log("Database reset operation cancelled.");
      showMenu();}
  });
}

// Display menu and handle user input


function showMenu() {
  console.log("\n==============================");
  console.log("Server Maintenance Tasks:");
  console.log("1) Set maintenance password");
  console.log("2) Clear database audit log");
  console.log("3) Reset database to initial state");
  console.log("4) Exit");
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
      rl.close();
      db.close();
      process.exit(0);
    }
    console.log("ERROR: Invalid option.");
    showMenu();
  });
}


showMenu();
