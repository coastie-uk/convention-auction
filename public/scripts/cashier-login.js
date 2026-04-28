(() => {
  "use strict";

  const API = "/api";
  const REFRESH_MS = 10000;
  const BUYER_DISPLAY_STATE_KEY = "cashierBuyerDisplayState";
  const CASHIER_ASSET_VERSION = window.__CASHIER_ASSET_VERSION__ || "2026-04-28-queue-mobile-1";

  const $ = (id) => document.getElementById(id);
  const els = {
    loginSection: $("login-section"),
    cashierSection: $("cashier-section"),
    cashierWorkspace: $("cashier-workspace"),
    cashierEmptyPanel: $("cashier-empty-panel"),
    cashierEmptyTitle: $("cashier-empty-title"),
    cashierEmptyCopy: $("cashier-empty-copy"),
    userInput: $("cashier-username"),
    pwInput: $("cashier-password"),
    loginBtn: $("login-button"),
    error: $("error-message"),
    auctionSelect: $("auction-select"),
    summaryBtn: $("summaryBtn"),
    csvBtn: $("csv"),
    goPublicBtn: $("go-public"),
    goLiveFeedBtn: $("go-livefeed"),
    openBuyerDisplayBtn: $("open-buyer-display"),
    toggleShowPictures: $("toggle-show-pictures"),
    currentAuctionPill: $("current-auction-pill"),
    currentStatePill: $("current-state-pill"),
    connectionPill: $("cashier-connection-pill"),
    connectionStatus: $("cashier-connection-status"),
    changePwBtn: $("change-own-password-cashier"),
    logoutBtn: $("logout"),
    userMenuBtn: $("cashier-user-menu-button"),
    userDisplay: $("cashier-logged-in-user"),
    roleDisplay: $("cashier-logged-in-role"),
    aboutModal: $("about-modal"),
    openAboutModalBtn: $("open-about-modal"),
    closeAboutModalBtn: $("close-about-modal"),
    aboutVersionSummary: $("about-version-summary"),
    aboutDatabaseId: $("about-database-id"),
    aboutDatabaseCreatedAt: $("about-database-created-at"),
    aboutDatabaseCreatedByBackend: $("about-database-created-by-backend"),
    aboutDatabaseRestore: $("about-database-restore"),
    aboutBackendUptime: $("about-backend-uptime")
  };

  const menuGroups = Array.from(document.querySelectorAll(".menu-group"));
  const query = new URLSearchParams(window.location.search);
  const cashierPreferenceController = window.AppAuth?.createPreferenceController?.({ pageKey: "cashier" }) || null;
  const cashierPreferences = cashierPreferenceController?.getPagePreferences?.() || {};

  let authToken = window.AppAuth?.getToken?.() || localStorage.getItem("cashierToken");
  let auctions = [];
  let refreshTimer = null;
  let settlementScriptLoaded = false;
  let cashierRefreshConnected = null;
  let buyerDisplayWindow = null;
  let showPictures = typeof cashierPreferences.show_pictures === "boolean" ? cashierPreferences.show_pictures : true;

  function saveCashierPreferences(partial) {
    cashierPreferenceController?.patchPagePreferences?.(partial);
  }

  const showError = (message) => {
    if (els.error) els.error.textContent = message || "";
  };

  function closeMenuGroups(exceptMenu = null) {
    menuGroups.forEach((menu) => {
      if (menu !== exceptMenu) menu.removeAttribute("open");
    });
  }

  function formatRoleLabel(role) {
    if (!role) return "Unknown";
    return String(role)
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
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
    if (!versions?.restored_at) return "Never";
    const backupId = versions.restored_from_backup_id === "uploaded-database"
      ? "Uploaded database"
      : (versions.restored_from_backup_id ? `Backup #${versions.restored_from_backup_id}` : "Unknown backup");
    const sourceDatabaseId = versions.restored_from_database_id ? `, source DB ${versions.restored_from_database_id}` : "";
    return `${backupId} on ${formatDateTime(versions.restored_at)}${sourceDatabaseId}`;
  }

  function updateAboutBox(versions = null) {
    const backend = versions?.backend || "Unknown";
    const schema = versions?.schema || "Unknown";
    const payment = versions?.payment_processor || "Unknown";
    if (els.aboutVersionSummary) els.aboutVersionSummary.textContent = `Backend ${backend} / Schema ${schema} / Payment ${payment}`;
    if (els.aboutDatabaseId) els.aboutDatabaseId.textContent = versions?.database_id || "Unknown";
    if (els.aboutDatabaseCreatedAt) els.aboutDatabaseCreatedAt.textContent = formatDateTime(versions?.database_created_at);
    if (els.aboutDatabaseCreatedByBackend) els.aboutDatabaseCreatedByBackend.textContent = versions?.database_created_by_backend_version || "Unknown";
    if (els.aboutDatabaseRestore) els.aboutDatabaseRestore.textContent = formatRestoreSummary(versions || {});
    if (els.aboutBackendUptime) els.aboutBackendUptime.textContent = formatUptime(versions?.last_started_at);
  }

  function setCashierConnectionStatus(isConnected, { announce = true } = {}) {
    if (els.connectionPill) {
      els.connectionPill.classList.remove("is-checking", "is-connected", "is-disconnected");
      els.connectionPill.classList.add(isConnected ? "is-connected" : "is-disconnected");
    }
    if (els.connectionStatus) {
      els.connectionStatus.textContent = isConnected ? "Connected" : "Not connected";
    }

    if (!announce || cashierRefreshConnected === isConnected) {
      cashierRefreshConnected = isConnected;
      return;
    }

    if (cashierRefreshConnected === null) {
      cashierRefreshConnected = isConnected;
      return;
    }

    cashierRefreshConnected = isConnected;
    showMessage(
      isConnected ? "Cashier connection restored." : "Cashier background refresh lost connection.",
      isConnected ? "success" : "error"
    );
  }

  function setCashierSessionMeta(user = null, versions = null) {
    const username = user?.username || "unknown";
    const roleLabel = window.AppAuth?.describeAccess
      ? window.AppAuth.describeAccess(user)
      : formatRoleLabel(user?.role);
    if (els.userDisplay) els.userDisplay.textContent = username;
    if (els.roleDisplay) els.roleDisplay.textContent = roleLabel;
    if (els.userMenuBtn) els.userMenuBtn.textContent = username;
    updateAboutBox(versions);
  }

  window.addEventListener(window.AppAuth?.SESSION_EVENT || "appauth:session", (event) => {
    const session = event.detail || null;
    setCashierSessionMeta(session?.user, session?.versions);
  });

  function getRequestedAuctionId() {
    const raw = Number(query.get("auctionId"));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  function getRequestedAuctionStatus() {
    return (query.get("auctionStatus") || "").toLowerCase();
  }

  function getStoredAuctionId() {
    const raw = Number(cashierPreferenceController?.getPagePreferences?.().selected_auction_id);
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  function getSelectedAuctionId() {
    const raw = Number(els.auctionSelect?.value);
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  function getAuctionById(auctionId) {
    return auctions.find((auction) => Number(auction.id) === Number(auctionId)) || null;
  }

  function getSelectedAuction() {
    return getAuctionById(getSelectedAuctionId());
  }

  function buildCashierUrl(auction) {
    const params = new URLSearchParams();
    params.set("auctionId", auction.id);
    params.set("auctionStatus", auction.status || "");
    return `/cashier/index.html?${params.toString()}`;
  }

  function getBuyerDisplayFallbackState() {
    const selectedAuction = getSelectedAuction() || getAuctionById(getRequestedAuctionId());
    return {
      auctionId: selectedAuction?.id || getRequestedAuctionId() || null,
      auctionName: selectedAuction?.full_name || "none selected",
      showPictures,
      selectedBidder: null
    };
  }

  function persistBuyerDisplayState(state) {
    try {
      localStorage.setItem(BUYER_DISPLAY_STATE_KEY, JSON.stringify(state));
    } catch (_) {
      // ignore storage failures
    }
  }

  function renderBuyerDisplayWindow(state) {
    if (!buyerDisplayWindow || buyerDisplayWindow.closed) return;
    try {
      if (typeof buyerDisplayWindow.__renderBuyerDisplayState__ === "function") {
        buyerDisplayWindow.__renderBuyerDisplayState__(state);
      }
    } catch (_) {
      // ignore popup render failures
    }
  }

  function pushBuyerDisplayState(state) {
    window.__cashierBuyerDisplayStateCurrent__ = state;
    persistBuyerDisplayState(state);
    renderBuyerDisplayWindow(state);
  }

  function getBuyerDisplayState() {
    if (typeof window.__getCashierBuyerDisplayStateImpl__ === "function") {
      const liveState = window.__getCashierBuyerDisplayStateImpl__();
      if (liveState) return liveState;
    }
    if (window.__cashierBuyerDisplayStateCurrent__) {
      return window.__cashierBuyerDisplayStateCurrent__;
    }
    return getBuyerDisplayFallbackState();
  }

  function buildBuyerDisplayHtml() {
    const currencySymbol = localStorage.getItem("currencySymbol") || "£";
    const uploadBase = "/api/uploads";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Buyer Display</title>
  <link rel="stylesheet" href="/styles/settlement.css?v=${encodeURIComponent(CASHIER_ASSET_VERSION)}">
</head>
<body class="buyer-display-page">
  <main class="buyer-display-shell">
    <section class="buyer-display-card">
      <header class="buyer-display-head">
        <h1 id="buyer-display-auction" class="buyer-display-auction">Auction</h1>
      </header>
      <div class="buyer-display-body">
        <div id="buyer-display-content"></div>
      </div>
    </section>
  </main>
  <script>
    (() => {
      const money = (value) => ${JSON.stringify(currencySymbol)} + Number(value || 0).toFixed(2);
      const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
      const contentEl = document.getElementById('buyer-display-content');
      const auctionEl = document.getElementById('buyer-display-auction');
      const THUMBNAIL_LIMIT = 6;
      let lastRenderedKey = null;

      function getState() {
        try {
          if (window.opener && !window.opener.closed && typeof window.opener.__getCashierBuyerDisplayState__ === 'function') {
            const liveState = window.opener.__getCashierBuyerDisplayState__();
            if (liveState) return liveState;
          }
          const raw = localStorage.getItem(${JSON.stringify(BUYER_DISPLAY_STATE_KEY)});
          if (raw) return JSON.parse(raw);
          return null;
        } catch (_) {
          return null;
        }
      }

      function renderEmpty(message) {
        contentEl.innerHTML = '<div class="buyer-display-empty">' + escapeHtml(message) + '</div>';
      }

      function render(state) {
        if (auctionEl) {
          auctionEl.textContent = state?.auctionName || 'Buyer Display';
        }

        if (!state) {
          renderEmpty('Cashier page unavailable. Keep this window open and return to the cashier screen.');
          return;
        }

        const bidder = state.selectedBidder;
        if (!bidder) {
          renderEmpty('Select a paddle on the cashier screen to show the buyer review here.');
          return;
        }

        const lots = Array.isArray(bidder.lots) ? bidder.lots : [];
        const pictureLots = lots.filter((lot) => lot.photo_url);
        const visibleThumbs = state.showPictures ? pictureLots.slice(0, THUMBNAIL_LIMIT) : [];
        const extraThumbs = state.showPictures ? Math.max(0, pictureLots.length - visibleThumbs.length) : 0;
        const rows = lots.length
          ? lots.map((lot) => \`
              <tr>
                <td>\${escapeHtml(lot.item_number)}</td>
                <td>\${escapeHtml(lot.description)}</td>
                <td>\${escapeHtml(money(lot.hammer_price))}</td>
              </tr>\`).join('')
          : '<tr><td colspan="3">No lots won</td></tr>';
        const thumbnails = visibleThumbs.length
          ? \`
            <section class="buyer-display-section">
              <h3 class="detail-heading">Item previews</h3>
              <div class="buyer-display-thumbnails">
                \${visibleThumbs.map((lot) => \`
                  <figure class="buyer-display-thumb">
                    <img src="${uploadBase}/preview_\${escapeHtml(lot.photo_url)}" alt="Lot \${escapeHtml(lot.item_number)} preview" loading="eager">
                    <figcaption>Lot \${escapeHtml(lot.item_number)}</figcaption>
                  </figure>\`).join('')}
                \${extraThumbs > 0 ? \`<div class="buyer-display-thumb buyer-display-thumb-more">+\${escapeHtml(extraThumbs)} more</div>\` : ''}
              </div>
            </section>\`
          : '';

        contentEl.innerHTML = \`
          <section class="buyer-display-section">
            <h2 class="buyer-display-paddle">\${escapeHtml(bidder.bidder_label || ('Paddle #' + bidder.paddle_number))}</h2>
          </section>
          <section class="buyer-display-section">
            <h3 class="detail-heading">Lots won</h3>
            <div class="table-wrap buyer-display-table">
              <table>
                <thead>
                  <tr><th>Lot</th><th>Title</th><th>Price</th></tr>
                </thead>
                <tbody>\${rows}</tbody>
              </table>
            </div>
            <div class="section-total">Total lots: \${escapeHtml(money(bidder.lots_total))}</div>
          </section>
          \${thumbnails}
          <section class="buyer-display-section">
            <h3 class="detail-heading">Summary</h3>
            <div class="buyer-display-summary">
              <div class="summary-card">
                <span class="summary-card-label">Paid</span>
                <span class="summary-card-value">\${escapeHtml(money(bidder.payments_total))}</span>
              </div>
              <div class="summary-card">
                <span class="summary-card-label">Donations</span>
                <span class="summary-card-value">\${escapeHtml(money(bidder.donations_total))}</span>
              </div>
              <div class="summary-card">
                <span class="summary-card-label">Balance</span>
                <span class="summary-card-value">\${escapeHtml(money(bidder.balance))}</span>
              </div>
            </div>
          </section>\`;
      }

      function sync() {
        const nextState = getState();
        const nextKey = JSON.stringify(nextState);
        if (nextKey === lastRenderedKey) return;
        lastRenderedKey = nextKey;
        render(nextState);
      }

      window.__renderBuyerDisplayState__ = (state) => {
        lastRenderedKey = JSON.stringify(state);
        render(state);
      };

      sync();
      window.setInterval(sync, 3000);
    })();
  </script>
</body>
</html>`;
  }

  function openBuyerDisplay() {
    buyerDisplayWindow = window.open("", "cashierBuyerDisplayWindow", "popup=yes,width=980,height=760,resizable=yes,scrollbars=yes");
    if (!buyerDisplayWindow) {
      showMessage("Buyer display popup was blocked. Allow popups for this site and try again.", "error");
      return;
    }

    buyerDisplayWindow.document.open();
    buyerDisplayWindow.document.write(buildBuyerDisplayHtml());
    buyerDisplayWindow.document.close();
    buyerDisplayWindow.focus();
    window.setTimeout(() => {
      pushBuyerDisplayState(getBuyerDisplayState());
    }, 50);
  }

  window.__getCashierBuyerDisplayState__ = getBuyerDisplayState;
  window.__cashierPushBuyerDisplayState__ = pushBuyerDisplayState;

  function setAuctionActionAvailability(selectedAuction = null) {
    const hasAuction = Boolean(selectedAuction);
    const isSetup = String(selectedAuction?.status || "").toLowerCase() === "setup";

    [els.summaryBtn, els.csvBtn, els.goLiveFeedBtn].forEach((button) => {
      if (button) {
        button.disabled = !hasAuction;
        button.title = hasAuction ? "" : "Select an auction first";
      }
    });

    if (els.goPublicBtn) {
      els.goPublicBtn.disabled = !hasAuction || !isSetup;
      els.goPublicBtn.title = !hasAuction
        ? "Select an auction first"
        : (isSetup ? "" : "Public form is only available while the auction is in setup state");
    }

    if (els.auctionSelect) els.auctionSelect.disabled = !auctions.length;
  }

  function updateAuctionStatusPills() {
    const selectedAuction = getSelectedAuction();
    const requestedAuction = getAuctionById(getRequestedAuctionId());
    const activeAuction = selectedAuction || requestedAuction;
    const auctionLabel = activeAuction?.full_name || "none selected";
    const stateLabel = formatRoleLabel(activeAuction?.status || getRequestedAuctionStatus() || "unknown");

    if (els.currentAuctionPill) els.currentAuctionPill.textContent = `Auction: ${auctionLabel}`;
    if (els.currentStatePill) els.currentStatePill.textContent = `State: ${stateLabel}`;
  }

  function showCashierEmpty(title, copy) {
    if (els.cashierWorkspace) els.cashierWorkspace.hidden = true;
    if (els.cashierEmptyPanel) els.cashierEmptyPanel.hidden = false;
    if (els.cashierEmptyTitle) els.cashierEmptyTitle.textContent = title;
    if (els.cashierEmptyCopy) els.cashierEmptyCopy.textContent = copy;
    pushBuyerDisplayState(getBuyerDisplayFallbackState());
    setAuctionActionAvailability(null);
    updateAuctionStatusPills();
  }

  function showCashierWorkspace() {
    const selectedAuction = getSelectedAuction();
    if (els.cashierEmptyPanel) els.cashierEmptyPanel.hidden = true;
    if (els.cashierWorkspace) els.cashierWorkspace.hidden = false;
    setAuctionActionAvailability(selectedAuction);
    updateAuctionStatusPills();
  }

  function loadSettlementScript() {
    if (settlementScriptLoaded) return;
    if (!els.cashierWorkspace || els.cashierWorkspace.hidden) return;

    settlementScriptLoaded = true;
    const script = document.createElement("script");
    script.src = `/scripts/settlement.js?v=${encodeURIComponent(CASHIER_ASSET_VERSION)}`;
    document.body.appendChild(script);
  }

  function openAboutModal() {
    if (!els.aboutModal) return;
    closeMenuGroups();
    els.aboutModal.hidden = false;
  }

  function closeAboutModal() {
    if (!els.aboutModal) return;
    els.aboutModal.hidden = true;
  }

  function logout() {
    window.AppAuth?.clearAllSessions?.({ broadcast: true });
    closeAboutModal();
    window.location.replace("/login.html?reason=signed_out");
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
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close(null);
      });

      [currentInput, newInput, confirmInput].forEach((input) => {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") submitForm();
          if (event.key === "Escape") close(null);
        });
      });

      row.append(cancel, submit);
      box.append(heading, currentInput, newInput, confirmInput, row);
      overlay.append(box);
      document.body.append(overlay);
      currentInput.focus();
    });
  }

  async function validateSession(token) {
    const res = await fetch(`${API}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Session expired");
    return data;
  }

  async function fetchAuctions() {
    const res = await fetch(`${API}/list-auctions`, {
      method: "POST",
      headers: {
        Authorization: authToken,
        "Content-Type": "application/json"
      }
    });

    if (res.status === 403) {
      showMessage("Session expired. Please log in again.", "info");
      window.AppAuth?.clearSharedSession?.({ broadcast: false });
      window.setTimeout(() => window.location.replace("/login.html"), 1500);
      return [];
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  function populateAuctionSelect(nextAuctions) {
    const preferredId =
      getSelectedAuctionId() ||
      getRequestedAuctionId() ||
      getStoredAuctionId();

    if (!els.auctionSelect) return;

    els.auctionSelect.innerHTML = "";
    nextAuctions.forEach((auction) => {
      const option = new Option(
        `${auction.id}: ${auction.full_name} - ${auction.status}`,
        auction.id
      );
      els.auctionSelect.add(option);
    });

    const selectedAuction = getAuctionById(preferredId) || nextAuctions[0] || null;
    if (selectedAuction) {
      els.auctionSelect.value = String(selectedAuction.id);
      saveCashierPreferences({ selected_auction_id: selectedAuction.id });
    }
  }

  function syncAuctionRoute({ navigateIfNeeded }) {
    const activeAuction =
      getAuctionById(getRequestedAuctionId()) ||
      getSelectedAuction() ||
      getAuctionById(getStoredAuctionId()) ||
      auctions[0] ||
      null;

    if (!activeAuction) {
      showCashierEmpty("No auctions available", "Use the maintenance interface to create an auction before opening cashier.");
      return false;
    }

    if (els.auctionSelect) els.auctionSelect.value = String(activeAuction.id);
    saveCashierPreferences({ selected_auction_id: activeAuction.id });

    const requestedId = getRequestedAuctionId();
    const requestedStatus = getRequestedAuctionStatus();
    const currentStatus = String(activeAuction.status || "").toLowerCase();
    const routeMismatch =
      requestedId !== Number(activeAuction.id) ||
      requestedStatus !== currentStatus;

    if (navigateIfNeeded && routeMismatch) {
      window.location.replace(buildCashierUrl(activeAuction));
      return false;
    }

    showCashierWorkspace();
    return true;
  }

  async function refreshAuctionLists({ navigateIfNeeded }) {
    try {
      auctions = await fetchAuctions();
      populateAuctionSelect(auctions);
      updateAuctionStatusPills();
      setCashierConnectionStatus(true);
      return syncAuctionRoute({ navigateIfNeeded });
    } catch (error) {
      setCashierConnectionStatus(false);
      showError("Could not refresh auctions");
      showCashierEmpty("Unable to load auctions", error.message || "Try refreshing the page.");
      return false;
    }
  }

  function startAutoRefresh() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      void refreshAuctionLists({ navigateIfNeeded: true });
    }, REFRESH_MS);
  }

  async function startDashboard(sessionData) {
    showError("");
    if (els.loginSection) els.loginSection.style.display = "none";
    if (els.cashierSection) els.cashierSection.style.display = "grid";

    setCashierSessionMeta(sessionData?.user, sessionData?.versions);
    const ready = await refreshAuctionLists({ navigateIfNeeded: true });
    if (!ready) return;

    loadSettlementScript();
    startAutoRefresh();
  }

  async function doLogin() {
    window.location.replace("/login.html");
  }

  async function handlePasswordChange() {
    const passwordInput = await promptPasswordChange();
    if (!passwordInput) return;

    const { currentPassword, newPassword, confirmPassword } = passwordInput;
    if (!currentPassword || !newPassword || !confirmPassword) {
      showError("All password fields are required");
      return;
    }
    if (newPassword !== confirmPassword) {
      showError("Passwords do not match");
      return;
    }

    const res = await fetch(`${API}/change-password`, {
      method: "POST",
      headers: {
        Authorization: authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showMessage(data.message || "Password updated.", "success");
      showError("");
    } else {
      showError(data.error || "Failed to change password");
    }
  }

  function openSelectedAuctionPublicPage() {
    closeMenuGroups();
    const selectedAuction = getSelectedAuction();
    if (!selectedAuction?.short_name) {
      showMessage("Please select an auction first", "error");
      return;
    }

    window.open(`/index.html?auction=${selectedAuction.short_name}`, "_blank", "noopener")?.focus();
  }

  function openSelectedAuctionLiveFeed() {
    closeMenuGroups();
    const selectedAuction = getSelectedAuction();
    if (!selectedAuction) {
      showMessage("Please select an auction first", "error");
      return;
    }

    window.location.assign(
      `/cashier/live-feed.html?auctionId=${selectedAuction.id}&auctionStatus=${selectedAuction.status || ""}`
    );
  }

  function bindEvents() {
    if (els.toggleShowPictures) {
      els.toggleShowPictures.checked = showPictures;
    }

    els.loginBtn?.addEventListener("click", doLogin);

    [els.userInput, els.pwInput].forEach((input) => {
      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") doLogin();
      });
    });

    els.auctionSelect?.addEventListener("change", () => {
      closeMenuGroups();
      const selectedAuction = getSelectedAuction();
      if (!selectedAuction) return;
      saveCashierPreferences({ selected_auction_id: selectedAuction.id });
      window.location.assign(buildCashierUrl(selectedAuction));
    });

    els.changePwBtn?.addEventListener("click", handlePasswordChange);
    els.logoutBtn?.addEventListener("click", () => {
      closeMenuGroups();
      logout();
    });
    els.goPublicBtn?.addEventListener("click", openSelectedAuctionPublicPage);
    els.goLiveFeedBtn?.addEventListener("click", openSelectedAuctionLiveFeed);
    els.openBuyerDisplayBtn?.addEventListener("click", openBuyerDisplay);
    els.toggleShowPictures?.addEventListener("change", () => {
      showPictures = Boolean(els.toggleShowPictures.checked);
      saveCashierPreferences({ show_pictures: showPictures });
      pushBuyerDisplayState(getBuyerDisplayState());
      window.dispatchEvent(new CustomEvent("cashier:show-pictures-changed", {
        detail: { showPictures }
      }));
      closeMenuGroups();
    });
    els.openAboutModalBtn?.addEventListener("click", openAboutModal);
    els.closeAboutModalBtn?.addEventListener("click", closeAboutModal);
    els.aboutModal?.addEventListener("click", (event) => {
      if (event.target === els.aboutModal) closeAboutModal();
    });

    menuGroups.forEach((menu) => {
      menu.addEventListener("toggle", () => {
        if (menu.open) closeMenuGroups(menu);
      });
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".menu-group")) closeMenuGroups();
    });

    document.querySelectorAll(".menu-item-link, .menu-item-button").forEach((element) => {
      element.addEventListener("click", () => {
        if (!element.disabled) closeMenuGroups();
      });
    });
  }

  bindEvents();
  setAuctionActionAvailability(false);
  updateAuctionStatusPills();

  if (authToken) {
    validateSession(authToken)
      .then((data) => startDashboard(data))
      .catch(() => {
        window.AppAuth?.clearSharedSession?.({ broadcast: false });
      });
  }
})();
