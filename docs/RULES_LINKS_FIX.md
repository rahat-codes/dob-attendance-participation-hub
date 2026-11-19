# Firestore Security Rules Proposal: Edit Profile Links, Legacy Member Resilience & Audit Hardening

> **STATUS: PROPOSAL ONLY — NOT APPLIED AND NOT DEPLOYED**  
> Per project policy, `/firestore.rules` has **not** been modified and **nothing** has been deployed to Firebase. Review the exact diff below and approve explicitly before applying or publishing.

---

## 1. Summary of Changes Proposed

1. **Unified Avatar & Portfolio Validators (`isValidAvatarUrl`, `isValidPortfolio`)**:
   - Unify `isValidAvatarUrl` on `^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$` (max 150 KB) and HTTPS URLs (max 500 chars), matching `processProfilePhoto` (`image/jpeg`) and `sanitizeAuthPhotoUrl`.
   - Update `isValidPortfolio` regex suffix from `(/[^\s]*)?$` to `([/?#][^\s]*)?$` (and `!url.matches('^https://([^/?#]+\\.)?localhost([/?#].*)?$')`) so query/fragment URLs without an intermediate `/` (e.g., `https://site.dev?a=1#sec`) match `PROFILE_LINK_RULES_REGEX.portfolio` in `src/utils/profileLinks.ts`, while `https://localhost?a=1` remains blocked.
2. **`members` Self-Update & `isValidMemberSelfUpdate` Scoping**:
   - Scope **all** validation clauses in `isValidMemberSelfUpdate(newData, oldData)` by `changed.hasAny([...])` (`affectedKeys()`) so untouched legacy fields (`tracks`, `handle`, `role`, missing `joinedDate`, or missing `id`) never cause a links-only or avatar-only update to fail.
   - Use `.get('handle', null)`, `.get('role', null)`, and `.get('status', null)` equality checks in `/members/{memberId}` `allow update` so missing legacy keys do not crash rule evaluation.
   - Ownership check continues to allow either matching `resource.data.authUid == request.auth.uid` or `myMemberId() == memberId` via `isMemberOwner(memberId, resource.data)`.
3. **`memberPrivate` Key Whitelist & Owner Scoping (`isValidMemberPrivate`)**:
   - Require `isActiveMember() && myMemberId() == memberId` directly on `/memberPrivate/{memberId}` read/write (while still enforcing `isMemberOwner` if `members/{memberId}` exists so `authUid` conflicts cannot read/write).
   - Enforce `isValidMemberPrivate(request.resource.data)` on member create/update: strict key whitelist (`email`, `phone`, `studentId`, `university`, `department`, `major`, `semester`, `profileCompleted`, `profileCompletedAt`, `createdAt`, `updatedAt`) with explicit string length and bool checks.
4. **`publicLeaderboard` Owner Validation Scoping**:
   - Guard each owner-editable field (`displayName`, `name`, `handle`, `lastUpdated`, `showLinksPublicly`, `avatar`, `avatarUrl`, `githubUrl`, `linkedinUrl`, `portfolioUrl`) by `affectedKeys().hasAny([...])`.
   - Enforce `handle` immutability (if already present) and `1..50` char bounds, `lastUpdated` string `1..50`, and `showLinksPublicly` bool-or-null.
5. **Security Audit Fixes**:
   - **`users` Create Escalation Fix**: Forbid `memberId`, `approvedMemberId`, `approvedAt`, and `respondedAt` on `/users/{userId}` `allow create` and in `isValidUserCreate`.
   - **`members` Staged Read Hijack Fix**: Require `me().status == 'approved_waiting_response'` alongside `me().approvedMemberId == memberId` on `/members/{memberId}` `allow read`.
   - **`users` `photoURL` Update Hygiene**: Tighten `isValidUserUpdate` so `photoURL` updates only accept `''`/`null` or short `https://` URLs (`data:` blobs are never stored in `users/{uid}.photoURL`).
   - **`isValidMember` Legacy Field Bounds**: Add explicit length bounds (`<= 30..150`) when legacy fields (`studentId`, `university`, `email`, `phone`, `department`, `major`, `semester`, `joinedDate`) exist on `/members/{memberId}` writes.

---

## 2. Exact Unified Diff (`diff -u` against current `/firestore.rules`)

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
+    // Legacy-tolerant validator for member self-profile updates (validates only keys in affectedKeys() so untouched legacy fields never block link/avatar edits)
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
 
     // [Group A1]: Full Session Validator for new sessions and full updates
@@ -306,6 +332,9 @@
                        request.resource.data.email == request.auth.token.email.lower() &&
                        request.resource.data.status == 'pending' &&
                        !('memberId' in request.resource.data) &&
+                       !('approvedMemberId' in request.resource.data) &&
+                       !('approvedAt' in request.resource.data) &&
+                       !('respondedAt' in request.resource.data) &&
                        isValidUserCreate(request.resource.data);
 
       allow update: if signedIn() &&
