# The Smart GetFit Nutrition — website

Catalogue website for **The Smart GetFit Nutrition**, a sports-nutrition and supplement store in Gulshan-e-Maymar, Karachi (since 2015). Visitors browse products and ask about them on WhatsApp; the owner manages the site's photos in a small admin panel.

It is deliberately simple: one Node.js process, plain HTML/CSS/JavaScript, a SQLite file, and no build step.

**What it is not:** there is no cart, checkout, payments, customer accounts or stock system. The built-in products and prices live in a JSON file; the admin panel manages photos and can add further products.

---

## Contents

1. [Quick start](#1-quick-start)
2. [How it fits together](#2-how-it-fits-together)
3. [Configuration (`.env`)](#3-configuration-env)
4. [Editing products and prices](#4-editing-products-and-prices)
5. [Editing shop details](#5-editing-shop-details)
6. [The admin panel](#6-the-admin-panel)
7. [Built-in photos](#7-built-in-photos)
8. [Commands](#8-commands)
9. [Database and migrations](#9-database-and-migrations)
10. [Backups and restore](#10-backups-and-restore)
11. [Going live](#11-going-live)
12. [Updating](#12-updating)
13. [Troubleshooting](#13-troubleshooting)
14. [Security notes](#14-security-notes)

---

## 1. Quick start

You need **Node.js 22.9 or newer** (Node 24 works too) and Git.

```bash
git clone https://github.com/syedd1/smart-getfit.git
cd smart-getfit
npm install
npm run dev
```

Open <http://localhost:3000>. That's the whole site, running locally, using the data in `data/`.

To also use the admin panel locally:

```bash
cp .env.example .env
npm run hash-password      # choose a password; it is saved into .env
```

Then open `.env` and set `ADMIN_USERNAME` (any name) and `SESSION_SECRET` (generate one with the command shown in the file), restart `npm run dev`, and visit <http://localhost:3000/admin/>.

Run the tests any time:

```bash
npm test
```

---

## 2. How it fits together

```text
data/products.json ─┐
data/site.json ─────┼─ validated at startup ─▶ pages rendered once, kept in memory ─▶ visitors
uploads/ + SQLite ──┘                          (re-rendered whenever a photo changes)

admin panel ─▶ /api/admin (login, CSRF) ─▶ check & resize photo ─▶ uploads/ + SQLite
```

| Folder | What's in it |
|---|---|
| `data/` | **`products.json`** (catalogue, prices) and **`site.json`** (phone, address, hours, …). The source of truth — edit these. |
| `public/` | CSS, JavaScript, fonts and built-in photos served as-is. |
| `server/` | The Node.js server: config, routes, security, views (page templates), database. |
| `admin/` | The admin panel page. |
| `uploads/` | Photos uploaded through the admin panel (created automatically, not in Git). |
| `var/` | The SQLite database file (not in Git). |
| `scripts/` | Helper commands (password, backups, image copies, migrations). |
| `tests/` | Automated tests (`npm test`). |
| `.npmrc` | Makes `npm install` use the native packages' ready-made binaries (no C++ compiler needed) and skips dependencies' install scripts. Keep it. |

Pages are built from the data files **once at startup** and kept in memory, so the site is fast and a typo can never half-break a page: if `products.json` or `site.json` is invalid, **the server refuses to start** and prints exactly what is wrong.

---

## 3. Configuration (`.env`)

Settings come from environment variables, normally a `.env` file in the project folder (copy `.env.example`). Empty lines fall back to the default. **Never commit `.env`** — it is already in `.gitignore`.

| Variable | Default | What it does |
|---|---|---|
| `NODE_ENV` | `development` | `production` on the live server. Turns on HSTS, secure cookies, long-term caching, indexing, and strict startup checks. |
| `HOST` | `127.0.0.1` | Address to listen on. Keep `127.0.0.1` behind a reverse proxy. Use `0.0.0.0` to test from a phone on your Wi-Fi. |
| `PORT` | `3000` | Port to listen on. |
| `SITE_URL` | `http://localhost:3000` | The public address, no trailing slash (e.g. `https://example.pk`). Used for canonical links, the sitemap and social previews. **Must be `https://` in production.** |
| `TRUST_PROXY` | `false` | Where the visitor's real IP comes from (rate limits and the login lockout depend on it). `loopback` = proxy on the same server; `1` = one proxy hop (most hosting platforms). Production refuses `true`, and refuses `false` while `HOST` is `127.0.0.1`. |
| `DATABASE_PATH` | `var/smart-getfit.db` | SQLite file (photo records and admin sessions). |
| `UPLOAD_DIR` | `uploads` | Where processed photos are stored. |
| `UPLOAD_MAX_MB` | `8` | Largest photo the admin panel accepts (1–25). |
| `ADMIN_PATH` | `/admin` | URL of the admin panel. |
| `ADMIN_USERNAME` | — | The admin's username. |
| `ADMIN_PASSWORD_HASH` | — | Argon2id hash of the admin password. Set it with `npm run hash-password`, never by hand. |
| `SESSION_SECRET` | — | Random secret, 32+ characters. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | `debug`, `info`, `warn`, `error` or `silent`. |

In **development**, leaving the three admin settings empty simply turns the admin panel off. In **production**, the server refuses to start unless they are set and strong. Relative paths are relative to the project folder.

---

## 4. Editing products and prices

All products are in **`data/products.json`**. Edit it with any text editor, save, and restart the server. If something is wrong, the server won't start and tells you the exact line and problem, for example:

```text
Refusing to start: products.json is invalid:
  - products[2].category: unknown category "wey"
  - products[5].id: duplicate product id "redcon1-total-war"
  - products[7]: Unrecognized key: "pirce"
```

### A product

```json
{
  "id": "cellucor-c4-original",
  "brand": "Cellucor",
  "name": "C4 Original",
  "category": "pre-workout",
  "size": "30 servings",
  "flavour": "Icy Blue Razz",
  "description": "Cellucor C4 Original pre-workout powder, available in Karachi.",
  "image": "/assets/products/cellucor-c4-original.webp",
  "price": 12500,
  "available": true,
  "featured": true
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Lowercase words joined by hyphens. It is also the page address (`/products/cellucor-c4-original`) and how admin photos are linked to the product — **don't rename it once photos are attached**. Must be unique, and must not equal a category id. |
| `brand`, `name` | yes | Shown on cards and pages. |
| `category` | yes | The `id` of a category (see below). |
| `size` | yes | e.g. `5 lb`, `30 servings`, `90 tablets`. |
| `flavour` | no | Shown after the size. |
| `description` | yes | One or two sentences (max 300 characters). |
| `image` | yes | A built-in WebP photo under `public/assets/`. Shown until a photo is uploaded in the admin panel (see [§7](#7-built-in-photos)). |
| `price` | no | Whole rupees, no commas (`12500`). **Leave it out to show "Ask for Price".** With a price the card shows "Rs 12,500" and Google sees it as an offer. |
| `available` | no | `false` shows "Currently Unavailable" and a "Check Availability" button. Default `true`. |
| `featured` | no | `true` puts the product in the homepage "Featured Products" slider. Default `false`. |

The order of products in the file is the order on the site.

### Categories

```json
{ "id": "whey-protein", "name": "Whey Protein", "shortName": "Whey" }
```

`shortName` (optional) is used on the small mobile filter buttons. `image` (optional, a WebP under `/assets/`) gives a category tile a photo when it has no products yet (Beverages and Coffee use this).

### Common mistakes

- **Missing comma** between items, or an **extra comma** after the last item → "not valid JSON". A JSON checker such as <https://jsonlint.com> points to the line.
- **Misspelled field** (`"pirce"`) → refused, so it can't silently do nothing.
- **Image path that doesn't exist** → refused, so the site never shows a broken photo.

---

## 5. Editing shop details

**`data/site.json`** holds the shop's details: phone, WhatsApp number, address, map location, hours, Maps link, Instagram/Facebook, delivery areas, the scrolling banner text, the WhatsApp message templates and the reviews. They appear everywhere on the site and in the information Google reads. Restart after editing.

A few rules the server checks for you:

- `whatsapp.number`: digits only with the country code (`923372106695`, not `0337…`).
- `phone.international`: `+` and digits (`+923372106695`).
- Links (`maps.url`, `social.*`, `reviews.url`) must start with `https://`.
- `hours.schedule[].opens` / `closes`: 24-hour `HH:MM` (`17:00`, `00:00` for midnight).
- WhatsApp templates for products must contain `{product}`, which is replaced by the product name and size.

---

## 6. The admin panel

Open `https://your-site/admin/` (or whatever `ADMIN_PATH` is). It has two tabs: **Photos** and **Products**.

### Setting up or changing the password

```bash
npm run hash-password
```

Type the new password twice (at least 12 characters). The hash is written straight into `.env`; restart the server. **Changing the password or username logs out every existing session.**

On a server where you set environment variables some other way, use `npm run hash-password -- --print` and copy the line it prints — on **one line**, inside single quotes.

### What it can do

- **Upload** JPEG, PNG or WebP photos (drag and drop, or tap to choose — on a phone this opens the camera roll). Up to 10 at once, up to 8 MB each, 30 photos per hour.
- **Choose where they go:**
  - **A product** — the first photo replaces that product's built-in photo everywhere.
  - **Homepage hero** — the big photo at the top of the homepage (first one is used).
  - **Healthy Snacks banner** — the banner above the snacks on phones (first one is used).
  - **Gallery** — the "Inside the Store" gallery, in the order shown. Uploads are added after the store video and before the built-in photos (they don't replace them).
- **Description (alt text)** for each photo — read by screen readers and Google.
- **Reorder** (↑ Earlier / ↓ Later), **replace**, **move** to another place, **delete**.

Every photo is checked and converted automatically: only real JPEG/PNG/WebP files are accepted, it is rotated correctly, resized to 400/800/1600 px WebP copies, and stripped of location and camera data. Changes appear on the site immediately.

### Adding products

**Products → Add product**: brand, name, category (one of the existing ones, including Healthy Snacks), size, optional flavour, description, in stock and featured. There is no price field: products added here show "Ask for Price". The web address (`/products/…`) is filled in from the name; it can't be changed after saving, because photos are linked to it.

- **Choose the photo in the same form** and the product goes on the site as soon as you save. Without a photo it is saved but marked "Needs a photo" (use its **Add photo** button later). Choosing a photo when editing makes it the one shown on the site; the old one stays under Photos, where you can delete it.
- Added products get the same pages, category filters, WhatsApp buttons and sitemap entries as built-in ones, and are listed after them.
- **Edit** and **Delete** work for added products only. Deleting a product also deletes its photos.
- Added products are stored in the database (so a `git pull` deploy doesn't remove them, and `npm run backup` includes them). The products in `data/products.json` are shown as "Built-in" and are still changed by editing that file ([§5](#5-editing-shop-details)). New categories are also added there.
- If `products.json` later gets a product with the same web address, or loses an added product's category, the added product is hidden and the admin says why — the site keeps working.

### Sessions and lockout

- A login lasts 12 hours, or ends after 2 hours without activity. "Log out" ends it at once.
- **5 wrong attempts in 15 minutes lock that connection out for 15 minutes.** Restarting the server clears the lockout.

---

## 7. Built-in photos

Built-in photos are the ones shipped with the site in `public/assets/` (store photos, and each product's default photo). The admin panel is the easy way to change photos; use this only to change the defaults.

1. Save the photo as WebP in the right folder, e.g. `public/assets/products/my-new-product.webp` (about 1200 × 1200 px for products). To convert a JPEG:

   ```bash
   node -e "require('sharp')('photo.jpg').rotate().resize({width:1200}).webp({quality:80}).toFile('public/assets/products/my-new-product.webp')"
   ```

2. Point the product's `image` at it in `products.json`.
3. Make the smaller copies used on phones, then commit everything:

   ```bash
   npm run optimize-images
   ```

Photo addresses carry a version stamp (`?v=…`), so a replaced photo shows up immediately after a restart even though photos are cached for a year.

---

## 8. Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start for development; restarts when server code changes. |
| `npm start` | Start for production. |
| `npm test` | Run the automated tests. |
| `npm run hash-password` | Set the admin password (writes `.env`). |
| `npm run backup` | Back up the database, uploaded photos and data files (see [§10](#10-backups-and-restore)). |
| `npm run migrate` | Apply database migrations (also happens automatically at startup). |
| `npm run optimize-images` | Make 400/800 px copies of built-in photos. `-- --force` rebuilds all. |
| `npm audit` | Check dependencies for known security problems. |

All commands load `.env` automatically when it exists.

---

## 9. Database and migrations

SQLite stores only what has to change at runtime: **photo records**, **products added in the admin panel** and **admin sessions** (plus one setting). The built-in products in `data/products.json` are *not* in the database.

The schema is a list of numbered SQL files in `server/db/migrations/` (`001_initial.sql`, `002_settings.sql`, …). At startup the server applies any it hasn't applied yet, in order, each in a transaction — if one fails it is rolled back and the server refuses to start with the error. `npm run migrate` does the same without starting the server.

To change the schema, **add** a new file with the next number (e.g. `003_something.sql`). Never edit a migration that has already run anywhere.

---

## 10. Backups and restore

Everything that can't be rebuilt from Git is the **database**, **`uploads/`**, and (if they were edited on the server) **`data/*.json`**. One command backs them all up into a single dated file:

```bash
npm run backup
```

```text
Backup written: backups/smart-getfit-2026-10-06_182725.tar.gz (228K, 4 photo files)
```

- Safe while the site is running (it uses SQLite's backup function and checks the copy).
- Keeps 14 days by default. Change with `KEEP_DAYS=30 npm run backup`; choose the folder with `BACKUP_DIR=/path/to/backups`.
- **`.env` is not included** (it contains secrets): keep your own copy of it somewhere safe.
- **Don't copy `smart-getfit.db` by hand while the server is running** — recent changes may still be in the `-wal` file next to it, and the copy would miss them. Use `npm run backup`.

### Daily automatic backups (Linux/macOS server)

Run `crontab -e` and add (adjust the path):

```cron
30 3 * * * cd /home/USER/smart-getfit && mkdir -p backups && /usr/bin/env bash scripts/backup.sh >> backups/backup.log 2>&1
```

A backup on the same server doesn't help if the server itself is lost — **copy backups somewhere else** regularly (another computer, or cloud storage), for example with `scp` or `rsync`.

### Restore

1. **Stop the site.**
2. Unpack the backup into a temporary folder:

   ```bash
   mkdir restore && tar -xzf backups/smart-getfit-YYYY-MM-DD_HHMMSS.tar.gz -C restore
   ```

3. Put the database back (removing any leftover `-wal`/`-shm` files first), and the photos:

   ```bash
   rm -f var/smart-getfit.db var/smart-getfit.db-wal var/smart-getfit.db-shm
   cp restore/smart-getfit.db var/smart-getfit.db
   mkdir -p uploads && cp restore/uploads/*.webp uploads/
   ```

   (Use your `DATABASE_PATH` / `UPLOAD_DIR` if you changed them.) Only if the data files were lost or edited on the server: `cp restore/data/*.json data/`.

4. **Start the site** and check `https://your-site/healthz` shows `{"status":"ok"}` and the photos are back.

This exact procedure is tested: back up while running → delete database and photos → restore → all photos served again.

---

## 11. Going live

Hosting-specific steps (server setup, domain and HTTPS) will be added once the hosting plan is confirmed. Whatever the host, the live site needs:

- [ ] **Node.js 22.9+** and the ability to keep a Node process running and restart it if it stops (all three native packages — `better-sqlite3`, `sharp`, `argon2` — ship ready-made builds for Linux x64).
- [ ] **Storage that survives redeploys** for the database and `uploads/`. Point `DATABASE_PATH` and `UPLOAD_DIR` at a folder outside anything the host overwrites on each deployment.
- [ ] **HTTPS** in front of the app (a reverse proxy such as Caddy or Nginx, or the host's own).
- [ ] A production `.env` (or the host's environment settings):
  - `NODE_ENV=production`
  - `SITE_URL=https://your-domain` (no trailing slash)
  - `TRUST_PROXY=loopback` (proxy on the same machine) or `1` (host's proxy)
  - `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` (new values — don't reuse development ones)
  - optionally a less guessable `ADMIN_PATH`
- [ ] `npm ci --omit=dev` then `npm start` (pending migrations run automatically). If the host asks for an **entry file** instead of a start command, use **`server/main.js`** — it starts the site however the host launches it (not `server/index.js`, which only defines the app).
- [ ] Daily backups, copied off the server ([§10](#10-backups-and-restore)).
- [ ] After launch: check `/healthz`, `/robots.txt`, `/sitemap.xml`, log in to the admin panel, upload a test photo, and run Lighthouse (Chrome DevTools → Lighthouse → Mobile) on the live site.
- [ ] Submit `https://your-domain/sitemap.xml` in Google Search Console, and use the same name, address and phone as on your Google Business Profile.

The server refuses to start in production if any of the settings above are missing or unsafe, and explains why.

---

## 12. Updating

To deploy a new version of the code:

```bash
git pull
npm ci
npm test
```

then restart the server (migrations run automatically). If something goes wrong, `git checkout` the previous version and restart — and if a migration had already run, restore the database backup taken before the update.

**Dependencies.** Check now and then:

```bash
npm audit
npm outdated
```

`npm audit fix` applies safe fixes; run `npm test` afterwards. For major version upgrades, update one package at a time and test.

**Node.js upgrades.** After changing the Node major version (e.g. 22 → 24), run `npm rebuild` (or delete `node_modules` and run `npm ci`) so the native packages match.

---

## 13. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Refusing to start: products.json is invalid` (or `site.json`) | The message lists each problem and where. Fix those lines and restart. |
| `Refusing to start: Invalid configuration` | A setting in `.env` is missing or unsafe; the message says which and how to fix it. |
| `EADDRINUSE` / port 3000 in use | Another copy is already running (often an earlier `npm run dev`). Stop it, or set another `PORT`. Running two copies on one database can cause `SQLITE_IOERR` errors. |
| Admin login always fails | The hash may have been pasted across two lines. Run `npm run hash-password` again (it repairs the entry) and restart. |
| "Too many attempts" on login | 5 wrong attempts lock that connection for 15 minutes. Wait, or restart the server. |
| On the live site, *everyone* gets locked out after a few bad logins | `TRUST_PROXY` is wrong, so all visitors look like one IP. See [§3](#3-configuration-env). |
| Admin panel says it is "not configured" | `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` must all be set; restart after setting them. |
| Host log says "App did not call listen() within 3 seconds" and nothing else | The host is running the wrong entry file (it must be `server/main.js`), or an old version of the code is deployed. |
| Visiting the site shows "The site is starting" for a few seconds | Normal right after a start or restart; the port opens first and the site follows about a second later. If it never goes away, check the logs for `Refusing to start`. |
| Edited `products.json` / `site.json` but nothing changed | Restart the server — data files are read at startup. |
| Replaced a built-in photo but the old one shows | Restart the server (version stamps are computed at startup), then run `npm run optimize-images`. |
| Upload rejected | The message says why: not a real JPEG/PNG/WebP, over the size limit, over 40 megapixels, or the hourly limit. |
| Site not showing in Google during testing | Outside `NODE_ENV=production`, `robots.txt` blocks search engines on purpose. |
| `npm install` fails with `gyp ERR!` / "find VS" while building `better-sqlite3` | npm is trying to compile instead of using the bundled binaries. Make sure the project's `.npmrc` (with `ignore-scripts=true`) is present, use Node 22.9+ on 64-bit Windows/Linux/macOS, delete `node_modules` and run `npm ci` again. |
| Want to test on a phone | Set `HOST=0.0.0.0` in `.env`, restart, and open `http://YOUR-PC-IP:3000` on the phone (same Wi-Fi). Set it back afterwards. |

Logs are JSON lines on the console (or wherever your process manager stores them). Look for `"level":"error"` or `"level":"warn"`.

---

## 14. Security notes

- One admin account; password stored only as an Argon2id hash. Sessions are random tokens, stored hashed, in HttpOnly SameSite=Strict cookies.
- Every admin change needs both a same-site request and a CSRF token; logins are rate-limited with a lockout.
- Uploads are checked by content (not file name), size- and pixel-limited, re-encoded, stripped of metadata and stored under random names; they can only ever be served as images.
- Strict Content-Security-Policy with no inline scripts or styles; security headers on every response; no cross-site API access.
- Errors never show internals to visitors; details go to the server log. Secrets are never logged.
- Keep `.env` private (never commit it), use a long random `SESSION_SECRET`, and run `npm audit` regularly.

---

*Built with Node.js, Express, SQLite (better-sqlite3), Sharp, Zod and Argon2 — and plain HTML, CSS and JavaScript.*
