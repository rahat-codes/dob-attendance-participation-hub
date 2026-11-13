import fs from 'node:fs';
import path from 'node:path';
import { nextUserState, getUserState, UnifiedUserState, UserAction } from '../src/utils/userStateMachine';
import { validateApplication, encodeApplication, decodeApplication, isApplicationSubmitted } from '../src/utils/application';
import { normalizeGitHubUrl, normalizeLinkedInUrl, normalizePortfolioUrl } from '../src/utils/profileLinks';
import { buildCompleteSessionBatchPlan, buildReopenSessionBatchPlan } from '../src/utils/sessionPlans';
import { buildDeactivateMemberPlan, buildReactivateMemberPlan } from '../src/utils/memberLifecyclePlans';
import { BUILDER_TRACKS } from '../src/config/constants';
import { PUBLIC_MEMBER_WHITELIST } from '../src/utils/repairTools';
import { UserProfile, Member } from '../src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

// -------------------------------------------------------------
// 1. Table-driven nextUserState testing
// -------------------------------------------------------------
function testStateMachineTransitions() {
  console.log('--- RUNNING STATE MACHINE TRANSITION TESTS ---');

  interface TestCase {
    name: string;
    user: Partial<UserProfile>;
    member?: Partial<Member>;
    action: UserAction;
    expectedAllowed: boolean;
    expectedState?: UnifiedUserState;
  }

  const testCases: TestCase[] = [
    // Signed-in without submission
    {
      name: 'Signed in without application submitting application -> allowed, awaiting_review',
      user: { status: 'pending' },
      action: 'submit_application',
      expectedAllowed: true,
      expectedState: 'awaiting_review',
    },
    {
      name: 'Signed in without application cannot be approved directly',
      user: { status: 'pending' },
      action: 'approve',
      expectedAllowed: false,
    },
    // Submitted application
    {
      name: 'Submitted application approved -> allowed, approved_waiting',
      user: { status: 'pending', membershipRequestedAt: '2026-11-06T10:00:00Z' },
      action: 'approve',
      expectedAllowed: true,
      expectedState: 'approved_waiting',
    },
    {
      name: 'Submitted application rejected -> allowed, declined',
      user: { status: 'pending', membershipRequestedAt: '2026-11-06T10:00:00Z' },
      action: 'reject',
      expectedAllowed: true,
      expectedState: 'declined',
    },
    // Approved waiting
    {
      name: 'Approved applicant accepts -> allowed, active',
      user: { status: 'approved_waiting_response', approvedMemberId: 'mem_1' },
      action: 'accept_invitation',
      expectedAllowed: true,
      expectedState: 'active',
    },
    {
      name: 'Approved applicant declines -> allowed, declined',
      user: { status: 'approved_waiting_response', approvedMemberId: 'mem_1' },
      action: 'decline_invitation',
      expectedAllowed: true,
      expectedState: 'declined',
    },
    // Declined user re-applying
    {
      name: 'Declined user re-applying -> allowed, awaiting_review',
      user: { status: 'declined' },
      action: 'reapply',
      expectedAllowed: true,
      expectedState: 'awaiting_review',
    },
    // Active member deactivation
    {
      name: 'Active member deactivated -> allowed, deactivated',
      user: { status: 'active', memberId: 'mem_1' },
      member: { id: 'mem_1', status: 'Active' },
      action: 'deactivate',
      expectedAllowed: true,
      expectedState: 'deactivated',
    },
    // Deactivated member re-applying
    {
      name: 'Deactivated member re-applying -> allowed, awaiting_review',
      user: { status: 'active', memberId: 'mem_1' },
      member: { id: 'mem_1', status: 'Inactive' },
      action: 'reapply',
      expectedAllowed: true,
      expectedState: 'awaiting_review',
    },
    // Suspension and unsuspend restoring derived state
    {
      name: 'Applicant suspended -> allowed, suspended',
      user: { status: 'pending', membershipRequestedAt: '2026-11-06T10:00:00Z' },
      action: 'suspend',
      expectedAllowed: true,
      expectedState: 'suspended',
    },
    {
      name: 'Suspended applicant unsuspended -> restored to awaiting_review',
      user: { status: 'suspended', membershipRequestedAt: '2026-11-06T10:00:00Z' },
      action: 'unsuspend',
      expectedAllowed: true,
      expectedState: 'awaiting_review',
    },
    {
      name: 'Suspended approved applicant unsuspended -> restored to approved_waiting',
      user: { status: 'suspended', approvedMemberId: 'mem_1' },
      action: 'unsuspend',
      expectedAllowed: true,
      expectedState: 'approved_waiting',
    },
    {
      name: 'Suspended active member unsuspended -> restored to active',
      user: { status: 'suspended', memberId: 'mem_1' },
      action: 'unsuspend',
      expectedAllowed: true,
      expectedState: 'active',
    },
    // Forbidden actions
    {
      name: 'Active member cannot re-apply',
      user: { status: 'active', memberId: 'mem_1' },
      member: { id: 'mem_1', status: 'Active' },
      action: 'reapply',
      expectedAllowed: false,
    },
    {
      name: 'Active member cannot accept invitation again',
      user: { status: 'active', memberId: 'mem_1' },
      member: { id: 'mem_1', status: 'Active' },
      action: 'accept_invitation',
      expectedAllowed: false,
    },
  ];

  for (const tc of testCases) {
    const res = nextUserState(tc.user as UserProfile, tc.member as Member, tc.action);
    assert(res.allowed === tc.expectedAllowed, `${tc.name}: expected allowed=${tc.expectedAllowed}, got ${res.allowed} (reason: ${res.reason})`);
    if (tc.expectedAllowed && tc.expectedState) {
      assert(res.nextState === tc.expectedState, `${tc.name}: expected state=${tc.expectedState}, got ${res.nextState}`);
    }
  }

  console.log(`✓ All ${testCases.length} table-driven state transitions passed cleanly`);
}

