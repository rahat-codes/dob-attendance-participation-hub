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
