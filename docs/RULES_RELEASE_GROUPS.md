# Firestore Rules Release Groups & Migration Sequencing

This document defines the exact production release sequence for Firestore Security Rules in DOB-Hub. Staging into **A1**, **A2**, data repair, and **B** ensures zero downtime and prevents old or transitioning clients from breaking.

> **IMPORTANT**: Always paste each rules file into the **Firebase Console -> Firestore Database -> Rules** editor and run its built-in syntax/simulator check **before** publishing. Never deploy Group B before step 6 passes with zero non-whitelisted keys on `members`.

---

## 1. Exact 7-Step Release Sequence

1. **Backup Database First**
   - Export a full backup using the in-app Super Admin JSON Exporter (`exportFullBackupJSON({ includePII: true })`) or Google Cloud / Firebase Console Managed Export.
2. **Publish Group A1 Rules Only (`docs/rules/A1.rules`)**
   - Paste `docs/rules/A1.rules` into the Firebase Console Rules Editor, verify syntax, and publish.
   - Safe to publish **before** deploying the new client build: enforces email binding/immutability, date-bound `monthKey`, completed-session rejection, link regexes, size bounds, legacy member/session update tolerance, and legacy notification/audit compatibility.
3. **Publish the New Client Build**
   - Deploy the updated web application so kiosks emit 8-char `prevToken`, self check-ins exclude `notes`/`verifiedBy`, audit logs use `serverTimestamp()`, and profile edits write clean `member` / `memberPrivate` documents.
4. **Publish Group A1 + A2 Rules (`firestore.rules`) During Idle Window**
   - Within minutes after client rollout—**while no check-in session is actively running**—paste `firestore.rules` into the Firebase Console Rules Editor, check syntax, and publish.
   - Activates `[Group A2]` client-coupled rules: strict 8-char `prevToken`, self check-in forbid `notes`/`verifiedBy`, authoritative manual `verifiedBy`, strict `notifications` create whitelist, and strict `auditLogs` `request.time` + field whitelist.
5. **Run Repair & Session Migration Tools (Dry Run -> Review -> Commit) Before First Live Event**
   - In the Admin Tools UI, execute `prepareMemberDataRepair`, `prepareUserStateRepair`, and **`prepareSessionMigration`** dry runs, inspect every proposed change, and commit (`executeMemberDataRepair`, `executeUserStateRepair`, `executeSessionMigration`) so:
     - Legacy `email`/`phone`/`studentId`/`university`/counter keys move out of `members/{memberId}` into `memberPrivate/{memberId}`.
     - Existing legacy sessions missing `startAt`/`endAt`/`checkInMode`/`openMinutesBefore`/`graceMinutesAfter`/`lateAfterMinutes`/`host`/`timezone` are backfilled **idempotently before the first live event** (although `sessionOpen` and `isValidCheckInStatus` already use `.get()` defaults for optional window config fields, `startAt` and `endAt` remain required timestamps).
6. **Verify Zero Legacy Keys on `members` & Zero Unmigrated Sessions (Read-Only Check)**
   - Run a read-only inspection (re-run the repair dry-runs or inspect `members` and `sessions` documents) and confirm **0** members have non-whitelisted keys (only the 16 keys in `PUBLIC_MEMBER_WHITELIST` remain) and **0** sessions lack `startAt`/`endAt` or required config fields.
7. **Publish Group B Strict Post-Migration Rules (`docs/RULES_GROUP_B.md`)**
   - Only after step 6 reports zero remaining non-whitelisted keys and zero unmigrated sessions, paste the ruleset from `docs/RULES_GROUP_B.md` into the Firebase Console Rules Editor, check syntax, and publish to permanently lock down `members`, `users` (single `notificationPrefs`), and `sessions` (`isValidSessionFull`).

---

## 2. Rule File Responsibilities

### `docs/rules/A1.rules` (Group A1 Only)
- **Users Schema & Lifecycle**: Size bounds (`applicantName <= 100`, `applicantHandle <= 31`, `applicantStudentId <= 20`, `applicantNote <= 300`, `requestedNotes <= 600`, `readAnnouncementIds <= 100`), fixed `BUILDER_TRACKS` enum for `applicantTrack`, email bound to `request.auth.token.email.lower()` on create, immutable email on update, dual `notificationPrefs` / `notificationPreferences` maps, and `declined` or deactivated (`status == 'active' && !isActiveMember()`) -> `pending` re-apply path.
- **Legacy Tolerance**: Allows legacy member updates (`email`, `phone`, counters), legacy session status/mode/timestamp updates, legacy notification `read`/`dismissed` owner toggles, legacy empty `prevToken`, and ISO-timestamp audit entries from un-updated clients.
- **Core Check-In Safety**: Date-bound `monthKey` (`date.split('-')[0] + '-' + date.split('-')[1]`), `completed` session rejection, ±15s `lateAt` tolerance.

### `firestore.rules` (Group A1 + Group A2)
Adds `[Group A2]` client-coupled enforcement on top of Group A1:
1. `sessionTokens/{sessionId}`: `prevToken` must match `^[A-Z0-9]{8}$`.
2. `checkIns/{checkInId}` self check-in: `notes` and `verifiedBy` are strictly forbidden (`keys().hasOnly([...])`).
3. `checkIns/{checkInId}` manual check-in: enforces `verifiedBy == request.auth.uid`, `checkedInAt == request.time`, `exists(members/memberId)`, `exists(sessions/sessionId)`.
4. `notifications/{notificationId}` create: enforces `isValidNotification` (`keys().hasAll` + `keys().hasOnly` + length bounds).
5. `auditLogs/{logId}` create: enforces `request.resource.data.timestamp == request.time`, `hasAll`/`hasOnly` field whitelists, and size bounds (`action <= 60`, `details <= 1000`, `performedByEmail <= 150`, `targetId <= 128`, `targetName <= 150`).

### `docs/RULES_GROUP_B.md` (Strict Post-Migration Group B)
Locks down remaining transition allowances once migration completes:
1. `members/{memberId}`: Strict `hasOnly` of the 16 public keys (`id`, `name`, `handle`, `role`, `tracks`, `joinedDate`, `status`, `avatarUrl`, `bio`, `leaderboardOptOut`, `authUid`, `createdAt`, `githubUrl`, `linkedinUrl`, `portfolioUrl`, `showLinksPublicly`). Legacy PII (`email`, `phone`, `studentId`, `university`, `department`, `major`, `semester`, counters) forbidden on public member docs.
2. `users/{userId}`: Requires canonical `notificationPrefs` only (forbids legacy `notificationPreferences`).
3. `sessions/{sessionId}`: Requires `isValidSessionFull` on every create and update.

---

## 3. Manual Console Verification Checklist
- [ ] **Step 1**: Full JSON/Console backup downloaded and stored safely.
- [ ] **Step 2**: Pasted `docs/rules/A1.rules` into Firebase Console Rules Editor -> verified syntax -> published.
- [ ] **Step 3**: Built and deployed new client bundle.
- [ ] **Step 4**: Confirmed no session is currently live -> pasted `firestore.rules` into Firebase Console Rules Editor -> verified syntax -> published.
- [ ] **Step 5**: Ran repair dry run -> reviewed diff -> committed migration.
- [ ] **Step 6**: Re-ran read-only check -> confirmed `0` members with non-whitelisted keys.
- [ ] **Step 7**: Pasted `docs/RULES_GROUP_B.md` ruleset into Firebase Console Rules Editor -> verified syntax -> published.
