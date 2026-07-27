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
const aboutVersionSummaryEl = document.getElementById("about-version-summary");
const aboutDeploymentModeEl = document.getElementById("about-deployment-mode");
const aboutDatabaseEntryEl = document.getElementById("about-database-entry");
const aboutDatabaseRestoreEl = document.getElementById("about-database-restore");
const aboutBackendUptimeEl = document.getElementById("about-backend-uptime");
const openAddAuctionModalButton = document.getElementById("open-add-auction-modal");
const addAuctionModal = document.getElementById("add-auction-modal");
const closeAddAuctionModalButton = document.getElementById("close-add-auction-modal");
const cancelAddAuctionButton = document.getElementById("cancel-add-auction");
const testDataModal = document.getElementById("test-data-modal");
const closeTestDataModalButton = document.getElementById("close-test-data-modal");
const cancelTestDataButton = document.getElementById("cancel-test-data");
const testAuctionName = document.getElementById("test-auction-name");
const testAuctionState = document.getElementById("test-auction-state");
const editAuctionModal = document.getElementById("edit-auction-modal");
const closeEditAuctionModalButton = document.getElementById("close-edit-auction-modal");
const cancelEditAuctionButton = document.getElementById("cancel-edit-auction");
const saveEditAuctionButton = document.getElementById("save-edit-auction");
const editAuctionIdInput = document.getElementById("edit-auction-id");
const editAuctionShortNameInput = document.getElementById("edit-auction-short-name");
const editAuctionFullNameInput = document.getElementById("edit-auction-full-name");
const editAuctionLogoSelect = document.getElementById("edit-auction-logo-select");
const editAuctionStatusSelect = document.getElementById("edit-auction-status");
const editAuctionAdminStatePermissionInput = document.getElementById("edit-auction-admin-state-permission");
const editAuctionPurgeDeletedButton = document.getElementById("edit-auction-purge-deleted");
const auctionQrModal = document.getElementById("auction-qr-modal");
const closeAuctionQrModalButton = document.getElementById("close-auction-qr-modal");
const cancelAuctionQrButton = document.getElementById("cancel-auction-qr");
const previewAuctionQrButton = document.getElementById("preview-auction-qr");
const downloadAuctionQrButton = document.getElementById("download-auction-qr");
const qrAuctionTitle = document.getElementById("qr-auction-title");
const qrAuctionShortNameInput = document.getElementById("qr-auction-short-name");
const qrRootUrlInput = document.getElementById("qr-root-url");
const qrFullUrlInput = document.getElementById("qr-full-url");
const qrForegroundColourInput = document.getElementById("qr-foreground-colour");
const qrBackgroundColourInput = document.getElementById("qr-background-colour");
const qrCentreImageSelect = document.getElementById("qr-centre-image");
const qrOutputSizeInput = document.getElementById("qr-output-size");
const qrPreviewImage = document.getElementById("qr-preview-image");
const qrPreviewPlaceholder = document.getElementById("qr-preview-placeholder");
const qrModalStatus = document.getElementById("qr-modal-status");
const popoutLogsButton = document.getElementById("popout-logs");
const autoRefreshLogsCheckbox = document.getElementById("auto-refresh-logs");
const integrityCheckButton = document.getElementById("integrity-check");
const integrityFixButton = document.getElementById("integrity-fix");
const integrityResults = document.getElementById("integrity-results");
const integritySummaryPanel = document.getElementById("integrity-summary-panel");
const integrityFixSummary = document.getElementById("integrity-fix-summary");
const integrityDetailsPanel = document.getElementById("integrity-details-panel");
const photoStorageResults = document.getElementById("photo-storage-results");
const openCreateBackupModalButton = document.getElementById("open-create-backup-modal");
const openImportBackupModalButton = document.getElementById("open-import-backup-modal");
const openAddUserModalButton = document.getElementById("open-add-user-modal");
const backupNoteInput = document.getElementById("backup-note");
const backupOperationStatus = document.getElementById("backup-operation-status");
const createBackupLog = document.getElementById("create-backup-log");
const refreshBackupsButton = document.getElementById("refresh-backups");
const backupTotalSize = document.getElementById("backup-total-size");
const backupTableBody = document.getElementById("backup-table-body");
const backupRestorePermissionNote = document.getElementById("backup-restore-permission-note");
const refreshMessagingStatsButton = document.getElementById("refresh-messaging-stats");
const exportMessagingCacheButton = document.getElementById("export-messaging-cache");
const clearMessagingCacheButton = document.getElementById("clear-messaging-cache");
const messagingEnabledStatus = document.getElementById("messaging-enabled-status");
const messagingMessageCount = document.getElementById("messaging-message-count");
const messagingCacheSize = document.getElementById("messaging-cache-size");
const messagingMessageLimit = document.getElementById("messaging-message-limit");
const messagingCacheLimit = document.getElementById("messaging-cache-limit");
const messagingCharLimit = document.getElementById("messaging-char-limit");
const messagingPersistenceStatus = document.getElementById("messaging-persistence-status");
const messagingPersistenceSaved = document.getElementById("messaging-persistence-saved");
const backupInfoModal = document.getElementById("backup-info-modal");
const closeBackupInfoModalButton = document.getElementById("close-backup-info-modal");
const backupRestoreModal = document.getElementById("backup-restore-modal");
const closeBackupRestoreModalButton = document.getElementById("close-backup-restore-modal");
const cancelBackupRestoreButton = document.getElementById("cancel-backup-restore");
const createBackupModal = document.getElementById("create-backup-modal");
const closeCreateBackupModalButton = document.getElementById("close-create-backup-modal");
const cancelCreateBackupButton = document.getElementById("cancel-create-backup");
const importBackupModal = document.getElementById("import-backup-modal");
const closeImportBackupModalButton = document.getElementById("close-import-backup-modal");
const cancelImportBackupButton = document.getElementById("cancel-import-backup");
const importBackupFileInput = document.getElementById("import-backup-file");
const inspectImportedBackupButton = document.getElementById("inspect-imported-backup");
const confirmImportBackupButton = document.getElementById("confirm-import-backup");
const importBackupStatus = document.getElementById("import-backup-status");
const importBackupProgressWrap = document.getElementById("import-backup-progress-wrap");
const importBackupProgress = document.getElementById("import-backup-progress");
const importBackupProgressLabel = document.getElementById("import-backup-progress-label");
const importBackupProgressPercent = document.getElementById("import-backup-progress-percent");
const importBackupValidation = document.getElementById("import-backup-validation");
const importBackupComparison = document.getElementById("import-backup-comparison");
const importBackupDetailTitle = document.getElementById("import-backup-detail-title");
const importBackupDetailSubtitle = document.getElementById("import-backup-detail-subtitle");
const importBackupDetailGrid = document.getElementById("import-backup-detail-grid");
const importBackupComponentSummary = document.getElementById("import-backup-component-summary");
const importBackupAuctionTableBody = document.getElementById("import-backup-auction-table-body");
const addUserModal = document.getElementById("add-user-modal");
const closeAddUserModalButton = document.getElementById("close-add-user-modal");
const cancelAddUserButton = document.getElementById("cancel-add-user");
const addUserAccessNote = document.getElementById("add-user-access-note");
const editUserModal = document.getElementById("edit-user-modal");
const closeEditUserModalButton = document.getElementById("close-edit-user-modal");
const cancelEditUserButton = document.getElementById("cancel-edit-user");
const editUserAccessNote = document.getElementById("edit-user-access-note");
const editUserUsernameInput = document.getElementById("edit-user-username");
const editUserPasswordInput = document.getElementById("edit-user-password");
const editUserConfirmPasswordInput = document.getElementById("edit-user-confirm-password");
const saveEditUserAccessButton = document.getElementById("save-edit-user-access");
const changeEditUserPasswordButton = document.getElementById("change-edit-user-password");
const backupDetailTitle = document.getElementById("backup-detail-title");
const backupDetailSubtitle = document.getElementById("backup-detail-subtitle");
const backupDetailGrid = document.getElementById("backup-detail-grid");
const backupComponentSummary = document.getElementById("backup-component-summary");
const backupAuctionTableBody = document.getElementById("backup-auction-table-body");
const backupRestoreDb = document.getElementById("backup-restore-db");
const backupRestorePhotos = document.getElementById("backup-restore-photos");
const backupRestoreResources = document.getElementById("backup-restore-resources");
const backupRestoreTitle = document.getElementById("backup-restore-title");
const backupRestoreSubtitle = document.getElementById("backup-restore-subtitle");
const restoreSelectedBackupButton = document.getElementById("restore-selected-backup");
const backupRestoreLog = document.getElementById("backup-restore-log");
const saveRestoreLogButton = document.getElementById("save-restore-log");
const AUCTION_STATUSES = Object.freeze(["setup", "locked", "live", "settlement", "archived"]);

var isRendering = false;
let currentUsername = null;
let currentMaintenanceUser = null;
let currentVersions = {};
let latestServerLog = "";
let logPopupWindow = null;
let lastIntegrityResult = null;
let managedBackups = [];
let selectedBackupId = null;
let selectedBackupDetail = null;
let lastManagedRestoreLog = "";
let backupOperationBusy = false;
let pendingBackupImport = null;
let resourceImageFiles = [];
let selectedQrAuction = null;
let currentQrPreviewUrl = null;
let auctionContextMenu = null;
let selectedEditUser = null;
let selectedTestAuction = null;
let testDataBusy = false;

const AUCTION_ACTION_ICONS = Object.freeze({
  qr: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 4h6v6H4z"></path>
      <path d="M14 4h6v6h-6z"></path>
      <path d="M4 14h6v6H4z"></path>
      <path d="M14 14h2v2h-2z"></path>
      <path d="M18 14h2v2h-2z"></path>
      <path d="M16 16h2v2h-2z"></path>
      <path d="M14 18h2v2h-2z"></path>
      <path d="M18 18h2v2h-2z"></path>
    </svg>
  `,
  edit: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
    </svg>
  `,
  testData: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6"></path>
      <path d="M10 3v5l-5.2 9a2.3 2.3 0 0 0 2 3.5h10.4a2.3 2.3 0 0 0 2-3.5L14 8V3"></path>
      <path d="M7.5 15h9"></path>
      <path d="M10 12h.01"></path>
      <path d="M14 17h.01"></path>
    </svg>
  `,
  reset: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 12a9 9 0 1 0 3-6.7"></path>
      <path d="M3 4v5h5"></path>
      <path d="M12 7v6"></path>
      <path d="M9 10l3 3 3-3"></path>
    </svg>
  `,
  delete: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6h18"></path>
      <path d="M8 6V4h8v2"></path>
      <path d="M19 6l-1 14H6L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
    </svg>
  `
});

const BACKUP_ACTION_ICONS = Object.freeze({
  restore: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 12a9 9 0 1 0 3-6.7"></path>
      <path d="M3 4v5h5"></path>
    </svg>
  `,
  download: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v12"></path>
      <path d="M7 10l5 5 5-5"></path>
      <path d="M5 21h14"></path>
    </svg>
  `,
  info: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M12 10v6"></path>
      <path d="M12 7h.01"></path>
    </svg>
  `,
  delete: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6h18"></path>
      <path d="M8 6V4h8v2"></path>
      <path d="M19 6l-1 14H6L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
    </svg>
  `
});

function getAuthToken() {
  return window.AppAuth?.getToken?.() || "";
}

let token = getAuthToken();

function canManageUsers(user = currentMaintenanceUser) {
  if (window.AppAuth?.canAccess) {
    return window.AppAuth.canAccess(user, { permission: "manage_users" });
  }
  return Array.isArray(user?.permissions) && user.permissions.includes("manage_users");
}

function canRestoreDatabase(user = currentMaintenanceUser) {
  return hasPermission(user, "restore_database");
}

function hasRole(user, role) {
  if (window.AppAuth?.hasRole) {
    return window.AppAuth.hasRole(user, role);
  }
  return Array.isArray(user?.roles) && user.roles.includes(role);
}

function hasPermission(user, permission) {
  if (window.AppAuth?.hasPermission) {
    return window.AppAuth.hasPermission(user, permission);
  }
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

function canGrantRole(role, user = currentMaintenanceUser) {
  return hasRole(user, role);
}

function canGrantPermission(permission, user = currentMaintenanceUser) {
  return hasPermission(user, permission);
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

function normalizeAuctionStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return AUCTION_STATUSES.includes(normalized) ? normalized : AUCTION_STATUSES[0];
}

function formatAuctionStatus(status) {
  return normalizeAuctionStatus(status);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let size = value;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatNullableBytes(bytes) {
  return bytes == null ? "Unknown" : formatBytes(bytes);
}

function formatInteger(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : "0";
}

function formatCountLimit(count, limit) {
  return `${formatInteger(count)} / ${formatInteger(limit)}`;
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (minutes || hours || days) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function formatUptime(startedAt) {
  if (!startedAt) return "Unknown";
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return "Unknown";
  return formatDuration(Date.now() - started.getTime());
}

function formatRestoreSummary(versions = {}) {
  if (!versions.restored_at) return "Never";
  const backupId = versions.restored_from_backup_id === "uploaded-database"
    ? "Uploaded database"
    : (versions.restored_from_backup_id ? `Backup #${versions.restored_from_backup_id}` : "Unknown backup");
  const sourceDatabaseId = versions.restored_from_database_id ? `, source DB ${versions.restored_from_database_id}` : "";
  return `${backupId} on ${formatDateTime(versions.restored_at)}${sourceDatabaseId}`;
}

function formatBackupDisplayLabel(backup) {
  const id = backup?.backup_id ? `#${backup.backup_id}` : "#Unknown";
  return `Backup ${id} from ${formatDateTime(backup?.created_at)}`;
}

async function confirmMaintenanceAction(message, options = {}) {
  if (window.DayPilot?.Modal?.confirm) {
    const result = await DayPilot.Modal.confirm(message, options);
    return !result.canceled;
  }
  showMessage("Confirmation dialog is unavailable. Please refresh the page and try again.", "error");
  return false;
}

function setBackupOperationStatus(message, type = "info") {
  if (!backupOperationStatus) return;
  backupOperationStatus.textContent = message;
  backupOperationStatus.dataset.state = type;
}

function setCreateBackupLog(text) {
  if (!createBackupLog) return;
  createBackupLog.textContent = text || "No backup log captured yet.";
}

function setImportBackupStatus(message, type = "info") {
  if (!importBackupStatus) return;
  importBackupStatus.textContent = message;
  importBackupStatus.dataset.state = type;
}

function setImportBackupProgress({
  hidden = false,
  label = "Uploading backup archive...",
  percent = null
} = {}) {
  if (!importBackupProgressWrap || !importBackupProgress || !importBackupProgressLabel || !importBackupProgressPercent) return;

  importBackupProgressWrap.hidden = hidden;
  if (hidden) {
    importBackupProgress.removeAttribute("value");
    importBackupProgressPercent.textContent = "";
    importBackupProgressLabel.textContent = label;
    return;
  }

  importBackupProgressLabel.textContent = label;
  if (typeof percent === "number" && Number.isFinite(percent)) {
    const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
    importBackupProgress.value = clampedPercent;
    importBackupProgressPercent.textContent = `${clampedPercent}%`;
  } else {
    importBackupProgress.removeAttribute("value");
    importBackupProgressPercent.textContent = "Working...";
  }
}

function postFormDataWithUploadProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.setRequestHeader("X-CSRF-Token", token);

    xhr.upload.addEventListener("progress", (event) => {
      if (typeof onProgress === "function") {
        onProgress(event);
      }
    });

    xhr.addEventListener("load", () => {
      const response = xhr.response && typeof xhr.response === "object"
        ? xhr.response
        : (() => {
            try {
              return JSON.parse(xhr.responseText || "{}");
            } catch (error) {
              return {};
            }
          })();

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(response);
        return;
      }

      reject(new Error(response.error || "Failed to inspect backup archive."));
    });

    xhr.addEventListener("error", () => reject(new Error("Backup upload failed.")));
    xhr.addEventListener("abort", () => reject(new Error("Backup upload was cancelled.")));
    xhr.send(formData);
  });
}

