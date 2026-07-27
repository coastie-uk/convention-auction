
(()=>{
const API = "/api"

const API_ROOT = `${API}/settlement`;
  const POLL_MS  = 5000;
  const BUYER_DISPLAY_STATE_KEY = 'cashierBuyerDisplayState';
  let token = window.AppAuth?.getToken?.() || null;
  const cashierPreferences = window.AppAuth?.getAppliedPreferences?.().cashier || {};

  let bidders = [];
  let selBidder = null;
  let selectedBidderId = null;
  let showPictures = typeof cashierPreferences.show_pictures === 'boolean' ? cashierPreferences.show_pictures : true;

  const bidderBody = document.querySelector('#bidderTable tbody');
  const lotsBody   = document.querySelector('#lotsTable tbody');
  const payBody    = document.querySelector('#payTable tbody');
  const detailBox  = document.getElementById('detail');
  const emptyDetailEl = document.getElementById('emptyDetail');
  const lotsTotalEl = document.getElementById('lotsTotal');
  const lotsPreviewStripEl = document.getElementById('lotsPreviewStrip');
  const lotsSectionEl = document.getElementById('lotsSection');
  const paymentStateHintEl = document.getElementById('paymentStateHint');
  const auctionPendingPaymentsEl = document.getElementById('auctionPendingPayments');
  const bidderPendingPaymentsEl = document.getElementById('bidderPendingPayments');
  const titleEl    = document.getElementById('title');
  const fingerprintDisplay = document.getElementById('fingerprintDisplay');
  const toggleFingerprintBtn = document.getElementById('toggleFingerprintBtn');
  const printReceiptBtn = document.getElementById('printReceiptBtn');
  const editBidderNameBtn = document.getElementById('editBidderNameBtn');
  const currencySymbol = localStorage.getItem("currencySymbol") || "£";
  const money = v => `${currencySymbol}${Number(v).toFixed(2)}`;
  const roundCurrency = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const moneyFromMinor = value => money(Number(value || 0) / 100);
  const uploadBase = "/api/uploads";
  let currentUsername = 'unknown';
  let fingerprintVisible = false;
  let fetchBiddersInFlight = false;
  let bidderListRenderKey = '';
  let selectedBidderRenderKey = '';
  let pendingIntents = [];
  let pendingRefreshInFlight = false;
  let waitingModalEl = null;
  let waitingModalIntentId = null;
  let waitingModalStartedAt = 0;
  let waitingModalTimer = null;
  let waitingModalPollTimer = null;
  const receiptDateTime = value => new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const urlParams  = new URLSearchParams(location.search);
  const AUCTION_ID = Number(urlParams.get('auctionId'));
  const AUCTION_STATUS = (urlParams.get('auctionStatus') || '').toLowerCase();

  if (!Number.isInteger(AUCTION_ID) || AUCTION_ID <= 0) {
    showMessage('This page must be opened with ?auctionId=<number>', 'error');

    throw new Error('auctionId missing');     // halt script
  }

  if (typeof initPhotoHoverPopup === 'function') {
    initPhotoHoverPopup({
      container: lotsBody,
      delayMs: 1000,
      maxSize: 220,
      getUrl: tr => tr.dataset.photoUrl ? `${uploadBase}/preview_${tr.dataset.photoUrl}` : null
    });
  }



  function sortBidders(arr){
    return arr.slice().sort((a,b)=>{
      if(a.balance===0 && b.balance!==0) return 1;
      if(b.balance===0 && a.balance!==0) return -1;
      return a.paddle_number - b.paddle_number;
    });
  }

  async function fetchCurrentUsername() {
    if (!token) return;
    try {
      const res = await window.AppAuth.authenticatedFetch(`${API}/validate`, { method: 'POST' });
      if (!res.ok) return;
      const data = await res.json();
      currentUsername = data?.user?.username || currentUsername;
    } catch (_) {
      // username is a nicety for the receipt footer; keep fallback
    }
  }

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  // Photos created by normal uploads use UUIDs, while generated sample lots
  // use names such as resized_sample_1759353388675_30.jpg. Keep the basename
  // allowlist strict, but accept both app-generated formats.
  const SAFE_PHOTO_FILENAME = /^resized_[a-z0-9][a-z0-9_-]*\.jpg$/i;
  const safePhotoFilename = value => {
    const text = String(value ?? '').trim();
    return SAFE_PHOTO_FILENAME.test(text) ? text : '';
  };

  function appendTextCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value ?? '';
    row.appendChild(cell);
    return cell;
  }

  const truncateReceiptText = (value, max = 30) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  };

  const formatPaymentMethod = method => {
    switch (method) {
      case 'card-manual':
        return 'Card';
      case 'paypal-manual':
        return 'PayPal';
      case 'sumup-app':
        return 'SumUp reader';
      case 'sumup-web':
        return 'SumUp web';
      default:
        return String(method ?? '').replace(/-/g, ' ') || 'Payment';
    }
  };

  function getResolvedTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function getPaymentStatus(bidder) {
    const balance = roundCurrency(bidder?.balance || 0);
    const paymentsTotal = roundCurrency(bidder?.payments_total || 0);
    if (balance < 0) return 'overpaid';
    if (balance === 0) return 'paid';
    if (balance > 0 && paymentsTotal > 0) return 'part-paid';
    return 'unpaid';
  }

  function getPaymentStatusClass(bidder) {
    return `payment-state-${getPaymentStatus(bidder)}`;
  }

  function formatBidderLabel(bidder, { prefix = false } = {}) {
    const paddle = bidder?.paddle_number == null ? '' : String(bidder.paddle_number);
    const name = String(bidder?.bidder_name || bidder?.name || '').trim();
    const label = name ? `${paddle} - ${name}` : paddle;
    return prefix && label ? `Paddle #${label}` : label;
  }

  function getCashierAuctionName() {
    const currentAuctionPill = document.getElementById('current-auction-pill');
    const rawLabel = currentAuctionPill?.textContent || '';
    const label = rawLabel.replace(/^Auction:\s*/i, '').trim();
    if (label && label.toLowerCase() !== 'none selected') return label;
    return selBidder?.auction_name || selBidder?.auction_short_name || `Auction ${AUCTION_ID}`;
  }

  function getBuyerDisplayState() {
    return {
      auctionId: AUCTION_ID,
      auctionName: getCashierAuctionName(),
      theme: getResolvedTheme(),
      showPictures,
      selectedBidder: selBidder
        ? {
            paddle_number: selBidder.paddle_number,
            bidder_name: selBidder.bidder_name || selBidder.name || '',
            bidder_label: formatBidderLabel(selBidder, { prefix: true }),
            lots_total: Number(selBidder.lots_total || 0),
            payments_total: Number(selBidder.payments_total || 0),
            donations_total: Number(selBidder.donations_total || 0),
            balance: Number(selBidder.balance || 0),
            lots: Array.isArray(selBidder.lots)
              ? selBidder.lots.map((lot) => ({
                  item_number: lot.item_number,
                  description: lot.description,
                  hammer_price: Number(lot.hammer_price || 0),
                  photo_url: lot.photo_url || lot.photoUrl || lot.photo || ''
                }))
              : []
          }
        : null
    };
  }

  function persistBuyerDisplayState() {
    const state = getBuyerDisplayState();
    window.__cashierBuyerDisplayStateCurrent__ = state;
    if (typeof window.__cashierPushBuyerDisplayState__ === 'function') {
      window.__cashierPushBuyerDisplayState__(state);
      return;
    }
    try {
      localStorage.setItem(BUYER_DISPLAY_STATE_KEY, JSON.stringify(state));
    } catch (_) {
      // ignore storage failures
    }
  }

  window.__getCashierBuyerDisplayStateImpl__ = getBuyerDisplayState;
  window.__cashierBuyerDisplayStateCurrent__ = getBuyerDisplayState();

  function buildReceiptHtml(bidder, printedAt) {
    const auctionName = bidder.auction_name || bidder.auction_short_name || `Auction ${AUCTION_ID}`;
    const lots = Array.isArray(bidder.lots) ? bidder.lots : [];
    const payments = Array.isArray(bidder.payments) ? bidder.payments : [];
    const donationTotal = Number(bidder.donations_total || 0);
    const balance = roundCurrency(bidder.balance || 0);
    const fingerprint = bidder.fingerprint || '';
    const receiptBidderLabel = formatBidderLabel(bidder, { prefix: true });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Receipt ${escapeHtml(auctionName)} #${escapeHtml(bidder.paddle_number)}</title>
  <style>
    @page { size: 72mm auto; margin: 4mm; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { width: 64mm; font-family: "Arial Narrow", Arial, sans-serif; color: #000; font-size: 10pt; line-height: 1.25; }
    .receipt { width: 100%; }
    .center { text-align: center; }
    .auction-name { font-size: 11pt; font-weight: 700; margin-bottom: 2mm; }
    .bidder-number { font-size: 21pt; font-weight: 700; text-align: center; margin: 0 0 3mm; }
    .section { margin-top: 3mm; }
    .section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 1.5mm; }
    .rule { border-top: 1px dashed #000; margin: 2.5mm 0; }
    .item-row, .payment-row, .summary-row { display: grid; gap: 2mm; align-items: start; }
    .item-row { grid-template-columns: 8mm minmax(0, 1fr) auto; }
    .payment-row, .summary-row { grid-template-columns: minmax(0, 1fr) auto; }
    .lot-number, .amount, .summary-value { white-space: nowrap; }
    .description, .payment-meta, .payment-note { min-width: 0; overflow: hidden; }
    .description { white-space: nowrap; }
    .payment-meta { font-size: 8.5pt; }
    .payment-note { font-size: 8.5pt; margin-top: 0.5mm; }
    .amount-due { font-weight: 700; font-size: 12pt; }
    .printed-at, .receipt-fingerprint { margin-top: 3mm; font-size: 8pt; }
    .receipt-fingerprint { font-family: "Courier New", monospace; overflow: hidden; white-space: nowrap; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="auction-name center">${escapeHtml(auctionName)}</div>
    <div class="bidder-number">${escapeHtml(receiptBidderLabel)}</div>

    <div class="section">
      <div class="section-title">Items won</div>
      ${lots.length ? lots.map(lot => `
        <div class="item-row">
          <div class="lot-number">#${escapeHtml(lot.item_number)}</div>
          <div class="description">${escapeHtml(truncateReceiptText(lot.description, 30))}</div>
          <div class="amount">${escapeHtml(money(lot.hammer_price))}</div>
        </div>
      `).join('') : '<div>No items won</div>'}
    </div>

    <div class="rule"></div>
    <div class="summary-row">
      <div>Total price</div>
      <div class="summary-value">${escapeHtml(money(bidder.lots_total || 0))}</div>
    </div>

    <div class="section">
      <div class="section-title">Payments</div>
      ${payments.length ? payments.map(payment => `
        <div class="payment-row">
          <div>
            <div class="payment-meta">${escapeHtml(receiptDateTime(payment.created_at))}  ${escapeHtml(formatPaymentMethod(payment.method))}</div>
            ${Number(payment.donation_amount || 0) > 0 ? `<div class="payment-note">Donation ${escapeHtml(money(payment.donation_amount))}</div>` : ''}
          </div>
          <div class="amount">${escapeHtml(money(payment.amount))}</div>
        </div>
      `).join('') : '<div>No payments recorded</div>'}
    </div>

    ${donationTotal > 0 ? `
      <div class="rule"></div>
      <div class="summary-row">
        <div>Total donations</div>
        <div class="summary-value">${escapeHtml(money(donationTotal))}</div>
      </div>
    ` : ''}

    <div class="rule"></div>
    <div class="summary-row amount-due">
      <div>Amount due</div>
      <div class="summary-value">${escapeHtml(money(balance))}</div>
    </div>

    <div class="printed-at">Printed ${escapeHtml(receiptDateTime(printedAt))} by user: ${escapeHtml(currentUsername)}</div>
    ${fingerprint ? `<div class="receipt-fingerprint">Fingerprint ${escapeHtml(fingerprint)}</div>` : ''}
  </div>
</body>
</html>`;
  }

  function printReceiptDocument(html) {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';

    const cleanup = () => {
      setTimeout(() => iframe.remove(), 15000);
    };

    iframe.onload = () => {
      setTimeout(() => {
        try {
          const frameWindow = iframe.contentWindow;
          if (!frameWindow) throw new Error('Unable to access print frame');
          frameWindow.focus();
          frameWindow.print();
        } catch (error) {
          showMessage(`Receipt print failed: ${error.message}`, 'error');
        } finally {
          cleanup();
        }
      }, 150);
    };

    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  }

  function handlePrintReceipt() {
    if (!selBidder) {
      showMessage('Select a bidder first', 'info');
      return;
    }
    printReceiptDocument(buildReceiptHtml(selBidder, new Date().toISOString()));
  }

  function updateFingerprintDisplay() {
    if (!fingerprintDisplay || !toggleFingerprintBtn) return;

    const fingerprint = selBidder?.fingerprint || '';
    const hasFingerprint = Boolean(fingerprint);

    toggleFingerprintBtn.hidden = !hasFingerprint;
    toggleFingerprintBtn.textContent = fingerprintVisible ? 'Hide fingerprint' : 'Show fingerprint';

    if (!hasFingerprint) {
      fingerprintDisplay.hidden = true;
      fingerprintDisplay.textContent = '';
      return;
    }

    fingerprintDisplay.hidden = !fingerprintVisible;
    fingerprintDisplay.textContent = fingerprintVisible ? `Fingerprint: ${fingerprint}` : '';
  }

  function updatePaymentStateTooltip(isSettlementState) {
    const buttons = document.querySelectorAll('#payButtons button[data-method]');
    if (paymentStateHintEl) {
      paymentStateHintEl.hidden = isSettlementState;
      paymentStateHintEl.textContent = isSettlementState
        ? ''
        : 'Payment methods are unavailable because this auction is not in settlement state.';
    }
    buttons.forEach((btn) => {
      if (!isSettlementState) {
        btn.title = 'Payments require the auction to be in settlement state';
      } else if (btn.style.display === 'none') {
        btn.title = 'This payment method is currently disabled.';
      } else {
        btn.removeAttribute('title');
      }
    });
  }

  async function fetchBidders(){
    if (fetchBiddersInFlight) return;
    fetchBiddersInFlight = true;
    try {
      const res = await window.AppAuth.authenticatedFetch(`${API_ROOT}/bidders?auction_id=${AUCTION_ID}`, { headers:{ "X-CSRF-Token":token }});
      if (!res.ok) {
        throw new Error(`Bidder refresh failed (${res.status})`);
      }
      bidders = await res.json();

      renderBidders();
      if(selBidder){
        const updated = bidders.find(b=>b.id===selBidder.id);
        if(updated) {
          await selectBidder(updated, { preserveUiState: true });
        } else {
          await selectBidder(null, { preserveUiState: true });
        }
        return;
      }
      persistBuyerDisplayState();
    } catch (error) {
      console.error("[payments] Bidder refresh failed:", error);
    } finally {
      fetchBiddersInFlight = false;
    }
  }

  async function saveSelectedBidderName(name) {
    if (!selBidder?.id) throw new Error('Select a bidder first');
    const response = await window.AppAuth.authenticatedFetch(`${API}/auctions/${AUCTION_ID}/bidders/${selBidder.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        "X-CSRF-Token": token
      },
      body: JSON.stringify({ name })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Failed to save bidder name');
    return data.bidder;
  }

  function openBidderNameModal() {
    if (!selBidder) {
      showMessage('Select a bidder first', 'info');
      return;
    }
    if (AUCTION_STATUS === 'archived') {
      showMessage('Bidder names cannot be edited for archived auctions', 'info');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="bidderNameTitle">
        <h3 id="bidderNameTitle" class="modal-title">Edit bidder name</h3>
        <label class="modal-label" for="bidderNameInput">Paddle #${escapeHtml(selBidder.paddle_number)}</label>
        <input id="bidderNameInput" class="modal-input" type="text" maxlength="100" value="${escapeHtml(selBidder.bidder_name || selBidder.name || '')}" autofocus>
        <div class="modal-actions">
          <button id="cancelBidderName" class="secondary-button" type="button">Cancel</button>
          <button id="saveBidderName" type="button">Save</button>
        </div>
      </div>
    `;

    const close = () => overlay.remove();
    const save = async () => {
      const input = overlay.querySelector('#bidderNameInput');
      const saveButton = overlay.querySelector('#saveBidderName');
      saveButton.disabled = true;
      try {
        await saveSelectedBidderName(input.value);
        await fetchBidders();
        showMessage('Bidder name saved', 'success');
        close();
      } catch (error) {
        showMessage(error.message, 'error');
        saveButton.disabled = false;
      }
    };

    overlay.querySelector('#cancelBidderName')?.addEventListener('click', close);
    overlay.querySelector('#saveBidderName')?.addEventListener('click', () => { void save(); });
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void save();
      }
    });
    document.body.appendChild(overlay);
    overlay.querySelector('#bidderNameInput')?.focus();
  }


// Enable or disable payment buttons based on backend config

async function refreshPaymentButtons() {
  const buttons = document.querySelectorAll('#payButtons button[data-method]');

  if (!buttons.length) {

    return;
  }

  try {
    const res = await window.AppAuth.authenticatedFetch(`${API_ROOT}/payment-methods`, { headers: { "X-CSRF-Token": token } });

    if (!res.ok) {
      // Fail-safe: disable all buttons if we can’t confirm what’s allowed
      buttons.forEach(btn => {
        btn.disabled = true;
        btn.classList.add('disabled');
      });
      return;
    }

    const data = await res.json();

    const methods = data.paymentMethods && typeof data.paymentMethods === 'object'
      ? data.paymentMethods
      : data;

    if (!methods || typeof methods !== 'object') {
      buttons.forEach(btn => {
        btn.disabled = true;
        btn.classList.add('disabled');
      });
      return;
    }

    // // Toggle each button based on the methods object
    // buttons.forEach(btn => {
    //   const key = btn.dataset.method;
    //   const enabled = !!methods[key];

    //   if (enabled) {
    //     btn.disabled = false;
    //     btn.classList.remove('disabled');
    //     btn.removeAttribute('title');
    //   } else {
    //     btn.disabled = true;
    //     btn.classList.add('disabled');
    //     btn.title = 'This payment method is currently disabled.';
    //   }
    // });

    // Toggle each button based on the methods object
buttons.forEach(btn => {
  const key = btn.dataset.method;
  const cfg = methods?.[key];

  // Backwards-compatible: old boolean format OR new { enabled, label } format
  const enabled =
    (typeof cfg === 'boolean') ? cfg :
    (cfg && typeof cfg === 'object') ? !!cfg.enabled :
    false;

  if (enabled) {
    btn.disabled = false;
    btn.style.display = '';
    btn.classList.remove('disabled');
    btn.removeAttribute('title');
  } else {
    btn.disabled = true;
    btn.classList.add('disabled');
    btn.style.display = 'none';
    btn.title = 'This payment method is currently disabled.';
  }

  if (cfg && typeof cfg === 'object' && cfg.label) {
    btn.textContent = cfg.label;
  }
});

    if (AUCTION_STATUS !== 'settlement') {
      buttons.forEach(btn => {
        btn.disabled = true;
      });
      document.getElementById('payButtons')?.classList.add('disabled');
      updatePaymentStateTooltip(false);
    } else {
      document.getElementById('payButtons')?.classList.remove('disabled');
      updatePaymentStateTooltip(true);
    }

  } catch (err) {
    showMessage(`[payments] Error while loading payment methods: ${err}`, "error");
    // Conservative: disable everything if something goes wrong
    const buttons = document.querySelectorAll('#payButtons button[data-method]');
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('disabled');
    });
    updatePaymentStateTooltip(AUCTION_STATUS === 'settlement');
  }
}

  function isPendingIntentActive(intent) {
    return intent?.status === 'pending';
  }

  function getPendingIntentsForBidder(bidderId) {
    return pendingIntents.filter(intent => Number(intent.bidder_id) === Number(bidderId) && isPendingIntentActive(intent));
  }

  function getActivePendingIntentForBidder(bidderId) {
    return getPendingIntentsForBidder(bidderId)[0] || null;
  }

  function getPendingStatusText(intent) {
    if (!intent) return 'Waiting for SumUp confirmation.';
    if (intent.status === 'succeeded') return 'Payment confirmed and recorded.';
    if (intent.status === 'failed') return 'SumUp reported this payment as failed.';
    if (intent.status === 'expired') return 'This payment request has expired.';
    if (intent.verification_state === 'failed') {
      return intent.channel === 'hosted' || intent.hosted_link
        ? 'The last SumUp checkout attempt was declined. The checkout can be tried again.'
        : 'SumUp reported this payment as failed.';
    }
    if (intent.verification_state === 'unavailable') return 'Verification is unavailable; the payment has not been recorded.';
    if (intent.verification_state === 'mismatch') return 'SumUp details did not match this payment.';
    if (intent.verification_state === 'not_found') return 'SumUp has not returned a matching transaction yet.';
    return 'Waiting for SumUp confirmation.';
  }

  function formatPendingIntentAmount(intent) {
    const donationMinor = Number(intent?.donation_minor || 0);
    const grossMinor = Number(intent?.amount_minor || 0);
    if (donationMinor > 0) {
      return `${moneyFromMinor(grossMinor)} including ${moneyFromMinor(donationMinor)} donation`;
    }
    return moneyFromMinor(grossMinor);
  }

  function formatPendingIntentAge(intent) {
    const createdAt = Date.parse(String(intent?.created_at || '').replace(' ', 'T'));
    if (!Number.isFinite(createdAt)) return '';
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
    if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
    return `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s ago`;
  }

  function upsertPendingIntent(intent) {
    if (!intent?.intent_id) return null;
    const existingIndex = pendingIntents.findIndex(row => row.intent_id === intent.intent_id);
    const merged = {
      ...(existingIndex >= 0 ? pendingIntents[existingIndex] : {}),
      ...intent
    };
    if (existingIndex >= 0) pendingIntents[existingIndex] = merged;
    else pendingIntents.push(merged);
    return merged;
  }

  function removePendingIntent(intentId) {
    pendingIntents = pendingIntents.filter(intent => intent.intent_id !== intentId);
  }

  async function loadPendingIntents() {
    if (pendingRefreshInFlight || AUCTION_STATUS !== 'settlement') return;
    pendingRefreshInFlight = true;
    try {
      const response = await window.AppAuth.authenticatedFetch(`${API}/payments/intents/pending/${AUCTION_ID}`, {
        headers: { "X-CSRF-Token": token }
      });
      if (!response.ok) throw new Error(`Pending payments refresh failed (${response.status})`);
      const data = await response.json();
      pendingIntents = Array.isArray(data?.intents) ? data.intents : [];
      renderPendingPayments();
      updateWaitingModal();
    } catch (error) {
      console.error('[payments] Pending payment refresh failed:', error);
    } finally {
      pendingRefreshInFlight = false;
    }
  }

  function applySumupPendingButtonState() {
    const activeIntent = selBidder ? getActivePendingIntentForBidder(selBidder.id) : null;
    document.querySelectorAll('#payButtons button[data-method="sumup-app"], #payButtons button[data-method="sumup-web"]').forEach(btn => {
      if (btn.style.display === 'none') return;
      if (AUCTION_STATUS !== 'settlement') {
        btn.disabled = true;
        return;
      }
      if (activeIntent) {
        btn.disabled = true;
        btn.title = 'This bidder already has a pending SumUp payment.';
      } else {
        btn.disabled = false;
        btn.removeAttribute('title');
      }
    });
  }

  function renderPendingPayments() {
    const activePending = pendingIntents.filter(isPendingIntentActive);

    if (auctionPendingPaymentsEl) {
      if (activePending.length === 0) {
        auctionPendingPaymentsEl.hidden = true;
        auctionPendingPaymentsEl.replaceChildren();
      } else {
        auctionPendingPaymentsEl.hidden = false;
        auctionPendingPaymentsEl.innerHTML = `
          <div class="pending-payments-heading">
            <span>Pending SumUp</span>
            <strong>${activePending.length}</strong>
          </div>
          <div class="pending-payment-list">
            ${activePending.map(intent => `
              <div class="pending-payment-row" data-intent-id="${escapeHtml(intent.intent_id)}">
                <button class="pending-payment-link" type="button" data-bidder-id="${escapeHtml(intent.bidder_id)}">
                  ${escapeHtml(intent.bidder_label || `Bidder ${intent.bidder_id}`)}
                </button>
                <span>${escapeHtml(formatPendingIntentAmount(intent))}</span>
              </div>
            `).join('')}
          </div>
        `;
        auctionPendingPaymentsEl.querySelectorAll('.pending-payment-link').forEach(button => {
          button.addEventListener('click', () => {
            const bidder = bidders.find(row => Number(row.id) === Number(button.dataset.bidderId));
            if (bidder) void selectBidder(bidder);
          });
        });
      }
    }

    const bidderPending = selBidder ? getPendingIntentsForBidder(selBidder.id) : [];
    if (bidderPendingPaymentsEl) {
      if (!selBidder || bidderPending.length === 0) {
        bidderPendingPaymentsEl.hidden = true;
        bidderPendingPaymentsEl.replaceChildren();
      } else {
        bidderPendingPaymentsEl.hidden = false;
        bidderPendingPaymentsEl.innerHTML = bidderPending.map(intent => `
          <div class="pending-payment-card" data-intent-id="${escapeHtml(intent.intent_id)}">
            <div class="pending-payment-card-main">
              <div>
                <div class="pending-payment-title">Waiting for SumUp confirmation</div>
                <div class="pending-payment-meta">${escapeHtml(formatPendingIntentAmount(intent))} · ${escapeHtml(intent.channel === 'hosted' ? 'SumUp web' : 'SumUp reader')} · ${escapeHtml(formatPendingIntentAge(intent))}</div>
                <div class="pending-payment-status">${escapeHtml(getPendingStatusText(intent))}</div>
              </div>
              <div class="pending-payment-actions">
                ${intent.hosted_link ? '<button class="secondary-button pending-open-checkout" type="button">Open checkout</button>' : ''}
                <button class="secondary-button pending-check-now" type="button">Check now</button>
                <button class="secondary-button pending-cancel-intent" type="button">Cancel</button>
              </div>
            </div>
          </div>
        `).join('');
        bidderPendingPaymentsEl.querySelectorAll('.pending-payment-card').forEach(card => {
          const intentId = card.dataset.intentId;
          card.querySelector('.pending-check-now')?.addEventListener('click', () => {
            void verifyPendingIntent(intentId, { userInitiated: true });
          });
          card.querySelector('.pending-open-checkout')?.addEventListener('click', () => {
            const intent = pendingIntents.find(row => row.intent_id === intentId);
            if (intent?.hosted_link) window.open(intent.hosted_link, '_blank', 'noopener');
          });
          card.querySelector('.pending-cancel-intent')?.addEventListener('click', () => {
            void cancelPendingIntent(intentId, { userInitiated: true });
          });
        });
      }
    }

    applySumupPendingButtonState();
    renderBidders({ force: true });
  }

  function focusPendingPayments(intent) {
    if (intent?.bidder_id && Number(selBidder?.id) !== Number(intent.bidder_id)) {
      const bidder = bidders.find(row => Number(row.id) === Number(intent.bidder_id));
      if (bidder) void selectBidder(bidder, { preserveUiState: true });
    }
    setTimeout(() => {
      const target = bidderPendingPaymentsEl && !bidderPendingPaymentsEl.hidden
        ? bidderPendingPaymentsEl
        : auctionPendingPaymentsEl;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.classList.add('pending-payments-panel-highlight');
      window.setTimeout(() => target?.classList.remove('pending-payments-panel-highlight'), 1600);
    }, 100);
  }

  async function verifyPendingIntent(intentId, options = {}) {
    const { userInitiated = false, foreground = false } = options;
    try {
      const response = await window.AppAuth.authenticatedFetch(
        `${API}/payments/intents/${encodeURIComponent(intentId)}/verify`,
        {
          method: 'POST',
          headers: { "X-CSRF-Token": token }
        }
      );
      const status = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(status.error || 'Unable to verify SumUp payment');
      const merged = upsertPendingIntent(status);
      updateWaitingModal(merged || status);
      renderPendingPayments();
      updateWaitingModal(merged || status);

      if (status.status === 'succeeded') {
        showMessage('SumUp payment confirmed.', 'success');
        finishWaitingModal(intentId, { delayMs: foreground ? 1200 : 0 });
        removePendingIntent(intentId);
        await fetchBidders();
        await loadPendingIntents();
        return status;
      }
      if (status.status === 'failed' || status.status === 'expired') {
        if (userInitiated || foreground) showMessage(`SumUp payment ${status.status}.`, 'error');
        finishWaitingModal(intentId, { delayMs: foreground ? 1600 : 0 });
        removePendingIntent(intentId);
        renderPendingPayments();
        await fetchBidders();
        await loadPendingIntents();
        return status;
      }
      if (userInitiated && merged?.verification_state === 'unavailable') {
        showMessage('SumUp verification is unavailable. The payment remains pending and has not been recorded.', 'info');
      } else if (userInitiated && merged?.verification_state === 'failed') {
        showMessage('The SumUp checkout was declined. The checkout remains open for another attempt or alternate payment method.', 'info');
      } else if (userInitiated && merged?.verification_state === 'mismatch') {
        showMessage('SumUp returned transaction details that did not match this payment. The payment remains pending.', 'error');
      } else if (userInitiated) {
        showMessage('SumUp confirmation is still pending. No payment has been recorded.', 'info');
      }
      return status;
    } catch (error) {
      if (userInitiated || foreground) {
        showMessage(`SumUp verification could not be completed: ${error.message}`, 'error');
      }
      return null;
    }
  }

  async function cancelPendingIntent(intentId, options = {}) {
    const { userInitiated = false } = options;
    const intent = pendingIntents.find(row => row.intent_id === intentId);
    const label = intent?.bidder_label || 'this bidder';
    const amountText = intent ? formatPendingIntentAmount(intent) : 'this payment';
    const confirmation = await DayPilot.Modal.confirm(
      `
        <strong>Stop waiting for this SumUp payment?</strong><br><br>
        ${escapeHtml(label)} - ${escapeHtml(amountText)}<br><br>
        ManeBid will stop checking this SumUp payment and make the payment buttons available again.
        Only do this if the customer is no longer trying to complete this SumUp payment, or you are taking payment another way.
      `,
      {
        okText: 'Stop waiting',
        cancelText: 'Keep waiting',
        width: 520
      }
    );
    if (confirmation?.canceled) return null;

    try {
      const response = await window.AppAuth.authenticatedFetch(
        `${API}/payments/intents/cancel/${AUCTION_ID}/${encodeURIComponent(intentId)}`,
        {
          method: 'POST',
          headers: { "X-CSRF-Token": token }
        }
      );
      const status = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(status.error || 'Unable to cancel SumUp payment');

      removePendingIntent(intentId);
      if (waitingModalIntentId === intentId) closeWaitingModal();
      renderPendingPayments();
      await fetchBidders();
      await loadPendingIntents();
      if (userInitiated) showMessage('Pending SumUp payment cancelled. Payment options are available again.', 'info');
      return status;
    } catch (error) {
      if (userInitiated) showMessage(`SumUp pending payment could not be cancelled: ${error.message}`, 'error');
      return null;
    }
  }

  function stopWaitingModalPolling() {
    if (waitingModalPollTimer) {
      window.clearInterval(waitingModalPollTimer);
      waitingModalPollTimer = null;
    }
  }

  function stopWaitingModalElapsedTimer() {
    if (waitingModalTimer) {
      window.clearInterval(waitingModalTimer);
      waitingModalTimer = null;
    }
  }

  function finishWaitingModal(intentId, options = {}) {
    if (waitingModalIntentId !== intentId) {
      return;
    }
    updateWaitingModal();
    stopWaitingModalPolling();
    stopWaitingModalElapsedTimer();
    window.setTimeout(closeWaitingModal, Math.max(0, Number(options.delayMs || 0)));
  }

  function closeWaitingModal() {
    stopWaitingModalElapsedTimer();
    stopWaitingModalPolling();
    waitingModalEl?.remove();
    waitingModalEl = null;
    waitingModalIntentId = null;
    waitingModalStartedAt = 0;
  }

  function updateWaitingModal(latestIntent = null) {
    if (!waitingModalEl || !waitingModalIntentId) return;
    const intent = latestIntent?.intent_id === waitingModalIntentId
      ? latestIntent
      : pendingIntents.find(row => row.intent_id === waitingModalIntentId);
    const elapsed = Math.max(0, Math.floor((Date.now() - waitingModalStartedAt) / 1000));
    const statusEl = waitingModalEl.querySelector('[data-waiting-status]');
    const elapsedEl = waitingModalEl.querySelector('[data-waiting-elapsed]');
    const openButton = waitingModalEl.querySelector('[data-open-checkout]');
    const waitingState = !intent
      || (intent.status === 'pending' && ['pending', 'not_found'].includes(intent.verification_state || 'pending'));
    if (statusEl) {
      statusEl.textContent = elapsed >= 30 && waitingState
        ? 'Still waiting. You can continue working while ManeBid keeps checking.'
        : getPendingStatusText(intent);
    }
    if (elapsedEl) elapsedEl.textContent = `Waiting ${elapsed}s`;
    if (openButton) openButton.hidden = !intent?.hosted_link;
  }

  function showWaitingModal(intent) {
    closeWaitingModal();
    waitingModalIntentId = intent.intent_id;
    waitingModalStartedAt = Date.now();
    waitingModalEl = document.createElement('div');
    waitingModalEl.className = 'modal-overlay sumup-waiting-overlay';
    waitingModalEl.innerHTML = `
      <div class="modal-card sumup-waiting-card" role="dialog" aria-modal="true" aria-labelledby="sumupWaitingTitle">
        <div class="sumup-spinner" aria-hidden="true"></div>
        <h3 id="sumupWaitingTitle" class="modal-title">Waiting for SumUp confirmation</h3>
        <div class="sumup-waiting-amount">${escapeHtml(formatPendingIntentAmount(intent))}</div>
        <div class="sumup-waiting-meta">${escapeHtml(intent.bidder_label || formatBidderLabel(selBidder, { prefix: true }))}</div>
        <p class="sumup-waiting-status" data-waiting-status>${escapeHtml(getPendingStatusText(intent))}</p>
        <div class="sumup-waiting-elapsed" data-waiting-elapsed>Waiting 0s</div>
        <div class="modal-actions">
          <button class="secondary-button" type="button" data-continue-working>Continue working</button>
          <button class="secondary-button" type="button" data-open-checkout ${intent.hosted_link ? '' : 'hidden'}>Open checkout</button>
          <button class="secondary-button" type="button" data-cancel-intent>Cancel</button>
          <button class="modal-button modal-button-primary" type="button" data-check-now>Check now</button>
        </div>
      </div>
    `;
    waitingModalEl.querySelector('[data-continue-working]')?.addEventListener('click', closeWaitingModal);
    waitingModalEl.querySelector('[data-open-checkout]')?.addEventListener('click', () => {
      const latest = pendingIntents.find(row => row.intent_id === waitingModalIntentId);
      if (latest?.hosted_link) window.open(latest.hosted_link, '_blank', 'noopener');
    });
    waitingModalEl.querySelector('[data-check-now]')?.addEventListener('click', () => {
      void verifyPendingIntent(waitingModalIntentId, { userInitiated: true, foreground: true });
    });
    waitingModalEl.querySelector('[data-cancel-intent]')?.addEventListener('click', () => {
      void cancelPendingIntent(waitingModalIntentId, { userInitiated: true });
    });
    document.body.appendChild(waitingModalEl);
    waitingModalTimer = window.setInterval(updateWaitingModal, 1000);
    waitingModalPollTimer = window.setInterval(() => {
      if (waitingModalIntentId) void verifyPendingIntent(waitingModalIntentId, { foreground: true });
    }, 3000);
    updateWaitingModal();
  }

  async function verifyAllPendingIntentsQuietly() {
    const activePending = pendingIntents.filter(isPendingIntentActive);
    for (const intent of activePending) {
      await verifyPendingIntent(intent.intent_id);
    }
  }


  function getBidderListRenderKey(sortedBidders) {
    return JSON.stringify(sortedBidders.map((bidder) => ({
      id: bidder.id,
      label: formatBidderLabel(bidder),
      balance: Number(bidder.balance || 0),
      paymentStatus: getPaymentStatus(bidder),
      pendingCount: getPendingIntentsForBidder(bidder.id).length,
      selected: (selectedBidderId ?? selBidder?.id) === bidder.id
    })));
  }

  function renderBidders({ force = false } = {}){
    const sortedBidders = sortBidders(bidders);
    const nextRenderKey = getBidderListRenderKey(sortedBidders);
    if (!force && nextRenderKey === bidderListRenderKey) return;
    bidderListRenderKey = nextRenderKey;

    bidderBody.replaceChildren();
    sortedBidders.forEach(b=>{
      const tr=document.createElement('tr');
      tr.className=`bidder-row ${getPaymentStatusClass(b)}`;
      if(b.balance===0) tr.classList.add('bidder-paid');
      if(getPaymentStatus(b)==='part-paid') tr.classList.add('bidder-part-paid');
      if(b.balance<0) tr.classList.add('bidder-negative');
      tr.dataset.id=b.id;
      const labelCell = appendTextCell(tr, formatBidderLabel(b));
      const pendingCount = getPendingIntentsForBidder(b.id).length;
      if (pendingCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'pending-bidder-badge';
        badge.textContent = `${pendingCount} pending`;
        labelCell.appendChild(document.createTextNode(' '));
        labelCell.appendChild(badge);
      }
      appendTextCell(tr, money(b.balance));
      tr.onclick=()=>selectBidder(b);
      if((selectedBidderId ?? selBidder?.id)===b.id) tr.classList.add('sel');
      bidderBody.appendChild(tr);
    });
  }

  async function selectBidder(b, options = {}){
    const { preserveUiState = false } = options;
    if(!b){
      selectedBidderId = null;
      selBidder=null;
      selectedBidderRenderKey = '';
      renderBidders();
      detailBox.style.display='none';
      if (emptyDetailEl) emptyDetailEl.style.display = 'block';
      titleEl.textContent='Select a bidder...';
      if (editBidderNameBtn) editBidderNameBtn.disabled = true;
      if (lotsSectionEl) {
        lotsSectionEl.classList.remove('payment-state-paid', 'payment-state-part-paid', 'payment-state-unpaid', 'payment-state-overpaid');
      }
      fingerprintVisible = false;
      if (lotsTotalEl) lotsTotalEl.textContent = '';
      updateFingerprintDisplay();
      renderPendingPayments();
      persistBuyerDisplayState();
      return;
    }

    selectedBidderId = b.id;
    renderBidders();

    const res = await window.AppAuth.authenticatedFetch(`${API_ROOT}/bidders/${b.id}?auction_id=${AUCTION_ID}`, { headers:{ "X-CSRF-Token":token }});

            // Check for 403 (unauthorized)
        if (res.status === 403) {
            showMessage("Session expired. Please log in again.", "info");
            window.AppAuth?.clearAllSessions?.({ broadcast: false });
            setTimeout(() => {
                window.location.reload();
            }, 1500);
            return;
        }

    if(!res.ok){
      showMessage('Could not load bidder', 'error');
      selectedBidderId = selBidder?.id ?? null;
      renderBidders();
      return;
    }
    const nextSelectedBidder = await res.json();
    const nextSelectedBidderRenderKey = JSON.stringify(nextSelectedBidder);
    const detailsChanged = nextSelectedBidderRenderKey !== selectedBidderRenderKey;
    selBidder = nextSelectedBidder;
    selectedBidderId = selBidder.id;
    if (!preserveUiState) fingerprintVisible = false;

    renderBidders();

    if (preserveUiState && !detailsChanged) {
      persistBuyerDisplayState();
      return;
    }
    selectedBidderRenderKey = nextSelectedBidderRenderKey;

    titleEl.textContent=formatBidderLabel(selBidder, { prefix: true });
    if (editBidderNameBtn) {
      editBidderNameBtn.disabled = AUCTION_STATUS === 'archived';
      editBidderNameBtn.title = AUCTION_STATUS === 'archived' ? 'Bidder names cannot be edited for archived auctions' : '';
    }
    if (emptyDetailEl) emptyDetailEl.style.display = 'none';
    detailBox.style.display='block';

    renderLots();
    renderPayments();
    renderPendingPayments();


    if (AUCTION_STATUS === 'settlement') {
document.getElementById('payButtons').classList.remove('disabled');
document.querySelectorAll('#payButtons button[data-method]').forEach(btn => { btn.disabled = btn.style.display === 'none'; });
document.querySelectorAll('.delPay').forEach(btn => btn.disabled = false);
updatePaymentStateTooltip(true);
applySumupPendingButtonState();


  } else {

document.querySelectorAll('#payButtons button[data-method]').forEach(btn => btn.disabled = true);
document.querySelectorAll('.delPay').forEach(btn => btn.disabled = true);
document.getElementById('payButtons').classList.add('disabled');
updatePaymentStateTooltip(false);
  }

updateTotals();
    persistBuyerDisplayState();

  }

  function renderLots(){
    lotsBody.innerHTML='';
    const lots = selBidder.lots || [];
    const statusClass = getPaymentStatusClass(selBidder);
    if (lotsSectionEl) {
      lotsSectionEl.classList.remove('payment-state-paid', 'payment-state-part-paid', 'payment-state-unpaid', 'payment-state-overpaid');
      lotsSectionEl.classList.add(statusClass);
    }
    lots.forEach(l=>{

    const prc = l.test_bid != null ? `${money(l.hammer_price)} [T]` : money(l.hammer_price);
    const desc = l.test_item != null ? `${l.description ?? ''} [T]` : (l.description ?? '');
    const photoUrl = safePhotoFilename(l.photo_url || l.photoUrl || l.photo || '');

      const tr=document.createElement('tr');
      tr.classList.add(statusClass);
      appendTextCell(tr, l.item_number);
      appendTextCell(tr, desc);
      appendTextCell(tr, prc);
      if (photoUrl) tr.dataset.photoUrl = photoUrl;
      else delete tr.dataset.photoUrl;
      lotsBody.appendChild(tr);
    });

    if (lotsPreviewStripEl) {
      const pictureLots = lots.filter(l => safePhotoFilename(l.photo_url || l.photoUrl || l.photo || ''));
      const previewLots = showPictures ? pictureLots.slice(0, 6) : [];
      const remainingCount = showPictures ? Math.max(0, pictureLots.length - previewLots.length) : 0;
      lotsPreviewStripEl.innerHTML = '';

      previewLots.forEach((lot) => {
        const photoUrl = safePhotoFilename(lot.photo_url || lot.photoUrl || lot.photo || '');
        if (!photoUrl) return;
        const figure = document.createElement('figure');
        figure.className = 'lot-preview-thumb';
        const img = document.createElement('img');
        img.src = `${uploadBase}/preview_${photoUrl}`;
        img.alt = `Lot ${lot.item_number ?? ''} preview`;
        img.loading = 'lazy';
        const caption = document.createElement('figcaption');
        caption.textContent = `Lot ${lot.item_number ?? ''}`;
        figure.append(img, caption);
        lotsPreviewStripEl.appendChild(figure);
      });

      if (remainingCount > 0) {
        const more = document.createElement('div');
        more.className = 'lot-preview-thumb lot-preview-thumb-more';
        more.textContent = `+${remainingCount} more`;
        lotsPreviewStripEl.appendChild(more);
      }

      lotsPreviewStripEl.hidden = previewLots.length === 0;
    }

    if (lotsTotalEl) lotsTotalEl.textContent = `Total lots: ${money(selBidder.lots_total || 0)}`;
  }

  function renderPayments() {
    payBody.innerHTML = '';
    (selBidder.payments || []).forEach(p => {
      const tr = document.createElement('tr');
      const donation = Number(p.donation_amount || 0);
      const paymentNote = donation > 0
        ? `${p.note || ''}${p.note ? ' | ' : ''}Donation ${money(donation)}`
        : (p.note || '');
      appendTextCell(tr, p.id);
      appendTextCell(tr, new Date(p.created_at).toLocaleString());
      appendTextCell(tr, formatPaymentMethod(p.method));
      appendTextCell(tr, money(p.amount));
      appendTextCell(tr, paymentNote);
      const actionCell = document.createElement('td');
      if (p.amount >= 0) {
        const refundButton = document.createElement('button');
        refundButton.type = 'button';
        refundButton.dataset.id = p.id;
        refundButton.className = 'delPay refund-button';
        refundButton.textContent = 'Refund';
        actionCell.appendChild(refundButton);
      }
      tr.appendChild(actionCell);
      payBody.appendChild(tr);
    });
    payBody.querySelectorAll('.delPay').forEach(btn => {
      //      btn.onclick=()=>delPayment(btn.dataset.id);
      btn.onclick = () => openRefundModal(btn.dataset.id);

    });
  }

  function updateTotals(){
    const o=selBidder;
    const donationsTotal = Number(o.donations_total || 0);
    document.getElementById('totals').innerHTML=`
      <div class="summary-card">
        <span class="summary-card-label">Paid</span>
        <span class="summary-card-value">${money(o.payments_total)}</span>
      </div>
      <div class="summary-card">
        <span class="summary-card-label">Donations</span>
        <span class="summary-card-value">${money(donationsTotal)}</span>
      </div>
      <div class="summary-card">
        <span class="summary-card-label">Balance</span>
        <span class="summary-card-value">${money(o.balance)}</span>
      </div>`;
    updateFingerprintDisplay();
  }





  async function startSumupPayment(amt, donation, note, mode = 'app') {
    if (!selBidder) {
      showMessage('No bidder selected', 'error');
      return false;
    }

    const existingIntent = getActivePendingIntentForBidder(selBidder.id);
    if (existingIntent) {
      showMessage('This bidder already has a pending SumUp payment.', 'info');
      focusPendingPayments(existingIntent);
      return true;
    }

    const paymentAmount = roundCurrency(amt);
    const donationAmount = roundCurrency(donation);
    const amountMinor = Math.round(Number(paymentAmount) * 100);
    const donationMinor = Math.round(Number(donationAmount) * 100);
    if (!Number.isFinite(amountMinor) || !Number.isFinite(donationMinor) || amountMinor < 0 || donationMinor < 0 || (amountMinor === 0 && donationMinor === 0)) {
      showMessage('Invalid amount for SumUp payment', 'error');
      return false;
    }

    try {
      const response = await window.AppAuth.authenticatedFetch(`${API}/payments/intents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          "X-CSRF-Token": token
        },
        body: JSON.stringify({
          bidder_id: selBidder.id,
          amount_minor: amountMinor,
          donation_minor: donationMinor,
          currency: 'GBP',
          channel: mode === 'web' ? 'hosted' : 'app',
          note: note || null,
          auctionId: AUCTION_ID
        })
      });

      if (!response.ok) {
        let msg = `Failed to start SumUp payment (status ${response.status})`;
        let pendingIntent = null;
        try {
          const errJson = await response.json();
          if (response.status === 409 && errJson?.error === 'pending_sumup_intent' && errJson.pending_intent) {
            pendingIntent = upsertPendingIntent(errJson.pending_intent);
          }
          if (errJson && errJson.error) msg = errJson.error;
        } catch (_) { /* ignore JSON parse errors */ }
        if (pendingIntent) {
          renderPendingPayments();
          showMessage('This bidder already has a pending SumUp payment.', 'info');
          focusPendingPayments(pendingIntent);
          return true;
        }
        throw new Error(msg);
      }

      const data = await response.json();
      const deepLink   = data.deep_link || null;
      const hostedLink = data.hosted_link || null;
      const url = deepLink || hostedLink;

      if (!url) {
        throw new Error('Backend did not return a SumUp checkout URL.');
      }

      const pendingIntent = upsertPendingIntent({
        ...data,
        bidder_id: selBidder.id,
        bidder_label: formatBidderLabel(selBidder, { prefix: true }),
        amount_minor: amountMinor + donationMinor,
        donation_minor: donationMinor,
        currency: 'GBP',
        channel: mode === 'web' ? 'hosted' : 'app',
        status: 'pending',
        created_at: new Date().toISOString(),
        hosted_link: hostedLink
      });

      // If this is a SumUp app deep link, this will jump into the app on a tablet/phone.
      // If it’s a hosted checkout URL, it will open in a new tab.
      window.open(url, '_blank', 'noopener');
      renderPendingPayments();
      showWaitingModal(pendingIntent);
      return true;

    } catch (err) {
      showMessage('SumUp error: ' + err.message, 'error');
      return false;
    }
  }


