import fs from 'node:fs';
import path from 'node:path';
import { Timestamp } from 'firebase/firestore';
import { getSessionState, getTargetSession } from '../src/utils/sessionWindow';
import { encodeSessionQRPayload, encodeMemberPassPayload, parseScannedQR } from '../src/utils/qrUtils';
import { generateSecureToken, formatBackupCode, normalizeTokenInput } from '../src/utils/token';
import {
  buildCompleteSessionBatchPlan,
  buildReopenSessionBatchPlan,
  buildSoftDeleteSessionBatchPlan,
  buildPermanentDeleteSessionOpsPlan,
  buildDeleteCheckInBatchPlan,
} from '../src/utils/sessionPlans';
import { getSubscriptionPlan } from '../src/utils/listenerScope';
import {
  prepareSessionMigration,
  createSessionPayload,
  isSessionRescheduled,
} from '../src/utils/sessionValidation';
import {
  CheckInStoreAdapter,
  executeSelfCheckInWithStore,
  executeManualCheckInWithStore,
} from '../src/utils/checkInFlow';
import {
  createInitialKioskTokenState,
  stepKioskRotation,
  detectActiveRemoteKiosk,
  shouldTriggerKioskTickRotation,
} from '../src/utils/kioskRotation';
import {
  computeClockOffsetMs,
  setServerOffsetMs,
  resetServerTimeOffset,
  getCorrectedNowMs,
  syncServerTimeOffset,
} from '../src/utils/serverTime';
import { TOKEN_ALPHABET, TOKEN_LENGTH } from '../src/config/constants';
import { CheckInRecord, Member, Session } from '../src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

// -------------------------------------------------------------
// 1. F20 Finding H: Scheduled session window & status evaluation
// -------------------------------------------------------------
function testFindingHSessionWindowStates() {
  console.log('--- RUNNING F20 FINDING H SESSION STATE TESTS ---');

  const startMs = Date.UTC(2026, 10, 15, 18, 0, 0); // 18:00 UTC
  const endMs = Date.UTC(2026, 10, 15, 20, 0, 0);   // 20:00 UTC

  const baseScheduledSession: Session = {
    id: 'sess_find_h',
    title: 'Firmware Lab',
    track: 'Hardware & Robotics',
    date: '2026-11-15',
    startTime: '18:00',
    endTime: '20:00',
    startAt: Timestamp.fromMillis(startMs),
    endAt: Timestamp.fromMillis(endMs),
    timezone: 'UTC',
    location: 'Lab 204',
    host: 'Guild Lead',
    description: 'Weekly firmware build lab',
    status: 'scheduled',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
  };

  // 20 min before start -> upcoming
  const stateUpcoming = getSessionState(baseScheduledSession, startMs - 20 * 60 * 1000);
  assert(stateUpcoming.phase === 'upcoming', 'Scheduled session 20m before start must be upcoming');
  assert(stateUpcoming.minutesToOpen === 5, 'Should report 5 minutes until check-in opens');

  // Inside check-in window even though status === 'scheduled' -> open!
  const stateOpenEarly = getSessionState(baseScheduledSession, startMs - 10 * 60 * 1000);
  assert(stateOpenEarly.phase === 'open', 'Finding H: scheduled session inside openMinutesBefore window must be open');
  assert(!stateOpenEarly.isLate(new Date(startMs - 10 * 60 * 1000)), 'Should not be late before startAt');

  // Inside graceMinutesAfter -> still open, marked late
  const stateGrace = getSessionState(baseScheduledSession, endMs + 15 * 60 * 1000);
  assert(stateGrace.phase === 'open', 'Session inside graceMinutesAfter window must still be open');
  assert(stateGrace.isLate(new Date(endMs + 15 * 60 * 1000)), 'Attendance inside grace period must be marked late');

  // Past endAt + graceMinutesAfter -> closed
  const stateAfterGrace = getSessionState(baseScheduledSession, endMs + 31 * 60 * 1000);
  assert(stateAfterGrace.phase === 'closed', 'Session after endAt + graceMinutesAfter must be closed');

  // Forced checkInMode: 'closed' or status: 'completed' -> closed even during scheduled hours
  assert(
    getSessionState({ ...baseScheduledSession, status: 'completed' }, startMs + 5 * 60 * 1000).phase === 'closed',
    'Completed session must be closed regardless of clock'
  );
  assert(
    getSessionState({ ...baseScheduledSession, checkInMode: 'closed' }, startMs + 5 * 60 * 1000).phase === 'closed',
    'checkInMode=closed must close session regardless of clock'
  );

  // Forced cancelled -> cancelled
  assert(
    getSessionState({ ...baseScheduledSession, status: 'cancelled' }, startMs + 5 * 60 * 1000).phase === 'cancelled',
    'Cancelled session must return cancelled phase'
  );

  // Forced checkInMode: 'open' -> open even outside window
  assert(
    getSessionState({ ...baseScheduledSession, checkInMode: 'open' }, startMs - 120 * 60 * 1000).phase === 'open',
    'checkInMode=open overrides upcoming window'
  );

  // getTargetSession prefers open > upcoming > fallback
  const target = getTargetSession(
    [
      { ...baseScheduledSession, id: 'sess_closed', status: 'completed' },
      { ...baseScheduledSession, id: 'sess_open', checkInMode: 'open' },
    ],
    startMs - 120 * 60 * 1000
  );
  assert(target?.id === 'sess_open', 'getTargetSession selects open session first');

  console.log('✓ F20 Finding H session state & window evaluation tests passed');
}

