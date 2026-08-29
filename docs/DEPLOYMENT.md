# Production deployment

Target: `https://telugunews.influencioweb.com`

The production stack is defined in `docker-compose.prod.yml`. Caddy obtains and
renews TLS certificates automatically. Only ports 80 and 443 are published;
MySQL, Redis, Meilisearch, the API, and the static web server stay private.

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

## 6. Seed reference data and create the first administrator

Reference data is safe for production; demo accounts are forbidden:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -m app.db.seed
```

Do **not** run `--demo` in production. Create the first administrator through an
approved bootstrap/admin process before opening the CMS to staff.

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
