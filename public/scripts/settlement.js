
(()=>{
const API = "/api"

const API_ROOT = `${API}/settlement`;
  const POLL_MS  = 5000;
  let token = localStorage.getItem('cashierToken');

  let bidders = [];
  let selBidder = null;

  const bidderBody = document.querySelector('#bidderTable tbody');
  const lotsBody   = document.querySelector('#lotsTable tbody');
  const payBody    = document.querySelector('#payTable tbody');
  const detailBox  = document.getElementById('detail');
  const titleEl    = document.getElementById('title');
  const currencySymbol = localStorage.getItem("currencySymbol") || "£";
  const money = v => `${currencySymbol}${Number(v).toFixed(2)}`;

  const urlParams  = new URLSearchParams(location.search);
  const AUCTION_ID = Number(urlParams.get('auctionId'));
  const AUCTION_STATUS = (urlParams.get('auctionStatus') || '').toLowerCase();

  if (!Number.isInteger(AUCTION_ID) || AUCTION_ID <= 0) {
    alert('This page must be opened with ?auctionId=<number>');

    throw new Error('auctionId missing');     // halt script
  }



  function sortBidders(arr){
    return arr.slice().sort((a,b)=>{
      if(a.balance===0 && b.balance!==0) return 1;
      if(b.balance===0 && a.balance!==0) return -1;
      return a.paddle_number - b.paddle_number;
    });
  }

  async function fetchBidders(){
    const res = await fetch(`${API_ROOT}/bidders?auction_id=${AUCTION_ID}`, { headers:{ Authorization:token }});
    bidders = await res.json();

    renderBidders();
    if(selBidder){
      const updated = bidders.find(b=>b.id===selBidder.id);
      if(updated) selectBidder(updated);
    }
  }


// Enable or disable payment buttons based on backend config

async function refreshPaymentButtons() {
  const buttons = document.querySelectorAll('#payButtons button[data-method]');

  if (!buttons.length) {
    console.warn('[payments] No payment buttons found under #payButtons');
    return;
  }

  try {
    const res = await fetch(`${API_ROOT}/payment-methods`, { headers: { Authorization: token } });

    if (!res.ok) {
      console.error('[payments] Failed to fetch payment methods:', res.status, res.statusText);
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
      console.error('[payments] Unexpected payload for payment methods:', data);
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


    console.info('[payments] Payment buttons updated from backend config:', methods);
  } catch (err) {
    console.error('[payments] Error while loading payment methods:', err);
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
      if(selBidder&&selBidder.id===b.id) tr.classList.add('sel');
      bidderBody.appendChild(tr);
    });



  }

  async function selectBidder(b){
    selBidder=null;
    renderBidders();
    if(!b){ detailBox.style.display='none'; titleEl.textContent='Select a bidder…'; return; }

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

    if(!res.ok){ alert('Could not load bidder'); return; }
    selBidder = await res.json();

    renderBidders();

    titleEl.textContent=`Paddle #${selBidder.paddle_number}`;
    detailBox.style.display='block';

    renderLots();
    renderPayments();
    

    if (AUCTION_STATUS === 'settlement') {
document.getElementById('payButtons').classList.remove('disabled');
document.querySelectorAll('#payButtons button').forEach(btn => btn.disabled = false);
document.querySelectorAll('#delPay button').forEach(btn => btn.disabled = false);
// console.log("buttons enabled");

  } else {
  
document.querySelectorAll('#payButtons button').forEach(btn => btn.disabled = true);
document.querySelectorAll('#delPay button').forEach(btn => btn.disabled = true);
document.getElementById('payButtons').classList.add('disabled');
  }

updateTotals();

  }

  function renderLots(){
    lotsBody.innerHTML='';
    (selBidder.lots||[]).forEach(l=>{

    const prc = l.test_bid != null ? `${money(l.hammer_price)} <b>[T]</b>` : money(l.hammer_price);
    const desc = l.test_item != null ? `${l.description} <b>[T]</b>` : l.description;

      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${l.item_number}</td><td>${desc}</td><td>${prc}</td>`;
      lotsBody.appendChild(tr);
    });
  }

  function renderPayments() {
    payBody.innerHTML = '';
    (selBidder.payments || []).forEach(p => {
      const tr = document.createElement('tr');
      if (p.amount < 0) {
        tr.innerHTML = `<td>${p.id}</td><td>${new Date(p.created_at).toLocaleString()}</td><td>${p.method}</td><td>${money(p.amount)}</td><td>${p.note}</td>`;
      } else {
        tr.innerHTML = `<td>${p.id}</td><td>${new Date(p.created_at).toLocaleString()}</td><td>${p.method}</td><td>${money(p.amount)}</td><td>${p.note}</td><td><button data-id="${p.id}" class="delPay">Refund</button></td>`;
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
    document.getElementById('totals').innerHTML=`<strong>Lots:</strong> ${money(o.lots_total)} &nbsp; <strong>Paid:</strong> ${money(o.payments_total)} &nbsp; <strong>Balance:</strong> ${money(o.balance)}`;
    document.getElementById('payButtons').classList.toggle('disabled',o.balance===0);
  }



  

  // ---------- SumUp integration helper ----------
  async function startSumupPayment(amt, note, mode = 'app') {
    if (!selBidder) {
      alert('No bidder selected');
      return;
    }

    const amountMinor = Math.round(Number(amt) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      alert('Invalid amount for SumUp payment');
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


      if (typeof showMessage === 'function') {
        showMessage(
          'SumUp payment started. Complete the card payment in the SumUp app, then refresh to see the updated balance.',
          'info'
        );
      } else {
        console.log('SumUp payment started for bidder', selBidder.id);
      }

    } catch (err) {
      if (typeof showMessage === 'function') {
        showMessage('SumUp error: ' + err.message, 'error');
      } else {
        alert('SumUp error: ' + err.message);
      }
    }
  }

// async function makePaymentRequest(amt,note) {
// // TODO remove currency as this is configured on the backend
// const currency = 'GBP';
// const method = 'sumup-app';
// const auctionId = AUCTION_ID;
// const bidderId = selBidder.id

//   // Basic front-end validation to fail fast
//   if (!auctionId || !bidderId) {
//     throw new Error('auctionId and bidderId are required to create a payment request');
//   }

//   const numericAmount = Number(amt);
//   if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
//     throw new Error(`Invalid amount "${amt}" for payment request`);
//   }

//   const payload = {
//     auction_id: auctionId,
//     bidder_id: bidderId,
//     amount: numericAmount,
//     currency,
//     method,
//     note: note || null
//   };

//   let response;
//   try {
//     response = await fetch(`${API}/payments/payment-requests`, {
//       method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           Authorization: token   
//         },
//       body: JSON.stringify(payload)
//     });
//   } catch (err) {
//     console.error('Network error creating payment request', err);
//     throw new Error('Network error while creating payment request');
//   }

//   if (!response.ok) {
//     let msg = `Server error (${response.status})`;
//     try {
//       const errBody = await response.json();
//       if (errBody && errBody.error) {
//         msg = errBody.error;
//       }
//     } catch {
//       // ignore JSON parse errors, keep default message
//     }
//     console.warn('Backend rejected payment request:', msg);
//     throw new Error(`Failed to create payment request: ${msg}`);
//   }

//   const data = await response.json();
//   if (!data || !data.payment_request) {
//     console.error('Unexpected backend payload for payment request', data);
//     throw new Error('Backend returned an unexpected response when creating payment request');
//   }

//   return data.payment_request;
// }


function openRefundModal(id){
    const tpl=document.getElementById('refundTpl').content.cloneNode(true);
    const overlay=tpl.firstElementChild;document.body.appendChild(overlay);
    overlay.querySelector('#modalTitle').textContent=`Apply refund for payment ID ${id}`;
    const amtIn=overlay.querySelector('#amt');
    amtIn.value=0.00;

overlay.querySelector('#amt').focus();

    overlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
  if (e.key === 'Enter')  { e.preventDefault(); ok.click();     }
});
    
    overlay.querySelector('#cancel').onclick=()=>overlay.remove();
    overlay.querySelector('#ok').onclick=async()=>{
      const amt=Number(amtIn.value);
        if(!amt)return alert('Amount?');
      const reason=overlay.querySelector('#note').value;

       const modal = await DayPilot.Modal.confirm("Confirm refund of " + money(amt) + " for payment ID " + id + "?");
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
  document.querySelectorAll('#payButtons button').forEach(btn=>{
    btn.onclick=()=>openPayModal(btn.dataset.method);
  });

  function openPayModal(method){
    const tpl=document.getElementById('payTpl').content.cloneNode(true);
    const overlay=tpl.firstElementChild;document.body.appendChild(overlay);
    overlay.querySelector('#modalTitle').textContent=`Add ${method} payment`;
    const amtIn=overlay.querySelector('#amt');
    amtIn.value=selBidder.balance.toFixed(2);

overlay.querySelector('#amt').focus();

    overlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
  if (e.key === 'Enter')  { e.preventDefault(); ok.click();     }
});
    
    overlay.querySelector('#cancel').onclick=()=>overlay.remove();
    overlay.querySelector('#ok').onclick=async()=>{
      const amt=Number(amtIn.value);
        if(!amt)return alert('Amount?');
      const note=overlay.querySelector('#note').value;

      // NEW: SumUp branch
  if (method === 'sumup-app') {
    await startSumupPayment(amt, note, 'app');
    overlay.remove();
    return;
  }

  if (method === 'sumup-web') {
    await startSumupPayment(amt, note, 'web');
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


  // async function delPayment(id) {
  

  //      const modal = await DayPilot.Modal.confirm("Are you sure you want to delete this payment?");
  //       if (modal.canceled) {
  //           showMessage("Payment not deleted", "info");
  //           return;
  //       } else { 

  //   try {

  //     const response = await fetch(`${API_ROOT}/payment/${id}`, {
  //       method: 'DELETE',
  //       headers: {
  //         Authorization: token,
  //         "Content-Type": "application/json"
  //       },
  //       body: JSON.stringify({
  //         auctionId: AUCTION_ID
  //       })

  //     });

  //     if (!response.ok) {
  //       const error = await response.json();
  //       throw new Error(error.error || "Failed to delete payment");
  //     }

  //      showMessage("Payment deleted", "info");

  //   } catch (err) {
  //     showMessage("Payment error " + err.message, "error");
  //   }

  //   fetchBidders();
  // }
  // }


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
      } catch (e) { alert(e.message || e); }
    };

/* ---------- summary modal ---------- */
document.getElementById('summaryBtn').onclick = async () => {
  const res = await fetch(`${API_ROOT}/summary?auction_id=${AUCTION_ID}`, {
    headers:{ Authorization: token }
  });
  if (!res.ok) { alert('Cannot fetch summary'); return; }
  const s = await res.json();

  const overlay = document.createElement('div');
  overlay.style = 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;justify-content:center;align-items:center;z-index:9999;';
  overlay.innerHTML = `
    <div style="background:#fff;padding:22px 26px;border-radius:8px;width:340px;">
      <h3>Auction Summary</h3>
      <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
        <tr><td>Total lots</td>         <td style="text-align:right;">${currencySymbol}${s.lots_total.toFixed(2)}</td></tr>
        <tr><td>Paid total</td>         <td style="text-align:right;">${currencySymbol}${s.payments_total.toFixed(2)}</td></tr>
        <tr><td style="padding-top:4px;" colspan="2"><strong>By method</strong></td></tr>
        ${Object.entries(s.breakdown).map(([m,v])=>`<tr><td>${m}</td><td style="text-align:right;">${currencySymbol}${v.toFixed(2)}</td></tr>`).join('')}
        <tr><td style="padding-top:6px;"><strong>Balance due</strong></td>
            <td style="text-align:right;"><strong>${currencySymbol}${s.balance.toFixed(2)}</strong></td></tr>
      </table>
      <div style="text-align:right;margin-top:10px;"><button id="closeSum">Close</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#closeSum').onclick = ()=>overlay.remove();
};



  // polling
  fetchBidders();
  refreshPaymentButtons();
  setInterval(fetchBidders,POLL_MS);
})();
