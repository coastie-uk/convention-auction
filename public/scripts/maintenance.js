const API = "/api"

const output = document.getElementById("output");
const loginSection = document.getElementById("login-section");
const maintenanceSection = document.getElementById("maintenance-section");
const softwareVersion = document.getElementById("software-version");

var isRendering = false;

checkToken();

// Check if maint is already authenticated
async function checkToken() {
  const token = localStorage.getItem("maintenanceToken");
  if (token) {
    const response = await fetch(`${API}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const data = await response.json();
    if (response.ok) {
      loginSection.style.display = "none";
      maintenanceSection.style.display = "block";
      refreshAuctions();
      checkIntegrity();
      loadPptxImageList();
      startAutoRefresh();
      loadEnabledPaymentMethods();
      softwareVersion.textContent = `Backend: ${data.versions.backend || 'N/A'}, Schema: ${data.versions.schema || 'N/A'}, Payment processor: ${data.versions.payment_processor || 'N/A'}`;
    } else {
      logOut();
      document.getElementById("error-message").innerText = data.error;
      showMessage("Authentication: " + data.error, "error");
    }
  }
}


document.getElementById("login-button").addEventListener("click", async () => {
  const password = document.getElementById("maintenance-password").value;
  const res = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, role: "maintenance" })
  });
  const data = await res.json();
  if (res.ok) {
    localStorage.setItem("maintenanceToken", data.token);
    loginSection.style.display = "none";
    maintenanceSection.style.display = "block";
    refreshAuctions();
    checkToken();
    loadEnabledPaymentMethods();
    softwareVersion.textContent = `Backend version: ${data.versions.backend || 'N/A'}, Schema version: ${data.versions.schema || 'N/A'}`;

    location.reload();
  } else {
    document.getElementById("error-message").innerText = data.error;
  }
});

const token = localStorage.getItem("maintenanceToken");

document.getElementById("backup-db").onclick = async () => {
  const res = await fetch(`${API}/maintenance/backup`, { method: "POST", headers: { Authorization: token } });
  const data = await res.json();
  showMessage(data.message);
};


document.getElementById("download-db").onclick = async () => {
  const res = await fetch(`${API}/maintenance/download-full`, {
    headers: { Authorization: token }
  });



  // Extract filename from content-disposition header
  const disposition = res.headers.get("Content-Disposition");
  let filename = "auction_backup.zip";

  if (disposition && disposition.includes("filename=")) {
    const match = disposition.match(/filename=\"?([^\";]+)\"?/);
    if (match && match[1]) {
      filename = match[1];
    }
  }

  // Trigger download
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

document.getElementById("download-db-file").onclick = async () => {
  const res = await fetch(`${API}/maintenance/download-db`, {
    headers: { Authorization: token }
  });

  const disposition = res.headers.get("Content-Disposition");
  let filename = "auction.db";

  if (disposition && disposition.includes("filename=")) {
    const match = disposition.match(/filename=\"?([^\";]+)\"?/);
    if (match && match[1]) {
      filename = match[1];
    }
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};





document.getElementById("restore-db").onclick = async () => {
  const fileInput = document.getElementById("restore-file");
  if (!fileInput.files.length) return showMessage("Select a file", "info");
  const formData = new FormData();
  formData.append("backup", fileInput.files[0]);
  const res = await fetch(`${API}/maintenance/restore`, {
    method: "POST",
    headers: { Authorization: token },
    body: formData
  });
  const data = await res.json();

  if (res.ok) {
    showMessage(data.message, "success");
  } else {
    showMessage(data.error || "Restore failed", "error");
  }

};

document.getElementById("export-csv").onclick = async () => {
  const res = await fetch(`${API}/maintenance/export`, {
    headers: { Authorization: token }
  });
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "auction_bulk_export.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
};



document.getElementById("import-csv-btn").onclick = async () => {
  const fileInput = document.getElementById("import-csv");
  if (!fileInput.files.length) return showMessage("Select a file", "info");
  const formData = new FormData();
  formData.append("csv", fileInput.files[0]);
  const res = await fetch(`${API}/maintenance/import`, {
    method: "POST",
    headers: { Authorization: token },
    body: formData
  });
  const data = await res.json();
  if (res.ok) {
    showMessage(data.message || "Import complete", "success");
  } else {
    showMessage(data.error || "Import failed", "error");
  }
};

document.getElementById("photo-report").onclick = async () => {
  const res = await fetch(`${API}/maintenance/photo-report`, { headers: { Authorization: token } });
  const data = await res.json();
  showMessage(`Stored images: ${data.count}, Total size: ${(data.totalSize / 1024 / 1024).toFixed(2)} MB`);
};

function formatLogs(rawText) {
  return rawText
    .replace(/\[DEBUG\]/g, '<span style="color:gray; font-weight:bold;">[DEBUG]</span>')
    .replace(/\[INFO\]/g, '<span style="color:green; font-weight:bold;">[INFO]</span>')
    .replace(/\[WARN\]/g, '<span style="color:orange; font-weight:bold;">[WARN]</span>')
    .replace(/\[ERROR\]/g, '<span style="color:red; font-weight:bold;">[ERROR]</span>')
    .replace(/\n/g, '<br>');  // Properly convert newlines to <br> tags
}


document.getElementById("change-password").onclick = async () => {
  const newPassword = document.getElementById("new-password").value.trim();
  const confirmPassword = document.getElementById("confirm-password").value.trim();
  const role = document.getElementById("password-role").value;


  if (newPassword.length < 5) {
    return showMessage("Password must be at least 5 characters.", "error");
  }

  if (newPassword !== confirmPassword) {
    return showMessage("Passwords do not match.", "error");
  }

  const confirmed = confirm(`Are you sure you want to change the password for role: ${role}?`);
  if (!confirmed) return;

  const res = await fetch(`${API}/maintenance/change-password`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ role, newPassword })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message, "success");
    document.getElementById("new-password").value = "";
    document.getElementById("confirm-password").value = "";
  } else {
    showMessage(data.error || "Failed to change password.", "error");
  }
};


document.getElementById("restart-server").onclick = async () => {
  if (confirm("Restart backend now?")) {
    await fetch(`${API}/maintenance/restart`, {
      method: "POST",
      headers: { Authorization: token }
    });
    showMessage("Restart command sent.");
  }
};


document.getElementById("load-logs").onclick = async () => {
  loadLogs();
}

async function loadLogs() {
  const res = await fetch(`${API}/maintenance/logs`, {
    headers: { Authorization: token }
  });
  const data = await res.json();
  if (res.ok) {

    const logBox = document.getElementById("server-logs");
    logBox.innerHTML = formatLogs(data.log);
    logBox.scrollTop = logBox.scrollHeight;

  } else {
    showMessage(data.error || "Failed to load logs", true);
  }
};




let logInterval = null;

document.getElementById("auto-refresh-logs").addEventListener("change", function () {
  if (this.checked) {
    loadLogs(); // load immediately
    logInterval = setInterval(loadLogs, 5000); // refresh every 5 seconds
  } else {
    clearInterval(logInterval);
    logInterval = null;
  }
});

document.getElementById("cleanup-orphans").onclick = async () => {
  // Step 1: Preview unused photos
  const preview = await fetch(`${API}/maintenance/orphan-photos`, {
    headers: { Authorization: token }
  });
  const data = await preview.json();

  if (!preview.ok) {
    return showMessage(data.error || "Could not check orphaned photos.", "error");
  }

  if (data.count === 0) {
    return showMessage("No unused photo files to clean up.", "info");
  }

       const modal = await DayPilot.Modal.confirm(`Found ${data.count} unused photo file(s). Do you want to delete them?`);
        if (modal.canceled) {
            return;
        } else { 

  // Step 2: Proceed with cleanup
  const cleanup = await fetch(`${API}/maintenance/cleanup-orphan-photos`, {
    method: "POST",
    headers: { Authorization: token }
  });
  const result = await cleanup.json();

  if (cleanup.ok) {
    showMessage(result.message, "success");
  } else {
    showMessage(result.error || "Cleanup failed.", "error");
  }
}
};


document.getElementById("generate-test-data").onclick = async () => {
  const count = parseInt(document.getElementById("test-count").value, 10);
  const auctionId = parseInt(document.getElementById("test-auction-select").value, 10);


  if (!count || count < 1) return showMessage("Enter a valid number of test items.", "error");
  if (!auctionId) return showMessage("Please select an auction.", "error");

  showMessage("Generating test data...");
  document.getElementById("generate-test-data").disabled = true;


  const res = await fetch(`${API}/maintenance/generate-test-data`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ count, auction_id: auctionId })
  });

  const data = await res.json();
  if (res.ok) {
    document.getElementById("generate-test-data").disabled = false;

    showMessage(data.message, "success");
    refreshAuctions();
  } else {
    showMessage(data.error || "Failed to generate test data", "error");
    document.getElementById("generate-test-data").disabled = false;

  }
};

document.getElementById("generate-bids-btn").onclick = async () => {
  const auctionId = parseInt(document.getElementById("test-auction-select").value, 10);
  const numBids = parseInt(document.getElementById("test-bid-count").value, 10);
  const numBidders = parseInt(document.getElementById("test-bidder-count").value, 10);

  if (!auctionId || isNaN(numBids) || isNaN(numBidders)) {
    showMessage("Please enter valid numbers and select an auction.", "error");
    return;
  }

  const res = await fetch(`${API}/maintenance/generate-bids`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ auction_id: auctionId, num_bids: numBids, num_bidders: numBidders })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message, "success");
    refreshAuctions();
  } else {
    showMessage(data.error || "Failed to generate bids", "error");
  }
};

document.getElementById("delete-test-bids").onclick = async () => {
  const auctionId = parseInt(document.getElementById("test-auction-select").value, 10);
  if (!auctionId) {
    showMessage("Please select an auction", "error");
    return;
  }

  const confirmed = confirm("Are you sure you want to delete all test bids for this auction?");
  if (!confirmed) return;

  const res = await fetch(`${API}/maintenance/delete-test-bids`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ auction_id: auctionId })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message, "success");
    refreshAuctions?.(); // or any function to refresh the view
  } else {
    showMessage(data.error || "Failed to delete test bids", "error");
  }
};



document.getElementById("logout").onclick = function logOut() {
  localStorage.removeItem("maintenanceToken");
  showMessage("Logged out", "info");
  window.location.reload(); // Or redirect to login: window.location.href = "/maint.html"
};

document.getElementById('save-config').addEventListener('click', async () => {
  const textarea = document.getElementById('config-json');
  const errorBox = document.getElementById('config-error');
  const configName = document.getElementById('config-select').value;
  errorBox.textContent = '';

  errorBox.textContent = '';
  let json;
  try {
    json = JSON.parse(textarea.value);
  } catch (e) {
    errorBox.textContent = 'Invalid JSON syntax!';
    return;
  }

  const response = await fetch(`${API}/maintenance/save-pptx-config/${configName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    },
    body: JSON.stringify(json)
  });

  const result = await response.json();
  if (response.ok) {
    showMessage(result.message, 'success');
   renderValidationErrors({ ok: true, message: result.message || 'Configuration updated successfully.' });
  } else {
    // errorBox.textContent = result.error || 'Unknown error';
    showMessage(result.error || 'Failed to save configuration', 'error');
    renderValidationErrors(result);
  }
});