function openModal(modal) {
  if (modal) {
    modal.hidden = false;
  }
}

function closeModal(modal) {
  if (modal) {
    modal.hidden = true;
  }
}

function resetAddAuctionForm() {
  const fullNameInput = document.getElementById("auction-full-name");
  const shortNameInput = document.getElementById("auction-short-name");
  const logoSelect = document.getElementById("auction-logo-select");
  if (fullNameInput) fullNameInput.value = "";
  if (shortNameInput) shortNameInput.value = "";
  if (logoSelect) logoSelect.selectedIndex = 0;
}

function openAddAuctionModal() {
  openModal(addAuctionModal);
  document.getElementById("auction-full-name")?.focus();
}

function closeAddAuctionModal() {
  closeModal(addAuctionModal);
}

function openTestDataModal(auction) {
  if (!testDataModal || !auction) return;
  selectedTestAuction = auction;
  const auctionIdInput = document.getElementById("test-auction-select");
  if (auctionIdInput) auctionIdInput.value = String(auction.id);
  if (testAuctionName) {
    testAuctionName.textContent = auction.full_name || auction.short_name || `Auction ${auction.id}`;
  }
  if (testAuctionState) {
    testAuctionState.textContent = formatAuctionStatus(auction.status);
  }
  openModal(testDataModal);
  document.getElementById("test-count")?.focus();
}

function closeTestDataModal() {
  selectedTestAuction = null;
  const auctionIdInput = document.getElementById("test-auction-select");
  if (auctionIdInput) auctionIdInput.value = "";
  closeModal(testDataModal);
}

function setTestDataBusy(busy) {
  testDataBusy = busy;
  ["generate-test-data", "generate-bids-btn", "delete-test-bids"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = busy;
  });
}

function getSelectedTestAuction() {
  const auctionId = Number(document.getElementById("test-auction-select")?.value);
  if (!selectedTestAuction || Number(selectedTestAuction.id) !== auctionId) return null;
  return selectedTestAuction;
}

function resetAddUserForm() {
  const usernameInput = document.getElementById("new-user-username");
  const passwordInput = document.getElementById("new-user-password");
  const confirmPasswordInput = document.getElementById("new-user-confirm-password");
  if (usernameInput) usernameInput.value = "";
  if (passwordInput) passwordInput.value = "";
  if (confirmPasswordInput) confirmPasswordInput.value = "";
  document.querySelectorAll('input[name="new-user-role"]').forEach((el) => { el.checked = el.defaultChecked; });
  document.querySelectorAll('input[name="new-user-permission"]').forEach((el) => { el.checked = el.defaultChecked; });
  syncAccessEditorState(addUserModal || document);
}

function clearEditUserPasswordFields() {
  if (editUserPasswordInput) editUserPasswordInput.value = "";
  if (editUserConfirmPasswordInput) editUserConfirmPasswordInput.value = "";
}

function closeEditUserModal() {
  selectedEditUser = null;
  clearEditUserPasswordFields();
  closeModal(editUserModal);
}

function createBackupActionButton(icon, title, onClick, { danger = false, disabled = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `backup-action-button${danger ? " danger" : ""}`;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = icon;
  button.disabled = disabled;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderBackupAuctionRows(tableBody, auctions) {
  if (!tableBody) return;
  if (!Array.isArray(auctions) || auctions.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="5">No auctions recorded in this backup.</td></tr>';
    return;
  }

  tableBody.innerHTML = auctions.map((auction) => `
    <tr>
      <td>${escapeHtml(auction.id)}</td>
      <td>${escapeHtml(auction.short_name)}</td>
      <td>${escapeHtml(auction.full_name)}</td>
      <td>${escapeHtml(auction.status)}</td>
      <td>${escapeHtml(auction.item_count)}${Number(auction.deleted_item_count || 0) > 0 ? ` (${escapeHtml(auction.deleted_item_count)} deleted)` : ""}</td>
    </tr>
  `).join("");
}

function renderBackupDetailSummary(detail, {
  titleEl,
  subtitleEl,
  gridEl,
  componentEl,
  auctionTableBody,
  titlePrefix = "Backup"
} = {}) {
  if (!detail) return;

  const auctions = Array.isArray(detail.auctions) ? detail.auctions : [];
  const resourceConfigCount = Array.isArray(detail.component_manifest?.resources?.config_files)
    ? detail.component_manifest.resources.config_files.length
    : 0;
  const detailTitle = detail.backup_id ? `${titlePrefix} #${detail.backup_id}` : titlePrefix;
  const detailSubtitle = detail.note
    ? `Note: ${detail.note}`
    : `Archive file: ${detail.filename || detail.import_source_filename || "Unknown"}`;

  if (titleEl) titleEl.textContent = detailTitle;
  if (subtitleEl) subtitleEl.textContent = detailSubtitle;
  if (gridEl) {
    gridEl.innerHTML = [
      ["Backup ID", detail.backup_id ? `#${detail.backup_id}` : "Assigned on import"],
      ["Source Backup ID", detail.archive_backup_id ? `#${detail.archive_backup_id}` : "Unknown"],
      ["Created", formatDateTime(detail.created_at)],
      ["User", detail.created_by || "Unknown"],
      ["Database ID", detail.database_id || "Unknown"],
      ["Last Restore", detail.restored_at ? formatRestoreSummary(detail) : "Never"],
      ["Schema", detail.schema_version || "Unknown"],
      ["Archive Size", formatBytes(detail.archive_size_bytes)],
      ["Format", `v${detail.format_version || "?"}`],
      ["Auctions", `${auctions.length}`],
      ["Archive", detail.filename || "Unknown"],
      ["Imported", detail.is_imported ? `Yes${detail.imported_at ? ` on ${formatDateTime(detail.imported_at)}` : ""}` : "No"],
      ["Imported By", detail.imported_by || "Not applicable"],
      ["Import Source", detail.import_source_filename || "Not applicable"]
    ].map(([label, value]) => `
      <div class="maintenance-detail-stat">
        <span class="maintenance-detail-label">${escapeHtml(label)}</span>
        <span class="maintenance-detail-value">${escapeHtml(value)}</span>
      </div>
    `).join("");
  }
  if (componentEl) {
    componentEl.innerHTML = [
      { label: "Database", value: detail.component_manifest?.database?.included ? "Included" : "Missing" },
      { label: "Photos", value: `${detail.component_manifest?.photos?.file_count ?? 0} file(s)` },
      { label: "Resources", value: `${detail.component_manifest?.resources?.image_count ?? 0} image(s)` },
      { label: "Configs", value: `${resourceConfigCount} file(s)` }
    ].map((entry) => `<span class="maintenance-inline-pill">${escapeHtml(entry.label)}: ${escapeHtml(entry.value)}</span>`).join("");
  }
  renderBackupAuctionRows(auctionTableBody, auctions);
}

function renderImportValidation(result = null) {
  if (!importBackupValidation) return;
  const blockingErrors = Array.isArray(result?.blocking_errors) ? result.blocking_errors : [];

  if (blockingErrors.length === 0) {
    importBackupValidation.hidden = true;
    importBackupValidation.innerHTML = "";
    return;
  }

  importBackupValidation.hidden = false;
  importBackupValidation.innerHTML = blockingErrors
    .map((message) => `<div class="maintenance-validation-item is-error"><strong>Blocked:</strong> ${escapeHtml(message)}</div>`)
    .join("");
}

function renderImportComparison(result = null) {
  if (!importBackupComparison) return;
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  const schema = { ...(result?.comparison?.schema || {}) };
  const database = { ...(result?.comparison?.database || {}) };
  const preview = result?.preview || {};
  const schemaSnapshotDiff = warnings.some((message) => message.includes("Database snapshot schema"));
  const databaseSnapshotDiff = warnings.some((message) => message.includes("Database snapshot ID"));

  if ((schema.status === "match" || !schema.status) && schemaSnapshotDiff) {
    schema.status = "warning";
    schema.message = "Uploaded backup schema matches the live server.";
  }

  if ((database.status === "match" || !database.status) && databaseSnapshotDiff) {
    database.status = "warning";
    database.message = "Uploaded backup database ID matches the live server.";
  }

  const renderCard = (label, comparison, extraNote = "") => `
    <div class="maintenance-compare-card is-${escapeHtml(comparison.status || "info")}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(comparison.message || "No comparison available.")}</strong>
      <div class="maintenance-compare-values">
        <span>Import: ${escapeHtml(comparison.imported || "Unknown")}</span>
        <span>Current Server: ${escapeHtml(comparison.live || "Unknown")}</span>
      </div>
    </div>
  `;


  importBackupComparison.innerHTML = `${renderCard("Schema", schema)}${renderCard("Database ID", database)}`;
}

function resetImportBackupPreview() {
  pendingBackupImport = null;
  if (importBackupFileInput) importBackupFileInput.value = "";
  setImportBackupStatus("Select a managed backup zip to inspect.", "info");
  setImportBackupProgress({ hidden: true });
  renderImportValidation(null);
  renderImportComparison(null);
  if (importBackupDetailTitle) importBackupDetailTitle.textContent = "Import Preview";
  if (importBackupDetailSubtitle) importBackupDetailSubtitle.textContent = "Preview metadata will appear after inspection.";
  if (importBackupDetailGrid) importBackupDetailGrid.innerHTML = "";
  if (importBackupComponentSummary) importBackupComponentSummary.innerHTML = "";
  if (importBackupAuctionTableBody) {
    importBackupAuctionTableBody.innerHTML = '<tr><td colspan="5">No backup inspected yet.</td></tr>';
  }
}

function createAuctionActionButton(icon, title, onClick, { danger = false, disabled = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `auction-action-button${danger ? " danger" : ""}`;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = icon;
  button.disabled = disabled;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (button.disabled) return;
    onClick();
  });
  return button;
}

function updateBackupActionState() {
  const hasSelection = Boolean(selectedBackupDetail?.backup_id);
  const restoreAllowed = canRestoreDatabase();
  const componentManifest = selectedBackupDetail?.component_manifest || {};
  const canRestoreDb = Boolean(componentManifest.database?.included);
  const canRestorePhotos = Boolean(componentManifest.photos?.included);
  const canRestoreResources = Boolean(componentManifest.resources?.included);

  if (backupRestoreDb) {
    backupRestoreDb.disabled = backupOperationBusy || !restoreAllowed || !canRestoreDb;
    if (!canRestoreDb) backupRestoreDb.checked = false;
  }
  if (backupRestorePhotos) {
    backupRestorePhotos.disabled = backupOperationBusy || !restoreAllowed || !canRestorePhotos;
    if (!canRestorePhotos) backupRestorePhotos.checked = false;
  }
  if (backupRestoreResources) {
    backupRestoreResources.disabled = backupOperationBusy || !restoreAllowed || !canRestoreResources;
    if (!canRestoreResources) backupRestoreResources.checked = false;
  }

  if (backupRestorePermissionNote) backupRestorePermissionNote.hidden = restoreAllowed;
  if (refreshBackupsButton) refreshBackupsButton.disabled = backupOperationBusy;
  if (backupNoteInput) backupNoteInput.disabled = backupOperationBusy;
  document.getElementById("backup-db").disabled = backupOperationBusy;
  if (openCreateBackupModalButton) openCreateBackupModalButton.disabled = backupOperationBusy;
  if (openImportBackupModalButton) {
    openImportBackupModalButton.hidden = !restoreAllowed;
    openImportBackupModalButton.disabled = backupOperationBusy || !restoreAllowed;
  }
  if (importBackupFileInput) importBackupFileInput.disabled = backupOperationBusy || !restoreAllowed;
  if (inspectImportedBackupButton) inspectImportedBackupButton.disabled = backupOperationBusy || !restoreAllowed;
  if (confirmImportBackupButton) {
    const canConfirmImport = Boolean(pendingBackupImport?.import_token) && pendingBackupImport?.can_import;
    confirmImportBackupButton.disabled = backupOperationBusy || !restoreAllowed || !canConfirmImport;
  }
  if (restoreSelectedBackupButton) {
    restoreSelectedBackupButton.disabled = backupOperationBusy || !restoreAllowed || !hasSelection;
  }
  if (saveRestoreLogButton) saveRestoreLogButton.disabled = !lastManagedRestoreLog;
}

function renderBackupDetails() {
  if (!selectedBackupDetail) return;
  renderBackupDetailSummary(selectedBackupDetail, {
    titleEl: backupDetailTitle,
    subtitleEl: backupDetailSubtitle,
    gridEl: backupDetailGrid,
    componentEl: backupComponentSummary,
    auctionTableBody: backupAuctionTableBody,
    titlePrefix: "Backup"
  });
  updateBackupActionState();
}

function renderBackupTable() {
  if (!backupTableBody) return;

  if (!Array.isArray(managedBackups) || managedBackups.length === 0) {
    backupTableBody.innerHTML = '<tr><td colspan="6">No managed backups found.</td></tr>';
    return;
  }

  backupTableBody.innerHTML = "";
  managedBackups.forEach((backup) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>#${escapeHtml(backup.backup_id)}</td>
      <td>${escapeHtml(formatDateTime(backup.created_at))}</td>
      <td>${escapeHtml(backup.created_by || "Unknown")}</td>
      <td><div class="backup-note-cell">${escapeHtml(backup.note || "")}</div></td>
      <td>${escapeHtml(formatBytes(backup.archive_size_bytes))}</td>
      <td></td>
    `;
    const actionCell = row.lastElementChild;
    const actionWrap = document.createElement("div");
    actionWrap.className = "backup-action-row";
    actionWrap.appendChild(createBackupActionButton(BACKUP_ACTION_ICONS.restore, "Restore backup", () => {
      void openBackupRestoreModal(backup.backup_id);
    }, { disabled: backupOperationBusy || !canRestoreDatabase() }));
    actionWrap.appendChild(createBackupActionButton(BACKUP_ACTION_ICONS.download, "Download archive", () => {
      void downloadManagedBackupById(backup.backup_id);
    }, { disabled: backupOperationBusy || !canRestoreDatabase() }));
    actionWrap.appendChild(createBackupActionButton(BACKUP_ACTION_ICONS.delete, "Delete backup", () => {
      void deleteManagedBackupById(backup.backup_id);
    }, { danger: true, disabled: backupOperationBusy }));
    actionWrap.appendChild(createBackupActionButton(BACKUP_ACTION_ICONS.info, "Show backup details", () => {
      void openBackupInfoModal(backup.backup_id);
    }, { disabled: backupOperationBusy }));
    actionCell.appendChild(actionWrap);
    backupTableBody.appendChild(row);
  });
}

async function loadManagedBackups({ preserveSelection = true } = {}) {
  if (!backupTableBody || !token) return;

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/backups`, {
    headers: { "X-CSRF-Token": token }
  });
  const data = await res.json();

  if (!res.ok) {
    showMessage(data.error || "Failed to load backups.", "error");
    return;
  }

  managedBackups = Array.isArray(data.backups) ? data.backups : [];
  if (backupTotalSize) {
    backupTotalSize.textContent = `Total occupied size: ${formatBytes(data.total_size_bytes)}`;
  }

  if (preserveSelection && selectedBackupId && managedBackups.some((backup) => backup.backup_id === selectedBackupId)) {
    await selectManagedBackup(selectedBackupId, { silent: true });
  } else {
    selectedBackupId = null;
    selectedBackupDetail = null;
  }

  renderBackupTable();
  if (selectedBackupDetail) {
    renderBackupDetails();
  }
}

function renderMessagingStats(data = {}) {
  const stats = data.stats || {};
  const config = data.config || {};
  const persistence = stats.persistence || {};
  const enabled = config.enabled ?? stats.enabled;
  if (messagingEnabledStatus) messagingEnabledStatus.textContent = enabled ? "Yes" : "No";
  if (messagingMessageCount) messagingMessageCount.textContent = String(stats.message_count ?? 0);
  if (messagingCacheSize) messagingCacheSize.textContent = formatBytes(stats.estimated_bytes);
  if (messagingMessageLimit) messagingMessageLimit.textContent = String(stats.max_messages ?? config.max_messages ?? 0);
  if (messagingCacheLimit) messagingCacheLimit.textContent = formatBytes(stats.max_cache_bytes ?? config.max_cache_bytes);
  if (messagingCharLimit) messagingCharLimit.textContent = String(stats.max_message_chars ?? config.max_message_chars ?? 0);
  if (messagingPersistenceStatus) {
    messagingPersistenceStatus.textContent = persistence.last_error
      ? "Error"
      : persistence.dirty
        ? "Pending save"
        : persistence.loaded
          ? "Saved"
          : "Not loaded";
  }
  if (messagingPersistenceSaved) messagingPersistenceSaved.textContent = persistence.last_saved_at || "Never";
}

async function loadMessagingStats({ announce = false } = {}) {
  if (!token || !messagingEnabledStatus) return;

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/messages`, {
    headers: { "X-CSRF-Token": token }
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showMessage(data.error || "Failed to load messaging status.", "error");
    return;
  }

  renderMessagingStats(data);
  if (announce) showMessage("Messaging status refreshed.", "success");
}

async function clearMessagingCache() {
  const confirmed = await confirmMaintenanceAction("Clear all stored operator messages from backend memory?");
  if (!confirmed) return;

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/messages/clear`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showMessage(data.error || "Failed to clear message cache.", "error");
    return;
  }

  renderMessagingStats(data);
  window.AppMessaging?.refreshStatus?.();
  showMessage(`Cleared ${data.deleted || 0} message(s).`, "success");
}