// -------------------------------------------------------------
// 2. F2 / F3 / F5: QR Payload, Deep Links, Backup Codes & Token Rotation
// -------------------------------------------------------------
function testQrDeepLinkAndBackupCodes() {
  console.log('--- RUNNING QR, DEEP-LINK & BACKUP CODE PARSING TESTS ---');

  // Token generation & backup formatting
  const tok = generateSecureToken();
  assert(tok.length === TOKEN_LENGTH, `Generated token length must be ${TOKEN_LENGTH}`);
  for (const ch of tok) {
    assert(TOKEN_ALPHABET.includes(ch), `Token char ${ch} must belong to unambiguous alphabet`);
  }
  const formatted = formatBackupCode(tok);
  assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(formatted), 'formatBackupCode must output XXXX-XXXX');
  assert(normalizeTokenInput(formatted) === tok, 'normalizeTokenInput round-trips formatted backup code');

  // Deep-link URL round-trip (?s=&t=)
  const qrPayloadUrl = encodeSessionQRPayload('sess_abc_123', tok);
  assert(qrPayloadUrl.includes(`?s=sess_abc_123&t=${tok}`), 'QR URL encodes ?s=...&t=...');
  const parsedUrl = parseScannedQR(qrPayloadUrl);
  assert(parsedUrl.kind === 'session', 'parseScannedQR identifies session deep link');
  assert(parsedUrl.sessionId === 'sess_abc_123', 'parseScannedQR extracts sessionId');
  assert(parsedUrl.token === tok, 'parseScannedQR extracts rotating token');

  // Legacy query variants (?sessionId=&token= and ?s=&checkin=)
  const legacyVariant = parseScannedQR('https://hub.example.com/?sessionId=sess_leg&token=ABCD2345');
  assert(legacyVariant.kind === 'session' && legacyVariant.sessionId === 'sess_leg' && legacyVariant.token === 'ABCD2345', 'Supports ?sessionId=&token=');

  // Backup code parsing (with/without hyphen, lowercase)
  const parsedHyphenBackup = parseScannedQR('ab34-cd56');
  assert(parsedHyphenBackup.kind === 'backup_code' && parsedHyphenBackup.token === 'AB34CD56', 'Parses hyphenated backup code cleanly');

  const parsedPlainBackup = parseScannedQR('XY78ZK29');
  assert(parsedPlainBackup.kind === 'backup_code' && parsedPlainBackup.token === 'XY78ZK29', 'Parses plain 8-char backup code cleanly');

  // Member pass JSON payload
  const passJson = encodeMemberPassPayload('mem_builder_9', '@builder9');
  const parsedPass = parseScannedQR(passJson);
  assert(parsedPass.kind === 'member' && parsedPass.memberId === 'mem_builder_9', 'Parses door-staff member pass JSON');

  // Direct mem_ ID scan
  const parsedMemId = parseScannedQR('mem_direct_77');
  assert(parsedMemId.kind === 'member' && parsedMemId.memberId === 'mem_direct_77', 'Parses mem_ direct ID');

  // Unknown noise
  assert(parseScannedQR('random invalid text').kind === 'unknown', 'Rejects non-matching strings as unknown');

  console.log('✓ QR deep-link, rotating token & backup code tests passed');
}

// -------------------------------------------------------------
// 3. F4 / F6: DIRECT_VERIFIED removal & atomic check-in routing audit
// -------------------------------------------------------------
function testDirectVerifiedRemovedAndCheckInWiring() {
  console.log('--- RUNNING DIRECT_VERIFIED REMOVAL & CHECK-IN WIRING CHECKS ---');

  const srcDir = path.resolve(process.cwd(), 'src');
  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : [full];
    });
  };
  const srcFiles = walk(srcDir).filter((f) => /\.(ts|tsx)$/.test(f));

  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert(!content.includes('DIRECT_VERIFIED'), `Source file ${path.relative(srcDir, file)} must NOT reference DIRECT_VERIFIED`);
    assert(!content.includes('Rahat Mahadi'), `Source file ${path.relative(srcDir, file)} must NOT contain hardcoded host Rahat Mahadi`);
    assert(!content.includes('DEMO_LEADERBOARD'), `Source file ${path.relative(srcDir, file)} must NOT reference DEMO_LEADERBOARD`);
  }

  // Verify App.tsx only passes operatorUid when method === 'manual_entry'
  const appSrc = fs.readFileSync(path.join(srcDir, 'App.tsx'), 'utf8');
  assert(
    appSrc.includes("isAdmin && method === 'manual_entry' ? user?.uid : undefined"),
    'App.tsx must pass operatorUid only for admin manual_entry (never for admin self check-in)'
  );

  // Verify QRScannerModal consumes pending deep link via getPendingCheckIn / clearPendingCheckIn
  const scannerSrc = fs.readFileSync(path.join(srcDir, 'components/QRScannerModal.tsx'), 'utf8');
  assert(
    scannerSrc.includes('getPendingCheckIn') && scannerSrc.includes('clearPendingCheckIn'),
    'QRScannerModal must consume and clear stored deep-link check-in params after sign-in'
  );
  assert(
    scannerSrc.includes('getSessionState'),
    'QRScannerModal must evaluate session window using getSessionState (Finding H)'
  );

  // Verify complete/reopen atomic batch plans
  const completePlan = buildCompleteSessionBatchPlan('sess_p4', 'admin_1', 'admin@dob.dev');
  assert(completePlan.sessionUpdate.status === 'completed' && completePlan.sessionUpdate.checkInMode === 'closed', 'completeSession closes & completes');
  const reopenPlan = buildReopenSessionBatchPlan('sess_p4', 'auto', 'admin_1', 'admin@dob.dev');
  assert(reopenPlan.sessionUpdate.status === 'scheduled' && reopenPlan.sessionUpdate.checkInMode === 'auto', 'reopenSession resets scheduled & auto');

  console.log('✓ DIRECT_VERIFIED removal, deep-link wiring & session completion checks passed');
}

