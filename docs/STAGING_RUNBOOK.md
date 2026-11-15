# Staging Firebase & Verification Runbook

One-page guide to stand up an isolated staging environment, seed safely without student PII, run Phase 3–5 checks, and roll back cleanly.

> **HARD RULE:** NEVER copy, commit, or reuse the production `firebase-applet-config.json` in staging, and NEVER import `memberPrivate` or `users` PII into staging.

---

## 1. Create a Separate Staging Firebase Project & Applet

1. **Create a new Firebase project** in Firebase Console (e.g., `dob-hub-staging`), distinct from your production project.
2. **Enable products** in the staging project:
   - **Firestore Database** (Native mode, same region as prod, e.g., `asia-northeast3`).
   - **Authentication -> Sign-in method -> Enable Google**.
3. **Register a Web App** in **Project Settings -> Your apps** and copy its web config into the **staging applet only** (or set matching `VITE_FIREBASE_*` env vars). Verify `projectId`, `authDomain`, and `apiKey` do **not** match production `firebase-applet-config.json`.
4. **Add the staging domain to Authorized domains**:
   - Open **Firebase Console (staging) -> Authentication -> Settings -> Authorized domains -> Add domain**.
   - Add your staging origin hostname (e.g., your AI Studio staging preview host or `staging.yourdomain.example`).

---

## 2. Create Staging-Only Test Accounts

Use throwaway test Google accounts (**zero real student names, emails, or student IDs**):

| Role | Account Purpose | How to Assign |
| :--- | :--- | :--- |
| **Super Admin** | Owner/rollback/backup testing | Set `VITE_SUPER_ADMIN_EMAIL` (and staging config) to a dedicated staging owner Google account. |
| **Delegated Admin** | Kiosk, session CRUD, manual check-in | Sign in with staging test Google account #2 -> promote via **Admin -> Administrators**. |
| **Active Member A & B** | QR self-check-in, `memberPrivate` isolation | Sign in with test Google accounts #3/#4 -> submit test application -> approve -> user accepts invite. |
| **Pending / Declined** | Listener isolation, re-apply flow | Sign in with test Google account #5 -> submit application -> leave pending (or decline). |

---

## 3. Seed Staging Data Safely

Choose **one** of these two safe options:

### Option A — Throwaway Seed (Fastest)
1. Publish `firestore.rules` (A1 + A2) in the **staging** Firebase Console Rules Editor.
2. Sign in to the staging app as the **Staging Super Admin** -> click **Initialize Club Workspace** (`initializeFirestoreWithDefaults`), then create 2–3 dummy sessions and test check-ins in the UI.

### Option B — Sanitized (Zero-PII) Copy from Production
1. On **production**, sign in as Super Admin -> **Database Backup & Integrity -> Download Sanitized JSON (`includePII: false`)** (`exportFullBackupJSON({ includePII: false })`).
2. Confirm `_metadata[0].includesPII === false` and confirm `memberPrivate` and `users` are absent from the JSON file.
3. Import only non-PII collections (`members`, `sessions`, `checkIns`, `announcements`, `settings`, `publicLeaderboard`) into the **staging** Firestore project via a temporary local Firebase Admin SDK script pointed at the **staging** service account.
4. Update `authUid` on 1–2 test member documents to match your Staging Active Member test UIDs (never leave real student emails/IDs if any legacy keys remain).

---

## 4. Run Manual Verification Suites

1. **Security Rules (`docs/RULES_MANUAL_CHECK.md`)**:
   - Paste `docs/rules/A1.rules` or `firestore.rules` into **Staging Firebase Console -> Firestore -> Rules -> Rules Playground**.
   - Execute all **10 scenarios** (valid check-in, empty/expired token reject, closed session reject, cross-member `memberPrivate` deny, non-admin vs admin session delete, immutable notification `userId`, unverified super admin deny, link validation).
   - If Java 21 + Firebase CLI emulators are available locally: run `npm run emulators:exec` to execute `tests/firestore-rules.test.ts` (**15 suites, 22 cases total**: `Suite 1` [2], `Suite 2` [1], `Suite 3` [3], `Suite 4` [1], `Suite 5` [1], `Suite 6` [3], `Suite 7` [1], `Suite 8` [1], `Suite 9` [2], `Suite 11` [1], `Suite 12` [1], `Suite 13` [2], `Suite 14` [1], `Suite 15` [1], `Suite 16` [1]; `Suite 10` unused).
2. **End-to-End Flow (`docs/PHASE4_MANUAL_CHECK.md`)**:
   - Walk through all **7 sections**: Kiosk 45s rotation + 30s grace window, signed-out QR deep-link (`?s=...&t=...`) strip + auto check-in, self check-in (`camera_scan` & `code_input`) + double-tap idempotency + offline/error states, admin manual pass scan, `completeSession` / `reopenSession` atomic batches, role-scoped listener check (zero console errors for pending users), and `points: 0` / `maxCapacity` soft warnings.

---

## 5. Rollback Procedures

| Layer | Rollback Action |
| :--- | :--- |
| **Web / Server Build (Cloud Run / AI Studio)** | Route traffic back to the previous healthy Cloud Run revision (`gcloud run services update-traffic <staging-service> --region=asia-northeast1 --to-revisions=<PREVIOUS_REVISION>=100`) or revert the AI Studio staging applet snapshot. (App is served by Node/Express on Cloud Run/AI Studio; no Firebase Hosting is used.) |
| **Firestore Rules** | Firebase Console -> **Firestore Database -> Rules -> Version history** -> select the previous published ruleset -> **Publish**. If Group B broke a stale client, revert temporarily to `firestore.rules` (A1 + A2) or `docs/rules/A1.rules`. |
| **Firestore Data** | Import from the step-1 pre-release backup (`exportFullBackupJSON` or Cloud Firestore Managed Export in Google Cloud Console). After any restore, run `prepareMemberDataRepair` and `prepareSessionMigration` dry-runs in **Admin Backup** before re-enabling Group B rules. |