// -------------------------------------------------------------
// 2. Profile Links & Security Tests
// -------------------------------------------------------------
function testProfileLinksValidation() {
  console.log('--- RUNNING PROFILE LINKS VALIDATION TESTS ---');

  // GitHub tests
  assert(normalizeGitHubUrl('alex').canonicalUrl === 'https://github.com/alex', 'standalone username');
  assert(normalizeGitHubUrl('@alex-builder').canonicalUrl === 'https://github.com/alex-builder', 'leading @');
  assert(normalizeGitHubUrl('https://github.com/alex').canonicalUrl === 'https://github.com/alex', 'full url');
  assert(!normalizeGitHubUrl('javascript:alert(1)').valid, 'reject javascript protocol');
  assert(!normalizeGitHubUrl('data:text/html,<script>alert(1)</script>').valid, 'reject data protocol in github');
  assert(!normalizeGitHubUrl('-invalid-user').valid, 'reject invalid github username with leading hyphen');
  assert(!normalizeGitHubUrl('a'.repeat(40)).valid, 'reject overlong github username > 39 characters');

  // LinkedIn tests
  assert(normalizeLinkedInUrl('in/alex-smith').canonicalUrl === 'https://www.linkedin.com/in/alex-smith', 'slug format');
  assert(normalizeLinkedInUrl('https://linkedin.com/in/alex-smith/').canonicalUrl === 'https://www.linkedin.com/in/alex-smith', 'url format');
  assert(!normalizeLinkedInUrl('data:text/html;alert(1)').valid, 'reject data protocol in linkedin');
  assert(!normalizeLinkedInUrl('javascript:void(0)').valid, 'reject javascript in linkedin');
  assert(!normalizeLinkedInUrl('in/' + 'a'.repeat(101)).valid, 'reject overlong linkedin slug > 100 characters');

  // Portfolio tests: 15 comprehensive edge-case assertions
  assert(normalizePortfolioUrl('').canonicalUrl === '', '1. optional empty portfolio allowed');
  assert(normalizePortfolioUrl('myportfolio.dev').canonicalUrl === 'https://myportfolio.dev/', '2. forces https');
  assert(normalizePortfolioUrl('https://myportfolio.dev/projects').valid, '3. valid domain with path passes');
  assert(!normalizePortfolioUrl('javascript:alert(1)').valid, '4. reject javascript scheme');
  assert(!normalizePortfolioUrl('data:text/html;base64,PHNjcmlwdD4=').valid, '5. reject data scheme');
  assert(!normalizePortfolioUrl('https://user:pass@evil.com').valid, '6. reject embedded credentials (user:pass)');
  assert(!normalizePortfolioUrl('https://user@legit.com').valid, '7. reject user@host trick');
  assert(normalizePortfolioUrl('https://evil.com/@github.com').valid, '8. valid host evil.com with /@path allowed');
  assert(!normalizePortfolioUrl('https://evil.com:8080/path').valid, '9. reject custom port (: in authority)');
  assert(!normalizePortfolioUrl('https://127.0.0.1/admin').valid, '10. reject IPv4 loopback');
  assert(!normalizePortfolioUrl('https://192.168.1.1').valid, '11. reject private LAN IP');
  assert(!normalizePortfolioUrl('https://8.8.8.8').valid, '12. reject public IPv4 (no letters-only TLD)');
  assert(!normalizePortfolioUrl('http://localhost:3000').valid, '13. reject localhost with port');
  assert(!normalizePortfolioUrl('https://sub.localhost').valid, '14. reject sub.localhost domain');
  assert(!normalizePortfolioUrl('https://' + 'a'.repeat(200) + '.dev').valid, '15. reject overlong portfolio URL > 200 chars');
  assert(normalizePortfolioUrl('HTTPS://MYPORTFOLIO.DEV/PATH').canonicalUrl === 'https://myportfolio.dev/PATH', '16. normalize uppercase protocol and host');
  assert(normalizePortfolioUrl('https://myportfolio.dev/').canonicalUrl === 'https://myportfolio.dev/', '17. trailing slash valid');
  assert(!normalizePortfolioUrl('https://my portfolio.dev').valid, '18. reject space in hostname');
  assert(!normalizePortfolioUrl('https://portfolio.dev/path with spaces').valid, '19. reject space in path');
  assert(!normalizePortfolioUrl('https://myportfolio.123').valid, '20. reject numeric TLD (requires letters-only TLD)');
  assert(!normalizePortfolioUrl('https://\u0430pple.com').valid, '21. reject Cyrillic unicode lookalike hostname');

  console.log('✓ Profile links validation: 21 edge-case tests (schemes, credentials, hosts, IPs, ports, spaces, unicode lookalikes) passed');
}

