import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  Timestamp,
  deleteField,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './config';
import { updateProfile } from 'firebase/auth';
import {
  Member,
  MemberPrivate,
  Session,
  CheckInRecord,
  CheckInMethod,
  CheckInStatus,
  UserProfile,
  AdminDoc,
  PublicLeaderboardItem,
  Announcement,
  AuditLog,
  AuditAction,
  ClubSettings,
  BuilderRole,
  BuilderTrack,
  ClubNotification,
} from '../types';
import { SUPER_ADMIN_EMAIL, DEFAULT_CLUB_TIMEZONE, DEFAULT_CHECKIN_SETTINGS } from '../config/constants';
import { buildPublicLeaderboardItems, buildLeaderboardRecomputeOpsPlan } from '../utils/stats';
import {
  getSessionState,
  getSessionTemporalInfo,
  formatDateInClubTz,
  formatTimeInClubTz,
} from '../utils/sessionWindow';
import { processProfilePhoto } from '../utils/imageUtils';
import { isHandleTaken, isStudentIdTaken, archiveHandle } from '../utils/reuseHelpers';
import { ApplicationInput, validateApplication, encodeApplication } from '../utils/application';
import { nextUserState, getUserState } from '../utils/userStateMachine';
import { buildDeactivateMemberPlan, buildReactivateMemberPlan } from '../utils/memberLifecyclePlans';
import { PUBLIC_MEMBER_WHITELIST, MemberDataRepairItem, UserStateRepairItem } from '../utils/repairTools';
import { createSessionPayload, SessionMigrationItem } from '../utils/sessionValidation';
import {
  type SessionBatchPlan,
  buildCompleteSessionBatchPlan,
  buildReopenSessionBatchPlan,
  buildSoftDeleteSessionBatchPlan,
  buildPermanentDeleteSessionOpsPlan,
  buildDeleteCheckInBatchPlan,
} from '../utils/sessionPlans';
import {
  type CheckInStoreAdapter,
  executeSelfCheckInWithStore,
  executeManualCheckInWithStore,
} from '../utils/checkInFlow';
import { ensureFreshServerTimeOffset, getCorrectedNowMs } from '../utils/serverTime';
import { normalizeGitHubUrl, normalizeLinkedInUrl, normalizePortfolioUrl } from '../utils/profileLinks';

export { SUPER_ADMIN_EMAIL, type SessionBatchPlan, buildCompleteSessionBatchPlan, buildReopenSessionBatchPlan };

/**
 * Ensures any avatar data URL is compressed and centered before writing to Firestore,
 * staying far below Firestore's 1,048,576 bytes limit (~25KB).
 */
export async function ensureSafeAvatarUrl(url?: string): Promise<string | undefined> {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  // Strictly reject dangerous schemes
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/html')) {
    return '';
  }

  // Only allow valid web schemes or image data
  if (
    !lower.startsWith('https://') &&
    !lower.startsWith('http://') &&
    !lower.startsWith('data:image/') &&
    !lower.startsWith('/')
  ) {
    return '';
  }

  if (trimmed.startsWith('data:image/') && trimmed.length > 70000) {
    try {
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        return await processProfilePhoto(trimmed, 256, 0.85);
      }
    } catch (err) {
      console.warn('Failed to compress avatar before writing to Firestore:', err);
    }
  }
  return trimmed;
}

const USERS_COLLECTION = 'users';
const ADMINS_COLLECTION = 'admins';
const MEMBERS_COLLECTION = 'members';
const MEMBER_PRIVATE_COLLECTION = 'memberPrivate';
const SESSIONS_COLLECTION = 'sessions';
const SESSION_TOKENS_COLLECTION = 'sessionTokens';
const CHECKINS_COLLECTION = 'checkIns';
const ANNOUNCEMENTS_COLLECTION = 'announcements';
const PUBLIC_LEADERBOARD_COLLECTION = 'publicLeaderboard';
const AUDIT_LOGS_COLLECTION = 'auditLogs';
const SETTINGS_COLLECTION = 'settings';
const NOTIFICATIONS_COLLECTION = 'notifications';

/**
 * Strips undefined fields recursively so Firestore mutations never fail.
 */
export function removeUndefinedFields<T extends Record<string, any>>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedFields) as unknown as T;
  }
  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      clean[key] = val && typeof val === 'object' && !(val instanceof Date) && !(val instanceof Timestamp)
        ? removeUndefinedFields(val)
        : val;
    }
  }
  return clean as T;
}

/**
 * Ensures onSnapshot error callbacks always receive the error with its code,
 * while safely invoking handleFirestoreError for auth logging without letting its throw abort the callback.
 */
export function notifyListenerError(
  err: unknown,
  op: OperationType,
  path: string,
  onError?: (err: Error) => void
): void {
  try {
    handleFirestoreError(err, op, path);
  } catch {
    // Expected: handleFirestoreError logs auth context and throws
  }
  const errorObj = err instanceof Error ? err : new Error(String(err));
  onError?.(errorObj);
}

// ==========================================
// Audit Trail
// ==========================================

export async function createAuditLog(
  action: AuditAction,
  details: string
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const logRef = doc(db, AUDIT_LOGS_COLLECTION, logId);

  const entry: AuditLog = {
    id: logId,
    action,
    performedBy: currentUser.uid,
    performedByEmail: currentUser.email || 'unknown',
    details,
    timestamp: serverTimestamp() as any,
  };

  try {
    await setDoc(logRef, entry);
  } catch (err) {
    console.warn('Failed to write audit log entry:', err);
  }
}

/**
 * Appends an audit log operation to an existing WriteBatch so multi-document operations
 * are atomic with their audit record.
 */
export function createAuditLogInBatch(
  batch: ReturnType<typeof writeBatch>,
  action: AuditAction,
  details: string,
  targetMeta?: { targetId?: string; targetName?: string }
): void {
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const logRef = doc(db, AUDIT_LOGS_COLLECTION, logId);
  const entry: AuditLog = {
    id: logId,
    action,
    performedBy: currentUser.uid,
    performedByEmail: currentUser.email || 'unknown',
    ...(targetMeta?.targetId ? { targetId: targetMeta.targetId } : {}),
    ...(targetMeta?.targetName ? { targetName: targetMeta.targetName } : {}),
    details,
    timestamp: serverTimestamp() as any,
  };

  batch.set(logRef, entry);
}

export function subscribeToAuditLogs(
  onUpdate: (logs: AuditLog[]) => void,
  onError?: (error: Error) => void
): () => void {
  const q = query(
    collection(db, AUDIT_LOGS_COLLECTION),
    orderBy('timestamp', 'desc'),
    limit(50)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const logs = snapshot.docs.map((d) => d.data() as AuditLog);
      onUpdate(logs);
    },
    (error) => {
      notifyListenerError(error, OperationType.LIST, AUDIT_LOGS_COLLECTION, onError);
    }
  );
}

// ==========================================
// Administrators (admins/{uid})
// ==========================================

export async function checkIsAdmin(uid: string, email?: string | null): Promise<boolean> {
  if (email && email.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim()) {
    if (!auth.currentUser || auth.currentUser.uid !== uid || auth.currentUser.emailVerified) {
      return true;
    }
  }
  if (!uid) return false;
  try {
    const adminDoc = await getDoc(doc(db, ADMINS_COLLECTION, uid));
    return adminDoc.exists();
  } catch {
    return false;
  }
}

export interface RequestPipelineCheckResult {
  canReadUsers: { pass: boolean; error?: string; errorCode?: string };
  userCounts: {
    pending: number;
    approved_waiting_response: number;
    active: number;
    declined: number;
    suspended: number;
  };
  adminDocExists: { pass: boolean; exists: boolean; error?: string; errorCode?: string };
  canReadMembersAndSessions: {
    pass: boolean;
    membersPass: boolean;
    sessionsPass: boolean;
    membersError?: string;
    membersErrorCode?: string;
    sessionsError?: string;
    sessionsErrorCode?: string;
  };
}

/**
 * Purely read-only diagnostic verifying the admin request pipeline connectivity and permissions.
 */
export async function checkRequestPipeline(currentUid: string): Promise<RequestPipelineCheckResult> {
  const result: RequestPipelineCheckResult = {
    canReadUsers: { pass: false },
    userCounts: {
      pending: 0,
      approved_waiting_response: 0,
      active: 0,
      declined: 0,
      suspended: 0,
    },
    adminDocExists: { pass: false, exists: false },
    canReadMembersAndSessions: {
      pass: false,
      membersPass: false,
      sessionsPass: false,
    },
  };

  // a & b: Can read users collection & count by status
  try {
    const usersSnap = await getDocs(collection(db, USERS_COLLECTION));
    result.canReadUsers = { pass: true };
    usersSnap.forEach((d) => {
      const data = d.data() as UserProfile;
      const status = data.status || 'pending';
      if (status in result.userCounts) {
        result.userCounts[status as keyof typeof result.userCounts]++;
      }
    });
  } catch (err: any) {
    result.canReadUsers = {
      pass: false,
      error: err?.message || 'Access to users collection denied',
      errorCode: err?.code || 'permission-denied',
    };
  }

  // c: admins/{myUid} exists
  try {
    if (currentUid) {
      const adminSnap = await getDoc(doc(db, ADMINS_COLLECTION, currentUid));
      result.adminDocExists = {
        pass: true,
        exists: adminSnap.exists(),
      };
    } else {
      result.adminDocExists = { pass: false, exists: false, error: 'No authenticated user UID' };
    }
  } catch (err: any) {
    result.adminDocExists = {
      pass: false,
      exists: false,
      error: err?.message || 'Failed to check admins collection',
      errorCode: err?.code || 'permission-denied',
    };
  }

  // d: Can read members and sessions
  let membersOk = false;
  let sessionsOk = false;
  try {
    await getDocs(query(collection(db, MEMBERS_COLLECTION), limit(1)));
    membersOk = true;
    result.canReadMembersAndSessions.membersPass = true;
  } catch (err: any) {
    result.canReadMembersAndSessions.membersError = err?.message || 'Members read error';
    result.canReadMembersAndSessions.membersErrorCode = err?.code || 'permission-denied';
  }

  try {
    await getDocs(query(collection(db, SESSIONS_COLLECTION), limit(1)));
    sessionsOk = true;
    result.canReadMembersAndSessions.sessionsPass = true;
  } catch (err: any) {
    result.canReadMembersAndSessions.sessionsError = err?.message || 'Sessions read error';
    result.canReadMembersAndSessions.sessionsErrorCode = err?.code || 'permission-denied';
  }

  result.canReadMembersAndSessions.pass = membersOk && sessionsOk;
  return result;
}

export function subscribeToAdmins(
  onUpdate: (adminDocs: { uid: string; data: AdminDoc }[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    collection(db, ADMINS_COLLECTION),
    (snapshot) => {
      const list = snapshot.docs.map((d) => ({
        uid: d.id,
        data: d.data() as AdminDoc,
      }));
      onUpdate(list);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, ADMINS_COLLECTION, onError);
    }
  );
}

export async function grantAdminRole(targetUid: string, targetEmail: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (
    !currentUser ||
    !currentUser.emailVerified ||
    currentUser.email?.toLowerCase().trim() !== SUPER_ADMIN_EMAIL.toLowerCase().trim()
  ) {
    throw new Error('Only the designated Super Administrator can grant admin privileges.');
  }

  const adminRef = doc(db, ADMINS_COLLECTION, targetUid);
  const adminData: AdminDoc = {
    email: targetEmail.trim().toLowerCase(),
    grantedBy: currentUser.uid,
    grantedAt: new Date().toISOString(),
  };

  try {
    await setDoc(adminRef, adminData);
    await createAuditLog('grant_admin', `Granted administrator role to ${targetEmail} (${targetUid})`);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `admins/${targetUid}`);
  }
}