function openRefundModal(id){
    const tpl=document.getElementById('refundTpl').content.cloneNode(true);
    const overlay=tpl.firstElementChild;document.body.appendChild(overlay);
    overlay.querySelector('#modalTitle').textContent=`Apply refund for payment ID ${id}`;
    const amtIn=overlay.querySelector('#amt');
    amtIn.value=0.00;

overlay.querySelector('#amt').focus();
    const cancelButton = overlay.querySelector('#cancel');
    const okButton = overlay.querySelector('#ok');

    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); cancelButton.click(); }
      if (e.key === 'Enter')  { e.preventDefault(); okButton.click(); }
    });

    cancelButton.onclick=()=>overlay.remove();
    okButton.textContent = 'Apply Refund';
    okButton.onclick=async()=>{
      const amt=Number(amtIn.value);
      const reason=overlay.querySelector('#note').value;
        if(!amt){ showMessage('Amount?', 'error'); return; }
        if(!reason){ showMessage('Reason?', 'error'); return; }

       const modal = await DayPilot.Modal.confirm("Confirm refund of " + money(amt) + " for payment ID " + id + " for reason: `" + reason + "` ?");
        if (modal.canceled) {
            showMessage("Refund cancelled", "info");
            return;
        } else {

       reversePayment(id, amt, reason, ``)
      .then(() => {
        showMessage('Refund applied successfully', 'info');
        overlay.remove();
        fetchBidders();
      })
      .catch(err => {
        showMessage('Refund error: ' + err.message, 'error');
      });
    }
    };


  }

  // payment modal via buttons
  document.querySelectorAll('#payButtons button[data-method]').forEach(btn=>{
    btn.onclick=()=>openPayModal(btn.dataset.method, btn.textContent.trim());
  });

  if (printReceiptBtn) {
    printReceiptBtn.onclick = handlePrintReceipt;
  }

  if (toggleFingerprintBtn) {
    toggleFingerprintBtn.onclick = () => {
      if (!selBidder?.fingerprint) return;
      fingerprintVisible = !fingerprintVisible;
      updateFingerprintDisplay();
    };
  }

  function browserAppearsMobile() {
    if (typeof navigator.userAgentData?.mobile === 'boolean') {
      return navigator.userAgentData.mobile;
    }

    const userAgent = navigator.userAgent || '';
    const isMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(userAgent);
    const isIPadUsingDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return isMobileUserAgent || isIPadUsingDesktopMode;
  }

  function openPayModal(method, methodLabel = ''){
    const tpl=document.getElementById('payTpl').content.cloneNode(true);
    const overlay=tpl.firstElementChild;document.body.appendChild(overlay);
    const displayLabel = methodLabel || formatPaymentMethod(method);
    const modalTitle = overlay.querySelector('#modalTitle');
    modalTitle.textContent=`Add ${displayLabel} payment`;
    if (method === 'sumup-app' && !browserAppearsMobile()) {
      modalTitle.insertAdjacentHTML(
        'afterend',
        '<div class="modal-warning" role="alert"><strong>Mobile device required</strong><br>This payment method only works on a mobile device with the SumUp app installed. This browser does not appear to be mobile.</div>'
      );
    }
    const amtIn=overlay.querySelector('#amt');
    const donationIn = overlay.querySelector('#donation');
    const balanceDue = roundCurrency(selBidder.balance || 0);
    amtIn.value=Math.max(0, balanceDue).toFixed(2);
    donationIn.value='0.00';
    if (balanceDue <= 0) {
      amtIn.value = '0.00';
      amtIn.disabled = true;
      amtIn.title = 'No item payment is due for this bidder';
      amtIn.insertAdjacentHTML('afterend', '<div class="modal-field-hint">No item balance is due; only donations can be recorded.</div>');
    }

    (balanceDue <= 0 ? donationIn : amtIn).focus();
    const cancelButton = overlay.querySelector('#cancel');
    const okButton = overlay.querySelector('#ok');
    okButton.textContent = 'Make Payment';

    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); cancelButton.click(); }
      if (e.key === 'Enter')  { e.preventDefault(); okButton.click(); }
    });

    cancelButton.onclick=()=>overlay.remove();
    okButton.onclick=async()=>{
      const amt=roundCurrency(amtIn.value);
      const donation=roundCurrency(donationIn.value);
      const outstanding = Math.max(0, roundCurrency(selBidder.balance || 0));
      if (!Number.isFinite(amt) || !Number.isFinite(donation) || amt < 0 || donation < 0) return showMessage('Invalid amount', 'error');
      if (amt === 0 && donation === 0) return showMessage('Enter a payment or donation amount', 'info');
      if (outstanding <= 0 && amt > 0) return showMessage('No item payment is due for this bidder', 'info');
      if (amt > outstanding + 0.000001) return showMessage('Item payment cannot exceed the balance due', 'info');
      if (donation > 0 && outstanding > 0 && Math.abs(amt - outstanding) > 0.000001) {
        return showMessage('A donation can only be added when the full balance due is being paid', 'info');
      }
      const note=overlay.querySelector('#note').value;

      // NEW: SumUp branch
  if (method === 'sumup-app') {
    const handled = await startSumupPayment(amt, donation, note, 'app');
    if (handled) overlay.remove();
    return;
  }

  if (method === 'sumup-web') {
    const handled = await startSumupPayment(amt, donation, note, 'web');
    if (handled) overlay.remove();
    return;
  }

  // if (method === 'sumup-indirect') {
  //   await makePaymentRequest(amt, note);
  //   overlay.remove();
  //   return;
  // }

     try {
      const response = await window.AppAuth.authenticatedFetch(`${API_ROOT}/payment/${AUCTION_ID}`,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          "X-CSRF-Token":token},
        body:JSON.stringify({
          auction_id: AUCTION_ID,
          bidder_id:selBidder.id,
          amount:amt,
          donation_amount: donation,
          method,
          note})});

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "Failed to save payment");
        }
        } catch (err) {
            showMessage("Payment error " + err.message, "error");
        }

      overlay.remove();fetchBidders();}; }