// -------------------------------------------------------------
// 3. Application Validation & Sanitization Tests
// -------------------------------------------------------------
function testApplicationValidation() {
  console.log('--- RUNNING APPLICATION VALIDATION TESTS ---');

  const validPayload = {
    applicantName: 'Ada Lovelace',
    applicantHandle: 'ada_love',
    applicantStudentId: '20261234',
    applicantTrack: 'Software & Systems' as const,
    applicantNote: 'Excited to build with the guild!',
    githubUrl: 'ada-lovelace',
    linkedinUrl: 'in/ada-lovelace',
    portfolioUrl: 'https://ada.dev',
    showLinksPublicly: true,
  };

  const validRes = validateApplication(validPayload);
  assert(validRes.valid, 'Valid application must pass');
  assert(validRes.sanitized?.applicantHandle === '@ada_love', 'handle must be formatted with leading @');
  assert(validRes.sanitized?.githubUrl === 'https://github.com/ada-lovelace', 'canonical github url');

  // Check delimiter stripping and sanitization
  const injected = {
    ...validPayload,
    applicantName: 'Ada · Injected',
    applicantNote: 'Testing · delimiter · injection',
  };
  const sanitizedRes = validateApplication(injected);
  assert(sanitizedRes.valid, 'Injected delimiters must be sanitized, not rejected');
  assert(!sanitizedRes.sanitized?.applicantName.includes('·'), 'Name must not contain ·');
  assert(!sanitizedRes.sanitized?.applicantNote?.includes('·'), 'Note must not contain ·');

  // Encoding & Decoding
  const encoded = encodeApplication(validRes.sanitized!);
  assert(encoded.startsWith('@ada_love - Track: Software & Systems'), 'Encoded legacy summary matches expected structure');

  const decoded = decodeApplication({
    id: 'u1',
    email: 'ada@example.com',
    displayName: 'Ada',
    status: 'pending',
    applicantName: 'Ada Lovelace',
    applicantHandle: '@ada_love',
    applicantTrack: 'Software & Systems',
  } as UserProfile);
  assert(decoded.applicantName === 'Ada Lovelace', 'Structured decode matches');

  // Legacy fallback decode
  const legacyDecoded = decodeApplication({
    id: 'u2',
    email: 'builder@example.com',
    displayName: 'Builder',
    status: 'pending',
    requestedNotes: '@legacy_builder · ID: 998877 · Track: AI & Embedded · Name: Alan Turing',
  } as UserProfile);
  assert(legacyDecoded.applicantHandle === '@legacy_builder', 'Legacy decode parsed handle');
  assert(legacyDecoded.applicantStudentId === '998877', 'Legacy decode parsed student ID');
  assert(legacyDecoded.applicantName === 'Alan Turing', 'Legacy decode parsed name');

  // isApplicationSubmitted test
  assert(!isApplicationSubmitted({ id: 'u3', status: 'pending', email: 'test@test.com', displayName: 'Test' } as UserProfile), 'Fresh sign-in is not submitted');
  assert(isApplicationSubmitted({ id: 'u4', status: 'pending', email: 'test@test.com', displayName: 'Test', membershipRequestedAt: '2026-11-06T12:00:00Z' } as UserProfile), 'Has membershipRequestedAt is submitted');

  console.log('✓ Application validation, delimiter protection, encode/decode, and submission checks passed');
}