// Function to show editor and load current config
function showConfigEditor() {
  const configName = document.getElementById('config-select').value;
  fetch(`${API}/maintenance/get-pptx-config/${configName}`, {
    headers: { 'Authorization': token }
  })
    .then(res => res.text())
    .then(text => {
      document.getElementById('config-json').value = text;
      document.getElementById('config-editor').style.display = 'block';
    })
    .catch(err => showMessage("Failed to load config", "error"));
}

async function refreshAuctions() {
  const baseUrl = window.location.origin;

  const res = await fetch(`${API}/maintenance/auctions/list`, {
    method: "POST",
    headers: { Authorization: token }
  });

  if (res.status === 403) {
    showMessage("Session expired or unauthorized. Logging out...", "error");
    setTimeout(() => {
      localStorage.removeItem("maintenanceToken");
      window.location.reload(); // or redirect to login
    }, 1500);
    return;
  }

  const auctions = await res.json();

try {
  isRendering = true; // Prevent the table listener firing while we render the table
 
  const tableBody = document.getElementById("auction-table-body");
  tableBody.innerHTML = "";

  auctions.forEach(auction => {
    const row = document.createElement("tr");
    // if (!auction.is_active) {
    //   row.classList.add("auction-inactive");
    // }
    const logoSrc = auction.logo ? `${API}/resources/${encodeURIComponent(auction.logo)}` : "/pptx-resources/default_logo.png";

    const statusOptions = ["setup", "locked", "live", "settlement", "archived"]; //  statuses
    const allowAdmin = !!auction.admin_can_change_state;

    // removed -->     <td style="text-align:center;"><input type="checkbox" ${auction.is_active ? "checked" : ""}></td>

    row.innerHTML = `
    <td>${auction.id}</td>
    <td><a href="${baseUrl}/?auction=${encodeURIComponent(auction.short_name)}" target="_blank">${auction.short_name}</a></td>
    <td>${auction.full_name}</td>
    <td style="text-align:center;"><img src="${logoSrc}" alt="Logo" style="height:40px; max-width:100px; object-fit:contain;"></td>
    <td>${auction.item_count}</td>
    <td> <select class="status-select" data-id="${auction.id}">
        ${statusOptions.map(opt =>
      `<option value="${opt}" ${auction.status === opt ? "selected" : ""}>${opt}</option>`
    ).join("")}
        </select>
    </td>

  <td>
    <label class="toggle">
      <input
        type="checkbox"
        class="js-admin-state-permission"
        data-id="${auction.id}" 
        ${allowAdmin ? "checked" : ""}
        aria-label="Allow admin to change state for this auction"
      >

    </label>
  </td>

     <td><button class="delete-auction-btn" 
     data-id="${auction.id}" ${auction.item_count > 0 ? 'disabled title="Cannot delete auction with items"' : ''}>Delete</button>
    </td>
    <td> <button class="reset-auction-btn" data-id="${auction.id}" ${(auction.status !== "archived" && auction.status !== "setup") ? 'disabled title="Only auctions in state setup or archived may be reset"' : ''}>Reset</button></td>
  `;

    

    // Hook up delete
    const deleteBtn = row.querySelector("button");
    deleteBtn.onclick = async () => {

      // Find out how many auctions are left

      const res1 = await fetch(`${API}/maintenance/auctions/list`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json"
        }
      });

      const auctions = await res1.json();
      if (!res1.ok || !Array.isArray(auctions)) {
        showMessage("Unable to fetch auction list", "error");
        return;
      }

      const isLast = auctions.length === 1;

      const confirmed = confirm(
        isLast
          ? `⚠️ WARNING: This is the last auction and deleting it will reset the database. Audit data and counters will NOT be reset. Proceed?`
          : `Are you sure you want to delete auction ${auction.full_name}?`
      );

      if (!confirmed) return;

      const res = await fetch(`${API}/maintenance/auctions/delete`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ auction_id: auction.id })
      });

      const result = await res.json();
      if (res.ok) {
        showMessage(result.message, "success");
        refreshAuctions();

      } else {
        showMessage(result.error || "Failed to delete", "error");
      }
    };



    tableBody.appendChild(row);
  });
} finally {
isRendering = false;
}

  // Attached event listener for auction status dropdowns
  document.getElementById("auction-table-body").addEventListener("change", async (e) => {

    if (isRendering) return; // Stop the listener while we render the table
    if (e.target.classList.contains("status-select")) {
      const auctionId = e.target.dataset.id;
      const newStatus = e.target.value.toLowerCase();

      const res = await fetch(`${API}/auctions/update-status`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ auction_id: auctionId, status: newStatus })
      });

      isRendering = true; // Stop dupliate triggers of the listener

      const data = await res.json();
      if (res.ok) {
        showMessage(data.message || `Status updated`, "success");
      } else {
        showMessage(data.error || "Failed to update status", "error");
      }
      isRendering = false;
    }
    else if (e.target.classList.contains("js-admin-state-permission")) {
      const auctionId = e.target.dataset.id;
      const newStatus = e.target.checked;
      e.target.disabled = true;
      try {
        const res = await fetch(`${API}/maintenance/auctions/set-admin-state-permission`, {
          method: 'POST',
          headers: {
            Authorization: token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ auction_id: auctionId, admin_can_change_state: newStatus })
        });
        isRendering = true;
        const data = await res.json();
        if (res.ok) {
          showMessage(data.message || `Status updated`, "success");
        } else {
          showMessage(data.error || "Failed to update control", "error");
          e.target.checked = !e.target.checked;
        }


      } catch (e) {
        e.target.checked = !e.target.checked;
        showMessage(`Error occurred:` + e || "Failed to update control", "error");

      } finally {
        e.target.disabled = false;
      }

