**Auction software \- quick start guide**

This program is designed for the kind of auctions often encountered at fan conventions. The use case may vary slightly from con to con, but generally looks like this:

1) Attendees (and/or staff) submit items during the event  
2) A live auction is held, using a slide deck to show items  
3) Attendees bid on items by holding up a paddle card  
4) Attendees pay for and collect their won items.

This process is typically hard work for the convention staff - This program is designed to automate as much as possible

**Entry points**

The following pages are provided:

| Path        | Login       | Use                                                                 |
|-------------|-------------|----------------------------------------------------------------------|
| `/`         | none        | Public submissions page                                              |
| `/admin`    | admin       | Tools for managing auctions                                          |
| `/maint`    | maintenance | Tools for setting up and using the program                           |
| `/cashier`  | cashier     | Tools for viewing the live progress of the auction, and performing payment tasks |
| `/slideshow`| admin       | A standalone slideshow of auction items for public display          |


All logins are session based and will remain logged in for several hours, unless explicitly logged out

**Quick start**

\[Maintenance\] Create at least one auction. 

* The name is used to populate the header of the public submission page  
* The short name is used as a URL tag to allow the public page to be opened directly e.g. index.html?auction=\[shortname\]. Intended for use in QR codes etc. The tag is case insensitive and cannot contain spaces  
* If a custom picture is desired on the public submission page, use the “manage resources” function to upload a suitable image before selecting the picture during auction creation.

Multiple auctions are supported (default limit is 20). This has been included for flexibility. For example:

* Create an auction for pre-registration  
* Create an auction for public submissions. Move items to a different auction after review & edit  
* Retain previous years auction data  
* Create separate test auctions for template generation or training

\[Maintenance\] Set passwords as required for the admin, maintenance and cashier roles. Note that if the maintenance password is lost, it will need to be reset by running node set-maint-pw.js on the server.

Default passwords:

| Role        | Pass  |
|-------------|-------|
| admin       | admin123 |
| maintenance | maint123 |
| cashier     | cashier123 |

\[Maintenance\] Configure the auction template generator and item card generator (if needed). This uses the pptxgenjs library. Custom graphics can be added via the “manage resources” function. See pptx_template_editing.md for the JSON fields that control slide layout.

Items can now be added via four routes:

1) \[Public\] Attendees can now submit items via the public page. Item name and contributor are mandatory. A creator can also be added. On a mobile, options are provided to take a live photo or select one from the gallery. A checkbox “I don’t have a photo” is provided, if needed.  
2) \[Admin\] The “add item” function can be used to add items  
3) \[Maintenance\] Items can be imported in CSV format into the database. Note that photos cannot be added automatically, but these can be added to the items via the \[admin\] “edit item” function  
4) \[Maintenance\] A user-configured number of auto-generated items can be added to the auction for test purposes. Test items will show a **\[T\]** in their name to show they have been automatically generated.

\[admin\] The following functions are supported (subject to the state restrictions below)

* Edit contributor, description, creator and notes  
* Upload a new photo  
* Rotate the photo  
* Crop the photo  
* Move the item within the current auction  
* Move the item to a different auction. The item will be placed at the end of the target auction  
* Delete the item  
* Change the sort order of the table  
* View the history of the item

Item number is automatically updated to maintain a 1…n sequence with no gaps.

\[admin\] the following export options are provided:

* CSV export  
* Generate auction slide pack  
* Generate item labels (e.g. for table display)

\[admin\] A slideshow is provided. This is designed to run full screen / unattended and cycles through all items in the auction. Touchscreen-only operation is supported. 

The following controls are provided:

* Press \[c\] or long screen press \- Open control panel. The panel will auto-close after a few seconds of inactivity  
* \[space\] \- pause / resume slideshow  
* Select display of contributor / description / creator  
* Turn shuffle on/off  
* Set the time per item

As the slideshow is expected to run unattended, running it will log out other functions on the browser (e.g. to prevent an attendee from using the browser back button).

\[maintenance\] Set the auction state to “locked”. This locks out the public submission page with a message “this auction is not accepting submissions”. \[admin\] users are free to edit and add items as required.

\[maintenance\] When the auction is ready, set the state to “live”. The \[admin\] display now changes to include bid recording controls, and all editing controls are disabled.

\[admin\] Use the “finalise” control to add bidder and price information as the auction progresses. An undo function is provided to retract/edit a bid. A running total is provided in the top bar.  
\[Admin / cashier\] The live view display displays all items sorted by winning bidder, to allow pre-assembly of won items while the auction is in progress.

\[maintenance\] Set the auction state to “settlement” to allow payments to be taken. The auction will also switch to this state automatically once all items have received bids.

\[Cashier\] Selecting a bidder displays the won items and total due. Payment by cash, PayPal and credit card are catered for. Part payment / split payment method are supported, as are refunds.

Note: Payment is recorded against the bidder, not the items. Part payment for a subset of items will need to be tracked manually.

A summary of payments made by type is available, and a CSV report of all payments can be exported.

\[admin\] A bid can still be retracted at this stage, as long as the original bidder has not made payments which would result in a negative balance once the bid has been retracted.

\[maintenance\] Once all operations have been completed, set the auction state to “archived”. All editing is now blocked.

**Auction states**

Each auction has one of the following states, which affects what operations can be done. In summary:

Setup: Public submission of items. Admin can edit as required  
Locked: Public submission is blocked, but admin can continue to edit or add items as needed  
Live: Bids are being recorded. No editing is possible  
Settlement: Payments are being taken. Bids can be edited, but only if the winning bidder has not paid  
Archive: The auction is preserved in a read-only state
