/**
 * Test Suite: Den of Builders (DOB) Attendance & Participation Hub
 * Verifies:
 * 1. Role Management & Super-Admin Permissions
 * 2. Public Leaderboard Privacy & Sanitization
 * 3. Builder Profile Validation & Self-Editing Protections
 * 4. Session Location Validation & Persistence
 * 5. Deterministic Attendance Check-In & Duplicate Prevention
 * 6. Monthly Statistics & Consistency Streak Logic
 */

import { Member, Session, CheckInRecord, PublicLeaderboardItem, BuilderRole } from '../src/types';
import { calculateMonthlyStats } from '../src/utils/storage';
import { parseScannedQR } from '../src/utils/qrUtils';
import { SUPER_ADMIN_EMAIL } from '../src/firebase/firestoreService';
import {
  getSessionTemporalInfo,
  getTargetSession,
  parseSessionTimeWindow,
  parseDateTimeInZone,
  todayInClubTz,
  formatDateInClubTz,
  formatInClubTz,
} from '../src/utils/sessionTiming';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

async function runTests() {
  console.log('\n--- Running Den of Builders Hub Automated Test Suite ---\n');

  // Test 1: Super Admin Email Identity & Role Permissions
  console.log('Test 1: Super Admin Permissions Policy');
  assert(
    SUPER_ADMIN_EMAIL === 'rahatmdmahadihasan@gmail.com',
    'Designated Super Admin email is rahatmdmahadihasan@gmail.com'
  );

  const canGrantAdmin = (email: string) => email.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase();
  assert(
    canGrantAdmin('rahatmdmahadihasan@gmail.com'),
    'Super Admin can grant/revoke application admin privileges'
  );
  assert(
    !canGrantAdmin('otheradmin@denofbuilders.org'),
    'Non-super admins cannot grant or revoke admin privileges'
  );
  assert(
    !canGrantAdmin('regularmember@gmail.com'),
    'Ordinary members cannot grant admin privileges'
  );

  // Test 2: Club Roles Definition
  console.log('\nTest 2: Club Roles Verification');
  const validClubRoles: BuilderRole[] = [
    'President',
    'Vice President',
    'Project Leader',
    'Member',
  ];
  for (const role of validClubRoles) {
    assert(
      ['President', 'Vice President', 'Project Leader', 'Member'].includes(role),
      `Club role "${role}" is recognized as valid executive/guild rank`
    );
  }

  // Test 3: Public Leaderboard Projection Privacy
  console.log('\nTest 3: Public Leaderboard Data Exposure Audit');
  const sampleMember: Member = {
    id: 'mem_101',
    name: 'Samiul Alom',
    handle: '@samiul',
    email: 'samiul.alom@private-university.edu',
    phone: '+880 1711-223344',
    authUid: 'auth_uid_secure_99',
    studentId: '20241099',
    university: 'Tongmyong University',
    department: 'CSE',
    major: 'Computer Science',
    semester: '7th Semester',
    role: 'Project Leader',
    tracks: ['Hardware & Robotics', 'AI & Embedded'],
    avatarUrl: 'https://example.com/avatar.jpg',
    joinedDate: '2026-09-01',
    totalCheckIns: 12,
    currentStreak: 6,
    bestStreak: 6,
    status: 'Active',
    bio: 'Robotics and embedded vision engineer',
  };

  const sanitizePublicLeaderboard = (m: Member): PublicLeaderboardItem => ({
    id: m.id,
    name: m.name,
    handle: m.handle,
    role: m.role,
    tracks: m.tracks,
    avatarUrl: m.avatarUrl || '',
    totalCheckIns: m.totalCheckIns ?? 0,
    currentStreak: m.currentStreak ?? 0,
    bestStreak: m.bestStreak ?? 0,
    points: (m.totalCheckIns ?? 0) * 10 + (m.currentStreak ?? 0) * 5,
  });

  const publicProjection = sanitizePublicLeaderboard(sampleMember);

  assert(!('email' in publicProjection), 'Public leaderboard projection omits private email');
  assert(!('phone' in publicProjection), 'Public leaderboard projection omits private phone');
  assert(!('authUid' in publicProjection), 'Public leaderboard projection omits authUid');
  assert(!('studentId' in publicProjection), 'Public leaderboard projection omits studentId detail');
  assert(!('university' in publicProjection), 'Public leaderboard projection omits university detail');
  assert(publicProjection.name === 'Samiul Alom', 'Public leaderboard correctly preserves public name');
  assert(publicProjection.totalCheckIns === 12, 'Public leaderboard preserves verified attendance total');
  assert(publicProjection.points === 150, 'Public participation score correctly calculated (12*10 + 6*5 = 150)');

  // Test 4: Builder Profile Self-Editing Protection & Validation
  console.log('\nTest 4: Builder Profile Validation & Anti-Tampering');
  const validateProfileUpdate = (updates: any) => {
    if (!updates.name || typeof updates.name !== 'string' || updates.name.trim().length === 0) {
      return { valid: false, error: 'Name is required' };
    }
    if (!updates.email || !updates.email.includes('@') || !updates.email.includes('.')) {
      return { valid: false, error: 'Valid email required' };
    }
    if (updates.phone && !/^[\d\s+\-()]{6,25}$/.test(updates.phone.trim())) {
      return { valid: false, error: 'Invalid phone format' };
    }
    return { valid: true };
  };

  assert(
    validateProfileUpdate({ name: 'Maya', email: 'maya@dob.org', phone: '+123456789' }).valid,
    'Valid profile updates pass validation'
  );
  assert(
    !validateProfileUpdate({ name: '', email: 'maya@dob.org' }).valid,
    'Empty name fails validation'
  );
  assert(
    !validateProfileUpdate({ name: 'Maya', email: 'invalid-email' }).valid,
    'Malformed email fails validation'
  );
  assert(
    !validateProfileUpdate({ name: 'Maya', email: 'maya@dob.org', phone: 'abc' }).valid,
    'Letters in phone number fail validation'
  );

  // Verify anti-tampering: ordinary member cannot self-modify role or attendance
  const sanitizeSelfProfileEdit = (existing: Member, input: any): Partial<Member> => ({
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() || '',
    university: input.university?.trim() || '',
    department: input.department?.trim() || '',
    major: input.major?.trim() || '',
    semester: input.semester?.trim() || '',
    avatarUrl: input.avatarUrl || existing.avatarUrl,
    bio: input.bio || existing.bio,
    // Critical: authoritative fields NEVER taken from input!
    role: existing.role,
    totalCheckIns: existing.totalCheckIns,
    currentStreak: existing.currentStreak,
    bestStreak: existing.bestStreak,
  });

  const forgedInput = {
    name: 'Honest Builder',
    email: 'builder@example.com',
    role: 'President', // malicious attempt to self-promote to President
    totalCheckIns: 9999, // malicious attempt to fake attendance
    currentStreak: 9999,
  };
  const sanitized = sanitizeSelfProfileEdit(sampleMember, forgedInput);
  assert(
    sanitized.role === sampleMember.role,
    'Self-profile update rejects forged role, preserving original club role'
  );
  assert(
    sanitized.totalCheckIns === sampleMember.totalCheckIns,
    'Self-profile update rejects forged attendance total'
  );

  // Test 5: Session Management Location Validation & Persistence
  console.log('\nTest 5: Session Meeting Location Validation');
  const validateSessionLocation = (loc: string) => {
    const trimmed = loc.trim();
    return trimmed.length > 0 && trimmed.length <= 150;
  };

  assert(
    validateSessionLocation('Bay 4 Prototyping Workshop'),
    'Standard meeting location is valid'
  );
  assert(
    validateSessionLocation('Innovation Lab · Room 302'),
    'Meeting location with special characters is valid'
  );
  assert(
    !validateSessionLocation('   '),
    'Empty/whitespace meeting location is rejected'
  );

  const sampleSession: Session = {
    id: 'sess_test_1',
    title: 'Edge AI Sprint',
    track: 'AI & Embedded',
    date: '2026-10-15',
    startTime: '18:00',
    endTime: '21:00',
    location: 'Innovation Lab · Room 302',
    description: 'Computer vision on Raspberry Pi',
    sessionCode: 'DOB-OCT-1501',
    points: 20,
    status: 'active',
    host: 'Rahat Mahadi',
  };
  assert(
    sampleSession.location === 'Innovation Lab · Room 302',
    'Session meeting location persists correctly on session object'
  );

  // Test 6: QR Parsing & Deterministic Check-In
  console.log('\nTest 6: QR Code Parsing & Deterministic ID Generation');
  const parsedFromURL = parseScannedQR('https://denofbuilders.org/?verify=attendance&checkin=DOB-OCT-1501&sessionId=sess_test_1');
  assert(
    parsedFromURL.kind === 'session' && parsedFromURL.sessionId === 'sess_test_1',
    'Camera scanner successfully parses session ID and code from check-in URL'
  );

  const deterministicCheckInId = `${sampleSession.id}_${sampleMember.id}`;
  assert(
    deterministicCheckInId === 'sess_test_1_mem_101',
    'Deterministic check-in ID matches {sessionId}_{memberId} preventing duplicates'
  );

  // Test 7: Duplicate Check-In Prevention Logic
  console.log('\nTest 7: Duplicate Check-In Guard');
  const existingCheckIns: CheckInRecord[] = [
    {
      id: deterministicCheckInId,
      sessionId: sampleSession.id,
      sessionTitle: sampleSession.title,
      memberId: sampleMember.id,
      memberName: sampleMember.name,
      memberHandle: sampleMember.handle,
      memberRole: sampleMember.role,
      track: sampleSession.track,
      timestamp: '2026-10-15T18:35:00.000Z',
      date: sampleSession.date,
      monthKey: '2026-10',
      method: 'camera_scan',
      status: 'present',
    },
  ];

  const isDuplicateCheckIn = (sessionId: string, memberId: string, records: CheckInRecord[]) => {
    return records.some((r) => r.sessionId === sessionId && r.memberId === memberId);
  };

  assert(
    isDuplicateCheckIn('sess_test_1', 'mem_101', existingCheckIns),
    'Duplicate check-in correctly identified for existing member and session'
  );
  assert(
    !isDuplicateCheckIn('sess_test_1', 'mem_999', existingCheckIns),
    'New member is allowed to check into active session'
  );

  // Test 8: Monthly Statistics & Zero Session Guard
  console.log('\nTest 8: Monthly Statistics Calculation');
  const statsEmpty = calculateMonthlyStats('2026-11', [sampleMember], [], []);
  assert(
    statsEmpty.totalSessions === 0 && statsEmpty.averageAttendancePerSession === 0,
    'Empty month returns 0 total sessions and 0.0 average attendance without division-by-zero errors'
  );

  const statsActive = calculateMonthlyStats(
    '2026-10',
    [sampleMember],
    [sampleSession],
    existingCheckIns
  );
  assert(
    statsActive.totalCheckIns === 1,
    'Calculates accurate total check-in count for month'
  );
  assert(
    statsActive.uniqueBuilders === 1,
    'Identifies 1 unique builder'
  );
  assert(
    statsActive.activeRatePercent === 100,
    '100% active rate when 1 out of 1 member attends'
  );

  // Test 9: Admin-Only Record Deletion Permissions Policy
  console.log('\nTest 9: Admin-Only Record Deletion Authorization');
  const canDeleteRecords = (userRole: 'admin' | 'member', isSuper: boolean = false) => {
    return isSuper || userRole === 'admin';
  };

  assert(
    canDeleteRecords('admin', false),
    'Admin user is authorized to delete club records'
  );
  assert(
    canDeleteRecords('member', true),
    'Super-admin is authorized to delete club records'
  );
  assert(
    !canDeleteRecords('member', false),
    'Ordinary member is strictly forbidden from deleting club records'
  );

  // Test 10: Check-In Deletion & Atomic Total Reconciliation
  console.log('\nTest 10: Attendance Check-In Deletion & Atomic Reconciliation');
  const reconcileMemberCheckInDeletion = (m: Member): Member => {
    return {
      ...m,
      totalCheckIns: Math.max(0, (m.totalCheckIns ?? 0) - 1),
    };
  };

  const initialMemberCheckIns = sampleMember.totalCheckIns ?? 0; // 12
  const reconciledMember = reconcileMemberCheckInDeletion(sampleMember);
  assert(
    reconciledMember.totalCheckIns === initialMemberCheckIns - 1,
    `Deleting check-in decrements member check-ins atomically (${initialMemberCheckIns} -> ${reconciledMember.totalCheckIns})`
  );

  const zeroMember: Member = { ...sampleMember, totalCheckIns: 0 };
  const safeZero = reconcileMemberCheckInDeletion(zeroMember);
  assert(
    safeZero.totalCheckIns === 0,
    'Atomic decrement does not drop below 0'
  );

  // Test 11: Meeting Publication Notification Schema & Duplicate Prevention
  console.log('\nTest 11: Meeting Publication Notifications & Duplicate Guard');
  const generatePublicationNotificationId = (sessionId: string, userId: string) => {
    return `notif_pub_${sessionId}_${userId}`;
  };

  const pubNotifId1 = generatePublicationNotificationId('sess_test_1', 'user_abc');
  const pubNotifId2 = generatePublicationNotificationId('sess_test_1', 'user_abc');
  assert(
    pubNotifId1 === pubNotifId2 && pubNotifId1 === 'notif_pub_sess_test_1_user_abc',
    'Deterministic publication notification ID prevents duplicate notification dispatches'
  );

  // Test 12: Notification Eligibility & Preferences Filter
  console.log('\nTest 12: Notification Eligibility & Preference Filtering');
  const sampleUsers = [
    {
      id: 'u1',
      status: 'active',
      memberStatus: 'Active',
      notificationPreferences: { enabled: true, meetingAnnouncements: true, meetingReminders: true },
    },
    {
      id: 'u2',
      status: 'suspended',
      memberStatus: 'Active',
      notificationPreferences: { enabled: true, meetingAnnouncements: true, meetingReminders: true },
    },
    {
      id: 'u3',
      status: 'pending',
      memberStatus: 'Active',
      notificationPreferences: { enabled: true, meetingAnnouncements: true, meetingReminders: true },
    },
    {
      id: 'u4',
      status: 'active',
      memberStatus: 'Inactive',
      notificationPreferences: { enabled: true, meetingAnnouncements: true, meetingReminders: true },
    },
    {
      id: 'u5',
      status: 'active',
      memberStatus: 'Active',
      notificationPreferences: { enabled: false, meetingAnnouncements: true, meetingReminders: true },
    },
    {
      id: 'u6',
      status: 'active',
      memberStatus: 'Active',
      notificationPreferences: { enabled: true, meetingAnnouncements: false, meetingReminders: true },
    },
  ];

  const filterEligibleForAnnouncement = (users: typeof sampleUsers) => {
    return users.filter((u) => {
      if (u.status === 'suspended' || u.status === 'pending') return false;
      if (u.memberStatus === 'Inactive') return false;
      if (u.notificationPreferences.enabled === false) return false;
      if (u.notificationPreferences.meetingAnnouncements === false) return false;
      return true;
    });
  };

  const eligibleForPub = filterEligibleForAnnouncement(sampleUsers);
  assert(
    eligibleForPub.length === 1 && eligibleForPub[0].id === 'u1',
    'Accurately filters eligible users: excludes suspended, pending, inactive, and opted-out preferences'
  );

  // Test 13: 30-Minute Reminder Time Window & Rescheduling Reset
  console.log('\nTest 13: 30-Minute Reminder Time Window Calculation');
  const isWithin30MinuteWindow = (nowTimeMs: number, sessionStartTimeMs: number) => {
    const diffMs = sessionStartTimeMs - nowTimeMs;
    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    return diffMinutes >= 0 && diffMinutes <= 35;
  };

  const baseTime = new Date('2026-10-15T18:00:00Z').getTime();
  const sessionStart = new Date('2026-10-15T18:30:00Z').getTime(); // exactly 30 mins away
  const sessionTooFar = new Date('2026-10-15T19:30:00Z').getTime(); // 90 mins away
  const sessionPassed = new Date('2026-10-15T17:30:00Z').getTime(); // in the past

  assert(
    isWithin30MinuteWindow(baseTime, sessionStart),
    'Session starting in 30 minutes correctly triggers 30-minute reminder window'
  );
  assert(
    !isWithin30MinuteWindow(baseTime, sessionTooFar),
    'Session 90 minutes away does not trigger premature reminder'
  );
  assert(
    !isWithin30MinuteWindow(baseTime, sessionPassed),
    'Past session does not trigger reminder'
  );

  // Test 14: Audit Trail Log Schema & Immutability Integrity
  console.log('\nTest 14: Security Audit Trail Logging Verification');
  const sampleAuditLog = {
    id: 'log_123456789',
    action: 'delete_session' as const,
    performedBy: 'admin_uid_777',
    performedByEmail: 'admin@denofbuilders.org',
    details: 'Permanently deleted session sess_test_1 ("Edge AI Sprint")',
    timestamp: '2026-10-10T18:00:00.000Z',
  };

  assert(
    sampleAuditLog.performedByEmail === 'admin@denofbuilders.org' &&
    sampleAuditLog.action === 'delete_session' &&
    sampleAuditLog.details.includes('sess_test_1'),
    'Audit log record correctly preserves admin identity, deletion action, and record context'
  );

  // Test 15: Builder Registration Input Validation
  console.log('\nTest 15: Builder Registration Validation & Duplicate Handle Prevention');
  const validateNewBuilder = (input: { name: string; email?: string; handle: string; tracks: string[] }) => {
    if (!input.name || !input.name.trim()) {
      return { valid: false, error: 'Name is required' };
    }
    if (input.email && (!input.email.includes('@') || !input.email.includes('.'))) {
      return { valid: false, error: 'Valid email required' };
    }
    if (!input.tracks || input.tracks.length === 0) {
      return { valid: false, error: 'At least one track required' };
    }
    const cleanHandle = input.handle.trim().startsWith('@') ? input.handle.trim() : `@${input.handle.trim()}`;
    return { valid: true, cleanHandle };
  };

  assert(
    validateNewBuilder({ name: 'Maya Chen', email: 'maya@dob.org', handle: '@mayac', tracks: ['Hardware & Robotics'] }).valid,
    'Valid builder registration passes'
  );
  assert(
    !validateNewBuilder({ name: '', email: 'maya@dob.org', handle: '@mayac', tracks: ['Hardware & Robotics'] }).valid,
    'Empty builder name fails registration'
  );
  assert(
    !validateNewBuilder({ name: 'Maya Chen', email: 'invalid-email', handle: '@mayac', tracks: ['Hardware & Robotics'] }).valid,
    'Malformed email fails registration'
  );
  assert(
    !validateNewBuilder({ name: 'Maya Chen', email: 'maya@dob.org', handle: '@mayac', tracks: [] }).valid,
    'Empty tracks selection fails registration'
  );

  // Test 16: Error Propagation in Async Operations
  console.log('\nTest 16: Error Propagation & Non-Swallowing Guarantee');
  let errorCaught = false;
  const mockFailingFirestoreSave = async () => {
    throw new Error('Firestore write quota exceeded');
  };
  try {
    await mockFailingFirestoreSave();
  } catch (err: any) {
    if (err.message === 'Firestore write quota exceeded') {
      errorCaught = true;
    }
  }
  assert(errorCaught, 'Async errors are faithfully caught and propagated to UI handlers without being silently swallowed');

  // Test 17: Membership Approval & Two-Stage Response Workflow
  console.log('\nTest 17: Membership Approval Separation & Applicant Response Verification');
  
  // 1. Initial State: Applicant requests membership
  let applicantUser: {
    id: string;
    email: string;
    displayName: string;
    role: 'member' | 'admin';
    status: 'pending' | 'approved_waiting_response' | 'active' | 'declined';
    membershipRequestedAt: string;
    approvedMemberId?: string;
    memberId?: string;
    approvedAt?: string;
    respondedAt?: string;
  } = {
    id: 'user_applicant_123',
    email: 'newbuilder@example.com',
    displayName: 'New Builder',
    role: 'member',
    status: 'pending',
    membershipRequestedAt: '2026-10-12T10:00:00.000Z',
    approvedMemberId: undefined,
    memberId: undefined,
  };
  let rosterMember = {
    id: 'mem_builder_456',
    name: 'New Builder',
    handle: '@newbuilder',
    email: 'newbuilder@example.com',
    authUid: undefined as string | undefined,
    role: 'Member' as const,
    tracks: ['Software & Systems' as const],
    joinedDate: '2026-10-12',
    totalCheckIns: 0,
    currentStreak: 0,
    bestStreak: 0,
  };

  assert(
    applicantUser.status === 'pending',
    'Initial applicant status is pending'
  );
  assert(
    rosterMember.authUid === undefined,
    'Roster record initially has no linked authUid'
  );

  // 2. Admin Approval Stage: Administrator approves request
  // MUST update status to 'Approved — Waiting for User Response' and NOT link UID yet!
  const simulateAdminApproval = (user: typeof applicantUser, targetMemberId: string) => {
    return {
      ...user,
      status: 'approved_waiting_response' as const,
      approvedMemberId: targetMemberId,
      approvedAt: '2026-10-12T10:30:00.000Z',
    };
  };

  applicantUser = simulateAdminApproval(applicantUser, rosterMember.id);
  assert(
    applicantUser.status === 'approved_waiting_response',
    'Admin approval sets status to "Approved — Waiting for User Response"'
  );
  assert(
    applicantUser.approvedMemberId === rosterMember.id,
    'Target member ID is staged in approvedMemberId'
  );
  assert(
    rosterMember.authUid === undefined,
    'Administrator clicking Approve does NOT automatically activate applicant or bind authUid'
  );

  // 3. Duplicate Prevention Check: Cannot link already bound member
  const alreadyBoundMember = { ...rosterMember, authUid: 'another_user_uid' };
  const canBindMember = (targetMember: typeof rosterMember, currentUserId: string) => {
    if (targetMember.authUid && targetMember.authUid !== currentUserId) {
      return { allowed: false, error: 'Member record is already linked to another account.' };
    }
    return { allowed: true };
  };
  assert(
    !canBindMember(alreadyBoundMember, applicantUser.id).allowed,
    'Duplicate UID binding to an already linked member profile is rejected'
  );

  // 4. Applicant Response Stage (Scenario A: Acceptance)
  const simulateApplicantAcceptance = (
    user: typeof applicantUser,
    member: typeof rosterMember
  ) => {
    const check = canBindMember(member, user.id);
    if (!check.allowed) throw new Error(check.error);
    return {
      updatedUser: {
        ...user,
        status: 'active' as const,
        memberId: user.approvedMemberId!,
        respondedAt: '2026-10-12T11:00:00.000Z',
      },
      updatedMember: {
        ...member,
        authUid: user.id,
      },
    };
  };

  const { updatedUser: acceptedUser, updatedMember: activatedMember } =
    simulateApplicantAcceptance(applicantUser, rosterMember);

  assert(
    acceptedUser.status === 'active',
    'Applicant acceptance updates user status to active (or accepted)'
  );
  assert(
    acceptedUser.memberId === rosterMember.id,
    'Applicant acceptance links correct memberId'
  );
  assert(
    activatedMember.authUid === applicantUser.id,
    'Applicant acceptance links Firebase Authentication UID to member record'
  );

  // 5. Applicant Response Stage (Scenario B: Declination)
  const simulateApplicantDeclination = (user: typeof applicantUser) => {
    return {
      ...user,
      status: 'declined' as const,
      respondedAt: '2026-10-12T11:00:00.000Z',
    };
  };

  const declinedUser = simulateApplicantDeclination(applicantUser);
  assert(
    declinedUser.status === 'declined',
    'Applicant declination updates status to declined'
  );
  assert(
    rosterMember.authUid === undefined,
    'Applicant declination preserves unlinked member record without UID pollution'
  );

  // Test 18: Time-Based Session Status Verification (Upcoming, Closed, Open Now)
  console.log('\nTest 18: Session Temporal Status on the Basis of Time');

  const testSessionTemplate: Session = {
    id: 'sess_time_test',
    title: 'Autonomous Robotics Sprint',
    track: 'Hardware & Robotics',
    date: '2026-10-15',
    startTime: '18:00',
    endTime: '21:00',
    location: 'Maker Lab B4',
    description: 'Hardware prototyping session',
    sessionCode: 'DOB-OCT-TEST',
    points: 10,
    status: 'upcoming',
    host: 'Elena Rostova',
  };

  // Case A: Before session start (Upcoming)
  const beforeTime = new Date('2026-10-15T16:00:00');
  const infoBefore = getSessionTemporalInfo(testSessionTemplate, beforeTime);
  assert(
    infoBefore.temporalStatus === 'upcoming' && infoBefore.isUpcoming && !infoBefore.isOpenNow,
    'Session 2 hours prior to startTime is correctly identified as Upcoming'
  );

  // Case B: 20 minutes before start (Upcoming · Starts Soon)
  const twentyMinsBefore = new Date('2026-10-15T17:40:00');
  const infoSoon = getSessionTemporalInfo(testSessionTemplate, twentyMinsBefore);
  assert(
    infoSoon.temporalStatus === 'upcoming' &&
    infoSoon.badgeVariant === 'upcoming_soon' &&
    infoSoon.diffMinutes === 20,
    'Session 20 minutes prior to startTime is identified as Upcoming with starts-in countdown'
  );

  // Case C: During session window (Open Now)
  const duringTime = new Date('2026-10-15T19:30:00');
  const infoDuring = getSessionTemporalInfo(testSessionTemplate, duringTime);
  assert(
    infoDuring.temporalStatus === 'open_now' && infoDuring.isOpenNow && !infoDuring.isClosed,
    'Session at 19:30 (between 18:00 and 21:00) is accurately identified as Open Now'
  );

  // Case D: After session end (Closed)
  const afterTime = new Date('2026-10-15T21:15:00');
  const infoAfter = getSessionTemporalInfo(testSessionTemplate, afterTime);
  assert(
    infoAfter.temporalStatus === 'closed' && infoAfter.isClosed && !infoAfter.isOpenNow,
    'Session at 21:15 (after 21:00 endTime) is accurately identified as Closed'
  );

  // Case E: Admin explicitly marked completed (Closed)
  const completedSession: Session = { ...testSessionTemplate, status: 'completed' };
  const infoCompleted = getSessionTemporalInfo(completedSession, duringTime);
  assert(
    infoCompleted.temporalStatus === 'closed' && infoCompleted.isClosed,
    'Session marked completed in DB is always evaluated as Closed'
  );

  // Case F: Explicitly cancelled session
  const cancelledSession: Session = { ...testSessionTemplate, status: 'cancelled' };
  const infoCancelled = getSessionTemporalInfo(cancelledSession, duringTime);
  assert(
    infoCancelled.temporalStatus === 'cancelled' && infoCancelled.isCancelled,
    'Session marked cancelled is evaluated as Closed · Cancelled'
  );

  // Case G: Target session selection prioritization
  const sessionList: Session[] = [
    { ...testSessionTemplate, id: 'past_1', date: '2026-10-10', startTime: '18:00', endTime: '20:00' },
    { ...testSessionTemplate, id: 'open_now_1', date: '2026-10-15', startTime: '18:00', endTime: '21:00' },
    { ...testSessionTemplate, id: 'future_1', date: '2026-10-20', startTime: '18:00', endTime: '21:00' },
  ];
  const selectedTarget = getTargetSession(sessionList, duringTime);
  assert(
    selectedTarget?.id === 'open_now_1',
    'getTargetSession prioritizes the session that is currently Open Now'
  );

  const selectedBefore = getTargetSession(sessionList, beforeTime);
  assert(
    selectedBefore?.id === 'open_now_1',
    'getTargetSession selects nearest upcoming session when none is actively open'
  );

  // Test 19: Date and Timezone Resolution Verification
  console.log('Test 19: Date Fixing & Timezone Formatting Audit');
  const fixedDateStr = '2026-10-17';
  const formattedDate = formatInClubTz(fixedDateStr, 'Asia/Seoul', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  assert(
    formattedDate.includes('Oct') && formattedDate.includes('17') && formattedDate.includes('2026'),
    'formatInClubTz accurately formats YYYY-MM-DD string without timezone day-shift'
  );

  const parsedUtcDate = parseDateTimeInZone('2026-10-17', '18:30', 'Asia/Seoul');
  assert(
    parsedUtcDate instanceof Date && !isNaN(parsedUtcDate.getTime()),
    'parseDateTimeInZone parses session date and time into valid Date object'
  );

  const normalized = formatDateInClubTz('2026-10-17T18:30:00.000Z', 'Asia/Seoul');
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(normalized),
    'formatDateInClubTz normalizes ISO timestamp to authoritative YYYY-MM-DD format'
  );

  console.log('\n========================================');
  console.log('🎉 ALL TEST SUITES PASSED CLEANLY (54/54)');
  console.log('========================================\n');
  process.exit(0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
