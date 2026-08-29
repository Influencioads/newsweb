# Source Conflicts & Resolutions

Two source files plus the build brief were treated as authoritative. Where they disagree,
this file records the conflict, the resolution, and the engineering consequence.
Nothing was silently ignored.

## C-1 — Backend runtime (BLOCKING, resolved)

| Source | Says |
|---|---|
| Build Instructions §1, §3 | NestJS (TypeScript, strict), "Team standard, modular, good DI for the provider adapters we need" |
| Build brief §1 | "Python 3.12+ / FastAPI / Pydantic v2 / SQLAlchemy 2.x / Alembic" and §46 "I have explicitly selected FastAPI" |

**Resolution: FastAPI.** The build brief is the client instruction of record and closes the
question explicitly. The Build Instructions' *functional* contract (module boundaries, guards,
audit ordering, gateway interface) is preserved 1:1 — only the runtime changes.

Mapping applied:

| Doc concept (NestJS) | This build (FastAPI) |
|---|---|
| `src/modules/<name>` | `app/api/v1/<name>.py` + `app/services/<name>` |
| `@RequirePermission('article.publish', { scoped: true })` | `Depends(require_permission("article.publish", scoped=True))` |
| Nest DI providers | FastAPI dependency injection + provider registry |
| class-validator / zod DTOs | Pydantic v2 request/response schemas |
| TypeORM/Prisma | SQLAlchemy 2.x ORM, no raw string SQL |
| BullMQ | Celery (Redis broker), same queue/job-status semantics |

## C-2 — Database engine (BLOCKING, resolved)

| Source | Says |
|---|---|
| Build Instructions §1, §5 | PostgreSQL 16 — `jsonb`, `text[]`, GIN `jsonb_path_ops`, partial indexes, `pg_trgm` |
| Build brief §1, §30 | MySQL 8+, §46 "I have explicitly selected MySQL" |

**Resolution: MySQL 8.** Five Postgres-only constructs in §5 have no direct MySQL equivalent.
Each is re-engineered rather than dropped:

| §5 Postgres construct | MySQL 8 implementation | Requirement preserved |
|---|---|---|
| `body jsonb` | `JSON` column | Tiptap JSON stays source of truth |
| `search_aliases text[]` | normalized `article_search_aliases` child table | indexable, and brief §30 demands normalization |
| GIN `jsonb_path_ops` on body | body is never queried by path; `body_plain` `FULLTEXT` covers admin lookup | search is Meilisearch's job (§4.4) |
| partial index `WHERE status='published' AND deleted_at IS NULL` | composite `(status, deleted_at, published_at DESC)` | same query plan for the hot feed query |
| `pg_trgm` GIN on `title_te` | `FULLTEXT ... WITH PARSER ngram` | admin-side fallback lookup only, per §4.4 |

Consequence: none of these are reader-facing. §4.4 already rules that reader search is
Meilisearch, so losing `pg_trgm` costs nothing at the reader surface.

## C-3 — Web framework (resolved)

| Source | Says |
|---|---|
| Build Instructions §1, §10.1 | Next.js 15 App Router, ISR, `revalidateTag()` on publish |
| Build brief §1, §4 | React + Vite + React Router + TanStack Query |

**Resolution: React + Vite + React Router.** The brief is explicit.

§10.1's *requirement* is not "use Next.js" — it is **"a breaking-news spike must land on the CDN,
not on the database."** That requirement is honoured without Next.js:

- Public read endpoints are Redis-cached server-side with an explicit TTL.
- Publishing/unpublishing fires a targeted cache-invalidation (the `revalidateTag()` equivalent).
- Public responses carry `Cache-Control: s-maxage / stale-while-revalidate` so an edge CDN or
  nginx proxy cache absorbs the spike.
- `infra/nginx/` ships a proxy-cache config implementing exactly that.

**Cost stated honestly:** a Vite SPA does not server-render article HTML, so the §10.3 SEO
contract (NewsArticle JSON-LD, Google News sitemap, OG tags crawled without JS) cannot be met by
client-side rendering alone. Mitigation built in: the API serves fully-rendered SEO payloads and
`/news-sitemap.xml`, `/sitemap.xml`, `/rss`, and per-article OG/JSON-LD are generated
**server-side by FastAPI** and served through nginx for crawler user-agents. This keeps §10.3
satisfied within the mandated stack. Flagged for sign-off.

## C-4 — Mobile app (scope)

Build Instructions §11 specifies an Expo React Native app; the build brief does not list Expo in
the stack and §8 says only "future React Native app".

**Resolution:** mobile app is **not built in this deliverable**. Its two mockup screens (`1f`, `1g`)
are implemented as the **responsive mobile rendering of the public React web app** (brief §28
requires 360/390/412px anyway), and the article renderer is kept framework-agnostic
(Tiptap JSON -> renderer contract) so an RN app can consume it later without a rewrite.

## C-5 — Queue

`BullMQ` (§2, §6.3, §8.1) -> **Celery + Redis**. Job-state semantics from brief §32
(`queued / processing / completed / failed / cancelled`), retry, and error capture are preserved.
§6.3's "scheduled publish runs through the same publish path ... no direct DB status flips by cron
SQL" is preserved exactly: Celery Beat calls the same `publish()` service method the UI calls.

## Non-conflicts — where both sources agree and the rule is absolute

- **No auto-publish anywhere.** (§0 "the one rule that overrides everything", brief §10.)
  Enforced in the service layer, not the UI.
- **Self-approval blocked**, `approved_by != author`, even for editor_in_chief. (§6.3, brief §11.)
- **`ai.publish_without_review` must not exist.** (§6.1.) Asserted by a test.
- **AI output is always a DRAFT.** (§7.2, brief §19.)
- **Telugu is first-class**, line-height >= 1.65, no fixed-height containers. (§4.1, brief §14.)
