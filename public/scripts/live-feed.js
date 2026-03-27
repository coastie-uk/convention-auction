// live-feed.js  —  v2.0  (single POST endpoint, optional unsold rows)
// -----------------------------------------------------------------------------
// * Requires URL param ?auctionId=<id>  (mandatory) and status=<status> (sets refresh)
// * Polls POST /api/cashier/live  with body {auction_id, include_unsold}
// * Checkbox #showUnsold toggles unsold visibility; unsold rows are greyed out
// * Maintains a Map rowid→<tr> so a row seamlessly upgrades from unsold→sold
// -----------------------------------------------------------------------------

(async () => {
  // ---------- config & auth ---------------------------------------------------
const API_ROOT = "/api"
  const API   = `${API_ROOT}/cashier/live`;
  const VALIDATE   = `${API_ROOT}/validate`;
  const params = new URLSearchParams(location.search);
  const AUCTION_ID = Number(params.get('auctionId'));
  const AUCTION_STATUS = (params.get('auctionStatus') || '').toLowerCase();
  const currencySymbol = localStorage.getItem("currencySymbol") || "£";


  // if the auction isnt live, we dont need to poll especially fast

  const REFRESH_MS = AUCTION_STATUS === 'live' ? 5000 : 60000;

  if (!Number.isInteger(AUCTION_ID) || AUCTION_ID <= 0) {
    alert('This page must be opened with ?auctionId=<number>');
    return;
  }

  // ---------- DOM refs --------------------------------------------------------
  const tbody = document.querySelector('#feed tbody');
  const statusEl = document.getElementById('status');
  const chkUnsold = document.getElementById('showUnsold');
  const applyFilter = document.getElementById('btnApply');
  const refreshButton = document.getElementById('btnRefresh');
  const countdownEl = document.getElementById('refreshCountdown');
  const filterInput = document.getElementById('filter');

  // ---------- state -----------------------------------------------------------
  const rowsMap = new Map(); // rowid -> <tr>
  let staleTimer = null;
  let refreshTimer = null;
  let countdownTimer = null;
  let nextRefreshAt = null;
  let pollInFlight = false;

  // ---------- helpers ---------------------------------------------------------
  const money = v => `${currencySymbol}${Number(v).toFixed(2)}`;
  const time  = () => new Date().toLocaleTimeString();
  const setStatus = ok => {
    statusEl.textContent = ok ? 'Updated' : 'Stale';
    statusEl.className   = ok ? 'ok' : 'stale';
  };
  const formatCountdown = ms => {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0
      ? `${minutes}:${String(seconds).padStart(2, '0')}`
      : `${seconds}s`;
  };
  const updateCountdown = () => {
    if (!countdownEl) return;
    if (!nextRefreshAt) {
      countdownEl.textContent = 'Next refresh: --';
      return;
    }
    const msRemaining = nextRefreshAt - Date.now();
    countdownEl.textContent = msRemaining <= 0
      ? 'Refreshing...'
      : `Next refresh: ${formatCountdown(msRemaining)}`;
  };
  const setNextRefresh = delayMs => {
    if (refreshTimer) clearTimeout(refreshTimer);
    nextRefreshAt = Date.now() + delayMs;
    updateCountdown();
    refreshTimer = setTimeout(() => {
      void poll({ reschedule: true });
    }, delayMs);
  };
  const startCountdown = () => {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(updateCountdown, 1000);
    updateCountdown();
  };

  function makeRow(r){
    const tr = document.createElement('tr');
    tr.dataset.rowid = r.rowid;
    if (r.unsold) tr.classList.add('unsold-row');
    renderRowContent(tr, r);
    return tr;
  }

  function getColor(paddle) {
    // simple deterministic pastel hash
    const hue = (paddle * 57) % 360;     // 57 = prime gives even spread
    
    return `hsl(${hue} 80% 94%)`;        // light pastel
  }

  function renderRowContent(tr, r){
    const pad  = r.bidder ?? '';
    const prc  = r.price  != null ? money(r.price) : '';
    const prc2 = r.test_bid != null ? `${prc} <b>[T]</b>` : prc;
    const desc = r.test_item != null ? `${r.description} <b>[T]</b>` : r.description;
    const photoUrl = r.photo_url || r.photoUrl || r.photo || '';

    const rowHtml = `
    <td>${pad}</td>
      <td>${r.lot}</td>
      <td>${desc}</td>
      <td>${prc2}</td>`;
      tr.style.setProperty('background', getColor(r.bidder), 'important'); // force tint

    tr.innerHTML = rowHtml;
    if (photoUrl) tr.dataset.photoUrl = photoUrl;
    else delete tr.dataset.photoUrl;
    // style switch if became sold
    if (!r.unsold) tr.classList.remove('unsold-row');
  }

  // remove all current rows (helper for filter change)
  function clearTable(){
    tbody.innerHTML='';
    rowsMap.clear();
  }


/* ---------- pick whichever stored token validates ---------- */
async function validateToken(tok) {
  if (!tok) return false;
  try {
    const res = await fetch(VALIDATE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': tok
      },
      body: JSON.stringify({ token: tok })
    });
    return res.ok;
  } catch { return false; }
}

