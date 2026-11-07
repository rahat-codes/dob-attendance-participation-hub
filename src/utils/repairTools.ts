import { Member, MemberPrivate, UserProfile } from '../types';

export const PUBLIC_MEMBER_WHITELIST = new Set([
  'id',
  'name',
  'handle',
  'role',
  'tracks',
  'joinedDate',
  'status',
  'avatarUrl',
  'bio',
  'leaderboardOptOut',
  'authUid',
  'createdAt',
  'githubUrl',
  'linkedinUrl',
  'portfolioUrl',
  'showLinksPublicly',
]);

export interface MemberDataRepairItem {
  memberId: string;
  name: string;
  keysToRemoveFromPublic: string[];
  privateFieldsToSet: Partial<MemberPrivate>;
  cleanedPublicData: Record<string, any>;
}

export interface UserStateRepairItem {
  userId: string;
  email: string;
  currentStatus: string;
  currentMemberId?: string;
  currentApprovedMemberId?: string;
  proposedStatus: string;
  proposedMemberId?: string | null;
  proposedApprovedMemberId?: string | null;
  reason: string;
}

/**
 * Scans public member documents and identifies any containing non-whitelisted keys
 * (e.g. email, phone, counters, academic details) that should be purged or migrated to memberPrivate.
 * Dry-run pure function: never mutates anything.
 */
export function prepareMemberDataRepair(
  members: (Member & Record<string, any>)[],
  existingPrivates?: Record<string, MemberPrivate>
): MemberDataRepairItem[] {
  const plan: MemberDataRepairItem[] = [];

  for (const m of members) {
    if (!m || !m.id) continue;

    const allKeys = Object.keys(m);
    const nonWhitelistedKeys = allKeys.filter((k) => !PUBLIC_MEMBER_WHITELIST.has(k));

    if (nonWhitelistedKeys.length === 0) {
      continue;
    }

    const existingPriv = existingPrivates?.[m.id];
    const privateFieldsToSet: Partial<MemberPrivate> = {};

    // Check if private values exist in public doc and need preserving in memberPrivate
    if (m.email && (!existingPriv || !existingPriv.email)) {
      privateFieldsToSet.email = String(m.email).trim().toLowerCase();
    }
    if (m.phone && (!existingPriv || !existingPriv.phone)) {
      privateFieldsToSet.phone = String(m.phone).trim();
    }
    if (m.studentId && (!existingPriv || !existingPriv.studentId)) {
      privateFieldsToSet.studentId = String(m.studentId).trim();
    }
    if (m.university && (!existingPriv || !existingPriv.university)) {
      privateFieldsToSet.university = String(m.university).trim();
    }
    if (m.department && (!existingPriv || !existingPriv.department)) {
      privateFieldsToSet.department = String(m.department).trim();
    }
    if (m.major && (!existingPriv || !existingPriv.major)) {
      privateFieldsToSet.major = String(m.major).trim();
    }
    if (m.semester && (!existingPriv || !existingPriv.semester)) {
      privateFieldsToSet.semester = String(m.semester).trim();
    }

    // Build pristine public document containing only whitelisted keys
    const cleanedPublicData: Record<string, any> = {};
    for (const key of allKeys) {
      if (PUBLIC_MEMBER_WHITELIST.has(key) && m[key] !== undefined) {
        cleanedPublicData[key] = m[key];
      }
    }

    plan.push({
      memberId: m.id,
      name: m.name || m.handle || m.id,
      keysToRemoveFromPublic: nonWhitelistedKeys,
      privateFieldsToSet,
      cleanedPublicData,
    });
  }

  return plan;
}

/**
 * Scans user profiles and detects state inconsistencies (e.g. active without roster,
 * active with inactive member, declined with stale approvedMemberId).
 * Dry-run pure function: never mutates anything.
 */
export function prepareUserStateRepair(
  users: UserProfile[],
  members: Member[]
): UserStateRepairItem[] {
  const memberMap = new Map<string, Member>();
  for (const m of members) {
    if (m && m.id) memberMap.set(m.id, m);
  }

  const plan: UserStateRepairItem[] = [];

  for (const u of users) {
    if (!u || !u.id) continue;

    // Case 1: User is active but has no memberId or member does not exist
    if (u.status === 'active') {
      if (!u.memberId) {
        plan.push({
          userId: u.id,
          email: u.email,
          currentStatus: u.status,
          proposedStatus: 'declined',
          proposedMemberId: null,
          reason: 'User marked active but has no linked member ID.',
        });
        continue;
      }

      const linkedMem = memberMap.get(u.memberId);
      if (!linkedMem) {
        plan.push({
          userId: u.id,
          email: u.email,
          currentStatus: u.status,
          currentMemberId: u.memberId,
          proposedStatus: 'declined',
          proposedMemberId: null,
          reason: `Linked member record ${u.memberId} does not exist in roster.`,
        });
        continue;
      }

      // Case 2: User is active but linked member is Inactive
      if (linkedMem.status === 'Inactive') {
        plan.push({
          userId: u.id,
          email: u.email,
          currentStatus: u.status,
          currentMemberId: u.memberId,
          proposedStatus: 'declined',
          proposedMemberId: null,
          reason: `Linked member ${linkedMem.name} (${u.memberId}) is deactivated (Inactive).`,
        });
        continue;
      }
    }

    // Case 3: User is declined but still holds approvedMemberId or memberId
    if (u.status === 'declined' && (u.approvedMemberId || u.memberId)) {
      plan.push({
        userId: u.id,
        email: u.email,
        currentStatus: u.status,
        currentMemberId: u.memberId,
        currentApprovedMemberId: u.approvedMemberId,
        proposedStatus: 'declined',
        proposedMemberId: null,
        proposedApprovedMemberId: null,
        reason: 'Declined user still holds stale memberId or approvedMemberId references.',
      });
      continue;
    }

    // Case 4: User is approved_waiting_response but approvedMemberId does not exist
    if (u.status === 'approved_waiting_response') {
      if (!u.approvedMemberId || !memberMap.has(u.approvedMemberId)) {
        plan.push({
          userId: u.id,
          email: u.email,
          currentStatus: u.status,
          currentApprovedMemberId: u.approvedMemberId,
          proposedStatus: 'pending',
          proposedApprovedMemberId: null,
          reason: 'Staged invitation references non-existent member record; reset to pending.',
        });
      }
    }
  }

  return plan;
}
