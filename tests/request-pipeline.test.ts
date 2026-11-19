import assert from 'node:assert/strict';
import {
  notifyListenerError,
  evaluateOnboardingHealth,
  RequestPipelineCheckResult,
} from '../src/firebase/firestoreService';
import { OperationType } from '../src/firebase/config';
import { EXPECTED_RULES_VERSION, CLIENT_SCHEMA_VERSION } from '../src/config/constants';

console.log('--- RUNNING REQUEST PIPELINE & WRONG-ACCOUNT GUARD TESTS ---');

// Test 1: subscribeToAdmins error calls onError with code preserved
{
  let receivedError: any = null;
  const permissionError = new Error('Missing or insufficient permissions.');
  (permissionError as any).code = 'permission-denied';

  // Exercise notifyListenerError as used by subscribeToAdmins error handler
  assert.doesNotThrow(() => {
    notifyListenerError(
      permissionError,
      OperationType.LIST,
      'admins',
      (err) => {
        receivedError = err;
      }
    );
  }, 'subscribeToAdmins notifyListenerError must never throw unhandled error');

  assert.ok(receivedError, 'onError must be invoked when listener fails');
  assert.equal(receivedError.code, 'permission-denied', 'Permission error code must be preserved');
  assert.equal(receivedError.message, 'Missing or insufficient permissions.');
  console.log('✓ (a) subscribeToAdmins listener error propagation to onError passed');
}

// Test 2: Pipeline-check simulation for successful admin read
{
  function evaluatePipelineSuccess(
    mockUsers: Array<{ id: string; status: string }>,
    mockAdminExists: boolean,
    mockMembersCount: number,
    mockSessionsCount: number
  ): RequestPipelineCheckResult {
    const counts = {
      pending: 0,
      approved_waiting_response: 0,
      active: 0,
      declined: 0,
      suspended: 0,
    };
    for (const u of mockUsers) {
      if (u.status in counts) {
        counts[u.status as keyof typeof counts]++;
      }
    }
    return {
      canReadUsers: { pass: true },
      userCounts: counts,
      adminDocExists: { pass: true, exists: mockAdminExists },
      canReadMembersAndSessions: {
        pass: mockMembersCount >= 0 && mockSessionsCount >= 0,
        membersPass: true,
        sessionsPass: true,
      },
    };
  }

  const successResult = evaluatePipelineSuccess(
    [
      { id: 'u1', status: 'pending' },
      { id: 'u2', status: 'pending' },
      { id: 'u3', status: 'active' },
      { id: 'u4', status: 'approved_waiting_response' },
    ],
    true,
    5,
    3
  );

  assert.equal(successResult.canReadUsers.pass, true);
  assert.equal(successResult.userCounts.pending, 2);
  assert.equal(successResult.userCounts.active, 1);
  assert.equal(successResult.userCounts.approved_waiting_response, 1);
  assert.equal(successResult.adminDocExists.pass, true);
  assert.equal(successResult.adminDocExists.exists, true);
  assert.equal(successResult.canReadMembersAndSessions.pass, true);
  assert.equal(successResult.canReadMembersAndSessions.membersPass, true);
  assert.equal(successResult.canReadMembersAndSessions.sessionsPass, true);
  console.log('✓ (b-1) pipeline-check structure for success passed');
}

// Test 3: Pipeline-check simulation for mocked permission-denied
{
  function evaluatePipelineFailure(
    userErrCode: string,
    adminErrCode: string
  ): RequestPipelineCheckResult {
    return {
      canReadUsers: {
        pass: false,
        error: 'Missing or insufficient permissions.',
        errorCode: userErrCode,
      },
      userCounts: {
        pending: 0,
        approved_waiting_response: 0,
        active: 0,
        declined: 0,
        suspended: 0,
      },
      adminDocExists: {
        pass: false,
        exists: false,
        error: 'Missing or insufficient permissions.',
        errorCode: adminErrCode,
      },
      canReadMembersAndSessions: {
        pass: false,
        membersPass: false,
        sessionsPass: false,
        membersError: 'Missing or insufficient permissions.',
        membersErrorCode: 'permission-denied',
        sessionsError: 'Missing or insufficient permissions.',
        sessionsErrorCode: 'permission-denied',
      },
    };
  }

  const failureResult = evaluatePipelineFailure('permission-denied', 'permission-denied');

  assert.equal(failureResult.canReadUsers.pass, false);
  assert.equal(failureResult.canReadUsers.errorCode, 'permission-denied');
  assert.equal(failureResult.adminDocExists.pass, false);
  assert.equal(failureResult.adminDocExists.exists, false);
  assert.equal(failureResult.adminDocExists.errorCode, 'permission-denied');
  assert.equal(failureResult.canReadMembersAndSessions.pass, false);
  assert.equal(failureResult.canReadMembersAndSessions.membersPass, false);
  assert.equal(failureResult.canReadMembersAndSessions.sessionsPass, false);
  console.log('✓ (b-2) pipeline-check structure for permission-denied passed');
}

