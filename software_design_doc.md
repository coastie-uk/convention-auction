# Convention Auction — Design Document

## Goals / scope

This document describes the project’s architecture and, **for each end‑user frontend function**, documents:

- The **UI / script flow**
- The **backend endpoint(s)** involved (as called by the browser, i.e. under the `/api` prefix)
- The **data flows** (SQLite tables + filesystem side effects)

It is written from the perspective of the code currently in this repo (`backend/` + `public/`). Current version 2.1.0.

Disclosure: This document was written entirely by ChatGPT 5.2 (and subsequently proof read).

> Note on paths: the frontend calls endpoints as `/api/<route>`. The Node/Express backend implements routes as `/<route>` and is typically deployed behind a reverse proxy that maps `/api/*` → backend.

---

## Roles and UI surfaces

| Role | Frontend surface | Purpose |
|---|---|---|
| Public | `public/index.html` | Submit auction items (optionally with photo). |
| Admin | `public/admin/index.html` | Manage items + run exports; record bids during live auction. |
| Cashier | `public/cashier/index.html` | View live sales feed; take payments during settlement. |
| Maintenance | `public/maint/index.html` | Backups, imports/exports, auction management, configs, logs, etc. |
| Slideshow | `public/slideshow/index.html` | Auto‑refreshing in‑venue slideshow of item photos + text. |

---

## High-level architecture

### Frontend

- Static HTML/CSS/JS served from `public/`.
- Each “panel” is a separate page with a single JS bundle in `public/scripts/`.
- State stored in browser storage:
  - `localStorage`: JWTs, last selected auction, slideshow config, currency symbol.
  - `sessionStorage`: admin item sort preferences, selected auction id.

### Backend

- Node.js + Express entrypoint: `backend/backend.js`
- SQLite via `better-sqlite3`: `backend/db.js`
- Authentication via JWT (`Authorization` header) with role claims:
  - `admin`, `maintenance`, `cashier`, `slideshow`
  - Tokens also include `username` and the user’s full assigned role set.
- Auction state gating via middleware `backend/middleware/checkAuctionState.js`:
  - State machine: `setup → locked → live → settlement → archived`

### Storage

- SQLite database file (configured in `backend/config.js`/`backend/config.json`).
- Uploaded images stored on disk in `UPLOAD_DIR`:
  - Original upload filename is replaced with a UUID.
  - Stored item photo is typically `resized_<uuid>.jpg`.
  - Preview image is `preview_<resized_name>.jpg` (used throughout the UI).
- Config / resource assets stored in `CONFIG_IMG_DIR` and served as `/api/resources/<filename>`.
- Temporary outputs (PPTX/CSV) written to `OUTPUT_DIR` and sent as downloads.

---

## Backend architecture (Express pipeline + mounted routes)

This section describes how an HTTP request is processed by the backend, and how the backend is assembled from route modules.

### Request lifecycle (high level)

1. **Express app boot**: `backend/backend.js` loads configuration (`backend/config.js`), initialises logging, opens SQLite (`backend/db.js`), and sets up Express middleware and routes.
2. **Generic middleware**:
   - JSON parsing: `express.json()` plus a JSON parse error handler that returns `400` for invalid JSON.
   - URL-encoded parsing: `express.urlencoded()` and `body-parser` URL encoding (legacy compatibility).
   - Optional CORS: enabled/disabled by config; rejected origins return `403`.
3. **Maintenance lock gate**:
   - A global middleware returns `503` (`{ error: 'Database maintenance in progress' }`) while `db.isMaintenanceLocked()` is true.
   - Requests under `/maintenance/*` bypass this gate so maintenance endpoints can perform DB operations (backup/restore/etc).
4. **Route matching**:
   - Express matches the request path to a specific handler or mounted router.
   - Authentication and state gating are applied per-route (see below).
5. **Handler logic**:
   - DB reads/writes via the `db` wrapper (better-sqlite3 underneath).
   - Filesystem reads/writes for uploads (`UPLOAD_DIR`), resources (`CONFIG_IMG_DIR`), and generated outputs (`OUTPUT_DIR`).
   - Most meaningful actions also call `audit(...)` to append to `audit_log`.
6. **Errors**:
   - Per-route errors are typically returned as JSON `{ error: ... }` with an appropriate HTTP status.
   - A final Express error handler returns `500 { error: "Server error" }` for unhandled exceptions.

### Cross-cutting middleware and helpers

- **Role authentication**: `backend/middleware/authenticateRole.js`
  - Expects a JWT string in the `Authorization` header.
  - On success sets `req.user` including `username`, active `role`, and assigned `roles`.
  - Enforced roles: `admin`, `maintenance`, `cashier`, `slideshow`.
- **Auction state guard**: `backend/middleware/checkAuctionState.js`
  - Resolves auction id from request (including `publicId`), loads `auctions.status`, and blocks if it’s not in the allowed set.
  - On success sets `req.auction = { id, status }`.
- **Input sanitisation**: `backend/middleware/sanitiseText.js` (used throughout to limit/clean text fields).
- **Audit logging**: `backend/middleware/audit.js`
  - `audit(user, action, object_type, object_id, details)` inserts into `audit_log`.
  - `recomputeBalanceAndAudit(...)` is used after payments to tag lots as “paid in full” / “part paid”.

### What routes are mounted (as seen by the frontend)

In production, the frontend calls these under `/api/*` (the backend itself generally registers them at `/*`).

