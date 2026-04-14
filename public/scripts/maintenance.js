const API = "/api";
const MAINTENANCE_TAB_KEY = "maintenanceSelectedTab";

const output = document.getElementById("output");
const loginSection = document.getElementById("login-section");
const maintenanceSection = document.getElementById("maintenance-section");
const softwareVersion = document.getElementById("software-version");
const maintenanceUserMenuButton = document.getElementById("maintenance-user-menu-button");
const maintenanceLoggedInUser = document.getElementById("maintenance-logged-in-user");
const maintenanceLoggedInRole = document.getElementById("maintenance-logged-in-role");
const maintenancePanelPill = document.getElementById("maintenance-panel-pill");
const menuGroups = Array.from(document.querySelectorAll(".menu-group"));
const tabButtons = Array.from(document.querySelectorAll(".maintenance-tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".maintenance-tab-panel"));
const userManagementTabButton = tabButtons.find((button) => button.dataset.tab === "user-management") || null;
const userManagementPanel = document.querySelector('[data-tab-panel="user-management"]');
const openAboutModalButton = document.getElementById("open-about-modal");
const aboutModal = document.getElementById("about-modal");
const closeAboutModalButton = document.getElementById("close-about-modal");
const aboutVersionBackendEl = document.getElementById("about-version-backend");
const aboutVersionSchemaEl = document.getElementById("about-version-schema");
const aboutVersionPaymentEl = document.getElementById("about-version-payment");
const editAuctionModal = document.getElementById("edit-auction-modal");
const closeEditAuctionModalButton = document.getElementById("close-edit-auction-modal");
const cancelEditAuctionButton = document.getElementById("cancel-edit-auction");
const saveEditAuctionButton = document.getElementById("save-edit-auction");
const editAuctionIdInput = document.getElementById("edit-auction-id");
const editAuctionShortNameInput = document.getElementById("edit-auction-short-name");
const editAuctionFullNameInput = document.getElementById("edit-auction-full-name");
const editAuctionLogoSelect = document.getElementById("edit-auction-logo-select");
const editAuctionAdminStatePermissionInput = document.getElementById("edit-auction-admin-state-permission");
const editAuctionDeleteButton = document.getElementById("edit-auction-delete");
const editAuctionResetButton = document.getElementById("edit-auction-reset");
const popoutLogsButton = document.getElementById("popout-logs");
const autoRefreshLogsCheckbox = document.getElementById("auto-refresh-logs");
const integrityCheckButton = document.getElementById("integrity-check");
const integrityFixButton = document.getElementById("integrity-fix");
const integrityResults = document.getElementById("integrity-results");
const integritySummaryPanel = document.getElementById("integrity-summary-panel");
const integrityFixSummary = document.getElementById("integrity-fix-summary");
const integrityDetailsPanel = document.getElementById("integrity-details-panel");

var isRendering = false;
let currentUsername = null;
let currentMaintenanceUser = null;
let currentVersions = {};
let latestServerLog = "";
let logPopupWindow = null;
let lastIntegrityResult = null;

function getAuthToken() {
  return window.AppAuth?.getToken?.() || localStorage.getItem("maintenanceToken") || "";
}

let token = getAuthToken();

function canManageUsers(user = currentMaintenanceUser) {
  if (window.AppAuth?.canAccess) {
    return window.AppAuth.canAccess(user, { permission: "manage_users" });
  }
  return Array.isArray(user?.permissions) && user.permissions.includes("manage_users");
}

function clearUserManagementData() {
  const tableBody = document.getElementById("user-table-body");
  if (tableBody) {
    tableBody.innerHTML = "";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyUserManagementAccess(user = currentMaintenanceUser) {
  const allowed = canManageUsers(user);
  if (userManagementTabButton) {
    userManagementTabButton.hidden = !allowed;
    userManagementTabButton.disabled = !allowed;
  }

  if (!allowed) {
    clearUserManagementData();
    if (localStorage.getItem(MAINTENANCE_TAB_KEY) === "user-management") {
      localStorage.setItem(MAINTENANCE_TAB_KEY, "auction-management");
    }
    const activePanel = tabPanels.find((panel) => !panel.hidden);
    if (activePanel?.dataset.tabPanel === "user-management") {
      setActiveTab("auction-management");
    }
    if (userManagementPanel) {
      userManagementPanel.hidden = true;
    }
  }
}

function closeMenuGroups(exception = null) {
  menuGroups.forEach((menu) => {
    if (menu !== exception) {
      menu.open = false;
    }
  });
}

function setActiveTab(tabId, { persist = true } = {}) {
  const availableButtons = tabButtons.filter((button) => !button.hidden && !button.disabled);
  const targetButton = tabButtons.find((button) => button.dataset.tab === tabId && !button.hidden && !button.disabled)
    || availableButtons[0]
    || tabButtons[0];
  const resolvedTabId = targetButton?.dataset.tab;

  if (!resolvedTabId) return;

  tabButtons.forEach((button) => {
    const isActive = button === targetButton;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });

  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== resolvedTabId;
  });

  if (maintenancePanelPill) {
    maintenancePanelPill.textContent = `View: ${targetButton.dataset.tabLabel || targetButton.textContent.trim()}`;
  }

  if (persist) {
    localStorage.setItem(MAINTENANCE_TAB_KEY, resolvedTabId);
  }
}

function updateVersionDisplays(versions = {}) {
  currentVersions = versions || {};
  const backend = currentVersions.backend || "N/A";
  const schema = currentVersions.schema || "N/A";
  const payment = currentVersions.payment_processor || "N/A";

  if (softwareVersion) {
    softwareVersion.textContent = `Backend: ${backend}, Schema: ${schema}, Payment: ${payment}`;
  }

  if (aboutVersionBackendEl) aboutVersionBackendEl.textContent = backend;
  if (aboutVersionSchemaEl) aboutVersionSchemaEl.textContent = schema;
  if (aboutVersionPaymentEl) aboutVersionPaymentEl.textContent = payment;
}

function openAboutModal() {
  if (aboutModal) {
    aboutModal.hidden = false;
  }
}

function closeAboutModal() {
  if (aboutModal) {
    aboutModal.hidden = true;
  }
}

function openEditAuctionModal(auction) {
  if (!editAuctionModal || !auction) return;

  editAuctionIdInput.value = auction.id;
  editAuctionShortNameInput.value = auction.short_name || "";
  editAuctionFullNameInput.value = auction.full_name || "";
  editAuctionLogoSelect.value = auction.logo || "default_logo.png";
  editAuctionAdminStatePermissionInput.checked = !!auction.admin_can_change_state;
  editAuctionDeleteButton.disabled = Number(auction.item_count) > 0;
  editAuctionDeleteButton.title = Number(auction.item_count) > 0 ? "Cannot delete auction with items" : "";
  const canReset = auction.status === "archived" || auction.status === "setup";
  editAuctionResetButton.disabled = !canReset;
  editAuctionResetButton.title = canReset ? "" : "Only auctions in state setup or archived may be reset";
  editAuctionModal.dataset.auctionStatus = auction.status || "";
  editAuctionModal.dataset.auctionItemCount = String(auction.item_count ?? 0);
  editAuctionModal.dataset.auctionFullName = auction.full_name || "";
  editAuctionModal.hidden = false;
  editAuctionFullNameInput.focus();

}

function closeEditAuctionModal() {
  if (!editAuctionModal) return;
  editAuctionModal.hidden = true;
}

async function deleteAuctionById(auctionId, auctionFullName = "") {
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
    return false;
  }

  const isLast = auctions.length === 1;
  const confirmed = await DayPilot.Modal.confirm(
    isLast
      ? `⚠️ WARNING: This is the last auction and deleting it will reset the database. Audit data and counters will NOT be reset. Proceed?`
      : `Are you sure you want to delete auction ${auctionFullName || auctionId}?`
  );

  if (confirmed.canceled) return false;

  const res = await fetch(`${API}/maintenance/auctions/delete`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ auction_id: auctionId })
  });

  const result = await res.json();
  if (!res.ok) {
    showMessage(result.error || "Failed to delete", "error");
    return false;
  }

  showMessage(result.message, "success");
  return true;
}

