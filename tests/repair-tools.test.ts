import { prepareMemberDataRepair, prepareUserStateRepair, PUBLIC_MEMBER_WHITELIST } from '../src/utils/repairTools';
import { Member, MemberPrivate, UserProfile } from '../src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

function testMemberDataRepair() {
  console.log('--- RUNNING MEMBER DATA REPAIR TESTS ---');

  const dirtyMembers: (Member & Record<string, any>)[] = [
    {
      id: 'mem_1',
      name: 'Clean Member',
      handle: '@clean',
      role: 'Member',
      tracks: ['Software & Systems'],
      joinedDate: '2026-01-01',
      status: 'Active',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'mem_2',
      name: 'Dirty Member',
      handle: '@dirty',
      role: 'Member',
      tracks: ['Hardware & Robotics'],
      joinedDate: '2026-01-01',
      status: 'Active',
      // Non-whitelisted keys that must be moved or stripped
      email: 'dirty@example.com',
      phone: '+82 10-1234-5678',
      totalCheckIns: 15,
      currentStreak: 3,
      bestStreak: 5,
    },
  ];

  const plan = prepareMemberDataRepair(dirtyMembers);
  assert(plan.length === 1, 'Only dirty member should be flagged for repair');
  assert(plan[0].memberId === 'mem_2', 'Flagged member must be mem_2');
  assert(plan[0].keysToRemoveFromPublic.includes('email'), 'email flagged');
  assert(plan[0].keysToRemoveFromPublic.includes('totalCheckIns'), 'totalCheckIns flagged');
  assert(plan[0].privateFieldsToSet.email === 'dirty@example.com', 'email preserved for private');
  assert(plan[0].privateFieldsToSet.phone === '+82 10-1234-5678', 'phone preserved for private');
  assert(plan[0].cleanedPublicData.totalCheckIns === undefined, 'cleaned doc omits totalCheckIns');
  assert(plan[0].cleanedPublicData.email === undefined, 'cleaned doc omits email');

  // Idempotence test: running repair on already clean members returns empty plan
  const cleanPlan = prepareMemberDataRepair([plan[0].cleanedPublicData as Member]);
  assert(cleanPlan.length === 0, 'Clean member returns empty repair plan');

  console.log('✓ prepareMemberDataRepair identification, private preservation, and idempotence passed');
}

function testUserStateRepair() {
  console.log('--- RUNNING USER STATE REPAIR TESTS ---');

  const members: Member[] = [
    { id: 'mem_active', name: 'Active', handle: '@active', role: 'Member', tracks: ['AI & Embedded'], joinedDate: '2026-01-01', status: 'Active' },
    { id: 'mem_inactive', name: 'Deactivated', handle: '@deact', role: 'Member', tracks: ['AI & Embedded'], joinedDate: '2026-01-01', status: 'Inactive' },
  ];

  const users: UserProfile[] = [
    // Case 1: Healthy active user
    { id: 'u1', email: 'healthy@test.com', displayName: 'Healthy', status: 'active', memberId: 'mem_active' },
    // Case 2: Active without memberId
    { id: 'u2', email: 'corrupt1@test.com', displayName: 'Corrupt 1', status: 'active' },
    // Case 3: Active with Inactive member
    { id: 'u3', email: 'corrupt2@test.com', displayName: 'Corrupt 2', status: 'active', memberId: 'mem_inactive' },
    // Case 4: Declined holding stale references
    { id: 'u4', email: 'corrupt3@test.com', displayName: 'Corrupt 3', status: 'declined', memberId: 'mem_active', approvedMemberId: 'mem_active' },
  ];

  const plan = prepareUserStateRepair(users, members);
  assert(plan.length === 3, `Expected 3 repair items, got ${plan.length}`);
  assert(plan[0].userId === 'u2' && plan[0].proposedStatus === 'declined', 'u2 reset to declined');
  assert(plan[1].userId === 'u3' && plan[1].proposedStatus === 'declined', 'u3 reset to declined');
  assert(plan[2].userId === 'u4' && plan[2].proposedMemberId === null, 'u4 cleared stale member references');

  console.log('✓ prepareUserStateRepair detected corrupt states correctly');
}

function runAll() {
  testMemberDataRepair();
  testUserStateRepair();
  console.log('ALL REPAIR TOOL TESTS PASSED CLEANLY!\n');
}

runAll();
