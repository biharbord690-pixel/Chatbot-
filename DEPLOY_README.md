# BGB WhatsApp AI CRM (Wapio-Style Full-Stack Platform) — 24/7 Server Deployment Guide

Full-stack WhatsApp AI Automation & Live CRM built with **Next.js 15 (App Router)**, **React 19**, **Tailwind CSS v4**, **Express 5**, **Socket.IO**, **`@whiskeysockets/baileys`** (QR Code + 8-Digit Pairing Code), and **`@google/genai`** (`gemini-2.5-flash` with live Bihar Gramin Bazaar function calling).

---

## 1. System & Node.js Requirements

- **Node.js:** `v22.x LTS` (tested on `v22.23.2`; minimum `Node.js 20.18+`)
- **npm:** `v10+`
- **OS:** Ubuntu 22.04 / 24.04 LTS, Debian 12+, or any Linux VPS / Docker / Railway / Render / Coolify host with persistent disk storage
- **RAM:** Minimum `1 GB` (`2 GB` recommended for Next.js production builds + persistent Baileys socket)
- **Open Port:** `3000` (or reverse-proxy via Nginx / Caddy with WebSocket upgrade enabled for `/socket.io`)

---

## 2. Environment Variables

Copy `.env.example` to `.env` (or configure environment variables in your hosting panel / PM2 ecosystem file):

```bash
cp .env.example .env
```

### Required Variables
| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | **Yes** | Google Gemini API key (used server-side by `server/gemini-engine.ts` with `gemini-2.5-flash` and live store tools). |
| `PORT` | Optional (default `3000`) | HTTP + Socket.IO port that `server.ts` listens on. |
| `APP_URL` | Recommended | Public HTTPS URL of your deployed server (e.g. `https://crm.bihargraminbazaar.com`). |

### Recommended Production Security Variables
| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Optional (auto-generated if omitted) | Strong 64-character random string for signing Admin Dashboard JWT sessions. If omitted, derived automatically from `./data/.vault.key`. |
| `CONFIG_ENCRYPTION_KEY` | Optional (auto-generated if omitted) | 32+ character key for AES-256-GCM encryption of optional secrets in `./data/secrets.enc`. If omitted, generated automatically at `./data/.vault.key`. |
| `BGB_STORE_API_BASE` | Optional | Defaults to `https://bihargraminbazaar.com/api` (`products.php`, `orders.php`, `delivery.php`). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Optional | Pre-seed initial admin login. If omitted, you create your admin account securely on first launch in the browser UI. |

### Optional Meta Cloud API v21.0 Fallback Variables (100% Optional — Not Needed for QR Code Mode)
You do **not** need any `META_*` keys to use the primary Baileys QR Code / 8-Digit Linking Code engine. If you also want Meta Cloud API coexistence/fallback later, set these in `.env` or inside **QR & Channels → Optional Mode B**:
- `META_APP_ID` (default `1521339533384901`)
- `META_CONFIG_ID` (default `1132291603061911`)
- `META_VERIFY_TOKEN` (default `bgb_whatsapp_verify_token_2026`)
- `META_APP_SECRET`
- `META_ACCESS_TOKEN`
- `META_PHONE_NUMBER_ID`
- `META_WABA_ID`
- `META_API_VERSION` (default `v21.0`)

---

## 3. Exact Build & Start Commands

> **Important:** This app uses a custom persistent Node.js server (`server.ts`) that runs **Next.js + Express 5 + Socket.IO + 24×7 `@whiskeysockets/baileys`** in a single process. Do **not** deploy to serverless platforms (like Vercel Serverless Functions) because WhatsApp WebSocket sessions require a persistent Node.js process and disk volume.

### Standard Production Build & Start
```bash
npm install
npm run build
npm run start
```
*(Under the hood, `npm run build` runs `next build` and `npm run start` runs `NODE_ENV=production tsx server.ts` on port `3000`.)*

### 24/7 Production Hosting with PM2 (Recommended for VPS)
```bash
# Install PM2 globally once
npm install -g pm2

# Install dependencies & build Next.js production bundle
npm install
npm run build

# Load .env and start 24/7 process with PM2
set -a && source .env && set +a
pm2 start "npm run start" --name bgb-whatsapp-crm

# Auto-start on server reboot
pm2 save
pm2 startup
```

### Checking Logs & Restarting
```bash
pm2 logs bgb-whatsapp-crm --lines 100
pm2 restart bgb-whatsapp-crm
```