@@ -372,6 +401,7 @@
       allow read: if isAdmin() || isActiveMember() || (
         signedIn() &&
         exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
+        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.status == 'approved_waiting_response' &&
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.approvedMemberId == memberId
       );
 
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
 
     // Sessions Collection: split create, update, delete
@@ -542,13 +584,16 @@
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
```

---

## 3. Rollout & Paste Order (`Group A1` vs `Group A2`)

| Phase | Rules Scope | Safe Before Client Deploy? | Manual Firebase Console Action |
| :--- | :--- | :--- | :--- |
| **Step 1 — Group A1 (Non-breaking Relaxation & Security Fixes)** | - `isValidPortfolio` allowing `[/?#]`<br>- `isValidMemberSelfUpdate` affectedKeys scoping + `.get()` guards on `handle`/`role`/`status`<br>- `memberPrivate` `myMemberId() == memberId` owner check<br>- `users` create forbidding `approvedMemberId`/`memberId`/`approvedAt`/`respondedAt`<br>- `members` staged read requiring `status == 'approved_waiting_response'` | **YES** (existing clients continue working; fixes broken member saves and closes privilege-escalation gap immediately) | Wait for explicit approval -> apply diff -> Firebase Console -> **Firestore Database -> Rules** -> paste updated `firestore.rules` -> **Publish** |
| **Step 2 — Deploy New Client to Vercel** | - Diff-only `updateMemberSelfProfile` (`src/utils/profileEdit.ts`)<br>- Step isolation `(a)`–`(d)`<br>- `data:` avatar stripped from `users/{uid}.photoURL` and `auth.photoURL` | Deploy via Vercel (`dob-hub.vercel.app`) | Verify on staging/prod with Test Accounts 1–3 (`Edit Profile` links, mandatory profile setup, clear link `""`) |
| **Step 3 — Group A2 (Tightening)** | - `isValidAvatarUrl` strictly `jpeg\|png\|webp`<br>- `isValidUserUpdate` rejecting new `data:` URIs on `users/{uid}.photoURL`<br>- `isValidMemberPrivate` key whitelist<br>- `publicLeaderboard` affectedKeys validation for `handle`/`lastUpdated`/`showLinksPublicly` | **NO — only after Step 2 client is live** | Confirm zero active editing issues -> confirm all Group A2 checks published in `firestore.rules` |

**Rollback**: Firebase Console -> **Firestore Database -> Rules -> Version history** -> select prior version -> **Publish** (`< 30s`).

---

## 4. Proposed Firestore Rules Emulator Tests (**`NOT RUN`**)

> Evidence label: **`NOT RUN`** (Java 21+ & Firestore Emulator runtime are unavailable in this sandbox; ready to append to `tests/firestore-rules.test.ts` once rules diff is approved).

| Test Case ID | Scenario | Target Path & Auth | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **LINK-RULE-01** (`NOT RUN`) | Member saves links-only diff (`githubUrl`, `linkedinUrl` with dot, `portfolioUrl` with `?a=1#s`) when `members/{id}` lacks `authUid` & `joinedDate` | `members/{id}` (`update`) as `active` user where `users/{uid}.memberId == id` | **`ALLOW`** |
| **LINK-RULE-02** (`NOT RUN`) | Member saves profile with `data:image/jpeg;base64,...` avatar and untouched `tracks` | `members/{id}` (`update`), `memberPrivate/{id}` (`set merge`), `publicLeaderboard/{id}` (`update`) | **`ALLOW`** |
| **LINK-RULE-03** (`NOT RUN`) | Member clears all three links by writing `""` and sets `showLinksPublicly: false` | `members/{id}` (`update`) & `publicLeaderboard/{id}` (`update`) | **`ALLOW`** |
| **LINK-RULE-04** (`NOT RUN`) | Rejects invalid links (`http://portfolio.dev`, `https://github.com/octocat/repo`, `https://www.linkedin.com/in/foo..bar`, `https://localhost/admin`) | `members/{id}` (`update`) | **`DENY`** |
| **LINK-RULE-05** (`NOT RUN`) | Rejects member escalating `role`, changing `handle`, or reactivating `status` alongside link edit | `members/{id}` (`update`) | **`DENY`** |
| **LINK-RULE-06** (`NOT RUN`) | Rejects member updating another member's `members/{otherId}`, `memberPrivate/{otherId}`, or `publicLeaderboard/{otherId}` | `{col}/{otherId}` (`update`) | **`DENY`** |
| **LINK-RULE-07** (`NOT RUN`) | Rejects unwhitelisted key or oversized string (`studentId.size() > 30`) on `memberPrivate/{id}` | `memberPrivate/{id}` (`set merge`) | **`DENY`** |
| **SEC-RULE-08** (`NOT RUN`) | Rejects attacker creating `users/{uid}` with `approvedMemberId: "<victimId>"` and reading `members/{victimId}` | `users/{uid}` (`create`) & `members/{victimId}` (`get`) | **`DENY`** |
| **SEC-RULE-09** (`NOT RUN`) | Rejects `users/{uid}` update attempting to store `data:image/jpeg;base64,...` into `photoURL` | `users/{uid}` (`update`) | **`DENY`** |
