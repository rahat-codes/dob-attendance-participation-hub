import { CheckInMethod, CheckInRecord, CheckInStatus, Member, Session } from '../types';
import { getSessionState } from './sessionWindow';
import { getCorrectedNowMs } from './serverTime';

export const CHECK_IN_TIMEOUT_MS = 12_000;

export interface CheckInResult {
  success: boolean;
  message: string;
  record?: CheckInRecord;
  isDuplicate?: boolean;
}

export interface CheckInStoreAdapter {
  isOnline?: () => boolean;
  writeSelfCheckIn: (checkInId: string, record: CheckInRecord) => Promise<void>;
  getExistingCheckIn: (checkInId: string) => Promise<CheckInRecord | null>;
  syncLeaderboard?: (memberId: string, monthKey: string, points: number) => Promise<void>;
  getMember?: (memberId: string) => Promise<Member | null>;
  getSession?: (sessionId: string) => Promise<Session | null>;
  writeManualCheckInBatch?: (
    checkInId: string,
    record: CheckInRecord,
    auditDetails: string
  ) => Promise<void>;
}

export function isPermissionDeniedError(err: unknown): boolean {
  const anyErr = err as any;
  const code = String(anyErr?.code || '').toLowerCase();
  const message = String(anyErr?.message || err || '').toLowerCase();
  return code === 'permission-denied' || message.includes('permission-denied') || message.includes('insufficient permissions');
}

export function isOfflineError(err: unknown): boolean {
  const anyErr = err as any;
  const code = String(anyErr?.code || '').toLowerCase();
  const message = String(anyErr?.message || err || '').toLowerCase();
  return code === 'unavailable' || message.includes('client is offline') || message.includes('network');
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = CHECK_IN_TIMEOUT_MS,
  timeoutMessage: string = 'Check-in request timed out after 12s. Please check your connection and try again.'
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      const timeoutErr = new Error(timeoutMessage);
      (timeoutErr as any).code = 'deadline-exceeded';
      reject(timeoutErr);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}

/**
 * Create-first self check-in execution flow.
 * Never pre-reads the not-yet-existing checkIns/{id} document before setDoc.
 * Only on permission-denied does it re-read checkIns/{id} to distinguish a duplicate check-in
 * from a true security rule rejection (expired token, closed window, inactive member).
 */
export async function executeSelfCheckInWithStore(
  store: CheckInStoreAdapter,
  params: {
    sessionId: string;
    memberId: string;
    authUid: string;
    token: string;
    session: Session;
    method?: CheckInMethod;
    checkedInAtValue: unknown;
    nowMs?: number;
    timeoutMs?: number;
  }
): Promise<CheckInResult> {
  const {
    sessionId,
    memberId,
    authUid,
    token,
    session,
    method = 'camera_scan',
    checkedInAtValue,
    timeoutMs = CHECK_IN_TIMEOUT_MS,
  } = params;

  if (!authUid) {
    throw new Error('You must be signed in to check in.');
  }

  const online = store.isOnline ? store.isOnline() : (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!online) {
    throw new Error('You appear to be offline. Reconnect to the internet and try checking in again.');
  }

  const normalizedToken = (token || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(normalizedToken)) {
    throw new Error('Valid 8-character rotating kiosk code or QR scan is required for check-in.');
  }

  const resolvedNowMs = params.nowMs ?? getCorrectedNowMs();
  const state = getSessionState(session, resolvedNowMs);
  if (state.phase !== 'open') {
    throw new Error(
      state.phase === 'upcoming'
        ? `Check-in is not open yet. Opens at ${state.opensAt.toLocaleTimeString()}.`
        : state.phase === 'cancelled'
        ? 'This session was cancelled. Check-in is closed.'
        : 'Check-in for this session is closed.'
    );
  }

  const status: CheckInStatus = state.isLate(new Date(resolvedNowMs)) ? 'late' : 'present';
  const monthKey = session.date.substring(0, 7);
  const checkInId = `${sessionId}_${memberId}`;

  const newRecord: CheckInRecord = {
    id: checkInId,
    sessionId,
    memberId,
    authUid,
    method,
    token: normalizedToken,
    checkedInAt: checkedInAtValue as any,
    status,
    monthKey,
  };

  try {
    await withTimeout(store.writeSelfCheckIn(checkInId, newRecord), timeoutMs);
    store.syncLeaderboard?.(memberId, monthKey, session.points ?? 10).catch(() => {});
    return {
      success: true,
      message: status === 'late' ? 'Check-in recorded (marked late).' : 'Check-in verified successfully!',
      record: {
        ...newRecord,
        checkedInAt: new Date(resolvedNowMs).toISOString(),
      },
    };
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      let existing: CheckInRecord | null = null;
      try {
        existing = await withTimeout(
          store.getExistingCheckIn(checkInId),
          Math.min(timeoutMs, 5000),
          'Timed out checking existing attendance record.'
        );
      } catch {
        existing = null;
      }

      if (existing) {
        return {
          success: true,
          message: 'You are already checked in for this session!',
          record: existing,
          isDuplicate: true,
        };
      }

      const denialErr = new Error(
        'Check-in declined: your QR or backup code may have expired, the session check-in window closed, or your membership is no longer active. Please scan the latest kiosk code.'
      );
      (denialErr as any).code = 'permission-denied';
      throw denialErr;
    }

    if (isOfflineError(err)) {
      throw new Error('Network unavailable while submitting check-in. Reconnect and try again.');
    }

    throw err;
  }
}

