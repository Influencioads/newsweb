# Implementation Map

Built from **Build Instructions v1.0** (functional contract) + **Telugu News Platform Mockups**
(visual contract, 14 annotated screens). Every mockup screen is traced
`SCREEN -> COMPONENT -> API -> SERVICE -> MODEL -> TABLE` before any code is written.

Screen ids (`1a`..`1n`) are the mockup's own ids. `§x` refers to Build Instructions sections.

---

## A. Design tokens (extracted from mockup `1a` — these are the contract)

| Token | Value | Use |
|---|---|---|
| `--brand` | `#A61C24` | masthead, primary buttons, active nav, links |
| `--breaking` | `#C6111F` | breaking ticker/chips, overdue age chip, destructive |
| `--ink` | `#1A1714` | body text, CMS topbar, dark surfaces |
| `--muted` | `#6B635A` | secondary text |
| `--muted-2` | `#8A7F70` | labels, meta, uppercase eyebrows |
| `--paper` | `#FAF7F2` | card/page surface |
| `--canvas` | `#EFEBE3` | app background |
| `--cms-canvas` | `#F4F2ED` | CMS working background |
| `--rule` | `#E5DFD6` | borders, dividers |
| `--ai` | `#6D4FC4` | AI badges, AI drafts tab, auto-detected hotspots |
| `--exclusive` | `#B98A2E` | exclusive star, correction / editor note |
| `--success` | `#2E7D4F` | linked hotspot, published state, toggles on |
| `--info` | `#1E66C8` | IN_REVIEW / SCHEDULED state, "see all" links |
| `--placeholder` | `#E9E2D6` | reserved-height media boxes |

Type: headline `Anek Telugu 700` 30-34px web / lh 1.5 · body `Noto Sans Telugu 400` 19px web,
17sp app / **lh 1.7** · Latin + numerals `Inter`. Hit targets >= 44px.
Font switcher `A- / A / A+ / A++` persisted in localStorage — a **required feature** (§4.1), not optional.

## B. Screens -> routes -> components -> APIs

### Public web (React + Vite + React Router)

| # | Screen | Route | Key components | API | Tables |
|---|---|---|---|---|---|
| `1b` | Home, district edition | `/` | `DateWeatherBar` `EditionSelector` `FontSizeSwitcher` `Masthead` `CategoryNav` `BreakingTicker` `LeadStory` `SecondaryList` `BriefsList` `EpaperPromoCard` `AdSlot` `VideoStrip` `PolicyFooter` | `GET /public/home?edition=` · `GET /public/breaking` (poll 20-30s) | articles, categories, districts, media, epaper_editions, videos |
| `1c` | Article | `/:categorySlug/:slugShortId` | `ArticleHeader` `Byline` `ReaderToolbar` (A-/A/A+/A++, TTS, WhatsApp, bookmark) `HeroMedia` + credit `ArticleRenderer` `CorrectionNote` `AiDisclosure` `TagPills` `RelatedGrid` | `GET /public/articles/{short_id}` | articles, article_versions, media, tags, redirects |
| `1d` | Search | `/search?q=` | `SearchBox` `ResultTypeTabs` `DistrictFilter` `DateFilter` `HighlightedResult` | `GET /public/search?q=` -> Meilisearch | meilisearch index + articles |
| `1e` | Video hub | `/videos` | `VideoPlayer` (provider-agnostic) `ProviderBadge` `VideoGrid` `ShortsRail` `CategoryPills` | `GET /public/videos` · `GET /public/videos/{id}/playback` | videos, video_sources, media |
| `1f` | Mobile feed | `/` at <768px | same components, responsive; `OfflineBanner` `BottomTabBar` | same | same |
| `1g` | Mobile article | article route at <768px | `FontSizeSheet` (bottom sheet) | same | same |
| `1m` | E-paper reader | `/epaper/:edition/:date`, `.../page-:n` | `EditionSwitcher` `DatePicker` `PageStrip` `DeepZoomViewer` `HotspotLayer` `ShareAsImageCard` | `GET /public/epaper/{edition}/{date}` · `.../pages/{n}` | epaper_editions, epaper_pages, epaper_hotspots |
| — | Static / compliance (§12.5) | `/about` `/contact` `/editorial-policy` `/corrections` `/grievance` `/privacy` `/terms` `/ai-disclosure` | `PolicyPage` `GrievanceForm` | `GET /public/pages/{slug}` · `POST /public/grievance` | settings, grievance_tickets |

### Newsroom CMS

