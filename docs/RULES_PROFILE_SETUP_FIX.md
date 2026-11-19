# Firestore Security Rules Proposal: Mandatory Builder Profile Setup & Legacy Link Resilience

> **STATUS: PROPOSAL ONLY — NOT APPLIED AND NOT DEPLOYED**  
> Per project policy, `/firestore.rules` has **not** been modified and **nothing** has been deployed to Firebase or Vercel. Review the diagnosis and exact unified diff below and approve explicitly before applying or publishing.

---

## 1. End-to-End Trace of Mandatory Builder Profile Setup (`"Complete & Activate Pass"`)

1. **UI Entry (`src/App.tsx:266-281`, `src/App.tsx:2164-2196`, `src/components/EditProfileModal.tsx:185-335`)**:
   - Triggered automatically when `!isAdmin && membershipState === 'active' && linkedMember` and `!isMarkedCompleted || !hasStudentId || !hasPhone || !hasTracks`.
   - User enters `studentId`, `phone`, `tracks`, optional `university`/`department`/`major`/`semester`/`bio`/links/avatar and clicks **Complete & Activate Pass** -> `updateMemberSelfProfile(member.id, details, { existingMember: member, existingPrivate: memberPrivate, isMandatory: true })`.
2. **Precheck & Invitation Safety Net (`src/firebase/firestoreService.ts:updateMemberSelfProfile`)**:
   - **Read `users/{uid}` (`getDoc`)**: Allowed by `firestore.rules:300` (`signedIn() && request.auth.uid == userId`). Previously swallowed read errors; now returns `failedStep: 'precheck'`.
   - **If `status === 'approved_waiting_response'` -> `acceptMembershipInvitation(uid)` (`src/firebase/firestoreService.ts:1047-1122`)**:
     - Reads `users/{uid}` (`firestore.rules:300`) and `members/{approvedMemberId}` (`firestore.rules:372-376`).
     - Commits `writeBatch` with:
       - `users/{uid}` (`update`, keys: `['status', 'memberId', 'respondedAt', 'updatedAt']`) -> allowed by `firestore.rules:330-338`.
       - `members/{memberId}` (`update`, key: `['authUid']`) when `!alreadyLinked` -> allowed by `firestore.rules:381-389` **only if** `!('authUid' in resource.data) || resource.data.authUid == null || resource.data.authUid == ''`.
     - **Client bug fixed**: Previously swallowed `getDoc(memberRef)` errors and proceeded with `batch.update(memberRef, { authUid })` even when `member.authUid == uid`, or activated nonexistent member docs.
3. **Member & Private Baseline Pre-reads (`src/firebase/firestoreService.ts:updateMemberSelfProfile`)**:
   - `getDoc(members/{targetMemberId})` -> allowed by `firestore.rules:372`.
   - `getDoc(memberPrivate/{targetMemberId})` (if not passed via `options.existingPrivate`) -> allowed by `firestore.rules:416-421` (`isMemberOwner`).
4. **4-Step Isolated Writes (`src/utils/profileEdit.ts:buildMemberProfileDiff`, `executeIsolatedProfileUpdate`)**:
   - **Step (a) `members/{targetMemberId}` (`updateDoc`, critical)**:
     - Keys written (only changed fields + missing `id`/`authUid` backfill): subset of `['id', 'authUid', 'name', 'avatarUrl', 'bio', 'tracks', 'leaderboardOptOut', 'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly']`. Note `studentId`, `phone`, `university`, `department`, `major`, `semester`, `profileCompleted`, `profileCompletedAt` go only to `memberPrivate/{targetMemberId}` in client code.
     - **Rule branch**: `firestore.rules:390-412` (`isMemberOwner(memberId, resource.data) && isValidMemberSelfUpdate(...) && request.resource.data.handle == resource.data.handle ...`).
   - **Step (b) `memberPrivate/{targetMemberId}` (`setDoc(..., { merge: true })`, critical after Step (a))**:
     - Keys written when `isMandatory: true`: `email` (if changed), `phone`, `studentId`, `university`, `department`, `major`, `semester`, `profileCompleted: true`, `profileCompletedAt`, `updatedAt`.
     - **Rule branch**: `firestore.rules:416-421` (`exists(.../members/$(memberId)) && isMemberOwner(...)`).
   - **Step (c) `publicLeaderboard/{targetMemberId}` (`getDoc` + `updateDoc` or `deleteDoc`, non-critical best-effort)**:
     - **Rule branch**: `firestore.rules:537-552`.
   - **Step (d) `users/{uid}` + Firebase Auth profile (`updateDoc`, non-critical best-effort, only when `name` or non-`data:` `photoURL` changed)**:
     - **Rule branch**: `firestore.rules:320-328`.

