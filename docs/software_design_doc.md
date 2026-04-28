# Convention Auction — Software Design Document

## Goals / scope

This document describes the current architecture of the project and the main end-user flows implemented in the repo today.

It focuses on:

- frontend-visible behavior in `public/`
- backend route and data flow behavior in `backend/`
- the current application shape after the changes introduced since schema/version `2.2`

Current code snapshot:

- backend package version: `3.0.0`
- database schema version: `3.0`
- payment processor module version: `SumUp 1.2.0(2026-02-09)`

Notes:

- Frontend calls backend endpoints as `/api/<route>`.
- Express generally registers those routes as `/<route>` and the deployment proxy maps `/api/*` to the Node service.
- This document reflects the current intended frontend surface. Retired routes that are no longer used by the frontend are intentionally omitted.

---

## What changed since 2.2

Version `2.2` introduced SumUp payment intents. Since then, the architecture has changed materially:

- user accounts moved to multi-role plus explicit permissions
- a shared operator session model was added, with server-persisted UI preferences
- remote logout/session invalidation was added
- items moved from hard delete to soft delete with restore support
- item export tracking was added for slides, cards, and slips
- async PPTX export jobs were added with status, cancel, and download endpoints
- manual entry sheet, auction report PDF, and bidder report PDF exports were added
- live feed became an operational collections view with:
  - bidder grouping
  - ready-for-collection state
  - collected-item tracking
  - uncollected CSV export
- settlement gained donation tracking and better payment reversal handling
- maintenance gained managed backup archives with metadata, listing, download, delete, and selective restore
- slideshow startup changed to an authenticated kiosk flow using `/api/slideshow/auctions`

Routes intentionally no longer documented because they are retired from frontend use:

- `POST /api/rotate-photo`
- `GET /api/maintenance/download-full`
- `POST /api/auctions/:auctionId/items/reset-slip-print`
- `PATCH /api/maintenance/users/:username/roles`

---

## Roles and UI surfaces

| Access | Frontend surface | Purpose |
| --- | --- | --- |
| Public | `public/index.html` | Submit auction items. |
| `admin` role | `public/admin/index.html` | Manage auction items, bidders, exports, and live bidding. |
| `cashier` role | `public/cashier/index.html` | Settlement workspace and operator launcher. |
| `live_feed` permission | `public/cashier/live-feed.html` | Collections workflow during/after auction. |
| `maintenance` role | `public/maint/index.html` | Backups, restores, auction admin, users, integrity, logs, config, resources. |
| `slideshow` role | `public/slideshow/index.html` | Kiosk slideshow of uploaded auction items. |

Current explicit permissions:

- `live_feed`
- `admin_bidding`
- `manage_users`

---

## High-level architecture

### Frontend

- Static HTML/CSS/JS served from `public/`.
- Each major surface has its own script:
  - public submission: `public/scripts/script.js`
  - operator login/session bootstrap: `public/scripts/login.js`, `public/scripts/session-auth.js`
  - admin: `public/scripts/admin-script.js`, `public/scripts/finalise-lot.js`
  - cashier dashboard: `public/scripts/cashier-login.js`
  - cashier live feed: `public/scripts/live-feed.js`
  - settlement: `public/scripts/settlement.js`
  - maintenance: `public/scripts/maintenance.js`
- Operator pages use the shared `AppAuth` layer from `public/scripts/session-auth.js`.

### Session model

- Shared operator session is stored in `localStorage.operatorSession`.
- Legacy mirrors such as `token`, `cashierToken`, and `maintenanceToken` are still written for compatibility.
- Last view is stored in `localStorage.operatorLastView`.
- Slideshow kiosk mode uses a separate session copy in `sessionStorage.slideshowKioskSession`.
- User interface preferences are persisted server-side in `users.preferences` and loaded/saved through:
  - `GET /api/preferences`
  - `POST /api/preferences`

### Backend

- Entrypoint: `backend/backend.js`
- DB/schema/bootstrap: `backend/db.js`
- User/access helpers: `backend/users.js`
- SumUp/payment integration: `backend/payments.js`
- Maintenance router: `backend/maintenance.js`
- Export/report routes: `backend/export-routes.js`
- Live-feed/settlement/bidding patch module: `backend/phase1-patch.js`