async function getSessionToken() {
  const cashierTok = localStorage.getItem('cashierToken');
  if (await validateToken(cashierTok)) return cashierTok;

  const genericTok = localStorage.getItem('token');
  if (await validateToken(genericTok)) return genericTok;

  return null;          // none valid
}

/* ---------- usage ---------- */
const token = await getSessionToken();
if (!token) {
  alert('Session expired. Please log in again.');
  throw new Error('no valid token');
}


    applyFilter.addEventListener("click", function () {
      clearTable();
      void poll({ reschedule: true });
    });

    refreshButton?.addEventListener("click", function () {
      void poll({ force: true, reschedule: true });
    });


  chkUnsold.onchange = () => {
    clearTable();
    void poll({ reschedule: true });
  }; // re-poll will rebuild
  filterInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      clearTable();
      void poll({ reschedule: true });
    }
  });
  if (typeof initPhotoHoverPopup === 'function') {
    initPhotoHoverPopup({
      container: tbody,
      delayMs: 1000,
       maxSize: 220,
      getUrl: tr => tr.dataset.photoUrl ? `${API_ROOT}/uploads/preview_${tr.dataset.photoUrl}` : null
    });
  }

  async function poll({ force = false, reschedule = false } = {}){
    if (pollInFlight) {
      if (force) setNextRefresh(1000);
      return;
    }

    pollInFlight = true;
    if (refreshButton) refreshButton.disabled = true;
    nextRefreshAt = null;
    updateCountdown();

    try{
      const res = await fetch(`${API}/${AUCTION_ID}?unsold=${chkUnsold.checked}`, {
        headers:{ 'Content-Type':'application/json', Authorization: token }
      });
      if(!res.ok) throw 0;
      const rows = await res.json();
      rows.forEach(r => {

        // filter paddle (if filter field present)
        const filterVal = document.getElementById('filter')?.value.trim();
        if (filterVal && Number(filterVal)!== (r.bidder??0)) return;

        const existing = rowsMap.get(r.rowid);
        if (existing){
          
          const wasUnsold = existing.classList.contains('unsold-row');
          renderRowContent(existing, r);
          // migrate row to the top if it just became sold
          if (wasUnsold && !r.unsold) {
            tbody.removeChild(existing);
            tbody.prepend(existing);
          }

        } else {
          const tr = makeRow(r);
          rowsMap.set(r.rowid, tr);
          if (r.unsold) tbody.appendChild(tr);   // unsold at bottom
          else           tbody.prepend(tr);      // sold at top
        }
      });
      setStatus(true);
      resetStale();
    }catch{
      setStatus(false);
    } finally {
      pollInFlight = false;
      if (refreshButton) refreshButton.disabled = false;
      if (reschedule && document.visibilityState === 'visible') {
        setNextRefresh(REFRESH_MS);
      } else if (document.visibilityState !== 'visible') {
        nextRefreshAt = null;
        updateCountdown();
      }
    }
  }

  function resetStale(){
    clearTimeout(staleTimer);
    staleTimer=setTimeout(()=>setStatus(false),REFRESH_MS*1.5);
  }

  function startAutoRefresh() {
    startCountdown();
  }

  // initial draw & polling loop ----------------------------------------------
  void poll({ reschedule: true });
  startAutoRefresh();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void poll({ reschedule: true });
      return;
    }

    if (refreshTimer) clearTimeout(refreshTimer);
    nextRefreshAt = null;
    updateCountdown();
  });
 
})();