---

## 2. Why Live `dob-hub.vercel.app` Showed `"Missing or insufficient permissions."` / `"Permission check failed"`

1. **Unpublished Rules Drift (`docs/rules/A1.rules` vs `/firestore.rules`)**:
   - The live screenshot for `Iuliia Gafurova` (`Student ID: 20251508`) shows raw `"Missing or insufficient permissions."`. Because Turn #9 did not deploy `/firestore.rules` to production, the live database is running either `docs/rules/A1.rules` or an older ruleset:
     - Under `docs/rules/A1.rules:289-300`, `members/{id}` `allow update` requires `resource.data.authUid == request.auth.uid`, validates the whole document via `isValidMember` (which rejects docs missing `id`, `joinedDate`, or `tracks`), and forbids `id`/`authUid`/`profileCompleted`/`updatedAt` in `affectedKeys()`.
     - Under `docs/rules/A1.rules:303-309`, `memberPrivate/{id}` `allow read, write` fails if `members/{id}.data.authUid` is missing or `''`.
     - An older live client bundle displayed raw `"Missing or insufficient permissions."`; Turn #9's `formatUserFriendlyFirestoreError` turned native `FirebaseError` throws (which have `err.code = 'permission-denied'` and no JSON `path`) into `"Permission check failed for this action."` because `context.path` was not passed from `formatStepFailureMessage`. Both client gaps are now fixed in code.