### Express assembly

Important mounted modules:

- `require('./phase1-patch')(app)` adds:
  - `/cashier/*`
  - `/settlement/*`
  - `/lots/*`
  - bidder metadata under `/auctions/*`
- `app.use(paymentsApi)` adds `/payments/*`
- `app.use('/maintenance', authenticateRole('maintenance'), ...)` mounts maintenance tools
- backend also statically serves:
  - `/uploads/*` from `UPLOAD_DIR`
  - `/resources/*` from `CONFIG_IMG_DIR`

### Cross-cutting middleware and helpers

- `authenticateRole(...)` and `authenticateAccess(...)`
- `checkAuctionState(...)`
- text sanitisation helpers
- audit logging via `audit(...)`
- maintenance lock gate via `db.isMaintenanceLocked()`

---

## Storage and data model

### Filesystem

- SQLite DB file in configured `DB_PATH` / `DB_NAME`
- item images in `UPLOAD_DIR`
- configurable resource assets in `CONFIG_IMG_DIR`
- generated exports in `OUTPUT_DIR`
- managed backup archives and sidecar metadata in `BACKUP_DIR`

### Key database tables

`auctions`

- `short_name`, `full_name`, `public_id`, `logo`, `status`
- `admin_can_change_state`

`items`

- text content: `description`, `contributor`, `artist`, `notes`
- image/path fields: `photo`
- numbering/state fields: `auction_id`, `item_number`
- bidding fields: `winning_bidder_id`, `hammer_price`, `last_bid_update`
- export/print fields: `last_print`, `last_slide_export`, `last_card_export`, `text_mod_date`
- collection fields: `collected_at`
- soft-delete fields: `is_deleted`, `deleted_at`, `deleted_by`
- test helpers: `test_item`, `test_bid`

`bidders`

- `auction_id`, `paddle_number`, `name`
- live-feed collection fields:
  - `ready_for_collection`
  - `ready_fingerprint`
  - `ready_updated_at`

`payments`

- `amount`
- `donation_amount`
- `method`, `note`, `currency`
- `provider`, `provider_txn_id`, `intent_id`, `raw_payload`
- `reverses_payment_id`, `reversal_reason`

`payment_intents`

- `intent_id`, `bidder_id`
- `amount_minor`, `donation_minor`
- `channel`, `status`, `sumup_checkout_id`
- `created_by`, `expires_at`, `note`

`users`

- `username`, `password`
- `roles`, `permissions`
- `preferences`
- `session_invalid_before`
- `is_root`

`audit_log`

- `user`, `action`, `object_type`, `object_id`, `details`, `created_at`

`metadata`

- schema/version metadata
- `database_id`
- restore provenance:
  - `restored_at`
  - `restored_from_backup_id`
  - `restored_from_database_id`
- `database_created_at`
- `database_created_by_backend_version`
- `last_started_at`

---

## Auction state machine

Canonical states:

- `setup`
- `locked`
- `live`
- `settlement`
- `archived`

High-level intent:

- `setup`: public item intake open
- `locked`: public intake blocked, admin cleanup still allowed
- `live`: lot bidding active
- `settlement`: payments and collections active
- `archived`: read-mostly historical state

Common backend enforcement:

- item edits, moves, duplicate/reorder, soft delete, restore:
  - generally limited to `setup` and `locked`
- lot finalise / undo:
  - allowed in `live` and `settlement`
- payments:
  - allowed in `settlement`
- slideshow reads:
  - allowed in all standard auction states

Automatic transition:

- `/api/lots/:itemId/finalize` sets auction state to `settlement` automatically if no unsold active lots remain.

---

## Backend request lifecycle

1. `backend/backend.js` loads config, opens DB, sets metadata, and starts Express.
2. Express applies JSON and URL-encoded parsers.
3. JSON parse errors are translated into `400`.
4. A maintenance lock middleware returns `503` for most routes while DB maintenance is active.
5. Auth and auction-state middleware run per route.
6. Route handlers read/write SQLite and filesystem state.
7. Meaningful state changes usually emit audit entries.
8. Unhandled errors fall through to a final `500 { error: "Server error" }`.

