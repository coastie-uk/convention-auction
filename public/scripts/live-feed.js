// live-feed.js
// ---------------------------------------------------------------------------
// Cashier live feed focused on two jobs:
// 1. Show newly sold items that need immediate attention.
// 2. Keep collection assembly stable by grouping sold items by bidder.
// ---------------------------------------------------------------------------

(async () => {
  const API_ROOT = '/api';
  const API = `${API_ROOT}/cashier/live`;
  const VALIDATE = `${API_ROOT}/validate`;
  const params = new URLSearchParams(location.search);
  const AUCTION_ID = Number(params.get('auctionId'));
  const AUCTION_STATUS = (params.get('auctionStatus') || '').toLowerCase();
  const currencySymbol = localStorage.getItem('currencySymbol') || '£';
  const REFRESH_MS = AUCTION_STATUS === 'live' ? 5000 : 60000;
  const READY_STORAGE_KEY = `live-feed-ready:${AUCTION_ID}`;
  const RECENT_ACTIVITY_LIMIT = 12;

  if (!Number.isInteger(AUCTION_ID) || AUCTION_ID <= 0) {
    alert('This page must be opened with ?auctionId=<number>');
    return;
  }

  const statusEl = document.getElementById('status');
  const chkUnsold = document.getElementById('showUnsold');
  const applyFilter = document.getElementById('btnApply');
  const refreshButton = document.getElementById('btnRefresh');
  const countdownEl = document.getElementById('refreshCountdown');
  const filterInput = document.getElementById('filter');
  const changePersistInput = document.getElementById('changePersistSeconds');
  const bucketSortOrderInput = document.getElementById('bucketSortOrder');
  const showMultiItemBucketsOnlyInput = document.getElementById('showMultiItemBucketsOnly');
  const recentBody = document.querySelector('#recentFeed tbody');
  const bidderGroupsEl = document.getElementById('bidderGroups');
  const bidderSummaryEl = document.getElementById('bidderSummary');
  const unsoldSectionEl = document.getElementById('unsoldSection');
  const unsoldBody = document.querySelector('#unsoldFeed tbody');
  const unsoldEmptyEl = document.getElementById('unsoldEmpty');

  let staleTimer = null;
  let refreshTimer = null;
  let countdownTimer = null;
  let effectTimer = null;
  let nextRefreshAt = null;
  let pollInFlight = false;
  let soldSnapshotReady = false;
  let lastSoldRowsById = new Map();
  let itemEffects = new Map();
  let readyState = loadReadyState();
  let changePersistMs = loadChangePersistMs();
  let bucketSortOrder = loadBucketSortOrder();
  let showMultiItemBucketsOnly = loadShowMultiItemBucketsOnly();

  const money = value => `${currencySymbol}${Number(value || 0).toFixed(2)}`;
  const escapeHtml = value =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  const setStatus = ok => {
    statusEl.textContent = ok ? 'Updated' : 'Stale';
    statusEl.className = ok ? 'ok' : 'stale';
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
  //    countdownEl.textContent = 'Next refresh: --';
      return;
    }

  //  const msRemaining = nextRefreshAt - Date.now();
  //  countdownEl.textContent = msRemaining <= 0
  //    ? 'Refreshing...'
  //    : `Next refresh: ${formatCountdown(msRemaining)}`;
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
  function parseDurationInput(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 15000;
  }

  function loadReadyState() {
    try {
      const raw = localStorage.getItem(READY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveReadyState() {
    localStorage.setItem(READY_STORAGE_KEY, JSON.stringify(readyState));
  }

  function loadChangePersistMs() {
    const raw = localStorage.getItem('live-feed-change-persist-seconds');
    return parseDurationInput(raw || '15');
  }

  function loadBucketSortOrder() {
    const raw = localStorage.getItem('live-feed-bucket-sort-order');
    if (raw === 'paddle' || raw === 'ready_state' || raw === 'last_update') return raw;
    return 'last_update';
  }

  function loadShowMultiItemBucketsOnly() {
    return localStorage.getItem('live-feed-show-multi-item-buckets-only') === 'true';
  }

  function saveChangePersistMs() {
    localStorage.setItem('live-feed-change-persist-seconds', String(Math.round(changePersistMs / 1000)));
  }

  function saveBucketSortOrder() {
    localStorage.setItem('live-feed-bucket-sort-order', bucketSortOrder);
  }

  function saveShowMultiItemBucketsOnly() {
    localStorage.setItem('live-feed-show-multi-item-buckets-only', String(showMultiItemBucketsOnly));
  }

  function syncChangePersistInput() {
    if (changePersistInput) {
      changePersistInput.value = String(Math.round(changePersistMs / 1000));
    }
  }

  function syncBucketSortOrderInput() {
    if (bucketSortOrderInput) {
      bucketSortOrderInput.value = bucketSortOrder;
    }
  }

  function syncShowMultiItemBucketsOnlyInput() {
    if (showMultiItemBucketsOnlyInput) {
      showMultiItemBucketsOnlyInput.checked = showMultiItemBucketsOnly;
    }
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
      renderCollation(lastRows);
      scheduleEffectRefresh();
    }, Math.max(0, nextExpiry - Date.now()) + 20);
  }

  function retimeActiveEffects() {
    const now = Date.now();
    for (const effect of itemEffects.values()) {
      effect.expiresAt = effect.startedAt + changePersistMs;
      if (effect.expiresAt <= now) {
        itemEffects.delete(effect.rowid);
      }
    }
    scheduleEffectRefresh();
  }

  function resetStale() {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => setStatus(false), REFRESH_MS * 1.5);
  }

  async function validateToken(tok) {
    if (!tok) return false;
    try {
      const res = await fetch(VALIDATE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: tok
        },
        body: JSON.stringify({ token: tok })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function getSessionToken() {
    const cashierTok = localStorage.getItem('cashierToken');
    if (await validateToken(cashierTok)) return cashierTok;

    const genericTok = localStorage.getItem('token');
    if (await validateToken(genericTok)) return genericTok;

    return null;
  }

  const token = await getSessionToken();
  if (!token) {
    alert('Session expired. Please log in again.');
    throw new Error('no valid token');
  }

  applyFilter.addEventListener('click', () => {
    void poll({ reschedule: true });
  });

  refreshButton?.addEventListener('click', () => {
    void poll({ force: true, reschedule: true });
  });

  chkUnsold.onchange = () => {
    void poll({ reschedule: true });
  };

  changePersistInput?.addEventListener('change', () => {
    changePersistMs = parseDurationInput(changePersistInput.value);
    saveChangePersistMs();
    syncChangePersistInput();
    retimeActiveEffects();
    renderCollation(lastRows);
  });

  bucketSortOrderInput?.addEventListener('change', () => {
    bucketSortOrder = bucketSortOrderInput.value;
    saveBucketSortOrder();
    syncBucketSortOrderInput();
    renderCollation(lastRows);
  });

  showMultiItemBucketsOnlyInput?.addEventListener('change', () => {
    showMultiItemBucketsOnly = Boolean(showMultiItemBucketsOnlyInput.checked);
    saveShowMultiItemBucketsOnly();
    syncShowMultiItemBucketsOnlyInput();
    renderCollation(lastRows);
  });

  syncChangePersistInput();
  syncBucketSortOrderInput();
  syncShowMultiItemBucketsOnlyInput();

  filterInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      void poll({ reschedule: true });
    }
  });

  if (typeof initPhotoHoverPopup === 'function') {
    initPhotoHoverPopup({
      container: document.body,
      delayMs: 1000,
      maxSize: 220,
      getUrl: tr => tr.dataset.photoUrl ? `${API_ROOT}/uploads/preview_${tr.dataset.photoUrl}` : null
    });
  }

  function createRow(item) {
    const tr = document.createElement('tr');
    const price = item.price != null ? money(item.price) : '';
    const description = item.test_item != null ? `${item.description} [T]` : item.description;
    const priceText = item.test_bid != null && price ? `${price} [T]` : price;

    tr.dataset.rowid = String(item.rowid);
    if (item.photo) tr.dataset.photoUrl = item.photo;

    const paddleCell = document.createElement('td');
    paddleCell.textContent = item.bidder ?? '';

    const lotCell = document.createElement('td');
    lotCell.textContent = item.lot ?? '';

    const descCell = document.createElement('td');
    descCell.textContent = description;

    const priceCell = document.createElement('td');
    priceCell.textContent = priceText;

    tr.append(paddleCell, lotCell, descCell, priceCell);
    return tr;
  }

  function createRecentRow(item) {
    const tr = createRow(item);
    tr.className = 'recent-sale-row';
    return tr;
  }

  function getRecentSales(rows, filterValue = '') {
    return rows
      .filter(row => !row.unsold && row.bidder != null)
      .filter(row => !filterValue || Number(filterValue) === Number(row.bidder))
      .sort((a, b) => {
        const timeA = a.last_bid_update || '';
        const timeB = b.last_bid_update || '';
        if (timeA === timeB) return Number(b.rowid) - Number(a.rowid);
        return timeA < timeB ? 1 : -1;
      })
      .slice(0, RECENT_ACTIVITY_LIMIT);
  }

  function updateItemEffects(rows) {
    const soldRows = rows.filter(row => !row.unsold && row.bidder != null);
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

  function getBidderFingerprint(items) {
    return items
      .slice()
      .sort((a, b) => Number(a.rowid) - Number(b.rowid))
      .map(item => `${item.rowid}:${item.lot}:${item.price ?? ''}`)
      .join('|');
  }

  function renderRecentActivity(rows, filterValue) {
    recentBody.innerHTML = '';

    const visibleItems = getRecentSales(rows, filterValue);
    if (visibleItems.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'empty-cell';
      td.textContent = 'No sold items found for the current filter.';
      tr.appendChild(td);
      recentBody.appendChild(tr);
      return;
    }

    visibleItems.forEach(item => {
      recentBody.appendChild(createRecentRow(item));
    });
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

  function updateReadyStateForBidder(bidder, fingerprint, changeSet = { addedRowIds: [], retractedRows: [] }) {
    const state = readyState[bidder];
    if (!state) return { ready: false, invalidated: false };

    if (state.ready && state.fingerprint !== fingerprint) {
      readyState[bidder] = {
        ready: false,
        fingerprint,
        invalidatedAt: new Date().toISOString(),
        invalidatedReason: 'This bidder changed after being marked ready.',
        invalidatedChanges: mergeInvalidatedChanges({}, changeSet)
      };
      saveReadyState();
      return {
        ready: false,
        invalidated: true,
        invalidatedChanges: readyState[bidder].invalidatedChanges
      };
    }

    if (state.invalidatedAt) {
      const mergedChanges = mergeInvalidatedChanges(state.invalidatedChanges, changeSet);
      const mergedChanged =
        JSON.stringify(mergedChanges.addedRowIds) !== JSON.stringify((state.invalidatedChanges?.addedRowIds || [])) ||
        JSON.stringify(mergedChanges.retractedRows.map(row => String(row.rowid))) !==
          JSON.stringify((state.invalidatedChanges?.retractedRows || []).map(row => String(row.rowid)));

      if (mergedChanged) {
        readyState[bidder] = {
          ...state,
          fingerprint,
          invalidatedChanges: mergedChanges
        };
        saveReadyState();
      }

      return {
        ready: false,
        invalidated: true,
        invalidatedChanges: readyState[bidder].invalidatedChanges || mergedChanges
      };
    }

    return {
      ready: Boolean(state.ready),
      invalidated: Boolean(state.invalidatedAt),
      invalidatedChanges: state.invalidatedChanges || { addedRowIds: [], retractedRows: [] }
    };
  }

  function setBidderReadyState(bidder, fingerprint, ready) {
    readyState[bidder] = ready
      ? {
          ready: true,
          fingerprint,
          invalidatedAt: null,
          invalidatedReason: null,
          invalidatedChanges: { addedRowIds: [], retractedRows: [] },
          updatedAt: new Date().toISOString()
        }
      : {
          ready: false,
          fingerprint,
          invalidatedAt: null,
          invalidatedReason: null,
          invalidatedChanges: { addedRowIds: [], retractedRows: [] },
          updatedAt: new Date().toISOString()
        };
    saveReadyState();
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

    const timeValue = meta.lastUpdate || '';
    return { primary: timeValue, secondary: Number(bidder) };
  }

  function createBidderGroup(bidder, items, isRecentBidder, fingerprint, readyMeta, bucketEffects) {
    const group = document.createElement('section');
    group.className = 'bidder-group';
    if (readyMeta.ready) group.classList.add('is-ready');
    if (readyMeta.invalidated) group.classList.add('is-invalidated');
    if (isRecentBidder) group.classList.add('has-recent-activity');
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
    heading.textContent = `Paddle ${bidder}`;

    const meta = document.createElement('div');
    meta.className = 'bidder-group-meta';
    meta.textContent = retractedCount > 0
      ? `${liveItems.length} live • ${retractedCount} retracted • ${money(total)}`
      : `${liveItems.length} item${liveItems.length === 1 ? '' : 's'} • ${money(total)}`;

    titleWrap.append(heading, meta);

    const badges = document.createElement('div');
    badges.className = 'bidder-badges';

    if (isRecentBidder) {
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

    const actions = document.createElement('label');
    actions.className = 'ready-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = readyMeta.ready;
    checkbox.addEventListener('change', () => {
      setBidderReadyState(bidder, fingerprint, checkbox.checked);
      renderCollation(lastRows);
    });

    const actionText = document.createElement('span');
    actionText.textContent = 'Ready for collection';
    actions.append(checkbox, actionText);

    header.append(titleWrap, badges, actions);
    group.appendChild(header);

    if (readyMeta.invalidated) {
      const alert = document.createElement('div');
      alert.className = 'bidder-alert';
      alert.textContent = 'This bucket changed after being marked ready';
      group.appendChild(alert);
    }

    const table = document.createElement('table');
    table.className = 'datatable bidder-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Lot</th><th>Title</th><th>Price</th></tr>';

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

        const lotCell = document.createElement('td');
        lotCell.textContent = item.lot ?? '';

        const descCell = document.createElement('td');
        descCell.textContent = item.test_item != null ? `${item.description} [T]` : item.description;

        const priceCell = document.createElement('td');
        priceCell.textContent = item.test_bid != null ? `${money(item.price)} [T]` : money(item.price);

        tr.append(lotCell, descCell, priceCell);
        tbody.appendChild(tr);
      });

    table.append(thead, tbody);
    group.appendChild(table);

    return group;
  }

  function renderUnsold(rows) {
    unsoldBody.innerHTML = '';
    const visible = rows.slice().sort((a, b) => Number(a.lot) - Number(b.lot));

    unsoldSectionEl.hidden = !chkUnsold.checked;
    unsoldEmptyEl.hidden = visible.length > 0;

    if (!chkUnsold.checked) return;

    visible.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = 'unsold-row';
      tr.dataset.rowid = String(item.rowid);
      if (item.photo) tr.dataset.photoUrl = item.photo;

      const lotCell = document.createElement('td');
      lotCell.textContent = item.lot ?? '';

      const descCell = document.createElement('td');
      descCell.textContent = item.description ?? '';

      tr.append(lotCell, descCell);
      unsoldBody.appendChild(tr);
    });
  }

  function renderCollation(rows) {
    const filterValue = filterInput?.value.trim() || '';
    const soldRows = rows.filter(row => !row.unsold && row.bidder != null);
    const unsoldRows = rows.filter(row => row.unsold);
    const allBidderMap = new Map();
    const bidderMap = new Map();
    const activeEffects = Array.from(getActiveItemEffects().values());
    const timedChangesByBidder = new Map();

    activeEffects.forEach(effect => {
      const bidder = Number(effect.snapshot?.bidder);
      if (!Number.isFinite(bidder)) return;
      if (!timedChangesByBidder.has(bidder)) {
        timedChangesByBidder.set(bidder, { addedRowIds: [], retractedRows: [] });
      }
      if (effect.type === 'added') {
        timedChangesByBidder.get(bidder).addedRowIds.push(String(effect.rowid));
      }
      if (effect.type === 'retracted') {
        timedChangesByBidder.get(bidder).retractedRows.push({ ...effect.snapshot, changeType: 'retracted' });
      }
    });

    const bucketEffectsByBidder = new Map();

    soldRows.forEach(row => {
      const bidder = Number(row.bidder);
      if (!allBidderMap.has(bidder)) allBidderMap.set(bidder, []);
      allBidderMap.get(bidder).push(row);
    });
    const bidderMeta = new Map();
    const allBidders = new Set([
      ...allBidderMap.keys(),
      ...timedChangesByBidder.keys(),
      ...Object.keys(readyState).map(Number).filter(Number.isFinite)
    ]);

    allBidders.forEach(bidder => {
      const items = allBidderMap.get(bidder) || [];
      const fingerprint = getBidderFingerprint(items);
      const timedChanges = timedChangesByBidder.get(bidder) || { addedRowIds: [], retractedRows: [] };
      const readyMeta = updateReadyStateForBidder(bidder, fingerprint, timedChanges);
      const persistentChanges = readyMeta.invalidated
        ? mergeInvalidatedChanges({}, readyMeta.invalidatedChanges)
        : { addedRowIds: [], retractedRows: [] };

      bidderMeta.set(bidder, {
        fingerprint,
        readyMeta,
        timedChanges,
        persistentChanges
      });
    });

    bidderMeta.forEach((meta, bidder) => {
      const combinedChanges = meta.readyMeta.invalidated
        ? mergeInvalidatedChanges(meta.timedChanges, meta.persistentChanges)
        : meta.timedChanges;
      const timedAdded = new Set((meta.timedChanges.addedRowIds || []).map(String));
      const combinedAdded = new Set((combinedChanges.addedRowIds || []).map(String));
      const retractedRows = new Map();

      [...(combinedChanges.retractedRows || [])].forEach(row => {
        if (!row?.rowid) return;
        retractedRows.set(String(row.rowid), { ...row, changeType: 'retracted' });
      });

      const bucketEffects = {
        hasAdded: combinedAdded.size > 0,
        hasRetracted: retractedRows.size > 0,
        hasTimedChange: timedAdded.size > 0 || (meta.timedChanges.retractedRows || []).length > 0
      };
      bucketEffectsByBidder.set(bidder, bucketEffects);
      meta.bucketEffects = bucketEffects;
      meta.lastUpdate = getBidderLastUpdate(allBidderMap.get(bidder) || [], [...retractedRows.values()]);

      const visibleByFilter = !filterValue || bidder === Number(filterValue);
      if (!visibleByFilter) return;

      const liveCount = (allBidderMap.get(bidder) || []).length;
      if (showMultiItemBucketsOnly && liveCount <= 1) return;

      const displayRows = (allBidderMap.get(bidder) || []).map(row => ({
        ...row,
        changeType: combinedAdded.has(String(row.rowid)) ? 'added' : null
      }));

      retractedRows.forEach(row => {
        displayRows.push(row);
      });

      if (displayRows.length > 0) bidderMap.set(bidder, displayRows);
    });

    const recentBidderSet = new Set(
      Array.from(bucketEffectsByBidder.entries())
        .filter(([, effects]) => effects.hasTimedChange)
        .map(([bidder]) => bidder)
    );
    const bidderNumbers = Array.from(bidderMap.keys()).sort((a, b) => {
      const metaA = bidderMeta.get(a);
      const metaB = bidderMeta.get(b);
      const rankA = getBidderSortRank(metaA, a);
      const rankB = getBidderSortRank(metaB, b);

      if (bucketSortOrder === 'paddle') {
        return rankA.primary - rankB.primary;
      }

      if (bucketSortOrder === 'ready_state') {
        if (rankA.primary !== rankB.primary) return rankA.primary - rankB.primary;
        if (rankA.secondary !== rankB.secondary) return rankA.secondary - rankB.secondary;
        const timeA = metaA?.lastUpdate || '';
        const timeB = metaB?.lastUpdate || '';
        if (timeA !== timeB) return timeA < timeB ? 1 : -1;
        return a - b;
      }

      if (rankA.primary !== rankB.primary) return rankA.primary < rankB.primary ? 1 : -1;
      return a - b;
    });

    bidderGroupsEl.innerHTML = '';
    bidderSummaryEl.textContent = `${bidderNumbers.length} bidder group${bidderNumbers.length === 1 ? '' : 's'} shown`;

    if (bidderNumbers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      if (filterValue) {
        empty.textContent = `No sold items found for paddle ${escapeHtml(filterValue)}.`;
      } else if (showMultiItemBucketsOnly) {
        empty.textContent = 'No multi-item buckets are currently shown.';
      } else {
        empty.textContent = 'No sold items to collate yet.';
      }
      bidderGroupsEl.appendChild(empty);
    } else {
      bidderNumbers.forEach(bidder => {
        const meta = bidderMeta.get(bidder);
        bidderGroupsEl.appendChild(
          createBidderGroup(
            bidder,
            bidderMap.get(bidder),
            recentBidderSet.has(bidder),
            meta.fingerprint,
            meta.readyMeta,
            bucketEffectsByBidder.get(bidder) || { hasAdded: false, hasRetracted: false }
          )
        );
      });
    }

    renderRecentActivity(soldRows, filterValue);
    renderUnsold(filterValue ? unsoldRows.filter(row => Number(filterValue) === Number(row.bidder)) : unsoldRows);
  }

  let lastRows = [];

  async function poll({ force = false, reschedule = false } = {}) {
    if (pollInFlight) {
      if (force) setNextRefresh(1000);
      return;
    }

    pollInFlight = true;
    if (refreshButton) refreshButton.disabled = true;
    nextRefreshAt = null;
    updateCountdown();

    try {
      const res = await fetch(`${API}/${AUCTION_ID}?unsold=${chkUnsold.checked}`, {
        headers: { 'Content-Type': 'application/json', Authorization: token }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const rows = await res.json();
      lastRows = Array.isArray(rows) ? rows : [];
      updateItemEffects(lastRows);
      renderCollation(lastRows);
      setStatus(true);
      resetStale();
    } catch {
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

  function startAutoRefresh() {
    startCountdown();
  }

  void poll({ reschedule: true });
  startAutoRefresh();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void poll({ reschedule: true });
      return;
    }

    if (refreshTimer) clearTimeout(refreshTimer);
    nextRefreshAt = null;
    updateCountdown();
  });
})();