### Nginx Reverse Proxy Snippet (with Socket.IO WebSocket Support)
```nginx
server {
    listen 80;
    server_name crm.bihargraminbazaar.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

---

## 4. Persistent Folders to Keep Across Updates & Redeploys

**CRITICAL:** Always preserve the entire `./data/` directory on a persistent disk/volume across server restarts, Docker rebuilds, and code updates:

- `./data/baileys_auth/` — Saved WhatsApp Linked Devices session credentials. Keeping this folder ensures your WhatsApp stays connected 24×7 and auto-reconnects after restarts without re-scanning the QR code.
- `./data/crm_store.json` — Admin account hash, chat sessions (`rawJid` / `altJid`), conversation history, AI settings, keyword quick-replies, synced catalog/orders cache, and logs.
- `./data/secrets.enc` & `./data/.vault.key` — AES-256-GCM encrypted optional secrets and auto-generated vault key.

> Never commit `./data/` or `.env` to Git or share them publicly.

---

## 5. First-Time Setup After Starting

1. Open `http://YOUR_SERVER_IP:3000` (or your HTTPS domain).
2. Create your Admin email & password on the first-run setup screen.
3. Go to **QR & Channels**:
   - **Scan QR Code:** Click **Generate / Refresh QR** and scan from *WhatsApp → Linked Devices → Link a Device*.
   - **8-Digit Linking Code (Single-Phone):** Enter your number with country code (e.g. `919472258022`), click **Get 8-Digit Linking Code**, and enter it under *Linked Devices → Link a Device → Link with phone number instead*.
4. Go to **Security & Settings** and click **Test Gemini AI** to verify live Gemini replies & Bihar Gramin Bazaar tool calling.
5. **Phone Remote Control Commands:** From your own phone WhatsApp inside any customer chat, send `#manual` or `#stop` to pause AI indefinitely, or `#ai` / `#start` to resume immediately. Regular replies from your phone auto-pause AI for 30 minutes (configurable in **AI Automation**).

---

## 6. Free 24/7 Hosting on Render Free Tier + MilesWeb Remote Vault Bridge

Render's Free Tier (512 MB RAM, ephemeral disk) wipes local files on every restart/redeploy. This project includes an automatic remote backup/restore bridge so your **WhatsApp Linked Devices session (`./data/baileys_auth/`)**, **Admin login**, **CRM chats**, and **AI settings** survive every Render restart seamlessly!

### Step 1: Upload the PHP Vault Bridge to MilesWeb (`bihargraminbazaar.com`)
1. Open `milesweb_backup_bridge/crm_vault.php` from this repository.
2. Replace `REPLACE_WITH_A_STRONG_64_CHAR_SECRET_TOKEN_BEFORE_UPLOAD` with a strong random secret token (at least 48 characters).
3. Upload it via MilesWeb cPanel File Manager to:
   ```
   public_html/api/crm_vault.php
   ```
   Your backup endpoint URL is now: `https://bihargraminbazaar.com/api/crm_vault.php`.
   *(It automatically creates `public_html/api/.ht_protected_vault/.htaccess` with `Deny from all` + `Require all denied` so no browser can ever access your backup snapshot.)*

### Step 2: Deploy to Render Free Tier
1. Push this repo to a **Private** GitHub repository (`.gitignore` already excludes `data/`, `.env`, `node_modules/`, `.next/`).
2. In Render Dashboard → **New + → Blueprint** (uses `render.yaml`) or **Web Service**:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start` *(runs `NODE_ENV=production NODE_OPTIONS=--max-old-space-size=380 tsx server.ts`)*
   - **Health Check Path:** `/api/health`
3. Set these **Environment Variables** in Render:
   - `GEMINI_API_KEY` = your Google Gemini API key
   - `BACKUP_SYNC_URL` = `https://bihargraminbazaar.com/api/crm_vault.php`
   - `BACKUP_SYNC_TOKEN` = exact same secret token from Step 1
   - `JWT_SECRET` = strong 64-char random string
   - `CONFIG_ENCRYPTION_KEY` = strong 64-char random string
   - `APP_URL` = your Render HTTPS URL (e.g. `https://bgb-whatsapp-crm.onrender.com`)

### Step 3: Keep Render Awake 24/7 with UptimeRobot (Free)
1. Create a free monitor on **UptimeRobot** (type: **HTTP(s)**).
2. Set URL to: `https://YOUR-RENDER-APP.onrender.com/api/health`
3. Set Monitoring Interval to **5 minutes**.
4. `/api/health` responds instantly with HTTP 200 `{ ok: true, baileysStatus, uptime, timestamp }`, preventing Render Free Tier from spinning down due to 15-minute inactivity.

