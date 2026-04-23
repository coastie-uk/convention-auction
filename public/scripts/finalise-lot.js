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
    const UNDO_PREVIEW_API = id => `${API}/lots/${id}/undo-preview`;
    const UNDO_API      = id => `${API}/lots/${id}/undo`;
    const FINALIZE_API = id => `${API}/lots/${id}/finalize`;
    const BIDDER_LOOKUP_API = (auctionId, paddle) => `${API}/auctions/${auctionId}/bidders/lookup?paddle_number=${encodeURIComponent(paddle)}`;
    const BIDDER_LIST_API = auctionId => `${API}/auctions/${auctionId}/bidders`;
    
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

  function getCurrencySymbol() {
    return window.localStorage.getItem("currencySymbol") || "£";
  }

  function money(value) {
    const amount = Number(value);
    const normalised = Number.isFinite(amount) ? amount : 0;
    return `${getCurrencySymbol()}${normalised.toFixed(2)}`;
  }

  function formatBidderLabel(paddle, name) {
    const paddleText = paddle == null || paddle === '' ? '' : String(paddle);
    const nameText = String(name || '').trim();
    return nameText ? `${paddleText} - ${nameText}` : paddleText;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createUndoPreviewModal(preview) {
    const overlay = document.createElement('div');
    const projectedBalance = Number(preview?.projected?.balance_after_retract || 0);
    const canRetract = preview?.can_retract === true;
    const bidderLabel = preview?.bidder?.paddle_number
      ? `Paddle ${preview.bidder.paddle_number}`
      : 'No bidder assigned';

    overlay.className = 'app-modal retract-preview-modal';
    overlay.innerHTML = `
      <div class="app-modal-card retract-preview-card" role="dialog" aria-modal="true" aria-labelledby="retract-preview-title">
        <div class="app-modal-header">
          <div>
            <h3 id="retract-preview-title">Retract Bid</h3>
            <p>Review the bidder balance before removing this lot.</p>
          </div>
          <button type="button" class="app-modal-close js-close-retract-preview" aria-label="Close retract preview">Close</button>
        </div>

        <div class="retract-preview-lot">
          <div class="retract-preview-lot-number">Lot #${escapeHtml(preview?.item?.item_number ?? '')}</div>
          <div class="retract-preview-lot-description">${escapeHtml(preview?.item?.description || '')}</div>
          <div class="retract-preview-lot-price">Item price ${money(preview?.item?.hammer_price || 0)}</div>
        </div>

        <div class="retract-preview-summary-grid">
          <div class="retract-preview-stat">
            <span class="retract-preview-stat-label">Bidder</span>
            <strong class="retract-preview-stat-value">${escapeHtml(bidderLabel)}</strong>
          </div>
          <div class="retract-preview-stat">
            <span class="retract-preview-stat-label">Payment status</span>
            <strong class="retract-preview-stat-value">
              <span class="retract-preview-badge retract-preview-badge--${escapeHtml(preview?.current?.payment_status || 'not_paid')}">${escapeHtml(preview?.current?.payment_status_label || 'Not paid')}</span>
            </strong>
          </div>
          <div class="retract-preview-stat">
            <span class="retract-preview-stat-label">Current total owed</span>
            <strong class="retract-preview-stat-value">${money(preview?.current?.lots_total || 0)}</strong>
          </div>
          <div class="retract-preview-stat">
            <span class="retract-preview-stat-label">Amount paid</span>
            <strong class="retract-preview-stat-value">${money(preview?.current?.payments_total || 0)}</strong>
          </div>
        </div>

        <div class="retract-preview-impact ${canRetract ? 'is-allowed' : 'is-blocked'}">
          <div class="retract-preview-impact-label">Projected owed after retraction</div>
          <div class="retract-preview-impact-value ${projectedBalance < 0 ? 'is-negative' : 'is-nonnegative'}">${money(projectedBalance)}</div>
          <p class="retract-preview-impact-copy">${escapeHtml(preview?.guidance || '')}</p>
        </div>

        <div class="retract-preview-actions">
          <button type="button" class="retract-preview-cancel js-close-retract-preview">Cancel</button>
          ${canRetract ? '<button type="button" class="retract-preview-confirm js-confirm-retract">Confirm Retract</button>' : ''}
        </div>
      </div>
    `;

    const close = () => overlay.remove();
    overlay.querySelectorAll('.js-close-retract-preview').forEach((button) => {
      button.addEventListener('click', close);
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    document.body.appendChild(overlay);
    overlay.tabIndex = -1;
    overlay.focus();

    return {
      overlay,
      close,
      confirmButton: overlay.querySelector('.js-confirm-retract')
    };
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
      if (tr.dataset.deleted === '1') return;

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

  function getRowBidContext(row) {
    if (!row) return null;
    const itemId = Number(row.dataset.itemId);
    const itemNo = Number(row.dataset.item_number);
    if (!Number.isInteger(itemId) || itemId <= 0) return null;
    return {
      itemId,
      itemNo,
      itemDesc: row.dataset.description || '',
      rowEl: row
    };
  }

  function findNextFinalizeContext(itemId, rowEl) {
    const nextButton = findNextFinalizeButton(itemId, rowEl);
    const context = getRowBidContext(nextButton?.closest('tr'));
    return context && context.itemId !== Number(itemId) ? context : null;
  }

  async function refreshAdminItems() {
    if (typeof window.loadAdminItems === 'function') {
      await window.loadAdminItems({ suppressErrors: true });
    }
  }

  async function fetchKnownBidders(auctionId) {
    if (!auctionId) return [];
    try {
      const res = await fetch(BIDDER_LIST_API(auctionId), {
        headers: { 'Authorization': getToken() }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load bidders');
      return Array.isArray(data.bidders) ? data.bidders : [];
    } catch (_error) {
      return [];
    }
  }

  function renderKnownBidders(container, bidders, selectBidder) {
    if (!container) return;
    if (!bidders.length) {
      container.innerHTML = '<div class="known-bidder-empty">No known bidders yet.</div>';
      return;
    }

    container.innerHTML = bidders.map((bidder) => `
      <button type="button" class="known-bidder-item" data-paddle="${escapeHtml(bidder.paddle_number)}" data-name="${escapeHtml(bidder.name || '')}">
        <span class="known-bidder-paddle">${escapeHtml(bidder.paddle_number)}</span>
        <span class="known-bidder-name">${escapeHtml(bidder.name || 'Unnamed')}</span>
      </button>
    `).join('');

    container.querySelectorAll('.known-bidder-item').forEach((button) => {
      button.addEventListener('click', () => {
        selectBidder(button.dataset.paddle || '', button.dataset.name || '');
      });
    });
  }

  // --------------- modal & finalize --------------------------
  function openFinalizeModal(itemId, itemNo, itemDesc, rowEl) {
    let activeItem = { itemId, itemNo, itemDesc, rowEl };
    const wrap = document.createElement('div');
    wrap.className = 'admin-inline-modal';
    wrap.innerHTML = `
      <div class="admin-inline-card admin-inline-card--bid" role="dialog" aria-modal="true" aria-labelledby="admin-bid-modal-title">
        <aside class="known-bidder-panel" aria-label="Known bidders">
          <div class="known-bidder-title">Known Bidders</div>
          <div class="known-bidder-list" data-known-bidder-list>
            <div class="known-bidder-empty">Loading bidders...</div>
          </div>
        </aside>
        <div class="admin-bid-entry">
          <h3 id="admin-bid-modal-title">Record Bid</h3>
          <p class="admin-inline-copy" data-lot-summary>Lot #${escapeHtml(itemNo)}: ${escapeHtml(itemDesc)}</p>
          <div class="admin-inline-field">
            <label for="paddle">Paddle #</label>
            <input id="paddle" class="admin-inline-input" type="number" min="1" max="999" inputmode="numeric" autofocus>
          </div>
          <div class="admin-inline-field">
            <label for="price">Hammer ${window.localStorage.getItem("currencySymbol") || "£"}</label>
            <input id="price" class="admin-inline-input" type="number" min="1" step="0.01" inputmode="decimal">
          </div>
          <div class="admin-inline-field">
            <label for="bidder-name">Name</label>
            <input id="bidder-name" class="admin-inline-input" type="text" maxlength="100" autocomplete="off">
          </div>
          <div class="admin-inline-actions">
            <button id="cancel" type="button" class="admin-inline-cancel">Cancel</button>
            <button id="record-next" type="button" class="admin-inline-secondary">Record and Next</button>
            <button id="ok" type="button" class="admin-inline-confirm">Record Bid</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const cancelButton = wrap.querySelector('#cancel');
    const okButton = wrap.querySelector('#ok');
    const recordNextButton = wrap.querySelector('#record-next');
    const paddleInput = wrap.querySelector('#paddle');
    const priceInput = wrap.querySelector('#price');
    const bidderNameInput = wrap.querySelector('#bidder-name');
    const lotSummary = wrap.querySelector('[data-lot-summary]');
    const knownBidderList = wrap.querySelector('[data-known-bidder-list]');

    const currentAuctionId = () => parseInt(document.getElementById("auction-select").value, 10);
    const updateLotSummary = () => {
      lotSummary.textContent = `Lot #${activeItem.itemNo}: ${activeItem.itemDesc}`;
    };
    const clearBidFields = ({ keepBidder = true } = {}) => {
      if (!keepBidder) {
        paddleInput.value = '';
        bidderNameInput.value = '';
      }
      priceInput.value = '';
    };
    const selectKnownBidder = (paddle, name) => {
      paddleInput.value = paddle;
      bidderNameInput.value = name;
      priceInput.focus();
      priceInput.select();
    };
    const reloadKnownBidders = async () => {
      renderKnownBidders(knownBidderList, await fetchKnownBidders(currentAuctionId()), selectKnownBidder);
    };

    void reloadKnownBidders();
    paddleInput.focus();

    paddleInput.addEventListener('blur', async () => {
      const paddle = paddleInput.value.trim();
      const auctionId = currentAuctionId();
      if (!paddle || !Number.isInteger(Number(paddle)) || Number(paddle) <= 0 || !auctionId) {
        bidderNameInput.value = '';
        return;
      }
      try {
        const res = await fetch(BIDDER_LOOKUP_API(auctionId, paddle), {
          headers: { 'Authorization': getToken() }
        });
        if (!res.ok) return;
        const data = await res.json();
        bidderNameInput.value = data?.bidder?.name || '';
      } catch (_error) {
        // Lookup is a convenience only; bid recording remains available.
      }
    });

    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); cancelButton.click(); }
      if (e.key === 'Enter')  { e.preventDefault(); okButton.click(); }
    });


    cancelButton.onclick = () => wrap.remove();
    const recordBid = async ({ advance = false } = {}) => {
      const paddle = wrap.querySelector('#paddle').value.trim();
      const price  = wrap.querySelector('#price').value.trim();
      const bidderName = bidderNameInput.value.trim();
      const auctionId = currentAuctionId();

      if (!paddle || !price) {
        showMessage("Enter paddle & price", "error");
        return;
      }
      try {
        const nextContext = advance ? findNextFinalizeContext(activeItem.itemId, activeItem.rowEl) : null;
        okButton.disabled = true;
        recordNextButton.disabled = true;
        const res = await fetch(FINALIZE_API(activeItem.itemId), {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Authorization': getToken() },
          body: JSON.stringify({ paddle:Number(paddle), price:Number(price), bidderName, auctionId:Number(auctionId) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
        activeItem.rowEl.dataset.sold = '1';
        activeItem.rowEl.classList.add('sold-row');
        activeItem.rowEl.querySelector('.btn-finalize')?.remove();
        enhanceRows(); // re-show UNDO button
        const displayBidder = formatBidderLabel(paddle, bidderName || data.bidder_name);
        showMessage(`Item ${activeItem.itemNo} sold to bidder #${displayBidder} for £${price}`, "success");

        /* --- update paddle & price cells immediately --- */
        const cells = activeItem.rowEl.children;
        if (cells.length >= 7) {
          cells[5].textContent = document.getElementById('show-bidder-names')?.checked
            ? displayBidder
            : paddle;                 // Paddle #
          cells[6].textContent = '£' + Number(price).toFixed(2);  // Hammer £
        }

        // Check if that was the last item (done on the backend)
        if (data.auction_status === "settlement") {
          showMessage(`All bids recorded - Auction now in settlement mode`, "success");
          await refreshAdminItems();
          wrap.remove();
        } else {
          await refreshAdminItems();
          await reloadKnownBidders();
          if (advance && nextContext) {
            const refreshedRow = TABLE_BODY.querySelector(`tr[data-item-id="${nextContext.itemId}"]`);
            activeItem = {
              ...nextContext,
              rowEl: refreshedRow || nextContext.rowEl
            };
            updateLotSummary();
            clearBidFields({ keepBidder: true });
            priceInput.focus();
          } else {
            /* move focus to the next visible finalize button in the current table DOM */
            const nextBtn = findNextFinalizeButton(activeItem.itemId, activeItem.rowEl);
            wrap.remove();
            nextBtn?.focus();
          }
        }

      } catch(err) {
        showMessage(err.message||err, "error");

   //     alert(err.message||err);
      } finally {
        okButton.disabled = false;
        recordNextButton.disabled = false;
      }
    };
    okButton.onclick = () => recordBid({ advance: false });
    recordNextButton.onclick = () => recordBid({ advance: true });
  }

  // --------------- undo finalize -----------------------------
  async function undoFinalize(itemId, rowEl) {
    try {
      const previewResponse = await fetch(UNDO_PREVIEW_API(itemId), {
        headers: { 'Authorization': getToken() }
      });
      const previewData = await previewResponse.json();
      if (!previewResponse.ok) {
        showMessage(previewData.error || 'Cannot load retract preview', "error");
        return;
      }

      const modal = createUndoPreviewModal(previewData);
      if (!modal.confirmButton) {
        return;
      }

      modal.confirmButton.addEventListener('click', async () => {
        modal.confirmButton.disabled = true;
        modal.confirmButton.textContent = 'Retracting...';

        try {
          const res = await fetch(UNDO_API(itemId), {
            method:'POST',
            headers:{ 'Authorization': getToken() }
          });
          const data = await res.json();
          if (!res.ok) {
            showMessage(data.error || 'Cannot undo', "error");
            modal.close();
            return;
          }

          rowEl.dataset.sold = '0';
          rowEl.classList.remove('sold-row');
          rowEl.querySelector('.btn-undo')?.remove();
          enhanceRows();
          showMessage(data.message, "info");

          const cells = rowEl.children;
          if (cells.length >= 7) {
            cells[5].textContent = "";
            cells[6].textContent = "";
          }

          await refreshAdminItems();
          modal.close();
        } catch(err) {
          showMessage(err.message||err, "error");
          modal.close();
        }
      });
    } catch(err) {
      showMessage(err.message||err, "error");
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
        const isViewBtn = btn.classList.contains('view-item-button');
        const shouldDisable = !isViewBtn && (isLive || hasBid);

        if (shouldDisable) {
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
