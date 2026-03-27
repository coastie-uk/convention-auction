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
    const userMenuButton = document.getElementById("admin-user-menu-button");
    const itemsTableBody = document.getElementById("items-table-body");
    const editForm = document.getElementById("edit-form");
    const deleteButton = document.getElementById("delete-item");
    const cancelEditButton = document.getElementById("cancel-edit");
    const editPhotoInput = document.getElementById("edit-photo");
    const openExportPanelButton = document.getElementById("open-export-panel");
    const addForm = document.getElementById("add-form");
    const cancelAddButton = document.getElementById("cancel-add");
    const addPhotoInput = document.getElementById("add-photo");
    const editLivePhotoInput = document.getElementById("edit-photo-live");
    const addItemButton = document.getElementById("add-item");
    const refreshButton = document.getElementById("refresh");
    const liveFeedButton = document.getElementById("livefeed");
    const publicButton = document.getElementById("public");
    const selectAuctionState = document.getElementById('auctionState');
    const saveEditButton = document.getElementById("save-changes");
    const saveNewButton = document.getElementById("save-new");
    const closeExportPanelButton = document.getElementById("close-export-panel");
    const cancelExportPanelButton = document.getElementById("cancel-export-panel");
    const exportForm = document.getElementById("export-form");
    const exportPanelAuction = document.getElementById("export-panel-auction");
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
    const exportTypeInputs = Array.from(document.querySelectorAll('input[name="export-type"]'));
    const exportSelectionModeInputs = Array.from(document.querySelectorAll('input[name="export-selection-mode"]'));
    const statusOptions = ["setup", "locked", "live", "settlement", "archived"];
    const managedSections = [loginSection, adminSection, editSection, addSection, exportSection].filter(Boolean);

    let currentEditId = null;
    let modifiedImages = {};
    let auctions = [];
    let selectedAuctionId = null;
    let selectedAuctionCanChangeState = 0;
    let selectedOrder = sessionStorage.getItem("item_sort_order") || "asc";
    let selectedSort = sessionStorage.getItem("item_sort_field") || "item_number";
    let currencySymbol = localStorage.getItem("currencySymbol") || "£";
    let pptxStatusPollTimer = null;
    let latestPptxJob = null;
    let autoDownloadJobId = null;
    const downloadedPptxJobs = new Set();

    document.getElementById("sort-field").value = selectedSort;
    document.getElementById("sort-order").value = selectedOrder;

    // controls whether to show bidder & amount columns
    const showBidStates = ['live', 'settlement', 'archived'];

    const fmtPrice = (a, v) => a ? `${currencySymbol}${Number(v).toFixed(2)}` : '';

    const API = "/api";

    function showSection(sectionId) {
        managedSections.forEach((section) => {
            if (!section) return;
            section.style.display = section.id === sectionId ? "block" : "none";
        });
    }

    function getTokenOrLogout() {
        const token = localStorage.getItem("token");
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
        if (!value || typeof value !== "string") return null;
        const match = value.trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) return null;
        const [, dd, mm, yyyy, hh, min, sec] = match;
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

    function getPrintStatus(modDate, lastPrint) {
        const lastPrintTs = parseDbDateTime(lastPrint);
        if (!lastPrintTs) return "unprinted";

        const modTs = parseDbDateTime(modDate);
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
            <button class="print-slip-button ${statusClass}" data-id="${itemId}" title="Print item slip (${statusHint})" aria-label="Print item slip">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M7 3h10v4H7zM7 17h10v4H7zM7 12h10v4H7z"></path>
                    <path d="M4 8h16a2 2 0 0 1 2 2v5h-3v-3H5v3H2v-5a2 2 0 0 1 2-2z"></path>
                </svg>
            </button>
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

    function updateExportPanelHeader() {
        exportPanelAuction.textContent = `Auction: ${getSelectedAuctionSummary()}`;
    }

    function updateExportSelectionUI() {
        const exportType = getSelectedExportType();
        let selectionMode = getSelectedExportSelectionMode();
        const isSlipExport = exportType === "slips";
        const isCsvExport = exportType === "csv";
        const activePptxJob = latestPptxJob && ["queued", "running", "cancelling"].includes(latestPptxJob.status)
            ? latestPptxJob
            : null;

        if (isCsvExport && selectionMode === "needs-attention") {
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
        if (needsAttentionInput) {
            needsAttentionInput.disabled = isCsvExport;
        }
        if (needsAttentionChoice) {
            needsAttentionChoice.hidden = isCsvExport;
        }

        exportRangeControls.hidden = !rangeSelected;
        exportItemRangeInput.disabled = !rangeSelected;
        if (!rangeSelected) {
            exportItemRangeInput.value = "";
        }

        resetExportTrackingButton.hidden = isCsvExport;
        resetExportTrackingButton.disabled = isCsvExport;
        resetExportTrackingButton.textContent = `Reset ${getExportTypeDisplayText(exportType)} Tracking`;

        if (activePptxJob && (exportType === "slides" || exportType === "cards")) {
            runExportButton.disabled = true;
            runExportButton.textContent = "PPTX Generation In Progress";
        } else {
            runExportButton.disabled = false;
            if (isSlipExport) {
                runExportButton.textContent = "Generate Slip PDF";
            } else if (isCsvExport) {
                runExportButton.textContent = "Download CSV";
            } else {
                runExportButton.textContent = "Start Export";
            }
        }
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

    function setAdminUserMenu(username) {
        if (!username) return;
        if (loggedInUserEl) loggedInUserEl.textContent = username;
        if (userMenuButton) userMenuButton.textContent = username;
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
                setAdminUserMenu(data.user?.username || "admin");
                showSection("admin-section");
                await loadAuctions();
                loadItems();
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

    const auctionSelect = document.getElementById("auction-select");
    const orderSelect = document.getElementById("sort-order");
    const sortSelect = document.getElementById("sort-field");

    async function loadAuctions() {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API}/list-auctions`, {
            method: "POST",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json"
            },
        });
        auctions = await res.json();

        if (auctions.length === 0) {
            showMessage("No auctions defined. Use the maintenance interface to add one", "info");
            return;
        }
        // build a list of auctions for the selector
        auctionSelect.innerHTML = "";

        auctions.forEach(auction => {
            const opt = document.createElement("option");
            opt.value = auction.id;
            opt.textContent = `${auction.full_name} - ${auction.status}`;
            auctionSelect.appendChild(opt);
        });

        // Preselect from URL or sessionStorage
        const urlParam = new URLSearchParams(window.location.search).get("auction");
        const storedAuctionId = sessionStorage.getItem("auction_id");

        if (urlParam) {
            const match = auctions.find(a => a.short_name === urlParam);
            if (match) auctionSelect.value = match.id;
        } else if (storedAuctionId) {
            auctionSelect.value = storedAuctionId;
        }

        selectedAuctionId = parseInt(auctionSelect.value, 10);
        sessionStorage.setItem("auction_id", selectedAuctionId);
        updateExportPanelHeader();

        if (window.refreshAuctionStatus) {        // get status first
            await window.refreshAuctionStatus();
        }
        loadItems();    // now build the table
        checkStatusChange();   // now update the change state control      


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

        // if (!selectedAuctionCanChangeState) {
        //     stateChanger.hidden = true;
        // } else {stateChanger.hidden = false;
        //     stateChanger.value = currentStatus;

        // }

    }



    auctionSelect.addEventListener("change", async () => {
        selectedAuctionId = parseInt(auctionSelect.value, 10);
        sessionStorage.setItem("auction_id", selectedAuctionId);
        updateExportPanelHeader();
        await window.refreshAuctionStatus();
        checkStatusChange(); //update the auction state control
        loadItems();
        if (window.refreshAuctionStatus) window.refreshAuctionStatus();

    });

    orderSelect.addEventListener("change", () => {
        selectedOrder = orderSelect.value;
        sessionStorage.setItem("item_sort_order", selectedOrder);
        loadItems();
    });

    sortSelect.addEventListener("change", () => {
        selectedSort = sortSelect.value;
        sessionStorage.setItem("item_sort_field", selectedSort);
        loadItems();
    });


    loginButton.addEventListener("click", async function login() {
        const username = document.getElementById("admin-username").value.trim();
        const password = document.getElementById("admin-password").value;
        if (!username || !password) {
            showMessage("Username and password are required.", "error");
            return;
        }
        const response = await fetch(`${API}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, role: "admin" })
        });
        document.getElementById("admin-username").value = "";
        document.getElementById("admin-password").value = "";
        const data = await response.json();
        if (response.ok) {
            localStorage.setItem("token", data.token);
            currencySymbol = data.currency || "£";
            localStorage.setItem("currencySymbol", currencySymbol);
            setAdminUserMenu(data.user?.username || username);
            showSection("admin-section");

            loadAuctions();
            loadItems();
            startAutoRefresh();
        } else {
            showMessage("Login failed: " + data.error, "error");
            document.getElementById("error-message").innerText = data.error;
        }
    })

    logoutButton.addEventListener("click", function () {
        logout();

    })

    changePasswordButton.addEventListener("click", async function () {
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
        loadItems();
        loadAuctions();
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


    function logout() {
        localStorage.removeItem("token");
        stopPptxStatusPolling();
        latestPptxJob = null;
        autoDownloadJobId = null;
        showSection("login-section");
    }


    async function loadItems() {
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
                showMessage("Session expired. Please log in again.", "info");
                localStorage.removeItem("token");
                setTimeout(() => {
                    window.location.href = "/admin";
                }, 1500);
                return;
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
                    auction_id: item.auction_id
                });

                const modToken = item.mod_date ? `?v=${encodeURIComponent(item.mod_date)}` : '';
                const imgSrc = item.photo ? `${API}/uploads/preview_${item.photo}${modToken}` : '';

                const row = document.createElement("tr");
                const hasBid = item.hammer_price != null || item.paddle_no != null;

            

                /* NEW — dataset hooks for the finalize‑lot add‑on */
                row.dataset.itemId = item.id;                         // used by add‑on
                row.dataset.sold = hasBid ? "1" : "0";               // 1 = already sold/has bid
                row.dataset.hasBid = hasBid ? "1" : "0";
                row.dataset.item_number = item.item_number;
                row.dataset.description = item.description;
                row.innerHTML = `
                <td>${item.item_number}</td>
                <td>${escapedDescription}</td>
                <td>${escapedContributor}</td>
                <td>${escapedArtist}</td>
                <td>
                    ${item.photo ? `<img src='${imgSrc}' alt='Item Image' style="max-width:60px; cursor:pointer;" class="popup-image">` : 'No Image'}
                </td>

                ${showBidCols ? `
                    <td>${item.paddle_no ?? ''}</td>
                    <td>${fmtPrice(hasBid, item.hammer_price ?? '')}</td>` : ''
                    }
                <td>
            
                    ${renderPrintButton(item.id, printStatus)}
                    <button onclick="showItemHistory(${item.id})" title="Display item history">History</button>
                    <button onclick="editItem('${encodedItem}')" data-default-title="Edit item" title="${hasBid ? 'Item has bids and cannot be edited' : 'Edit item'}" ${hasBid ? 'disabled' : ''}>Edit</button>
                    <button class="duplicate-item-button" data-id="${item.id}" title="Duplicate this item immediately after itself">Duplicate</button>
                    <button class="move-toggle" data-id="${item.id}" data-default-title="Move item within auction or to a different auction" title="${hasBid ? 'Item has bids and cannot be moved' : 'Move item within auction or to a different auction'}" ${hasBid ? 'disabled' : ''} >Move</button>
                    <div class="move-panel" data-id="${item.id}" style="display:none; margin-top: 5px;">
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
                    <br/>
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


        } catch (error) {
            showMessage("Error fetching items: " + error.message, "error");
        }

        document.querySelectorAll(".move-toggle").forEach(button => {
            button.addEventListener("click", function () {
                const panel = this.nextElementSibling;
                panel.style.display = panel.style.display === "none" ? "block" : "none";
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
            const moveButton = dropdown.closest(".move-panel")?.previousElementSibling;
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
                loadItems();
            } else {
                dropdown.disabled = false;
                if (moveButton) moveButton.disabled = false;
                showMessage(data.error || "Failed to move item", "error");
            }
        }
    });


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

                const popup = window.open("", "ImagePopup", "width=800,height=800");
                popup.document.write(`
                    <html>
                        <head><title>Image Preview</title></head>
                        <body style='margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#000;'>
                            <img src="${fullImageUrl}" style="max-width:100%;max-height:100%;">
                        </body>
                    </html>
                `);
            });
        });
    }

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
        


        if (addPhotoInput.files.length > 0) {
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
                document.getElementById("add-description").value = "";
                document.getElementById("add-contributor").value = "";
                document.getElementById("add-artist").value = "";
                document.getElementById("add-photo").value = "";
                document.getElementById("add-notes").value = "";

                showSection("admin-section");
            })
            .catch(error => {
                showMessage("Error adding item: " + error, "error");
            })
    });

    cancelAddButton.addEventListener("click", function () {
        showSection("admin-section");
    });

    function startAutoRefresh() {
        setInterval(() => {
            if (document.visibilityState === "visible") {
                loadItems();
                loadAuctions();
            } else {
            }
        }, 30000);
    }

    // Open the editor and get data
    window.editItem = function editItem(encodedData) {
        const item = JSON.parse(decodeURIComponent(encodedData));

        // Use the extracted values. Dates are recorded by the backend
        document.getElementById("edit-title").innerHTML = "<h2>Edit item #" + item.item_number + "</h2>";
        document.getElementById("edit-dates").innerHTML = "Created on: <b>" + item.date + "</b> Last modified: <b>" + item.mod_date + "</b> Database ID: <b>" + item.id + "</b>";


        document.getElementById("edit-id").value = item.id || "";
        document.getElementById("edit-description").value = item.description || "";
        document.getElementById("edit-contributor").value = item.contributor || "";
        document.getElementById("edit-artist").value = item.artist || "";
        document.getElementById("edit-notes").value = item.notes || "";
        document.getElementById("current-photo").src = item.photo;

        document.getElementById("edit-photo").value = "";
        document.getElementById("edit-photo-live").value = "";

        const hasPhoto = !!item.photo;

        document.getElementById("rotate-left").disabled = !hasPhoto;
        document.getElementById("rotate-right").disabled = !hasPhoto;
        document.getElementById("crop-image").disabled = !hasPhoto;

        if (item.photo && item.photo !== "null") {
            document.getElementById("current-photo").src = `${API}/uploads/${item.photo}?v=${encodeURIComponent(item.mod_date)}`;

        } else {
            document.getElementById("current-photo").src = "";

        }

        showSection("edit-section");
        currentEditId = item.id;
        
// // TODO why doesn't this work???
//             editForm.addEventListener('keydown', e => {
//   if (e.key === 'Escape') { e.preventDefault(); cancelEditButton.click(); }
//     });
    };



    editForm.addEventListener("submit", function (event) {
        var token = localStorage.getItem("token");
        if (!token) return logout();
        event.preventDefault();

        const auctionId = parseInt(selectedAuctionId, 10);


        const formData = new FormData();
        formData.append("id", currentEditId); // Ensure the ID is sent
        formData.append("description", document.getElementById("edit-description").value.trim() || "");
        formData.append("contributor", document.getElementById("edit-contributor").value.trim() || "");
        formData.append("artist", document.getElementById("edit-artist").value.trim() || "");
        formData.append("notes", document.getElementById("edit-notes").value.trim() || "");
        formData.append("auction_id", auctionId);


        if (editLivePhotoInput.files.length > 0) {
            formData.append("photo", editLivePhotoInput.files[0]);
        } else if (editPhotoInput.files.length > 0) {
            formData.append("photo", editPhotoInput.files[0]);
        }

        fetch(`${API}/auctions/${auctionId}/items/${currentEditId}/update`, {
            method: "POST",
            body: formData,
            headers: { "Authorization": token }

        })

            .then(async res => {
                const data = await res.json();
                if (!res.ok) {
                    
                    throw new Error(data.error || "Unknown error");
                }
                showMessage(data.message || "Item updated successfully", "success");
                const now = new Date().getTime();
                modifiedImages[currentEditId] = now;

                loadItems();
                setTimeout(() => {
                    modifiedImages = {};
                }, 3000); // clear it after a short while

                showSection("admin-section");
            })
            .catch(error => {
                showMessage("Error updating item: " + error, "error");
            })
    });

    deleteButton.addEventListener("click", async function () {
        var token = localStorage.getItem("token");
        if (!token) return logout();

        const modal = await DayPilot.Modal.confirm("Are you sure you want to delete this item?");
        if (modal.canceled) {
            showMessage("Delete cancelled", "info");
            return;
        } else {
            fetch(`${API}/items/${currentEditId}`, {
                method: "DELETE",
                headers: { "Authorization": token }
            })
                .then(async res => {
                    const data = await res.json();
                    if (!res.ok) {
                        
                        throw new Error(data.error || "Unknown error");
                    }

                    showMessage(data.message || "Item deleted successfully", "success");
                    loadItems();
                    showSection("admin-section");
                })
                .catch(error => {
                    showMessage("Error deleting item: " + error, "error");
                })

        }
    });

    cancelEditButton.addEventListener("click", function () {
        showSection("admin-section");
    });

    const rotateLeftButton = document.getElementById("rotate-left");
    const rotateRightButton = document.getElementById("rotate-right");

    rotateLeftButton.addEventListener("click", () => rotateImage("left"));
    rotateRightButton.addEventListener("click", () => rotateImage("right"));

    function rotateImage(direction) {
        const token = localStorage.getItem("token");
        if (!token || !currentEditId) return;

        fetch(`${API}/rotate-photo`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            },
            body: JSON.stringify({ id: currentEditId, direction })
        })
            .then(res => res.json())
            .then(data => {
                showMessage("Image rotated", "success");

                const currentPhoto = document.getElementById("current-photo");
                currentPhoto.src = currentPhoto.src.split("?")[0] + `?t=${new Date().getTime()}`; // Bust cache
                const now = new Date().getTime();
                modifiedImages[currentEditId] = now;
            })
            .catch(err => {
                showMessage("Failed to rotate image", "error");
            });
    }

    const cropImageButton = document.getElementById("crop-image");
    const cropModal = document.getElementById("crop-modal");
    const cropTarget = document.getElementById("crop-target");
    const applyCropButton = document.getElementById("apply-crop");
    const cancelCropButton = document.getElementById("cancel-crop");

    cropImageButton.addEventListener("click", () => {
        var currentPhoto = document.getElementById("current-photo").src.replace(/preview_/, "");
        cropTarget.src = currentPhoto + `?t=${new Date().getTime()}`; // bust cache
        cropModal.style.display = "flex";

        setTimeout(() => {
            cropper = new Cropper(cropTarget, {
                aspectRatio: NaN,
                viewMode: 1,
                autoCropArea: 1,
            });
        }, 200);
    });

    cancelCropButton.addEventListener("click", () => {

        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        cropModal.style.display = "none";
    })


    applyCropButton.addEventListener("click", async function () {
        const modal = await DayPilot.Modal.confirm("Are you sure you want to crop? Change is applied immediately");
        if (modal.canceled) {
            showMessage("Delete cancelled", "info");
            return;
        } else {

            cropper.getCroppedCanvas().toBlob(blob => {
                const formData = new FormData();
                const auctionId = parseInt(selectedAuctionId, 10);

                formData.append("id", currentEditId);
                formData.append("description", document.getElementById("edit-description").value.trim() || "");
                formData.append("contributor", document.getElementById("edit-contributor").value.trim() || "");
                formData.append("artist", document.getElementById("edit-artist").value.trim() || "");
                formData.append("notes", document.getElementById("edit-notes").value.trim() || "");
                formData.append("photo", blob, "cropped.jpg");

                const token = localStorage.getItem("token");

                fetch(`${API}/auctions/${auctionId}/items/${currentEditId}/update`, {
                    method: "POST",
                    body: formData,
                    headers: { Authorization: token }
                })

                    .then(async res => {
                        if (!res.ok) {
                            const data = await res.json();
                            throw new Error(data.error || "Unknown error");
                        }
                        showMessage("Image cropped and saved", "success");
                        cropper.destroy();
                        cropModal.style.display = "none";
                        modifiedImages[currentEditId] = new Date().getTime();
                        loadItems();

                        const currentPhoto = document.getElementById("current-photo");
                        if (currentPhoto && currentPhoto.src) {
                            // Update the image with a cache-busting timestamp
                            currentPhoto.src = currentPhoto.src.split("?")[0] + `?t=${new Date().getTime()}`;
                        }
                    })
                    .catch(err => {
                        cropper.destroy();
                        cropModal.style.display = "none";
                        showMessage("Cropping failed: " + err.message, "error");
                    });
            }, "image/jpeg", 0.9);
        }
    });

    // Button to open the live feed view
    liveFeedButton.addEventListener("click", function () {

        const selectedAuction = auctions.find(a => a.id === selectedAuctionId);
        const status = selectedAuction?.status;


        window.open(`/cashier/live-feed.html?auctionId=${selectedAuctionId}&auctionStatus=${status}`, '_blank').focus();

    })

    // Button to open the public page
    publicButton.addEventListener("click", function () {
        // look up the current shortname
        const selectedAuction = auctions.find(a => a.id === selectedAuctionId);
        const shortName = selectedAuction?.short_name;
        window.open(`/index.html?auction=` + shortName, '_blank').focus();

    })

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
        if (e.key === 'Escape' && editSection.style.display === 'block') {
            e.preventDefault();
            cancelEditButton.click();
        }
        else if (e.key === 'Escape' && addSection.style.display === 'block') {
            e.preventDefault();
            cancelAddButton.click();
        }
        else if (e.key === 'd' && e.ctrlKey && editSection.style.display === 'block') {
            e.preventDefault();
            deleteButton.click();
        }
        else if (e.key === 's' && e.ctrlKey && editSection.style.display === 'block') {
            e.preventDefault();
            saveEditButton.click();
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

 
    });


});