isRendering = false;

    }


  });


  // populate the test data dropdown
  const testAuctionSelect = document.getElementById("test-auction-select");
  const previousValue = testAuctionSelect.value;

  testAuctionSelect.innerHTML = '<option value="">-- Select Auction --</option>';

  auctions.forEach(auction => {
    const option = document.createElement("option");
    option.value = auction.id;
    option.textContent = `${auction.full_name} (${auction.status})`;
    if (auction.status === "archive") { option.disabled = true };

    testAuctionSelect.appendChild(option);
  });
  testAuctionSelect.value = previousValue;

}

document.getElementById("create-auction").onclick = async () => {
  const short = document.getElementById("auction-short-name").value.trim();
  const full = document.getElementById("auction-full-name").value.trim();
  const selectedLogo = document.getElementById("auction-logo-select").value;


  if (!short || !full) {
    return showMessage("Please provide both short and full names", "error");
  }

  const res = await fetch(`${API}/maintenance/auctions/create`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ short_name: short, full_name: full, logo: selectedLogo })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message, "success");
    document.getElementById("auction-short-name").value = "";
    document.getElementById("auction-full-name").value = "";
    refreshAuctions();
  } else {
    showMessage(data.error || "Failed to create auction", "error");
  }
};

document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("reset-auction-btn")) {
    const auctionId = e.target.getAttribute("data-id");

    const confirmMsg = `Delete all items from auction ${auctionId}? Bidder and payment details will also be removed`;
 //   if (!confirm(confirmMsg)) return;

    // TODO change prompt to not show password in plain text
 //   const password = prompt(`Enter maintenance password to reset auction ${auctionId}:`);
 const password = await promptPassword(`Enter maintenance password to reset auction`, confirmMsg)
    if (!password) return;

    const res = await fetch(`${API}/maintenance/reset`, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ auction_id: auctionId, password })
    });

    const data = await res.json();
    if (res.ok) {

      showMessage(`Deleted auction ${auctionId}: ${data.deleted.items} items, ${data.deleted.bidders} bidders, ${data.deleted.payments} payments`, "success");
      refreshAuctions(); // or reload items
    } else {
      showMessage(data.error || "Reset failed", "error");
    }
  }

    function promptPassword(message, message2) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.5);
      display:flex; align-items:center; justify-content:center; z-index:9999;
    `;

    const box = document.createElement("div");
    box.style.cssText = `
      background:#fff; padding:16px; border-radius:8px; width:min(420px, 92vw);
      box-shadow:0 8px 24px rgba(0,0,0,.2); font-family:system-ui, sans-serif;
    `;

    const p = document.createElement("div");
    p.textContent = message;
    p.style.marginBottom = "10px";

    
      const p2 = document.createElement("div");
      p2.textContent = message2;
      p2.style.marginBottom = "10px";
      
    

    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "current-password";
    input.style.cssText = "width:100%; padding:8px; box-sizing:border-box;";

    const row = document.createElement("div");
    row.style.cssText = "display:flex; justify-content:flex-end; gap:8px; margin-top:12px;";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";

    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "OK";

    function close(val) {
      overlay.remove();
      resolve(val);
    }

    cancel.addEventListener("click", () => close(null));
    ok.addEventListener("click", () => close(input.value));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(input.value);
      if (e.key === "Escape") close(null);
    });

    row.append(cancel, ok);
    box.append(p2, p, input, row);
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
  });
}
});

let runCheck = document.getElementById("integrity-check");
runCheck.addEventListener("click", checkIntegrity);


async function checkIntegrity() {
  const res = await fetch(`${API}/maintenance/check-integrity`, {
    headers: { Authorization: token }
  });

  const data = await res.json();
  if (!res.ok) return showMessage(data.error || "Integrity check failed", "error");

  const listDiv = document.getElementById("integrity-results");
  const summary = document.getElementById("integrity-summary");
  const details = document.getElementById("invalid-items-list");

// TODO: Update this function to also process invalidBidders and invalidPayments

  if (data.invalidItems.length === 0) {
    summary.textContent = "No invalid items found.";
    details.textContent = "";
    listDiv.style.display = "block";
    return;
  }

  summary.textContent = `${data.invalidItems.length} invalid item(s) found.`;
  showMessage(`Integrity check found ${data.invalidItems.length} invalid item(s).`, "error");


  details.textContent = data.invalidItems.map(item =>
    `ID: ${item.id}\n  Auction: ${item.auction_id}\n  Description: ${item.description || "-"}\n  Contributor: ${item.contributor || "-"}\n  Photo: ${item.photo || "-"}\n  Item number: ${item.item_number || "-"}\n  Issues: ${item.issues.join(", ")}\n`
  ).join("\n\n");


  listDiv.style.display = "block";

  // Store IDs for deletion
  listDiv.dataset.ids = JSON.stringify(data.invalidItems.map(i => i.id));
};

// document.getElementById("delete-invalid-items").onclick = async () => {
//   const ids = JSON.parse(document.getElementById("integrity-results").dataset.ids || "[]");
//   if (ids.length === 0) return showMessage("Nothing to delete.", "info");

//   const confirmed = confirm(`Delete ${ids.length} invalid item(s)?`);
//   if (!confirmed) return;

//   const res = await fetch(`${API}/maintenance/check-integrity/delete`, {
//     method: "POST",
//     headers: {
//       Authorization: token,
//       "Content-Type": "application/json"
//     },
//     body: JSON.stringify({ ids })
//   });

//   const data = await res.json();
//   if (res.ok) {
//     showMessage(data.message, "success");
//     document.getElementById("integrity-check").click(); // refresh results
//   } else {
//     showMessage(data.error || "Failed to delete items", "error");
//   }
// };

const imgForm = document.getElementById("pptx-image-form");
const imgInput = document.getElementById("pptx-image-input");
const imgList = document.getElementById("pptx-image-list");
const imgStatus = document.getElementById("pptx-image-status");

// Upload handler
imgForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!imgInput.files.length) {
    showMessage("Please select one or more image files.", "error");
    return;
  }

  const formData = new FormData();
  for (const file of imgInput.files) {
    formData.append("images", file);
  }

  const res = await fetch(`${API}/maintenance/resources/upload`, {
    method: "POST",
    headers: { Authorization: token },
    body: formData
  });

  const data = await res.json();

  if (res.ok) {
    imgInput.value = "";
    loadPptxImageList();

    if (data.saved.length === 0) {
      if (data.rejected && data.rejected.length > 0) {
        showMessage(`No files uploaded. ${data.rejected.length} file(s) rejected: ${data.rejected.join(", ")}`, "error");
      } else {
        showMessage("No valid files uploaded.", "error");
      }
    } else {
      let message = `Uploaded ${data.saved.length} file(s).`;
      if (data.rejected && data.rejected.length > 0) {
        message += ` ${data.rejected.length} file(s) rejected: ${data.rejected.join(", ")}`;
      }
      showMessage(message, "success");
    }

  } else {
    showMessage(data.error || "Upload failed", "error");
  }



});

// Load file list
async function loadPptxImageList() {
  const res = await fetch(`${API}/maintenance/resources`, {
    headers: { Authorization: token }
  });

  const data = await res.json();
  const tableBody = document.getElementById("pptx-image-table-body");
  tableBody.innerHTML = "";

  if (!data.files || data.files.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="3">No image resources stored.</td></tr>`;
    return;
  }

  for (const file of data.files) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const link = document.createElement("a");
    link.href = `${API}/resources/${encodeURIComponent(file.name)}`;
    link.target = "_blank";
    link.textContent = file.name;
    nameTd.appendChild(link);
    const sizeTd = document.createElement("td");
    sizeTd.style.textAlign = "right";
    sizeTd.textContent = (file.size / 1024).toFixed(1) + " KB";

    const actionTd = document.createElement("td");
    actionTd.style.textAlign = "right";
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.onclick = async () => {
      const confirmed = confirm(`Delete image "${file.name}"?`);
      if (!confirmed) return;

      const res = await fetch(`${API}/maintenance/resources/delete`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ filename: file.name })
      });

      const result = await res.json();
      if (res.ok) {
        showMessage(result.message, "success");
        loadPptxImageList();
      } else {
        showMessage(result.error || "Failed to delete image", "error");
      }
    };
    actionTd.appendChild(delBtn);

    tr.appendChild(nameTd);
    tr.appendChild(sizeTd);
    tr.appendChild(actionTd);

    tableBody.appendChild(tr);
  }
  // also populate the create auction dropdown - saves an api call!

  const select = document.getElementById("auction-logo-select");
  select.innerHTML = "";

  // Always offer the default option first
  const defaultOption = document.createElement("option");
  defaultOption.value = "default_logo.png";
  defaultOption.textContent = "Default Logo";
  select.appendChild(defaultOption);

  if (data.files && data.files.length > 0) {
    for (const file of data.files) {
      const option = document.createElement("option");
      option.value = file.name;
      option.textContent = file.name;
      select.appendChild(option);
    }
  }


}