2. **Remaining Gaps in Current `/firestore.rules` (Even Before Turn #10)**:
   - Even if `/firestore.rules` were deployed as-is, edge cases remain:
     - **`firestore.rules:223-228` (`isValidMemberSelfUpdate`)**: Still checks `newData.keys().hasAll(['name', 'handle', 'role', 'tracks', 'status'])` and `newData.tracks.size() > 0` on every write even when untouched on legacy docs.
     - **`firestore.rules:387` (`members` accept-invitation branch)**: Allows `!('authUid' in resource.data) || resource.data.authUid == null || resource.data.authUid == ''`, but rejects `|| resource.data.authUid == request.auth.uid` if an invitation batch updates `authUid` redundantly.
     - **`firestore.rules:404-406` (`members` self-update immutability)**: Direct `.handle`, `.role`, `.status` access fails evaluation if any legacy doc lacks one of those fields; needs `.get('...', null)`.
     - **`firestore.rules:416-421` (`memberPrivate`)**: Requires `exists(.../members/$(memberId))` without a `!exists(...)` fallback for `isActiveMember() && myMemberId() == memberId`, and lacks `isValidMemberPrivate` field validation.

---

## 3. Account Shapes Walkthrough (Current `/firestore.rules` vs Proposed)

| Account Shape | Step / Write | Current `/firestore.rules` Verdict | Under Live `A1.rules` | After Proposed Rules Diff |
| :--- | :--- | :--- | :--- | :--- |
| **(a) `approved_waiting_response` (`approvedMemberId` set, not accepted yet)** | `acceptMembershipInvitation` batch: `users/{uid}` update (`status, memberId, respondedAt, updatedAt`) + `members/{id}` (`authUid`); then Step (a)+(b) | **ALLOW** if `members/{id}.authUid` is unset/empty; **DENY** if `authUid == uid` already & client writes `authUid` | **DENY** if `members/{id}.authUid == ''` (`L286` only checks `null`) or if batch includes `members` alongside `authUid == uid` | **ALLOW** (idempotent `authUid == request.auth.uid` tolerated + client skips `authUid` write when equal) |
| **(b) `active` with `memberId`, created by `createMemberAndApprove` (`authUid` set at accept)** | `members/{id}` update + `memberPrivate/{id}` `set({ merge: true })` | **ALLOW** on `firestore.rules` (assuming valid `tracks`/`handle`/`role`); Step (c) `publicLeaderboard` skipped if doc doesn't exist yet | **DENY** if `id` is backfilled or `joinedDate` missing (`A1.rules:296` omits `id` from `affectedKeys()`) | **ALLOW** |
| **(c) Activated directly by an admin (`authUid` & `memberId` set)** | `members/{id}` update + `memberPrivate/{id}` `set({ merge: true })` | **ALLOW** on `firestore.rules` if `tracks` is non-empty; **DENY** if legacy member doc has `tracks: []` and user only updates links/bio | **DENY** if `tracks: []` or missing `id`/`joinedDate` (`isValidMember`) | **ALLOW** (`tracks` only checked when in `affectedKeys()`) |
| **(d) `members/{id}` doc without `authUid` (or `authUid == ''`)** | `members/{id}` update (backfills `authUid`) + `memberPrivate/{id}` write | **ALLOW** via `isMemberOwner` (`myMemberId() == memberId`) on `firestore.rules:102-110` | **DENY** on BOTH `members` (`L290`) and `memberPrivate` (`L307`) because `A1` requires `resource.data.authUid == request.auth.uid` | **ALLOW** |
| **(e) `memberPrivate/{id}` missing vs existing** | `getDoc(memberPrivate/{id})` + `setDoc(..., { merge: true })` | **ALLOW** on `firestore.rules:416-421` (`read, write`), provided `members/{id}` exists and `isMemberOwner` passes | **DENY** if `members/{id}.authUid` is missing/empty (`L307`) | **ALLOW** + schema-validated by `isValidMemberPrivate` |

---

## 4. Exact Unified Diff (`diff -u` against current `/firestore.rules`)

Includes all fixes from `docs/RULES_LINKS_FIX.md` plus mandatory-profile-setup idempotency & `settings/appMeta` read access:

```diff
--- firestore.rules	current
+++ firestore.rules	proposed
@@ -94,7 +94,7 @@
       return url == null || url == '' || (
         url is string && (
           (url.size() <= 500 && url.matches('^https://.+')) ||
-          (url.size() <= 150000 && url.matches('^data:image/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$'))
+          (url.size() <= 150000 && url.matches('^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'))
         )
       );
     }
@@ -130,8 +130,8 @@
       return url == null || url == '' || (
         url is string &&
         url.size() <= 200 &&
-        url.matches('^https://[a-zA-Z0-9]([a-zA-Z0-9\\-]*[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9\\-]*[a-zA-Z0-9])?)*\\.[a-zA-Z]{2,}(/[^\\s]*)?$') &&
-        !url.matches('^https://([^/]+\\.)?localhost(/.*)?$')
+        url.matches('^https://[a-zA-Z0-9]([a-zA-Z0-9\\-]*[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9\\-]*[a-zA-Z0-9])?)*\\.[a-zA-Z]{2,}([/?#][^\\s]*)?$') &&
+        !url.matches('^https://([^/?#]+\\.)?localhost([/?#].*)?$')
       );
     }
 
@@ -168,7 +168,7 @@
       return (!changed.hasAny(['email']) || newData.email == null || (newData.email is string && newData.email.size() <= 150)) &&
              (!changed.hasAny(['id']) || (newData.id is string && newData.id.size() > 0 && newData.id.size() <= 128)) &&
              (!changed.hasAny(['displayName']) || newData.displayName == null || (newData.displayName is string && newData.displayName.size() <= 100)) &&
-             (!changed.hasAny(['photoURL']) || isValidAvatarUrl(newData.photoURL)) &&
+             (!changed.hasAny(['photoURL']) || newData.photoURL == null || newData.photoURL == '' || (newData.photoURL is string && newData.photoURL.size() <= 500 && newData.photoURL.matches('^https://.+'))) &&
              (!changed.hasAny(['githubUrl']) || isValidGitHub(newData.githubUrl)) &&
              (!changed.hasAny(['linkedinUrl']) || isValidLinkedIn(newData.linkedinUrl)) &&
              (!changed.hasAny(['portfolioUrl']) || isValidPortfolio(newData.portfolioUrl)) &&
@@ -187,10 +187,14 @@
 
     function isValidUserCreate(data) {
       return data.keys().hasAll(['id', 'email', 'displayName', 'status']) &&
+             !('memberId' in data) &&
+             !('approvedMemberId' in data) &&
+             !('approvedAt' in data) &&
+             !('respondedAt' in data) &&
              data.keys().hasOnly([
-               'id', 'email', 'displayName', 'photoURL', 'status', 'memberId', 'approvedMemberId',
+               'id', 'email', 'displayName', 'photoURL', 'status',
                'requestedNotes', 'readAnnouncementIds', 'notificationPrefs', 'notificationPreferences', 'createdAt', 'updatedAt',
-               'approvedAt', 'respondedAt', 'membershipRequestedAt',
+               'membershipRequestedAt',
                'applicantName', 'applicantHandle', 'applicantStudentId', 'applicantTrack',
                'applicantNote', 'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly'
              ]) &&
@@ -214,18 +218,23 @@
              (!('githubUrl' in data) || isValidGitHub(data.githubUrl)) &&
              (!('linkedinUrl' in data) || isValidLinkedIn(data.linkedinUrl)) &&
              (!('portfolioUrl' in data) || isValidPortfolio(data.portfolioUrl)) &&
+             (!('joinedDate' in data) || (data.joinedDate is string && data.joinedDate.size() <= 50)) &&
+             (!('studentId' in data) || data.studentId == null || (data.studentId is string && data.studentId.size() <= 30)) &&
+             (!('university' in data) || data.university == null || (data.university is string && data.university.size() <= 120)) &&
+             (!('email' in data) || data.email == null || (data.email is string && data.email.size() <= 150)) &&
+             (!('phone' in data) || data.phone == null || (data.phone is string && data.phone.size() <= 30)) &&
+             (!('department' in data) || data.department == null || (data.department is string && data.department.size() <= 100)) &&
+             (!('major' in data) || data.major == null || (data.major is string && data.major.size() <= 100)) &&
+             (!('semester' in data) || data.semester == null || (data.semester is string && data.semester.size() <= 40)) &&
              data.status in ['Active', 'Probationary', 'Inactive'];
     }
 
-    // Legacy-tolerant validator for member self-profile updates (allows pre-migration docs missing id/joinedDate or untouched legacy fields)
+    // Legacy-tolerant validator for member self-profile updates (validates only keys in affectedKeys())
     function isValidMemberSelfUpdate(newData, oldData) {
       let changed = newData.diff(oldData).affectedKeys();
-      return newData.keys().hasAll(['name', 'handle', 'role', 'tracks', 'status']) &&
-             (!('id' in newData) || (newData.id is string && isValidId(newData.id))) &&
-             newData.name is string && newData.name.size() > 0 && newData.name.size() <= 100 &&
-             newData.handle is string && newData.handle.size() > 0 && newData.handle.size() <= 50 &&
-             newData.role is string && newData.role.size() > 0 && newData.role.size() <= 50 &&
-             newData.tracks is list && newData.tracks.size() > 0 && newData.tracks.size() <= 10 &&
+      return (!changed.hasAny(['id']) || (newData.id is string && isValidId(newData.id))) &&
+             (!changed.hasAny(['name']) || (newData.name is string && newData.name.size() > 0 && newData.name.size() <= 100)) &&
+             (!changed.hasAny(['tracks']) || (newData.tracks is list && newData.tracks.size() > 0 && newData.tracks.size() <= 10)) &&
              (!changed.hasAny(['avatarUrl']) || !('avatarUrl' in newData) || isValidAvatarUrl(newData.avatarUrl)) &&
              (!changed.hasAny(['bio']) || !('bio' in newData) || newData.bio == null || (newData.bio is string && newData.bio.size() <= 500)) &&
              (!changed.hasAny(['leaderboardOptOut']) || !('leaderboardOptOut' in newData) || newData.leaderboardOptOut == null || newData.leaderboardOptOut is bool) &&
@@ -238,8 +247,25 @@
              (!changed.hasAny(['university']) || !('university' in newData) || newData.university == null || (newData.university is string && newData.university.size() <= 120)) &&
              (!changed.hasAny(['profileCompleted']) || !('profileCompleted' in newData) || newData.profileCompleted is bool) &&
              (!changed.hasAny(['profileCompletedAt']) || !('profileCompletedAt' in newData) || (newData.profileCompletedAt is string && newData.profileCompletedAt.size() <= 50)) &&
-             (!changed.hasAny(['updatedAt']) || !('updatedAt' in newData) || (newData.updatedAt is string && newData.updatedAt.size() <= 50)) &&
-             newData.status in ['Active', 'Probationary', 'Inactive'];
+             (!changed.hasAny(['updatedAt']) || !('updatedAt' in newData) || (newData.updatedAt is string && newData.updatedAt.size() <= 50));
+    }
+
+    function isValidMemberPrivate(data) {
+      return data.keys().hasOnly([
+               'email', 'phone', 'studentId', 'university', 'department', 'major', 'semester',
+               'profileCompleted', 'profileCompletedAt', 'createdAt', 'updatedAt'
+             ]) &&
+             (!('email' in data) || data.email == null || (data.email is string && data.email.size() <= 150)) &&
+             (!('phone' in data) || data.phone == null || (data.phone is string && data.phone.size() <= 30)) &&
+             (!('studentId' in data) || data.studentId == null || (data.studentId is string && data.studentId.size() <= 30)) &&
+             (!('university' in data) || data.university == null || (data.university is string && data.university.size() <= 120)) &&
+             (!('department' in data) || data.department == null || (data.department is string && data.department.size() <= 100)) &&
+             (!('major' in data) || data.major == null || (data.major is string && data.major.size() <= 100)) &&
+             (!('semester' in data) || data.semester == null || (data.semester is string && data.semester.size() <= 40)) &&
+             (!('profileCompleted' in data) || data.profileCompleted is bool) &&
+             (!('profileCompletedAt' in data) || data.profileCompletedAt == null || (data.profileCompletedAt is string && data.profileCompletedAt.size() <= 50)) &&
+             (!('createdAt' in data) || data.createdAt == null || (data.createdAt is string && data.createdAt.size() <= 50)) &&
+             (!('updatedAt' in data) || data.updatedAt == null || (data.updatedAt is string && data.updatedAt.size() <= 50));
     }
 
     // Users Collection
@@ -306,6 +332,9 @@
                        request.resource.data.email == request.auth.token.email.lower() &&
                        request.resource.data.status == 'pending' &&
                        !('memberId' in request.resource.data) &&
+                       !('approvedMemberId' in request.resource.data) &&
+                       !('approvedAt' in request.resource.data) &&
+                       !('respondedAt' in request.resource.data) &&
                        isValidUserCreate(request.resource.data);
 
     // Members Collection
@@ -372,6 +401,7 @@
       allow read: if isAdmin() || isActiveMember() || (
         signedIn() &&
         exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
+        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.status == 'approved_waiting_response' &&
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.approvedMemberId == memberId
       );
 
@@ -384,7 +414,7 @@
         exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.status == 'approved_waiting_response' &&
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.approvedMemberId == memberId &&
-        (!('authUid' in resource.data) || resource.data.authUid == null || resource.data.authUid == '') &&
+        (!('authUid' in resource.data) || resource.data.authUid == null || resource.data.authUid == '' || resource.data.authUid == request.auth.uid) &&
         request.resource.data.diff(resource.data).affectedKeys().hasOnly(['authUid'])
       ) || (
         isMemberOwner(memberId, resource.data) &&
@@ -401,9 +431,9 @@
             request.resource.data.authUid == request.auth.uid
           )
         ) &&
-        request.resource.data.handle == resource.data.handle &&
-        request.resource.data.role == resource.data.role &&
-        request.resource.data.status == resource.data.status &&
+        request.resource.data.get('handle', null) == resource.data.get('handle', null) &&
+        request.resource.data.get('role', null) == resource.data.get('role', null) &&
+        request.resource.data.get('status', null) == resource.data.get('status', null) &&
         request.resource.data.diff(resource.data).affectedKeys().hasOnly([
           'id', 'name', 'avatarUrl', 'bio', 'tracks', 'leaderboardOptOut', 'studentId', 'university',
           'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly', 'authUid',
@@ -414,10 +444,22 @@
 
     // Member Private Details: isolated PII
     match /memberPrivate/{memberId} {
-      allow read, write: if isAdmin() || (
-        exists(/databases/$(database)/documents/members/$(memberId)) &&
-        isMemberOwner(memberId, get(/databases/$(database)/documents/members/$(memberId)).data)
+      allow read: if isAdmin() || (
+        isActiveMember() &&
+        myMemberId() == memberId && (
+          !exists(/databases/$(database)/documents/members/$(memberId)) ||
+          isMemberOwner(memberId, get(/databases/$(database)/documents/members/$(memberId)).data)
+        )
       );
+      allow create, update: if isAdmin() || (
+        isActiveMember() &&
+        myMemberId() == memberId && (
+          !exists(/databases/$(database)/documents/members/$(memberId)) ||
+          isMemberOwner(memberId, get(/databases/$(database)/documents/members/$(memberId)).data)
+        ) &&
+        isValidMemberPrivate(request.resource.data)
+      );
+      allow delete: if isAdmin();
     }
 
     // Public Leaderboard
@@ -542,18 +584,23 @@
           'displayName', 'name', 'avatar', 'avatarUrl', 'handle', 'lastUpdated',
           'githubUrl', 'linkedinUrl', 'portfolioUrl', 'showLinksPublicly'
         ]) &&
-        (!('displayName' in request.resource.data) || (request.resource.data.displayName is string && request.resource.data.displayName.size() > 0 && request.resource.data.displayName.size() <= 100)) &&
-        (!('name' in request.resource.data) || (request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 100)) &&
-        (!('avatar' in request.resource.data) || isValidAvatarUrl(request.resource.data.avatar)) &&
-        (!('avatarUrl' in request.resource.data) || isValidAvatarUrl(request.resource.data.avatarUrl)) &&
-        (!('githubUrl' in request.resource.data) || isValidGitHub(request.resource.data.githubUrl)) &&
-        (!('linkedinUrl' in request.resource.data) || isValidLinkedIn(request.resource.data.linkedinUrl)) &&
-        (!('portfolioUrl' in request.resource.data) || isValidPortfolio(request.resource.data.portfolioUrl))
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['displayName']) || (request.resource.data.displayName is string && request.resource.data.displayName.size() > 0 && request.resource.data.displayName.size() <= 100)) &&
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['name']) || (request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 100)) &&
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['handle']) || (request.resource.data.handle is string && request.resource.data.handle.size() > 0 && request.resource.data.handle.size() <= 50 && (!('handle' in resource.data) || request.resource.data.handle == resource.data.handle))) &&
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['lastUpdated']) || (request.resource.data.lastUpdated is string && request.resource.data.lastUpdated.size() > 0 && request.resource.data.lastUpdated.size() <= 50)) &&
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['showLinksPublicly']) || request.resource.data.showLinksPublicly == null || request.resource.data.showLinksPublicly is bool) &&
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['avatar']) || isValidAvatarUrl(request.resource.data.avatar)) &&
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['avatarUrl']) || isValidAvatarUrl(request.resource.data.avatarUrl)) &&
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['githubUrl']) || isValidGitHub(request.resource.data.githubUrl)) &&
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['linkedinUrl']) || isValidLinkedIn(request.resource.data.linkedinUrl)) &&
+        (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['portfolioUrl']) || isValidPortfolio(request.resource.data.portfolioUrl))
       );
     }
 
     // Club Settings
     match /settings/{settingId} {
-      allow read: if isAdmin() || isActiveMember();
+      allow read: if isAdmin() || isActiveMember() || (signedIn() && settingId == 'appMeta');
       allow write: if isAdmin() && isValidId(settingId);
     }
```

---

## 5. Rollout & Verification Checklist (`MANUAL` / `NOT RUN`)

1. **Await explicit approval** to apply the diff above to `/firestore.rules`.
2. **After approval (`MANUAL`)**:
   - Apply diff to `/firestore.rules` and run `npm run test:rules` in an environment with Java 21+ (`NOT RUN` in sandbox: `sh: 1: java: not found`).
   - Publish updated rules in Firebase Console (**Firestore Database -> Rules**) and optionally create `settings/appMeta` `{ rulesVersion: "2026.11.v3" }` so **Account & Access -> Run Pipeline Check** confirms live rules parity.
   - Deploy updated client bundle to Vercel (`dob-hub.vercel.app`).
3. **Proposed Emulator Tests (`NOT RUN` — Java unavailable)**:
   - **SETUP-RULE-01 (`NOT RUN`)**: Newly approved user (`approved_waiting_response`) completes accept batch + Mandatory Profile Setup (`members` + `memberPrivate`) even when `members/{id}` lacks `authUid` or `joinedDate` -> **`ALLOW`**.
   - **SETUP-RULE-02 (`NOT RUN`)**: Idempotent invitation accept when `members/{id}.authUid == request.auth.uid` -> **`ALLOW`**.
   - **SETUP-RULE-03 (`NOT RUN`)**: Active member without `memberPrivate/{id}` creates `memberPrivate/{id}` with `{ studentId, phone, tracks, university, profileCompleted: true, profileCompletedAt, updatedAt }` -> **`ALLOW`**.
   - **SETUP-RULE-04 (`NOT RUN`)**: Attacker attempts `memberPrivate/{otherId}` write or unwhitelisted key -> **`DENY`**.
