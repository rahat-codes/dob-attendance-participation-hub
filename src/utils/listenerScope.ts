/**
 * Pure Firestore listener subscription planner (F11).
 * Gates collection subscriptions strictly by authentication and active-membership rules
 * so pending/declined users never attach privileged listeners and non-admin members
 * only subscribe to their own scoped check-ins.
 */

export interface SubscriptionPlanInput {
  hasUser: boolean;
  isAdmin: boolean;
  isApprovedMember: boolean;
  linkedMemberId?: string | null;
}

export type CheckInSubscriptionMode = 'all' | 'self' | 'none';

export interface SubscriptionPlan {
  publicLeaderboard: true;
  userNotifications: boolean;
  members: boolean;
  sessions: boolean;
  checkInsMode: CheckInSubscriptionMode;
  usersDirectory: boolean;
  reminderSweep: boolean;
}

export function getSubscriptionPlan(input: SubscriptionPlanInput): SubscriptionPlan {
  const { hasUser, isAdmin, isApprovedMember, linkedMemberId } = input;
  if (!hasUser) {
    return {
      publicLeaderboard: true,
      userNotifications: false,
      members: false,
      sessions: false,
      checkInsMode: 'none',
      usersDirectory: false,
      reminderSweep: false,
    };
  }

  const canReadClubData = isAdmin || isApprovedMember;

  let checkInsMode: CheckInSubscriptionMode = 'none';
  if (isAdmin) {
    checkInsMode = 'all';
  } else if (isApprovedMember && typeof linkedMemberId === 'string' && linkedMemberId.trim().length > 0) {
    checkInsMode = 'self';
  }

  return {
    publicLeaderboard: true,
    userNotifications: true,
    members: canReadClubData,
    sessions: canReadClubData,
    checkInsMode,
    usersDirectory: isAdmin,
    reminderSweep: isAdmin,
  };
}

/**
 * Bounded Admin Query Defaults (Phase 7):
 * - Admin live listeners subscribe to the current month plus previous N months of check-ins
 *   and the last 12 months + all upcoming sessions by default.
 * - Optional server-side aggregation (e.g., a Cloud Function computing publicLeaderboard and
 *   monthly rollups) should be considered once raw checkIns exceed ~3,000 documents or >150
 *   active builders, when client-side initial download latency exceeds 1-2s on mobile.
 */
export const DEFAULT_ADMIN_CHECKIN_MONTHS_BACK = 2;
export const DEFAULT_ADMIN_SESSION_MONTHS_BACK = 12;
export const SERVER_AGGREGATION_THRESHOLD_DOCS = 3000;

export function getBoundedCheckInStartMonthKey(
  now: Date = new Date(),
  monthsBack: number = DEFAULT_ADMIN_CHECKIN_MONTHS_BACK,
  timeZone: string = 'Asia/Seoul'
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === 'year')?.value || now.getUTCFullYear());
  const month = Number(parts.find((p) => p.type === 'month')?.value || now.getUTCMonth() + 1);

  const target = new Date(Date.UTC(year, month - 1 - Math.max(0, monthsBack), 15, 12, 0, 0));
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getBoundedSessionStartDate(
  now: Date = new Date(),
  monthsBack: number = DEFAULT_ADMIN_SESSION_MONTHS_BACK,
  timeZone: string = 'Asia/Seoul'
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === 'year')?.value || now.getUTCFullYear());
  const month = Number(parts.find((p) => p.type === 'month')?.value || now.getUTCMonth() + 1);
  const day = Number(parts.find((p) => p.type === 'day')?.value || now.getUTCDate());

  const target = new Date(Date.UTC(year, month - 1 - Math.max(0, monthsBack), day, 12, 0, 0));
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  const d = String(target.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function mergeBoundedWithHistory<T extends { id: string }>(
  historical: T[],
  live: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of historical) {
    map.set(item.id, item);
  }
  for (const item of live) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

export type LeaderboardRecomputeSource = 'live_full' | 'backfill_full' | 'skip';

/**
 * Ensures bounded admin subscriptions never overwrite the publicLeaderboard
 * projection with a truncated (< full history) slice of check-ins or sessions.
 */
export function resolveLeaderboardRecomputeSource(params: {
  hasLoadedAllHistory: boolean;
  hasLiveData: boolean;
}): LeaderboardRecomputeSource {
  if (!params.hasLiveData) return 'skip';
  return params.hasLoadedAllHistory ? 'live_full' : 'backfill_full';
}

/**
 * Splits IDs into bounded chunks (<= 30) safe for Firestore `in` queries.
 */
export function chunkIds<T>(items: readonly T[], chunkSize: number = 10): T[][] {
  const safeSize = Math.max(1, Math.min(30, Math.floor(chunkSize) || 10));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

