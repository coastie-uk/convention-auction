# convention-auction

Web platform to collect, manage, present, record bids and take payment for items at the kind of auctions 
often encountered at fan conventions. The use case may vary slightly from 
con to con, but generally looks like this:

- Attendees submit items before / during the event
- A live auction is held, using a slide deck to show items
- Attendees bid on items by holding up a paddle card
- Attendees pay for and collect their won items.

This software provides a single platform which automates the process from item submission through to payment.

## Features
- Supports multiple simultaneous auctions with managed state lifecycle
- Public item submission (with optional photo) & QR code support
- Admin panel to add, edit, delete, and manage items, including image rotate/crop
- Bid recording view with undo function
- Cashier panel to record payments
- Maintenance tools: manage auctions, logs, auditing, import/export, auto-create test items, etc.
- Automatic PowerPoint generation from custom templates (slide deck + item cards)
- Auto-updating slideshow for in-venue advertising
- Mobile-friendly interfaces

## Limitations

- Integration with payment providers (e.g. SumUp) has not been included in this version

## System Requirements

- Linux server (developed on Mint) 
- Root/sudo access for installation (runs as normal user)  
- A registered domain name pointing to your server's IP address

## Stack

- Node.js + Express
- SQLite (via better-sqlite3)
- Plain HTML, CSS, JS
- Hosted via a webserver of your choice (insturctions included for Apache + HTTPS + Let's Encrypt)


## Installation

See installation.md

## Quick-start

see quickstart.md
