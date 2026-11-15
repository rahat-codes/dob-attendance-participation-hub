/**
 * Session Timing Forwarding Module
 * Exposes time-based session state and calculation helpers from sessionWindow.
 */
export {
  getSessionState,
  getTargetSession,
  getSessionTemporalInfo,
  parseSessionTimeWindow,
  parseDateTimeInZone,
  todayInClubTz,
  formatDateInClubTz,
  formatInClubTz,
  formatTimeInClubTz,
  getMonthKeyInClubTz,
  toJsDate,
  useNow,
} from './sessionWindow';
export type { SessionTemporalStatus, SessionBadgeVariant } from './sessionWindow';
import type { Session } from '../types';

/**
 * Determines whether editing a session changed schedule date, time window, or location.
 */
export function isSessionRescheduled(
  prev: Pick<Session, 'date' | 'startTime' | 'endTime' | 'location'>,
  next: Pick<Session, 'date' | 'startTime' | 'endTime' | 'location'>
): boolean {
  return Boolean(
    prev.date !== next.date ||
    (prev.startTime || '') !== (next.startTime || '') ||
    (prev.endTime || '') !== (next.endTime || '') ||
    (prev.location || '').trim() !== (next.location || '').trim()
  );
}
