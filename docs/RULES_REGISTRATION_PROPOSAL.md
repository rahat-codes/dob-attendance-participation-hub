# Firestore Security Rules Registration & Profile Links Proposal

> **Safety Notice:** Do NOT deploy these rules automatically. Group A (Transition) and Group B (Tightened) must be deployed in strictly sequential phases as documented below.

---

## 1. Release Order & Strategy

1. **Phase 1 (Pre-Deployment)**: Review and approve **Group A (Transition)** rules.
2. **Phase 2 (Database Preparation)**: Deploy **Group A (Transition)** rules to Firestore (`rpc_action DeployRules`).
3. **Phase 3 (Client Release)**: Publish and deploy the new frontend client.
4. **Phase 4 (Data Sanitization & Repair)**: Admin triggers the dry-run repair tools (`prepareMemberDataRepair` and `prepareUserStateRepair`), verifies preview diffs, and commits repairs.
5. **Phase 5 (Hardening & Tightening)**: Deploy **Group B (Tightened)** rules (defined in `docs/RULES_TIGHTENED.md`).
6. **Phase 6 (Live Smoke Verification)**: Execute live test flow with throwaway accounts.

---

## 2. Group A: Transition Rules (Current firestore.rules)

Allows additive application and social link fields without breaking documents created under earlier schemas, while immediately fixing critical security vulnerabilities:
- **`isSuper()` Hardening**: Requires `email_verified == true` and `firebase.sign_in_provider == 'google.com'`.
- **Sessions & SessionTokens Split**: Splits `write` into distinct `create`, `update`, and `delete` operations so admin session deletion does not fail on null `request.resource.data`.
- **Kiosk Token Hardening**: Prevents empty token match by validating `token` and `prevToken` against `^[A-Z0-9]{8}$`.
- **Check-In Key Allowlists**: Enforces `hasAll` for mandatory check-in keys and `hasOnly` for allowed keys, plus Finding G protection for non-existent document pre-reads.
- **Additive User Fields**: Adds `'applicantName'`, `'applicantHandle'`, `'applicantStudentId'`, `'applicantTrack'`, `'applicantNote'`, `'githubUrl'`, `'linkedinUrl'`, `'portfolioUrl'`, `'showLinksPublicly'` to allowed user keys and update `affectedKeys()`.
- **Member Social Links**: Adds `'githubUrl'`, `'linkedinUrl'`, `'portfolioUrl'`, `'showLinksPublicly'` to `isValidMember` and self-update `affectedKeys()`.
- **Backward Compatibility**: Still permits legacy `studentId` and `university` on `members/{memberId}` during migration.

---

## 3. Group B: Tightened Rules (docs/RULES_TIGHTENED.md)

- Removes legacy `studentId` and `university` completely from `isValidMember` and member self-update `affectedKeys()`.
- Enforces token email immutability on `users` creation: `request.resource.data.email == request.auth.token.email.lower()`.
- Enforces strict `createdAt` immutability on `users` updates.
- Limits `photoURL` to empty or HTTPS URL with length <= 500.
- Restricts `members/{memberId}` read access for staged applicants strictly to users whose status is currently `'approved_waiting_response'`.

---

## 4. Findings G and H Emulator Test Specifications

### Finding G: Pre-Reading Non-Existent Check-In Record
- **Hypothesis**: In rules that dereference `resource.data.memberId == myMemberId()`, calling `getDoc()` on a document that does NOT exist causes rules evaluation failure because `resource == null`. This throws `permission-denied` instead of returning a non-existent document snapshot (`docSnap.exists() === false`).
- **Confirmation Condition**: When an active member calls `getDoc(doc(db, 'checkIns', 'non_existent_checkin_id'))`:
  - If it throws `FirebaseError: Missing or insufficient permissions`, **Finding G is CONFIRMED**.
  - If it succeeds and returns `exists() === false`, **Finding G is REFUTED**.
- **Fix in Rules**: Use conditional handling for non-existent docs:
  ```javascript
  allow read: if isAdmin() || (
    isActiveMember() && (
      resource == null
        ? checkInId.matches('^.*_' + myMemberId() + '$')
        : resource.data.memberId == myMemberId()
    )
  );
  ```

### Finding H: Session Status vs Temporal Open Window
- **Hypothesis**: The client UI in `QRScannerModal` checks `session.status === 'active'`, whereas `firestore.rules` evaluates `sessionOpen(sid)` based on `session.status != 'cancelled'` and the time window `[startAt - openMinutesBefore, endAt + graceMinutesAfter]`.
- **Confirmation Condition**: In emulator, create a session with `status: 'scheduled'` and current time inside the open window `[startAt, endAt]`. Have an active member submit a valid self check-in.
  - If the check-in SUCCEEDS in rules (`assertSucceeds`), **Finding H is CONFIRMED**: rules allow check-in regardless of whether an admin clicked "Mark Active", proving the client `status === 'active'` check is an artificial barrier or discrepancy.
  - If the check-in FAILS in rules, **Finding H is REFUTED**.
