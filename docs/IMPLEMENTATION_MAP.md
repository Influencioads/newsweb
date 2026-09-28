# Implementation Map

Built from **Build Instructions v1.0** (functional contract) + **Telugu News Platform Mockups**
(visual contract, 14 annotated screens). Every mockup screen is traced
`SCREEN -> COMPONENT -> API -> SERVICE -> MODEL -> TABLE` before any code is written.

Screen ids (`1a`..`1n`) are the mockup's own ids. `§x` refers to Build Instructions sections.

---

## A. Design tokens (extracted from mockup `1a` — these are the contract)

| Token | Value | Use |
|---|---|---|
| `--brand` | `#0D47A1` logo blue | primary buttons, active nav, links |
| `--breaking` | `#BE0A14` deep red | breaking ticker/chips, overdue age chip, destructive |
| `--exclusive` | `#D0101A` logo red | exclusive star, the accent, correction / editor note |
| `--ink` | `#17191E` | body text, CMS sidebar, dark surfaces |
| `--muted` | `#666B75` | secondary text |
| `--muted-2` | `#8A8F99` | decoration only (chevrons, placeholders) |
| `--paper` | `#FFFFFF` | card/page surface |
| `--canvas` | `#FFFFFF` | app background |
| `--cms-canvas` | `#F6F7F9` | CMS working background |
| `--rule` | `#E5E7EB` | borders, dividers |
| `--ai` | `#6D4FC4` | AI badges, AI drafts tab, auto-detected hotspots |
| `--partial` | `#7A6A25` olive gold | pending / partially available |
| `--success` | `#3B7D45` | linked hotspot, published state, toggles on |
| `--info` | `#2F5E8C` | IN_REVIEW / SCHEDULED state, "see all" links |
| `--placeholder` | `#E9E5DC` | reserved-height media boxes |

The palette follows the logo (`frontend/public/logo.webp`): blue brand, red
accent and breaking, clean white ground. It replaced the UI upgrade's
teal-and-gold identity on 2026-09-24; migration `8e1c5a3f6d27` clears stored
brand colours that still pinned the old defaults. The dark palette lightens
the blue and red so foregrounds on those fills become ink rather than white.

Type: headline `Noto Serif Telugu 700/800` 30-34px web / lh 1.5 · body `Noto Sans Telugu 400` 19px web,
17sp app / **lh 1.7** · Latin display `Fraunces` · Latin chrome + numerals `Manrope`. Hit targets >= 44px.
Font switcher `A- / A / A+ / A++` persisted in localStorage — a **required feature** (§4.1), not optional.

> **Where the contract lives now.** The table above is the origin; the executable
> contract is `frontend/tailwind.config.ts` + `frontend/src/assets/index.css` on
> the web and `mobile/src/lib/theme.ts` on the app, and the two are kept in step
> token for token. Both carry the same additions made during the UI upgrade:
> a named type scale (`text-display` … `text-meta`, so `text-[Npx]` is banned),
> `surface` / `field` / `partial` / `overlay` / `on-brand` colour tokens, a
> radius ladder (12 / 16 / pill), an elevation ladder (`shadow-card`,
> `-raised`, `-sheet`) and motion tokens (120 / 200 / 320 ms with two easings).
> `scripts/audit-ui.mjs` in each app fails the build on a breach — including any
> type token whose line-height would drop Telugu under the §4.1 floor.
>
> Dark mode is three-state (`system` / `light` / `dark`), applied before first
> paint, and reduced motion disables every animation on both platforms.

## B. Screens -> routes -> components -> APIs

### Public web (React + Vite + React Router)

