import { Member, UserProfile } from '../types';

/**
 * Normalizes a builder handle for comparison:
 * trims whitespace, removes leading '@', converts to lowercase.
 */
export function normalizeHandle(handle: string): string {
  if (!handle) return '';
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Normalizes a student ID for comparison:
 * trims whitespace and converts to lowercase.
 */
export function normalizeStudentId(studentId?: string): string {
  if (!studentId) return '';
  return studentId.trim().toLowerCase();
}

/**
 * Extracts builder handle, student ID, and full name from applicant requestedNotes.
 */
export function parseApplicantNotes(notes?: string): {
  handle: string;
  studentId?: string;
  name?: string;
  track?: string;
} {
  if (!notes) return { handle: '' };
  const rawHandle = notes.split('·')[0]?.trim() || '';
  const cleanHandle = rawHandle.replace(/^@+/, '').trim();

  const idMatch = notes.match(/ID:\s*([A-Za-z0-9_-]+)/i) || notes.match(/\b(20\d{6,8})\b/);
  const studentId = idMatch && idMatch[1] !== 'N/A' ? idMatch[1].trim() : undefined;

  const trackMatch = notes.match(/Track:\s*([^·]+)/i);
  const track = trackMatch ? trackMatch[1].trim() : undefined;

  const nameMatch = notes.match(/Name:\s*([^·]+)/i);
  const name = nameMatch ? nameMatch[1].trim() : undefined;

  return {
    handle: cleanHandle,
    studentId,
    name,
    track,
  };
}

/**
 * Checks if a builder handle is already taken by an active roster member.
 * Inactive members NEVER block handle reuse.
 */
export function isHandleTaken(
  members: Member[],
  handle: string,
  options?: { ignoreMemberId?: string }
): { taken: boolean; conflictingMember?: Member } {
  const target = normalizeHandle(handle);
  if (!target) return { taken: false };

  const conflict = members.find((m) => {
    if (options?.ignoreMemberId && m.id === options.ignoreMemberId) {
      return false;
    }
    // Inactive members never block reuse
    if (m.status === 'Inactive') {
      return false;
    }
    return normalizeHandle(m.handle) === target;
  });

  if (conflict) {
    return { taken: true, conflictingMember: conflict };
  }
  return { taken: false };
}

/**
 * Checks if a student ID is already in use by an active roster member.
 * Inactive members NEVER block student ID reuse.
 */
export function isStudentIdTaken(
  members: Member[],
  studentId: string,
  options?: { ignoreMemberId?: string }
): { taken: boolean; conflictingMember?: Member } {
  const target = normalizeStudentId(studentId);
  if (!target || target === 'n/a') return { taken: false };

  const conflict = members.find((m) => {
    if (options?.ignoreMemberId && m.id === options.ignoreMemberId) {
      return false;
    }
    if (m.status === 'Inactive') {
      return false;
    }
    return normalizeStudentId(m.studentId) === target;
  });

  if (conflict) {
    return { taken: true, conflictingMember: conflict };
  }
  return { taken: false };
}

/**
 * Finds previous Inactive or unlinked roster records that match an applicant's
 * handle, student ID, or email (admin-only).
 */
export function findReuseCandidates(
  members: Member[],
  applicant: {
    email?: string;
    handle?: string;
    studentId?: string;
    requestedNotes?: string;
  }
): Member[] {
  const parsed = parseApplicantNotes(applicant.requestedNotes);
  const targetHandle = normalizeHandle(applicant.handle || parsed.handle);
  const targetStudentId = normalizeStudentId(applicant.studentId || parsed.studentId);
  const targetEmail = applicant.email?.trim().toLowerCase();

  const candidates: Member[] = [];
  const seenIds = new Set<string>();

  for (const m of members) {
    // Only Inactive or unlinked records are candidates for reuse
    const isCandidatePool = m.status === 'Inactive' || !m.authUid;
    if (!isCandidatePool) continue;

    let matched = false;

    // Match by email
    if (targetEmail && m.email && m.email.trim().toLowerCase() === targetEmail) {
      matched = true;
    }

    // Match by handle
    if (!matched && targetHandle && normalizeHandle(m.handle) === targetHandle) {
      matched = true;
    }

    // Match by student ID
    if (!matched && targetStudentId && normalizeStudentId(m.studentId) === targetStudentId) {
      matched = true;
    }

    if (matched && !seenIds.has(m.id)) {
      seenIds.add(m.id);
      candidates.push(m);
    }
  }

  return candidates;
}

/**
 * Checks whether a user can submit a re-application.
 * Only users in 'declined' status can re-apply.
 */
export function canReapply(user: UserProfile | null | undefined): boolean {
  return user?.status === 'declined';
}

/**
 * Formats an archived handle: `<handle>~archived-<yyyymmdd>`
 */
export function archiveHandle(handle: string, date: Date = new Date()): string {
  const clean = handle.startsWith('@') ? handle : `@${handle}`;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${clean}~archived-${yyyy}${mm}${dd}`;
}

export interface PermanentDeletePlan {
  memberId: string;
  linkedUserId?: string;
  deletions: string[];
  userReset: {
    userId: string;
    status: 'declined';
    deleteMemberId: boolean;
    deleteApprovedMemberId: boolean;
  } | null;
  deleteAttendance: boolean;
  auditAction: string;
  auditMessage: string;
}

/**
 * Builds the atomic permanent deletion plan, ensuring:
 * - Administrators cannot be permanently deleted (must revoke admin first)
 * - Super admin cannot be permanently deleted
 * - Linked user record is reset to status 'declined' and memberId/approvedMemberId are removed via deleteField()
 */
export function buildPermanentDeletePlan(
  member: Member,
  linkedUser?: UserProfile | null,
  options?: {
    deleteAttendance?: boolean;
    checkInsCount?: number;
    isSuperAdmin?: boolean;
    isAdmin?: boolean;
  }
): PermanentDeletePlan {
  if (options?.isSuperAdmin) {
    throw new Error('Cannot delete super admin.');
  }
  if (options?.isAdmin) {
    throw new Error('Cannot permanently delete an administrator. Revoke admin role first.');
  }

  const linkedUserId = linkedUser?.id || member.authUid;

  return {
    memberId: member.id,
    linkedUserId,
    deletions: [
      `members/${member.id}`,
      `memberPrivate/${member.id}`,
      `publicLeaderboard/${member.id}`,
    ],
    userReset: linkedUserId
      ? {
          userId: linkedUserId,
          status: 'declined',
          deleteMemberId: true,
          deleteApprovedMemberId: true,
        }
      : null,
    deleteAttendance: !!options?.deleteAttendance,
    auditAction: 'delete_member',
    auditMessage: `Permanently deleted member "${member.name}" (${member.id}). Handle "${member.handle}" freed for reuse.`,
  };
}