Auth/session:
- `POST /validate` — validate JWT and return version info
- `POST /login` — username/password login selecting one assigned role
- `POST /change-password` — authenticated user changes own password

Core auction + item management (mostly admin-facing):
- `POST /validate-auction` — resolve short name and enforce public submission eligibility
- `POST /list-auctions` — list auctions (admin/cashier/maintenance)
- `POST /auction-status` — fetch a single auction’s status (admin)
- `POST /auctions/update-status` — update auction state (admin/maintenance)
- `POST /auctions/:publicId/newitem` — create item (public or admin)
- `GET /auctions/:auctionId/items` — list items in an auction (admin)
- `POST /auctions/:auctionId/items/:id/update` — update item (admin; setup/locked only)
- `POST /auctions/:auctionId/items/:id/move-auction/:targetAuctionId` — move item to another auction (admin; setup/locked only)
- `POST /auctions/:auctionId/items/:id/move-after/:after_id` — reorder items (admin; setup/locked only)
- `DELETE /items/:id` — delete item (admin; setup/locked only)
- `POST /rotate-photo` — rotate both full + preview image (admin)
- `POST /generate-pptx` / `POST /generate-cards` / `POST /export-csv` — admin exports
- `GET /auctions/:publicId/slideshow-items` — slideshow list (slideshow role)
- `GET /audit-log` — audit query endpoint (admin/maintenance)

“Phase 1 patch” (mounted via `require('./phase1-patch')(app)`):
- Mounted routers:
  - `/cashier/*` — live feed API (read-only)
  - `/settlement/*` — bidder summary + manual payment APIs
  - `/lots/*` — bid recording (“finalize”/“undo”) APIs

Payments (mounted via `app.use(paymentsApi)` from `backend/payments.js`):
- `/payments/*` — SumUp intent creation and callback/webhook handling

Maintenance (mounted via `app.use('/maintenance', authenticateRole('maintenance'), ...)`):
- `/maintenance/*` — backups, restore, import/export, auctions admin, resources, logs, generators, etc.

Static asset serving (backend-side):
- `GET /uploads/*` — serves uploaded images from `UPLOAD_DIR`
- `GET /resources/*` — serves resource files from `CONFIG_IMG_DIR` (logos, templates, etc.)

### Typical processing flows (examples)

- **Admin “update item”**:
  - `authenticateRole('admin')` validates JWT
  - `checkAuctionState(['setup','locked'])` enforces auction phase
  - `multer` handles optional file upload
  - handler updates `items` (+ filesystem if photo) and writes `audit_log`
- **Cashier “record payment”**:
  - `authenticateRole('cashier')` validates JWT
  - `checkAuctionState(['settlement'])` enforces settlement-only payments
  - handler inserts into `payments` and calls `recomputeBalanceAndAudit(...)`
- **Slideshow “load items”**:
  - `authenticateRole('slideshow')` validates JWT
  - `checkAuctionState([...])` resolves `publicId → auctionId` and ensures auction exists in an allowed state
  - handler reads `items` with photos and returns a minimal DTO for the slideshow

---

## Data model (SQLite)

Primary tables (see `backend/db.js`):

- `auctions`
  - `id` (numeric primary key)
  - `public_id` (public identifier used by public submission + slideshow)
  - `short_name`, `full_name`, `logo`, `status`
  - `admin_can_change_state` (gate for admin state changes)
- `items`
  - `auction_id`, `item_number`
  - `description`, `contributor`, `artist`, `notes`
  - `photo`, `date`, `mod_date`
  - `winning_bidder_id`, `hammer_price`
  - `test_item`, `test_bid` (test/training helpers)
- `bidders`
  - `auction_id`, `paddle_number`, `name`
- `payments`
  - `bidder_id`, `amount` (positive = payment, negative = refund)
  - `method`, `note`, `created_by`, `created_at`
  - SumUp metadata: `provider`, `provider_txn_id`, `intent_id`, `currency`, `raw_payload`
  - Reversal linkage: `reverses_payment_id`, `reversal_reason`
- `payment_intents`
  - `intent_id`, `bidder_id`, `amount_minor`, `currency`, `channel`, `status`, `expires_at`, `note`
  - `sumup_checkout_id` for hosted checkout flow
- `audit_log`
  - `user`, `action`, `object_type`, `object_id`, `details`, `created_at`
- `users`
  - `username`, `password` (bcrypt hash), `roles` (JSON array), `is_root`
  - Root is canonical (`username='root'`) and always has full permissions.

---

## API conventions used by the frontend

- **Auth**: JWT string stored in browser and sent in `Authorization` header.
- **Validation**: the UIs call `POST /api/validate` on load to reuse a stored token.
- **Auction identifiers**:
  - Admin/Cashier/Maintenance typically use numeric `auction_id` from `/api/list-auctions`.
  - Public submission + slideshow use `public_id` resolved via `POST /api/validate-auction`.
- **State gating**:
  - Item submission and editing are only allowed in `setup` and `locked`.
  - Bid recording is allowed in `live`/`settlement`.
  - Payments are allowed in `settlement`.

---

## Auction state machine

The auction lifecycle is represented by `auctions.status` (strings), and is enforced primarily by the `checkAuctionState()` middleware (`backend/middleware/checkAuctionState.js`). Frontends also enforce it via UI enable/disable logic, but the backend is the source of truth.

### States (what they mean in code)