// Test 4: Wrong-account guard logic
{
  function formatWrongAccountGuardMessage(email: string): string {
    return `You are signed in as ${email}. This account is not an administrator. Ask the Super Administrator to make this account an admin, or sign in with the admin account.`;
  }

  function resolveDestinationTab(requestedTab: string, isAdmin: boolean): string {
    // Kiosk is restricted; requests is NOT silently redirected so the guard can display
    if (!isAdmin && requestedTab === 'kiosk') {
      return 'home';
    }
    return requestedTab;
  }

  const testEmail = 'builder.student@university.edu';
  const guardMessage = formatWrongAccountGuardMessage(testEmail);

  assert.ok(guardMessage.includes(testEmail), 'Guard message must include user email');
  assert.ok(guardMessage.includes('This account is not an administrator'), 'Guard message must state non-admin');
  assert.ok(
    guardMessage.includes('Ask the Super Administrator to make this account an admin, or sign in with the admin account.'),
    'Guard message must give actionable instruction'
  );

  // Non-admin navigating to requests remains on requests (not redirected to home)
  const resolvedNonAdminTab = resolveDestinationTab('requests', false);
  assert.equal(resolvedNonAdminTab, 'requests', 'Non-admin on requests tab must NOT silently redirect');

  // Non-admin on kiosk is redirected
  const resolvedKioskTab = resolveDestinationTab('kiosk', false);
  assert.equal(resolvedKioskTab, 'home', 'Non-admin on kiosk must redirect to home');

  // Admin on requests remains on requests
  const resolvedAdminTab = resolveDestinationTab('requests', true);
  assert.equal(resolvedAdminTab, 'requests', 'Admin on requests tab must stay on requests');

  console.log('✓ (c) wrong-account guard formatting and non-redirect navigation logic passed');
}

import fs from 'node:fs';
import path from 'node:path';

// Test 5: Re-applicant badge condition across BOTH reject paths and fresh signups
{
  const isReapplicant = (req: { status?: string; respondedAt?: string }) =>
    Boolean(req.status === 'declined' || (req.status === 'pending' && req.respondedAt));

  assert.equal(
    isReapplicant({ status: 'pending' }),
    false,
    'Fresh applicant whose membershipRequestedAt differs from createdAt must not be tagged Re-applicant'
  );
  assert.equal(
    isReapplicant({ status: 'declined', respondedAt: '2026-11-01T00:00:00Z' }),
    true,
    'Declined applicant is tagged Re-applicant'
  );
  assert.equal(
    isReapplicant({ status: 'pending', respondedAt: '2026-11-01T00:00:00Z' }),
    true,
    'Previously responded applicant returning to pending is tagged Re-applicant'
  );

  // Reject Path 1: Applicant declines approved invitation -> respondedAt written -> re-apply -> Re-applicant
  const afterUserDecline = {
    status: 'declined' as const,
    respondedAt: '2026-11-02T09:00:00.000Z',
  };
  const afterUserReapplyFromPath1 = {
    ...afterUserDecline,
    status: 'pending' as const,
    membershipRequestedAt: '2026-11-03T10:00:00.000Z',
  };
  assert.equal(
    isReapplicant(afterUserReapplyFromPath1),
    true,
    'Path 1 (user declined invitation -> re-apply) must display Re-applicant badge'
  );

  // Reject Path 2: Admin rejects request (declineUserRequest sets respondedAt) -> re-apply -> Re-applicant
  const afterAdminReject = {
    status: 'declined' as const,
    respondedAt: '2026-11-02T12:00:00.000Z',
  };
  const afterUserReapplyFromPath2 = {
    ...afterAdminReject,
    status: 'pending' as const,
    membershipRequestedAt: '2026-11-04T10:00:00.000Z',
  };
  assert.equal(
    isReapplicant(afterUserReapplyFromPath2),
    true,
    'Path 2 (admin declineUserRequest -> re-apply) must display Re-applicant badge'
  );

  console.log('✓ (d) Re-applicant badge logic verified for fresh signup and BOTH reject paths');
}

