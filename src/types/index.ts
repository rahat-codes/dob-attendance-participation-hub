import { Timestamp } from 'firebase/firestore';

export type BuilderRole =
  | 'Member'
  | 'Project Leader'
  | 'Vice President'
  | 'President'
  // Backward compatibility legacy values
  | 'Founder'
  | 'Lead'
  | 'Builder'
  | 'Apprentice';

export type BuilderTrack =
  | 'Hardware & Robotics'
  | 'Software & Systems'
  | 'AI & Embedded'
  | 'Open Hack & Demo';

export type MemberStatus = 'Active' | 'Probationary' | 'Inactive';

export type BuilderTier = 'Guild Architect' | 'Master Craftsman' | 'Active Builder' | 'Apprentice' | 'Novice Maker';

/**
 * Public Member Roster Document
 * Stored at: members/{memberId}
 * Readable by: Active club members & admins
 */
export interface Member {
  id: string; // memberId
  name: string;
  handle: string; // unique, e.g. "@alex"
  role: BuilderRole;
  tracks: BuilderTrack[];
  avatarUrl?: string;
  photoURL?: string;
  joinedDate: string; // YYYY-MM-DD
  status: MemberStatus;
  bio?: string;
  leaderboardOptOut?: boolean;
  authUid?: string; // Linked Firebase Auth UID
  createdAt?: string;
  // Optional convenience / joined fields
  email?: string;
  phone?: string;
  university?: string;
  department?: string;
  major?: string;
  semester?: string;
  totalCheckIns?: number;
  currentStreak?: number;
  bestStreak?: number;
}

/**
 * Isolated Sensitive Personal Details
 * Stored at: memberPrivate/{memberId}
 * Readable by: ONLY Admins and the document owner
 */
export interface MemberPrivate {
  email?: string;
  phone?: string;
  university?: string;
  department?: string;
  major?: string;
  semester?: string;
}

export type UserStatus = 'pending' | 'approved_waiting_response' | 'active' | 'declined' | 'suspended';

export interface UserNotificationPreferences {
  enabled: boolean;
  announcements?: boolean;
  reminders?: boolean;
  meetingAnnouncements?: boolean;
  meetingReminders?: boolean;
}

/**
 * User Account Profile
 * Stored at: users/{uid}
 * Note: Role is intentionally separated in admins/{uid} to avoid privilege escalation
 */
export interface UserProfile {
  id: string; // Auth UID
  email: string;
  displayName: string;
  photoURL?: string;
  status: UserStatus;
  memberId?: string; // Linked roster member ID
  approvedMemberId?: string; // Staged member ID waiting for applicant acceptance
  requestedNotes?: string; // Applicant handle or student ID submitted during sign-up
  readAnnouncementIds?: string[];
  notificationPrefs?: UserNotificationPreferences;
  notificationPreferences?: UserNotificationPreferences;
  createdAt?: string;
  updatedAt?: string;
  approvedAt?: string;
  respondedAt?: string;
  membershipRequestedAt?: string;
}

/**
 * Dedicated Admin Authority Document
 * Stored at: admins/{uid}
 * Admin status is determined by: Super Admin email OR presence of admins/{uid}
 */
export interface AdminDoc {
  email: string;
  grantedBy: string; // UID of super admin
  grantedAt: string; // ISO date or Timestamp string
}

export type SessionStatus = 'scheduled' | 'cancelled' | 'completed' | 'active' | 'upcoming';
export type CheckInMode = 'auto' | 'open' | 'closed';

/**
 * Workshop / Meeting Session
 * Stored at: sessions/{sessionId}
 */
export interface Session {
  id: string;
  title: string;
  track: BuilderTrack;
  date: string; // YYYY-MM-DD in the club time zone
  startAt?: Timestamp | { seconds: number; nanoseconds: number };
  endAt?: Timestamp | { seconds: number; nanoseconds: number };
  startTime?: string;
  endTime?: string;
  sessionCode?: string;
  timezone?: string; // e.g. "Asia/Seoul"
  status: SessionStatus;
  checkInMode?: CheckInMode;
  openMinutesBefore?: number; // default 15
  graceMinutesAfter?: number; // default 30
  lateAfterMinutes?: number; // default 10
  points: number; // default 10
  maxCapacity?: number;
  location: string;
  description: string;
  host: string;
  createdAt?: string;
  createdBy?: string;
}