async function exportMessagingCache() {
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/messages/export.csv`, {
    headers: { "X-CSRF-Token": token }
  });

  if (!res.ok) {
    showMessage("Failed to export message cache.", "error");
    return;
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "operator_messages.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

async function selectManagedBackup(backupId, { silent = false } = {}) {
  if (!backupId) {
    selectedBackupId = null;
    selectedBackupDetail = null;
    return;
  }

  selectedBackupId = backupId;

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/backups/${encodeURIComponent(backupId)}`, {
    headers: { "X-CSRF-Token": token }
  });
  const data = await res.json();

  if (!res.ok) {
    selectedBackupDetail = null;
    if (!silent) {
      showMessage(data.error || "Failed to load backup details.", "error");
    }
    return;
  }

  selectedBackupDetail = data;
  renderBackupDetails();
}

async function openBackupInfoModal(backupId) {
  await selectManagedBackup(backupId);
  if (selectedBackupDetail) {
    openModal(backupInfoModal);
  }
}

async function openBackupRestoreModal(backupId) {
  if (!canRestoreDatabase()) {
    showMessage("Restore Database permission is required.", "error");
    return;
  }
  await selectManagedBackup(backupId);
  if (!selectedBackupDetail) return;

  backupRestoreTitle.textContent = `Restore Backup #${selectedBackupDetail.backup_id || ""}`;
  backupRestoreSubtitle.textContent = "Select which parts of the backup should be restored.";
  if (backupRestoreDb) backupRestoreDb.checked = Boolean(selectedBackupDetail.component_manifest?.database?.included);
  if (backupRestorePhotos) backupRestorePhotos.checked = false;
  if (backupRestoreResources) backupRestoreResources.checked = false;
  updateBackupActionState();
  openModal(backupRestoreModal);
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

  if (resolvedTabId === "diagnostics") {
    void loadMessagingStats();
  }
}

function updateVersionDisplays(versions = {}) {
  currentVersions = versions || {};
  const backend = currentVersions.backend || "N/A";
  const schema = currentVersions.schema || "N/A";
  const payment = currentVersions.payment_processor || "N/A";
  const deploymentMode = currentVersions.deployment_mode === "docker"
    ? "Docker"
    : currentVersions.deployment_mode === "native"
      ? "Native"
      : "Unknown";
  const versionSummary = `Backend ${backend} / Schema ${schema} / Payment ${payment}`;
  const databaseId = currentVersions.database_id || "Unknown";
  const databaseCreatedAt = formatDateTime(currentVersions.database_created_at);
  const databaseCreatedByBackend = currentVersions.database_created_by_backend_version || "Unknown";
  const databaseEntry = `ID ${databaseId}, Created ${databaseCreatedAt} By Backend ${databaseCreatedByBackend}`;
  const restoreSummary = formatRestoreSummary(currentVersions);
  const uptime = formatUptime(currentVersions.last_started_at);

  if (softwareVersion) {
    softwareVersion.textContent = `Server Version: ${backend}`;
  }

  if (aboutVersionSummaryEl) aboutVersionSummaryEl.textContent = versionSummary;
  if (aboutDeploymentModeEl) aboutDeploymentModeEl.textContent = deploymentMode;
  if (aboutDatabaseEntryEl) aboutDatabaseEntryEl.textContent = databaseEntry;
  if (aboutDatabaseRestoreEl) aboutDatabaseRestoreEl.textContent = restoreSummary;
  if (aboutBackendUptimeEl) aboutBackendUptimeEl.textContent = uptime;
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

function populateAuctionStatusSelect(select, selectedStatus) {
  if (!select) return;
  const normalizedStatus = normalizeAuctionStatus(selectedStatus);
  select.innerHTML = "";
  AUCTION_STATUSES.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = status === normalizedStatus;
    select.appendChild(option);
  });
}

function openEditAuctionModal(auction) {
  if (!editAuctionModal || !auction) return;

  editAuctionIdInput.value = auction.id;
  editAuctionShortNameInput.value = auction.short_name || "";
  editAuctionFullNameInput.value = auction.full_name || "";
  editAuctionLogoSelect.value = auction.logo || "default_logo.png";
  populateAuctionStatusSelect(editAuctionStatusSelect, auction.status);
  editAuctionAdminStatePermissionInput.checked = !!auction.admin_can_change_state;
  const deletedCount = Number(auction.deleted_item_count || 0);
  if (editAuctionPurgeDeletedButton) {
    editAuctionPurgeDeletedButton.disabled = deletedCount <= 0;
    editAuctionPurgeDeletedButton.title = deletedCount > 0 ? "" : "No deleted items to purge";
  }
  editAuctionModal.dataset.auctionStatus = normalizeAuctionStatus(auction.status);
  editAuctionModal.dataset.auctionItemCount = String(auction.item_count ?? 0);
  editAuctionModal.dataset.auctionDeletedItemCount = String(deletedCount);
  editAuctionModal.dataset.auctionFullName = auction.full_name || "";
  editAuctionModal.hidden = false;
  editAuctionFullNameInput.focus();

}

function closeEditAuctionModal() {
  if (!editAuctionModal) return;
  editAuctionModal.hidden = true;
}

function getDefaultQrRootUrl() {
  return `${window.location.origin}/`;
}

function getQrUrlSuffix(shortName = qrAuctionShortNameInput?.value || "") {
  return `?auction=${encodeURIComponent(shortName)}`;
}

function getQrRootUrlForDisplay() {
  const rawValue = qrRootUrlInput?.value.trim() || "";
  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return rawValue;
    parsed.search = "";
    parsed.hash = "";
    if (!parsed.pathname.endsWith("/")) parsed.pathname = `${parsed.pathname}/`;
    return parsed.toString();
  } catch {
    return rawValue;
  }
}

function syncQrUrlDisplay() {
  if (!qrRootUrlInput || !qrFullUrlInput) return;
  const shortName = qrAuctionShortNameInput?.value || "";
  const suffix = getQrUrlSuffix(shortName);
  qrFullUrlInput.value = `${getQrRootUrlForDisplay()}${suffix}`;
  if (downloadAuctionQrButton) downloadAuctionQrButton.disabled = true;
}

function setQrModalStatus(message = "", type = "info") {
  if (!qrModalStatus) return;
  qrModalStatus.textContent = message;
  qrModalStatus.dataset.state = type;
}

function revokeQrPreviewUrl() {
  if (currentQrPreviewUrl) {
    URL.revokeObjectURL(currentQrPreviewUrl);
    currentQrPreviewUrl = null;
  }
}

function resetQrPreview() {
  revokeQrPreviewUrl();
  if (qrPreviewImage) {
    qrPreviewImage.hidden = true;
    qrPreviewImage.removeAttribute("src");
  }
  if (qrPreviewPlaceholder) qrPreviewPlaceholder.hidden = false;
  if (downloadAuctionQrButton) downloadAuctionQrButton.disabled = true;
}

function populateQrImageOptions(files = resourceImageFiles) {
  if (!qrCentreImageSelect) return;
  const currentValue = qrCentreImageSelect.value;
  qrCentreImageSelect.innerHTML = "";

  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "None";
  qrCentreImageSelect.appendChild(noneOption);

  for (const file of files) {
    const option = document.createElement("option");
    option.value = file.name;
    option.textContent = file.name;
    qrCentreImageSelect.appendChild(option);
  }

  if (currentValue && files.some((file) => file.name === currentValue)) {
    qrCentreImageSelect.value = currentValue;
  }
}

