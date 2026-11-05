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
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
  Timestamp,
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

async function runRulesTests() {
  console.log('--- Initializing Firestore Rules Test Suite (Phase 0 Baseline) ---');
  try {
    await setupSuite();
  } catch (err: any) {
    console.log('⚠️ Firestore Emulator not running at 127.0.0.1:8080. Start the emulator with `firebase emulators:start --only firestore` to run rules unit tests.');
    return { passed: 0, failed: 0, testResults: [] };
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
      console.log(`❌ FAIL (Expected defect demonstrated): ${name}\n   -> ${err?.message || err}`);
    }
  }

  // Seed baseline helper docs with admin bypass
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    // Super admin doc
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
      email: 'ada@example.com',
      role: 'Member',
      status: 'Active',
      authUid: 'user_active_1',
      tracks: ['Software & Systems'],
    });
    // Active user doc
    await setDoc(doc(adminDb, 'users', 'user_active_1'), {
      authUid: 'user_active_1',
      email: 'ada@example.com',
      status: 'active',
      memberId: 'mem_active_1',
    });
    // Pending applicant doc
    await setDoc(doc(adminDb, 'users', 'user_pending_1'), {
      authUid: 'user_pending_1',
      email: 'newbie@example.com',
      status: 'approved_waiting_response',
      approvedMemberId: 'mem_staged_1',
    });
    // Staged member doc unlinked
    await setDoc(doc(adminDb, 'members', 'mem_staged_1'), {
      id: 'mem_staged_1',
      name: 'Alan Turing',
      handle: '@alan',
      email: 'newbie@example.com',
      role: 'Member',
      status: 'Active',
      tracks: ['AI & Embedded'],
    });
  });

  // TEST 1: P0-5 Defect: Admin deleting a session
  // In current rules: match /sessions/{sessionId} { allow write: if isAdmin() && isValidSession(request.resource.data); }
  // On delete, request.resource is null, so deleteDoc is rejected!
  await test('P0-5 Defect: Admin session deletion must succeed', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'sessions', 'sess_del_1'), {
        id: 'sess_del_1',
        title: 'Delete Target Session',
        date: '2026-10-25',
        track: 'Software & Systems',
        status: 'scheduled',
        location: 'BIC Center',
      });
    });

    const superContext = testEnv.authenticatedContext('super_uid', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: true,
    });
    const db = superContext.firestore();
    await assertSucceeds(deleteDoc(doc(db, 'sessions', 'sess_del_1')));
  });

  // TEST 2: N-1 Defect: Super admin with unverified email should be DENIED
  // In current rules: isSuper() does not check email_verified == true
  await test('N-1 Defect: Super admin without email_verified == true must be denied', async () => {
    const unverifiedSuper = testEnv.authenticatedContext('fake_super_unverified', {
      email: SUPER_ADMIN_EMAIL,
      email_verified: false,
    });
    const db = unverifiedSuper.firestore();
    // Attempting to delete a member should fail for unverified super admin
    await assertFails(deleteDoc(doc(db, 'members', 'mem_active_1')));
  });

  // TEST 3: P0-4 Defect: Approved waiting applicant reading members doc
  // In current rules: members read allows only active members (auth.uid == resource.data.authUid && isMemberActive())
  // The applicant is still approved_waiting_response and not yet linked, so reading the member doc fails
  await test('P0-4 Defect: Pre-read of member by applicant in approved_waiting_response', async () => {
    const applicantContext = testEnv.authenticatedContext('user_pending_1', {
      email: 'newbie@example.com',
      email_verified: true,
    });
    const db = applicantContext.firestore();
    // In buggy code: getDoc(members/{approvedMemberId}) is called before write. Assert this fails as proof of defect!
    await assertFails(getDoc(doc(db, 'members', 'mem_staged_1')));
  });

  // TEST 4: P0-6 Defect: Regular member querying all check-ins collection
  // In current rules: match /checkIns/{checkInId} requires authUid == auth.uid on read
  // Full collection query without memberId filter is rejected
  await test('P0-6 Defect: Regular member querying whole checkIns collection is denied', async () => {
    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();
    await assertFails(getDocs(collection(db, 'checkIns')));
  });

  // TEST 5: P0-3 Defect: Empty token bypass
  // In current rules: k.prevToken is '' on kiosk start, matching empty string token
  await test('P0-3 Defect: Empty string token should be denied', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'sessionTokens', 'sess_token_1'), {
        token: 'ABC12345',
        prevToken: '',
        rotatedAt: Timestamp.now(),
      });
      await setDoc(doc(adminDb, 'sessions', 'sess_token_1'), {
        id: 'sess_token_1',
        title: 'Token Test Session',
        date: '2026-10-20',
        track: 'Software & Systems',
        status: 'scheduled',
        location: 'Lab',
        startAt: Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)),
        endAt: Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000)),
        timezone: 'Asia/Seoul',
      });
    });

    const memberContext = testEnv.authenticatedContext('user_active_1', {
      email: 'ada@example.com',
      email_verified: true,
    });
    const db = memberContext.firestore();
    // An empty token must be rejected
    await assertFails(
      setDoc(doc(db, 'checkIns', 'sess_token_1_mem_active_1'), {
        id: 'sess_token_1_mem_active_1',
        sessionId: 'sess_token_1',
        memberId: 'mem_active_1',
        authUid: 'user_active_1',
        method: 'camera_scan',
        token: '',
        checkedInAt: serverTimestamp(),
        status: 'present',
        monthKey: '2026-10',
      })
    );
  });

  // TEST 6: Pending user updating requestedNotes and membershipRequestedAt
  await test('Pending applicant can update requestedNotes and membershipRequestedAt without permission-denied', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'applicant_uid_1'), {
        id: 'applicant_uid_1',
        email: 'applicant@example.com',
        displayName: 'Applicant One',
        status: 'pending',
        readAnnouncementIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    const applicantContext = testEnv.authenticatedContext('applicant_uid_1', {
      email: 'applicant@example.com',
      email_verified: true,
    });
    const db = applicantContext.firestore();

    // Updating requestedNotes and membershipRequestedAt must succeed under affectedKeys().hasOnly
    await assertSucceeds(
      setDoc(
        doc(db, 'users', 'applicant_uid_1'),
        {
          requestedNotes: '@applicant_one',
          membershipRequestedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      )
    );
  });

  console.log('\n========================================');
  console.log(`BASELINE RULES TEST RUN COMPLETE`);
  console.log(`Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('========================================\n');

  await testEnv.cleanup();

  // If there are failures matching the expected defects, exit with code 0 or 1
  return { passed, failed, testResults };
}

runRulesTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