async function resetAuctionById(auctionId) {
  const confirmMsg = `Delete all items from auction ${auctionId}? Bidder and payment details will also be removed`;
  const password = await promptPassword(`Enter maintenance password to reset auction`, confirmMsg);
  if (!password) return false;

  const res = await fetch(`${API}/maintenance/reset`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ auction_id: auctionId, password })
  });

  const data = await res.json();
  if (!res.ok) {
    showMessage(data.error || "Reset failed", "error");
    return false;
  }

  showMessage(`Reset auction ${auctionId}: Removed ${data.deleted.items} items, ${data.deleted.bidders} bidders, ${data.deleted.payments} payments`, "success");
  return true;
}

async function updateAuctionAdminStatePermission(auctionId, enabled) {
  const res = await fetch(`${API}/maintenance/auctions/set-admin-state-permission`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ auction_id: auctionId, admin_can_change_state: enabled })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to update control");
  }

  return data;
}

function setMaintenanceUserMenu(username) {
  const safeName = username || "maintenance";
  if (maintenanceLoggedInUser) maintenanceLoggedInUser.textContent = safeName;
  if (maintenanceUserMenuButton) maintenanceUserMenuButton.textContent = safeName;
  if (maintenanceLoggedInRole) {
    maintenanceLoggedInRole.textContent = window.AppAuth?.describeAccess
      ? window.AppAuth.describeAccess(currentMaintenanceUser || { roles: ["maintenance"], permissions: [] })
      : "Manage Auctions";
  }
}

function bindMaintenanceShell() {
  const storedTab = localStorage.getItem(MAINTENANCE_TAB_KEY) || "auction-management";
  setActiveTab(storedTab, { persist: false });

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab);
    });
  });

  menuGroups.forEach((menu) => {
    menu.addEventListener("toggle", () => {
      if (menu.open) {
        closeMenuGroups(menu);
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-group")) {
      closeMenuGroups();
    }
  });

  document.querySelectorAll(".menu-item-link, .menu-item-button").forEach((element) => {
    element.addEventListener("click", () => {
      if (!element.disabled) {
        closeMenuGroups();
      }
    });
  });

  openAboutModalButton?.addEventListener("click", openAboutModal);
  closeAboutModalButton?.addEventListener("click", closeAboutModal);
  aboutModal?.addEventListener("click", (event) => {
    if (event.target === aboutModal) {
      closeAboutModal();
    }
  });

  closeEditAuctionModalButton?.addEventListener("click", closeEditAuctionModal);
  cancelEditAuctionButton?.addEventListener("click", closeEditAuctionModal);
  editAuctionModal?.addEventListener("click", (event) => {
    if (event.target === editAuctionModal) {
      closeEditAuctionModal();
    }
  });
}

bindMaintenanceShell();
updateVersionDisplays();
checkToken();

window.addEventListener("beforeunload", () => {
  if (logPopupWindow && !logPopupWindow.closed) {
    logPopupWindow.close();
  }
});

function promptPassword(message, message2 = "") {
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

function promptPasswordChange() {
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

    const heading = document.createElement("div");
    heading.textContent = "Change password";
    heading.style.cssText = "font-weight:600; margin-bottom:10px;";

    const currentInput = document.createElement("input");
    currentInput.type = "password";
    currentInput.placeholder = "Current password";
    currentInput.autocomplete = "current-password";
    currentInput.style.cssText = "width:100%; padding:8px; margin-bottom:8px; box-sizing:border-box;";

    const newInput = document.createElement("input");
    newInput.type = "password";
    newInput.placeholder = "New password";
    newInput.autocomplete = "new-password";
    newInput.style.cssText = "width:100%; padding:8px; margin-bottom:8px; box-sizing:border-box;";

    const confirmInput = document.createElement("input");
    confirmInput.type = "password";
    confirmInput.placeholder = "Confirm new password";
    confirmInput.autocomplete = "new-password";
    confirmInput.style.cssText = "width:100%; padding:8px; box-sizing:border-box;";

    const row = document.createElement("div");
    row.style.cssText = "display:flex; justify-content:flex-end; gap:8px; margin-top:12px;";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";

    const submit = document.createElement("button");
    submit.type = "button";
    submit.textContent = "Update";

    function close(result) {
      overlay.remove();
      resolve(result);
    }

    function submitForm() {
      close({
        currentPassword: currentInput.value,
        newPassword: newInput.value,
        confirmPassword: confirmInput.value
      });
    }

    cancel.addEventListener("click", () => close(null));
    submit.addEventListener("click", submitForm);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });

    [currentInput, newInput, confirmInput].forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitForm();
        if (e.key === "Escape") close(null);
      });
    });

    row.append(cancel, submit);
    box.append(heading, currentInput, newInput, confirmInput, row);
    overlay.append(box);
    document.body.append(overlay);
    currentInput.focus();
  });
}

