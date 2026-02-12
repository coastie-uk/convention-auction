**Deployment Guide**

This guide explains how to deploy the Auction App backend and frontend using Node.js, Apache, PM2, and Let's Encrypt for free HTTPS certificates. It assumes an Ubuntu comamnd style (developed on Mint & Ubuntu).

The default locations are:

    Backend:     /srv/auction/
    database:        /var/lib/auction
    Data:        /var/lib/auction
        Uploaded images:        /resources
        Auction item pictures:  /uploads
        DB backups:             /backup
        Generated outputs:      /output
    Secure env:  /etc/auction
    Logs:        /var/log/auction
    Frontend:    /var/www/auction-frontend

If your installation requires different paths, remember to update config.json accordingly and adapt the instructions.

---

## **System Requirements**

* Linux server
* Root/sudo access 
* A registered domain name (e.g. `yourdomain.com`) pointing to your server's IP address

---

## **Install Node.js**

Install the latest supported LTS version (18.x recommended):

    sudo apt update  
    sudo apt install nodejs

Verify:

    node -v  
    npm -v

---


## Create a dedicated service user

```
sudo useradd --system --home /srv/auction --shell /usr/sbin/nologin auction
```

## Create directories

```
sudo mkdir -p /srv/auction /var/lib/auction /var/log/auction /etc/auction /var/www/auction-frontend

# Data subfolders
sudo mkdir -p /var/lib/auction/resources /var/lib/auction/backup /var/lib/auction/uploads /var/lib/auction/output

```



## Ownership & permissions:

```
sudo chown -R auction:auction /srv/auction /var/lib/auction /var/log/auction
sudo chmod 750 /srv/auction /var/lib/auction /var/log/auction
sudo chmod 750 /etc/auction
```

## **Setup Your Project Directory and install dependancies**

Clone or copy the repository to a convenient folder on the server

    git clone https://github.com/coastie-uk/convention-auction 

Copy the backend and frontend to the required folder

    sudo rsync -a [path to the repo]/convention-auction/backend/ /srv/auction/
    sudo rsync -a [path to the repo]/convention-auction/public/ /var/www/auction-frontend


Navigate to the folder:

    cd /srv/auction/

Install Node dependencies:

    npm install

Set ownership of the backend and frontend files

    sudo chown -R auction:auction /srv/auction
    sudo chown -R www-data:www-data /var/www/auction-frontend

---

## Create the env file

Copy auction.env.example to /etc/auction/auction.env and update the contents
At minimum, you must set the SECRET_KEY and enable the required payment methods
When done, set restrictive permissions (0640, root:auction)

```
# Quick way to generate a suitable SECRET_KEY value (or use your own)
openssl rand -base64 48

# Create auction.env and edit as required
sudo cp auction.env.example /etc/auction/auction.env
sudo nano /etc/auction/auction.env

# Set permissions - IMPORTANT!
sudo chown root:auction /etc/auction/auction.env
sudo chmod 640 /etc/auction/auction.env
```

## **Configure backend config.json**

`backend/config.json` contains the non-secret runtime settings for the backend. Secrets (like `SECRET_KEY`) must live in `/etc/auction/auction.env`, not in `config.json`. The backend validates the config on startup and will exit if required values are missing or out of range.

The defaults should suffice for most use cases, but you may want to adjust based on your server configuration / capabilities.