export async function revokeAdminRole(targetUid: string, targetEmail: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (
    !currentUser ||
    !currentUser.emailVerified ||
    currentUser.email?.toLowerCase().trim() !== SUPER_ADMIN_EMAIL.toLowerCase().trim()
  ) {
    throw new Error('Only the designated Super Administrator can revoke admin privileges.');
  }

  if (targetEmail.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim()) {
    throw new Error('Cannot revoke administrator status from the designated Super Administrator.');
  }

  const adminRef = doc(db, ADMINS_COLLECTION, targetUid);
  try {
    await deleteDoc(adminRef);
    await createAuditLog('revoke_admin', `Revoked administrator role from ${targetEmail} (${targetUid})`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `admins/${targetUid}`);
  }
}

// ==========================================
// Users (users/{uid})
// ==========================================

export async function ensureUserProfile(uid: string, email: string, displayName: string, photoURL?: string): Promise<UserProfile> {
  const userRef = doc(db, USERS_COLLECTION, uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      if (photoURL && !existing.photoURL) {
        ensureSafeAvatarUrl(photoURL).then((safe) => {
          if (safe) {
            updateDoc(userRef, { photoURL: safe, updatedAt: new Date().toISOString() }).catch(() => {});
          }
        }).catch(() => {});
      }
      return existing;
    }

    // Write minimal profile first without blocking on avatar compression
    const rawPhoto = photoURL || '';
    const newProfile: UserProfile = {
      id: uid,
      email: (email || '').trim().toLowerCase(),
      displayName: (displayName || '').trim() || 'Club Builder',
      photoURL: rawPhoto,
      status: 'pending', // Initial state machine phase: always pending
      readAnnouncementIds: [],
      notificationPrefs: {
        enabled: true,
        announcements: true,
        reminders: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await setDoc(userRef, newProfile);
      if (rawPhoto) {
        ensureSafeAvatarUrl(rawPhoto).then((safe) => {
          if (safe && safe !== rawPhoto) {
            updateDoc(userRef, { photoURL: safe, updatedAt: new Date().toISOString() }).catch(() => {});
          }
        }).catch(() => {});
      }
      return newProfile;
    } catch (writeErr: any) {
      // If the write failed (e.g. concurrent creation race), re-read immediately
      const recheck = await getDoc(userRef);
      if (recheck.exists()) {
        return recheck.data() as UserProfile;
      }
      throw writeErr;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }
}

export function subscribeToUserProfile(
  uid: string,
  onUpdate: (profile: UserProfile | null) => void,
  onError?: (err: Error) => void
): () => void {
  const userRef = doc(db, USERS_COLLECTION, uid);
  return onSnapshot(
    userRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as UserProfile);
      } else {
        onUpdate(null);
      }
    },
    (err) => {
      notifyListenerError(err, OperationType.GET, `users/${uid}`, onError);
    }
  );
}

export function subscribeToPendingUsers(
  onUpdate: (users: UserProfile[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, USERS_COLLECTION),
    where('status', 'in', ['pending', 'approved_waiting_response', 'declined', 'suspended'])
  );

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }) as UserProfile);
      onUpdate(list);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, USERS_COLLECTION, onError);
    }
  );
}

export async function submitApplication(
  uid: string,
  application: ApplicationInput
): Promise<void> {
  const validation = validateApplication(application);
  if (!validation.valid || !validation.sanitized) {
    const firstErr = Object.values(validation.errors)[0] || 'Invalid application data';
    throw new Error(firstErr);
  }
  const sanitized = validation.sanitized;
  const encodedSummary = encodeApplication(sanitized);
  const now = new Date().toISOString();

  const userRef = doc(db, USERS_COLLECTION, uid);
  try {
    await updateDoc(
      userRef,
      removeUndefinedFields({
        applicantName: sanitized.applicantName,
        applicantHandle: sanitized.applicantHandle,
        applicantStudentId: sanitized.applicantStudentId || undefined,
        applicantTrack: sanitized.applicantTrack,
        applicantNote: sanitized.applicantNote || undefined,
        githubUrl: sanitized.githubUrl,
        linkedinUrl: sanitized.linkedinUrl,
        portfolioUrl: sanitized.portfolioUrl || undefined,
        showLinksPublicly: sanitized.showLinksPublicly ?? true,
        displayName: sanitized.applicantName,
        requestedNotes: encodedSummary,
        membershipRequestedAt: now,
        updatedAt: now,
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function reRequestMembership(
  uid: string,
  application?: ApplicationInput | string
): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, uid);
  const now = new Date().toISOString();

  if (application && typeof application === 'object') {
    const validation = validateApplication(application);
    if (!validation.valid || !validation.sanitized) {
      const firstErr = Object.values(validation.errors)[0] || 'Invalid application data';
      throw new Error(firstErr);
    }
    const sanitized = validation.sanitized;
    const encodedSummary = encodeApplication(sanitized);

    try {
      await updateDoc(
        userRef,
        removeUndefinedFields({
          status: 'pending',
          applicantName: sanitized.applicantName,
          applicantHandle: sanitized.applicantHandle,
          applicantStudentId: sanitized.applicantStudentId || undefined,
          applicantTrack: sanitized.applicantTrack,
          applicantNote: sanitized.applicantNote || undefined,
          githubUrl: sanitized.githubUrl,
          linkedinUrl: sanitized.linkedinUrl,
          portfolioUrl: sanitized.portfolioUrl || undefined,
          showLinksPublicly: sanitized.showLinksPublicly ?? true,
          displayName: sanitized.applicantName,
          requestedNotes: encodedSummary,
          membershipRequestedAt: now,
          updatedAt: now,
        })
      );
      return;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  }

  try {
    await updateDoc(userRef, {
      status: 'pending',
      requestedNotes: typeof application === 'string' ? application : '',
      membershipRequestedAt: now,
      updatedAt: now,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function updateUserSelfProfile(
  uid: string,
  updates: {
    displayName?: string;
    photoURL?: string;
    requestedNotes?: string;
    notificationPrefs?: UserProfile['notificationPrefs'];
  }
): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, uid);
  try {
    const cleanUpdates = { ...updates };
    if (cleanUpdates.photoURL) {
      cleanUpdates.photoURL = await ensureSafeAvatarUrl(cleanUpdates.photoURL);
    }
    await updateDoc(userRef, removeUndefinedFields({
      ...cleanUpdates,
      updatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function markAnnouncementAsRead(uid: string, announcementId: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, uid);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const profile = snap.data() as UserProfile;
    const current = profile.readAnnouncementIds || [];
    if (!current.includes(announcementId)) {
      const updated = [announcementId, ...current].slice(0, 50); // Bounded to 50
      await updateDoc(userRef, { readAnnouncementIds: updated });
    }
  } catch {
    // Non-blocking
  }
}

export async function markAllAnnouncementsRead(uid: string, announcementIds: string[]): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, uid);
  try {
    const bounded = announcementIds.slice(0, 50);
    await updateDoc(userRef, { readAnnouncementIds: bounded });
  } catch {
    // Non-blocking
  }
}

// ==========================================
// Membership Approval & Two-Stage Linking Workflow
// ==========================================

export async function requestMembershipLink(
  userId: string,
  requestedNotes?: string,
  displayName?: string
): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  try {
    const updatePayload: Record<string, any> = {
      requestedNotes: (requestedNotes || '').trim(),
      membershipRequestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (displayName && displayName.trim()) {
      updatePayload.displayName = displayName.trim();
    }
    await updateDoc(userRef, updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
}

/**
 * Stage 1: Administrator approves membership request.
 * Updates status to 'approved_waiting_response' and stages approvedMemberId.
 * Does NOT link UID or activate member yet.
 */
export async function approveUserMembershipLink(
  userId: string,
  targetMemberId: string
): Promise<void> {
  return approveExistingMember(userId, targetMemberId);
}

export async function createMemberAndApprove(
  userId: string,
  memberInput: {
    name: string;
    handle: string;
    role: BuilderRole;
    tracks: BuilderTrack[];
    email?: string;
    phone?: string;
    studentId?: string;
    university?: string;
    department?: string;
    major?: string;
    semester?: string;
    avatarUrl?: string;
    bio?: string;
    githubUrl?: string;
    linkedinUrl?: string;
    portfolioUrl?: string;
    showLinksPublicly?: boolean;
    archiveOldMemberId?: string;
  }
): Promise<{ memberId: string }> {
  if (!userId) throw new Error('User ID is required.');
  if (!memberInput.name?.trim()) throw new Error('Full Name is required.');
  if (!memberInput.handle?.trim()) throw new Error('Builder handle is required.');
  if (!memberInput.tracks || memberInput.tracks.length === 0) {
    throw new Error('At least one track discipline must be selected.');
  }

  // Pre-write handle & student ID uniqueness check across active roster
  const cleanHandle = memberInput.handle.trim();
  const snapAll = await getDocs(collection(db, MEMBERS_COLLECTION));
  const existingMembers = snapAll.docs.map((d) => d.data() as Member);

  const handleCheck = isHandleTaken(existingMembers, cleanHandle);
  if (handleCheck.taken && handleCheck.conflictingMember) {
    throw new Error(
      `Builder handle "${cleanHandle}" is already in use by active builder ${handleCheck.conflictingMember.name} (${handleCheck.conflictingMember.status}).`
    );
  }

  const cleanStudentId = memberInput.studentId?.trim();
  if (cleanStudentId) {
    const idCheck = isStudentIdTaken(existingMembers, cleanStudentId);
    if (idCheck.taken && idCheck.conflictingMember) {
      throw new Error(
        `Student ID "${cleanStudentId}" is already registered to active builder ${idCheck.conflictingMember.name} (${idCheck.conflictingMember.status}).`
      );
    }
    const privDocs = await getDocs(
      query(collection(db, MEMBER_PRIVATE_COLLECTION), where('studentId', '==', cleanStudentId), limit(1))
    );
    if (!privDocs.empty) {
      const conflictId = privDocs.docs[0].id;
      const activeConflict = existingMembers.find((m) => m.id === conflictId && m.status !== 'Inactive');
      if (activeConflict) {
        throw new Error(
          `Student ID "${cleanStudentId}" is already registered to active builder ${activeConflict.name} (${activeConflict.status}).`
        );
      }
    }
  }

  const memberId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  const privRef = doc(db, MEMBER_PRIVATE_COLLECTION, memberId);
  const userRef = doc(db, USERS_COLLECTION, userId);
  const now = new Date().toISOString();

  const safeAvatar = await ensureSafeAvatarUrl(memberInput.avatarUrl);

  // Whitelisted public fields only: NO email, phone, counters, or private academic data
  const publicData: Record<string, any> = {
    id: memberId,
    name: memberInput.name.trim(),
    handle: cleanHandle,
    role: memberInput.role || 'Member',
    tracks: memberInput.tracks,
    joinedDate: now.split('T')[0],
    status: 'Active',
    avatarUrl: safeAvatar || '',
    bio: memberInput.bio?.trim() || 'New member of Den of Builders.',
    leaderboardOptOut: false,
    createdAt: now,
  };
  if (memberInput.githubUrl) publicData.githubUrl = memberInput.githubUrl;
  if (memberInput.linkedinUrl) publicData.linkedinUrl = memberInput.linkedinUrl;
  if (memberInput.portfolioUrl) publicData.portfolioUrl = memberInput.portfolioUrl;
  if (memberInput.showLinksPublicly !== undefined) publicData.showLinksPublicly = memberInput.showLinksPublicly;

  const privateData: Record<string, any> = {
    createdAt: now,
    updatedAt: now,
  };
  if (memberInput.email?.trim()) privateData.email = memberInput.email.trim().toLowerCase();
  if (memberInput.phone?.trim()) privateData.phone = memberInput.phone.trim();
  if (cleanStudentId) privateData.studentId = cleanStudentId;
  if (memberInput.university?.trim()) privateData.university = memberInput.university.trim();
  if (memberInput.department?.trim()) privateData.department = memberInput.department.trim();
  if (memberInput.major?.trim()) privateData.major = memberInput.major.trim();
  if (memberInput.semester?.trim()) privateData.semester = memberInput.semester.trim();

  const batch = writeBatch(db);
  batch.set(memberRef, publicData);
  batch.set(privRef, privateData);

  // Stage user in the same atomic batch
  batch.update(userRef, {
    status: 'approved_waiting_response',
    approvedMemberId: memberId,
    approvedAt: now,
    updatedAt: now,
  });

  // If handle archival was requested for an old Inactive member, execute in the SAME batch
  if (memberInput.archiveOldMemberId) {
    const oldMemRef = doc(db, MEMBERS_COLLECTION, memberInput.archiveOldMemberId);
    const oldMem = existingMembers.find((m) => m.id === memberInput.archiveOldMemberId);
    if (oldMem) {
      batch.update(oldMemRef, { handle: archiveHandle(oldMem.handle) });
    }
  }

  createAuditLogInBatch(
    batch,
    'approve_user',
    `Admin created member record ${memberId} (${memberInput.name} ${cleanHandle}) and approved applicant ${userId}`
  );

  try {
    await batch.commit();
    return { memberId };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `members/${memberId}`);
  }
}

export async function approveExistingMember(
  userId: string,
  memberId: string,
  _options?: { confirmedByAdmin?: boolean }
): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);

  const [userSnap, memSnap] = await Promise.all([getDoc(userRef), getDoc(memberRef)]);
  if (!userSnap.exists()) throw new Error('Applicant user profile not found.');
  if (!memSnap.exists()) throw new Error('Roster member record not found.');

  const userData = userSnap.data() as UserProfile;
  const memData = memSnap.data() as Member;

  const transition = nextUserState(userData, memData, 'approve');
  if (!transition.allowed) {
    throw new Error(transition.reason || 'Cannot approve applicant in current state.');
  }

  if (memData.authUid && memData.authUid !== userId) {
    throw new Error(`Member record is already linked to another active account.`);
  }

  const now = new Date().toISOString();
  const batch = writeBatch(db);

  let reactivated = false;
  if (memData.status === 'Inactive') {
    batch.update(memberRef, { status: 'Active' });
    reactivated = true;
  }

  batch.update(userRef, {
    status: 'approved_waiting_response',
    approvedMemberId: memberId,
    approvedAt: now,
    updatedAt: now,
  });

  createAuditLogInBatch(
    batch,
    'approve_user',
    `Admin approved membership request for user ${userId} waiting for applicant acceptance (staged member: ${memberId} - ${memData.name}${reactivated ? ' [Reactivated]' : ''})`
  );

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
}

export async function detachAndReuseMember(
  userId: string,
  memberId: string
): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);

  const [userSnap, memSnap] = await Promise.all([getDoc(userRef), getDoc(memberRef)]);
  if (!userSnap.exists()) throw new Error('Applicant user profile not found.');
  if (!memSnap.exists()) throw new Error('Roster member record not found.');

  const memData = memSnap.data() as Member;
  const oldAuthUid = memData.authUid;

  const now = new Date().toISOString();
  const batch = writeBatch(db);

  // Clear authUid on member and reactivate
  batch.update(memberRef, {
    authUid: deleteField(),
    status: 'Active',
  });

  // Reset old linked account if different from new applicant
  if (oldAuthUid && oldAuthUid !== userId) {
    const oldUserRef = doc(db, USERS_COLLECTION, oldAuthUid);
    batch.update(oldUserRef, {
      status: 'declined',
      memberId: deleteField(),
      approvedMemberId: deleteField(),
      updatedAt: now,
    });
  }

  // Stage new user
  batch.update(userRef, {
    status: 'approved_waiting_response',
    approvedMemberId: memberId,
    approvedAt: now,
    updatedAt: now,
  });

  createAuditLogInBatch(
    batch,
    'approve_user',
    `Admin detached member ${memberId} from previous account and staged for applicant ${userId}`
  );

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `members/${memberId}`);
  }
}

export async function activateDirectly(
  userId: string,
  targetMemberId: string
): Promise<void> {
  if (!userId) throw new Error('User ID is required.');
  if (!targetMemberId) throw new Error('Target member ID is required.');

  const userRef = doc(db, USERS_COLLECTION, userId);
  const memberRef = doc(db, MEMBERS_COLLECTION, targetMemberId);

  const [userSnap, memSnap] = await Promise.all([getDoc(userRef), getDoc(memberRef)]);
  if (!userSnap.exists()) throw new Error('Target user profile not found.');
  if (!memSnap.exists()) throw new Error('Target member record not found in roster.');

  const userData = userSnap.data() as UserProfile;
  const memData = memSnap.data() as Member;

  const transition = nextUserState(userData, memData, 'activate_directly');
  if (!transition.allowed) {
    throw new Error(transition.reason || 'Direct activation is not allowed in current state.');
  }

  if (memData.authUid && memData.authUid !== userId) {
    throw new Error('Member record is already linked to another account.');
  }

  const now = new Date().toISOString();
  const batch = writeBatch(db);

  batch.update(userRef, {
    status: 'active',
    memberId: targetMemberId,
    approvedMemberId: targetMemberId,
    approvedAt: now,
    respondedAt: now,
    updatedAt: now,
  });

  const memberUpdates: Record<string, any> = { authUid: userId };
  if (memData.status === 'Inactive') {
    memberUpdates.status = 'Active';
  }
  batch.update(memberRef, memberUpdates);

  createAuditLogInBatch(
    batch,
    'approve_user',
    `Admin directly activated member link for user ${userId} to member ${targetMemberId}`
  );

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${userId}`);
  }
}

export async function acceptMembershipInvitation(userId: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    throw new Error('User profile not found.');
  }

  const userProfile = userSnap.data() as UserProfile;
  if (userProfile.status !== 'approved_waiting_response' || !userProfile.approvedMemberId) {
    throw new Error('No pending approved membership invitation to accept.');
  }

  const memberId = userProfile.approvedMemberId;
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  let memberExists = true;
  let alreadyLinked = false;
  try {
    const memberSnap = await getDoc(memberRef);
    if (memberSnap.exists()) {
      const memData = memberSnap.data() as Member;
      if (memData.authUid && memData.authUid !== userId) {
        throw new Error('Member record is already linked to another account.');
      }
      if (memData.authUid === userId) {
        alreadyLinked = true;
      }
    } else {
      memberExists = false;
    }
  } catch (err: any) {
    if (err?.message?.includes('already linked')) {
      throw err;
    }
  }

  const batch = writeBatch(db);
  batch.update(userRef, {
    status: 'active',
    memberId: memberId,
    respondedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (memberExists && !alreadyLinked) {
    batch.update(memberRef, { authUid: userId });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${userId}`);
  }
}

