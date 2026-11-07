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
import { buildPublicLeaderboardItems } from '../utils/stats';
import { getSessionState, getSessionTemporalInfo, parseDateTimeInZone } from '../utils/sessionWindow';
import { processProfilePhoto } from '../utils/imageUtils';
import { isHandleTaken, isStudentIdTaken, archiveHandle } from '../utils/reuseHelpers';

export { SUPER_ADMIN_EMAIL };

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
    timestamp: new Date().toISOString(),
  };

  try {
    await setDoc(logRef, entry);
  } catch (err) {
    console.warn('Failed to write audit log entry:', err);
  }
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
    return true;
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
  if (!currentUser || currentUser.email?.toLowerCase().trim() !== SUPER_ADMIN_EMAIL.toLowerCase().trim()) {
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
  if (!currentUser || currentUser.email?.toLowerCase().trim() !== SUPER_ADMIN_EMAIL.toLowerCase().trim()) {
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
    const safePhoto = await ensureSafeAvatarUrl(photoURL);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      if (safePhoto && !existing.photoURL) {
        updateDoc(userRef, { photoURL: safePhoto, updatedAt: new Date().toISOString() }).catch(() => {});
        existing.photoURL = safePhoto;
      }
      return existing;
    }

    const newProfile: UserProfile = {
      id: uid,
      email: email.trim().toLowerCase(),
      displayName: displayName || 'Club Builder',
      photoURL: safePhoto || '',
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

    await setDoc(userRef, newProfile);
    return newProfile;
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

export async function reRequestMembership(uid: string, requestedNotes?: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, uid);
  try {
    await updateDoc(userRef, {
      status: 'pending',
      requestedNotes: requestedNotes || '',
      membershipRequestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
  const memberRef = doc(db, MEMBERS_COLLECTION, targetMemberId);
  const memSnap = await getDoc(memberRef);
  let memberName = 'Builder Profile';
  let shouldReactivate = false;

  if (memSnap.exists()) {
    const existingMem = memSnap.data() as Member;
    memberName = existingMem.name;
    if (existingMem.authUid && existingMem.authUid !== userId) {
      throw new Error(`Member record is already linked to another account.`);
    }
    if (existingMem.status === 'Inactive') {
      shouldReactivate = true;
    }
  }

  const batch = writeBatch(db);
  if (shouldReactivate) {
    batch.update(memberRef, { status: 'Active' });
  }

  const userRef = doc(db, USERS_COLLECTION, userId);
  batch.update(userRef, {
    status: 'approved_waiting_response',
    approvedMemberId: targetMemberId,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await batch.commit();
    await createAuditLog(
      'approve_user',
      `Admin approved membership request for user ${userId} waiting for applicant acceptance (staged member: ${targetMemberId} - ${memberName}${shouldReactivate ? ' [Reactivated]' : ''})`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
}

/**
 * Stage 2A: Applicant accepts the membership invitation.
 * Activates user status to 'active', links memberId, and binds authUid to member record.
 */
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
    // Non-fatal pre-read: Firestore security rules validate authUid during atomic batch commit
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
    await createAuditLog('update_member', `Applicant ${userId} accepted membership invitation for member ${memberId}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${userId}`);
  }
}

/**
 * Stage 2B: Applicant declines the membership invitation.
 * Updates user status to 'declined'. Leaves roster record unlinked.
 */
export async function declineMembershipInvitation(userId: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  try {
    await updateDoc(userRef, {
      status: 'declined',
      respondedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await createAuditLog('decline_user', `Applicant ${userId} declined membership invitation`);
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
    const memberRef = doc(db, MEMBERS_COLLECTION, targetMemberId);
    const memberDocData: Member = {
      id: targetMemberId,
      name: newMemberData.name.trim(),
      handle: newMemberData.handle.trim(),
      role: newMemberData.role,
      tracks: newMemberData.tracks,
      joinedDate: new Date().toISOString().split('T')[0],
      status: 'Active',
      createdAt: new Date().toISOString(),
    };
    await setDoc(memberRef, memberDocData);
    if (newMemberData.email) {
      const privRef = doc(db, MEMBER_PRIVATE_COLLECTION, targetMemberId);
      await setDoc(privRef, { email: newMemberData.email.trim().toLowerCase() });
    }
  }
  await approveUserMembershipLink(userId, targetMemberId);
}

export async function directActivateUserMembership(
  userId: string,
  targetMemberId: string
): Promise<void> {
  if (!userId) throw new Error('User ID is required.');
  if (!targetMemberId) throw new Error('Target member ID is required.');

  const memberRef = doc(db, MEMBERS_COLLECTION, targetMemberId);
  const memSnap = await getDoc(memberRef);
  if (!memSnap.exists()) {
    throw new Error('Target member record not found in roster.');
  }

  const existingMem = memSnap.data() as Member;
  if (existingMem.authUid && existingMem.authUid !== userId) {
    throw new Error('Member record is already linked to another account.');
  }

  const userRef = doc(db, USERS_COLLECTION, userId);
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

  batch.update(memberRef, {
    authUid: userId,
  });

  try {
    await batch.commit();
    await createAuditLog(
      'approve_user',
      `Admin directly activated member link for user ${userId} to member ${targetMemberId}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${userId}`);
  }
}

export async function declineUserRequest(userId: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  const batch = writeBatch(db);
  batch.update(userRef, {
    status: 'declined',
    approvedMemberId: deleteField(),
    updatedAt: new Date().toISOString(),
  });

  const currentUser = auth.currentUser;
  if (currentUser) {
    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const logRef = doc(db, AUDIT_LOGS_COLLECTION, logId);
    batch.set(logRef, {
      id: logId,
      action: 'decline_user',
      performedBy: currentUser.uid,
      performedByEmail: currentUser.email || 'unknown',
      details: `Declined applicant request for user ${userId}`,
      timestamp: new Date().toISOString(),
    });
  }

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
  try {
    await updateDoc(userRef, {
      status: 'active',
      updatedAt: new Date().toISOString(),
    });
    await createAuditLog('unsuspend_user', `Unsuspended user ${userId}`);
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
  const finalPublic: Member = removeUndefinedFields({
    ...publicData,
    avatarUrl: safeAvatar,
    id: memberId,
    name: publicData.name.trim(),
    handle: cleanHandle,
    studentId: publicData.studentId?.trim() || privateData?.studentId?.trim() || undefined,
    university: defaultUni,
    authUid: rawAuthUid || undefined,
    createdAt: new Date().toISOString(),
  });
  if (!finalPublic.authUid) {
    delete (finalPublic as any).authUid;
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
  publicUpdates: Partial<Pick<Member, 'name' | 'avatarUrl' | 'bio' | 'tracks' | 'leaderboardOptOut' | 'studentId' | 'university'>>,
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
    if (cleanPublicUpdates.leaderboardOptOut === true) {
      batch.delete(pubRef);
    } else if (cleanPublicUpdates.name || cleanPublicUpdates.avatarUrl !== undefined) {
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
  try {
    await updateDoc(memberRef, { status: 'Inactive' });
    await createAuditLog('deactivate_member', `Deactivated builder ${memberId}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `members/${memberId}`);
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
      timestamp: new Date().toISOString(),
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
  sessionData: Omit<Session, 'id' | 'createdAt'>
): Promise<string> {
  const tz = sessionData.timezone || DEFAULT_CLUB_TIMEZONE;
  let startAt = sessionData.startAt;
  let endAt = sessionData.endAt;

  if (!startAt && sessionData.date && sessionData.startTime) {
    startAt = Timestamp.fromDate(parseDateTimeInZone(sessionData.date, sessionData.startTime, tz));
  }
  if (!endAt && sessionData.date && sessionData.endTime) {
    endAt = Timestamp.fromDate(parseDateTimeInZone(sessionData.date, sessionData.endTime, tz));
  }

  const startMs = (startAt as Timestamp)?.toMillis ? (startAt as Timestamp).toMillis() : new Date((startAt as any) || Date.now()).getTime();
  const endMs = (endAt as Timestamp)?.toMillis ? (endAt as Timestamp).toMillis() : new Date((endAt as any) || Date.now() + 7200000).getTime();

  if (endMs <= startMs) {
    throw new Error('Session end time must be strictly after start time.');
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);

  const finalSession: Session = removeUndefinedFields({
    ...sessionData,
    startAt,
    endAt,
    timezone: tz,
    id: sessionId,
    createdAt: new Date().toISOString(),
  });

  const announcementId = `ann_${sessionId}_pub`;
  const announcementRef = doc(db, ANNOUNCEMENTS_COLLECTION, announcementId);
  const announcement: Announcement = {
    id: announcementId,
    type: 'session_published',
    sessionId,
    title: `New Session: ${finalSession.title}`,
    message: `${finalSession.title} (${finalSession.track}) scheduled for ${finalSession.date} at ${finalSession.location}.`,
    createdAt: new Date().toISOString(),
    createdBy: finalSession.createdBy || 'admin',
  };

  const batch = writeBatch(db);
  batch.set(sessionRef, finalSession);
  batch.set(announcementRef, announcement);

  try {
    await batch.commit();
    await createAuditLog('create_session', `Scheduled new session "${finalSession.title}" (${sessionId})`);
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
  const finalUpdates = typeof sessionIdOrSession === 'string' ? (updates || {}) : sessionIdOrSession;

  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);

  const cleaned: any = removeUndefinedFields(finalUpdates);
  const tz = cleaned.timezone || DEFAULT_CLUB_TIMEZONE;
  cleaned.timezone = tz;

  if (cleaned.date && cleaned.startTime) {
    cleaned.startAt = Timestamp.fromDate(parseDateTimeInZone(cleaned.date, cleaned.startTime, tz));
  }
  if (cleaned.date && cleaned.endTime) {
    cleaned.endAt = Timestamp.fromDate(parseDateTimeInZone(cleaned.date, cleaned.endTime, tz));
  }

  try {
    await updateDoc(sessionRef, cleaned);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }

  if (isRescheduled) {
    try {
      const annId = `ann_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
      const announcement: Announcement = {
        id: annId,
        type: 'session_rescheduled',
        sessionId,
        title: `Rescheduled: ${finalUpdates.title || 'Session'}`,
        message: `The session schedule has been updated to ${finalUpdates.date || ''} at ${finalUpdates.location || ''}.`,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.uid || 'admin',
      };
      await setDoc(doc(db, ANNOUNCEMENTS_COLLECTION, annId), announcement);
    } catch (annErr) {
      console.warn('Non-fatal: Rescheduled announcement could not be dispatched:', annErr);
    }
  }

  try {
    await createAuditLog('update_session', `Updated session ${sessionId}`);
  } catch (auditErr) {
    console.warn('Non-fatal: Could not write session update audit log:', auditErr);
  }
}

export async function setSessionCheckInMode(
  sessionId: string,
  mode: Session['checkInMode']
): Promise<void> {
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  try {
    await updateDoc(sessionRef, { checkInMode: mode });
    await createAuditLog('session_open_close', `Set session ${sessionId} check-in mode to ${mode}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function completeSession(sessionId: string): Promise<void> {
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  try {
    await updateDoc(sessionRef, {
      status: 'completed',
      checkInMode: 'closed',
    });
    await createAuditLog('complete_session', `Marked session ${sessionId} as completed`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function cancelSession(sessionId: string, sessionTitle: string): Promise<void> {
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  const annId = `ann_${sessionId}_cancel_${Date.now()}`;
  const announcement: Announcement = {
    id: annId,
    type: 'session_cancelled',
    sessionId,
    title: `Cancelled: ${sessionTitle}`,
    message: `The session "${sessionTitle}" has been cancelled.`,
    createdAt: new Date().toISOString(),
    createdBy: auth.currentUser?.uid || 'admin',
  };

  const batch = writeBatch(db);
  batch.update(sessionRef, { status: 'cancelled', checkInMode: 'closed' });
  batch.set(doc(db, ANNOUNCEMENTS_COLLECTION, annId), announcement);

  try {
    await batch.commit();
    await createAuditLog('cancel_session', `Cancelled session ${sessionId}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const sessionRef = doc(db, SESSIONS_COLLECTION, sessionId);
  try {
    await deleteDoc(sessionRef);
    await createAuditLog('delete_session', `Deleted session ${sessionId}`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `sessions/${sessionId}`);
  }
}

// ==========================================
// Rotating Kiosk Tokens (sessionTokens/{sessionId})
// ==========================================

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

  const checkInId = `${sessionId}_${memberId}`;
  const checkInRef = doc(db, CHECKINS_COLLECTION, checkInId);

  // Check if check-in already recorded
  const existingSnap = await getDoc(checkInRef);
  if (existingSnap.exists()) {
    return {
      success: true,
      message: 'You are already checked in for this session!',
      record: existingSnap.data() as CheckInRecord,
      isDuplicate: true,
    };
  }

  const state = getSessionState(session);
  if (state.phase !== 'open') {
    throw new Error(
      state.phase === 'upcoming'
        ? `Check-in is not open yet. Opens at ${state.opensAt.toLocaleTimeString()}.`
        : `Check-in for this session is closed.`
    );
  }

  const status: CheckInStatus = state.isLate() ? 'late' : 'present';
  const monthKey = session.date.substring(0, 7);

  const newRecord: CheckInRecord = {
    id: checkInId,
    sessionId,
    memberId,
    authUid: currentUser.uid,
    method,
    token: token.trim().toUpperCase(),
    checkedInAt: serverTimestamp() as any,
    status,
    monthKey,
  };

  try {
    await setDoc(checkInRef, newRecord);
    syncMemberCheckInToPublicLeaderboard(memberId, monthKey, session.points ?? 10).catch(() => {});
    return {
      success: true,
      message: status === 'late' ? 'Check-in recorded (marked late).' : 'Check-in verified successfully!',
      record: {
        ...newRecord,
        checkedInAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `checkIns/${checkInId}`);
  }
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

  const checkInId = `${sessionId}_${memberId}`;
  const checkInRef = doc(db, CHECKINS_COLLECTION, checkInId);

  const existingSnap = await getDoc(checkInRef);
  if (existingSnap.exists()) {
    return {
      success: true,
      message: 'Member is already checked in for this session.',
      record: existingSnap.data() as CheckInRecord,
      isDuplicate: true,
    };
  }

  let session: Session | null = null;
  let notes: string | undefined = undefined;

  if (typeof sessionOrNotes === 'string') {
    notes = sessionOrNotes;
  } else if (sessionOrNotes && typeof sessionOrNotes === 'object') {
    session = sessionOrNotes;
    notes = notesOrOperator;
  }

  if (!session) {
    const sDoc = await getDoc(doc(db, SESSIONS_COLLECTION, sessionId));
    if (sDoc.exists()) {
      session = { id: sessionId, ...(sDoc.data() as any) } as Session;
    }
  }

  const isLateCheck = session ? getSessionState(session).isLate() : false;
  const status: CheckInStatus = isLateCheck ? 'late' : 'present';
  const monthKey = session?.date ? session.date.substring(0, 7) : new Date().toISOString().substring(0, 7);

  const newRecord: CheckInRecord = {
    id: checkInId,
    sessionId,
    memberId,
    authUid: currentUser.uid,
    method: 'manual_entry',
    checkedInAt: new Date().toISOString(),
    status,
    monthKey,
    notes,
    verifiedBy: currentUser.uid,
  };

  try {
    await setDoc(checkInRef, removeUndefinedFields(newRecord));
    syncMemberCheckInToPublicLeaderboard(memberId, monthKey, session?.points ?? 10).catch(() => {});
    await createAuditLog('check_in_manual', `Admin checked in member ${memberId} for session ${sessionId}`);
    return {
      success: true,
      message: 'Manual check-in confirmed.',
      record: newRecord,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `checkIns/${checkInId}`);
  }
}

export async function deleteCheckInRecord(checkInId: string): Promise<void> {
  const checkInRef = doc(db, CHECKINS_COLLECTION, checkInId);
  try {
    await deleteDoc(checkInRef);
    await createAuditLog('delete_check_in', `Deleted attendance check-in record ${checkInId}`);
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
  monthKey: string,
  pointsAwarded: number = 10
): Promise<void> {
  try {
    const memberDoc = await getDoc(doc(db, MEMBERS_COLLECTION, memberId));
    if (!memberDoc.exists()) return;
    const member = memberDoc.data() as Member;
    if (member.status === 'Inactive' || member.leaderboardOptOut) {
      // Opted out or inactive: ensure not in publicLeaderboard
      await deleteDoc(doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId));
      return;
    }

    const pubRef = doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId);
    const pubSnap = await getDoc(pubRef);
    if (pubSnap.exists()) {
      const existing = pubSnap.data() as PublicLeaderboardItem;
      const currentMonthly = existing.monthlyCheckIns || {};
      const newMonthly = {
        ...currentMonthly,
        [monthKey]: (currentMonthly[monthKey] || 0) + 1,
      };
      const newTotalPts = (existing.totalPoints || existing.points || 0) + pointsAwarded;
      const newTotalCheckIns = (existing.totalCheckIns || 0) + 1;
      const newStreak = (existing.currentStreak || 0) + 1;
      const newBestStreak = Math.max(existing.bestStreak || 0, newStreak);

      await updateDoc(pubRef, {
        totalCheckIns: newTotalCheckIns,
        points: newTotalPts,
        totalPoints: newTotalPts,
        currentStreak: newStreak,
        bestStreak: newBestStreak,
        monthlyCheckIns: newMonthly,
        displayName: member.name,
        name: member.name,
        handle: member.handle,
        avatar: member.avatarUrl || '',
        avatarUrl: member.avatarUrl || '',
        lastUpdated: new Date().toISOString(),
      });
    } else {
      const newEntry: PublicLeaderboardItem = {
        id: memberId,
        name: member.name,
        displayName: member.name,
        handle: member.handle,
        role: member.role,
        avatarUrl: member.avatarUrl || '',
        avatar: member.avatarUrl || '',
        tracks: member.tracks || [],
        totalCheckIns: 1,
        currentStreak: 1,
        bestStreak: 1,
        points: pointsAwarded,
        totalPoints: pointsAwarded,
        monthlyCheckIns: { [monthKey]: 1 },
        lastUpdated: new Date().toISOString(),
      };
      await setDoc(pubRef, removeUndefinedFields(newEntry));
    }
  } catch (err) {
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

export async function backfillPublicLeaderboard(): Promise<{ totalBackfilled: number; totalRemoved: number }> {
  try {
    const [membersSnap, sessionsSnap, checkInsSnap] = await Promise.all([
      getDocs(collection(db, MEMBERS_COLLECTION)),
      getDocs(collection(db, SESSIONS_COLLECTION)),
      getDocs(collection(db, CHECKINS_COLLECTION)),
    ]);

    const members = membersSnap.docs.map((d) => d.data() as Member);
    const sessions = sessionsSnap.docs.map((d) => d.data() as Session);
    const checkIns = checkInsSnap.docs.map((d) => d.data() as CheckInRecord);

    const items = buildPublicLeaderboardItems(members, sessions, checkIns);
    const batch = writeBatch(db);

    const activeOptedInIds = new Set<string>();
    for (const item of items) {
      activeOptedInIds.add(item.id);
      const pubRef = doc(db, PUBLIC_LEADERBOARD_COLLECTION, item.id);
      batch.set(pubRef, removeUndefinedFields(item));
    }

    // Prune any member docs in publicLeaderboard who are inactive or opted out
    const currentPubSnap = await getDocs(collection(db, PUBLIC_LEADERBOARD_COLLECTION));
    let totalRemoved = 0;
    currentPubSnap.docs.forEach((d) => {
      if (!activeOptedInIds.has(d.id)) {
        batch.delete(d.ref);
        totalRemoved++;
      }
    });

    await batch.commit();
    await createAuditLog('recompute_leaderboard', `Backfilled ${items.length} builders and pruned ${totalRemoved} opted-out/inactive profiles`);
    return { totalBackfilled: items.length, totalRemoved };
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
  const items = buildPublicLeaderboardItems(members, sessions, checkIns);
  const batch = writeBatch(db);

  for (const item of items) {
    const itemRef = doc(db, PUBLIC_LEADERBOARD_COLLECTION, item.id);
    batch.set(itemRef, removeUndefinedFields(item));
  }

  try {
    await batch.commit();
    await createAuditLog('recompute_leaderboard', `Refreshed public leaderboard rankings for ${items.length} builders`);
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

  if (!currentUserEmail || currentUserEmail !== superAdminEmail) {
    throw new Error(
      `Permission denied: Only the Super Administrator (${SUPER_ADMIN_EMAIL}) may export database backups.`
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

    const safeAvatar = await ensureSafeAvatarUrl(details.avatarUrl);

    const memberUpdates: Record<string, any> = {
      name: details.name.trim(),
      avatarUrl: safeAvatar || '',
      bio: details.bio?.trim() || '',
      tracks: details.tracks && details.tracks.length > 0 ? details.tracks : ['Software & Systems'],
      leaderboardOptOut: details.leaderboardOptOut ?? false,
    };
    if (details.studentId?.trim()) {
      memberUpdates.studentId = details.studentId.trim();
    }
    if (details.university?.trim()) {
      memberUpdates.university = details.university.trim();
    }

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

    // 1. Core Profile Update (Member + MemberPrivate)
    const batch = writeBatch(db);
    batch.update(memberRef, memberUpdates);
    batch.set(privRef, privUpdates, { merge: true });
    await batch.commit();

    // 2. Safe Public Leaderboard Sync (Active members can only update existing docs; creation is admin-only)
    try {
      const pubRef = doc(db, PUBLIC_LEADERBOARD_COLLECTION, targetMemberId);
      const pubSnap = await getDoc(pubRef);
      if (pubSnap.exists()) {
        if (details.leaderboardOptOut === true) {
          await deleteDoc(pubRef).catch(() => {});
        } else {
          await updateDoc(pubRef, removeUndefinedFields({
            displayName: details.name.trim(),
            name: details.name.trim(),
            avatar: safeAvatar || '',
            avatarUrl: safeAvatar || '',
            lastUpdated: new Date().toISOString(),
          })).catch(() => {});
        }
      }
    } catch (pubErr) {
      console.warn('Public leaderboard display sync notice:', pubErr);
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
  notes?: string,
  operatorUid?: string
): Promise<{ success: boolean; message: string; record?: CheckInRecord; isDuplicate?: boolean }> {
  if (operatorUid) {
    return await recordAdminManualCheckIn(sessionId, memberId, notes, operatorUid);
  }

  const checkInId = `${sessionId}_${memberId}`;
  const checkInRef = doc(db, CHECKINS_COLLECTION, checkInId);
  const snap = await getDoc(checkInRef);
  if (snap.exists()) {
    return {
      success: true,
      message: 'You are already checked in for this session!',
      record: snap.data() as CheckInRecord,
      isDuplicate: true,
    };
  }

  const sessionSnap = await getDoc(doc(db, SESSIONS_COLLECTION, sessionId));
  if (!sessionSnap.exists()) {
    throw new Error('Session not found in club directory.');
  }
  const session = { id: sessionId, ...(sessionSnap.data() as any) } as Session;
  return await recordSelfCheckIn(sessionId, memberId, 'DIRECT_VERIFIED', session, method);
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
      studentId: member.studentId?.trim() || undefined,
      university: member.university?.trim() || 'Tongmyong University',
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

export const adminDeleteSession = async (sessionId: string, _title?: string, _permanent?: boolean): Promise<void> => {
  await deleteSession(sessionId);
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

export const adminDeleteCheckIn = async (checkInId: string, _memberName?: string, _sessionTitle?: string): Promise<void> => {
  await deleteCheckInRecord(checkInId);
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
    founder.email || 'rahatmdmahadihasan@gmail.com'
  );
  try {
    await createSessionInFirestore(initialSession);
  } catch (err) {
    console.warn('Initial session seeding notice:', err);
  }
};

