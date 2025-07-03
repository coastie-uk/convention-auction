/* /scripts/cashier-script.js  (v2 – auto-refresh + live→settlement hand-off) */
// document.addEventListener("DOMContentLoaded", function () {
(() => {
    "use strict";
  
    // ---------- Config ---------------------------------------------------------
  //  const API = "https://drive.icychris.co.uk";    
const API = "/api"                                 
    const REFRESH_MS   = 10000;           
  
    const log = (...a) => console.debug("[cashier]", ...a);
  
    // ---------- DOM shortcuts --------------------------------------------------
    const $ = (id) => document.getElementById(id);
    const els = {
      loginSection : $("login-section"),
      dashSection  : $("dashboard-section"),
      pwInput      : $("cashier-password"),
      error        : $("error-message"),
      liveSel      : $("live-select"),
   //   settleSel    : $("settle-select"),
      openLiveBtn  : $("open-live"),
      openSettleBtn: $("open-settle"),
      logoutBtn    : $("logout"),
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
  

    // ---------- Initialisation -------------------------------------------------
    els.loginBtn.onclick = doLogin;
  
    authToken = localStorage.getItem("cashierToken");
    if (authToken) {
      fetchAuctions("live")               // cheap probe to validate token
        .then(() => startDashboard(authToken))
        .catch(() => localStorage.removeItem("cashierToken"));
    }

  async function applyLastView() {
  const { screen, auctionId } = loadLastView();

 // if (auctionId && document.querySelector(`#liveSel option[value="${auctionId}"]`)) {
  //   pre-select the saved auction in both dropdowns
  //  document.getElementById('liveSel').value   = auctionId;
  //  document.getElementById('settleSel').value = auctionId;

    // auto-open the saved screen
    if (screen === 'settlement') {
  //    document.getElementById('settleSel').value = auctionId;
      loadIntoViewport('/cashier/settlement.html', auctionId);
    } else if (screen === 'live') {
  //    document.getElementById('liveSel').value   = auctionId;
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
 //     frame.src   = `${path}?auctionId=${auctionId}`;
      frame.src = `${path}?auctionId=${auctionId}&auctionStatus=${status}`;

      frame.width = "100%";
      frame.height = "900";           // or flex-auto with height calc

      frame.style.border = "none";
      frame.onload = () => log("Viewport loaded", { path, auctionId, status });
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
    //      fetchAuctions("settlement")
        ]);
  
        populateSelect(els.liveSel, live);
    //    populateSelect(els.settleSel, live);
        log("Auctions refreshed", { live: live.length
          
         });
  
    //    autoSwitchIfNeeded(live, settlement);
      } catch (e) {
        console.error(e);
        showError("Could not refresh auctions");
      }
    }
  
    // ---------- Intelligent hand-off ------------------------------------------
    function autoSwitchIfNeeded(liveAuctions, settlementAuctions) {
      if (currentScreen !== "live" || !currentAuctionId) return; // nothing to do
  
      const stillLive = liveAuctions.some(a => a.id === Number(currentAuctionId));
      if (stillLive) return;                                     // stay put
  
      const nowSettlement = settlementAuctions.some(a => a.id === Number(currentAuctionId));
      if (nowSettlement) {
        showMessage(`Auction ${currentAuctionId} moved from live → settlement; switching view`, "info");

        log(`Auction ${currentAuctionId} moved from live → settlement; switching`);
        loadIntoViewport("/settlement.html", currentAuctionId);
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
      

      // clearInterval(refreshTimer);
      // refreshTimer = setInterval(refreshAuctionLists, REFRESH_MS);
  
      els.openLiveBtn  .onclick = () => loadIntoViewport("/cashier/live-feed.html", els.liveSel.value);
      els.openSettleBtn.onclick = () => loadIntoViewport("/cashier/settlement.html", els.liveSel.value);
      els.logoutBtn    .onclick = () => { localStorage.removeItem("cashierToken"); location.reload(); };
    }
  

   
    async function doLogin() {
      const pwd = els.pwInput.value.trim();
      if (!pwd) { showError("Password required"); return; }
  
      try {
        const res  = await fetch(`${API}/login`, {
          method : "POST",
          headers: { "Content-Type": "application/json" },
          body   : JSON.stringify({ password: pwd, role: "cashier" })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Auth failed");
  
        localStorage.setItem("cashierToken", data.token);
        startDashboard();
      } catch (err) {
        console.error(err);
        showError(err.message || "Unexpected error");
      }
    }

        document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
 //           console.log("Page became visible — refreshing now");
        refreshAuctionLists();
        }
      });

          function startAutoRefresh() {
        setInterval(() => {
            if (document.visibilityState === "visible") {
        refreshAuctionLists();
                            } else {
     //           console.log("Page not visible — skipping refresh");
            }
        }, REFRESH_MS);
    }

  })();
// });