| State | Intent | What the code allows / blocks |
|---|---|---|
| `setup` | Auction is being prepared; public can submit items. | **Public submission UI works** because `POST /api/validate-auction` accepts only `setup` for unauthenticated users, and `POST /api/auctions/:publicId/newitem` is allowed by `checkAuctionState(['setup','locked'])`. **Admin can create/edit/delete/move/reorder items** because item-modifying endpoints are gated to `setup`/`locked`. |
| `locked` | Freeze public submissions; still allow admin to clean up data before the live auction. | **Public submission UI is blocked** because `POST /api/validate-auction` rejects non-`setup` states unless a valid JWT is provided in `Authorization`. **Admin item management still works** (same `checkAuctionState(['setup','locked'])` gates). |
| `live` | Live auction running; bids are being recorded. | **Admin edits/deletes/moves are blocked** by backend gates (item mutation endpoints require `setup`/`locked`) and also disabled in the UI (`public/scripts/finalise-lot.js`). **Bid recording is enabled** via `POST /api/lots/:itemId/finalize` and `POST /api/lots/:itemId/undo` (both gated to `['live','settlement']`). **Cashier live feed polling** reads data regardless of state (no explicit state gate). |
| `settlement` | Auction is over; payments are taken and balances reconciled. | **Cashier payments are enabled**: manual payments (`POST /api/settlement/payment/:auctionId`) and reversals (`POST /api/settlement/payment/:paymentId/reverse`) are gated to `settlement`. **SumUp intent creation** (`POST /api/payments/intents`) is gated to `settlement`. **Bid undo / finalize** remains allowed (`['live','settlement']`) to support late corrections. |
| `archived` | Closed/read-only “historical” state. | **Admin item mutation remains blocked** (still only allowed in `setup`/`locked`). Read-only views (audit log, exports, slideshow, live feed) should continue to work if their endpoints don’t state-gate them. |

### Transitions (where they happen)

- Manual state changes:
  - `POST /api/auctions/update-status` updates `auctions.status`.
  - Admin is additionally gated by `auctions.admin_can_change_state`; maintenance can change state regardless.
- Automatic transition to settlement:
  - `POST /api/lots/:itemId/finalize` checks if any unsold lots remain; if none, it sets `auctions.status = 'settlement'` and returns `auction_status: 'settlement'`.

### Enforcement details / edge cases

- `checkAuctionState()` resolves the auction id from (in precedence order): `req.params.auctionId`, `req.body.auctionId` / `req.body.auction_id`, `req.params.id` (item id → auction id), or `req.params.publicId` (public id → auction id).
- Public submission is effectively “setup only” due to `POST /api/validate-auction` (even though `/auctions/:publicId/newitem` allows `locked` too). This is intentional as `locked` supports “admin-only intake”.
- Canonical auction statuses are: `["setup","locked","live","settlement","archived"]`.

---

## Frontend user functions

### 1) Public item submission (`public/index.html`, `public/scripts/script.js`)

#### 1.1 Select auction by short name (“auction gate”)

Flow:
1. User enters auction short name (or URL param `?auction=<short>`).
2. Frontend validates auction and loads branding.
3. Frontend shows the submission form.

Backend endpoints:
- `POST /api/validate-auction`
  - Request: `{ short_name }`
  - Response: `{ valid, short_name, full_name, logo, public_id }`

Data flows:
- Reads `auctions` by `short_name`.
- No writes.
- If `logo` is present, frontend later loads it as a static resource:
  - `GET /api/resources/<logo>`

#### 1.2 Upload/select/take a photo (client-side)

Flow:
1. User selects a file or captures a live photo.
2. Browser previews the image and optionally resizes it client-side (canvas).

Backend endpoints:
- None (until submit).

Data flows:
- None (client-side only).

#### 1.3 Submit item

Flow:
1. User confirms submission.
2. Frontend constructs `FormData` with fields + optional `photo`.
3. Frontend submits to the auction’s `public_id`.
4. On success, UI resets the form.

Backend endpoints:
- `POST /api/auctions/:publicId/newitem` (multipart/form-data)
  - Fields: `description`, `contributor`, `artist`, `notes`, optional `photo`
  - Response: `{ id, photo, ... }` on success; `{ error }` otherwise

Data flows:
- `checkAuctionState(['setup','locked'])` resolves `publicId → auctions.id` and enforces status.
- Writes:
  - Inserts row into `items` (assigns `item_number`, stores sanitised text, stores `photo` filename).
  - Writes image files to `UPLOAD_DIR`:
    - `resized_<uuid>.jpg` + `preview_resized_<uuid>.jpg` (plus the raw upload temp file).
  - Inserts audit event into `audit_log` as `user=public` (or `admin` if auth header was supplied).

---

### 2) Admin panel (`public/admin/index.html`, `public/scripts/admin-script.js`, `public/scripts/finalise-lot.js`)

#### 2.1 Restore prior session (auto-login)

Flow:
1. Admin page loads.
2. If `localStorage.token` exists, frontend verifies it.
3. If valid, it loads auctions and items; otherwise it clears local session.

Backend endpoints:
- `POST /api/validate`
  - Request: `{ token }`
  - Response: `{ token, versions }` or `403`

Data flows:
- Verifies JWT; no DB writes.

#### 2.2 Login / logout

Flow:
1. User enters username + password and presses “Login”.
2. Frontend requests a JWT for the `admin` role.
3. Token stored in `localStorage.token`.
4. Logout clears token and returns to login view.

