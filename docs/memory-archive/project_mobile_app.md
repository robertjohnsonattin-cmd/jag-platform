---
name: project-mobile-app
description: "JAG Mobile Android app — stack, screens, signing, notification, biometric lock, build commands, FUEL vehicle linking — updated session 34 2026-07-05"
metadata: 
  node_type: memory
  type: project
  originSessionId: 594cff5c-75cd-41e3-b068-4964e19c4812
---

JAG Mobile is a React Native Android app (sideloaded APK, not Play Store). Built session 17, updated session 18. See also [[project-phase-status]].

**Why:** Robert needed a quick-entry expense widget in the Android notification shade (like Money Manager) for instant logging from the phone, without navigating to the web platform.

**How to apply:** When working on mobile app features, note that jag-mobile/ is a separate Expo bare workflow project. It uses its own auth (PKCE, not web session), its own build pipeline (Gradle), and its own API client.

## Location & Package
- Directory: `jag-mobile/` (repo root)
- Package: `com.jagcorporate.mobile`
- Device: Samsung S24 Ultra (Robert's primary phone)
- Install: `adb install -r android/app/build/outputs/apk/release/app-release.apk`

## Stack
| Component | Choice |
|---|---|
| Framework | React Native 0.76.3 / Expo 52 (bare workflow) |
| Routing | expo-router v4 |
| Auth | Keycloak PKCE via `react-native-app-auth` v8; redirect scheme `jagmobile://` |
| Token storage | `expo-secure-store` (Android Keystore hardware-backed) |
| Notifications | `@notifee/react-native` — persistent ongoing notification |
| Camera | `expo-image-picker` for receipt photos |
| Biometrics | `expo-local-authentication` ~15.0.2 — fingerprint lock on every cold open |

## Screens
| Route | Purpose |
|---|---|
| `/login` | Keycloak PKCE; fingerprint button if refresh token + biometrics enrolled |
| `/expense-form` | Quick entry — amount, currency, category, payment method, payee, card picker, receipt photo; category=FUEL shows a Vehicle picker (session 34) |
| `/expenses` | Recent 50 expenses; Submit button on DRAFT items |

## Biometric Lock (added session 18)
- `_layout.tsx` shows a fingerprint lock screen on every cold start before revealing the app
- Checks `hasHardwareAsync()` + `isEnrolledAsync()` on mount; if both true → auto-prompts fingerprint
- On success: `locked = false` → app proceeds normally (auth check + routing runs behind it)
- On failure/cancel: lock screen stays showing green "Use Fingerprint" button to retry
- If biometrics not available/enrolled: lock is skipped silently
- Login screen (`login.tsx`) also has fingerprint button for re-auth when refresh token expired

## Auth Flow
- PKCE browser redirect on first login → tokens in SecureStore (`jag_access_token`, `jag_refresh_token`, `jag_id_token`)
- Subsequent opens: biometric gate first, then silent token refresh — no KC browser needed
- Notification shown as soon as `jag_refresh_token` exists

## Gradle — Biometric Dependency Fix (CRITICAL)
`expo-local-authentication` requires `androidx.biometric:biometric:1.2.0-alpha04` which cannot be downloaded on this machine due to JDK SSL trust store issue (PKIX path building failed).

**Fix applied:** `android/build.gradle` root `allprojects {}` block forces stable cached version:
```groovy
allprojects {
    configurations.all {
        resolutionStrategy.force 'androidx.biometric:biometric:1.1.0'
    }
    ...
}
```
Also `android/gradle.properties` has `-Dhttps.protocols=TLSv1.2,TLSv1.3` in JVM args.
**Do NOT remove these** — build will fail without them.

## Card Picker Fixes (session 18)
- Added `keyboardShouldPersistTaps="handled"` to picker `ScrollView` — fixes Android touch freeze
- Added "No card" option at top of card list — allows clearing a selected card
- `entityId` state typed as `useState<string>()` (was inferred as literal UUID causing TS error)

## Notification Widget
- Persistent ongoing notification in Android shade (`+ New Expense` action button)
- Channel: `jag-quick-entry`, importance: DEFAULT (silent on Samsung One UI)
- `ongoing: true` keeps it pinned until force-stop or restart

## Boot Receiver (post-restart persistence)
- `BootReceiver.kt` — restores notification on `BOOT_COMPLETED`
- `exported="false"` — security; BOOT_COMPLETED is protected so system still delivers it
- **Samsung caveat:** battery optimization blocks boot receivers for sideloaded apps → Settings → Apps → JAG Mobile → Battery → Unrestricted

## Release Signing
- Keystore: `jag-mobile/android/app/jag-mobile.keystore` (gitignored)
- Credentials: `jag-mobile/android/signing.properties` (gitignored)
  - Password: `labourday2026` (both store and key)

## Build Commands
```powershell
# Release build
cd jag-mobile/android && ./gradlew assembleRelease

# Install (USB cable — set phone to File Transfer mode first)
adb install -r app/build/outputs/apk/release/app-release.apk

# Wireless: pair first (Settings → Developer options → Wireless debugging → Pair)
adb pair <ip>:<pairing-port> <code>
adb connect <ip>:<connection-port>   # port shown on main Wireless debugging screen
```

## Key Patterns
- **FX rates:** live from `GET /finance/fx-rates`; `FALLBACK_FX = {TTD:1, USD:6.78, CNY:0.94, EUR:7.35, GBP:8.60}` for offline
- **Card picker:** `GET /finance/credit-cards`; only shown when payment method is CREDIT_CARD or DEBIT_CARD
- **Receipt photo:** `expo-image-picker` → `POST /finance/expenses/:id/receipt` multipart/form-data
- **Auto-submit:** expense-form auto-calls `expensesApi.submit(id)` after create
- **FX conversion on mobile:** same rule as web — `toTTD = amount × rateMap[currency]`; TTD rate is 1

## API Client Files
- `jag-mobile/src/api/client.ts` — fetch-based base client (`request<T>()`) with SecureStore token injection; `api.get/post/patch/delete/postForm`
- `jag-mobile/src/api/expenses.ts` — expensesApi, fxRatesApi, creditCardsApi
- `jag-mobile/src/api/vehicles.ts` (added session 34) — `vehiclesApi.list()` (`GET /ims/vehicles`), `vehiclesApi.lastFuelLog(id)` (`GET /ims/vehicles/:id/fuel-logs`) — backs the FUEL-category vehicle picker
- `jag-mobile/src/services/quickNotification.ts` — showQuickEntryNotification(), registerForegroundHandler()
- `jag-mobile/android/app/src/main/java/com/jagcorporate/mobile/BootReceiver.kt`

## Fuel expense → vehicle linking (session 34)
Picking category **Fuel** in `/expense-form` shows a Vehicle picker (lazy-loaded on first use). Selecting a vehicle prefills Odometer (from `vehicle.current_mileage_km`) and Price/Litre + Fuel Type (from that vehicle's most recent fuel log) — litres is always derived from Amount ÷ Price, never typed. On submit this sends `linked_record_type/id/label` + `fuel_litres/fuel_odometer_km/fuel_type` so the backend's `autoInsertFuelLog()` creates a matching `vms_fuel_logs` row automatically. See [[project-fuel-logging-sync]] for the full sync architecture and two bugs that had to be fixed for this to actually work end-to-end.

**Debug build (`npx expo run:android`) is currently broken** — Gradle can't resolve `app.notifee:core:+` (`Could not find any matches for app.notifee:core`). Use `cd android && ./gradlew assembleRelease` + `adb install -r app/build/outputs/apk/release/app-release.apk` instead (works fine, same as the normal release flow).

## Pending
- No web UI for fin_credit_cards management yet — use mobile or API directly