export type SessionPhase = 'upcoming' | 'open' | 'closed' | 'cancelled';

export interface SessionState {
  phase: SessionPhase;
  opensAt: Date;
  closesAt: Date;
  minutesToOpen: number;
  isLate: (now?: Date) => boolean;
}

/**
 * Ephemeral Kiosk QR Rotating Token
 * Stored at: sessionTokens/{sessionId} (Admin read/write only)
 */
export interface SessionTokenDoc {
  token: string;
  prevToken: string;
  rotatedAt: Timestamp | { seconds: number; nanoseconds: number };
}

export type CheckInMethod = 'camera_scan' | 'code_input' | 'manual_entry' | 'kiosk_scan';
export type CheckInStatus = 'present' | 'late';

/**
 * Verified Attendance Record
 * Stored at: checkIns/{sessionId}_{memberId}
 */
export interface CheckInRecord {
  id: string; // {sessionId}_{memberId}
  sessionId: string;
  memberId: string;
  authUid?: string;
  method: CheckInMethod;
  token?: string; // Submitted kiosk token (for self check-ins)
  checkedInAt?: Timestamp | { seconds: number; nanoseconds: number } | string;
  status: CheckInStatus;
  monthKey: string; // YYYY-MM in club timezone
  notes?: string;
  verifiedBy?: string; // UID of admin if manual/kiosk
  // Optional joined / legacy fields
  sessionTitle?: string;
  memberName?: string;
  memberHandle?: string;
  memberRole?: BuilderRole;
  track?: BuilderTrack;
  timestamp?: string;
  date?: string;
}

export type ClubNotificationType =
  | 'announcement'
  | 'reminder'
  | 'system'
  | 'meeting_published'
  | 'meeting_reminder_30m'
  | 'meeting_rescheduled'
  | 'meeting_cancelled';

/**
 * Club Notification item for members
 */
export interface ClubNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type?: ClubNotificationType;
  read?: boolean;
  createdAt: string;
  sessionId?: string;
  sessionDate?: string;
  sessionLocation?: string;
  sessionTime?: string;
}

/**
 * Club-Wide Broadcast Announcement
 * Stored at: announcements/{id}
 */
export type AnnouncementType =
  | 'session_published'
  | 'session_rescheduled'
  | 'session_cancelled'
  | 'general';

export interface Announcement {
  id: string;
  type: AnnouncementType;
  sessionId?: string;
  title: string;
  message: string;
  createdAt: string;
  createdBy: string;
}

/**
 * Public Leaderboard Cached Projection
 * Stored at: publicLeaderboard/{memberId}
 * Publicly readable; recomputed & written by admins
 */
export interface PublicLeaderboardItem {
  id: string; // memberId
  name: string;
  handle: string;
  role: BuilderRole;
  avatarUrl?: string;
  tracks: BuilderTrack[];
  totalCheckIns: number;
  currentStreak: number;
  bestStreak: number;
  points: number;
}

export type AuditAction =
  | 'create_session'
  | 'update_session'
  | 'delete_session'
  | 'cancel_session'
  | 'complete_session'
  | 'session_open_close'
  | 'check_in_manual'
  | 'delete_check_in'
  | 'approve_user'
  | 'decline_user'
  | 'suspend_user'
  | 'unsuspend_user'
  | 'grant_admin'
  | 'revoke_admin'
  | 'add_member'
  | 'update_member'
  | 'deactivate_member'
  | 'delete_member'
  | 'update_settings'
  | 'recompute_leaderboard';

export interface AuditLog {
  id: string;
  action: AuditAction;
  performedBy: string; // UID
  performedByEmail: string;
  details: string;
  timestamp: string; // ISO string
  targetName?: string;
  targetType?: string;
  targetId?: string;
}

export interface ClubSettings {
  name: string;
  timezone: string;
  tracks: BuilderTrack[];
  defaults: {
    openMinutesBefore: number;
    graceMinutesAfter: number;
    lateAfterMinutes: number;
    points: number;
  };
}

export interface ComputedMemberStats {
  total: number;
  streak: number;
  bestStreak: number;
  points: number;
  lateCount: number;
}
