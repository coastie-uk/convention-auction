# ManeBid

**Convention Auction Manager**

Web platform to collect, manage, present, record bids and take payment for items at the kind of auctions often encountered at fan conventions. The use case may vary slightly from con to con, but generally looks like this:

- Attendees submit items before / during the event
- A live auction is held, using a slide deck to show items
- Attendees bid on items by holding up a paddle card
- Attendees pay for and collect their won items.

This software provides a single platform which automates the process from item submission through to payment. This now includes integration with the SumUp merchant platform allowing payments to be taken and recorded through the platform.

## Features
- Supports multiple simultaneous auctions with managed state lifecycle
- Public item submission (with optional photo) & QR code support
- Admin panel to add, edit, delete, and manage items, including image rotate/crop
- Bid recording view with undo function
- Cashier panel to record payments
- Integration with SumUp supporting web hosted checkouts and app payments with a card reader.
- Maintenance tools: manage auctions, logs, auditing, import/export, auto-create test items, etc.
- User accounts with username/password login, per-user roles, and extra scoped permissions
- Automatic PowerPoint generation from custom templates (slide deck + item cards)
- Printing of receipt-style item slips
- Auto-updating slideshow for in-venue advertising
- Automatic randomised item & bid generators (for testing/training/evaluation)
- Mobile-friendly interfaces

## New v3 Features

- Completely reworked menu-driven UI with single login point
- Fine-grained access control
- User preference persistence, including operator theme settings and other per-user UI state
- Soft-delete workflow for auction items, with restore support
- Managed backup archives with metadata, downloadable restore bundles, and selective restore of database, photos, and resource/config assets
- Improved export functions including auction and bidder report generation
- New item assembly management and collection tracking

## New in 3.1

- Auction QR code generation for public submission links
- Operator messaging with attention/acknowledgement support
- Improved SumUp payment recovery and verification for pending payments
- Managed backup import/restore improvements and clearer maintenance diagnostics
- CSV item import with preview, validation, and optional images
- Hardened browser sessions, CSRF protection, upload limits, and backup validation

## System Requirements

- Linux server (developed on Ubuntu & Mint)
- Either Docker Engine with Compose, or Node.js 20+ and root/sudo access for
  the standalone installation
- A registered domain name pointing to your server's IP address
- For SumUp payments, a SumUp merchant account and card reader

## Stack

- Node.js + Express
- SQLite (via better-sqlite3)
- Plain HTML, CSS, JS
- Hosted via a webserver of your choice (instructions included for Apache + HTTPS + Let's Encrypt)
- Optional Docker Compose deployment with a Caddy HTTPS frontend


## Installation

- For Docker deployment see [docs/docker_installation.md](docs/docker_installation.md)
  or the [hosted guide](https://mainbid.co.uk/docker_installation.html).
- For standalone Node.js/Apache setup see
  [docs/installation.md](docs/installation.md) or the
  [hosted guide](https://mainbid.co.uk/installation.html).
- For payment setup see [docs/sumup_setup.md](docs/sumup_setup.md) or the
  [hosted guide](https://mainbid.co.uk/sumup.html).
- For PowerPoint and item slip template setup see
  [docs/template_editing.md](docs/template_editing.md) or the
  [hosted guide](https://mainbid.co.uk/pptx_guide.html).

## Quick-start

See [docs/quickstart.md](docs/quickstart.md) or the
[hosted guide](https://mainbid.co.uk/quickstart.html).