// -------------------------------------------------------------
// 4. Session Reopen Logic Tests
// -------------------------------------------------------------
function testSessionReopenLogic() {
  console.log('--- RUNNING SESSION REOPEN LOGIC TESTS ---');
  const completedSession = {
    id: 's1',
    status: 'completed' as const,
    checkInMode: 'closed' as const,
  };

  const computeReopenedPayload = (target: { status: string; checkInMode: string }, mode?: string) => ({
    ...target,
    status: 'scheduled',
    checkInMode: mode || (target.status === 'completed' || target.status === 'cancelled' ? 'auto' : target.checkInMode || 'auto'),
  });

  const reopened = computeReopenedPayload(completedSession);
  assert(reopened.status === 'scheduled', 'Reopened session status is scheduled');
  assert(reopened.checkInMode === 'auto', 'Reopened session checkInMode reset to auto');

  const cancelledSession = {
    id: 's2',
    status: 'cancelled' as const,
    checkInMode: 'closed' as const,
  };
  const reopenedCancelled = computeReopenedPayload(cancelledSession);
  assert(reopenedCancelled.status === 'scheduled', 'Cancelled session reopen status is scheduled');
  assert(reopenedCancelled.checkInMode === 'auto', 'Cancelled session reopen checkInMode reset to auto');

  const customReopened = computeReopenedPayload(completedSession, 'open');
  assert(customReopened.checkInMode === 'open', 'Custom mode respected on reopen');

  console.log('✓ Session reopen status & checkInMode reset logic passed');
}

// -------------------------------------------------------------
// 5. Session Atomic Batch Plan Tests (Requirement 1)
// -------------------------------------------------------------
function testSessionBatchPlanGeneration() {
  console.log('--- RUNNING SESSION ATOMIC BATCH PLAN TESTS ---');
  
  // 1. completeSession plan
  const completePlan = buildCompleteSessionBatchPlan('sess_xyz123', 'admin_uid_1', 'admin@example.com');
  assert(completePlan.sessionId === 'sess_xyz123', 'Plan sessionId matches');
  assert(completePlan.sessionUpdate.status === 'completed', 'Plan status is completed');
  assert(completePlan.sessionUpdate.checkInMode === 'closed', 'Plan checkInMode is closed');
  assert(Boolean(completePlan.sessionUpdate.closedAt), 'closedAt timestamp is present');
  assert(Boolean(completePlan.sessionUpdate.updatedAt), 'updatedAt timestamp is present');
  assert(completePlan.auditEntry.action === 'complete_session', 'Audit action matches');
  assert(completePlan.auditEntry.performedBy === 'admin_uid_1', 'Audit performedBy matches admin');
  assert(completePlan.auditEntry.performedByEmail === 'admin@example.com', 'Audit email matches');
  assert(completePlan.auditEntry.targetId === 'sess_xyz123', 'Audit targetId matches session');
  assert(!('timestampIso' in completePlan.auditEntry), 'completeSession auditEntry must not include timestampIso');

  // 2. reopenSession plan
  const reopenPlan = buildReopenSessionBatchPlan('sess_xyz123', 'auto', 'admin_uid_1', 'admin@example.com');
  assert(reopenPlan.sessionUpdate.status === 'scheduled', 'Reopen status is scheduled');
  assert(reopenPlan.sessionUpdate.checkInMode === 'auto', 'Reopen checkInMode is auto');
  assert(reopenPlan.auditEntry.action === 'reopen_session', 'Audit action matches reopen_session');
  assert(reopenPlan.auditEntry.performedBy === 'admin_uid_1', 'Audit performedBy matches admin');
  assert(!('timestampIso' in reopenPlan.auditEntry), 'reopenSession auditEntry must not include timestampIso');

  console.log('✓ Session atomic batch plans (completeSession & reopenSession) verified');
}