// -------------------------------------------------------------
// 4. F11: Listener Scoping Planner
// -------------------------------------------------------------
function testListenerScopingPlan() {
  console.log('--- RUNNING F11 LISTENER SCOPING TESTS ---');

  // Unauthenticated guest: leaderboard only
  const guestPlan = getSubscriptionPlan({
    hasUser: false,
    isAdmin: false,
    isApprovedMember: false,
    linkedMemberId: null,
  });
  assert(guestPlan.publicLeaderboard === true, 'Guest reads publicLeaderboard');
  assert(!guestPlan.userNotifications && !guestPlan.members && !guestPlan.sessions && guestPlan.checkInsMode === 'none' && !guestPlan.usersDirectory && !guestPlan.reminderSweep, 'Guest attaches zero private/club listeners');

  // Pending / declined user: user notifications only (no club roster/sessions/check-ins)
  const pendingPlan = getSubscriptionPlan({
    hasUser: true,
    isAdmin: false,
    isApprovedMember: false,
    linkedMemberId: null,
  });
  assert(pendingPlan.userNotifications === true, 'Signed-in pending user reads own notifications');
  assert(!pendingPlan.members && !pendingPlan.sessions && pendingPlan.checkInsMode === 'none' && !pendingPlan.usersDirectory && !pendingPlan.reminderSweep, 'Pending user must NOT attach members/sessions/checkIns/users/reminders listeners');

  // Active non-admin member: members + sessions + self-scoped check-ins only
  const memberPlan = getSubscriptionPlan({
    hasUser: true,
    isAdmin: false,
    isApprovedMember: true,
    linkedMemberId: 'mem_42',
  });
  assert(memberPlan.members && memberPlan.sessions, 'Approved active member reads members and sessions');
  assert(memberPlan.checkInsMode === 'self', 'Non-admin active member uses self-scoped check-ins listener');
  assert(!memberPlan.usersDirectory && !memberPlan.reminderSweep, 'Non-admin member never reads users directory or runs reminder sweep');

  // Admin: full access
  const adminPlan = getSubscriptionPlan({
    hasUser: true,
    isAdmin: true,
    isApprovedMember: false,
    linkedMemberId: null,
  });
  assert(adminPlan.members && adminPlan.sessions && adminPlan.checkInsMode === 'all' && adminPlan.usersDirectory && adminPlan.reminderSweep, 'Admin attaches full operational listeners');

  console.log('✓ F11 listener scoping planner tests passed');
}

// -------------------------------------------------------------
// 5. Idempotent Legacy Session Migration & Capacity Edge Cases
// -------------------------------------------------------------
function testSessionMigrationAndCapacityZero() {
  console.log('--- RUNNING SESSION MIGRATION & CAPACITY=0 TESTS ---');

  // Create session with explicit points: 0 and maxCapacity: 0
  const zeroConfigSession = createSessionPayload({
    id: 'sess_zero_cfg',
    title: 'Open Hack Night',
    track: 'Open Hack & Demo',
    date: '2026-11-20',
    startTime: '18:00',
    endTime: '21:00',
    location: 'Main Atrium',
    points: 0,
    maxCapacity: 0,
  });
  assert(zeroConfigSession.points === 0, 'points: 0 must be preserved (not overwritten with default 10)');
  assert(zeroConfigSession.maxCapacity === 0, 'maxCapacity: 0 must be preserved (unlimited soft cap)');

  // Legacy session missing startAt, endAt, timezone, host, checkInMode, window minutes, points
  const legacySession = {
    id: 'sess_legacy_01',
    title: 'Legacy Build Night',
    track: 'Software & Systems',
    date: '2026-10-01',
    startTime: '18:30',
    endTime: '20:30',
    location: 'Room 101',
    status: 'completed',
  };

  const firstRun = prepareSessionMigration([legacySession, zeroConfigSession]);
  assert(firstRun.totalScanned === 2, 'Scanned 2 sessions');
  assert(firstRun.itemsNeedingMigration === 1, 'Only legacy session needs migration');
  assert(firstRun.skippedCount === 1, 'Compliant zero-config session is skipped');
  assert(firstRun.items[0].addedFields.includes('startAt') && firstRun.items[0].addedFields.includes('endAt'), 'Backfills startAt & endAt');

  // Second pass on already-migrated doc -> idempotent (0 items remaining)
  const secondRun = prepareSessionMigration([firstRun.items[0].migratedDoc, zeroConfigSession]);
  assert(secondRun.itemsNeedingMigration === 0, 'Second migration run must be idempotent (0 remaining)');
  assert(secondRun.skippedCount === 2, 'Both sessions skipped after backfill');

  // Capacity soft-warning helper check (matches QRKioskView & SessionsView condition)
  const isOverSoftCapacity = (maxCapacity: number | undefined, count: number) => {
    const cap = maxCapacity ?? 0;
    return cap > 0 && count > cap;
  };
  assert(!isOverSoftCapacity(0, 50), 'maxCapacity=0 means unlimited; never triggers soft capacity warning');
  assert(!isOverSoftCapacity(25, 25), 'Equal to maxCapacity does not exceed capacity');
  assert(isOverSoftCapacity(25, 26), 'Exceeding maxCapacity > 0 triggers soft capacity warning');

  console.log('✓ Idempotent session migration & zero-capacity soft-warning tests passed');
}

