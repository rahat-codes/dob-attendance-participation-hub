import type { ClubNotification, Session, UserProfile } from '../types';
import { getSessionTemporalInfo } from './sessionWindow';

export function isTabVisible(docLike?: Pick<Document, 'visibilityState'> | null): boolean {
  const target = docLike !== undefined ? docLike : typeof document !== 'undefined' ? document : null;
  if (!target) return true;
  return target.visibilityState === 'visible';
}

export function filterUpcomingReminderSessions(
  sessions: Session[],
  now: Date = new Date()
): Array<{ session: Session; diffMinutes: number }> {
  const result: Array<{ session: Session; diffMinutes: number }> = [];
  for (const s of sessions) {
    if (!s || s.status === 'cancelled' || s.status === 'completed' || s.deletedAt) continue;
    const temporal = getSessionTemporalInfo(s, now);
    if (temporal.isUpcoming && temporal.diffMinutes > 0 && temporal.diffMinutes <= 35) {
      result.push({ session: s, diffMinutes: temporal.diffMinutes });
    }
  }
  return result;
}

export interface PlannedReminderWrite {
  notificationId: string;
  payload: ClubNotification;
}

export interface ReminderSweepPlan {
  writes: PlannedReminderWrite[];
  batches: PlannedReminderWrite[][];
  skippedExistingCount: number;
}

/**
 * Pure planner for 30-minute meeting reminder sweeps.
 * - Never re-creates any reminder whose deterministic doc ID already exists (even if read or dismissed).
 * - Chunks writes into safe batch sizes (<= 400 ops) so the caller commits via a single writeBatch per chunk.
 */
export function buildReminderSweepPlan(params: {
  upcomingSessions: Array<{ session: Session; diffMinutes: number }>;
  eligibleUsers: UserProfile[];
  existingNotificationIds: Set<string>;
  now?: Date;
  chunkLimit?: number;
}): ReminderSweepPlan {
  const {
    upcomingSessions,
    eligibleUsers,
    existingNotificationIds,
    now = new Date(),
    chunkLimit = 400,
  } = params;

  const safeLimit = Math.max(1, Math.min(450, chunkLimit));
  const writes: PlannedReminderWrite[] = [];
  let skippedExistingCount = 0;
  const createdAtIso = now.toISOString();

  for (const { session, diffMinutes } of upcomingSessions) {
    for (const user of eligibleUsers) {
      const notificationId = `reminder_30m_${session.id}_${user.id}`;
      if (existingNotificationIds.has(notificationId)) {
        skippedExistingCount += 1;
        continue;
      }

      const safeTitle = `Meeting Starting Soon: ${session.title}`.slice(0, 145);
      const safeMessage = `Starting in ~${diffMinutes}m at ${session.location || 'Den of Builders'}. Get ready to hack!`.slice(0, 990);

      writes.push({
        notificationId,
        payload: {
          id: notificationId,
          userId: user.id,
          title: safeTitle,
          message: safeMessage,
          type: 'meeting_reminder_30m',
          sessionId: session.id,
          sessionDate: session.date,
          sessionTime: session.startTime,
          sessionLocation: session.location,
          read: false,
          dismissed: false,
          createdAt: createdAtIso,
        },
      });
    }
  }

  const batches: PlannedReminderWrite[][] = [];
  for (let i = 0; i < writes.length; i += safeLimit) {
    batches.push(writes.slice(i, i + safeLimit));
  }

  return {
    writes,
    batches,
    skippedExistingCount,
  };
}