---

## Frontend-driven flows

### 1) Public submission

Files:

- `public/index.html`
- `public/scripts/script.js`

Flow:

1. User enters an auction short name.
2. Frontend calls `POST /api/validate-auction`.
3. If valid, it stores `public_id` and branding and reveals the submission form.
4. User fills item details and optionally uploads or captures a photo.
5. Frontend resizes the chosen image client-side.
6. Frontend submits multipart data to `POST /api/auctions/:publicId/newitem`.

Backend endpoints:

- `POST /api/validate-auction`
- `POST /api/auctions/:publicId/newitem`

Data flow:

- reads `auctions`
- inserts into `items`
- writes resized photo files into `UPLOAD_DIR` when provided
- records audit as public submission unless an authenticated admin token was supplied

---

### 2) Operator authentication and shared session

Files:

- `public/login.html`
- `public/scripts/login.js`
- `public/scripts/session-auth.js`

Flow:

1. Operator signs in once with username and password.
2. Backend returns:
   - JWT
   - resolved `landing_path`
   - `user` access shape
   - `versions` metadata
3. Shared session is stored through `AppAuth`.
4. Operator pages call `POST /api/validate` to refresh tokens and pick up restore/version metadata.
5. Per-user preferences are loaded from `GET /api/preferences` and saved via `POST /api/preferences`.

Important behavior:

- login is no longer role-specific; landing page is derived from access
- pages are shown/hidden from access metadata, not separate logins
- remote logout uses `users.session_invalid_before`

Backend endpoints:

- `POST /api/login`
- `POST /api/validate`
- `GET /api/preferences`
- `POST /api/preferences`
- `POST /api/change-password`

---

### 3) Admin panel

Files:

- `public/admin/index.html`
- `public/scripts/admin-script.js`
- `public/scripts/finalise-lot.js`

#### 3.1 Auction selection and items table

Flow:

1. Admin session validates.
2. Frontend loads auctions via `POST /api/list-auctions`.
3. It loads current state and selected auction items.
4. Admin preferences control:
   - selected auction
   - sort field/order
   - show bidder names
   - show deleted items

Endpoints:

- `POST /api/list-auctions`
- `POST /api/auction-status`
- `GET /api/auctions/:auctionId/items?sort=...&field=...&show_deleted=true|false`

Data flow:

- reads `auctions`
- reads `items`, `bidders`, and payment totals for the selected auction

#### 3.2 Create, edit, delete, restore, move, duplicate

Current admin item behavior:

- create uses the same `newitem` endpoint as the public form, but with admin auth
- item deletion is now soft delete, not hard delete
- deleted items can be restored
- reorder endpoint also supports duplication when `copy=true`
- move between auctions and reorder both preserve active-item numbering semantics

Endpoints:

- `POST /api/auctions/:publicId/newitem`
- `POST /api/auctions/:auctionId/items/:id/update`
- `DELETE /api/items/:id`
- `POST /api/items/:id/restore`
- `POST /api/auctions/:auctionId/items/:id/move-auction/:targetAuctionId`
- `POST /api/auctions/:auctionId/items/:id/move-after/:after_id`

Data flow:

- updates `items`
- may write image files in `UPLOAD_DIR`
- soft delete sets:
  - `is_deleted = 1`
  - `deleted_at`
  - `deleted_by`
- restore clears those fields and appends the item at the end of the auction
- duplicate may clone both source photo and preview image

Photo handling note:

- photo changes now flow through `POST /api/auctions/:auctionId/items/:id/update`
- the retired standalone `POST /api/rotate-photo` route is no longer part of the intended frontend design

#### 3.3 Bidder management

Admin can now manage bidder identities directly for the selected auction.

Endpoints:

- `GET /api/auctions/:auctionId/bidders`
- `POST /api/auctions/:auctionId/bidders`
- `PATCH /api/auctions/:auctionId/bidders/:bidderId`

Data flow:

- reads and writes `bidders`
- preserves per-auction paddle uniqueness
- supports late name assignment or correction

