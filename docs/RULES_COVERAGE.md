# Firestore Rules Coverage Matrix

This matrix maps every Firestore operation in `src/` to its corresponding Security Rule branch in `firestore.rules`, states the expected authorization result for Member / Admin / Guest, and marks execution coverage.

> **Verification Notice**: Any row with rules test coverage in `tests/firestore-rules.test.ts` is explicitly labeled with its suite number and noted as `(written, NOT RUN)` since emulator tests are prepared but not executed in this environment. All other rows are strictly labeled **`READ (rule not executed)`**.

---

| Function | File | Path | Operation | Allowing Rule Branch | Member | Admin | Guest | Rules Coverage Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `fetchUserProfile` | `firestoreService.ts` | `users/{userId}` | `get` | `signedIn() && (uid == userId \|\| isAdmin())` | Allow (self) | Allow | Deny | Suite 11 (written, NOT RUN) |
| `subscribeToUserProfile` | `firestoreService.ts` | `users/{userId}` | `onSnapshot` | `signedIn() && (uid == userId \|\| isAdmin())` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `createUserProfile` | `firestoreService.ts` | `users/{userId}` | `create` | `signedIn() && uid == userId && email == token.email && isValidUser` | Allow (self) | Allow | Deny | Suite 11 (written, NOT RUN) |
| `updateUserProfile` | `firestoreService.ts` | `users/{userId}` | `update` | `signedIn() && uid == userId && email == email && affectedKeys().hasOnly([...])` | Allow (self) | Allow | Deny | Suite 11 (written, NOT RUN) |
| `respondToApproval` (accept) | `firestoreService.ts` | `users/{userId}` | `update` | `uid == userId && status == 'approved_waiting_response' -> 'active'` | Allow (self) | Allow | Deny | Suite 7 (written, NOT RUN) |
| `respondToApproval` (decline) | `firestoreService.ts` | `users/{userId}` | `update` | `uid == userId && status == 'approved_waiting_response' -> 'declined'` | Allow (self) | Allow | Deny | Suite 7 (written, NOT RUN) |
| `reapplyAfterDecline` | `firestoreService.ts` | `users/{userId}` | `update` | `uid == userId && status == 'declined' -> 'pending'` | Allow (self) | Allow | Deny | Suite 7 (written, NOT RUN) |
| `adminUpdateUser` | `firestoreService.ts` | `users/{userId}` | `update` | `isAdmin() && isValidUser(data) && email == email` | Deny | Allow | Deny | Suite 11 (written, NOT RUN) |
| `deleteUserAccount` | `firestoreService.ts` | `users/{userId}` | `delete` | `isSuper()` | Deny | Super only | Deny | Suite 3 (written, NOT RUN) |
| `checkAdminStatus` | `firestoreService.ts` | `admins/{adminUid}` | `get` | `isAdmin()` | Deny | Allow | Deny | Suite 3 (written, NOT RUN) |
| `subscribeToAdmins` | `firestoreService.ts` | `admins` | `list` | `isAdmin()` | Deny | Allow | Deny | READ (rule not executed) |
| `grantAdminRole` | `firestoreService.ts` | `admins/{adminUid}` | `create` | `isSuper() && isValidId(adminUid)` | Deny | Super only | Deny | Suite 3 (written, NOT RUN) |
| `revokeAdminRole` | `firestoreService.ts` | `admins/{adminUid}` | `delete` | `isSuper() && isValidId(adminUid)` | Deny | Super only | Deny | Suite 3 (written, NOT RUN) |
| `fetchMembers` | `firestoreService.ts` | `members` | `list` | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `subscribeToMembers` | `firestoreService.ts` | `members` | `list` | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `addMemberToFirestore` | `firestoreService.ts` | `members/{memberId}` | `create` | `isAdmin() && isValidMember(data)` | Deny | Allow | Deny | Suite 8 (written, NOT RUN) |
| `createMemberAndApprove` | `firestoreService.ts` | `members/{memberId}` | `create (batch)` | `isAdmin() && isValidMember(data)` | Deny | Allow | Deny | Suite 8 (written, NOT RUN) |
| `updateMemberInFirestore` | `firestoreService.ts` | `members/{memberId}` | `update` | `isAdmin() && isValidMember(data)` | Deny | Allow | Deny | Suite 8 (written, NOT RUN) |
| `updateMemberSelfProfile` | `firestoreService.ts` | `members/{memberId}` | `update (batch)` | `isActiveMember() && authUid == uid && affectedKeys().hasOnly([...])` | Allow (self) | Allow | Deny | Suite 8 (written, NOT RUN) |
| `deleteMemberFromFirestore` | `firestoreService.ts` | `members/{memberId}` | `delete` | `isAdmin() && isValidId(memberId)` | Deny | Allow | Deny | READ (rule not executed) |
| `fetchMemberPrivate` | `firestoreService.ts` | `memberPrivate/{memberId}` | `get` | `isAdmin() \|\| (isActiveMember() && member.authUid == uid)` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `saveMemberPrivate` | `firestoreService.ts` | `memberPrivate/{memberId}` | `write` | `isAdmin() \|\| (isActiveMember() && member.authUid == uid)` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `fetchSessions` | `firestoreService.ts` | `sessions` | `list` | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `subscribeToSessions` | `firestoreService.ts` | `sessions` | `list` | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `createSessionInFirestore` | `firestoreService.ts` | `sessions/{sessionId}` | `create` | `isAdmin() && isValidSessionFull(data)` | Deny | Allow | Deny | Suite 4 (written, NOT RUN) |
| `updateSessionInFirestore` | `firestoreService.ts` | `sessions/{sessionId}` | `update` | `isAdmin() && (isValidSessionFull(data) \|\| affectedKeys)` | Deny | Allow | Deny | Suite 4 (written, NOT RUN) |
| `completeSession` | `firestoreService.ts` | `sessions/{sessionId}` | `update (batch)` | `isAdmin() && affectedKeys().hasOnly(['status','checkInMode',...])` | Deny | Allow | Deny | Suite 4 (written, NOT RUN) |
| `reopenSession` | `firestoreService.ts` | `sessions/{sessionId}` | `update (batch)` | `isAdmin() && affectedKeys().hasOnly(['status','checkInMode',...])` | Deny | Allow | Deny | Suite 4 (written, NOT RUN) |
| `cancelSession` | `firestoreService.ts` | `sessions/{sessionId}` | `update (batch)` | `isAdmin() && affectedKeys().hasOnly(['status','checkInMode',...])` | Deny | Allow | Deny | READ (rule not executed) |
| `deleteSessionFromFirestore` | `firestoreService.ts` | `sessions/{sessionId}` | `delete` | `isAdmin() && isValidId(sessionId)` | Deny | Allow | Deny | Suite 4 (written, NOT RUN) |
| `subscribeToSessionToken` | `firestoreService.ts` | `sessionTokens/{sessionId}` | `onSnapshot` | `isAdmin()` | Deny | Allow | Deny | Suite 5 (written, NOT RUN) |
| `updateSessionToken` | `firestoreService.ts` | `sessionTokens/{sessionId}` | `create/update` | `isAdmin() && rotatedAt == request.time && token/prevToken 8 chars` | Deny | Allow | Deny | Suite 5 (written, NOT RUN) |
| `recordCheckIn` | `firestoreService.ts` | `checkIns/{checkInId}` | `create` | `isActiveMember() && tokenValid && sessionOpen && monthKey && status` | Allow (self) | Allow (self) | Deny | Suite 1, 2, 6 (written, NOT RUN) |
| `recordAdminManualCheckIn` | `firestoreService.ts` | `checkIns/{checkInId}` | `create` | `isAdmin() && method == 'manual_entry' && verifiedBy == auth.uid` | Deny | Allow | Deny | Suite 6 (written, NOT RUN) |
| `fetchMemberCheckIns` | `firestoreService.ts` | `checkIns` | `list / get` | `isAdmin() \|\| (isActiveMember() && memberId == myMemberId())` | Allow (self) | Allow | Deny | Suite 1 (written, NOT RUN) |
| `deleteCheckInFromFirestore` | `firestoreService.ts` | `checkIns/{checkInId}` | `delete` | `isAdmin()` | Deny | Allow | Deny | READ (rule not executed) |
| `subscribeToAnnouncements` | `firestoreService.ts` | `announcements` | `list` | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `createAnnouncement` | `firestoreService.ts` | `announcements/{id}` | `create` | `isAdmin() && isValidId(id)` | Deny | Allow | Deny | READ (rule not executed) |
| `deleteAnnouncement` | `firestoreService.ts` | `announcements/{id}` | `delete` | `isAdmin() && isValidId(id)` | Deny | Allow | Deny | READ (rule not executed) |
| `subscribeToNotifications` | `firestoreService.ts` | `notifications` | `list` | `signedIn() && resource.userId == auth.uid` | Allow (self) | Allow (self) | Deny | Suite 10 (written, NOT RUN) |
| `createNotification` | `firestoreService.ts` | `notifications/{id}` | `create` | `isAdmin() \|\| (signedIn() && userId == auth.uid)` | Allow (self) | Allow (any) | Deny | Suite 10 (written, NOT RUN) |
| `markNotificationAsRead` | `firestoreService.ts` | `notifications/{id}` | `update` | `owner && affectedKeys().hasOnly(['read','dismissed'])` | Allow (self) | Allow | Deny | Suite 10, 12 (written, NOT RUN) |
| `dismissNotification` | `firestoreService.ts` | `notifications/{id}` | `update` | `owner && affectedKeys().hasOnly(['read','dismissed'])` | Allow (self) | Allow | Deny | Suite 10, 12 (written, NOT RUN) |
| `deleteNotification` | `firestoreService.ts` | `notifications/{id}` | `delete` | `signedIn() && resource.userId == auth.uid` | Allow (self) | Allow | Deny | READ (rule not executed) |
| `subscribeToPublicLeaderboard` | `firestoreService.ts` | `publicLeaderboard` | `list` | `allow read: if true;` (Public) | Allow | Allow | Allow | READ (rule not executed) |
| `updatePublicLeaderboard` | `firestoreService.ts` | `publicLeaderboard/{id}` | `update (batch)` | `isAdmin() \|\| (isActiveMember() && id == myMemberId() && affectedKeys)` | Allow (self) | Allow | Deny | Suite 9 (written, NOT RUN) |
| `getClubSettings` | `firestoreService.ts` | `settings/{id}` | `get` | `isAdmin() \|\| isActiveMember()` | Allow | Allow | Deny | READ (rule not executed) |
| `updateClubSettings` | `firestoreService.ts` | `settings/{id}` | `write` | `isAdmin() && isValidId(id)` | Deny | Allow | Deny | READ (rule not executed) |
| `createAuditLog` | `firestoreService.ts` | `auditLogs/{id}` | `create` | `isAdmin() && performedBy == auth.uid` | Deny | Allow | Deny | Suite 1 (written, NOT RUN) |
| `subscribeToAuditLogs` | `firestoreService.ts` | `auditLogs` | `list` | `isAdmin()` | Deny | Allow | Deny | READ (rule not executed) |
