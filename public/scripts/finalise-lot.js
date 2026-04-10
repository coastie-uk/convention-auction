// Admin Finalize‑Lot Add‑on
// ---------------------------------------------------------------------------
//  • Adds a FINALIZE button to each row when auction.status === 'live'
//  • Pops a mini‑modal to capture Paddle # (3‑digit) and Hammer £
//  • Calls POST /api/lots/:id/finalize with admin token
//  • Disables itself automatically if auction status is not 'live'
//
// ---------------------------------------------------------------------------

(() => {
const API = "/api"
    const ACTION_ICONS = Object.freeze({
      finalize: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="m8.5 12.5 2.3 2.3 4.7-5.3"></path>
        </svg>
      `,
      undo: `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m9 14-5-5 5-5"></path>
          <path d="M20 20a8 8 0 0 0-8-8H4"></path>
        </svg>
      `
    });

    const TABLE_BODY    = document.getElementById('items-table-body');
    const STATUS_API    = `${API}/auction-status`;   // new endpoint in patch v1.2
    const UNDO_API      = id => `${API}/lots/${id}/undo`;
    const FINALIZE_API = id => `${API}/lots/${id}/finalize`;
    
    let auctionStatus = 'setup';  // default; will sync below

    // states in which the edit controls should be locked out
    const lockEditStates = ['live', 'settlement', 'archived'];
    const lockNewAdminItemStates = ['settlement', 'archived'];

    // states in which we should hide the bid  control buttons
    const hideFinaliseStates = ['setup', 'locked', 'archived'];


  function getToken() {
    return window.AppAuth?.getToken?.() || localStorage.getItem("token");
  }

  function canManageBids() {
    const session = window.__APP_AUTH_BOOTSTRAP__ || window.AppAuth?.getSharedSession?.();
    return window.AppAuth?.canAccess
      ? window.AppAuth.canAccess(session?.user, { permission: "admin_bidding" })
      : true;
  }
     // --------------- fetch auction status (POST body) ----------
    async function syncStatus() {
        try {
  //          const currentAuctionId = sessionStorage.getItem("auction_id");
          const currentAuctionId = parseInt(document.getElementById("auction-select").value, 10);
          const res = await fetch(STATUS_API, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': getToken()
            },
            body: JSON.stringify({ auction_id: currentAuctionId })
          });
          if (!res.ok) throw new Error('status');
          const data = await res.json();
          auctionStatus = data.status || 'live';
          window.currentAuctionStatus = auctionStatus;   // ← expose globally

        } catch (err) {

          auctionStatus = 'live';
        }
      }


  // --------------- inject buttons ----------------------------
  function enhanceRows() {
    if (!canManageBids()) {
      TABLE_BODY.querySelectorAll('.btn-finalize, .btn-undo').forEach((button) => button.remove());
      return;
    }

    if (hideFinaliseStates.includes(auctionStatus)) return;

    TABLE_BODY.querySelectorAll('tr').forEach(tr => {

      const id      = Number(tr.dataset.itemId);
      const item_no = Number(tr.dataset.item_number);
      const description = tr.dataset.description;
      const isSold  = tr.dataset.sold === '1';
      const locked  = tr.dataset.locked === '1';  // set after payment exists
 //     const cell    = tr.querySelector('td:last-child');

      // use the Actions column (parent of Edit button) if possible
      let cell = tr.querySelector('button[onclick^="editItem"]')?.parentElement;
      if (!cell) cell = tr.querySelector('td:last-child'); // fallback

      if (!cell) return;
      const actionStrip = cell.querySelector('.item-actions') || cell;

      // Finalize button (only for unsold lots)
      if (!isSold && !actionStrip.querySelector('.btn-finalize')) {
        const btn = buildActionButton('btn-finalize', 'Record bid', ACTION_ICONS.finalize);
        btn.onclick     = () => openFinalizeModal(id, item_no, description, tr);
        actionStrip.appendChild(btn);
      }

      // Undo button (sold but not locked)
      if (isSold && !locked && !actionStrip.querySelector('.btn-undo')) {
        const u = buildActionButton('btn-undo', 'Undo bid', ACTION_ICONS.undo);
        u.onclick     = () => undoFinalize(id, tr);
        actionStrip.appendChild(u);
      }
    });
  }

  function buildActionButton(className, title, icon) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `item-action-button ${className}`;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.dataset.defaultTitle = title;
    btn.innerHTML = `<span class="item-action-icon" aria-hidden="true">${icon}</span>`;
    return btn;
  }

  function findNextFinalizeButton(itemId, rowEl) {
    const currentRow = TABLE_BODY.querySelector(`tr[data-item-id="${itemId}"]`) || rowEl;
    if (!currentRow?.isConnected) {
      return null;
    }

    let nextRow = currentRow.nextElementSibling;
    while (nextRow) {
      const nextBtn = nextRow.querySelector('.btn-finalize');
      if (nextBtn) return nextBtn;
      nextRow = nextRow.nextElementSibling;
    }

    // Only wrap if we still have a stable anchor for the current row in the live DOM.
    return TABLE_BODY.querySelector('.btn-finalize');
  }

  // --------------- modal & finalize --------------------------
  function openFinalizeModal(itemId, itemNo, itemDesc, rowEl) {

    const wrap = document.createElement('div');
    wrap.style = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center;z-index:9999;';
    wrap.innerHTML = `
      <div style="background:#fff;padding:20px;border-radius:8px;width:260px;font-family:Arial;">
        <h3>Record bid for Lot #${itemNo} - ${itemDesc}</h3>
        <label>Paddle #</label>
        <input id="paddle" type="number" min="1" max="999" style="width:100%" autofocus>
        <label>Hammer £</label>
        <input id="price" type="number" min="1" step="0.01" style="width:100%">
        <div style="margin-top:1rem;display:flex;gap:6px;justify-content:flex-end;">
          <button id="cancel">Cancel</button>
          <button id="ok">Record Bid</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('#paddle').focus();

    wrap.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
  if (e.key === 'Enter')  { e.preventDefault(); ok.click();     }
});


    wrap.querySelector('#cancel').onclick = () => wrap.remove();
    wrap.querySelector('#ok').onclick = async () => {
      const paddle = wrap.querySelector('#paddle').value.trim();
      const price  = wrap.querySelector('#price').value.trim();
      const currentAuctionId = parseInt(document.getElementById("auction-select").value, 10);

      if (!paddle || !price) {
        showMessage("Enter paddle & price", "error");
        return;
      }
      try {
        const res = await fetch(FINALIZE_API(itemId), {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Authorization': getToken() },
          body: JSON.stringify({ paddle:Number(paddle), price:Number(price), auctionId:Number(currentAuctionId) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
        rowEl.dataset.sold = '1';
        rowEl.classList.add('sold-row');
        rowEl.querySelector('.btn-finalize').remove();
        enhanceRows(); // re-show UNDO button
        showMessage(`Item ${itemNo} sold to bidder #${paddle} for £${price}`, "success");

        /* --- update paddle & price cells immediately --- */
        const cells = rowEl.children;        
        if (cells.length >= 7) {
          cells[5].textContent = paddle;                 // Paddle #
          cells[6].textContent = '£' + Number(price).toFixed(2);  // Hammer £
        }

        // Check if that was the last item (done on the backend)
        if (data.auction_status === "settlement") {
          showMessage(`All bids recorded - Auction now in settlement mode`, "success");
        } else {

        /* move focus to the next visible finalize button in the current table DOM */
            const nextBtn = findNextFinalizeButton(itemId, rowEl);
            nextBtn?.focus();
      }

      } catch(err) { 
                showMessage(err.message||err, "error");

   //     alert(err.message||err); 
   }
      wrap.remove();
    };
  }

  // --------------- undo finalize -----------------------------
  async function undoFinalize(itemId, rowEl) {
    // if (!confirm('Undo finalize for this lot?')) return;
           const modal = await DayPilot.Modal.confirm("Retract bid for this lot?");
        if (modal.canceled) {
           return showMessage("Retract cancelled", "info");
        } else { 
    
    try {
      const res = await fetch(UNDO_API(itemId), {
        method:'POST',
        headers:{ 'Authorization': getToken() }
      });
      const data = await res.json();
      if (!res.ok) {
 //       alert(data.error || 'Cannot undo');
            showMessage(data.error || 'Cannot undo', "error");

        if (res.status === 409) {
          rowEl.dataset.locked = '1'; // locked (payment exists)
      //    rowEl.querySelector('.btn-undo')?.remove();
        }
        return;
      }
      // success → reset row state
      rowEl.dataset.sold = '0';
      rowEl.classList.remove('sold-row');
      rowEl.querySelector('.btn-undo')?.remove();
      enhanceRows(); // re-show Finalize button
      showMessage(data.message, "info");

              /* --- update paddle & price cells immediately --- */
        const cells = rowEl.children;        
        if (cells.length >= 7) {
          cells[5].textContent = "";                 // Paddle #
          cells[6].textContent = "";  // Hammer £
        }

      

    } catch(err) { 
   //   alert(err.message||err);
      showMessage(err.message||err, "error");

    }
  }
  }

  // --------------- lock editing when live --------------------
  function lockEditingUI() {
    const addBtn = document.getElementById('add-item');
 //   const isLive = auctionStatus === 'live';
    
    const isLive = lockEditStates.includes(auctionStatus);

    // Toggle main “Create New Item” button - Allow in live but not settlement/archived, per feedback
    if (lockNewAdminItemStates.includes(auctionStatus)) {
      addBtn?.setAttribute('disabled', '');
      addBtn?.classList.add('disabled');
    } else {
      addBtn?.removeAttribute('disabled');
      addBtn?.classList.remove('disabled');
    }

    // Toggle per‑row Edit & Move buttons
    TABLE_BODY.querySelectorAll('tr').forEach(tr => {
      const editBtn = tr.querySelector('button[onclick^="editItem"]');
      const moveBtn = tr.querySelector('.move-toggle');
      const copyBtn = tr.querySelector('.duplicate-item-button');
      const printBtn = tr.querySelector('button[onclick^="printItem"]');
      const hasBid = tr.dataset.sold === '1';
      [editBtn, moveBtn, copyBtn].forEach(btn => {
        if (!btn) return;
        const defaultTitle = btn.dataset.defaultTitle || btn.title || '';
        const isMoveBtn = btn.classList.contains('move-toggle');
        if (isLive || hasBid) {
          btn.disabled = true;
          btn.style.display = isLive ? 'none' : 'inline-flex'; // hide move if live without bids
          btn.classList.add('disabled');
          btn.style.pointerEvents = 'none';
          btn.style.opacity = '0.5';
          if (hasBid) {
            btn.title = isMoveBtn
              ? 'Item has bids and cannot be moved'
              : 'Item has bids and cannot be edited';
          } else {
            btn.title = isMoveBtn
              ? 'Items cannot be moved while editing is locked for this auction'
              : 'Items cannot be edited while editing is locked for this auction';
          }
        } else {
          btn.disabled = false;
          btn.style.display = 'inline-flex';
          btn.classList.remove('disabled');
          btn.style.pointerEvents = '';
          btn.style.opacity = '';
          btn.title = defaultTitle;
        }
      });
    });
  }

  // make enhancer callable from outside (e.g., after table refresh)
  window.enhanceFinalizeButtons = () => { enhanceRows(); lockEditingUI(); }; () => { enhanceRows(); lockEditingUI(); };


  //  ---- add once, near bottom of finalize‑lot add‑on -----
const observer = new MutationObserver(() => enhanceRows());
observer.observe(TABLE_BODY, { childList: true });

  // --------------- expose refresh for auction switch ---------
  window.refreshAuctionStatus = async () => {
    await syncStatus();
    enhanceRows();
    lockEditingUI();
    return auctionStatus;  // allow callers to await if they want
  };

  // --------------- init --------------------------------------
  // (async () => { 
  //   await syncStatus(); 
  //   enhanceRows(); 
  //   lockEditingUI(); })();


  async function initFinalise() {
    await syncStatus();
    enhanceRows();
    lockEditingUI();

    }

window.addEventListener("load", () => {
    const token = localStorage.getItem("token");
    if (!token) return; // Not logged in

    fetch(`${API}/validate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token })
    })
    .then(res => {
        if (res.status === 403) {
            throw new Error("Token expired");
        }
        return res.json();
    })
    .then(data => {
         initFinalise();
    })
    .catch(err => {

        localStorage.removeItem("token");
        window.location.href = "/admin"; // or logout()
    });
});

window.addEventListener(window.AppAuth?.SESSION_EVENT || "appauth:session", () => {
    enhanceRows();
    lockEditingUI();
});



})();
