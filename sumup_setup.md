# SumUp Payments – Server Operator Setup Guide

This document explains how SumUp payments are integrated into the Auction system and what a server operator needs to configure to make card payments work reliably.

The backend is coded defensively and does not handle card data directly, but most of the real security comes from how you run the server. Operate the app as a dedicated service user, lock down file permissions (especially `.env`, which should be readable only by the service), use strong and unique server/app passwords, keep the OS and packages patched, and enable basic hardening such as firewalls, SSH key auth, and restricted outbound access. Protect backups, monitor logs, and limit who can access the host; a secure server setup is the best way to protect payment-related operations.

To complete the steps in this guide, you will need to have access:
- to the backend server filesystem (VM / VPS / NAS)
- to the webserver configuration
- to the SumUp merchant account
---

## 1. Technical overview (how payments flow)

At a high level, SumUp payments follow this flow:

```
Payment initated on cashier page
   ↓
Payment intent created on server and sent to SumUp
   ↓
SumUp provides a checkout link to the backend
   ↓
Web page opens SumUp checkout link - opens SumUp app or website
   ↓
Customer completes payment in SumUp
   ↓
SumUp sends response back to your server
   ↓
Payment is finalised and recorded
```

More detail:

1. **Payment intent is created**
   - The backend creates a *payment intent* record in the database.
   - This represents “we intend to take £X from bidder Y”.
   - At this point, **no money has moved**.

2. **Backend asks SumUp to generate a Checkout link**
   - For **web payments**, the backend generates a **hosted checkout URL**.
   - For **card-present / app payments**, the backend generates a **deeplink** that opens the SumUp app.
   - The (random) intent ID is embedded as a reference so the payment can be matched later.

3. **Payment is completed in SumUp**
   - The customer pays using the SumUp-hosted page or SumUp app.
   - SumUp processes the transaction independently.

4. **SumUp calls back to your server**
   - After payment, SumUp sends server-to-server confirmation back to your server:
     - A **POST webhook** for web payments
     - A **GET callback** for app payments
   - These requests tell the backend whether the payment succeeded or failed.
   - If a response fails to appear, the backend silently times out the payment intent and the process stops here.

5. **Payment is finalised**
   - The backend verifies the intent and SumUp transaction.
   - A payment row is created in the database.
   - The bidder’s balance updates automatically.

> **Important:**  
> No personal or payment information touches the backend server or any connection we initiate (apart from the 
> amount and the intent ID which ties it back to the bidder)
> Payments are not recorded until positive confimation from SumUp

---

## 2. SumUp merchant account prerequisites

The SumUp account must be configured before setting up this app.

Decide which checkout types you want (app or web based - either or both are supported)

### 2.1 Create an App / Affiliate key

Below are general instructions. It is suggested that you review the SumUp documentation

In the SumUp developer dashboard:

1. Create a **new App**
2. Generate an **Affiliate Key**
3. Define at least one **Application ID** (string value)
   - This must match the `app-id` passed in deeplinks
   - The value itself can be arbitrary, but it must match exactly

For app-based checkout you will need:
- **Affiliate Key**
- **Application ID**

For web-based checkout you will need:
- **API Key**
- **Merchant Code**

These values must be kept confidential. Do not share them unncesserially as they allow access into your merchant account
---

## 3. Environment variables (.env configuration)

The backend reads SumUp configuration from environment variables.

### 3.1 Required variables

Populate these in your `auction.env` file (see auction.env.example for a template)

```env
# SumUp: API for online payments
SUMUP_API_KEY=sup_sk_xxxxxxx
SUMUP_MERCHANT_CODE=Mxxxxxxx
SUMUP_RETURN_URL=https://yoursite.com/payments/sumup/webhook


# SumUp: for deep link (card-present)
SUMUP_AFFILIATE_KEY=sup_afk_xxxxxxxxxx
SUMUP_APP_ID=YourAppID
SUMUP_CALLBACK_SUCCESS=https://yoursite.com/payments/sumup/callback/success
SUMUP_CALLBACK_FAIL=https://yoursite.com/payments/sumup/callback/fail

# SumUp: Other config items
PAYMENT_INTENT_TTL_MINUTES=20
CURRENCY=GBP
SUMUP_WEB_ENABLED=true
SUMUP_CARD_PRESENT_ENABLED=true
```

