# Production deployment

Target: `https://telugunews.influencioweb.com`

The production stack is defined in `docker-compose.prod.yml`. Caddy obtains and
renews TLS certificates automatically. Only ports 80 and 443 are published;
MySQL, Redis, Meilisearch, the API, and the static web server stay private.

If the server already runs a shared host Nginx, use
`infra/nginx/telugunews.influencioweb.com.conf`. The web and API containers are
available only on `127.0.0.1:8094` and `127.0.0.1:8004`. Caddy is opt-in through
the `caddy` Compose profile, so it does not contend with an existing proxy.

## 1. Push the repository

From the project directory:

```bash
git init
git branch -M main
git remote add origin https://github.com/Influencioads/newsweb.git
git add -- .gitignore .env.example .env.production.example README.md backend docs frontend infra docker-compose.yml docker-compose.prod.yml
git commit -m "Prepare Telugu News platform for production Docker deployment"
git push -u origin main
```

Authenticate with GitHub when prompted. Never add `.env` or `.env.production`.

## 2. Configure DNS

At the DNS provider for `influencioweb.com`, create:

- Type: `A`
- Name/host: `telugunews`
- Value: the public IPv4 address of the deployment server
- TTL: 300 (or automatic)

If the server has IPv6, add an `AAAA` record too. Wait until this command returns
the server IP before starting Caddy:

```bash
dig +short telugunews.influencioweb.com
```

## 3. Prepare an Ubuntu server

Use Ubuntu 24.04 or 22.04 with at least 4 GB RAM, 2 vCPU, and 40 GB disk.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable
```

## 4. Clone and create production secrets

```bash
sudo mkdir -p /opt/telugu-news
sudo chown "$USER":"$USER" /opt/telugu-news
git clone https://github.com/Influencioads/newsweb.git /opt/telugu-news
cd /opt/telugu-news
cp .env.production.example .env.production
chmod 600 .env.production
```

Generate secrets on the server:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 24
openssl rand -hex 24
openssl rand -base64 32
```

Put different generated values into `JWT_SECRET`, `JWT_REFRESH_SECRET`,
`MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `MEILISEARCH_KEY`, and `ENCRYPTION_KEY`.
Also set `ACME_EMAIL` to a monitored email address. Do not reuse development
credentials.

## 5. Validate and launch

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

The API container applies Alembic migrations before starting. Watch the first
startup and TLS issuance:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api caddy
```

Verify:

```bash
curl -fsS https://telugunews.influencioweb.com/health/live
curl -I https://telugunews.influencioweb.com/
```

## 5a. The AI newsroom features

Four things here fail *quietly* if you skip them. Each is listed with how you
would otherwise find out.

### The `worker-ingest` container must be running

Crawl tasks are routed to their own Celery queue (`ingest`) so a slow publisher
can never delay e-paper generation or audio. The existing `worker` has no `-Q`
and therefore does not consume that queue.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps worker-ingest
```

Without it, crawl tasks accumulate in Redis forever and **nothing reports an
error**. The detection mechanism is `GET /cms/crawl/status`, whose `stale` flag
goes true when no source has been fetched successfully for two hours; the
Coverage tab on the Content Sources screen shows it as a banner.

**Keep this at one replica.** The fetcher's robots.txt cache and its two-second
per-host throttle are per *process*, so a second replica silently doubles the
request rate presented to every publisher.

### Pillow needs libraqm, or Telugu share cards and e-paper PDFs are unreadable

Pillow only performs complex text layout — the conjunct formation and mark
positioning Telugu requires — when it can load Raqm. The PyPI wheel bundles
Raqm and HarfBuzz and loads FriBiDi at runtime, so `infra/docker/api.Dockerfile`
installs `libfribidi0 libharfbuzz0b libraqm0`; no Pillow rebuild is needed.
Check after every image build:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml   exec api python -c "from PIL import features; print(features.check('raqm'))"
```

`False` means two features switch themselves off rather than ship garbage:
share cards (`share_card_service.available()` declines and readers share text
and a link) and the e-paper PDF (`epaper_service.generate_pdf` marks the asset
`FAILED` with `Telugu shaping unavailable: install libfribidi0`, and the CMS
shows that error on the edition). Fix the image, then press "Render PDF" on
the edition again.

Neither failure touches public reading. The e-paper is drawn in the browser
from the edition JSON, not from the PDF, so readers see the paper whatever the
renderer is doing — and they only ever see it: there is no public PDF route,
and the printable sheets at `/admin/epaper/{date}/print` sit behind the CMS
sign-in. That print page is also the fallback way for staff to produce a file
when Raqm is unavailable, since the browser does the Telugu shaping itself.

The role -> permission matrix lives in the database, so after a deploy that
changes `ROLE_PERMISSIONS` (for example the desk editor grant for
`epaper.upload`) re-run the seed from section 6; it adds and revokes grants to
match the code.

