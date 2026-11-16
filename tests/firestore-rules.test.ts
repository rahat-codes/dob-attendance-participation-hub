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

  // ========================================================================
  // SUITE 13: AUDIT LOG SERVER TIMESTAMP & DEACTIVATED RE-APPLY TRANSITION
  // ========================================================================
  await test('Audit Logs Security: Enforces serverTimestamp(), field whitelist, and performedBy match (written, NOT RUN)', async () => {
    const adminContext = testEnv.authenticatedContext('admin_super_1', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const adminDb = adminContext.firestore();

    // 1. Valid audit log with serverTimestamp() succeeds
    await assertSucceeds(
      setDoc(doc(adminDb, 'auditLogs', 'log_valid_server_ts_1'), {
        id: 'log_valid_server_ts_1',
        action: 'complete_session',
        performedBy: 'admin_super_1',
        performedByEmail: SUPER_ADMIN_EMAIL,
        targetId: 'sess_test_1',
        details: 'Marked session sess_test_1 as completed',
        timestamp: serverTimestamp(),
      })
    );

    // 2. Audit log with client ISO string timestamp is DENIED
    await assertFails(
      setDoc(doc(adminDb, 'auditLogs', 'log_bad_iso_ts_1'), {
        id: 'log_bad_iso_ts_1',
        action: 'complete_session',
        performedBy: 'admin_super_1',
        details: 'Client timestamp must fail',
        timestamp: new Date().toISOString(),
      })
    );

    // 3. Audit log with unexpected field (timestampIso) is DENIED
    await assertFails(
      setDoc(doc(adminDb, 'auditLogs', 'log_extra_field_1'), {
        id: 'log_extra_field_1',
        action: 'complete_session',
        performedBy: 'admin_super_1',
        details: 'Extra field must fail',
        timestamp: serverTimestamp(),
        timestampIso: new Date().toISOString(),
      })
    );

    // 4. Audit log with spoofed performedBy is DENIED
    await assertFails(
      setDoc(doc(adminDb, 'auditLogs', 'log_spoof_actor_1'), {
        id: 'log_spoof_actor_1',
        action: 'complete_session',
        performedBy: 'other_admin_uid',
        details: 'Spoofed actor must fail',
        timestamp: serverTimestamp(),
      })
    );
  });

  await test('Deactivated User Re-Apply: Deactivated member can transition active -> pending on re-apply (written, NOT RUN)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'members', 'mem_inactive_1'), {
        id: 'mem_inactive_1',
        name: 'Deactivated Builder',
        handle: '@inactive_builder',
        role: 'Member',
        tracks: ['Software & Systems'],
        joinedDate: '2026-01-01',
        status: 'Inactive',
        authUid: 'user_inactive_1',
      });
      await setDoc(doc(context.firestore(), 'users', 'user_inactive_1'), {
        id: 'user_inactive_1',
        email: 'inactive@example.com',
        displayName: 'Deactivated Builder',
        status: 'active',
        memberId: 'mem_inactive_1',
      });
    });

    const inactiveCtx = testEnv.authenticatedContext('user_inactive_1', {
      email: 'inactive@example.com',
      email_verified: true,
    });
    const db = inactiveCtx.firestore();

    await assertSucceeds(
      updateDoc(doc(db, 'users', 'user_inactive_1'), {
        status: 'pending',
        requestedNotes: '@inactive_builder - Track: Software & Systems - Name: Deactivated Builder',
        applicantName: 'Deactivated Builder',
        applicantHandle: '@inactive_builder',
        applicantTrack: 'Software & Systems',
        githubUrl: 'https://github.com/inactivebuilder',
        linkedinUrl: 'https://www.linkedin.com/in/inactive-builder',
        membershipRequestedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
  });

  // ========================================================================
  // SUITE 14: LEGACY SESSION DEFAULTS (sessionOpen & isValidCheckInStatus) (written, NOT RUN)
  // ========================================================================
  await test('Legacy Session Compatibility: sessionOpen and isValidCheckInStatus apply map.get defaults when optional config fields are omitted (written, NOT RUN)', async () => {
    const now = new Date();
    const startAt = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago -> within default 10 min late threshold
    const endAt = new Date(now.getTime() + 60 * 60 * 1000);
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const sessionDate = `${yyyy}-${mm}-${dd}`;
    const monthKey = `${yyyy}-${mm}`;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'sessions', 'sess_legacy_defaults_1'), {
        id: 'sess_legacy_defaults_1',
        title: 'Legacy Hardware Session',
        track: 'Hardware & Robotics',
        date: sessionDate,
        status: 'scheduled',
        location: 'Maker Bay',
        startAt,
        endAt,
        // Intentionally omit checkInMode, openMinutesBefore, graceMinutesAfter, lateAfterMinutes
      });
      await setDoc(doc(context.firestore(), 'sessionTokens', 'sess_legacy_defaults_1'), {
        token: 'LEG8TOKN',
        prevToken: 'LEG8PRVK',
        rotatedAt: serverTimestamp(),
      });
    });

    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();

    await assertSucceeds(
      setDoc(doc(db, 'checkIns', 'sess_legacy_defaults_1_mem_active_1'), {
        id: 'sess_legacy_defaults_1_mem_active_1',
        sessionId: 'sess_legacy_defaults_1',
        memberId: 'mem_active_1',
        authUid: 'user_active_1',
        method: 'camera_scan',
        token: 'LEG8TOKN',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey,
      })
    );
  });

  // ========================================================================
  // SUITE 15: SESSION SOFT-DELETE WHITELIST (deletedAt) (written, NOT RUN)
  // ========================================================================
  await test('Session Soft-Delete: Admin can update status/checkInMode/cancelledAt/deletedAt/updatedAt only; non-admin & unwhitelisted partial fields denied (written, NOT RUN)', async () => {
    const adminContext = testEnv.authenticatedContext('admin_super_1', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const adminDb = adminContext.firestore();

    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const memberDb = memberContext.firestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'sessions', 'sess_softdel_test_1'), {
        id: 'sess_softdel_test_1',
        title: 'Soft Delete Target',
        track: 'Software & Systems',
        date: '2026-11-22',
        status: 'scheduled',
        location: 'Room 101',
        startAt: new Date(Date.UTC(2026, 10, 22, 18, 0, 0)),
        endAt: new Date(Date.UTC(2026, 10, 22, 20, 0, 0)),
      });
    });

    // Non-admin member cannot soft-delete session
    await assertFails(
      updateDoc(doc(memberDb, 'sessions', 'sess_softdel_test_1'), {
        status: 'cancelled',
        checkInMode: 'closed',
        cancelledAt: new Date().toISOString(),
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    // Admin cannot touch unwhitelisted partial field (e.g. title) in partial soft-delete update
    await assertFails(
      updateDoc(doc(adminDb, 'sessions', 'sess_softdel_test_1'), {
        status: 'cancelled',
        checkInMode: 'closed',
        deletedAt: new Date().toISOString(),
        title: 'Tampered Partial Title',
      })
    );

    // Valid admin soft-delete succeeds
    await assertSucceeds(
      updateDoc(doc(adminDb, 'sessions', 'sess_softdel_test_1'), {
        status: 'cancelled',
        checkInMode: 'closed',
        cancelledAt: new Date().toISOString(),
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
  });

  // ========================================================================
  // SUITE 16: PERMANENT SESSION DELETE AUDIT SURVIVAL (written, NOT RUN)
  // ========================================================================
  await test('Audit Survival: auditLogs entry persists and remains immutable after permanent session delete (written, NOT RUN)', async () => {
    const adminContext = testEnv.authenticatedContext('admin_super_1', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    });
    const adminDb = adminContext.firestore();

    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const memberDb = memberContext.firestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await setDoc(doc(seedDb, 'sessions', 'sess_permdel_1'), {
        id: 'sess_permdel_1',
        title: 'Permanent Delete Target',
        track: 'AI & Embedded',
        date: '2026-11-23',
        status: 'cancelled',
        checkInMode: 'closed',
        location: 'Lab B',
        startAt: new Date(Date.UTC(2026, 10, 23, 18, 0, 0)),
        endAt: new Date(Date.UTC(2026, 10, 23, 20, 0, 0)),
      });
      await setDoc(doc(seedDb, 'sessionTokens', 'sess_permdel_1'), {
        token: 'PERM8DEL',
        prevToken: 'PRV8PERM',
        rotatedAt: serverTimestamp(),
      });
      await setDoc(doc(seedDb, 'checkIns', 'sess_permdel_1_mem_active_1'), {
        id: 'sess_permdel_1_mem_active_1',
        sessionId: 'sess_permdel_1',
        memberId: 'mem_active_1',
        method: 'manual_entry',
        verifiedBy: 'admin_super_1',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-11',
      });
      await setDoc(doc(seedDb, 'announcements', 'ann_permdel_1'), {
        id: 'ann_permdel_1',
        title: 'Lab B Workshop',
        type: 'session_published',
        sessionId: 'sess_permdel_1',
        createdAt: new Date().toISOString(),
        createdBy: 'admin_super_1',
      });
    });

    // Execute permanent cleanup deletes + delete_session audit entry
    await assertSucceeds(deleteDoc(doc(adminDb, 'checkIns', 'sess_permdel_1_mem_active_1')));
    await assertSucceeds(deleteDoc(doc(adminDb, 'sessionTokens', 'sess_permdel_1')));
    await assertSucceeds(deleteDoc(doc(adminDb, 'announcements', 'ann_permdel_1')));
    await assertSucceeds(deleteDoc(doc(adminDb, 'sessions', 'sess_permdel_1')));
    await assertSucceeds(
      setDoc(doc(adminDb, 'auditLogs', 'log_perm_del_survive_1'), {
        id: 'log_perm_del_survive_1',
        action: 'delete_session',
        performedBy: 'admin_super_1',
        performedByEmail: SUPER_ADMIN_EMAIL,
        targetId: 'sess_permdel_1',
        targetName: 'Permanent Delete Target',
        details: 'Permanently deleted cancelled session and cascaded 1 check-in and 1 announcement.',
        timestamp: serverTimestamp(),
      })
    );

    // Verify deleted session & cascaded docs no longer exist, while audit log survives and is readable by admin
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const verifyDb = context.firestore();
      const [sessSnap, tokSnap, chkSnap, annSnap] = await Promise.all([
        getDoc(doc(verifyDb, 'sessions', 'sess_permdel_1')),
        getDoc(doc(verifyDb, 'sessionTokens', 'sess_permdel_1')),
        getDoc(doc(verifyDb, 'checkIns', 'sess_permdel_1_mem_active_1')),
        getDoc(doc(verifyDb, 'announcements', 'ann_permdel_1')),
      ]);
      if (sessSnap.exists() || tokSnap.exists() || chkSnap.exists() || annSnap.exists()) {
        throw new Error('Expected session and cascaded documents to be deleted.');
      }
    });

    const auditSnap = await assertSucceeds(getDoc(doc(adminDb, 'auditLogs', 'log_perm_del_survive_1')));
    if (!auditSnap.exists() || auditSnap.data()?.action !== 'delete_session') {
      throw new Error('Expected delete_session audit entry to survive permanent session delete.');
    }

    // Verify audit entry cannot be tampered with or deleted (even by Super Admin or regular member)
    await assertFails(
      updateDoc(doc(adminDb, 'auditLogs', 'log_perm_del_survive_1'), {
        details: 'Attempted tamper after deletion',
      })
    );
    await assertFails(deleteDoc(doc(adminDb, 'auditLogs', 'log_perm_del_survive_1')));
    await assertFails(deleteDoc(doc(memberDb, 'auditLogs', 'log_perm_del_survive_1')));
  });

  // 29. Legacy users/{uid} doc with extra fields & photoURL: null allows owner updates, blocks privilege escalation
  await test('29. Legacy users/{uid} doc (extra keys & photoURL: null) permits submitApplication & blocks escalation', async () => {
    const legacyUid = 'user_legacy_extra_1';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await setDoc(doc(seedDb, 'users', legacyUid), {
        uid: legacyUid,
        role: 'Member',
        email: 'legacy_builder@example.com',
        displayName: 'Legacy Builder',
        photoURL: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    });

    const userDb = testEnv.authenticatedContext(legacyUid, {
      email: 'legacy_builder@example.com',
      email_verified: true,
    }).firestore();

    await assertSucceeds(
      updateDoc(doc(userDb, 'users', legacyUid), {
        id: legacyUid,
        displayName: 'Legacy Builder Updated',
        applicantName: 'Legacy Builder Updated',
        applicantHandle: '@legacybuilder',
        applicantTrack: 'Software & Systems',
        githubUrl: 'https://github.com/legacybuilder',
        linkedinUrl: 'https://www.linkedin.com/in/legacybuilder',
        requestedNotes: '@legacybuilder - Track: Software & Systems - Name: Legacy Builder Updated',
        membershipRequestedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    // Owner still cannot escalate status or memberId or alter email
    await assertFails(
      updateDoc(doc(userDb, 'users', legacyUid), {
        status: 'active',
        memberId: 'mem_active_1',
      })
    );
    await assertFails(
      updateDoc(doc(userDb, 'users', legacyUid), {
        email: 'spoofed@example.com',
      })
    );
  });

  // 30. Declined / deactivated user reRequestMembership with displayName succeeds
  await test('30. Declined & deactivated users can re-apply including displayName update', async () => {
    const declinedUid = 'user_declined_reapply_1';
    const deactivatedUid = 'user_deactivated_reapply_1';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await setDoc(doc(seedDb, 'users', declinedUid), {
        id: declinedUid,
        email: 'declined_reapply@example.com',
        displayName: 'Old Name',
        status: 'declined',
      });
      await setDoc(doc(seedDb, 'users', deactivatedUid), {
        id: deactivatedUid,
        email: 'deactivated_reapply@example.com',
        displayName: 'Inactive User',
        status: 'active',
        memberId: 'mem_inactive_reapply_1',
      });
      await setDoc(doc(seedDb, 'members', 'mem_inactive_reapply_1'), {
        id: 'mem_inactive_reapply_1',
        name: 'Inactive User',
        handle: '@inactiveuser',
        role: 'Member',
        tracks: ['Software & Systems'],
        joinedDate: '2026-01-01',
        status: 'Inactive',
      });
    });

    const declinedDb = testEnv.authenticatedContext(declinedUid, {
      email: 'declined_reapply@example.com',
      email_verified: true,
    }).firestore();

    await assertSucceeds(
      updateDoc(doc(declinedDb, 'users', declinedUid), {
        status: 'pending',
        displayName: 'New Reapplicant Name',
        applicantName: 'New Reapplicant Name',
        applicantHandle: '@newreapp',
        applicantTrack: 'AI & Embedded',
        githubUrl: 'https://github.com/newreapp',
        linkedinUrl: 'https://www.linkedin.com/in/newreapp',
        requestedNotes: '@newreapp - Track: AI & Embedded - Name: New Reapplicant Name',
        membershipRequestedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    const deactivatedDb = testEnv.authenticatedContext(deactivatedUid, {
      email: 'deactivated_reapply@example.com',
      email_verified: true,
    }).firestore();

    await assertSucceeds(
      updateDoc(doc(deactivatedDb, 'users', deactivatedUid), {
        status: 'pending',
        displayName: 'Restored Applicant',
        requestedNotes: 'Requesting reactivation',
        membershipRequestedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
  });

  // 31. Active linked member with missing/empty authUid can complete mandatory setup (memberPrivate + members + data:image avatar + publicLeaderboard)
  await test('31. Active member with empty/missing authUid can complete mandatory profile setup & upload compressed avatar', async () => {
    const uid = 'user_unseeded_authuid_1';
    const memberId = 'mem_unseeded_authuid_1';
    const otherMemberId = 'mem_active_1';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await setDoc(doc(seedDb, 'users', uid), {
        id: uid,
        email: 'iuliia@example.com',
        displayName: 'Iuliia Gafurova',
        status: 'active',
        memberId,
      });
      await setDoc(doc(seedDb, 'members', memberId), {
        id: memberId,
        name: 'Iuliia Gafurova',
        handle: '@iuliia',
        role: 'Member',
        tracks: ['Software & Systems'],
        status: 'Active',
        authUid: '',
      });
      await setDoc(doc(seedDb, 'publicLeaderboard', memberId), {
        memberId,
        displayName: 'Iuliia Gafurova',
        handle: '@iuliia',
        rank: 5,
        totalPoints: 0,
      });
    });

    const userDb = testEnv.authenticatedContext(uid, {
      email: 'iuliia@example.com',
      email_verified: true,
    }).firestore();

    // Private profile read & write succeeds via myMemberId() even when member.authUid is ''
    await assertSucceeds(getDoc(doc(userDb, 'memberPrivate', memberId)));
    await assertSucceeds(
      setDoc(
        doc(userDb, 'memberPrivate', memberId),
        {
          email: 'iuliia@example.com',
          studentId: '20251508',
          phone: '+82 10-1234-5678',
          profileCompleted: true,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      )
    );

    const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    // Self-profile update + authUid self-heal + data:image avatar + publicLeaderboard sync succeed
    await assertSucceeds(
      updateDoc(doc(userDb, 'members', memberId), {
        name: 'Iuliia Gafurova',
        avatarUrl: tinyPngDataUrl,
        bio: 'Building full-stack tools',
        tracks: ['Software & Systems', 'AI & Embedded'],
        leaderboardOptOut: false,
        githubUrl: 'https://github.com/iuliia',
        linkedinUrl: 'https://www.linkedin.com/in/iuliia',
        portfolioUrl: '',
        showLinksPublicly: true,
        authUid: uid,
      })
    );

    await assertSucceeds(
      updateDoc(doc(userDb, 'publicLeaderboard', memberId), {
        displayName: 'Iuliia Gafurova',
        name: 'Iuliia Gafurova',
        avatar: tinyPngDataUrl,
        avatarUrl: tinyPngDataUrl,
        lastUpdated: new Date().toISOString(),
        githubUrl: 'https://github.com/iuliia',
        linkedinUrl: 'https://www.linkedin.com/in/iuliia',
        portfolioUrl: '',
        showLinksPublicly: true,
      })
    );

    // SVG data URI and HTTP URLs are still blocked, and cross-member writes / role escalation fail
    await assertFails(
      updateDoc(doc(userDb, 'members', memberId), {
        avatarUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      })
    );
    await assertFails(
      updateDoc(doc(userDb, 'members', memberId), {
        role: 'President',
      })
    );
    await assertFails(
      setDoc(doc(userDb, 'memberPrivate', otherMemberId), { studentId: '99999999' }, { merge: true })
    );
  });

  // 32. Legacy users/{uid} missing email, oversized untouched photoURL, legacy applicantTrack, and missing status permits submitApplication & notificationPrefs while blocking tampering
  await test('32. Legacy users/{uid} (missing email/status, oversized untouched photoURL, legacy track) allows valid updates & blocks escalation', async () => {
    const legacyUid = 'user_legacy_punisher_1';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await setDoc(doc(seedDb, 'users', legacyUid), {
        displayName: 'Legacy Member',
        photoURL: 'https://lh3.googleusercontent.com/' + 'x'.repeat(600),
        applicantTrack: 'Legacy Robotics Track',
        requestedNotes: 'Old bio note',
      });
    });

    const userDb = testEnv.authenticatedContext(legacyUid, {
      email: 'legacy_punisher@example.com',
      email_verified: true,
    }).firestore();

    // Saving notification preferences without touching legacy photoURL or track succeeds
    await assertSucceeds(
      updateDoc(doc(userDb, 'users', legacyUid), {
        notificationPreferences: { enabled: true, reminders: true, announcements: false },
        updatedAt: new Date().toISOString(),
      })
    );

    // Submitting application with dot-containing LinkedIn slug and missing status/email succeeds
    await assertSucceeds(
      updateDoc(doc(userDb, 'users', legacyUid), {
        id: legacyUid,
        status: 'pending',
        displayName: 'Punisher Builder',
        applicantName: 'Punisher Builder',
        applicantHandle: '@punisher',
        applicantTrack: 'Hardware & Robotics',
        githubUrl: 'https://github.com/punisher-builder',
        linkedinUrl: 'https://www.linkedin.com/in/punisher.builder',
        requestedNotes: '@punisher - Track: Hardware & Robotics',
        membershipRequestedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    // Tampering with invalid new photoURL or escalating status still fails
    await assertFails(
      updateDoc(doc(userDb, 'users', legacyUid), {
        photoURL: 'http://insecure.example.com/avatar.png',
      })
    );
    await assertFails(
      updateDoc(doc(userDb, 'users', legacyUid), {
        status: 'active',
        memberId: 'mem_active_1',
      })
    );
  });

  // 33. Legacy members/{memberId} missing internal id permits member self-profile update, id backfill, profileCompleted, updatedAt, and dot/non-www LinkedIn URLs
  await test('33. Legacy members/{memberId} missing id allows self-update with id backfill & dot/no-www LinkedIn slugs', async () => {
    const uid = 'user_legacy_member_self_1';
    const memberId = 'mem_legacy_no_id_1';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await setDoc(doc(seedDb, 'users', uid), {
        id: uid,
        email: 'legacy_self@example.com',
        displayName: 'Legacy Self',
        status: 'active',
        memberId,
      });
      // Deliberately omit internal `id` and include an old >500-char untouched avatarUrl
      await setDoc(doc(seedDb, 'members', memberId), {
        name: 'Legacy Self',
        handle: '@legacyself',
        role: 'Member',
        tracks: ['Software & Systems'],
        status: 'Active',
        avatarUrl: 'https://lh3.googleusercontent.com/' + 'a'.repeat(550),
      });
    });

    const userDb = testEnv.authenticatedContext(uid, {
      email: 'legacy_self@example.com',
      email_verified: true,
    }).firestore();

    await assertSucceeds(
      updateDoc(doc(userDb, 'members', memberId), {
        id: memberId,
        name: 'Legacy Self Completed',
        bio: 'Ready to ship',
        tracks: ['Software & Systems'],
        githubUrl: 'https://github.com/legacyself',
        linkedinUrl: 'https://linkedin.com/in/legacy.self',
        portfolioUrl: 'https://legacyself.dev',
        showLinksPublicly: true,
        authUid: uid,
        profileCompleted: true,
        profileCompletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    // Path traversal (..) in LinkedIn slug and mismatched id backfill remain rejected
    await assertFails(
      updateDoc(doc(userDb, 'members', memberId), {
        linkedinUrl: 'https://www.linkedin.com/in/bad..slug',
      })
    );
    await assertFails(
      updateDoc(doc(userDb, 'members', memberId), {
        id: 'mem_other_spoof',
      })
    );
  });

  console.log('\n========================================');
  console.log(`PHASE 2-5 RULES TEST SUITE COMPLETE`);
  console.log(`Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('========================================\n');

  await testEnv.cleanup();
  return { passed, failed, testResults };
}

runRulesTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
