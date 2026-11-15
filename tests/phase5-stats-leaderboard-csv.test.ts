/**
 * Phase 5 Behavioral Tests:
 * - toJsDate (Timestamp, { seconds, nanoseconds }, Date, number, YYYY-MM-DD, ISO)
 * - computeMemberStats (streaks, gaps, cancelled/deleted exclusion, joinedDate, points: 0, lateCount)
 * - buildPublicLeaderboardItems (Zero PII keys, Inactive/opt-out exclusion, monthlyPoints, deterministic tie-breaks)
 * - buildLeaderboardRecomputeOpsPlan (pruning + <=400 op batch chunking)
 * - calculateMonthlyStats (joins Phase 4 minimal checkIns, excludes cancelled/deleted sessions, deterministic topBuilders)
 * - csv.ts (sanitizeCSVCell formula injection defense, generateAttendanceCSV joins, generateMembersRosterCSV live stats & PII boundary, generateMonthlyReportCSV)
 */

import { toJsDate, getMonthKeyInClubTz } from '../src/utils/sessionWindow';
import {
  computeMemberStats,
  buildPublicLeaderboardItems,
  buildLeaderboardRecomputeOpsPlan,
  checkBackfillCooldown,
  getLatestLeaderboardUpdate,
  computeBackfillPreviewSummary,
  shouldTriggerDebouncedRecompute,
  AUTO_RECOMPUTE_DEBOUNCE_MS,
} from '../src/utils/stats';
import {
  sanitizeCSVCell,
  generateAttendanceCSV,
  generateMembersRosterCSV,
  generateMonthlyReportCSV,
} from '../src/utils/csv';
import { calculateMonthlyStats, formatMonthLabel } from '../src/utils/storage';
import { getSeoulMonthKey, getSeoulPreviousMonthKey } from '../src/config/tierConfig';
import type { Member, Session, CheckInRecord, MemberPrivate } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, message: string) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message} -> expected=${String(expected)}, actual=${String(actual)}`);
    failed++;
  }
}

function makeMember(overrides: Partial<Member> & { id: string }): Member {
  return {
    name: `Builder ${overrides.id}`,
    handle: `@${overrides.id}`,
    role: 'Member',
    tracks: ['Software & Systems'],
    joinedDate: '2026-10-01',
    status: 'Active',
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> & { id: string; date: string }): Session {
  const [y, m, d] = overrides.date.split('-').map(Number);
  const startAt = new Date(Date.UTC(y, m - 1, d, 9, 0, 0)); // 18:00 KST
  const endAt = new Date(Date.UTC(y, m - 1, d, 11, 0, 0)); // 20:00 KST
  return {
    title: `Session ${overrides.id}`,
    track: 'Software & Systems',
    status: 'scheduled',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
    location: 'Lab A',
    description: 'Workshop',
    host: 'Host',
    startAt: { seconds: Math.floor(startAt.getTime() / 1000), nanoseconds: 0 },
    endAt: { seconds: Math.floor(endAt.getTime() / 1000), nanoseconds: 0 },
    ...overrides,
  };
}

function runPhase5Tests() {
  console.log('\n========================================');
  console.log('PHASE 5 STATS, LEADERBOARD & CSV TESTS');
  console.log('========================================\n');

  // 1. toJsDate conversions
  console.log('1. toJsDate Timestamp & Date Normalization');
  const fromProtoTs = toJsDate({ seconds: 1760518800, nanoseconds: 500000000 });
  assertEq(fromProtoTs.getTime(), 1760518800500, 'Converts plain { seconds, nanoseconds } object accurately');

  const fromMockFirestoreTs = toJsDate({
    toDate: () => new Date('2026-10-15T09:00:00.000Z'),
  } as any);
  assertEq(
    fromMockFirestoreTs.toISOString(),
    '2026-10-15T09:00:00.000Z',
    'Calls .toDate() on Firestore Timestamp instances'
  );

  const fromDateOnly = toJsDate('2026-10-15');
  assert(
    fromDateOnly.getFullYear() === 2026 && fromDateOnly.getMonth() === 9 && fromDateOnly.getDate() === 15,
    'Parses YYYY-MM-DD without UTC day-shift regression'
  );
  assertEq(toJsDate(1760000000000).getTime(), 1760000000000, 'Converts numeric epoch milliseconds');

  // 2. computeMemberStats authoritative streaks, cancelled/deleted exclusion, points: 0, joinedDate
  console.log('\n2. computeMemberStats Authoritative Calculation');
  const alice = makeMember({ id: 'mem_alice', name: 'Alice Kim', handle: '@alice', joinedDate: '2026-10-05' });
  const now = new Date('2026-10-25T00:00:00.000Z');

  const sessions: Session[] = [
    // Before Alice joined -> must NOT break Alice's streak
    makeSession({ id: 's0_prejoin', date: '2026-10-01', points: 10 }),
    // Concluded sessions after joinedDate
    makeSession({ id: 's1', date: '2026-10-06', points: 15 }),
    makeSession({ id: 's2', date: '2026-10-08', points: 25 }),
    // Missed by Alice -> breaks streak before s4
    makeSession({ id: 's3_missed', date: '2026-10-12', points: 10 }),
    // Cancelled and soft-deleted sessions -> must NOT break streak
    makeSession({ id: 's3b_cancelled', date: '2026-10-14', status: 'cancelled', points: 10 }),
    makeSession({ id: 's3c_softdel', date: '2026-10-15', deletedAt: '2026-10-15T12:00:00Z', points: 10 }),
    // Concluded attended 0-point social hangout + regular completed session
    makeSession({ id: 's4_zero_pts', date: '2026-10-18', points: 0 }),
    // Completed override even with future endAt -> counts toward streak immediately
    makeSession({
      id: 's5_completed_early',
      date: '2026-10-20',
      status: 'completed',
      points: 20,
      startAt: { seconds: Math.floor(new Date('2026-10-28T09:00:00Z').getTime() / 1000), nanoseconds: 0 },
      endAt: { seconds: Math.floor(new Date('2026-10-28T11:00:00Z').getTime() / 1000), nanoseconds: 0 },
    }),
    // Future scheduled session -> must NOT break current streak
    makeSession({ id: 's6_future', date: '2026-11-05', points: 10 }),
  ];

  const checkIns: CheckInRecord[] = [
    { id: 's1_mem_alice', sessionId: 's1', memberId: 'mem_alice', method: 'camera_scan', status: 'present', monthKey: '2026-10' },
    { id: 's2_mem_alice', sessionId: 's2', memberId: 'mem_alice', method: 'code_input', status: 'late', monthKey: '2026-10' },
    { id: 's4_zero_pts_mem_alice', sessionId: 's4_zero_pts', memberId: 'mem_alice', method: 'camera_scan', status: 'present', monthKey: '2026-10' },
    { id: 's5_completed_early_mem_alice', sessionId: 's5_completed_early', memberId: 'mem_alice', method: 'manual_entry', verifiedBy: 'admin_1', status: 'present', monthKey: '2026-10' },
  ];

  const aliceStats = computeMemberStats(alice, sessions, checkIns, now);
  assertEq(aliceStats.total, 4, 'Counts 4 unique attended sessions');
  assertEq(aliceStats.points, 60, 'Sums exact workshop points (15 + 25 + 0 + 20 = 60, preserving points: 0)');
  assertEq(aliceStats.streak, 2, 'Current streak skips cancelled/soft-deleted/future and equals 2 (s4, s5)');
  assertEq(aliceStats.bestStreak, 2, 'Best streak matches longest consecutive run (2)');
  assertEq(aliceStats.lateCount, 1, 'Counts late arrivals accurately');

  // Legacy session without startAt/endAt whose date+endTime has already passed must count as concluded
  const legacyConcluded = makeSession({
    id: 's_legacy_past',
    date: '2026-10-10',
    startAt: undefined,
    endAt: undefined,
    startTime: '18:00',
    endTime: '20:00',
    timezone: 'Asia/Seoul',
    points: 10,
  });
  const legacyStats = computeMemberStats(
    makeMember({ id: 'mem_leg', joinedDate: '2026-10-01' }),
    [legacyConcluded],
    [],
    now
  );
  assertEq(legacyStats.streak, 0, 'Concluded legacy session without Timestamp does not use Date.now() fallback');

  // 3. buildPublicLeaderboardItems (Zero PII, Opt-out, Inactive, monthlyPoints, ranking)
  console.log('\n3. buildPublicLeaderboardItems (Zero PII, Monthly Points, Exclusion)');
  const bob = makeMember({
    id: 'mem_bob',
    name: 'Bob Lee',
    handle: '@bob',
    email: 'secret-bob@example.com',
    phone: '010-1234-5678',
    studentId: '20260001',
    authUid: 'uid_secret_bob',
    university: 'Private Univ',
    department: 'CS',
    major: 'AI',
    semester: '2026-2',
  });
  const charlieOptOut = makeMember({ id: 'mem_charlie', name: 'Charlie OptOut', handle: '@charlie', leaderboardOptOut: true });
  const daveInactive = makeMember({ id: 'mem_dave', name: 'Dave Inactive', handle: '@dave', status: 'Inactive' });

  const combinedCheckIns: CheckInRecord[] = [
    ...checkIns,
    { id: 's2_mem_bob', sessionId: 's2', memberId: 'mem_bob', method: 'camera_scan', status: 'present', monthKey: '2026-10' },
    { id: 's2_mem_bob_dup', sessionId: 's2', memberId: 'mem_bob', method: 'camera_scan', status: 'present', monthKey: '2026-10' },
    { id: 's1_mem_charlie', sessionId: 's1', memberId: 'mem_charlie', method: 'camera_scan', status: 'present', monthKey: '2026-10' },
    { id: 's1_mem_dave', sessionId: 's1', memberId: 'mem_dave', method: 'camera_scan', status: 'present', monthKey: '2026-10' },
  ];

  const pubItems = buildPublicLeaderboardItems([bob, alice, charlieOptOut, daveInactive], sessions, combinedCheckIns, now);
  assertEq(pubItems.length, 2, 'Excludes Inactive and leaderboardOptOut members from publicLeaderboard');
  assertEq(pubItems[0].id, 'mem_alice', 'Ranks Alice #1 above Bob by total points (60 vs 25)');
  assertEq(pubItems[1].monthlyPoints?.['2026-10'], 25, 'Computes authoritative non-10 monthlyPoints and deduplicates session check-ins');
  assertEq(pubItems[1].monthlyScores?.['2026-10'], 25, 'Keeps monthlyScores synchronized with monthlyPoints');

  const forbiddenPIIKeys = ['email', 'phone', 'studentId', 'authUid', 'university', 'department', 'major', 'semester'];
  const leakedKeys = pubItems.flatMap((item) =>
    forbiddenPIIKeys.filter((k) => Object.prototype.hasOwnProperty.call(item, k))
  );
  assertEq(leakedKeys.length, 0, 'Public leaderboard projection strips 100% of PII keys');

  // 4. buildLeaderboardRecomputeOpsPlan (Pruning + 400-op Batch Chunking)
  console.log('\n4. buildLeaderboardRecomputeOpsPlan (Prune & Safe <= 400 Batch Chunking)');
  const manyMembers: Member[] = Array.from({ length: 820 }, (_, i) =>
    makeMember({ id: `mem_${String(i).padStart(4, '0')}`, name: `Builder ${i}`, handle: `@b${i}` })
  );
  const scalePlan = buildLeaderboardRecomputeOpsPlan({
    members: manyMembers,
    sessions,
    checkIns: [],
    existingPublicIds: ['mem_stale_deleted', 'mem_opted_out', 'mem_0001'],
    chunkLimit: 400,
    now,
  });
  assertEq(scalePlan.setOps.length, 820, 'Plans set operations for all 820 active members');
  assertEq(scalePlan.totalRemoved, 2, 'Prunes stale and opted-out doc IDs not present in active list');
  assertEq(scalePlan.batches.length, 3, 'Splits 822 total operations cleanly across 3 batches (400 + 400 + 22)');
  assert(
    scalePlan.batches.every((b) => b.length <= 400),
    'Every batch strictly respects <= 400 op cap leaving margin under Firestore 500-op limit'
  );

  // 5. calculateMonthlyStats with minimal Phase 4 check-ins & cancelled session exclusion
  console.log('\n5. calculateMonthlyStats Minimal Phase 4 Joins & Cancelled Exclusion');
  const minimalPhase4CheckIns: CheckInRecord[] = [
    // Intentionally omits .track, .date, .memberName, .memberHandle, .sessionTitle
    { id: 's1_mem_alice', sessionId: 's1', memberId: 'mem_alice', authUid: 'u1', method: 'camera_scan', status: 'present', monthKey: '2026-10' },
    { id: 's2_mem_alice', sessionId: 's2', memberId: 'mem_alice', authUid: 'u1', method: 'code_input', status: 'late', monthKey: '2026-10' },
    // Check-in referencing soft-deleted session must be excluded from monthly metrics
    { id: 's3c_softdel_mem_bob', sessionId: 's3c_softdel', memberId: 'mem_bob', method: 'manual_entry', verifiedBy: 'admin', status: 'present', monthKey: '2026-10' },
  ];
  const monthSessionsOnly: Session[] = [
    makeSession({ id: 's1', date: '2026-10-06', track: 'AI & Embedded', points: 15 }),
    makeSession({ id: 's2', date: '2026-10-08', track: 'Hardware & Robotics', points: 25 }),
    makeSession({ id: 's3b_cancelled', date: '2026-10-14', status: 'cancelled', track: 'Open Hack & Demo', points: 10 }),
    makeSession({ id: 's3c_softdel', date: '2026-10-15', deletedAt: '2026-10-15T12:00:00Z', track: 'Open Hack & Demo', points: 10 }),
  ];
  const mStats = calculateMonthlyStats('2026-10', [bob, alice, daveInactive], monthSessionsOnly, minimalPhase4CheckIns, now);
  assertEq(mStats.totalSessions, 2, 'Excludes cancelled and soft-deleted sessions from totalSessions');
  assertEq(mStats.totalCheckIns, 2, 'Excludes check-ins to cancelled/soft-deleted sessions from month total');
  assertEq(mStats.trackBreakdown['AI & Embedded'], 1, 'Resolves track from session when checkIn lacks track');
  assertEq(mStats.trackBreakdown['Hardware & Robotics'], 1, 'Resolves second track cleanly via session join');
  assertEq(mStats.activeRatePercent, 50, 'Computes activeRatePercent over Active members only (1 of 2, excluding Inactive Dave)');
  assertEq(mStats.topBuilders[0].member.id, 'mem_alice', 'Sorts topBuilders deterministically by monthly points');
  assertEq(mStats.topBuilders[0].monthlyPoints, 40, 'Computes monthlyPoints accurately (15 + 25 = 40)');

  // 6. CSV Formula Injection & Joined Exports
  console.log('\n6. csv.ts Formula Defense & Authoritative Joins');
  assertEq(sanitizeCSVCell('=CMD()'), `"'=CMD()"`, 'Prefixes leading =');
  assertEq(sanitizeCSVCell('+1234'), `"'+1234"`, 'Prefixes leading +');
  assertEq(sanitizeCSVCell('-1234'), `"'-1234"`, 'Prefixes leading -');
  assertEq(sanitizeCSVCell('@SUM(A1)'), `"'@SUM(A1)"`, 'Prefixes leading @');
  assertEq(sanitizeCSVCell('\t=HYPERLINK()'), `"'\t=HYPERLINK()"`, 'Prefixes leading tab-formula payload');
  assertEq(sanitizeCSVCell('  =1+1'), `"'  =1+1"`, 'Prefixes space-padded formula payload');
  assertEq(sanitizeCSVCell('He said "Hi"'), `"He said ""Hi"""`, 'Escapes embedded double quotes cleanly');

  const minimalExportRecords: CheckInRecord[] = [
    {
      id: 's1_mem_alice',
      sessionId: 's1',
      memberId: 'mem_alice',
      method: 'camera_scan',
      status: 'present',
      monthKey: '2026-10',
      checkedInAt: '2026-10-06T09:05:00.000Z',
    },
  ];
  const attCsv = generateAttendanceCSV(minimalExportRecords, [alice], monthSessionsOnly);
  assert(
    attCsv.includes('"Alice Kim"') &&
      attCsv.includes(`"'@alice"`) &&
      attCsv.includes('"Session s1"') &&
      attCsv.includes('"AI & Embedded"'),
    'generateAttendanceCSV joins member name/handle (formula-escaped) & session title/track onto minimal Phase 4 checkIns'
  );

  const publicOnlyRosterCsv = generateMembersRosterCSV([bob], monthSessionsOnly, minimalPhase4CheckIns, undefined, now);
  assert(!publicOnlyRosterCsv.includes('secret-bob@example.com'), 'Roster CSV without privateDataMap excludes email');
  assert(!publicOnlyRosterCsv.includes('20260001'), 'Roster CSV without privateDataMap excludes studentId');

  const privMap = new Map<string, MemberPrivate>([
    ['mem_bob', { email: 'bob@tm.ac.kr', studentId: '20260001' }],
  ]);
  const adminRosterCsv = generateMembersRosterCSV([bob], monthSessionsOnly, minimalPhase4CheckIns, privMap, now);
  assert(
    adminRosterCsv.includes('bob@tm.ac.kr') && adminRosterCsv.includes('20260001'),
    'Admin Roster CSV includes memberPrivate PII only when privateDataMap is provided'
  );

  const reportCsv = generateMonthlyReportCSV({
    ...mStats,
    monthLabel: '=EVIL_MONTH',
  });
  assert(reportCsv.includes(`"'=EVIL_MONTH"`), 'generateMonthlyReportCSV sanitizes monthLabel against formula injection');
  assert(reportCsv.includes('"Monthly Points"'), 'generateMonthlyReportCSV includes Monthly Points column');
  assert(reportCsv.includes('"Alice Kim"'), 'generateMonthlyReportCSV includes ranked builder rows');

  // 7. Backfill Cooldown & Latest Leaderboard Sync Display
  console.log('\n7. Backfill Cooldown & Last Updated Helpers');
  const cdFirstRun = checkBackfillCooldown(null, 100_000, 60_000);
  assertEq(cdFirstRun.allowed, true, 'Allows first backfill immediately when lastSyncedAtMs is null');
  const cdBlocked = checkBackfillCooldown(100_000, 125_000, 60_000);
  assertEq(cdBlocked.allowed, false, 'Blocks backfill within 60s cooldown window');
  assertEq(cdBlocked.remainingSeconds, 35, 'Reports exact remaining cooldown seconds (35s)');
  const cdExpired = checkBackfillCooldown(100_000, 160_000, 60_000);
  assertEq(cdExpired.allowed, true, 'Allows backfill again once 60s cooldown expires');
  assertEq(
    getLatestLeaderboardUpdate([
      { ...pubItems[0], lastUpdated: '2026-10-10T09:00:00.000Z' },
      { ...pubItems[1], lastUpdated: '2026-10-12T15:30:00.000Z' },
    ]),
    '2026-10-12T15:30:00.000Z',
    'getLatestLeaderboardUpdate picks newest ISO timestamp across projection items'
  );

  // 8. UTC-vs-Asia/Seoul Month Boundary
  console.log('\n8. UTC-vs-Asia/Seoul Month Boundary Consistency');
  const seoulBoundaryUtc = new Date('2026-10-31T15:30:00.000Z'); // 2026-11-01 00:30:00 KST
  assertEq(
    getMonthKeyInClubTz(seoulBoundaryUtc),
    '2026-11',
    'getMonthKeyInClubTz shifts 2026-10-31T15:30Z to 2026-11 in Asia/Seoul'
  );
  assertEq(
    getSeoulMonthKey(seoulBoundaryUtc),
    '2026-11',
    'getSeoulMonthKey agrees with Asia/Seoul month boundary at 2026-10-31T15:30Z'
  );
  assertEq(
    getSeoulPreviousMonthKey(seoulBoundaryUtc),
    '2026-10',
    'getSeoulPreviousMonthKey returns 2026-10 when KST is 2026-11-01 00:30'
  );
  assertEq(
    formatMonthLabel('2026-11'),
    'November 2026',
    'formatMonthLabel formats 2026-11 cleanly without UTC day-shift'
  );

  // 9. Orphan Check-Ins Exclusion (Deleted Member & Deleted Session)
  console.log('\n9. Orphan Check-In Exclusion Across Stats, Leaderboard & CSV');
  const orphanCheckIns: CheckInRecord[] = [
    ...minimalPhase4CheckIns,
    // Deleted member check-in referencing valid session s1
    {
      id: 's1_mem_deleted_999',
      sessionId: 's1',
      memberId: 'mem_deleted_999',
      method: 'camera_scan',
      status: 'present',
      monthKey: '2026-10',
    },
    // Permanently deleted session check-in referencing active member alice
    {
      id: 'sess_deleted_999_mem_alice',
      sessionId: 'sess_deleted_999',
      memberId: 'mem_alice',
      method: 'camera_scan',
      status: 'present',
      monthKey: '2026-10',
    },
  ];
  const orphanMemberStats = computeMemberStats(alice, monthSessionsOnly, orphanCheckIns, now);
  assertEq(orphanMemberStats.total, 2, 'computeMemberStats excludes check-in referencing permanently deleted session');

  const orphanPub = buildPublicLeaderboardItems([alice], monthSessionsOnly, orphanCheckIns, now);
  assertEq(orphanPub.length, 1, 'buildPublicLeaderboardItems ignores deleted member mem_deleted_999');
  assertEq(orphanPub[0].totalCheckIns, 2, 'buildPublicLeaderboardItems excludes deleted session check-ins from totals');

  const orphanMonthly = calculateMonthlyStats('2026-10', [alice], monthSessionsOnly, orphanCheckIns, now);
  assertEq(orphanMonthly.totalCheckIns, 2, 'calculateMonthlyStats excludes orphan member and orphan session check-ins');

  const orphanAttCsv = generateAttendanceCSV(orphanCheckIns, [alice], monthSessionsOnly);
  assert(
    !orphanAttCsv.includes('mem_deleted_999') && !orphanAttCsv.includes('sess_deleted_999'),
    'generateAttendanceCSV excludes orphan member and deleted session rows'
  );

  // 10. Public Projection Canonical Links Gated by showLinksPublicly
  console.log('\n10. Public Projection Canonical Links Gating & Safety');
  const linkedPublicMember = makeMember({
    id: 'mem_linked_pub',
    name: 'Hannah Park',
    handle: '@hannah',
    email: 'hannah-private@example.com',
    phone: '010-9999-8888',
    studentId: '20269999',
    authUid: 'uid_hannah',
    showLinksPublicly: true,
    githubUrl: '@hannah-dev',
    linkedinUrl: 'in/hannah-park',
    portfolioUrl: 'hannah.dev',
  });
  const hiddenLinksMember = makeMember({
    id: 'mem_hidden_links',
    name: 'Ian Cho',
    handle: '@ian',
    showLinksPublicly: false,
    githubUrl: 'https://github.com/ian',
    linkedinUrl: 'https://www.linkedin.com/in/ian',
    portfolioUrl: 'https://ian.dev',
  });
  const invalidLinksMember = makeMember({
    id: 'mem_bad_links',
    name: 'Jae Kim',
    handle: '@jae',
    showLinksPublicly: true,
    githubUrl: 'javascript:alert(1)',
    linkedinUrl: 'http://evil.com/in/jae',
    portfolioUrl: 'http://insecure.example.com',
  });

  const linksPub = buildPublicLeaderboardItems(
    [linkedPublicMember, hiddenLinksMember, invalidLinksMember],
    sessions,
    [],
    now
  );
  const pubHannah = linksPub.find((i) => i.id === 'mem_linked_pub')!;
  const pubIan = linksPub.find((i) => i.id === 'mem_hidden_links')!;
  const pubJae = linksPub.find((i) => i.id === 'mem_bad_links')!;

  assertEq(pubHannah.githubUrl, 'https://github.com/hannah-dev', 'Normalizes valid GitHub handle when showLinksPublicly is true');
  assertEq(pubHannah.linkedinUrl, 'https://www.linkedin.com/in/hannah-park', 'Normalizes valid LinkedIn path when showLinksPublicly is true');
  assertEq(pubHannah.portfolioUrl, 'https://hannah.dev/', 'Normalizes valid Portfolio URL when showLinksPublicly is true');
  assert(
    !Object.prototype.hasOwnProperty.call(pubHannah, 'email') &&
      !Object.prototype.hasOwnProperty.call(pubHannah, 'phone') &&
      !Object.prototype.hasOwnProperty.call(pubHannah, 'studentId') &&
      !Object.prototype.hasOwnProperty.call(pubHannah, 'authUid'),
    'Canonical-link member still strips 100% of PII keys on public projection'
  );
  assert(
    !pubIan.githubUrl && !pubIan.linkedinUrl && !pubIan.portfolioUrl,
    'Omits all links when showLinksPublicly is false'
  );
  assert(
    !pubJae.githubUrl && !pubJae.linkedinUrl && !pubJae.portfolioUrl,
    'Omits invalid/non-HTTPS links even when showLinksPublicly is true'
  );

  // 11. First-Run Backfill Preview & 5-Minute Open-Tab Recompute Debounce
  console.log('\n11. Backfill Confirmation Summary & 5-Minute Auto-Recompute Debounce');
  const preview = computeBackfillPreviewSummary([alice, bob, charlieOptOut, daveInactive]);
  assertEq(preview.eligibleCount, 2, 'Counts eligible Active opted-in builders for backfill preview');
  assertEq(preview.excludedOptOutCount, 1, 'Counts opted-out builders excluded from backfill');
  assertEq(preview.excludedInactiveCount, 1, 'Counts Inactive builders excluded from backfill');
  assert(
    preview.fieldsWritten.includes('displayName') || preview.fieldsWritten.includes('name/displayName'),
    'Lists public fields written in confirmation prompt'
  );

  assertEq(AUTO_RECOMPUTE_DEBOUNCE_MS, 300_000, 'Auto-recompute debounce constant equals 5 minutes (300,000 ms)');
  assertEq(
    shouldTriggerDebouncedRecompute({
      isAdmin: true,
      hasSettledInitialLoad: false,
      isTabVisible: true,
      hasExistingProjection: true,
      nowMs: 500_000,
      lastAutoRecomputeAtMs: null,
    }),
    false,
    'Never auto-recomputes before initial admin app load settles'
  );
  assertEq(
    shouldTriggerDebouncedRecompute({
      isAdmin: true,
      hasSettledInitialLoad: true,
      isTabVisible: true,
      hasExistingProjection: false,
      nowMs: 500_000,
      lastAutoRecomputeAtMs: null,
    }),
    false,
    'Does not auto-write when publicLeaderboard is empty (requires admin confirmation prompt)'
  );
  assertEq(
    shouldTriggerDebouncedRecompute({
      isAdmin: true,
      hasSettledInitialLoad: true,
      isTabVisible: false,
      hasExistingProjection: true,
      nowMs: 500_000,
      lastAutoRecomputeAtMs: null,
    }),
    false,
    'Skips auto-recompute while browser tab is hidden'
  );
  assertEq(
    shouldTriggerDebouncedRecompute({
      isAdmin: true,
      hasSettledInitialLoad: true,
      isTabVisible: true,
      hasExistingProjection: true,
      nowMs: 500_000,
      lastAutoRecomputeAtMs: 300_000,
    }),
    false,
    'Blocks automatic recompute inside 5-minute debounce window (200s elapsed < 300s)'
  );
  assertEq(
    shouldTriggerDebouncedRecompute({
      isAdmin: true,
      hasSettledInitialLoad: true,
      isTabVisible: true,
      hasExistingProjection: true,
      nowMs: 600_000,
      lastAutoRecomputeAtMs: 300_000,
    }),
    true,
    'Permits automatic recompute after 5-minute debounce expires on subsequent open-tab changes'
  );

  console.log('\n========================================');
  console.log(`PHASE 5 TEST SUITE: Passed: ${passed} | Failed: ${failed}`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase5Tests();
