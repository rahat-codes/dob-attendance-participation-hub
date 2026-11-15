import { useState, useEffect } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { Session, SessionState, SessionPhase } from '../types';
import { DEFAULT_CLUB_TIMEZONE } from '../config/constants';
import { getCorrectedNow } from './serverTime';

export type SessionTemporalStatus = 'open_now' | 'upcoming' | 'closed' | 'cancelled';
export type SessionBadgeVariant = 'open_now' | 'upcoming' | 'upcoming_soon' | 'closed' | 'cancelled';

/**
 * Converts a Timestamp, Date, seconds object, or string into a native JavaScript Date.
 */
export function toJsDate(
  val: Timestamp | { seconds: number; nanoseconds?: number } | Date | string | number | undefined | null
): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const [y, m, d] = val.split('-').map(Number);
      return new Date(y, m - 1, d, 12, 0, 0);
    }
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  if (typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate();
  }
  if ('seconds' in val && typeof val.seconds === 'number') {
    return new Date(val.seconds * 1000 + (val.nanoseconds ? Math.floor(val.nanoseconds / 1000000) : 0));
  }
  return new Date();
}

/**
 * Parses date and time strings (e.g. "2026-10-15", "18:00") in the specified IANA timezone into a UTC Date.
 */
export function parseDateTimeInZone(dateStr: string, timeStr: string, tz?: string): Date {
  const [y, m, d] = (dateStr || '2026-01-01').split('-').map(Number);
  const [h, min] = (timeStr || '18:00').split(':').map(Number);
  if (!tz) {
    return new Date(y, (m || 1) - 1, d || 1, h || 0, min || 0, 0);
  }
  const utcGuess = new Date(Date.UTC(y, (m || 1) - 1, d || 1, h || 0, min || 0, 0));
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(utcGuess);

    const py = Number(parts.find((p) => p.type === 'year')?.value);
    const pm = Number(parts.find((p) => p.type === 'month')?.value);
    const pd = Number(parts.find((p) => p.type === 'day')?.value);
    const ph = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
    const pmin = Number(parts.find((p) => p.type === 'minute')?.value);

    const localGuessMs = Date.UTC(py, pm - 1, pd, ph, pmin, 0);
    const offsetMs = localGuessMs - utcGuess.getTime();
    return new Date(utcGuess.getTime() - offsetMs);
  } catch {
    return utcGuess;
  }
}

/**
 * Evaluates the authoritative session phase and check-in window.
 * Rules:
 * - 'cancelled' if status === 'cancelled'
 * - 'open' if checkInMode === 'open', or (checkInMode === 'auto' and startAt - openMinutesBefore <= now <= endAt + graceMinutesAfter)
 * - 'closed' if checkInMode === 'closed', status === 'completed', or now > endAt + graceMinutesAfter
 * - otherwise 'upcoming'
 */
