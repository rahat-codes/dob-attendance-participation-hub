import { UserProfile, Member, UserStatus } from '../types';

export type UnifiedUserState =
  | 'signed_in_no_application'
  | 'awaiting_review'
  | 'approved_waiting'
  | 'declined'
  | 'active'
  | 'deactivated'
  | 'suspended';

export type UserAction =
  | 'submit_application'
  | 'approve'
  | 'accept_invitation'
  | 'decline_invitation'
  | 'reject'
  | 'suspend'
  | 'unsuspend'
  | 'activate_directly'
  | 'deactivate'
  | 'reactivate'
  | 'reapply';

export interface StateTransitionResult {
  allowed: boolean;
  nextState?: UnifiedUserState;
  nextUserStatus?: UserStatus;
  reason?: string;
}

/**
 * Derives the authoritative unified user state from a user profile and linked roster member.
 */
export function getUserState(
  user: UserProfile | null | undefined,
  member: Member | null | undefined
): UnifiedUserState {
  if (!user) return 'signed_in_no_application';

  if (user.status === 'suspended') {
    return 'suspended';
  }

  if (user.status === 'active') {
    // A user is only active if they have a linked member and the member is not Inactive
    if (user.memberId && member && member.status !== 'Inactive') {
      return 'active';
    }
    // Deactivated builder or missing member record
    return 'deactivated';
  }

  if (user.status === 'approved_waiting_response') {
    return 'approved_waiting';
  }

  if (user.status === 'declined') {
    return 'declined';
  }

  // Pending user status: distinguish between unsubmitted sign-ins and submitted applications
  if (user.status === 'pending') {
    if (user.membershipRequestedAt) {
      return 'awaiting_review';
    }
    return 'signed_in_no_application';
  }

  return 'signed_in_no_application';
}

/**
 * Pure transition function modeling all valid and forbidden state x action transitions.
 */
export function nextUserState(
  user: UserProfile | null | undefined,
  member: Member | null | undefined,
  action: UserAction
): StateTransitionResult {
  const currentState = getUserState(user, member);

  switch (action) {
    case 'submit_application':
    case 'reapply': {
      if (currentState === 'signed_in_no_application' || currentState === 'declined' || currentState === 'deactivated') {
        return {
          allowed: true,
          nextState: 'awaiting_review',
          nextUserStatus: 'pending',
        };
      }
      return {
        allowed: false,
        reason: `Cannot submit application from ${currentState} state.`,
      };
    }

    case 'approve': {
      if (currentState === 'awaiting_review' || currentState === 'approved_waiting') {
        return {
          allowed: true,
          nextState: 'approved_waiting',
          nextUserStatus: 'approved_waiting_response',
        };
      }
      return {
        allowed: false,
        reason: `Approve is only permitted for submitted applications or re-sending invitations (current: ${currentState}).`,
      };
    }

    case 'activate_directly': {
      if (currentState === 'awaiting_review' || currentState === 'approved_waiting') {
        return {
          allowed: true,
          nextState: 'active',
          nextUserStatus: 'active',
        };
      }
      return {
        allowed: false,
        reason: `Direct activation is only permitted for submitted or approved applications (current: ${currentState}).`,
      };
    }

    case 'accept_invitation': {
      if (currentState === 'approved_waiting') {
        return {
          allowed: true,
          nextState: 'active',
          nextUserStatus: 'active',
        };
      }
      return {
        allowed: false,
        reason: `Accept invitation is only permitted when waiting for response (current: ${currentState}).`,
      };
    }

    case 'decline_invitation':
    case 'reject': {
      if (currentState === 'awaiting_review' || currentState === 'approved_waiting') {
        return {
          allowed: true,
          nextState: 'declined',
          nextUserStatus: 'declined',
        };
      }
      return {
        allowed: false,
        reason: `Reject or decline is only permitted for submitted or approved applications (current: ${currentState}).`,
      };
    }

    case 'suspend': {
      if (currentState === 'suspended') {
        return {
          allowed: false,
          reason: 'User is already suspended.',
        };
      }
      return {
        allowed: true,
        nextState: 'suspended',
        nextUserStatus: 'suspended',
      };
    }

    case 'unsuspend': {
      if (currentState !== 'suspended') {
        return {
          allowed: false,
          reason: 'Only suspended users can be unsuspended.',
        };
      }
      // Restore derived original state
      if (user?.memberId) {
        return {
          allowed: true,
          nextState: 'active',
          nextUserStatus: 'active',
        };
      }
      if (user?.approvedMemberId) {
        return {
          allowed: true,
          nextState: 'approved_waiting',
          nextUserStatus: 'approved_waiting_response',
        };
      }
      if (user?.membershipRequestedAt) {
        return {
          allowed: true,
          nextState: 'awaiting_review',
          nextUserStatus: 'pending',
        };
      }
      return {
        allowed: true,
        nextState: 'signed_in_no_application',
        nextUserStatus: 'pending',
      };
    }

    case 'deactivate': {
      if (currentState === 'active') {
        return {
          allowed: true,
          nextState: 'deactivated',
          nextUserStatus: 'declined',
        };
      }
      return {
        allowed: false,
        reason: `Only active members can be deactivated (current: ${currentState}).`,
      };
    }

    case 'reactivate': {
      if (currentState === 'deactivated' || currentState === 'declined' || currentState === 'awaiting_review') {
        return {
          allowed: true,
          nextState: 'approved_waiting',
          nextUserStatus: 'approved_waiting_response',
        };
      }
      return {
        allowed: false,
        reason: `Only deactivated or declined records can be reactivated through approval (current: ${currentState}).`,
      };
    }

    default:
      return { allowed: false, reason: 'Unknown action.' };
  }
}
