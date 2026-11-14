import { generateSecureToken } from './token';
import { TOKEN_ROTATION_SECONDS } from '../config/constants';

export const ACTIVE_KIOSK_CONFLICT_WINDOW_MS = 60_000;

export interface KioskTokenPair {
  currentToken: string;
  prevToken: string;
}

export interface RemoteKioskTokenDoc {
  token: string;
  prevToken?: string;
  rotatedAt?: unknown;
}

export interface KioskConflictStatus {
  conflict: boolean;
  remoteToken?: string;
  ageSeconds?: number;
}

/**
 * Generates an initial pair of distinct, non-empty 8-character kiosk tokens.
 * Ensures prevToken is never empty or equal to currentToken on first Firestore write.
 */
export function createInitialKioskTokenState(
  tokenGenerator: () => string = generateSecureToken
): KioskTokenPair {
  const currentToken = tokenGenerator();
  let prevToken = tokenGenerator();
  let guard = 0;
  while ((!prevToken || prevToken === currentToken) && guard < 10) {
    prevToken = tokenGenerator();
    guard++;
  }
  if (!prevToken || prevToken === currentToken) {
    // Deterministic fallback perturbation if mock generator returns constant
    const tail = currentToken.endsWith('2') ? '3' : '2';
    prevToken = currentToken.slice(0, 7) + tail;
  }
  return { currentToken, prevToken };
}

/**
 * Pure rotation step: shifts currentToken to prevToken and produces a distinct next currentToken.
 */
export function stepKioskRotation(
  current: KioskTokenPair,
  tokenGenerator: () => string = generateSecureToken
): KioskTokenPair {
  let nextToken = tokenGenerator();
  let guard = 0;
  while ((!nextToken || nextToken === current.currentToken) && guard < 10) {
    nextToken = tokenGenerator();
    guard++;
  }
  if (!nextToken || nextToken === current.currentToken) {
    const tail = current.currentToken.endsWith('4') ? '5' : '4';
    nextToken = current.currentToken.slice(0, 7) + tail;
  }
  return {
    currentToken: nextToken,
    prevToken: current.currentToken,
  };
}

/**
 * Extracts epoch milliseconds from a Firestore Timestamp, Date, number, or ISO string.
 */
export function extractRotatedAtMs(rotatedAt: unknown): number | null {
  if (rotatedAt === null || rotatedAt === undefined) return null;
  if (typeof rotatedAt === 'number' && Number.isFinite(rotatedAt)) return rotatedAt;
  if (rotatedAt instanceof Date) {
    const ms = rotatedAt.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof (rotatedAt as any)?.toMillis === 'function') {
    const ms = (rotatedAt as any).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof (rotatedAt as any)?.seconds === 'number') {
    const nanos = typeof (rotatedAt as any).nanoseconds === 'number' ? (rotatedAt as any).nanoseconds : 0;
    return (rotatedAt as any).seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  if (typeof rotatedAt === 'string') {
    const ms = Date.parse(rotatedAt);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Detects whether another kiosk instance is actively writing tokens for the same session
 * (remote token differs from local kiosk's current/written token and was rotated within <= 60s).
 */
export function detectActiveRemoteKiosk(params: {
  remoteDoc: RemoteKioskTokenDoc | null;
  localCurrentToken: string;
  localLastWrittenToken: string | null;
  takenOverAtMs: number | null;
  nowMs: number;
  windowMs?: number;
}): KioskConflictStatus {
  const {
    remoteDoc,
    localCurrentToken,
    localLastWrittenToken,
    takenOverAtMs,
    nowMs,
    windowMs = ACTIVE_KIOSK_CONFLICT_WINDOW_MS,
  } = params;

  if (!remoteDoc || !remoteDoc.token) {
    return { conflict: false };
  }

  if (
    remoteDoc.token === localCurrentToken ||
    (localLastWrittenToken && remoteDoc.token === localLastWrittenToken)
  ) {
    return { conflict: false };
  }

  const rotatedAtMs = extractRotatedAtMs(remoteDoc.rotatedAt);
  if (rotatedAtMs === null) {
    return { conflict: false };
  }

  if (takenOverAtMs !== null && rotatedAtMs <= takenOverAtMs) {
    return { conflict: false };
  }

  const ageMs = nowMs - rotatedAtMs;
  if (ageMs <= windowMs && ageMs >= -5_000) {
    return {
      conflict: true,
      remoteToken: remoteDoc.token,
      ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
    };
  }

  return { conflict: false };
}

/**
 * Pure gate determining whether an interval tick should perform a single token rotation.
 * Guarantees at most one rotation per interval and halts while a remote kiosk conflict or write lock is active.
 */
export function shouldTriggerKioskTickRotation(params: {
  isOpen: boolean;
  isAdmin: boolean;
  hasConflict: boolean;
  isInFlight: boolean;
  lastRotationAtMs: number;
  nowMs: number;
  intervalMs?: number;
}): boolean {
  const {
    isOpen,
    isAdmin,
    hasConflict,
    isInFlight,
    lastRotationAtMs,
    nowMs,
    intervalMs = TOKEN_ROTATION_SECONDS * 1000,
  } = params;

  if (!isOpen || !isAdmin || hasConflict || isInFlight) {
    return false;
  }

  return nowMs - lastRotationAtMs >= intervalMs;
}
