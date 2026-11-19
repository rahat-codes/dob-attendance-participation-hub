# DOB-Hub V3 Production Release & Cutover Runbook

This runbook governs deploying the hardened V3 release cleanly with zero downtime during live club operations. Validate all steps in staging first per `docs/STAGING_RUNBOOK.md`.

---

## Pre-Flight Checklist

- [ ] CI (`npm run lint`, `npm test`, `npm run build`, `npm run emulators:exec`) is green on the release commit.
- [ ] `.env` / production environment sets `VITE_PUBLIC_BASE_URL` (if non-default) and Firebase Auth **Authorized domains** includes the exact production origin.
- [ ] Confirm **zero live check-in session** is active before deploying `[Group A2]` rules (Step 4).

---

## Step 1 — Mandatory Database Backup

1. Sign in as the **Super Admin** (`SUPER_ADMIN_EMAIL`).
2. Open **Admin -> Diagnostics & Data Repair -> Export Full Backup JSON** (`exportFullBackupJSON`).
3. Download and archive the JSON backup (along with Firestore Managed Export if enabled) to encrypted offline storage.
4. Keep `firestore.rules.prev` ready in version control for instant rules rollback.

---

## Step 2 — Deploy Group A1 Rules (`docs/rules/A1.rules`)

**Purpose**: Backward-compatible hardening safe to publish *before* the new client rollout.

1. Open **Firebase Console -> Firestore Database -> Rules**.
2. Paste the contents of `docs/rules/A1.rules`.
3. Verify syntax in the Rules Simulator and click **Publish**.
4. Confirm existing clients still read/write `users`, `members`, `sessions`, and check-ins without permission errors.

---

## Step 3 — Deploy New Client & Node Server Build

1. Install and build:
   ```bash
   npm ci
   npm run build
   ```
2. Verify `dist/` + `server.js` built cleanly.
3. Deploy the built static SPA (`dist/`) and `/api/*` serverless endpoints (`api/health.ts`, `api/time.ts`, `api/csp-report.ts`) to Vercel (`https://dob-hub.vercel.app` via `vercel.json`), or run the Express server (`node server.js` / `npm start` on Node `>= 22.18.0`) when self-hosting.
4. Smoke-check HTTP endpoints on the live domain (`https://dob-hub.vercel.app`):
   - `GET /api/health` returns `200` with `{ "status": "ok" }`
   - `GET /api/time` returns `200` with `Cache-Control: no-store` and JSON `{ "nowMs": ... }`
   - `GET /` includes security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `Content-Security-Policy-Report-Only`)
   - Hard-refresh once and confirm legacy Service Workers unregister (`/sw.js` served with `no-cache, must-revalidate`).

---

## Step 4 — Deploy Group A1 + A2 Rules (`firestore.rules`)

**Purpose**: Activates client-coupled security (`prevToken` 8-char format on `sessionTokens`, strict self-check-in allowlists forbidding `notes`/`verifiedBy`, authoritative `verifiedBy == auth.uid` on manual check-ins, `notifications` schema validation, and append-only `auditLogs` `request.time`).

1. Confirm no check-in session is currently open.
2. Paste `/firestore.rules` into **Firebase Console -> Firestore Database -> Rules** (or run `firebase deploy --only firestore:rules` against the target project).
3. Click **Publish** and run quick smoke checks from `docs/RULES_MANUAL_CHECK.md` & `docs/PHASE4_MANUAL_CHECK.md`.

---

## Step 5 — Migration Dry-Runs & Commits (Admin UI)

Execute all three idempotent migrations in **Admin -> Diagnostics & Data Repair** (dry-run -> inspect diff -> commit):

1. **Member PII Isolation (`prepareMemberDataRepair` -> `executeMemberDataRepair`)**
   - Copies legacy `email`, `phone`, `studentId`, `university`, `department`, `major`, `semester`, and `profileCompleted` into `memberPrivate/{memberId}`.
   - Strips non-whitelisted legacy PII & counters from `members/{memberId}` down to the 16 canonical public keys.
2. **User State Normalization (`prepareUserStateRepair` -> `executeUserStateRepair`)**
   - Consolidates legacy `notificationPreferences` -> `notificationPrefs` and validates state invariants (`active` users have valid `memberId`).
3. **Session Schema Backfill (`prepareSessionMigration` -> `executeSessionMigration`)**
   - Backfills `startAt`/`endAt` Timestamps, `timezone` (`Asia/Seoul`), `checkInMode`, `openMinutesBefore`, `graceMinutesAfter`, `lateAfterMinutes`, `points`, `host`, and `location`.

### Verification Gate Before Group B
Re-run all three **Dry Runs** and confirm **`0` proposed changes** remain. Also confirm every public leaderboard entry is synced via **Leaderboard -> Recompute / Backfill Public Leaderboard** (confirms prompt explaining exact write count).

---

## Step 6 — Deploy Strict Group B Rules (`docs/RULES_GROUP_B.md`)

**Gate**: Do NOT execute Step 6 until Step 5 Dry-Runs show zero remaining legacy fields on `members`, `users`, and `sessions`.

1. Copy the rules block from `docs/RULES_GROUP_B.md` into **Firebase Console -> Firestore Database -> Rules**.
2. Verify syntax cleanly and click **Publish**.
3. Run post-cutover verification:
   - Signed-out Public Hub loads `publicLeaderboard` (zero PII) and handles retry cleanly.
   - Sign in as member -> check in via kiosk QR + typed 8-char backup token -> confirm `checkIns/{sessionId}_{memberId}` written and duplicate prevented.
   - Export Member Roster CSV -> verify PII excluded unless checkbox enabled.

---

## Step 7 — Emergency Rollback Procedure

| Layer | Rollback Action |
| :--- | :--- |
| **Security Rules** | Paste `firestore.rules.prev` (or `docs/rules/A1.rules` if A2/Group B rejects transitioning data) in **Firebase Console -> Firestore -> Rules -> Publish** (takes effect in < 30s), or restore the previous ruleset from **Firestore -> Rules -> Version history**. |
| **Web / Server Build (Vercel)** | In **Vercel Dashboard -> Project (`dob-hub`) -> Deployments**, open the previous healthy deployment and click **Promote to Production** ("Promote previous deployment", or run `vercel rollback` via Vercel CLI). No Firebase Hosting or Cloud Run service is used. Old clients remain compatible with `docs/rules/A1.rules`. |
| **Data Corruption / Bad Migration** | Restore affected documents from the Step 1 JSON backup (`exportFullBackupJSON`) or Managed Firestore PITR export. Audit entries in `auditLogs` remain immutable for post-incident tracing. |
