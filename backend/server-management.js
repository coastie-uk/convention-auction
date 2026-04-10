/**
 * @file        server-management.js
 * @description Small utility for password reset, audit maintenance, database reset, and root-only user reset.
 * @author      Chris Staples
 * @license     GPL3
 */

const readline = require("readline");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { audit } = require("./middleware/audit");
const { log, logLevels } = require("./logger");
const { PASSWORD_MIN_LENGTH } = require("./config");
const { getUserByUsername, setUserPassword, normaliseUsername, ROOT_USERNAME } = require("./users");

const linuxusername = process.env.USER || "Unknown";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const MENU_OPTIONS = [
  { key: "1", aliases: ["password", "pass", "p"], label: "Set user password", action: setMaintenancePassword },
  { key: "2", aliases: ["audit", "clear-audit"], label: "Clear database audit log", action: clearAuditLog },
  { key: "3", aliases: ["reset", "db"], label: "Reset database", action: () => resetDatabase(false) },
  { key: "4", aliases: ["reset-all", "counters"], label: "Reset database including counters", action: () => resetDatabase(true) },
  { key: "5", aliases: ["users", "delete-users"], label: `Remove all users except "${ROOT_USERNAME}"`, action: removeAllNonRootUsers },
  { key: "6", aliases: ["exit", "quit", "q"], label: "Exit", action: exitProgram }
];

process.on("SIGINT", () => {
  console.log("\nExiting server management utility.");
  exitProgram();
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

function printMenu() {
  console.log("\n==============================");
  console.log("Server Maintenance Tasks:");
  for (const option of MENU_OPTIONS) {
    console.log(`${option.key}) ${option.label}`);
  }
  console.log("==============================");
  console.log("Tip: enter the number or a shortcut such as 'reset', 'users', or 'quit'.\n");
}

function getMenuAction(answer) {
  const response = String(answer || "").trim().toLowerCase();
  return MENU_OPTIONS.find((option) => option.key === response || option.aliases.includes(response)) || null;
}

async function promptForConfirmation(message, expectedValue) {
  const answer = await prompt(message);
  return String(answer || "").trim().toLowerCase() === expectedValue;
}

async function setMaintenancePassword() {
  const usernameInput = await prompt(`Enter username to reset (default: ${ROOT_USERNAME}): `);
  const targetUsername = normaliseUsername(usernameInput) || ROOT_USERNAME;
  const user = getUserByUsername(targetUsername);
  if (!user) {
    console.log(`ERROR: User "${targetUsername}" not found.`);
    return;
  }

  const newPassword = await prompt(`Enter new password for "${targetUsername}": `);
  if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
    console.log(`ERROR: Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    return;
  }

  const confirmPassword = await prompt("Confirm new password: ");
  if (newPassword !== confirmPassword) {
    console.log("ERROR: Passwords do not match.");
    return;
  }

  updateMaintenancePassword(targetUsername, newPassword);
}

function updateMaintenancePassword(username, newPassword) {
  const hashed = bcrypt.hashSync(newPassword, 12);

  try {
    const result = setUserPassword(username, hashed);
    if (!result || result.changes === 0) {
      log("Server", logLevels.ERROR, `User ${username} not found.`);
    } else {
      log("Server", logLevels.INFO, `Password updated successfully for ${username}.`);
      audit("system", "change password", "server", null, {
        changed_user: username,
        method: "server-management.js",
        user: linuxusername
      });
    }
  } catch (err) {
    log("Server", logLevels.ERROR, `Error updating password for ${username}: ${err.message}`);
  }
}

async function clearAuditLog() {
  const confirmed = await promptForConfirmation(
    "Are you sure you want to clear the audit log? This action cannot be undone. Type `clear` to proceed: ",
    "clear"
  );

  if (!confirmed) {
    console.log("Audit log clear operation cancelled.");
    return;
  }

  try {
    db.pragma("foreign_keys = OFF");
    const clearAuditLogTx = db.transaction(() => {
      db.prepare("DELETE FROM audit_log").run();
      db.prepare("DELETE FROM sqlite_sequence WHERE name = 'audit_log'").run();
    });
    clearAuditLogTx();
    db.pragma("foreign_keys = ON");
    log("Server", logLevels.INFO, "Audit log cleared successfully.");
    audit("system", "clear audit log", "server", null, {
      method: "server-management.js",
      user: linuxusername
    });
  } catch (err) {
    log("Server", logLevels.ERROR, `Error clearing audit log: ${err.message}`);
    db.pragma("foreign_keys = ON");
  }
}

async function resetDatabase(counters = false) {
  const confirmed = await promptForConfirmation(
    `This will clear the database${counters ? " and reset all counters" : ""}. This action cannot be undone. Type \`reset\` to proceed: `,
    "reset"
  );

  if (!confirmed) {
    console.log("Database reset operation cancelled.");
    return;
  }

  try {
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM bidders").run();
    db.prepare("DELETE FROM auctions").run();
    db.prepare("DELETE FROM items").run();
    db.prepare("DELETE FROM payment_intents").run();
    db.prepare("DELETE FROM payments").run();

    if (counters) {
      db.prepare("DELETE FROM sqlite_sequence").run();
      log("Server", logLevels.INFO, "Database counters reset.");
      audit("system", "reset database counters", "server", null, {
        method: "server-management.js",
        user: linuxusername
      });
    }

    db.pragma("foreign_keys = ON");
    log("Server", logLevels.INFO, "Database reset to initial state.");
    audit("system", "reset database", "server", null, {
      method: "server-management.js",
      user: linuxusername
    });
  } catch (err) {
    log("Server", logLevels.ERROR, `Error resetting database: ${err.message}`);
    db.pragma("foreign_keys = ON");
  }
}

async function removeAllNonRootUsers() {
  const confirmed = await promptForConfirmation(
    `This will delete all users except "${ROOT_USERNAME}". Type \`delete\` to proceed: `,
    "delete"
  );

  if (!confirmed) {
    console.log("User removal operation cancelled.");
    return;
  }

  try {
    const result = db.prepare("DELETE FROM users WHERE lower(username) <> lower(?)").run(ROOT_USERNAME);
    log("Server", logLevels.INFO, `Deleted ${result.changes} non-root user(s).`);
    audit("system", "remove non-root users", "server", null, {
      method: "server-management.js",
      user: linuxusername,
      removed_count: result.changes,
      root_username: ROOT_USERNAME
    });
  } catch (err) {
    log("Server", logLevels.ERROR, `Error removing non-root users: ${err.message}`);
  }
}

function exitProgram() {
  rl.close();
  db.close();
  process.exit(0);
}

async function showMenu() {
  while (true) {
    printMenu();
    const answer = await prompt("Select an option: ");
    const selectedOption = getMenuAction(answer);

    if (!selectedOption) {
      console.log("ERROR: Invalid option.");
      continue;
    }

    if (selectedOption.key === "3") {
      console.log("Resetting database to initial state...");
    }

    await selectedOption.action();
  }
}

showMenu().catch((err) => {
  log("Server", logLevels.ERROR, `Unhandled error in server-management.js: ${err.message}`);
  exitProgram();
});
