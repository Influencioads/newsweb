# Top Telugu News — mobile app

React Native (Expo SDK 57, expo-router) reader app consuming the same
`/api/v1` backend as the website. Updated-doc scope shipped so far: Home feed
(breaking ticker, lead, sections), Local feed (state → district → mandal,
exact-location-first), full-text Search with popular/recent chips, reader OTP
sign-in (auto-registration §11), preferences (language, location, interests,
notifications), article page with the §4.1 A-/A/A+/A++ switcher and native
Tiptap rendering, and share.

## Run it

```bash
cd mobile
npm install
npm start          # Expo dev server — scan the QR with Expo Go (Android/iOS)
npm run web        # or run the same app in a browser
```

The API origin resolves automatically:

1. `EXPO_PUBLIC_API_URL` when set (use this for staging/production builds).
2. In Expo Go, the dev machine's LAN IP derived from the Metro host, port 8000 —
   so a phone on the same Wi-Fi reaches the laptop's backend with zero config.
3. `http://localhost:8000` on web.

Start the backend first (from `backend/`):

```bash
.venv/Scripts/python.exe scripts/init_dev_db.py   # once, or after schema changes: --fresh
.venv/Scripts/python.exe scripts/run_dev.py
```

## Layout

```
src/api/         axios client (SecureStore tokens, 401 refresh+replay), endpoints, types
src/stores/      zustand: auth session, persisted reader prefs (language/location/font step)
src/lib/         design tokens (mirror of frontend/tailwind.config.ts), i18n strings
src/components/  ArticleCard variants, SectionHeader, BodyRenderer (Tiptap → native), states
src/app/         expo-router: (tabs)/{index,local,search,profile}, article/[shortId], section/[slug]
```

Conventions carried over from the web app: Telugu-first with English fallback
(`pick(te, en)`), Noto Sans Telugu ≥1.65 line-height everywhere, loading/empty/
error states on every screen, and no publish-side features — this is a reader
app; the newsroom works in the web CMS.
