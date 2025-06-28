# convention-auction

Web platform to collect, manage, and present auction items for the kind of auctions often encountered at fan conventions. The use case may vary slightly from con to con, but generally looks like this:

Attendees submit items before / during the event
A live auction is held, using a slide deck to show items
Attendees bid on items by holding up a paddle card
Attendees pay for and collect their won items.


## Features
- Supports multiple simultaneous auctions with state management
- Public item submission (with optional photo)
- Admin panel to edit, delete, and manage items
- Cashier panel to manage payments
- Maintenance tools: database reset, logs, auditing, import/export, etc.
- Automatic PowerPoint generation from custom templates
- Slideshow for in-venue advertising
- Mobile-friendly interfaces

## Stack

- Node.js + Express
- SQLite (via better-sqlite3)
- Plain HTML, CSS, JS
- Hosted via a webserver of your choice (e.g. Apache + HTTPS + Let's Encrypt)

