---
name: setup-nginx
description: Setup and configure Nginx as a reverse proxy or web server with SSL support
---

## Overview

This skill helps you set up Nginx with common configurations including reverse proxy, SSL, and load balancing.

## Steps

1. **Install Nginx**
   ```bash
   sudo apt update && sudo apt install nginx
   ```

2. **Create a server block configuration**
   ```nginx
   server {
       listen 80;
       server_name example.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

3. **Enable the site**
   ```bash
   sudo ln -s /etc/nginx/sites-available/example.com /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

4. **Setup SSL with Let's Encrypt** (optional)
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d example.com
   ```