Notes:

- If a payment method is enabled, the related fields must be populated
- All URLs **must be HTTPS**
- Certificates **must be valid and not expired**
- These URLs must be reachable from the public internet

### 3.2 What each URL is used for

| Variable | Method | Purpose |
|--------|--------|---------|
| `SUMUP_RETURN_URL` | POST (*) | Main webhook used by SumUp to confirm payment outcome |
| `SUMUP_CALLBACK_SUCCESS` | GET | Browser/app redirect after a successful payment |
| `SUMUP_CALLBACK_FAIL` | GET | Browser/app redirect after a failed payment |

(*) For diagnostics, the same endpoint also supports **GET** requests returning a simple status message.

The POST webhook is the most important one for correct payment recording.

---

## 4. Server routing requirements (Apache example)

SumUp must be able to reach your backend routes from the internet.

This example assumes the following routing. Note that the backend endpoints are hard-coded

| Variable | URL | Backend Endpoint |
|---------|-------|-----------------|
| SUMUP_CALLBACK_SUCCESS | https://yoursite.com/payments/sumup/callback/success | /payments/sumup/callback |
| SUMUP_CALLBACK_FAIL | https://yoursite.com/payments/sumup/callback/fail | /payments/sumup/callback |
| SUMUP_RETURN_URL | https://yoursite.com/payments/sumup/webhook | /payments/sumup/webhook | 

- URLs as above
- Apache on port 443 (HTTPS)
- Node.js backend listening on localhost (e.g. port 3000)
- Apache acting as a reverse proxy


### 4.1 Example Apache configuration

```apache
<VirtualHost *:443>
    ServerName yourdomain.example

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/yourdomain.example/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/yourdomain.example/privkey.pem

    ProxyPreserveHost On
    ProxyRequests Off

    # Backend API proxy
    ProxyPass /api/ http://127.0.0.1:3000/
    ProxyPassReverse /api/ http://127.0.0.1:3000/

    # SumUp webhook for web payments - Note the placement of trailing '/'
    ProxyPass /payments/sumup/webhook http://localhost:3000/payments/sumup/webhook/
    ProxyPassReverse /payments/sumup/webhook http://localhost:3000/payments/sumup/webhook/

    # SumUp webhook for app payments - Note the placement of trailing '/'
    ProxyPass /payments/sumup/callback/ http://localhost:3000/payments/sumup/callback/
    ProxyPassReverse /payments/sumup/callback/ http://localhost:3000/payments/sumup/callback/

    # Optional: proxy other app routes as needed
</VirtualHost>
```

### 4.2 Verifying routing

Once configured, each endpoint as **exactly written** in your .env config **must** work from the public internet.

The backend will respond with a test page confirming that the route worked. Any errors (certs etc) will prevent SumUp making a connection.
This can be tested from the maintenance page "payments" subsection.

Once you have confirmed connection, it is recommended to run a live test. Initiate a payment through the app and then cancel (either in the app or by cancelling on the reader itself. This will provoke a "fail" response which will cause the backend to display a message in the browser). If this works, the next step is to make a small (real) transaction and check that it is recorded on the cashier page. The payment can subsequently be refunded from your merchant account.

SumUp supports sandbox accounts for web checkouts but not app payments. If using a sandbox account, it is easy to simulate web payments using one of the publicly listed test credit card numbers. Note that failing to complete a web checkout (e.g. by failing to submit the payment) does not return anything to your server - This doesn't cause an issue as the payment intent will time out and expire automatically.

## 7. Operational recommendations

- Monitor SSL certificate expiry (this is the most common real-world failure)
- Use the maintenance UI / diagnostics to confirm reachability after changes

## 8. Summary

To enable SumUp payments successfully, the server operator must:

1. Configure SumUp merchant account
2. Populate required `.env` variables
3. Ensure HTTPS is correctly configured and kept valid
4. Proxy SumUp callback routes to the backend
5. Verify public reachability of webhook and callback endpoints