#### 3.4 Audit and history

Endpoints:

- `GET /api/audit-log?object_type=item&object_id=<itemId>`

Data flow:

- reads `audit_log` joined to related item/auction context

#### 3.5 Exports, reports, and print tracking

Admin exports are broader than in `2.2`:

- CSV item export
- slide PPTX
- card PPTX
- manual entry sheet PDF
- auction report PDF
- bidder report PDF
- single-item slip PDF
- batch slip PDF

PPTX generation is now asynchronous-capable.

Endpoints:

- `POST /api/export-csv`
- `POST /api/generate-pptx`
- `POST /api/generate-cards`
- `GET /api/export-jobs/pptx/status`
- `POST /api/export-jobs/pptx/cancel`
- `GET /api/export-jobs/pptx/download?job_id=...`
- `GET /api/auctions/:auctionId/items/manual-entry-sheet`
- `GET /api/auctions/:auctionId/report-pdf`
- `GET /api/auctions/:auctionId/bidder-report-pdf`
- `GET /api/auctions/:auctionId/items/:id/print-slip`
- `GET /api/auctions/:auctionId/items/print-slip`
- `POST /api/auctions/:auctionId/items/confirm-slip-print`
- `POST /api/auctions/:auctionId/items/reset-export-tracking`

Data flow:

- reads active `items`, `bidders`, `payments`, and config files
- writes temp export files to `OUTPUT_DIR`
- updates:
  - `items.last_slide_export`
  - `items.last_card_export`
  - `items.last_print`
- report generation includes collection state, refunds, donations, and ready-for-collection metrics

Retired print/export route:

- `POST /api/auctions/:auctionId/items/reset-slip-print` is no longer part of the intended surface

#### 3.6 Auction state changes

Endpoint:

- `POST /api/auctions/update-status`

Notes:

- admin can only change state if `admin_can_change_state=1`
- maintenance can also call the same shared state-change endpoint

#### 3.7 Live bidding and undo

Endpoints:

- `POST /api/lots/:itemId/finalize`
- `GET /api/lots/:itemId/undo-preview`
- `POST /api/lots/:itemId/undo`

Data flow:

- creates/updates `bidders`
- writes winning bidder and hammer price to `items`
- updates `last_bid_update`
- can auto-transition auction to `settlement`
- undo is balance-aware and can block reversions that would create invalid settlement state

---

### 4) Cashier dashboard and live feed

Files:

- `public/cashier/index.html`
- `public/scripts/cashier-login.js`
- `public/cashier/live-feed.html`
- `public/scripts/live-feed.js`

#### 4.1 Cashier dashboard

Flow:

1. Shared session is validated.
2. Cashier dashboard loads auction list.
3. Preferences store selected auction and picture toggle.
4. The dashboard opens:
   - settlement workflow
   - live feed / collections workflow
   - buyer display popup

Endpoints:

- `POST /api/validate`
- `POST /api/list-auctions`
- `POST /api/change-password`

#### 4.2 Live feed / collections workflow

This is no longer a simple sold-row poller. It is a grouped collections tool.

Flow:

1. Frontend polls the current auction feed.
2. Backend returns:
   - sold item rows
   - optional unsold rows
   - bidder collection summaries
3. UI groups sold items by bidder.
4. Operators can:
   - mark bidder ready
   - mark individual items collected/uncollected
   - mark all items collected for a bidder
   - download uncollected CSV

Endpoints:

- `GET /api/cashier/live/:auctionId?unsold=true|false`
- `POST /api/cashier/live/:auctionId/bidders/:bidderId/ready`
- `POST /api/cashier/live/:auctionId/items/:itemId/collection`
- `POST /api/cashier/live/:auctionId/bidders/:bidderId/collect-all`
- `GET /api/cashier/live/:auctionId/uncollected.csv`

Data flow:

- reads `items`, `bidders`, `payments`
- writes:
  - `bidders.ready_for_collection`
  - `bidders.ready_fingerprint`
  - `bidders.ready_updated_at`
  - `items.collected_at`

Hover preview behavior:

1. Each row stores a photo reference in `tr.dataset.photoUrl`.
2. Hover helper loads `/api/uploads/preview_<filename>`.

