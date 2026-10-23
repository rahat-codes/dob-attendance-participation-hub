import { Member, Session, CheckInRecord, MemberPrivate } from '../types';
import { toJsDate, formatInClubTz, formatTimeInClubTz, todayInClubTz } from './sessionWindow';
import { computeMemberStats } from './stats';

/**
 * Sanitizes and escapes a CSV cell:
 * 1. Converts to string
 * 2. Neutralizes CSV formula injection (cells starting with =, +, -, @ are prefixed with ')
 * 3. Escapes embedded double quotes by doubling them ("" -> """")
 * 4. Wraps cell in double quotes
 */
export function sanitizeCSVCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }
  let str = String(value);

  // Formula injection defense: prefix dangerous leading characters with a single quote
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  // Escape double quotes
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Downloads CSV content as a file with UTF-8 BOM (\uFEFF)
 * so Korean characters, accents, and emojis render properly in Microsoft Excel and other spreadsheet editors.
 */
export function downloadCSV(filename: string, csvContent: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates Attendance Record CSV
 * Joins member and session details authoritatively
 */
export function generateAttendanceCSV(
  records: CheckInRecord[],
  members: Member[] = [],
  sessions: Session[] = []
): string {
  const memberMap = new Map<string, Member>();
  members.forEach((m) => memberMap.set(m.id, m));

  const sessionMap = new Map<string, Session>();
  sessions.forEach((s) => sessionMap.set(s.id, s));

  const headers = [
    'Record ID',
    'Session ID',
    'Session Title',
    'Track',
    'Session Date',
    'Check-in Time',
    'Status',
    'Check-in Method',
    'Member ID',
    'Member Name',
    'Handle',
    'Guild Role',
    'Verified By',
  ];

  const rows = records.map((r) => {
    const mem = memberMap.get(r.memberId);
    const sess = sessionMap.get(r.sessionId);

    const formattedTime = r.checkedInAt
      ? formatTimeInClubTz(r.checkedInAt)
      : r.timestamp
      ? formatTimeInClubTz(r.timestamp)
      : '';

    return [
      sanitizeCSVCell(r.id),
      sanitizeCSVCell(r.sessionId),
      sanitizeCSVCell(sess?.title || r.sessionTitle || 'Workshop Session'),
      sanitizeCSVCell(sess?.track || r.track || ''),
      sanitizeCSVCell(sess?.date || r.date || ''),
      sanitizeCSVCell(formattedTime),
      sanitizeCSVCell(r.status),
      sanitizeCSVCell(r.method),
      sanitizeCSVCell(r.memberId),
      sanitizeCSVCell(mem?.name || r.memberName || 'Club Builder'),
      sanitizeCSVCell(mem?.handle || r.memberHandle || ''),
      sanitizeCSVCell(mem?.role || r.memberRole || 'Member'),
      sanitizeCSVCell(r.verifiedBy || 'system'),
    ].join(',');
  });

  return [headers.map(sanitizeCSVCell).join(','), ...rows].join('\n');
}

/**
 * Generates Member Roster CSV
 * For admins, private details from memberPrivate can be included securely.
 */
export function generateMembersRosterCSV(
  members: Member[],
  sessions: Session[],
  checkIns: CheckInRecord[],
  privateDataMap?: Map<string, MemberPrivate>
): string {
  const headers = [
    'Member ID',
    'Full Name',
    'Handle',
    'Guild Role',
    'Tracks',
    'Status',
    'Joined Date',
    'Verified Attendance',
    'Current Streak',
    'Best Streak',
    'Points',
  ];

  if (privateDataMap) {
    headers.push('Email', 'Phone', 'University', 'Department', 'Major', 'Semester');
  }

  const rows = members.map((m) => {
    const stats = computeMemberStats(m, sessions, checkIns);
    const priv = privateDataMap?.get(m.id);

    const cols = [
      sanitizeCSVCell(m.id),
      sanitizeCSVCell(m.name),
      sanitizeCSVCell(m.handle),
      sanitizeCSVCell(m.role),
      sanitizeCSVCell((m.tracks || []).join('; ')),
      sanitizeCSVCell(m.status || 'Active'),
      sanitizeCSVCell(m.joinedDate),
      sanitizeCSVCell(stats.total),
      sanitizeCSVCell(stats.streak),
      sanitizeCSVCell(stats.bestStreak),
      sanitizeCSVCell(stats.points),
    ];

    if (privateDataMap) {
      cols.push(
        sanitizeCSVCell(priv?.email || m.email || ''),
        sanitizeCSVCell(priv?.phone || m.phone || ''),
        sanitizeCSVCell(priv?.university || m.university || ''),
        sanitizeCSVCell(priv?.department || m.department || ''),
        sanitizeCSVCell(priv?.major || m.major || ''),
        sanitizeCSVCell(priv?.semester || m.semester || '')
      );
    }

    return cols.join(',');
  });

  return [headers.map(sanitizeCSVCell).join(','), ...rows].join('\n');
}

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

  const topBuilders = members.map((m) => {
    const memberMonthCheckIns = monthCheckIns.filter((c) => c.memberId === m.id).length;
    const streak = m.currentStreak || 0;
    const participationRate = totalSessions > 0 ? Math.round((memberMonthCheckIns / totalSessions) * 100) : 0;
    return {
      member: m,
      monthlyCount: memberMonthCheckIns,
      streak,
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

export function generateMonthlyReportCSV(stats: {
  monthLabel?: string;
  totalSessions: number;
  totalCheckIns: number;
  uniqueBuilders: number;
  averageAttendancePerSession: number;
  activeRatePercent: number;
  topBuilders?: any[];
}): string {
  const lines = [
    'Metric,Value',
    `Month,"${stats.monthLabel || ''}"`,
    `Total Scheduled Sessions,${stats.totalSessions}`,
    `Total Check-ins Logged,${stats.totalCheckIns}`,
    `Unique Active Builders,${stats.uniqueBuilders}`,
    `Average Attendance Per Session,${stats.averageAttendancePerSession}`,
    `Active Rate,${stats.activeRatePercent}%`,
  ];
  return lines.join('\n');
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