function openAuctionQrModal(auction) {
  if (!auctionQrModal || !auction) return;
  selectedQrAuction = auction;
  if (qrAuctionTitle) {
    const fullName = auction.full_name || auction.short_name || "Selected auction";
    qrAuctionTitle.textContent = fullName;
  }
  if (qrAuctionShortNameInput) qrAuctionShortNameInput.value = auction.short_name || "";
  if (qrRootUrlInput) qrRootUrlInput.value = getDefaultQrRootUrl();
  if (qrForegroundColourInput) qrForegroundColourInput.value = "#000000";
  if (qrBackgroundColourInput) qrBackgroundColourInput.value = "#FFFFFF";
  if (qrOutputSizeInput) qrOutputSizeInput.value = "512";
  populateQrImageOptions();
  if (qrCentreImageSelect) qrCentreImageSelect.value = "";
  resetQrPreview();
  setQrModalStatus("");
  syncQrUrlDisplay();
  openModal(auctionQrModal);
  qrRootUrlInput?.focus();
}

function closeAuctionQrModal() {
  closeModal(auctionQrModal);
  selectedQrAuction = null;
  resetQrPreview();
}

function getQrRequestPayload() {
  return {
    short_name: qrAuctionShortNameInput?.value || selectedQrAuction?.short_name || "",
    root_url: qrRootUrlInput?.value || "",
    foreground: qrForegroundColourInput?.value || "#000000",
    background: qrBackgroundColourInput?.value || "#FFFFFF",
    image: qrCentreImageSelect?.value || "",
    size: Number(qrOutputSizeInput?.value || 512)
  };
}

async function requestQrPngBlob() {
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/auctions/qr-code`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(getQrRequestPayload())
  });

  if (!res.ok) {
    let message = "Failed to generate QR code.";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // Keep the fallback message for non-JSON failures.
    }
    throw new Error(message);
  }

  return res.blob();
}

async function previewAuctionQrCode() {
  if (!selectedQrAuction) return;
  previewAuctionQrButton.disabled = true;
  if (downloadAuctionQrButton) downloadAuctionQrButton.disabled = true;
  setQrModalStatus("Generating preview...", "info");

  try {
    const blob = await requestQrPngBlob();
    revokeQrPreviewUrl();
    currentQrPreviewUrl = URL.createObjectURL(blob);
    if (qrPreviewImage) {
      qrPreviewImage.src = currentQrPreviewUrl;
      qrPreviewImage.hidden = false;
    }
    if (qrPreviewPlaceholder) qrPreviewPlaceholder.hidden = true;
    if (downloadAuctionQrButton) downloadAuctionQrButton.disabled = false;
    setQrModalStatus("Preview ready.", "success");
  } catch (error) {
    resetQrPreview();
    setQrModalStatus(error.message || "Failed to generate QR code.", "error");
    showMessage(error.message || "Failed to generate QR code.", "error");
  } finally {
    previewAuctionQrButton.disabled = false;
  }
}

async function downloadAuctionQrCode() {
  if (!selectedQrAuction) return;
  downloadAuctionQrButton.disabled = true;
  setQrModalStatus("Preparing PNG download...", "info");

  try {
    const blob = await requestQrPngBlob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeShortName = String(selectedQrAuction.short_name || "auction").replace(/[^a-z0-9_-]/gi, "_");
    anchor.href = url;
    anchor.download = `auction-${safeShortName}-qr.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setQrModalStatus("PNG downloaded.", "success");
    showMessage("QR code downloaded", "success");
  } catch (error) {
    setQrModalStatus(error.message || "Failed to download QR code.", "error");
    showMessage(error.message || "Failed to download QR code.", "error");
  } finally {
    downloadAuctionQrButton.disabled = false;
  }
}

async function updateAuctionStatus(auctionId, status) {
  const normalizedStatus = normalizeAuctionStatus(status);
  const res = await window.AppAuth.authenticatedFetch(`${API}/auctions/update-status`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ auction_id: auctionId, status: normalizedStatus })
  });

  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }

  if (!res.ok) {
    throw new Error(data.error || "Failed to update status");
  }

  return data;
}

async function deleteAuctionById(auctionId, auctionFullName = "") {
  const res1 = await window.AppAuth.authenticatedFetch(`${API}/maintenance/auctions/list`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
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
      : `Are you sure you want to delete auction "${auctionFullName || auctionId}"?`
  );

  if (confirmed.canceled) return false;

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/auctions/delete`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
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

async function resetAuctionById(auctionId, auctionFullName = "") {
  const auctionLabel = auctionFullName || auctionId;
  const confirmMsg = `Delete all items from auction "${auctionLabel}"? Bidder and payment details will also be removed`;
  const password = await promptPassword(`Enter your current password to reset auction`, confirmMsg);
  if (!password) return false;

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/reset`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
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

async function deleteAuctionFromRow(auction) {
  const auctionId = Number(auction?.id);
  if (!auctionId) {
    showMessage("Missing auction ID.", "error");
    return;
  }

  const deleted = await deleteAuctionById(auctionId, auction.full_name || "");
  if (deleted) {
    refreshAuctions();
  }
}

async function resetAuctionFromRow(auction) {
  const auctionId = Number(auction?.id);
  if (!auctionId) {
    showMessage("Missing auction ID.", "error");
    return;
  }

  const reset = await resetAuctionById(auctionId, auction.full_name || "");
  if (reset) {
    refreshAuctions();
  }
}

async function purgeDeletedItemsByAuctionId(auctionId, deletedCountOverride = null) {
  const deletedCount = Number(deletedCountOverride ?? editAuctionModal?.dataset.auctionDeletedItemCount ?? 0);
  const confirmMsg = `Permanently delete ${deletedCount} deleted item(s) from auction ${auctionId}? Associated photo files will also be removed.`;
  const password = await promptPassword(`Enter your password to purge deleted items`, confirmMsg);
  if (!password) return false;

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/auctions/purge-deleted-items`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ auction_id: auctionId, password })
  });

  const data = await res.json();
  if (!res.ok) {
    showMessage(data.error || "Purge failed", "error");
    return false;
  }

  const purged = data.purged || {};
  showMessage(`Purged ${purged.items || 0} deleted item(s) and ${purged.photos || 0} photo file(s)`, "success");
  return true;
}

async function updateAuctionAdminStatePermission(auctionId, enabled) {
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/auctions/set-admin-state-permission`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
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

function ensureAuctionContextMenu() {
  if (auctionContextMenu) return auctionContextMenu;

  auctionContextMenu = document.createElement("div");
  auctionContextMenu.className = "item-context-menu auction-context-menu";
  auctionContextMenu.hidden = true;
  auctionContextMenu.setAttribute("role", "menu");
  document.body.appendChild(auctionContextMenu);
  return auctionContextMenu;
}

function closeAuctionContextMenu() {
  if (!auctionContextMenu) return;
  auctionContextMenu.hidden = true;
  auctionContextMenu.innerHTML = "";
  auctionContextMenu.removeAttribute("data-auction-id");
}

function positionAuctionContextMenu(menu, clientX, clientY) {
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.classList.remove("auction-context-menu--submenu-left");
  menu.hidden = false;

  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  if (clientX + menuRect.width + 190 + margin > window.innerWidth) {
    menu.classList.add("auction-context-menu--submenu-left");
  }
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);
  const left = Math.min(Math.max(clientX, margin), maxLeft);
  const top = Math.min(Math.max(clientY, margin), maxTop);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

async function updateAuctionStatusFromContext(auction, status) {
  const auctionId = Number(auction?.id);
  const normalizedStatus = normalizeAuctionStatus(status);
  if (!auctionId || normalizeAuctionStatus(auction?.status) === normalizedStatus) return;

  try {
    const data = await updateAuctionStatus(auctionId, normalizedStatus);
    showMessage(data.message || "Status updated", "success");
    refreshAuctions();
  } catch (error) {
    showMessage(error?.message || "Failed to update status", "error");
  }
}

async function toggleAuctionAdminStateFromContext(auction) {
  const auctionId = Number(auction?.id);
  if (!auctionId) {
    showMessage("Missing auction ID.", "error");
    return;
  }

  try {
    const enabled = !auction.admin_can_change_state;
    const data = await updateAuctionAdminStatePermission(auctionId, enabled);
    showMessage(data.message || "Auction permission updated", "success");
    refreshAuctions();
  } catch (error) {
    showMessage(error?.message || "Failed to update auction permission", "error");
  }
}

async function purgeDeletedItemsFromContext(auction) {
  const auctionId = Number(auction?.id);
  const deletedCount = Number(auction?.deleted_item_count || 0);
  if (!auctionId) {
    showMessage("Missing auction ID.", "error");
    return;
  }
  if (deletedCount <= 0) return;

  const purged = await purgeDeletedItemsByAuctionId(auctionId, deletedCount);
  if (purged) {
    refreshAuctions();
  }
}

function getAuctionContextMenuActions(auction) {
  const canReset = auction.status === "archived" || auction.status === "setup";
  const canPurge = Number(auction.deleted_item_count || 0) > 0;
  const canDelete = Number(auction.item_count || 0) <= 0;
  const shortName = String(auction.short_name || "").trim();
  const hasPublicUrl = shortName.length > 0;

  return [
    {
      id: "qr",
      label: "Generate QR code",
      run: () => openAuctionQrModal(auction)
    },
    {
      id: "edit",
      label: "Edit auction",
      run: () => openEditAuctionModal(auction)
    },
    {
      id: "test-data",
      label: "Generate test data/bids",
      run: () => openTestDataModal(auction)
    },
    {
      id: "public-page",
      label: "Open public page",
      disabled: !hasPublicUrl,
      disabledReason: "Auction has no URL tag",
      run: () => window.open(
        `${window.location.origin}/?auction=${encodeURIComponent(shortName)}`,
        "_blank",
        "noopener"
      )
    },
    {
      id: "manage-items",
      label: "Manage Items",
      disabled: !hasPublicUrl,
      disabledReason: "Auction has no URL tag",
      run: () => window.open(
        `${window.location.origin}/admin/index.html?auction=${encodeURIComponent(shortName)}`,
        "_blank",
        "noopener"
      )
    },
    {
      id: "admin-state",
      label: "Manage Items can set state",
      checked: !!auction.admin_can_change_state,
      run: () => toggleAuctionAdminStateFromContext(auction)
    },
    {
      id: "reset",
      label: "Reset auction",
      disabled: !canReset,
      disabledReason: "Only auctions in state setup or archived may be reset",
      run: () => resetAuctionFromRow(auction)
    },
    {
      id: "purge",
      label: "Purge deleted items",
      disabled: !canPurge,
      disabledReason: "No deleted items to purge",
      run: () => purgeDeletedItemsFromContext(auction)
    },
    {
      id: "delete",
      label: "Delete auction",
      disabled: !canDelete,
      disabledReason: "Cannot delete auction with items",
      run: () => deleteAuctionFromRow(auction)
    }
  ];
}

function renderAuctionContextMenuAction(action) {
  return `
    <button
      type="button"
      class="item-context-menu-action auction-context-menu-action"
      role="menuitem"
      data-action-id="${escapeHtml(action.id)}"
      ${action.disabled ? "disabled" : ""}
      ${action.disabledReason ? `title="${escapeHtml(action.disabledReason)}"` : ""}
    >
      <span class="auction-context-menu-check${action.checked ? " is-checked" : ""}" aria-hidden="true"></span>
      <span>${escapeHtml(action.label)}</span>
    </button>
  `;
}

function renderAuctionStatusSubmenu(auction) {
  const currentStatus = normalizeAuctionStatus(auction.status);
  return `
    <div class="auction-context-menu-submenu">
      <button
        type="button"
        class="item-context-menu-action auction-context-menu-action auction-context-menu-submenu-trigger"
        role="menuitem"
        aria-haspopup="true"
      >
        <span class="auction-context-menu-check" aria-hidden="true"></span>
        <span>Set State</span>
        <span class="auction-context-menu-submenu-caret" aria-hidden="true">></span>
      </button>
      <div class="auction-context-menu-submenu-panel" role="menu">
        ${AUCTION_STATUSES.map((status) => `
          <button
            type="button"
            class="item-context-menu-action auction-context-menu-action"
            role="menuitemradio"
            aria-checked="${status === currentStatus ? "true" : "false"}"
            data-status="${escapeHtml(status)}"
          >
            <span class="auction-context-menu-check${status === currentStatus ? " is-checked" : ""}" aria-hidden="true"></span>
            <span>${escapeHtml(status)}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function openAuctionContextMenu(row, event) {
  const auction = row?._auction;
  const auctionId = Number(auction?.id);
  if (!Number.isInteger(auctionId) || auctionId <= 0) return;

  closeMenuGroups();
  closeAuctionContextMenu();
  const menu = ensureAuctionContextMenu();
  const actions = getAuctionContextMenuActions(auction);
  const auctionName = auction.full_name || auction.short_name || `Auction ${auctionId}`;

  menu.dataset.auctionId = String(auctionId);
  menu.innerHTML = `
    <div class="item-context-menu-header">${escapeHtml(auctionName)}</div>
    <div class="item-context-menu-actions">
      ${actions.slice(0, 5).map(renderAuctionContextMenuAction).join("")}
      ${renderAuctionStatusSubmenu(auction)}
      ${actions.slice(5).map(renderAuctionContextMenuAction).join("")}
    </div>
  `;

  menu.querySelectorAll("[data-action-id]").forEach((button) => {
    const action = actions.find((candidate) => candidate.id === button.dataset.actionId);
    if (!action || action.disabled) return;
    button.addEventListener("click", async () => {
      closeAuctionContextMenu();
      await action.run();
    });
  });

  menu.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = button.dataset.status;
      closeAuctionContextMenu();
      await updateAuctionStatusFromContext(auction, status);
    });
  });

  positionAuctionContextMenu(menu, event.clientX, event.clientY);
  menu.querySelector(".item-context-menu-action:not(:disabled)")?.focus({ preventScroll: true });
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
  const savedTab = localStorage.getItem(MAINTENANCE_TAB_KEY) || "auction-management";
  const legacyTabMap = {
    "database-import-export": "database-backups",
    "add-new-auction": "auction-management",
    "test-data-generator": "auction-management",
    "csv-import-export": "diagnostics",
    "server-logs": "diagnostics",
    "messaging": "diagnostics"
  };
  const storedTab = legacyTabMap[savedTab] || savedTab;
  if (storedTab !== savedTab) {
    localStorage.setItem(MAINTENANCE_TAB_KEY, storedTab);
  }
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

  const auctionTableBody = document.getElementById("auction-table-body");
  auctionTableBody?.addEventListener("contextmenu", (event) => {
    const row = event.target.closest("tr");
    if (!row || !auctionTableBody.contains(row) || !row._auction) return;

    event.preventDefault();
    openAuctionContextMenu(row, event);
  });

  document.addEventListener("contextmenu", (event) => {
    if (!auctionContextMenu || auctionContextMenu.hidden) return;
    if (auctionTableBody?.contains(event.target)) return;
    closeAuctionContextMenu();
  });

  document.addEventListener("mousedown", (event) => {
    if (!auctionContextMenu || auctionContextMenu.hidden) return;
    if (auctionContextMenu.contains(event.target)) return;
    closeAuctionContextMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !auctionContextMenu || auctionContextMenu.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    closeAuctionContextMenu();
  }, true);

  window.addEventListener("scroll", closeAuctionContextMenu, true);
  window.addEventListener("resize", closeAuctionContextMenu);

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

  openAddAuctionModalButton?.addEventListener("click", openAddAuctionModal);
  closeAddAuctionModalButton?.addEventListener("click", closeAddAuctionModal);
  cancelAddAuctionButton?.addEventListener("click", closeAddAuctionModal);
  addAuctionModal?.addEventListener("click", (event) => {
    if (event.target === addAuctionModal) {
      closeAddAuctionModal();
    }
  });

  closeTestDataModalButton?.addEventListener("click", closeTestDataModal);
  cancelTestDataButton?.addEventListener("click", closeTestDataModal);
  testDataModal?.addEventListener("click", (event) => {
    if (event.target === testDataModal && !testDataBusy) {
      closeTestDataModal();
    }
  });

  refreshMessagingStatsButton?.addEventListener("click", () => {
    void loadMessagingStats({ announce: true });
  });
  exportMessagingCacheButton?.addEventListener("click", () => {
    void exportMessagingCache();
  });
  clearMessagingCacheButton?.addEventListener("click", () => {
    void clearMessagingCache();
  });

  closeEditAuctionModalButton?.addEventListener("click", closeEditAuctionModal);
  cancelEditAuctionButton?.addEventListener("click", closeEditAuctionModal);
  editAuctionModal?.addEventListener("click", (event) => {
    if (event.target === editAuctionModal) {
      closeEditAuctionModal();
    }
  });

  closeBackupInfoModalButton?.addEventListener("click", () => closeModal(backupInfoModal));
  backupInfoModal?.addEventListener("click", (event) => {
    if (event.target === backupInfoModal) {
      closeModal(backupInfoModal);
    }
  });

  closeBackupRestoreModalButton?.addEventListener("click", () => closeModal(backupRestoreModal));
  cancelBackupRestoreButton?.addEventListener("click", () => closeModal(backupRestoreModal));
  backupRestoreModal?.addEventListener("click", (event) => {
    if (event.target === backupRestoreModal) {
      closeModal(backupRestoreModal);
    }
  });

  openCreateBackupModalButton?.addEventListener("click", () => {
    setBackupOperationStatus("No backup operation running.");
    setCreateBackupLog("");
    openModal(createBackupModal);
    backupNoteInput?.focus();
  });
  closeCreateBackupModalButton?.addEventListener("click", () => closeModal(createBackupModal));
  cancelCreateBackupButton?.addEventListener("click", () => closeModal(createBackupModal));
  createBackupModal?.addEventListener("click", (event) => {
    if (event.target === createBackupModal) {
      closeModal(createBackupModal);
    }
  });

  openImportBackupModalButton?.addEventListener("click", () => {
    if (!canRestoreDatabase()) return;
    resetImportBackupPreview();
    openModal(importBackupModal);
    importBackupFileInput?.focus();
  });
  closeImportBackupModalButton?.addEventListener("click", () => closeModal(importBackupModal));
  cancelImportBackupButton?.addEventListener("click", () => closeModal(importBackupModal));
  importBackupModal?.addEventListener("click", (event) => {
    if (event.target === importBackupModal) {
      closeModal(importBackupModal);
    }
  });
  importBackupFileInput?.addEventListener("change", () => {
    pendingBackupImport = null;
    setImportBackupStatus("Selected file ready to inspect.", "info");
    setImportBackupProgress({ hidden: true });
    renderImportValidation(null);
    renderImportComparison(null);
    if (importBackupDetailTitle) importBackupDetailTitle.textContent = "Import Preview";
    if (importBackupDetailSubtitle) importBackupDetailSubtitle.textContent = "Preview metadata will appear after inspection.";
    if (importBackupDetailGrid) importBackupDetailGrid.innerHTML = "";
    if (importBackupComponentSummary) importBackupComponentSummary.innerHTML = "";
    if (importBackupAuctionTableBody) {
      importBackupAuctionTableBody.innerHTML = '<tr><td colspan="5">No backup inspected yet.</td></tr>';
    }
    updateBackupActionState();
  });

  openAddUserModalButton?.addEventListener("click", () => {
    resetAddUserForm();
    openModal(addUserModal);
    document.getElementById("new-user-username")?.focus();
  });
  closeAddUserModalButton?.addEventListener("click", () => closeModal(addUserModal));
  cancelAddUserButton?.addEventListener("click", () => closeModal(addUserModal));
  addUserModal?.addEventListener("click", (event) => {
    if (event.target === addUserModal) {
      closeModal(addUserModal);
    }
  });

  closeEditUserModalButton?.addEventListener("click", closeEditUserModal);
  cancelEditUserButton?.addEventListener("click", closeEditUserModal);
  editUserModal?.addEventListener("click", (event) => {
    if (event.target === editUserModal) {
      closeEditUserModal();
    }
  });
}

