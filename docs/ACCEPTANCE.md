# Acceptance — updated doc §31 checklist

Status of every §31 homepage acceptance criterion, with the evidence that
backs it. "Test" names an automated test that fails if the behaviour
regresses; "live" means walked in the browser against the dev stack during
the build (Sep 2026). The backend suite is `backend/tests/` (133 tests).

| § | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Homepage loads on desktop, tablet and mobile | ✅ desktop + mobile live; tablet via responsive layout | Live at 1280px and 375px (app + web); Tailwind breakpoints cover 768/1024 — run the §15.4 device pass before launch |
| 2 | User can navigate to every configured category | ✅ | Nav renders from `GET /public/config`; `test_config_lists_states_and_new_categories`; live |
| 3 | Trending stories dynamically returned by the backend | ✅ | `TestTrending` (decay, spam dedup, scopes, drafts-never-trend); live on `/trending` and the home section |
| 4 | National / local / international feeds independently configurable | ✅ | `homepage_sections` drives the section list; `test_disabling_a_section_removes_it_without_deploy` |
| 5 | Local feed changes when the user changes location | ✅ | Live: Guntur selection re-anchored header, home edition and Local tab; preferences round-trip test |
| 6 | Mandal-level stories appear only when their hierarchy matches | ✅ | `test_locality_stories_rank_above_district_stories` (exact-first §4 rule) |
| 7 | Admin can pin/unpin; expired pins disappear automatically | ✅ | `TestPins` — expiry is the read predicate, not a job; live: pin → home lead → unpin |
| 8 | Article cards open the correct article | ✅ | Live across home/section/search/local/trending/shorts on web and app |
| 9 | Homepage supports loading, empty and error states | ✅ | Every screen ships all three (web page states; app `Feedback.tsx`); error states exercised live during CORS setup |
| 10 | Logged-in users receive personalized content | ✅ | `TestForYou` — §3.2 formula with negative feedback; "మీ కోసం" rail on web + app |
| 11 | Anonymous users receive a sensible default feed | ✅ | `test_new_account_gets_latest_fallback`; anonymous home is the edge-cached broadsheet |
| 12 | Analytics events do not block normal page usage | ✅ | Beacon returns 202 and is fired without awaiting; search-log failures are swallowed (`log_search` guard); rate-limit fails open (`test_redis_outage_fails_open`) |
| 13 | API responses paginated and cached where appropriate | ✅ | Cursor/offset paging on every feed; Redis + `Cache-Control` on public reads; publish purges (`test_publish_purges_reader_caches`) |

## §27/§28 hardening shipped alongside

- Rate limits on public writes (beacon 30/min, comments 6/min, reports 6/min,
  follows 30/min, submissions 3/min, ad clicks 30/min) keyed by user id or
  IP — Redis-backed, failing open on outage by design (`test_phase_g_hardening.py`).
- Publishing/unpublishing purges the `home:`/`breaking`/`trending:` caches (§10.1).
- Redis circuit breaker: one failed connection opens a 15 s fail-fast window,
  so an outage degrades instead of stacking 2 s timeouts per request.
- Refresh-token rotation re-registers its session, so a Redis flush cannot
  force-log-out readers holding valid refresh tokens.

## Known launch prerequisites (config, not code)

| Item | Blocked on |
|---|---|
| Real SMS OTP | MSG91 credentials (`MSG91_*`); until then email/dev-echo |
| Push delivery to devices | `FCM_SERVICE_ACCOUNT_JSON` (tokens already collected) |
| Server-side cached TTS audio | Telugu TTS provider decision (on-device TTS live now) |
| LLM-backed assist | Provider API keys (heuristic-v1 live now, same response shape) |
| §15.4 device matrix render pass | Physical devices (Samsung/Xiaomi/…); `/qa/telugu-render` ships |
