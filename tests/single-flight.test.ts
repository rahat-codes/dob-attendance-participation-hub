import { singleFlight, clearSingleFlight } from '../src/utils/singleFlight';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

async function testSingleFlightDeduplication() {
  clearSingleFlight();
  let executionCount = 0;

  const task = async () => {
    executionCount++;
    await new Promise((res) => setTimeout(res, 30));
    return { data: 'test-user', count: executionCount };
  };

  const [res1, res2] = await Promise.all([
    singleFlight('uid_123', task),
    singleFlight('uid_123', task),
  ]);

  assert(executionCount === 1, `Expected 1 execution, got ${executionCount}`);
  assert(res1 === res2, 'Expected identical result references from shared promise');
  console.log('✓ single-flight (two concurrent calls, one execution, same result) passed');
}

async function testSingleFlightKeyDifferentiation() {
  clearSingleFlight();
  let executionCount = 0;

  const task = async (name: string) => {
    executionCount++;
    await new Promise((res) => setTimeout(res, 20));
    return name;
  };

  const [resA, resB] = await Promise.all([
    singleFlight('uid_A', () => task('Alice')),
    singleFlight('uid_B', () => task('Bob')),
  ]);

  assert(executionCount === 2, `Expected 2 executions for distinct keys, got ${executionCount}`);
  assert(resA === 'Alice', 'resA Alice mismatch');
  assert(resB === 'Bob', 'resB Bob mismatch');
  console.log('✓ single-flight key differentiation passed');
}

async function testCreateFirstIdempotenceSimulation() {
  // Simulates ensureUserProfile idempotent logic across race conditions:
  // 1) doc exists -> returns existing
  // 2) race: write fails with permission-denied because concurrent worker already setDoc -> re-read returns doc
  // 3) true denial: write fails and doc does not exist -> throws registration error

  type FakeDb = { [path: string]: any };

  async function simulateEnsureUserProfile(
    db: FakeDb,
    uid: string,
    payload: any,
    options?: { simulateDenialOnAbsent?: boolean; simulateRaceWrite?: boolean }
  ) {
    const docPath = `users/${uid}`;
    // Step 1: Read existing
    if (db[docPath]) {
      return { profile: db[docPath], status: 'found_existing' };
    }

    // Step 2: Write
    try {
      if (options?.simulateDenialOnAbsent) {
        throw new Error('permission-denied: simulated unauthorized write');
      }
      if (options?.simulateRaceWrite) {
        // another worker inserted doc concurrently
        db[docPath] = { ...payload, createdByWorker: 'worker-2' };
        throw new Error('permission-denied: document already exists with createdAt');
      }
      db[docPath] = payload;
      return { profile: payload, status: 'created' };
    } catch (writeErr: any) {
      // Step 3: Re-read fallback
      if (db[docPath]) {
        return { profile: db[docPath], status: 'recovered_from_race' };
      }
      throw writeErr;
    }
  }

  // Case A: Existing doc
  const dbA: FakeDb = { 'users/u1': { id: 'u1', status: 'pending' } };
  const resA = await simulateEnsureUserProfile(dbA, 'u1', { id: 'u1' });
  assert(resA.status === 'found_existing', 'Case A should find existing');

  // Case B: Race write (write denied because already exists after race)
  const dbB: FakeDb = {};
  const resB = await simulateEnsureUserProfile(dbB, 'u2', { id: 'u2' }, { simulateRaceWrite: true });
  assert(resB.status === 'recovered_from_race', 'Case B should recover existing profile from race');
  assert(resB.profile.createdByWorker === 'worker-2', 'Case B should have worker profile');

  // Case C: Truly denied
  let caughtError: any = null;
  const dbC: FakeDb = {};
  try {
    await simulateEnsureUserProfile(dbC, 'u3', { id: 'u3' }, { simulateDenialOnAbsent: true });
  } catch (err: any) {
    caughtError = err;
  }
  assert(caughtError !== null && caughtError.message.includes('permission-denied'), 'Case C should throw true denial');

  console.log('✓ create-first logic with fake data layer (existing, race, truly denied) passed');
}

async function testStaleResultGuardSimulation() {
  let activeAuthUid = 'user_initial';

  let attachedUid: string | null = null;
  const attach = async (targetUid: string) => {
    await new Promise((res) => setTimeout(res, 25));
    // Stale guard: if auth changed during resolution, ignore
    if (activeAuthUid !== targetUid) {
      return { ignored: true };
    }
    attachedUid = targetUid;
    return { ignored: false };
  };

  // User signs in as user_initial, but immediately switches to user_secondary
  const p1 = attach('user_initial');
  activeAuthUid = 'user_secondary';
  const p2 = attach('user_secondary');

  const [out1, out2] = await Promise.all([p1, p2]);
  assert(out1.ignored === true, 'user_initial result should have been ignored due to auth change');
  assert(out2.ignored === false, 'user_secondary should have attached');
  assert(attachedUid === 'user_secondary', 'active attached uid must be user_secondary');
  console.log('✓ stale-result guard simulation passed');
}

async function runAll() {
  console.log('--- RUNNING SINGLE-FLIGHT & SIGN-IN RACE TESTS ---');
  await testSingleFlightDeduplication();
  await testSingleFlightKeyDifferentiation();
  await testCreateFirstIdempotenceSimulation();
  await testStaleResultGuardSimulation();
  console.log('ALL SINGLE-FLIGHT & SIGN-IN TESTS PASSED CLEANLY!\n');
}

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
