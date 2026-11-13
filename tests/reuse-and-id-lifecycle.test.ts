import assert from 'node:assert/strict';
import {
  normalizeHandle,
  normalizeStudentId,
  parseApplicantNotes,
  isHandleTaken,
  isStudentIdTaken,
  findReuseCandidates,
  canReapply,
  archiveHandle,
  buildPermanentDeletePlan,
} from '../src/utils/reuseHelpers';
import { Member, UserProfile, CheckInRecord, Session } from '../src/types';
import { buildPublicLeaderboardItems } from '../src/utils/stats';

console.log('--- RUNNING REUSE & ID LIFECYCLE TESTS ---');

// Test 1: Handle normalization
{
  assert.equal(normalizeHandle('@Alex'), 'alex');
  assert.equal(normalizeHandle('alex'), 'alex');
  assert.equal(normalizeHandle('  @ALEX  '), 'alex');
  assert.equal(normalizeHandle('@@builder_1'), 'builder_1');
  assert.equal(normalizeHandle(''), '');
  console.log('✓ normalizeHandle handles case, spaces, and leading @');
}

// Test 2: isHandleTaken behavior with Active vs Inactive members
{
  const members: Member[] = [
    {
      id: 'mem_1',
      name: 'Alice Active',
      handle: '@alice',
      role: 'Member',
      tracks: ['Software & Systems'],
      joinedDate: '2026-01-01',
      status: 'Active',
      studentId: '20240001',
    },
    {
      id: 'mem_2',
      name: 'Bob Inactive',
      handle: '@bob',
      role: 'Member',
      tracks: ['Hardware & Robotics'],
      joinedDate: '2025-09-01',
      status: 'Inactive',
      studentId: '20230002',
    },
  ];

  // Active handle is taken
  const checkAlice = isHandleTaken(members, 'alice');
  assert.equal(checkAlice.taken, true);
  assert.equal(checkAlice.conflictingMember?.name, 'Alice Active');

  const checkAliceAt = isHandleTaken(members, '@ALICE');
  assert.equal(checkAliceAt.taken, true);

  // Inactive handle is NOT taken and can be reused
  const checkBob = isHandleTaken(members, 'bob');
  assert.equal(checkBob.taken, false, 'Inactive member handle must not block reuse');

  const checkBobAt = isHandleTaken(members, '@BOB');
  assert.equal(checkBobAt.taken, false, 'Inactive member handle must not block reuse');

  // ignoreMemberId allows a member to keep their own handle when updating
  const checkAliceIgnore = isHandleTaken(members, '@alice', { ignoreMemberId: 'mem_1' });
  assert.equal(checkAliceIgnore.taken, false, 'Self-handle with ignoreMemberId must not conflict');

  console.log('✓ isHandleTaken blocks Active conflicts and ignores Inactive records');
}

// Test 3: isStudentIdTaken behavior
{
  const members: Member[] = [
    {
      id: 'mem_1',
      name: 'Alice Active',
      handle: '@alice',
      role: 'Member',
      tracks: ['Software & Systems'],
      joinedDate: '2026-01-01',
      status: 'Active',
      studentId: '20240001',
    },
    {
      id: 'mem_2',
      name: 'Bob Inactive',
      handle: '@bob',
      role: 'Member',
      tracks: ['Hardware & Robotics'],
      joinedDate: '2025-09-01',
      status: 'Inactive',
      studentId: '20230002',
    },
  ];

  const checkAliceId = isStudentIdTaken(members, '20240001');
  assert.equal(checkAliceId.taken, true);

  const checkBobId = isStudentIdTaken(members, '20230002');
  assert.equal(checkBobId.taken, false, 'Inactive studentId must be reusable');

  console.log('✓ isStudentIdTaken blocks Active conflicts and frees Inactive student IDs');
}

