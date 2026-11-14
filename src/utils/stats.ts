import { Member, Session, CheckInRecord, ComputedMemberStats, PublicLeaderboardItem } from '../types';
import { toJsDate, parseDateTimeInZone, getMonthKeyInClubTz } from './sessionWindow';
import {
  normalizeGitHubUrl,
  normalizeLinkedInUrl,
  normalizePortfolioUrl,
} from './profileLinks';

export const BACKFILL_COOLDOWN_MS = 60_000;

export function checkBackfillCooldown(
  lastSyncedAtMs: number | null,
  nowMs: number = Date.now(),
  cooldownMs: number = BACKFILL_COOLDOWN_MS
): { allowed: boolean; remainingMs: number; remainingSeconds: number } {
  if (lastSyncedAtMs === null || lastSyncedAtMs <= 0) {
    return { allowed: true, remainingMs: 0, remainingSeconds: 0 };
  }
  const elapsed = Math.max(0, nowMs - lastSyncedAtMs);
  if (elapsed >= cooldownMs) {
    return { allowed: true, remainingMs: 0, remainingSeconds: 0 };
  }
  const remainingMs = cooldownMs - elapsed;
  return {
    allowed: false,
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}

export function getLatestLeaderboardUpdate(items: PublicLeaderboardItem[]): string | null {
  let latestMs = 0;
  let latestIso: string | null = null;
  for (const item of items) {
    if (!item.lastUpdated) continue;
    const ms = toJsDate(item.lastUpdated).getTime();
    if (!Number.isNaN(ms) && ms > latestMs) {
      latestMs = ms;
      latestIso = typeof item.lastUpdated === 'string' ? item.lastUpdated : new Date(ms).toISOString();
    }
  }
  return latestIso;
}

function resolveSessionStartMs(s: Session): number {
  if (s.startAt) return toJsDate(s.startAt).getTime();
  if (s.date) return parseDateTimeInZone(s.date, s.startTime || '18:00', s.timezone).getTime();
  return 0;
}

function resolveSessionEndMs(s: Session): number {
  if (s.endAt) return toJsDate(s.endAt).getTime();
  if (s.date) return parseDateTimeInZone(s.date, s.endTime || '21:00', s.timezone).getTime();
  return 0;
}

function isValidAuthoritativeSession(s: Session | undefined): s is Session {
  return Boolean(s && s.status !== 'cancelled' && !s.deletedAt);
}

/**
 * Computes live, unforgeable member statistics from authoritative session and check-in records.
 * No counter is ever stored or trusted from the client.
 * Excludes orphan check-ins whose session has been permanently deleted, cancelled, or soft-deleted.
 */
export function computeMemberStats(
  member: Member,
  sessions: Session[],
  checkIns: CheckInRecord[],
  now: Date = new Date()
): ComputedMemberStats {
  const sessionMap = new Map<string, Session>();
  const sessionPointsMap = new Map<string, number>();
  sessions.forEach((s) => {
    sessionMap.set(s.id, s);
    sessionPointsMap.set(s.id, typeof s.points === 'number' ? s.points : 10);
  });

  const memberCheckIns = checkIns.filter(
    (c) => c.memberId === member.id && isValidAuthoritativeSession(sessionMap.get(c.sessionId))
  );
  const attendedSessionIds = new Set(memberCheckIns.map((c) => c.sessionId));

  const nowMs = now.getTime();
  const joinedDateStr = (member.joinedDate || '').split('T')[0];

  // Eligible sessions:
  // 1. Not cancelled and not soft-deleted
  // 2. Has ended or marked completed
  // 3. Started on or after member's joinedDate
  const eligibleSessions = sessions
    .filter((s) => {
      if (!isValidAuthoritativeSession(s)) return false;
      const endMs = resolveSessionEndMs(s);
      const isConcluded = s.status === 'completed' || endMs <= nowMs;
      if (!isConcluded) return false;

      // Date check against member.joinedDate (YYYY-MM-DD)
      if (joinedDateStr && s.date && s.date < joinedDateStr) {
        return false;
      }
      return true;
    })
    .sort((a, b) => resolveSessionStartMs(a) - resolveSessionStartMs(b) || a.id.localeCompare(b.id));

  // Points: sum of session.points for attended sessions (preserves explicit 0 points)
  let totalPoints = 0;
  attendedSessionIds.forEach((sid) => {
    totalPoints += sessionPointsMap.get(sid) ?? 10;
  });

  // Best streak (maximum consecutive run ever among eligible sessions)
  let bestStreak = 0;
  let currentRun = 0;
  for (const session of eligibleSessions) {
    if (attendedSessionIds.has(session.id)) {
      currentRun += 1;
      if (currentRun > bestStreak) {
        bestStreak = currentRun;
      }
    } else {
      currentRun = 0;
    }
  }

  // Current streak (consecutive attended from most recent backwards)
  let currentStreak = 0;
  for (let i = eligibleSessions.length - 1; i >= 0; i--) {
    const session = eligibleSessions[i];
    if (attendedSessionIds.has(session.id)) {
      currentStreak += 1;
    } else {
      break; // Missing one resets streak to 0
    }
  }

  const lateCount = memberCheckIns.filter((c) => c.status === 'late').length;

  return {
    total: attendedSessionIds.size,
    streak: currentStreak,
    bestStreak,
    points: totalPoints,
    lateCount,
  };
}

/**
 * Builds the public leaderboard projection from active members and live stats.
 * Excludes Inactive members and members with leaderboardOptOut === true.
 * Holds only non-PII public fields: name/displayName, handle, avatar, role, tracks, totals, streaks,
 * per-month metrics, and canonical public links ONLY when showLinksPublicly === true.
 */
export function buildPublicLeaderboardItems(
  members: Member[],
  sessions: Session[],
  checkIns: CheckInRecord[],
  now: Date = new Date()
): PublicLeaderboardItem[] {
  const sessionMap = new Map<string, Session>();
  const sessionMonthMap = new Map<string, string>();
  const sessionPointsMap = new Map<string, number>();
  sessions.forEach((s) => {
    sessionMap.set(s.id, s);
    if (s.date) {
      sessionMonthMap.set(s.id, s.date.substring(0, 7));
    }
    sessionPointsMap.set(s.id, typeof s.points === 'number' ? s.points : 10);
  });

  return members
    .filter((m) => m.status !== 'Inactive' && !m.leaderboardOptOut)
    .map((member) => {
      const stats = computeMemberStats(member, sessions, checkIns, now);
      const memberCheckIns = checkIns.filter(
        (c) => c.memberId === member.id && isValidAuthoritativeSession(sessionMap.get(c.sessionId))
      );

      // Deduplicate by sessionId so per-month counts and points match totalCheckIns/points
      const seenSessions = new Set<string>();
      const monthlyCheckIns: Record<string, number> = {};
      const monthlyPoints: Record<string, number> = {};

      memberCheckIns.forEach((c) => {
        if (seenSessions.has(c.sessionId)) return;
        seenSessions.add(c.sessionId);

        const monthKey =
          c.monthKey ||
          sessionMonthMap.get(c.sessionId) ||
          (c.date ? c.date.substring(0, 7) : undefined) ||
          (c.checkedInAt ? getMonthKeyInClubTz(c.checkedInAt) : undefined);

        if (monthKey) {
          monthlyCheckIns[monthKey] = (monthlyCheckIns[monthKey] || 0) + 1;
          const pts = sessionPointsMap.get(c.sessionId) ?? 10;
          monthlyPoints[monthKey] = (monthlyPoints[monthKey] || 0) + pts;
        }
      });

      const showLinksPublicly = member.showLinksPublicly === true;
      const gh = showLinksPublicly && member.githubUrl ? normalizeGitHubUrl(member.githubUrl) : null;
      const li = showLinksPublicly && member.linkedinUrl ? normalizeLinkedInUrl(member.linkedinUrl) : null;
      const pf = showLinksPublicly && member.portfolioUrl ? normalizePortfolioUrl(member.portfolioUrl) : null;

      const publicItem: PublicLeaderboardItem = {
        id: member.id,
        name: member.name,
        displayName: member.name,
        handle: member.handle,
        role: member.role,
        avatarUrl: member.avatarUrl || '',
        avatar: member.avatarUrl || '',
        tracks: member.tracks || [],
        totalCheckIns: stats.total,
        currentStreak: stats.streak,
        bestStreak: stats.bestStreak,
        points: stats.points,
        totalPoints: stats.points,
        monthlyCheckIns,
        monthlyPoints,
        monthlyScores: monthlyPoints,
        showLinksPublicly,
        lastUpdated: now.toISOString(),
      };

      if (showLinksPublicly) {
        if (gh?.valid && gh.canonicalUrl) publicItem.githubUrl = gh.canonicalUrl;
        if (li?.valid && li.canonicalUrl) publicItem.linkedinUrl = li.canonicalUrl;
        if (pf?.valid && pf.canonicalUrl) publicItem.portfolioUrl = pf.canonicalUrl;
      }

      return publicItem;
    })
    .sort((a, b) => {
      // Primary: Points, Secondary: Total Check-Ins, Tertiary: Current Streak, Best Streak, ID tie-break
      const ptsDiff = (b.points ?? 0) - (a.points ?? 0);
      if (ptsDiff !== 0) return ptsDiff;
      if (b.totalCheckIns !== a.totalCheckIns) return b.totalCheckIns - a.totalCheckIns;
      if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
      if (b.bestStreak !== a.bestStreak) return b.bestStreak - a.bestStreak;
      return a.id.localeCompare(b.id);
    });
}

export type LeaderboardBatchOp =
  | { type: 'set'; memberId: string; item: PublicLeaderboardItem }
  | { type: 'delete'; memberId: string };

export interface LeaderboardRecomputePlan {
  items: PublicLeaderboardItem[];
  setOps: Array<{ type: 'set'; memberId: string; item: PublicLeaderboardItem }>;
  deleteOps: Array<{ type: 'delete'; memberId: string }>;
  batches: LeaderboardBatchOp[][];
  totalOps: number;
  totalRemoved: number;
}

/**
 * Pure planner for full publicLeaderboard rebuilds & stale/opt-out pruning.
 * Chunks writes into safe batch sizes (<= 400 ops per commit, staying well under Firestore's 500-op limit).
 */
export function buildLeaderboardRecomputeOpsPlan(params: {
  members: Member[];
  sessions: Session[];
  checkIns: CheckInRecord[];
  existingPublicIds?: string[];
  chunkLimit?: number;
  now?: Date;
}): LeaderboardRecomputePlan {
  const {
    members,
    sessions,
    checkIns,
    existingPublicIds = [],
    chunkLimit = 400,
    now = new Date(),
  } = params;

  const safeChunkLimit = Math.max(1, Math.min(450, chunkLimit));
  const items = buildPublicLeaderboardItems(members, sessions, checkIns, now);
  const activeOptedInIds = new Set(items.map((item) => item.id));

  const setOps = items.map((item) => ({
    type: 'set' as const,
    memberId: item.id,
    item,
  }));

  const seenDeleted = new Set<string>();
  const deleteOps: Array<{ type: 'delete'; memberId: string }> = [];
  for (const existingId of existingPublicIds) {
    if (!activeOptedInIds.has(existingId) && !seenDeleted.has(existingId)) {
      seenDeleted.add(existingId);
      deleteOps.push({ type: 'delete' as const, memberId: existingId });
    }
  }

  const allOps: LeaderboardBatchOp[] = [...setOps, ...deleteOps];
  const batches: LeaderboardBatchOp[][] = [];
  for (let i = 0; i < allOps.length; i += safeChunkLimit) {
    batches.push(allOps.slice(i, i + safeChunkLimit));
  }

  return {
    items,
    setOps,
    deleteOps,
    batches,
    totalOps: allOps.length,
    totalRemoved: deleteOps.length,
  };
}