// Check if maint is already authenticated
async function checkToken() {
  token = getAuthToken();
  const session = window.__APP_AUTH_READY__ ? await window.__APP_AUTH_READY__ : await window.AppAuth?.refreshSession?.();
  if (session?.user) {
    currentUsername = session.user.username || null;
    currentMaintenanceUser = session.user;
    setMaintenanceUserMenu(currentUsername);
    applyUserManagementAccess(session.user);
    loginSection.style.display = "none";
    maintenanceSection.style.display = "grid";
    refreshAuctions();
    checkIntegritySummary();
    loadPptxImageList();
    if (canManageUsers(session.user)) {
      loadUsers();
    }
    startAutoRefresh();
    loadEnabledPaymentMethods();
    updateVersionDisplays(session.versions);
  } else {
    logOut();
  }
}


document.getElementById("login-button").addEventListener("click", async () => {
  window.location.replace("/login.html");
});

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

const USER_ROLE_ORDER = ["admin", "cashier", "maintenance", "slideshow"];
const USER_PERMISSION_ORDER = ["live_feed", "admin_bidding", "manage_users"];
const ACCESS_DEPENDENCIES = [
  { permission: "admin_bidding", role: "admin" },
  { permission: "manage_users", role: "maintenance" }
];
const USER_ACTION_ICONS = Object.freeze({
  save: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"></path>
      <path d="M17 21v-8H7v8"></path>
      <path d="M7 3v5h8"></path>
    </svg>
  `,
  key: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="8" cy="15" r="4"></circle>
      <path d="M12 15h9"></path>
      <path d="M18 12v6"></path>
      <path d="M21 13v4"></path>
    </svg>
  `,
  logout: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
      <path d="M16 17l5-5-5-5"></path>
      <path d="M21 12H9"></path>
    </svg>
  `,
  trash: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6h18"></path>
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
    </svg>
  `
});

