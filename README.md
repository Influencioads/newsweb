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

## Tests and gates

```bash
cd backend && .venv/Scripts/python.exe -m pytest
```

The web app has five gates. All five must pass before a UI change merges:

```bash
cd frontend && npm run lint && npm run typecheck && npm test && npm run build && npm run audit:ui:strict
```

`audit:ui` is the design-system regression net (`frontend/scripts/audit-ui.mjs`).
It fails the build on a hard-rule breach rather than leaving it to review:
`text-[Npx]` instead of the named type scale, hex literals instead of tokens,
`rounded`/`rounded-[Npx]` instead of the radius ladder, interactive elements
under 44px, `line-clamp`/`truncate` on Telugu (use `.te-clamp-N`), `bg-white`
instead of the theme-aware `bg-surface`, `window.prompt/confirm/alert` instead
of the dialog primitives, and any type token whose line-height falls below the
Telugu floor. `--strict` turns findings into a non-zero exit.

The mobile app has its own equivalents:

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json && npm run lint && npm run audit:ui
```

`mobile/scripts/audit-ui.mjs` blocks hex/rgba outside `src/lib/theme.ts`, the
deprecated `color.white` alias, raw `Pressable` outside `src/ui/PressableScale`,
emoji or Unicode glyphs used as icons, Telugu styles under a 1.65 line-height,
`textTransform: uppercase` on a Telugu face, and ad-hoc Reanimated configs
outside `src/lib/motion.ts`.

## Design system

Both apps render from one token contract, so a colour, size, radius, shadow or
duration is picked from the system rather than invented:

| | Web | App |
|---|---|---|
| Tokens | `frontend/tailwind.config.ts` + `src/assets/index.css` | `mobile/src/lib/theme.ts` |
| Motion | `frontend/src/utils/motion.ts` (+ CSS keyframes) | `mobile/src/lib/motion.ts` (`useMotion`) |
| Primitives | `frontend/src/components/ui/*` | `mobile/src/ui/*` |

**Identity.** Peacock teal (`#0F5F57`) as the brand, champagne gold as the
accent, ivory paper and charcoal ink, with urgency carried by a burnished
amber — there is no red anywhere in the system, deliberately unlike the rest of
the Telugu news market. Headlines and the wordmark are set in **Noto Serif
Telugu**, body copy in **Noto Sans Telugu** (the most legible face at 19px on
a mid-range Android), Latin display in **Fraunces** and Latin chrome in
**Manrope**. All four are self-hosted variable WOFF2 files in
`frontend/public/fonts` (the Telugu subsets keep U+200C–200D) and the same
families load through `@expo-google-fonts/*` in the app.

Reduced motion is honoured on both: the web kill switch lives in `index.css`
and JS-driven motion checks `prefersReducedMotion()`; on the app every
animation, transition and haptic goes through `useMotion()`, which reads the OS
setting. Dark mode is three-state (`system` / `light` / `dark`) and is applied
before first paint by an inline script in `frontend/index.html`, so a dark
reader never sees a light flash.

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
