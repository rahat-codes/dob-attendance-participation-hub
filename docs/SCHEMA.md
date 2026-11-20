# DOB-Hub Firestore Schema & Indexing Specification

This specification documents the 12 authoritative Firestore collections used by **DOB-Hub**, matching `src/types/index.ts`, `firestore.rules`, and `firebase-blueprint.json`.

---

## 1. Collections Summary

| Collection | Document ID | Read Access | Write Access | Primary Role |
| :--- | :--- | :--- | :--- | :--- |
| `users` | Firebase Auth UID (`{uid}`) | Self or Admin | Self (restricted transitions; approval fields forbidden on create) / Admin; Super delete | Auth account status & registration state |
| `admins` | Firebase Auth UID (`{uid}`) | Admin | Super Admin only | Authoritative delegated admin role lookup |
| `members` | `mem_*` | Active Members, Admins, or `approved_waiting_response` Invitees (`approvedMemberId == memberId`) | Admin; Invitees (idempotent `authUid` claim); Active self (safe profile fields via `affectedKeys()`) | Public/member guild directory profile |
| `memberPrivate` | `mem_*` (matches `members.id`) | Owner (`isMemberOwner` if member exists; `isLinkedActiveUser` fallback if absent) or Admin | Owner (`isValidMemberPrivateCreate` / merge-safe `isValidMemberPrivateUpdate`) or Admin; Admin delete | Isolated PII (`email`, `phone`, `studentId`, academic details) |
| `sessions` | `sess_*` | Active Members or Admins | Admin only | Scheduled meetings, time windows, points, & status |
| `sessionTokens` | `sess_*` (matches `sessions.id`) | Admin only | Admin create/update/delete | Rotating 8-char QR/entry tokens with server `rotatedAt` |
| `checkIns` | `{sessionId}_{memberId}` | Owner (`memberId == myMemberId()`) or Admin | Self-create (strict token+window) or Admin manual create; immutable (`update: false`); Admin delete | Attendance confirmation records |
| `announcements` | `ann_*` | Active Members or Admins | Admin only | Broadcast feed (published/rescheduled/cancelled/general) |
| `notifications` | `notif_*` | Owner (`userId == uid`) or Admin | Admin create (`id == notificationId` & existing `users/{userId}`); Admin update (normalizes missing/mismatched `id` strictly to `notificationId`; `userId` immutable); Owner `read`/`dismissed` bool toggle (`id`/`userId` locked) or delete | User reminder notifications (30m before sessions) |
| `publicLeaderboard` | `mem_*` (matches `members.id`) | Public (`allow read: if true`) | Admin write/delete; Active member self-display update/delete (`handle` immutable) | Pre-aggregated public ranking projection (zero PII) |
| `settings` | `club`, `appMeta`, `publicMeta` | `club`: Active Members/Admins; `appMeta`: Admin only; `publicMeta`: Signed-in users | Admin only (`publicMeta` strictly 4-key whitelisted) | Organization config (`club`), admin ops (`appMeta`), public info (`publicMeta`) |
| `auditLogs` | `audit_*` | Admin only | Admin append-only (`create` with `request.time`); `update, delete: false` | Immutable admin action audit trail |

---

## 2. Detailed Collection Schemas

### `users/{userId}`
- **Required**: `id` (string `<=128`), `email` (`<=150`, immutable, bound to `token.email.lower()` on create), `displayName` (`<=100`), `status` (`'pending' | 'approved_waiting_response' | 'active' | 'declined' | 'suspended'`).
- **Optional & Bounds**: `photoURL` (`isValidPhotoUrl`: domain-valid `https://...`, `<=500`, excluding localhost/IPs/data URIs), `memberId`, `approvedMemberId`, `requestedNotes` (`<=600`), `applicantName` (`<=100`), `applicantHandle` (`<=31`), `applicantStudentId` (`<=20`), `applicantTrack` (`Hardware & Robotics | Software & Systems | AI & Embedded | Open Hack & Demo`), `applicantNote` (`<=300`), `githubUrl`, `linkedinUrl`, `portfolioUrl`, `showLinksPublicly` (bool), `readAnnouncementIds` (list `<=100`), `notificationPrefs` (map), `createdAt`, `updatedAt`, `approvedAt`, `respondedAt`, `membershipRequestedAt`. *(Note: legacy `notificationPreferences` is tolerated in Group A rules and removed before Group B cutover.)*