// -------------------------------------------------------------
// 6. Token End-to-End & Create-First Self Check-In (Fake Data Layer)
// -------------------------------------------------------------
async function testTokenEndToEndAndCreateFirstFakeStore() {
  console.log('--- RUNNING CREATE-FIRST SELF CHECK-IN & TOKEN END-TO-END TESTS ---');

  const startMs = Date.UTC(2026, 10, 15, 18, 0, 0);
  const endMs = Date.UTC(2026, 10, 15, 20, 0, 0);
  const openSession: Session = {
    id: 'sess_e2e_1',
    title: 'Systems Sprint',
    track: 'Software & Systems',
    date: '2026-11-15',
    startTime: '18:00',
    endTime: '20:00',
    startAt: Timestamp.fromMillis(startMs),
    endAt: Timestamp.fromMillis(endMs),
    timezone: 'UTC',
    location: 'Lab 302',
    host: 'Admin Lead',
    description: 'Sprint',
    sessionCode: 'DOB-STATIC-01',
    status: 'scheduled',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 15,
  };

  // A. End-to-end token flow: QR scan, typed backup code (code_input), and deep-link
  const qrPayload = encodeSessionQRPayload('sess_e2e_1', 'K9M2P4Q7');
  const decodedScan = parseScannedQR(qrPayload);
  assert(decodedScan.kind === 'session' && decodedScan.token === 'K9M2P4Q7', 'QR scanner decodes rotating token');

  const decodedDeepLink = parseScannedQR('https://dob.club/?s=sess_e2e_1&t=H4N8R3W6');
  assert(decodedDeepLink.kind === 'session' && decodedDeepLink.sessionId === 'sess_e2e_1' && decodedDeepLink.token === 'H4N8R3W6', 'Deep-link decodes session & token');

  const decodedBackup = parseScannedQR('p7q2-m4n8');
  assert(decodedBackup.kind === 'backup_code' && decodedBackup.token === 'P7Q2M4N8', 'Backup code normalizes cleanly');

  const staticReject = parseScannedQR('DOB-STATIC-01');
  assert(staticReject.kind === 'unknown', 'Static sessionCode is NEVER recognized as an authorization token');

  const writtenRecords: CheckInRecord[] = [];
  let getExistingCalls = 0;

  const successStore: CheckInStoreAdapter = {
    isOnline: () => true,
    writeSelfCheckIn: async (_id, rec) => {
      assert(getExistingCalls === 0, 'CRITICAL: getExistingCheckIn must NEVER be called before writeSelfCheckIn');
      writtenRecords.push(rec);
    },
    getExistingCheckIn: async () => {
      getExistingCalls++;
      return null;
    },
  };

  const scanResult = await executeSelfCheckInWithStore(successStore, {
    sessionId: decodedScan.sessionId!,
    memberId: 'mem_101',
    authUid: 'uid_101',
    token: decodedScan.token!,
    session: openSession,
    method: 'camera_scan',
    checkedInAtValue: 'SERVER_TS',
    nowMs: startMs + 5 * 60 * 1000,
  });
  assert(scanResult.success && !scanResult.isDuplicate, 'Camera scan create-first succeeds');
  assert(getExistingCalls === 0, 'Zero pre-reads or post-reads on happy path');
  assert(writtenRecords[0].token === 'K9M2P4Q7' && writtenRecords[0].method === 'camera_scan', 'Written doc has exact scanned token & camera_scan method');

  const backupResult = await executeSelfCheckInWithStore(successStore, {
    sessionId: 'sess_e2e_1',
    memberId: 'mem_102',
    authUid: 'uid_102',
    token: decodedBackup.token!,
    session: openSession,
    method: 'code_input',
    checkedInAtValue: 'SERVER_TS',
    nowMs: startMs + 5 * 60 * 1000,
  });
  assert(backupResult.success && writtenRecords[1].token === 'P7Q2M4N8' && writtenRecords[1].method === 'code_input', 'code_input backup code writes exact token & method');

  const deepLinkResult = await executeSelfCheckInWithStore(successStore, {
    sessionId: decodedDeepLink.sessionId!,
    memberId: 'mem_103',
    authUid: 'uid_103',
    token: decodedDeepLink.token!,
    session: openSession,
    method: 'camera_scan',
    checkedInAtValue: 'SERVER_TS',
    nowMs: startMs + 15 * 60 * 1000, // Past lateAfterMinutes=10
  });
  assert(deepLinkResult.success && writtenRecords[2].token === 'H4N8R3W6' && writtenRecords[2].status === 'late', 'Deep-link token reaches record & marks late after lateAfterMinutes');

  // B. Duplicate check-in: write fails with permission-denied -> re-read returns existing doc -> isDuplicate: true
  let dupPreReads = 0;
  let dupWriteAttempts = 0;
  const dupStore: CheckInStoreAdapter = {
    isOnline: () => true,
    writeSelfCheckIn: async () => {
      dupWriteAttempts++;
      assert(dupPreReads === 0, 'Duplicate flow must attempt create BEFORE any getExistingCheckIn read');
      const err: any = new Error('Missing or insufficient permissions.');
      err.code = 'permission-denied';
      throw err;
    },
    getExistingCheckIn: async (checkInId) => {
      dupPreReads++;
      return {
        id: checkInId,
        sessionId: 'sess_e2e_1',
        memberId: 'mem_101',
        authUid: 'uid_101',
        method: 'camera_scan',
        status: 'present',
        monthKey: '2026-11',
        checkedInAt: new Date(startMs).toISOString(),
      };
    },
  };
  const dupRes = await executeSelfCheckInWithStore(dupStore, {
    sessionId: 'sess_e2e_1',
    memberId: 'mem_101',
    authUid: 'uid_101',
    token: 'K9M2P4Q7',
    session: openSession,
    method: 'camera_scan',
    checkedInAtValue: 'SERVER_TS',
    nowMs: startMs + 2 * 60 * 1000,
  });
  assert(dupWriteAttempts === 1 && dupPreReads === 1, 'Duplicate flow does 1 create attempt then 1 re-read');
  assert(dupRes.success && dupRes.isDuplicate === true, 'Duplicate flow reports isDuplicate cleanly');

  // C. Closed session window: rejected fast without calling store write
  let closedWrites = 0;
  let closedErr = '';
  try {
    await executeSelfCheckInWithStore(
      {
        isOnline: () => true,
        writeSelfCheckIn: async () => { closedWrites++; },
        getExistingCheckIn: async () => null,
      },
      {
        sessionId: 'sess_e2e_1',
        memberId: 'mem_101',
        authUid: 'uid_101',
        token: 'K9M2P4Q7',
        session: { ...openSession, checkInMode: 'closed' },
        method: 'camera_scan',
        checkedInAtValue: 'SERVER_TS',
        nowMs: startMs + 5 * 60 * 1000,
      }
    );
  } catch (e: any) {
    closedErr = e.message;
  }
  assert(closedWrites === 0 && closedErr.toLowerCase().includes('closed'), 'Closed session rejects before attempting write');

  // D. Expired token / Truly denied: write throws permission-denied and re-read returns null -> friendly denial error
  let expiredDeniedErr: any = null;
  let expiredRereads = 0;
  try {
    await executeSelfCheckInWithStore(
      {
        isOnline: () => true,
        writeSelfCheckIn: async () => {
          const err: any = new Error('permission-denied');
          err.code = 'permission-denied';
          throw err;
        },
        getExistingCheckIn: async () => {
          expiredRereads++;
          return null;
        },
      },
      {
        sessionId: 'sess_e2e_1',
        memberId: 'mem_101',
        authUid: 'uid_101',
        token: 'EXPRD999',
        session: openSession,
        method: 'code_input',
        checkedInAtValue: 'SERVER_TS',
        nowMs: startMs + 5 * 60 * 1000,
      }
    );
  } catch (e) {
    expiredDeniedErr = e;
  }
  assert(expiredRereads === 1, 'Permission-denied triggers single re-read to rule out duplicate');
  assert(
    expiredDeniedErr?.code === 'permission-denied' &&
      String(expiredDeniedErr?.message || '').includes('expired'),
    'Non-duplicate permission-denied surfaces friendly expired/closed/inactive error'
  );

  // E. Offline fail-fast & timeout
  let offlineMsg = '';
  try {
    await executeSelfCheckInWithStore(
      {
        isOnline: () => false,
        writeSelfCheckIn: async () => { throw new Error('Should not write offline'); },
        getExistingCheckIn: async () => null,
      },
      {
        sessionId: 'sess_e2e_1',
        memberId: 'mem_101',
        authUid: 'uid_101',
        token: 'K9M2P4Q7',
        session: openSession,
        method: 'camera_scan',
        checkedInAtValue: 'SERVER_TS',
        nowMs: startMs + 5 * 60 * 1000,
      }
    );
  } catch (e: any) {
    offlineMsg = e.message;
  }
  assert(offlineMsg.toLowerCase().includes('offline'), 'Offline fail-fast aborts immediately');

  let timeoutCode = '';
  try {
    await executeSelfCheckInWithStore(
      {
        isOnline: () => true,
        writeSelfCheckIn: () => new Promise(() => {}), // never resolves
        getExistingCheckIn: async () => null,
      },
      {
        sessionId: 'sess_e2e_1',
        memberId: 'mem_101',
        authUid: 'uid_101',
        token: 'K9M2P4Q7',
        session: openSession,
        method: 'camera_scan',
        checkedInAtValue: 'SERVER_TS',
        nowMs: startMs + 5 * 60 * 1000,
        timeoutMs: 25,
      }
    );
  } catch (e: any) {
    timeoutCode = e.code || '';
  }
  assert(timeoutCode === 'deadline-exceeded', 'Slow write triggers timeout cleanly');

  console.log('✓ Create-first self check-in & token end-to-end tests passed');
}