function createUserActionButton(icon, title, { disabled = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "item-action-button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = `<span class="item-action-icon" aria-hidden="true">${icon}</span>`;
  button.disabled = disabled;
  return button;
}

function syncDependentAccessCheckboxes(scope = document) {
  ACCESS_DEPENDENCIES.forEach(({ permission, role }) => {
    scope.querySelectorAll(`input[value="${permission}"]`).forEach((permissionInput) => {
      const isNewUserRow = permissionInput.name === "new-user-permission";
      const roleInput = isNewUserRow
        ? scope.querySelector(`input[name="new-user-role"][value="${role}"]`)
        : scope.querySelector(`input[data-access-role="${role}"]`);

      const allowed = Boolean(roleInput?.checked);
      permissionInput.disabled = !allowed;
      if (!allowed) {
        permissionInput.checked = false;
      }
    });
  });
}

document.getElementById("change-own-password").onclick = async () => {
  const passwordInput = await promptPasswordChange();
  if (!passwordInput) return;
  const { currentPassword, newPassword, confirmPassword } = passwordInput;
  if (!currentPassword || !newPassword || !confirmPassword) {
    return showMessage("All password fields are required.", "error");
  }

  if (newPassword !== confirmPassword) {
    return showMessage("Passwords do not match.", "error");
  }

  const res = await fetch(`${API}/change-password`, {
    method: "POST",
    headers: {
      Authorization: getAuthToken(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ currentPassword, newPassword })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message || "Password updated.", "success");
  } else {
    showMessage(data.error || "Failed to change password.", "error");
  }
};

document.getElementById("add-user-button").onclick = async () => {
  const username = document.getElementById("new-user-username").value.trim();
  const password = document.getElementById("new-user-password").value;
  const confirmPassword = document.getElementById("new-user-confirm-password").value;
  const roles = Array.from(document.querySelectorAll('input[name="new-user-role"]:checked')).map((el) => el.value);
  const permissions = Array.from(document.querySelectorAll('input[name="new-user-permission"]:checked')).map((el) => el.value);

  if (!username || !password) {
    return showMessage("Username and password are required.", "error");
  }

  if (password !== confirmPassword) {
    return showMessage("Passwords do not match.", "error");
  }

  if (roles.length === 0 && permissions.length === 0) {
    return showMessage("Select at least one access option.", "error");
  }

  const res = await fetch(`${API}/maintenance/users`, {
    method: "POST",
    headers: {
      Authorization: getAuthToken(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password, roles, permissions })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message || "User created.", "success");
    document.getElementById("new-user-username").value = "";
    document.getElementById("new-user-password").value = "";
    document.getElementById("new-user-confirm-password").value = "";
    document.querySelectorAll('input[name="new-user-role"]').forEach((el) => { el.checked = false; });
    document.querySelectorAll('input[name="new-user-permission"]').forEach((el) => { el.checked = false; });
    syncDependentAccessCheckboxes(document);
    loadUsers();
  } else {
    showMessage(data.error || "Failed to create user.", "error");
  }
};

async function loadUsers() {
  const tableBody = document.getElementById("user-table-body");
  if (!tableBody || !canManageUsers()) {
    clearUserManagementData();
    return;
  }

  const authToken = getAuthToken();
  if (!authToken) return;

  const res = await fetch(`${API}/maintenance/users`, {
    headers: { Authorization: authToken }
  });
  const data = await res.json();

  if (!res.ok) {
    if (res.status === 403) {
      if (data?.reason === "remote_logout") {
        window.AppAuth?.clearAllSessions?.({ broadcast: true });
        window.location.replace("/login.html?reason=remote_logout");
        return;
      }
      applyUserManagementAccess(null);
      return;
    }
    showMessage(data.error || "Failed to load users.", "error");
    return;
  }

  currentUsername = data.current_user || currentUsername;
  const users = Array.isArray(data.users) ? data.users : [];

  tableBody.innerHTML = "";
  if (users.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.textContent = "No users found.";
    tr.appendChild(td);
    tableBody.appendChild(tr);
    return;
  }

  users.forEach((user) => {
    const tr = document.createElement("tr");
    const roleCheckboxes = {};
    const permissionCheckboxes = {};

    const usernameTd = document.createElement("td");
    usernameTd.textContent = user.username === currentUsername ? `${user.username} (you)` : user.username;
    tr.appendChild(usernameTd);

    USER_ROLE_ORDER.forEach((role) => {
      const td = document.createElement("td");
      td.style.textAlign = "center";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Array.isArray(user.roles) && user.roles.includes(role);
      cb.disabled = Boolean(user.is_root);
      roleCheckboxes[role] = cb;
      td.appendChild(cb);
      tr.appendChild(td);
    });

    USER_PERMISSION_ORDER.forEach((permission) => {
      const td = document.createElement("td");
      td.style.textAlign = "center";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Array.isArray(user.permissions) && user.permissions.includes(permission);
      cb.disabled = Boolean(user.is_root);
      cb.dataset.accessPermission = permission;
      permissionCheckboxes[permission] = cb;
      td.appendChild(cb);
      tr.appendChild(td);
    });

    roleCheckboxes.admin.dataset.accessRole = "admin";
    roleCheckboxes.maintenance.dataset.accessRole = "maintenance";
    roleCheckboxes.admin.addEventListener("change", () => syncDependentAccessCheckboxes(tr));
    roleCheckboxes.maintenance.addEventListener("change", () => syncDependentAccessCheckboxes(tr));
    syncDependentAccessCheckboxes(tr);

    const actionsTd = document.createElement("td");
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "maintenance-user-actions";

    const logoutNowBtn = createUserActionButton(USER_ACTION_ICONS.logout, "Log out user from all current sessions");
    logoutNowBtn.onclick = async () => {
      const confirmed = confirm(`Log out "${user.username}" from all current sessions?`);
      if (!confirmed) return;
      const logoutRes = await fetch(`${API}/maintenance/users/${encodeURIComponent(user.username)}/logout-now`, {
        method: "POST",
        headers: { Authorization: getAuthToken() }
      });
      const logoutData = await logoutRes.json();
      if (logoutRes.ok) {
        showMessage(logoutData.message || "User logged out from all sessions.", "success");
        if (user.username === currentUsername) {
          window.AppAuth?.clearAllSessions?.({ broadcast: true });
          window.location.replace("/login.html?reason=remote_logout");
          return;
        }
        loadUsers();
      } else {
        showMessage(logoutData.error || "Failed to log out user.", "error");
      }
    };

    if (!user.is_root) {
      const saveRolesBtn = createUserActionButton(USER_ACTION_ICONS.save, "Save access changes");
      saveRolesBtn.onclick = async () => {
        const roles = USER_ROLE_ORDER.filter((role) => roleCheckboxes[role].checked);
        const permissions = USER_PERMISSION_ORDER.filter((permission) => permissionCheckboxes[permission].checked);
        if (roles.length === 0 && permissions.length === 0) {
          showMessage("A user must have at least one access option.", "error");
          return;
        }
        const updateRes = await fetch(`${API}/maintenance/users/${encodeURIComponent(user.username)}/access`, {
          method: "PATCH",
          headers: {
            Authorization: getAuthToken(),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ roles, permissions })
        });
        const updateData = await updateRes.json();
        if (updateRes.ok) {
          showMessage(updateData.message || "Access updated.", "success");
          loadUsers();
        } else {
          showMessage(updateData.error || "Failed to update access.", "error");
        }
      };

      const setPasswordBtn = createUserActionButton(USER_ACTION_ICONS.key, "Set password");
      setPasswordBtn.onclick = async () => {
        const newPassword = await promptPassword(`Enter new password for "${user.username}"`);
        if (!newPassword) return;
        const confirmPassword = await promptPassword(`Confirm new password for "${user.username}"`);
        if (!confirmPassword) return;
        if (newPassword !== confirmPassword) {
          showMessage("Passwords do not match.", "error");
          return;
        }
        const pwRes = await fetch(`${API}/maintenance/users/${encodeURIComponent(user.username)}/password`, {
          method: "POST",
          headers: {
            Authorization: getAuthToken(),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ newPassword })
        });
        const pwData = await pwRes.json();
        if (pwRes.ok) {
          showMessage(pwData.message || "Password updated.", "success");
        } else {
          showMessage(pwData.error || "Failed to set password.", "error");
        }
      };

      const deleteBtn = createUserActionButton(USER_ACTION_ICONS.trash, "Delete user", {
        disabled: user.username === currentUsername
      });
      deleteBtn.onclick = async () => {
        const confirmed = confirm(`Delete user "${user.username}"?`);
        if (!confirmed) return;
        const delRes = await fetch(`${API}/maintenance/users/${encodeURIComponent(user.username)}`, {
          method: "DELETE",
          headers: { Authorization: getAuthToken() }
        });
        const delData = await delRes.json();
        if (delRes.ok) {
          showMessage(delData.message || "User deleted.", "success");
          loadUsers();
        } else {
          showMessage(delData.error || "Failed to delete user.", "error");
        }
      };

      actionsWrap.appendChild(saveRolesBtn);
      actionsWrap.appendChild(setPasswordBtn);
      actionsWrap.appendChild(logoutNowBtn);
      actionsWrap.appendChild(deleteBtn);
    } else {
      actionsWrap.appendChild(logoutNowBtn);
    }
    actionsTd.appendChild(actionsWrap);
    tr.appendChild(actionsTd);

    tableBody.appendChild(tr);
  });
}

