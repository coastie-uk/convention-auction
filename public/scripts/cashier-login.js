(() => {
  "use strict";

  const API = "/api";
  const REFRESH_MS = 10000;
  const SELECTED_AUCTION_KEY = "cashierSelectedAuctionId";

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
    aboutVersionBackend: $("about-version-backend"),
    aboutVersionSchema: $("about-version-schema"),
    aboutVersionPayment: $("about-version-payment")
  };

  const menuGroups = Array.from(document.querySelectorAll(".menu-group"));
  const query = new URLSearchParams(window.location.search);

  let authToken = localStorage.getItem("cashierToken");
  let auctions = [];
  let refreshTimer = null;
  let settlementScriptLoaded = false;
  let cashierRefreshConnected = null;

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

  function updateAboutBox(versions = null) {
    if (els.aboutVersionBackend) els.aboutVersionBackend.textContent = versions?.backend || "Unknown";
    if (els.aboutVersionSchema) els.aboutVersionSchema.textContent = versions?.schema || "Unknown";
    if (els.aboutVersionPayment) els.aboutVersionPayment.textContent = versions?.payment_processor || "Unknown";
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
    const roleLabel = formatRoleLabel(user?.role);
    if (els.userDisplay) els.userDisplay.textContent = username;
    if (els.roleDisplay) els.roleDisplay.textContent = roleLabel;
    if (els.userMenuBtn) els.userMenuBtn.textContent = username;
    updateAboutBox(versions);
  }

  function getRequestedAuctionId() {
    const raw = Number(query.get("auctionId"));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  function getRequestedAuctionStatus() {
    return (query.get("auctionStatus") || "").toLowerCase();
  }

  function getStoredAuctionId() {
    const raw = Number(localStorage.getItem(SELECTED_AUCTION_KEY));
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
    script.src = "/scripts/settlement.js";
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
    localStorage.removeItem("cashierToken");
    closeAboutModal();
    window.location.replace("/cashier/index.html");
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
      localStorage.removeItem("cashierToken");
      window.setTimeout(() => window.location.replace("/cashier/index.html"), 1500);
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
      localStorage.setItem(SELECTED_AUCTION_KEY, String(selectedAuction.id));
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
    localStorage.setItem(SELECTED_AUCTION_KEY, String(activeAuction.id));

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
    const username = els.userInput?.value.trim() || "";
    const password = els.pwInput?.value.trim() || "";

    if (!username || !password) {
      showError("Username and password are required");
      return;
    }

    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role: "cashier" })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Auth failed");

      authToken = data.token;
      localStorage.setItem("cashierToken", data.token);
      localStorage.setItem("currencySymbol", data.currency || "£");

      await startDashboard(data);
    } catch (error) {
      showError(`Login failed: ${error.message}`);
    }
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

    window.open(
      `/cashier/live-feed.html?auctionId=${selectedAuction.id}&auctionStatus=${selectedAuction.status || ""}`,
      "_blank",
      "noopener"
    )?.focus();
  }

  function bindEvents() {
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
      localStorage.setItem(SELECTED_AUCTION_KEY, String(selectedAuction.id));
      window.location.assign(buildCashierUrl(selectedAuction));
    });

    els.changePwBtn?.addEventListener("click", handlePasswordChange);
    els.logoutBtn?.addEventListener("click", () => {
      closeMenuGroups();
      logout();
    });
    els.goPublicBtn?.addEventListener("click", openSelectedAuctionPublicPage);
    els.goLiveFeedBtn?.addEventListener("click", openSelectedAuctionLiveFeed);
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
        localStorage.removeItem("cashierToken");
      });
  }
})();
