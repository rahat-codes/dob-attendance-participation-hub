# Firestore Security Rules Registration & Profile Links Proposal

> **Safety Notice:** Do NOT deploy these rules automatically. Group A and Group B must be deployed in strictly sequential phases as documented below.

---

## 1. Release Order & Strategy

1. **Phase 1 (Pre-Deployment)**: Review and approve **Group A** rules.
2. **Phase 2 (Database Preparation)**: Deploy **Group A** rules to Firestore (`rpc_action DeployRules`).
3. **Phase 3 (Client Release)**: Publish and deploy the new frontend client.
4. **Phase 4 (Data Sanitization & Repair)**: Admin triggers the dry-run repair tools (`prepareMemberDataRepair` and `prepareUserStateRepair`), verifies preview diffs, and commits repairs.
5. **Phase 5 (Hardening & Tightening)**: Deploy **Group B** rules.
6. **Phase 6 (Live Smoke Verification)**: Execute live test flow with throwaway accounts.

---

## 2. Group A: Additive Rules (Deploy BEFORE Client)

Allows additive application and social link fields without breaking documents created under earlier schemas:
- In `isValidUser`: add `'applicantName'`, `'applicantHandle'`, `'applicantStudentId'`, `'applicantTrack'`, `'applicantNote'`, `'githubUrl'`, `'linkedinUrl'`, `'portfolioUrl'`, `'showLinksPublicly'` to allowed keys.
- In `users` applicant owner-update and `declined -> pending` paths: permit the new application keys in `affectedKeys()`.
- In `members` active self-update: permit `'githubUrl'`, `'linkedinUrl'`, `'portfolioUrl'`, `'showLinksPublicly'` in `affectedKeys()`.
- In `publicLeaderboard` active self-update: permit `'githubUrl'`, `'linkedinUrl'`, `'portfolioUrl'`, `'showLinksPublicly'` in `affectedKeys()`.

```diff
--- firestore.rules (Current Live)
+++ firestore.rules (Group A Additive)
@@ -71,7 +71,7 @@
     function isValidUser(data) {
       return data.keys().hasAll(['id', 'email', 'displayName', 'status']) &&
-             data.keys().hasOnly(['id', 'email', 'displayName', 'photoURL', 'status', 'memberId', 'approvedMemberId', 'requestedNotes', 'readAnnouncementIds', 'notificationPrefs', 'createdAt', 'updatedAt', 'approvedAt', 'respondedAt', 'membershipRequestedAt']) &&
+             data.keys().hasOnly(['id', 'email', 'displayName', 'photoURL', 'status', 'memberId', 'approvedMemberId', 'requestedNotes', 'readAnnouncementIds', 'notificationPrefs', 'createdAt', 'updatedAt', 'approvedAt', 'respondedAt', 'membershipRequestedAt', 'applicantName', 'applicantHandle', 'applicantStudentId', 'applicantTrack', 'applicantNote', 'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly']) &&
              data.id is string && data.id.size() <= 128 &&
              data.email is string && data.email.size() <= 150 &&
              data.displayName is string && data.displayName.size() <= 100 &&
@@ -121,7 +121,7 @@
               request.resource.data.status == resource.data.status &&
               request.resource.data.diff(resource.data).affectedKeys().hasOnly([
-                'displayName', 'photoURL', 'requestedNotes', 'membershipRequestedAt', 'notificationPrefs', 'readAnnouncementIds', 'updatedAt'
+                'displayName', 'photoURL', 'requestedNotes', 'membershipRequestedAt', 'notificationPrefs', 'readAnnouncementIds', 'updatedAt', 'applicantName', 'applicantHandle', 'applicantStudentId', 'applicantTrack', 'applicantNote', 'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly'
               ])
             ) ||
             // Applicant accepting an approved invitation
@@ -147,7 +147,7 @@
               resource.data.status == 'declined' &&
               request.resource.data.status == 'pending' &&
               request.resource.data.diff(resource.data).affectedKeys().hasOnly([
-                'status', 'requestedNotes', 'membershipRequestedAt', 'updatedAt'
+                'status', 'requestedNotes', 'membershipRequestedAt', 'updatedAt', 'applicantName', 'applicantHandle', 'applicantStudentId', 'applicantTrack', 'applicantNote', 'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly'
               ])
             )
           )
@@ -190,7 +190,7 @@
         request.resource.data.status == resource.data.status &&
         request.resource.data.diff(resource.data).affectedKeys().hasOnly([
-          'name', 'avatarUrl', 'bio', 'tracks', 'leaderboardOptOut', 'studentId', 'university'
+          'name', 'avatarUrl', 'bio', 'tracks', 'leaderboardOptOut', 'studentId', 'university', 'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly'
         ])
       );
     }
@@ -279,7 +279,7 @@
         memberId == myMemberId() &&
         request.resource.data.diff(resource.data).affectedKeys().hasOnly([
-          'displayName', 'name', 'avatar', 'avatarUrl', 'handle', 'lastUpdated'
+          'displayName', 'name', 'avatar', 'avatarUrl', 'handle', 'lastUpdated', 'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly'
         ])
       );
     }
```