### `admins/{adminUid}`
- **Fields**: `email` (string), `grantedBy` (UID of Super Admin), `grantedAt` (ISO timestamp).
- **Super Admin**: Verified Google OAuth email matching `SUPER_ADMIN_EMAIL` (`rahatmdmahadihasan@gmail.com`) in `firestore.rules`.

### `members/{memberId}`
- **Required**: `id` (`isValidId`), `name` (`1..100`), `handle` (`1..50`), `role` (`'Member' | 'Project Leader' | 'Vice President' | 'President' | 'Founder' | 'Lead' | 'Builder' | 'Apprentice'`), `tracks` (`list 1..10`), `joinedDate` (`YYYY-MM-DD`), `status` (`'Active' | 'Probationary' | 'Inactive'`).
- **Optional Whitelist (16-key target in Group B)**: `avatarUrl` (`isValidAvatarUrl`: domain-valid `https://... <=500` or raster `data:image/(png|jpeg|jpg|webp|gif);base64,... <=150KB`), `bio` (`<=500`), `leaderboardOptOut` (bool), `authUid`, `createdAt`, `githubUrl`, `linkedinUrl`, `portfolioUrl`, `showLinksPublicly` (bool).
- **Security Guarantee**: Legacy PII keys (`email`, `phone`, `studentId`, `university`, `department`, `major`, `semester`) and denormalized counters are isolated to `memberPrivate/{memberId}` and removed by `prepareMemberDataRepair` / `executeMemberDataRepair`.

### `memberPrivate/{memberId}`
- **Fields (`create` strict 11-key allowlist; merge-safe `affectedKeys()` `update`)**: `email`, `phone`, `studentId`, `university`, `department`, `major`, `semester`, `profileCompleted` (bool), `profileCompletedAt` (`<=50` ISO string), `createdAt` (`<=50` ISO string), `updatedAt` (`<=50` ISO string). Legacy documents with historical unexpected keys or `Timestamp` fields remain updatable via `{ merge: true }` without data loss.

### `sessions/{sessionId}`
- **Required (`isValidSessionFull`)**: `id` (`isValidId`), `title` (`1..150`), `track` (fixed enum), `date` (`YYYY-MM-DD` in club timezone), `status` (`'scheduled' | 'completed' | 'cancelled' | 'active' | 'upcoming'`), `location` (`<=150`), `host` (`1..100`), `startAt` (Timestamp), `endAt` (Timestamp `> startAt`), `timezone` (`<=50`, default `'Asia/Seoul'`), `checkInMode` (`'auto' | 'open' | 'closed'`), `openMinutesBefore` (`int 0..240`), `graceMinutesAfter` (`int 0..240`), `lateAfterMinutes` (`int 0..240`), `points` (`int 0..1000`).
- **Optional**: `description` (`<=2000`), `startTime`, `endTime`, `sessionCode` (display-only, never authorizes check-ins), `maxCapacity` (`int 0..5000`), `createdAt`, `createdBy`, `updatedAt`, `closedAt`, `cancelledAt`, `deletedAt` (`<=50` ISO string for soft-delete hiding).

### `sessionTokens/{sessionId}`
- **Strict Keys (`hasOnly`)**: `token` (`^[A-Z0-9]{8}$`), `prevToken` (`^[A-Z0-9]{8}$`), `rotatedAt` (`request.time`).
- **Validity Window (Rules `tokenValid`)**: Current `token` valid for **75 s** from `rotatedAt`; `prevToken` valid for **30 s** grace period from `rotatedAt`.

