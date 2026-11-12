# Firestore Rules Release Groups & Migration Sequencing

This document defines the production release staging for Firestore Security Rules in DOB-Hub. Staging into Groups **A1**, **A2**, and **B** guarantees zero downtime, backward compatibility with existing production documents, and prevention of client breakage.

---

## 1. Group Definitions & Release Order

```
┌─────────────────────────────────────────────────────────────┐
│ Group A1: Additive & Safe Pre-Client Rules                  │
│ • Can be deployed BEFORE any client updates                 │
│ • Backward compatible with all existing production data     │
│ • Non-breaking security fixes and validators                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Group A2: Client-Coupled Rules (Synchronized Release)       │
│ • Deployed TOGETHER with updated client code                │
│ • Requires new client shapes (8-char prevToken, authUid)   │
│ • Breaks older un-updated client versions                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ [Data Migration]: Admin Repair Tool (Idempotent Dry Run)    │
│ • Strips legacy PII from members into memberPrivate         │
│ • Reconciles orphan counters and verifies clean documents   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Group B: Strict Post-Migration Rules (Locked Whitelists)     │
│ • Deployed ONLY AFTER data migration completes              │
│ • Strict key whitelists (no legacy fields allowed)          │
│ • Located in `docs/RULES_GROUP_B.md`                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Group Details

### Group A1: Additive & Safe Before Client Updates
These rules enhance security without requiring immediate client changes or data migrations:
1. **Users Schema Limits**: Size bounds on `applicantName` (<= 100), `applicantHandle` (<= 31), `applicantStudentId` (<= 20), `applicantTrack` (<= 60), `applicantNote` (<= 300), `requestedNotes` (<= 600), `readAnnouncementIds` (<= 100), and boolean validation on `showLinksPublicly`.
2. **Email Immutability & Binding**: `users.email` is bound to `request.auth.token.email.lower()` on creation and is strictly immutable (`request.resource.data.email == resource.data.email`) on all updates.
3. **Dual Notification Preference Compatibility**: `isValidUser` permits both `notificationPrefs` and `notificationPreferences` maps to accommodate legacy and new profile formats.
4. **Member Size & Type Bounds**: Bounds `member.bio` (<= 500), `tracks` (<= 10), and validates `leaderboardOptOut` and `showLinksPublicly` as booleans while permitting legacy fields (`email`, `phone`, `counters`) so admin edits to existing members are not denied.
5. **Session Split & Legacy-Tolerant Updates**:
   - `isValidSessionFull` enforces full schema for new session creation.
   - `sessions/{sessionId}` update rule allows a legacy-tolerant branch (`affectedKeys().hasOnly(['status', 'checkInMode', 'closedAt', 'updatedAt', 'cancelledAt'])`), permitting admins to cancel, close, reopen, or mark completed legacy sessions before data migration.
6. **Notification Owner Update Tolerance**: Owner update rule requires only `affectedKeys().hasOnly(['read', 'dismissed'])` with boolean checks and `userId` immutability, allowing legacy notifications to be marked read without failing strict schema validation.
7. **Date-Bound `monthKey`**: CEL comparison using `date.split('-')[0] + '-' + date.split('-')[1]` ensures monthKey strictly matches session date.
8. **Rejection of Completed Sessions**: `sessionOpen` check explicitly denies check-in writes to sessions marked `'completed'`.

### Group A2: Client-Coupled Rules (Synchronized Release)
These rules require matching client implementations and must be deployed together with the new web client:
1. **8-Character Session PrevToken**: `sessionTokens` create/update requires `prevToken is string && prevToken.matches('^[A-Z0-9]{8}$')`. Old kiosks that write `prevToken: ''` or omit `prevToken` will be denied.
2. **Check-In Field Allowlist on Self Check-In**: Member self check-in strictly forbids `notes` and `verifiedBy`.
3. **Manual Check-In Shape**: Admin manual door check-in enforces `verifiedBy: request.auth.uid` as authoritative and no longer requires `authUid`.
4. **Strict Notification Whitelist on Creation**: `isValidNotification` enforces exact key whitelist (`keys().hasOnly([...])`).

### Group B: Strict Post-Migration Rules
Stored in `docs/RULES_GROUP_B.md`. Must NOT be deployed until `prepareMemberDataRepair` dry-run and migration have executed:
1. **Strict Member Key Whitelist**: `data.keys().hasOnly(['id', 'name', 'handle', 'role', 'tracks', 'joinedDate', 'status', 'authUid', 'avatarUrl', 'bio', 'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly', 'leaderboardOptOut', 'readAnnouncementIds'])`. Legacy PII (`email`, `phone`, `department`, `major`, `counters`) is completely forbidden on member documents.
2. **Strict User Key Whitelist**: Requires single canonical `notificationPrefs` key and forbids legacy `notificationPreferences`.
3. **Mandatory Full Session Schema**: Forbids legacy session updates that lack `startAt`/`endAt` timestamps.

---

## 3. Checklist for Operators
- [ ] Deploy Group A1 + A2 rules (`firestore.rules`) together with client build.
- [ ] Run member data repair dry-run via Admin Tools (`prepareMemberDataRepair(false)`).
- [ ] Inspect dry-run results to confirm all legacy member documents and PII are accounted for.
- [ ] Execute member data repair commit via Admin Tools (`prepareMemberDataRepair(true)`).
- [ ] Verify zero legacy keys remain in `members` collection.
- [ ] Deploy Group B rules from `docs/RULES_GROUP_B.md` to lock down schema permanently.
