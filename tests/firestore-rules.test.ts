import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  serverTimestamp,
  Timestamp,
  deleteField,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

const PROJECT_ID = 'ai-studio-denofbuildersatt-42d7846f-ad64-451a-ad75-5301b71e1953';
const SUPER_ADMIN_EMAIL = 'rahatmdmahadihasan@gmail.com';

let testEnv: RulesTestEnvironment;

async function setupSuite() {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: rulesContent,
      host: '127.0.0.1',
      port: 8080,
    },
  });
}

/**
 * ============================================================================
 * FIRESTORE RULES EMULATOR TEST SUITE & FINDINGS VERIFICATION
 * ============================================================================
 *
 * SETTLEMENT STATE FOR FINDINGS G & H:
 *
 * FINDING G: Pre-Reading Non-Existent checkIn Record
 * - Target: In rules evaluating `resource.data.memberId == myMemberId()`, reading
 *   a non-existent document fails evaluation because `resource == null`, returning
 *   `permission-denied` instead of a 404 snapshot (`exists() === false`).
 * - Settled by Test G-1 and G-2 below:
 *   * If `getDoc(doc(db, 'checkIns', 'sess_test_mem_active_1'))` on a non-existent
 *     doc throws permission-denied under old rules: Finding G is CONFIRMED.
 *   * With the null-safe check `resource == null ? checkInId.matches(...) : ...`,
 *     `assertSucceeds` passes and `snap.exists() === false`.
 *
 * FINDING H: Client vs Rules Session Status Window Discrepancy
 * - Target: UI in QRScannerModal previously checked `session.status === 'active'`,
 *   whereas rules `sessionOpen(sid)` evaluates `s.status != 'cancelled'` and the
 *   time window [startAt - openMinutesBefore, endAt + graceMinutesAfter].
 * - Settled by Test H-1 below:
 *   * A session with `status: 'scheduled'` and checkInMode `'open'` allows
 *     check-in in security rules (`assertSucceeds`). This confirms that rules
 *     do not require `status == 'active'`, proving the client `status === 'active'`
 *     was an artificial blockage.
 */
