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
  computeLeaderboardDataSignature,
  computeMemberStats,
  estimateLeaderboardRecomputeReads,
  MAX_AUTO_RECOMPUTES_PER_HOUR,
  ONE_HOUR_MS,
  pruneHourlyTimestamps,
  shouldTriggerDebouncedRecompute,
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

  console.log('\n[Test 5] Server hardening headers, compression (skip 206), CSP collector, 404 assets & SW invariants');
  {
    const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    const swSrc = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
    assert(serverSrc.includes("import compression from 'compression'") && serverSrc.includes('threshold: 1024'), 'server uses standard compression package with 1 KB threshold');
    assert(serverSrc.includes("res.statusCode === 206 || res.getHeader('Content-Range')"), 'compression filter explicitly skips HTTP 206 / Content-Range responses');
    assert(serverSrc.includes("X-Content-Type-Options', 'nosniff'"), 'server sets X-Content-Type-Options: nosniff');
    assert(serverSrc.includes('Strict-Transport-Security'), 'server conditionally emits HSTS on HTTPS / x-forwarded-proto=https');
    assert(serverSrc.includes("Content-Security-Policy-Report-Only") && serverSrc.includes('report-uri /api/csp-report'), 'server sets CSP Report-Only pointing to /api/csp-report');
    assert(serverSrc.includes("'/api/csp-report'") && serverSrc.includes("limit: '8kb'") && serverSrc.includes('allowCspReportIp'), 'POST /api/csp-report is size-capped (8kb) and rate-limited per IP');
    assert(serverSrc.includes("app.get('/api/health'") && serverSrc.includes("res.json({ status: 'ok' })"), '/api/health returns only { status: "ok" }');
    assert(serverSrc.includes('path.extname(req.path)') && serverSrc.includes("res.status(404).type('text/plain').send('Not found')"), 'unknown paths with file extensions return 404 instead of index.html');
    assert(serverSrc.includes('req.path.startsWith(\'/api/\')') && !serverSrc.includes('err.stack'), 'error handler omits stack traces and returns JSON for /api vs plain text');
    assert(serverSrc.includes('immutable: true'), 'server sets immutable cache only on hashed /assets bundles');
    assert(swSrc.includes('self.registration.unregister()') && !swSrc.includes('caches.open'), 'public/sw.js only clears caches/unregisters and never caches network responses');
  }

  console.log('\n[Test 6] Leaderboard recompute cost guards (data signature, 6/hr cap, read estimates)');
  {
    const baseMembers: Member[] = [
      {
        id: 'mem_1',
        name: 'Alice',
        handle: '@alice',
        role: 'Builder',
        tracks: ['Software & Systems'],
        avatarUrl: '',
        joinedDate: '2026-01-01',
        status: 'Active',
      },
    ];
    const baseSessions: Session[] = [
      {
        id: 'sess_1',
        title: 'Build Night',
        track: 'Software & Systems',
        date: '2026-10-10',
        startTime: '18:00',
        endTime: '20:00',
        timezone: 'Asia/Seoul',
        location: 'Lab A',
        description: '',
        host: 'Lead',
        status: 'completed',
        points: 10,
      },
    ];
    const baseCheckIns: CheckInRecord[] = [
      {
        id: 'sess_1_mem_1',
        sessionId: 'sess_1',
        memberId: 'mem_1',
        method: 'camera_scan',
        status: 'present',
        monthKey: '2026-10',
        checkedInAt: '2026-10-10T09:05:00.000Z',
        timestamp: '2026-10-10T09:05:00.000Z',
      },
    ];

    const sig1 = computeLeaderboardDataSignature(baseMembers, baseSessions, baseCheckIns);
    const sigSame = computeLeaderboardDataSignature([...baseMembers], [...baseSessions], [...baseCheckIns]);
    assertEq(sig1, sigSame, 'computeLeaderboardDataSignature is deterministic for identical snapshots');

    const sigNewCheckIn = computeLeaderboardDataSignature(
      baseMembers,
      baseSessions,
      [...baseCheckIns, { ...baseCheckIns[0], id: 'sess_2_mem_1', sessionId: 'sess_2' }]
    );
    const sigStatusChange = computeLeaderboardDataSignature(
      [{ ...baseMembers[0], status: 'Inactive' }],
      baseSessions,
      baseCheckIns
    );
    const sigSessionPointsChange = computeLeaderboardDataSignature(
      baseMembers,
      [{ ...baseSessions[0], points: 25 }],
      baseCheckIns
    );
    assert(sigNewCheckIn !== sig1, 'data signature changes when a new check-in arrives');
    assert(sigStatusChange !== sig1, 'data signature changes when member status changes');
    assert(sigSessionPointsChange !== sig1, 'data signature changes when session points change');

    const nowMs = Date.parse('2026-10-20T12:00:00.000Z');
    const sixMinutesAgo = nowMs - 6 * 60_000;

    // 1. No-op identical signature is skipped even past the 5m debounce
    assertEq(
      shouldTriggerDebouncedRecompute({
        isAdmin: true,
        hasSettledInitialLoad: true,
        isTabVisible: true,
        hasExistingProjection: true,
        nowMs,
        lastAutoRecomputeAtMs: sixMinutesAgo,
        dataSignature: sig1,
        lastSyncedDataSignature: sig1,
        recentRecomputeTimestampsMs: [],
      }),
      false,
      'skips open-tab recompute when live data signature is unchanged'
    );

    // 2. Changed signature within <6 runs/hr triggers cleanly
    assertEq(
      shouldTriggerDebouncedRecompute({
        isAdmin: true,
        hasSettledInitialLoad: true,
        isTabVisible: true,
        hasExistingProjection: true,
        nowMs,
        lastAutoRecomputeAtMs: sixMinutesAgo,
        dataSignature: sigNewCheckIn,
        lastSyncedDataSignature: sig1,
        recentRecomputeTimestampsMs: [nowMs - 50 * 60_000, nowMs - 30 * 60_000],
      }),
      true,
      'triggers recompute when data changed, >=5m elapsed, and runs < 6/hr'
    );

    // 3. Hard cap of 6 runs/hr blocks a 7th automatic run
    const sixRecentRuns = Array.from({ length: MAX_AUTO_RECOMPUTES_PER_HOUR }, (_, i) => nowMs - (i + 6) * 60_000);
    assertEq(
      shouldTriggerDebouncedRecompute({
        isAdmin: true,
        hasSettledInitialLoad: true,
        isTabVisible: true,
        hasExistingProjection: true,
        nowMs,
        lastAutoRecomputeAtMs: sixMinutesAgo,
        dataSignature: sigNewCheckIn,
        lastSyncedDataSignature: sig1,
        recentRecomputeTimestampsMs: sixRecentRuns,
      }),
      false,
      'enforces hard cap of 6 automatic open-tab recomputes per hour'
    );

    // 4. Rolling window drops runs older than 1 hour so recomputes resume naturally
    const expiredPlusFive = [nowMs - ONE_HOUR_MS - 10_000, ...sixRecentRuns.slice(0, 5)];
    assertEq(pruneHourlyTimestamps(expiredPlusFive, nowMs).length, 5, 'pruneHourlyTimestamps drops entries older than 1 hour');
    assertEq(
      shouldTriggerDebouncedRecompute({
        isAdmin: true,
        hasSettledInitialLoad: true,
        isTabVisible: true,
        hasExistingProjection: true,
        nowMs,
        lastAutoRecomputeAtMs: sixMinutesAgo,
        dataSignature: sigNewCheckIn,
        lastSyncedDataSignature: sig1,
        recentRecomputeTimestampsMs: expiredPlusFive,
      }),
      true,
      'resumes recompute allowance once an older timestamp ages past 1 hour'
    );

    // 5. Read cost estimates match documented 100 / 500 / 3,000 scales
    assertEq(
      estimateLeaderboardRecomputeReads({
        memberCount: 100,
        sessionCount: 40,
        checkInCount: 100,
        publicLeaderboardCount: 100,
        usesFullCollectionFetch: true,
      }).estimatedReads,
      340,
      'read estimate for 100 check-ins backfill_full = 340 reads'
    );
    assertEq(
      estimateLeaderboardRecomputeReads({
        memberCount: 100,
        sessionCount: 40,
        checkInCount: 500,
        publicLeaderboardCount: 100,
        usesFullCollectionFetch: true,
      }).estimatedReads,
      740,
      'read estimate for 500 check-ins backfill_full = 740 reads'
    );
    assertEq(
      estimateLeaderboardRecomputeReads({
        memberCount: 100,
        sessionCount: 40,
        checkInCount: 3000,
        publicLeaderboardCount: 100,
        usesFullCollectionFetch: true,
      }).estimatedReads,
      3240,
      'read estimate for 3,000 check-ins backfill_full = 3,240 reads'
    );
    assertEq(
      estimateLeaderboardRecomputeReads({
        memberCount: 100,
        sessionCount: 40,
        checkInCount: 3000,
        publicLeaderboardCount: 100,
        usesFullCollectionFetch: false,
      }).estimatedReads,
      100,
      'read estimate for in_memory recompute = 100 reads (publicLeaderboard IDs only)'
    );
  }

  console.log(`\nPhase 8 Regression Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
