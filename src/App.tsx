/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import {
  Member,
  Session,
  CheckInRecord,
  CheckInMethod,
  SessionStatus,
  UserProfile,
  PublicLeaderboardItem,
  ClubNotification,
} from './types';
import {
  getStoredMembers,
  saveStoredMembers,
  getStoredSessions,
  saveStoredSessions,
  getStoredCheckIns,
  saveStoredCheckIns,
  getSavedNavigationTab,
  saveNavigationTab,
} from './utils/storage';
import {
  subscribeToMembers,
  subscribeToSessions,
  subscribeToCheckIns,
  subscribeToUsers,
  subscribeToPublicLeaderboard,
  subscribeToUserNotifications,
  checkAndSend30MinuteReminders,
  approveUserMembershipLink,
  rejectUserMembershipLink,
  addMemberToFirestore,
  updateMemberInFirestore,
  addSessionToFirestore,
  updateSessionInFirestore,
  recordCheckInAtomic,
  adminDeleteMember,
  adminDeleteSession,
  adminDeleteCheckIn,
  deleteCheckInFromFirestore,
  initializeFirestoreWithDefaults,
} from './firebase/firestoreService';
import { Navbar, NavigationTab } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { m, AnimatePresence } from 'motion/react';
import { fadeUp, fade, spring } from './motion/presets';
import { BottomTabBar } from './components/BottomTabBar';
import { MobileMoreSheet } from './components/MobileMoreSheet';
import { LoginView } from './components/LoginView';
import { MemberHomeView } from './components/MemberHomeView';
import { PublicLeaderboardView } from './components/PublicLeaderboardView';
import { PendingRequests } from './components/PendingRequests';
import { MemberPassModal } from './components/MemberPassModal';
import { NewSessionModal } from './components/NewSessionModal';
import { AddMemberModal } from './components/AddMemberModal';
import { EditProfileModal } from './components/EditProfileModal';
import { GuideModal } from './components/GuideModal';
import { AdminLoginModal } from './components/AdminLoginModal';
import { ConfirmModal } from './components/ConfirmModal';
import { RecordDeleteModal, DeleteRecordTarget } from './components/RecordDeleteModal';
import { NotificationsModal } from './components/NotificationsModal';
import {
  AttendanceConfirmationModal,
  AttendanceConfirmationData,
} from './components/AttendanceConfirmationModal';
import { useAuth } from './firebase/AuthContext';
import { todayInClubTz } from './utils/sessionWindow';
import { DEFAULT_CLUB_TIMEZONE } from './config/constants';

// Code-split heavy views and modals for sub-500KB bundle
const MonthlyParticipationView = lazy(() =>
  import('./components/MonthlyParticipationView').then((m) => ({ default: m.MonthlyParticipationView }))
);
const QRKioskView = lazy(() =>
  import('./components/QRKioskView').then((m) => ({ default: m.QRKioskView }))
);
const QRScannerModal = lazy(() =>
  import('./components/QRScannerModal').then((m) => ({ default: m.QRScannerModal }))
);
const MembersView = lazy(() =>
  import('./components/MembersView').then((m) => ({ default: m.MembersView }))
);
const SessionsView = lazy(() =>
  import('./components/SessionsView').then((m) => ({ default: m.SessionsView }))
);
const AuditLogsModal = lazy(() =>
  import('./components/AuditLogsModal').then((m) => ({ default: m.AuditLogsModal }))
);
import {
  RotateCcw,
  Sparkles,
  HelpCircle,
  BookOpen,
  ShieldCheck,
  Lock,
  LogOut,
  ShieldAlert,
  AlertCircle,
  RefreshCw,
  Trophy,
  ArrowLeft,
  Calendar,
} from 'lucide-react';

function getTabFromHash(): NavigationTab | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  const validTabs: NavigationTab[] = [
    'home',
    'sessions',
    'participation',
    'members',
    'leaderboard',
    'kiosk',
    'requests',
  ];
  if (validTabs.includes(hash as NavigationTab)) {
    return hash as NavigationTab;
  }
  return null;
}