bindMaintenanceShell();
updateVersionDisplays();
setBackupOperationStatus("No backup operation running.");
resetImportBackupPreview();
updateBackupActionState();
checkToken();

window.addEventListener("beforeunload", () => {
  if (logPopupWindow && !logPopupWindow.closed) {
    logPopupWindow.close();
  }
});

function promptPassword(message, message2 = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "password-modal-overlay";

    const box = document.createElement("div");
    box.className = "password-modal-card";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    const heading = document.createElement("h3");
    heading.className = "password-modal-title";
    heading.textContent = message;

    const description = document.createElement("p");
    description.className = "password-modal-description";
    description.textContent = message2;
    description.hidden = !message2;

    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "current-password";
    input.className = "password-modal-input";
    input.setAttribute("aria-label", "Current password");

    const row = document.createElement("div");
    row.className = "password-modal-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.className = "password-modal-button";

    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "OK";
    ok.className = "password-modal-button password-modal-button--primary";

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
    box.append(heading, description, input, row);
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
  });
}

function promptPasswordChange() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "password-modal-overlay";

    const box = document.createElement("div");
    box.className = "password-modal-card";

    const heading = document.createElement("div");
    heading.textContent = "Change password";
    heading.className = "password-modal-title";

    const currentInput = document.createElement("input");
    currentInput.type = "password";
    currentInput.placeholder = "Current password";
    currentInput.autocomplete = "current-password";
    currentInput.className = "password-modal-input";

    const newInput = document.createElement("input");
    newInput.type = "password";
    newInput.placeholder = "New password";
    newInput.autocomplete = "new-password";
    newInput.className = "password-modal-input";

    const confirmInput = document.createElement("input");
    confirmInput.type = "password";
    confirmInput.placeholder = "Confirm new password";
    confirmInput.autocomplete = "new-password";
    confirmInput.className = "password-modal-input";

    const row = document.createElement("div");
    row.className = "password-modal-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.className = "password-modal-button";

    const submit = document.createElement("button");
    submit.type = "button";
    submit.textContent = "Update";
    submit.className = "password-modal-button password-modal-button--primary";

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
  const session = window.__APP_AUTH_READY__ ? await window.__APP_AUTH_READY__ : await window.AppAuth?.refreshSession?.();
  if (session?.user) {
    token = session.csrf_token || getAuthToken();
    currentUsername = session.user.username || null;
    currentMaintenanceUser = session.user;
    setMaintenanceUserMenu(currentUsername);
    applyUserManagementAccess(session.user);
    updateBackupActionState();
    loginSection.style.display = "none";
    maintenanceSection.style.display = "grid";
    refreshAuctions();
    checkIntegritySummary();
    loadPptxImageList();
    loadManagedBackups();
    if (canManageUsers(session.user)) {
      loadUsers();
    }
    startAutoRefresh();
    loadEnabledPaymentMethods();
    if (localStorage.getItem(MAINTENANCE_TAB_KEY) === "diagnostics") {
      loadMessagingStats();
    }
    updateVersionDisplays(session.versions);
  } else {
    logOut();
  }
}


document.getElementById("login-button").addEventListener("click", async () => {
  window.location.replace("/login.html");
});

