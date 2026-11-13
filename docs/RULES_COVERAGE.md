# Firestore Rules Coverage Matrix

This matrix maps every Firestore operation emitted by `node scripts/list-firestore-ops.mjs` across `src/` to its Security Rule branch in `firestore.rules`, expected Member / Admin / Guest outcomes, and execution status.

> **Verification Notice**: Rules emulator tests in `tests/firestore-rules.test.ts` are **`(written, NOT RUN)`** because the Firestore emulator is not run in this environment. All uncovered operations are strictly labeled **`READ (rule not executed)`**.

---

## Audit Logs & Admin Authority

| Function | File | Path | Operation | Allowing Rule Branch | Member | Admin | Guest | Rules Coverage Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `createAuditLog` | `firestoreService.ts` | `auditLogs/{logId}` | `create` (`setDoc`) | `isAdmin() && isValidId(logId) && id == logId && performedBy == auth.uid && timestamp == request.time && hasAll/hasOnly` | Deny | Allow | Deny | Suite 13 (written, NOT RUN) |
| `createAuditLogInBatch` | `firestoreService.ts` | `auditLogs/{logId}` | `create (batch)` | Same as `createAuditLog` (`[Group A2]` `serverTimestamp()` + whitelist) | Deny | Allow | Deny | Suite 13 (written, NOT RUN) |
| `subscribeToAuditLogs` | `firestoreService.ts` | `auditLogs` | `list` (`onSnapshot`) | `isAdmin()` | Deny | Allow | Deny | READ (rule not executed) |
| `checkIsAdmin` | `firestoreService.ts` | `admins/{uid}` | `get` (`getDoc`) | `isAdmin()` | Deny | Allow | Deny | Suite 3 (written, NOT RUN) |
| `subscribeToAdmins` | `firestoreService.ts` | `admins` | `list` (`onSnapshot`) | `isAdmin()` | Deny | Allow | Deny | READ (rule not executed) |
| `grantAdminRole` | `firestoreService.ts` | `admins/{targetUid}` | `create/update` (`setDoc`) | `isSuper() && isValidId(adminUid)` | Deny | Super only | Deny | Suite 3 (written, NOT RUN) |
| `revokeAdminRole` | `firestoreService.ts` | `admins/{targetUid}` | `delete` (`deleteDoc`) | `isSuper() && isValidId(adminUid)` | Deny | Super only | Deny | Suite 3 (written, NOT RUN) |

## Users, Registration & Approval Pipeline