async function reversePayment(paymentId, amount, reason, note) {
  const res = await window.AppAuth.authenticatedFetch(`${API_ROOT}/payment/${paymentId}/reverse`, {
    method: 'POST',
    headers: {
          "X-CSRF-Token": token,
          "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount,
      reason,
      note,
      auction_id: AUCTION_ID
    })
  });

  const data = await res.json();

  if (!res.ok) {
    // backend may return remaining amount on conflict
    if (data?.remaining != null) {
      throw new Error(`Amount exceeds remaining reversible (£${data.remaining})`);
    }
    throw new Error(data?.error || 'Reverse payment failed');
  }

  return data;
}



    /* ---------- CSV download with auth header ---------- */
    document.getElementById('csv').onclick = async () => {
      try {
        const res = await window.AppAuth.authenticatedFetch(`${API_ROOT}/export.csv?auction_id=${AUCTION_ID}`, {
          headers: { "X-CSRF-Token": token }
        });
        if (!res.ok) throw new Error('CSV fetch failed');
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `settlement-auction-${AUCTION_ID}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) { showMessage(e.message || e, 'error'); }
    };

/* ---------- summary modal ---------- */
document.getElementById('summaryBtn').onclick = async () => {
  const res = await window.AppAuth.authenticatedFetch(`${API_ROOT}/summary?auction_id=${AUCTION_ID}`, {
    headers:{ "X-CSRF-Token": token }
  });
  if (!res.ok) { showMessage('Cannot fetch summary', 'error'); return; }
  const s = await res.json();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card summary-modal-card" role="dialog" aria-modal="true" aria-labelledby="cashier-summary-title">
      <h3 id="cashier-summary-title" class="modal-title">Auction Summary</h3>
      <table class="summary-breakdown-table">
        <tbody>
          <tr><td>Total lots</td><td colspan="2">${currencySymbol}${s.lots_total.toFixed(2)}</td></tr>
          <tr><td>Paid total</td><td colspan="2">${currencySymbol}${s.payments_total.toFixed(2)}</td></tr>
          <tr><td>Donations total</td><td colspan="2">${currencySymbol}${s.donations_total.toFixed(2)}</td></tr>
          <tr><td>Expected grand total</td><td colspan="2">${currencySymbol}${Number(s.expected_grand_total || 0).toFixed(2)}</td></tr>
          <tr><td>Current grand total</td><td colspan="2">${currencySymbol}${Number(s.current_grand_total || 0).toFixed(2)}</td></tr>
          <tr class="summary-modal-group-title"><td colspan="3">By method</td></tr>
          <tr class="summary-column-headings"><th>Method</th><th>Paid</th><th>Donation</th></tr>
          ${Object.entries(s.breakdown).map(([m,v])=>`<tr><td>${m}</td><td>${currencySymbol}${Number(v.payments_total || 0).toFixed(2)}</td><td>${currencySymbol}${Number(v.donations_total || 0).toFixed(2)}</td></tr>`).join('')}
          <tr class="summary-modal-total"><td>Balance due</td><td colspan="2">${currencySymbol}${s.balance.toFixed(2)}</td></tr>
        </tbody>
      </table>
      <div class="summary-modal-actions"><button id="closeSum" class="secondary-button" type="button">Close</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const closeButton = overlay.querySelector('#closeSum');
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeButton.click();
    }
  });
  closeButton.onclick = ()=>overlay.remove();
  closeButton.focus();
};



  // polling
  window.addEventListener('cashier:show-pictures-changed', (event) => {
    showPictures = Boolean(event.detail?.showPictures);
    if (selBidder) {
      renderLots();
      persistBuyerDisplayState();
    }
  });
  editBidderNameBtn?.addEventListener('click', openBidderNameModal);
  void fetchCurrentUsername();
  fetchBidders();
  refreshPaymentButtons();
  loadPendingIntents();
  setInterval(fetchBidders,POLL_MS);
  setInterval(loadPendingIntents, 10000);
  setInterval(() => { void verifyAllPendingIntentsQuietly(); }, 10000);
})();
