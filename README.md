# DOB-Hub (Den of Builders Attendance & Participation Hub)

Production attendance, kiosk QR verification, public leaderboard projection, participation reporting, and admin operations hub for **Den of Builders**.

---

## Key Architecture & Security Highlights

- **Firebase Auth + Firestore Rules Enforcement**: Role checks (`Super Admin`, delegated `admins/{uid}`, `isActiveMember()`) and attendance validity (`sessionOpen`, rotating 8-char `sessionTokens`, `request.time` late thresholds, immutable check-ins, append-only `auditLogs`) live in `firestore.rules`.
- **PII Separation**: Public roster profiles (`members/{memberId}`) are isolated from sensitive personal data (`memberPrivate/{memberId}`). The signed-out public leaderboard reads only sanitized `publicLeaderboard/{memberId}` projections.
- **Performance & Bundle Hygiene**: Lazy-loaded Firestore services, code-split routes/charts (`vite.config.ts`), bounded admin default listeners (current + 2 prior months check-ins, 12 months sessions) with on-demand full history fetch, compressed PNG logo assets, and a self-unregistering `public/sw.js`.
- **Express Production Server (`server.ts`)**: Serves built `dist/` assets with native gzip compression, `/_healthz`, `/api/health`, `/api/time` (`Cache-Control: no-store` for server-offset check-in timing), immutable `/assets` caching, `no-cache` for SPA shell/`sw.js`, and security headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy-Report-Only`).

---

## Requirements & Setup

- **Node.js**: `>= 22.18.0` (verified on `v22.23.2` — required if running `npm start` / `node server.ts` directly without flags; `npm run build` also emits bundled `server.js` runnable on Node 20+).
- **Java 21+**: Required locally or in CI (`actions/setup-java`) to execute the Firestore Emulator security rules suite.

### 1. Install Dependencies

```bash
npm ci
```

### 2. Environment Variables (`.env.example`)

Copy `.env.example` to `.env` when needed:

```env
APP_URL="MY_APP_URL"
VITE_PUBLIC_BASE_URL=""
```

- `APP_URL`: Injected automatically in Cloud Run / AI Studio runtime.
- `VITE_PUBLIC_BASE_URL`: Optional canonical base URL for QR code deep links (defaults to `window.location.origin` in browser).
- Firebase web configuration is loaded from `firebase-applet-config.json` (never commit production credentials to public repos if forked). See `docs/STAGING_RUNBOOK.md` for creating a separate staging Firebase project.

---

## Available Scripts (`package.json`)

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run dev` | `vite` | Start Vite development server |
| `npm run build` | `NODE_ENV=production vite build && esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=server.js` | Build `dist/` SPA + bundled `server.js` |
| `npm start` | `node server.ts` | Start Express production server (requires Node `>= 22.18.0` native TS type stripping, or run `node server.js`) |
| `npm run lint` | `tsc --noEmit` | Run strict TypeScript check |
| `npm test` | Runs all 19 tsx behavioral & regression test files | Verify client logic & regressions |
| `npm run test:rules` | `tsx tests/firestore-rules.test.ts` | Run Firestore security rules suite against a running emulator |
| `npm run emulators:exec` | `npx -y firebase-tools@15.36.0 emulators:exec --project demo-dob-hub-test --only firestore "npx tsx tests/firestore-rules.test.ts"` | Boot Firestore Emulator and run rules tests end-to-end |

---

## Testing & Verification

```bash
# TypeScript check
npm run lint

# All behavioral & regression tests (excludes Firestore emulator suite)
npm test

# Production build
npm run build

# Firestore security rules emulator suite (requires Java 21+)
npm run emulators:exec
```

CI automatically executes `lint`, `test`, `build`, and `emulators:exec` via `.github/workflows/ci.yml`.

---

## Deployment & Cutover Docs

- `docs/SCHEMA.md` — Authoritative 12-collection schema, validators, and index patterns
- `docs/RULES_COVERAGE.md` — Operation-to-rule coverage matrix (emitted via `node scripts/list-firestore-ops.mjs`)
- `docs/RELEASE_V3.md` — Phased production cutover (Backup -> Group A1 -> Client -> Group A2 -> Repair/Migrations -> Group B -> Rollback)
- `docs/STAGING_RUNBOOK.md` — Isolated staging setup and test checklists
- `docs/FEATURE_MATRIX.md` — Final capability matrix (`F1`–`F20`) with explicit evidence labels
- `docs/PHASE4_MANUAL_CHECK.md` & `docs/PHASE6_MANUAL_CHECK.md` — Real-browser & viewport verification checklists
