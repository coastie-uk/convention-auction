// live-feed.js  —  v2.0  (single POST endpoint, optional unsold rows)
// -----------------------------------------------------------------------------
// * Requires URL param ?auctionId=<id>  (mandatory) and status=<status> (sets refresh)
// * Polls POST /api/cashier/live  with body {auction_id, include_unsold}
// * Checkbox #showUnsold toggles unsold visibility; unsold rows are greyed out
// * Maintains a Map rowid→<tr> so a row seamlessly upgrades from unsold→sold
// -----------------------------------------------------------------------------

(async () => {
  // ---------- config & auth ---------------------------------------------------
  // const API_ROOT     = 'https://drive.icychris.co.uk';
const API_ROOT = "/api"

  const API   = `${API_ROOT}/cashier/live`;
  const VALIDATE   = `${API_ROOT}/validate`;

 // for legacy reasons, the admin token is called "token"
// let token = localStorage.getItem('token') || localStorage.getItem('cashierToken');

  const params = new URLSearchParams(location.search);
  const AUCTION_ID = Number(params.get('auctionId'));
  const AUCTION_STATUS = (params.get('auctionStatus') || '').toLowerCase();

  // if the auction isnt live, we dont need to poll especially fast

  const REFRESH_MS = AUCTION_STATUS === 'live' ? 5000 : 60000;

  // console.log(REFRESH_MS);

  if (!Number.isInteger(AUCTION_ID) || AUCTION_ID <= 0) {
    alert('This page must be opened with ?auctionId=<number>');
 //   location.href = '/admin.html';
    return;
  }

  // ---------- DOM refs --------------------------------------------------------
  const tbody = document.querySelector('#feed tbody');
  const statusEl = document.getElementById('status');
  const chkUnsold = document.getElementById('showUnsold');
  const applyFilter = document.getElementById('btnApply');

  

  // ---------- state -----------------------------------------------------------
  const rowsMap = new Map(); // rowid -> <tr>

  // ---------- helpers ---------------------------------------------------------
  const money = v => `£${Number(v).toFixed(2)}`;
  const time  = () => new Date().toLocaleTimeString();
  const setStatus = ok => {
    statusEl.textContent = ok ? 'Updated' : 'Stale';
    statusEl.className   = ok ? 'ok' : 'stale';
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

    const rowHtml = `
    <td>${pad}</td>
      <td>${r.lot}</td>
      <td>${desc}</td>
      <td>${prc2}</td>`;
      tr.style.setProperty('background', getColor(r.bidder), 'important'); // force tint

    tr.innerHTML = rowHtml;
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
//  location.href = '/cashier-login.html';
  throw new Error('no valid token');
}


    applyFilter.addEventListener("click", function () { clearTable(); poll(); })


  chkUnsold.onchange = () => { clearTable(); poll() }; // re-poll will rebuild

  async function poll(){
    try{
      // const body = {
      //   auction_id: AUCTION_ID,
      //   include_unsold: chkUnsold.checked
      // };
      const res = await fetch(`${API}/${AUCTION_ID}?unsold=${chkUnsold.checked}`, {
   //     method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization: token }
  //      body: JSON.stringify(body)
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

   //       renderRowContent(existing, r); // update content / style
        } else {
          const tr = makeRow(r);
          rowsMap.set(r.rowid, tr);
          if (r.unsold) tbody.appendChild(tr);   // unsold at bottom
          else           tbody.prepend(tr);      // sold at top
        }
      });
      setStatus(true);
      resetStale();
    }catch{ setStatus(false);}  }

  let staleTimer=null;
  function resetStale(){
    clearTimeout(staleTimer);
    staleTimer=setTimeout(()=>setStatus(false),REFRESH_MS*1.5);
  }

    function startAutoRefresh() {
        setInterval(() => {
            if (document.visibilityState === "visible") {
                poll();
                            } else {
     //           console.log("Page not visible — skipping refresh");
            }
        }, REFRESH_MS);
    }

  // initial draw & polling loop ----------------------------------------------
  poll();
  startAutoRefresh();
 // setInterval(poll, REFRESH_MS);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
 //           console.log("Page became visible — refreshing now");
  poll();
        }
      })
 
})();
