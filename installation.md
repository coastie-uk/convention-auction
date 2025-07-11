**Deployment Guide**

This guide explains how to deploy the Auction App backend and frontend using Node.js, Apache, PM2, and Let's Encrypt for free HTTPS certificates.
If your installation requires different paths, remember to update the configuration accordingly and set the correct permissions.

---

## **System Requirements**

* Linux server (developed on Mint) 
* Root/sudo access  
* A registered domain name (e.g. `yourdomain.com`) pointing to your server's IP address

---

##  **Install Node.js**

Install the latest supported LTS version (18.x recommended):

    sudo apt update  
    sudo apt install nodejs

Verify:

    node -v  
    npm -v

---

## **Set Up Your Project Directory and install dependancies**

Clone or copy your project to the server:

    git clone https://github.com/coastie-uk/convention-auction 
    cd convention-auction/backend

Install Node dependencies:

    npm install

---

## **Step 3: Use PM2 to Run the Backend**
PM2 is not required, but it provides a convenient method to manage the backend and also allows the maintenance GUI to restart the server.

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

## **Step 4: Install and Configure Apache**

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

    ErrorLog ${APACHE_LOG_DIR}/auction-error.log
    CustomLog ${APACHE_LOG_DIR}/auction-access.log combined
</VirtualHost>
```

Deploy static frontend files to `/var/www/auction-frontend`

    sudo chown -R www-data:www-data /var/www/auction-frontend

Enable the site:

    sudo a2ensite auction.conf  
    sudo systemctl reload apache2

---

## **Step 5: Install HTTPS via Let's Encrypt**

Install Certbot:

    sudo apt install certbot python3-certbot-apache

Generate and install a free certificate:

    sudo certbot --apache -d yourdomain.com

When prompted, choose to redirect all HTTP to HTTPS.

Test automatic renewal:

    sudo certbot renew --dry-run

Restart Apache if changes don’t take effect:  
    sudo systemctl restart apache2


Additional changes

Set SECRET_KEY in config.json then restart the backend ("pm2 restart auction")
If required, update front-end browser icon (/images/favicon.png)
If required, Update default auction logo (/resources/default_logo.png)

---

The default setup assumes that frontend and backend are running on the same server- /api/ is proxied to the backend on localhost, port 3000\. If this is not the case, the following changes will be needed:

* If a port other than 3000 is needed, edit the port setting in config.json.
* Update the $API constant in each frontend script file to point to the correct backend server and port 
* Update the Apache site .conf file as required  
* The backend will require CORS to prevent browsers blocking the cross-domain traffic. The code required for this is present in [backend.js] but will need to be uncommented and configured for your use.