### `checkIns/{sessionId}_{memberId}`
- **Deterministic ID**: `{sessionId}_{memberId}` guarantees max 1 check-in per member per session atomically.
- **Self Check-In (`method in ['camera_scan', 'code_input']`)**: Strict `hasAll`/`hasOnly` 9 keys (`id`, `sessionId`, `memberId`, `authUid`, `method`, `token`, `checkedInAt == request.time`, `status in ['present', 'late']`, `monthKey == YYYY-MM`). Rules forbid `notes` & `verifiedBy` and validate `sessionOpen()`, `tokenValid()`, `isMatchingMonthKey()`, and `isValidCheckInStatus()` (±15s clock skew tolerance).
- **Admin Manual Check-In (`method == 'manual_entry'`)**: Enforces `isAdmin()`, `verifiedBy == request.auth.uid`, `checkedInAt == request.time`, `exists(members/memberId)`, `exists(sessions/sessionId)`, `isMatchingMonthKey()`. Allows optional `notes`, `authUid`, `token`.
- **Immutability**: `allow update: if false`. Delete allowed by admin only with audit log.

### `announcements/{announcementId}`
- **Fields**: `id`, `type` (`'session_published' | 'session_rescheduled' | 'session_cancelled' | 'general'`), `sessionId`, `title`, `content`/`message`, `createdAt`, `createdBy`, `authorName`, `priority`.

### `notifications/{notificationId}`
- **Required**: `id` (`isValidId`), `userId` (`isValidId`), `title` (`1..150`), `message` (`1..1000`), `createdAt` (`<=50`).
- **Optional**: `type` (`'announcement' | 'reminder' | 'system' | 'meeting_published' | 'meeting_reminder_30m' | 'meeting_rescheduled' | 'meeting_cancelled'`), `read` (bool), `dismissed` (bool), `sessionId`, `sessionDate`, `sessionLocation`, `sessionTime`.

### `publicLeaderboard/{memberId}`
- **Publicly Readable Zero-PII Projection**: `id`, `name`, `displayName`, `handle`, `role`, `avatarUrl`, `avatar`, `tracks`, `totalCheckIns`, `currentStreak`, `bestStreak`, `points`, `totalPoints`, `monthlyCheckIns`, `monthlyPoints`, `monthlyScores`, `showLinksPublicly`, `lastUpdated`, optional validated `githubUrl`, `linkedinUrl`, `portfolioUrl` (included ONLY when `showLinksPublicly === true` and URL passes canonical validators). Never stores `email`, `phone`, `studentId`, `authUid`, or `university`.

### `auditLogs/{logId}`
- **Append-Only (`update, delete: false`)**:
  - **Required**: `id == logId`, `action` (`1..60`), `performedBy == request.auth.uid`, `details` (`1..1000`), `timestamp == request.time`.
  - **Optional**: `performedByEmail` (`<=150`), `targetId` (`<=128`), `targetName` (`<=150`), `metadata` (map).

---

## 3. Indexes & Query Access Patterns

All queries in `src/firebase/firestoreService.ts` use single-field equality/range filters or client-side sorting so zero composite index build failures block deployment (`firestore.indexes.json` intentionally has `indexes: []`):

- `sessions` (admin bounded listener): `where('date', '>=', minDate)` (single-field range index).
- `checkIns` (member listener): `where('memberId', '==', memberId)` (single-field index).
- `checkIns` (admin bounded listener): `where('monthKey', '>=', minMonthKey)` (single-field range index).
- `checkIns` (delete member / permanent delete session): `where('memberId', '==', memberId)` or `where('sessionId', '==', sessionId)` (single-field index).
- `notifications` (user inbox): `where('userId', '==', userId)` + `limit(100)` (single-field index).
- `notifications` (30m reminder dedupe sweep): `where('sessionId', 'in', chunkIds)` with chunk size **10** (<= 30 Firestore limit).
- `users` (pending & active filters): `where('status', '==', ...)` (single-field index).
- `members` (handle lookup): `where('handle', '==', ...)` (single-field index).
