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
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './config';
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

export { SUPER_ADMIN_EMAIL };

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
      console.warn('Audit logs subscription error:', error);
      onError?.(error);
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
      handleFirestoreError(err, OperationType.LIST, ADMINS_COLLECTION);
      onError?.(err);
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
      return snap.data() as UserProfile;
    }

    const newProfile: UserProfile = {
      id: uid,
      email: email.trim().toLowerCase(),
      displayName: displayName || 'Club Builder',
      photoURL: photoURL || '',
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
      handleFirestoreError(err, OperationType.GET, `users/${uid}`);
      onError?.(err);
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
      const list = snap.docs.map((d) => d.data() as UserProfile);
      onUpdate(list);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, USERS_COLLECTION);
      onError?.(err);
    }
  );
}

export async function reRequestMembership(uid: string, requestedNotes?: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, uid);
  try {
    await updateDoc(userRef, {
      status: 'pending',
      requestedNotes: requestedNotes || '',
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
    await updateDoc(userRef, removeUndefinedFields({
      ...updates,
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

export async function requestMembershipLink(userId: string, requestedNotes?: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  try {
    await updateDoc(userRef, {
      status: 'pending',
      requestedNotes: requestedNotes || '',
      membershipRequestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
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
  if (memSnap.exists()) {
    const existingMem = memSnap.data() as Member;
    if (existingMem.authUid && existingMem.authUid !== userId) {
      throw new Error(`Member record is already linked to another account.`);
    }
  }

  const userRef = doc(db, USERS_COLLECTION, userId);
  try {
    await updateDoc(userRef, {
      status: 'approved_waiting_response',
      approvedMemberId: targetMemberId,
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await createAuditLog(
      'approve_user',
      `Admin approved membership request for user ${userId} waiting for applicant acceptance (staged member: ${targetMemberId})`
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
  const memberSnap = await getDoc(memberRef);

  if (memberSnap.exists()) {
    const memData = memberSnap.data() as Member;
    if (memData.authUid && memData.authUid !== userId) {
      throw new Error('Member record is already linked to another account.');
    }
  }

  const batch = writeBatch(db);
  batch.update(userRef, {
    status: 'active',
    memberId: memberId,
    respondedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (memberSnap.exists()) {
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

export async function declineUserRequest(userId: string): Promise<void> {
  const userRef = doc(db, USERS_COLLECTION, userId);
  try {
    await updateDoc(userRef, {
      status: 'declined',
      updatedAt: new Date().toISOString(),
    });
    await createAuditLog('decline_user', `Declined applicant request for user ${userId}`);
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
      handleFirestoreError(err, OperationType.LIST, MEMBERS_COLLECTION);
      onError?.(err);
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

  // Check unique handle
  const cleanHandle = publicData.handle.trim();
  const qHandle = query(collection(db, MEMBERS_COLLECTION), where('handle', '==', cleanHandle));
  const snapHandle = await getDocs(qHandle);
  if (!snapHandle.empty) {
    throw new Error(`Builder handle "${cleanHandle}" is already in use.`);
  }

  const memberId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
  const privRef = doc(db, MEMBER_PRIVATE_COLLECTION, memberId);

  const batch = writeBatch(db);

  const defaultUni = publicData.university?.trim() || privateData?.university?.trim() || 'Tongmyong University';
  const finalPublic: Member = removeUndefinedFields({
    ...publicData,
    id: memberId,
    name: publicData.name.trim(),
    handle: cleanHandle,
    studentId: publicData.studentId?.trim() || privateData?.studentId?.trim() || undefined,
    university: defaultUni,
    createdAt: new Date().toISOString(),
  });
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
    batch.update(memberRef, removeUndefinedFields(publicUpdates));
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

export async function permanentDeleteMember(memberId: string, linkedAuthUid?: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, MEMBERS_COLLECTION, memberId));
  batch.delete(doc(db, MEMBER_PRIVATE_COLLECTION, memberId));
  batch.delete(doc(db, PUBLIC_LEADERBOARD_COLLECTION, memberId));

  if (linkedAuthUid) {
    batch.update(doc(db, USERS_COLLECTION, linkedAuthUid), {
      status: 'declined',
      memberId: null as any,
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    await batch.commit();
    await createAuditLog('delete_member', `Permanently deleted member ${memberId}`);
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
      handleFirestoreError(err, OperationType.LIST, SESSIONS_COLLECTION);
      onError?.(err);
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
  onUpdate: (data: { token: string; prevToken: string; rotatedAt?: Timestamp } | null) => void
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
      console.warn('Session token listener warning:', err);
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
      handleFirestoreError(err, OperationType.LIST, CHECKINS_COLLECTION);
      onError?.(err);
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
      handleFirestoreError(err, OperationType.LIST, CHECKINS_COLLECTION);
      onError?.(err);
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
      handleFirestoreError(err, OperationType.LIST, ANNOUNCEMENTS_COLLECTION);
      onError?.(err);
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
      console.warn('Public leaderboard listener warning:', err);
      onError?.(err);
    }
  );
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
    batch.set(itemRef, item);
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
      handleFirestoreError(err, OperationType.LIST, USERS_COLLECTION);
      onError?.(err);
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
      console.warn('Notifications subscription warning:', err);
      onError?.(err);
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
    university?: string;
    department?: string;
    major?: string;
    semester?: string;
    avatarUrl?: string;
    bio?: string;
    tracks: BuilderTrack[];
  }
): Promise<{ success: boolean; message?: string }> {
  try {
    const memberRef = doc(db, MEMBERS_COLLECTION, memberId);
    const privRef = doc(db, MEMBER_PRIVATE_COLLECTION, memberId);
    const batch = writeBatch(db);

    batch.update(memberRef, removeUndefinedFields({
      name: details.name,
      avatarUrl: details.avatarUrl || '',
      bio: details.bio || '',
      tracks: details.tracks,
    }));

    batch.set(privRef, removeUndefinedFields({
      email: details.email,
      phone: details.phone,
      university: details.university,
      department: details.department,
      major: details.major,
      semester: details.semester,
    }), { merge: true });

    await batch.commit();
    return { success: true };
  } catch (err: any) {
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
    },
    {
      email: member.email,
      phone: member.phone,
      university: member.university,
      department: member.department,
      major: member.major,
      semester: member.semester,
    }
  );
};

export const addSessionToFirestore = createSessionInFirestore;

export const adminDeleteSession = async (sessionId: string, _title?: string, _permanent?: boolean): Promise<void> => {
  await deleteSession(sessionId);
};

export const adminDeleteMember = async (memberId: string, _name?: string, permanent?: boolean): Promise<void> => {
  if (permanent) {
    await permanentDeleteMember(memberId);
  } else {
    await deactivateMember(memberId);
  }
};

export const adminDeleteCheckIn = async (checkInId: string, _memberName?: string, _sessionTitle?: string): Promise<void> => {
  await deleteCheckInRecord(checkInId);
};

export const deleteCheckInFromFirestore = deleteCheckInRecord;

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

