**Auction software - quick start guide**

This program is designed for the kind of auctions often encountered at fan conventions. The use case may vary slightly from event to event, but generally looks like this:

1. Attendees and/or staff submit items during the event
2. A live auction is held, using a slide deck to show items
3. Attendees bid using paddle numbers
4. Attendees pay for and collect their won items

This process is usually labour-intensive for convention staff. The software is designed to automate as much of it as possible.

A full user guide is available from the **Help** menu on each screen, but this guide provides the key steps required to operate the app.

**Entry points**

The following pages are provided:

| Path | Login | Use |
| ------ | ------- | ----- |
| `/` | none | Public item submission page |
| `/login.html` | operator | Shared operator login page |
| `/admin` | `admin` | **Manage Items** - item entry, editing, bidding, exports |
| `/maint` | `maintenance` | **Manage Auctions** - setup, templates, backups, diagnostics, user management |
| `/cashier` | `cashier` | **Manage Payments** - bidder settlement, receipts, payment summaries |
| `/slideshow` | `slideshow` | Standalone slideshow for public display |

All operator pages use a shared session. After signing in once, you can move between the pages your account can access from the **Open** menu.

**Quick start**

[Manage Auctions] Configure users and access.

* On first run, the backend creates a default **root** user with full access.
* The initial root password is generated randomly and shown once in the server startup logs.
* Sign in as root, change the password from the **user** menu, then select **Manage Users** to create named user accounts as required.
* Users with Manage Users permissions can create other users with access up to their own access.
* The root user cannot be deleted and always has full access.
* Non-root passwords can be reset from the Manage Auctions UI.
* If the root password is lost, reset it with the `server-management.js` console tool on the server.

[Manage Auctions] Create at least one auction.

* The auction name is used in operator screens and public-facing headers.
* The URL tag is used to open the public page directly, for example `index.html?auction=[tag]`. This is intended for QR codes and similar uses.
* The URL tag is case-insensitive and cannot contain spaces.
* If you want a custom logo or image on the public page, upload it first in **Image Management**, then select it when creating or editing the auction.

Multiple auctions are supported. This is useful for cases such as:

* Separating pre-registration intake
* Public submissions
* Keeping previous years' data
* Operator training or test auctions

[Manage Auctions] Configure templates and resources if needed.

* Use **Template Editor** to configure the auction slide pack and item slip/card output.
* Use **Image Management** to upload shared graphics used by auction branding or templates.
* See `pptx_template_editing.md` for the JSON fields controlling slide layout.

Items can now be added by four routes:

1. [Public] Attendees can submit items from the public page. Item name and contributor are mandatory. A creator can also be supplied. On mobile, users can take a photo or choose one from the gallery. A checkbox is provided for cases where no photo is available.
2. [Manage Items] Use **Create New Item...** to add items directly.
3. [Manage Auctions] Import items in CSV format. Photos are not imported automatically, but they can be added later in **Manage Items**.
4. [Manage Auctions] Use **Test Data Generator** to create sample items for training or template testing. Test items include **[T]** in the name.

[Manage Items] The following item operations are supported while the auction is editable:

* Edit contributor, description, creator, and notes
* Upload a new photo
* Rotate or crop the photo
* Duplicate an item
* Move an item within the current auction
* Move an item to a different auction
* Delete an item (deletes are "soft" until purged using the Manage Auctions screen)
* Restore deleted items
* Change table sort order and visibility options
* Manage optional bidder names
* View item history/audit
* Print individual item slips

Item numbers are automatically maintained as a continuous `1...n` sequence with no gaps.

[Manage Items] Export options include:

* CSV export
* Generate auction slide pack
* Generate item slips / labels
* Generate an Auction report or Bidder report

[Slideshow] A standalone slideshow is provided for public display. It is intended to run fullscreen and unattended, cycling through the items in the selected auction. Touchscreen-only operation is supported.

The following controls are provided:

* Press `[c]` or long-press the screen to open the control panel
* `[space]` pauses or resumes the slideshow
* Toggle contributor / description / creator display
* Turn shuffle on or off
* Set the time per item

Because the slideshow is expected to run unattended, using it will log out other functions in the same browser session.

[Manage Auctions] Set the auction state to **locked** when public submissions should stop. The public page will show that the auction is not accepting submissions, while **Manage Items** users can continue to tidy and add items.

[Manage Auctions] When ready for the live auction, set the state to **live**.

* **Manage Items** switches to bidding mode.
* Editing controls are disabled.
* Users with **Manage Bids** (`admin_bidding`) can record and retract bids.
* **Manage Collections** can be used by staff to follow live progress and prepare sold items for pickup.

[Manage Items] During the live auction, use the bid controls to record paddle number and hammer price as each lot is sold. A running total is shown in the header. Bid retraction is available for corrections.

[Manage Auctions] Set the auction state to **settlement** to take payments. The system will also switch to this state automatically once all items have received bids.

[Manage Payments] Select a bidder to view the won items and current balance.

* Supported payment methods depend on configuration and can include cash, manual card, manual PayPal, and SumUp options.
* Part-payment / split-payment workflows are supported.
* Refunds/reversals can be recorded.
* Receipts can be printed.
* A payment summary and CSV settlement export are available.

Note: payment is recorded against the bidder, not against individual items. If a bidder pays only for part of their lots, staff will need to track which items are being released.

[Manage Collections] Use the live collections view to group sold items by bidder (to allow pre-assembly of bidders' items), mark buckets ready, view bidder fingerprint details where used, and mark items as collected.

[Manage Items] In case of errors, bids can still be retracted in **settlement**, provided the change would not leave the bidder with a negative balance because of payments already recorded.

[Manage Auctions] When the event is complete, set the auction state to **archived**. The auction is then preserved in read-only form. An Auction report can be generated from **Manage Items** including totals and statistics on the auction drawn from the database.

**Auction states**

Each auction has one of the following states:

Setup: Public submission is open. **Manage Items** users can add and edit items.  
Locked: Public submission is blocked, but **Manage Items** users can continue to edit or add items.  
Live: Bids are being recorded. Item editing is blocked.  
Settlement: Payments are being taken. Bid corrections are still possible if payment rules allow it.  
Archived: The auction is preserved in a read-only state.