export function getSessionState(session: Session, nowInput?: Date | number): SessionState {
  const now = nowInput instanceof Date ? nowInput : typeof nowInput === 'number' ? new Date(nowInput) : getCorrectedNow();
  const nowMs = now.getTime();

  let startDate: Date;
  let endDate: Date;

  if (session.startAt) {
    startDate = toJsDate(session.startAt);
  } else if (session.date && session.startTime) {
    startDate = parseDateTimeInZone(session.date, session.startTime, session.timezone);
  } else {
    startDate = new Date(nowMs);
  }

  if (session.endAt) {
    endDate = toJsDate(session.endAt);
  } else if (session.date && session.endTime) {
    endDate = parseDateTimeInZone(session.date, session.endTime, session.timezone);
  } else {
    endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  }

  // Matches firestore.rules s.get('openMinutesBefore', 15), s.get('graceMinutesAfter', 30), s.get('lateAfterMinutes', 10)
  // for Timestamp-backed sessions; pre-migration display-only sessions without startAt/endAt use exact HH:mm boundaries.
  const openMins = typeof session.openMinutesBefore === 'number'
    ? session.openMinutesBefore
    : session.startAt ? 15 : 0;
  const graceMins = typeof session.graceMinutesAfter === 'number'
    ? session.graceMinutesAfter
    : session.endAt ? 30 : 0;
  const lateMins = typeof session.lateAfterMinutes === 'number'
    ? session.lateAfterMinutes
    : 10;

  const opensAt = new Date(startDate.getTime() - openMins * 60 * 1000);
  const closesAt = new Date(endDate.getTime() + graceMins * 60 * 1000);
  const lateThreshold = new Date(startDate.getTime() + lateMins * 60 * 1000);

  const diffMs = opensAt.getTime() - nowMs;
  const minutesToOpen = Math.max(0, Math.ceil(diffMs / (60 * 1000)));

  const isLate = (targetNow?: Date) => {
    const t = targetNow ? targetNow.getTime() : nowMs;
    return t > lateThreshold.getTime();
  };

  if (session.status === 'cancelled') {
    return {
      phase: 'cancelled',
      opensAt,
      closesAt,
      minutesToOpen,
      isLate,
    };
  }

  if (session.status === 'completed' || session.checkInMode === 'closed') {
    return {
      phase: 'closed',
      opensAt,
      closesAt,
      minutesToOpen: 0,
      isLate,
    };
  }

  if (session.checkInMode === 'open') {
    return {
      phase: 'open',
      opensAt,
      closesAt,
      minutesToOpen: 0,
      isLate,
    };
  }

  // checkInMode === 'auto' (or undefined default 'auto')
  if (nowMs >= opensAt.getTime() && nowMs <= closesAt.getTime()) {
    return {
      phase: 'open',
      opensAt,
      closesAt,
      minutesToOpen: 0,
      isLate,
    };
  }

  if (nowMs > closesAt.getTime()) {
    return {
      phase: 'closed',
      opensAt,
      closesAt,
      minutesToOpen: 0,
      isLate,
    };
  }

  return {
    phase: 'upcoming',
    opensAt,
    closesAt,
    minutesToOpen,
    isLate,
  };
}

/**
 * Selects the most relevant target session based on time and status.
 * Prioritizes: Open Now > Upcoming (nearest) > Most recent completed/closed
 */
export function getTargetSession(sessions: Session[], nowInput?: Date | number): Session | undefined {
  if (!sessions || sessions.length === 0) return undefined;
  const now = nowInput instanceof Date ? nowInput : typeof nowInput === 'number' ? new Date(nowInput) : new Date();

  // 1. Open session
  const openSession = sessions.find((s) => getSessionState(s, now).phase === 'open');
  if (openSession) return openSession;

  // 2. Nearest upcoming session
  const upcoming = sessions
    .filter((s) => getSessionState(s, now).phase === 'upcoming')
    .sort((a, b) => {
      const aStart = a.startAt ? toJsDate(a.startAt).getTime() : parseDateTimeInZone(a.date, a.startTime || '18:00', a.timezone).getTime();
      const bStart = b.startAt ? toJsDate(b.startAt).getTime() : parseDateTimeInZone(b.date, b.startTime || '18:00', b.timezone).getTime();
      return aStart - bStart;
    });
  if (upcoming.length > 0) return upcoming[0];

  // 3. Fallback to first session
  return sessions[0];
}

/**
 * Returns backward-compatible temporal metadata for session cards and badges.
 */