| Function | File | Path | Operation | Allowing Rule Branch | Member | Admin | Guest | Rules Coverage Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ensureUserProfile` | `firestoreService.ts` | `users/{uid}` | `get` / `create` / `update` | Read self or admin; create `uid == auth.uid && email == token.email.lower() && status == 'pending'`; update self `photoURL`/`updatedAt` | Allow (self) | Allow | Deny | Suite 11 (written, NOT RUN) |
| `subscribeToUserProfile` | `firestoreService.ts` | `users/{uid}` | `onSnapshot` | `signedIn() && (auth.uid == userId \|\| isAdmin())` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `AuthProvider.loadMemberData` | `AuthContext.tsx` | `users/{uid}` | `onSnapshot` | `signedIn() && (auth.uid == userId \|\| isAdmin())` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `subscribeToUsers` | `firestoreService.ts` | `users` | `list` (`onSnapshot`) | `isAdmin()` (collection list requires admin) | Deny | Allow | Deny | READ (rule not executed) |
| `subscribeToPendingUsers` | `firestoreService.ts` | `users` | `list` (`onSnapshot`) | `isAdmin()` | Deny | Allow | Deny | READ (rule not executed) |
| `checkRequestPipeline` | `firestoreService.ts` | `users`, `admins/{uid}`, `members`, `sessions` | `getDocs` / `getDoc` | `isAdmin()` (diagnostic verification) | Deny (users/admins) | Allow | Deny | READ (rule not executed) |
| `submitApplication` | `firestoreService.ts` | `users/{uid}` | `update` (`updateDoc`) | `auth.uid == userId && status == status && email == email && affectedKeys().hasOnly([...])` | Allow (self) | Allow | Deny | Suite 7 (written, NOT RUN) |
| `reRequestMembership` | `firestoreService.ts` | `users/{uid}` | `update` (`updateDoc`) | `auth.uid == userId && (declined \|\| (active && !isActiveMember())) && status == 'pending'` | Allow (declined/deactivated) | Allow | Deny | Suite 7, 13 (written, NOT RUN) |
| `updateUserSelfProfile` | `firestoreService.ts` | `users/{uid}` | `update` (`updateDoc`) | `auth.uid == userId && affectedKeys().hasOnly([...])` | Allow (self) | Allow | Deny | Suite 11 (written, NOT RUN) |
| `NotificationsModal.handleSavePreferences` | `NotificationsModal.tsx` | `users/{uid}` | `update` (`updateDoc`) | `auth.uid == userId && affectedKeys().hasOnly(['notificationPrefs', ...])` | Allow (self) | Allow | Deny | Suite 11 (written, NOT RUN) |
| `markAnnouncementAsRead` | `firestoreService.ts` | `users/{uid}` | `get` / `update` | `auth.uid == userId && affectedKeys().hasOnly(['readAnnouncementIds', ...])` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `markAllAnnouncementsRead` | `firestoreService.ts` | `users/{uid}` | `update` (`updateDoc`) | `auth.uid == userId && affectedKeys().hasOnly(['readAnnouncementIds', ...])` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `requestMembershipLink` | `firestoreService.ts` | `users/{userId}` | `update` (`updateDoc`) | `auth.uid == userId && affectedKeys().hasOnly([...])` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `createMemberAndApprove` | `firestoreService.ts` | `members`, `memberPrivate`, `members/{id}`, `memberPrivate/{id}`, `users/{uid}`, `auditLogs/{logId}` | `getDocs` + `writeBatch` (`set`, `update`) | `isAdmin()` across `members` create, `memberPrivate` write, `users` update, optional `members` handle archive, `auditLogs` create | Deny | Allow | Deny | Suite 8, 13 (written, NOT RUN) |
| `approveExistingMember` | `firestoreService.ts` | `users/{userId}`, `members/{memberId}`, `auditLogs/{logId}` | `getDoc` + `writeBatch` (`update`, `set`) | `isAdmin()` on `users`, `members`, `auditLogs` | Deny | Allow | Deny | READ (rule not executed) |
| `detachAndReuseMember` | `firestoreService.ts` | `users/{userId}`, `members/{memberId}`, `users/{oldAuthUid}`, `auditLogs/{logId}` | `getDoc` + `writeBatch` (`update`, `set`) | `isAdmin()` clears old `authUid`, reactivates member, stages `approvedMemberId` | Deny | Allow | Deny | READ (rule not executed) |
| `activateDirectly` | `firestoreService.ts` | `users/{userId}`, `members/{memberId}`, `auditLogs/{logId}` | `getDoc` + `writeBatch` (`update`, `set`) | `isAdmin()` sets `status: 'active'` + `memberId` and links `members.authUid` | Deny | Allow | Deny | READ (rule not executed) |
| `acceptMembershipInvitation` | `firestoreService.ts` | `users/{userId}`, `members/{memberId}` | `getDoc` + `writeBatch` (`update`) | `users`: `approved_waiting_response -> active`; `members`: `approvedMemberId == memberId && authUid == uid && affectedKeys().hasOnly(['authUid'])` | Allow (invited self) | Allow | Deny | Suite 7 (written, NOT RUN) |
| `declineMembershipInvitation` | `firestoreService.ts` | `users/{userId}` | `update` (`updateDoc`) | `auth.uid == userId && approved_waiting_response -> declined` | Allow (invited self) | Allow | Deny | Suite 7 (written, NOT RUN) |
| `declineUserRequest` | `firestoreService.ts` | `users/{userId}`, `auditLogs/{logId}` | `writeBatch` (`update`, `set`) | `isAdmin() && isValidUser(data)` | Deny | Allow | Deny | READ (rule not executed) |
| `suspendUser` | `firestoreService.ts` | `users/{userId}` | `update` (`updateDoc`) | `isAdmin() && isValidUser(data)` | Deny | Allow | Deny | READ (rule not executed) |
| `unsuspendUser` | `firestoreService.ts` | `users/{userId}` | `get` + `update` | `isAdmin() && isValidUser(data)` | Deny | Allow | Deny | READ (rule not executed) |

## Members & MemberPrivate PII

| Function | File | Path | Operation | Allowing Rule Branch | Member | Admin | Guest | Rules Coverage Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `subscribeToMembers` | `firestoreService.ts` | `members` | `list` (`onSnapshot`) | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `AuthProvider.loadMemberData` | `AuthContext.tsx` | `members/{memberId}`, `memberPrivate/{memberId}` | `onSnapshot` | `members`: `isAdmin() \|\| isActiveMember() \|\| approvedMemberId`; `memberPrivate`: `isAdmin() \|\| (isActiveMember() && member.authUid == uid)` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `getMemberPrivate` | `firestoreService.ts` | `memberPrivate/{memberId}` | `get` (`getDoc`) | `isAdmin() \|\| (isActiveMember() && member.authUid == uid)` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `addMemberToFirestore` | `firestoreService.ts` | `members`, `memberPrivate`, `members/{id}`, `memberPrivate/{id}`, `auditLogs/{logId}` | `getDocs` + `writeBatch` (`set`) | `isAdmin() && isValidId(memberId) && isValidMember(data)` | Deny | Allow | Deny | Suite 8 (written, NOT RUN) |
| `updateMemberProfile` | `firestoreService.ts` | `members/{memberId}`, `memberPrivate/{memberId}`, `publicLeaderboard/{memberId}` | `writeBatch` (`update`, `set`, `delete`) | `isAdmin() && isValidMember(data)` + `memberPrivate` + `publicLeaderboard` | Deny | Allow | Deny | Suite 8, 9 (written, NOT RUN) |
| `updateMemberInFirestore` | `firestoreService.ts` | `members/{memberId}`, `memberPrivate/{memberId}`, `publicLeaderboard/{memberId}` | Delegates to `updateMemberProfile` | `isAdmin()` | Deny | Allow | Deny | Suite 8 (written, NOT RUN) |
| `updateMemberSelfProfile` | `firestoreService.ts` | `users/{uid}`, `members/{id}`, `memberPrivate/{id}`, `publicLeaderboard/{id}` | `getDoc`/`getDocs` + `setDoc` + `writeBatch` (`update`/`delete`) + `updateDoc` | `isActiveMember() && authUid == uid && affectedKeys().hasOnly([...])`; `memberPrivate` owner write; `publicLeaderboard` owner sync; `users/{uid}` self display update | Allow (self) | Allow | Deny | Suite 8, 9 (written, NOT RUN) |
| `RoleManagementModal.handleSaveClubRole` | `RoleManagementModal.tsx` | `members/{memberId}` | `update` (`updateDoc`) | `isAdmin() && isValidMember(data)` | Deny | Allow | Deny | READ (rule not executed) |
| `deactivateMember` | `firestoreService.ts` | `members/{memberId}`, `auditLogs/{logId}` | `update` (`updateDoc`) | `isAdmin() && isValidMember(data)` | Deny | Allow | Deny | READ (rule not executed) |
| `archiveMemberHandle` | `firestoreService.ts` | `members/{memberId}`, `auditLogs/{logId}` | `get` + `update` | `isAdmin() && isValidMember(data)` | Deny | Allow | Deny | READ (rule not executed) |
| `permanentDeleteMember` | `firestoreService.ts` | `members/{id}`, `users`, `admins/{uid}`, `checkIns`, `memberPrivate/{id}`, `publicLeaderboard/{id}`, `users/{uid}`, `auditLogs/{logId}` | `getDoc`/`getDocs` + `writeBatch` (`delete`, `update`, `set`) | `isAdmin()` delete on `members`, `memberPrivate`, `publicLeaderboard`, `checkIns`, plus admin `users` update & `auditLogs` create (`serverTimestamp()`) | Deny | Allow | Deny | Suite 13 (audit part, NOT RUN) |

## Sessions & Kiosk Tokens

| Function | File | Path | Operation | Allowing Rule Branch | Member | Admin | Guest | Rules Coverage Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `subscribeToSessions` | `firestoreService.ts` | `sessions` | `list` (`onSnapshot`) | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `createSessionInFirestore` | `firestoreService.ts` | `sessions/{sessionId}`, `announcements/{id}`, `auditLogs/{logId}` | `writeBatch` (`set`) | `isAdmin() && isValidId(sessionId) && isValidSessionFull(data)` | Deny | Allow | Deny | Suite 4 (written, NOT RUN) |
| `updateSessionInFirestore` | `firestoreService.ts` | `sessions/{sessionId}`, `announcements/{id}`, `auditLogs/{logId}` | `update` (`updateDoc`) + optional `setDoc` | `isAdmin() && (isValidSessionFull(data) \|\| affectedKeys().hasOnly(['status','checkInMode','closedAt','updatedAt','cancelledAt']))` | Deny | Allow | Deny | Suite 4 (written, NOT RUN) |
| `setSessionCheckInMode` | `firestoreService.ts` | `sessions/{sessionId}`, `auditLogs/{logId}` | `update` (`updateDoc`) | `isAdmin() && affectedKeys().hasOnly(['checkInMode'])` | Deny | Allow | Deny | Suite 4 (written, NOT RUN) |
| `completeSession` | `firestoreService.ts` | `sessions/{sessionId}`, `auditLogs/{logId}` | `writeBatch` (`update`, `set`) | `sessions`: `isAdmin() && affectedKeys().hasOnly(['status','checkInMode','closedAt','updatedAt','cancelledAt'])`; `auditLogs`: `isAdmin() && timestamp == request.time` | Deny | Allow | Deny | Suite 4, 13 (written, NOT RUN) |
| `reopenSession` | `firestoreService.ts` | `sessions/{sessionId}`, `auditLogs/{logId}` | `writeBatch` (`update`, `set`) | `sessions`: `isAdmin() && affectedKeys().hasOnly([...])`; `auditLogs`: `isAdmin() && timestamp == request.time` | Deny | Allow | Deny | Suite 4, 13 (written, NOT RUN) |
| `cancelSession` | `firestoreService.ts` | `sessions/{sessionId}`, `announcements/{id}`, `auditLogs/{logId}` | `writeBatch` (`update`, `set`) | `isAdmin() && affectedKeys().hasOnly(['status','checkInMode',...])` | Deny | Allow | Deny | READ (rule not executed) |
| `deleteSession` | `firestoreService.ts` | `sessions/{sessionId}`, `auditLogs/{logId}` | `delete` (`deleteDoc`) | `isAdmin() && isValidId(sessionId)` | Deny | Allow | Deny | Suite 4 (written, NOT RUN) |
| `writeKioskToken` | `firestoreService.ts` | `sessionTokens/{sessionId}` | `create/update` (`setDoc`) | `isAdmin() && isValidId && rotatedAt == request.time && 8-char token/prevToken` | Deny | Allow | Deny | Suite 5 (written, NOT RUN) |
| `subscribeToSessionToken` | `firestoreService.ts` | `sessionTokens/{sessionId}` | `onSnapshot` | `isAdmin()` | Deny | Allow | Deny | Suite 5 (written, NOT RUN) |

## Check-Ins

| Function | File | Path | Operation | Allowing Rule Branch | Member | Admin | Guest | Rules Coverage Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `subscribeToMemberCheckIns` | `firestoreService.ts` | `checkIns` | `list` (`onSnapshot`) | `isAdmin() \|\| (isActiveMember() && resource.data.memberId == myMemberId())` | Allow (self) | Allow | Deny | Suite 1 (written, NOT RUN) |
| `subscribeToAllCheckIns` | `firestoreService.ts` | `checkIns` | `list` (`onSnapshot`) | `isAdmin()` | Deny | Allow | Deny | Suite 1 (written, NOT RUN) |
| `recordSelfCheckIn` | `firestoreService.ts` | `checkIns/{sessionId}_{memberId}` | `get` + `create` (`setDoc`) | `isActiveMember() && sessionOpen && tokenValid && monthKey && status && !('notes'/'verifiedBy')` | Allow (self) | Allow (self) | Deny | Suite 1, 2, 6, 9 (written, NOT RUN) |
| `recordAdminManualCheckIn` | `firestoreService.ts` | `checkIns/{id}`, `sessions/{id}`, `auditLogs/{logId}` | `getDoc` + `create` (`setDoc`) | `isAdmin() && method == 'manual_entry' && verifiedBy == auth.uid && checkedInAt == request.time && exists(member) && exists(session)` | Deny | Allow | Deny | Suite 6 (written, NOT RUN) |
| `recordCheckInAtomic` | `firestoreService.ts` | `checkIns/{id}`, `sessions/{id}` | `getDoc` + delegates | Dispatches to `recordAdminManualCheckIn` or `recordSelfCheckIn` | Allow (self) | Allow | Deny | Suite 1, 2, 6 (written, NOT RUN) |
| `deleteCheckInRecord` | `firestoreService.ts` | `checkIns/{checkInId}`, `auditLogs/{logId}` | `delete` (`deleteDoc`) | `isAdmin()` | Deny | Allow | Deny | READ (rule not executed) |

## Announcements, Notifications, Leaderboard & Admin Utilities

| Function | File | Path | Operation | Allowing Rule Branch | Member | Admin | Guest | Rules Coverage Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `subscribeToAnnouncements` | `firestoreService.ts` | `announcements` | `list` (`onSnapshot`) | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `subscribeToUserNotifications` | `firestoreService.ts` | `notifications` | `list` (`onSnapshot`) | `signedIn() && (resource.data.userId == auth.uid \|\| isAdmin())` | Allow (self) | Allow | Deny | Suite 9 (written, NOT RUN) |
| `markNotificationAsRead` | `firestoreService.ts` | `notifications/{id}` | `update` (`updateDoc`) | Owner `affectedKeys().hasOnly(['read','dismissed']) && read is bool` | Allow (self) | Allow | Deny | Suite 9, 12 (written, NOT RUN) |
| `markAllNotificationsAsRead` | `firestoreService.ts` | `notifications` / `notifications/{id}` | `getDocs` + `writeBatch` (`update`) | Owner `affectedKeys().hasOnly(['read','dismissed'])` | Allow (self) | Allow | Deny | Suite 9, 12 (written, NOT RUN) |
| `dismissNotification` | `firestoreService.ts` | `notifications/{id}` | `delete` (`deleteDoc`) | `signedIn() && (resource.data.userId == auth.uid \|\| isAdmin())` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `checkAndSend30MinuteReminders` | `firestoreService.ts` | `sessions`, `users`, `notifications/{id}` | `getDocs`, `getDoc`, `setDoc` | `isAdmin() && isValidNotification(data)` (admin sweep reads sessions/users and writes notifications) | Deny | Allow | Deny | Suite 9 (written, NOT RUN) |
| `subscribeToPublicLeaderboard` | `firestoreService.ts` | `publicLeaderboard` | `list` (`onSnapshot`) | `allow read: if true;` (Public) | Allow | Allow | Allow | READ (rule not executed) |
| `syncMemberCheckInToPublicLeaderboard` | `firestoreService.ts` | `members/{id}`, `publicLeaderboard/{id}` | `getDoc`, `setDoc`/`updateDoc`/`deleteDoc` | `isAdmin()` OR active member self delete / display-only update | Allow (self sync) | Allow | Deny | READ (rule not executed) |
| `removeFromPublicLeaderboard` | `firestoreService.ts` | `publicLeaderboard/{id}` | `delete` (`deleteDoc`) | `isAdmin() \|\| (isActiveMember() && memberId == myMemberId())` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `backfillPublicLeaderboard` | `firestoreService.ts` | `members`, `sessions`, `checkIns`, `publicLeaderboard`, `publicLeaderboard/{id}` | `getDocs` + `writeBatch` (`set`) | `isAdmin()` | Deny | Allow | Deny | READ (rule not executed) |
| `recomputeAndSaveLeaderboard` | `firestoreService.ts` | `publicLeaderboard/{id}`, `auditLogs/{logId}` | `writeBatch` (`set`) | `isAdmin() && isValidId(memberId)` | Deny | Allow | Deny | READ (rule not executed) |
| `getClubSettings` | `firestoreService.ts` | `settings/club` | `get` (`getDoc`) | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `saveClubSettings` | `firestoreService.ts` | `settings/club`, `auditLogs/{logId}` | `write` (`setDoc`) | `isAdmin() && isValidId(settingId)` | Deny | Allow | Deny | READ (rule not executed) |
| `exportFullBackupJSON` | `firestoreService.ts` | `{colName}` (all except `sessionTokens`), `auditLogs/{logId}` | `getDocs` (`collection`) | `isSuper()` enforces verified super-admin in client + `isAdmin()` reads in rules | Deny | Allow (Super) | Deny | READ (rule not executed) |
| `setupSuperAdminInitialRoster` | `firestoreService.ts` | `settings/club`, `members/{id}`, `users/{uid}`, `admins/{uid}`, `auditLogs/{logId}` | `writeBatch` (`set`) | `isSuper()` (super admin creates initial `admins/{uid}` + `settings` + `members` + `users`) | Deny | Super only | Deny | Suite 3 (written, NOT RUN) |
| `executeMemberDataRepair` | `firestoreService.ts` | `members/{id}`, `memberPrivate/{id}`, `auditLogs/{logId}` | `writeBatch` (`set`) | `isAdmin() && isValidMember(data)` | Deny | Allow | Deny | READ (rule not executed) |
| `executeUserStateRepair` | `firestoreService.ts` | `users/{uid}`, `auditLogs/{logId}` | `writeBatch` (`update`) | `isAdmin() && isValidUser(data)` | Deny | Allow | Deny | READ (rule not executed) |
| `testConnection` | `config.ts` | `test/connection` | `getDocFromServer` | Catch-all `allow read, write: if false;` (expected deny; detects offline vs reachable) | Deny | Deny | Deny | READ (rule not executed) |