Backend endpoints:
- `POST /api/login`
  - Request: `{ username, password, role: "admin" }`
  - Response: `{ token, currency, versions }`

Data flows:
- Reads `users` (bcrypt compare + role assignment check).
- No DB writes on successful login (aside from rate/lockout state in memory).

#### 2.3 Load auctions / select auction

Flow:
1. Frontend requests list of auctions.
2. Populates auction selector; remembers selection in `sessionStorage.auction_id`.
3. For the selected auction it refreshes status, renders state-change UI, and loads items.

Backend endpoints:
- `POST /api/list-auctions` (requires admin JWT)
  - Optional body: `{ status }`
  - Response: `[{ id, short_name, full_name, status, admin_can_change_state, public_id }, ...]`
- `POST /api/auction-status` (requires admin JWT)
  - Request: `{ auction_id }`
  - Response: `{ status }`

Data flows:
- Reads `auctions`.

#### 2.4 Load items table (with sort/order)

Flow:
1. Frontend requests items for `auction_id` with chosen sort field/order.
2. Renders items including preview images and (in bid states) bidder/price columns.
3. Shows a running total for hammer prices and bid count.

Backend endpoints:
- `GET /api/auctions/:auctionId/items?sort=<asc|desc>&field=<...>` (requires admin JWT)
  - Response: `{ items: [...], totals: { item_count, items_with_bids, hammer_total } }`

Data flows:
- Reads `items` (LEFT JOIN `bidders` for paddle number).
- Aggregates totals over `items` for the auction.

#### 2.5 Create a new item (admin-driven)

Flow:
1. Admin clicks “Create New Item”.
2. Frontend posts to the same endpoint as the public form, but with an admin token.
3. Backend treats it as an admin submission (bypasses public rate limiting).

Backend endpoints:
- `POST /api/auctions/:publicId/newitem` (multipart/form-data)
  - Same as public submission; includes `Authorization: <adminJWT>`

Data flows:
- Same as public submission, but audit `user=admin`.

#### 2.6 Edit item details (text fields)

Flow:
1. Admin clicks “Edit” on a row; form is populated client-side.
2. Admin edits description/contributor/creator/notes.
3. Frontend submits `FormData` to update endpoint.

Backend endpoints:
- `POST /api/auctions/:auctionId/items/:id/update` (multipart/form-data; requires admin JWT)

Data flows:
- `checkAuctionState(['setup','locked'])` blocks edits outside setup/locked.
- Reads `items` to validate existence + auction membership.
- Writes:
  - Updates the `items` row and sets `mod_date`.
  - Inserts `audit_log` entry.
- Guardrails:
  - Backend blocks edits if the item has bids (`winning_bidder_id`/`hammer_price` set).

#### 2.7 Update item photo (upload) + image tools (rotate/crop)

Rotate flow:
1. Admin clicks rotate left/right in the edit UI.
2. Frontend calls rotate endpoint with item id and direction.
3. Backend rotates both the stored image and its preview and updates `mod_date`.

Crop flow:
1. Admin opens crop UI (CropperJS), selects crop region.
2. Frontend converts cropped canvas to a JPEG blob.
3. Frontend submits update endpoint with `photo` set to the cropped blob.

Backend endpoints:
- `POST /api/rotate-photo` (JSON; requires admin JWT)
  - Request: `{ id, direction: "left"|"right" }`
- `POST /api/auctions/:auctionId/items/:id/update` (multipart; requires admin JWT)

Data flows:
- Rotations/crops write to filesystem:
  - Overwrites `UPLOAD_DIR/<photo>` and `UPLOAD_DIR/preview_<photo>`.
- Updates `items.mod_date`.
- Audit entries for updates.

#### 2.8 Delete an item

Flow:
1. Admin clicks “Delete Item”.
2. Frontend calls delete endpoint.
3. Backend deletes DB row, removes the image files, then renumbers remaining items.

Backend endpoints:
- `DELETE /api/items/:id` (requires admin JWT)

Data flows:
- `checkAuctionState(['setup','locked'])` blocks deletes outside setup/locked.
- Reads `items` to validate auction membership and ensure no bids exist.
- Writes:
  - Deletes image files from `UPLOAD_DIR` (`photo` + `preview_<photo>`).
  - Deletes row from `items`.
  - Renumbers `items.item_number` within the auction.
  - Inserts `audit_log` entry.

#### 2.9 Move item to another auction

Flow:
1. Admin opens the “Move” panel for a row.
2. Admin selects a target auction (must be in `setup` or `locked`).
3. Frontend posts move request.
4. Backend updates `items.auction_id` and assigns a new `item_number` at the end of the target auction; then renumbers the old auction.

Backend endpoints:
- `POST /api/auctions/:auctionId/items/:id/move-auction/:targetAuctionId` (requires admin JWT)

Data flows:
- `checkAuctionState(['setup','locked'])` blocks move outside setup/locked for the *source* auction.
- Reads:
  - `items` to ensure the item has no bids.
  - `auctions` to ensure target exists and is setup/locked.
- Writes:
  - Updates `items.auction_id`, `items.item_number`, `items.mod_date`.
  - Renumbers `items.item_number` in the source auction.
  - Inserts `audit_log` entry.

#### 2.10 Reorder items within an auction (“Move after…”)

Flow:
1. Admin selects “Move after…” target in the row’s move panel.
2. Frontend posts reorder request.
3. Backend renumbers all `item_number` values in a single transaction.

