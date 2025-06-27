const sqlite3 = require("sqlite3").verbose();
const readline = require("readline");

// Set up prompt interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Prompt user for password
rl.question("Enter new maintenance password: ", (newPassword) => {
  if (!newPassword || newPassword.length < 5) {
    console.error("Password must be at least 5 characters.");
    rl.close();
    process.exit(1);
  }

  const db = new sqlite3.Database("./auction.db");

  db.run(
    `UPDATE passwords SET password = ? WHERE role = 'maintenance'`,
    [newPassword],
    function (err) {
      if (err) {
        console.error("Error updating password:", err.message);
      } else if (this.changes === 0) {
        console.log("Maintenance role not found. Inserting...");
        db.run(
          `INSERT INTO passwords (role, password) VALUES ('maintenance', ?)`,
          [newPassword],
          (err) => {
            if (err) {
              console.error("Error inserting password:", err.message);
            } else {
              console.log("Maintenance password set successfully.");
            }
            db.close();
            rl.close();
          }
        );
      } else {
        console.log("Maintenance password updated successfully.");
        db.close();
        rl.close();
      }
    }
  );
});
