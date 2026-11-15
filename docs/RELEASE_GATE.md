# DOB-Hub Pre-Production Release Gate Checklist

> **MANDATORY DISCLOSURE BEFORE REVIEWING OR PUBLISHING:**
> **The automated Firestore Security Rules emulator suite (`tests/firestore-rules.test.ts`, 22 test cases across 15 suites: `Suite 1`–`Suite 9` and `Suite 11`–`Suite 16`; `Suite 10` unused) has NEVER BEEN RUN in this development environment** because Java 21+ and the Firestore Emulator runtime are not available inside the sandbox. Every rules test is strictly **`NOT RUN`** until executed cleanly in CI (`.github/workflows/ci.yml`) or on a local machine via `npm run emulators:exec`.
> **Do NOT publish rules or announce production launch until every gate item below is marked `PASS`.**

---

## Go / No-Go Release Checklist

| # | Gate Item | Verification Evidence / Command | Pass Criteria | Owner | Status (`PASS` / `FAIL`) |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **1** | **Firestore Security Rules Emulator Suite** | Run `npm run emulators:exec` (or inspect `.github/workflows/ci.yml` `verify` job on the release commit) | **22/22 cases across 15 suites pass (`Suite 1` [2], `Suite 2` [1], `Suite 3` [3], `Suite 4` [1], `Suite 5` [1], `Suite 6` [3], `Suite 7` [1], `Suite 8` [1], `Suite 9` [2], `Suite 11` [1], `Suite 12` [1], `Suite 13` [2], `Suite 14` [1], `Suite 15` [1], `Suite 16` [1]; `Suite 10` unused) — Currently `NOT RUN`** | Tech Lead / DevOps | **FAIL (NOT RUN)** |
| **2** | **CI Pipeline Green (`lint`, `test`, `build`, `emulators:exec`)** | Check GitHub Actions `.github/workflows/ci.yml` on exact release SHA | All 4 CI steps green: `npm run lint`, `npm test` (17 test files), `npm run build`, and emulator rules suite (`22/22` cases) | Tech Lead / DevOps | PENDING |
| **3** | **Rules Playground Manual Cases (`docs/RULES_MANUAL_CHECK.md`)** | Execute all **10 scenarios** in Staging Firebase Console -> Firestore -> Rules Playground against seeded docs (`docs/RULES_MANUAL_CHECK.md`) | All 10 cases match expected `ALLOW` / `DENY` outcomes; Rules A1 (`docs/rules/A1.rules`) -> A1+A2 (`firestore.rules`) -> Group B (`docs/RULES_GROUP_B.md`) verified | Security Reviewer / Admin | PENDING |
| **4** | **Staging Run — Phase 4 Attendance & Kiosk Flows (`docs/PHASE4_MANUAL_CHECK.md`)** | Run Sections 1–7 in isolated staging project (`docs/STAGING_RUNBOOK.md`) with Admin + Member + Incognito | Kiosk 45s rotation & 30s grace valid, deep-link strips query params, create-first idempotency & offline/camera error UX work, manual entry & complete/reopen batches verified | QA / Club Admin | PENDING |
| **5** | **Staging Run — Phase 6 UI, Viewports & A11y (`docs/PHASE6_MANUAL_CHECK.md`)** | Test all 19 checks across **320, 360, 390, 412, 768, 1024, 1280 px** as Guest, Member, Admin with keyboard open & 200% zoom | Zero horizontal overflow, dark theme default preserved, opt-in light theme AA contrast, 44px touch targets, 404 route & ErrorBoundary verified | QA / Frontend Lead | PENDING |
| **6** | **Pre-Release Production Database Backup** | Super Admin -> `exportFullBackupJSON({ includePII: true })` + GCP/Firebase Console Managed Firestore Export | Full JSON backup + Cloud export stored in encrypted offline storage; integrity & doc counts confirmed (`docs/RELEASE_V3.md` Step 1) | Super Admin | PENDING |
| **7** | **Migration Dry-Runs Reviewed (`prepareMemberDataRepair`, `prepareUserStateRepair`, `prepareSessionMigration`)** | Run all 3 dry-runs in **Admin -> Diagnostics & Data Repair** on production before committing, plus inspect `computeBackfillPreviewSummary` | Every diff inspected; after commit, re-running all 3 dry-runs returns **0 remaining legacy items** before deploying Group B (`docs/RELEASE_V3.md` Steps 5–6) | Super Admin | PENDING |
| **8** | **Firebase Auth Authorized Domains Configured** | **Firebase Console -> Authentication -> Settings -> Authorized domains** | Exact production domain(s) added; staging domain removed from production (and prod config never reused in staging); localhost removed if strictly locking prod | Super Admin / DevOps | PENDING |
| **9** | **Firebase Web API Key & OAuth Client Restrictions** | **Google Cloud Console -> APIs & Services -> Credentials -> Browser API key** | HTTP referrer restrictions set strictly to production origin(s) (`https://<prod-domain>/*`); API restrictions limited to required Firebase/Identity Toolkit/Firestore APIs only | DevOps / Cloud Owner | PENDING |
| **10** | **Production Server Headers, Health, CSP & Cost Check** | Verify `/_healthz`, `/api/health` (`{"status":"ok"}`), `/api/time` (`Cache-Control: no-store`), unknown `/api/*` JSON `404`, `Strict-Transport-Security`, `Content-Security-Policy-Report-Only`, `/api/csp-report`, non-caching `sw.js`, and review `docs/COST_NOTES.md` + `docs/CSP_NOTES.md` | All headers verified live over HTTPS; Google Sign-In/Auth domains verified per `docs/CSP_NOTES.md` before ever enforcing CSP; `> 1,500` check-in auto-recompute cutoff confirmed | DevOps / Tech Lead | PENDING |
| **11** | **Rollback Readiness Verified (Cloud Run / AI Studio)** | Confirm `firestore.rules.prev`, `docs/rules/A1.rules`, previous Cloud Run revision ID (`gcloud run revisions list`), AI Studio snapshot, and Step 6 backup exist and are writable by on-call owner | Super Admin can re-publish previous Firestore rules (`< 30s`) and DevOps can route Cloud Run traffic to previous revision (`gcloud run services update-traffic ... --to-revisions=PREV=100`, no Firebase Hosting used) (`docs/RELEASE_V3.md` Step 7) | Super Admin / On-Call | PENDING |

---

## Sign-Off Rule

- **GO**: All **11 rows** marked `PASS` with CI run URL and backup timestamp recorded.
- **NO-GO**: Any row is `FAIL` or `PENDING` (including Gate #1 while `tests/firestore-rules.test.ts` remains `NOT RUN`).