Backend endpoints:
- `POST /api/auctions/:auctionId/items/:id/move-after/:after_id` (requires admin JWT)

Data flows:
- Reads ordered `items.id` list by `auction_id`.
- Writes updated `items.item_number` for all items in that auction.

#### 2.11 View item history (“History” button)

Flow:
1. Admin clicks “History” on a row.
2. Frontend requests audit events filtered to the item id and renders them in a modal.

Backend endpoints:
- `GET /api/audit-log?object_type=item&object_id=<itemId>` (requires admin JWT)

Data flows:
- Reads `audit_log` (LEFT JOIN `items` and `auctions` for extra context).

#### 2.12 Export CSV / generate PPTX / generate item cards

CSV flow:
1. Admin clicks “Generate CSV Export”.
2. Frontend posts `{ auction_id }` and downloads the CSV.

PPTX slides flow:
1. Admin clicks “Generate Auction Slides”.
2. Frontend posts `{ auction_id }`.
3. Backend reads PPTX config, loads items, renders slides, writes to `OUTPUT_DIR`, responds as download.

Cards flow:
1. Admin clicks “Generate Item Cards”.
2. Frontend posts `{ auction_id }`.
3. Backend reads card config, generates A6 deck, writes to `OUTPUT_DIR`, responds as download.

Backend endpoints:
- `POST /api/export-csv` (requires admin JWT)
- `POST /api/generate-pptx` (requires admin JWT)
- `POST /api/generate-cards` (requires admin JWT)

Data flows:
- Reads `items` (and bidder paddle numbers for export).
- Writes temp files to `OUTPUT_DIR` (`auction_data.csv`, `auction_presentation.pptx`, `auction_cards.pptx`).

#### 2.13 Change auction state (admin)

Flow:
1. Admin uses the “State” dropdown.
2. UI is enabled only if the auction has `admin_can_change_state=1`.
3. Frontend posts new status.

Backend endpoints:
- `POST /api/auctions/update-status` (requires admin JWT)
  - Request: `{ auction_id, status }`

Data flows:
- Reads `auctions` to enforce `admin_can_change_state`.
- Writes `auctions.status`.
- Inserts `audit_log` entry.

#### 2.14 Record bids during live auction (“Record Bid” / “Undo”)

Record bid flow:
1. When auction status is `live` (or `settlement`), the add-on injects “Record Bid” buttons in the table.
2. Admin enters `paddle` and `price`.
3. Frontend posts to finalize endpoint.
4. Backend ensures bidder exists for that auction (creates bidder if missing), then sets winning bidder + hammer price.
5. If *no unsold lots remain*, backend auto-transitions auction to `settlement`.

Undo flow:
1. Admin clicks “Undo” on a sold lot (only if not “locked” by payments UI logic).
2. Frontend posts undo endpoint.
3. Backend clears winner + hammer price unless it would cause a negative balance when payments exist.

Backend endpoints:
- `POST /api/lots/:itemId/finalize` (requires admin JWT)
  - Request: `{ paddle, price, auctionId }`
  - Response includes `{ auction_status }` (`live` or `settlement`)
- `POST /api/lots/:itemId/undo` (requires admin JWT)

Data flows:
- Writes:
  - `bidders` insert on first-seen paddle number per auction.
  - `items.winning_bidder_id`, `items.hammer_price`.
  - Potentially `auctions.status='settlement'` if all lots have bids.
  - Inserts `audit_log` entries.

---

### 3) Cashier dashboard (`public/cashier/index.html`, `public/scripts/cashier-login.js`)

#### 3.1 Restore session / login / logout

Flow:
1. If `localStorage.cashierToken` exists, dashboard probes auction list to validate it.
2. If invalid, it clears the token.
3. Login obtains a JWT for the `cashier` role.
4. Logout clears `cashierToken`.

Backend endpoints:
- `POST /api/login` with `{ username, password, role: "cashier" }`
- `POST /api/list-auctions` (requires cashier JWT)

Data flows:
- Reads `users` at login.
- Reads `auctions` for list.

#### 3.2 Choose auction and open embedded sub-pages

Flow:
1. Cashier selects an auction from the dropdown.
2. Cashier clicks:
   - “View live feed” → loads `cashier/live-feed.html` in an `<iframe>`
   - “Manage payments” → loads `cashier/settlement.html` in an `<iframe>`
3. The dashboard stores last view in `localStorage.lastViewport`.

Backend endpoints:
- None directly (sub-pages call their own endpoints).

Data flows:
- Client-only until sub-page actions.

---

### 4) Cashier live feed (`public/cashier/live-feed.html`, `public/scripts/live-feed.js`)

#### 4.1 Validate a usable token

Flow:
1. Script tries `cashierToken`, then falls back to `token` (admin token), validating whichever exists.
2. If no token validates, it stops with “Session expired”.

Backend endpoints:
- `POST /api/validate`

Data flows:
- JWT verification only.

#### 4.2 Poll live feed rows

Flow:
1. Page is opened with `?auctionId=<id>&auctionStatus=<status>`.
2. Poll interval depends on status (`live` polls faster).
3. Frontend requests sold rows and optionally unsold rows.
4. UI maintains a `rowid → <tr>` map so unsold rows can “upgrade” to sold without flicker.

Backend endpoints:
- `GET /api/cashier/live/:auctionId?unsold=<true|false>` (requires cashier or admin JWT)
  - Response: array of rows:
    - sold: `{ lot, description, bidder, price, rowid, test_item, test_bid, photo }`
    - unsold (optional): `{ lot, description, rowid, unsold: 1, photo }`

