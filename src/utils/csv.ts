/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Member, Session, CheckInRecord, MemberPrivate } from '../types';
import { formatTimeInClubTz } from './sessionWindow';
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

  // Formula injection defense: prefix dangerous leading characters (=, +, -, @, tab, CR, LF, or spaces before them) with a single quote
  if (/^[\t\r\n=+\-@]|^[ ]+[=+\-@]/.test(str)) {
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

  const validRecords = records.filter((r) => {
    if (members.length > 0 && !memberMap.has(r.memberId)) return false;
    if (sessions.length > 0) {
      const sess = sessionMap.get(r.sessionId);
      if (!sess || sess.status === 'cancelled' || sess.deletedAt) return false;
    }
    return true;
  });

  const rows = validRecords.map((r) => {
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
  privateDataMap?: Map<string, MemberPrivate>,
  now: Date = new Date()
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
    headers.push('Email', 'Phone', 'Student ID', 'University', 'Department', 'Major', 'Semester');
  }

  const rows = members.map((m) => {
    const stats = computeMemberStats(m, sessions, checkIns, now);
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
        sanitizeCSVCell(priv?.studentId || m.studentId || ''),
        sanitizeCSVCell(priv?.university || m.university || 'Tongmyong University'),
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
 * Generates Monthly Aggregation Report CSV
 */
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
    ['Metric', 'Value'].map(sanitizeCSVCell).join(','),
    ['Month', stats.monthLabel || ''].map(sanitizeCSVCell).join(','),
    ['Total Scheduled Sessions', stats.totalSessions].map(sanitizeCSVCell).join(','),
    ['Total Check-in Events', stats.totalCheckIns].map(sanitizeCSVCell).join(','),
    ['Unique Builders Attended', stats.uniqueBuilders].map(sanitizeCSVCell).join(','),
    ['Average Attendance Per Session', stats.averageAttendancePerSession].map(sanitizeCSVCell).join(','),
    ['Club Active Participation Rate', `${stats.activeRatePercent}%`].map(sanitizeCSVCell).join(','),
    '',
    ['Rank', 'Builder Name', 'Handle', 'Sessions Attended', 'Monthly Points', 'Streak', 'Attendance Rate']
      .map(sanitizeCSVCell)
      .join(','),
  ];

  if (stats.topBuilders && stats.topBuilders.length > 0) {
    stats.topBuilders.forEach((tb, i) => {
      lines.push(
        [
          i + 1,
          tb.member?.name || 'Unknown',
          tb.member?.handle || '',
          tb.monthlyCount ?? 0,
          tb.monthlyPoints ?? (tb.monthlyCount ?? 0) * 10,
          tb.streak ?? 0,
          `${tb.participationRate ?? 0}%`,
        ]
          .map(sanitizeCSVCell)
          .join(',')
      );
    });
  }

  return lines.join('\n');
}
