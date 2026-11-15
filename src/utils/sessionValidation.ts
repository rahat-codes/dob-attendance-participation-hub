import { Timestamp } from 'firebase/firestore';
import { Session, BuilderTrack, SessionStatus, CheckInMode } from '../types';
import { DEFAULT_CLUB_TIMEZONE } from '../config/constants';
import { parseDateTimeInZone, isSessionRescheduled } from './sessionTiming';

/**
 * Single source of truth for session configuration and defaults.
 * Used across client forms, firestore writes, and validation.
 */
export const DEFAULT_SESSION_CONFIG = {
  timezone: DEFAULT_CLUB_TIMEZONE,
  checkInMode: 'auto' as CheckInMode,
  openMinutesBefore: 15,
  graceMinutesAfter: 30,
  lateAfterMinutes: 10,
  points: 10,
  host: 'Guild Lead',
  status: 'scheduled' as SessionStatus,
} as const;

export const VALID_CHECK_IN_MODES: CheckInMode[] = ['auto', 'open', 'closed'];
export const VALID_SESSION_STATUSES: SessionStatus[] = [
  'scheduled',
  'active',
  'upcoming',
  'completed',
  'cancelled',
];

export interface SessionPayloadInput {
  id?: string;
  title: string;
  track: BuilderTrack;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  host?: string;
  description?: string;
  sessionCode?: string;
  timezone?: string;
  status?: SessionStatus;
  checkInMode?: CheckInMode;
  openMinutesBefore?: number;
  graceMinutesAfter?: number;
  lateAfterMinutes?: number;
  points?: number;
  maxCapacity?: number;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  deletedAt?: string;
}

/**
 * Validates a session data object against the strict Firestore rules schema.
 * Throws a descriptive Error if any requirement is violated.
 */
export function validateSessionData(session: Partial<Session>): Session {
  if (!session) {
    throw new Error('Session payload cannot be empty.');
  }

  // ID validation
  if (!session.id || typeof session.id !== 'string' || session.id.trim().length === 0) {
    throw new Error('Session id is required and must be a non-empty string.');
  }
  if (session.id.length > 128) {
    throw new Error('Session id cannot exceed 128 characters.');
  }

  // Title validation
  if (!session.title || typeof session.title !== 'string' || session.title.trim().length === 0) {
    throw new Error('Session title is required.');
  }
  if (session.title.length > 150) {
    throw new Error('Session title cannot exceed 150 characters.');
  }

  // startAt and endAt validation (Strictly required; no silent Date.now())
  if (!session.startAt) {
    throw new Error('Session startAt timestamp is required.');
  }
  if (!session.endAt) {
    throw new Error('Session endAt timestamp is required.');
  }

  const startMs = (session.startAt as Timestamp).toMillis
    ? (session.startAt as Timestamp).toMillis()
    : (session.startAt as any)?.seconds
    ? (session.startAt as any).seconds * 1000
    : new Date(session.startAt as any).getTime();

  const endMs = (session.endAt as Timestamp).toMillis
    ? (session.endAt as Timestamp).toMillis()
    : (session.endAt as any)?.seconds
    ? (session.endAt as any).seconds * 1000
    : new Date(session.endAt as any).getTime();

  if (Number.isNaN(startMs)) {
    throw new Error('Invalid startAt timestamp.');
  }
  if (Number.isNaN(endMs)) {
    throw new Error('Invalid endAt timestamp.');
  }

  if (endMs <= startMs) {
    throw new Error('Session endAt must be strictly after startAt.');
  }

  // Location validation
  if (!session.location || typeof session.location !== 'string' || session.location.trim().length === 0) {
    throw new Error('Session location is required.');
  }
  if (session.location.length > 150) {
    throw new Error('Session location cannot exceed 150 characters.');
  }

  // Host validation
  if (!session.host || typeof session.host !== 'string' || session.host.trim().length === 0) {
    throw new Error('Session host is required.');
  }
  if (session.host.length > 100) {
    throw new Error('Session host cannot exceed 100 characters.');
  }

  // Status validation
  if (!session.status || !VALID_SESSION_STATUSES.includes(session.status)) {
    throw new Error(`Session status must be one of: ${VALID_SESSION_STATUSES.join(', ')}.`);
  }

  // Timezone validation
  if (!session.timezone || typeof session.timezone !== 'string' || session.timezone.trim().length === 0) {
    throw new Error('Session timezone is required.');
  }
  if (session.timezone.length > 50) {
    throw new Error('Session timezone cannot exceed 50 characters.');
  }

  // CheckInMode validation
  if (!session.checkInMode || !VALID_CHECK_IN_MODES.includes(session.checkInMode)) {
    throw new Error(`Session checkInMode must be one of: ${VALID_CHECK_IN_MODES.join(', ')}.`);
  }

  // openMinutesBefore validation
  if (typeof session.openMinutesBefore !== 'number' || !Number.isInteger(session.openMinutesBefore)) {
    throw new Error('Session openMinutesBefore must be an integer.');
  }
  if (session.openMinutesBefore < 0 || session.openMinutesBefore > 240) {
    throw new Error('Session openMinutesBefore must be between 0 and 240 minutes.');
  }

  // graceMinutesAfter validation
  if (typeof session.graceMinutesAfter !== 'number' || !Number.isInteger(session.graceMinutesAfter)) {
    throw new Error('Session graceMinutesAfter must be an integer.');
  }
  if (session.graceMinutesAfter < 0 || session.graceMinutesAfter > 240) {
    throw new Error('Session graceMinutesAfter must be between 0 and 240 minutes.');
  }

  // lateAfterMinutes validation
  if (typeof session.lateAfterMinutes !== 'number' || !Number.isInteger(session.lateAfterMinutes)) {
    throw new Error('Session lateAfterMinutes must be an integer.');
  }
  if (session.lateAfterMinutes < 0 || session.lateAfterMinutes > 120) {
    throw new Error('Session lateAfterMinutes must be between 0 and 120 minutes.');
  }

  // Points validation: points 0 allowed!
  if (typeof session.points !== 'number' || !Number.isInteger(session.points)) {
    throw new Error('Session points must be an integer.');
  }
  if (session.points < 0 || session.points > 1000) {
    throw new Error('Session points must be between 0 and 1000.');
  }

  return session as Session;
}