document.querySelector('input[name="new-user-role"][value="admin"]')?.addEventListener("change", () => {
  syncDependentAccessCheckboxes(document);
});
document.querySelector('input[name="new-user-role"][value="maintenance"]')?.addEventListener("change", () => {
  syncDependentAccessCheckboxes(document);
});
syncDependentAccessCheckboxes(document);

window.addEventListener(window.AppAuth?.SESSION_EVENT || "appauth:session", (event) => {
  const session = event.detail || null;
  token = session?.token || getAuthToken();
  currentMaintenanceUser = session?.user || null;
  currentUsername = session?.user?.username || currentUsername;
  setMaintenanceUserMenu(currentUsername);
  applyUserManagementAccess(currentMaintenanceUser);
  updateVersionDisplays(session?.versions || currentVersions);
  if (canManageUsers(currentMaintenanceUser)) {
    void loadUsers();
  }
});


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
};

function syncLogPopupControls() {
  if (!logPopupWindow || logPopupWindow.closed) return;

  const popupCheckbox = logPopupWindow.document.getElementById("popup-auto-refresh");
  if (popupCheckbox && autoRefreshLogsCheckbox) {
    popupCheckbox.checked = autoRefreshLogsCheckbox.checked;
  }
}

function syncLogPopup() {
  if (!logPopupWindow || logPopupWindow.closed) return;

  const popupLogBox = logPopupWindow.document.getElementById("popup-server-logs");
  if (!popupLogBox) return;

  popupLogBox.innerHTML = latestServerLog ? formatLogs(latestServerLog) : '<span class="maintenance-log-empty">No log output loaded yet.</span>';
  popupLogBox.scrollTop = popupLogBox.scrollHeight;
  syncLogPopupControls();
}