| # | Screen | Route | Key components | API | Tables |
|---|---|---|---|---|---|
| `1k` | Login (2 variants) | `/admin/login` | `OtpLoginForm` (phone + 6-box OTP, resend timer, attempt counter) `PasswordLoginForm` + `TotpStep` | `POST /auth/otp/request` `/auth/otp/verify` `/auth/login` `/auth/2fa/verify` | users, sessions, audit_log |
| `1h` | Editor approval queue | `/admin/review` | `QueueTabs` (all · **AI drafts** violet · district filter) `QueueColumn` x3 `ArticleQueueCard` (state chip, **age chip red at >30m**, reporter, district) | `GET /cms/dashboard/queue` · `POST /cms/articles/{id}/approve\|reject\|request-changes` | articles, workflow_transitions, audit_log, article_versions |
| `1i` | AI article writer | `/admin/ai/writer` | `IntakeTabs` (notes / press note / wire / **voice** / WhatsApp) `VoiceRecorder` + waveform `TranscriptPanel` `HeadlineOptions` (5) `TiptapPreview` `SuggestedMeta` `UnverifiedPanel` `SimilarityMeter` `SensitiveTopicNotice` — **no publish button exists on this screen** | `POST /cms/ai/run` · `POST /cms/articles` (DRAFT) · `.../submit` | ai_jobs, ai_task_configs, ai_prompts, articles |
| `1j` | AI cost dashboard | `/admin/ai/usage` | `BudgetMeter` (80% amber / 100% red markers) `ProviderCard` x3 `TaskRoutingTable` + edit routing | `GET /cms/ai/usage` · `PATCH /cms/ai/task-configs/{id}` | ai_cost_ledger, ai_jobs, ai_providers, ai_models, ai_task_configs |
| `1l` | Push pipeline | `/admin/notifications` | `PushComposer` (**live 65-char counter**) `TopicChips` `QuietHoursNotice` `PushApprovalCard` (audience, article state, CDN pre-warm) `DevicePreview` `ReaderPrefsPanel` | `POST /cms/push` · `.../approve` · `.../send` | push_campaigns, articles, audit_log |
| `1n` | Hotspot editor | `/admin/epaper/:editionId/pages/:n` | `PageCanvas` `HotspotRect` (8 handles) `AutoDetectBox` (violet dashed) `HotspotInspector` (normalized x/y/w/h) `ArticleLinkSearch` `KeyboardLegend` (N / Enter / arrows / Tab / A / Del) `PageStatusStrip` `SendToPublishButton` | `GET/POST/PATCH/DELETE /cms/epaper/pages/{id}/hotspots` · `POST /cms/epaper/editions/{id}/submit` | epaper_pages, epaper_hotspots, articles |
| — | Dashboard | `/admin/dashboard` | `StatCard` grid — **every count from the database, never hardcoded** (brief §26) | `GET /cms/dashboard` | aggregate |
| — | Articles CRUD | `/admin/articles`, `/new`, `/:id/edit` | `ArticleTable` (server-side paging/sort/filter/bulk) `TiptapEditor` + Telugu toolbar `LegacyPasteDetector` `MediaPicker` `SeoPanel` `WorkflowBar` | `CRUD /cms/articles` | articles, article_versions, article_tags, article_media |
| — | Media / Users / Roles / Taxonomy / Audit / Settings | `/admin/media` `/users` `/roles` `/categories` `/districts` `/tags` `/glossary` `/audit` `/settings` | `MediaGrid` + presigned upload, `UserTable`, `RoleMatrix`, `AuditTable` (read-only) | respective `/cms/*` | media, users, roles, permissions, audit_log, settings |

## C. Roles (§6.1 — seed exactly)

`super_admin` 100 global · `admin` 90 global · `editor_in_chief` 80 global · `desk_editor` 60 desk/district ·
`sub_editor` 50 desk · `reporter` 40 district · `stringer` 30 mandal · `photo_video` 30 global ·
`dtp_operator` 30 edition · `ad_manager` 30 global · `seo_analyst` 30 global · `moderator` 20 global ·
`subscriber` 10 self.

Checked by **permission key + scope**, never by role name.
`ai.publish_without_review` **must not exist** — asserted by a test.

## D. Workflow state machine (§6.3)

`DRAFT -> SUBMITTED -> IN_REVIEW -> APPROVED -> {PUBLISHED | SCHEDULED -> PUBLISHED}`
plus `CHANGES_REQUESTED`, `REJECTED`, `UNPUBLISHED`, and `UPDATE_REVIEW` (edit of a published
article; **the live version stays live until re-approved**).

Hard rules, enforced in the service layer only:

1. `PUBLISHED` requires `article.publish` **and** `approved_by != author_id`.
   Self-approval is blocked even for `editor_in_chief` (§6.3; open item #11 default = no override).
2. `is_breaking` requires role level >= 80.
3. Every transition writes `workflow_transitions` + `audit_log`; every approval snapshots into `article_versions`.
4. Scheduled publish goes through the **same** `publish()` service call via Celery Beat — no cron SQL.
5. District scope must match unless the user's scope is global.

## E. Background jobs (Celery)

`ai.run` · `epaper.split_render` (PDF -> WebP + DZI tiles + thumb + page PDF) · `epaper.ocr` ·
`epaper.autodetect` · `video.transcode` (ffmpeg ladder) · `search.index` / `search.deindex` ·
`media.derivatives` (WebP/AVIF at 4 widths + blurhash + EXIF strip) · `push.send` (+ CDN pre-warm) ·
`publish.scheduled` (Beat) · `ai.cost_rollup` (Beat, daily).

Job states (brief §32): `queued / processing / completed / failed / cancelled`, with error capture and retry.

## F. External integrations

Storage (Zata S3 / Bunny / local behind one `StorageProvider` interface) · AI Gateway
(Gemini / OpenAI / Anthropic adapters) · Meilisearch · MSG91 OTP · FCM/APNs ·
Bunny Stream + YouTube oEmbed · Sentry.
**No feature file ever imports a vendor SDK directly.**

## G. Build order (brief §44)

P1 setup / docker / MySQL / Redis / FastAPI / React / Alembic · P2 auth + RBAC + sessions + audit ·
P3 taxonomy + article CRUD + Tiptap · P4 workflow + approval · P5 public site + search + SEO ·
P6 media · P7 AI gateway + tools + images · P8 e-paper Mode A · P9 video ·
P10 notifications + analytics · P11 security + performance + tests + deployment.