export async function declineMembershipInvitation(userId: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  try {
    await updateDoc(userRef, {
      status: 'declined',
      respondedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
}

export async function rejectUserMembershipLink(userId: string): Promise<void> {
  return declineUserRequest(userId);
}

export async function approveAndLinkUser(
  userId: string,
  targetMemberId: string,
  newMemberData?: {
    name: string;
    handle: string;
    role: BuilderRole;
    tracks: BuilderTrack[];
    email?: string;
  }
): Promise<void> {
  if (newMemberData) {
    await createMemberAndApprove(userId, {
      name: newMemberData.name,
      handle: newMemberData.handle,
      role: newMemberData.role,
      tracks: newMemberData.tracks,
      email: newMemberData.email,
    });
    return;
  }
  await approveExistingMember(userId, targetMemberId);
}

export async function directActivateUserMembership(
  userId: string,
  targetMemberId: string
): Promise<void> {
  return activateDirectly(userId, targetMemberId);
}

export async function declineUserRequest(userId: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.update(userRef, {
    status: 'declined',
    approvedMemberId: deleteField(),
    respondedAt: now,
    updatedAt: now,
  });

  createAuditLogInBatch(batch, 'decline_user', `Declined applicant request for user ${userId}`, {
    targetId: userId,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
}

export async function suspendUser(userId: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  try {
    await updateDoc(userRef, {
      status: 'suspended',
      updatedAt: new Date().toISOString(),
    });
    await createAuditLog('suspend_user', `Suspended user ${userId}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
}

export async function unsuspendUser(userId: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    throw new Error('User profile not found.');
  }
  const profile = snap.data() as UserProfile;
  const transition = nextUserState(profile, null, 'unsuspend');
  const targetStatus = transition.nextUserStatus || 'pending';

  try {
    await updateDoc(userRef, {
      status: targetStatus,
      updatedAt: new Date().toISOString(),
    });
    await createAuditLog('unsuspend_user', `Unsuspended user ${userId} -> restored to ${targetStatus}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
}

// ==========================================
// Members (members/{memberId}) & memberPrivate
// ==========================================

export function subscribeToMembers(
  onUpdate: (members: Member[]) => void,
  onError?: (err: Error) => void
): () => void {
  return onSnapshot(
    collection(db, MEMBERS_COLLECTION),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Member);
      onUpdate(list);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, MEMBERS_COLLECTION, onError);
    }
  );
}

export async function getMemberPrivate(memberId: string): Promise<MemberPrivate | null> {
  const privRef = doc(db, MEMBER_PRIVATE_COLLECTION, memberId);
  try {
    const snap = await getDoc(privRef);
    return snap.exists() ? (snap.data() as MemberPrivate) : null;
  } catch {
    return null;
  }
}

export async function getAllMemberPrivateMap(auditReason = 'Admin Roster CSV export with PII'): Promise<Map<string, MemberPrivate>> {
  const snap = await getDocs(collection(db, MEMBER_PRIVATE_COLLECTION));
  const map = new Map<string, MemberPrivate>();
  snap.docs.forEach((d) => {
    map.set(d.id, d.data() as MemberPrivate);
  });
  await createAuditLog('export_roster_pii', `${auditReason} (${map.size} memberPrivate records accessed)`);
  return map;
}

export async function addMemberToFirestore(
  publicData: Omit<Member, 'id' | 'createdAt'>,
  privateData?: MemberPrivate
): Promise<string> {
  if (!publicData.name || !publicData.name.trim()) {
    throw new Error('Full name is required.');
  }
  if (!publicData.handle || !publicData.handle.trim()) {
    throw new Error('Builder handle is required.');
  }
  if (!publicData.tracks || publicData.tracks.length === 0) {
    throw new Error('At least one track discipline must be selected.');
  }

  // Check unique handle and student ID right before writing against all active members
  // Note: Client-side pre-write checks minimize collision risk; a simultaneous write race is theoretically possible.
  const cleanHandle = publicData.handle.trim();
  const snapAll = await getDocs(collection(db, MEMBERS_COLLECTION));
  const existingMembers = snapAll.docs.map((d) => d.data() as Member);

  const handleCheck = isHandleTaken(existingMembers, cleanHandle);
  if (handleCheck.taken && handleCheck.conflictingMember) {
    throw new Error(
      `Builder handle "${cleanHandle}" is already in use by active builder ${handleCheck.conflictingMember.name} (${handleCheck.conflictingMember.status}).`
    );
  }

  const cleanStudentId = publicData.studentId?.trim() || privateData?.studentId?.trim();
  if (cleanStudentId) {
    const idCheck = isStudentIdTaken(existingMembers, cleanStudentId);
    if (idCheck.taken && idCheck.conflictingMember) {
      throw new Error(
        `Student ID "${cleanStudentId}" is already registered to active builder ${idCheck.conflictingMember.name} (${idCheck.conflictingMember.status}).`
      );
    }
    const privDocs = await getDocs(
      query(collection(db, MEMBER_PRIVATE_COLLECTION), where('studentId', '==', cleanStudentId), limit(1))
    );
    if (!privDocs.empty) {
      const conflictId = privDocs.docs[0].id;
      const activeConflict = existingMembers.find((m) => m.id === conflictId && m.status !== 'Inactive');
      if (activeConflict) {
        throw new Error(
          `Student ID "${cleanStudentId}" is already registered to active builder ${activeConflict.name} (${activeConflict.status}).`
        );
      }
    }
  }

  const memberId = (publicData as any).id && typeof (publicData as any).id === 'string' && (publicData as any).id.trim().length > 0
    ? (publicData as any).id.trim()
    : `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  const privRef = doc(db, MEMBER_PRIVATE_COLLECTION, memberId);

  const batch = writeBatch(db);

  const defaultUni = publicData.university?.trim() || privateData?.university?.trim() || 'Tongmyong University';
  const safeAvatar = await ensureSafeAvatarUrl(publicData.avatarUrl);
  const rawAuthUid = (publicData as any).authUid?.trim() || undefined;
  const candidatePublic: Record<string, any> = {
    id: memberId,
    name: publicData.name.trim(),
    handle: cleanHandle,
    role: publicData.role || 'Member',
    tracks: publicData.tracks && publicData.tracks.length > 0 ? publicData.tracks : ['Hardware & Robotics'],
    joinedDate: publicData.joinedDate || new Date().toISOString().split('T')[0],
    status: publicData.status || 'Active',
    avatarUrl: safeAvatar || '',
    bio: publicData.bio?.trim() || '',
    leaderboardOptOut: publicData.leaderboardOptOut ?? false,
    authUid: rawAuthUid || undefined,
    createdAt: new Date().toISOString(),
    githubUrl: publicData.githubUrl || '',
    linkedinUrl: publicData.linkedinUrl || '',
    portfolioUrl: publicData.portfolioUrl || '',
    showLinksPublicly: publicData.showLinksPublicly ?? true,
  };
  const finalPublic: Record<string, any> = {};
  for (const key of Object.keys(candidatePublic)) {
    if (PUBLIC_MEMBER_WHITELIST.has(key) && candidatePublic[key] !== undefined) {
      finalPublic[key] = candidatePublic[key];
    }
  }
  batch.set(memberRef, finalPublic);

  const finalPriv: MemberPrivate = removeUndefinedFields({
    email: (privateData?.email || publicData.email)?.trim().toLowerCase() || undefined,
    phone: (privateData?.phone || publicData.phone)?.trim() || undefined,
    studentId: (privateData?.studentId || publicData.studentId)?.trim() || undefined,
    university: defaultUni,
    department: (privateData?.department || publicData.department)?.trim() || undefined,
    major: (privateData?.major || publicData.major)?.trim() || undefined,
    semester: (privateData?.semester || publicData.semester)?.trim() || undefined,
  });
  batch.set(privRef, finalPriv);

  try {
    await batch.commit();
    await createAuditLog('add_member', `Created builder profile "${finalPublic.name}" (${memberId})`);
    return memberId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `members/${memberId}`);
  }
}

export async function updateMemberProfile(
  memberId: string,
  publicUpdates: Partial<
    Pick<
      Member,
      | 'name'
      | 'avatarUrl'
      | 'bio'
      | 'tracks'
      | 'leaderboardOptOut'
      | 'githubUrl'
      | 'linkedinUrl'
      | 'portfolioUrl'
      | 'showLinksPublicly'
    >
  >,
  privateUpdates?: MemberPrivate
): Promise<void> {
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  const privRef = doc(db, MEMBER_PRIVATE_COLLECTION, memberId);

  const batch = writeBatch(db);

  if (Object.keys(publicUpdates).length > 0) {
    const cleanPublicUpdates = { ...publicUpdates };
    if (cleanPublicUpdates.avatarUrl !== undefined) {
      cleanPublicUpdates.avatarUrl = (await ensureSafeAvatarUrl(cleanPublicUpdates.avatarUrl)) || '';
    }
    batch.update(memberRef, removeUndefinedFields(cleanPublicUpdates));

    const pubRef = doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId);
    const hasLinkFields =
      'githubUrl' in cleanPublicUpdates ||
      'linkedinUrl' in cleanPublicUpdates ||
      'portfolioUrl' in cleanPublicUpdates ||
      'showLinksPublicly' in cleanPublicUpdates;

    if (cleanPublicUpdates.leaderboardOptOut === true) {
      batch.delete(pubRef);
    } else if (cleanPublicUpdates.name || cleanPublicUpdates.avatarUrl !== undefined || hasLinkFields) {
      const pubUpdates: Record<string, any> = {
        lastUpdated: new Date().toISOString(),
      };
      if (cleanPublicUpdates.name) {
        pubUpdates.displayName = cleanPublicUpdates.name;
        pubUpdates.name = cleanPublicUpdates.name;
      }
      if (cleanPublicUpdates.avatarUrl !== undefined) {
        pubUpdates.avatar = cleanPublicUpdates.avatarUrl || '';
        pubUpdates.avatarUrl = cleanPublicUpdates.avatarUrl || '';
      }
      if (hasLinkFields) {
        const showPublicly = cleanPublicUpdates.showLinksPublicly !== false;
        if (cleanPublicUpdates.showLinksPublicly !== undefined) {
          pubUpdates.showLinksPublicly = cleanPublicUpdates.showLinksPublicly;
        }
        if (showPublicly) {
          if (cleanPublicUpdates.githubUrl !== undefined) pubUpdates.githubUrl = cleanPublicUpdates.githubUrl;
          if (cleanPublicUpdates.linkedinUrl !== undefined) pubUpdates.linkedinUrl = cleanPublicUpdates.linkedinUrl;
          if (cleanPublicUpdates.portfolioUrl !== undefined) pubUpdates.portfolioUrl = cleanPublicUpdates.portfolioUrl;
        } else {
          pubUpdates.githubUrl = '';
          pubUpdates.linkedinUrl = '';
          pubUpdates.portfolioUrl = '';
        }
      }
      batch.set(pubRef, pubUpdates, { merge: true });
    }
  }

  if (privateUpdates && Object.keys(privateUpdates).length > 0) {
    batch.set(privRef, removeUndefinedFields(privateUpdates), { merge: true });
  }

  try {
    await batch.commit();
    await createAuditLog('update_member', `Updated builder profile details for ${memberId}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `members/${memberId}`);
  }
}

export async function deactivateMember(memberId: string): Promise<void> {
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  const memSnap = await getDoc(memberRef);
  if (!memSnap.exists()) {
    throw new Error(`Member ${memberId} not found.`);
  }
  const memberData = memSnap.data() as Member;

  // Locate linked users via members/{id}.authUid AND users where memberId == id
  const linkedUsersMap = new Map<string, UserProfile>();
  if (memberData.authUid) {
    const authUserSnap = await getDoc(doc(db, USERS_COLLECTION, memberData.authUid));
    if (authUserSnap.exists()) {
      linkedUsersMap.set(authUserSnap.id, {
        id: authUserSnap.id,
        ...(authUserSnap.data() as any),
      } as UserProfile);
    }
  }

  const linkedQuerySnap = await getDocs(
    query(collection(db, USERS_COLLECTION), where('memberId', '==', memberId))
  );
  linkedQuerySnap.forEach((d) => {
    if (!linkedUsersMap.has(d.id)) {
      linkedUsersMap.set(d.id, { id: d.id, ...(d.data() as any) } as UserProfile);
    }
  });

  const linkedUsersList = Array.from(linkedUsersMap.values());
  const delegatedAdminUids: string[] = [];
  for (const linked of linkedUsersList) {
    if (linked.email?.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim()) {
      throw new Error('Cannot deactivate the designated Super Administrator account.');
    }
    try {
      const adminSnap = await getDoc(doc(db, ADMINS_COLLECTION, linked.id));
      if (adminSnap.exists()) {
        delegatedAdminUids.push(linked.id);
      }
    } catch {
      // ignore read notice
    }
  }

  const currentUser = auth.currentUser;
  const plan = buildDeactivateMemberPlan({
    member: memberData,
    linkedUsers: linkedUsersList,
    actorUid: currentUser?.uid || 'admin',
    actorEmail: currentUser?.email || 'unknown',
    superAdminEmail: SUPER_ADMIN_EMAIL,
    delegatedAdminUids,
  });

  const batch = writeBatch(db);
  batch.update(memberRef, plan.memberUpdate);

  for (const userUpdate of plan.userUpdates) {
    const userRef = doc(db, USERS_COLLECTION, userUpdate.uid);
    batch.update(userRef, {
      status: userUpdate.update.status,
      memberId: deleteField(),
      approvedMemberId: deleteField(),
      respondedAt: userUpdate.update.respondedAt,
      updatedAt: userUpdate.update.updatedAt,
    });
  }

  batch.delete(doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId));

  if (currentUser) {
    batch.set(doc(db, AUDIT_LOGS_COLLECTION, plan.auditEntry.id), {
      ...plan.auditEntry,
      timestamp: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `members/${memberId}`);
  }
}

export async function reactivateMember(
  memberId: string,
  options?: { targetUserId?: string; routeThroughApproval?: boolean }
): Promise<void> {
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  const memSnap = await getDoc(memberRef);
  if (!memSnap.exists()) {
    throw new Error(`Member ${memberId} not found.`);
  }
  const memberData = memSnap.data() as Member;

  let linkedUser: UserProfile | null = null;
  const candidateUid = options?.targetUserId || memberData.authUid;
  if (candidateUid) {
    const userSnap = await getDoc(doc(db, USERS_COLLECTION, candidateUid));
    if (userSnap.exists()) {
      linkedUser = { id: userSnap.id, ...(userSnap.data() as any) } as UserProfile;
    }
  } else {
    const linkedQuerySnap = await getDocs(
      query(collection(db, USERS_COLLECTION), where('memberId', '==', memberId), limit(1))
    );
    if (!linkedQuerySnap.empty) {
      const d = linkedQuerySnap.docs[0];
      linkedUser = { id: d.id, ...(d.data() as any) } as UserProfile;
    }
  }

  const currentUser = auth.currentUser;
  const plan = buildReactivateMemberPlan({
    member: memberData,
    linkedUser,
    actorUid: currentUser?.uid || 'admin',
    actorEmail: currentUser?.email || 'unknown',
    routeThroughApproval: options?.routeThroughApproval ?? true,
  });

  const batch = writeBatch(db);
  batch.update(memberRef, plan.memberUpdate);

  if (plan.userUpdate) {
    const userRef = doc(db, USERS_COLLECTION, plan.userUpdate.uid);
    batch.update(userRef, {
      status: plan.userUpdate.update.status,
      approvedMemberId: plan.userUpdate.update.approvedMemberId,
      approvedAt: plan.userUpdate.update.approvedAt,
      memberId: deleteField(),
      updatedAt: plan.userUpdate.update.updatedAt,
    });
  }

  if (currentUser) {
    batch.set(doc(db, AUDIT_LOGS_COLLECTION, plan.auditEntry.id), {
      ...plan.auditEntry,
      timestamp: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `members/${memberId}`);
  }
}

export async function archiveMemberHandle(memberId: string): Promise<string> {
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  const snap = await getDoc(memberRef);
  if (!snap.exists()) {
    throw new Error(`Member ${memberId} not found.`);
  }
  const data = snap.data() as Member;
  const newHandle = archiveHandle(data.handle);
  await updateDoc(memberRef, { handle: newHandle } as any);
  await createAuditLog('update_member', `Archived handle for member ${memberId}: ${data.handle} -> ${newHandle}`);
  return newHandle;
}

export async function permanentDeleteMember(
  memberId: string,
  options?: { deleteAttendance?: boolean }
): Promise<void> {
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  const memSnap = await getDoc(memberRef);
  if (!memSnap.exists()) {
    throw new Error(`Member ${memberId} not found.`);
  }
  const memberData = memSnap.data() as Member;

  // 1. Look up linked user by authUid or where memberId == id
  let linkedUid: string | undefined = memberData.authUid;
  if (!linkedUid) {
    const qUser = query(collection(db, USERS_COLLECTION), where('memberId', '==', memberId));
    const userSnap = await getDocs(qUser);
    if (!userSnap.empty) {
      linkedUid = userSnap.docs[0].id;
    }
  }

  // 2. Guard: Check if linked user or member is an admin or super admin
  if (linkedUid) {
    const userDocRef = doc(db, USERS_COLLECTION, linkedUid);
    const userSnap = await getDoc(userDocRef);
    const userData = userSnap.data() as UserProfile | undefined;
    const userEmail = userData?.email?.toLowerCase();

    if (userEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
      throw new Error('Cannot delete super admin.');
    }

    const adminDocRef = doc(db, 'admins', linkedUid);
    const adminSnap = await getDoc(adminDocRef);
    if (adminSnap.exists()) {
      throw new Error('Cannot permanently delete an administrator. Revoke admin role first.');
    }
  }

  // 3. Optional: Delete attendance records in chunks of 400 if explicitly requested
  if (options?.deleteAttendance) {
    const qCheckIns = query(collection(db, CHECKINS_COLLECTION), where('memberId', '==', memberId));
    const checkInsSnap = await getDocs(qCheckIns);
    const checkInDocs = checkInsSnap.docs;
    for (let i = 0; i < checkInDocs.length; i += 400) {
      const chunkBatch = writeBatch(db);
      checkInDocs.slice(i, i + 400).forEach((d) => chunkBatch.delete(d.ref));
      await chunkBatch.commit();
    }
  }

  // 4. Atomic batch deletion & linked user reset using deleteField()
  const batch = writeBatch(db);
  batch.delete(memberRef);
  batch.delete(doc(db, MEMBER_PRIVATE_COLLECTION, memberId));
  batch.delete(doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId));

  if (linkedUid) {
    batch.update(doc(db, USERS_COLLECTION, linkedUid), {
      status: 'declined',
      memberId: deleteField(),
      approvedMemberId: deleteField(),
      updatedAt: new Date().toISOString(),
    });
  }

  const currentUser = auth.currentUser;
  if (currentUser) {
    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const logRef = doc(db, AUDIT_LOGS_COLLECTION, logId);
    batch.set(logRef, {
      id: logId,
      action: 'delete_member',
      performedBy: currentUser.uid,
      performedByEmail: currentUser.email || 'unknown',
      details: `Permanently deleted member "${memberData.name}" (${memberId}). Handle "${memberData.handle}" freed for reuse.`,
      timestamp: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `members/${memberId}`);
  }
}

// ==========================================
// Sessions (sessions/{sessionId})
// ==========================================

export function subscribeToSessions(
  onUpdate: (sessions: Session[]) => void,
  onError?: (err: Error) => void
): () => void {
  return onSnapshot(
    collection(db, SESSIONS_COLLECTION),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Session);
      onUpdate(list);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, SESSIONS_COLLECTION, onError);
    }
  );
}