function openLogPopup() {
  if (logPopupWindow && !logPopupWindow.closed) {
    logPopupWindow.focus();
    syncLogPopup();
    return;
  }

  logPopupWindow = window.open("", "maintenanceServerLogs", "popup,width=960,height=680,resizable=yes,scrollbars=yes");

  if (!logPopupWindow) {
    showMessage("Browser blocked the log viewer pop-out window.", "error");
    return;
  }

  const popupDoc = logPopupWindow.document;
  popupDoc.open();
  popupDoc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Server Logs - Convention Auction</title>
  <style>
    body {
      margin: 0;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      background: #f5f7fb;
      color: #1b2430;
    }
    .popup-shell {
      display: grid;
      gap: 12px;
      padding: 12px;
    }
    .popup-card {
      background: rgba(255, 255, 255, 0.96);
      border: 1px solid #d8dee6;
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(10, 30, 60, 0.08);
      overflow: hidden;
    }
    .popup-head {
      align-items: flex-start;
      background: #fbfcfe;
      border-bottom: 1px solid #d8dee6;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 12px 14px;
    }
    .popup-head h1 {
      margin: 0;
      font-size: 1.05rem;
    }
    .popup-subtle {
      color: #5f6b7a;
      margin-top: 4px;
    }
    .popup-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
    }
    .popup-actions button {
      background: #0f62fe;
      border: 1px solid #0f62fe;
      border-radius: 10px;
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      min-height: 38px;
      padding: 0 12px;
    }
    .popup-actions label {
      align-items: center;
      color: #1b2430;
      display: inline-flex;
      gap: 8px;
      font-weight: 600;
    }
    .popup-actions input {
      margin: 0;
    }
    #popup-server-logs {
      background: #0f1720;
      border: 1px solid #1e293b;
      border-radius: 12px;
      box-sizing: border-box;
      color: #dbe7f5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      height: calc(100vh - 124px);
      margin: 12px;
      overflow: auto;
      padding: 12px;
      white-space: pre-wrap;
    }
    .maintenance-log-empty {
      color: #8ea0b8;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="popup-shell">
    <section class="popup-card">
      <div class="popup-head">
        <div>
          <h1>Server Logs</h1>
          <div class="popup-subtle">Monitoring window linked to the maintenance panel.</div>
        </div>
        <div class="popup-actions">
          <label><input id="popup-auto-refresh" type="checkbox"> Auto-refresh</label>
          <button id="popup-refresh-logs" type="button">Refresh</button>
          <button id="popup-close-window" type="button">Close</button>
        </div>
      </div>
      <div id="popup-server-logs"><span class="maintenance-log-empty">Loading logs...</span></div>
    </section>
  </div>
</body>
</html>`);
  popupDoc.close();

  popupDoc.getElementById("popup-refresh-logs")?.addEventListener("click", () => {
    loadLogs();
  });

  popupDoc.getElementById("popup-close-window")?.addEventListener("click", () => {
    logPopupWindow?.close();
  });

  popupDoc.getElementById("popup-auto-refresh")?.addEventListener("change", (event) => {
    if (!autoRefreshLogsCheckbox) return;
    autoRefreshLogsCheckbox.checked = event.target.checked;
    autoRefreshLogsCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
  });

  syncLogPopup();
  logPopupWindow.focus();
}

async function loadLogs() {
  const res = await fetch(`${API}/maintenance/logs`, {
    headers: { Authorization: token }
  });
  const data = await res.json();
  if (res.ok) {
    const logBox = document.getElementById("server-logs");
    latestServerLog = data.log || "";
    logBox.innerHTML = latestServerLog ? formatLogs(latestServerLog) : '<span class="maintenance-log-empty">No log output loaded yet.</span>';
    logBox.scrollTop = logBox.scrollHeight;
    syncLogPopup();
  } else {
    showMessage(data.error || "Failed to load logs", "error");
  }
}




let logInterval = null;

document.getElementById("auto-refresh-logs").addEventListener("change", function () {
  if (logInterval) {
    clearInterval(logInterval);
    logInterval = null;
  }

  if (this.checked) {
    loadLogs();
    logInterval = setInterval(loadLogs, 5000);
  }
  syncLogPopupControls();
});

popoutLogsButton?.addEventListener("click", () => {
  setActiveTab("server-logs");
  openLogPopup();
  if (!latestServerLog) {
    loadLogs();
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



function logOut() {
  if (logInterval) {
    clearInterval(logInterval);
    logInterval = null;
  }
  if (logPopupWindow && !logPopupWindow.closed) {
    logPopupWindow.close();
  }
  window.AppAuth?.clearAllSessions?.({ broadcast: true });
  token = "";
  currentUsername = null;
  showMessage("Logged out", "info");
  window.location.replace("/login.html?reason=signed_out");
}

document.getElementById("logout").onclick = logOut;

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
      window.AppAuth?.clearSharedSession?.({ broadcast: false });
      window.location.replace("/login.html");
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
    <td>${allowAdmin ? "Yes" : "No"}</td>
    <td><button class="edit-auction-btn" data-id="${auction.id}">Edit</button></td>
  `;

    const editBtn = row.querySelector(".edit-auction-btn");
    editBtn.onclick = () => {
      openEditAuctionModal(auction);
    };

    tableBody.appendChild(row);
  });
} finally {
isRendering = false;
}

  // Attached event handler for auction status dropdowns
  document.getElementById("auction-table-body").onchange = async (e) => {

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
  };


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

saveEditAuctionButton?.addEventListener("click", async () => {
  const auctionId = Number(editAuctionIdInput.value);
  const shortName = editAuctionShortNameInput.value.trim();
  const fullName = editAuctionFullNameInput.value.trim();
  const selectedLogo = editAuctionLogoSelect.value;
  const adminCanSetState = !!editAuctionAdminStatePermissionInput.checked;

  if (!auctionId) {
    showMessage("Missing auction ID.", "error");
    return;
  }

  if (!shortName || !fullName) {
    showMessage("Please provide both short and full names", "error");
    return;
  }

  saveEditAuctionButton.disabled = true;
  editAuctionDeleteButton.disabled = true;
  editAuctionResetButton.disabled = true;

  try {
    const updateRes = await fetch(`${API}/maintenance/auctions/update`, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        auction_id: auctionId,
        short_name: shortName,
        full_name: fullName,
        logo: selectedLogo
      })
    });

    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      showMessage(updateData.error || "Failed to update auction", "error");
      return;
    }

    const permissionData = await updateAuctionAdminStatePermission(auctionId, adminCanSetState);
    if (!permissionData) {
      showMessage("Failed to update auction permission", "error");
      return;
    }

    showMessage(updateData.message || "Auction updated", "success");
    closeEditAuctionModal();
    refreshAuctions();
  } catch (error) {
    showMessage(error?.message || "Failed to update auction", "error");
  } finally {
    saveEditAuctionButton.disabled = false;
    editAuctionDeleteButton.disabled = Number(editAuctionModal?.dataset.auctionItemCount || 0) > 0;
    editAuctionResetButton.disabled = !["archived", "setup"].includes(editAuctionModal?.dataset.auctionStatus || "");
  }
});

editAuctionDeleteButton?.addEventListener("click", async () => {
  const auctionId = Number(editAuctionIdInput.value);
  if (!auctionId) {
    showMessage("Missing auction ID.", "error");
    return;
  }

  editAuctionDeleteButton.disabled = true;
  try {
    const deleted = await deleteAuctionById(auctionId, editAuctionModal?.dataset.auctionFullName || "");
    if (!deleted) return;
    closeEditAuctionModal();
    refreshAuctions();
  } finally {
    editAuctionDeleteButton.disabled = Number(editAuctionModal?.dataset.auctionItemCount || 0) > 0;
  }
});