The Telugu and Latin fonts themselves are vendored at
`backend/app/assets/fonts/` and need no host packages. Both are needed: Noto
Sans Telugu contains Telugu and digits but **no Latin letters**, so a masthead
or a domain drawn with it alone renders as boxes.

### Identity documents need their own private bucket

`KYC_STORAGE_BUCKET` and friends in `.env.production`. This must be a
**different bucket from the media one**, with no public-read policy and no CDN
in front of it. Left blank, documents go to `var/storage-private/` on the API
container — deliberately a sibling of the served media directory, never a child
of it.

Verify after the first contributor applies that the object is not reachable:

```bash
curl -I https://telugunews.influencioweb.com/media/kyc/1/pan/…   # expect 404
```

### nginx: `$is_link_crawler` belongs in the cache key

`infra/nginx/news-platform.conf` routes WhatsApp, Facebook and similar
link-preview crawlers to the API's Open Graph stubs. The `proxy_cache_key`
includes `$is_link_crawler` for a reason: without it, the first crawler's stub
HTML is served to every human reader for the whole cache TTL.

```bash
curl -sA "WhatsApp/2.23" https://telugunews.influencioweb.com/politics/some-story-ab12cd | grep og:image
curl -sA "Mozilla/5.0"   https://telugunews.influencioweb.com/politics/some-story-ab12cd | grep '<div id="root">'
```

The first must show a card URL, the second the SPA shell. If both show the
same thing, the cache key is wrong.

### Everything ships off

`crawl.enabled`, `crawl.rewrite_enabled`, `bulletin.enabled`, `ai.enabled` and
`voice.enabled` all default to false, so deploying this code cannot start
spending at a provider. Turn them on from **Settings** in the CMS, one at a
time, watching `/cms/crawl/status` and the voice usage meter.

For the crawl, switch on government, press-release and job-notification sources
first: those are published *for* redistribution, which the others are not.

### Push notifications setup

The server sends pushes through Expo's push service; the `beat` and `worker`
containers deliver them (`notify.dispatch`, every 30 s). Nothing is configured
on the server. What Android needs is done once, outside the code:

1. In the [Firebase console](https://console.firebase.google.com), create a
   project and add an Android app with the package
   `com.influencioweb.toptelugunews`. Download `google-services.json` into
   `mobile/` (next to `app.json`). The repo is public, so the file is
   gitignored and EAS never sees it on its own; hand it over once as a file
   variable:
   `cd mobile && npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret --environment production --environment preview`.
   `mobile/app.config.js` uses that variable on EAS and the local file for
   local builds; with neither, builds still work, just without push.
2. In Firebase → Project settings → Service accounts, generate a private key
   (the FCM V1 service-account JSON). Give it to Expo, not to our server, and
   do not keep it in the repo (`*-firebase-adminsdk-*.json` is gitignored):
   `cd mobile && npx eas-cli credentials` → Android → `apk` profile →
   Google Service Account → "Manage your Google Service Account Key for Push
   Notifications (FCM V1)" → upload the JSON.
3. Rebuild and reinstall the APK: `npx eas-cli build -p android --profile apk`.
   Expo Go cannot receive remote pushes on Android, so test on the built APK.
4. Open the app once on a phone and allow notifications. **Notifications** in
   the CMS then shows it under "Registered phones"; send a test to *Everyone*
   and watch Phones / Delivered / Failed fill in within a minute.

Optional: if "Enhanced push security" is switched on for the Expo project,
create an access token at expo.dev and paste it into **Settings → Push
notifications**. **Settings → Push notifications → Send push notifications**
is the kill switch: off, alerts still reach the in-app inbox but no phone.
iOS needs an APNs key through `eas credentials` and an iOS build profile, which
this project does not have yet.

## 6. Seed reference data and create the first administrator

Reference data is safe for production; demo accounts are forbidden:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -m app.db.seed
```

Do **not** run `--demo` in production. Create the first administrator through an
interactive bootstrap command before opening the CMS to staff:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -it api \
  python -m scripts.create_admin --email admin@example.com
```

The password prompt is hidden and the command refuses to overwrite an existing
account. Use a unique password of at least 14 characters.

## 7. Deploy later updates

```bash
cd /opt/telugu-news
git pull --ff-only origin main
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --remove-orphans
docker image prune -f
```

## 8. Backup

```bash
mkdir -p backups
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T mysql \
  sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  | gzip > "backups/telugu-news-$(date +%F-%H%M).sql.gz"
```

Also back up the `storage_data` Docker volume and `.env.production` to encrypted,
off-server storage. Test restores regularly.

## 9. Rollback

Check out the last known-good Git commit, rebuild, and restart. Database
migrations are forward-only, so restore a tested database backup if a release
requires data rollback.

```bash
git log --oneline -10
git checkout <known-good-commit>
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```
