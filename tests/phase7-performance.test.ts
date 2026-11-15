/**
 * Phase 7 Performance & Caching Behavioral Tests:
 * - Bounded admin check-in/session query bounds & Asia/Seoul month rollover
 * - mergeBoundedWithHistory deduplication & live override semantics
 * - Reminder sweep gating (tab visibility, upcoming sessions only, <= 400 batch plan, never resurrect dismissed)
 * - Zero private data cached in localStorage, sessionStorage, IndexedDB, or Service Worker
 * - Logo optimization check (public/dob_logo.png & public/dob_logo-192.png)
 */

import fs from 'fs';
import path from 'path';
import {
  DEFAULT_ADMIN_CHECKIN_MONTHS_BACK,
  DEFAULT_ADMIN_SESSION_MONTHS_BACK,
  SERVER_AGGREGATION_THRESHOLD_DOCS,
  getBoundedCheckInStartMonthKey,
  getBoundedSessionStartDate,
  mergeBoundedWithHistory,
} from '../src/utils/listenerScope';
import {
  isTabVisible,
  filterUpcomingReminderSessions,
  buildReminderSweepPlan,
} from '../src/utils/reminders';
import {
  getStoredMembers,
  getStoredSessions,
  getStoredCheckIns,
} from '../src/utils/storage';
import type { Session, UserProfile } from '../src/types';

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

function makeSession(overrides: Partial<Session> & { id: string; date: string }): Session {
  const [y, m, d] = overrides.date.split('-').map(Number);
  const startAt = new Date(Date.UTC(y, m - 1, d, 9, 0, 0));
  const endAt = new Date(Date.UTC(y, m - 1, d, 11, 0, 0));
  return {
    title: `Session ${overrides.id}`,
    track: 'Software & Systems',
    status: 'scheduled',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
    location: 'Lab 204',
    description: 'Build session',
    host: 'Admin',
    startAt: { seconds: Math.floor(startAt.getTime() / 1000), nanoseconds: 0 },
    endAt: { seconds: Math.floor(endAt.getTime() / 1000), nanoseconds: 0 },
    ...overrides,
  };
}