---

## 3. Group B: Tightening & Hardening Rules (Deploy AFTER Client & Data Repairs)

- Restore `request.auth.token.email_verified == true` in `isSuper()`.
- Enforce token email immutability on `users` creation: `request.resource.data.email == request.auth.token.email.lower()`.
- Make `createdAt` strictly immutable on `users` updates: `request.resource.data.createdAt == resource.data.createdAt`.
- Limit `photoURL` to empty or HTTPS URL with length <= 500: `!('photoURL' in data) || data.photoURL == '' || (data.photoURL.size() <= 500 && data.photoURL.matches('^https://.+'))`.
- Restrict `members/{memberId}` read access for staged applicants strictly to users whose status is currently `'approved_waiting_response'` (closing R12).

```diff
--- firestore.rules (Group A)
+++ firestore.rules (Group B Hardened)
@@ -21,6 +21,7 @@
     function isSuper() {
       return signedIn() &&
+             request.auth.token.email_verified == true &&
              request.auth.token.email.lower() == 'rahatmdmahadihasan@gmail.com';
     }
@@ -107,6 +108,7 @@
                        request.auth.uid == userId &&
                        request.resource.data.id == userId &&
+                       request.resource.data.email == request.auth.token.email.lower() &&
                        request.resource.data.status == 'pending' &&
                        !('memberId' in request.resource.data) &&
                        isValidUser(request.resource.data);
@@ -118,6 +120,7 @@
             // Normal profile update without changing status or memberId
             (
+              request.resource.data.createdAt == resource.data.createdAt &&
               request.resource.data.status == resource.data.status &&
               request.resource.data.diff(resource.data).affectedKeys().hasOnly([
@@ -168,7 +171,8 @@
         signedIn() &&
         exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
-        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.approvedMemberId == memberId
+        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.status == 'approved_waiting_response' &&
+        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.approvedMemberId == memberId
       );
```

---

## 4. Comprehensive Security Rules Tests Specification

*Status: **NOT RUN** (Local Firestore Emulator requires Java environment). Run locally with: `npm run test:rules`.*

### Test Suite Structure (`tests/firestore-rules.test.ts`):
1. **Applicant Creation**:
   - `[ALLOW]` Fresh sign-in creates `users/{uid}` with `status: 'pending'`, matching token email and no `memberId`.
   - `[DENY]` Applicant attempting to inject `memberId` or `status: 'active'` on create.
   - `[DENY]` Email mismatch (Group B: token email `alice@gmail.com` trying to register `bob@gmail.com`).
2. **Application Submission & Format Constraints**:
   - `[ALLOW]` Applicant updates `users/{uid}` with valid GitHub and LinkedIn URLs and note <= 300 chars.
   - `[DENY]` Applicant attempting to inject `javascript:alert(1)` in GitHub or LinkedIn.
   - `[DENY]` Applicant attempting to update `status` to `active` or `approved_waiting_response`.
3. **Invitation Acceptance & Declination**:
   - `[ALLOW]` Staged applicant (`approved_waiting_response`) accepts invitation: updates `status` to `active`, sets `memberId == approvedMemberId`, and updates `members/{id}.authUid = uid`.
   - `[DENY]` Non-staged user attempting to claim `approvedMemberId` or `members/{id}.authUid`.
   - `[ALLOW]` Staged applicant declines invitation: updates `status` to `declined`, leaving roster doc untouched.
4. **Declined Applicant Re-Application**:
   - `[ALLOW]` User with `status: 'declined'` transitions to `'pending'` with updated application fields.
   - `[DENY]` Declined user attempting to transition directly to `'active'`.
5. **Roster Document Access & PII Protection**:
   - `[ALLOW]` Staged applicant with `status == 'approved_waiting_response'` reads staged `members/{memberId}`.
   - `[DENY]` Declined applicant attempting to read `members/{memberId}` once declined (Group B).
   - `[DENY]` Public read of `memberPrivate/{memberId}` by non-admin or unlinked user.
   - `[ALLOW]` Linked active member updates allowed public fields (`name`, `bio`, `tracks`, `githubUrl`, etc.).
   - `[DENY]` Member attempting to write `totalCheckIns` or change `handle` or `role`.
