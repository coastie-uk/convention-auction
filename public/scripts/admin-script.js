let cropper;
document.addEventListener("DOMContentLoaded", function () {
    const loginSection = document.getElementById("login-section");
    const adminSection = document.getElementById("admin-section");
    const editSection = document.getElementById("edit-section");
    const addSection = document.getElementById("add-section");
    const exportSection = document.getElementById("export-section");
    const loginButton = document.getElementById("login-button");
    const logoutButton = document.getElementById("logout");
    const changePasswordButton = document.getElementById("change-own-password-admin");
    const loggedInUserEl = document.getElementById("admin-logged-in-user");
    const loggedInRoleEl = document.getElementById("admin-logged-in-role");
    const userMenuButton = document.getElementById("admin-user-menu-button");
    const menuGroups = Array.from(document.querySelectorAll(".menu-group"));
    const itemsTableBody = document.getElementById("items-table-body");
    const editForm = document.getElementById("edit-form");
    const editModeBanner = document.getElementById("edit-mode-banner");
    const deleteButton = document.getElementById("delete-item");
    const cancelEditButton = document.getElementById("cancel-edit");
    const editPhotoInput = document.getElementById("edit-photo");
    const editPhotoCaptureButton = document.getElementById("capture-button");
    const currentPhotoEl = document.getElementById("current-photo");
    const openExportPanelButton = document.getElementById("open-export-panel");
    const addForm = document.getElementById("add-form");
    const cancelAddButton = document.getElementById("cancel-add");
    const addPhotoInput = document.getElementById("add-photo");
    const addPhotoCaptureButton = document.getElementById("add-capture-button");
    const addCurrentPhotoEl = document.getElementById("add-current-photo");
    const addPhotoLiveInput = document.getElementById("add-photo-live");
    const addRotateLeftButton = document.getElementById("add-rotate-left");
    const addRotateRightButton = document.getElementById("add-rotate-right");
    const addCropImageButton = document.getElementById("add-crop-image");
    const editLivePhotoInput = document.getElementById("edit-photo-live");
    const addItemButton = document.getElementById("add-item");
    const manageBiddersButton = document.getElementById("manage-bidders");
    const refreshButton = document.getElementById("refresh");
    const liveFeedButton = document.getElementById("livefeed");
    const publicButton = document.getElementById("public");
    const cashierPageButton = document.getElementById("cashier-page");
    const selectAuctionState = document.getElementById('auctionState');
    const auctionStateMenu = document.getElementById("auction-state-menu");
    const sortFieldMenu = document.getElementById("sort-field-menu");
    const sortOrderMenu = document.getElementById("sort-order-menu");
    const photoPreviewSizeMenu = document.getElementById("photo-preview-size-menu");
    const showBidderNamesInput = document.getElementById("show-bidder-names");
    const currentAuctionPill = document.getElementById("current-auction-pill");
    const currentStatePill = document.getElementById("current-state-pill");
    const connectionPill = document.getElementById("admin-connection-pill");
    const connectionStatusText = document.getElementById("admin-connection-status");
    const saveEditButton = document.getElementById("save-changes");
    const saveNewButton = document.getElementById("save-new");
    const closeExportPanelButton = document.getElementById("close-export-panel");
    const cancelExportPanelButton = document.getElementById("cancel-export-panel");
    const exportForm = document.getElementById("export-form");
    const exportPanelAuction = document.getElementById("export-panel-auction");
    const itemExportSelectionFieldset = document.getElementById("item-export-selection-fieldset");
    const bidderReportSelectionFieldset = document.getElementById("bidder-report-selection-fieldset");
    const exportRangeControls = document.getElementById("export-range-controls");
    const exportItemRangeInput = document.getElementById("export-item-range");
    const exportNeedsAttentionTitle = document.getElementById("export-needs-attention-title");
    const exportNeedsAttentionHelp = document.getElementById("export-needs-attention-help");
    const exportJobStatus = document.getElementById("export-job-status");
    const exportJobSummary = document.getElementById("export-job-summary");
    const exportJobDetail = document.getElementById("export-job-detail");
    const cancelExportJobButton = document.getElementById("cancel-export-job");
    const downloadExportJobButton = document.getElementById("download-export-job");
    const runExportButton = document.getElementById("run-export");
    const resetExportTrackingButton = document.getElementById("reset-export-tracking");
    const openAboutModalButton = document.getElementById("open-about-modal");
    const aboutModal = document.getElementById("about-modal");
    const closeAboutModalButton = document.getElementById("close-about-modal");
    const showAllItemDataButton = document.getElementById("show-all-item-data");
    const itemDetailsModal = document.getElementById("item-details-modal");
    const itemDetailsModalSummary = document.getElementById("item-details-modal-summary");
    const itemDetailsTableBody = document.getElementById("item-details-table-body");
    const closeItemDetailsModalButton = document.getElementById("close-item-details-modal");
    const imagePreviewModal = document.getElementById("image-preview-modal");
    const imagePreviewModalTitle = document.getElementById("image-preview-modal-title");
    const imagePreviewModalImage = document.getElementById("image-preview-modal-image");
    const closeImagePreviewModalButton = document.getElementById("close-image-preview-modal");
    const aboutVersionBackendEl = document.getElementById("about-version-backend");
    const aboutVersionSchemaEl = document.getElementById("about-version-schema");
    const aboutVersionPaymentEl = document.getElementById("about-version-payment");
    const exportTypeInputs = Array.from(document.querySelectorAll('input[name="export-type"]'));
    const exportSelectionModeInputs = Array.from(document.querySelectorAll('input[name="export-selection-mode"]'));
    const bidderReportModeInputs = Array.from(document.querySelectorAll('input[name="bidder-report-mode"]'));
    const statusOptions = ["setup", "locked", "live", "settlement", "archived"];
    const managedSections = [loginSection, adminSection, editSection, addSection, exportSection].filter(Boolean);

    let currentEditId = null;
    let currentEditItem = null;
    let currentEditCanEdit = true;
    let currentEditBlockReason = "";
    let modifiedImages = {};
    let auctions = [];
    let selectedAuctionId = null;
    let selectedAuctionCanChangeState = 0;
    const adminPreferenceController = window.AppAuth?.createPreferenceController?.({ pageKey: "admin" }) || null;
    const adminPreferences = adminPreferenceController?.getPagePreferences?.() || {};
    let selectedOrder = adminPreferences.sort_order || "asc";
    let selectedSort = adminPreferences.sort_field || "item_number";
    let showBidderNames = adminPreferences.show_bidder_names === true;
    let selectedPhotoPreviewSize = adminPreferences.photo_preview_size || "small";
    let currencySymbol = localStorage.getItem("currencySymbol") || "£";
    let pptxStatusPollTimer = null;
    let latestPptxJob = null;
    let autoDownloadJobId = null;
    let adminRefreshConnected = null;
    let draftImageBlob = null;
    let draftImageFilename = "";
    let draftImageUrl = "";
    let addDraftImageBlob = null;
    let addDraftImageFilename = "";
    let addDraftImageUrl = "";
    let activeCropContext = "edit";
    const downloadedPptxJobs = new Set();

    document.getElementById("sort-field").value = selectedSort;
    document.getElementById("sort-order").value = selectedOrder;
    document.getElementById("photo-preview-size").value = selectedPhotoPreviewSize;
    if (showBidderNamesInput) showBidderNamesInput.checked = showBidderNames;

    // controls whether to show bidder & amount columns
    const showBidStates = ['live', 'settlement', 'archived'];

    const fmtPrice = (a, v) => a ? `${currencySymbol}${Number(v).toFixed(2)}` : '';

    const API = "/api";
    const OPEN_MOVE_PANEL_KEY = "admin_open_move_panel_item";
    const EDITABLE_AUCTION_STATUSES = new Set(["setup", "locked"]);
    const ITEM_DETAIL_FIELDS = Object.freeze([
        "id",
        "description",
        "contributor",
        "artist",
        "photo",
        "date",
        "notes",
        "mod_date",
        "last_print",
        "last_slide_export",
        "last_card_export",
        "last_bid_update",
        "collected_at",
        "text_mod_date",
        "item_number",
        "auction_id",
        "test_item",
        "test_bid",
        "winning_bidder_id",
        "hammer_price"
    ]);
    const SORT_FIELD_LABELS = Object.freeze({
        item_number: "Number",
        description: "Name",
        contributor: "Contributor",
        artist: "Creator",
        paddle_number: "Bidder",
        hammer_price: "Price"
    });
    const SORT_ORDER_LABELS = Object.freeze({
        asc: "Ascending",
        desc: "Descending"
    });
    const PHOTO_PREVIEW_SIZE_LABELS = Object.freeze({
        small: "Small",
        medium: "Medium",
        large: "Large"
    });
    const VALID_SORT_FIELDS = new Set(Object.keys(SORT_FIELD_LABELS));
    const VALID_SORT_ORDERS = new Set(Object.keys(SORT_ORDER_LABELS));
    const VALID_PHOTO_PREVIEW_SIZES = new Set(Object.keys(PHOTO_PREVIEW_SIZE_LABELS));

    if (!VALID_SORT_FIELDS.has(selectedSort)) selectedSort = "item_number";
    if (!VALID_SORT_ORDERS.has(selectedOrder)) selectedOrder = "asc";
    if (!VALID_PHOTO_PREVIEW_SIZES.has(selectedPhotoPreviewSize)) selectedPhotoPreviewSize = "small";
    document.getElementById("photo-preview-size").value = selectedPhotoPreviewSize;

    function getPhotoPreviewSizeClass(size = selectedPhotoPreviewSize) {
        const normalizedSize = VALID_PHOTO_PREVIEW_SIZES.has(size) ? size : "small";
        return `item-thumb--${normalizedSize}`;
    }

    function applyPhotoPreviewSize() {
        itemsTableBody.querySelectorAll(".item-thumb").forEach((image) => {
            image.classList.remove("item-thumb--small", "item-thumb--medium", "item-thumb--large");
            image.classList.add(getPhotoPreviewSizeClass());
        });
    }

    function saveAdminPreferences(partial) {
        adminPreferenceController?.patchPagePreferences?.(partial);
    }

    function formatBidderLabel(paddleNumber, name, { prefix = false } = {}) {
        const paddle = paddleNumber == null || paddleNumber === "" ? "" : String(paddleNumber);
        const cleanName = normalizeString(name);
        const base = cleanName ? `${paddle} - ${cleanName}` : paddle;
        return prefix && base ? `Paddle ${base}` : base;
    }

    function getSavedAdminAuctionId() {
        const savedAuctionId = Number(adminPreferenceController?.getPagePreferences?.().selected_auction_id);
        return Number.isInteger(savedAuctionId) && savedAuctionId > 0 ? savedAuctionId : null;
    }

    function getSelectedAuction() {
        return auctions.find((auction) => Number(auction.id) === Number(selectedAuctionId)) || null;
    }

    function getSelectedAuctionStatus() {
        return String(getSelectedAuction()?.status || "").toLowerCase();
    }

    function itemHasBid(item) {
        return item?.winning_bidder_id != null || item?.hammer_price != null || item?.paddle_no != null;
    }

    function getItemEditState(item) {
        const auctionStatus = getSelectedAuctionStatus();
        if (!EDITABLE_AUCTION_STATUSES.has(auctionStatus)) {
            return {
                canEdit: false,
                reason: `Editing is unavailable because this auction is currently in ${auctionStatus || "an unknown"} state.`
            };
        }

        if (itemHasBid(item)) {
            return {
                canEdit: false,
                reason: "Editing is unavailable because this item already has a bid."
            };
        }

        return {
            canEdit: true,
            reason: ""
        };
    }

    function revokeDraftImageUrl() {
        if (draftImageUrl) {
            URL.revokeObjectURL(draftImageUrl);
            draftImageUrl = "";
        }
    }

    function resetDraftImageState() {
        revokeDraftImageUrl();
        draftImageBlob = null;
        draftImageFilename = "";
    }

    function revokeAddDraftImageUrl() {
        if (addDraftImageUrl) {
            URL.revokeObjectURL(addDraftImageUrl);
            addDraftImageUrl = "";
        }
    }

    function resetAddDraftImageState() {
        revokeAddDraftImageUrl();
        addDraftImageBlob = null;
        addDraftImageFilename = "";
    }

    function getPersistedPhotoUrl(item = currentEditItem) {
        if (!item?.photo || item.photo === "null") return "";
        const version = item.mod_date ? `?v=${encodeURIComponent(item.mod_date)}` : "";
        return `${API}/uploads/${item.photo}${version}`;
    }

    function getCurrentEditImageUrl() {
        return draftImageUrl || getPersistedPhotoUrl();
    }

    function getCurrentAddImageUrl() {
        return addDraftImageUrl || "";
    }

    function refreshCurrentPhotoPreview() {
        const currentPhotoUrl = getCurrentEditImageUrl();
        if (currentPhotoUrl) {
            currentPhotoEl.src = currentPhotoUrl;
        } else {
            currentPhotoEl.removeAttribute("src");
        }
        currentPhotoEl.alt = currentPhotoUrl ? "Current Photo" : "No photo selected";
    }

    function refreshAddPhotoPreview() {
        const photoUrl = getCurrentAddImageUrl();
        if (photoUrl) {
            addCurrentPhotoEl.src = photoUrl;
        } else {
            addCurrentPhotoEl.removeAttribute("src");
        }
        addCurrentPhotoEl.alt = photoUrl ? "New Item Photo Preview" : "No photo selected";
    }

    function updateImageToolState() {
        const hasPhoto = Boolean(getCurrentEditImageUrl());
        const imageToolsDisabled = !currentEditCanEdit || !hasPhoto;
        document.getElementById("rotate-left").disabled = imageToolsDisabled;
        document.getElementById("rotate-right").disabled = imageToolsDisabled;
        document.getElementById("crop-image").disabled = imageToolsDisabled;
    }

    function updateAddImageToolState() {
        const hasPhoto = Boolean(getCurrentAddImageUrl());
        addRotateLeftButton.disabled = !hasPhoto;
        addRotateRightButton.disabled = !hasPhoto;
        addCropImageButton.disabled = !hasPhoto;
    }

    function setDraftImageBlob(blob, fileName = "edited-photo.jpg") {
        if (!(blob instanceof Blob)) return;
        revokeDraftImageUrl();
        draftImageBlob = blob;
        draftImageFilename = fileName;
        draftImageUrl = URL.createObjectURL(blob);
        refreshCurrentPhotoPreview();
        updateImageToolState();
    }

    function setAddDraftImageBlob(blob, fileName = "new-item-photo.jpg") {
        if (!(blob instanceof Blob)) return;
        revokeAddDraftImageUrl();
        addDraftImageBlob = blob;
        addDraftImageFilename = fileName;
        addDraftImageUrl = URL.createObjectURL(blob);
        refreshAddPhotoPreview();
        updateAddImageToolState();
    }

    function loadImageFromUrl(imageUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("Failed to load image"));
            image.src = imageUrl;
        });
    }

    function canvasToBlob(canvas, type = "image/jpeg", quality = 0.9) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error("Failed to render image"));
                    return;
                }
                resolve(blob);
            }, type, quality);
        });
    }

    async function applyRotateToDraft(direction) {
        const sourceUrl = getCurrentEditImageUrl();
        if (!sourceUrl) throw new Error("No photo available");

        const image = await loadImageFromUrl(sourceUrl);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image editor is unavailable");

        canvas.width = image.height;
        canvas.height = image.width;
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(direction === "left" ? -Math.PI / 2 : Math.PI / 2);
        context.drawImage(image, -image.width / 2, -image.height / 2);

        const rotatedBlob = await canvasToBlob(canvas);
        setDraftImageBlob(rotatedBlob, draftImageFilename || "edited-photo.jpg");
    }

    async function applyRotateToAddDraft(direction) {
        const sourceUrl = getCurrentAddImageUrl();
        if (!sourceUrl) throw new Error("No photo available");

        const image = await loadImageFromUrl(sourceUrl);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image editor is unavailable");

        canvas.width = image.height;
        canvas.height = image.width;
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(direction === "left" ? -Math.PI / 2 : Math.PI / 2);
        context.drawImage(image, -image.width / 2, -image.height / 2);

        const rotatedBlob = await canvasToBlob(canvas);
        setAddDraftImageBlob(rotatedBlob, addDraftImageFilename || "new-item-photo.jpg");
    }

    function setEditFormEnabled(isEnabled) {
        const selectors = [
            "#edit-description",
            "#edit-contributor",
            "#edit-artist",
            "#edit-notes",
            "#edit-photo",
            "#edit-photo-live"
        ];

        selectors.forEach((selector) => {
            const field = document.querySelector(selector);
            if (field) field.disabled = !isEnabled;
        });

        if (editPhotoCaptureButton) editPhotoCaptureButton.disabled = !isEnabled;
        saveEditButton.disabled = !isEnabled;
        deleteButton.disabled = !isEnabled;
        updateImageToolState();
    }

    function updateEditModeUI() {
        const titleVerb = currentEditCanEdit ? "Edit" : "View";
        document.getElementById("edit-title").innerHTML = `<h2>${titleVerb} item #${escapeHtml(String(currentEditItem?.item_number ?? ""))}</h2>`;
        if (editModeBanner) {
            if (currentEditCanEdit) {
                editModeBanner.hidden = true;
                editModeBanner.textContent = "";
            } else {
                editModeBanner.hidden = false;
                editModeBanner.innerHTML = `<strong>View only.</strong> ${escapeHtml(currentEditBlockReason)}`;
            }
        }
        setEditFormEnabled(currentEditCanEdit);
    }

    function closeCropperModal() {
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        const cropModal = document.getElementById("crop-modal");
        if (cropModal) {
            cropModal.style.display = "none";
        }
    }

    function resetEditDraftState() {
        closeCropperModal();
        closeItemDetailsModal();
        resetDraftImageState();
        currentEditItem = null;
        currentEditCanEdit = true;
        currentEditBlockReason = "";
        currentEditId = null;
    }

    function resetAddDraftState() {
        closeCropperModal();
        resetAddDraftImageState();
        addForm.reset();
        refreshAddPhotoPreview();
        updateAddImageToolState();
    }

    function setAdminConnectionStatus(isConnected, { announce = true } = {}) {
        if (connectionPill) {
            connectionPill.classList.remove("is-checking", "is-connected", "is-disconnected");
            connectionPill.classList.add(isConnected ? "is-connected" : "is-disconnected");
        }
        if (connectionStatusText) {
            connectionStatusText.textContent = isConnected ? "Connected" : "Not connected";
        }

        if (!announce || adminRefreshConnected === isConnected) {
            adminRefreshConnected = isConnected;
            return;
        }

        if (adminRefreshConnected === null) {
            adminRefreshConnected = isConnected;
            return;
        }

        adminRefreshConnected = isConnected;
        showMessage(
            isConnected ? "Admin connection restored." : "Admin background refresh lost connection.",
            isConnected ? "success" : "error"
        );
    }

    const ACTION_ICONS = Object.freeze({
        history: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 12a9 9 0 1 0 3-6.7"></path>
                <path d="M3 4v5h5"></path>
                <path d="M12 7v5l3 2"></path>
            </svg>
        `,
        edit: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
            </svg>
        `,
        view: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
        `,
        duplicate: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
        `,
        move: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m8 5-4 4 4 4"></path>
                <path d="M4 9h10a4 4 0 0 1 0 8h-2"></path>
                <path d="m16 13 4 4-4 4"></path>
            </svg>
        `
    });
    const ITEM_STATUS_LABELS = Object.freeze({
        not_sold: "Not sold",
        sold_unpaid: "Sold and not paid",
        part_paid: "Part paid",
        paid_in_full: "Paid in full",
        collected: "Item collected"
    });
    const STATUS_ICONS = Object.freeze({
        not_sold: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="9"></circle>
            </svg>
        `,
        sold_unpaid: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="m8.5 12 2.5 2.5 4.5-4.5"></path>
            </svg>
        `,
        part_paid: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="9"></circle>
                <path class="status-fill" d="M12 12 12 3a9 9 0 0 1 0 18Z"></path>
                <path d="M12 3v18"></path>
            </svg>
        `,
        paid_in_full: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M9 8.5h6"></path>
                <path d="M9 15.5h6"></path>
                <path d="M12 6.5v11"></path>
                <path d="M15 10c0-1.1-1.34-2-3-2s-3 .9-3 2 1.34 2 3 2 3 .9 3 2-1.34 2-3 2-3-.9-3-2"></path>
            </svg>
        `,
        collected: `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"></path>
                <path d="M3 7.5 12 12l9-4.5"></path>
                <path d="M12 12v9"></path>
                <path d="m9.5 12.5 1.75 1.75 3.75-3.75"></path>
            </svg>
        `
    });
    function showSection(sectionId) {
        closeMenuGroups();
        managedSections.forEach((section) => {
            if (!section) return;
            section.style.display = section.id === sectionId ? "block" : "none";
        });
    }

    function getTokenOrLogout() {
        const token = window.AppAuth?.getToken?.() || localStorage.getItem("token");
        if (!token) {
            logout();
            return null;
        }
        return token;
    }

    function formatIsoDateTime(value) {
        if (!value) return "";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return value;
        return parsed.toLocaleString();
    }

    function parseDbDateTime(value) {
        if (!value) return null;
        if (value instanceof Date) {
            const ts = value.getTime();
            return Number.isFinite(ts) ? ts : null;
        }

        const rawValue = typeof value === "string" ? value.trim() : String(value).trim();
        if (!rawValue) return null;

        const legacyMatch = rawValue.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (legacyMatch) {
            const [, dd, mm, yyyy, hh, min, sec] = legacyMatch;
            const parsed = new Date(
                Number(yyyy),
                Number(mm) - 1,
                Number(dd),
                Number(hh),
                Number(min),
                sec ? Number(sec) : 0
            );
            const ts = parsed.getTime();
            return Number.isFinite(ts) ? ts : null;
        }

        const normalizedIsoCandidate = rawValue.includes("T")
            ? rawValue
            : rawValue.replace(" ", "T");
        const isoTs = Date.parse(normalizedIsoCandidate);
        return Number.isFinite(isoTs) ? isoTs : null;
    }

    function getPrintStatus(textModDate, lastPrint) {
        const lastPrintTs = parseDbDateTime(lastPrint);
        if (!lastPrintTs) return "unprinted";

        const modTs = parseDbDateTime(textModDate);
        if (!modTs) return "printed";
        return modTs > lastPrintTs ? "stale" : "printed";
    }

    function renderPrintButton(itemId, printStatus) {
        const statusClass = printStatus === "printed"
            ? "print-slip-button--printed"
            : (printStatus === "stale" ? "print-slip-button--stale" : "");
        const statusHint = printStatus === "printed"
            ? "Slip print is up to date"
            : (printStatus === "stale" ? "Slip may be out of date" : "Not printed yet");
        return `
            <button type="button" class="item-action-button print-slip-button ${statusClass}" data-id="${itemId}" title="Print item slip (${statusHint})" aria-label="Print item slip">
                <span class="item-action-icon item-action-icon--print" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M7 3h10v4H7zM7 17h10v4H7zM7 12h10v4H7z"></path>
                        <path d="M4 8h16a2 2 0 0 1 2 2v5h-3v-3H5v3H2v-5a2 2 0 0 1 2-2z"></path>
                    </svg>
                </span>
            </button>
        `;
    }

    function renderIconButton({ className = "", title = "", icon = "", attributes = "" }) {
        const buttonClass = ["item-action-button", className].filter(Boolean).join(" ");
        const safeTitle = escapeHtml(title);
        return `
            <button type="button" class="${buttonClass}" title="${safeTitle}" aria-label="${safeTitle}" ${attributes}>
                <span class="item-action-icon" aria-hidden="true">${icon}</span>
            </button>
        `;
    }

    function isUnavailableActionButton(button) {
        if (!button || button.disabled) return true;
        const style = window.getComputedStyle(button);
        return style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none";
    }

    function getUnavailableActionReason(button, fallback = "This command is unavailable") {
        return normalizeString(button?.title || button?.dataset?.defaultTitle || fallback) || fallback;
    }

    async function deleteItemById(itemId, { afterDelete = null } = {}) {
        const token = getTokenOrLogout();
        if (!token) return;

        const numericItemId = Number(itemId);
        if (!Number.isInteger(numericItemId) || numericItemId <= 0) {
            showMessage("Cannot delete item: missing item id", "error");
            return;
        }

        const modal = await DayPilot.Modal.confirm("Are you sure you want to delete this item?");
        if (modal.canceled) {
            showMessage("Delete cancelled", "info");
            return;
        }

        try {
            const response = await fetch(`${API}/items/${numericItemId}`, {
                method: "DELETE",
                headers: { Authorization: token }
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Unknown error");
            }

            showMessage(data.message || "Item deleted successfully", "success");
            await loadItems();
            if (typeof afterDelete === "function") {
                afterDelete();
            }
        } catch (error) {
            showMessage("Error deleting item: " + error.message, "error");
        }
    }

    function renderItemStatusIndicator(statusCode, statusLabel) {
        const code = Object.prototype.hasOwnProperty.call(STATUS_ICONS, statusCode) ? statusCode : "not_sold";
        const label = normalizeString(statusLabel) || ITEM_STATUS_LABELS[code];
        const safeLabel = escapeHtml(label);
        return `
            <span class="item-status-indicator item-status-indicator--${code}" title="${safeLabel}" aria-label="${safeLabel}" role="img">
                <span class="item-status-icon" aria-hidden="true">${STATUS_ICONS[code]}</span>
            </span>
        `;
    }

    function openPdfBlobForPrinting(pdfBlob, confirmationPrompt) {
        return new Promise((resolve) => {
            const pdfUrl = URL.createObjectURL(pdfBlob);
            const iframe = document.createElement("iframe");
            iframe.style.position = "fixed";
            iframe.style.width = "0";
            iframe.style.height = "0";
            iframe.style.border = "0";
            iframe.style.opacity = "0";
            iframe.style.pointerEvents = "none";

            let isCleaned = false;
            let isSettled = false;
            const finish = (value) => {
                if (isSettled) return;
                isSettled = true;
                resolve(value);
            };
            const askForConfirmation = async () => {
                if (isSettled) return;
                try {
                    if (window.DayPilot?.Modal?.confirm) {
                        const modal = await DayPilot.Modal.confirm(
                            confirmationPrompt || "Did the print complete successfully?"
                        );
                        finish(!modal?.canceled);
                        return;
                    }
                } catch (_) {
                    // fallback to native confirm
                }
                const confirmed = window.confirm(confirmationPrompt || "Did the print complete successfully?");
                finish(confirmed);
            };
            const cleanup = () => {
                if (isCleaned) return;
                isCleaned = true;
                URL.revokeObjectURL(pdfUrl);
                iframe.remove();
            };

            iframe.onload = () => {
                setTimeout(() => {
                    try {
                        const frameWindow = iframe.contentWindow;
                        if (!frameWindow) {
                            throw new Error("Unable to access print frame");
                        }

                        let printedOrClosed = false;
                        const onDialogClosed = () => {
                            if (printedOrClosed || isSettled) return;
                            printedOrClosed = true;
                            removeHandlers();
                            setTimeout(() => {
                                void askForConfirmation();
                            }, 120);
                        };

                        const removeHandlers = () => {
                            window.removeEventListener("focus", onDialogClosed);
                        };

                        window.addEventListener("focus", onDialogClosed, { once: true });

                        frameWindow.focus();
                        frameWindow.print();

                        // Fallback: if no focus-return signal arrives, ask anyway.
                        setTimeout(() => {
                            removeHandlers();
                            onDialogClosed();
                        }, 120000);
                    } catch (err) {
                        window.open(pdfUrl, "_blank", "noopener,noreferrer");
                        showMessage("Auto print blocked. Opened the PDF in a new tab. Print status was not updated.", "info");
                        finish(false);
                    } finally {
                        setTimeout(cleanup, 15000);
                    }
                }, 150);
            };

            iframe.src = pdfUrl;
            document.body.appendChild(iframe);
            setTimeout(() => {
                if (!isSettled) {
                    finish(false);
                    cleanup();
                }
            }, 120000);
        });
    }

    async function fetchSlipPdfBlob(url, defaultMessage) {
        const token = localStorage.getItem("token");
        if (!token) {
            logout();
            throw new Error("Not authenticated");
        }

        const response = await fetch(url, {
            headers: { Authorization: token }
        });

        if (!response.ok) {
            let message = defaultMessage;
            try {
                const data = await response.json();
                message = data.error || message;
            } catch (parseErr) {
                // keep fallback message when response is not JSON
            }
            const err = new Error(message);
            err.status = response.status;
            throw err;
        }

        const itemIdsHeader = response.headers.get("x-slip-item-ids") || "";
        const itemIds = itemIdsHeader
            .split(",")
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0);
        const blob = await response.blob();
        return { blob, itemIds };
    }

    async function confirmSlipPrinted(itemIds) {
        const token = localStorage.getItem("token");
        const auctionId = Number(selectedAuctionId);
        if (!token || !auctionId) {
            logout();
            throw new Error("Not authenticated");
        }

        if (!Array.isArray(itemIds) || itemIds.length === 0) {
            throw new Error("No printed item ids returned by server");
        }

        const response = await fetch(`${API}/auctions/${auctionId}/items/confirm-slip-print`, {
            method: "POST",
            headers: {
                Authorization: token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ item_ids: itemIds })
        });

        if (!response.ok) {
            let message = "Failed to confirm print";
            try {
                const data = await response.json();
                message = data.error || message;
            } catch (parseErr) {
                // keep fallback message when response is not JSON
            }
            throw new Error(message);
        }
    }

    async function printItemSlip(itemId) {
        const auctionId = Number(selectedAuctionId);
        if (!auctionId || !itemId) return;

        try {
            const { blob, itemIds } = await fetchSlipPdfBlob(
                `${API}/auctions/${auctionId}/items/${itemId}/print-slip`,
                "Failed to generate slip"
            );
            const confirmed = await openPdfBlobForPrinting(
                blob,
                "Did the item slip print successfully?"
            );
            if (!confirmed) {
                showMessage("Print not confirmed. Slip print status was not updated.", "info");
                return;
            }

            const idsToConfirm = itemIds.length > 0 ? itemIds : [itemId];
            await confirmSlipPrinted(idsToConfirm);
            await loadItems();
        } catch (error) {
            showMessage("Print failed: " + error.message, "error");
        }
    }

    async function printAuctionSlips(selectionMode, itemRange = "") {
        const auctionId = Number(selectedAuctionId);
        if (!auctionId) {
            showMessage("Please select an auction first", "error");
            return;
        }

        try {
            const params = new URLSearchParams();
            params.set("selection_mode", selectionMode);
            if (selectionMode === "range") {
                params.set("item_range", itemRange);
            }
            const { blob, itemIds } = await fetchSlipPdfBlob(
                `${API}/auctions/${auctionId}/items/print-slip?${params.toString()}`,
                "Failed to generate slips"
            );
            const confirmed = await openPdfBlobForPrinting(
                blob,
                "Did all item slips print successfully?"
            );
            if (!confirmed) {
                showMessage("Print not confirmed. Slip print status was not updated.", "info");
                return;
            }

            await confirmSlipPrinted(itemIds);
            await loadItems();
        } catch (error) {
            const level = error.status === 400 ? "info" : "error";
            showMessage("Print failed: " + error.message, level);
        }
    }

    function getExportTypeDisplayText(exportType) {
        switch (exportType) {
            case "slides":
                return "slide export";
            case "cards":
                return "card export";
            case "slips":
                return "slip print";
            case "manual-entry-sheet":
                return "manual entry sheet";
            case "report-pdf":
                return "auction report";
            case "bidder-report-pdf":
                return "bidder report";
            case "csv":
                return "CSV export";
            default:
                return "export";
        }
    }

    async function resetExportTracking(exportType) {
        const auctionId = Number(selectedAuctionId);
        if (!auctionId) {
            showMessage("Please select an auction first", "error");
            return;
        }
        if (!["slides", "cards", "slips"].includes(exportType)) {
            showMessage("Tracking reset is only available for slides, item cards, and item slips", "info");
            return;
        }

        const token = localStorage.getItem("token");
        if (!token) return logout();

        try {
            const exportLabel = getExportTypeDisplayText(exportType);
            const modal = await DayPilot.Modal.confirm(
                `Clear ${exportLabel} tracking for all items in this auction?`
            );
            if (modal?.canceled) {
                showMessage("Reset cancelled", "info");
                return;
            }

            const response = await fetch(`${API}/auctions/${auctionId}/items/reset-export-tracking`, {
                method: "POST",
                headers: {
                    Authorization: token,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ export_type: exportType })
            });

            if (!response.ok) {
                let message = `Failed to reset ${exportLabel} tracking`;
                try {
                    const data = await response.json();
                    message = data.error || message;
                } catch (parseErr) {
                    // keep fallback message when response is not JSON
                }
                throw new Error(message);
            }

            const data = await response.json();
            showMessage(data.message || `${exportLabel} tracking reset`, "success");
            await loadItems();
        } catch (error) {
            showMessage("Reset failed: " + error.message, "error");
        }
    }

    function getSelectedAuctionSummary() {
        const selectedAuction = auctions.find((auction) => auction.id === selectedAuctionId);
        if (!selectedAuction) return "Select an auction before exporting.";
        return `${selectedAuction.full_name} (${selectedAuction.status})`;
    }

    function getSelectedExportType() {
        return exportTypeInputs.find((input) => input.checked)?.value || "slides";
    }

    function getSelectedExportSelectionMode() {
        return exportSelectionModeInputs.find((input) => input.checked)?.value || "all";
    }

    function getSelectedBidderReportMode() {
        return bidderReportModeInputs.find((input) => input.checked)?.value || "all";
    }

    function updateExportPanelHeader() {
        exportPanelAuction.textContent = `Auction: ${getSelectedAuctionSummary()}`;
    }

    function updateExportSelectionUI() {
        const exportType = getSelectedExportType();
        let selectionMode = getSelectedExportSelectionMode();
        const isSlipExport = exportType === "slips";
        const isManualEntrySheetExport = exportType === "manual-entry-sheet";
        const isReportPdfExport = exportType === "report-pdf";
        const isBidderReportExport = exportType === "bidder-report-pdf";
        const isCsvExport = exportType === "csv";
        const activePptxJob = latestPptxJob && ["queued", "running", "cancelling"].includes(latestPptxJob.status)
            ? latestPptxJob
            : null;
        const requiresAllItems = isCsvExport || isManualEntrySheetExport || isReportPdfExport;

        if (itemExportSelectionFieldset) {
            itemExportSelectionFieldset.hidden = isBidderReportExport;
        }
        if (bidderReportSelectionFieldset) {
            bidderReportSelectionFieldset.hidden = !isBidderReportExport;
        }

        if (isBidderReportExport) {
            exportRangeControls.hidden = true;
            exportItemRangeInput.disabled = true;
            exportItemRangeInput.value = "";
            resetExportTrackingButton.hidden = true;
            resetExportTrackingButton.disabled = true;

            if (activePptxJob && (exportType === "slides" || exportType === "cards")) {
                runExportButton.disabled = true;
                runExportButton.textContent = "PPTX Generation In Progress";
            } else {
                runExportButton.disabled = false;
                runExportButton.textContent = "Download Bidder Report";
            }
            return;
        }

        if (requiresAllItems && selectionMode === "needs-attention") {
            const allModeInput = exportSelectionModeInputs.find((input) => input.value === "all");
            if (allModeInput) {
                allModeInput.checked = true;
            }
            selectionMode = "all";
        }
        if ((isManualEntrySheetExport || isReportPdfExport) && selectionMode === "range") {
            const allModeInput = exportSelectionModeInputs.find((input) => input.value === "all");
            if (allModeInput) {
                allModeInput.checked = true;
            }
            selectionMode = "all";
        }
        const rangeSelected = selectionMode === "range";

        exportNeedsAttentionTitle.textContent = isSlipExport
            ? "Unprinted / Out of date items"
            : "Unexported / Out of date items";
        exportNeedsAttentionHelp.textContent = isSlipExport
            ? "Only include slips that have not been printed yet or where the item text changed after the last print."
            : "Only include items that have not been exported yet or have changed since the last export.";

        const needsAttentionInput = exportSelectionModeInputs.find((input) => input.value === "needs-attention");
        const needsAttentionChoice = needsAttentionInput?.closest(".export-choice");
        const rangeInput = exportSelectionModeInputs.find((input) => input.value === "range");
        const rangeChoice = rangeInput?.closest(".export-choice");
        const allInput = exportSelectionModeInputs.find((input) => input.value === "all");
        const allChoice = allInput?.closest(".export-choice");
        if (needsAttentionInput) {
            needsAttentionInput.disabled = requiresAllItems;
        }
        if (needsAttentionChoice) {
            needsAttentionChoice.classList.toggle("export-choice--disabled", requiresAllItems);
        }
        if (rangeInput) {
            rangeInput.disabled = isManualEntrySheetExport || isReportPdfExport;
        }
        if (rangeChoice) {
            rangeChoice.classList.toggle("export-choice--disabled", isManualEntrySheetExport || isReportPdfExport);
        }
        if (allChoice) {
            allChoice.classList.remove("export-choice--disabled");
        }

        exportRangeControls.hidden = !rangeSelected;
        exportItemRangeInput.disabled = !rangeSelected;
        if (!rangeSelected) {
            exportItemRangeInput.value = "";
        }

        resetExportTrackingButton.hidden = isCsvExport || isManualEntrySheetExport || isReportPdfExport;
        resetExportTrackingButton.disabled = isCsvExport || isManualEntrySheetExport || isReportPdfExport;
        resetExportTrackingButton.textContent = `Reset ${getExportTypeDisplayText(exportType)} Tracking`;

        if (activePptxJob && (exportType === "slides" || exportType === "cards")) {
            runExportButton.disabled = true;
            runExportButton.textContent = "PPTX Generation In Progress";
        } else {
            runExportButton.disabled = false;
            if (isSlipExport) {
                runExportButton.textContent = "Generate Slip PDF";
            } else if (isManualEntrySheetExport) {
                runExportButton.textContent = "Download Manual Entry Sheet";
            } else if (isReportPdfExport) {
                runExportButton.textContent = "Download Auction Report";
            } else if (isBidderReportExport) {
                runExportButton.textContent = "Download Bidder Report";
            } else if (isCsvExport) {
                runExportButton.textContent = "Download CSV";
            } else {
                runExportButton.textContent = "Start Export";
            }
        }
    }

    async function downloadManualEntrySheet() {
        const token = getTokenOrLogout();
        if (!token) return;

        const response = await fetch(`${API}/auctions/${selectedAuctionId}/items/manual-entry-sheet?selection_mode=all`, {
            headers: { Authorization: token }
        });

        if (!response.ok) {
            let message = "Failed to generate manual entry sheet";
            try {
                const data = await response.json();
                message = data.error || message;
            } catch (parseErr) {
                // keep fallback message
            }
            throw new Error(message);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `auction_${selectedAuctionId}_manual_entry_sheet.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showMessage("Manual entry sheet downloaded", "success");
    }

    async function downloadAuctionReportPdf() {
        const token = getTokenOrLogout();
        if (!token) return;

        const response = await fetch(`${API}/auctions/${selectedAuctionId}/report-pdf?selection_mode=all`, {
            headers: { Authorization: token }
        });

        if (!response.ok) {
            let message = "Failed to generate auction report";
            try {
                const data = await response.json();
                message = data.error || message;
            } catch (parseErr) {
                // keep fallback message
            }
            throw new Error(message);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `auction_${selectedAuctionId}_report.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showMessage("Auction report downloaded", "success");
    }

    async function downloadBidderReportPdf(bidderMode) {
        const token = getTokenOrLogout();
        if (!token) return;

        const params = new URLSearchParams();
        params.set("bidder_mode", bidderMode || "all");
        const response = await fetch(`${API}/auctions/${selectedAuctionId}/bidder-report-pdf?${params.toString()}`, {
            headers: { Authorization: token }
        });

        if (!response.ok) {
            let message = "Failed to generate bidder report";
            try {
                const data = await response.json();
                message = data.error || message;
            } catch (parseErr) {
                // keep fallback message
            }
            throw new Error(message);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `auction_${selectedAuctionId}_bidder_report_${bidderMode || "all"}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showMessage("Bidder report downloaded", "success");
    }

    function renderPptxJobStatus(job) {
        latestPptxJob = job || null;
        const hasJob = !!job;
        exportJobStatus.hidden = !hasJob;
        if (!hasJob) {
            updateExportSelectionUI();
            return;
        }

        const exportLabel = job.export_type === "cards" ? "Item cards" : "Auction slides";
        const statusText = job.status || "unknown";
        const detailParts = [
            `${exportLabel}`,
            `${job.item_count || 0} item(s)`,
            `mode: ${job.selection_mode || "all"}`
        ];
        if (job.item_range) {
            detailParts.push(`range: ${job.item_range}`);
        }
        if (job.started_at) {
            detailParts.push(`started: ${formatIsoDateTime(job.started_at)}`);
        }
        if (job.completed_at) {
            detailParts.push(`finished: ${formatIsoDateTime(job.completed_at)}`);
        }

        exportJobSummary.textContent = `Latest PPTX job: ${statusText}`;
        exportJobDetail.textContent = detailParts.join(" | ");
        cancelExportJobButton.hidden = !["queued", "running", "cancelling"].includes(statusText);
        downloadExportJobButton.hidden = !(statusText === "completed" && job.download_url);
        downloadExportJobButton.disabled = !(statusText === "completed" && job.download_url);

        if (job.error) {
            exportJobSummary.textContent = `Latest PPTX job: ${statusText} (${job.error})`;
        }

        if (job.status === "completed" && job.download_url && autoDownloadJobId === job.id && !downloadedPptxJobs.has(job.id)) {
            downloadedPptxJobs.add(job.id);
            autoDownloadJobId = null;
            void downloadPptxJob(job, false).catch((error) => {
                showMessage(`Failed to download export: ${error.message}`, "error");
            });
        }

        updateExportSelectionUI();
    }

    function stopPptxStatusPolling() {
        if (pptxStatusPollTimer) {
            clearInterval(pptxStatusPollTimer);
            pptxStatusPollTimer = null;
        }
    }

    async function refreshPptxExportStatus() {
        const token = getTokenOrLogout();
        if (!token) return;

        const response = await fetch(`${API}/export-jobs/pptx/status`, {
            headers: { Authorization: token }
        });

        if (!response.ok) {
            throw new Error("Failed to fetch PPTX export status");
        }

        const data = await response.json();
        renderPptxJobStatus(data.job || null);
        if (data.job && ["queued", "running", "cancelling"].includes(data.job.status)) {
            startPptxStatusPolling();
        } else {
            stopPptxStatusPolling();
        }
    }

    function startPptxStatusPolling() {
        if (pptxStatusPollTimer) return;
        pptxStatusPollTimer = setInterval(() => {
            void refreshPptxExportStatus().catch((error) => {
                stopPptxStatusPolling();
                showMessage(`Failed to refresh export status: ${error.message}`, "error");
            });
        }, 2000);
    }

    async function downloadPptxJob(job, announce = true) {
        if (!job?.download_url) return;
        const token = getTokenOrLogout();
        if (!token) return;

        const response = await fetch(job.download_url, {
            headers: { Authorization: token }
        });
        if (!response.ok) {
            let message = "Failed to download PPTX export";
            try {
                const data = await response.json();
                message = data.error || message;
            } catch (parseErr) {
                // keep fallback message
            }
            throw new Error(message);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = job.filename || (job.export_type === "cards" ? "auction_cards.pptx" : "auction_slides.pptx");
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        if (announce) {
            showMessage("PPTX export downloaded", "success");
        }
    }

    async function cancelPptxExportJob() {
        const token = getTokenOrLogout();
        if (!token) return;

        if (!latestPptxJob || !["queued", "running", "cancelling"].includes(latestPptxJob.status)) {
            showMessage("No PPTX export is currently running", "info");
            return;
        }

        const modal = await DayPilot.Modal.confirm("Cancel the current PPTX export?");
        if (modal?.canceled) {
            showMessage("Cancel request aborted", "info");
            return;
        }

        const response = await fetch(`${API}/export-jobs/pptx/cancel`, {
            method: "POST",
            headers: {
                Authorization: token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ job_id: latestPptxJob.id })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Failed to cancel PPTX export");
        }

        renderPptxJobStatus(data.job || latestPptxJob);
        startPptxStatusPolling();
        showMessage(data.message || "Cancellation requested", "info");
    }

    function openExportPanel() {
        if (!selectedAuctionId) {
            showMessage("Please select an auction first", "error");
            return;
        }
        closeMenuGroups();
        updateExportPanelHeader();
        updateExportSelectionUI();
        showSection("export-section");
        void refreshPptxExportStatus().catch(() => {
            renderPptxJobStatus(null);
        });
    }

    function closeExportPanel() {
        stopPptxStatusPolling();
        showSection("admin-section");
    }

    function buildExportSelectionPayload() {
        if (getSelectedExportType() === "bidder-report-pdf") {
            return {
                bidder_mode: getSelectedBidderReportMode()
            };
        }

        const selectionMode = getSelectedExportSelectionMode();
        const itemRange = exportItemRangeInput.value.trim();

        if (selectionMode === "range" && !itemRange) {
            throw new Error("Enter one or more item numbers or ranges");
        }

        return {
            selection_mode: selectionMode,
            item_range: selectionMode === "range" ? itemRange : undefined
        };
    }

    async function startPptxExport(exportType, selectionPayload) {
        const token = getTokenOrLogout();
        if (!token) return;

        const endpoint = exportType === "cards" ? "generate-cards" : "generate-pptx";
        const response = await fetch(`${API}/${endpoint}`, {
            method: "POST",
            headers: {
                Authorization: token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                auction_id: selectedAuctionId,
                async: true,
                ...selectionPayload
            })
        });

        const data = await response.json();
        if (response.status === 409) {
            renderPptxJobStatus(data.job || latestPptxJob);
            startPptxStatusPolling();
            throw new Error(data.error || "A PPTX export is already in progress");
        }
        if (!response.ok) {
            throw new Error(data.error || "Failed to start PPTX export");
        }

        autoDownloadJobId = data.job?.id || null;
        renderPptxJobStatus(data.job || null);
        startPptxStatusPolling();
        showMessage(data.message || "PPTX export started", "info");
    }

    async function downloadCsvExport(selectionPayload) {
        const token = getTokenOrLogout();
        if (!token) return;

        const response = await fetch(`${API}/export-csv`, {
            method: "POST",
            headers: {
                Authorization: token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                auction_id: selectedAuctionId,
                ...selectionPayload
            })
        });

        if (!response.ok) {
            let message = "Failed to export CSV";
            try {
                const data = await response.json();
                message = data.error || message;
            } catch (parseErr) {
                // keep fallback message
            }
            throw new Error(message);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `auction_${selectedAuctionId}_items.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showMessage("CSV export downloaded", "success");
    }

    function closeMenuGroups(exceptMenu = null) {
        menuGroups.forEach((menu) => {
            if (menu !== exceptMenu) {
                menu.removeAttribute("open");
            }
        });
    }

    function formatRoleLabel(role) {
        if (!role) return "Unknown";
        return String(role)
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function formatStateLabel(state) {
        return formatRoleLabel(state);
    }

    function updateAboutBox(user = null, versions = null) {
        if (aboutVersionBackendEl) aboutVersionBackendEl.textContent = versions?.backend || "Unknown";
        if (aboutVersionSchemaEl) aboutVersionSchemaEl.textContent = versions?.schema || "Unknown";
        if (aboutVersionPaymentEl) aboutVersionPaymentEl.textContent = versions?.payment_processor || "Unknown";
    }

    function setAdminSessionMeta(user = null, versions = null) {
        const username = user?.username || "unknown";
        const roleLabel = window.AppAuth?.describeAccess
            ? window.AppAuth.describeAccess(user)
            : formatRoleLabel(user?.role);

        if (loggedInUserEl) loggedInUserEl.textContent = username;
        if (loggedInRoleEl) loggedInRoleEl.textContent = roleLabel;
        if (userMenuButton) userMenuButton.textContent = username;
        updateAboutBox(user, versions);
    }

    window.addEventListener(window.AppAuth?.SESSION_EVENT || "appauth:session", (event) => {
        const session = event.detail || null;
        setAdminSessionMeta(session?.user, session?.versions);
    });

    function updateHeaderAuctionStatus() {
        const selectedAuction = auctions.find((auction) => auction.id === selectedAuctionId);
        const auctionLabel = selectedAuction?.full_name || "none selected";
        const stateLabel = formatStateLabel(selectedAuction?.status || selectAuctionState?.value || "unknown");
        if (currentAuctionPill) currentAuctionPill.textContent = `Auction: ${auctionLabel}`;
        if (currentStatePill) currentStatePill.textContent = `State: ${stateLabel}`;
        updateGoMenuAvailability();
    }

    function updateGoMenuAvailability() {
        const selectedAuction = auctions.find((auction) => auction.id === selectedAuctionId);
        const isSetup = String(selectedAuction?.status || "").toLowerCase() === "setup";

        if (publicButton) {
            publicButton.disabled = !selectedAuction || !isSetup;
            publicButton.title = !selectedAuction
                ? "Please select an auction first"
                : (isSetup ? "" : "Public form is only available while the auction is in setup state");
        }

        if (cashierPageButton) {
            cashierPageButton.disabled = !selectedAuction;
            cashierPageButton.title = selectedAuction ? "" : "Please select an auction first";
        }
    }

    function renderChoiceMenu(container, choices, selectedValue, { disabled = false, titleWhenDisabled = "" } = {}) {
        if (!container) return;
        container.innerHTML = choices.map(({ value, label }) => `
            <button
                type="button"
                class="menu-choice-button${String(value) === String(selectedValue) ? " is-selected" : ""}"
                data-value="${escapeHtml(value)}"
                aria-pressed="${String(value) === String(selectedValue) ? "true" : "false"}"
                ${disabled ? "disabled" : ""}
                ${disabled && titleWhenDisabled ? `title="${escapeHtml(titleWhenDisabled)}"` : ""}
            >
                <span class="menu-choice-check" aria-hidden="true">${String(value) === String(selectedValue) ? "✓" : ""}</span>
                <span>${escapeHtml(label)}</span>
            </button>
        `).join("");
    }

    function syncViewMenus() {
        renderChoiceMenu(
            sortFieldMenu,
            Object.entries(SORT_FIELD_LABELS).map(([value, label]) => ({ value, label })),
            selectedSort
        );
        renderChoiceMenu(
            sortOrderMenu,
            Object.entries(SORT_ORDER_LABELS).map(([value, label]) => ({ value, label })),
            selectedOrder
        );
        renderChoiceMenu(
            photoPreviewSizeMenu,
            Object.entries(PHOTO_PREVIEW_SIZE_LABELS).map(([value, label]) => ({ value, label })),
            selectedPhotoPreviewSize
        );
    }

    function openAboutModal() {
        if (!aboutModal) return;
        closeMenuGroups();
        aboutModal.hidden = false;
    }

    function closeAboutModal() {
        if (!aboutModal) return;
        aboutModal.hidden = true;
    }

    function promptPasswordChange() {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = `
                position: fixed; inset: 0; background: rgba(0,0,0,.5);
                display: flex; align-items: center; justify-content: center; z-index: 9999;
            `;

            const box = document.createElement("div");
            box.style.cssText = `
                background: #fff; padding: 16px; border-radius: 8px; width: min(420px, 92vw);
                box-shadow: 0 8px 24px rgba(0,0,0,.2); font-family: system-ui, sans-serif;
            `;

            const heading = document.createElement("div");
            heading.textContent = "Change password";
            heading.style.cssText = "font-weight: 600; margin-bottom: 10px;";

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



    // Check if admin is already authenticated
    async function checkToken() {
        const token = localStorage.getItem("token");

        if (token) {
            const response = await fetch(`${API}/validate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token })
            });
            const data = await response.json();
            if (response.ok) {
                setAdminSessionMeta(data.user, data.versions);
                showSection("admin-section");
                await refreshAdminData({ showErrors: true, announceConnectivity: false });
                startAutoRefresh();
            } else {
                logout();
                document.getElementById("error-message").innerText = data.error;
                showMessage("Authentication: " + data.error, "error");
            }
        }
    }

    checkToken();
    updateExportPanelHeader();
    updateExportSelectionUI();
    setAdminSessionMeta();
    syncViewMenus();
    updateHeaderAuctionStatus();

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

    document.querySelectorAll(".menu-item-link").forEach((link) => {
        link.addEventListener("click", () => {
            closeMenuGroups();
        });
    });

    sortFieldMenu?.addEventListener("click", (event) => {
        const button = event.target.closest(".menu-choice-button");
        if (!button || button.disabled) return;
        sortSelect.value = button.dataset.value;
        sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    sortOrderMenu?.addEventListener("click", (event) => {
        const button = event.target.closest(".menu-choice-button");
        if (!button || button.disabled) return;
        orderSelect.value = button.dataset.value;
        orderSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    photoPreviewSizeMenu?.addEventListener("click", (event) => {
        const button = event.target.closest(".menu-choice-button");
        if (!button || button.disabled) return;
        photoPreviewSizeSelect.value = button.dataset.value;
        photoPreviewSizeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    auctionStateMenu?.addEventListener("click", (event) => {
        const button = event.target.closest(".menu-choice-button");
        if (!button || button.disabled) return;
        selectAuctionState.value = button.dataset.value;
        selectAuctionState.dispatchEvent(new Event("change", { bubbles: true }));
    });

    openAboutModalButton?.addEventListener("click", openAboutModal);
    closeAboutModalButton?.addEventListener("click", closeAboutModal);
    aboutModal?.addEventListener("click", (event) => {
        if (event.target === aboutModal) {
            closeAboutModal();
        }
    });

    const auctionSelect = document.getElementById("auction-select");
    const orderSelect = document.getElementById("sort-order");
    const sortSelect = document.getElementById("sort-field");
    const photoPreviewSizeSelect = document.getElementById("photo-preview-size");

    async function loadAuctions(options = {}) {
        const { suppressErrors = false, rethrow = false } = options;
        const token = localStorage.getItem("token");

        try {
            const res = await fetch(`${API}/list-auctions`, {
                method: "POST",
                headers: {
                    "Authorization": token,
                    "Content-Type": "application/json"
                },
            });

            if (res.status === 403) {
                if (!suppressErrors) {
                    showMessage("Session expired. Please log in again.", "info");
                }
                window.AppAuth?.clearSharedSession?.({ broadcast: false });
                setTimeout(() => {
                    window.location.href = "/login.html";
                }, 1500);
                throw new Error("Session expired");
            }

            if (!res.ok) {
                const error = await res.json().catch(() => ({}));
                throw new Error(error.error || "Failed to load auctions");
            }

            auctions = await res.json();

            if (auctions.length === 0) {
                if (!suppressErrors) {
                    showMessage("No auctions defined. Use the maintenance interface to add one", "info");
                }
                return;
            }

            auctionSelect.innerHTML = "";

            auctions.forEach(auction => {
                const opt = document.createElement("option");
                opt.value = auction.id;
                opt.textContent = `${auction.full_name} - ${auction.status}`;
                auctionSelect.appendChild(opt);
            });

            const urlParam = new URLSearchParams(window.location.search).get("auction");
            const preferredAuctionId = selectedAuctionId || getSavedAdminAuctionId();

            if (urlParam) {
                const match = auctions.find(a => a.short_name === urlParam);
                if (match) auctionSelect.value = match.id;
            } else if (Number.isInteger(preferredAuctionId) && preferredAuctionId > 0) {
                const match = auctions.find(a => a.id === preferredAuctionId);
                if (match) auctionSelect.value = String(match.id);
            }

            selectedAuctionId = parseInt(auctionSelect.value, 10);
            saveAdminPreferences({ selected_auction_id: selectedAuctionId });
            updateExportPanelHeader();
            updateHeaderAuctionStatus();

            if (window.refreshAuctionStatus) {
                await window.refreshAuctionStatus();
            }
            checkStatusChange();
        } catch (error) {
            if (!suppressErrors) {
                showMessage("Error fetching auctions: " + error.message, "error");
            }
            if (rethrow) throw error;
        }
    }

    function checkStatusChange() {
        // Get the selected auction ID, current state and state change permisison setting
        const selectedAuction = auctions.find(a => a.id === selectedAuctionId);
        selectedAuctionCanChangeState = selectedAuction?.admin_can_change_state;
        const currentStatus = selectedAuction?.status;


        const select = document.getElementById("auctionState");
        select.innerHTML = statusOptions.map(opt =>
            `<option value="${opt}" ${opt === currentStatus ? "selected" : ""}>${opt}</option>`
        ).join("");

        const stateChanger = document.getElementById('stateChanger');

        const hint = document.getElementById("stateHint");

        if (!selectedAuctionCanChangeState) {
            select.disabled = true;
            select.title = "Admin state change disabled for this auction (toggle in Maintenance ▶ Auctions).";
        } else {
            select.disabled = false;
            select.title = "Change auction state";
        }

        renderChoiceMenu(
            auctionStateMenu,
            statusOptions.map((value) => ({ value, label: formatStateLabel(value) })),
            currentStatus,
            {
                disabled: !selectedAuctionCanChangeState,
                titleWhenDisabled: "Admin state change disabled for this auction (toggle in Maintenance ▶ Auctions)."
            }
        );
        updateHeaderAuctionStatus();

        // if (!selectedAuctionCanChangeState) {
        //     stateChanger.hidden = true;
        // } else {stateChanger.hidden = false;
        //     stateChanger.value = currentStatus;

        // }

    }



    auctionSelect.addEventListener("change", async () => {
        selectedAuctionId = parseInt(auctionSelect.value, 10);
        saveAdminPreferences({ selected_auction_id: selectedAuctionId });
        setStoredMovePanelItemId(null);
        closeMenuGroups();
        updateExportPanelHeader();
        await window.refreshAuctionStatus();
        checkStatusChange(); //update the auction state control
        await loadItems();
        if (window.refreshAuctionStatus) window.refreshAuctionStatus();

    });

    orderSelect.addEventListener("change", () => {
        selectedOrder = orderSelect.value;
        saveAdminPreferences({ sort_order: selectedOrder });
        syncViewMenus();
        closeMenuGroups();
        loadItems();
    });

    sortSelect.addEventListener("change", () => {
        selectedSort = sortSelect.value;
        saveAdminPreferences({ sort_field: selectedSort });
        syncViewMenus();
        closeMenuGroups();
        loadItems();
    });

    photoPreviewSizeSelect.addEventListener("change", () => {
        const nextSize = photoPreviewSizeSelect.value;
        selectedPhotoPreviewSize = VALID_PHOTO_PREVIEW_SIZES.has(nextSize) ? nextSize : "small";
        photoPreviewSizeSelect.value = selectedPhotoPreviewSize;
        saveAdminPreferences({ photo_preview_size: selectedPhotoPreviewSize });
        syncViewMenus();
        closeMenuGroups();
        applyPhotoPreviewSize();
    });

    showBidderNamesInput?.addEventListener("change", () => {
        showBidderNames = Boolean(showBidderNamesInput.checked);
        saveAdminPreferences({ show_bidder_names: showBidderNames });
        closeMenuGroups();
        loadItems();
    });

    manageBiddersButton?.addEventListener("click", () => {
        void openManageBiddersModal();
    });


    loginButton.addEventListener("click", async function login() {
        window.location.replace("/login.html");
    })

    logoutButton.addEventListener("click", function () {
        logout();

    })

    changePasswordButton.addEventListener("click", async function () {
        closeMenuGroups();
        const passwordInput = await promptPasswordChange();
        if (!passwordInput) return;
        const { currentPassword, newPassword, confirmPassword } = passwordInput;
        if (!currentPassword || !newPassword || !confirmPassword) {
            showMessage("All password fields are required.", "error");
            return;
        }
        if (newPassword !== confirmPassword) {
            showMessage("Passwords do not match.", "error");
            return;
        }

        const token = localStorage.getItem("token");
        const response = await fetch(`${API}/change-password`, {
            method: "POST",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await response.json();
        if (response.ok) {
            showMessage(data.message || "Password updated.", "success");
        } else {
            showMessage(data.error || "Failed to change password.", "error");
        }
    });


    addItemButton.addEventListener("click", function () {
        closeMenuGroups();
        resetAddDraftState();
        showSection("add-section");
    });

    openExportPanelButton.addEventListener("click", function () {
        openExportPanel();
    });

    closeExportPanelButton.addEventListener("click", function () {
        closeExportPanel();
    });

    cancelExportPanelButton.addEventListener("click", function () {
        closeExportPanel();
    });

    exportTypeInputs.forEach((input) => {
        input.addEventListener("change", updateExportSelectionUI);
    });

    exportSelectionModeInputs.forEach((input) => {
        input.addEventListener("change", updateExportSelectionUI);
    });

    cancelExportJobButton.addEventListener("click", async function () {
        try {
            await cancelPptxExportJob();
        } catch (error) {
            showMessage(`Failed to cancel export: ${error.message}`, "error");
        }
    });

    downloadExportJobButton.addEventListener("click", async function () {
        try {
            await downloadPptxJob(latestPptxJob);
        } catch (error) {
            showMessage(`Failed to download export: ${error.message}`, "error");
        }
    });

    resetExportTrackingButton.addEventListener("click", async function () {
        try {
            await resetExportTracking(getSelectedExportType());
        } catch (error) {
            showMessage(`Failed to reset tracking: ${error.message}`, "error");
        }
    });

    exportForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!selectedAuctionId) {
            showMessage("Please select an auction first", "error");
            return;
        }

        try {
            const exportType = getSelectedExportType();
            const selectionPayload = buildExportSelectionPayload();

            if (exportType === "slips") {
                await printAuctionSlips(selectionPayload.selection_mode, selectionPayload.item_range || "");
                return;
            }
            if (exportType === "manual-entry-sheet") {
                await downloadManualEntrySheet();
                return;
            }
            if (exportType === "report-pdf") {
                await downloadAuctionReportPdf();
                return;
            }
            if (exportType === "bidder-report-pdf") {
                await downloadBidderReportPdf(selectionPayload.bidder_mode);
                return;
            }
            if (exportType === "csv") {
                await downloadCsvExport(selectionPayload);
                return;
            }

            await startPptxExport(exportType, selectionPayload);
        } catch (error) {
            showMessage(error.message || "Export failed", "error");
        }
    });

    refreshButton.addEventListener("click", function () {
        closeMenuGroups();
        void refreshAdminData({ showErrors: true });
    })
    function normalizeString(value) {
        if (value === null || value === undefined) return "";
        return typeof value === "string" ? value : String(value);
    }

    function escapeHtml(str) {
        return normalizeString(str).replace(/[&<>"']/g, (char) => {
            switch (char) {
                case "&":
                    return "&amp;";
                case "<":
                    return "&lt;";
                case ">":
                    return "&gt;";
                case '"':
                    return "&quot;";
                case "'":
                    return "&#39;";
                case "`":
                    return "&#x60;";    
                default:
                    return char;
            }
        });
    }

    function encodeItemData(data) {
        // encodeURIComponent does not escape single quotes, which breaks inline onclick strings
        return encodeURIComponent(JSON.stringify(data)).replace(/'/g, "%27");
    }
        // Escaping "" and '' is becoming too much of a headache to fix, so we're just going to remove quotes from things if they get edited
    function removeQuotes(str) {
        if (typeof str !== "string" || str === null) return ""; // Handle null, undefined, and non-strings safely
        return str
            .replace(/['"]/g, "");  // Removes all single and double quotes
    }

    async function fetchBiddersForSelectedAuction() {
        const auctionId = Number(selectedAuctionId);
        if (!Number.isInteger(auctionId) || auctionId <= 0) {
            throw new Error("Please select an auction first");
        }
        const response = await fetch(`${API}/auctions/${auctionId}/bidders`, {
            headers: { Authorization: localStorage.getItem("token") }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to load bidders");
        return Array.isArray(data.bidders) ? data.bidders : [];
    }

    async function saveBidderName(bidderId, name) {
        const auctionId = Number(selectedAuctionId);
        const response = await fetch(`${API}/auctions/${auctionId}/bidders/${bidderId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: localStorage.getItem("token")
            },
            body: JSON.stringify({ name })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to save bidder");
        return data.bidder;
    }

    async function addOrUpdateBidder(paddleNumber, name) {
        const auctionId = Number(selectedAuctionId);
        const response = await fetch(`${API}/auctions/${auctionId}/bidders`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: localStorage.getItem("token")
            },
            body: JSON.stringify({ paddle_number: Number(paddleNumber), name })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to save bidder");
        return data.bidder;
    }

    async function openManageBiddersModal() {
        const auctionId = Number(selectedAuctionId);
        if (!Number.isInteger(auctionId) || auctionId <= 0) {
            showMessage("Please select an auction first", "error");
            return;
        }

        closeMenuGroups();
        let bidders;
        try {
            bidders = await fetchBiddersForSelectedAuction();
        } catch (error) {
            showMessage(error.message, "error");
            return;
        }

        const archived = getSelectedAuctionStatus() === "archived";
        const overlay = document.createElement("div");
        overlay.className = "app-modal bidder-manager-modal";
        overlay.innerHTML = `
            <div class="app-modal-card app-modal-card--wide bidder-manager-card" role="dialog" aria-modal="true" aria-labelledby="bidder-manager-title">
                <div class="app-modal-header">
                    <div>
                        <h3 id="bidder-manager-title">Manage Bidders</h3>
                        <p>Edit optional bidder names for the selected auction.</p>
                    </div>
                    <button type="button" class="app-modal-close js-close-bidder-manager" aria-label="Close bidder manager">Close</button>
                </div>
                ${archived ? '<div class="bidder-manager-warning">This auction is archived. Bidder names are read only.</div>' : ''}
                <div class="bidder-manager-table-wrap">
                    <table class="bidder-manager-table">
                        <thead><tr><th>Paddle</th><th>Name</th><th></th></tr></thead>
                        <tbody>
                            ${bidders.map((bidder) => `
                                <tr data-bidder-id="${bidder.id}">
                                    <td>${escapeHtml(bidder.paddle_number)}</td>
                                    <td><input type="text" class="bidder-manager-name" value="${escapeHtml(bidder.name || "")}" maxlength="100" ${archived ? "disabled" : ""}></td>
                                    <td><button type="button" class="secondary-button js-save-bidder-name" ${archived ? "disabled" : ""}>Save</button></td>
                                </tr>
                            `).join("") || '<tr><td colspan="3" class="empty-cell">No bidders recorded yet.</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <div class="bidder-manager-add">
                    <label>Paddle #<input type="number" min="1" class="js-new-bidder-paddle" ${archived ? "disabled" : ""}></label>
                    <label>Name<input type="text" maxlength="100" class="js-new-bidder-name" ${archived ? "disabled" : ""}></label>
                    <button type="button" class="js-add-bidder" ${archived ? "disabled" : ""}>Add / Update</button>
                </div>
            </div>
        `;

        const close = () => overlay.remove();
        overlay.querySelectorAll(".js-close-bidder-manager").forEach((button) => button.addEventListener("click", close));
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close();
        });
        overlay.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                close();
            }
        });

        overlay.querySelectorAll(".js-save-bidder-name").forEach((button) => {
            button.addEventListener("click", async () => {
                const row = button.closest("tr");
                const bidderId = Number(row?.dataset.bidderId);
                const input = row?.querySelector(".bidder-manager-name");
                button.disabled = true;
                try {
                    await saveBidderName(bidderId, input?.value || "");
                    showMessage("Bidder name saved", "success");
                    await loadItems({ suppressErrors: true });
                } catch (error) {
                    showMessage(error.message, "error");
                } finally {
                    button.disabled = archived;
                }
            });
        });

        overlay.querySelector(".js-add-bidder")?.addEventListener("click", async () => {
            const paddleInput = overlay.querySelector(".js-new-bidder-paddle");
            const nameInput = overlay.querySelector(".js-new-bidder-name");
            try {
                await addOrUpdateBidder(paddleInput?.value, nameInput?.value || "");
                showMessage("Bidder saved", "success");
                close();
                await openManageBiddersModal();
                await loadItems({ suppressErrors: true });
            } catch (error) {
                showMessage(error.message, "error");
            }
        });

        document.body.appendChild(overlay);
        overlay.tabIndex = -1;
        overlay.focus();
    }


    function logout() {
        window.AppAuth?.clearAllSessions?.({ broadcast: true });
        stopPptxStatusPolling();
        latestPptxJob = null;
        autoDownloadJobId = null;
        sessionStorage.removeItem(OPEN_MOVE_PANEL_KEY);
        closeAboutModal();
        setAdminSessionMeta();
        window.location.replace("/login.html?reason=signed_out");
    }

    function getStoredMovePanelItemId() {
        const rawValue = sessionStorage.getItem(OPEN_MOVE_PANEL_KEY);
        if (!rawValue) return null;

        try {
            const parsed = JSON.parse(rawValue);
            const auctionId = Number(parsed?.auctionId);
            const itemId = Number(parsed?.itemId);
            if (auctionId !== Number(selectedAuctionId)) return null;
            return Number.isInteger(itemId) && itemId > 0 ? itemId : null;
        } catch (_) {
            const itemId = Number(rawValue);
            return Number.isInteger(itemId) && itemId > 0 ? itemId : null;
        }
    }

    function setStoredMovePanelItemId(itemId) {
        const auctionId = Number(selectedAuctionId);
        if (Number.isInteger(itemId) && itemId > 0 && Number.isInteger(auctionId) && auctionId > 0) {
            sessionStorage.setItem(OPEN_MOVE_PANEL_KEY, JSON.stringify({ auctionId, itemId }));
            return;
        }
        sessionStorage.removeItem(OPEN_MOVE_PANEL_KEY);
    }

    function syncMoveToggleStates() {
        document.querySelectorAll(".move-toggle").forEach((button) => {
            const itemId = Number(button.dataset.id);
            const panel = document.querySelector(`.move-panel[data-id="${itemId}"]`);
            const isOpen = !!panel && panel.classList.contains("is-open");
            button.setAttribute("aria-expanded", isOpen ? "true" : "false");
        });
    }

    function closeAllMovePanels() {
        document.querySelectorAll(".move-panel").forEach((panel) => {
            panel.classList.remove("is-open");
            panel.style.display = "none";
        });
        setStoredMovePanelItemId(null);
        syncMoveToggleStates();
    }

    function toggleMovePanel(itemId) {
        const panel = document.querySelector(`.move-panel[data-id="${itemId}"]`);
        const button = document.querySelector(`.move-toggle[data-id="${itemId}"]`);
        const shouldOpen = !!panel && !!button && !button.disabled && !panel.classList.contains("is-open");

        closeAllMovePanels();

        if (!shouldOpen || !panel) {
            return;
        }

        panel.classList.add("is-open");
        panel.style.display = "grid";
        setStoredMovePanelItemId(itemId);
        syncMoveToggleStates();
    }

    function restoreMovePanelState() {
        const itemId = getStoredMovePanelItemId();
        if (!itemId) {
            syncMoveToggleStates();
            return;
        }

        const panel = document.querySelector(`.move-panel[data-id="${itemId}"]`);
        const button = document.querySelector(`.move-toggle[data-id="${itemId}"]`);
        if (!panel || !button || button.disabled) {
            setStoredMovePanelItemId(null);
            syncMoveToggleStates();
            return;
        }

        panel.classList.add("is-open");
        panel.style.display = "grid";
        syncMoveToggleStates();
    }

    let itemContextMenu = null;

    function ensureItemContextMenu() {
        if (itemContextMenu) return itemContextMenu;

        itemContextMenu = document.createElement("div");
        itemContextMenu.className = "item-context-menu";
        itemContextMenu.hidden = true;
        itemContextMenu.setAttribute("role", "menu");
        document.body.appendChild(itemContextMenu);
        return itemContextMenu;
    }

    function closeItemContextMenu() {
        if (!itemContextMenu) return;
        itemContextMenu.hidden = true;
        itemContextMenu.innerHTML = "";
        itemContextMenu.removeAttribute("data-item-id");
    }

    function getRowActionButton(row, selector) {
        return row?.querySelector(selector) || null;
    }

    function buildContextMenuAction({ id, label, button = null, disabled = false, disabledReason = "", run }) {
        const reason = disabled ? (disabledReason || getUnavailableActionReason(button)) : "";
        return { id, label, button, disabled: Boolean(disabled), disabledReason: reason, run };
    }

    function getBidContextMenuLabel(row, bidButton) {
        if (bidButton?.classList.contains("btn-undo")) return "Retract bid";
        if (bidButton?.classList.contains("btn-finalize")) return "Record bid";
        return row?.dataset?.sold === "1" ? "Retract bid" : "Record bid";
    }

    function getItemContextMenuActions(row) {
        const itemId = Number(row?.dataset?.itemId);
        const editButton = getRowActionButton(row, ".edit-item-button, .view-item-button");
        const duplicateButton = getRowActionButton(row, ".duplicate-item-button");
        const moveButton = getRowActionButton(row, ".move-toggle");
        const printButton = getRowActionButton(row, ".print-slip-button");
        const bidButton = getRowActionButton(row, ".btn-finalize, .btn-undo");
        const historyButton = getRowActionButton(row, ".history-button");
        const isView = editButton?.classList.contains("view-item-button");
        const deleteDisabled = isView || isUnavailableActionButton(editButton);
        const deleteReason = isView
            ? getUnavailableActionReason(editButton, "This item cannot be deleted")
            : "This item cannot be deleted";

        return [
            buildContextMenuAction({
                id: "edit",
                label: isView ? "View" : "Edit",
                button: editButton,
                disabled: isUnavailableActionButton(editButton),
                run: () => editButton?.click()
            }),
            buildContextMenuAction({
                id: "delete",
                label: "Delete",
                button: editButton,
                disabled: deleteDisabled,
                disabledReason: deleteReason,
                run: () => deleteItemById(itemId)
            }),
            buildContextMenuAction({
                id: "copy",
                label: "Copy",
                button: duplicateButton,
                disabled: isUnavailableActionButton(duplicateButton),
                run: () => duplicateButton?.click()
            }),
            buildContextMenuAction({
                id: "move",
                label: "Move item / auction",
                button: moveButton,
                disabled: isUnavailableActionButton(moveButton),
                run: () => moveButton?.click()
            }),
            buildContextMenuAction({
                id: "print",
                label: "Print item slip",
                button: printButton,
                disabled: isUnavailableActionButton(printButton),
                run: () => printButton?.click()
            }),
            buildContextMenuAction({
                id: "bid",
                label: getBidContextMenuLabel(row, bidButton),
                button: bidButton,
                disabled: isUnavailableActionButton(bidButton),
                disabledReason: getUnavailableActionReason(bidButton, "Bid commands are unavailable for this auction state or user"),
                run: () => bidButton?.click()
            }),
            buildContextMenuAction({
                id: "history",
                label: "Show history",
                button: historyButton,
                disabled: isUnavailableActionButton(historyButton),
                run: () => historyButton?.click()
            })
        ];
    }

    function positionItemContextMenu(menu, clientX, clientY) {
        menu.style.left = "0px";
        menu.style.top = "0px";
        menu.hidden = false;

        const menuRect = menu.getBoundingClientRect();
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);
        const left = Math.min(Math.max(clientX, margin), maxLeft);
        const top = Math.min(Math.max(clientY, margin), maxTop);

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    function openItemContextMenu(row, event) {
        const itemId = Number(row?.dataset?.itemId);
        if (!Number.isInteger(itemId) || itemId <= 0) return;

        closeMenuGroups();
        const menu = ensureItemContextMenu();
        const itemNumber = normalizeString(row.dataset.item_number || row.cells?.[0]?.textContent || itemId);
        const actions = getItemContextMenuActions(row);

        menu.dataset.itemId = String(itemId);
        menu.innerHTML = `
            <div class="item-context-menu-header">Item #${escapeHtml(itemNumber)}</div>
            <div class="item-context-menu-actions">
                ${actions.map((action) => `
                    <button
                        type="button"
                        class="item-context-menu-action"
                        role="menuitem"
                        data-action-id="${escapeHtml(action.id)}"
                        ${action.disabled ? "disabled" : ""}
                        ${action.disabledReason ? `title="${escapeHtml(action.disabledReason)}"` : ""}
                    >${escapeHtml(action.label)}</button>
                `).join("")}
            </div>
        `;

        menu.querySelectorAll(".item-context-menu-action").forEach((button) => {
            const action = actions.find((candidate) => candidate.id === button.dataset.actionId);
            if (!action || action.disabled) return;
            button.addEventListener("click", async () => {
                closeItemContextMenu();
                await action.run();
            });
        });

        positionItemContextMenu(menu, event.clientX, event.clientY);
        menu.querySelector(".item-context-menu-action:not(:disabled)")?.focus({ preventScroll: true });
    }


    async function loadItems(options = {}) {
        const { suppressErrors = false, rethrow = false } = options;
        closeItemContextMenu();
        const token = localStorage.getItem("token");
        if (!token) return logout();
        const showBidCols = showBidStates.includes(window.currentAuctionStatus);
        const auctionId = parseInt(selectedAuctionId, 10);
        if (!auctionId || isNaN(auctionId)) {
            return;
        }

        try {

            const response = await fetch(`${API}/auctions/${auctionId}/items?sort=${selectedOrder}&field=${selectedSort}`, { headers: { Authorization: token } })

            // Check for 403 (unauthorized)
            if (response.status === 403) {
                if (!suppressErrors) {
                    showMessage("Session expired. Please log in again.", "info");
                }
                window.AppAuth?.clearSharedSession?.({ broadcast: false });
                setTimeout(() => {
                    window.location.href = "/login.html";
                }, 1500);
                throw new Error("Session expired");
            }

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to load items");
            }

            const { items, totals } = await response.json();

            // build the summary text

            document.getElementById("auction-total").textContent =
                `Total: ${currencySymbol}${(totals?.hammer_total || 0).toFixed(2)} (${totals.items_with_bids}/${totals.item_count})`;



            itemsTableBody.innerHTML = "";
            const auctionStatus = getSelectedAuctionStatus();

            items.forEach(item => {

                const description = normalizeString(item.description);
                const contributor = normalizeString(item.contributor);
                const artist = normalizeString(item.artist);
                const notes = normalizeString(item.notes);
                const printStatus = getPrintStatus(item.text_mod_date, item.last_print);

                const escapedDescription = escapeHtml(description);
                const escapedContributor = escapeHtml(contributor);
                const escapedArtist = escapeHtml(artist);

                const encodedItem = encodeItemData({
                    id: item.id,
                    description,
                    contributor,
                    artist,
                    photo: item.photo,
                    date: item.date,
                    notes,
                    mod_date: item.mod_date,
                    last_print: item.last_print,
                    item_number: item.item_number,
                    auction_id: item.auction_id,
                    winning_bidder_id: item.winning_bidder_id,
                    hammer_price: item.hammer_price
                });

                const modToken = item.mod_date ? `?v=${encodeURIComponent(item.mod_date)}` : '';
                const imgSrc = item.photo ? `${API}/uploads/preview_${item.photo}${modToken}` : '';

                const row = document.createElement("tr");
                const hasBid = itemHasBid(item);
                const itemEditState = getItemEditState(item);
                const editTitle = itemEditState.canEdit
                    ? "Edit item"
                    : `View item details (${itemEditState.reason})`;
                const editIcon = itemEditState.canEdit ? ACTION_ICONS.edit : ACTION_ICONS.view;

            

                /* NEW — dataset hooks for the finalize‑lot add‑on */
                row.dataset.itemId = item.id;                         // used by add‑on
                row.dataset.sold = hasBid ? "1" : "0";               // 1 = already sold/has bid
                row.dataset.hasBid = hasBid ? "1" : "0";
                row.dataset.item_number = item.item_number;
                row.dataset.description = item.description;
                row.dataset.bidderName = item.bidder_name || "";
                const moveTitle = hasBid ? "Item has bids and cannot be moved" : "Move item within auction or to a different auction";
                const bidderDisplay = showBidderNames
                    ? formatBidderLabel(item.paddle_no, item.bidder_name)
                    : (item.paddle_no ?? '');

                row.innerHTML = `
                <td>${item.item_number}</td>
                <td>${escapedDescription}</td>
                <td>${escapedContributor}</td>
                <td>${escapedArtist}</td>
                <td>
                    ${item.photo ? `<img src='${imgSrc}' alt='Item Image' class="popup-image item-thumb ${getPhotoPreviewSizeClass()}">` : '<span class="item-photo-placeholder">No image</span>'}
                </td>

                ${showBidCols ? `
                    <td>${escapeHtml(bidderDisplay)}</td>
                    <td>${fmtPrice(hasBid, item.hammer_price ?? '')}</td>` : ''
                    }
                <td class="status-cell">${renderItemStatusIndicator(item.status_code, item.status_label)}</td>
                <td class="actions-cell">
                    <div class="item-actions">
                        ${renderPrintButton(item.id, printStatus)}
                        ${renderIconButton({
                            className: "history-button",
                            title: "Display item history",
                            icon: ACTION_ICONS.history,
                            attributes: `onclick="showItemHistory(${item.id})"`
                        })}
                        ${renderIconButton({
                            className: itemEditState.canEdit ? "edit-item-button" : "view-item-button",
                            title: editTitle,
                            icon: editIcon,
                            attributes: `onclick="editItem('${encodedItem}')" data-default-title="Edit item" data-auction-status="${escapeHtml(auctionStatus)}"`
                        })}
                        ${renderIconButton({
                            className: "duplicate-item-button",
                            title: "Duplicate this item immediately after itself",
                            icon: ACTION_ICONS.duplicate,
                            attributes: `data-id="${item.id}" data-default-title="Duplicate this item immediately after itself"`
                        })}
                        ${renderIconButton({
                            className: "move-toggle",
                            title: moveTitle,
                            icon: ACTION_ICONS.move,
                            attributes: `data-id="${item.id}" data-default-title="Move item within auction or to a different auction" aria-expanded="false" ${hasBid ? "disabled" : ""}`
                        })}
                    </div>
                    <div class="move-panel" data-id="${item.id}" style="display:none;">
                        <select class="move-auction-select" data-id="${item.id}">
                        <option value="">Move to auction...</option>
                        ${auctions
                        .filter(a => a.id !== auctionId)
                        .map(a => {
                            const disabled = (a.status !== "setup" && a.status !== "locked") ? "disabled" : "";
                            const label = `${a.full_name} (${a.status})`;
                            return `<option value="${a.id}" ${disabled}>${label}</option>`;
                        })
                        .join("")}
                            </select>
                    <select class="move-after-dropdown" data-id="${item.id}">
                    <option value="">Move after...</option>
                    ${items
                        .filter(i => i.id !== item.id)
                        .map(i => `<option value="${i.id}">After #${i.item_number} ${i.description.slice(0, 20)}</option>`)
                        .join("")}
                    </select>
                </div>
                </td>
            `;
                itemsTableBody.appendChild(row);
            });

            attachImagePopupEvent();

            document.querySelectorAll('.live-only').forEach(th => {
                th.style.display = showBidCols ? '' : 'none';
            });

            /* NEW — inject Finalize buttons once rows are in the DOM */
            if (window.enhanceFinalizeButtons) window.enhanceFinalizeButtons();
            restoreMovePanelState();


        } catch (error) {
            if (!suppressErrors) {
                showMessage("Error fetching items: " + error.message, "error");
            }
            if (rethrow) throw error;
        }

        document.querySelectorAll(".move-toggle").forEach(button => {
            button.addEventListener("click", function () {
                const itemId = parseInt(this.dataset.id, 10);
                if (!itemId || isNaN(itemId)) return;
                toggleMovePanel(itemId);
            });
        });

        document.querySelectorAll(".print-slip-button").forEach((button) => {
            button.addEventListener("click", async function () {
                const itemId = parseInt(this.dataset.id, 10);
                if (!itemId || isNaN(itemId)) return;
                await printItemSlip(itemId);
            });
        });

        document.querySelectorAll(".move-auction-select").forEach(select => {
            select.addEventListener("change", async function () {
                const currentEditId = parseInt(this.dataset.id, 10);
                const targetAuctionId = parseInt(this.value, 10);
                const token = localStorage.getItem("token");
                const auctionId = parseInt(selectedAuctionId, 10);


                if (!targetAuctionId || isNaN(targetAuctionId)) return;


                try {
                    const response = await fetch(`${API}/auctions/${auctionId}/items/${currentEditId}/move-auction/${targetAuctionId}`, {
                        method: "POST",
                //        body: formData,
                        
                        headers: { Authorization: token }

                    })

                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || "Move failed");

                    showMessage(result.message || "Item moved to different auction", "success");
                    setStoredMovePanelItemId(null);
                    loadItems(); // Refresh the list
                } catch (err) {
                    showMessage("Move failed: " + err.message, "error");
                }
            });
        });

        window.showItemHistory = async function editItem(itemId) {

         

            const token = localStorage.getItem("token");
            const modal = document.getElementById("history-modal");
            const tbody = document.getElementById("history-table-body");

            tbody.innerHTML = `<tr><td colspan="4" style="padding:6px;">Loading...</td></tr>`;
            modal.style.display = "flex";

            try {
                const res = await fetch(`${API}/audit-log?object_type=item&object_id=${itemId}`, {
                    headers: { Authorization: token }
                });

                if (!res.ok) throw new Error("Failed to load history");

                const history = await res.json();

                if (!Array.isArray(history.logs) || history.logs.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="4" style="padding:6px;">No history found for this item.</td></tr>`;
                    return;
                }

                tbody.innerHTML = history.logs.map(record => `
            <tr>
                <td style="padding:6px;">${record.created_at}</td>
                <td style="padding:6px;">${record.user || "?"}</td>
                <td style="padding:6px;">${record.action}</td>
                <td style="padding:6px;">${formatHistoryDetails(record.details)}</td>
            </tr>
        `).join("");

            } catch (err) {
                tbody.innerHTML = `<tr><td colspan="4" style="padding:6px; color:red;">Error: ${err.message}</td></tr>`;
            }
        }


        window.closeHistoryModal = function closeHistoryModal() {

            document.getElementById("history-modal").style.display = "none";
        }

        function formatHistoryDetails(details) {
            if (!details) return "";

            return String(details)
                .replace(/^{|}$/g, "")       // remove surrounding { and }
                .replace(/"/g, "")           // remove quotes
                .replace(/,/g, ", ")         // add space after commas
                .replace(/:/g, ": ")        // add space after colons
                .replace(/\n/g, "<br>")      // convert newlines to <br>
                .replace(/_/g, " "); // replace _ with spaces
        }

    }

    window.loadAdminItems = loadItems;

    async function refreshAdminData({ showErrors = false, announceConnectivity = true } = {}) {
        try {
            const hasSelectedAuction = Number.isInteger(parseInt(selectedAuctionId, 10)) && parseInt(selectedAuctionId, 10) > 0;

            if (hasSelectedAuction) {
                await Promise.all([
                    loadAuctions({ suppressErrors: !showErrors, rethrow: true }),
                    loadItems({ suppressErrors: !showErrors, rethrow: true })
                ]);
            } else {
                await loadAuctions({ suppressErrors: !showErrors, rethrow: true });
                await loadItems({ suppressErrors: !showErrors, rethrow: true });
            }
            setAdminConnectionStatus(true, { announce: announceConnectivity });
            return true;
        } catch (_) {
            setAdminConnectionStatus(false, { announce: announceConnectivity });
            return false;
        }
    }


    document.getElementById("items-table-body").addEventListener("click", async function (e) {
        const duplicateButton = e.target.closest(".duplicate-item-button");
        if (!duplicateButton) return;

        const id = parseInt(duplicateButton.dataset.id, 10);
        if (!id || isNaN(id)) return;

        duplicateButton.disabled = true;
        showMessage(`Duplicating item....`, "info");

        try {
            const res = await fetch(`${API}/auctions/${selectedAuctionId}/items/${id}/move-after/${id}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": localStorage.getItem("token")
                },
                body: JSON.stringify({
                    id,
                    after_id: id,
                    auction_id: selectedAuctionId,
                    copy: true
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to duplicate item");
            }

            showMessage(data.message ||`Item duplicated`, "success");
            loadItems();
        } catch (err) {
            duplicateButton.disabled = false;
            showMessage(err.message || "Failed to duplicate item", "error");
        }
    });


    document.getElementById("items-table-body").addEventListener("change", async function (e) {
        if (e.target.classList.contains("move-after-dropdown")) {
            const dropdown = e.target;
            const id = parseInt(dropdown.dataset.id, 10);
            const after_id = dropdown.value ? parseInt(dropdown.value, 10) : null;
            showMessage(`Moving item....`, "info");

            dropdown.disabled = true;
            const movePanel = dropdown.closest(".move-panel");
            const moveButton = movePanel?.closest(".actions-cell")?.querySelector(".move-toggle");
            if (moveButton) moveButton.disabled = true;

            const res = await fetch(`${API}/auctions/${selectedAuctionId}/items/${id}/move-after/${after_id}`, {

                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": localStorage.getItem("token")
                },
                body: JSON.stringify({
                    id,
                    after_id,
                    auction_id: selectedAuctionId
                })
            });

            const data = await res.json();
            if (res.ok) {
                showMessage(`Item moved`, "success");
                setStoredMovePanelItemId(null);
                loadItems();
            } else {
                dropdown.disabled = false;
                if (moveButton) moveButton.disabled = false;
                showMessage(data.error || "Failed to move item", "error");
            }
        }
    });

    itemsTableBody.addEventListener("contextmenu", function (event) {
        const row = event.target.closest("tr");
        if (!row || !itemsTableBody.contains(row) || !row.dataset.itemId) return;

        event.preventDefault();
        openItemContextMenu(row, event);
    });

    document.addEventListener("contextmenu", (event) => {
        if (!itemContextMenu || itemContextMenu.hidden) return;
        if (itemsTableBody.contains(event.target)) return;
        closeItemContextMenu();
    });

    document.addEventListener("mousedown", (event) => {
        if (!itemContextMenu || itemContextMenu.hidden) return;
        if (itemContextMenu.contains(event.target)) return;
        closeItemContextMenu();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !itemContextMenu || itemContextMenu.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        closeItemContextMenu();
    }, true);

    window.addEventListener("scroll", closeItemContextMenu, true);
    window.addEventListener("resize", closeItemContextMenu);


    function attachImagePopupEvent() {
        document.querySelectorAll(".popup-image").forEach(img => {
            img.addEventListener("click", function () {
                // Extract base filename and mod_date version from the preview image
                const previewSrc = this.src;
                const previewMatch = previewSrc.match(/\/preview_(.+?)(\?v=.*)?$/);

                if (!previewMatch) return;

                const filename = previewMatch[1]; // original photo filename
                const version = previewMatch[2] || ""; // ?v=mod_date

                const fullImageUrl = `${API}/uploads/${filename}${version}`;
                const row = this.closest("tr");
                const itemNumber = normalizeString(row?.dataset?.item_number || "");
                const description = normalizeString(row?.dataset?.description || "");
                const previewTitle = [itemNumber, description].filter(Boolean).join(" - ") || "Image Preview";

                openImagePreviewModal(fullImageUrl, this.alt || "Item image", previewTitle);
            });
        });
    }

    async function stageSelectedAddPhoto(file) {
        if (!file) return;
        setAddDraftImageBlob(file, file.name || "new-item-photo.jpg");
        addPhotoInput.value = "";
        addPhotoLiveInput.value = "";
        showMessage("Photo staged for the new item.", "info");
    }

    addPhotoInput.addEventListener("change", async () => {
        const file = addPhotoInput.files?.[0];
        try {
            await stageSelectedAddPhoto(file);
        } catch (error) {
            showMessage(`Failed to stage photo: ${error.message}`, "error");
        }
    });

    addPhotoLiveInput.addEventListener("change", async () => {
        const file = addPhotoLiveInput.files?.[0];
        try {
            await stageSelectedAddPhoto(file);
        } catch (error) {
            showMessage(`Failed to stage photo: ${error.message}`, "error");
        }
    });

    addForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const formData = new FormData();
        formData.append("description", document.getElementById("add-description").value);
        formData.append("contributor", document.getElementById("add-contributor").value);
        formData.append("artist", document.getElementById("add-artist").value);
        formData.append("notes", document.getElementById("add-notes").value);

        const auctionId = parseInt(selectedAuctionId, 10);

        const selectedAuction = auctions.find(a => a.id === selectedAuctionId);
        const selectedAuctionPublicId = selectedAuction?.public_id;

        if (addDraftImageBlob) {
            formData.append("photo", addDraftImageBlob, addDraftImageFilename || "new-item-photo.jpg");
        } else if (addPhotoInput.files.length > 0) {
            formData.append("photo", addPhotoInput.files[0]);
        }

        var token = localStorage.getItem("token");

        fetch(`${API}/auctions/${selectedAuctionPublicId}/newitem`, {
            method: "POST",
            headers: { "Authorization": token },
            body: formData
        })

            .then(async res => {
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Unknown error");
                }

                showMessage("Item added successfully", "success");
                loadItems();
                resetAddDraftState();

                showSection("admin-section");
            })
            .catch(error => {
                showMessage("Error adding item: " + error, "error");
            })
    });

    cancelAddButton.addEventListener("click", function () {
        resetAddDraftState();
        showSection("admin-section");
    });

    function startAutoRefresh() {
        setInterval(() => {
            if (document.visibilityState === "visible") {
                void refreshAdminData({ showErrors: false });
            } else {
            }
        }, 30000);
    }

    function renderEditDates(item) {
        const created = escapeHtml(normalizeString(item?.date) || "Unknown");
        const modified = escapeHtml(normalizeString(item?.mod_date) || "Unknown");
        const id = escapeHtml(String(item?.id ?? ""));
        return `Created on: <b>${created}</b> Last modified: <b>${modified}</b> Database ID: <b>${id}</b>`;
    }

    function formatItemDetailsValue(value) {
        if (value === null || value === undefined || value === "") return "—";
        return String(value);
    }

    function closeItemDetailsModal() {
        if (!itemDetailsModal) return;
        itemDetailsModal.hidden = true;
    }

    function openImagePreviewModal(imageUrl, altText = "Full image preview", titleText = "Image Preview") {
        if (!imagePreviewModal || !imagePreviewModalImage || !imageUrl) return;
        if (imagePreviewModalTitle) {
            imagePreviewModalTitle.textContent = titleText;
        }
        imagePreviewModalImage.src = imageUrl;
        imagePreviewModalImage.alt = altText;
        imagePreviewModal.hidden = false;
    }

    function closeImagePreviewModal() {
        if (!imagePreviewModal || !imagePreviewModalImage) return;
        imagePreviewModal.hidden = true;
        if (imagePreviewModalTitle) {
            imagePreviewModalTitle.textContent = "Image Preview";
        }
        imagePreviewModalImage.removeAttribute("src");
    }

    async function openItemDetailsModal() {
        const token = getTokenOrLogout();
        if (!token || !currentEditId) return;

        itemDetailsTableBody.innerHTML = `<tr><td colspan="2">Loading...</td></tr>`;
        itemDetailsModalSummary.textContent = `Item #${currentEditItem?.item_number ?? currentEditId} saved row from the items table.`;
        itemDetailsModal.hidden = false;

        try {
            const response = await fetch(`${API}/auctions/${selectedAuctionId}/items/${currentEditId}`, {
                headers: { Authorization: token }
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Failed to load item details");
            }

            itemDetailsTableBody.innerHTML = ITEM_DETAIL_FIELDS.map((field) => `
                <tr>
                    <th scope="row">${escapeHtml(field)}</th>
                    <td>${escapeHtml(formatItemDetailsValue(data[field]))}</td>
                </tr>
            `).join("");
        } catch (error) {
            itemDetailsTableBody.innerHTML = `<tr><td colspan="2">${escapeHtml(error.message)}</td></tr>`;
        }
    }

    async function stageSelectedEditPhoto(file) {
        if (!file) return;
        setDraftImageBlob(file, file.name || "updated-photo.jpg");
        editPhotoInput.value = "";
        editLivePhotoInput.value = "";
        showMessage("Photo change staged. Save Changes to upload it.", "info");
    }

    // Open the editor and get data
    window.editItem = function editItem(encodedData) {
        const item = JSON.parse(decodeURIComponent(encodedData));
        resetEditDraftState();

        currentEditItem = item;
        currentEditId = item.id;
        const editState = getItemEditState(item);
        currentEditCanEdit = editState.canEdit;
        currentEditBlockReason = editState.reason;

        document.getElementById("edit-dates").innerHTML = renderEditDates(item);
        document.getElementById("edit-id").value = item.id || "";
        document.getElementById("edit-description").value = item.description || "";
        document.getElementById("edit-contributor").value = item.contributor || "";
        document.getElementById("edit-artist").value = item.artist || "";
        document.getElementById("edit-notes").value = item.notes || "";
        editPhotoInput.value = "";
        editLivePhotoInput.value = "";

        refreshCurrentPhotoPreview();
        updateEditModeUI();
        showSection("edit-section");
    };

    editPhotoInput.addEventListener("change", async () => {
        if (!currentEditCanEdit) return;
        const file = editPhotoInput.files?.[0];
        try {
            await stageSelectedEditPhoto(file);
        } catch (error) {
            showMessage(`Failed to stage photo: ${error.message}`, "error");
        }
    });

    editLivePhotoInput.addEventListener("change", async () => {
        if (!currentEditCanEdit) return;
        const file = editLivePhotoInput.files?.[0];
        try {
            await stageSelectedEditPhoto(file);
        } catch (error) {
            showMessage(`Failed to stage photo: ${error.message}`, "error");
        }
    });

    editForm.addEventListener("submit", async function (event) {
        const token = getTokenOrLogout();
        if (!token) return;
        event.preventDefault();

        if (!currentEditCanEdit) {
            showMessage(currentEditBlockReason || "This item is view only.", "info");
            return;
        }

        const auctionId = parseInt(selectedAuctionId, 10);
        const formData = new FormData();
        formData.append("id", currentEditId);
        formData.append("description", document.getElementById("edit-description").value.trim() || "");
        formData.append("contributor", document.getElementById("edit-contributor").value.trim() || "");
        formData.append("artist", document.getElementById("edit-artist").value.trim() || "");
        formData.append("notes", document.getElementById("edit-notes").value.trim() || "");
        formData.append("auction_id", auctionId);

        if (draftImageBlob) {
            formData.append("photo", draftImageBlob, draftImageFilename || "edited-photo.jpg");
        }

        try {
            const response = await fetch(`${API}/auctions/${auctionId}/items/${currentEditId}/update`, {
                method: "POST",
                body: formData,
                headers: { Authorization: token }
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Unknown error");
            }

            showMessage(data.message || "Item updated successfully", "success");
            modifiedImages[currentEditId] = Date.now();
            await loadItems();
            setTimeout(() => {
                modifiedImages = {};
            }, 3000);

            resetEditDraftState();
            showSection("admin-section");
        } catch (error) {
            showMessage("Error updating item: " + error.message, "error");
        }
    });

    deleteButton.addEventListener("click", async function () {
        if (!currentEditCanEdit) {
            showMessage(currentEditBlockReason || "This item is view only.", "info");
            return;
        }

        await deleteItemById(currentEditId, {
            afterDelete: () => {
                resetEditDraftState();
                showSection("admin-section");
            }
        });
    });

    cancelEditButton.addEventListener("click", function () {
        resetEditDraftState();
        showSection("admin-section");
    });

    const rotateLeftButton = document.getElementById("rotate-left");
    const rotateRightButton = document.getElementById("rotate-right");

    rotateLeftButton.addEventListener("click", () => rotateImage("left"));
    rotateRightButton.addEventListener("click", () => rotateImage("right"));

    async function rotateImage(direction) {
        if (!currentEditCanEdit) {
            showMessage(currentEditBlockReason || "This item is view only.", "info");
            return;
        }

        try {
            await applyRotateToDraft(direction);
            showMessage("Image rotation staged. Save Changes to upload it.", "info");
        } catch (error) {
            showMessage(`Failed to rotate image: ${error.message}`, "error");
        }
    }

    const cropImageButton = document.getElementById("crop-image");
    const cropModal = document.getElementById("crop-modal");
    const cropTarget = document.getElementById("crop-target");
    const applyCropButton = document.getElementById("apply-crop");
    const cancelCropButton = document.getElementById("cancel-crop");

    cropImageButton.addEventListener("click", () => {
        if (!currentEditCanEdit) {
            showMessage(currentEditBlockReason || "This item is view only.", "info");
            return;
        }

        const currentPhoto = getCurrentEditImageUrl();
        if (!currentPhoto) return;

        activeCropContext = "edit";
        closeCropperModal();
        cropTarget.src = currentPhoto;
        cropModal.style.display = "flex";

        setTimeout(() => {
            cropper = new Cropper(cropTarget, {
                aspectRatio: NaN,
                viewMode: 1,
                autoCropArea: 1
            });
        }, 200);
    });

    cancelCropButton.addEventListener("click", closeCropperModal);

    applyCropButton.addEventListener("click", async function () {
        if (!cropper) return;

        try {
            const croppedCanvas = cropper.getCroppedCanvas();
            if (!croppedCanvas) {
                throw new Error("No crop selection available");
            }
            const croppedBlob = await canvasToBlob(croppedCanvas);
            if (activeCropContext === "add") {
                setAddDraftImageBlob(croppedBlob, addDraftImageFilename || "new-item-photo.jpg");
            } else {
                if (!currentEditCanEdit) {
                    showMessage(currentEditBlockReason || "This item is view only.", "info");
                    return;
                }
                setDraftImageBlob(croppedBlob, draftImageFilename || "cropped.jpg");
            }
            closeCropperModal();
            showMessage(
                activeCropContext === "add"
                    ? "Crop staged for the new item."
                    : "Crop staged. Save Changes to upload it.",
                "info"
            );
        } catch (error) {
            closeCropperModal();
            showMessage("Cropping failed: " + error.message, "error");
        }
    });

    addRotateLeftButton?.addEventListener("click", async () => {
        try {
            await applyRotateToAddDraft("left");
            showMessage("Image rotation staged for the new item.", "info");
        } catch (error) {
            showMessage(`Failed to rotate image: ${error.message}`, "error");
        }
    });

    addRotateRightButton?.addEventListener("click", async () => {
        try {
            await applyRotateToAddDraft("right");
            showMessage("Image rotation staged for the new item.", "info");
        } catch (error) {
            showMessage(`Failed to rotate image: ${error.message}`, "error");
        }
    });

    addCropImageButton?.addEventListener("click", () => {
        const currentPhoto = getCurrentAddImageUrl();
        if (!currentPhoto) return;

        activeCropContext = "add";
        closeCropperModal();
        cropTarget.src = currentPhoto;
        cropModal.style.display = "flex";

        setTimeout(() => {
            cropper = new Cropper(cropTarget, {
                aspectRatio: NaN,
                viewMode: 1,
                autoCropArea: 1
            });
        }, 200);
    });

    showAllItemDataButton?.addEventListener("click", openItemDetailsModal);
    closeItemDetailsModalButton?.addEventListener("click", closeItemDetailsModal);
    itemDetailsModal?.addEventListener("click", (event) => {
        if (event.target === itemDetailsModal) {
            closeItemDetailsModal();
        }
    });
    closeImagePreviewModalButton?.addEventListener("click", closeImagePreviewModal);
    imagePreviewModal?.addEventListener("click", (event) => {
        if (event.target === imagePreviewModal) {
            closeImagePreviewModal();
        }
    });

    // Button to open the live feed view
    liveFeedButton.addEventListener("click", function () {
        closeMenuGroups();

        const selectedAuction = auctions.find(a => a.id === selectedAuctionId);
        const status = selectedAuction?.status;


        window.location.assign(`/cashier/live-feed.html?auctionId=${selectedAuctionId}&auctionStatus=${status}`);

    })

    // Button to open the public page
    publicButton.addEventListener("click", function () {
        closeMenuGroups();
        // look up the current shortname
        const selectedAuction = auctions.find(a => a.id === selectedAuctionId);
        const shortName = selectedAuction?.short_name;
        if (!selectedAuction || selectedAuction.status !== "setup") return;
        window.open(`/index.html?auction=` + shortName, '_blank').focus();

    })

    cashierPageButton?.addEventListener("click", function () {
        closeMenuGroups();
        const selectedAuction = auctions.find(a => a.id === selectedAuctionId);
        if (!selectedAuction) return;
        const status = selectedAuction?.status || "";
        window.location.assign(`/cashier/index.html?auctionId=${selectedAuctionId}&auctionStatus=${encodeURIComponent(status)}`);
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            loadItems();
            if (exportSection.style.display === "block") {
                void refreshPptxExportStatus().catch(() => {
                    renderPptxJobStatus(null);
                });
            }
        }

    });


    document.getElementById('auctionState')?.addEventListener('change', async () => {
        var token = localStorage.getItem("token");
        if (!token) return logout();
        closeMenuGroups();



        const newStatus = selectAuctionState.value;

        try {
            const res = await fetch(`${API}/auctions/update-status`, {
                method: 'POST',
                headers: {
                    Authorization: token,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ auction_id: selectedAuctionId, status: newStatus })
            });

            const data = await res.json();
            if (res.ok) {
                showMessage(data.message || `Status updated`, "success");
                loadItems();
                loadAuctions();
            } else {
                showMessage(data.error || "Failed to update status", "error");
            }

        } catch (e) {
            showMessage("Network error while changing auction state.", "error");
        }
    });
    // Global keydown listener for useful keyboardshortcuts
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && imagePreviewModal && !imagePreviewModal.hidden) {
            e.preventDefault();
            closeImagePreviewModal();
        }
        else if (e.key === 'Escape' && itemDetailsModal && !itemDetailsModal.hidden) {
            e.preventDefault();
            closeItemDetailsModal();
        }
        else if (e.key === 'Escape' && cropModal && cropModal.style.display === 'flex') {
            e.preventDefault();
            closeCropperModal();
        }
        else if (e.key === 'Escape' && editSection.style.display === 'block') {
            e.preventDefault();
            cancelEditButton.click();
        }
        else if (e.key === 'Escape' && addSection.style.display === 'block') {
            e.preventDefault();
            cancelAddButton.click();
        }
        else if (e.key === 'd' && e.ctrlKey && editSection.style.display === 'block') {
            e.preventDefault();
            if (!deleteButton.disabled) {
                deleteButton.click();
            }
        }
        else if (e.key === 's' && e.ctrlKey && editSection.style.display === 'block') {
            e.preventDefault();
            if (!saveEditButton.disabled) {
                saveEditButton.click();
            }
        }
        else if (e.key === 'Escape' || e.key === `Enter` && document.getElementById("history-modal").style.display === 'flex') {
            e.preventDefault();
            closeHistoryModal();
        }
        else if (e.key === 's' && e.ctrlKey && addSection.style.display === 'block') {
            e.preventDefault();
            saveNewButton.click();
        }
        else if (e.key === 'Escape' && exportSection.style.display === 'block') {
            e.preventDefault();
            closeExportPanel();
        }
        else if (e.key === 'Escape' && aboutModal && !aboutModal.hidden) {
            e.preventDefault();
            closeAboutModal();
        }

    });

});