export default function App() {
  const {
    user,
    profile,
    linkedMember,
    membershipState,
    isAdmin,
    isApprovedMember,
    signOutUser,
  } = useAuth();

  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteRecordTarget | null>(null);
  const [isAuditLogsOpen, setIsAuditLogsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [notifications, setNotifications] = useState<ClubNotification[]>([]);

  // Firestore Collections State (Hydrated from cache for instant paint, updated authoritative via onSnapshot)
  const [members, setMembers] = useState<Member[]>(() => getStoredMembers());
  const [sessions, setSessions] = useState<Session[]>(() => getStoredSessions());
  const [checkIns, setCheckIns] = useState<CheckInRecord[]>(() => getStoredCheckIns());
  const [publicLeaderboard, setPublicLeaderboard] = useState<PublicLeaderboardItem[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  // Guest view toggle & active guest navigation tab
  const [showGuestLeaderboard, setShowGuestLeaderboard] = useState(false);
  const [guestTab, setGuestTab] = useState<'leaderboard' | 'sessions' | 'guide'>('leaderboard');

  // Navigation tab with History API & URL hash synchronization
  const [activeTab, setActiveTab] = useState<NavigationTab>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if (p.get('sessionId') || p.get('checkin') || p.get('s') || p.get('t') || p.get('verify')) {
        return 'home';
      }
      const hashTab = getTabFromHash();
      if (hashTab) return hashTab;
    }
    const saved = getSavedNavigationTab() as NavigationTab | null;
    return saved || 'home';
  });

  const [activeKioskSessionId, setActiveKioskSessionId] = useState<string | null>(null);

  // Modals
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [prefillMember, setPrefillMember] = useState<{
    name?: string;
    email?: string;
    handle?: string;
    authUid?: string;
  } | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [selectedPassMember, setSelectedPassMember] = useState<Member | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [attendanceConfirmation, setAttendanceConfirmation] = useState<AttendanceConfirmationData | null>(null);

  // Synchronize tab selection with History API (pushState) & LocalStorage
  const handleSelectTab = useCallback(
    (tab: NavigationTab, pushHistory = true) => {
      let targetTab = tab;
      // If not admin and selecting an admin-only tab, default to home
      if (!isAdmin && (tab === 'kiosk' || tab === 'requests')) {
        targetTab = 'home';
      }

      setActiveTab(targetTab);
      saveNavigationTab(targetTab);

      if (pushHistory && typeof window !== 'undefined') {
        const targetHash = `#/${targetTab}`;
        if (window.location.hash !== targetHash) {
          window.history.pushState({ tab: targetTab }, '', targetHash);
        }
      }

      // Scroll to top on tab change
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [isAdmin]
  );

  // Popstate listener for real browser Back/Forward button navigation
  useEffect(() => {
    const handlePopState = () => {
      const hashTab = getTabFromHash();
      if (hashTab) {
        handleSelectTab(hashTab, false);
      } else {
        handleSelectTab('home', false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [handleSelectTab]);

  // Initial sync of hash if empty for authenticated users
  useEffect(() => {
    if (typeof window !== 'undefined' && user) {
      const hashTab = getTabFromHash();
      if (!hashTab) {
        window.history.replaceState({ tab: activeTab }, '', `#/${activeTab}`);
      }
    }
  }, [user, activeTab]);

  // Enforce role-based access for tabs if role changes or tab loaded from storage
  useEffect(() => {
    if (!isAdmin && (activeTab === 'requests' || activeTab === 'kiosk')) {
      handleSelectTab('home');
    }
  }, [isAdmin, activeTab, handleSelectTab]);

  // Real-time Public Leaderboard Sync (Available without login, 0 private information exposed)
  useEffect(() => {
    const unsub = subscribeToPublicLeaderboard(
      (items) => {
        setPublicLeaderboard(items);
      },
      (err) => {
        console.warn('Public leaderboard listener notice:', err);
      }
    );
    return () => unsub();
  }, []);

  // Real-time Firestore sync (Active only when authenticated)
  useEffect(() => {
    if (!user) return;

    const unsubMembers = subscribeToMembers(
      (remoteMembers) => {
        setMembers(remoteMembers);
        saveStoredMembers(remoteMembers);
        setFirestoreError(null);
      },
      (err) => {
        setFirestoreError('Could not sync members directory: ' + err.message);
      }
    );

    const unsubSessions = subscribeToSessions(
      (remoteSessions) => {
        setSessions(remoteSessions);
        saveStoredSessions(remoteSessions);
        setFirestoreError(null);
      },
      (err) => {
        setFirestoreError('Could not sync sessions: ' + err.message);
      }
    );

    const unsubCheckIns = subscribeToCheckIns(
      (remoteCheckIns) => {
        setCheckIns(remoteCheckIns);
        saveStoredCheckIns(remoteCheckIns);
        setFirestoreError(null);
      },
      (err) => {
        setFirestoreError('Could not sync attendance records: ' + err.message);
      }
    );

    let unsubUsers: (() => void) | undefined;
    if (isAdmin) {
      unsubUsers = subscribeToUsers(
        (remoteUsers) => {
          setAllUsers(remoteUsers);
        },
        () => {
          // Non-blocking if admin permissions are resolving
        }
      );
    }

    return () => {
      unsubMembers();
      unsubSessions();
      unsubCheckIns();
      if (unsubUsers) unsubUsers();
    };
  }, [user, isAdmin]);

  // Real-time Club Notifications subscription for logged in user
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }

    const unsub = subscribeToUserNotifications(
      user.uid,
      (items) => {
        setNotifications(items);
      },
      (err) => {
        console.warn('Notifications subscription notice:', err);
      }
    );

    return () => unsub();
  }, [user]);

  // Automated 30-Minute Meeting Reminders Scheduled Background Sweep
  useEffect(() => {
    if (!user) return;

    // Run sweep once immediately upon login/session refresh
    checkAndSend30MinuteReminders().catch((err) => {
      console.warn('Initial 30-minute reminder sweep:', err);
    });

    // Run periodic sweep every 60 seconds while app is in active session
    const interval = setInterval(() => {
      checkAndSend30MinuteReminders().catch((err) => {
        console.warn('Scheduled 30-minute reminder check:', err);
      });
    }, 60000);

    return () => clearInterval(interval);
  }, [user, isAdmin]);

  // Handle URL query parameters for instant scan opening
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const hasScanParam = p.get('verify') === 'attendance' || p.get('sessionId') || p.get('checkin');
      if (hasScanParam && isApprovedMember) {
        setIsScannerOpen(true);
      }
    }
  }, [isApprovedMember]);

  // Close mobile navigation drawer on Escape key press
  useEffect(() => {
    if (!isMoreOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMoreOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMoreOpen]);

  // Authoritative Check-In Handler (Asynchronous, Atomic, Firestore-confirmed)
  const handleRecordCheckIn = useCallback(
    async (
      sessionId: string,
      memberId: string,
      method: CheckInMethod,
      notes?: string
    ): Promise<{ success: boolean; message: string; record?: CheckInRecord; isDuplicate?: boolean }> => {
      // Execute atomic transaction in Firestore with deterministic document ID {sessionId}_{memberId}
      const operatorUid = isAdmin ? user?.uid : undefined;
      const res = await recordCheckInAtomic(sessionId, memberId, method, notes, operatorUid);
      return res;
    },
    [isAdmin, user]
  );

  // Admin-Only Record Deletion Execution (Session, Member Profile, or Attendance Check-in)
  const handleExecuteRecordDeletion = async (target: DeleteRecordTarget, permanent: boolean) => {
    if (!isAdmin) {
      throw new Error('Unauthorized: Only administrators can delete club records.');
    }

    try {
      if (target.type === 'session') {
        await adminDeleteSession(target.id, target.session?.title, permanent);
      } else if (target.type === 'member') {
        await adminDeleteMember(target.id, target.member?.name, permanent);
      } else if (target.type === 'checkin') {
        await adminDeleteCheckIn(
          target.id,
          target.checkIn?.memberName,
          target.checkIn?.sessionTitle
        );
      }
      setDeleteTarget(null);
    } catch (err: any) {
      console.error('Failed to execute record deletion:', err);
      throw err;
    }
  };

  const handleSaveSession = async (sessionPayload: Session): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Unauthorized: Only administrators can schedule or edit sessions.');
    }
    try {
      if (editingSession) {
        const isRescheduled = Boolean(
          editingSession.date !== sessionPayload.date ||
          editingSession.startTime !== sessionPayload.startTime
        );
        await updateSessionInFirestore(sessionPayload, undefined, isRescheduled);
      } else {
        await addSessionToFirestore(sessionPayload);
      }
      setEditingSession(null);
    } catch (err: any) {
      console.error('Failed to save session:', err);
      throw err;
    }
  };

  const handleEditSession = (session: Session) => {
    if (!isAdmin) return;
    setEditingSession(session);
    setIsNewSessionOpen(true);
  };

  const handleUpdateSessionStatus = async (sessionId: string, status: SessionStatus) => {
    if (!isAdmin) return;
    const target = sessions.find((s) => s.id === sessionId);
    if (target) {
      try {
        await updateSessionInFirestore({ ...target, status });
      } catch (err: any) {
        console.error('Failed to update session status:', err);
      }
    }
  };

  const handleAddMember = async (newMember: Member): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Unauthorized: Only administrators can register builders.');
    }
    try {
      await addMemberToFirestore(newMember);
      if (newMember.authUid) {
        await approveUserMembershipLink(newMember.authUid, newMember.id);
      }
    } catch (err: any) {
      console.error('Failed to add member:', err);
      throw err;
    }
  };

  const handleApproveMembershipRequest = async (
    req: UserProfile,
    matchedMemberId?: string
  ) => {
    if (!isAdmin) return;
    try {
      if (matchedMemberId) {
        await approveUserMembershipLink(req.id, matchedMemberId);
      } else {
        setEditingMember(null);
        setPrefillMember({
          name: req.displayName,
          email: req.email,
          handle: req.requestedNotes?.startsWith('@')
            ? req.requestedNotes
            : `@${req.requestedNotes || req.email?.split('@')[0]}`,
          authUid: req.id,
        });
        setIsAddMemberOpen(true);
      }
    } catch (err: any) {
      console.error('Failed to approve membership request:', err);
    }
  };

  const handleRejectMembershipRequest = async (userId: string) => {
    if (!isAdmin) return;
    try {
      await rejectUserMembershipLink(userId);
    } catch (err: any) {
      console.error('Failed to reject membership request:', err);
    }
  };

  const handleUpdateMember = async (updated: Member): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Unauthorized: Only administrators can update builder profiles.');
    }
    try {
      await updateMemberInFirestore(updated);
      setEditingMember(null);
    } catch (err: any) {
      console.error('Failed to update member:', err);
      throw err;
    }
  };

  // Seed initial club template if admin requests and database is empty
  const handleSeedClubTemplate = async () => {
    if (!isAdmin || !user) return;
    const todayStr = todayInClubTz();
    const initialFounder: Member = {
      id: 'mem_1',
      name: user.displayName || 'Rahat Mahadi',
      handle: '@rahat',
      email: user.email || 'rahatmdmahadihasan@gmail.com',
      authUid: user.uid,
      role: 'President',
      tracks: ['Hardware & Robotics', 'AI & Embedded'],
      joinedDate: todayStr,
      totalCheckIns: 0,
      currentStreak: 0,
      bestStreak: 0,
      status: 'Active',
      bio: 'Club President and Lead Organizer.',
    };

    const initialSession: Session = {
      id: `sess_${todayStr.replace(/-/g, '_')}`,
      title: 'Weekly Builder Sprint: AI Hardware & Systems',
      track: 'Hardware & Robotics',
      date: todayStr,
      startTime: '18:30',
      endTime: '21:30',
      location: 'Innovation Lab · Room 302',
      description: 'Hands-on hardware hacking, robotics firmware, and collaborative build session.',
      sessionCode: `DOB-SPRINT-${todayStr.replace(/-/g, '').substring(2)}`,
      points: 10,
      status: 'active',
      timezone: DEFAULT_CLUB_TIMEZONE,
      host: user.displayName || 'Rahat Mahadi',
    };

    await initializeFirestoreWithDefaults(initialFounder, initialSession);
  };

  // Compute fallback public items from members if publicLeaderboard collection is populating
  const safePublicLeaderboardItems: PublicLeaderboardItem[] =
    publicLeaderboard.length > 0
      ? publicLeaderboard
      : members.map((m) => ({
          id: m.id,
          name: m.name,
          handle: m.handle,
          role: m.role,
          tracks: m.tracks,
          avatarUrl: m.avatarUrl || m.photoURL || '',
          totalCheckIns: m.totalCheckIns ?? 0,
          currentStreak: m.currentStreak ?? 0,
          bestStreak: m.bestStreak ?? 0,
          points: (m.totalCheckIns ?? 0) * 10 + (m.currentStreak ?? 0) * 5,
        }));

  // 1. Unauthenticated or Unapproved View
  if (!user || (!isApprovedMember && !isAdmin)) {
    // If visitor explicitly chooses Public Hub view without logging in:
    if (showGuestLeaderboard) {
      return (
        <div className="min-h-dvh bg-[#09090b] tech-grid text-zinc-100 flex flex-col font-sans selection:bg-[#b5ff00]/25 selection:text-[#b5ff00] overflow-x-hidden max-w-full w-full">
          <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-black/90 backdrop-blur-2xl">
            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-3 sm:px-6 lg:px-8 gap-3">
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowGuestLeaderboard(false)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-white/10 text-zinc-300 hover:text-white transition-colors cursor-pointer text-xs font-mono"
                  title="Back to Sign In"
                  aria-label="Back to Sign In"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Sign In</span>
                </button>
                <img
                  src="/dob_logo-192.png"
                  alt="Den of Builders"
                  className="w-8 h-8 object-contain"
                  width={32}
                  height={32}
                />
                <div>
                  <span className="font-display font-black tracking-tight text-sm sm:text-base text-white uppercase block leading-none">
                    Den of Builders
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b5ff00] font-mono">
                    Public Hub
                  </span>
                </div>
              </div>

              {/* Guest Navigation Tabs (Visible on tablet & desktop) */}
              <nav className="hidden sm:flex items-center gap-1 bg-zinc-950/80 p-1 rounded-2xl border border-white/10 neu-inset">
                <button
                  type="button"
                  onClick={() => setGuestTab('leaderboard')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider font-display flex items-center gap-1.5 transition-all cursor-pointer ${
                    guestTab === 'leaderboard'
                      ? 'bg-[#181b24] text-[#b5ff00] border border-[#b5ff00]/40 font-bold shadow-[0_0_10px_rgba(181,255,0,0.15)]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Trophy className="h-3.5 w-3.5 text-[#b5ff00]" />
                  <span>Leaderboard</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGuestTab('sessions')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider font-display flex items-center gap-1.5 transition-all cursor-pointer ${
                    guestTab === 'sessions'
                      ? 'bg-[#181b24] text-[#b5ff00] border border-[#b5ff00]/40 font-bold shadow-[0_0_10px_rgba(181,255,0,0.15)]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Calendar className="h-3.5 w-3.5 text-[#b5ff00]" />
                  <span>Meetings</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGuestTab('guide')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider font-display flex items-center gap-1.5 transition-all cursor-pointer ${
                    guestTab === 'guide'
                      ? 'bg-[#181b24] text-[#b5ff00] border border-[#b5ff00]/40 font-bold shadow-[0_0_10px_rgba(181,255,0,0.15)]'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#b5ff00]" />
                  <span>Guild Guide</span>
                </button>
              </nav>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowGuestLeaderboard(false)}
                  className="px-3.5 py-2 rounded-xl bg-[#b5ff00] hover:bg-[#c4ff26] text-black font-bold text-xs uppercase tracking-wider font-mono cursor-pointer transition-all shadow-[0_0_12px_rgba(181,255,0,0.25)] min-h-10 flex items-center gap-1.5"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>Sign In</span>
                </button>
              </div>
            </div>

            {/* Mobile Guest Navigation Strip (< sm) */}
            <nav
              aria-label="Public Navigation Bar"
              className="sm:hidden border-t border-white/[0.08] bg-[#0c0e14]/98 px-2 py-1.5 overflow-x-auto no-scrollbar flex items-center gap-1.5 shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)]"
            >
              <button
                type="button"
                onClick={() => setGuestTab('leaderboard')}
                aria-current={guestTab === 'leaderboard' ? 'page' : undefined}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold font-display uppercase tracking-wider transition-all min-h-10 cursor-pointer ${
                  guestTab === 'leaderboard'
                    ? 'bg-[#181b24] text-[#b5ff00] border border-[#b5ff00]/40 shadow-[0_0_12px_rgba(181,255,0,0.2)] font-black'
                    : 'text-zinc-400 hover:text-white bg-zinc-900/60 border border-white/5'
                }`}
              >
                <Trophy className="h-3.5 w-3.5 text-[#b5ff00]" />
                <span>Leaderboard</span>
              </button>

              <button
                type="button"
                onClick={() => setGuestTab('sessions')}
                aria-current={guestTab === 'sessions' ? 'page' : undefined}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold font-display uppercase tracking-wider transition-all min-h-10 cursor-pointer ${
                  guestTab === 'sessions'
                    ? 'bg-[#181b24] text-[#b5ff00] border border-[#b5ff00]/40 shadow-[0_0_12px_rgba(181,255,0,0.2)] font-black'
                    : 'text-zinc-400 hover:text-white bg-zinc-900/60 border border-white/5'
                }`}
              >
                <Calendar className="h-3.5 w-3.5 text-[#b5ff00]" />
                <span>Meetings</span>
              </button>

              <button
                type="button"
                onClick={() => setGuestTab('guide')}
                aria-current={guestTab === 'guide' ? 'page' : undefined}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold font-display uppercase tracking-wider transition-all min-h-10 cursor-pointer ${
                  guestTab === 'guide'
                    ? 'bg-[#181b24] text-[#b5ff00] border border-[#b5ff00]/40 shadow-[0_0_12px_rgba(181,255,0,0.2)] font-black'
                    : 'text-zinc-400 hover:text-white bg-zinc-900/60 border border-white/5'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-[#b5ff00]" />
                <span>Guild Guide</span>
              </button>
            </nav>
          </header>

          <main id="main" tabIndex={-1} className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-8 focus:outline-none">
            <AnimatePresence mode="popLayout" initial={false}>
              {guestTab === 'leaderboard' && (
                <m.div key="guest-leaderboard" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                  <PublicLeaderboardView
                    items={safePublicLeaderboardItems}
                    onOpenLogin={() => setShowGuestLeaderboard(false)}
                  />
                </m.div>
              )}

              {guestTab === 'sessions' && (
                <m.div key="guest-sessions" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                  <SessionsView
                    sessions={sessions}
                    members={members}
                    checkIns={checkIns}
                    isAdmin={false}
                    onOpenAdminLogin={() => setShowGuestLeaderboard(false)}
                    onOpenNewSession={() => {}}
                    onLaunchKioskForSession={() => {}}
                    onCheckInToSession={() => {}}
                    onRemoveCheckIn={() => {}}
                  />
                </m.div>
              )}

              {guestTab === 'guide' && (
                <m.div key="guest-guide" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                  <div className="max-w-3xl mx-auto space-y-6">
                    <div className="p-6 rounded-3xl bg-zinc-950/80 border border-white/10 neu-raised space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-2xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00]">
                          <Sparkles className="h-6 w-6" />
                        </div>
                        <div>
                          <h2 className="text-xl font-bold font-display text-white uppercase">Den of Builders Operational Guide</h2>
                          <p className="text-xs text-zinc-400 font-mono">Participation rules, tracks, streak scoring, and workshop access</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                        <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/5 space-y-2">
                          <h3 className="text-xs font-bold font-mono text-[#b5ff00] uppercase">1. How Attendance Works</h3>
                          <p className="text-xs text-zinc-300 leading-relaxed">
                            Builders attend weekly build sessions and scan the session QR code using their mobile camera or in-app scanner to record verified presence.
                          </p>
                        </div>

                        <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/5 space-y-2">
                          <h3 className="text-xs font-bold font-mono text-[#b5ff00] uppercase">2. Streak &amp; Scoring</h3>
                          <p className="text-xs text-zinc-300 leading-relaxed">
                            Earn 10 points for each workshop attended plus 5 bonus points per consecutive weekly streak. Consistency unlocks Guild ranks and leadership roles.
                          </p>
                        </div>

                        <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/5 space-y-2">
                          <h3 className="text-xs font-bold font-mono text-[#b5ff00] uppercase">3. Guild Tracks</h3>
                          <p className="text-xs text-zinc-300 leading-relaxed">
                            Specialized cohorts in Hardware &amp; Robotics, Software &amp; Systems, AI &amp; Embedded, and Open Hack sprints.
                          </p>
                        </div>

                        <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/5 space-y-2">
                          <h3 className="text-xs font-bold font-mono text-[#b5ff00] uppercase">4. Join the Guild</h3>
                          <p className="text-xs text-zinc-300 leading-relaxed">
                            Sign in with your Google account to register your builder profile and join upcoming meetings.
                          </p>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-white/10 text-center">
                        <button
                          type="button"
                          onClick={() => setShowGuestLeaderboard(false)}
                          className="px-5 py-2.5 rounded-2xl bg-[#b5ff00] text-black font-bold font-mono text-xs uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(181,255,0,0.3)] cursor-pointer"
                        >
                          Sign In &amp; Register Profile
                        </button>
                      </div>
                    </div>
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </main>

          {/* Mobile Bottom Tab Bar for Guests */}
          <nav
            aria-label="Guest Navigation"
            className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0c0e14]/95 backdrop-blur-2xl border-t border-white/[0.08] pb-safe shadow-[0_-8px_30px_rgba(0,0,0,0.7)]"
          >
            <div className="flex items-center justify-around h-14 max-w-md mx-auto px-2">
              <button
                type="button"
                onClick={() => setGuestTab('leaderboard')}
                className={`flex flex-col items-center justify-center flex-1 h-full min-w-11 min-h-11 py-1 transition-colors cursor-pointer ${
                  guestTab === 'leaderboard' ? 'text-[#b5ff00]' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Trophy className="w-5 h-5 shrink-0" />
                <span className="text-xs font-medium tracking-tight mt-0.5 font-display">Leaderboard</span>
              </button>

              <button
                type="button"
                onClick={() => setGuestTab('sessions')}
                className={`flex flex-col items-center justify-center flex-1 h-full min-w-11 min-h-11 py-1 transition-colors cursor-pointer ${
                  guestTab === 'sessions' ? 'text-[#b5ff00]' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Calendar className="w-5 h-5 shrink-0" />
                <span className="text-xs font-medium tracking-tight mt-0.5 font-display">Meetings</span>
              </button>

              <button
                type="button"
                onClick={() => setGuestTab('guide')}
                className={`flex flex-col items-center justify-center flex-1 h-full min-w-11 min-h-11 py-1 transition-colors cursor-pointer ${
                  guestTab === 'guide' ? 'text-[#b5ff00]' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sparkles className="w-5 h-5 shrink-0" />
                <span className="text-xs font-medium tracking-tight mt-0.5 font-display">Guide</span>
              </button>

              <button
                type="button"
                onClick={() => setShowGuestLeaderboard(false)}
                className="flex flex-col items-center justify-center flex-1 h-full min-w-11 min-h-11 py-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <Lock className="w-5 h-5 shrink-0" />
                <span className="text-xs font-medium tracking-tight mt-0.5 font-display">Sign In</span>
              </button>
            </div>
          </nav>

          <footer className="mt-auto border-t border-white/10 bg-black/80 py-6 text-center text-xs text-zinc-400 hidden sm:block">
            Den of Builders &copy; 2026 · Attendance &amp; Participation Hub
          </footer>
        </div>
      );
    }

    return (
      <LoginView
        onContinueAsGuest={() => {
          setShowGuestLeaderboard(true);
        }}
      />
    );
  }

  const pendingRequestsCount = allUsers.filter(
    (u) => u.status === 'pending' || u.status === 'approved_waiting_response'
  ).length;
  const unreadNotificationsCount = notifications.filter((n) => !n.read).length;

  const isAnyModalOpen =
    isScannerOpen ||
    isNewSessionOpen ||
    isAddMemberOpen ||
    isEditProfileOpen ||
    isGuideOpen ||
    isAdminLoginOpen ||
    !!deleteTarget ||
    isNotificationsOpen ||
    isAuditLogsOpen ||
    !!selectedPassMember ||
    !!attendanceConfirmation ||
    isMoreOpen;

  // 2. Active Authenticated Workspace
  return (
    <div className="min-h-dvh bg-[#09090b] tech-grid text-zinc-100 flex flex-col font-sans selection:bg-[#b5ff00]/25 selection:text-[#b5ff00] overflow-x-hidden max-w-full w-full">
      {/* Skip to Main Content Link for Keyboard Accessibility */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#b5ff00] focus:text-black focus:font-bold focus:rounded-xl focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Universal Top Navigation */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenQuickScan={() => setIsScannerOpen(true)}
        onOpenNewSession={() => {
          setEditingSession(null);
          setIsNewSessionOpen(true);
        }}
        onOpenGuide={() => setIsGuideOpen(true)}
        onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
        members={members}
        pendingRequestsCount={pendingRequestsCount}
        unreadNotificationsCount={unreadNotificationsCount}
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        onOpenAuditLogs={() => setIsAuditLogsOpen(true)}
        onOpenMore={() => setIsMoreOpen(true)}
        onToggleSidebar={() => setIsMoreOpen((prev) => !prev)}
        onOpenEditProfile={() => setIsEditProfileOpen(true)}
        onViewPass={() => {
          if (linkedMember) setSelectedPassMember(linkedMember);
        }}
      />

      {/* Access Level Strip (Hidden on mobile < sm; collapsed into Avatar Menu and More sheet) */}
      <div className="hidden sm:block border-b border-zinc-800/80 bg-zinc-950/95 px-3 sm:px-4 py-2 text-xs">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {isAdmin ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="flex h-2 w-2 rounded-full bg-[#b5ff00] animate-pulse shrink-0" />
              <div className="flex items-center gap-1.5 font-semibold text-white shrink-0">
                <ShieldCheck className="h-3.5 w-3.5 text-[#b5ff00]" />
                <span className="text-xs">Administrator Active:</span>
              </div>
              <span className="text-zinc-400 font-mono text-xs truncate">
                {user?.email}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-zinc-300 min-w-0 flex-1">
              <span className="flex h-2 w-2 rounded-full bg-[#b5ff00] shrink-0" />
              <span className="font-semibold text-zinc-200 shrink-0 text-xs">
                {linkedMember ? `${linkedMember.name} (${linkedMember.handle})` : user.email}
              </span>
              <span className="text-zinc-400 text-xs truncate">
                · Verified Guild Member
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            {isAdmin && members.length === 0 && (
              <button
                type="button"
                onClick={handleSeedClubTemplate}
                className="px-2.5 py-1 rounded-full bg-[#b5ff00]/20 hover:bg-[#b5ff00]/30 text-[#b5ff00] text-xs font-bold font-mono transition-colors cursor-pointer"
              >
                + Initialize First Meeting
              </button>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {firestoreError && (
          <m.div
            key="firestore-error"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit="exit"
            role="alert"
            className="bg-red-950/80 border-b border-red-800 px-4 py-2 text-xs text-red-300 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{firestoreError}</span>
            </div>
            <button
              onClick={() => setFirestoreError(null)}
              className="text-red-400 hover:text-red-200 cursor-pointer"
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          </m.div>
        )}
      </AnimatePresence>

      {/* Workspace Content Shell: Desktop Persistent Sidebar for Primary Sections + Main Views */}
      <div className="flex-1 flex w-full max-w-7xl mx-auto items-stretch">
        {/* Desktop Sidebar for Primary Sections (>= lg) */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          pendingRequestsCount={pendingRequestsCount}
          onOpenGuide={() => setIsGuideOpen(true)}
          onOpenAuditLogs={() => setIsAuditLogsOpen(true)}
          onViewPass={() => {
            if (linkedMember) setSelectedPassMember(linkedMember);
          }}
          onOpenEditProfile={() => setIsEditProfileOpen(true)}
          className="hidden lg:flex w-64 shrink-0 self-start sticky top-16 h-[calc(100dvh-4rem)] border-r border-white/[0.08]"
        />

        {/* Main Viewport Content */}
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-8 focus:outline-none"
        >
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="py-20 text-center font-mono text-zinc-400 text-xs flex items-center justify-center gap-2"
            >
              <span className="w-2 h-2 rounded-full bg-[#b5ff00] animate-pulse" />
              <span>Loading view...</span>
            </div>
          }
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {activeTab === 'home' && (
              <m.div key="home" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                <MemberHomeView
                  member={
                    linkedMember || {
                      id: user.uid,
                      name: user.displayName || 'Club Builder',
                      handle: `@${user.email?.split('@')[0] || 'builder'}`,
                      email: user.email || '',
                      role: 'Member',
                      tracks: ['Software & Systems'],
                      joinedDate: new Date().toISOString().split('T')[0],
                      status: 'Active',
                      totalCheckIns: checkIns.filter((c) => c.authUid === user.uid).length,
                      currentStreak: 0,
                      bestStreak: 0,
                    }
                  }
                  sessions={sessions}
                  checkIns={checkIns}
                  notifications={notifications}
                  onOpenScanner={() => setIsScannerOpen(true)}
                  onViewPass={() => {
                    if (linkedMember) setSelectedPassMember(linkedMember);
                  }}
                  onOpenEditProfile={() => setIsEditProfileOpen(true)}
                  onOpenNotifications={() => setIsNotificationsOpen(true)}
                />
              </m.div>
            )}

            {activeTab === 'leaderboard' && (
              <m.div key="leaderboard" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                <PublicLeaderboardView
                  items={safePublicLeaderboardItems}
                  onOpenLogin={() => {}}
                />
              </m.div>
            )}

            {activeTab === 'kiosk' && (
              <m.div key="kiosk" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                <QRKioskView
                  sessions={sessions}
                  members={members}
                  checkIns={checkIns}
                  isAdmin={isAdmin}
                  onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
                  onRecordCheckIn={handleRecordCheckIn}
                  onOpenScanner={() => setIsScannerOpen(true)}
                  onCloseCheckIn={(sessionId) => handleUpdateSessionStatus(sessionId, 'completed')}
                  activeKioskSessionId={activeKioskSessionId}
                  onExitKiosk={() => handleSelectTab('sessions')}
                />
              </m.div>
            )}

            {activeTab === 'sessions' && (
              <m.div key="sessions" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                <SessionsView
                  sessions={sessions}
                  members={members}
                  checkIns={checkIns}
                  isAdmin={isAdmin}
                  onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
                  onOpenNewSession={() => {
                    setEditingSession(null);
                    setIsNewSessionOpen(true);
                  }}
                  onEditSession={handleEditSession}
                  onLaunchKioskForSession={(sessionId) => {
                    setActiveKioskSessionId(sessionId);
                    handleSelectTab('kiosk');
                  }}
                  onCheckInToSession={(sId, mId) => {
                    handleRecordCheckIn(sId, mId, 'manual_entry');
                  }}
                  onRemoveCheckIn={(checkIn) => {
                    if (!isAdmin) return;
                    setDeleteTarget({
                      type: 'checkin',
                      id: checkIn.id,
                      checkIn,
                    });
                  }}
                  onUpdateSessionStatus={handleUpdateSessionStatus}
                  onDeleteSession={(session) => {
                    if (!isAdmin) return;
                    setDeleteTarget({
                      type: 'session',
                      id: session.id,
                      session,
                      relatedCheckInsCount: checkIns.filter((c) => c.sessionId === session.id).length,
                    });
                  }}
                />
              </m.div>
            )}

            {activeTab === 'participation' && (
              <m.div key="participation" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                <MonthlyParticipationView
                  members={members}
                  sessions={sessions}
                  checkIns={checkIns}
                  isAdmin={isAdmin}
                  onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
                  onOpenScanner={() => setIsScannerOpen(true)}
                  onViewMemberPass={(m) => setSelectedPassMember(m)}
                />
              </m.div>
            )}

            {activeTab === 'members' && (
              <m.div key="members" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                <MembersView
                  members={members}
                  checkIns={checkIns}
                  sessions={sessions}
                  pendingRequests={allUsers.filter(
                    (u) => u.status === 'pending' || u.status === 'approved_waiting_response'
                  )}
                  allUsers={allUsers}
                  isAdmin={isAdmin}
                  onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
                  onOpenAddMember={() => {
                    setEditingMember(null);
                    setPrefillMember(null);
                    setIsAddMemberOpen(true);
                  }}
                  onApproveRequest={handleApproveMembershipRequest}
                  onRejectRequest={handleRejectMembershipRequest}
                  onEditMember={(member) => {
                    setEditingMember(member);
                    setPrefillMember(null);
                    setIsAddMemberOpen(true);
                  }}
                  onDeleteMember={(member) => {
                    if (!isAdmin) return;
                    setDeleteTarget({
                      type: 'member',
                      id: member.id,
                      member,
                    });
                  }}
                  onViewMemberPass={(m) => setSelectedPassMember(m)}
                />
              </m.div>
            )}

            {activeTab === 'requests' && isAdmin && (
              <m.div key="requests" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full">
                <PendingRequests
                  members={members}
                  onOpenAddMemberWithPrefill={(prefill) => {
                    setEditingMember(null);
                    setPrefillMember(prefill);
                    setIsAddMemberOpen(true);
                  }}
                />
              </m.div>
            )}
          </AnimatePresence>
        </Suspense>
      </main>
    </div>

      {/* Footer */}
      <footer className="mt-auto border-t border-white/[0.08] bg-[#0c0e14]/80 backdrop-blur-2xl py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-6 shadow-[0_-4px_30px_rgba(0,0,0,0.5)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-400">
          <div className="flex items-center gap-3">
            <div className="p-1 rounded-xl bg-zinc-900/60 border border-white/10 neu-raised-sm">
              <img
                src="/dob_logo-192.png"
                alt="Den of Builders Logo"
                className="h-6 w-6 object-contain"
                width={24}
                height={24}
                loading="lazy"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold uppercase text-zinc-300">
                Den of Builders
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400">
                Attendance &amp; Participation Hub &copy; 2026
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => handleSelectTab('leaderboard')}
              className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-[#b5ff00] transition-colors cursor-pointer"
            >
              <Trophy className="h-3.5 w-3.5 text-[#b5ff00]" />
              <span>Public Leaderboard</span>
            </button>
            <button
              type="button"
              onClick={() => setIsGuideOpen(true)}
              className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-[#b5ff00] transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#b5ff00]" />
              <span>Guild Operational Guide</span>
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile Fixed Bottom Tab Bar (< 768px) */}
      <BottomTabBar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenQuickScan={() => setIsScannerOpen(true)}
        onOpenMore={() => setIsMoreOpen(true)}
        onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
        pendingRequestsCount={pendingRequestsCount}
        unreadNotificationsCount={unreadNotificationsCount}
        isModalOpen={isAnyModalOpen}
      />

      {/* Mobile Collapsible Sidebar Drawer (< lg) */}
      <AnimatePresence>
        {isMoreOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Primary Navigation Menu"
            className="lg:hidden fixed inset-0 z-50 flex"
          >
            {/* Backdrop */}
            <m.div
              variants={fade}
              initial="hidden"
              animate="show"
              exit="exit"
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => setIsMoreOpen(false)}
              aria-hidden="true"
            />

            {/* Drawer Panel */}
            <m.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={spring.sheet}
              className="relative w-80 max-w-[85vw] h-full flex flex-col z-10 shadow-2xl"
            >
              <Sidebar
                activeTab={activeTab}
                onSelectTab={(tab) => {
                  handleSelectTab(tab);
                  setIsMoreOpen(false);
                }}
                pendingRequestsCount={pendingRequestsCount}
                onOpenGuide={() => {
                  setIsMoreOpen(false);
                  setIsGuideOpen(true);
                }}
                onOpenAuditLogs={() => {
                  setIsMoreOpen(false);
                  setIsAuditLogsOpen(true);
                }}
                onViewPass={() => {
                  setIsMoreOpen(false);
                  if (linkedMember) setSelectedPassMember(linkedMember);
                }}
                onOpenEditProfile={() => {
                  setIsMoreOpen(false);
                  setIsEditProfileOpen(true);
                }}
                isMobileDrawer={true}
                onCloseMobileDrawer={() => setIsMoreOpen(false)}
                className="h-full w-full border-r border-white/10"
              />
            </m.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <Suspense fallback={null}>
        <QRScannerModal
          isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        sessions={sessions}
        members={members}
        onRecordCheckIn={handleRecordCheckIn}
        onAttendanceConfirmed={(data) => {
          setIsScannerOpen(false);
          setAttendanceConfirmation(data);
        }}
      />

      <AttendanceConfirmationModal
        data={attendanceConfirmation}
        onClose={() => setAttendanceConfirmation(null)}
        onViewPass={(m) => setSelectedPassMember(m)}
      />

      <NewSessionModal
        isOpen={isNewSessionOpen}
        onClose={() => {
          setIsNewSessionOpen(false);
          setEditingSession(null);
        }}
        onSaveSession={handleSaveSession}
        existingSessionsCount={sessions.length}
        initialSession={editingSession}
      />

      <AddMemberModal
        isOpen={isAddMemberOpen}
        onClose={() => {
          setIsAddMemberOpen(false);
          setEditingMember(null);
          setPrefillMember(null);
        }}
        onAddMember={handleAddMember}
        onUpdateMember={handleUpdateMember}
        initialMember={editingMember}
        prefill={prefillMember}
      />

      {/* Builder Self Profile Editing Modal */}
      {isEditProfileOpen && (
        <EditProfileModal
          isOpen={isEditProfileOpen}
          onClose={() => setIsEditProfileOpen(false)}
          member={
            linkedMember || {
              id: user.uid,
              name: user.displayName || 'Club Builder',
              handle: `@${user.email?.split('@')[0] || 'builder'}`,
              email: user.email || '',
              role: 'Member',
              tracks: ['Software & Systems'],
              joinedDate: new Date().toISOString().split('T')[0],
              status: 'Active',
              totalCheckIns: checkIns.filter((c) => c.authUid === user.uid).length,
              currentStreak: 0,
              bestStreak: 0,
            }
          }
        />
      )}

      <MemberPassModal
        member={selectedPassMember}
        onClose={() => setSelectedPassMember(null)}
      />

      <GuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        isAdmin={isAdmin}
        onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
        onOpenKiosk={() => {
          setIsGuideOpen(false);
          handleSelectTab('kiosk');
        }}
        onOpenScanner={() => {
          setIsGuideOpen(false);
          setIsScannerOpen(true);
        }}
      />

      <AdminLoginModal
        isOpen={isAdminLoginOpen}
        onClose={() => setIsAdminLoginOpen(false)}
      />

      {/* Comprehensive Admin Record Deletion Modal with Audit Trail */}
      <RecordDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        target={deleteTarget}
        onConfirmDelete={handleExecuteRecordDeletion}
      />

      {/* Real-time Meeting Notifications Center */}
      <NotificationsModal
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        notifications={notifications}
        onNavigateToSession={(_sessionId) => {
          setIsNotificationsOpen(false);
          handleSelectTab('sessions');
        }}
      />

      {/* Security & Operations Audit Logs Modal */}
      <AuditLogsModal
        isOpen={isAuditLogsOpen}
        onClose={() => setIsAuditLogsOpen(false)}
      />
      </Suspense>
    </div>
  );
}