editAuctionResetButton?.addEventListener("click", async () => {
  const auctionId = Number(editAuctionIdInput.value);
  if (!auctionId) {
    showMessage("Missing auction ID.", "error");
    return;
  }

  editAuctionResetButton.disabled = true;
  try {
    const reset = await resetAuctionById(auctionId);
    if (!reset) return;
    closeEditAuctionModal();
    refreshAuctions();
  } finally {
    editAuctionResetButton.disabled = !["archived", "setup"].includes(editAuctionModal?.dataset.auctionStatus || "");
  }
});

integrityCheckButton?.addEventListener("click", checkIntegrity);
integrityFixButton?.addEventListener("click", fixIntegrity);

function resetIntegrityPanels() {
  lastIntegrityResult = null;
  if (integrityResults) {
    integrityResults.style.display = "none";
  }
  if (integritySummaryPanel) {
    integritySummaryPanel.innerHTML = "";
  }
  if (integrityFixSummary) {
    integrityFixSummary.innerHTML = "";
    integrityFixSummary.hidden = true;
    integrityFixSummary.className = "";
  }
  if (integrityDetailsPanel) {
    integrityDetailsPanel.innerHTML = "";
    integrityDetailsPanel.hidden = true;
    integrityDetailsPanel.className = "";
  }
  if (integrityFixButton) {
    integrityFixButton.disabled = true;
  }
}

function renderIntegritySummary(result) {
  if (!integrityResults || !integritySummaryPanel) return;

  lastIntegrityResult = result;
  integrityResults.style.display = "block";
  integritySummaryPanel.innerHTML = `
    <p class="integrity-summary-line ${result.has_problems ? "has-problems" : "no-problems"}">${escapeHtml(result.summary_text || "")}</p>
    <p class="integrity-summary-meta">
      Checks run: ${escapeHtml(result.check_count || 0)}.
      Fixable problems: ${escapeHtml(result.fixable_problem_count || 0)}.
      Errors: ${escapeHtml(result.problems_by_severity?.error || 0)}.
      Warnings: ${escapeHtml(result.problems_by_severity?.warning || 0)}.
    </p>
  `;

  if (integrityFixSummary) {
    integrityFixSummary.innerHTML = "";
    integrityFixSummary.hidden = true;
    integrityFixSummary.className = "";
  }
  if (integrityDetailsPanel) {
    integrityDetailsPanel.innerHTML = "";
    integrityDetailsPanel.hidden = true;
    integrityDetailsPanel.className = "";
  }
  if (integrityFixButton) {
    integrityFixButton.disabled = !(result.fixable_problem_count > 0);
  }
}