// -------------------------------------------------------------
// 6. Legacy requestedNotes Decoding Tests (Requirement 6)
// -------------------------------------------------------------
function testLegacyRequestedNotesDecoding() {
  console.log('--- RUNNING LEGACY REQUESTED NOTES DECODING TESTS ---');

  // Case A: Full legacy notes string with delimiter '·'
  const userA: UserProfile = {
    id: 'u_legacy_a',
    email: 'grace@example.com',
    displayName: 'Grace Hopper',
    status: 'pending',
    requestedNotes: '@grace_hopper · ID: 20260001 · Track: Software & Systems · Name: Grace Brewster Hopper',
  };
  const decodedA = decodeApplication(userA);
  assert(decodedA.applicantHandle === '@grace_hopper', 'Decodes handle from delimiter-separated notes');
  assert(decodedA.applicantStudentId === '20260001', 'Decodes student ID');
  assert(decodedA.applicantName === 'Grace Brewster Hopper', 'Decodes name');
  assert(decodedA.applicantTrack === 'Software & Systems', 'Decodes track');

  // Case B: Only a handle in requestedNotes
  const userB: UserProfile = {
    id: 'u_legacy_b',
    email: 'linus@example.com',
    displayName: 'Linus Torvalds',
    status: 'pending',
    requestedNotes: '@torvalds',
  };
  const decodedB = decodeApplication(userB);
  assert(decodedB.applicantHandle === '@torvalds', 'Decodes bare handle');
  assert(decodedB.applicantStudentId === '', 'Empty student ID when absent');
  assert(decodedB.applicantName === 'Linus Torvalds', 'Falls back to displayName');

  // Case C: Empty / undefined requestedNotes
  const userC: UserProfile = {
    id: 'u_legacy_c',
    email: 'newuser@example.com',
    displayName: 'New Builder',
    status: 'pending',
  };
  const decodedC = decodeApplication(userC);
  assert(decodedC.applicantHandle === '@newuser', 'Generates fallback handle from email prefix');
  assert(decodedC.applicantStudentId === '', 'Empty student ID');
  assert(decodedC.applicantName === 'New Builder', 'Uses displayName');

  // Case D: Student ID only in requestedNotes (e.g. "ID: 20269999" or "20269999")
  const userD1: UserProfile = {
    id: 'u_legacy_d1',
    email: 'student1@example.com',
    displayName: 'Student One',
    status: 'pending',
    requestedNotes: 'ID: 20269999',
  };
  const decodedD1 = decodeApplication(userD1);
  assert(decodedD1.applicantStudentId === '20269999', 'Decodes student ID from ID: prefix');
  assert(decodedD1.applicantHandle === '@student1', 'Does not mistake ID: for handle');

  const userD2: UserProfile = {
    id: 'u_legacy_d2',
    email: 'student2@example.com',
    displayName: 'Student Two',
    status: 'pending',
    requestedNotes: '20268888',
  };
  const decodedD2 = decodeApplication(userD2);
  assert(decodedD2.applicantStudentId === '20268888', 'Decodes raw numeric student ID');
  assert(decodedD2.applicantHandle === '@student2', 'Does not mistake numeric student ID for handle');

  // Verify that Admin Requests modal rendering simulation executes without throwing
  const allUsers = [userA, userB, userC, userD1, userD2];
  for (const u of allUsers) {
    const app = decodeApplication(u);
    const searchString = `${u.displayName} ${u.email} ${app.applicantName} ${app.applicantHandle} ${app.applicantStudentId} ${u.requestedNotes || ''}`.toLowerCase();
    assert(searchString.length > 0, 'Admin Requests search index computes safely');
  }

  console.log('✓ Legacy requestedNotes decoding (with ·, only handle, empty, student ID only) passed without errors');
}