/**
 * Constructs a fully qualified Session payload using the shared defaults.
 * Properly parses startAt and endAt from date + startTime + endTime in timezone,
 * ensuring points: 0 is explicitly preserved.
 */
export function createSessionPayload(input: SessionPayloadInput): Session {
  const tz = input.timezone || DEFAULT_SESSION_CONFIG.timezone;
  const cleanDate = (input.date || '').trim();
  const cleanStartTime = (input.startTime || '').trim();
  const cleanEndTime = (input.endTime || '').trim();

  if (!cleanDate) {
    throw new Error('Session date is required (YYYY-MM-DD).');
  }
  if (!cleanStartTime) {
    throw new Error('Session startTime is required (HH:mm).');
  }
  if (!cleanEndTime) {
    throw new Error('Session endTime is required (HH:mm).');
  }

  const startDate = parseDateTimeInZone(cleanDate, cleanStartTime, tz);
  const endDate = parseDateTimeInZone(cleanDate, cleanEndTime, tz);

  const startAt = Timestamp.fromDate(startDate);
  const endAt = Timestamp.fromDate(endDate);

  const sessionId = input.id || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Points: strictly preserve 0 if provided!
  const finalPoints = typeof input.points === 'number' ? input.points : DEFAULT_SESSION_CONFIG.points;

  const payload: Session = {
    id: sessionId,
    title: input.title.trim(),
    track: input.track,
    date: cleanDate,
    startTime: cleanStartTime,
    endTime: cleanEndTime,
    startAt,
    endAt,
    timezone: tz,
    location: input.location.trim(),
    host: input.host ? input.host.trim() : DEFAULT_SESSION_CONFIG.host,
    description: (input.description || 'Club builder sprint and hands-on laboratory session.').trim(),
    sessionCode: input.sessionCode,
    points: finalPoints,
    maxCapacity: input.maxCapacity !== undefined ? Number(input.maxCapacity) : 25,
    status: input.status || DEFAULT_SESSION_CONFIG.status,
    checkInMode: input.checkInMode || DEFAULT_SESSION_CONFIG.checkInMode,
    openMinutesBefore:
      input.openMinutesBefore !== undefined
        ? Number(input.openMinutesBefore)
        : DEFAULT_SESSION_CONFIG.openMinutesBefore,
    graceMinutesAfter:
      input.graceMinutesAfter !== undefined
        ? Number(input.graceMinutesAfter)
        : DEFAULT_SESSION_CONFIG.graceMinutesAfter,
    lateAfterMinutes:
      input.lateAfterMinutes !== undefined
        ? Number(input.lateAfterMinutes)
        : DEFAULT_SESSION_CONFIG.lateAfterMinutes,
    createdAt: input.createdAt || new Date().toISOString(),
    createdBy: input.createdBy,
    updatedAt: input.updatedAt,
    deletedAt: input.deletedAt,
  };

  return validateSessionData(payload);
}

