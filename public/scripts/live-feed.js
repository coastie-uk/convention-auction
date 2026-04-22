// live-feed.js
// ---------------------------------------------------------------------------
// Cashier live feed focused on two jobs:
// 1. Show newly sold items that need immediate attention.
// 2. Keep collection assembly stable by grouping sold items by bidder.
// ---------------------------------------------------------------------------

(async () => {
  const API_ROOT = '/api';
  const API = `${API_ROOT}/cashier/live`;
  const LIST_AUCTIONS = `${API_ROOT}/list-auctions`;
  const CHANGE_PASSWORD = `${API_ROOT}/change-password`;
  const params = new URLSearchParams(location.search);
  const REQUESTED_AUCTION_ID = Number(params.get('auctionId'));
  const REQUESTED_AUCTION_STATUS = (params.get('auctionStatus') || '').toLowerCase();
  const currencySymbol = localStorage.getItem('currencySymbol') || '£';
  const REFRESH_MS = 5000;
  const RECENT_ACTIVITY_LIMIT = 12;
  const liveFeedPreferenceController = window.AppAuth?.createPreferenceController?.({ pageKey: 'live_feed' }) || null;
  const liveFeedPreferences = liveFeedPreferenceController?.getPagePreferences?.() || {};
  const INITIAL_AUCTION_ID = Number.isInteger(REQUESTED_AUCTION_ID) && REQUESTED_AUCTION_ID > 0
    ? REQUESTED_AUCTION_ID
    : null;

  const $ = id => document.getElementById(id);
  const els = {
    status: $('status'),
    chkUnsold: $('showUnsold'),
    applyFilter: $('btnApply'),
    refreshButton: $('btnRefresh'),
    uncollectedCsvButton: $('btnUncollectedCsv'),
    countdown: $('refreshCountdown'),
    filterInput: $('filter'),
    changePersistInput: $('changePersistSeconds'),
    bucketSortOrderInput: $('bucketSortOrder'),
    showPicturesInput: $('showPictures'),
    showMultiItemBucketsOnlyInput: $('showMultiItemBucketsOnly'),
    recentBody: document.querySelector('#recentFeed tbody'),
    bidderGroups: $('bidderGroups'),
    bidderSummary: $('bidderSummary'),
    unsoldSection: $('unsoldSection'),
    unsoldBody: document.querySelector('#unsoldFeed tbody'),
    unsoldEmpty: $('unsoldEmpty'),
    auctionSelect: $('auction-select'),
    auctionMenuState: $('auction-menu-state'),
    currentAuctionPill: $('current-auction-pill'),
    currentStatePill: $('current-state-pill'),
    goPublicBtn: $('go-public'),
    goAdminBtn: $('go-admin'),
    goCashierBtn: $('go-cashier'),
    userMenuBtn: $('live-feed-user-menu-button'),
    userDisplay: $('live-feed-logged-in-user'),
    roleDisplay: $('live-feed-logged-in-role'),
    changePwBtn: $('change-own-password-live-feed'),
    logoutBtn: $('logout'),
    aboutModal: $('about-modal'),
    openAboutModalBtn: $('open-about-modal'),
    closeAboutModalBtn: $('close-about-modal'),
    aboutVersionBackend: $('about-version-backend'),
    aboutVersionSchema: $('about-version-schema'),
    aboutVersionPayment: $('about-version-payment')
  };

  const menuGroups = Array.from(document.querySelectorAll('.menu-group'));

  let authToken = null;
  let auctions = [];
  let currentAuction = {
    id: INITIAL_AUCTION_ID,
    full_name: INITIAL_AUCTION_ID ? `Auction ${INITIAL_AUCTION_ID}` : 'No auction selected',
    short_name: '',
    status: REQUESTED_AUCTION_STATUS || 'unknown'
  };
  let staleTimer = null;
  let refreshTimer = null;
  let countdownTimer = null;
  let effectTimer = null;
  let nextRefreshAt = null;
  let pollInFlight = false;
  let soldSnapshotReady = false;
  let lastSoldRowsById = new Map();
  let itemEffects = new Map();
  let invalidatedChangesByBidder = new Map();
  let lastPayload = { sold: [], unsold: [], bidders: [], auction_status: '' };
  let changePersistMs = loadChangePersistMs();
  let bucketSortOrder = loadBucketSortOrder();
  let showPictures = loadShowPictures();
  let showMultiItemBucketsOnly = loadShowMultiItemBucketsOnly();

  function saveLiveFeedPreferences(partial) {
    liveFeedPreferenceController?.patchPagePreferences?.(partial);
  }

  const money = value => `${currencySymbol}${Number(value || 0).toFixed(2)}`;

  function bidderDisplayLabel(summaryOrItem, { prefix = false } = {}) {
    const paddle = summaryOrItem?.bidder == null ? '' : String(summaryOrItem.bidder);
    const name = String(summaryOrItem?.bidder_name || summaryOrItem?.name || '').trim();
    const label = name ? `${paddle} - ${name}` : paddle;
    return prefix && label ? `Paddle ${label}` : label;
  }

  function notify(message, type = 'info') {
    if (typeof showMessage === 'function') {
      showMessage(message, type);
      return;
    }
    alert(message);
  }

  function formatRoleLabel(role) {
    if (!role) return 'Unknown';
    return String(role)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function parseDurationInput(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 15000;
  }

  function buildAuctionOptionLabel(auction) {
    return `${auction.id}: ${auction.full_name} - ${auction.status || 'unknown'}`;
  }

  function getAuctionById(auctionId) {
    return auctions.find(auction => Number(auction.id) === Number(auctionId)) || null;
  }

  function getActiveAuctionId() {
    const auctionId = Number(currentAuction?.id);
    return Number.isInteger(auctionId) && auctionId > 0 ? auctionId : null;
  }

  function getSavedAuctionId() {
    const auctionId = Number(liveFeedPreferenceController?.getPagePreferences?.().selected_auction_id);
    return Number.isInteger(auctionId) && auctionId > 0 ? auctionId : null;
  }

  function updateAboutBox(versions = null) {
    if (els.aboutVersionBackend) els.aboutVersionBackend.textContent = versions?.backend || 'Unknown';
    if (els.aboutVersionSchema) els.aboutVersionSchema.textContent = versions?.schema || 'Unknown';
    if (els.aboutVersionPayment) els.aboutVersionPayment.textContent = versions?.payment_processor || 'Unknown';
  }

  function setSessionMeta(user = null, versions = null) {
    const username = user?.username || 'unknown';
    const roleLabel = window.AppAuth?.describeAccess
      ? window.AppAuth.describeAccess(user)
      : formatRoleLabel(user?.role);
    if (els.userDisplay) els.userDisplay.textContent = username;
    if (els.roleDisplay) els.roleDisplay.textContent = roleLabel;
    if (els.userMenuBtn) els.userMenuBtn.textContent = username;
    updateAboutBox(versions);
  }

  window.addEventListener(window.AppAuth?.SESSION_EVENT || 'appauth:session', (event) => {
    const session = event.detail || null;
    setSessionMeta(session?.user, session?.versions);
  });

  function updateAuctionStatusPills(statusOverride = '') {
    const auctionLabel = currentAuction?.full_name || 'No auction selected';
    const state = statusOverride || currentAuction?.status || REQUESTED_AUCTION_STATUS || 'unknown';
    const stateLabel = formatRoleLabel(state);

    if (els.currentAuctionPill) els.currentAuctionPill.textContent = `Auction: ${auctionLabel}`;
    if (els.currentStatePill) els.currentStatePill.textContent = `State: ${stateLabel}`;
    if (els.auctionMenuState) els.auctionMenuState.textContent = stateLabel;
  }

  function syncGoActionAvailability() {
    const hasAuction = Boolean(currentAuction?.id);
    const isSetup = String(currentAuction?.status || '').toLowerCase() === 'setup';

    if (els.goPublicBtn) {
      els.goPublicBtn.disabled = !currentAuction?.short_name || !isSetup;
      els.goPublicBtn.title = !currentAuction?.short_name
        ? 'Select an auction first'
        : (isSetup ? '' : 'Public form is only available while the auction is in setup state');
    }

    [els.goAdminBtn, els.goCashierBtn].forEach(button => {
      if (!button) return;
      button.disabled = !hasAuction;
      button.title = hasAuction ? '' : 'Select an auction first';
    });

    if (els.auctionSelect) els.auctionSelect.disabled = els.auctionSelect.options.length === 0;
  }

  function updateAuctionOptionLabel(auction) {
    if (!els.auctionSelect || !auction?.id) return;
    const option = Array.from(els.auctionSelect.options).find(
      item => Number(item.value) === Number(auction.id)
    );
    if (option) option.textContent = buildAuctionOptionLabel(auction);
  }

  function populateAuctionSelect() {
    if (!els.auctionSelect) return;

    els.auctionSelect.innerHTML = '';
    auctions.forEach(auction => {
      const option = new Option(buildAuctionOptionLabel(auction), auction.id);
      els.auctionSelect.add(option);
    });

    const matchedAuction = getAuctionById(INITIAL_AUCTION_ID || getSavedAuctionId());
    if (matchedAuction) {
      currentAuction = matchedAuction;
      els.auctionSelect.value = String(matchedAuction.id);
    } else if (auctions[0]) {
      currentAuction = auctions[0];
      els.auctionSelect.value = String(auctions[0].id);
    } else {
      currentAuction = {
        id: null,
        full_name: 'No auction selected',
        short_name: '',
        status: 'unknown'
      };
    }

    if (currentAuction?.id) {
      saveLiveFeedPreferences({ selected_auction_id: Number(currentAuction.id) });
    }

    updateAuctionStatusPills();
    syncGoActionAvailability();
  }

  function closeMenuGroups(exceptMenu = null) {
    menuGroups.forEach(menu => {
      if (menu !== exceptMenu) menu.removeAttribute('open');
    });
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

  function buildLiveFeedUrl(auction) {
    const urlParams = new URLSearchParams();
    urlParams.set('auctionId', auction.id);
    urlParams.set('auctionStatus', auction.status || '');
    return `/cashier/live-feed.html?${urlParams.toString()}`;
  }

  function buildCashierUrl(auction) {
    const urlParams = new URLSearchParams();
    urlParams.set('auctionId', auction.id);
    urlParams.set('auctionStatus', auction.status || '');
    return `/cashier/index.html?${urlParams.toString()}`;
  }

  function buildAdminUrl(auction) {
    if (!auction?.short_name) return '/admin/index.html';
    const urlParams = new URLSearchParams();
    urlParams.set('auction', auction.short_name);
    return `/admin/index.html?${urlParams.toString()}`;
  }

  function buildPublicUrl(auction) {
    if (!auction?.short_name) return null;
    const urlParams = new URLSearchParams();
    urlParams.set('auction', auction.short_name);
    return `/index.html?${urlParams.toString()}`;
  }

  function openUrlInNewTab(url) {
    if (!url) {
      notify('Please select an auction first', 'error');
      return;
    }
    closeMenuGroups();
    window.open(url, '_blank', 'noopener')?.focus();
  }

  function openUrlInSameWindow(url) {
    if (!url) {
      notify('Please select an auction first', 'error');
      return;
    }
    closeMenuGroups();
    window.location.assign(url);
  }

  function logout() {
    window.AppAuth?.clearAllSessions?.({ broadcast: true });
    closeAboutModal();
    window.location.replace('/login.html?reason=signed_out');
  }

  function promptPasswordChange() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,.5);
        display:flex; align-items:center; justify-content:center; z-index:9999;
      `;

      const box = document.createElement('div');
      box.style.cssText = `
        background:#fff; padding:16px; border-radius:8px; width:min(420px, 92vw);
        box-shadow:0 8px 24px rgba(0,0,0,.2); font-family:system-ui, sans-serif;
      `;

      const heading = document.createElement('div');
      heading.textContent = 'Change password';
      heading.style.cssText = 'font-weight:600; margin-bottom:10px;';

      const currentInput = document.createElement('input');
      currentInput.type = 'password';
      currentInput.placeholder = 'Current password';
      currentInput.autocomplete = 'current-password';
      currentInput.style.cssText = 'width:100%; padding:8px; margin-bottom:8px; box-sizing:border-box;';

      const newInput = document.createElement('input');
      newInput.type = 'password';
      newInput.placeholder = 'New password';
      newInput.autocomplete = 'new-password';
      newInput.style.cssText = 'width:100%; padding:8px; margin-bottom:8px; box-sizing:border-box;';

      const confirmInput = document.createElement('input');
      confirmInput.type = 'password';
      confirmInput.placeholder = 'Confirm new password';
      confirmInput.autocomplete = 'new-password';
      confirmInput.style.cssText = 'width:100%; padding:8px; box-sizing:border-box;';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:12px;';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';

      const submit = document.createElement('button');
      submit.type = 'button';
      submit.textContent = 'Update';

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

      cancel.addEventListener('click', () => close(null));
      submit.addEventListener('click', submitForm);
      overlay.addEventListener('click', event => {
        if (event.target === overlay) close(null);
      });

      [currentInput, newInput, confirmInput].forEach(input => {
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter') submitForm();
          if (event.key === 'Escape') close(null);
        });
      });

      row.append(cancel, submit);
      box.append(heading, currentInput, newInput, confirmInput, row);
      overlay.append(box);
      document.body.append(overlay);
      currentInput.focus();
    });
  }

  async function handlePasswordChange() {
    closeMenuGroups();
    const passwordInput = await promptPasswordChange();
    if (!passwordInput) return;

    const { currentPassword, newPassword, confirmPassword } = passwordInput;
    if (!currentPassword || !newPassword || !confirmPassword) {
      notify('All password fields are required', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      notify('Passwords do not match', 'error');
      return;
    }

    try {
      const res = await fetch(CHANGE_PASSWORD, {
        method: 'POST',
        headers: {
          Authorization: authToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notify(data.message || 'Password updated.', 'success');
      } else {
        notify(data.error || 'Failed to change password', 'error');
      }
    } catch {
      notify('Failed to change password', 'error');
    }
  }

  async function getSessionToken() {
    const session = window.__APP_AUTH_BOOTSTRAP__ || await window.AppAuth?.refreshSession?.();
    if (!session) return null;
    return { token: session.token, storageKey: 'shared', data: session };
  }

  async function fetchAuctions() {
    const res = await fetch(LIST_AUCTIONS, {
      method: 'POST',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  function setStatus(ok) {
    if (!els.status) return;
    els.status.textContent = ok ? 'Connected' : 'Not Connected';
    els.status.className = ok ? 'ok' : 'stale';
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
  }

  function updateCountdown() {
    if (!els.countdown) return;
    if (!nextRefreshAt) {
      els.countdown.textContent = 'Next refresh: --';
      return;
    }
    const msRemaining = nextRefreshAt - Date.now();
    els.countdown.textContent = msRemaining <= 0 ? 'Refreshing...' : `Next refresh: ${formatCountdown(msRemaining)}`;
  }

  function setNextRefresh(delayMs) {
    if (refreshTimer) clearTimeout(refreshTimer);
    nextRefreshAt = Date.now() + delayMs;
    updateCountdown();
    refreshTimer = setTimeout(() => {
      void poll({ reschedule: true });
    }, delayMs);
  }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(updateCountdown, 1000);
    updateCountdown();
  }

  function loadChangePersistMs() {
    return parseDurationInput(liveFeedPreferences.change_persist_seconds || 15);
  }

  function loadBucketSortOrder() {
    const raw = liveFeedPreferences.bucket_sort_order;
    if (['paddle', 'ready_state', 'last_update', 'last_paid'].includes(raw)) return raw;
    return 'last_update';
  }

  function loadShowMultiItemBucketsOnly() {
    return liveFeedPreferences.show_multi_item_buckets_only === true;
  }

  function loadShowPictures() {
    return liveFeedPreferences.show_pictures !== false;
  }

  function syncInputs() {
    const pagePreferences = liveFeedPreferenceController?.getPagePreferences?.() || liveFeedPreferences;
    if (els.filterInput) els.filterInput.value = typeof pagePreferences.filter === 'string' ? pagePreferences.filter : '';
    if (els.chkUnsold) els.chkUnsold.checked = pagePreferences.show_unsold === true;
    if (els.changePersistInput) els.changePersistInput.value = String(Math.round(changePersistMs / 1000));
    if (els.bucketSortOrderInput) els.bucketSortOrderInput.value = bucketSortOrder;
    if (els.showPicturesInput) els.showPicturesInput.checked = showPictures;
    if (els.showMultiItemBucketsOnlyInput) els.showMultiItemBucketsOnlyInput.checked = showMultiItemBucketsOnly;
  }

  function resetStale() {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => setStatus(false), REFRESH_MS * 1.5);
  }

  function getActiveItemEffects() {
    const now = Date.now();
    for (const [rowid, effect] of itemEffects.entries()) {
      if (effect.expiresAt <= now) itemEffects.delete(rowid);
    }
    return itemEffects;
  }

  function scheduleEffectRefresh() {
    if (effectTimer) clearTimeout(effectTimer);
    const activeEffects = getActiveItemEffects();
    let nextExpiry = null;

    for (const effect of activeEffects.values()) {
      if (nextExpiry == null || effect.expiresAt < nextExpiry) nextExpiry = effect.expiresAt;
    }
    if (nextExpiry == null) return;

    effectTimer = setTimeout(() => {
      getActiveItemEffects();
      render();
      scheduleEffectRefresh();
    }, Math.max(0, nextExpiry - Date.now()) + 20);
  }

  function retimeActiveEffects() {
    const now = Date.now();
    for (const effect of itemEffects.values()) {
      effect.expiresAt = effect.startedAt + changePersistMs;
      if (effect.expiresAt <= now) itemEffects.delete(effect.rowid);
    }
    scheduleEffectRefresh();
  }

  function mergeInvalidatedChanges(existing = {}, incoming = {}) {
    const addedRowIds = new Set([
      ...(existing.addedRowIds || []).map(String),
      ...(incoming.addedRowIds || []).map(String)
    ]);
    const retractedRows = new Map();

    [...(existing.retractedRows || []), ...(incoming.retractedRows || [])].forEach(row => {
      if (!row?.rowid) return;
      retractedRows.set(String(row.rowid), row);
    });

    return {
      addedRowIds: Array.from(addedRowIds),
      retractedRows: Array.from(retractedRows.values())
    };
  }

  function updateItemEffects(soldRows) {
    const currentSoldById = new Map(soldRows.map(row => [String(row.rowid), row]));
    if (!soldSnapshotReady) {
      soldSnapshotReady = true;
      lastSoldRowsById = currentSoldById;
      return;
    }

    const now = Date.now();
    for (const [rowid, row] of currentSoldById.entries()) {
      if (!lastSoldRowsById.has(rowid)) {
        itemEffects.set(rowid, {
          rowid,
          type: 'added',
          startedAt: now,
          expiresAt: now + changePersistMs,
          snapshot: { ...row }
        });
      } else if (itemEffects.has(rowid) && itemEffects.get(rowid).type === 'retracted') {
        itemEffects.set(rowid, {
          rowid,
          type: 'added',
          startedAt: now,
          expiresAt: now + changePersistMs,
          snapshot: { ...row }
        });
      }
    }

    for (const [rowid, row] of lastSoldRowsById.entries()) {
      if (!currentSoldById.has(rowid)) {
        itemEffects.set(rowid, {
          rowid,
          type: 'retracted',
          startedAt: now,
          expiresAt: now + changePersistMs,
          snapshot: { ...row }
        });
      }
    }

    lastSoldRowsById = currentSoldById;
    scheduleEffectRefresh();
  }

  function getRecentSales(rows, filterValue = '') {
    return rows
      .filter(row => !filterValue || Number(filterValue) === Number(row.bidder))
      .sort((a, b) => {
        const timeA = a.last_bid_update || '';
        const timeB = b.last_bid_update || '';
        if (timeA === timeB) return Number(b.rowid) - Number(a.rowid);
        return timeA < timeB ? 1 : -1;
      })
      .slice(0, RECENT_ACTIVITY_LIMIT);
  }

  function paymentStatusLabel(summary) {
    if (summary.payment_status === 'paid_in_full') return `Paid in full ${money(summary.payments_total)}`;
    if (summary.payment_status === 'part_paid') return `Part paid ${money(summary.payments_total)} / ${money(summary.lots_total)}`;
    return 'Not paid';
  }

  function paymentStatusClass(summary) {
    if (summary.payment_status === 'paid_in_full') return 'badge-paid';
    if (summary.payment_status === 'part_paid') return 'badge-part-paid';
    return 'badge-not-paid';
  }

  function getBidderLastUpdate(items, extraRows = []) {
    const timestamps = [...items, ...extraRows]
      .map(item => item?.last_bid_update || '')
      .filter(Boolean)
      .sort();
    return timestamps.length > 0 ? timestamps[timestamps.length - 1] : '';
  }

  function getBidderSortRank(meta, bidder) {
    if (bucketSortOrder === 'paddle') {
      return { primary: Number(bidder), secondary: 0 };
    }

    if (bucketSortOrder === 'ready_state') {
      const readyRank = meta.readyMeta.invalidated ? 0 : (meta.readyMeta.ready ? 2 : 1);
      const recentRank = meta.bucketEffects?.hasTimedChange ? 0 : 1;
      return { primary: readyRank, secondary: recentRank };
    }

    if (bucketSortOrder === 'last_paid') {
      return { primary: meta.lastPaidAt || '', secondary: Number(bidder) };
    }

    return { primary: meta.lastUpdate || '', secondary: Number(bidder) };
  }

  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken
      },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || `Request failed (${res.status})`);
    }
    return res.json().catch(() => ({}));
  }

  async function downloadUncollectedCsv() {
    const auctionId = getActiveAuctionId();
    if (!auctionId) {
      throw new Error('Please select an auction first');
    }

    const res = await fetch(`${API}/${auctionId}/uncollected.csv`, {
      headers: { Authorization: authToken }
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || 'CSV fetch failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uncollected-auction-${auctionId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function setBidderReady(summary, ready, fingerprint) {
    const auctionId = getActiveAuctionId();
    if (!auctionId) throw new Error('Please select an auction first');

    await apiPost(`${API}/${auctionId}/bidders/${summary.bidder_id}/ready`, {
      ready,
      fingerprint
    });
    if (ready) invalidatedChangesByBidder.delete(String(summary.bidder_id));
    void poll({ force: true, reschedule: true });
  }

  async function setItemCollected(item, collected) {
    const auctionId = getActiveAuctionId();
    if (!auctionId) throw new Error('Please select an auction first');

    await apiPost(`${API}/${auctionId}/items/${item.id}/collection`, { collected });
    void poll({ force: true, reschedule: true });
  }

  async function collectAll(summary) {
    const auctionId = getActiveAuctionId();
    if (!auctionId) throw new Error('Please select an auction first');

    await apiPost(`${API}/${auctionId}/bidders/${summary.bidder_id}/collect-all`, {});
    invalidatedChangesByBidder.delete(String(summary.bidder_id));
    void poll({ force: true, reschedule: true });
  }

  function renderRecentActivity(soldRows, filterValue) {
    els.recentBody.innerHTML = '';
    const visibleItems = getRecentSales(soldRows, filterValue);
    if (visibleItems.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'empty-cell';
      td.textContent = 'No sold items found for the current filter.';
      tr.appendChild(td);
      els.recentBody.appendChild(tr);
      return;
    }

    visibleItems.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = 'recent-sale-row';
      if (item.photo) tr.dataset.photoUrl = item.photo;

      const description = item.test_item ? `${item.description} [T]` : item.description;
      const price = item.test_bid ? `${money(item.price)} [T]` : money(item.price);

      [bidderDisplayLabel(item), item.lot ?? '', description, price].forEach(value => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      els.recentBody.appendChild(tr);
    });
  }

  function renderUnsold(rows) {
    els.unsoldBody.innerHTML = '';
    const visible = rows.slice().sort((a, b) => Number(a.lot) - Number(b.lot));

    els.unsoldSection.hidden = !els.chkUnsold.checked;
    els.unsoldEmpty.hidden = visible.length > 0;
    if (!els.chkUnsold.checked) return;

    visible.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = 'unsold-row';
      if (item.photo) tr.dataset.photoUrl = item.photo;

      const lotCell = document.createElement('td');
      lotCell.textContent = item.lot ?? '';

      const descCell = document.createElement('td');
      descCell.textContent = item.description ?? '';

      tr.append(lotCell, descCell);
      els.unsoldBody.appendChild(tr);
    });
  }

  function createBidderGroup(summary, items, readyMeta, bucketEffects) {
    const group = document.createElement('section');
    group.className = 'bidder-group';
    if (readyMeta.ready) group.classList.add('is-ready');
    if (readyMeta.invalidated) group.classList.add('is-invalidated');
    if (bucketEffects.hasTimedChange) group.classList.add('has-recent-activity');
    if (bucketEffects.hasAdded) group.classList.add('has-added-change');
    if (bucketEffects.hasRetracted) group.classList.add('has-retracted-change');

    const liveItems = items.filter(item => item.changeType !== 'retracted');
    const retractedCount = items.length - liveItems.length;
    const total = liveItems.reduce((sum, item) => sum + Number(item.price || 0), 0);

    const header = document.createElement('div');
    header.className = 'bidder-group-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'bidder-group-title';

    const heading = document.createElement('h3');
    heading.textContent = bidderDisplayLabel(summary, { prefix: true });

    const meta = document.createElement('div');
    meta.className = 'bidder-group-meta';

    const summaryLine = document.createElement('div');
    summaryLine.textContent = retractedCount > 0
      ? `${liveItems.length} live - ${retractedCount} retracted - ${money(total)}`
      : `${liveItems.length} item${liveItems.length === 1 ? '' : 's'} - ${money(total)}`;

    const fingerprintLine = document.createElement('div');
    fingerprintLine.textContent = summary.current_fingerprint
      ? `Fingerprint ${summary.current_fingerprint}`
      : 'Fingerprint unavailable';

    meta.append(summaryLine, fingerprintLine);
    titleWrap.append(heading, meta);

    const badges = document.createElement('div');
    badges.className = 'bidder-badges';

    const paymentBadge = document.createElement('span');
    paymentBadge.className = `badge ${paymentStatusClass(summary)}`;
    paymentBadge.textContent = paymentStatusLabel(summary);
    badges.appendChild(paymentBadge);

    if (summary.collected_count > 0) {
      const collectedBadge = document.createElement('span');
      collectedBadge.className = 'badge badge-collected';
      collectedBadge.textContent = `${summary.collected_count}/${summary.item_count} collected`;
      badges.appendChild(collectedBadge);
    }

    if (bucketEffects.hasTimedChange) {
      const newBadge = document.createElement('span');
      newBadge.className = 'badge badge-recent';
      newBadge.textContent = 'New activity';
      badges.appendChild(newBadge);
    }

    if (bucketEffects.hasAdded) {
      const addedBadge = document.createElement('span');
      addedBadge.className = 'badge badge-added';
      addedBadge.textContent = 'New item';
      badges.appendChild(addedBadge);
    }

    if (bucketEffects.hasRetracted) {
      const retractedBadge = document.createElement('span');
      retractedBadge.className = 'badge badge-retracted';
      retractedBadge.textContent = 'Bid retracted';
      badges.appendChild(retractedBadge);
    }

    if (readyMeta.ready) {
      const readyBadge = document.createElement('span');
      readyBadge.className = 'badge badge-ready';
      readyBadge.textContent = 'Ready for collection';
      badges.appendChild(readyBadge);
    }

    if (readyMeta.invalidated) {
      const invalidBadge = document.createElement('span');
      invalidBadge.className = 'badge badge-invalid';
      invalidBadge.textContent = 'Ready invalidated';
      badges.appendChild(invalidBadge);
    }

    const actionWrap = document.createElement('div');
    actionWrap.className = 'bucket-actions';

    const readyLabel = document.createElement('label');
    readyLabel.className = 'ready-toggle';

    const readyCheckbox = document.createElement('input');
    readyCheckbox.type = 'checkbox';
    readyCheckbox.checked = readyMeta.ready;
    readyCheckbox.addEventListener('change', () => {
      const nextReady = readyCheckbox.checked;
      readyCheckbox.disabled = true;
      void setBidderReady(summary, nextReady, summary.current_fingerprint).catch(error => {
        notify(error.message, 'error');
        readyCheckbox.checked = !nextReady;
        readyCheckbox.disabled = false;
      });
    });

    const readyText = document.createElement('span');
    readyText.textContent = 'Ready';
    readyLabel.append(readyCheckbox, readyText);

    const collectAllButton = document.createElement('button');
    collectAllButton.type = 'button';
    collectAllButton.className = 'action-btn';
    collectAllButton.textContent = summary.all_collected ? 'All collected' : 'Collect all';
    collectAllButton.disabled = !summary.can_collect || summary.all_collected;
    collectAllButton.title = summary.can_collect
      ? 'Mark every item in this bucket as collected'
      : 'Collection requires settlement mode and a nonzero payment';
    collectAllButton.addEventListener('click', () => {
      collectAllButton.disabled = true;
      void collectAll(summary).catch(error => {
        notify(error.message, 'error');
        collectAllButton.disabled = false;
      });
    });

    actionWrap.append(readyLabel, collectAllButton);
    header.append(titleWrap, badges, actionWrap);
    group.appendChild(header);

    if (readyMeta.invalidated) {
      const alert = document.createElement('div');
      alert.className = 'bidder-alert';
      alert.textContent = 'This bucket changed after being marked ready.';
      group.appendChild(alert);
    }

    const table = document.createElement('table');
    table.className = 'datatable bidder-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Lot</th><th>Title</th><th>Price</th><th>Pickup</th></tr>';

    const tbody = document.createElement('tbody');
    items
      .slice()
      .sort((a, b) => {
        const lotDiff = Number(a.lot) - Number(b.lot);
        if (lotDiff !== 0) return lotDiff;
        if (a.changeType === b.changeType) return 0;
        return a.changeType === 'retracted' ? 1 : -1;
      })
      .forEach(item => {
        const tr = document.createElement('tr');
        if (item.photo) tr.dataset.photoUrl = item.photo;
        if (item.changeType === 'added') tr.classList.add('item-row-added');
        if (item.changeType === 'retracted') tr.classList.add('item-row-retracted');
        if (item.collected_at) tr.classList.add('item-row-collected');

        const lotCell = document.createElement('td');
        lotCell.textContent = item.lot ?? '';

        const descCell = document.createElement('td');
        descCell.textContent = item.test_item ? `${item.description} [T]` : item.description;

        const priceCell = document.createElement('td');
        priceCell.textContent = item.test_bid ? `${money(item.price)} [T]` : money(item.price);

        const pickupCell = document.createElement('td');
        pickupCell.className = 'pickup-cell';
        if (item.changeType === 'retracted') {
          pickupCell.textContent = '';
        } else {
          const pickupToggle = document.createElement('input');
          pickupToggle.type = 'checkbox';
          pickupToggle.className = 'pickup-toggle';
          pickupToggle.checked = Boolean(item.collected_at);
          pickupToggle.disabled = !summary.can_collect;
          pickupToggle.title = summary.can_collect
            ? 'Mark this item as collected'
            : 'Collection requires settlement mode and a nonzero payment';
          pickupToggle.addEventListener('change', () => {
            const nextCollected = pickupToggle.checked;
            pickupToggle.disabled = true;
            void setItemCollected(item, nextCollected).catch(error => {
              notify(error.message, 'error');
              pickupToggle.checked = !nextCollected;
              pickupToggle.disabled = false;
            });
          });
          pickupCell.appendChild(pickupToggle);
        }

        tr.append(lotCell, descCell, priceCell, pickupCell);
        tbody.appendChild(tr);
      });

    table.append(thead, tbody);
    group.appendChild(table);

    const pictureItems = liveItems.filter(item => item.photo);
    if (showPictures && pictureItems.length) {
      const previewStrip = document.createElement('div');
      previewStrip.className = 'bucket-preview-strip';

      pictureItems.slice(0, 8).forEach(item => {
        const figure = document.createElement('figure');
        figure.className = 'bucket-preview-thumb';
        figure.innerHTML = `
          <img src="${API_ROOT}/uploads/preview_${item.photo}" alt="Lot ${item.lot} preview" loading="lazy">
          <figcaption>Lot ${item.lot}</figcaption>`;
        previewStrip.appendChild(figure);
      });

      const extraCount = pictureItems.length - Math.min(pictureItems.length, 8);
      if (extraCount > 0) {
        const more = document.createElement('div');
        more.className = 'bucket-preview-thumb bucket-preview-thumb-more';
        more.textContent = `+${extraCount} more`;
        previewStrip.appendChild(more);
      }

      group.appendChild(previewStrip);
    }

    return group;
  }

  function buildViewModel() {
    const filterValue = els.filterInput?.value.trim() || '';
    const soldRows = lastPayload.sold || [];
    const unsoldRows = lastPayload.unsold || [];
    const bidderSummaryMap = new Map((lastPayload.bidders || []).map(summary => [Number(summary.bidder_id), summary]));
    const allBidderMap = new Map();
    soldRows.forEach(row => {
      const bidderId = Number(row.bidder_id);
      if (!Number.isFinite(bidderId)) return;
      if (!allBidderMap.has(bidderId)) allBidderMap.set(bidderId, []);
      allBidderMap.get(bidderId).push(row);
    });

    const activeEffects = Array.from(getActiveItemEffects().values());
    const timedChangesByBidder = new Map();
    activeEffects.forEach(effect => {
      const bidderId = Number(effect.snapshot?.bidder_id);
      if (!Number.isFinite(bidderId)) return;
      if (!timedChangesByBidder.has(bidderId)) {
        timedChangesByBidder.set(bidderId, { addedRowIds: [], retractedRows: [] });
      }
      if (effect.type === 'added') timedChangesByBidder.get(bidderId).addedRowIds.push(String(effect.rowid));
      if (effect.type === 'retracted') {
        timedChangesByBidder.get(bidderId).retractedRows.push({ ...effect.snapshot, changeType: 'retracted' });
      }
    });

    const bidderMeta = new Map();
    const allBidderIds = new Set([
      ...allBidderMap.keys(),
      ...timedChangesByBidder.keys(),
      ...bidderSummaryMap.keys()
    ]);

    allBidderIds.forEach(bidderId => {
      const summary = bidderSummaryMap.get(bidderId);
      if (!summary) return;
      const items = allBidderMap.get(bidderId) || [];
      const fingerprint = summary.current_fingerprint || '';
      const timedChanges = timedChangesByBidder.get(bidderId) || { addedRowIds: [], retractedRows: [] };
      const backendReady = Boolean(summary.ready_for_collection);
      const invalidated = backendReady && summary.ready_fingerprint && summary.ready_fingerprint !== fingerprint;

      let persistentInvalidation = invalidatedChangesByBidder.get(String(bidderId)) || { addedRowIds: [], retractedRows: [] };
      if (invalidated) {
        persistentInvalidation = mergeInvalidatedChanges(persistentInvalidation, timedChanges);
        invalidatedChangesByBidder.set(String(bidderId), persistentInvalidation);
      } else {
        invalidatedChangesByBidder.delete(String(bidderId));
        persistentInvalidation = { addedRowIds: [], retractedRows: [] };
      }

      const combinedChanges = invalidated
        ? mergeInvalidatedChanges(timedChanges, persistentInvalidation)
        : timedChanges;
      const combinedAdded = new Set((combinedChanges.addedRowIds || []).map(String));
      const timedAdded = new Set((timedChanges.addedRowIds || []).map(String));
      const retractedRows = new Map();
      (combinedChanges.retractedRows || []).forEach(row => {
        if (!row?.rowid) return;
        retractedRows.set(String(row.rowid), { ...row, changeType: 'retracted' });
      });

      const displayRows = items.map(row => ({
        ...row,
        changeType: combinedAdded.has(String(row.rowid)) ? 'added' : null
      }));
      retractedRows.forEach(row => displayRows.push(row));

      const liveCount = items.length;
      const visibleByFilter = !filterValue || summary.bidder === Number(filterValue);
      const visibleByCount = !showMultiItemBucketsOnly || liveCount > 1;
      const bucketEffects = {
        hasAdded: combinedAdded.size > 0,
        hasRetracted: retractedRows.size > 0,
        hasTimedChange: timedAdded.size > 0 || (timedChanges.retractedRows || []).length > 0
      };

      bidderMeta.set(bidderId, {
        summary,
        fingerprint,
        readyMeta: {
          ready: backendReady && !invalidated,
          invalidated
        },
        bucketEffects,
        displayRows,
        visible: visibleByFilter && visibleByCount && displayRows.length > 0,
        lastUpdate: getBidderLastUpdate(items, [...retractedRows.values()]),
        lastPaidAt: summary.last_paid_at || ''
      });
    });

    return {
      filterValue,
      soldRows,
      unsoldRows,
      bidderMeta
    };
  }

  function render() {
    const { filterValue, soldRows, unsoldRows, bidderMeta } = buildViewModel();
    const visibleBidderIds = Array.from(bidderMeta.keys()).filter(bidderId => bidderMeta.get(bidderId).visible);

    visibleBidderIds.sort((a, b) => {
      const metaA = bidderMeta.get(a);
      const metaB = bidderMeta.get(b);
      const rankA = getBidderSortRank(metaA, metaA.summary.bidder);
      const rankB = getBidderSortRank(metaB, metaB.summary.bidder);

      if (bucketSortOrder === 'paddle') return rankA.primary - rankB.primary;

      if (bucketSortOrder === 'ready_state') {
        if (rankA.primary !== rankB.primary) return rankA.primary - rankB.primary;
        if (rankA.secondary !== rankB.secondary) return rankA.secondary - rankB.secondary;
        const timeA = metaA.lastUpdate || '';
        const timeB = metaB.lastUpdate || '';
        if (timeA !== timeB) return timeA < timeB ? 1 : -1;
        return metaA.summary.bidder - metaB.summary.bidder;
      }

      if (rankA.primary !== rankB.primary) return rankA.primary < rankB.primary ? 1 : -1;
      return metaA.summary.bidder - metaB.summary.bidder;
    });

    els.bidderGroups.innerHTML = '';
    els.bidderSummary.textContent = `${visibleBidderIds.length} bidder group${visibleBidderIds.length === 1 ? '' : 's'} shown`;

    if (visibleBidderIds.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      if (filterValue) {
        empty.textContent = `No sold items found for paddle ${filterValue}.`;
      } else if (showMultiItemBucketsOnly) {
        empty.textContent = 'No multi-item buckets are currently shown.';
      } else {
        empty.textContent = 'No sold items to collate yet.';
      }
      els.bidderGroups.appendChild(empty);
    } else {
      visibleBidderIds.forEach(bidderId => {
        const meta = bidderMeta.get(bidderId);
        els.bidderGroups.appendChild(
          createBidderGroup(
            meta.summary,
            meta.displayRows,
            meta.readyMeta,
            meta.bucketEffects
          )
        );
      });
    }

    renderRecentActivity(soldRows, filterValue);
    renderUnsold(filterValue ? unsoldRows.filter(row => Number(filterValue) === Number(row.bidder)) : unsoldRows);
  }

  async function poll({ force = false, reschedule = false } = {}) {
    const auctionId = getActiveAuctionId();
    if (!auctionId) {
      setStatus(false);
      return;
    }

    if (pollInFlight) {
      if (force) setNextRefresh(1000);
      return;
    }

    pollInFlight = true;
    if (els.refreshButton) els.refreshButton.disabled = true;
    if (els.uncollectedCsvButton) els.uncollectedCsvButton.disabled = true;
    nextRefreshAt = null;
    updateCountdown();

    try {
      const res = await fetch(`${API}/${auctionId}?unsold=${els.chkUnsold.checked}`, {
        headers: { 'Content-Type': 'application/json', Authorization: authToken }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const payload = await res.json();
      lastPayload = {
        sold: Array.isArray(payload?.sold) ? payload.sold : [],
        unsold: Array.isArray(payload?.unsold) ? payload.unsold : [],
        bidders: Array.isArray(payload?.bidders) ? payload.bidders : [],
        auction_status: payload?.auction_status || ''
      };
      if (lastPayload.auction_status) {
        currentAuction.status = lastPayload.auction_status;
        updateAuctionStatusPills(lastPayload.auction_status);
        updateAuctionOptionLabel(currentAuction);
        syncGoActionAvailability();
      }
      updateItemEffects(lastPayload.sold);
      render();
      setStatus(true);
      resetStale();
    } catch {
      setStatus(false);
    } finally {
      pollInFlight = false;
      if (els.refreshButton) els.refreshButton.disabled = false;
      if (els.uncollectedCsvButton) els.uncollectedCsvButton.disabled = false;
      if (reschedule && document.visibilityState === 'visible') {
        setNextRefresh(REFRESH_MS);
      } else if (document.visibilityState !== 'visible') {
        nextRefreshAt = null;
        updateCountdown();
      }
    }
  }

  async function loadAuctions() {
    try {
      auctions = await fetchAuctions();
      populateAuctionSelect();
    } catch (error) {
      updateAuctionStatusPills();
      syncGoActionAvailability();
      notify(error.message || 'Could not load auctions', 'error');
    }
  }

  function bindEvents() {
    els.auctionSelect?.addEventListener('change', () => {
      closeMenuGroups();
      const selectedAuction = getAuctionById(Number(els.auctionSelect.value));
      if (!selectedAuction) return;
      saveLiveFeedPreferences({ selected_auction_id: Number(selectedAuction.id) });
      window.location.assign(buildLiveFeedUrl(selectedAuction));
    });

    els.applyFilter?.addEventListener('click', () => {
      closeMenuGroups();
      saveLiveFeedPreferences({ filter: els.filterInput?.value.trim() || '' });
      render();
      void poll({ reschedule: true });
    });

    els.refreshButton?.addEventListener('click', () => {
      closeMenuGroups();
      void poll({ force: true, reschedule: true });
    });

    els.uncollectedCsvButton?.addEventListener('click', () => {
      closeMenuGroups();
      void downloadUncollectedCsv().catch(error => notify(error.message, 'error'));
    });

    els.chkUnsold?.addEventListener('change', () => {
      saveLiveFeedPreferences({ show_unsold: Boolean(els.chkUnsold.checked) });
      render();
      void poll({ reschedule: true });
    });

    els.changePersistInput?.addEventListener('change', () => {
      changePersistMs = parseDurationInput(els.changePersistInput.value);
      saveLiveFeedPreferences({ change_persist_seconds: Math.round(changePersistMs / 1000) });
      syncInputs();
      retimeActiveEffects();
      render();
    });

    els.bucketSortOrderInput?.addEventListener('change', () => {
      bucketSortOrder = els.bucketSortOrderInput.value;
      saveLiveFeedPreferences({ bucket_sort_order: bucketSortOrder });
      syncInputs();
      render();
    });

    els.showPicturesInput?.addEventListener('change', () => {
      showPictures = Boolean(els.showPicturesInput.checked);
      saveLiveFeedPreferences({ show_pictures: showPictures });
      syncInputs();
      render();
    });

    els.showMultiItemBucketsOnlyInput?.addEventListener('change', () => {
      showMultiItemBucketsOnly = Boolean(els.showMultiItemBucketsOnlyInput.checked);
      saveLiveFeedPreferences({ show_multi_item_buckets_only: showMultiItemBucketsOnly });
      syncInputs();
      render();
    });

    els.filterInput?.addEventListener('change', () => {
      saveLiveFeedPreferences({ filter: els.filterInput?.value.trim() || '' });
    });

    els.filterInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        closeMenuGroups();
        saveLiveFeedPreferences({ filter: els.filterInput?.value.trim() || '' });
        render();
        void poll({ reschedule: true });
      }
    });

    els.goPublicBtn?.addEventListener('click', () => {
      openUrlInNewTab(buildPublicUrl(currentAuction));
    });

    els.goAdminBtn?.addEventListener('click', () => {
      openUrlInSameWindow(buildAdminUrl(currentAuction));
    });

    els.goCashierBtn?.addEventListener('click', () => {
      openUrlInSameWindow(buildCashierUrl(currentAuction));
    });

    els.changePwBtn?.addEventListener('click', () => {
      void handlePasswordChange();
    });

    els.logoutBtn?.addEventListener('click', () => {
      closeMenuGroups();
      logout();
    });

    els.openAboutModalBtn?.addEventListener('click', openAboutModal);
    els.closeAboutModalBtn?.addEventListener('click', closeAboutModal);
    els.aboutModal?.addEventListener('click', event => {
      if (event.target === els.aboutModal) closeAboutModal();
    });

    menuGroups.forEach(menu => {
      menu.addEventListener('toggle', () => {
        if (menu.open) closeMenuGroups(menu);
      });
    });

    document.addEventListener('click', event => {
      if (!event.target.closest('.menu-group')) closeMenuGroups();
    });

    document.querySelectorAll('.menu-item-link, .menu-item-button').forEach(element => {
      element.addEventListener('click', () => {
        if (!element.disabled) closeMenuGroups();
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void poll({ reschedule: true });
        return;
      }
      if (refreshTimer) clearTimeout(refreshTimer);
      nextRefreshAt = null;
      updateCountdown();
    });
  }

  bindEvents();
  syncInputs();
  updateAuctionStatusPills();
  syncGoActionAvailability();

  const session = await getSessionToken();
  if (!session) {
    alert('Session expired. Please log in again.');
    return;
  }

  authToken = session.token;
  setSessionMeta(session.data.user, session.data.versions);
  await loadAuctions();

  if (typeof initPhotoHoverPopup === 'function') {
    initPhotoHoverPopup({
      container: document.body,
      delayMs: 1000,
      maxSize: 220,
      getUrl: tr => (tr.dataset.photoUrl ? `${API_ROOT}/uploads/preview_${tr.dataset.photoUrl}` : null)
    });
  }

  startCountdown();
  void poll({ reschedule: true });
})();
