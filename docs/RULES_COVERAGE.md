# Firestore Rules Coverage Matrix

This matrix maps every Firestore operation in `src/` to its corresponding Security Rule branch in `firestore.rules` and states its current operational status.

---

## 1. Matrix Overview

| Function | File | Path | Operation | Allowing Rule Branch | Passes Today? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `fetchUserProfile` | `firestoreService.ts` | `users/{userId}` | `get` | `signedIn() && (uid == userId \|\| isAdmin())` | **PASS** |
| `subscribeToUserProfile` | `firestoreService.ts` | `users/{userId}` | `onSnapshot` | `signedIn() && (uid == userId \|\| isAdmin())` | **PASS** |
| `createUserProfile` | `firestoreService.ts` | `users/{userId}` | `create` | `signedIn() && request.auth.uid == userId && email == token.email && isValidUser` | **PASS** |
| `updateUserProfile` | `firestoreService.ts` | `users/{userId}` | `update` | `signedIn() && uid == userId && email == email && affectedKeys().hasOnly([...])` | **PASS** |
| `respondToApproval` (accept) | `firestoreService.ts` | `users/{userId}` | `update` | `uid == userId && status == 'approved_waiting_response' -> 'active'` | **PASS** |
| `respondToApproval` (decline) | `firestoreService.ts` | `users/{userId}` | `update` | `uid == userId && status == 'approved_waiting_response' -> 'declined'` | **PASS** |
| `reapplyAfterDecline` | `firestoreService.ts` | `users/{userId}` | `update` | `uid == userId && status == 'declined' -> 'pending'` | **PASS** |
| `adminUpdateUser` | `firestoreService.ts` | `users/{userId}` | `update` | `isAdmin() && isValidUser(request.resource.data)` | **PASS** |
| `deleteUserAccount` | `firestoreService.ts` | `users/{userId}` | `delete` | `isSuper()` | **PASS** |
| `checkAdminStatus` | `firestoreService.ts` | `admins/{adminUid}` | `get` | `isAdmin()` | **PASS** |
| `subscribeToAdmins` | `firestoreService.ts` | `admins` | `list` | `isAdmin()` | **PASS** |
| `grantAdminRole` | `firestoreService.ts` | `admins/{adminUid}` | `create` | `isSuper() && isValidId(adminUid)` | **PASS** |
| `revokeAdminRole` | `firestoreService.ts` | `admins/{adminUid}` | `delete` | `isSuper() && isValidId(adminUid)` | **PASS** |
| `fetchMembers` | `firestoreService.ts` | `members` | `list` | `isAdmin() \|\| isActiveMember()` | **PASS** |
| `subscribeToMembers` | `firestoreService.ts` | `members` | `list (onSnapshot)` | `isAdmin() \|\| isActiveMember()` | **PASS** |
| `addMemberToFirestore` | `firestoreService.ts` | `members/{memberId}` | `create` | `isAdmin() && isValidMember(data)` | **PASS** |
| `createMemberAndApprove` | `firestoreService.ts` | `members/{memberId}` | `create (batch)` | `isAdmin() && isValidMember(data)` | **PASS** |
| `updateMemberInFirestore` | `firestoreService.ts` | `members/{memberId}` | `update` | `isAdmin() && isValidMember(data)` (Group A legacy-tolerant) | **PASS** |
| `updateMemberSelfProfile` | `firestoreService.ts` | `members/{memberId}` | `update (batch)` | `isActiveMember() && authUid == uid && affectedKeys().hasOnly([...])` | **PASS** |
| `deleteMemberFromFirestore` | `firestoreService.ts` | `members/{memberId}` | `delete` | `isAdmin() && isValidId(memberId)` | **PASS** |
| `fetchMemberPrivate` | `firestoreService.ts` | `memberPrivate/{memberId}` | `get` | `isAdmin() \|\| (isActiveMember() && member.authUid == uid)` | **PASS** |
| `saveMemberPrivate` | `firestoreService.ts` | `memberPrivate/{memberId}` | `write` | `isAdmin() \|\| (isActiveMember() && member.authUid == uid)` | **PASS** |
| `fetchSessions` | `firestoreService.ts` | `sessions` | `list` | `isAdmin() \|\| isActiveMember()` | **PASS** |
| `subscribeToSessions` | `firestoreService.ts` | `sessions` | `list (onSnapshot)` | `isAdmin() \|\| isActiveMember()` | **PASS** |
| `createSessionInFirestore` | `firestoreService.ts` | `sessions/{sessionId}` | `create` | `isAdmin() && isValidSessionFull(data)` | **PASS** |
| `updateSessionInFirestore` | `firestoreService.ts` | `sessions/{sessionId}` | `update` | `isAdmin() && (isValidSessionFull(data) \|\| legacyAffectedKeys)` | **PASS** |
| `completeSession` | `firestoreService.ts` | `sessions/{sessionId}` | `update` | `isAdmin() && affectedKeys().hasOnly(['status','checkInMode'])` | **PASS** |
| `reopenSession` | `firestoreService.ts` | `sessions/{sessionId}` | `update` | `isAdmin() && affectedKeys().hasOnly(['status','checkInMode'])` | **PASS** |
| `cancelSession` | `firestoreService.ts` | `sessions/{sessionId}` | `update (batch)` | `isAdmin() && affectedKeys().hasOnly(['status','checkInMode'])` | **PASS** |
| `deleteSessionFromFirestore` | `firestoreService.ts` | `sessions/{sessionId}` | `delete` | `isAdmin() && isValidId(sessionId)` | **PASS** |
| `subscribeToSessionToken` | `firestoreService.ts` | `sessionTokens/{sessionId}` | `onSnapshot` | `isAdmin()` | **PASS** |
| `updateSessionToken` (kiosk) | `firestoreService.ts` | `sessionTokens/{sessionId}` | `create/update` | `isAdmin() && rotatedAt == request.time && token/prevToken 8 chars` | **PASS** |
| `recordCheckIn` (member) | `firestoreService.ts` | `checkIns/{checkInId}` | `create` | `isActiveMember() && tokenValid && sessionOpen && monthKey && strict keys` | **PASS** |
| `recordAdminManualCheckIn` | `firestoreService.ts` | `checkIns/{checkInId}` | `create` | `isAdmin() && method == 'manual_entry' && verifiedBy == auth.uid` | **PASS** |
| `fetchMemberCheckIns` | `firestoreService.ts` | `checkIns` | `list / get` | `isAdmin() \|\| (isActiveMember() && memberId == myMemberId())` | **PASS** |
| `deleteCheckInFromFirestore` | `firestoreService.ts` | `checkIns/{checkInId}` | `delete` | `isAdmin()` | **PASS** |
| `subscribeToAnnouncements` | `firestoreService.ts` | `announcements` | `list` | `isAdmin() \|\| isActiveMember()` | **PASS** |
| `createAnnouncement` | `firestoreService.ts` | `announcements/{annId}` | `create` | `isAdmin() && isValidId(annId)` | **PASS** |
| `deleteAnnouncement` | `firestoreService.ts` | `announcements/{annId}` | `delete` | `isAdmin() && isValidId(annId)` | **PASS** |
| `subscribeToNotifications` | `firestoreService.ts` | `notifications` | `list` | `signedIn() && resource.userId == auth.uid` | **PASS** |
| `createNotification` | `firestoreService.ts` | `notifications/{id}` | `create` | `isAdmin() \|\| (signedIn() && userId == auth.uid)` | **PASS** |
| `markNotificationAsRead` | `firestoreService.ts` | `notifications/{id}` | `update` | `owner && affectedKeys().hasOnly(['read','dismissed'])` | **PASS** |
| `dismissNotification` | `firestoreService.ts` | `notifications/{id}` | `update` | `owner && affectedKeys().hasOnly(['read','dismissed'])` | **PASS** |
| `deleteNotification` | `firestoreService.ts` | `notifications/{id}` | `delete` | `signedIn() && resource.userId == auth.uid` | **PASS** |
| `subscribeToPublicLeaderboard`| `firestoreService.ts` | `publicLeaderboard` | `list` | `allow read: if true` (Public) | **PASS** |
| `updatePublicLeaderboard` (member sync) | `firestoreService.ts` | `publicLeaderboard/{id}` | `update (batch)` | `isActiveMember() && id == myMemberId() && affectedKeys().hasOnly([...])` | **PASS** |
| `getClubSettings` | `firestoreService.ts` | `settings/{id}` | `get` | `isAdmin() \|\| isActiveMember()` | **PASS** |
| `updateClubSettings` | `firestoreService.ts` | `settings/{id}` | `write` | `isAdmin() && isValidId(id)` | **PASS** |
| `createAuditLog` | `firestoreService.ts` | `auditLogs/{id}` | `create` | `isAdmin() && performedBy == auth.uid` | **PASS** |
| `subscribeToAuditLogs` | `firestoreService.ts` | `auditLogs` | `list` | `isAdmin()` | **PASS** |