---

### 5) Settlement and payments

Files:

- `public/cashier/settlement.html`
- `public/scripts/settlement.js`

#### 5.1 Bidder list and bidder detail

Endpoints:

- `GET /api/settlement/bidders?auction_id=<id>`
- `GET /api/settlement/bidders/:bidderId?auction_id=<id>`

Data flow:

- reads `bidders`, sold `items`, and `payments`
- bidder detail now includes donation-aware payment totals and refund history

#### 5.2 Payment method discovery

Endpoint:

- `GET /api/settlement/payment-methods`

Used by:

- cashier settlement UI
- maintenance visibility panel

#### 5.3 Manual payments

Endpoint:

- `POST /api/settlement/payment/:auctionId`

Payload includes:

- `bidder_id`
- `amount`
- optional `donation_amount`
- `method`
- optional `note`

Data flow:

- validates outstanding balance
- inserts into `payments`
- recomputes payment state for the bidder
- writes audit

#### 5.4 SumUp payments

Frontend-called endpoint:

- `POST /api/payments/intents`

Provider-facing endpoints:

- `POST /api/payments/sumup/webhook`
- `GET /api/payments/sumup/callback/success`
- `GET /api/payments/sumup/callback/fail`

Optional polling fallback:

- `GET /api/payments/intents/:id`

Data flow:

- inserts pending `payment_intents`
- verifies remote completion
- writes final `payments` rows with provider metadata
- supports both hosted checkout and app deep-link flows
- tracks donations separately from settlement amount

#### 5.5 Refunds and summaries

Endpoints:

- `POST /api/settlement/payment/:paymentId/reverse`
- `GET /api/settlement/export.csv?auction_id=<id>`
- `GET /api/settlement/summary?auction_id=<id>`

Data flow:

- reversal creates a new negative `payments` row
- summaries include settlement totals, donations, and method-level grouping

---

### 6) Maintenance

Files:

- `public/maint/index.html`
- `public/scripts/maintenance.js`

#### 6.1 Managed backups and restore

The maintenance area no longer exposes only a raw DB backup model. It now has managed archives with metadata and selective restore.

Endpoints:

- `POST /api/maintenance/backup`
- `GET /api/maintenance/backups`
- `GET /api/maintenance/backups/:backupId`
- `GET /api/maintenance/backups/:backupId/download`
- `DELETE /api/maintenance/backups/:backupId`
- `POST /api/maintenance/backups/:backupId/restore`
- `GET /api/maintenance/download-db`
- `POST /api/maintenance/restore`

Data flow:

- managed backup archive includes:
  - DB snapshot
  - uploaded item photos
  - resource images
  - resource config files
  - archive metadata
  - backup log
- managed restore can selectively restore:
  - database
  - photos
  - resources/config
- uploaded raw DB restore still exists for direct snapshot replacement
- restore provenance is written into `metadata`

Retired route:

- `GET /api/maintenance/download-full` is no longer part of the intended frontend surface

#### 6.2 Import/export, auctions, and state policy

Endpoints:

- `GET /api/maintenance/export`
- `POST /api/maintenance/import`
- `POST /api/maintenance/reset`
- `POST /api/maintenance/auctions/list`
- `POST /api/maintenance/auctions/create`
- `POST /api/maintenance/auctions/update`
- `POST /api/maintenance/auctions/delete`
- `POST /api/maintenance/auctions/purge-deleted-items`
- `POST /api/maintenance/auctions/set-admin-state-permission`
- `POST /api/auctions/update-status`

Data flow:

- reads/writes `auctions`, `items`, `bidders`, `payments`, `payment_intents`
- can permanently purge soft-deleted items by auction
- maintains per-auction admin state-change policy

#### 6.3 User and access management

Current user management is permission-based.

Endpoints:

- `GET /api/maintenance/users`
- `POST /api/maintenance/users`
- `PATCH /api/maintenance/users/:username/access`
- `POST /api/maintenance/users/:username/password`
- `POST /api/maintenance/users/:username/logout-now`
- `DELETE /api/maintenance/users/:username`
- `POST /api/change-password`