async function loadLogoOptions() {
  const res = await fetch(`${API}/maintenance/pptx-resources`, {
    headers: { Authorization: token }
  });

  const data = await res.json();
  const select = document.getElementById("auction-logo-select");
  select.innerHTML = "";

  // Always offer the default option first
  const defaultOption = document.createElement("option");
  defaultOption.value = "default_logo.png";
  defaultOption.textContent = "Default Logo (Recommended)";
  select.appendChild(defaultOption);

  if (data.files && data.files.length > 0) {
    for (const file of data.files) {
      const option = document.createElement("option");
      option.value = file.name;
      option.textContent = file.name;
      select.appendChild(option);
    }
  }
}


// Optionally auto-load on login
if (maintenanceSection.style.display === "block") {
  loadPptxImageList();
}

document.getElementById("reset-pptx-config").onclick = async () => {
  const selectedConfig = document.getElementById("config-select").value; // or whatever your dropdown ID is
  const configType = selectedConfig.replace(".json", ""); // removes '.json'

  const confirmed = confirm(`Reset ${selectedConfig} to default?`);
  if (!confirmed) return;

  const res = await fetch(`${API}/maintenance/pptx-config/reset`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ configType })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message, "success");
    showConfigEditor(); // reload the config editor
  } else {
    showMessage(data.error || "Failed to reset config", "error");
  }
};