export async function createSessionInFirestore(
  sessionData: Omit<Session, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
): Promise<string> {
  const operatorUid = auth.currentUser?.uid;
  const finalSession: Session = createSessionPayload({
    ...sessionData,
    id: sessionData.id,
    startTime: sessionData.startTime || '',
    endTime: sessionData.endTime || '',
    createdAt: sessionData.createdAt,
    createdBy: sessionData.createdBy || operatorUid,
  });

  const sessionId = finalSession.id;
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  const announcementId = `ann_${sessionId}_pub`;
  const announcementRef = doc(db, ANNOUNCEMENTS_COLLECTION, announcementId);
  const announcement: Announcement = {
    id: announcementId,
    type: 'session_published',
    sessionId,
    title: `New Session: ${finalSession.title}`,
    message: `${finalSession.title} (${finalSession.track}) scheduled for ${finalSession.date} at ${finalSession.location}.`,
    createdAt: new Date().toISOString(),
    createdBy: operatorUid || finalSession.createdBy || 'admin',
  };

  const batch = writeBatch(db);
  batch.set(sessionRef, removeUndefinedFields(finalSession));
  batch.set(announcementRef, removeUndefinedFields(announcement));
  createAuditLogInBatch(
    batch,
    'create_session',
    `Scheduled new session "${finalSession.title}" (${sessionId})`,
    { targetId: sessionId, targetName: finalSession.title }
  );

  try {
    await batch.commit();
    return sessionId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `sessions/${sessionId}`);
  }
}