Below is a description of each setting:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `PORT` | number | `3000` | Port for the HTTP server. Range: **1–65535**. |
| `CONFIG_IMG_DIR` | text | `"/var/lib/auction/resources"` | Directory for config images/resources. Must be a non-empty string. |
| `BACKUP_DIR` | text | `"/var/lib/auction/backup"` | Directory for DB backups. Must be a non-empty string. |
| `UPLOAD_DIR` | text | `"/var/lib/auction/uploads"` | Directory for uploaded item images. Must be a non-empty string. |
| `PPTX_CONFIG_DIR` | text | `"/var/lib/auction"` | Directory for PPTX config files. Must be a non-empty string. |
| `OUTPUT_DIR` | text | `"/var/lib/auction/output"` | Directory for generated outputs. Must be a non-empty string. |
| `DB_PATH` | text | `"/var/lib/auction"` | Directory where the database file lives. Must be a non-empty string. |
| `DB_NAME` | text | `"auction.db"` | Database filename. Length **1–100** characters. |
| `LOG_DIR` | text | `"/var/log/auction"` | Directory for log files. Must be a non-empty string. |
| `LOG_NAME` | text | `"server.log"` | Log filename. Must be a non-empty string. |
| `SAMPLE_DIR` | text | `"sample-assets"` | Directory for sample assets. Must be a non-empty string. |
| `MAX_UPLOADS` | number | `100` | Max config images allowed. Range: **1–1000**. |
| `allowedExtensions` | list | `[".jpg", ".jpeg", ".png"]` | Allowed upload file extensions. Each entry should be a non-empty string. |
| `LOG_LEVEL` | text | `"INFO"` | Logging level (e.g., `DEBUG`, `INFO`, `WARN`, `ERROR`). Length **3–10** characters. |
| `MAX_AUCTIONS` | number | `100` | Max auctions allowed in the system. Range: **1–100**. |
| `MAX_ITEMS` | number | `2000` | Max items across auctions. Range: **1–10000**. |
| `CURRENCY_SYMBOL` | text | `"£"` | Currency symbol for display. Length **1–3** characters. |
| `PASSWORD_MIN_LENGTH` | number | `8` | Minimum password length. Range: **5–100**. |
| `RATE_LIMIT_WINDOW` | number | `60` | Public item submisison rate limit window in seconds. Range: **1–86400**. |
| `RATE_LIMIT_MAX` | number | `10` | Public item submisison max requests per rate limit window. Range: **1–1000**. |
| `LOGIN_LOCKOUT_AFTER` | number | `8` | Failed login attempts before lockout. Range: **1–1000**. |
| `LOGIN_LOCKOUT` | number | `600` | Lockout duration in seconds. Range: **1–86400**. |
| `SERVICE_NAME` | text | `"auction-backend"` | Service name used in logs/process metadata. Length **1–100** characters. |
| `ENABLE_CORS` | boolean | `false` | Enable CORS handling. |
| `ALLOWED_ORIGINS` | list | `["localhost:3000", "example.com:3000"]` | Allowed origins when CORS is enabled. Each entry is trimmed; empty strings are ignored. |

If you make changes once the server is running, remember to restart the service to pick up changes:

```bash
sudo systemctl restart auction-backend
```

## **Start the server**

From within /srv/auction/ confirm that the backend starts

    node backend.js

You should see a number of log entries similar to those shown below. Any errors should be investigated before proceeding. Most likely culprits are paths and permissions

```
[WARN] [unknown] [General] Database file not found; creating new database at /var/lib/auction/auction.db
[WARN] [unknown] [General] Schema version missing or mismatched (db=missing, expected=2.4); Running DB se>
[WARN] [unknown] [General] Created default root account with full permissions.
[WARN] [unknown] [General] Initial root password (shown once): [Random password]
[INFO] [unknown] [General] Database opened
[INFO] [unknown] [General] ~~ Starting up Auction backend ~~
[INFO] [unknown] [Logger] Logging framework initialized.
[INFO] [unknown] [General] Backend version: 2.1.0, DB schema version: 2.4
[INFO] [unknown] [General] Payment processor: SumUp 1.2.0(2026-02-09)
[INFO] [unknown] [Logger] Log level set to DEBUG
[INFO] [unknown] [General] CORS is disabled.
[INFO] [unknown] [General] Server startup complete and listening on port 3000
```

On first run the backend will:
    Create the database
    Create a logfile
    Create a root user and set the intial password
    Generate default pptx config files
    Copy default image resource files into the required folder

