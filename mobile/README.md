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
src/stores/      zustand: auth session, persisted reader prefs, toast queue
src/lib/         theme tokens (mirror of frontend/tailwind.config.ts), motion, i18n, beacon, tts
src/ui/          the primitives: T, Icon, PressableScale, Button, Chip, Badge, Card, Screen,
                 ScreenHeader, TabBar, Skeleton, ListFooter, BottomSheet, Toast, Input
src/components/  ArticleCard variants, SectionHeader, BodyRenderer (Tiptap → native), Feedback
src/app/         expo-router: (tabs)/{index,local,videos,search,profile}, article/[shortId], …
```

## Design system

`src/lib/theme.ts` is the single source of colour, type, spacing, radius and
elevation, and it mirrors the web contract token for token. Rules that the
audit script enforces rather than trusting to review:

* every string renders through `<T>`, which picks the face (Noto Serif Telugu
  for headlines, Noto Sans Telugu for body, Fraunces for Latin display, Manrope
  for Latin chrome), applies the scale and floors Telugu
  line-height at 1.65× — body never drops below 17sp, including at `A-`;
* every colour comes from `useColors()` / `makeStyles`, never a literal;
* every touchable is `<PressableScale>` (or a primitive built on it), so press
  feedback and haptics are consistent and targets stay at 44px;
* every animation and haptic goes through `useMotion()`, which disables them
  when the OS asks for reduced motion;
* icons come from `<Icon name="…">` (lucide) — no emoji, no glyph characters.

## Gates

```bash
cd mobile
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run audit:ui            # design-system regression net, --strict to fail hard
CI=1 npx expo export --platform android
```

## Release

The app ships as an APK; there is no `expo-updates` channel, so JS changes need
a new build. Native modules (`expo-haptics`, `react-native-svg`) and anything in
`app.json` require a prebuild first:

```bash
npx expo prebuild -p android --clean
eas build -p android --profile apk      # or: cd android && ./gradlew assembleRelease
```

Set `EXPO_PUBLIC_API_URL` for the build. Bump `version` and `android.versionCode`
in `app.json` in their own commit. Note that previously shipped APKs were signed
with the local Gradle debug keystore, so a build signed with a different key
installs as a separate app rather than an update.

Conventions carried over from the web app: Telugu-first with English fallback
(`pick(te, en)`), Noto Sans Telugu ≥1.65 line-height everywhere, loading/empty/
error states on every screen, and no publish-side features — this is a reader
app; the newsroom works in the web CMS.
