import { Member, Session, CheckInRecord, ComputedMemberStats, BuilderTrack, PublicLeaderboardItem } from '../types';
import { toJsDate } from './sessionWindow';

/**
 * Computes live, unforgeable member statistics from authoritative session and check-in records.
 * No counter is ever stored or trusted from the client.
 */
export function computeMemberStats(
  member: Member,
  sessions: Session[],
  checkIns: CheckInRecord[],
  now: Date = new Date()
): ComputedMemberStats {
  const memberCheckIns = checkIns.filter((c) => c.memberId === member.id);
  const attendedSessionIds = new Set(memberCheckIns.map((c) => c.sessionId));

  const nowMs = now.getTime();
  const joinedDateStr = (member.joinedDate || '').split('T')[0];

  // Eligible sessions:
  // 1. Not cancelled
  // 2. Has ended or marked completed
  // 3. Started on or after member's joinedDate
  const eligibleSessions = sessions
    .filter((s) => {
      if (s.status === 'cancelled') return false;
      const endMs = toJsDate(s.endAt).getTime();
      const isConcluded = s.status === 'completed' || endMs <= nowMs;
      if (!isConcluded) return false;

      // Date check against member.joinedDate (YYYY-MM-DD)
      if (joinedDateStr && s.date && s.date < joinedDateStr) {
        return false;
      }
      return true;
    })
    .sort((a, b) => toJsDate(a.startAt).getTime() - toJsDate(b.startAt).getTime());

  // Points: sum of session.points for attended sessions
  const sessionPointsMap = new Map<string, number>();
  sessions.forEach((s) => {
    sessionPointsMap.set(s.id, typeof s.points === 'number' ? s.points : 10);
  });

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
 */
export function buildPublicLeaderboardItems(
  members: Member[],
  sessions: Session[],
  checkIns: CheckInRecord[],
  now: Date = new Date()
): PublicLeaderboardItem[] {
  return members
    .filter((m) => m.status !== 'Inactive' && !m.leaderboardOptOut)
    .map((member) => {
      const stats = computeMemberStats(member, sessions, checkIns, now);
      return {
        id: member.id,
        name: member.name,
        handle: member.handle,
        role: member.role,
        avatarUrl: member.avatarUrl,
        tracks: member.tracks || [],
        totalCheckIns: stats.total,
        currentStreak: stats.streak,
        bestStreak: stats.bestStreak,
        points: stats.points,
      };
    })
    .sort((a, b) => {
      // Primary: Points, Secondary: Total Check-Ins, Tertiary: Streak
      if (b.points !== a.points) return b.points - a.points;
      if (b.totalCheckIns !== a.totalCheckIns) return b.totalCheckIns - a.totalCheckIns;
      return b.currentStreak - a.currentStreak;
    });
}
