import { nextUserState, getUserState, UnifiedUserState, UserAction } from '../src/utils/userStateMachine';
import { validateApplication, encodeApplication, decodeApplication, isApplicationSubmitted } from '../src/utils/application';
import { normalizeGitHubUrl, normalizeLinkedInUrl, normalizePortfolioUrl } from '../src/utils/profileLinks';
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

  // Portfolio tests
  assert(normalizePortfolioUrl('').canonicalUrl === '', 'optional empty portfolio allowed');
  assert(normalizePortfolioUrl('myportfolio.dev').canonicalUrl === 'https://myportfolio.dev/', 'forces https');
  assert(!normalizePortfolioUrl('http://localhost:3000').valid, 'reject localhost');
  assert(!normalizePortfolioUrl('https://127.0.0.1/admin').valid, 'reject private loopback IP');
  assert(!normalizePortfolioUrl('https://192.168.1.1').valid, 'reject private LAN IP');
  assert(!normalizePortfolioUrl('https://user:pass@evil.com').valid, 'reject embedded credentials (user:pass)');
  assert(!normalizePortfolioUrl('https://user@legit.com').valid, 'reject user@host trick');
  assert(!normalizePortfolioUrl('javascript:alert(1)').valid, 'reject javascript in portfolio');
  assert(!normalizePortfolioUrl('data:text/html;base64,PHNjcmlwdD4=').valid, 'reject data scheme in portfolio');
  assert(!normalizePortfolioUrl('https://' + 'a'.repeat(200) + '.dev').valid, 'reject overlong portfolio URL > 200 chars');

  console.log('✓ Profile links validation, protocol hardening, credential tricks, and length guards passed');
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

function runAll() {
  testStateMachineTransitions();
  testProfileLinksValidation();
  testApplicationValidation();
  console.log('ALL STEP 2 STATE MACHINE & VALIDATION TESTS PASSED CLEANLY!\n');
}

runAll();