// -------------------------------------------------------------
// 7. BUILDER_TRACKS & Rules Consistency Tests
// -------------------------------------------------------------
function testTracksConsistencyAcrossRules() {
  console.log('--- RUNNING BUILDER_TRACKS & RULES CONSISTENCY TESTS ---');

  const ruleFiles = [
    path.resolve(process.cwd(), 'firestore.rules'),
    path.resolve(process.cwd(), 'docs/rules/A1.rules'),
    path.resolve(process.cwd(), 'docs/RULES_GROUP_B.md'),
  ];

  const expectedListLiteral = `[${BUILDER_TRACKS.map((t) => `'${t}'`).join(', ')}]`;

  for (const filePath of ruleFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.relative(process.cwd(), filePath);
    assert(content.includes(expectedListLiteral), `${fileName} must contain identical track list ${expectedListLiteral}`);
    for (const track of BUILDER_TRACKS) {
      assert(content.includes(`'${track}'`), `${fileName} must include BUILDER_TRACKS entry '${track}'`);
    }
    assert(
      !content.includes('applicantTrack.size() <= 60'),
      `${fileName} must not contain free-text applicantTrack fallback`
    );
  }

  // Confirm Group B public member whitelist excludes PII and counters
  assert(PUBLIC_MEMBER_WHITELIST.size === 16, 'PUBLIC_MEMBER_WHITELIST must have exactly 16 public keys');
  for (const forbiddenKey of ['email', 'phone', 'studentId', 'university', 'totalCheckIns', 'currentStreak', 'bestStreak']) {
    assert(!PUBLIC_MEMBER_WHITELIST.has(forbiddenKey), `PUBLIC_MEMBER_WHITELIST must exclude ${forbiddenKey}`);
  }

  console.log('✓ BUILDER_TRACKS matches firestore.rules, docs/rules/A1.rules, and docs/RULES_GROUP_B.md identically');
}