Rules:

- only operators with `manage_users` can use the management routes
- managers can only grant or remove roles/permissions they themselves hold
- users cannot change their own access
- remote logout bumps `session_invalid_before`

Retired route:

- `PATCH /api/maintenance/users/:username/roles` is legacy and no longer part of the intended frontend surface

#### 6.4 Restart, logs, integrity, cleanup, generators

Endpoints:

- `POST /api/maintenance/restart`
- `GET /api/maintenance/logs`
- `GET /api/maintenance/photo-report`
- `GET /api/maintenance/check-integrity`
- `POST /api/maintenance/check-integrity/fix`
- `GET /api/maintenance/orphan-photos`
- `POST /api/maintenance/cleanup-orphan-photos`
- `POST /api/maintenance/generate-test-data`
- `POST /api/maintenance/generate-bids`
- `POST /api/maintenance/delete-test-bids`

Data flow:

- integrity checks span DB consistency across auctions, items, bidders, payments, and soft-delete states
- photo/orphan tools inspect `UPLOAD_DIR`
- generators create training/test records

#### 6.5 Config, resources, audit, and payment visibility

Endpoints:

- `GET /api/maintenance/get-pptx-config/:name`
- `POST /api/maintenance/save-pptx-config/:name`
- `POST /api/maintenance/pptx-config/reset`
- `POST /api/maintenance/resources/upload`
- `GET /api/maintenance/resources`
- `POST /api/maintenance/resources/delete`
- `GET /api/maintenance/audit-log/export`
- `GET /api/audit-log`
- `GET /api/settlement/payment-methods`

Data flow:

- reads/writes JSON config files in `PPTX_CONFIG_DIR`
- reads/writes resource files in `CONFIG_IMG_DIR`
- validates:
  - PPTX/card image paths
  - slip config schema
- audit viewer/export reads `audit_log`

---

### 7) Slideshow

File:

- `public/slideshow/index.html`

Current slideshow flow is kiosk-oriented.

Flow:

1. Operator signs in with an account that has `slideshow`.
2. Frontend fetches available slideshow auctions from `GET /api/slideshow/auctions`.
3. User picks an auction by `public_id`.
4. Frontend starts kiosk session mode through `AppAuth`.
5. Slideshow stores:
   - selected `public_id`
   - selected auction name
   - slideshow config
6. Frontend fetches slideshow items and rotates through them with periodic refresh.

Endpoints:

- `POST /api/login`
- `POST /api/validate`
- `GET /api/slideshow/auctions`
- `GET /api/auctions/:publicId/slideshow-items`
- `GET /api/uploads/<photo_filename>`

Important difference from older behavior:

- slideshow no longer depends on `POST /api/validate-auction` for auction selection
- it uses an authenticated kiosk flow and a direct auction list endpoint instead

---

## Current frontend-visible route summary

Authentication/session:

- `POST /api/login`
- `POST /api/validate`
- `GET /api/preferences`
- `POST /api/preferences`
- `POST /api/change-password`

Public:

- `POST /api/validate-auction`
- `POST /api/auctions/:publicId/newitem`

Admin:

- `POST /api/list-auctions`
- `POST /api/auction-status`
- `POST /api/auctions/update-status`
- `GET /api/auctions/:auctionId/items`
- `POST /api/auctions/:auctionId/items/:id/update`
- `DELETE /api/items/:id`
- `POST /api/items/:id/restore`
- `POST /api/auctions/:auctionId/items/:id/move-auction/:targetAuctionId`
- `POST /api/auctions/:auctionId/items/:id/move-after/:after_id`
- `GET /api/auctions/:auctionId/bidders`
- `POST /api/auctions/:auctionId/bidders`
- `PATCH /api/auctions/:auctionId/bidders/:bidderId`
- `GET /api/audit-log`
- `POST /api/export-csv`
- `POST /api/generate-pptx`
- `POST /api/generate-cards`
- `GET /api/export-jobs/pptx/status`
- `POST /api/export-jobs/pptx/cancel`
- `GET /api/export-jobs/pptx/download`
- `GET /api/auctions/:auctionId/items/manual-entry-sheet`
- `GET /api/auctions/:auctionId/report-pdf`
- `GET /api/auctions/:auctionId/bidder-report-pdf`
- `GET /api/auctions/:auctionId/items/:id/print-slip`
- `GET /api/auctions/:auctionId/items/print-slip`
- `POST /api/auctions/:auctionId/items/confirm-slip-print`
- `POST /api/auctions/:auctionId/items/reset-export-tracking`
- `POST /api/lots/:itemId/finalize`
- `GET /api/lots/:itemId/undo-preview`
- `POST /api/lots/:itemId/undo`