Data flows:
- Reads `items` and joins `bidders` to show paddle numbers.
- No writes.

#### 4.3 Hover photo preview

Flow:
1. Hover helper reads `tr.dataset.photoUrl` (set from row photo filename).
2. Loads preview image from uploads.

Backend endpoints:
- `GET /api/uploads/preview_<photo_filename>`

Data flows:
- Filesystem reads only.

---

### 5) Settlement & payments (`public/cashier/settlement.html`, `public/scripts/settlement.js`)

#### 5.1 Load bidders list (polling)

Flow:
1. Page is opened with `?auctionId=<id>&auctionStatus=<status>`.
2. Frontend polls bidders every few seconds.
3. UI displays only bidders with either won lots or recorded payments.

Backend endpoints:
- `GET /api/settlement/bidders?auction_id=<id>` (requires cashier JWT)

Data flows:
- Reads:
  - `bidders` for the auction
  - Aggregates totals from `items` (lots total) and `payments` (payments total)
- No writes.

#### 5.2 Select a bidder to view lots + payments

Flow:
1. Cashier clicks a bidder.
2. Frontend loads bidder summary, lots, and payments list.
3. UI enables payment buttons only if auction status is `settlement`.

Backend endpoints:
- `GET /api/settlement/bidders/:bidderId?auction_id=<id>` (requires cashier JWT)

Data flows:
- Reads:
  - `bidders` (ensures bidder belongs to auction)
  - `items` where `winning_bidder_id = bidderId` within auction
  - `payments` where `bidder_id = bidderId`

#### 5.3 Load enabled payment methods (UI gating)

Flow:
1. Frontend requests a payment methods object.
2. Buttons are shown/hidden and labelled based on backend config.

Backend endpoints:
- `GET /api/settlement/payment-methods` (requires cashier JWT)

Data flows:
- Reads runtime config values.

#### 5.4 Record a manual payment (cash / manual card / manual PayPal)

Flow:
1. Cashier clicks a payment method button.
2. Frontend opens a modal with default amount = current outstanding balance.
3. Frontend posts the payment record.
4. UI refreshes bidder list; backend may audit “paid in full” / “part paid” per item.

Backend endpoints:
- `POST /api/settlement/payment/:auctionId` (requires cashier JWT; auction must be in settlement)
  - Request: `{ auction_id, bidder_id, amount, method, note }`

Data flows:
- `checkAuctionState(['settlement'])` blocks payment outside settlement.
- Reads:
  - `bidders` to ensure bidder belongs to the auction.
  - Aggregates `items` + `payments` to ensure amount does not exceed outstanding balance.
- Writes:
  - Inserts `payments` row.
  - Inserts audit event.
  - Additional audit events per won item (`paid in full` / `part paid`) based on recomputed balance.

#### 5.5 Start a SumUp payment (app deep-link or hosted checkout)

Frontend flow:
1. Cashier chooses `sumup-app` or `sumup-web`.
2. Frontend calls intent creation endpoint with `amount_minor` (pence).
3. Backend returns either:
  - `deep_link` (SumUp app), or
  - `hosted_link` (browser checkout URL).
4. Frontend opens returned URL in a new tab/window.
5. Cashier returns to the UI and refreshes bidders to see the resulting recorded payment.

Backend endpoints (frontend-called):
- `POST /api/payments/intents` (requires cashier JWT; auction must be in settlement)
  - Request: `{ bidder_id, amount_minor, currency, channel: "app"|"hosted", note }`
  - Response: `{ intent_id, amount_minor, currency, deep_link? , hosted_link? }`

Backend endpoints (provider → backend, not directly called by the UI):
- `POST /api/payments/sumup/webhook` (SumUp hosted checkout webhook)
- `GET /api/payments/sumup/callback/success` / `fail` (SumUp app callbacks)
- `GET /api/payments/intents/:id` (optional polling fallback)

Data flows:
- Intent creation:
  - Inserts row into `payment_intents` with `pending` status + expiry.
  - Reads bidder’s outstanding balance (from `items` and `payments`) to prevent overcharging.
- Finalisation (webhook/callback verification):
  - Writes a `payments` record for the verified SumUp transaction (and updates intent status).
  - Enforced uniqueness on `(provider, provider_txn_id)` and `(provider, intent_id)` prevents duplicates.
  - Inserts audit events.

#### 5.6 Apply a refund (payment reversal)

Flow:
1. Cashier clicks “Refund” next to a payment row.
2. Frontend collects amount and reason and confirms.
3. Frontend posts reversal request.
4. Backend inserts a new negative `payments` row linked to the original via `reverses_payment_id`.

Backend endpoints:
- `POST /api/settlement/payment/:paymentId/reverse` (requires cashier/admin JWT; auction must be in settlement)
  - Request: `{ amount, reason, note, auction_id }`

Data flows:
- Reads original payment and computes how much is still reversible.
- Writes:
  - Inserts negative `payments` row.
  - Inserts audit event for payment reversal.

#### 5.7 Download settlement CSV + show payment summary

Flow:
1. CSV: Frontend downloads a bidder-by-bidder settlement report.
2. Summary: Frontend fetches auction totals grouped by payment method and renders a modal.

Backend endpoints:
- `GET /api/settlement/export.csv?auction_id=<id>` (requires cashier JWT)
- `GET /api/settlement/summary?auction_id=<id>` (requires cashier JWT)