// Test 4: findReuseCandidates matching
{
  const members: Member[] = [
    {
      id: 'mem_active',
      name: 'Active Builder',
      handle: '@active_builder',
      role: 'Member',
      tracks: ['Software & Systems'],
      joinedDate: '2026-01-01',
      status: 'Active',
      authUid: 'uid_active',
      email: 'active@example.com',
    },
    {
      id: 'mem_inactive',
      name: 'Old Bob',
      handle: '@old_bob',
      role: 'Member',
      tracks: ['Hardware & Robotics'],
      joinedDate: '2025-01-01',
      status: 'Inactive',
      studentId: '20239999',
      email: 'bob@example.com',
      totalCheckIns: 14,
    },
    {
      id: 'mem_unlinked',
      name: 'Staged Charlie',
      handle: '@charlie',
      role: 'Member',
      tracks: ['AI & Embedded'],
      joinedDate: '2026-02-01',
      status: 'Active',
      // no authUid: unlinked
      studentId: '20248888',
      email: 'charlie@example.com',
    },
  ];

  // Match by handle from notes
  const candidatesByHandle = findReuseCandidates(members, {
    requestedNotes: '@old_bob · ID: 99999999',
  });
  assert.equal(candidatesByHandle.length, 1);
  assert.equal(candidatesByHandle[0].id, 'mem_inactive');

  // Match by student ID from notes
  const candidatesById = findReuseCandidates(members, {
    requestedNotes: '@new_name · ID: 20239999',
  });
  assert.equal(candidatesById.length, 1);
  assert.equal(candidatesById[0].id, 'mem_inactive');

  // Match by email
  const candidatesByEmail = findReuseCandidates(members, {
    email: 'charlie@example.com',
  });
  assert.equal(candidatesByEmail.length, 1);
  assert.equal(candidatesByEmail[0].id, 'mem_unlinked');

  // Active linked member is never in candidates
  const candidatesActive = findReuseCandidates(members, {
    email: 'active@example.com',
    handle: '@active_builder',
  });
  assert.equal(candidatesActive.length, 0, 'Active linked member cannot be a candidate for reuse');

  console.log('✓ findReuseCandidates accurately identifies Inactive and unlinked candidates');
}

// Test 5: canReapply gating
{
  assert.equal(canReapply({ status: 'declined' } as UserProfile), true);
  assert.equal(canReapply({ status: 'pending' } as UserProfile), false);
  assert.equal(canReapply({ status: 'active' } as UserProfile), false);
  assert.equal(canReapply({ status: 'suspended' } as UserProfile), false);
  assert.equal(canReapply({ status: 'approved_waiting_response' } as UserProfile), false);
  assert.equal(canReapply(null), false);
  console.log('✓ canReapply permits re-application only for declined users');
}

// Test 6: archiveHandle formatting
{
  const fixedDate = new Date(2026, 10, 5); // Nov 5, 2026
  assert.equal(archiveHandle('@builder', fixedDate), '@builder~archived-20261105');
  assert.equal(archiveHandle('builder', fixedDate), '@builder~archived-20261105');
  console.log('✓ archiveHandle produces canonical @handle~archived-YYYYMMDD strings');
}

// Test 7: buildPermanentDeletePlan security guards & user reset
{
  const targetMember: Member = {
    id: 'mem_target',
    name: 'Target Builder',
    handle: '@target',
    role: 'Member',
    tracks: ['Software & Systems'],
    joinedDate: '2026-01-01',
    status: 'Active',
    authUid: 'uid_target',
  };

  const targetUser: UserProfile = {
    id: 'uid_target',
    email: 'target@example.com',
    displayName: 'Target Builder',
    status: 'active',
    memberId: 'mem_target',
  };

  // Guard: Super Admin cannot be deleted
  assert.throws(
    () => {
      buildPermanentDeletePlan(targetMember, targetUser, { isSuperAdmin: true });
    },
    /Cannot delete super admin/
  );

  // Guard: Administrator cannot be deleted
  assert.throws(
    () => {
      buildPermanentDeletePlan(targetMember, targetUser, { isAdmin: true });
    },
    /Cannot permanently delete an administrator/
  );

  // Valid plan
  const plan = buildPermanentDeletePlan(targetMember, targetUser);
  assert.equal(plan.memberId, 'mem_target');
  assert.equal(plan.linkedUserId, 'uid_target');
  assert.deepEqual(plan.deletions, [
    'members/mem_target',
    'memberPrivate/mem_target',
    'publicLeaderboard/mem_target',
  ]);
  assert.notEqual(plan.userReset, null);
  assert.equal(plan.userReset?.status, 'declined');
  assert.equal(plan.userReset?.deleteMemberId, true);
  assert.equal(plan.userReset?.deleteApprovedMemberId, true);

  console.log('✓ buildPermanentDeletePlan enforces admin guards and prepares clean deleteField reset');
}