function runPhase7Tests() {
  console.log('\n========================================');
  console.log('PHASE 7 PERFORMANCE & CACHING TESTS');
  console.log('========================================\n');

  // 1. Bounded Admin Query Windows & Year/TZ Boundary
  console.log('1. Bounded Admin Query Defaults & Year/Timezone Rollover');
  assertEq(DEFAULT_ADMIN_CHECKIN_MONTHS_BACK, 2, 'Default bounded check-in window covers current + prior 2 months');
  assertEq(DEFAULT_ADMIN_SESSION_MONTHS_BACK, 12, 'Default bounded session window covers prior 12 months + upcoming');
  assertEq(SERVER_AGGREGATION_THRESHOLD_DOCS, 3000, 'Documents ~3,000 check-in doc server aggregation threshold');

  const janUtc = new Date('2026-01-15T05:00:00.000Z'); // 2026-01-15 KST
  assertEq(
    getBoundedCheckInStartMonthKey(janUtc, 2),
    '2025-11',
    'getBoundedCheckInStartMonthKey crosses year boundary cleanly (2026-01 back 2 -> 2025-11)'
  );

  // 2026-03-31 15:30 UTC is already 2026-04-01 00:30 KST -> 2 months back = 2026-02
  const utcVsSeoulCutoff = new Date('2026-03-31T15:30:00.000Z');
  assertEq(
    getBoundedCheckInStartMonthKey(utcVsSeoulCutoff, 2),
    '2026-02',
    'getBoundedCheckInStartMonthKey respects Asia/Seoul month rollover at UTC-vs-KST boundary'
  );

  assertEq(
    getBoundedSessionStartDate(janUtc, 12),
    '2025-01-15',
    'getBoundedSessionStartDate steps back exactly 12 months cleanly'
  );

  // Merge historical check-ins with live listener updates
  const merged = mergeBoundedWithHistory(
    [
      { id: 'c_old', status: 'present' },
      { id: 'c_overlap', status: 'present' },
    ],
    [
      { id: 'c_overlap', status: 'late' },
      { id: 'c_new', status: 'present' },
    ]
  );
  assertEq(merged.length, 3, 'mergeBoundedWithHistory combines historical and live items without duplicates');
  assertEq(
    merged.find((item) => item.id === 'c_overlap')?.status,
    'late',
    'mergeBoundedWithHistory lets newer live record override stale historical snapshot'
  );

  // 2. 30-Minute Reminder Optimization (Visibility, Upcoming Filter, Dismissed Safety, 1 Batch)
  console.log('\n2. Reminder Sweep Visibility, Upcoming Filter & Dismissed Persistence');
  assertEq(isTabVisible({ visibilityState: 'visible' }), true, 'isTabVisible true when tab is visible');
  assertEq(isTabVisible({ visibilityState: 'hidden' }), false, 'isTabVisible false when tab is backgrounded');

  const now = new Date('2026-10-15T08:40:00.000Z'); // 20 min before 09:00 UTC session
  const sUpcoming20m = makeSession({ id: 's_up_20', date: '2026-10-15' });
  const sCancelled = makeSession({ id: 's_canc', date: '2026-10-15', status: 'cancelled' });
  const sSoftDeleted = makeSession({ id: 's_soft', date: '2026-10-15', deletedAt: '2026-10-15T08:00:00Z' });
  const sFarFuture = makeSession({ id: 's_far', date: '2026-10-20' });
  const sAlreadyStarted = makeSession({
    id: 's_started',
    date: '2026-10-15',
    startAt: { seconds: Math.floor(new Date('2026-10-15T08:30:00.000Z').getTime() / 1000), nanoseconds: 0 },
  });

  const upcomingMatches = filterUpcomingReminderSessions(
    [sUpcoming20m, sCancelled, sSoftDeleted, sFarFuture, sAlreadyStarted],
    now
  );
  assertEq(upcomingMatches.length, 1, 'filterUpcomingReminderSessions selects only active sessions starting in 1-35m');
  assertEq(upcomingMatches[0].session.id, 's_up_20', 'Selects exact matching upcoming session');
  assertEq(upcomingMatches[0].diffMinutes, 20, 'Computes exact remaining minutes until start');

  const users: UserProfile[] = Array.from({ length: 405 }, (_, idx) => ({
    id: `uid_${idx}`,
    email: `u${idx}@example.com`,
    displayName: `User ${idx}`,
    status: 'active',
  }));
  const dismissedOrExisting = new Set<string>([
    `reminder_30m_s_up_20_uid_0`,
    `reminder_30m_s_up_20_uid_1`,
  ]);
  const sweepPlan = buildReminderSweepPlan({
    upcomingSessions: [{ session: sUpcoming20m, diffMinutes: 20 }],
    eligibleUsers: users,
    existingNotificationIds: dismissedOrExisting,
    now,
    chunkLimit: 400,
  });

  assertEq(sweepPlan.skippedExistingCount, 2, 'Skips existing/dismissed deterministic reminder IDs so dismissed items never resurrect');
  assertEq(sweepPlan.writes.length, 403, 'Plans writes only for non-existing user reminders');
  assertEq(sweepPlan.batches.length, 2, 'Chunks >400 reminder writes into safe <=400 op batches (400 + 3)');
  assert(
    sweepPlan.batches.every((b) => b.length <= 400) && sweepPlan.writes[0].payload.dismissed === false,
    'Every reminder batch <= 400 ops and initializes dismissed: false'
  );

  // Oversized session title + location clamped safely within firestore.rules limits
  const longSession = makeSession({
    id: 's_long',
    date: '2026-10-15',
    title: 'X'.repeat(250),
    location: 'L'.repeat(1100),
  });
  const longPlan = buildReminderSweepPlan({
    upcomingSessions: [{ session: longSession, diffMinutes: 15 }],
    eligibleUsers: [users[0]],
    existingNotificationIds: new Set(),
    now,
  });
  assert(
    longPlan.writes[0].payload.title.length <= 150 && longPlan.writes[0].payload.message.length <= 1000,
    'Clamps notification title <= 150 and message <= 1000 chars to satisfy firestore.rules'
  );

  // 3. Cache Privacy & Asset Budget Verification
  console.log('\n3. Cache Privacy Invariants & Asset Size Verification');
  assertEq(getStoredMembers().length, 0, 'getStoredMembers returns empty array (no roster cached locally)');
  assertEq(getStoredSessions().length, 0, 'getStoredSessions returns empty array (no sessions cached locally)');
  assertEq(getStoredCheckIns().length, 0, 'getStoredCheckIns returns empty array (no attendance cached locally)');

  const storageSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/storage.ts'), 'utf-8');
  assert(
    !/\blocalStorage\.(getItem|setItem|removeItem|clear)\b/.test(storageSrc),
    'storage.ts never reads or persists private data in localStorage'
  );

  const configSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/firebase/config.ts'), 'utf-8');
  assert(!configSrc.includes('persistentLocalCache'), 'Firestore does not enable IndexedDB persistentLocalCache for private club data');

  const swSrc = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf-8');
  assert(
    swSrc.includes('self.registration.unregister()') && swSrc.includes('caches.delete'),
    'public/sw.js clears caches and unregisters instead of caching private API/Firestore responses'
  );

  const logoFullBytes = fs.statSync(path.resolve(process.cwd(), 'public/dob_logo.png')).size;
  const logo192Bytes = fs.statSync(path.resolve(process.cwd(), 'public/dob_logo-192.png')).size;
  assert(
    logoFullBytes < 100_000 && logo192Bytes < 50_000,
    `Logo assets optimized well under 100 KB (dob_logo.png=${logoFullBytes}B, dob_logo-192.png=${logo192Bytes}B)`
  );

  console.log('\n========================================');
  console.log(`PHASE 7 TEST SUITE: Passed: ${passed} | Failed: ${failed}`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase7Tests();
