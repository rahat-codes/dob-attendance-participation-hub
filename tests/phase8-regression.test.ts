/**
 * Phase 8 Regression & Hardening Behavioral Tests:
 * - Lazy Firestore dynamic loader: slow-load deduplication + failure reset & recovery retry
 * - Auth Firestore bootstrap failure maps cleanly to recoverable registrationError (no stuck spinner)
 * - Bounded admin listener guard + multi-month (>3 months) streak/total full-history preservation
 * - Reminder `where('sessionId', 'in', ...)` chunking (<= 10, strictly <= 30)
 */

import fs from 'fs';
import path from 'path';
import {
  createLazyFirestoreLoader,
  resolveAuthFirestoreLoadFailure,
} from '../src/firebase/lazyFirestore';
import {
  getBoundedCheckInStartMonthKey,
  mergeBoundedWithHistory,
  resolveLeaderboardRecomputeSource,
  chunkIds,
} from '../src/utils/listenerScope';
import {
  buildPublicLeaderboardItems,
  computeMemberStats,
} from '../src/utils/stats';
import type { CheckInRecord, Member, Session } from '../src/types';

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
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n[Test 1] Lazy Firestore Loader (slow-load dedupe & failure retry reset)');
  {
    let calls = 0;
    let resolveSlow!: (v: { ok: boolean }) => void;
    const loader = createLazyFirestoreLoader(() => {
      calls += 1;
      return new Promise<{ ok: boolean }>((resolve) => {
        resolveSlow = resolve;
      });
    });

    const p1 = loader();
    const p2 = loader();
    assertEq(calls, 1, 'concurrent slow-load callers share one in-flight dynamic import');

    resolveSlow({ ok: true });
    const [r1, r2] = await Promise.all([p1, p2]);
    assertEq(r1.ok && r2.ok, true, 'slow-load resolves cleanly for all waiting callers');

    // Failure -> reset -> recovery retry
    let attempt = 0;
    const flakyLoader = createLazyFirestoreLoader(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('Failed to fetch dynamically imported module');
      }
      return { recovered: true };
    });

    let firstFailed = false;
    try {
      await flakyLoader();
    } catch {
      firstFailed = true;
    }
    assertEq(firstFailed, true, 'initial failed dynamic import rejects cleanly for caller UI');

    const retried = await flakyLoader();
    assertEq(attempt, 2, 'retry invokes dynamic import again instead of caching rejected promise');
    assertEq(retried.recovered, true, 'retry succeeds after transient chunk/network failure');
  }

  console.log('\n[Test 2] Auth Firestore load failure escapes loading_profile spinner');
  {
    const chunkFailure = resolveAuthFirestoreLoadFailure(
      new Error('Failed to fetch dynamically imported module: firestoreService')
    );
    assertEq(chunkFailure.registrationError.code, 'firestore-load-failed', 'sets explicit registrationError code on chunk load failure');
    assert(
      chunkFailure.authError.toLowerCase().includes('retry'),
      'produces friendly retry message instead of leaving LoginView in verifying state'
    );

    const codeFailure = resolveAuthFirestoreLoadFailure({
      code: 'unavailable',
      message: 'Backend unavailable',
    });
    assertEq(codeFailure.registrationError.code, 'unavailable', 'preserves explicit Firestore error code when provided');
    assertEq(codeFailure.authError, 'Backend unavailable', 'preserves explicit message when not a generic fetch error');
  }

  console.log('\n[Test 3] All-time stats, >3-month streak, and full-history leaderboard recompute guard');
  {
    const nowOct = new Date('2026-10-20T09:00:00.000Z');
    const boundedMinMonth = getBoundedCheckInStartMonthKey(nowOct, 2, 'Asia/Seoul');
    assertEq(boundedMinMonth, '2026-08', 'bounded check-in window covers current + 2 previous months (2026-08..2026-10)');

    // When full history has not been loaded yet, recompute must use backfill_full (server collection fetch)
    assertEq(
      resolveLeaderboardRecomputeSource({ hasLoadedAllHistory: false, hasLiveData: true }),
      'backfill_full',
      'blocks overwriting publicLeaderboard with truncated bounded admin slices'
    );
    assertEq(
      resolveLeaderboardRecomputeSource({ hasLoadedAllHistory: true, hasLiveData: true }),
      'live_full',
      'permits in-memory recompute once full history is loaded'
    );

    const builder: Member = {
      id: 'mem_streak_5',
      name: 'Minjun Park',
      handle: '@minjun',
      role: 'Builder',
      tracks: ['Software & Systems'],
      avatarUrl: '',
      joinedDate: '2026-01-10',
      status: 'Active',
    };

    const makeTs = (iso: string) => ({ seconds: Math.floor(Date.parse(iso) / 1000), nanoseconds: 0 });
    const sessionSpecs = [
      { id: 'sess_m6', title: 'June Sprint', date: '2026-06-15', startIso: '2026-06-15T09:00:00.000Z', endIso: '2026-06-15T11:00:00.000Z' },
      { id: 'sess_m7', title: 'July Sprint', date: '2026-07-15', startIso: '2026-07-15T09:00:00.000Z', endIso: '2026-07-15T11:00:00.000Z' },
      { id: 'sess_m8', title: 'August Sprint', date: '2026-08-15', startIso: '2026-08-15T09:00:00.000Z', endIso: '2026-08-15T11:00:00.000Z' },
      { id: 'sess_m9', title: 'September Sprint', date: '2026-09-15', startIso: '2026-09-15T09:00:00.000Z', endIso: '2026-09-15T11:00:00.000Z' },
      { id: 'sess_m10', title: 'October Sprint', date: '2026-10-15', startIso: '2026-10-15T09:00:00.000Z', endIso: '2026-10-15T11:00:00.000Z' },
    ];

    const allSessions: Session[] = sessionSpecs.map((sp) => ({
      id: sp.id,
      title: sp.title,
      track: 'Software & Systems',
      date: sp.date,
      startTime: '18:00',
      endTime: '20:00',
      startAt: makeTs(sp.startIso),
      endAt: makeTs(sp.endIso),
      timezone: 'Asia/Seoul',
      location: 'Lab A',
      description: '',
      host: 'Lead',
      status: 'completed',
      points: 10,
    }));

    const allCheckIns: CheckInRecord[] = sessionSpecs.map((sp) => ({
      id: `${sp.id}_${builder.id}`,
      sessionId: sp.id,
      memberId: builder.id,
      method: 'camera_scan',
      status: 'present',
      monthKey: sp.date.slice(0, 7),
      checkedInAt: sp.startIso,
      timestamp: sp.startIso,
    }));

    const boundedCheckIns = allCheckIns.filter((c) => c.monthKey >= boundedMinMonth);
    const boundedStats = computeMemberStats(builder, allSessions, boundedCheckIns, nowOct);
    assertEq(boundedStats.total, 3, 'bounded-only checkIns miss pre-window (>3 months old) check-ins');
    assertEq(boundedStats.streak, 3, 'bounded-only checkIns truncate streak to 3');

    const fullMergedCheckIns = mergeBoundedWithHistory(allCheckIns, boundedCheckIns);
    const fullStats = computeMemberStats(builder, allSessions, fullMergedCheckIns, nowOct);
    assertEq(fullStats.total, 5, 'full-history merge preserves 5 total check-ins spanning 5 months');
    assertEq(fullStats.streak, 5, 'full-history merge preserves unbroken 5-session (>3-month) streak');
    assertEq(fullStats.bestStreak, 5, 'full-history merge computes bestStreak === 5');
    assertEq(fullStats.points, 50, 'full-history merge computes full 50 points');

    const [pubItem] = buildPublicLeaderboardItems([builder], allSessions, fullMergedCheckIns, nowOct);
    assertEq(pubItem.totalCheckIns, 5, 'publicLeaderboard projection includes full 5 check-ins across >3 months');
    assertEq(pubItem.currentStreak, 5, 'publicLeaderboard projection includes full 5-session streak across >3 months');
    assertEq(pubItem.points, 50, 'publicLeaderboard projection includes full 50 points across >3 months');
  }

  console.log('\n[Test 4] Reminder query `in` chunking stays <= 10 (strictly <= 30 Firestore limit)');
  {
    assertEq(chunkIds([], 10), [], 'empty sessionIds list returns zero chunks');
    const ids35 = Array.from({ length: 35 }, (_, idx) => `sess_${idx + 1}`);
    const chunks10 = chunkIds(ids35, 10);
    assertEq(
      chunks10.map((c) => c.length),
      [10, 10, 10, 5],
      'splits 35 upcoming sessions into [10, 10, 10, 5] chunks'
    );
    assert(
      chunks10.every((c) => c.length > 0 && c.length <= 30),
      'every reminder `in` query chunk satisfies Firestore <= 30 limit'
    );
    assertEq(chunks10.flat(), ids35, 'chunking preserves all session IDs in exact order');
  }

  console.log('\n[Test 5] Server headers & self-unregistering Service Worker invariants');
  {
    const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    const swSrc = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
    assert(serverSrc.includes("X-Content-Type-Options', 'nosniff'"), 'server sets X-Content-Type-Options: nosniff');
    assert(serverSrc.includes("Content-Security-Policy-Report-Only"), 'server sets Content-Security-Policy-Report-Only header');
    assert(serverSrc.includes("immutable: true"), 'server sets immutable cache only on hashed /assets bundles');
    assert(swSrc.includes('self.registration.unregister()') && !swSrc.includes('caches.open'), 'public/sw.js only clears caches/unregisters and never caches network responses');
  }

  console.log(`\nPhase 8 Regression Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