async function runRulesTests() {
  console.log('--- Initializing Firestore Rules Test Suite (Phase 2 Hardening) ---');
  try {
    await setupSuite();
  } catch (err: any) {
    console.error(
      '❌ Firestore Emulator not running at 127.0.0.1:8080.\nRun tests inside the emulator using: `npm run emulators:exec`'
    );
    throw new Error(
      `Firestore Emulator missing at 127.0.0.1:8080. Start emulator with \`npm run emulators:exec\` to execute rules suite. (${err?.message || err})`
    );
  }

  let passed = 0;
  let failed = 0;
  const testResults: { name: string; status: 'PASS' | 'FAIL'; note?: string }[] = [];

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed++;
      testResults.push({ name, status: 'PASS' });
      console.log(`✅ PASS: ${name}`);
    } catch (err: any) {
      failed++;
      testResults.push({ name, status: 'FAIL', note: err?.message || String(err) });
      console.log(`❌ FAIL: ${name}\n   -> ${err?.message || err}`);
    }
  }

  // Seed baseline helper docs with admin bypass
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();

    // Super admin authority record
    await setDoc(doc(adminDb, 'admins', 'super_uid'), {
      email: SUPER_ADMIN_EMAIL,
      grantedAt: new Date().toISOString(),
      role: 'Super Admin',
    });

    // Active member doc
    await setDoc(doc(adminDb, 'members', 'mem_active_1'), {
      id: 'mem_active_1',
      name: 'Ada Lovelace',
      handle: '@ada',
      role: 'Member',
      status: 'Active',
      authUid: 'user_active_1',
      tracks: ['Software & Systems'],
      joinedDate: '2026-01-01',
      studentId: '20241001',
      university: 'Tongmyong University',
    });

    // Active user doc
    await setDoc(doc(adminDb, 'users', 'user_active_1'), {
      id: 'user_active_1',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      status: 'active',
      memberId: 'mem_active_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Pending applicant doc
    await setDoc(doc(adminDb, 'users', 'user_pending_1'), {
      id: 'user_pending_1',
      email: 'newbie@example.com',
      displayName: 'New Applicant',
      status: 'approved_waiting_response',
      approvedMemberId: 'mem_staged_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Staged member doc unlinked
    await setDoc(doc(adminDb, 'members', 'mem_staged_1'), {
      id: 'mem_staged_1',
      name: 'Alan Turing',
      handle: '@alan',
      role: 'Member',
      status: 'Active',
      tracks: ['AI & Embedded'],
      joinedDate: '2026-02-01',
    });
  });

  // ========================================================================
  // SUITE 1: FINDING G — Pre-reading Non-Existent Check-In Record
  // ========================================================================
  await test('FINDING G (G-1): Member reading non-existent self check-in must succeed without permission-denied', async () => {
    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    // ID conforms to `sessionId_myMemberId` but document does NOT exist in Firestore
    const nonExistentDocRef = doc(db, 'checkIns', 'sess_test_phase2_mem_active_1');
    const snap = await assertSucceeds(getDoc(nonExistentDocRef));
    if (snap.exists()) {
      throw new Error('Expected document to not exist.');
    }
  });

  await test('FINDING G (G-2): Member reading non-existent check-in of ANOTHER member must be denied', async () => {
    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    // ID targets someone else's memberId
    const otherMemberDocRef = doc(db, 'checkIns', 'sess_test_phase2_mem_other_99');
    await assertFails(getDoc(otherMemberDocRef));
  });

  // ========================================================================
  // SUITE 2: FINDING H — Session Temporal Window vs Status Check
  // ========================================================================
  await test('FINDING H (H-1): Rules allow check-in when session is scheduled (not active) but temporally open', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'sessions', 'sess_scheduled_open'), {
        id: 'sess_scheduled_open',
        title: 'Temporal Window Test Session',
        track: 'Software & Systems',
        date: '2026-10-25',
        status: 'scheduled', // NOTE: 'scheduled', NOT 'active'!
        location: 'BIC Lab 101',
        checkInMode: 'open',
        lateAfterMinutes: 15,
      });

      await setDoc(doc(adminDb, 'sessionTokens', 'sess_scheduled_open'), {
        token: 'TESTTOK1',
        prevToken: 'TESTTOK0',
        rotatedAt: Timestamp.now(),
      });
    });

    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    // In rules, sessionOpen() checks `s.status != 'cancelled' && s.checkInMode == 'open'`,
    // so this succeeds even though status is 'scheduled'!
    await assertSucceeds(
      setDoc(doc(db, 'checkIns', 'sess_scheduled_open_mem_active_1'), {
        id: 'sess_scheduled_open_mem_active_1',
        sessionId: 'sess_scheduled_open',
        memberId: 'mem_active_1',
        authUid: 'user_active_1',
        method: 'camera_scan',
        token: 'TESTTOK1',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-10',
      })
    );
  });

  // ========================================================================
  // SUITE 3: SUPER ADMIN SECURITY HARDENING (Finding L)
  // ========================================================================
  await test('isSuper() Security: Super admin without email_verified == true is DENIED', async () => {
    const unverifiedSuper = testEnv.authenticatedContext('super_unverified', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: false,
      firebase: { sign_in_provider: 'google.com' },
    });
    const db = unverifiedSuper.firestore();
    await assertFails(deleteDoc(doc(db, 'members', 'mem_active_1')));
  });

  await test('isSuper() Security: Super admin without google.com provider is DENIED', async () => {
    const passwordSuper = testEnv.authenticatedContext('super_password', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    });
    const db = passwordSuper.firestore();
    await assertFails(deleteDoc(doc(db, 'members', 'mem_active_1')));
  });

  await test('isSuper() Security: Verified Google Super Admin is GRANTED', async () => {
    const validSuper = testEnv.authenticatedContext('super_valid', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const db = validSuper.firestore();

    // Create and delete an admin doc
    await assertSucceeds(
      setDoc(doc(db, 'admins', 'temp_admin_uid'), {
        email: 'temp@example.com',
        grantedAt: new Date().toISOString(),
      })
    );
    await assertSucceeds(deleteDoc(doc(db, 'admins', 'temp_admin_uid')));
  });

  // ========================================================================
  // SUITE 4: SESSION & SESSIONTOKENS CREATE/UPDATE/DELETE SPLIT (Finding E)
  // ========================================================================
  await test('Sessions Split: Admin can create, update, and delete sessions without null-resource errors', async () => {
    const adminContext = testEnv.authenticatedContext('super_valid', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const db = adminContext.firestore();

    // 1. Create with full valid schema
    await assertSucceeds(
      setDoc(doc(db, 'sessions', 'sess_crud_1'), {
        id: 'sess_crud_1',
        title: 'CRUD Session',
        track: 'Software & Systems',
        date: '2026-11-01',
        status: 'scheduled',
        location: 'Room 304',
        host: 'Guild Lead',
        startAt: new Date('2026-11-01T18:00:00Z'),
        endAt: new Date('2026-11-01T20:00:00Z'),
        timezone: 'Asia/Seoul',
        checkInMode: 'auto',
        openMinutesBefore: 15,
        graceMinutesAfter: 30,
        lateAfterMinutes: 10,
        points: 10,
      })
    );

    // 2. Full Update
    await assertSucceeds(
      updateDoc(doc(db, 'sessions', 'sess_crud_1'), {
        title: 'Updated CRUD Session Title',
      })
    );

    // 3. Legacy-Tolerant Session Update: updating status/mode on legacy session without full fields passes
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'sessions', 'sess_legacy_1'), {
        id: 'sess_legacy_1',
        title: 'Old Legacy Session',
        date: '2025-01-01',
        status: 'scheduled',
        location: 'Old Lab',
      });
    });

    await assertSucceeds(
      updateDoc(doc(db, 'sessions', 'sess_legacy_1'), {
        status: 'completed',
        checkInMode: 'closed',
        closedAt: new Date().toISOString(),
      })
    );

    // Denied if attempting to mutate unwhitelisted fields on legacy session
    await assertFails(
      updateDoc(doc(db, 'sessions', 'sess_legacy_1'), {
        title: 'Cannot Change Title On Legacy Session Without Full Schema',
      })
    );

    // 4. Delete (previously failed when write rule checked request.resource.data)
    await assertSucceeds(deleteDoc(doc(db, 'sessions', 'sess_crud_1')));
    await assertSucceeds(deleteDoc(doc(db, 'sessions', 'sess_legacy_1')));
  });

  // ========================================================================
  // SUITE 5: SESSIONTOKENS KIOSK ROTATION & EMPTY BYPASS GUARDS (Finding C)
  // ========================================================================
  await test('SessionTokens Security: Empty prevToken and malformed tokens are DENIED', async () => {
    const adminContext = testEnv.authenticatedContext('super_valid', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const db = adminContext.firestore();

    // Empty string prevToken must be rejected
    await assertFails(
      setDoc(doc(db, 'sessionTokens', 'sess_token_bad_1'), {
        token: 'ABCD1234',
        prevToken: '',
        rotatedAt: serverTimestamp(),
      })
    );

    // Non-8 character token must be rejected
    await assertFails(
      setDoc(doc(db, 'sessionTokens', 'sess_token_bad_2'), {
        token: 'TOOLONGTOKEN123',
        prevToken: 'ABCD1234',
        rotatedAt: serverTimestamp(),
      })
    );

    // Valid 8-character uppercase/digit tokens succeed
    await assertSucceeds(
      setDoc(doc(db, 'sessionTokens', 'sess_token_good_1'), {
        token: 'ABCD1234',
        prevToken: 'WXYZ5678',
        rotatedAt: serverTimestamp(),
      })
    );

    // Admin can delete sessionTokens
    await assertSucceeds(deleteDoc(doc(db, 'sessionTokens', 'sess_token_good_1')));
  });

  // ========================================================================
  // SUITE 6: CHECK-IN KEY ALLOWLIST & ATTACK GUARDS (Finding K)
  // ========================================================================
  await test('CheckIn Security: Unauthorized extra keys injected on check-in are DENIED', async () => {
    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    // Injected malicious key `points: 1000` in self-scan must be rejected
    await assertFails(
      setDoc(doc(db, 'checkIns', 'sess_scheduled_open_mem_active_1_hacked'), {
        id: 'sess_scheduled_open_mem_active_1_hacked',
        sessionId: 'sess_scheduled_open',
        memberId: 'mem_active_1',
        authUid: 'user_active_1',
        method: 'camera_scan',
        token: 'TESTTOK1',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-10',
        points: 9999, // Unauthorized extra field!
      })
    );

    // Injected `verifiedBy` or `notes` in member self check-in must be rejected
    await assertFails(
      setDoc(doc(db, 'checkIns', 'sess_scheduled_open_mem_active_1_spoofed'), {
        id: 'sess_scheduled_open_mem_active_1_spoofed',
        sessionId: 'sess_scheduled_open',
        memberId: 'mem_active_1',
        authUid: 'user_active_1',
        method: 'camera_scan',
        token: 'TESTTOK1',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-10',
        verifiedBy: 'user_active_1', // Member cannot self-verify
      })
    );

    await assertFails(
      setDoc(doc(db, 'checkIns', 'sess_scheduled_open_mem_active_1_notes'), {
        id: 'sess_scheduled_open_mem_active_1_notes',
        sessionId: 'sess_scheduled_open',
        memberId: 'mem_active_1',
        authUid: 'user_active_1',
        method: 'camera_scan',
        token: 'TESTTOK1',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-10',
        notes: 'Trying to inject notes', // Member self-checkin allowlist forbids notes
      })
    );
  });

  await test('CheckIn MonthKey & Token Hardening: monthKey bound to session date and token size 8 enforced', async () => {
    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    // Wrong monthKey (session date is 2026-10-15, trying monthKey 2026-11)
    await assertFails(
      setDoc(doc(db, 'checkIns', 'sess_scheduled_open_mem_active_1_month_mismatch'), {
        id: 'sess_scheduled_open_mem_active_1_month_mismatch',
        sessionId: 'sess_scheduled_open',
        memberId: 'mem_active_1',
        authUid: 'user_active_1',
        method: 'camera_scan',
        token: 'TESTTOK1',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-11', // Mismatch! Must match session date year-month 2026-10
      })
    );

    // Short token (7 chars) must be denied by token size 8 check
    await assertFails(
      setDoc(doc(db, 'checkIns', 'sess_scheduled_open_mem_active_1_short_tok'), {
        id: 'sess_scheduled_open_mem_active_1_short_tok',
        sessionId: 'sess_scheduled_open',
        memberId: 'mem_active_1',
        authUid: 'user_active_1',
        method: 'camera_scan',
        token: 'SHORT1', // Only 6 chars, rule requires size() == 8
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-10',
      })
    );
  });

  await test('Admin Manual CheckIn: Existence of member and session, verifiedBy, and checkedInAt == request.time required', async () => {
    const adminContext = testEnv.authenticatedContext('admin_super_1', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const db = adminContext.firestore();

    // Non-existent member ID must be rejected by exists(/databases/.../members/...)
    await assertFails(
      setDoc(doc(db, 'checkIns', 'sess_scheduled_open_mem_ghost_nonexistent'), {
        id: 'sess_scheduled_open_mem_ghost_nonexistent',
        sessionId: 'sess_scheduled_open',
        memberId: 'mem_ghost_nonexistent',
        authUid: 'admin_super_1',
        method: 'manual_entry',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-10',
        verifiedBy: 'admin_super_1',
      })
    );

    // Mismatched verifiedBy != request.auth.uid must be rejected
    await assertFails(
      setDoc(doc(db, 'checkIns', 'sess_scheduled_open_mem_active_1_spoofed_admin'), {
        id: 'sess_scheduled_open_mem_active_1_spoofed_admin',
        sessionId: 'sess_scheduled_open',
        memberId: 'mem_active_1',
        authUid: 'admin_super_1',
        method: 'manual_entry',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-10',
        verifiedBy: 'someone_else_uid',
      })
    );
  });

  // ========================================================================
  // SUITE 7: APPLICANT ADDITIVE PROFILE FIELDS (Finding D & J)
  // ========================================================================
  await test('Application Submission: Additive structured application fields succeed', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'applicant_structured_1'), {
        id: 'applicant_structured_1',
        email: 'applicant.structured@example.com',
        displayName: 'Structured Applicant',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    const applicantContext = testEnv.authenticatedContext('applicant_structured_1', {
      email: 'applicant.structured@example.com',
      email_verified: true,
    });
    const db = applicantContext.firestore();

    // Updating structured application fields succeeds under affectedKeys().hasOnly
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'applicant_structured_1'), {
        applicantName: 'Structured Applicant',
        applicantHandle: '@struct_app',
        applicantStudentId: '20269999',
        applicantTrack: 'Software & Systems',
        applicantNote: 'Excited to build embedded IoT systems.',
        githubUrl: 'https://github.com/structured-app',
        linkedinUrl: 'https://linkedin.com/in/structured-app',
        portfolioUrl: 'https://structured-app.dev',
        showLinksPublicly: true,
        membershipRequestedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
  });

  // ========================================================================
  // SUITE 8: MEMBER PROFILE LINKS & TRANSITION KEYS (Finding J)
  // ========================================================================
  await test('Member Self-Update: Transition rules allow githubUrl, linkedinUrl, portfolioUrl, studentId, university', async () => {
    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    // Member updates bio and social links
    await assertSucceeds(
      updateDoc(doc(db, 'members', 'mem_active_1'), {
        bio: 'First computer programmer & systems builder.',
        githubUrl: 'https://github.com/adalovelace',
        linkedinUrl: 'https://linkedin.com/in/adalovelace',
        portfolioUrl: 'https://adalovelace.dev',
        showLinksPublicly: true,
        studentId: '20241001',
        university: 'Tongmyong University',
      })
    );

    // Member cannot alter privileged fields like role or handle
    await assertFails(
      updateDoc(doc(db, 'members', 'mem_active_1'), {
        role: 'President',
      })
    );
  });

  // ========================================================================
  // SUITE 9: NOTIFICATIONS HARDENING & SESSION COMPLETED REJECTION
  // ========================================================================
  await test('Notifications Security: Immutability of userId, field allowlist, and owner limits', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'notifications', 'notif_test_1'), {
        id: 'notif_test_1',
        userId: 'user_active_1',
        title: 'Meeting Scheduled',
        message: 'A new workshop has been published.',
        type: 'meeting_published',
        read: false,
        dismissed: false,
        createdAt: new Date().toISOString(),
      });
    });

    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    // Owner can mark read and dismissed
    await assertSucceeds(
      updateDoc(doc(db, 'notifications', 'notif_test_1'), {
        read: true,
        dismissed: true,
      })
    );

    // Owner CANNOT modify userId (immutable)
    await assertFails(
      updateDoc(doc(db, 'notifications', 'notif_test_1'), {
        userId: 'user_attacker_2',
        read: true,
      })
    );

    // Owner CANNOT modify title or message
    await assertFails(
      updateDoc(doc(db, 'notifications', 'notif_test_1'), {
        title: 'Defaced Notification Title',
        read: true,
      })
    );

    // Attacker cannot read or update another user's notification
    const attackerContext = testEnv.authenticatedContext('user_attacker_2', {
      email: 'attacker@example.com',
      email_verified: true,
    });
    const attackerDb = attackerContext.firestore();

    await assertFails(getDoc(doc(attackerDb, 'notifications', 'notif_test_1')));
    await assertFails(updateDoc(doc(attackerDb, 'notifications', 'notif_test_1'), { read: true }));

    // Admin CAN create notification for any user
    const adminContext = testEnv.authenticatedContext('admin_super_1', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const adminDb = adminContext.firestore();

    await assertSucceeds(
      setDoc(doc(adminDb, 'notifications', 'notif_admin_broadcast_1'), {
        id: 'notif_admin_broadcast_1',
        userId: 'user_active_1',
        title: 'Admin Alert',
        message: 'System maintenance scheduled.',
        type: 'system',
        read: false,
        dismissed: false,
        createdAt: new Date().toISOString(),
      })
    );
  });

  await test('Session Lifecycle: sessionOpen rejects check-ins to completed sessions', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'sessions', 'sess_test_completed_1'), {
        id: 'sess_test_completed_1',
        title: 'Completed Workshop',
        track: 'Software & Systems',
        date: '2026-10-15',
        status: 'completed', // Explicitly completed
        checkInMode: 'open',
        location: 'Engineering Hall 301',
        startAt: new Date(Date.now() - 3600000).toISOString(),
        endAt: new Date(Date.now() + 3600000).toISOString(),
        openMinutesBefore: 30,
        graceMinutesAfter: 30,
      });
      await setDoc(doc(context.firestore(), 'sessionTokens', 'sess_test_completed_1'), {
        token: 'COMPLTOK',
        prevToken: 'COMPLPRV',
        rotatedAt: serverTimestamp(),
      });
    });

    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    // Check-in to completed session must fail sessionOpen rule check
    await assertFails(
      setDoc(doc(db, 'checkIns', 'sess_test_completed_1_mem_active_1'), {
        id: 'sess_test_completed_1_mem_active_1',
        sessionId: 'sess_test_completed_1',
        memberId: 'mem_active_1',
        authUid: 'user_active_1',
        method: 'camera_scan',
        token: 'COMPLTOK',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-10',
      })
    );
  });

  // ========================================================================
  // SUITE 11: USER PROFILE SECURITY & EMAIL IMMUTABILITY
  // ========================================================================
  await test('Users Collection: Email bound to token email on create, and strictly immutable on update', async () => {
    const userContext = testEnv.authenticatedContext('user_email_test_1', {
      email: 'builder1@example.com',
      email_verified: true,
    });
    const db = userContext.firestore();

    // 1. Create with matching email succeeds
    await assertSucceeds(
      setDoc(doc(db, 'users', 'user_email_test_1'), {
        id: 'user_email_test_1',
        email: 'builder1@example.com',
        displayName: 'Builder One',
        status: 'pending',
      })
    );

    // 2. Create with mismatched email fails
    const user2Context = testEnv.authenticatedContext('user_email_test_2', {
      email: 'builder2@example.com',
      email_verified: true,
    });
    await assertFails(
      setDoc(doc(user2Context.firestore(), 'users', 'user_email_test_2'), {
        id: 'user_email_test_2',
        email: 'spoofed@example.com', // Mismatched email
        displayName: 'Builder Two',
        status: 'pending',
      })
    );

    // 3. User update attempting to mutate email is DENIED (email immutable)
    await assertFails(
      updateDoc(doc(db, 'users', 'user_email_test_1'), {
        email: 'changed@example.com',
        displayName: 'Updated Name',
      })
    );

    // 4. User update preserving original email succeeds
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'user_email_test_1'), {
        displayName: 'Updated Builder Name',
        applicantNote: 'Learning systems design',
      })
    );
  });

  // ========================================================================
  // SUITE 12: LEGACY NOTIFICATION TOLERANCE
  // ========================================================================
  await test('Notifications Security: Owner can mark legacy notifications read/dismissed without full schema', async () => {
    // Seed a legacy notification document that lacks new schema fields and contains legacy keys
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'notifications', 'notif_legacy_doc_1'), {
        id: 'notif_legacy_doc_1',
        userId: 'user_active_1',
        title: 'Old Notification Title',
        read: false,
        dismissed: false,
        legacyExtraField: 'legacy_value',
      });
    });

    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    // Owner marks read: true on legacy doc -> succeeds without schema error
    await assertSucceeds(
      updateDoc(doc(db, 'notifications', 'notif_legacy_doc_1'), {
        read: true,
      })
    );

    // Owner attempting to modify other fields on legacy doc is DENIED
    await assertFails(
      updateDoc(doc(db, 'notifications', 'notif_legacy_doc_1'), {
        read: true,
        title: 'Tampered Title',
      })
    );
  });

  console.log('\n========================================');
  console.log(`PHASE 2 RULES TEST SUITE COMPLETE`);
  console.log(`Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('========================================\n');

  await testEnv.cleanup();
  return { passed, failed, testResults };
}

runRulesTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