/**
 * Pure validation & record builder for admin manual check-ins.
 * Requires verified Active member and existing session, uses serverTimestamp and verifiedBy.
 */
export function buildManualCheckInRecord(params: {
  sessionId: string;
  memberId: string;
  operatorUid: string;
  member: Member | null;
  session: Session | null;
  checkedInAtValue: unknown;
  notes?: string;
  nowMs?: number;
}): { checkInId: string; record: CheckInRecord; auditDetails: string; monthKey: string; points: number } {
  const { sessionId, memberId, operatorUid, member, session, checkedInAtValue, notes } = params;

  if (!operatorUid) {
    throw new Error('Admin authentication required.');
  }
  if (!member) {
    throw new Error(`Cannot check in member "${memberId}": member profile does not exist.`);
  }
  if (member.status !== 'Active') {
    throw new Error(
      `Cannot check in ${member.name}: member status is "${member.status}". Only Active members can be checked in.`
    );
  }
  if (!session) {
    throw new Error(`Cannot check in: session "${sessionId}" does not exist.`);
  }

  const resolvedNowMs = params.nowMs ?? getCorrectedNowMs();
  const isLateCheck = getSessionState(session, resolvedNowMs).isLate(new Date(resolvedNowMs));
  const status: CheckInStatus = isLateCheck ? 'late' : 'present';
  const monthKey = session.date.substring(0, 7);
  const checkInId = `${sessionId}_${memberId}`;

  const cleanNotes = notes?.trim() ? notes.trim().slice(0, 300) : undefined;
  const record: CheckInRecord = {
    id: checkInId,
    sessionId,
    memberId,
    method: 'manual_entry',
    checkedInAt: checkedInAtValue as any,
    status,
    monthKey,
    ...(cleanNotes ? { notes: cleanNotes } : {}),
    verifiedBy: operatorUid,
  };

  return {
    checkInId,
    record,
    auditDetails: `Admin manually checked in member ${member.name} (${memberId}) for session ${session.title} (${sessionId})`,
    monthKey,
    points: session.points ?? 10,
  };
}

export async function executeManualCheckInWithStore(
  store: CheckInStoreAdapter,
  params: {
    sessionId: string;
    memberId: string;
    operatorUid: string;
    checkedInAtValue: unknown;
    sessionHint?: Session | null;
    notes?: string;
    nowMs?: number;
  }
): Promise<CheckInResult> {
  if (!params.operatorUid) {
    throw new Error('Admin authentication required.');
  }
  if (!store.getMember || !store.getSession || !store.writeManualCheckInBatch) {
    throw new Error('Manual check-in store adapter is incomplete.');
  }

  const [member, fetchedSession] = await Promise.all([
    store.getMember(params.memberId),
    store.getSession(params.sessionId),
  ]);

  const built = buildManualCheckInRecord({
    sessionId: params.sessionId,
    memberId: params.memberId,
    operatorUid: params.operatorUid,
    member,
    session: fetchedSession || params.sessionHint || null,
    checkedInAtValue: params.checkedInAtValue,
    notes: params.notes,
    nowMs: params.nowMs,
  });

  try {
    await store.writeManualCheckInBatch(built.checkInId, built.record, built.auditDetails);
    store.syncLeaderboard?.(params.memberId, built.monthKey, built.points).catch(() => {});
    return {
      success: true,
      message: 'Manual check-in confirmed.',
      record: {
        ...built.record,
        checkedInAt: new Date(params.nowMs ?? getCorrectedNowMs()).toISOString(),
      },
    };
  } catch (err: any) {
    if (isPermissionDeniedError(err)) {
      const existing = await store.getExistingCheckIn(built.checkInId).catch(() => null);
      if (existing) {
        return {
          success: true,
          message: 'Member is already checked in for this session.',
          record: existing,
          isDuplicate: true,
        };
      }
    }
    throw err;
  }
}
