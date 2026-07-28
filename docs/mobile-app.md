# JAG Mobile (Android) — full reference

> Split out of CLAUDE.md.

## JAG MOBILE APP (session 17, 2026-06-18)

**App directory:** `jag-mobile/` (at repo root, alongside `jag-api/`, `jag-web/`, `jag-infra/`)
**Package:** `com.jagcorporate.mobile`
**Platform:** Android only (Samsung S24 Ultra — Robert's primary device)
**Release APK:** sideloaded via `adb install -r android/app/build/outputs/apk/release/app-release.apk`

### Stack

| Component | Choice |
|---|---|
| Framework | React Native 0.76.3 / Expo 52 (bare workflow) |
| Routing | expo-router v4 |
| Auth | Keycloak PKCE via `react-native-app-auth` v8; redirect scheme `jagmobile://` |
| Token storage | `expo-secure-store` (Android Keystore hardware-backed encryption) |
| Notifications | `@notifee/react-native` — persistent ongoing notification in Android shade |
| Camera / gallery | `expo-image-picker` for receipt photos |

### Screens

| Route | Purpose |
|---|---|
| `/login` | Keycloak PKCE login; auto-redirects if refresh token exists |
| `/expense-form` | Quick expense entry — amount, currency, category, payment method, payee, card picker, receipt photo; auto-submits on save |
| `/expenses` | Expense list (50 most recent); DRAFT items show Submit button |

**Note:** JAG Mobile has NO VMS, vehicle, or GPS screens. Vehicle management (work orders, fuel logs, compliance, disposal) and GPS tracking are **web-browser-only** (`jagcorporate.com` on phone browser). The independent GPS fallback on mobile is the **Traccar Manager** app (connects directly to `traccar.jagcorporate.com`).

### Auth Pattern
- First login: PKCE browser redirect → tokens stored in SecureStore (`jag_access_token`, `jag_refresh_token`, `jag_id_token`)
- Subsequent opens: silent refresh via `refresh_token` grant — no manual login required
- Notification shown as soon as `jag_refresh_token` exists in SecureStore (no need to wait for full auth check)

### Notification Widget
- Persistent ongoing notification in Android shade (like Money Manager) — channel `jag-quick-entry`
- `+ New Expense` action button opens expense-form directly
- Importance: `DEFAULT` (silent on Samsung One UI — no sound, no vibration)
- `ongoing: true` keeps notification pinned until force-stop or restart
- **After phone restart:** `BootReceiver.kt` restores notification via `BOOT_COMPLETED` broadcast
  - `exported="false"` (security — protected broadcast, external apps can't trigger it)
  - Samsung battery optimization blocks boot receiver for sideloaded apps → set **Settings → Apps → JAG Mobile → Battery → Unrestricted**

### Release Signing
- Keystore: `jag-mobile/android/app/jag-mobile.keystore` (gitignored via `android/.gitignore`)
- Credentials: `jag-mobile/android/signing.properties` (gitignored) — `MYAPP_UPLOAD_STORE_FILE`, `MYAPP_UPLOAD_KEY_ALIAS`, `MYAPP_UPLOAD_STORE_PASSWORD`, `MYAPP_UPLOAD_KEY_PASSWORD`
- `build.gradle` reads `signing.properties` via `Properties.load()` — never stores credentials in code
- Password: ‹SECRETS VAULT›[^secrets] (both store and key password)

### App Icon
- Square + round variants at all mipmap densities (mdpi through xxxhdpi)
- JAG hexagonal logo, white background, logo fills ~96% of icon space
- Source: PowerShell brightness-threshold pixel scan to find tight logo bounds, gray background pixels replaced with white

### Splash Screen
- Dark navy background (`#0f172a`) via `res/values/colors.xml` → `splashscreen_background`
- White silhouette JAG logo (`splashscreen_logo.png`) at all drawable densities

### Build Commands
```powershell
# Debug build
cd jag-mobile && npx expo run:android

# Release build
cd jag-mobile/android && ./gradlew assembleRelease

# Install on connected device
adb install -r app/build/outputs/apk/release/app-release.apk
```

### Key Patterns
- **FX rates:** fetched live from `GET /finance/fx-rates` on expense-form mount; `FALLBACK_FX` used if offline (`TTD:1, USD:6.78, CNY:0.94, EUR:7.35, GBP:8.60`)
- **Card picker:** fetches `GET /finance/credit-cards`; shown only when payment method is `CREDIT_CARD` or `DEBIT_CARD`
- **Receipt photo:** `expo-image-picker` (camera or gallery) → `POST /finance/expenses/:id/receipt` as multipart/form-data
- **Notification icon:** `ic_notification.png` — must be white on transparent (Android requirement); at drawable densities 24/36/48/72/96px

### Security Notes
- `BootReceiver` uses `exported="false"` — BOOT_COMPLETED is a protected broadcast so system still delivers it, but other apps cannot trigger the receiver by component name
- No biometric lock (decided not to add — acceptable for current use)
- All tokens in Android Keystore via expo-secure-store; never in AsyncStorage or plaintext

---