Note the root password (it won't be shown again). Ctrl-C to terminate the backend process, and continue setting up.

## Create the systemd service

Copy the provided auction-backend.service file to `/etc/systemd/system/auction-backend.service`:

```bash
sudo cp auction-backend.service /etc/systemd/system/auction-backend.service
```

If you've adjusted any of the default paths, remember to update the following lines to match:

    WorkingDirectory=/srv/auction
    EnvironmentFile=/etc/auction/auction.env
    ExecStart=/usr/bin/node /srv/auction/backend.js
    ReadWritePaths=/var/lib/auction /var/log/auction
    ReadOnlyPaths=/srv/auction
 

### 5) Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now auction-backend
sudo systemctl status auction-backend
```

### 6) Verify

```bash
sudo journalctl -u auction-backend -f
```
---



## **Install and Configure Apache**

Install Apache:

    sudo apt install apache2

Enable required modules:

    sudo a2enmod ssl proxy proxy_http proxy_wstunnel headers rewrite
    sudo systemctl reload apache2

Create a virtual host file:

    sudo nano /etc/apache2/sites-available/auction.conf

Paste and edit the config to include your domain name. If you already have SSL keys, uncomment those lines and point them to the required files.

```
<VirtualHost *:80>
    ServerName yourdomain.com
    Redirect permanent / https://yourdomain.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName yourdomain.com

#   If you have your own certificatesm insert them here. Otherwise leave as-is and let CertBot update the file
#   SSLEngine on
#   SSLCertificateFile /etc/letsencrypt/live/yourdomain.com/fullchain.pem
#   SSLCertificateKeyFile /etc/letsencrypt/live/yourdomain.com/privkey.pem

    DocumentRoot /var/www/auction-frontend

    <Directory /var/www/auction-frontend>
        Options Indexes FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    ProxyPreserveHost On
    ProxyPass /api/ http://localhost:3000/
    ProxyPassReverse /api/ http://localhost:3000/

    # SumUp webhook for web payments - Note the placement of trailing '/'
    ProxyPass /payments/sumup/webhook http://localhost:3000/payments/sumup/webhook/
    ProxyPassReverse /payments/sumup/webhook http://localhost:3000/payments/sumup/webhook/

    # SumUp webhook for app payments - Note the placement of trailing '/'
    ProxyPass /payments/sumup/callback/ http://localhost:3000/payments/sumup/callback/
    ProxyPassReverse /payments/sumup/callback/ http://localhost:3000/payments/sumup/callback/

    ErrorLog ${APACHE_LOG_DIR}/auction-error.log
    CustomLog ${APACHE_LOG_DIR}/auction-access.log combined
</VirtualHost>
```

Enable the site:

    sudo a2ensite auction.conf  
    sudo systemctl restart apache2

---

## **Install HTTPS via Let's Encrypt with CertBot**

Install Certbot:

    sudo apt install certbot python3-certbot-apache

Generate and install a free certificate:

    sudo certbot --apache -d yourdomain.com

When prompted, choose to redirect all HTTP to HTTPS.

Test automatic renewal:

    sudo certbot renew --dry-run

Restart Apache if changes don’t take effect:  
    sudo systemctl restart apache2

To test your installation, go to [Your URL]/maint. Login as "root" and the initial password you noted earlier. The "security" tab can be used to create additional users as required. 

For futher instructions, see quickstart.md

For instructions for setting up SumUp, see sumup_setup.md

Additional changes

If required, update front-end browser icon (/images/favicon.png)
If required, update default auction logo (/resources/default_logo.png)

---

The default setup assumes that frontend and backend are running on the same server- /api/ is proxied to the backend on localhost, port 3000\. If this is not the case, changes may be needed depending on your configuration and how the connections are proxied.

* If a port other than 3000 is needed, edit the port setting in config.json.
* Update the Apache site .conf file as required to relay the traffic to the target server
* CORS may be needed to prevent browsers blocking the cross-domain traffic. The backend has been built with CORS middleware - Set ENABLE_CORS = true and populate ALLOWED_ORIGINS with the required addresses.

## Server Management (CLI-only)

`node server-management.js` is a self-contained node CLI tool which exposes maintenance tasks that are intentionally not available in the web UI. Run it from the server to perform:

- Reset passwords
- Remove all users (apart from the root user)
- Clear the audit log
- Reset the database (clears bidders, auctions, items, payments, and payment intents). Item counters are not reset to maintain alignment with the audit log
- Reset the database **and** counters (effectively results in a new database, but with the existing users)


## **Setup PM2 to Run the Backend**

Note: For security reasons it is recommended to run the backend as a service. These PM2 instructions have been retained for test/legacy purposes.

PM2 provides a convenient method to manage the backend and also allows the maintenance GUI to restart the server.

Install PM2 globally:

    sudo npm install -g pm2

Start and name your app:

    pm2 start backend.js --name auction

Save the PM2 process list:

    pm2 save

Enable startup on boot:

    pm2 startup  
\# Follow the printed instructions to enable startup

To view console output:

    pm2 logs auction  

To remove a site:

    pm2 stop auction  
    pm2 delete auction  
    pm2 save

---