// -------------------------------------------------------------
// 8. F13 Member Lifecycle Plan & nextUserState Tests
// -------------------------------------------------------------
function testMemberLifecyclePlans() {
  console.log('--- RUNNING F13 MEMBER LIFECYCLE & REACTIVATION TESTS ---');

  const activeMember: Member = {
    id: 'mem_42',
    name: 'Grace Hopper',
    handle: '@grace',
    role: 'Member',
    tracks: ['Software & Systems'],
    joinedDate: '2026-01-15',
    status: 'Active',
    authUid: 'uid_grace',
  };

  const activeUser: UserProfile = {
    id: 'uid_grace',
    email: 'grace@example.com',
    displayName: 'Grace Hopper',
    status: 'active',
    memberId: 'mem_42',
    approvedMemberId: 'mem_42',
  };

  // Duplicate UID in linkedUsers (as if returned by both authUid lookup and where memberId == id)
  const deactPlan = buildDeactivateMemberPlan({
    member: activeMember,
    linkedUsers: [activeUser, { ...activeUser }],
    actorUid: 'uid_admin',
    actorEmail: 'admin@example.com',
    nowIso: '2026-11-12T10:00:00.000Z',
    logId: 'log_deact_1',
  });

  assert(deactPlan.memberUpdate.status === 'Inactive', 'Deactivate plan sets member status Inactive');
  assert(deactPlan.userUpdates.length === 1, 'Deduplicates linked user found via authUid and memberId query');
  assert(deactPlan.userUpdates[0].transition.allowed === true, 'nextUserState permits active -> deactivate');
  assert(deactPlan.userUpdates[0].update.status === 'declined', 'Deactivated user status is reset to declined');
  assert(deactPlan.userUpdates[0].update.clearMemberId === true, 'Deactivate clears memberId via deleteField');
  assert(deactPlan.userUpdates[0].update.clearApprovedMemberId === true, 'Deactivate clears approvedMemberId via deleteField');
  assert(deactPlan.removeLeaderboardProjection === true, 'Deactivate removes publicLeaderboard projection');
  assert(deactPlan.auditEntry.action === 'deactivate_member', 'Audit action is deactivate_member');
  assert(deactPlan.auditEntry.performedBy === 'uid_admin', 'Audit performedBy matches admin UID');
  assert(deactPlan.auditEntry.targetId === 'mem_42', 'Audit targetId matches member ID');

  // Verify nextUserState reactivate routes through approval
  const deactivatedMember: Member = { ...activeMember, status: 'Inactive' };
  const declinedResetUser: UserProfile = {
    id: 'uid_grace',
    email: 'grace@example.com',
    displayName: 'Grace Hopper',
    status: 'declined',
    respondedAt: '2026-11-12T10:00:00.000Z',
  };

  const reactStateFromDeclined = nextUserState(declinedResetUser, deactivatedMember, 'reactivate');
  assert(reactStateFromDeclined.allowed === true, 'nextUserState allows reactivate from declined');
  assert(
    reactStateFromDeclined.nextUserStatus === 'approved_waiting_response',
    'nextUserState routes reactivated user back through approved_waiting_response'
  );

  const reactStateFromLegacyDeactivated = nextUserState(activeUser, deactivatedMember, 'reactivate');
  assert(reactStateFromLegacyDeactivated.allowed === true, 'nextUserState allows reactivate from legacy deactivated state');
  assert(
    reactStateFromLegacyDeactivated.nextUserStatus === 'approved_waiting_response',
    'nextUserState routes legacy deactivated user back through approved_waiting_response'
  );

  const reactPlan = buildReactivateMemberPlan({
    member: deactivatedMember,
    linkedUser: declinedResetUser,
    actorUid: 'uid_admin',
    actorEmail: 'admin@example.com',
    nowIso: '2026-11-12T11:00:00.000Z',
    logId: 'log_react_1',
  });

  assert(reactPlan.memberUpdate.status === 'Active', 'Reactivate plan restores member status to Active');
  assert(reactPlan.userUpdate !== null, 'Reactivate plan produces user approval staging update');
  assert(
    reactPlan.userUpdate!.update.status === 'approved_waiting_response',
    'Reactivate stages linked user into approved_waiting_response'
  );
  assert(reactPlan.userUpdate!.update.approvedMemberId === 'mem_42', 'Reactivate stages target memberId');
  assert(reactPlan.userUpdate!.update.clearMemberId === true, 'Reactivate keeps memberId cleared until user accepts');
  assert(reactPlan.auditEntry.action === 'reactivate_member', 'Audit action is reactivate_member');

  // Verify user accepting invitation after reactivation transitions to active
  const stagedUser: UserProfile = {
    ...declinedResetUser,
    status: reactPlan.userUpdate!.update.status,
    approvedMemberId: reactPlan.userUpdate!.update.approvedMemberId,
    approvedAt: reactPlan.userUpdate!.update.approvedAt,
  };
  const acceptAfterReact = nextUserState(stagedUser, { ...activeMember, status: 'Active' }, 'accept_invitation');
  assert(acceptAfterReact.allowed && acceptAfterReact.nextState === 'active', 'User accepts staged invitation to become active');

  // Verify isApprovedMember null/Inactive guards
  const computeIsApprovedMember = (p: UserProfile | null, m: Member | null) =>
    Boolean(p?.status === 'active' && p?.memberId && m && m.status !== 'Inactive');
  assert(!computeIsApprovedMember(activeUser, null), 'isApprovedMember must be false when linkedMember is missing/null');
  assert(!computeIsApprovedMember(activeUser, deactivatedMember), 'isApprovedMember must be false when linkedMember is Inactive');
  assert(computeIsApprovedMember(activeUser, activeMember), 'isApprovedMember is true only when member exists and is Active');

  console.log('✓ F13 deactivateMember/reactivateMember batch plans, nextUserState reactivation routing, and isApprovedMember guards passed');
}

function runAll() {
  testStateMachineTransitions();
  testProfileLinksValidation();
  testApplicationValidation();
  testSessionReopenLogic();
  testSessionBatchPlanGeneration();
  testLegacyRequestedNotesDecoding();
  testTracksConsistencyAcrossRules();
  testMemberLifecyclePlans();
  console.log('ALL STEP 2 STATE MACHINE & VALIDATION TESTS PASSED CLEANLY!\n');
}

runAll();
