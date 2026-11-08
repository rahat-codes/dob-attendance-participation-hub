# DOB-Hub: New-Member Registration Workflow Release Guide

## 1. Overview & Summary of Fixes

This release addresses all confirmed problems (R1 through R16) in the new-member registration, approval, linking, re-application, and profile activation workflows:

- **R1 (First Sign-In Race)**: Deduplicated `ensureUserProfile` calls with in-flight single-flight promises by UID and create-first idempotent writes. Eliminates "permission-denied" on initial Google sign-in.
- **R2 (Zero Phantom Requests)**: Unsubmitted Google sign-ins (`users/{uid}` without submitted application form) are segregated from the active queue. They never trigger audio/visual alerts, never inflate the pending requests badge, and appear only in a collapsed reference section without Approve buttons.
- **R3 & R4 (Structured Registration Form)**: Replaced free-text delimiter-separated string parsing with a validated schema (`applicantName`, `applicantHandle`, `applicantStudentId`, `applicantTrack`, `githubUrl`, `linkedinUrl`, `portfolioUrl`, `showLinksPublicly`, `applicantNote`). Added delimiter sanitization (stripping `·` characters to prevent injection).
- **R5 & R6 (Atomic Approval & Anti-Impersonation)**: Removed silent auto-matching by applicant-typed handle/name. Roster record reuse requires explicit candidate matching (`findReuseCandidates`) and an administrative confirmation dialog. Member creation and user staging occur in a single atomic `writeBatch` including audit logs.
- **R7 (PII Isolation)**: Public `members` documents are strictly whitelisted to non-sensitive fields (`id, name, handle, role, tracks, joinedDate, status, avatarUrl, bio, leaderboardOptOut, authUid, createdAt, githubUrl, linkedinUrl, portfolioUrl, showLinksPublicly`). Private PII (`email, phone, studentId, university, department, major, semester`) resides exclusively in `memberPrivate`.
- **R8, R9, R10, R11, R12 (State Machine & ID Lifecycle)**: Table-driven state machine (`getUserState` and `nextUserState`) enforces clear transitions. Deactivated members never see the active workspace; declined and deactivated members can cleanly re-apply and reuse their handles.
- **R13 & R15 (Security Rules Audit)**: Documented rules diffs in `docs/RULES_REGISTRATION_PROPOSAL.md`. Rules changes require explicit administrative review before deployment.
- **R14 (Audit Integrity)**: Multi-document operations batch administrative audit logs atomically. Applicant-side writes never attempt unauthorized audit writes.
- **R16 (Production Optimization)**: Enforced production Vite build mode (`NODE_ENV=production`), cutting bundle size by over 65 kB gzip and eliminating React development runtime warnings.

---

## 2. Release & Deployment Checklist

### Pre-Deployment Verification
1. Run all test suites:
   ```bash
   npm test
   ```
   *Expected: All 9 test suites pass with 0 errors (60+ tests).*
2. Verify TypeScript type checking:
   ```bash
   npm run lint
   ```
   *Expected: Clean exit with code 0.*
3. Verify production compilation and bundle size:
   ```bash
   npm run build
   ```
   *Expected: Production build output, zero `react-dom-client.development` strings in bundle.*

### Firestore Security Rules Deployment
> **Note**: Per Operating Rule 3, security rules are **NOT** deployed automatically.
1. Review the proposed rules diff in `docs/RULES_REGISTRATION_PROPOSAL.md`.
2. Apply Group A (additive rules for structured fields and external links).
3. Test with throwaway accounts.
4. Deploy Group B (tightening rules) when ready via Firebase Console or CLI.

### Data Integrity & Repair Tools
In the app, Super Administrators can open **Settings / More > Database Operations & Integrity**:
1. **Preview Member Data Repair (Dry Run)**:
   - Scans public `members` documents for legacy keys (`email`, `phone`, `totalCheckIns`, etc.).
   - Displays count of affected documents.
   - If confirmed, executes chunked writes (<= 200 members per batch) to purge non-whitelisted keys from `members` and preserve them in `memberPrivate`.
2. **Preview User State Repair (Dry Run)**:
   - Detects users in inconsistent states (Active without a member, Active with an Inactive member, Declined with lingering references).
   - Displays count and repair plan.
   - If confirmed, synchronizes user documents in atomic batches.

---

## 3. Manual Testing Verification Procedures

### Test Case 1: First Sign-In & Application Submission
1. Sign in with a new Google Account (throwaway account).
2. Verify screen displays **New Member Registration** with the `ApplicationForm`.
3. Fill in Full Name, Builder Handle (`@testbuilder`), Student ID, Specialty Track, GitHub, and LinkedIn URLs.
4. Submit the form.
5. Verify state transitions immediately to **Pending Admin Verification** with structured details, safe link previews, and an "Edit application details" button.
6. Verify the Admin Requests badge on organizer accounts increments by 1.

### Test Case 2: Unsubmitted Sign-In Isolation
1. Sign in with a fresh throwaway Google account.
2. When the registration form is shown, do NOT submit it.
3. Open the Admin dashboard on an organizer account.
4. Verify the pending requests counter badge does NOT increment.
5. In **Pending Membership Requests**, verify the user is in the collapsed "Signed in, no application submitted yet" section without an Approve button.

### Test Case 3: Admin Review & Approval
1. In **Pending Membership Requests**, locate the applicant from Test Case 1.
2. Click **Register & Link New**.
3. Verify `AddMemberModal` opens with applicant's name, handle, student ID, and track prefilled.
4. Click **Add Builder**.
5. Verify the applicant is staged in `users/{uid}.approvedMemberId` and status set to `approved_waiting_response` in one atomic batch.

### Test Case 4: Acceptance & Mandatory Profile Setup
1. Switch back to the applicant's browser session.
2. Verify screen displays **Approved — Waiting for User Response**.
3. Click **Accept Invitation & Activate Pass**.
4. Verify user status becomes `active`, the member record is bound, and the **Mandatory Builder Profile Setup** modal opens.
5. Enter required student ID, phone number, and confirm tracks.
6. Click **Complete & Activate Pass**.
7. Verify pass activates and member pass view / attendance hub is ready.

### Test Case 5: Decline & Re-Application
1. As an admin, decline a test applicant.
2. On applicant's screen, verify **Membership Invitation Declined** is shown.
3. Verify the re-application form is rendered prefilled with previous details.
4. Change the handle / track and submit.
5. Verify admin sees the applicant again with a purple **Re-applicant** badge.