// -------------------------------------------------------------
// 7. Kiosk Pure Rotation & Multi-Kiosk Conflict Detection
// -------------------------------------------------------------
function testKioskRotationAndConflictDetection() {
  console.log('--- RUNNING KIOSK ROTATION & CONFLICT TESTS ---');

  // Constant generator stress test ensures initial prevToken is ALWAYS distinct & 8 chars
  const initial = createInitialKioskTokenState(() => 'AAAA2222');
  assert(initial.currentToken === 'AAAA2222', 'Initial uses generated token');
  assert(/^[A-Z0-9]{8}$/.test(initial.prevToken) && initial.prevToken !== initial.currentToken, 'First write uses distinct non-empty 8-char prevToken');

  const rotated = stepKioskRotation(initial, () => 'BBBB3333');
  assert(rotated.prevToken === 'AAAA2222' && rotated.currentToken === 'BBBB3333', 'Rotation shifts current -> prev cleanly');

  const nowMs = Date.UTC(2026, 10, 15, 19, 0, 0);

  // Another kiosk rotated 15s ago -> conflict detected
  const conflict = detectActiveRemoteKiosk({
    remoteDoc: { token: 'REMOT999', prevToken: 'OLD88888', rotatedAt: nowMs - 15_000 },
    localCurrentToken: rotated.currentToken,
    localLastWrittenToken: rotated.currentToken,
    takenOverAtMs: null,
    nowMs,
  });
  assert(conflict.conflict && conflict.remoteToken === 'REMOT999' && conflict.ageSeconds === 15, 'Detects active remote kiosk within 60s');

  // Remote doc older than 60s -> no conflict
  const stale = detectActiveRemoteKiosk({
    remoteDoc: { token: 'REMOT999', rotatedAt: nowMs - 65_000 },
    localCurrentToken: rotated.currentToken,
    localLastWrittenToken: rotated.currentToken,
    takenOverAtMs: null,
    nowMs,
  });
  assert(!stale.conflict, 'Ignores stale remote token older than 60s');

  // Matching local token -> no conflict
  const own = detectActiveRemoteKiosk({
    remoteDoc: { token: rotated.currentToken, rotatedAt: nowMs - 5_000 },
    localCurrentToken: rotated.currentToken,
    localLastWrittenToken: rotated.currentToken,
    takenOverAtMs: null,
    nowMs,
  });
  assert(!own.conflict, 'Does not flag own kiosk token write as conflict');

  // Pre-takeover token ignored after Take Over Kiosk clicked
  const afterTakeOver = detectActiveRemoteKiosk({
    remoteDoc: { token: 'REMOT999', rotatedAt: nowMs - 5_000 },
    localCurrentToken: rotated.currentToken,
    localLastWrittenToken: rotated.currentToken,
    takenOverAtMs: nowMs - 2_000,
    nowMs,
  });
  assert(!afterTakeOver.conflict, 'Take-over timestamp suppresses older remote writes');

  // Single-flight tick gate: max 1 rotation per interval & pauses on conflict
  assert(
    !shouldTriggerKioskTickRotation({
      isOpen: true,
      isAdmin: true,
      hasConflict: true,
      isInFlight: false,
      lastRotationAtMs: nowMs - 45_000,
      nowMs,
      intervalMs: 45_000,
    }),
    'Halts rotation while remote kiosk conflict is active'
  );
  assert(
    !shouldTriggerKioskTickRotation({
      isOpen: true,
      isAdmin: true,
      hasConflict: false,
      isInFlight: false,
      lastRotationAtMs: nowMs - 44_000,
      nowMs,
      intervalMs: 45_000,
    }),
    'Enforces 1 rotation per full interval (44s < 45s rejected)'
  );
  assert(
    shouldTriggerKioskTickRotation({
      isOpen: true,
      isAdmin: true,
      hasConflict: false,
      isInFlight: false,
      lastRotationAtMs: nowMs - 45_000,
      nowMs,
      intervalMs: 45_000,
    }),
    'Allows rotation when interval elapsed cleanly'
  );

  // Confirm QRKioskView has NO rotateToken inside setCountdown updater
  const kioskSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/QRKioskView.tsx'), 'utf8');
  assert(!/setCountdown\([\s\S]{0,120}rotateToken/.test(kioskSrc), 'QRKioskView must NOT call rotateToken inside setCountdown state updater');

  console.log('✓ Kiosk rotation & conflict detection tests passed');
}

// -------------------------------------------------------------
// 8. Server Time Offset (/api/time) & Present/Late Shift
// -------------------------------------------------------------
async function testServerTimeOffsetAndBoundary() {
  console.log('--- RUNNING SERVER TIME OFFSET TESTS ---');
  resetServerTimeOffset();

  const offset = computeClockOffsetMs(1_000_000, 1_900_100, 1_000_200);
  assert(offset === 900_000, 'Computes RTT-midpoint clock offset (+15m)');

  const serverTime = Date.UTC(2026, 10, 15, 18, 12, 0); // 12m after 18:00 -> late!
  const mockFetch = (async () => ({
    ok: true,
    json: async () => ({ nowMs: serverTime }),
  })) as unknown as typeof fetch;

  // Simulate local clock lagging behind server by setting explicit offset after sync check
  await syncServerTimeOffset(mockFetch);
  setServerOffsetMs(15 * 60 * 1000); // client clock 15 min slow -> server is +15m ahead

  const startMs = Date.UTC(2026, 10, 15, 18, 0, 0);
  const localClockMs = startMs - 2 * 60 * 1000; // Local clock claims 17:58 (present), server clock is 18:13 (late!)
  const correctedNow = getCorrectedNowMs(localClockMs);
  assert(correctedNow === startMs + 13 * 60 * 1000, 'Corrected clock adds server offset');

  const sess: Session = {
    id: 'sess_time_1',
    title: 'Clock Test',
    track: 'Software & Systems',
    date: '2026-11-15',
    startTime: '18:00',
    endTime: '20:00',
    startAt: Timestamp.fromMillis(startMs),
    endAt: Timestamp.fromMillis(startMs + 2 * 60 * 60 * 1000),
    timezone: 'UTC',
    location: 'Lab',
    host: 'Host',
    description: 'Desc',
    status: 'scheduled',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
  };

  assert(!getSessionState(sess, localClockMs).isLate(), 'Uncorrected slow client clock thinks present');
  assert(getSessionState(sess, correctedNow).isLate(), 'Server-offset clock correctly evaluates late (>10m)');

  resetServerTimeOffset();
  console.log('✓ Server time offset & present/late decision tests passed');
}

// -------------------------------------------------------------
// 9. Client vs Firestore Rules Parity Matrix (getSessionState === sessionOpen)
// -------------------------------------------------------------
function testClientRulesParityMatrix() {
  console.log('--- RUNNING CLIENT VS RULES PARITY MATRIX ---');

  const startMs = Date.UTC(2026, 10, 15, 18, 0, 0);
  const endMs = Date.UTC(2026, 10, 15, 20, 0, 0);

  const mkSession = (overrides: Partial<Session>): Session => ({
    id: 'sess_parity',
    title: 'Parity Session',
    track: 'Software & Systems',
    date: '2026-11-15',
    startTime: '18:00',
    endTime: '20:00',
    startAt: Timestamp.fromMillis(startMs),
    endAt: Timestamp.fromMillis(endMs),
    timezone: 'UTC',
    location: 'Room 101',
    host: 'Lead',
    description: 'Desc',
    status: 'scheduled',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    ...overrides,
    points: overrides.points ?? 10,
  });

  // Exact Firestore rule `sessionOpen` mirror for parity assertion
  const ruleSessionOpen = (s: Partial<Session>, nowMs: number): boolean => {
    if (s.status === 'cancelled' || s.status === 'completed') return false;
    const mode = s.checkInMode ?? 'auto';
    if (mode === 'closed') return false;
    if (mode === 'open') return true;
    const openBefore = (s.openMinutesBefore ?? 15) * 60 * 1000;
    const graceAfter = (s.graceMinutesAfter ?? 30) * 60 * 1000;
    const sStart = (s.startAt as Timestamp).toMillis();
    const sEnd = (s.endAt as Timestamp).toMillis();
    return nowMs >= sStart - openBefore && nowMs <= sEnd + graceAfter;
  };

  const cases: { label: string; session: Session; atMs: number; expectedPhase: string }[] = [
    { label: 'cancelled + mode=open during hours -> closed/cancelled', session: mkSession({ status: 'cancelled', checkInMode: 'open' }), atMs: startMs + 60_000, expectedPhase: 'cancelled' },
    { label: 'completed + mode=open during hours -> closed', session: mkSession({ status: 'completed', checkInMode: 'open' }), atMs: startMs + 60_000, expectedPhase: 'closed' },
    { label: 'scheduled + mode=closed during hours -> closed', session: mkSession({ checkInMode: 'closed' }), atMs: startMs + 60_000, expectedPhase: 'closed' },
    { label: 'scheduled + mode=open 2h early -> open', session: mkSession({ checkInMode: 'open' }), atMs: startMs - 120 * 60_000, expectedPhase: 'open' },
    { label: 'scheduled + mode=auto 20m early -> upcoming (closed in rules)', session: mkSession({ checkInMode: 'auto' }), atMs: startMs - 20 * 60_000, expectedPhase: 'upcoming' },
    { label: 'scheduled + mode=auto 10m early -> open', session: mkSession({ checkInMode: 'auto' }), atMs: startMs - 10 * 60_000, expectedPhase: 'open' },
    { label: 'scheduled + mode=auto +20m grace -> open', session: mkSession({ checkInMode: 'auto' }), atMs: endMs + 20 * 60_000, expectedPhase: 'open' },
    { label: 'scheduled + mode=auto +31m past grace -> closed', session: mkSession({ checkInMode: 'auto' }), atMs: endMs + 31 * 60_000, expectedPhase: 'closed' },
    { label: 'legacy status=active + mode=auto outside window -> upcoming (parity!)', session: mkSession({ status: 'active', checkInMode: 'auto' }), atMs: startMs - 60 * 60_000, expectedPhase: 'upcoming' },
    { label: 'legacy status=active + mode=auto inside window -> open', session: mkSession({ status: 'active', checkInMode: 'auto' }), atMs: startMs + 10 * 60_000, expectedPhase: 'open' },
    {
      label: 'omitted optional window fields use s.get defaults (15/30/10)',
      session: {
        ...mkSession({}),
        checkInMode: undefined,
        openMinutesBefore: undefined,
        graceMinutesAfter: undefined,
        lateAfterMinutes: undefined,
      },
      atMs: startMs - 15 * 60_000,
      expectedPhase: 'open',
    },
  ];

  for (const c of cases) {
    const clientState = getSessionState(c.session, c.atMs);
    const ruleAllowed = ruleSessionOpen(c.session, c.atMs);
    assert(clientState.phase === c.expectedPhase, `${c.label}: expected phase=${c.expectedPhase}, got=${clientState.phase}`);
    assert((clientState.phase === 'open') === ruleAllowed, `${c.label}: client open=${clientState.phase === 'open'} must equal rules sessionOpen=${ruleAllowed}`);
  }

  console.log(`✓ Client vs rules parity matrix passed (${cases.length}/${cases.length} cases matched)`);
}

// -------------------------------------------------------------
// 10. Reschedule Detection (incl. Location) & Strict Session Payload
// -------------------------------------------------------------
function testRescheduleAndSessionPayloadStrictness() {
  console.log('--- RUNNING RESCHEDULE & SESSION PAYLOAD TESTS ---');

  const base = { date: '2026-11-15', startTime: '18:00', endTime: '20:00', location: 'Room 302' };
  assert(!isSessionRescheduled(base, { ...base }), 'Identical schedule is not rescheduled');
  assert(isSessionRescheduled(base, { ...base, date: '2026-11-16' }), 'Date change counts as rescheduled');
  assert(isSessionRescheduled(base, { ...base, startTime: '19:00' }), 'Start time change counts as rescheduled');
  assert(isSessionRescheduled(base, { ...base, endTime: '21:00' }), 'End time change counts as rescheduled');
  assert(isSessionRescheduled(base, { ...base, location: 'Main Auditorium' }), 'Location change counts as rescheduled');

  let threwMissingDate = false;
  try {
    createSessionPayload({
      title: 'Missing Date',
      track: 'Hardware & Robotics',
      date: '',
      startTime: '18:00',
      endTime: '20:00',
      location: 'Lab',
    });
  } catch {
    threwMissingDate = true;
  }
  assert(threwMissingDate, 'createSessionPayload throws instead of falling back to Date.now() when date missing');

  console.log('✓ Reschedule detection & strict session payload tests passed');
}

// -------------------------------------------------------------
// 11. Session Soft Delete & Chunked Cascade Permanent Delete Planner
// -------------------------------------------------------------
function testSoftDeleteAndChunkedPermanentDeletePlan() {
  console.log('--- RUNNING SOFT DELETE & CHUNKED PERMANENT DELETE TESTS ---');

  const softPlan = buildSoftDeleteSessionBatchPlan('sess_soft_1', 'Hardware Build', 'admin_1', 'admin@dob.dev');
  assert(
    softPlan.sessionUpdate.status === 'cancelled' &&
      softPlan.sessionUpdate.checkInMode === 'closed' &&
      Boolean(softPlan.sessionUpdate.deletedAt) &&
      softPlan.auditEntry.action === 'delete_session',
    'Soft delete sets cancelled + closed + deletedAt + audit entry'
  );

  // Simulate 850 checkIns + 5 announcements + 1 token + 1 session + 1 audit = 858 ops -> 3 batches (<= 400 each)
  const checkInIds = Array.from({ length: 850 }, (_, i) => `sess_big_mem_${i}`);
  const announcementIds = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const permPlan = buildPermanentDeleteSessionOpsPlan({
    sessionId: 'sess_big',
    sessionTitle: 'Giant Demo Day',
    checkInIds,
    announcementIds,
    includeSessionToken: true,
    operatorUid: 'admin_1',
    operatorEmail: 'admin@dob.dev',
    maxBatchOps: 400,
  });

  assert(permPlan.totalOps === 858, `Total cascade ops should be 858, got ${permPlan.totalOps}`);
  assert(permPlan.chunkCount === 3, `858 ops should split into 3 chunks <= 400, got ${permPlan.chunkCount}`);
  for (const chunk of permPlan.chunks) {
    assert(chunk.length <= 400, 'Every batch chunk must stay <= 400 ops');
  }
  const finalChunk = permPlan.chunks[permPlan.chunks.length - 1];
  const lastOp = finalChunk[finalChunk.length - 1];
  const secondLastOp = finalChunk[finalChunk.length - 2];
  assert(secondLastOp.op === 'delete' && secondLastOp.collection === 'sessions', 'Session delete runs in final batch after check-ins');
  assert(lastOp.op === 'set_audit' && lastOp.data.action === 'delete_session', 'Audit log writes in final cascade batch');

  console.log('✓ Soft delete & chunked permanent delete planner tests passed');
}

// -------------------------------------------------------------
// 12. Manual Check-In Validation & Reasoned Check-In Delete Plan
// -------------------------------------------------------------
async function testManualCheckInAndDeleteCheckInPlan() {
  console.log('--- RUNNING MANUAL CHECK-IN & REASONED DELETE TESTS ---');

  const startMs = Date.UTC(2026, 10, 15, 18, 0, 0);
  const validSession: Session = {
    id: 'sess_man_1',
    title: 'Manual Check-In Lab',
    track: 'AI & Embedded',
    date: '2026-11-15',
    startTime: '18:00',
    endTime: '20:00',
    startAt: Timestamp.fromMillis(startMs),
    endAt: Timestamp.fromMillis(startMs + 2 * 60 * 60 * 1000),
    timezone: 'UTC',
    location: 'Room 202',
    host: 'Host',
    description: 'Desc',
    status: 'scheduled',
    checkInMode: 'auto',
    openMinutesBefore: 15,
    graceMinutesAfter: 30,
    lateAfterMinutes: 10,
    points: 10,
  };
  const activeMember: Member = {
    id: 'mem_act_1',
    name: 'Grace Hopper',
    handle: '@grace',
    role: 'Member',
    tracks: ['AI & Embedded'],
    joinedDate: '2026-01-01',
    status: 'Active',
  };
  const inactiveMember: Member = { ...activeMember, id: 'mem_inact_1', status: 'Inactive' };

  // Rejects Inactive member
  let inactiveRejected = false;
  try {
    await executeManualCheckInWithStore(
      {
        writeSelfCheckIn: async () => {},
        getExistingCheckIn: async () => null,
        getMember: async () => inactiveMember,
        getSession: async () => validSession,
        writeManualCheckInBatch: async () => {},
      },
      {
        sessionId: 'sess_man_1',
        memberId: 'mem_inact_1',
        operatorUid: 'admin_uid_1',
        checkedInAtValue: 'SERVER_TIMESTAMP_SENTINEL',
        nowMs: startMs + 2 * 60_000,
      }
    );
  } catch (e: any) {
    inactiveRejected = e.message.includes('Active');
  }
  assert(inactiveRejected, 'Manual check-in rejects Inactive member');

  // Rejects missing session
  let missingSessionRejected = false;
  try {
    await executeManualCheckInWithStore(
      {
        writeSelfCheckIn: async () => {},
        getExistingCheckIn: async () => null,
        getMember: async () => activeMember,
        getSession: async () => null,
        writeManualCheckInBatch: async () => {},
      },
      {
        sessionId: 'sess_missing',
        memberId: 'mem_act_1',
        operatorUid: 'admin_uid_1',
        checkedInAtValue: 'SERVER_TIMESTAMP_SENTINEL',
        nowMs: startMs + 2 * 60_000,
      }
    );
  } catch (e: any) {
    missingSessionRejected = e.message.includes('does not exist');
  }
  assert(missingSessionRejected, 'Manual check-in rejects missing session');

  // Valid manual check-in sets verifiedBy + checkedInAt sentinel and commits single batch
  const writtenManualRecords: CheckInRecord[] = [];
  let writtenAudit = '';
  const manualRes = await executeManualCheckInWithStore(
    {
      writeSelfCheckIn: async () => {},
      getExistingCheckIn: async () => null,
      getMember: async () => activeMember,
      getSession: async () => validSession,
      writeManualCheckInBatch: async (_id, rec, auditDetails) => {
        writtenManualRecords.push(rec);
        writtenAudit = auditDetails;
      },
    },
    {
      sessionId: 'sess_man_1',
      memberId: 'mem_act_1',
      operatorUid: 'admin_uid_1',
      checkedInAtValue: 'SERVER_TIMESTAMP_SENTINEL',
      notes: '  Checked ID at door  ',
      nowMs: startMs + 2 * 60_000,
    }
  );
  const writtenManualRecord = writtenManualRecords[0];
  assert(manualRes.success && Boolean(writtenManualRecord), 'Manual check-in succeeds');
  assert(
    writtenManualRecord.verifiedBy === 'admin_uid_1' &&
      writtenManualRecord.checkedInAt === ('SERVER_TIMESTAMP_SENTINEL' as any) &&
      writtenManualRecord.method === 'manual_entry' &&
      writtenManualRecord.notes === 'Checked ID at door' &&
      writtenAudit.includes('Grace Hopper'),
    'Manual check-in sets verifiedBy, serverTimestamp sentinel, trimmed notes, and audit entry'
  );

  // Check-in deletion requires non-empty reason
  let blankReasonRejected = false;
  try {
    buildDeleteCheckInBatchPlan({
      checkInId: 'sess_man_1_mem_act_1',
      reason: '   ',
      operatorUid: 'admin_uid_1',
    });
  } catch {
    blankReasonRejected = true;
  }
  assert(blankReasonRejected, 'Check-in deletion rejects empty reason');

  const delPlan = buildDeleteCheckInBatchPlan({
    checkInId: 'sess_man_1_mem_act_1',
    reason: 'Duplicate kiosk retry recorded for wrong user',
    operatorUid: 'admin_uid_1',
    operatorEmail: 'admin@dob.dev',
  });
  assert(
    delPlan.auditEntry.action === 'delete_check_in' &&
      delPlan.auditEntry.metadata.reason === 'Duplicate kiosk retry recorded for wrong user' &&
      delPlan.auditEntry.details.includes('Duplicate kiosk retry'),
    'Check-in deletion produces single-batch delete_check_in audit with reason metadata'
  );

  console.log('✓ Manual check-in & reasoned check-in delete tests passed');
}

async function runAll() {
  const tests: { name: string; fn: () => void | Promise<void> }[] = [
    { name: 'testFindingHSessionWindowStates', fn: testFindingHSessionWindowStates },
    { name: 'testQrDeepLinkAndBackupCodes', fn: testQrDeepLinkAndBackupCodes },
    { name: 'testDirectVerifiedRemovedAndCheckInWiring', fn: testDirectVerifiedRemovedAndCheckInWiring },
    { name: 'testListenerScopingPlan', fn: testListenerScopingPlan },
    { name: 'testSessionMigrationAndCapacityZero', fn: testSessionMigrationAndCapacityZero },
    { name: 'testTokenEndToEndAndCreateFirstFakeStore', fn: testTokenEndToEndAndCreateFirstFakeStore },
    { name: 'testKioskRotationAndConflictDetection', fn: testKioskRotationAndConflictDetection },
    { name: 'testServerTimeOffsetAndBoundary', fn: testServerTimeOffsetAndBoundary },
    { name: 'testClientRulesParityMatrix', fn: testClientRulesParityMatrix },
    { name: 'testRescheduleAndSessionPayloadStrictness', fn: testRescheduleAndSessionPayloadStrictness },
    { name: 'testSoftDeleteAndChunkedPermanentDeletePlan', fn: testSoftDeleteAndChunkedPermanentDeletePlan },
    { name: 'testManualCheckInAndDeleteCheckInPlan', fn: testManualCheckInAndDeleteCheckInPlan },
  ];

  for (const t of tests) {
    await t.fn();
  }

  console.log(`ALL PHASE 4 ATTENDANCE & SESSION TESTS PASSED CLEANLY (${tests.length}/${tests.length} test suites)!\n`);
}

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
