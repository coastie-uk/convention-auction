
(()=>{
  //  const API = "https://drive.icychris.co.uk";
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

  const money = v => `£${Number(v).toFixed(2)}`;

  const urlParams  = new URLSearchParams(location.search);
  const AUCTION_ID = Number(urlParams.get('auctionId'));
  
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

            // Check for 403 (unauthorized)
        // if (res.status === 403) {
        //     showMessage("Session expired. Please log in again.", "info");
        //     localStorage.removeItem("cashierToken");
        //     setTimeout(() => {
        //         window.location.reload();
        //     }, 1500);
        //     return;
        // }

    renderBidders();
    if(selBidder){
      const updated = bidders.find(b=>b.id===selBidder.id);
      if(updated) selectBidder(updated);
    }
  }

  function renderBidders(){
    bidderBody.innerHTML='';
    sortBidders(bidders).forEach(b=>{
      const tr=document.createElement('tr');
      tr.className='bidder-row'+(b.balance===0?' bidder-paid':'');
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

  function renderPayments(){
    payBody.innerHTML='';
    (selBidder.payments||[]).forEach(p=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${new Date(p.created_at).toLocaleTimeString()}</td><td>${p.method}</td><td>${money(p.amount)}</td><td><button data-id="${p.id}" class="delPay">✕</button></td>`;
      payBody.appendChild(tr);
    });
    payBody.querySelectorAll('.delPay').forEach(btn=>{
      btn.onclick=()=>delPayment(btn.dataset.id);
    });
  }

  function updateTotals(){
    const o=selBidder;
    document.getElementById('totals').innerHTML=`<strong>Lots:</strong> ${money(o.lots_total)} &nbsp; <strong>Paid:</strong> ${money(o.payments_total)} &nbsp; <strong>Balance:</strong> ${money(o.balance)}`;
    document.getElementById('payButtons').classList.toggle('disabled',o.balance===0);
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

  async function delPayment(id) {
  //  if (!confirm('Delete payment?')) return;

       const modal = await DayPilot.Modal.confirm("Are you sure you want to delete this payment?");
        if (modal.canceled) {
            showMessage("Payment not deleted", "info");
            return;
        } else { 

    try {

      const response = await fetch(`${API_ROOT}/payment/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          auctionId: AUCTION_ID
        })

      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete payment");
      }

       showMessage("Payment deleted", "info");

    } catch (err) {
      showMessage("Payment error " + err.message, "error");
    }

    fetchBidders();
  }
  }

  // CSV
  // document.getElementById('csv').onclick=()=>{ window.location.href=`${API_ROOT}/export.csv?auction_id=${AUCTION_ID}`; };

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
        <tr><td>Total lots</td>         <td style="text-align:right;">£${s.lots_total.toFixed(2)}</td></tr>
        <tr><td>Paid total</td>         <td style="text-align:right;">£${s.payments_total.toFixed(2)}</td></tr>
        <tr><td style="padding-top:4px;" colspan="2"><strong>By method</strong></td></tr>
        ${Object.entries(s.breakdown).map(([m,v])=>`<tr><td>${m}</td><td style="text-align:right;">£${v.toFixed(2)}</td></tr>`).join('')}
        <tr><td style="padding-top:6px;"><strong>Balance due</strong></td>
            <td style="text-align:right;"><strong>£${s.balance.toFixed(2)}</strong></td></tr>
      </table>
      <div style="text-align:right;margin-top:10px;"><button id="closeSum">Close</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#closeSum').onclick = ()=>overlay.remove();
};



  // polling
  fetchBidders();
  setInterval(fetchBidders,POLL_MS);
})();