document.getElementById("backup-db").onclick = async () => {
  try {
    backupOperationBusy = true;
    updateBackupActionState();
    setBackupOperationStatus("Creating managed backup on the server...", "info");
    setCreateBackupLog("[pending] Creating managed backup...");

    const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/backup`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ note: backupNoteInput?.value || "" })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to create backup.");
    }

    setBackupOperationStatus(`Created backup ${data.filename}.`, "success");
    setCreateBackupLog(data.backup_log || `Created ${data.filename}`);
    showMessage(data.message || "Backup created.", "success");
    if (backupNoteInput) {
      backupNoteInput.value = "";
    }
    await loadManagedBackups({ preserveSelection: false });
    if (data.backup_id) {
      await selectManagedBackup(data.backup_id);
    }
  } catch (error) {
    setBackupOperationStatus(error.message || "Backup failed.", "error");
    setCreateBackupLog(`[error] ${error.message || "Backup failed."}`);
    showMessage(error.message || "Backup failed.", "error");
  } finally {
    backupOperationBusy = false;
    updateBackupActionState();
  }
};

inspectImportedBackupButton?.addEventListener("click", async () => {
  if (!canRestoreDatabase()) {
    showMessage("Restore Database permission is required.", "error");
    return;
  }
  if (!importBackupFileInput?.files?.length) {
    showMessage("Select a backup zip to inspect.", "info");
    return;
  }

  const formData = new FormData();
  formData.append("backup", importBackupFileInput.files[0]);

  try {
    backupOperationBusy = true;
    updateBackupActionState();
    pendingBackupImport = null;
    setImportBackupStatus("Uploading backup archive...", "info");
    setImportBackupProgress({
      hidden: false,
      label: "Uploading backup archive...",
      percent: 0
    });
    renderImportValidation(null);
    renderImportComparison(null);

    const data = await postFormDataWithUploadProgress(`${API}/maintenance/backups/import/inspect`, formData, (event) => {
      if (event.lengthComputable) {
        const percent = (event.loaded / event.total) * 100;
        setImportBackupProgress({
          hidden: false,
          label: "Uploading backup archive...",
          percent
        });
      } else {
        setImportBackupProgress({
          hidden: false,
          label: "Uploading backup archive...",
          percent: null
        });
      }
    });
    setImportBackupStatus("Inspecting uploaded backup archive...", "info");
    setImportBackupProgress({
      hidden: false,
      label: "Inspecting uploaded backup archive...",
      percent: 100
    });

    pendingBackupImport = data;
    renderImportValidation(data);
    renderImportComparison(data);
    renderBackupDetailSummary(data.preview, {
      titleEl: importBackupDetailTitle,
      subtitleEl: importBackupDetailSubtitle,
      gridEl: importBackupDetailGrid,
      componentEl: importBackupComponentSummary,
      auctionTableBody: importBackupAuctionTableBody,
      titlePrefix: "Import Preview"
    });
    setImportBackupStatus(
      data.can_import
        ? "Backup archive passed inspection and can be imported."
        : "Backup archive inspection found blocking problems.",
      data.can_import ? "success" : "error"
    );
    setImportBackupProgress({ hidden: true });
  } catch (error) {
    setImportBackupProgress({ hidden: true });
    setImportBackupStatus(error.message || "Backup inspection failed.", "error");
    renderImportValidation({
      blocking_errors: [error.message || "Backup inspection failed."],
      warnings: []
    });
    showMessage(error.message || "Backup inspection failed.", "error");
  } finally {
    backupOperationBusy = false;
    updateBackupActionState();
  }
});

confirmImportBackupButton?.addEventListener("click", async () => {
  if (!canRestoreDatabase()) {
    showMessage("Restore Database permission is required.", "error");
    return;
  }
  if (!pendingBackupImport?.import_token || !pendingBackupImport?.can_import) {
    showMessage("Inspect a valid backup archive before importing.", "info");
    return;
  }

  const sourceLabel = pendingBackupImport?.preview?.archive_backup_id
    ? `source backup #${pendingBackupImport.preview.archive_backup_id}`
    : "this backup";
  const confirmed = await confirmMaintenanceAction(
    `Import <strong>${escapeHtml(sourceLabel)}</strong> into this server's backup list?`,
    {
      okText: "Import Backup",
      cancelText: "Cancel",
      height: 70
    }
  );
  if (!confirmed) return;

  try {
    backupOperationBusy = true;
    updateBackupActionState();
    setImportBackupStatus("Importing backup into the server backup store...", "info");

    const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/backups/import/confirm`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ import_token: pendingBackupImport.import_token })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to import backup archive.");
    }

    setImportBackupStatus(data.message || "Backup imported.", "success");
    showMessage(data.message || "Backup imported.", "success");
    const importedBackupId = data.backup?.backup_id || null;
    resetImportBackupPreview();
    closeModal(importBackupModal);
    await loadManagedBackups({ preserveSelection: false });
    if (importedBackupId) {
      await selectManagedBackup(importedBackupId);
    }
  } catch (error) {
    setImportBackupStatus(error.message || "Backup import failed.", "error");
    showMessage(error.message || "Backup import failed.", "error");
  } finally {
    backupOperationBusy = false;
    updateBackupActionState();
  }
});

refreshBackupsButton?.addEventListener("click", () => {
  void loadManagedBackups();
});

async function downloadManagedBackupById(backupId) {
  if (!canRestoreDatabase()) {
    showMessage("Restore Database permission is required.", "error");
    return;
  }
  await selectManagedBackup(backupId, { silent: true });
  if (!selectedBackupDetail?.backup_id) {
    showMessage("Backup details are unavailable.", "error");
    return;
  }

  backupOperationBusy = true;
  updateBackupActionState();
  setBackupOperationStatus(`Downloading ${selectedBackupDetail.filename}...`, "info");

  try {
    const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/backups/${encodeURIComponent(selectedBackupDetail.backup_id)}/download`, {
      headers: { "X-CSRF-Token": token }
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to download backup.");
    }

    const disposition = res.headers.get("Content-Disposition");
    let filename = selectedBackupDetail.filename || "managed-backup.zip";
    if (disposition && disposition.includes("filename=")) {
      const match = disposition.match(/filename=\"?([^\";]+)\"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.setAttribute("download", filename);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);

    setBackupOperationStatus(`Downloaded ${filename}.`, "success");
  } catch (error) {
    setBackupOperationStatus(error.message || "Backup download failed.", "error");
    showMessage(error.message || "Backup download failed.", "error");
  } finally {
    backupOperationBusy = false;
    updateBackupActionState();
  }
}

async function deleteManagedBackupById(backupId) {
  await selectManagedBackup(backupId, { silent: true });
  if (!selectedBackupDetail?.backup_id) {
    showMessage("Backup details are unavailable.", "error");
    return;
  }

  const backupLabel = formatBackupDisplayLabel(selectedBackupDetail);
  const confirmed = await confirmMaintenanceAction(
    `Delete <strong>${escapeHtml(backupLabel)}</strong>?<br><br>This cannot be undone.`,
    {
      okText: "Delete Backup",
      cancelText: "Cancel",
      height: 90
    }
  );
  if (!confirmed) return;

  backupOperationBusy = true;
  updateBackupActionState();
  setBackupOperationStatus(`Deleting ${backupLabel}...`, "info");

  try {
    const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/backups/${encodeURIComponent(selectedBackupDetail.backup_id)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to delete backup.");
    }

    selectedBackupId = null;
    selectedBackupDetail = null;
    lastManagedRestoreLog = "";
    if (backupRestoreLog) {
      backupRestoreLog.textContent = "No restore log captured yet.";
    }
    setBackupOperationStatus(data.message || "Backup deleted.", "success");
    showMessage(data.message || "Backup deleted.", "success");
    await loadManagedBackups({ preserveSelection: false });
  } catch (error) {
    setBackupOperationStatus(error.message || "Backup delete failed.", "error");
    showMessage(error.message || "Backup delete failed.", "error");
  } finally {
    backupOperationBusy = false;
    updateBackupActionState();
  }
}

restoreSelectedBackupButton?.addEventListener("click", async () => {
  if (!canRestoreDatabase()) {
    showMessage("Restore Database permission is required.", "error");
    return;
  }
  if (!selectedBackupDetail?.backup_id) {
    showMessage("Select a backup first.", "info");
    return;
  }

  const restoreDb = Boolean(backupRestoreDb?.checked);
  const restorePhotos = Boolean(backupRestorePhotos?.checked);
  const restoreResources = Boolean(backupRestoreResources?.checked);
  if (!restoreDb && !restorePhotos && !restoreResources) {
    showMessage("Select at least one restore component.", "info");
    return;
  }

  const components = [
    restoreDb ? "database" : null,
    restorePhotos ? "photos" : null,
    restoreResources ? "resources" : null
  ].filter(Boolean);
  const backupLabel = formatBackupDisplayLabel(selectedBackupDetail);
  const confirmed = await confirmMaintenanceAction(
    `Restore ${escapeHtml(components.join(", "))} from <strong>${escapeHtml(backupLabel)}</strong>?`,
    {
      okText: "Restore",
      cancelText: "Cancel",
      height: 70
    }
  );
  if (!confirmed) return;

  backupOperationBusy = true;
  updateBackupActionState();
  setBackupOperationStatus(`Restoring ${components.join(", ")} from ${backupLabel}...`, "info");

  try {
    const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/backups/${encodeURIComponent(selectedBackupDetail.backup_id)}/restore`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ restoreDb, restorePhotos, restoreResources })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Restore failed.");
    }

    lastManagedRestoreLog = data.restore_log || "";
    if (backupRestoreLog) {
      backupRestoreLog.textContent = lastManagedRestoreLog || "No restore log captured.";
    }
    setBackupOperationStatus(data.message || "Restore completed.", "success");
    showMessage(data.message || "Restore completed.", "success");
    closeModal(backupRestoreModal);
    if (restoreDb) {
      await window.AppAuth?.refreshSession?.();
    }
    await loadManagedBackups();
    await refreshAuctions();
    await loadPptxImageList();
  } catch (error) {
    setBackupOperationStatus(error.message || "Restore failed.", "error");
    showMessage(error.message || "Restore failed.", "error");
  } finally {
    backupOperationBusy = false;
    updateBackupActionState();
  }
});

saveRestoreLogButton?.addEventListener("click", () => {
  if (!lastManagedRestoreLog) {
    showMessage("No restore log available to save.", "info");
    return;
  }

  const blob = new Blob([lastManagedRestoreLog], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `restore_log_${selectedBackupDetail?.backup_id || "backup"}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
});

document.getElementById("export-csv").onclick = async () => {
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/export`, {
    headers: { "X-CSRF-Token": token }
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



// document.getElementById("import-csv-btn").onclick = async () => {
//   const fileInput = document.getElementById("import-csv");
//   if (!fileInput.files.length) return showMessage("Select a file", "info");
//   const formData = new FormData();
//   formData.append("csv", fileInput.files[0]);
//   const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/import`, {
//     method: "POST",
//     headers: { "X-CSRF-Token": token },
//     body: formData
//   });
//   const data = await res.json();
//   if (res.ok) {
//     showMessage(data.message || "Import complete", "success");
//   } else {
//     showMessage(data.error || "Import failed", "error");
//   }
// };

function renderStorageReport(data) {
  if (!photoStorageResults) return;

  const totals = data.totals || {};
  const counts = data.counts || {};
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const countCards = [
    ["Auctions", counts.auctions],
    ["Items", counts.items],
    ["Resources", counts.resources]
  ];

  photoStorageResults.style.display = "block";
  photoStorageResults.innerHTML = `
    <div class="storage-report-summary">
      <div class="storage-report-stat">
        <span>Total occupied</span>
        <strong>${escapeHtml(formatBytes(totals.occupied_bytes))}</strong>
      </div>
      <div class="storage-report-stat">
        <span>Free across mounts</span>
        <strong>${escapeHtml(formatNullableBytes(totals.free_bytes))}</strong>
      </div>
      <div class="storage-report-stat">
        <span>Mounts counted</span>
        <strong>${escapeHtml(formatInteger(totals.unique_mount_count))}</strong>
      </div>
      <div class="storage-report-stat">
        <span>Mount capacity</span>
        <strong>${escapeHtml(formatNullableBytes(totals.capacity_bytes))}</strong>
      </div>
    </div>
    <div class="storage-report-counts">
      ${countCards.map(([label, value]) => `
        <div class="storage-report-stat">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(formatCountLimit(value?.count, value?.limit))}</strong>
        </div>
      `).join("")}
    </div>
    <div class="table-wrap storage-report-table-wrap">
      <table class="maintenance-data-table storage-report-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Occupied</th>
            <th>Free on mount</th>
            <th>Mount size</th>
            <th>Path</th>
          </tr>
        </thead>
        <tbody>
          ${categories.map((category) => `
            <tr>
              <td>
                <strong>${escapeHtml(category.label || category.key || "Unknown")}</strong>
                ${category.error ? `<div class="storage-report-warning">${escapeHtml(category.error)}</div>` : ""}
              </td>
              <td>${escapeHtml(formatBytes(category.occupied_bytes))}</td>
              <td>${escapeHtml(formatNullableBytes(category.free_bytes))}</td>
              <td>${escapeHtml(formatNullableBytes(category.capacity_bytes))}</td>
              <td><code>${escapeHtml(category.path || "")}</code></td>
            </tr>
          `).join("")}
        </tbody>

      </table>
    </div>
  `;
}

document.getElementById("photo-report").onclick = async () => {
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/photo-report`, { headers: { "X-CSRF-Token": token } });
  const data = await res.json();
  if (!res.ok) {
    return showMessage(data.error || "Could not get storage report.", "error");
  }
  renderStorageReport(data);
 // showMessage(`Stored images: ${formatInteger(data.count)}, Total image size: ${formatBytes(data.totalSize)}`, "success");
};

function renderLogs(target, rawText) {
  target.replaceChildren();
  const levelPattern = /(\[(?:DEBUG|INFO|WARN|ERROR)\])/g;
  String(rawText || "").split("\n").forEach((line, lineIndex, lines) => {
    line.split(levelPattern).forEach((part) => {
      const level = /^\[(DEBUG|INFO|WARN|ERROR)\]$/.exec(part)?.[1];
      if (!level) {
        target.appendChild(document.createTextNode(part));
        return;
      }
      const span = document.createElement("span");
      span.className = `log-level log-level-${level.toLowerCase()}`;
      span.textContent = part;
      target.appendChild(span);
    });
    if (lineIndex < lines.length - 1) target.appendChild(document.createElement("br"));
  });
}

const USER_ROLE_ORDER = ["admin", "cashier", "maintenance", "slideshow"];
const USER_PERMISSION_ORDER = ["live_feed", "admin_bidding", "manage_users", "restore_database"];
const ACCESS_DEPENDENCIES = [
  { permission: "admin_bidding", role: "admin" },
  { permission: "manage_users", role: "maintenance" },
  { permission: "restore_database", role: "maintenance" }
];
const USER_ACTION_ICONS = Object.freeze({
  edit: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"></path>
    </svg>
  `,
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

function syncGrantableRoleCheckboxes(scope = document) {
  scope.querySelectorAll('input[name="new-user-role"], input[name="edit-user-role"], input[data-access-role]').forEach((roleInput) => {
    const actorCanGrant = roleInput.dataset.actorCanGrant !== "false";
    const lockedForSelf = roleInput.dataset.lockedSelf === "true";
    const lockedForRoot = roleInput.dataset.lockedRoot === "true";
    roleInput.disabled = !actorCanGrant || lockedForSelf || lockedForRoot;
  });
}

function syncGrantablePermissionCheckboxes(scope = document) {
  scope.querySelectorAll('input[name="new-user-permission"], input[name="edit-user-permission"], input[data-access-permission]').forEach((permissionInput) => {
    const actorCanGrant = permissionInput.dataset.actorCanGrant !== "false";
    const lockedForSelf = permissionInput.dataset.lockedSelf === "true";
    const lockedForRoot = permissionInput.dataset.lockedRoot === "true";
    permissionInput.disabled = !actorCanGrant || lockedForSelf || lockedForRoot;
  });
}

function findRoleInputForPermission(scope, permissionInput, role) {
  if (permissionInput.name === "new-user-permission") {
    return scope.querySelector(`input[name="new-user-role"][value="${role}"]`);
  }
  if (permissionInput.name === "edit-user-permission") {
    return scope.querySelector(`input[name="edit-user-role"][value="${role}"]`);
  }
  return scope.querySelector(`input[data-access-role="${role}"]`);
}

function syncDependentAccessCheckboxes(scope = document) {
  ACCESS_DEPENDENCIES.forEach(({ permission, role }) => {
    scope.querySelectorAll(`input[value="${permission}"]`).forEach((permissionInput) => {
      const roleInput = findRoleInputForPermission(scope, permissionInput, role);

      const allowedByRole = Boolean(roleInput?.checked);
      const actorCanGrant = permissionInput.dataset.actorCanGrant !== "false";
      const lockedForSelf = permissionInput.dataset.lockedSelf === "true";
      const lockedForRoot = permissionInput.dataset.lockedRoot === "true";
      const allowed = allowedByRole && actorCanGrant && !lockedForSelf && !lockedForRoot;
      permissionInput.disabled = !allowed;
      if (!allowedByRole) {
        permissionInput.checked = false;
      }
    });
  });
}

function syncAccessEditorState(scope = document) {
  syncGrantableRoleCheckboxes(scope);
  syncGrantablePermissionCheckboxes(scope);
  syncDependentAccessCheckboxes(scope);
  updateAccessAvailability(addUserModal || document, 'input[name="new-user-role"], input[name="new-user-permission"]', addUserAccessNote);
  updateAccessAvailability(editUserModal || document, 'input[name="edit-user-role"], input[name="edit-user-permission"]', editUserAccessNote);
}

function updateAccessAvailability(scope, selector, note) {
  let hasUnavailableAccess = false;

  scope.querySelectorAll(selector).forEach((input) => {
    const item = input.closest(".user-access-item");
    if (!item) return;

    const unavailable = input.dataset.actorCanGrant === "false"
      || input.dataset.lockedSelf === "true"
      || input.dataset.lockedRoot === "true";
    item.classList.toggle("user-access-item--unavailable", unavailable);
    if (unavailable) {
      hasUnavailableAccess = true;
    }
  });

  if (note) {
    note.hidden = !hasUnavailableAccess;
  }
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

  const res = await window.AppAuth.authenticatedFetch(`${API}/change-password`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": getAuthToken(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ currentPassword, newPassword })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message || "Password updated.", "success");
    window.AppAuth?.clearAllSessions?.({ broadcast: true });
    window.setTimeout(() => window.location.replace("/login.html?reason=signed_out"), 800);
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

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/users`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": getAuthToken(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password, roles, permissions })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message || "User created.", "success");
    resetAddUserForm();
    closeModal(addUserModal);
    loadUsers();
  } else {
    showMessage(data.error || "Failed to create user.", "error");
  }
};

function userHasRoleAccess(user, role) {
  return Array.isArray(user?.roles) && user.roles.includes(role);
}

function userHasPermissionAccess(user, permission) {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

function createAccessIndicator(enabled) {
  const indicator = document.createElement("span");
  indicator.className = `user-access-indicator${enabled ? " is-enabled" : ""}`;
  indicator.setAttribute("aria-label", enabled ? "Access granted" : "Access not granted");
  indicator.title = enabled ? "Access granted" : "Access not granted";
  indicator.innerHTML = enabled ? "&#10003;" : "&ndash;";
  return indicator;
}

function setupAccessInput(input, { isCurrentUser = false, isRoot = false } = {}) {
  const isRoleInput = input.name === "new-user-role" || input.name === "edit-user-role";
  input.dataset.actorCanGrant = isRoleInput
    ? (canGrantRole(input.value) ? "true" : "false")
    : (canGrantPermission(input.value) ? "true" : "false");
  input.dataset.originalChecked = input.checked ? "true" : "false";
  input.dataset.lockedSelf = isCurrentUser ? "true" : "false";
  input.dataset.lockedRoot = isRoot ? "true" : "false";
}

function getEditUserAccessInputs() {
  return Array.from(editUserModal?.querySelectorAll('input[name="edit-user-role"], input[name="edit-user-permission"]') || []);
}

function populateEditUserModal(user) {
  const isCurrentUser = user.username === currentUsername;
  const isRoot = Boolean(user.is_root);
  selectedEditUser = user;
  if (editUserUsernameInput) {
    editUserUsernameInput.value = user.username || "";
  }
  clearEditUserPasswordFields();

  getEditUserAccessInputs().forEach((input) => {
    if (input.name === "edit-user-role") {
      input.checked = userHasRoleAccess(user, input.value);
    } else {
      input.checked = userHasPermissionAccess(user, input.value);
    }
    setupAccessInput(input, { isCurrentUser, isRoot });
  });

  syncAccessEditorState(editUserModal || document);
  if (saveEditUserAccessButton) {
    saveEditUserAccessButton.disabled = isCurrentUser || isRoot;
    saveEditUserAccessButton.title = isCurrentUser
      ? "You cannot change your own access"
      : (isRoot ? "The root user's access cannot be changed" : "");
  }
  if (changeEditUserPasswordButton) {
    changeEditUserPasswordButton.disabled = isRoot;
    changeEditUserPasswordButton.title = isRoot ? "The root password cannot be changed here" : "";
  }
}

function openEditUserModal(user) {
  populateEditUserModal(user);
  openModal(editUserModal);
  editUserPasswordInput?.focus();
}

function collectEditUserAccess() {
  const roles = Array.from(editUserModal?.querySelectorAll('input[name="edit-user-role"]:checked') || []).map((el) => el.value);
  const permissions = Array.from(editUserModal?.querySelectorAll('input[name="edit-user-permission"]:checked') || []).map((el) => el.value);
  return { roles, permissions };
}

saveEditUserAccessButton?.addEventListener("click", async () => {
  if (!selectedEditUser) return;
  const { roles, permissions } = collectEditUserAccess();
  if (roles.length === 0 && permissions.length === 0) {
    showMessage("A user must have at least one access option.", "error");
    return;
  }

  const updateRes = await window.AppAuth.authenticatedFetch(`${API}/maintenance/users/${encodeURIComponent(selectedEditUser.username)}/access`, {
    method: "PATCH",
    headers: {
      "X-CSRF-Token": getAuthToken(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roles, permissions })
  });
  const updateData = await updateRes.json();
  if (updateRes.ok) {
    showMessage(updateData.message || "Access updated.", "success");
    closeEditUserModal();
    loadUsers();
  } else {
    showMessage(updateData.error || "Failed to update access.", "error");
  }
});

changeEditUserPasswordButton?.addEventListener("click", async () => {
  if (!selectedEditUser) return;
  const newPassword = editUserPasswordInput?.value || "";
  const confirmPassword = editUserConfirmPasswordInput?.value || "";
  if (!newPassword || !confirmPassword) {
    showMessage("Both password fields are required.", "error");
    return;
  }
  if (newPassword !== confirmPassword) {
    showMessage("Passwords do not match.", "error");
    return;
  }

  const pwRes = await window.AppAuth.authenticatedFetch(`${API}/maintenance/users/${encodeURIComponent(selectedEditUser.username)}/password`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": getAuthToken(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ newPassword })
  });
  const pwData = await pwRes.json();
  if (pwRes.ok) {
    showMessage(pwData.message || "Password updated.", "success");
    clearEditUserPasswordFields();
  } else {
    showMessage(pwData.error || "Failed to set password.", "error");
  }
});

async function loadUsers() {
  const tableBody = document.getElementById("user-table-body");
  if (!tableBody || !canManageUsers()) {
    clearUserManagementData();
    return;
  }

  const authToken = getAuthToken();
  if (!authToken) return;

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/users`, {
    headers: { "X-CSRF-Token": authToken }
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
    td.colSpan = 10;
    td.textContent = "No users found.";
    tr.appendChild(td);
    tableBody.appendChild(tr);
    return;
  }

  users.forEach((user) => {
    const tr = document.createElement("tr");
    const isCurrentUser = user.username === currentUsername;

    const usernameTd = document.createElement("td");
    usernameTd.textContent = isCurrentUser ? `${user.username} (you)` : user.username;
    tr.appendChild(usernameTd);

    USER_ROLE_ORDER.forEach((role) => {
      const td = document.createElement("td");
      td.style.textAlign = "center";
      td.appendChild(createAccessIndicator(userHasRoleAccess(user, role)));
      tr.appendChild(td);
    });

    USER_PERMISSION_ORDER.forEach((permission) => {
      const td = document.createElement("td");
      td.style.textAlign = "center";
      td.appendChild(createAccessIndicator(userHasPermissionAccess(user, permission)));
      tr.appendChild(td);
    });

    const actionsTd = document.createElement("td");
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "maintenance-user-actions";

    const logoutNowBtn = createUserActionButton(USER_ACTION_ICONS.logout, "Log out user from all current sessions");
    logoutNowBtn.onclick = async () => {
      const confirmed = await confirmMaintenanceAction(
        `Log out <strong>${escapeHtml(user.username)}</strong> from all current sessions?`,
        {
          okText: "Log Out User",
          cancelText: "Cancel",
          height: 70
        }
      );
      if (!confirmed) return;
      const logoutRes = await window.AppAuth.authenticatedFetch(`${API}/maintenance/users/${encodeURIComponent(user.username)}/logout-now`, {
        method: "POST",
        headers: { "X-CSRF-Token": getAuthToken() }
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
      const editBtn = createUserActionButton(USER_ACTION_ICONS.edit, "Edit user");
      editBtn.onclick = () => openEditUserModal(user);

      const deleteBtn = createUserActionButton(USER_ACTION_ICONS.trash, "Delete user", {
        disabled: user.username === currentUsername
      });
      deleteBtn.onclick = async () => {
        const confirmed = await confirmMaintenanceAction(
          `Delete user <strong>${escapeHtml(user.username)}</strong>?`,
          {
            okText: "Delete User",
            cancelText: "Cancel",
            height: 70
          }
        );
        if (!confirmed) return;
        const delRes = await window.AppAuth.authenticatedFetch(`${API}/maintenance/users/${encodeURIComponent(user.username)}`, {
          method: "DELETE",
          headers: { "X-CSRF-Token": getAuthToken() }
        });
        const delData = await delRes.json();
        if (delRes.ok) {
          showMessage(delData.message || "User deleted.", "success");
          loadUsers();
        } else {
          showMessage(delData.error || "Failed to delete user.", "error");
        }
      };

      actionsWrap.appendChild(editBtn);
      actionsWrap.appendChild(logoutNowBtn);
      actionsWrap.appendChild(deleteBtn);
    } else {
      const editBtn = createUserActionButton(USER_ACTION_ICONS.edit, "The root user cannot be edited here", {
        disabled: true
      });
      actionsWrap.appendChild(editBtn);
      actionsWrap.appendChild(logoutNowBtn);
    }
    actionsTd.appendChild(actionsWrap);
    tr.appendChild(actionsTd);

    tableBody.appendChild(tr);
  });
}

document.querySelectorAll('input[name="new-user-role"]').forEach((input) => {
  setupAccessInput(input);
  input.addEventListener("change", () => {
    syncAccessEditorState(addUserModal || document);
  });
});
document.querySelectorAll('input[name="new-user-permission"]').forEach((input) => {
  setupAccessInput(input);
  input.addEventListener("change", () => {
    syncAccessEditorState(addUserModal || document);
  });
});
getEditUserAccessInputs().forEach((input) => {
  setupAccessInput(input);
  input.addEventListener("change", () => {
    syncAccessEditorState(editUserModal || document);
  });
});
syncAccessEditorState(addUserModal || document);
syncAccessEditorState(editUserModal || document);

window.addEventListener(window.AppAuth?.SESSION_EVENT || "appauth:session", (event) => {
  const session = event.detail || null;
  token = session?.csrf_token || getAuthToken();
  currentMaintenanceUser = session?.user || null;
  currentUsername = session?.user?.username || currentUsername;
  setMaintenanceUserMenu(currentUsername);
  applyUserManagementAccess(currentMaintenanceUser);
  updateBackupActionState();
  document.querySelectorAll('input[name="new-user-role"]').forEach((input) => {
    input.dataset.actorCanGrant = canGrantRole(input.value, currentMaintenanceUser) ? "true" : "false";
  });
  document.querySelectorAll('input[name="new-user-permission"]').forEach((input) => {
    input.dataset.actorCanGrant = canGrantPermission(input.value, currentMaintenanceUser) ? "true" : "false";
  });
  getEditUserAccessInputs().forEach((input) => {
    const isRoleInput = input.name === "edit-user-role";
    input.dataset.actorCanGrant = isRoleInput
      ? (canGrantRole(input.value, currentMaintenanceUser) ? "true" : "false")
      : (canGrantPermission(input.value, currentMaintenanceUser) ? "true" : "false");
  });
  syncAccessEditorState(addUserModal || document);
  syncAccessEditorState(editUserModal || document);
  updateVersionDisplays(session?.versions || currentVersions);
  if (canManageUsers(currentMaintenanceUser)) {
    void loadUsers();
  }
});


document.getElementById("restart-server").onclick = async () => {
  const confirmed = await confirmMaintenanceAction("Restart backend now?", {
    okText: "Restart",
    cancelText: "Cancel",
    height: 60
  });
  if (confirmed) {
    await window.AppAuth.authenticatedFetch(`${API}/maintenance/restart`, {
      method: "POST",
      headers: { "X-CSRF-Token": token }
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

  renderLogs(popupLogBox, latestServerLog || "No log output loaded yet.");
  popupLogBox.scrollTop = popupLogBox.scrollHeight;
  syncLogPopupControls();
}

function openLogPopup() {
  if (logPopupWindow && !logPopupWindow.closed) {
    logPopupWindow.focus();
    syncLogPopup();
    return;
  }
  logPopupWindow = window.open("/maint/log-viewer.html", "maintenanceServerLogs", "popup,width=960,height=680,resizable=yes,scrollbars=yes");
  if (!logPopupWindow) {
    showMessage("Browser blocked the log viewer pop-out window.", "error");
  } else {
    logPopupWindow.addEventListener("load", syncLogPopup, { once: true });
  }
}

async function loadLogs() {
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/logs`, {
    headers: { "X-CSRF-Token": token }
  });
  const data = await res.json();
  if (res.ok) {
    const logBox = document.getElementById("server-logs");
    latestServerLog = data.log || "";
    renderLogs(logBox, latestServerLog || "No log output loaded yet.");
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
  setActiveTab("diagnostics");
  openLogPopup();
  if (!latestServerLog) {
    loadLogs();
  }
});

document.getElementById("cleanup-orphans").onclick = async () => {
  // Step 1: Preview unused photos
  const preview = await window.AppAuth.authenticatedFetch(`${API}/maintenance/orphan-photos`, {
    headers: { "X-CSRF-Token": token }
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
  const cleanup = await window.AppAuth.authenticatedFetch(`${API}/maintenance/cleanup-orphan-photos`, {
    method: "POST",
    headers: { "X-CSRF-Token": token }
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
  const auction = getSelectedTestAuction();
  if (!count || count < 1) return showMessage("Enter a valid number of test items.", "error");
  if (!auction) return showMessage("Please select an auction.", "error");
  if (testDataBusy) return;

  const state = normalizeAuctionStatus(auction.status);
  const auctionName = auction.full_name || auction.short_name || `Auction ${auction.id}`;
  const stateWarning = ["setup", "locked"].includes(state)
    ? ""
    : ` Warning: this auction is in state "${state}". Test items are normally added only in setup or locked.`;
  const message = `Generate ${count} test item${count === 1 ? "" : "s"} for "${auctionName}"?${stateWarning}`;

  setTestDataBusy(true);
  try {
    const confirmed = await confirmMaintenanceAction(message, {
      okText: "Generate Items",
      cancelText: "Cancel",
      height: stateWarning ? 120 : 80
    });
    if (!confirmed) return;

    showMessage("Generating test data...");
    const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/generate-test-data`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ count, auction_id: Number(auction.id) })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to generate test data");
    }

    showMessage(data.message, "success");
    await refreshAuctions();
  } catch (error) {
    showMessage(error?.message || "Failed to generate test data", "error");
  } finally {
    setTestDataBusy(false);
  }
};

document.getElementById("generate-bids-btn").onclick = async () => {
  const auction = getSelectedTestAuction();
  const numBids = parseInt(document.getElementById("test-bid-count").value, 10);
  const numBidders = parseInt(document.getElementById("test-bidder-count").value, 10);

  if (!auction || !Number.isInteger(numBids) || numBids < 1 || !Number.isInteger(numBidders) || numBidders < 1) {
    showMessage("Please enter valid numbers and select an auction.", "error");
    return;
  }
  if (testDataBusy) return;

  const state = normalizeAuctionStatus(auction.status);
  const auctionName = auction.full_name || auction.short_name || `Auction ${auction.id}`;
  const stateWarning = ["live", "settlement"].includes(state)
    ? ""
    : ` Warning: this auction is in state "${state}". Test bids are normally added only in live or settlement.`;
  const message = `Generate ${numBids} test bid${numBids === 1 ? "" : "s"} from ${numBidders} bidder${numBidders === 1 ? "" : "s"} for "${auctionName}"?${stateWarning}`;

  setTestDataBusy(true);
  try {
    const confirmed = await confirmMaintenanceAction(message, {
      okText: "Generate Bids",
      cancelText: "Cancel",
      height: stateWarning ? 120 : 80
    });
    if (!confirmed) return;

    showMessage("Generating test bids...");
    const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/generate-bids`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ auction_id: Number(auction.id), num_bids: numBids, num_bidders: numBidders })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to generate bids");
    }

    showMessage(data.message, "success");
    await refreshAuctions();
  } catch (error) {
    showMessage(error?.message || "Failed to generate bids", "error");
  } finally {
    setTestDataBusy(false);
  }
};

document.getElementById("delete-test-bids").onclick = async () => {
  const auction = getSelectedTestAuction();
  if (!auction) {
    showMessage("Please select an auction", "error");
    return;
  }
  if (testDataBusy) return;

  const auctionName = auction.full_name || auction.short_name || `Auction ${auction.id}`;
  setTestDataBusy(true);
  try {
    const confirmed = await confirmMaintenanceAction(`Delete all test bids for "${auctionName}"?`, {
      okText: "Delete Bids",
      cancelText: "Cancel",
      height: 70
    });
    if (!confirmed) return;

    const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/delete-test-bids`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ auction_id: Number(auction.id) })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to delete test bids");
    }

    showMessage(data.message, "success");
    await refreshAuctions();
  } catch (error) {
    showMessage(error?.message || "Failed to delete test bids", "error");
  } finally {
    setTestDataBusy(false);
  }
};



async function logOut() {
  if (logInterval) {
    clearInterval(logInterval);
    logInterval = null;
  }
  if (logPopupWindow && !logPopupWindow.closed) {
    logPopupWindow.close();
  }
  await window.AppAuth?.logout?.();
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

  const response = await window.AppAuth.authenticatedFetch(`${API}/maintenance/save-pptx-config/${configName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token
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
  window.AppAuth.authenticatedFetch(`${API}/maintenance/get-pptx-config/${configName}`, {
    headers: { 'X-CSRF-Token': token }
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

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/auctions/list`, {
    method: "POST",
    headers: { "X-CSRF-Token": token }
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
  closeAuctionContextMenu();
  tableBody.innerHTML = "";

  auctions.forEach(auction => {
    const row = document.createElement("tr");
    row._auction = auction;
    // if (!auction.is_active) {
    //   row.classList.add("auction-inactive");
    // }
    const logoSrc = auction.logo ? `${API}/resources/${encodeURIComponent(auction.logo)}` : "/pptx-resources/default_logo.png";

    const allowAdmin = !!auction.admin_can_change_state;

    // removed -->     <td style="text-align:center;"><input type="checkbox" ${auction.is_active ? "checked" : ""}></td>

    row.innerHTML = `
    <td>${escapeHtml(auction.id)}</td>
    <td><a class="maintenance-table-link maintenance-table-link--label" href="${baseUrl}/?auction=${encodeURIComponent(auction.short_name)}" target="_blank">${escapeHtml(auction.short_name)}</a></td>
    <td><a class="maintenance-table-link maintenance-table-link--plain" href="${baseUrl}/admin/index.html?auction=${encodeURIComponent(auction.short_name)}" rel="noopener">${escapeHtml(auction.full_name)}</a></td>
    <td style="text-align:center;"><img src="${logoSrc}" alt="Logo" style="height:40px; max-width:100px; object-fit:contain;"></td>
    <td>${escapeHtml(auction.item_count)}${Number(auction.deleted_item_count || 0) > 0 ? ` (${escapeHtml(auction.deleted_item_count)} deleted)` : ""}</td>
    <td>${escapeHtml(formatAuctionStatus(auction.status))}</td>
    <td>${allowAdmin ? "Yes" : "No"}</td>
    <td><div class="auction-action-row"></div></td>
  `;

    const actionRow = row.querySelector(".auction-action-row");
    const canReset = auction.status === "archived" || auction.status === "setup";
    const canDelete = Number(auction.item_count) <= 0;
    actionRow.appendChild(createAuctionActionButton(
      AUCTION_ACTION_ICONS.qr,
      "Generate auction URL QR code",
      () => openAuctionQrModal(auction)
    ));
    actionRow.appendChild(createAuctionActionButton(
      AUCTION_ACTION_ICONS.testData,
      "Generate test data",
      () => openTestDataModal(auction)
    ));
    actionRow.appendChild(createAuctionActionButton(
      AUCTION_ACTION_ICONS.edit,
      "Edit auction",
      () => openEditAuctionModal(auction)
    ));
    actionRow.appendChild(createAuctionActionButton(
      AUCTION_ACTION_ICONS.reset,
      canReset ? "Reset auction" : "Only auctions in state setup or archived may be reset",
      () => resetAuctionFromRow(auction),
      { danger: true, disabled: !canReset }
    ));
    actionRow.appendChild(createAuctionActionButton(
      AUCTION_ACTION_ICONS.delete,
      canDelete ? "Delete auction" : "Cannot delete auction with items",
      () => deleteAuctionFromRow(auction),
      { danger: true, disabled: !canDelete }
    ));

    tableBody.appendChild(row);
  });
} finally {
isRendering = false;
}

}

document.getElementById("create-auction").onclick = async () => {
  const short = document.getElementById("auction-short-name").value.trim();
  const full = document.getElementById("auction-full-name").value.trim();
  const selectedLogo = document.getElementById("auction-logo-select").value;


  if (!short || !full) {
    return showMessage("Please provide both short and full names", "error");
  }

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/auctions/create`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ short_name: short, full_name: full, logo: selectedLogo })
  });

  const data = await res.json();
  if (res.ok) {
    showMessage(data.message, "success");
    resetAddAuctionForm();
    closeAddAuctionModal();
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
  const selectedStatus = normalizeAuctionStatus(editAuctionStatusSelect?.value);
  const originalStatus = normalizeAuctionStatus(editAuctionModal?.dataset.auctionStatus);

  if (!auctionId) {
    showMessage("Missing auction ID.", "error");
    return;
  }

  if (!shortName || !fullName) {
    showMessage("Please provide both short and full names", "error");
    return;
  }

  saveEditAuctionButton.disabled = true;
  if (editAuctionPurgeDeletedButton) editAuctionPurgeDeletedButton.disabled = true;

  try {
    const updateRes = await window.AppAuth.authenticatedFetch(`${API}/maintenance/auctions/update`, {
      method: "POST",
      headers: {
        "X-CSRF-Token": token,
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

    if (selectedStatus !== originalStatus) {
      await updateAuctionStatus(auctionId, selectedStatus);
    }

    showMessage(updateData.message || "Auction updated", "success");
    closeEditAuctionModal();
    refreshAuctions();
  } catch (error) {
    showMessage(error?.message || "Failed to update auction", "error");
  } finally {
    saveEditAuctionButton.disabled = false;
    if (editAuctionPurgeDeletedButton) editAuctionPurgeDeletedButton.disabled = Number(editAuctionModal?.dataset.auctionDeletedItemCount || 0) <= 0;
  }
});

editAuctionPurgeDeletedButton?.addEventListener("click", async () => {
  const auctionId = Number(editAuctionIdInput.value);
  if (!auctionId) {
    showMessage("Missing auction ID.", "error");
    return;
  }

  editAuctionPurgeDeletedButton.disabled = true;
  try {
    const purged = await purgeDeletedItemsByAuctionId(auctionId);
    if (!purged) return;
    closeEditAuctionModal();
    refreshAuctions();
  } finally {
    editAuctionPurgeDeletedButton.disabled = Number(editAuctionModal?.dataset.auctionDeletedItemCount || 0) <= 0;
  }
});

closeAuctionQrModalButton?.addEventListener("click", closeAuctionQrModal);
cancelAuctionQrButton?.addEventListener("click", closeAuctionQrModal);
previewAuctionQrButton?.addEventListener("click", previewAuctionQrCode);
downloadAuctionQrButton?.addEventListener("click", downloadAuctionQrCode);
[qrRootUrlInput, qrForegroundColourInput, qrBackgroundColourInput, qrCentreImageSelect, qrOutputSizeInput]
  .filter(Boolean)
  .forEach((input) => {
    input.addEventListener("input", () => {
      syncQrUrlDisplay();
      resetQrPreview();
      setQrModalStatus("");
    });
    input.addEventListener("change", () => {
      syncQrUrlDisplay();
      resetQrPreview();
      setQrModalStatus("");
    });
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
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/check-integrity?mode=${encodeURIComponent(mode)}`, {
    headers: { "X-CSRF-Token": token }
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
    const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/check-integrity/fix`, {
      method: "POST",
      headers: { "X-CSRF-Token": token }
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

//   const confirmed = await confirmMaintenanceAction(`Delete ${ids.length} invalid item(s)?`);
//   if (!confirmed) return;

//   const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/check-integrity/delete`, {
//     method: "POST",
//     headers: {
//       "X-CSRF-Token": token,
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

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/resources/upload`, {
    method: "POST",
    headers: { "X-CSRF-Token": token },
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
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/resources`, {
    headers: { "X-CSRF-Token": token }
  });

  const data = await res.json();
  const tableBody = document.getElementById("pptx-image-table-body");
  tableBody.innerHTML = "";
  resourceImageFiles = Array.isArray(data.files) ? data.files : [];
  populateQrImageOptions(resourceImageFiles);

  if (!resourceImageFiles.length) {
    tableBody.innerHTML = `<tr><td colspan="3">No image resources stored.</td></tr>`;
    return;
  }

  for (const file of resourceImageFiles) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const link = document.createElement("a");
    link.href = `${API}/resources/${encodeURIComponent(file.name)}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "maintenance-table-link maintenance-table-link--label";
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
      const confirmed = await confirmMaintenanceAction(
        `Delete image <strong>${escapeHtml(file.name)}</strong>?`,
        {
          okText: "Delete Image",
          cancelText: "Cancel",
          height: 70
        }
      );
      if (!confirmed) return;

      const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/resources/delete`, {
        method: "POST",
        headers: {
          "X-CSRF-Token": token,
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

  if (resourceImageFiles.length > 0) {
    for (const file of resourceImageFiles) {
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
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/pptx-resources`, {
    headers: { "X-CSRF-Token": token }
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

  const confirmed = await confirmMaintenanceAction(
    `Reset <strong>${escapeHtml(selectedConfig)}</strong> to default?`,
    {
      okText: "Reset",
      cancelText: "Cancel",
      height: 70
    }
  );
  if (!confirmed) return;

  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/pptx-config/reset`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": token,
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

  const res = await window.AppAuth.authenticatedFetch(`${API}/audit-log${finalQuery}`, {
    headers: { "X-CSRF-Token": token }
  });

  const body = document.getElementById("audit-log-body");
  body.replaceChildren();

  if (!res.ok) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.style.padding = "4px";
    cell.style.color = "red";
    cell.textContent = "Failed to load audit log.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  const data = await res.json();
  data.logs.forEach(log => {
    const row = document.createElement("tr");
    [
      log.created_at,
      log.object_type,
      log.object_id,
      log.action,
      formatHistoryDetails(log.details),
      log.user,
      log.short_name ?? "",
      log.item_number ?? ""
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.style.padding = "4px";
      cell.textContent = String(value ?? "");
      row.appendChild(cell);
    });
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

  const res = await window.AppAuth.authenticatedFetch(`${API}/settlement/payment-methods`, {
    headers: {
      "X-CSRF-Token": token,
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
  const res = await window.AppAuth.authenticatedFetch(`${API}/maintenance/audit-log/export`, {
    headers: { "X-CSRF-Token": token }
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
      loadManagedBackups();
      loadUsers();
      if (localStorage.getItem(MAINTENANCE_TAB_KEY) === "diagnostics") {
        loadMessagingStats();
      }

    } else {
    }
  }, 30000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshAuctions();
    loadPptxImageList();
    loadManagedBackups();
    loadUsers();
    if (localStorage.getItem(MAINTENANCE_TAB_KEY) === "diagnostics") {
      loadMessagingStats();
    }

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