Data flows:
- Reads `bidders`, `items`, `payments` to compute totals.
- No writes.

---

### 6) Maintenance panel (`public/maint/index.html`, `public/scripts/maintenance.js`)

All maintenance endpoints are mounted under `/api/maintenance/*` and are protected by the `maintenance` role (see `backend/backend.js` + `backend/maintenance.js`).

#### 6.1 Restore session / login

Flow:
1. If `maintenanceToken` exists, frontend validates it.
2. If valid, it loads auction list, integrity checks, resources lists, payment method status, and starts auto-refresh.

Backend endpoints:
- `POST /api/validate`
- `POST /api/login` with `{ username, password, role: "maintenance" }`

Data flows:
- JWT verification and password hash checks; no DB writes.

#### 6.2 Backups / downloads / restores

Flow:
- Backup DB to server: creates a snapshot copy of the SQLite DB.
- Download DB file: downloads raw SQLite file.
- Download full backup: downloads a zip bundle (DB + uploads + configs, depending on implementation).
- Restore: uploads a file; backend validates it’s SQLite and schema-compatible; swaps DB and removes WAL/SHM files.

Backend endpoints:
- `POST /api/maintenance/backup`
- `GET /api/maintenance/download-db`
- `GET /api/maintenance/download-full`
- `POST /api/maintenance/restore` (multipart)

Data flows:
- Filesystem:
  - Reads/writes DB file and backup files under `BACKUP_DIR`.
  - Sets a maintenance lock (`db.setMaintenanceLock(true)`) to avoid concurrent access.
- DB is closed and reopened during copy/restore operations.
- Audit entries may be written for database operations (where implemented).

#### 6.3 Import/export bulk data

Flow:
- Export: downloads bulk export zip.
- Import: uploads CSV zip; backend imports into DB.

Backend endpoints:
- `GET /api/maintenance/export`
- `POST /api/maintenance/import` (multipart)

Data flows:
- Filesystem reads/writes for zip creation/extraction.
- DB writes to `auctions`, `items`, etc depending on import mode.

#### 6.4 Auction management (create/list/delete/reset/status, admin state permission)

Flow:
1. Frontend lists auctions and shows status.
2. User can create/delete auctions, reset auctions, update status, and toggle `admin_can_change_state`.

Backend endpoints:
- `POST /api/maintenance/auctions/list`
- `POST /api/maintenance/auctions/create`
- `POST /api/maintenance/auctions/delete`
- `POST /api/maintenance/reset`
- `POST /api/auctions/update-status` (shared with admin, allowed for maintenance)
- `POST /api/maintenance/auctions/set-admin-state-permission`

Data flows:
- Reads/writes `auctions` and related `items`/`bidders`/`payments` for reset/delete operations.
- Inserts audit events for changes.

#### 6.5 Password management / server management / logs

Flow:
- Manage user accounts (create users, assign roles, set passwords, delete users).
- Change the logged-in user’s own password.
- Restart backend service.
- Load server logs (optionally auto-refresh).

Backend endpoints:
- `GET /api/maintenance/users`
- `POST /api/maintenance/users`
- `PATCH /api/maintenance/users/:username/roles`
- `POST /api/maintenance/users/:username/password`
- `DELETE /api/maintenance/users/:username`
- `POST /api/maintenance/change-password`
- `POST /api/change-password`
- `POST /api/maintenance/restart`
- `GET /api/maintenance/logs`

Data flows:
- Reads/writes `users` (bcrypt hash) for account and password changes.
- Restart uses OS-level service control (see maintenance implementation + `SERVICE_NAME`).
- Logs are filesystem reads from `LOG_DIR/LOG_NAME`.

#### 6.6 Data quality & cleanup (integrity checks, photo reporting, orphan cleanup)

Flow:
- Check DB integrity and common data issues.
- Report total stored photo count/size.
- Detect orphaned photo files and optionally delete them.

Backend endpoints:
- `GET /api/maintenance/check-integrity`
- `GET /api/maintenance/photo-report`
- `GET /api/maintenance/orphan-photos`
- `POST /api/maintenance/cleanup-orphan-photos`

Data flows:
- Reads DB tables and filesystem `UPLOAD_DIR`.
- Deletes orphan files from `UPLOAD_DIR` when requested.

#### 6.7 Test/training generators (items and bids)

Flow:
- Generate test items.
- Generate test bids/bidders for an auction.
- Delete generated test bids.

Backend endpoints:
- `POST /api/maintenance/generate-test-data`
- `POST /api/maintenance/generate-bids`
- `POST /api/maintenance/delete-test-bids`

Data flows:
- Writes `items`, `bidders`, and bid fields (`winning_bidder_id`, `hammer_price`) depending on generator.
- Inserts audit events.

#### 6.8 PPTX configuration editor + resources management

Flow:
- Load/edit/save pptx/card JSON templates used by `/generate-pptx` and `/generate-cards`.
- Upload/list/delete resource files (logos, template assets).

Backend endpoints:
- `GET /api/maintenance/get-pptx-config/:name`
- `POST /api/maintenance/save-pptx-config/:name`
- `POST /api/maintenance/pptx-config/reset`
- `POST /api/maintenance/resources/upload` (multipart)
- `GET /api/maintenance/resources`
- `POST /api/maintenance/resources/delete`

Data flows:
- Filesystem:
  - Reads/writes JSON files under `PPTX_CONFIG_DIR`.
  - Reads/writes resource files under `CONFIG_IMG_DIR`.
