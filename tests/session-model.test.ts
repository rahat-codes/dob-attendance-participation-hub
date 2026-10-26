import {
  DEFAULT_SESSION_CONFIG,
  validateSessionData,
  createSessionPayload,
  dryRunMigrateSession,
} from '../src/utils/sessionValidation';
import { Timestamp } from 'firebase/firestore';

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${desc}`);
  }
}

function expectThrow(fn: () => void, desc: string, expectedMsgSubstr?: string) {
  try {
    fn();
    failed++;
    console.error(`  ❌ FAIL (Expected throw, but succeeded): ${desc}`);
  } catch (err: any) {
    if (expectedMsgSubstr && !err.message.includes(expectedMsgSubstr)) {
      failed++;
      console.error(`  ❌ FAIL (Expected message "${expectedMsgSubstr}", got "${err.message}"): ${desc}`);
    } else {
      passed++;
      console.log(`  ✅ PASS (Caught expected error): ${desc} -> "${err.message}"`);
    }
  }
}

console.log('=== Running Phase 3 Step 1: Session Model & Timing Validation Tests ===\n');

// 1. Silent Date.now() prevention
console.log('Test Group 1: No Silent Date.now() Defaults');
expectThrow(() => {
  validateSessionData({
    id: 'sess_1',
    title: 'Hardware Sprint',
    track: 'Hardware & Robotics',
    date: '2026-10-26',
    // Missing startAt and endAt
    status: 'scheduled',
    location: 'Bay 4',
  } as any);
}, 'Missing startAt must fail validation (no silent Date.now())', 'startAt');

expectThrow(() => {
  validateSessionData({
    id: 'sess_1',
    title: 'Hardware Sprint',
    track: 'Hardware & Robotics',
    date: '2026-10-26',
    startAt: Timestamp.fromMillis(1000),
    // Missing endAt
    status: 'scheduled',
    location: 'Bay 4',
  } as any);
}, 'Missing endAt must fail validation', 'endAt');

// 2. Strict Ordering (endAt > startAt)
console.log('\nTest Group 2: Temporal Ordering (endAt > startAt)');
expectThrow(() => {
  validateSessionData({
    id: 'sess_1',
    title: 'Hardware Sprint',
    track: 'Hardware & Robotics',
    date: '2026-10-26',
    startAt: Timestamp.fromMillis(5000),
    endAt: Timestamp.fromMillis(5000), // Equal
    status: 'scheduled',
    location: 'Bay 4',
    timezone: 'Asia/Seoul',
    host: 'Rahat Mahadi',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
  } as any);
}, 'Equal startAt and endAt must fail', 'endAt must be strictly after startAt');

expectThrow(() => {
  validateSessionData({
    id: 'sess_1',
    title: 'Hardware Sprint',
    track: 'Hardware & Robotics',
    date: '2026-10-26',
    startAt: Timestamp.fromMillis(8000),
    endAt: Timestamp.fromMillis(5000), // endAt < startAt
    status: 'scheduled',
    location: 'Bay 4',
    timezone: 'Asia/Seoul',
    host: 'Rahat Mahadi',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
  } as any);
}, 'endAt earlier than startAt must fail', 'endAt must be strictly after startAt');

// 3. Required Fields & Value Ranges
console.log('\nTest Group 3: Required Fields & Bounds');
expectThrow(() => {
  validateSessionData({
    id: 'sess_1',
    title: 'Hardware Sprint',
    track: 'Hardware & Robotics',
    date: '2026-10-26',
    startAt: Timestamp.fromMillis(1000),
    endAt: Timestamp.fromMillis(5000),
    status: 'scheduled',
    location: 'Bay 4',
    timezone: '', // Missing / empty timezone
    host: 'Rahat Mahadi',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
  } as any);
}, 'Empty timezone must fail', 'timezone');

expectThrow(() => {
  validateSessionData({
    id: 'sess_1',
    title: 'Hardware Sprint',
    track: 'Hardware & Robotics',
    date: '2026-10-26',
    startAt: Timestamp.fromMillis(1000),
    endAt: Timestamp.fromMillis(5000),
    status: 'scheduled',
    location: 'Bay 4',
    timezone: 'Asia/Seoul',
    host: '', // Empty host
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
  } as any);
}, 'Empty host must fail', 'host');

expectThrow(() => {
  validateSessionData({
    id: 'sess_1',
    title: 'Hardware Sprint',
    track: 'Hardware & Robotics',
    date: '2026-10-26',
    startAt: Timestamp.fromMillis(1000),
    endAt: Timestamp.fromMillis(5000),
    status: 'scheduled',
    location: 'Bay 4',
    timezone: 'Asia/Seoul',
    host: 'Lead',
    checkInMode: 'invalid_mode' as any,
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
  } as any);
}, 'Invalid checkInMode must fail', 'checkInMode');

expectThrow(() => {
  validateSessionData({
    id: 'sess_1',
    title: 'Hardware Sprint',
    track: 'Hardware & Robotics',
    date: '2026-10-26',
    startAt: Timestamp.fromMillis(1000),
    endAt: Timestamp.fromMillis(5000),
    status: 'scheduled',
    location: 'Bay 4',
    timezone: 'Asia/Seoul',
    host: 'Lead',
    checkInMode: 'auto',
    openMinutesBefore: -5, // Negative
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
  } as any);
}, 'Negative openMinutesBefore must fail', 'openMinutesBefore');

// 4. Points = 0 Allowed
console.log('\nTest Group 4: Points = 0 explicitly allowed');
const zeroPointsSession = validateSessionData({
  id: 'sess_1',
  title: 'Social Meetup (0 points)',
  track: 'Open Hack & Demo',
  date: '2026-10-26',
  startAt: Timestamp.fromMillis(10000),
  endAt: Timestamp.fromMillis(20000),
  status: 'scheduled',
  location: 'Lounge',
  timezone: 'Asia/Seoul',
  host: 'Social Lead',
  checkInMode: 'auto',
  openMinutesBefore: 15,
  graceMinutesAfter: 30,
  lateAfterMinutes: 10,
  points: 0, // Explicitly 0
});
assert(zeroPointsSession.points === 0, 'Session points 0 is preserved and not replaced by default 10/20');

// 5. Shared Default Helper
console.log('\nTest Group 5: Shared Default Helper Integration');
const constructed = createSessionPayload({
  title: 'Autonomous Drone Build',
  track: 'Hardware & Robotics',
  date: '2026-10-27',
  startTime: '18:00',
  endTime: '21:00',
  location: 'Hardware Lab',
  host: 'Rahat Mahadi',
  points: 0,
});
assert(constructed.points === 0, 'createSessionPayload preserves points=0');
assert(constructed.timezone === DEFAULT_SESSION_CONFIG.timezone, 'createSessionPayload uses shared DEFAULT_SESSION_CONFIG.timezone');
assert(constructed.openMinutesBefore === DEFAULT_SESSION_CONFIG.openMinutesBefore, 'createSessionPayload uses shared openMinutesBefore');
assert(constructed.graceMinutesAfter === DEFAULT_SESSION_CONFIG.graceMinutesAfter, 'createSessionPayload uses shared graceMinutesAfter');
assert(constructed.lateAfterMinutes === DEFAULT_SESSION_CONFIG.lateAfterMinutes, 'createSessionPayload uses shared lateAfterMinutes');
assert(constructed.checkInMode === DEFAULT_SESSION_CONFIG.checkInMode, 'createSessionPayload uses shared checkInMode');

// 6. Idempotent Dry-Run Migration
console.log('\nTest Group 6: Idempotent Dry-Run Migration');
const legacySession = {
  id: 'sess_legacy_01',
  title: 'Old Legacy Session',
  track: 'Software & Systems',
  date: '2026-09-15',
  startTime: '19:00',
  endTime: '21:00',
  location: 'Room 201',
  status: 'completed',
  // missing startAt, endAt, timezone, checkInMode, openMinutesBefore, graceMinutesAfter, lateAfterMinutes, host
};

const dryRunResult = dryRunMigrateSession(legacySession);
assert(dryRunResult.needsMigration === true, 'Legacy session flagged as needing migration');
assert(dryRunResult.migratedDoc.timezone === 'Asia/Seoul', 'Legacy session receives timezone Asia/Seoul');
assert(dryRunResult.migratedDoc.startAt !== undefined, 'Legacy session computes startAt from date and startTime');
assert(dryRunResult.migratedDoc.checkInMode === 'auto', 'Legacy session receives default checkInMode auto');
assert(dryRunResult.migratedDoc.host === 'Guild Lead', 'Legacy session receives default host');

// Running dry run on an already compliant session
const alreadyCompliant = dryRunMigrateSession(constructed);
assert(alreadyCompliant.needsMigration === false, 'Compliant session flagged as NOT needing migration (idempotent)');

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
