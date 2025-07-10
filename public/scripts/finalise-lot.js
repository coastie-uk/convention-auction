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

    const TABLE_BODY    = document.getElementById('items-table-body');
    const STATUS_API    = `${API}/auction-status`;   // new endpoint in patch v1.2
    const UNDO_API      = id => `${API}/lots/${id}/undo`;
    const FINALIZE_API = id => `${API}/lots/${id}/finalize`;
    
    let auctionStatus = 'setup';  // default; will sync below

    // states in which the edit controls should be locked out
    const lockEditStates = ['live', 'settlement', 'archived'];

    // states in which we should hide the bid  control buttons
    const hideFinaliseStates = ['setup', 'locked', 'archived'];


  function getToken() {
    return localStorage.getItem("token");
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
          console.warn('Auction status check failed', err);
          auctionStatus = 'live';
        }
      }


  // --------------- inject buttons ----------------------------
  function enhanceRows() {

//    if (auctionStatus !== 'live') return; // active only in live phase
    if (hideFinaliseStates.includes(auctionStatus)) return

    TABLE_BODY.querySelectorAll('tr').forEach(tr => {
  //      console.log(tr.dataset);
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

      // Finalize button (only for unsold lots)
      if (!isSold && !cell.querySelector('.btn-finalize')) {
        const btn = document.createElement('button');
        btn.textContent = 'Finalize';
        btn.className   = 'btn-finalize';
        btn.onclick     = () => openFinalizeModal(id, item_no, description, tr);
        cell.appendChild(btn);
      }

      // Undo button (sold but not locked)
      if (isSold && !locked && !cell.querySelector('.btn-undo')) {
        const u = document.createElement('button');
        u.textContent = 'Undo';
        u.className   = 'btn-undo';
        u.onclick     = () => undoFinalize(id, tr);
        cell.appendChild(u);
      }
    });
  }

  // --------------- modal & finalize --------------------------
  function openFinalizeModal(itemId, itemNo, itemDesc, rowEl) {

    const wrap = document.createElement('div');
    wrap.style = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;justify-content:center;align-items:center;z-index:9999;';
    wrap.innerHTML = `
      <div style="background:#fff;padding:20px;border-radius:8px;width:260px;font-family:Arial;">
        <h3>Finalize Lot #${itemNo} - ${itemDesc}</h3>
        <label>Paddle #</label>
        <input id="paddle" type="number" min="1" max="999" style="width:100%" autofocus>
        <label>Hammer £</label>
        <input id="price" type="number" min="1" step="0.01" style="width:100%">
        <div style="margin-top:1rem;display:flex;gap:6px;justify-content:flex-end;">
          <button id="cancel">Cancel</button>
          <button id="ok">Finalize</button>
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

        /* move focus to next Finalize button */
            let nextRow = rowEl.nextElementSibling;
            while (nextRow && !nextRow.querySelector('.btn-finalize')) {
              nextRow = nextRow.nextElementSibling;
            }
            const nextBtn = nextRow
              ? nextRow.querySelector('.btn-finalize')
              : document.querySelector('.btn-finalize');  // wrap-around if at end
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
    if (!confirm('Undo finalize for this lot?')) return;
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
      showMessage("Bid retracted successfully", "info");

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

  // --------------- lock editing when live --------------------
  function lockEditingUI() {
    const addBtn = document.getElementById('add-item');
 //   const isLive = auctionStatus === 'live';

    const isLive = lockEditStates.includes(auctionStatus);

    // Toggle main “Create New Item” button
    if (isLive) {
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
      [editBtn, moveBtn].forEach(btn => {
        if (!btn) return;
        if (isLive) {
          btn.disabled = true;
          btn.classList.add('disabled');
          btn.style.pointerEvents = 'none';
          btn.style.opacity = '0.5';
        } else {
          btn.disabled = false;
          btn.classList.remove('disabled');
          btn.style.pointerEvents = '';
          btn.style.opacity = '';
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
        console.warn("Login required:", err.message);
        localStorage.removeItem("token");
        window.location.href = "/admin"; // or logout()
    });
});



})();