export async function updateSessionInFirestore(
  sessionIdOrSession: string | Session,
  updates?: Partial<Session>,
  isRescheduled = false
): Promise<void> {
  const sessionId = typeof sessionIdOrSession === 'string' ? sessionIdOrSession : sessionIdOrSession.id;
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);

  let mergedInput: Partial<Session>;
  if (typeof sessionIdOrSession === 'string') {
    const existingSnap = await getDoc(sessionRef);
    const existingData = existingSnap.exists() ? (existingSnap.data() as Session) : {};
    mergedInput = {
      ...existingData,
      ...(updates || {}),
      id: sessionId,
    };
  } else {
    mergedInput = sessionIdOrSession;
  }

  // Derive missing date/startTime/endTime strings only if legacy doc has startAt/endAt without HH:mm
  const nowIso = new Date().toISOString();
  const tz = mergedInput.timezone || DEFAULT_CLUB_TIMEZONE;
  const normalizeHhMm = (hhmm: string) => hhmm.replace(/^24:/, '00:');
  const derivedDate = mergedInput.date || (mergedInput.startAt ? formatDateInClubTz(mergedInput.startAt, tz) : '');
  const derivedStartTime =
    mergedInput.startTime || (mergedInput.startAt ? normalizeHhMm(formatTimeInClubTz(mergedInput.startAt, tz, true)) : '');
  const derivedEndTime =
    mergedInput.endTime || (mergedInput.endAt ? normalizeHhMm(formatTimeInClubTz(mergedInput.endAt, tz, true)) : '');
  const validatedSession = createSessionPayload({
    id: sessionId,
    title: mergedInput.title || '',
    track: mergedInput.track || 'Hardware & Robotics',
    date: derivedDate,
    startTime: derivedStartTime,
    endTime: derivedEndTime,
    location: mergedInput.location || '',
    host: mergedInput.host,
    description: mergedInput.description,
    sessionCode: mergedInput.sessionCode,
    timezone: tz,
    status: mergedInput.status,
    checkInMode: mergedInput.checkInMode,
    openMinutesBefore: mergedInput.openMinutesBefore,
    graceMinutesAfter: mergedInput.graceMinutesAfter,
    lateAfterMinutes: mergedInput.lateAfterMinutes,
    points: mergedInput.points,
    maxCapacity: mergedInput.maxCapacity,
    createdAt: mergedInput.createdAt,
    createdBy: mergedInput.createdBy,
    updatedAt: nowIso,
    deletedAt: mergedInput.deletedAt,
  });

  const batch = writeBatch(db);
  batch.update(sessionRef, removeUndefinedFields(validatedSession) as Record<string, any>);

  if (isRescheduled) {
    const annId = `ann_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
    const announcement: Announcement = {
      id: annId,
      type: 'session_rescheduled',
      sessionId,
      title: `Rescheduled: ${validatedSession.title}`,
      message: `The session schedule has been updated to ${validatedSession.date} (${validatedSession.startTime}–${validatedSession.endTime}) at ${validatedSession.location}.`,
      createdAt: nowIso,
      createdBy: auth.currentUser?.uid || 'admin',
    };
    batch.set(doc(db, ANNOUNCEMENTS_COLLECTION, annId), removeUndefinedFields(announcement));
  }

  createAuditLogInBatch(
    batch,
    'update_session',
    `Updated session "${validatedSession.title}" (${sessionId})`,
    { targetId: sessionId, targetName: validatedSession.title }
  );

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function setSessionCheckInMode(
  sessionId: string,
  mode: Session['checkInMode']
): Promise<void> {
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  const batch = writeBatch(db);
  batch.update(sessionRef, {
    checkInMode: mode,
    updatedAt: new Date().toISOString(),
  });
  createAuditLogInBatch(batch, 'session_open_close', `Set session ${sessionId} check-in mode to ${mode}`, {
    targetId: sessionId,
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function completeSession(sessionId: string): Promise<void> {
  const operatorUid = auth.currentUser?.uid;
  if (!operatorUid) {
    throw new Error('Authentication required: only administrators can complete sessions.');
  }
  const plan = buildCompleteSessionBatchPlan(sessionId, operatorUid, auth.currentUser?.email || undefined);
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  const auditRef = doc(db, AUDIT_LOGS_COLLECTION, plan.auditEntry.id);

  const batch = writeBatch(db);
  batch.update(sessionRef, plan.sessionUpdate);
  batch.set(auditRef, removeUndefinedFields({
    ...plan.auditEntry,
    timestamp: serverTimestamp(),
  }));

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function reopenSession(
  sessionId: string,
  targetMode: Session['checkInMode'] = 'auto'
): Promise<void> {
  const operatorUid = auth.currentUser?.uid;
  if (!operatorUid) {
    throw new Error('Authentication required: only administrators can reopen sessions.');
  }
  const plan = buildReopenSessionBatchPlan(sessionId, targetMode, operatorUid, auth.currentUser?.email || undefined);
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  const auditRef = doc(db, AUDIT_LOGS_COLLECTION, plan.auditEntry.id);

  const batch = writeBatch(db);
  batch.update(sessionRef, plan.sessionUpdate);
  batch.set(auditRef, removeUndefinedFields({
    ...plan.auditEntry,
    timestamp: serverTimestamp(),
  }));

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function cancelSession(sessionId: string, sessionTitle: string): Promise<void> {
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  const annId = `ann_${sessionId}_cancel_${Date.now()}`;
  const nowIso = new Date().toISOString();
  const announcement: Announcement = {
    id: annId,
    type: 'session_cancelled',
    sessionId,
    title: `Cancelled: ${sessionTitle}`,
    message: `The session "${sessionTitle}" has been cancelled.`,
    createdAt: nowIso,
    createdBy: auth.currentUser?.uid || 'admin',
  };

  const batch = writeBatch(db);
  batch.update(sessionRef, {
    status: 'cancelled',
    checkInMode: 'closed',
    cancelledAt: nowIso,
    updatedAt: nowIso,
  });
  batch.set(doc(db, ANNOUNCEMENTS_COLLECTION, annId), removeUndefinedFields(announcement));
  createAuditLogInBatch(batch, 'cancel_session', `Cancelled session "${sessionTitle}" (${sessionId})`, {
    targetId: sessionId,
    targetName: sessionTitle,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function softDeleteSession(sessionId: string, sessionTitle?: string): Promise<void> {
  const operatorUid = auth.currentUser?.uid;
  if (!operatorUid) {
    throw new Error('Authentication required: only administrators can archive or delete sessions.');
  }
  const plan = buildSoftDeleteSessionBatchPlan(
    sessionId,
    sessionTitle,
    operatorUid,
    auth.currentUser?.email || undefined
  );
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  const auditRef = doc(db, AUDIT_LOGS_COLLECTION, plan.auditEntry.id);

  const batch = writeBatch(db);
  batch.update(sessionRef, plan.sessionUpdate);
  batch.set(
    auditRef,
    removeUndefinedFields({
      ...plan.auditEntry,
      timestamp: serverTimestamp(),
    })
  );

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function permanentDeleteSession(sessionId: string, sessionTitle?: string): Promise<void> {
  const operatorUid = auth.currentUser?.uid;
  if (!operatorUid) {
    throw new Error('Authentication required: only administrators can permanently delete sessions.');
  }

  try {
    const [checkInsSnap, announcementsSnap] = await Promise.all([
      getDocs(query(collection(db, CHECKINS_COLLECTION), where('sessionId', '==', sessionId))),
      getDocs(query(collection(db, ANNOUNCEMENTS_COLLECTION), where('sessionId', '==', sessionId))),
    ]);

    const plan = buildPermanentDeleteSessionOpsPlan({
      sessionId,
      sessionTitle,
      checkInIds: checkInsSnap.docs.map((d) => d.id),
      announcementIds: announcementsSnap.docs.map((d) => d.id),
      includeSessionToken: true,
      operatorUid,
      operatorEmail: auth.currentUser?.email || undefined,
      maxBatchOps: 400,
    });

    for (const chunk of plan.chunks) {
      const batch = writeBatch(db);
      for (const op of chunk) {
        if (op.op === 'delete') {
          batch.delete(doc(db, op.collection, op.docId));
        } else {
          batch.set(
            doc(db, AUDIT_LOGS_COLLECTION, op.docId),
            removeUndefinedFields({
              ...op.data,
              timestamp: serverTimestamp(),
            })
          );
        }
      }
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `sessions/${sessionId}`);
  }
}

export async function deleteSession(sessionId: string, sessionTitle?: string): Promise<void> {
  await permanentDeleteSession(sessionId, sessionTitle);
}

// ==========================================
// Rotating Kiosk Tokens (sessionTokens/{sessionId})
// ==========================================

export async function getSessionTokenDoc(
  sessionId: string
): Promise<{ token: string; prevToken?: string; rotatedAt?: Timestamp } | null> {
  const tokenRef = doc(db, SESSION_TOKENS_COLLECTION, sessionId);
  try {
    const snap = await getDoc(tokenRef);
    return snap.exists() ? (snap.data() as any) : null;
  } catch {
    return null;
  }
}

export async function writeKioskToken(sessionId: string, token: string, prevToken: string): Promise<void> {
  const tokenRef = doc(db, SESSION_TOKENS_COLLECTION, sessionId);
  try {
    await setDoc(tokenRef, {
      token,
      prevToken,
      rotatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `sessionTokens/${sessionId}`);
  }
}

export function subscribeToSessionToken(
  sessionId: string,
  onUpdate: (data: { token: string; prevToken: string; rotatedAt?: Timestamp } | null) => void,
  onError?: (err: Error) => void
): () => void {
  const tokenRef = doc(db, SESSION_TOKENS_COLLECTION, sessionId);
  return onSnapshot(
    tokenRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as any);
      } else {
        onUpdate(null);
      }
    },
    (err) => {
      notifyListenerError(err, OperationType.GET, `sessionTokens/${sessionId}`, onError);
    }
  );
}

// ==========================================
// Check-Ins (checkIns/{sessionId}_{memberId})
// ==========================================

export function subscribeToMemberCheckIns(
  memberId: string,
  onUpdate: (records: CheckInRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, CHECKINS_COLLECTION),
    where('memberId', '==', memberId)
  );

  return onSnapshot(
    q,
    (snap) => {
      const records = snap.docs.map((d) => d.data() as CheckInRecord);
      onUpdate(records);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, CHECKINS_COLLECTION, onError);
    }
  );
}

export function subscribeToAllCheckIns(
  onUpdate: (records: CheckInRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  return onSnapshot(
    collection(db, CHECKINS_COLLECTION),
    (snap) => {
      const records = snap.docs.map((d) => d.data() as CheckInRecord);
      onUpdate(records);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, CHECKINS_COLLECTION, onError);
    }
  );
}

function createFirestoreCheckInStore(): CheckInStoreAdapter {
  return {
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    writeSelfCheckIn: async (checkInId, record) => {
      await setDoc(doc(db, CHECKINS_COLLECTION, checkInId), removeUndefinedFields(record));
    },
    getExistingCheckIn: async (checkInId) => {
      const snap = await getDoc(doc(db, CHECKINS_COLLECTION, checkInId));
      return snap.exists() ? (snap.data() as CheckInRecord) : null;
    },
    syncLeaderboard: async (memberId, monthKey, points) => {
      await syncMemberCheckInToPublicLeaderboard(memberId, monthKey, points);
    },
    getMember: async (memberId) => {
      const snap = await getDoc(doc(db, MEMBERS_COLLECTION, memberId));
      return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as Member) : null;
    },
    getSession: async (sessionId) => {
      const snap = await getDoc(doc(db, SESSIONS_COLLECTION, sessionId));
      return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as Session) : null;
    },
    writeManualCheckInBatch: async (checkInId, record, auditDetails) => {
      const batch = writeBatch(db);
      batch.set(doc(db, CHECKINS_COLLECTION, checkInId), removeUndefinedFields(record));
      createAuditLogInBatch(batch, 'check_in_manual', auditDetails, {
        targetId: checkInId,
        targetName: record.memberId,
      });
      await batch.commit();
    },
  };
}

export async function recordSelfCheckIn(
  sessionId: string,
  memberId: string,
  token: string,
  session: Session,
  method: CheckInMethod = 'camera_scan'
): Promise<{ success: boolean; message: string; record?: CheckInRecord; isDuplicate?: boolean }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to check in.');
  }

  await ensureFreshServerTimeOffset();

  return await executeSelfCheckInWithStore(createFirestoreCheckInStore(), {
    sessionId,
    memberId,
    authUid: currentUser.uid,
    token,
    session,
    method,
    checkedInAtValue: serverTimestamp(),
    nowMs: getCorrectedNowMs(),
  });
}

export async function recordAdminManualCheckIn(
  sessionId: string,
  memberId: string,
  sessionOrNotes?: Session | string,
  notesOrOperator?: string
): Promise<{ success: boolean; message: string; record?: CheckInRecord; isDuplicate?: boolean }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Admin authentication required.');
  }

  let sessionHint: Session | null = null;
  let notes: string | undefined = undefined;

  if (typeof sessionOrNotes === 'string') {
    notes = sessionOrNotes;
  } else if (sessionOrNotes && typeof sessionOrNotes === 'object') {
    sessionHint = sessionOrNotes;
    notes = notesOrOperator;
  }

  await ensureFreshServerTimeOffset();

  return await executeManualCheckInWithStore(createFirestoreCheckInStore(), {
    sessionId,
    memberId,
    operatorUid: currentUser.uid,
    checkedInAtValue: serverTimestamp(),
    sessionHint,
    notes,
    nowMs: getCorrectedNowMs(),
  });
}

export async function deleteCheckInRecord(checkInId: string, reason: string = ''): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Admin authentication required to delete attendance check-ins.');
  }

  const plan = buildDeleteCheckInBatchPlan({
    checkInId,
    reason,
    operatorUid: currentUser.uid,
    operatorEmail: currentUser.email || undefined,
  });

  const batch = writeBatch(db);
  batch.delete(doc(db, CHECKINS_COLLECTION, checkInId));
  batch.set(
    doc(db, AUDIT_LOGS_COLLECTION, plan.auditEntry.id),
    removeUndefinedFields({
      ...plan.auditEntry,
      timestamp: serverTimestamp(),
    })
  );

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `checkIns/${checkInId}`);
  }
}

// ==========================================
// Announcements (announcements/{id})
// ==========================================

export function subscribeToAnnouncements(
  onUpdate: (announcements: Announcement[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, ANNOUNCEMENTS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(30)
  );

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Announcement);
      onUpdate(list);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, ANNOUNCEMENTS_COLLECTION, onError);
    }
  );
}

// ==========================================
// Public Leaderboard (publicLeaderboard/{memberId})
// ==========================================

export function subscribeToPublicLeaderboard(
  onUpdate: (items: PublicLeaderboardItem[]) => void,
  onError?: (err: Error) => void
): () => void {
  return onSnapshot(
    collection(db, PUBLIC_LEADERBOARD_COLLECTION),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as PublicLeaderboardItem);
      list.sort((a, b) => (b.points || 0) - (a.points || 0) || (b.totalCheckIns || 0) - (a.totalCheckIns || 0));
      onUpdate(list);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, PUBLIC_LEADERBOARD_COLLECTION, onError);
    }
  );
}

export async function syncMemberCheckInToPublicLeaderboard(
  memberId: string,
  _monthKey?: string,
  _pointsAwarded?: number
): Promise<void> {
  try {
    const memberSnap = await getDoc(doc(db, MEMBERS_COLLECTION, memberId));
    if (!memberSnap.exists()) {
      await deleteDoc(doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId));
      return;
    }

    const member = { id: memberSnap.id, ...(memberSnap.data() as any) } as Member;
    if (member.status === 'Inactive' || member.leaderboardOptOut) {
      await deleteDoc(doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId));
      return;
    }

    // Recompute authoritatively from sessions + member's checkIns instead of naive +1 math
    const [sessionsSnap, memberCheckInsSnap] = await Promise.all([
      getDocs(collection(db, SESSIONS_COLLECTION)),
      getDocs(query(collection(db, CHECKINS_COLLECTION), where('memberId', '==', memberId))),
    ]);

    const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Session);
    const memberCheckIns = memberCheckInsSnap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as any) }) as CheckInRecord
    );

    const items = buildPublicLeaderboardItems([member], sessions, memberCheckIns);
    if (items.length === 0) {
      await deleteDoc(doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId));
      return;
    }

    await setDoc(doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId), removeUndefinedFields(items[0]));
  } catch (err: any) {
    // Score writes on publicLeaderboard are admin-restricted under firestore.rules;
    // non-admin self check-ins ignore permission-denied cleanly (recomputed on admin sync/session refresh).
    if (err?.code === 'permission-denied') {
      return;
    }
    console.warn('Public leaderboard sync notice:', err);
  }
}

export async function removeFromPublicLeaderboard(memberId: string): Promise<void> {
  try {
    const pubRef = doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId);
    await deleteDoc(pubRef);
  } catch (err) {
    console.warn('Remove from public leaderboard notice:', err);
  }
}

async function commitLeaderboardRecomputePlan(
  members: Member[],
  sessions: Session[],
  checkIns: CheckInRecord[],
  auditDetailsPrefix: string
): Promise<{ totalBackfilled: number; totalRemoved: number }> {
  const currentPubSnap = await getDocs(collection(db, PUBLIC_LEADERBOARD_COLLECTION));
  const existingPublicIds = currentPubSnap.docs.map((d) => d.id);

  const plan = buildLeaderboardRecomputeOpsPlan({
    members,
    sessions,
    checkIns,
    existingPublicIds,
    chunkLimit: 400,
  });

  const auditDetails = `${auditDetailsPrefix} (${plan.items.length} active builders synced, ${plan.totalRemoved} opted-out/inactive pruned)`;

  if (plan.batches.length === 0) {
    const batch = writeBatch(db);
    createAuditLogInBatch(batch, 'recompute_leaderboard', auditDetails, {
      targetName: 'publicLeaderboard',
    });
    await batch.commit();
  } else {
    for (let i = 0; i < plan.batches.length; i++) {
      const ops = plan.batches[i];
      const batch = writeBatch(db);
      for (const op of ops) {
        const pubRef = doc(db, PUBLIC_LEADERBOARD_COLLECTION, op.memberId);
        if (op.type === 'set') {
          batch.set(pubRef, removeUndefinedFields(op.item));
        } else {
          batch.delete(pubRef);
        }
      }
      if (i === plan.batches.length - 1) {
        createAuditLogInBatch(batch, 'recompute_leaderboard', auditDetails, {
          targetName: 'publicLeaderboard',
        });
      }
      await batch.commit();
    }
  }

  return { totalBackfilled: plan.items.length, totalRemoved: plan.totalRemoved };
}

export async function backfillPublicLeaderboard(): Promise<{ totalBackfilled: number; totalRemoved: number }> {
  try {
    const [membersSnap, sessionsSnap, checkInsSnap] = await Promise.all([
      getDocs(collection(db, MEMBERS_COLLECTION)),
      getDocs(collection(db, SESSIONS_COLLECTION)),
      getDocs(collection(db, CHECKINS_COLLECTION)),
    ]);

    const members = membersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Member);
    const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Session);
    const checkIns = checkInsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as CheckInRecord);

    return await commitLeaderboardRecomputePlan(
      members,
      sessions,
      checkIns,
      'Backfilled public leaderboard'
    );
  } catch (err) {
    console.error('Failed to backfill public leaderboard:', err);
    throw err;
  }
}

export async function recomputeAndSaveLeaderboard(
  members: Member[],
  sessions: Session[],
  checkIns: CheckInRecord[]
): Promise<void> {
  try {
    await commitLeaderboardRecomputePlan(
      members,
      sessions,
      checkIns,
      'Recomputed public leaderboard rankings'
    );
  } catch (err) {
    console.warn('Failed to commit public leaderboard projection:', err);
  }
}

// ==========================================
// Club Settings (settings/club)
// ==========================================

export async function getClubSettings(): Promise<ClubSettings | null> {
  const settingsRef = doc(db, SETTINGS_COLLECTION, 'club');
  try {
    const snap = await getDoc(settingsRef);
    return snap.exists() ? (snap.data() as ClubSettings) : null;
  } catch {
    return null;
  }
}

export async function saveClubSettings(settings: ClubSettings): Promise<void> {
  const settingsRef = doc(db, SETTINGS_COLLECTION, 'club');
  try {
    await setDoc(settingsRef, settings);
    await createAuditLog('update_settings', `Updated club settings: ${settings.name} (${settings.timezone})`);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'settings/club');
  }
}

/**
 * Super-Admin Database JSON Backup Exporter
 * Downloads a complete JSON snapshot.
 * - Restricted strictly to Super Administrator (SUPER_ADMIN_EMAIL)
 * - Ephemeral sessionTokens are ALWAYS excluded
 * - Sensitive memberPrivate and users collections are included ONLY when includePII is confirmed true
 * - Emits an authoritative audit trail entry
 */
export async function exportFullBackupJSON(options?: { includePII?: boolean }): Promise<void> {
  const currentUserEmail = auth.currentUser?.email?.toLowerCase().trim();
  const superAdminEmail = SUPER_ADMIN_EMAIL.toLowerCase().trim();

  if (!currentUserEmail || !auth.currentUser?.emailVerified || currentUserEmail !== superAdminEmail) {
    throw new Error(
      'Permission denied: Only the designated Super Administrator may export database backups.'
    );
  }

  const includePII = !!options?.includePII;

  // Base collections: sessionTokens is strictly excluded
  const baseCollections = [
    MEMBERS_COLLECTION,
    SESSIONS_COLLECTION,
    CHECKINS_COLLECTION,
    ANNOUNCEMENTS_COLLECTION,
    NOTIFICATIONS_COLLECTION,
    AUDIT_LOGS_COLLECTION,
    SETTINGS_COLLECTION,
    PUBLIC_LEADERBOARD_COLLECTION,
  ];

  const collectionsToExport = [...baseCollections];
  if (includePII) {
    collectionsToExport.push(MEMBER_PRIVATE_COLLECTION, USERS_COLLECTION);
  }

  const backupData: Record<string, any[]> = {
    _metadata: [
      {
        exportedAt: new Date().toISOString(),
        exportedBy: currentUserEmail,
        schemaVersion: '2.0.0',
        club: 'Den of Builders',
        includesPII: includePII,
        excludedCollections: ['sessionTokens', ...(includePII ? [] : ['memberPrivate', 'users'])],
        note: 'For managed automated backups and point-in-time recovery (PITR), check the Google Cloud Console / Firebase Console under Cloud Firestore Backups.',
      },
    ],
  };

  for (const colName of collectionsToExport) {
    try {
      const snap = await getDocs(collection(db, colName));
      backupData[colName] = snap.docs.map((d) => ({
        _docId: d.id,
        ...d.data(),
      }));
    } catch (err) {
      console.warn(`Full backup: notice reading collection ${colName}:`, err);
      backupData[colName] = [];
    }
  }

  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  const piiTag = includePII ? '-with-pii' : '-sanitized';
  a.href = url;
  a.download = `dob-hub-backup-${dateStr}${piiTag}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  try {
    await createAuditLog(
      'update_settings',
      `Super Admin (${currentUserEmail}) generated JSON database backup (${includePII ? 'Full including memberPrivate & users PII' : 'Sanitized without PII'})`
    );
  } catch {
    // Non-fatal audit log
  }
}


