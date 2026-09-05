# Telugu News Platform

A Telugu-language digital news product: public reader website, newsroom CMS,
e-paper, video, and an AI gateway — built to **Build Instructions v1.0** and the
**Telugu News Platform Mockups**.

> **The rule that overrides everything.**
> Nothing reaches a reader without a human editor pressing Approve. There is no
> auto-publish flag anywhere in this codebase — not for AI drafts, not for
> scheduled posts, not for API imports. A bypass added "for testing" gets removed
> before merge.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 · Vite 6 · TypeScript (strict) · React Router · TanStack Query · Tailwind · Zustand · Tiptap |
| Backend | Python 3.12 · FastAPI · Pydantic v2 · SQLAlchemy 2 · Alembic |
| Database | MySQL 8 (utf8mb4) |
| Cache / queue | Redis 7 · Celery |
| Search | Meilisearch |
| Storage | Pluggable: local · Zata.ai (S3) · Bunny |
| AI | Internal gateway with Gemini / OpenAI / Anthropic adapters |

The Build Instructions specify NestJS + PostgreSQL + Next.js; the build brief
mandates FastAPI + MySQL + React/Vite. Every conflict, its resolution, and the
engineering consequence is recorded in **[docs/SOURCE_CONFLICTS.md](docs/SOURCE_CONFLICTS.md)**.
Nothing was silently dropped.

## Quick start

Requirements: Docker, Node 20+, and Python 3.12 (or `uv`, which can provision it).

```bash
cp .env.example .env
```

Generate real dev secrets in `.env` (`JWT_SECRET`, `JWT_REFRESH_SECRET`,
`MYSQL_PASSWORD`, `MEILISEARCH_KEY`, `ENCRYPTION_KEY`) before starting.

**1. Infrastructure**

```bash
docker compose up -d mysql redis meilisearch
```

**2. Backend**

```bash
cd backend && uv venv --python 3.12 .venv && uv pip install --python .venv/Scripts/python.exe -r requirements.txt
```

```bash
cd backend && .venv/Scripts/python.exe -m alembic upgrade head
```

```bash
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

**3. Frontend**

```bash
cd frontend && npm install && npm run dev
```

**4. Mobile app (React Native / Expo)** — see [mobile/README.md](mobile/README.md)

```bash
cd mobile && npm install && npm start
```

**No-Docker alternative for reader-facing work**: SQLite stands in for MySQL and
Redis features degrade to dev fallbacks —

```bash
cd backend && .venv/Scripts/python.exe scripts/init_dev_db.py --fresh
```

```bash
cd backend && .venv/Scripts/python.exe scripts/run_dev.py
```

| Surface | URL |
|---|---|
| Reader site / CMS | http://localhost:5174 |
| System status | http://localhost:5174/qa/status |
| Telugu render test | http://localhost:5174/qa/telugu-render |
| API docs (OpenAPI) | http://localhost:8000/docs |
| Health probe | http://localhost:8000/health |

Ports are offset from the usual defaults (MySQL **3307**, Redis **6381**,
Meilisearch **7701**, Vite **5174**) so this stack never collides with other
projects on the same machine.

## Tests

```bash
cd backend && .venv/Scripts/python.exe -m pytest
```

```bash
cd frontend && npm run typecheck && npm run build
```

## Production deployment

The Docker production stack, automatic HTTPS configuration, server setup,
GitHub push steps, backups, updates, and rollback procedure are documented in
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Telugu — read §4 of the Build Instructions twice

Telugu is a first-class requirement, not a translation layer. The rules that
break the product when violated:

- **Line-height >= 1.65x font-size**, always. Telugu stacks marks above *and*
  below the baseline.
- **Never** a fixed-height container or `overflow: hidden` on a Telugu headline.
  Use `.te-clamp-2/3/4`, which clamps by line count and keeps height elastic.
- Fonts are **self-hosted WOFF2** in `frontend/public/fonts`. No Google Fonts CDN.
- The Telugu subsets **must** keep `U+200C-200D` (ZWNJ/ZWJ) or conjuncts break.
- All text is NFC-normalised on write, and the database is `utf8mb4` throughout.

`/qa/telugu-render` is the §15.4 QA checklist item and ships with the app. Run it
on Samsung One UI, Xiaomi HyperOS/MIUI, Realme/Oppo, a 3-year-old budget Android,
iPhone (2 versions), Chrome desktop and Safari desktop before every release.
If any glyph clips, boxes, or reorders, **the build is not shippable**.

## Layout

```
backend/
  app/
    api/v1/        routers          core/          config, errors, logging, security
    models/        SQLAlchemy       schemas/       Pydantic request/response
    services/      business logic   repositories/  data access
    workers/       Celery tasks     integrations/  storage, ai, video, search, sms
    telugu/        normalisation, transliteration, legacy-font conversion
  alembic/         forward-only migrations
  tests/
frontend/
  src/  api/ components/ features/ hooks/ layouts/ pages/ routes/ stores/ types/
  public/fonts/    self-hosted WOFF2
infra/
  docker/  nginx/
docs/
  IMPLEMENTATION_MAP.md   every mockup screen -> component -> API -> table
  SOURCE_CONFLICTS.md     conflicts between the two source documents + resolutions
```

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Project setup, Docker, MySQL, Redis, FastAPI, React, Alembic | **Done** |
| 2 | Auth, RBAC, district scoping, sessions, audit | **Done** |
| 3 | Categories, tags, article CRUD, Tiptap | In progress |
| 4 | Workflow, submit, review, approval, publish | Pending |
| 5 | Public website (search + SEO pending) | Partial |
| 6 | Media — storage providers, derivatives, blurhash | **Done** |
| 7 | AI gateway, AI article tools, AI images | Pending |
| 8 | E-paper Mode A | Pending |
| 9 | Video | Pending |
| 10 | Notifications, analytics, CMS extras | Pending |
| 11 | Security, performance, testing, deployment | Pending |