| # | Screen | Route | Key components | API | Tables |
|---|---|---|---|---|---|
| `1b` | Home, district edition | `/` | `Masthead` `CategoryNav` `BreakingTicker` `ReaderSettings` (edition · A-/A/A+/A++ · language · theme) `NavDrawer` `LeadCard` `SecondaryCard` `BriefCard` `KickerCard` `LatestCard` `CompactCard` `AdSlot` `VideoStrip` `PolicyFooter` | `GET /public/home?edition=` · `GET /public/breaking` (poll 20-30s) | articles, categories, districts, media, epaper_editions, videos |
| `1c` | Article | `/:categorySlug/:slugShortId` | `ReadingProgress` `ReaderToolbar` (A-/A/A+/A++ via `FontSizeSheet`, listen, save, share, comments — sticky bottom < md) `NewsImage` + `ImageCaption` `ArticleRenderer` `ArticleGallery` (Dialog lightbox) `AudioPlayer` `ShareSheet` `EngagementBar` `CommentsSection` `ReadNext` | `GET /public/articles/{short_id}` | articles, article_versions, media, tags, redirects |
| `1d` | Search | `/search?q=` | `SearchBox` `ResultTypeTabs` `DistrictFilter` `DateFilter` `HighlightedResult` | `GET /public/search?q=` -> Meilisearch | meilisearch index + articles |
| `1e` | Video hub | `/videos` | `Tabs` (sliding indicator) `ChipRail` `VideoCard` grid `VideoStrip` `ReactionBar` | `GET /public/videos` · `GET /public/videos/{id}/playback` | videos, video_sources, media |
| `1f` | Mobile feed | `/` at <768px | same components, responsive. The Expo app ships the native twin: `TabBar` (5 tabs, spring pill) + a sectioned `FlatList` with a collapsing `ScreenHeader` | same | same |
| `1g` | Mobile article | article route at <768px | `FontSizeSheet` (Sheet on web, `BottomSheet` in the app) | same | same |
| `1m` | E-paper reader | `/epaper`, `/epaper/:date`, `/epaper/:date/page/:n` (+ `?clip=<short_id>`) | `EditionReader` (toolbar: date, search, first/prev/page-box/next/last, zoom, clips toggle, two-page spread, full screen, share) `EpaperSheetViewport` (fits the whole sheet, zoom 1-4x, pan) `EpaperSheet` (fixed 1200x1860 broadsheet drawn from the page JSON: folio, page-1 masthead, justified Telugu columns, captioned photos, hairline rules; modes reader / thumbnail / print) `EpaperRail` (Pages thumbnails + Page clips) `EpaperClipDialog` (one story, share, link to the full article) `EpaperDatePicker` (month calendar over the archive) `EpaperSearch` (client-side over the loaded edition) `EpaperRadio` (`AudioPlayer`) `ShareSheet` | `GET /epaper/today` · `GET /epaper/{date}` · `.../pages/{n}` · `GET /epaper/archive` (the calendar's available days) — **no public PDF route: readers see the paper, they do not download it** | epaper_editions, epaper_pages, epaper_page_articles |
| — | Static / compliance (§12.5) | `/about` `/contact` `/editorial-policy` `/corrections` `/grievance` `/privacy` `/terms` `/ai-disclosure` | `PolicyPage` `GrievanceForm` | `GET /public/pages/{slug}` · `POST /public/grievance` | settings, grievance_tickets |

### Newsroom CMS

| # | Screen | Route | Key components | API | Tables |
|---|---|---|---|---|---|
| `1k` | Login (2 variants) | `/admin/login` | `OtpLoginForm` (phone + 6-box OTP, resend timer, attempt counter) `PasswordLoginForm` + `TotpStep` | `POST /auth/otp/request` `/auth/otp/verify` `/auth/login` `/auth/2fa/verify` | users, sessions, audit_log |
| `1h` | Editor approval queue | `/admin/review` | `QueueTabs` (all · **AI drafts** violet · district filter) `QueueColumn` x3 `ArticleQueueCard` (state chip, **age chip red at >30m**, reporter, district) | `GET /cms/dashboard/queue` · `POST /cms/articles/{id}/approve\|reject\|request-changes` | articles, workflow_transitions, audit_log, article_versions |
| `1i` | AI article writer | `/admin/ai/writer` | `IntakeTabs` (notes / press note / wire / **voice** / WhatsApp) `VoiceRecorder` + waveform `TranscriptPanel` `HeadlineOptions` (5) `TiptapPreview` `SuggestedMeta` `UnverifiedPanel` `SimilarityMeter` `SensitiveTopicNotice` — **no publish button exists on this screen** | `POST /cms/ai/run` · `POST /cms/articles` (DRAFT) · `.../submit` | ai_jobs, ai_task_configs, ai_prompts, articles |
| `1j` | AI cost dashboard | `/admin/ai/usage` | `BudgetMeter` (80% amber / 100% red markers) `ProviderCard` x3 `TaskRoutingTable` + edit routing | `GET /cms/ai/usage` · `PATCH /cms/ai/task-configs/{id}` | ai_cost_ledger, ai_jobs, ai_providers, ai_models, ai_task_configs |
| `1l` | Push pipeline | `/admin/notifications` | `PushComposer` (**live 65-char counter**) `TopicChips` `QuietHoursNotice` `PushApprovalCard` (audience, article state, CDN pre-warm) `DevicePreview` `ReaderPrefsPanel` | `POST /cms/push` · `.../approve` · `.../send` | push_campaigns, articles, audit_log |
| `1n` | E-paper builder | `/admin/epaper`, `/admin/epaper/:date`, `/admin/epaper/:date/print` | `EpaperGenerateDialog` (date + page count, plan preview) `EpaperWorkspace` (page rail, editable `EpaperSheet` with slot chrome, `EpaperPageEditor` toolbar, `EpaperCandidates` picker with size badges) `EpaperPrintPage` (every sheet at scale 1 with `@page`, staff print / save as PDF; inside `RequireAuth`, outside `AdminLayout` so no chrome prints) `EpaperTemplates` (layout + category chips) | `GET /admin/epaper/plan` · `POST /admin/epaper/generate` · `POST .../{id}/regenerate` · `GET .../{id}/candidates` · `POST .../pages/{pid}/fill` · `POST .../{id}/fill` · `PATCH .../pages/{pid}` (slot-aligned `article_ids`) · `POST .../submit|approve|publish|withdraw|pdf` | epaper_editions, epaper_pages, epaper_page_articles, epaper_page_templates, epaper_assets |
| — | Dashboard | `/admin/dashboard` | `AdminPage` + `StatCard` grid — **every count from the database, never hardcoded** (brief §26) | `GET /cms/dashboard` | aggregate |
| — | Articles CRUD | `/admin/articles`, `/new`, `/:id/edit` | `DataTable` (stacks to cards < md) + `StatusPill` `WorkflowActions` (Approve hidden on your own story) `TiptapEditor` + Telugu toolbar `MediaPicker` (Dialog) `SeoPanel` | `CRUD /cms/articles` | articles, article_versions, article_tags, article_media |
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

`ai.run` · `epaper.schedule` (Beat, daily draft edition) · `epaper.audio` (Beat) — the e-paper PDF is
rendered by a FastAPI background task at publish (Pillow + Raqm, `epaper_pdf`) and is **staff-only**:
it is reachable from the CMS edition and from a reader's own generated edition, never from a public
route · `video.transcode` (ffmpeg ladder) · `search.index` / `search.deindex` ·
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
P6 media · P7 AI gateway + tools + images · P8 e-paper (generated daily edition, slot layouts) · P9 video ·
P10 notifications + analytics · P11 security + performance + tests + deployment.


---

## E. Shared UI primitives (added by the UI upgrade)

Every screen above is assembled from these; a page does not hand-roll a button,
a table, a dialog or an empty state. The two lists are deliberate twins.

| Concern | Web (`frontend/src/components/ui`) | App (`mobile/src/ui`) |
|---|---|---|
| Text / script | `useScript()` + `.te` / `.th` classes | `T` (picks the face, floors Telugu line-height) |
| Icons | `Icon` (lucide-react) | `Icon` / `TabIcon` (lucide-react-native + svg) |
| Actions | `Button` `ButtonLink` `IconButton` `IconButtonLink` | `Button` `IconButton` `PressableScale` |
| Selection | `Chip` `ChipRail` `Tabs` | `Chip` `ChipRail` |
| Status | `Badge` `StatusPill` (+ `features/cms/status.ts`) | `Badge` |
| Surfaces | `Card` `PageContainer` `PageHeader` `SectionHeader` | `Card` `Screen` `ScreenHeader` `Divider` |
| States | `Skeleton` `SkeletonCard` `QueryState` `EmptyState` `ErrorState` | `Skeleton` `SkeletonFeed` `ListFooter` `Feedback` |
| Overlays | `Dialog` `Sheet` `ConfirmDialog` `PromptDialog` `useConfirm` `Toaster` / `useToast` | `BottomSheet` `ConfirmSheet` `ToastHost` / `useToast` |
| Forms | `Field` `Input` `Select` `Textarea` `Checkbox` `Radio` `Switch` `FileDrop` | `Field` `Input` |
| Motion | `utils/motion.ts` (`useReveal` `useScrolled` `useHideOnScroll` `withViewTransition`) | `lib/motion.ts` (`useMotion`) |
| Shell | `AppErrorBoundary` `RouteFallback` `ScrollToTop` `SkipLink` | `AppErrorBoundary` `TabBar` |

`window.prompt` / `confirm` / `alert` are banned on the web and `Alert.alert` is
no longer used for feedback in the app: both go through the dialog and toast
primitives, and the audit scripts enforce it.
