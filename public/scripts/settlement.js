
(()=>{
const API = "/api"

const API_ROOT = `${API}/settlement`;
  const POLL_MS  = 5000;
  const BUYER_DISPLAY_STATE_KEY = 'cashierBuyerDisplayState';
  let token = localStorage.getItem('cashierToken');
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
  const titleEl    = document.getElementById('title');
  const fingerprintDisplay = document.getElementById('fingerprintDisplay');
  const toggleFingerprintBtn = document.getElementById('toggleFingerprintBtn');
  const printReceiptBtn = document.getElementById('printReceiptBtn');
  const currencySymbol = localStorage.getItem("currencySymbol") || "£";
  const money = v => `${currencySymbol}${Number(v).toFixed(2)}`;
  const roundCurrency = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const uploadBase = "/api/uploads";
  let currentUsername = 'unknown';
  let fingerprintVisible = false;
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
      const res = await fetch(`${API}/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token })
      });
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
      showPictures,
      selectedBidder: selBidder
        ? {
            paddle_number: selBidder.paddle_number,
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
    <div class="bidder-number">${escapeHtml(bidder.paddle_number)}</div>

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
    const res = await fetch(`${API_ROOT}/bidders?auction_id=${AUCTION_ID}`, { headers:{ Authorization:token }});
    bidders = await res.json();

    renderBidders();
    if(selBidder){
      const updated = bidders.find(b=>b.id===selBidder.id);
      if(updated) {
        await selectBidder(updated, { preserveUiState: true });
      } else {
        selectBidder(null, { preserveUiState: true });
      }
      return;
    }
    persistBuyerDisplayState();
  }


// Enable or disable payment buttons based on backend config

async function refreshPaymentButtons() {
  const buttons = document.querySelectorAll('#payButtons button[data-method]');

  if (!buttons.length) {

    return;
  }

  try {
    const res = await fetch(`${API_ROOT}/payment-methods`, { headers: { Authorization: token } });

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


  } catch (err) {
    showMessage(`[payments] Error while loading payment methods: ${err}`, "error");
    // Conservative: disable everything if something goes wrong
    const buttons = document.querySelectorAll('#payButtons button[data-method]');
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('disabled');
    });
  }
}

  
  function renderBidders(){
   
    bidderBody.innerHTML='';
    sortBidders(bidders).forEach(b=>{
      const tr=document.createElement('tr');
      tr.className='bidder-row'+(b.balance===0?' bidder-paid':'');
      if(b.balance<0) tr.classList.add('bidder-negative');
      tr.dataset.id=b.id;
      tr.innerHTML=`<td>${b.paddle_number}</td><td>${money(b.balance)}</td>`;
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
      renderBidders();
      detailBox.style.display='none';
      if (emptyDetailEl) emptyDetailEl.style.display = 'block';
      titleEl.textContent='Select a bidder...';
      fingerprintVisible = false;
      if (lotsTotalEl) lotsTotalEl.textContent = '';
      updateFingerprintDisplay();
      persistBuyerDisplayState();
      return;
    }

    selectedBidderId = b.id;
    renderBidders();

    const res = await fetch(`${API_ROOT}/bidders/${b.id}?auction_id=${AUCTION_ID}`, { headers:{ Authorization:token }});

            // Check for 403 (unauthorized)
        if (res.status === 403) {
            showMessage("Session expired. Please log in again.", "info");
            localStorage.removeItem("cashierToken");
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
    selBidder = await res.json();
    selectedBidderId = selBidder.id;
    if (!preserveUiState) fingerprintVisible = false;

    renderBidders();

    titleEl.textContent=`Paddle #${selBidder.paddle_number}`;
    if (emptyDetailEl) emptyDetailEl.style.display = 'none';
    detailBox.style.display='block';

    renderLots();
    renderPayments();
    

    if (AUCTION_STATUS === 'settlement') {
document.getElementById('payButtons').classList.remove('disabled');
document.querySelectorAll('#payButtons button[data-method]').forEach(btn => btn.disabled = false);
document.querySelectorAll('.delPay').forEach(btn => btn.disabled = false);
updatePaymentStateTooltip(true);


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
    lots.forEach(l=>{

    const prc = l.test_bid != null ? `${money(l.hammer_price)} <b>[T]</b>` : money(l.hammer_price);
    const desc = l.test_item != null ? `${l.description} <b>[T]</b>` : l.description;
    const photoUrl = l.photo_url || l.photoUrl || l.photo || '';

      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${l.item_number}</td><td>${desc}</td><td>${prc}</td>`;
      if (photoUrl) tr.dataset.photoUrl = photoUrl;
      else delete tr.dataset.photoUrl;
      lotsBody.appendChild(tr);
    });

    if (lotsPreviewStripEl) {
      const pictureLots = lots.filter(l => l.photo_url || l.photoUrl || l.photo || '');
      const previewLots = showPictures ? pictureLots.slice(0, 6) : [];
      const remainingCount = showPictures ? Math.max(0, pictureLots.length - previewLots.length) : 0;
      lotsPreviewStripEl.innerHTML = '';

      previewLots.forEach((lot) => {
        const photoUrl = lot.photo_url || lot.photoUrl || lot.photo || '';
        const figure = document.createElement('figure');
        figure.className = 'lot-preview-thumb';
        figure.innerHTML = `
          <img src="${uploadBase}/preview_${photoUrl}" alt="Lot ${lot.item_number} preview" loading="lazy">
          <figcaption>Lot ${lot.item_number}</figcaption>`;
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
      if (p.amount < 0) {
        tr.innerHTML = `<td>${p.id}</td><td>${new Date(p.created_at).toLocaleString()}</td><td>${formatPaymentMethod(p.method)}</td><td>${money(p.amount)}</td><td>${paymentNote}</td><td></td>`;
      } else {
        tr.innerHTML = `<td>${p.id}</td><td>${new Date(p.created_at).toLocaleString()}</td><td>${formatPaymentMethod(p.method)}</td><td>${money(p.amount)}</td><td>${paymentNote}</td><td><button data-id="${p.id}" class="delPay refund-button">Refund</button></td>`;
      }
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



  

  // ---------- SumUp integration helper ----------
  async function startSumupPayment(amt, donation, note, mode = 'app') {
    if (!selBidder) {
      showMessage('No bidder selected', 'error');
      return;
    }

    const paymentAmount = roundCurrency(amt);
    const donationAmount = roundCurrency(donation);
    const amountMinor = Math.round(Number(paymentAmount) * 100);
    const donationMinor = Math.round(Number(donationAmount) * 100);
    if (!Number.isFinite(amountMinor) || !Number.isFinite(donationMinor) || amountMinor < 0 || donationMinor < 0 || (amountMinor === 0 && donationMinor === 0)) {
      showMessage('Invalid amount for SumUp payment', 'error');
      return;
    }

    try {
      const response = await fetch(`${API}/payments/intents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token   
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
        try {
          const errJson = await response.json();
          if (errJson && errJson.error) msg = errJson.error;
        } catch (_) { /* ignore JSON parse errors */ }
        throw new Error(msg);
      }

      const data = await response.json();
      const deepLink   = data.deep_link || null;
      const hostedLink = data.hosted_link || null;
      const url = deepLink || hostedLink;

      if (!url) {
        throw new Error('Backend did not return a SumUp checkout URL.');
      }

      // If this is a SumUp app deep link, this will jump into the app on a tablet/phone.
      // If it’s a hosted checkout URL, it will open in a new tab.
     window.open(url, '_blank', 'noopener');


  
        showMessage(
          'SumUp payment started. Complete the card payment in the SumUp app, then refresh to see the updated balance.',
          'info'
        );

    } catch (err) {

        showMessage('SumUp error: ' + err.message, 'error');
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
    btn.onclick=()=>openPayModal(btn.dataset.method);
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

  function openPayModal(method){
    const tpl=document.getElementById('payTpl').content.cloneNode(true);
    const overlay=tpl.firstElementChild;document.body.appendChild(overlay);
    overlay.querySelector('#modalTitle').textContent=`Add ${method} payment`;
    const amtIn=overlay.querySelector('#amt');
    const donationIn = overlay.querySelector('#donation');
    const balanceDue = roundCurrency(selBidder.balance || 0);
    amtIn.value=Math.max(0, balanceDue).toFixed(2);
    donationIn.value='0.00';

overlay.querySelector('#amt').focus();
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
    await startSumupPayment(amt, donation, note, 'app');
    overlay.remove();
    return;
  }

  if (method === 'sumup-web') {
    await startSumupPayment(amt, donation, note, 'web');
    overlay.remove();
    return;
  }

  // if (method === 'sumup-indirect') {
  //   await makePaymentRequest(amt, note);
  //   overlay.remove();
  //   return;
  // }

     try {
      const response = await fetch(`${API_ROOT}/payment/${AUCTION_ID}`,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          Authorization:token},
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
  const res = await fetch(`${API_ROOT}/payment/${paymentId}/reverse`, {
    method: 'POST',
    headers: {
          Authorization: token,
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
        const res = await fetch(`${API_ROOT}/export.csv?auction_id=${AUCTION_ID}`, {
          headers: { Authorization: token }
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
  const res = await fetch(`${API_ROOT}/summary?auction_id=${AUCTION_ID}`, {
    headers:{ Authorization: token }
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
  void fetchCurrentUsername();
  fetchBidders();
  refreshPaymentButtons();
  setInterval(fetchBidders,POLL_MS);
})();