Cashier/live feed/settlement:

- `GET /api/cashier/live/:auctionId`
- `POST /api/cashier/live/:auctionId/bidders/:bidderId/ready`
- `POST /api/cashier/live/:auctionId/items/:itemId/collection`
- `POST /api/cashier/live/:auctionId/bidders/:bidderId/collect-all`
- `GET /api/cashier/live/:auctionId/uncollected.csv`
- `GET /api/settlement/bidders`
- `GET /api/settlement/bidders/:bidderId`
- `GET /api/settlement/payment-methods`
- `POST /api/settlement/payment/:auctionId`
- `POST /api/payments/intents`
- `GET /api/payments/intents/:id`
- `POST /api/settlement/payment/:paymentId/reverse`
- `GET /api/settlement/export.csv`
- `GET /api/settlement/summary`

Maintenance:

- `POST /api/maintenance/backup`
- `GET /api/maintenance/backups`
- `GET /api/maintenance/backups/:backupId`
- `GET /api/maintenance/backups/:backupId/download`
- `DELETE /api/maintenance/backups/:backupId`
- `POST /api/maintenance/backups/:backupId/restore`
- `GET /api/maintenance/download-db`
- `POST /api/maintenance/restore`
- `GET /api/maintenance/export`
- `POST /api/maintenance/import`
- `POST /api/maintenance/reset`
- `POST /api/maintenance/auctions/list`
- `POST /api/maintenance/auctions/create`
- `POST /api/maintenance/auctions/update`
- `POST /api/maintenance/auctions/delete`
- `POST /api/maintenance/auctions/purge-deleted-items`
- `POST /api/maintenance/auctions/set-admin-state-permission`
- `GET /api/maintenance/users`
- `POST /api/maintenance/users`
- `PATCH /api/maintenance/users/:username/access`
- `POST /api/maintenance/users/:username/password`
- `POST /api/maintenance/users/:username/logout-now`
- `DELETE /api/maintenance/users/:username`
- `POST /api/maintenance/restart`
- `GET /api/maintenance/logs`
- `GET /api/maintenance/photo-report`
- `GET /api/maintenance/check-integrity`
- `POST /api/maintenance/check-integrity/fix`
- `GET /api/maintenance/orphan-photos`
- `POST /api/maintenance/cleanup-orphan-photos`
- `POST /api/maintenance/generate-test-data`
- `POST /api/maintenance/generate-bids`
- `POST /api/maintenance/delete-test-bids`
- `GET /api/maintenance/get-pptx-config/:name`
- `POST /api/maintenance/save-pptx-config/:name`
- `POST /api/maintenance/pptx-config/reset`
- `POST /api/maintenance/resources/upload`
- `GET /api/maintenance/resources`
- `POST /api/maintenance/resources/delete`
- `GET /api/maintenance/audit-log/export`

Slideshow:

- `GET /api/slideshow/auctions`
- `GET /api/auctions/:publicId/slideshow-items`

Static backend-served assets:

- `GET /api/uploads/*`
- `GET /api/resources/*`

---

## Summary

The application has advanced from the `2.2` baseline to include:

- shared authenticated operator sessions
- explicit permissions layered on top of roles
- server-persisted per-user preferences
- soft-delete/restore item lifecycle
- async export/report generation
- donation-aware settlement and reversals
- live-feed collection tracking
- managed backup archives with selective restore
- authenticated slideshow kiosk mode

Any future design changes should update this document together with:

- `backend/db.js` schema history
- the frontend route inventory above
- retired-route notes when a frontend surface stops using an endpoint