- Save endpoint performs JSON path validation and returns structured errors for UI display.

#### 6.9 Audit log viewer + export

Flow:
- UI fetches audit entries with optional filters.
- Export downloads CSV of audit logs.

Backend endpoints:
- `GET /api/audit-log` (shared endpoint; requires maintenance JWT)
- `GET /api/maintenance/audit-log/export`

Data flows:
- Reads `audit_log` (and joins for item/auction details).

#### 6.10 Payment method status (maintenance visibility)

Flow:
- UI calls payment methods endpoint (same as cashier UI) and shows whether each method is enabled/blocked and any configured URLs.

Backend endpoints:
- `GET /api/settlement/payment-methods`

Data flows:
- Reads runtime payment config.

---

### 7) Slideshow (`public/slideshow/index.html`)

#### 7.1 Authenticate with slideshow role

Flow:
1. User enters auction short name + slideshow username + slideshow password.
2. Frontend logs in directly with role `slideshow`.
3. Frontend stores the slideshow JWT and clears other elevated tokens (admin/maintenance/cashier) because slideshow is expected to be unattended.

Backend endpoints:
- `POST /api/login` (role `slideshow`)
  - Response includes `{ token }`

Data flows:
- Reads `users` for slideshow login.
- No DB writes.

#### 7.2 Validate auction short name (authorised bypass) and store `public_id`

Flow:
1. Frontend calls validate-auction with slideshow JWT in `Authorization`.
2. Backend treats slideshow/admin/maintenance/root JWT as authorised bypass and does not require `status === setup`.
3. Frontend stores `public_id` and auction name in local storage.

Backend endpoints:
- `POST /api/validate-auction` (with `Authorization: <slideshowJWT>`)

Data flows:
- Reads `auctions`.

#### 7.3 Fetch and display slideshow items (auto-refresh)

Flow:
1. Frontend requests items for `public_id` and filters those with photos.
2. It shuffles and cycles through items, displaying:
   - image: `/api/uploads/<photo>`
   - overlay text (description/contributor/creator) depending on user config
3. It refreshes the list periodically and merges “new” items into the upcoming queue.

Backend endpoints:
- `GET /api/auctions/:publicId/slideshow-items` (requires slideshow JWT)
- `GET /api/uploads/<photo_filename>`

Data flows:
- Reads `items` (photo-present only) for the auction.
- Filesystem reads of uploaded images.

---

## Appendix: Endpoint index (only those used by the frontend)

Authentication & session:
- `POST /api/login` (admin/cashier/maintenance/slideshow)
- `POST /api/validate` (all roles)
- `POST /api/change-password` (all authenticated roles)

Auctions:
- `POST /api/validate-auction` (public; optional auth bypass)
- `POST /api/list-auctions` (admin/cashier/maintenance)
- `POST /api/auction-status` (admin)
- `POST /api/auctions/update-status` (admin/maintenance)

Items:
- `POST /api/auctions/:publicId/newitem` (public; optional admin auth)
- `GET /api/auctions/:auctionId/items` (admin)
- `POST /api/auctions/:auctionId/items/:id/update` (admin)
- `DELETE /api/items/:id` (admin)
- `POST /api/auctions/:auctionId/items/:id/move-auction/:targetAuctionId` (admin)
- `POST /api/auctions/:auctionId/items/:id/move-after/:after_id` (admin)
- `POST /api/rotate-photo` (admin)

Exports:
- `POST /api/export-csv` (admin)
- `POST /api/generate-pptx` (admin)
- `POST /api/generate-cards` (admin)

Live auction bid recording:
- `POST /api/lots/:itemId/finalize` (admin)
- `POST /api/lots/:itemId/undo` (admin)
- `GET /api/cashier/live/:auctionId` (admin/cashier)

Settlement:
- `GET /api/settlement/bidders` (cashier)
- `GET /api/settlement/bidders/:bidderId` (cashier)
- `GET /api/settlement/payment-methods` (cashier/maintenance)
- `POST /api/settlement/payment/:auctionId` (cashier)
- `POST /api/settlement/payment/:paymentId/reverse` (cashier/admin)
- `GET /api/settlement/export.csv` (cashier)
- `GET /api/settlement/summary` (cashier)

SumUp:
- `POST /api/payments/intents` (cashier)
- `GET /api/payments/intents/:id` (cashier; optional polling)
- `POST /api/payments/sumup/webhook` (SumUp → backend)
- `GET /api/payments/sumup/callback/success|fail` (SumUp → backend)

Audit:
- `GET /api/audit-log` (admin/maintenance)

Maintenance (all require maintenance role and are prefixed `/api/maintenance/*`):
- Backups/download/restore: `backup`, `download-db`, `download-full`, `restore`
- Import/export: `export`, `import`
- Integrity & cleanup: `check-integrity`, `photo-report`, `orphan-photos`, `cleanup-orphan-photos`
- Auctions: `auctions/list`, `auctions/create`, `auctions/delete`, `reset`, `auctions/set-admin-state-permission`
- Generators: `generate-test-data`, `generate-bids`, `delete-test-bids`
- Config/resources: `get-pptx-config/:name`, `save-pptx-config/:name`, `pptx-config/reset`, `resources`, `resources/upload`, `resources/delete`
- Users: `users`, `users/:username/roles`, `users/:username/password`
- Ops: `change-password`, `restart`, `logs`
- Audit export: `audit-log/export`