export async function setupSuperAdminInitialRoster(
  clubName: string,
  timezone: string,
  adminName: string,
  adminHandle: string,
  adminUid: string,
  adminEmail: string
): Promise<void> {
  const batch = writeBatch(db);

  // 1. Settings
  const settingsRef = doc(db, SETTINGS_COLLECTION, 'club');
  const settings: ClubSettings = {
    name: clubName || 'Den of Builders',
    timezone: timezone || DEFAULT_CLUB_TIMEZONE,
    tracks: [
      'Hardware & Robotics',
      'Software & Systems',
      'AI & Embedded',
      'Open Hack & Demo',
    ],
    defaults: DEFAULT_CHECKIN_SETTINGS,
  };
  batch.set(settingsRef, settings);

  // 2. Super admin roster entry
  const memberId = `mem_admin_${adminUid.slice(0, 8)}`;
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  const memberDoc: Member = {
    id: memberId,
    name: adminName || 'Club President',
    handle: adminHandle || '@president',
    role: 'President',
    tracks: ['Software & Systems'],
    joinedDate: new Date().toISOString().split('T')[0],
    status: 'Active',
    authUid: adminUid,
    createdAt: new Date().toISOString(),
  };
  batch.set(memberRef, memberDoc);

  // 3. User profile linking
  const userRef = doc(db, USERS_COLLECTION, adminUid);
  batch.set(userRef, {
    id: adminUid,
    email: adminEmail.toLowerCase().trim(),
    displayName: adminName || 'Club President',
    status: 'active',
    memberId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  // 4. Admin document
  const adminRef = doc(db, ADMINS_COLLECTION, adminUid);
  batch.set(adminRef, {
    email: adminEmail.toLowerCase().trim(),
    grantedBy: adminUid,
    grantedAt: new Date().toISOString(),
  });

  try {
    await batch.commit();
    await createAuditLog('grant_admin', `Bootstrapped club setup and super-admin roster profile for ${adminEmail}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'settings/club');
  }
}

// ==========================================
// User Directory Subscriptions & Operations
// ==========================================

export function subscribeToUsers(
  onData: (users: UserProfile[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = collection(db, USERS_COLLECTION);
  return onSnapshot(
    q,
    (snap) => {
      const users: UserProfile[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      onData(users);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, USERS_COLLECTION, onError);
    }
  );
}

// ==========================================
// Notifications & 30-Minute Reminder Sweep
// ==========================================

export function subscribeToUserNotifications(
  userId: string,
  onData: (notifs: ClubNotification[]) => void,
  onError?: (err: Error) => void
): () => void {
  const notifsCol = collection(db, 'notifications');
  const q = query(notifsCol, where('userId', '==', userId));

  return onSnapshot(
    q,
    (snap) => {
      const notifs = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as ClubNotification[];
      notifs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      onData(notifs);
    },
    (err) => {
      notifyListenerError(err, OperationType.LIST, 'notifications', onError);
    }
  );
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  try {
    const notifRef = doc(db, 'notifications', notificationId);
    await updateDoc(notifRef, { read: true });
  } catch (err) {
    console.warn('Failed to mark notification read:', err);
  }
}

export async function markAllNotificationsAsRead(userId: string, _notifs?: ClubNotification[]): Promise<void> {
  try {
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      where('read', '==', false)
    );
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.forEach((d) => {
      batch.update(d.ref, { read: true });
    });
    await batch.commit();
  } catch (err) {
    console.warn('Failed to mark all notifications read:', err);
  }
}

export async function dismissNotification(notificationId: string): Promise<void> {
  try {
    const notifRef = doc(db, 'notifications', notificationId);
    await deleteDoc(notifRef);
  } catch (err) {
    console.warn('Failed to dismiss notification:', err);
  }
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    return await Notification.requestPermission();
  }
  return 'denied';
}

export async function checkAndSend30MinuteReminders(): Promise<void> {
  try {
    const sessionsSnap = await getDocs(collection(db, SESSIONS_COLLECTION));
    const now = new Date();

    const upcomingSessions: Session[] = [];
    sessionsSnap.forEach((d) => {
      const s = { id: d.id, ...(d.data() as any) } as Session;
      if (s.status === 'cancelled' || s.status === 'completed') return;
      const temporal = getSessionTemporalInfo(s, now);
      if (temporal.isUpcoming && temporal.diffMinutes > 0 && temporal.diffMinutes <= 35) {
        upcomingSessions.push(s);
      }
    });

    if (upcomingSessions.length === 0) return;

    const usersSnap = await getDocs(
      query(collection(db, USERS_COLLECTION), where('status', '==', 'active'))
    );
    const eligibleUsers: UserProfile[] = [];
    usersSnap.forEach((d) => {
      const u = { id: d.id, ...(d.data() as any) } as UserProfile;
      const prefs = u.notificationPrefs || u.notificationPreferences;
      if (prefs && prefs.enabled !== false && prefs.reminders !== false && prefs.meetingReminders !== false) {
        eligibleUsers.push(u);
      }
    });

    for (const session of upcomingSessions) {
      for (const u of eligibleUsers) {
        const notifId = `reminder_30m_${session.id}_${u.id}`;
        const notifRef = doc(db, 'notifications', notifId);
        const existing = await getDoc(notifRef);
        if (!existing.exists()) {
          const temporal = getSessionTemporalInfo(session, now);
          await setDoc(notifRef, {
            id: notifId,
            userId: u.id,
            title: `⏰ Meeting Starting Soon: ${session.title}`,
            message: `Starting in ~${temporal.diffMinutes}m at ${session.location || 'Den of Builders'}. Get ready to hack!`,
            type: 'meeting_reminder_30m',
            sessionId: session.id,
            sessionDate: session.date,
            sessionTime: session.startTime,
            sessionLocation: session.location,
            read: false,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  } catch (err) {
    console.warn('Failed in checkAndSend30MinuteReminders:', err);
  }
}

// ==========================================
// Self Profile Updates
// ==========================================

export async function updateMemberSelfProfile(
  memberId: string,
  details: {
    name: string;
    email?: string;
    phone?: string;
    studentId?: string;
    university?: string;
    department?: string;
    major?: string;
    semester?: string;
    avatarUrl?: string;
    bio?: string;
    tracks: BuilderTrack[];
    leaderboardOptOut?: boolean;
    githubUrl?: string;
    linkedinUrl?: string;
    portfolioUrl?: string;
    showLinksPublicly?: boolean;
  }
): Promise<{ success: boolean; message?: string }> {
  try {
    let targetMemberId = (memberId || '').trim();
    if (!targetMemberId || targetMemberId === 'undefined' || !targetMemberId.startsWith('mem_')) {
      if (auth.currentUser) {
        const userSnap = await getDoc(doc(db, USERS_COLLECTION, auth.currentUser.uid));
        if (userSnap.exists()) {
          const userData = userSnap.data() as UserProfile;
          if (userData.memberId) {
            targetMemberId = userData.memberId;
          } else if (userData.approvedMemberId) {
            targetMemberId = userData.approvedMemberId;
          }
        }
        if (!targetMemberId || !targetMemberId.startsWith('mem_')) {
          const q = query(
            collection(db, MEMBERS_COLLECTION),
            where('authUid', '==', auth.currentUser.uid),
            limit(1)
          );
          const mSnap = await getDocs(q);
          if (!mSnap.empty) {
            targetMemberId = mSnap.docs[0].id;
          }
        }
      }
    }

    if (!targetMemberId) {
      return { success: false, message: 'No linked builder profile ID found to update.' };
    }

    const memberRef = doc(db, MEMBERS_COLLECTION, targetMemberId);
    const privRef = doc(db, MEMBER_PRIVATE_COLLECTION, targetMemberId);

    // Normalize and strictly validate social & portfolio links with profileLinks.ts
    let canonicalGithub = '';
    if (details.githubUrl && details.githubUrl.trim()) {
      const res = normalizeGitHubUrl(details.githubUrl);
      if (!res.valid || !res.canonicalUrl) {
        return { success: false, message: res.error || 'Invalid GitHub URL format.' };
      }
      canonicalGithub = res.canonicalUrl;
    }

    let canonicalLinkedin = '';
    if (details.linkedinUrl && details.linkedinUrl.trim()) {
      const res = normalizeLinkedInUrl(details.linkedinUrl);
      if (!res.valid || !res.canonicalUrl) {
        return { success: false, message: res.error || 'Invalid LinkedIn URL format.' };
      }
      canonicalLinkedin = res.canonicalUrl;
    }

    let canonicalPortfolio = '';
    if (details.portfolioUrl && details.portfolioUrl.trim()) {
      const res = normalizePortfolioUrl(details.portfolioUrl);
      if (!res.valid) {
        return { success: false, message: res.error || 'Invalid Portfolio URL format.' };
      }
      canonicalPortfolio = res.canonicalUrl || '';
    }

    const safeAvatar = await ensureSafeAvatarUrl(details.avatarUrl);

    // STOP writing studentId and university to members now. Only write whitelisted public fields!
    const memberUpdates: Record<string, any> = {
      name: details.name.trim(),
      avatarUrl: safeAvatar || '',
      bio: details.bio?.trim() || '',
      tracks: details.tracks && details.tracks.length > 0 ? details.tracks : ['Software & Systems'],
      leaderboardOptOut: details.leaderboardOptOut ?? false,
      githubUrl: canonicalGithub,
      linkedinUrl: canonicalLinkedin,
      portfolioUrl: canonicalPortfolio,
      showLinksPublicly: details.showLinksPublicly ?? false,
    };

    const privUpdates: Record<string, any> = {
      profileCompleted: true,
      profileCompletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (details.email?.trim()) privUpdates.email = details.email.trim().toLowerCase();
    if (details.phone?.trim()) privUpdates.phone = details.phone.trim();
    if (details.studentId?.trim()) privUpdates.studentId = details.studentId.trim();
    if (details.university?.trim()) privUpdates.university = details.university.trim();
    if (details.department?.trim()) privUpdates.department = details.department.trim();
    if (details.major?.trim()) privUpdates.major = details.major.trim();
    if (details.semester?.trim()) privUpdates.semester = details.semester.trim();

    // 1. Core Private Profile Update (MemberPrivate stores studentId, phone, department, major, semester)
    await setDoc(privRef, privUpdates, { merge: true });

    // 2. Member & Leaderboard Projection in ONE writeBatch
    const pubRef = doc(db, PUBLIC_LEADERBOARD_COLLECTION, targetMemberId);
    let pubExists = false;
    try {
      const pubSnap = await getDoc(pubRef);
      pubExists = pubSnap.exists();
    } catch (err: any) {
      if (err?.code !== 'not-found') {
        throw err;
      }
    }

    const batch = writeBatch(db);
    batch.update(memberRef, removeUndefinedFields(memberUpdates));

    if (pubExists) {
      if (details.leaderboardOptOut === true) {
        batch.delete(pubRef);
      } else {
        const pubUpdates: Record<string, any> = {
          displayName: details.name.trim(),
          name: details.name.trim(),
          avatar: safeAvatar || '',
          avatarUrl: safeAvatar || '',
          lastUpdated: new Date().toISOString(),
          githubUrl: details.showLinksPublicly ? canonicalGithub : '',
          linkedinUrl: details.showLinksPublicly ? canonicalLinkedin : '',
          portfolioUrl: details.showLinksPublicly ? canonicalPortfolio : '',
          showLinksPublicly: details.showLinksPublicly ?? false,
        };
        batch.update(pubRef, removeUndefinedFields(pubUpdates));
      }
    }

    try {
      await batch.commit();
    } catch (batchErr: any) {
      if (batchErr?.code === 'not-found' && pubExists) {
        // If projection doc was deleted concurrently, update member alone
        await updateDoc(memberRef, removeUndefinedFields(memberUpdates));
      } else {
        // Show permission or schema validation error directly
        throw batchErr;
      }
    }

    // 3. User Document & Auth Display Name Sync
    if (auth.currentUser) {
      try {
        if (safeAvatar !== undefined) {
          await updateProfile(auth.currentUser, {
            displayName: details.name.trim() || auth.currentUser.displayName || undefined,
            photoURL: safeAvatar || '',
          }).catch(() => {});
        }
        const userRef = doc(db, USERS_COLLECTION, auth.currentUser.uid);
        await updateDoc(userRef, {
          photoURL: safeAvatar || '',
          displayName: details.name.trim(),
          updatedAt: new Date().toISOString(),
        }).catch(() => {});
      } catch (authErr) {
        console.warn('Profile sync to auth/users completed with fallback:', authErr);
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error('updateMemberSelfProfile error:', err);
    return { success: false, message: err?.message || 'Failed to update profile' };
  }
}

// ==========================================
// Atomic Check-In Execution & Aliases
// ==========================================

export async function recordCheckInAtomic(
  sessionId: string,
  memberId: string,
  method: CheckInMethod = 'camera_scan',
  notesOrOptions?: string | { token?: string; notes?: string; operatorUid?: string },
  operatorUid?: string
): Promise<{ success: boolean; message: string; record?: CheckInRecord; isDuplicate?: boolean }> {
  const isOptionsObj = typeof notesOrOptions === 'object' && notesOrOptions !== null;
  const resolvedNotes = isOptionsObj ? notesOrOptions.notes : notesOrOptions;
  const resolvedToken = isOptionsObj ? notesOrOptions.token : undefined;
  const resolvedOperatorUid = (isOptionsObj ? notesOrOptions.operatorUid : undefined) || operatorUid;

  // Only explicit manual_entry by an admin routes through recordAdminManualCheckIn.
  // Admin self check-ins (camera_scan / code_input) always take recordSelfCheckIn.
  if (resolvedOperatorUid && method === 'manual_entry') {
    return await recordAdminManualCheckIn(sessionId, memberId, resolvedNotes, resolvedOperatorUid);
  }

  // Create-first: NEVER pre-read checkIns/{sessionId}_{memberId} before attempting write.
  const cleanToken = (resolvedToken || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(cleanToken)) {
    throw new Error('Valid 8-character rotating kiosk QR code or backup code is required for self check-in.');
  }

  const sessionSnap = await getDoc(doc(db, SESSIONS_COLLECTION, sessionId));
  if (!sessionSnap.exists()) {
    throw new Error('Session not found in club directory.');
  }
  const session = { id: sessionId, ...(sessionSnap.data() as any) } as Session;
  return await recordSelfCheckIn(sessionId, memberId, cleanToken, session, method);
}

// Backward-compatible aliases for existing App and component calls
export const subscribeToCheckIns = subscribeToAllCheckIns;

export const updateMemberInFirestore = async (member: Member): Promise<void> => {
  await updateMemberProfile(
    member.id,
    {
      name: member.name,
      avatarUrl: member.avatarUrl,
      bio: member.bio,
      tracks: member.tracks,
      leaderboardOptOut: member.leaderboardOptOut,
      ...(member.githubUrl !== undefined ? { githubUrl: member.githubUrl } : {}),
      ...(member.linkedinUrl !== undefined ? { linkedinUrl: member.linkedinUrl } : {}),
      ...(member.portfolioUrl !== undefined ? { portfolioUrl: member.portfolioUrl } : {}),
      ...(member.showLinksPublicly !== undefined ? { showLinksPublicly: member.showLinksPublicly } : {}),
    },
    {
      email: member.email,
      phone: member.phone,
      studentId: member.studentId?.trim() || undefined,
      university: member.university?.trim() || 'Tongmyong University',
      department: member.department,
      major: member.major,
      semester: member.semester,
    }
  );
};

export const adminDeleteSession = async (sessionId: string, title?: string, permanent = false): Promise<void> => {
  if (permanent) {
    await permanentDeleteSession(sessionId, title);
  } else {
    await softDeleteSession(sessionId, title);
  }
};

export const adminDeleteMember = async (
  memberId: string,
  _name?: string,
  permanent?: boolean,
  options?: { deleteAttendance?: boolean }
): Promise<void> => {
  if (permanent) {
    await permanentDeleteMember(memberId, options);
  } else {
    await deactivateMember(memberId);
  }
};

export const adminDeleteCheckIn = async (
  checkInId: string,
  _memberName?: string,
  _sessionTitle?: string,
  reason = ''
): Promise<void> => {
  await deleteCheckInRecord(checkInId, reason);
};

export const initializeFirestoreWithDefaults = async (
  founder: Member,
  initialSession: Session
): Promise<void> => {
  await setupSuperAdminInitialRoster(
    'Den of Builders',
    DEFAULT_CLUB_TIMEZONE,
    founder.name,
    founder.handle,
    founder.authUid || '',
    founder.email || ''
  );
  try {
    await createSessionInFirestore(initialSession);
  } catch (err) {
    console.warn('Initial session seeding notice:', err);
  }
};

/**
 * Executes a prepared member data repair plan to purge legacy private PII from public member documents
 * and sync it safely to memberPrivate. Batched in chunks of at most 200 items (400 ops).
 */
export async function executeMemberDataRepair(items: MemberDataRepairItem[]): Promise<number> {
  let modifiedCount = 0;
  const chunkSize = 200;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const item of chunk) {
      const memberRef = doc(db, MEMBERS_COLLECTION, item.memberId);
      batch.set(memberRef, item.cleanedPublicData);
      if (Object.keys(item.privateFieldsToSet).length > 0) {
        const privRef = doc(db, MEMBER_PRIVATE_COLLECTION, item.memberId);
        batch.set(privRef, item.privateFieldsToSet, { merge: true });
      }
      modifiedCount++;
    }
    await batch.commit();
  }
  await createAuditLog('member_data_repair', `Executed member data repair on ${modifiedCount} documents to purge private fields`);
  return modifiedCount;
}

/**
 * Executes a prepared user state repair plan to align inconsistent user accounts
 * with their authoritative roster documents. Batched in chunks of at most 400 writes.
 */
export async function executeUserStateRepair(items: UserStateRepairItem[]): Promise<number> {
  let modifiedCount = 0;
  const chunkSize = 400;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const item of chunk) {
      const userRef = doc(db, USERS_COLLECTION, item.userId);
      const updates: Record<string, any> = {
        status: item.proposedStatus,
        updatedAt: new Date().toISOString(),
      };
      if (item.proposedMemberId === null) {
        updates.memberId = deleteField();
      } else if (item.proposedMemberId !== undefined) {
        updates.memberId = item.proposedMemberId;
      }
      if (item.proposedApprovedMemberId === null) {
        updates.approvedMemberId = deleteField();
      } else if (item.proposedApprovedMemberId !== undefined) {
        updates.approvedMemberId = item.proposedApprovedMemberId;
      }
      batch.update(userRef, updates);
      modifiedCount++;
    }
    await batch.commit();
  }
  await createAuditLog('user_state_repair', `Executed user state repair on ${modifiedCount} user documents`);
  return modifiedCount;
}

/**
 * Executes a prepared legacy session migration plan (idempotent backfill of startAt, endAt,
 * checkInMode, openMinutesBefore, graceMinutesAfter, lateAfterMinutes, host, timezone, points).
 * Batched in chunks of up to 400 writes and logged cleanly to auditLogs.
 */
export async function executeSessionMigration(items: SessionMigrationItem[]): Promise<number> {
  let modifiedCount = 0;
  const chunkSize = 400;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const item of chunk) {
      const sessionRef = doc(db, SESSIONS_COLLECTION, item.sessionId);
      batch.set(sessionRef, removeUndefinedFields(item.migratedDoc), { merge: true });
      modifiedCount++;
    }
    await batch.commit();
  }
  await createAuditLog('update_session', `Executed legacy session migration on ${modifiedCount} session document(s)`);
  return modifiedCount;
}