function renderIntegrityFixResult(fixResult) {
  if (!integrityFixSummary) return;

  const fixes = Array.isArray(fixResult?.applied_fixes) ? fixResult.applied_fixes : [];
  integrityFixSummary.hidden = false;
  integrityFixSummary.className = "integrity-fix-box";
  integrityFixSummary.innerHTML = `
    <p class="integrity-summary-line ${fixes.length > 0 ? "no-problems" : "has-problems"}">
      ${escapeHtml(fixes.length > 0 ? `Applied ${fixes.length} safe fix(es).` : "No safe fixes were applied.")}
    </p>
    <p class="integrity-fix-meta">
      Remaining problems after rerun: ${escapeHtml(fixResult?.remaining_problem_count || 0)}.
    </p>
    ${fixes.length > 0 ? `
      <div class="integrity-fix-list">
        ${fixes.map((fix) => `
          <div class="integrity-fix-card">
            <div class="integrity-problem-title">${escapeHtml(fix.message || fix.type || "Applied fix")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;
}

function renderIntegrityVerbose(result, fixResult = null) {
  renderIntegritySummary(result);
  if (!integrityDetailsPanel) return;

  const checks = Array.isArray(result.checks) ? result.checks : [];
  const problems = Array.isArray(result.problems) ? result.problems : [];

  integrityDetailsPanel.hidden = false;
  integrityDetailsPanel.className = "integrity-details-box";
  integrityDetailsPanel.innerHTML = `
    <div class="integrity-details-grid">
      <div class="integrity-detail-stat">
        <span class="integrity-detail-label">Problems</span>
        <span class="integrity-detail-value">${escapeHtml(result.problem_count || 0)}</span>
      </div>
      <div class="integrity-detail-stat">
        <span class="integrity-detail-label">Errors</span>
        <span class="integrity-detail-value">${escapeHtml(result.problems_by_severity?.error || 0)}</span>
      </div>
      <div class="integrity-detail-stat">
        <span class="integrity-detail-label">Warnings</span>
        <span class="integrity-detail-value">${escapeHtml(result.problems_by_severity?.warning || 0)}</span>
      </div>
      <div class="integrity-detail-stat">
        <span class="integrity-detail-label">Fixable Problems</span>
        <span class="integrity-detail-value">${escapeHtml(result.fixable_problem_count || 0)}</span>
      </div>
    </div>
    <div class="integrity-check-list">
      ${checks.map((check) => `
        <div class="integrity-check-card ${check.status === "fail" ? "is-fail" : "is-pass"}">
          <div class="integrity-check-head">
            <div class="integrity-check-title">${escapeHtml(check.title || check.code || "Check")}</div>
            <div>${escapeHtml(check.status === "fail" ? "Fail" : "Pass")}</div>
          </div>
          <p class="integrity-check-summary">
            ${escapeHtml(check.problem_count || 0)} problem(s), ${escapeHtml(check.fixable_count || 0)} fixable.
          </p>
          <div class="integrity-badge-row">
            <span class="integrity-badge priority-${escapeHtml(check.priority || "workflow")}">${escapeHtml(check.priority || "workflow")}</span>
            <span class="integrity-badge severity-${escapeHtml(check.severity || "error")}">${escapeHtml(check.severity || "error")}</span>
            <span class="integrity-badge">${escapeHtml(check.code || "")}</span>
          </div>
        </div>
      `).join("")}
    </div>
    <div class="integrity-problem-list">
      ${problems.length > 0 ? problems.map((problem) => `
        <div class="integrity-problem-card">
          <div class="integrity-problem-head">
            <div class="integrity-problem-title">${escapeHtml(problem.code || "problem")}</div>
            <div>${escapeHtml(`${problem.entity_type || "entity"} ${problem.entity_id ?? ""}`.trim())}</div>
          </div>
          <p class="integrity-problem-message">${escapeHtml(problem.message || "")}</p>
          <div class="integrity-badge-row">
            <span class="integrity-badge severity-${escapeHtml(problem.severity || "error")}">${escapeHtml(problem.severity || "error")}</span>
            ${problem.fixable ? '<span class="integrity-badge fixable">fixable</span>' : ""}
            ${problem.auction_id != null ? `<span class="integrity-badge">auction ${escapeHtml(problem.auction_id)}</span>` : ""}
          </div>
          <details class="integrity-problem-details">
            <summary>Details</summary>
            <pre>${escapeHtml(JSON.stringify(problem.details || {}, null, 2))}</pre>
          </details>
        </div>
      `).join("") : `
        <div class="integrity-problem-card">
          <div class="integrity-problem-title">No problems detected in verbose mode.</div>
        </div>
      `}
    </div>
  `;

  if (fixResult) {
    renderIntegrityFixResult(fixResult);
  }
}

async function fetchIntegrityResult(mode = "verbose") {
  const res = await fetch(`${API}/maintenance/check-integrity?mode=${encodeURIComponent(mode)}`, {
    headers: { Authorization: token }
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Integrity check failed");
  }
  return data;
}

async function checkIntegritySummary() {
  try {
    const data = await fetchIntegrityResult("summary");
    if (!data.has_problems) {
      resetIntegrityPanels();
      return;
    }
    renderIntegritySummary(data);
    showMessage(`Integrity check found ${data.problem_count || 0} problem(s).`, "error");
  } catch (error) {
    resetIntegrityPanels();
    showMessage(error.message || "Integrity check failed", "error");
  }
}

async function checkIntegrity() {
  integrityCheckButton.disabled = true;
  try {
    const data = await fetchIntegrityResult("verbose");
    renderIntegrityVerbose(data);
    showMessage(data.summary_text || "Integrity check complete.", data.has_problems ? "error" : "success");
  } catch (error) {
    showMessage(error.message || "Integrity check failed", "error");
  } finally {
    integrityCheckButton.disabled = false;
  }
}

async function fixIntegrity() {
  integrityFixButton.disabled = true;
  integrityCheckButton.disabled = true;
  try {
    const res = await fetch(`${API}/maintenance/check-integrity/fix`, {
      method: "POST",
      headers: { Authorization: token }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Integrity fix failed");
    }

    renderIntegrityVerbose(data.rerun, data);
    showMessage(
      data.applied_fix_count > 0
        ? `Applied ${data.applied_fix_count} safe integrity fix(es).`
        : "No safe integrity fixes were available.",
      data.applied_fix_count > 0 ? "success" : "info"
    );
  } catch (error) {
    showMessage(error.message || "Integrity fix failed", "error");
  } finally {
    integrityCheckButton.disabled = false;
    integrityFixButton.disabled = !(lastIntegrityResult?.fixable_problem_count > 0);
  }
}

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
  if (editAuctionLogoSelect) editAuctionLogoSelect.innerHTML = "";

  // Always offer the default option first
  const defaultOption = document.createElement("option");
  defaultOption.value = "default_logo.png";
  defaultOption.textContent = "Default Logo";
  select.appendChild(defaultOption);
  if (editAuctionLogoSelect) {
    const editDefaultOption = document.createElement("option");
    editDefaultOption.value = "default_logo.png";
    editDefaultOption.textContent = "Default Logo";
    editAuctionLogoSelect.appendChild(editDefaultOption);
  }

  if (data.files && data.files.length > 0) {
    for (const file of data.files) {
      const option = document.createElement("option");
      option.value = file.name;
      option.textContent = file.name;
      select.appendChild(option);
      if (editAuctionLogoSelect) {
        const editOption = document.createElement("option");
        editOption.value = file.name;
        editOption.textContent = file.name;
        editAuctionLogoSelect.appendChild(editOption);
      }
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
  if (editAuctionLogoSelect) editAuctionLogoSelect.innerHTML = "";

  // Always offer the default option first
  const defaultOption = document.createElement("option");
  defaultOption.value = "default_logo.png";
  defaultOption.textContent = "Default Logo (Recommended)";
  select.appendChild(defaultOption);
  if (editAuctionLogoSelect) {
    const editDefaultOption = document.createElement("option");
    editDefaultOption.value = "default_logo.png";
    editDefaultOption.textContent = "Default Logo (Recommended)";
    editAuctionLogoSelect.appendChild(editDefaultOption);
  }

  if (data.files && data.files.length > 0) {
    for (const file of data.files) {
      const option = document.createElement("option");
      option.value = file.name;
      option.textContent = file.name;
      select.appendChild(option);
      if (editAuctionLogoSelect) {
        const editOption = document.createElement("option");
        editOption.value = file.name;
        editOption.textContent = file.name;
        editAuctionLogoSelect.appendChild(editOption);
      }
    }
  }
}


// Optionally auto-load on login
if (maintenanceSection.style.display === "grid") {
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
    row.innerHTML = `<td colspan="8" style="padding: 4px; color: red;">Failed to load audit log.</td>`;
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
  document.getElementById('pay-error').textContent = "";


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
      loadUsers();

    } else {
    }
  }, 30000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshAuctions();
    loadPptxImageList();
    loadUsers();

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
