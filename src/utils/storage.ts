import { Member, Session, CheckInRecord, MemberPrivate } from '../types';
import { toJsDate, formatInClubTz, formatTimeInClubTz, todayInClubTz } from './sessionWindow';
import { computeMemberStats } from './stats';

export {
  sanitizeCSVCell,
  downloadCSV,
  generateAttendanceCSV,
  generateMembersRosterCSV,
  generateMonthlyReportCSV,
} from './csv';


/**
 * Calculates monthly aggregation statistics
 */
export function calculateMonthlyStats(
  monthKey: string,
  members: Member[],
  sessions: Session[],
  checkIns: CheckInRecord[]
) {
  const monthSessions = sessions.filter((s) => s.date && s.date.startsWith(monthKey));
  const monthCheckIns = checkIns.filter((c) => {
    if (c.monthKey) return c.monthKey === monthKey;
    if (c.date) return c.date.startsWith(monthKey);
    return false;
  });

  const uniqueBuilderIds = new Set(monthCheckIns.map((c) => c.memberId));
  const totalSessions = monthSessions.length;
  const totalCheckIns = monthCheckIns.length;
  const uniqueBuilders = uniqueBuilderIds.size;
  const averageAttendancePerSession =
    totalSessions > 0 ? Number((totalCheckIns / totalSessions).toFixed(1)) : 0;
  const activeRatePercent =
    members.length > 0 ? Math.round((uniqueBuilders / members.length) * 100) : 0;

  const monthLabel = formatMonthLabel(monthKey);

  const trackBreakdown: Record<string, number> = {};
  monthCheckIns.forEach((c) => {
    const track = c.track || 'Hardware & Robotics';
    trackBreakdown[track] = (trackBreakdown[track] || 0) + 1;
  });

  const sessionPointsMap = new Map<string, number>();
  monthSessions.forEach((s) => {
    sessionPointsMap.set(s.id, typeof s.points === 'number' ? s.points : 10);
  });

  const topBuilders = members.map((m) => {
    const memberMonthRecords = monthCheckIns.filter((c) => c.memberId === m.id);
    const memberMonthCheckIns = memberMonthRecords.length;
    let monthlyPoints = 0;
    memberMonthRecords.forEach((c) => {
      monthlyPoints += sessionPointsMap.get(c.sessionId) ?? 10;
    });
    const stats = computeMemberStats(m, sessions, checkIns);
    const streak = stats.streak;
    const participationRate = totalSessions > 0 ? Math.round((memberMonthCheckIns / totalSessions) * 100) : 0;
    return {
      member: m,
      monthlyCount: memberMonthCheckIns,
      monthlyPoints,
      streak,
      bestStreak: stats.bestStreak,
      totalPoints: stats.points,
      participationRate,
    };
  });

  return {
    totalSessions,
    totalCheckIns,
    uniqueBuilders,
    averageAttendancePerSession,
    activeRatePercent,
    monthLabel,
    topBuilders,
    trackBreakdown,
  };
}

/**
 * Returns available YYYY-MM month strings
 */
export function getAvailableMonthKeys(sessions: Session[], checkIns: CheckInRecord[]): string[] {
  const keys = new Set<string>();
  const currentMonth = todayInClubTz().substring(0, 7);
  keys.add(currentMonth);
  sessions.forEach((s) => {
    if (s.date && s.date.length >= 7) {
      keys.add(s.date.substring(0, 7));
    }
  });
  checkIns.forEach((c) => {
    if (c.monthKey) {
      keys.add(c.monthKey);
    }
  });
  return Array.from(keys).sort((a, b) => b.localeCompare(a));
}

export function formatMonthLabel(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const d = new Date(year, month, 1);
  return formatInClubTz(d, undefined, { month: 'long', year: 'numeric' });
}

// Memory-only fallback / UI navigation state (No localStorage for roster/user data)
export function getStoredMembers(): Member[] {
  return [];
}
export function saveStoredMembers(_members: Member[]): void {}

export function getStoredSessions(): Session[] {
  return [];
}
export function saveStoredSessions(_sessions: Session[]): void {}

export function getStoredCheckIns(): CheckInRecord[] {
  return [];
}
export function saveStoredCheckIns(_checkIns: CheckInRecord[]): void {}

const TAB_STORAGE_KEY = 'dob_hub_active_tab';
export function getSavedNavigationTab(defaultTab: string = 'home'): string {
  try {
    return sessionStorage.getItem(TAB_STORAGE_KEY) || defaultTab;
  } catch {
    return defaultTab;
  }
}
export function saveNavigationTab(tab: string): void {
  try {
    sessionStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {}
}