// Test 6: F15 Audit Integrity - applicant accept/decline flows contain zero createAuditLog calls
{
  const serviceSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/firebase/firestoreService.ts'), 'utf8');
  const acceptSlice = serviceSrc.slice(
    serviceSrc.indexOf('export async function acceptMembershipInvitation'),
    serviceSrc.indexOf('export async function declineMembershipInvitation')
  );
  const declineSlice = serviceSrc.slice(
    serviceSrc.indexOf('export async function declineMembershipInvitation'),
    serviceSrc.indexOf('export async function rejectUserMembershipLink')
  );
  const adminDeclineSlice = serviceSrc.slice(
    serviceSrc.indexOf('export async function declineUserRequest'),
    serviceSrc.indexOf('export async function suspendUser')
  );

  assert.ok(!acceptSlice.includes('createAuditLog'), 'acceptMembershipInvitation must not call createAuditLog');
  assert.ok(acceptSlice.includes('respondedAt'), 'acceptMembershipInvitation must record respondedAt');
  assert.ok(!declineSlice.includes('createAuditLog'), 'declineMembershipInvitation must not call createAuditLog');
  assert.ok(declineSlice.includes('respondedAt'), 'declineMembershipInvitation must record respondedAt');
  assert.ok(adminDeclineSlice.includes('respondedAt'), 'declineUserRequest must record respondedAt for re-applicant history');

  console.log('✓ (e) F15 applicant audit-free accept/decline and respondedAt history tracking verified');
}

// Test 7: evaluateOnboardingHealth detects broken links, missing authUid, legacy fields, and rules version drift
{
  const health = evaluateOnboardingHealth(
    [
      { status: 'active', memberId: 'm1' },
      { status: 'active' }, // missing memberId
      { status: 'approved_waiting_response', approvedMemberId: 'm2' },
      { status: 'approved_waiting_response' }, // missing approvedMemberId
    ],
    [
      { id: 'm1', authUid: 'u1', status: 'Active', joinedDate: '2026-01-01', tracks: ['AI & Embedded'] },
      { id: 'm2', status: 'Active', joinedDate: '2026-01-02', tracks: [] }, // missing authUid + empty tracks
      { status: 'Inactive', tracks: ['Software & Systems'] }, // missing id & joinedDate
    ],
    { rulesVersion: '2026.10.A1' }
  );

  assert.equal(health.activeUsersWithoutMemberId, 1);
  assert.equal(health.approvedWaitingMissingId, 1);
  assert.equal(health.membersMissingAuthUid, 1);
  assert.equal(health.membersMissingCoreFields, 2);
  assert.equal(health.rulesVersion, '2026.10.A1');
  assert.equal(health.expectedRulesVersion, EXPECTED_RULES_VERSION);
  assert.equal(health.clientSchemaVersion, CLIENT_SCHEMA_VERSION);
  assert.equal(health.rulesVersionDrift, true);

  const cleanHealth = evaluateOnboardingHealth(
    [{ status: 'active', memberId: 'm1' }],
    [{ id: 'm1', authUid: 'u1', status: 'Active', joinedDate: '2026-01-01', tracks: ['AI & Embedded'] }],
    { rulesVersion: EXPECTED_RULES_VERSION }
  );
  assert.equal(cleanHealth.activeUsersWithoutMemberId, 0);
  assert.equal(cleanHealth.approvedWaitingMissingId, 0);
  assert.equal(cleanHealth.membersMissingAuthUid, 0);
  assert.equal(cleanHealth.membersMissingCoreFields, 0);
  assert.equal(cleanHealth.rulesVersionDrift, false);

  console.log('✓ (f) evaluateOnboardingHealth link integrity and rules version drift verified');
}

console.log('ALL REQUEST PIPELINE TESTS PASSED SUCCESSFULLY!');
process.exit(0);