export function getSessionTemporalInfo(session: Session, nowInput?: Date | number) {
  const now = nowInput instanceof Date ? nowInput : typeof nowInput === 'number' ? new Date(nowInput) : new Date();
  const nowMs = now.getTime();
  const state = getSessionState(session, now);
  const isOpenNow = state.phase === 'open';
  const isUpcoming = state.phase === 'upcoming';
  const isClosed = state.phase === 'closed';
  const isCancelled = state.phase === 'cancelled';

  let startDate: Date;
  if (session.startAt) {
    startDate = toJsDate(session.startAt);
  } else if (session.date && session.startTime) {
    startDate = parseDateTimeInZone(session.date, session.startTime, session.timezone);
  } else {
    startDate = state.opensAt;
  }

  const diffMsToStart = startDate.getTime() - nowMs;
  const diffMinutes = Math.max(0, Math.ceil(diffMsToStart / (60 * 1000)));

  let badgeVariant: SessionBadgeVariant = 'upcoming';
  let label = 'Upcoming';

  if (isCancelled) {
    badgeVariant = 'cancelled';
    label = 'Closed · Cancelled';
  } else if (isClosed) {
    badgeVariant = 'closed';
    label = 'Closed · Session Ended';
  } else if (isOpenNow) {
    badgeVariant = 'open_now';
    label = 'Check-In Open Now';
  } else if (isUpcoming) {
    if (diffMinutes <= 30) {
      badgeVariant = 'upcoming_soon';
      label = `Starts in ${diffMinutes}m`;
    } else {
      badgeVariant = 'upcoming';
      label = 'Upcoming Session';
    }
  }

  return {
    temporalStatus: state.phase === 'open' ? ('open_now' as const) : state.phase,
    isOpenNow,
    isUpcoming,
    isClosed,
    isCancelled,
    badgeVariant,
    diffMinutes,
    label,
    opensAt: state.opensAt,
    closesAt: state.closesAt,
  };
}

/**
 * Parses start and end Date for a session.
 */
export function parseSessionTimeWindow(session: Session) {
  const start = session.startAt ? toJsDate(session.startAt) : parseDateTimeInZone(session.date, session.startTime || '18:00', session.timezone);
  const end = session.endAt ? toJsDate(session.endAt) : parseDateTimeInZone(session.date, session.endTime || '21:00', session.timezone);
  return { start, end };
}

/**
 * Returns today's date in YYYY-MM-DD format within the club time zone.
 */
export function todayInClubTz(tz = DEFAULT_CLUB_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';

  return `${year}-${month}-${day}`;
}

/**
 * Formats any Date, Timestamp, or string into authoritative YYYY-MM-DD in the club time zone.
 */
export function formatDateInClubTz(
  val: Timestamp | { seconds: number; nanoseconds?: number } | Date | number | string | undefined | null,
  tz = DEFAULT_CLUB_TIMEZONE
): string {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val;
  }
  const d = toJsDate(val);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';

  return `${year}-${month}-${day}`;
}

/**
 * Formats a timestamp in the club time zone (e.g. "Oct 15, 2026").
 */
export function formatInClubTz(
  val: Timestamp | { seconds: number; nanoseconds?: number } | Date | number | string | undefined | null,
  tz = DEFAULT_CLUB_TIMEZONE,
  options?: Intl.DateTimeFormatOptions
): string {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...options,
    }).format(dObj);
  }
  const d = toJsDate(val);
  const defaultOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  };
  return new Intl.DateTimeFormat('en-US', defaultOpts).format(d);
}

/**
 * Formats time in the club time zone (e.g. "18:30" or "6:30 PM").
 */
export function formatTimeInClubTz(
  val: Timestamp | { seconds: number; nanoseconds?: number } | Date | number | string | undefined | null,
  tz = DEFAULT_CLUB_TIMEZONE,
  use24Hour = true
): string {
  const d = toJsDate(val);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24Hour,
  }).format(d);
}

/**
 * Formats month key in the club time zone (e.g. "2026-10").
 */
export function getMonthKeyInClubTz(
  val: Timestamp | { seconds: number; nanoseconds?: number } | Date | number | string | undefined | null,
  tz = DEFAULT_CLUB_TIMEZONE
): string {
  const d = toJsDate(val);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);

  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  return `${year}-${month}`;
}

/**
 * React hook: Ticks at the specified interval (default 60 seconds).
 */
export function useNow(intervalMs = 60000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
