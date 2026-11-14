import { Member, UserProfile, AuditAction } from '../types';
import { nextUserState, StateTransitionResult } from './userStateMachine';

export interface DeactivateUserUpdatePlan {
  uid: string;
  transition: StateTransitionResult;
  update: {
    status: 'declined';
    clearMemberId: true;
    clearApprovedMemberId: true;
    respondedAt: string;
    updatedAt: string;
  };
}

export interface MemberAuditPlan {
  id: string;
  action: AuditAction;
  performedBy: string;
  performedByEmail?: string;
  targetId: string;
  targetName: string;
  details: string;
}

export interface DeactivateMemberPlan {
  memberId: string;
  memberUpdate: {
    status: 'Inactive';
  };
  userUpdates: DeactivateUserUpdatePlan[];
  removeLeaderboardProjection: boolean;
  preservesAdminRoleUids: string[];
  auditEntry: MemberAuditPlan;
}

export interface ReactivateMemberPlan {
  memberId: string;
  memberUpdate: {
    status: 'Active';
  };
  userUpdate: {
    uid: string;
    transition: StateTransitionResult;
    update: {
      status: 'approved_waiting_response';
      approvedMemberId: string;
      approvedAt: string;
      clearMemberId: true;
      updatedAt: string;
    };
  } | null;
  auditEntry: MemberAuditPlan;
}

export function buildDeactivateMemberPlan(params: {
  member: Member;
  linkedUsers: UserProfile[];
  actorUid: string;
  actorEmail?: string;
  superAdminEmail?: string;
  delegatedAdminUids?: string[];
  nowIso?: string;
  logId?: string;
}): DeactivateMemberPlan {
  const {
    member,
    linkedUsers,
    actorUid,
    actorEmail,
    superAdminEmail,
    delegatedAdminUids = [],
  } = params;
  const normalizedSuperEmail = superAdminEmail?.trim().toLowerCase();
  const adminUidSet = new Set(delegatedAdminUids);

  const hasSuperAdminUser = Boolean(
    normalizedSuperEmail &&
      linkedUsers.some((u) => u?.email?.trim().toLowerCase() === normalizedSuperEmail)
  );
  if (hasSuperAdminUser) {
    throw new Error('Cannot deactivate the designated Super Administrator account.');
  }

  const now = params.nowIso || new Date().toISOString();
  const logId =
    params.logId ||
    `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const seenUids = new Set<string>();
  const userUpdates: DeactivateUserUpdatePlan[] = [];
  const preservesAdminRoleUids: string[] = [];

  for (const u of linkedUsers) {
    if (!u?.id || seenUids.has(u.id)) continue;
    seenUids.add(u.id);

    if (adminUidSet.has(u.id)) {
      preservesAdminRoleUids.push(u.id);
    }

    const transition = nextUserState(u, member, 'deactivate');
    userUpdates.push({
      uid: u.id,
      transition,
      update: {
        status: 'declined',
        clearMemberId: true,
        clearApprovedMemberId: true,
        respondedAt: now,
        updatedAt: now,
      },
    });
  }

  const adminNote =
    preservesAdminRoleUids.length > 0
      ? ` (Note: delegated admins/${preservesAdminRoleUids.join(', ')} role remains intact until revoked separately)`
      : '';

  return {
    memberId: member.id,
    memberUpdate: {
      status: 'Inactive',
    },
    userUpdates,
    removeLeaderboardProjection: true,
    preservesAdminRoleUids,
    auditEntry: {
      id: logId,
      action: 'deactivate_member',
      performedBy: actorUid,
      ...(actorEmail ? { performedByEmail: actorEmail } : {}),
      targetId: member.id,
      targetName: member.name,
      details: `Deactivated builder "${member.name}" (${member.id}) and reset ${userUpdates.length} linked user account(s) to declined${adminNote}`,
    },
  };
}

export function buildReactivateMemberPlan(params: {
  member: Member;
  linkedUser?: UserProfile | null;
  actorUid: string;
  actorEmail?: string;
  routeThroughApproval?: boolean;
  nowIso?: string;
  logId?: string;
}): ReactivateMemberPlan {
  const {
    member,
    linkedUser,
    actorUid,
    actorEmail,
    routeThroughApproval = true,
  } = params;
  const now = params.nowIso || new Date().toISOString();
  const logId =
    params.logId ||
    `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  let userUpdate: ReactivateMemberPlan['userUpdate'] = null;
  if (linkedUser && routeThroughApproval) {
    const transition = nextUserState(linkedUser, member, 'reactivate');
    if (transition.allowed && transition.nextUserStatus === 'approved_waiting_response') {
      userUpdate = {
        uid: linkedUser.id,
        transition,
        update: {
          status: 'approved_waiting_response',
          approvedMemberId: member.id,
          approvedAt: now,
          clearMemberId: true,
          updatedAt: now,
        },
      };
    }
  }

  return {
    memberId: member.id,
    memberUpdate: {
      status: 'Active',
    },
    userUpdate,
    auditEntry: {
      id: logId,
      action: 'reactivate_member',
      performedBy: actorUid,
      ...(actorEmail ? { performedByEmail: actorEmail } : {}),
      targetId: member.id,
      targetName: member.name,
      details: userUpdate
        ? `Reactivated builder "${member.name}" (${member.id}) and staged user ${userUpdate.uid} back through approval invitation`
        : `Reactivated builder "${member.name}" (${member.id}) on roster (awaiting user re-application/approval)`,
    },
  };
}
