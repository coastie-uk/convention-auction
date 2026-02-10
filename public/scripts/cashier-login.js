/* /scripts/cashier-script.js  (v2 – auto-refresh + live→settlement hand-off) */
(() => {
    "use strict";
  
    // ---------- Config ---------------------------------------------------------
const API = "/api"                                 
    const REFRESH_MS   = 10000;           
  

  
    // ---------- DOM shortcuts --------------------------------------------------
    const $ = (id) => document.getElementById(id);
    const els = {
      loginSection : $("login-section"),
      dashSection  : $("dashboard-section"),
      userInput    : $("cashier-username"),
      pwInput      : $("cashier-password"),
      error        : $("error-message"),
      liveSel      : $("live-select"),
      openLiveBtn  : $("open-live"),
      openSettleBtn: $("open-settle"),
      changePwBtn  : $("change-own-password-cashier"),
      logoutBtn    : $("logout"),
      userMenuBtn  : $("cashier-user-menu-button"),
      userDisplay  : $("cashier-logged-in-user"),
      loginBtn     : $("login-button"),
      viewport     : $("viewport")
    };


    function saveLastView(screen, auctionId) {
      localStorage.setItem('lastViewport', JSON.stringify({ screen, auctionId }));
    }

  
    // ---------- State ----------------------------------------------------------
    let authToken        = null;        // JWT once logged in
    let currentAuctionId = null;        // number | null
    let currentScreen    = null;        // "live" | "settlement" | null
    let refreshTimer     = null;
    let currencySymbol = localStorage.getItem("currencySymbol") || "£";

    function setCashierUserMenu(username) {
      const safeName = username || "cashier";
      if (els.userDisplay) els.userDisplay.textContent = safeName;
      if (els.userMenuBtn) els.userMenuBtn.textContent = safeName;
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

    // ---------- Initialisation -------------------------------------------------
    els.loginBtn.onclick = doLogin;
  
    authToken = localStorage.getItem("cashierToken");
    if (authToken) {
      fetch(`${API}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: authToken })
      })
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) throw new Error(data?.error || "Session expired");
          setCashierUserMenu(data?.user?.username || "cashier");
          return startDashboard(authToken);
        })
        .catch(() => localStorage.removeItem("cashierToken"));
    }

  async function applyLastView() {
  const { screen, auctionId } = loadLastView();

    // auto-open the saved screen
    if (screen === 'settlement') {
      loadIntoViewport('/cashier/settlement.html', auctionId);
    } else if (screen === 'live') {
      loadIntoViewport('/cashier/live-feed.html', auctionId);
    }
// }
}

function loadLastView() {
  try { return JSON.parse(localStorage.getItem("lastViewport") || '{}'); }
  catch { return {}; }
}


    // ---------- UI helpers -----------------------------------------------------
    const showError = (msg) => { els.error.textContent = msg; };
  
    let auctionStatusMap = {};               // id → status

    const populateSelect = (sel, auctions) => {
      // Preserve previous selection if still available
      const prev = sel.value;
      sel.innerHTML = "";

      auctions.forEach(a => {
        auctionStatusMap[a.id] = a.status;       // live | settlement | archive …

        sel.add(new Option(`${a.id}: ${a.full_name} - ${a.status}`, a.id))
      }
      );
      
      if (auctions.some(a => String(a.id) === prev)) sel.value = prev;
    
      els.openSettleBtn.disabled = !auctions.length;
      els.openLiveBtn.disabled = !auctions.length;

    };
  
    function loadIntoViewport(path, auctionId) {
      currentAuctionId = auctionId;
      currentScreen    = path.includes("settlement") ? "settlement" : "live";
  
      saveLastView(currentScreen, auctionId);


      const status = auctionStatusMap[auctionId]; 

      els.viewport.innerHTML = "";
      const frame = document.createElement("iframe");
      frame.src = `${path}?auctionId=${auctionId}&auctionStatus=${status}`;

      frame.width = "100%";
      frame.height = "900";           // or flex-auto with height calc

      frame.style.border = "none";

      els.viewport.appendChild(frame);
    }
  
    // ---------- Back-end calls -------------------------------------------------
    async function fetchAuctions(status) {
      const token = localStorage.getItem("cashierToken");
      if (token) {
      const res = await fetch(`${API}/list-auctions`, {
        method : "POST",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json"
            },
        body: JSON.stringify({ status })
      });

            // Check for 403 (unauthorized)
        if (res.status === 403) {
          
            showMessage("Session expired. Please log in again.", "info");
            localStorage.removeItem("cashierToken");
            setTimeout(() => {
                window.location.reload();
            }, 1500);
            return;
        }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();   // [{id, full_name, …}, …]
    }}
  
    async function refreshAuctionLists() {
      try {
        const [live] = await Promise.all([
          fetchAuctions(),
        ]);
  
        populateSelect(els.liveSel, live);

  
    //    autoSwitchIfNeeded(live, settlement);
      } catch (e) {
        showError("Could not refresh auctions");
      }
    }
  

    
    // ---------- Auth & bootstrap ----------------------------------------------
    async function startDashboard() {
      
      els.loginSection.style.display = "none";
      els.dashSection.style.display = "block";
      els.viewport.style.display = "block";
      
  
      // First load immediately, then schedule auto-refresh
      const done = await refreshAuctionLists();
      applyLastView();
      startAutoRefresh();
 
      els.openLiveBtn  .onclick = () => loadIntoViewport("/cashier/live-feed.html", els.liveSel.value);
      els.openSettleBtn.onclick = () => loadIntoViewport("/cashier/settlement.html", els.liveSel.value);
      els.changePwBtn  .onclick = async () => {
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
            Authorization: localStorage.getItem("cashierToken"),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (res.ok) {
          showMessage(data.message || "Password updated.", "success");
        } else {
          showError(data.error || "Failed to change password");
        }
      };
      els.logoutBtn    .onclick = () => { localStorage.removeItem("cashierToken"); location.reload(); };
    }
   
    async function doLogin() {
      const username = els.userInput.value.trim();
      const pwd = els.pwInput.value.trim();
      if (!username || !pwd) { showError("Username and password are required"); return; }
  
      try {
        const res  = await fetch(`${API}/login`, {
          method : "POST",
          headers: { "Content-Type": "application/json" },
          body   : JSON.stringify({ username, password: pwd, role: "cashier" })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Auth failed");
  
        localStorage.setItem("cashierToken", data.token);
        currencySymbol = data.currency || "£";
        localStorage.setItem("currencySymbol", currencySymbol);
        setCashierUserMenu(data.user?.username || username);
        startDashboard();
      } catch (err) {
        showError(err.message || "Unexpected error");
      }
    }

        document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
        refreshAuctionLists();
        }
      });

          function startAutoRefresh() {
        setInterval(() => {
            if (document.visibilityState === "visible") {
        refreshAuctionLists();
                            } else {
            }
        }, REFRESH_MS);
    }

  })();