document.getElementById("fetch-audit-log").onclick = async () => {

  const filterId = document.getElementById("audit-filter-id").value;
  const typeSelect = document.getElementById("audit-filter-type");
  const selectedType = typeSelect.options[typeSelect.selectedIndex].value; 
  const idQuery = filterId ? `?object_id=${filterId}` : "";
  const typeQuery = selectedType ? (idQuery ? `&object_type=${selectedType}` : `?object_type=${selectedType}`) : "";
  const finalQuery = idQuery + typeQuery;

  const res = await fetch(`${API}/audit-log${finalQuery}`, {
    headers: { Authorization: token }
  });

  const body = document.getElementById("audit-log-body");
  body.innerHTML = "";

  if (!res.ok) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" style="padding: 4px; color: red;">Failed to load audit log.</td>`;
    body.appendChild(row);
    return;
  }

  const data = await res.json();
  data.logs.forEach(log => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 4px;">${log.created_at}</td>
      <td style="padding: 4px;">${log.object_type}</td>
      <td style="padding: 4px;">${log.object_id}</td>
      <td style="padding: 4px;">${log.action}</td>
      <td style="padding: 4px;">${formatHistoryDetails(log.details)}</td>

      <td style="padding: 4px;">${log.user}</td>

      <td style="padding: 4px;">${log.short_name ?? ""}</td>
      <td style="padding: 4px;">${log.item_number ?? ""}</td>
    `;
    body.appendChild(row);
  });


  // data.logs.forEach(log => {
  //   const line = `[${log.timestamp}] ${log.action} (${log.user}) on item ${log.object_id} → ${log.description || "(no description)"}, auction ${log.auction_id}, item #${log.item_number}\n`;
  //   logBox.textContent += line;
  // });
}
async function loadEnabledPaymentMethods() {
  const tableBody = document.querySelector('#paymentMethodsTable tbody');

  tableBody.innerHTML = '';

  const res = await fetch(`${API}/settlement/payment-methods`, {
    headers: {
      Authorization: token,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to load payment methods (${res.status})`);
  }

  const methods = await res.json();
  const blocked = methods.blockedFlag;

if (methods.blockedFlag) { document.getElementById('pay-error').textContent = "Default cashier password detected - The default must be changed to allow SumUp payments." };


  Object.entries(methods.paymentMethods).forEach(([key, cfg]) => {
    const label = cfg?.label || key;
    const enabled = !!cfg?.enabled;
    const url  = cfg?.url || null;

    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    tdLabel.textContent = label;

    const tdStatus = document.createElement('td');
    tdStatus.textContent = enabled ? 'Enabled' : 'Disabled';
    tdStatus.className = enabled ? 'enabled' : 'disabled';

    
      const tdLink = document.createElement('td');
      tdLink.textContent = url ? '' : 'N/A';

      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.textContent = url;
        tdLink.appendChild(link);
      }

    tr.appendChild(tdLabel);
    tr.appendChild(tdStatus);
    tr.appendChild(tdLink);


    tableBody.appendChild(tr);
  });
}


function formatHistoryDetails(details) {
  if (!details) return "";

  return String(details)
    .replace(/^{|}$/g, "")       // remove surrounding { and }
    .replace(/"/g, "")           // remove quotes
    .replace(/,/g, ", ")         // add space after commas
    .replace(/:/g, ": ");        // add space after colons
}

document.getElementById("export-audit-log").onclick = async () => {
  const res = await fetch(`${API}/maintenance/audit-log/export`, {
    headers: { Authorization: token }
  });

  if (!res.ok) {
    showMessage("Failed to download audit log", "error");
    return;
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "audit_log.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};



function startAutoRefresh() {
  setInterval(() => {
    if (document.visibilityState === "visible") {
      refreshAuctions();
      loadPptxImageList();

    } else {
    }
  }, 30000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshAuctions();
    loadPptxImageList();

  }
});

//})

(function () {
  const errorBox  = document.getElementById('errorBox');
  const errorList = document.getElementById('errorList');

  function preview(val, max = 160) {
    if (val == null) return '';
    const s = String(val).replace(/\s+/g, ' ');
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  // Pass the parsed JSON result from your POST to /save-pptx-config/:name
  window.renderValidationErrors = function renderValidationErrors(result) {
    // Reset UI
    errorBox.textContent = '';
    errorList.innerHTML = '';
    errorList.hidden = true;

    if (!result) {
      errorBox.textContent = 'Unknown error';
      return;
    }

    // Success path (optional)
    if (result.ok || result.message) {
      errorBox.textContent = result.message || 'OK';
      errorBox.classList.remove('is-error');

    errorBox.textContent = '';
    errorList.innerHTML = '';
    errorList.hidden = true;

      return;
    }

    // Error summary
    
    const summary = result.error || 'Error';
    const details = Array.isArray(result.details) ? result.details : [];

    if (!details.length) {
      // Fall back to whatever the server sent
      errorBox.textContent = summary || 'Unknown error';
      errorList.hidden = true;
      return;
    }

    // Show summary with count
    errorBox.textContent = `${summary} (${details.length})`;
    errorBox.classList.add('is-error');

    // Build list items: { jsonPath, value, error }
    for (const e of details) {
      const li = document.createElement('li');

      const pathSpan = document.createElement('span');
      pathSpan.className = 'error-path';
      pathSpan.textContent = e?.jsonPath || '(unknown path)';

      const reasonSpan = document.createElement('span');
      reasonSpan.className = 'error-reason';
      reasonSpan.textContent = ` – ${e?.error || 'Invalid value'}`;

      const valueSpan = document.createElement('span');
      valueSpan.className = 'error-value';
      const value = typeof e?.value === 'string' ? e.value : JSON.stringify(e?.value);
      valueSpan.textContent = value ? `  [${preview(value)}]` : '';

      li.appendChild(pathSpan);
      li.appendChild(reasonSpan);
      li.appendChild(valueSpan);
      errorList.appendChild(li);
    }

    errorList.hidden = false;
  };



})();