// Test 8: Orphan check-ins do not affect leaderboard or active member stats
{
  const activeMembers: Member[] = [
    {
      id: 'mem_survivor',
      name: 'Survivor Builder',
      handle: '@survivor',
      role: 'Member',
      tracks: ['Software & Systems'],
      joinedDate: '2026-01-01',
      status: 'Active',
      totalCheckIns: 5,
    },
  ];

  const checkIns: CheckInRecord[] = [
    {
      id: 'chk_1',
      sessionId: 'sess_1',
      memberId: 'mem_survivor',
      checkedInAt: '2026-11-01T10:00:00Z',
      status: 'present',
      method: 'camera_scan',
      monthKey: '2026-11',
    },
    // Orphan check-in belonging to a deleted member
    {
      id: 'chk_orphan',
      sessionId: 'sess_1',
      memberId: 'mem_deleted_999',
      checkedInAt: '2026-11-01T10:05:00Z',
      status: 'present',
      method: 'camera_scan',
      monthKey: '2026-11',
    },
  ];

  const sessions: Session[] = [
    {
      id: 'sess_1',
      title: 'Workshop #1',
      track: 'Software & Systems',
      date: '2026-11-01',
      status: 'completed',
      location: 'Engineering Lab 401',
      startTime: '18:00',
      endTime: '21:00',
      points: 10,
      description: 'Test workshop',
      host: 'Lead Host',
    },
  ];

  const leaderboard = buildPublicLeaderboardItems(activeMembers, sessions, checkIns);
  assert.equal(leaderboard.length, 1, 'Orphan check-in must not create a ghost leaderboard entry');
  assert.equal(leaderboard[0].id, 'mem_survivor');
  assert.equal(leaderboard[0].totalCheckIns, 1);

  console.log('✓ Orphan check-ins do not corrupt leaderboard projection');
}

// Test 9: Complete Re-Apply Lifecycle Simulation (Delete -> Declined -> Re-apply -> Reuse Handle)
{
  // 1. Initial State: Member exists
  const members: Member[] = [
    {
      id: 'mem_reapply_test',
      name: 'Reapply Maker',
      handle: '@maker',
      role: 'Member',
      tracks: ['Hardware & Robotics'],
      joinedDate: '2026-01-01',
      status: 'Active',
      studentId: '20245555',
      authUid: 'uid_maker',
    },
  ];

  // While Active, handle is taken
  assert.equal(isHandleTaken(members, '@maker').taken, true);

  // 2. Member is permanently deleted -> removed from members array
  const remainingMembers = members.filter((m) => m.id !== 'mem_reapply_test');

  // Handle is immediately freed!
  assert.equal(isHandleTaken(remainingMembers, '@maker').taken, false);
  assert.equal(isStudentIdTaken(remainingMembers, '20245555').taken, false);

  // 3. User account is reset to 'declined'
  const user: UserProfile = {
    id: 'uid_maker',
    email: 'maker@example.com',
    displayName: 'Reapply Maker',
    status: 'declined',
    requestedNotes: '@maker · ID: 20245555',
  };

  // User is eligible to re-apply
  assert.equal(canReapply(user), true);

  // 4. Re-apply parses notes accurately
  const parsed = parseApplicantNotes(user.requestedNotes);
  assert.equal(parsed.handle, 'maker');
  assert.equal(parsed.studentId, '20245555');

  console.log('✓ Complete Re-Apply & Handle Reuse lifecycle simulation passed cleanly');
}

// Test 10: parseApplicantNotes hyphen preservation and edge cases
{
  const hyphenHandle = parseApplicantNotes('@john-doe - ID: 2026-0042 - Track: AI & Embedded - Name: Anne-Marie Smith');
  assert.equal(hyphenHandle.handle, 'john-doe', 'Hyphenated handle @john-doe must not be truncated');
  assert.equal(hyphenHandle.studentId, '2026-0042', 'Hyphenated student ID must be preserved');
  assert.equal(hyphenHandle.track, 'AI & Embedded', 'Track must be extracted cleanly');
  assert.equal(hyphenHandle.name, 'Anne-Marie Smith', 'Hyphenated name Anne-Marie Smith must not be truncated');

  const legacyDot = parseApplicantNotes('@legacy-user · ID: 20240011 · Track: Hardware & Robotics · Name: Jean-Luc Picard');
  assert.equal(legacyDot.handle, 'legacy-user');
  assert.equal(legacyDot.studentId, '20240011');
  assert.equal(legacyDot.track, 'Hardware & Robotics');
  assert.equal(legacyDot.name, 'Jean-Luc Picard');

  const empty = parseApplicantNotes('');
  assert.equal(empty.handle, '');
  assert.equal(empty.studentId, undefined);
  assert.equal(empty.name, undefined);

  const undefinedNotes = parseApplicantNotes(undefined);
  assert.equal(undefinedNotes.handle, '');

  const handleOnly = parseApplicantNotes('@solo-builder');
  assert.equal(handleOnly.handle, 'solo-builder');
  assert.equal(handleOnly.studentId, undefined);

  const idOnly = parseApplicantNotes('ID: 2026-9901');
  assert.equal(idOnly.handle, '');
  assert.equal(idOnly.studentId, '2026-9901');

  console.log('✓ parseApplicantNotes preserves hyphenated handles, names, IDs, legacy middle-dots, empty and handle-only inputs');
}

console.log('ALL REUSE & ID LIFECYCLE TESTS PASSED CLEANLY!');