export { isSessionRescheduled };

export interface DryRunMigrationResult {
  needsMigration: boolean;
  migratedDoc: Session;
  addedFields: string[];
}

/**
 * Idempotent dry-run inspection and backfill helper for legacy sessions.
 * Inspects a raw document and produces a compliant Session without writing to DB.
 */
export function dryRunMigrateSession(rawSession: any): DryRunMigrationResult {
  const addedFields: string[] = [];
  const tz = rawSession.timezone || DEFAULT_SESSION_CONFIG.timezone;
  if (!rawSession.timezone) addedFields.push('timezone');

  let startAt = rawSession.startAt;
  let endAt = rawSession.endAt;

  if (!startAt && rawSession.date && rawSession.startTime) {
    startAt = Timestamp.fromDate(parseDateTimeInZone(rawSession.date, rawSession.startTime, tz));
    addedFields.push('startAt');
  }

  if (!endAt && rawSession.date && rawSession.endTime) {
    endAt = Timestamp.fromDate(parseDateTimeInZone(rawSession.date, rawSession.endTime, tz));
    addedFields.push('endAt');
  }

  // If still missing startAt/endAt because startTime/endTime were absent, derive standard evening window
  if (!startAt && rawSession.date) {
    startAt = Timestamp.fromDate(parseDateTimeInZone(rawSession.date, '18:00', tz));
    addedFields.push('startAt');
  }
  if (!endAt && rawSession.date) {
    endAt = Timestamp.fromDate(parseDateTimeInZone(rawSession.date, '21:00', tz));
    addedFields.push('endAt');
  }

  const host = rawSession.host || DEFAULT_SESSION_CONFIG.host;
  if (!rawSession.host) addedFields.push('host');

  const checkInMode = rawSession.checkInMode || DEFAULT_SESSION_CONFIG.checkInMode;
  if (!rawSession.checkInMode) addedFields.push('checkInMode');

  const openMinutesBefore =
    rawSession.openMinutesBefore !== undefined
      ? Number(rawSession.openMinutesBefore)
      : DEFAULT_SESSION_CONFIG.openMinutesBefore;
  if (rawSession.openMinutesBefore === undefined) addedFields.push('openMinutesBefore');

  const graceMinutesAfter =
    rawSession.graceMinutesAfter !== undefined
      ? Number(rawSession.graceMinutesAfter)
      : DEFAULT_SESSION_CONFIG.graceMinutesAfter;
  if (rawSession.graceMinutesAfter === undefined) addedFields.push('graceMinutesAfter');

  const lateAfterMinutes =
    rawSession.lateAfterMinutes !== undefined
      ? Number(rawSession.lateAfterMinutes)
      : DEFAULT_SESSION_CONFIG.lateAfterMinutes;
  if (rawSession.lateAfterMinutes === undefined) addedFields.push('lateAfterMinutes');

  const points = typeof rawSession.points === 'number' ? rawSession.points : DEFAULT_SESSION_CONFIG.points;
  if (rawSession.points === undefined) addedFields.push('points');

  const migratedDoc: Session = {
    ...rawSession,
    timezone: tz,
    startAt,
    endAt,
    host,
    checkInMode,
    openMinutesBefore,
    graceMinutesAfter,
    lateAfterMinutes,
    points,
  };

  const validated = validateSessionData(migratedDoc);
  return {
    needsMigration: addedFields.length > 0,
    migratedDoc: validated,
    addedFields,
  };
}

export interface SessionMigrationItem {
  sessionId: string;
  title: string;
  addedFields: string[];
  migratedDoc: Session;
}

export interface SessionMigrationPlan {
  totalScanned: number;
  itemsNeedingMigration: number;
  skippedCount: number;
  items: SessionMigrationItem[];
}

/**
 * Idempotent dry-run planner across all existing sessions.
 * Scans raw session records, backfills missing schedule/window fields, and skips already-compliant sessions.
 */
export function prepareSessionMigration(rawSessions: any[]): SessionMigrationPlan {
  const items: SessionMigrationItem[] = [];
  let skippedCount = 0;

  for (const raw of rawSessions) {
    if (!raw || !raw.id) {
      skippedCount++;
      continue;
    }
    const res = dryRunMigrateSession(raw);
    if (res.needsMigration) {
      items.push({
        sessionId: String(raw.id),
        title: String(raw.title || raw.id),
        addedFields: res.addedFields,
        migratedDoc: res.migratedDoc,
      });
    } else {
      skippedCount++;
    }
  }

  return {
    totalScanned: rawSessions.length,
    itemsNeedingMigration: items.length,
    skippedCount,
    items,
  };
}
