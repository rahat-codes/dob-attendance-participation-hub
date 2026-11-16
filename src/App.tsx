/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, useReducer, Suspense, lazy } from 'react';
import {
  Member,
  Session,
  CheckInRecord,
  CheckInMethod,
  CheckInMode,
  SessionStatus,
  UserProfile,
  PublicLeaderboardItem,
  ClubNotification,
  BuilderTrack,
} from './types';
import { getPendingCheckIn } from './utils/deepLink';
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
  getSubscriptionPlan,
  getBoundedCheckInStartMonthKey,
  getBoundedSessionStartDate,
  mergeBoundedWithHistory,
  resolveLeaderboardRecomputeSource,
} from './utils/listenerScope';
import { loadFirestoreService } from './firebase/lazyFirestore';
import { ensureFreshServerTimeOffset } from './utils/serverTime';
import { isSessionRescheduled } from './utils/sessionTiming';
import { SUPER_ADMIN_EMAIL, DEFAULT_CLUB_TIMEZONE } from './config/constants';
import { decodeApplication, isApplicationSubmitted } from './utils/application';
import { m, AnimatePresence } from 'motion/react';
import { fadeUp, fade, spring } from './motion/presets';
import { useMotionSafe } from './motion/useMotionSafe';
import { navChromeReducer, getNavChromeState } from './utils/navChrome';
import { LoginView } from './components/LoginView';
import type { DeleteRecordTarget } from './components/RecordDeleteModal';
import type { AttendanceConfirmationData } from './components/AttendanceConfirmationModal';
import { useAuth } from './firebase/AuthContext';
import { todayInClubTz } from './utils/sessionWindow';
import {
  AUTO_RECOMPUTE_DEBOUNCE_MS,
  MAX_AUTO_RECOMPUTE_CHECKINS,
  computeBackfillPreviewSummary,
  computeLeaderboardDataSignature,
  pruneHourlyTimestamps,
  shouldTriggerDebouncedRecompute,
} from './utils/stats';
import { isTabVisible } from './utils/reminders';
import { NavigationTab, resolveAppRoute } from './utils/routing';
import { formatUserFriendlyFirestoreError } from './utils/firestoreErrors';
import {
  PendingRequestDetector,
  triggerBrowserNotification,
  requestNotificationPermission,
} from './utils/pendingAlerts';
import {
  Sparkles,
  Lock,
  LogOut,
  ShieldAlert,
  AlertCircle,
  RefreshCw,
  Trophy,
  ArrowLeft,
  Calendar,
  UserCheck,
  ArrowRight,
  Info,
} from 'lucide-react';

// Code-split views, navigation chrome, and modals for lean initial load
const IslandNav = lazy(() =>
  import('./ui/IslandNav').then((mod) => ({ default: mod.IslandNav }))
);
const Sidebar = lazy(() =>
  import('./components/Sidebar').then((mod) => ({ default: mod.Sidebar }))
);
const MemberHomeView = lazy(() =>
  import('./components/MemberHomeView').then((mod) => ({ default: mod.MemberHomeView }))
);
const PublicLeaderboardView = lazy(() =>
  import('./components/PublicLeaderboardView').then((mod) => ({ default: mod.PublicLeaderboardView }))
);
const PendingRequests = lazy(() =>
  import('./components/PendingRequests').then((mod) => ({ default: mod.PendingRequests }))
);
const NotFoundView = lazy(() =>
  import('./components/common/NotFoundView').then((mod) => ({ default: mod.NotFoundView }))
);
const MonthlyParticipationView = lazy(() =>
  import('./components/MonthlyParticipationView').then((mod) => ({ default: mod.MonthlyParticipationView }))
);
const QRKioskView = lazy(() =>
  import('./components/QRKioskView').then((mod) => ({ default: mod.QRKioskView }))
);
const QRScannerModal = lazy(() =>
  import('./components/QRScannerModal').then((mod) => ({ default: mod.QRScannerModal }))
);
const MembersView = lazy(() =>
  import('./components/MembersView').then((mod) => ({ default: mod.MembersView }))
);
const SessionsView = lazy(() =>
  import('./components/SessionsView').then((mod) => ({ default: mod.SessionsView }))
);
const AuditLogsModal = lazy(() =>
  import('./components/AuditLogsModal').then((mod) => ({ default: mod.AuditLogsModal }))
);
const MemberPassModal = lazy(() =>
  import('./components/MemberPassModal').then((mod) => ({ default: mod.MemberPassModal }))
);
const NewSessionModal = lazy(() =>
  import('./components/NewSessionModal').then((mod) => ({ default: mod.NewSessionModal }))
);
const AddMemberModal = lazy(() =>
  import('./components/AddMemberModal').then((mod) => ({ default: mod.AddMemberModal }))
);
const EditProfileModal = lazy(() =>
  import('./components/EditProfileModal').then((mod) => ({ default: mod.EditProfileModal }))
);
const GuideModal = lazy(() =>
  import('./components/GuideModal').then((mod) => ({ default: mod.GuideModal }))
);
const AdminLoginModal = lazy(() =>
  import('./components/AdminLoginModal').then((mod) => ({ default: mod.AdminLoginModal }))
);
const AdminBackupModal = lazy(() =>
  import('./components/AdminBackupModal').then((mod) => ({ default: mod.AdminBackupModal }))
);
const RecordDeleteModal = lazy(() =>
  import('./components/RecordDeleteModal').then((mod) => ({ default: mod.RecordDeleteModal }))
);
const NotificationsModal = lazy(() =>
  import('./components/NotificationsModal').then((mod) => ({ default: mod.NotificationsModal }))
);
const AttendanceConfirmationModal = lazy(() =>
  import('./components/AttendanceConfirmationModal').then((mod) => ({ default: mod.AttendanceConfirmationModal }))
);

export default function App() {
  const {
    user,
    profile,
    linkedMember,
    memberPrivate,
    membershipState,
    isAdmin,
    isApprovedMember,
    loading,
    signInWithGoogle,
    signOutUser,
    refreshProfile,
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
  const [hasPublicLeaderboardLoaded, setHasPublicLeaderboardLoaded] = useState(false);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const [newRequestToast, setNewRequestToast] = useState<UserProfile | null>(null);
  const [initialPendingToastCount, setInitialPendingToastCount] = useState<number | null>(null);
  const hasCheckedInitialPendingRef = useRef(false);
  const pendingDetectorRef = useRef<PendingRequestDetector>(new PendingRequestDetector());

  // Bounded admin listener state + on-demand full-history refs
  const adminMinMonthKey = useMemo(() => getBoundedCheckInStartMonthKey(), []);
  const adminMinSessionDate = useMemo(() => getBoundedSessionStartDate(), []);
  const historicalSessionsRef = useRef<Session[]>([]);
  const historicalCheckInsRef = useRef<CheckInRecord[]>([]);
  const [hasLoadedAllHistory, setHasLoadedAllHistory] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // First-run backfill confirmation + 5m open-tab recompute debounce state
  const [firstRunBackfillDismissed, setFirstRunBackfillDismissed] = useState(false);
  const [backfillPromptBusy, setBackfillPromptBusy] = useState(false);
  const [backfillPromptStatus, setBackfillPromptStatus] = useState<string | null>(null);
  const initialAdminLoadSettledRef = useRef(false);
  const initialMembersSettledRef = useRef(false);
  const initialSessionsSettledRef = useRef(false);
  const initialCheckInsSettledRef = useRef(false);
  const lastAutoRecomputeAtRef = useRef<number | null>(null);
  const lastSyncedDataSignatureRef = useRef<string | null>(null);
  const recentAutoRecomputeMsRef = useRef<number[]>([]);

  // Guest view toggle & active guest navigation tab
  const [showGuestLeaderboard, setShowGuestLeaderboard] = useState(false);
  const [guestTab, setGuestTab] = useState<'leaderboard' | 'sessions' | 'guide'>('leaderboard');
  const [guestLeaderboardStatus, setGuestLeaderboardStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [guestLeaderboardError, setGuestLeaderboardError] = useState<string | null>(null);
  const [guestLeaderboardRetryTick, setGuestLeaderboardRetryTick] = useState(0);

  // Navigation tab & 404 state synchronized with History API & URL hash
  const [routeNotFound, setRouteNotFound] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const resolved = resolveAppRoute(window.location);
    return resolved.isNotFound ? resolved.invalidRoute : null;
  });

  const [activeTab, setActiveTab] = useState<NavigationTab>(() => {
    if (typeof window !== 'undefined') {
      const resolved = resolveAppRoute(window.location);
      if (resolved.tab) return resolved.tab;
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
    studentId?: string;
    university?: string;
    tracks?: BuilderTrack[];
    githubUrl?: string;
    linkedinUrl?: string;
    portfolioUrl?: string;
    showLinksPublicly?: boolean;
  } | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [selectedPassMember, setSelectedPassMember] = useState<Member | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [attendanceConfirmation, setAttendanceConfirmation] = useState<AttendanceConfirmationData | null>(null);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [mandatoryProfileDismissed, setMandatoryProfileDismissed] = useState(false);

  useEffect(() => {
    setMandatoryProfileDismissed(false);
  }, [user?.uid]);

  // Sync client/server clock offset via GET /api/time at startup
  useEffect(() => {
    ensureFreshServerTimeOffset().catch(() => {});
  }, []);

  // Check if an approved/active builder must complete the mandatory profile form
  const isMandatoryProfileRequired = useMemo(() => {
    if (mandatoryProfileDismissed) return false;
    // Only applies to logged-in non-admin active members who have a linked member profile
    if (!user || isAdmin || !linkedMember || membershipState !== 'active') return false;

    // A member must have completed the mandatory profile setup
    const isMarkedCompleted = memberPrivate?.profileCompleted === true || linkedMember.profileCompleted === true;

    // Check mandatory fields: studentId, phone, and at least one track
    const hasStudentId = Boolean(linkedMember.studentId?.trim() || memberPrivate?.studentId?.trim());
    const hasPhone = Boolean(memberPrivate?.phone?.trim() || linkedMember.phone?.trim());
    const hasTracks = Boolean(linkedMember.tracks && linkedMember.tracks.length > 0);

    // If not completed or any required credential is missing, mandatory modal must be shown
    return !isMarkedCompleted || !hasStudentId || !hasPhone || !hasTracks;
  }, [user, isAdmin, linkedMember, memberPrivate, membershipState, mandatoryProfileDismissed]);

  // Motion safe hook for respecting prefers-reduced-motion
  const { reduced: reducedMotion } = useMotionSafe();

  // Desktop media query (>= 1024px) with cleanup
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  // Focus management refs for drawer accessibility
  const desktopLogoButtonRef = useRef<HTMLButtonElement | null>(null);
  const desktopSidebarCloseRef = useRef<HTMLButtonElement | null>(null);
  const wasSidebarOpenRef = useRef(false);

  // App blocked state (profile completion gate, loading, guest hub, signed out)
  const isAppBlocked = useMemo(() => {
    return Boolean(
      loading ||
      !user ||
      membershipState !== 'active' ||
      isMandatoryProfileRequired
    );
  }, [loading, user, membershipState, isMandatoryProfileRequired]);

  // Unified chrome state reducer
  const [chromeState, dispatchChrome] = useReducer(navChromeReducer, {
    isDesktop: typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : false,
    isSidebarOpen: false,
    isBlocked: false,
  });

  // Keep chrome reducer state synchronized with media query and blocked state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 1024px)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
      if (e.matches) {
        dispatchChrome({ type: 'resizeToDesktop' });
      } else {
        dispatchChrome({ type: 'resizeToMobile' });
      }
    };

    mql.addEventListener('change', handleMediaChange);
    return () => mql.removeEventListener('change', handleMediaChange);
  }, []);

  useEffect(() => {
    if (isAppBlocked) {
      dispatchChrome({ type: 'blocked' });
    }
  }, [isAppBlocked]);

  // Derive top bar and sidebar visibility
  const navChrome = useMemo(() => {
    return getNavChromeState({
      isDesktop,
      isSidebarOpen: chromeState.isSidebarOpen,
      isBlocked: isAppBlocked,
    });
  }, [isDesktop, chromeState.isSidebarOpen, isAppBlocked]);

  // Focus trap and restore on open / close
  useEffect(() => {
    if (navChrome.sidebarVisible) {
      wasSidebarOpenRef.current = true;
      // Focus close button on open
      requestAnimationFrame(() => {
        desktopSidebarCloseRef.current?.focus();
      });
    } else if (wasSidebarOpenRef.current) {
      wasSidebarOpenRef.current = false;
      // Return focus to logo button when top bar becomes visible again
      requestAnimationFrame(() => {
        desktopLogoButtonRef.current?.focus();
      });
    }
  }, [navChrome.sidebarVisible]);

  // Lock body scroll while desktop sidebar is open
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (navChrome.sidebarVisible) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [navChrome.sidebarVisible]);

  // Synchronize tab selection with History API (pushState) & LocalStorage
  const handleSelectTab = useCallback(
    (tab: NavigationTab, pushHistory = true) => {
      let targetTab = tab;
      // If not admin and selecting kiosk, default to home
      if (!isAdmin && tab === 'kiosk') {
        targetTab = 'home';
      }

      setRouteNotFound(null);
      setActiveTab(targetTab);
      saveNavigationTab(targetTab);

      if (pushHistory && typeof window !== 'undefined') {
        const targetHash = `#/${targetTab}`;
        if (window.location.hash !== targetHash || window.location.pathname !== '/') {
          window.history.pushState({ tab: targetTab }, '', `/${targetHash}`);
        }
      }

      // Close sidebar if open
      dispatchChrome({ type: 'selectDestination' });

      // Scroll to top on tab change
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [isAdmin]
  );

  // Popstate & hashchange listener for real browser Back/Forward button navigation & 404
  useEffect(() => {
    const syncFromLocation = () => {
      dispatchChrome({ type: 'routeChange' });
      const resolved = resolveAppRoute(window.location);
      if (resolved.isNotFound) {
        setRouteNotFound(resolved.invalidRoute || 'unknown');
        return;
      }
      setRouteNotFound(null);
      if (resolved.tab) {
        handleSelectTab(resolved.tab, false);
      } else {
        handleSelectTab('home', false);
      }
    };

    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('hashchange', syncFromLocation);
    };
  }, [handleSelectTab]);

  // Initial sync of hash if empty (only when on valid route) for authenticated users
  useEffect(() => {
    if (typeof window !== 'undefined' && user && !routeNotFound) {
      const resolved = resolveAppRoute(window.location);
      if (!resolved.isNotFound && !resolved.tab) {
        window.history.replaceState({ tab: activeTab }, '', `#/${activeTab}`);
      }
    }
  }, [user, activeTab, routeNotFound]);

  // Enforce role-based access for tabs if role changes or tab loaded from storage
  useEffect(() => {
    if (!isAdmin && activeTab === 'kiosk') {
      handleSelectTab('home');
    }
  }, [isAdmin, activeTab, handleSelectTab]);

  // Route user to appropriate view upon signing in (admin dashboard or member check-in)
  const prevUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (user && !prevUserRef.current) {
      if (isAdmin) {
        handleSelectTab('sessions');
      } else {
        handleSelectTab('home');
      }
    }
    prevUserRef.current = user ? user.uid : null;
  }, [user, isAdmin, handleSelectTab]);

  // Real-time Public Leaderboard Sync (Deferred until guest hub is opened or user is signed in)
  useEffect(() => {
    if (!showGuestLeaderboard && !user) {
      setHasPublicLeaderboardLoaded(false);
      setGuestLeaderboardStatus('idle');
      setGuestLeaderboardError(null);
      return;
    }

    let cancelled = false;
    let unsub: (() => void) | undefined;
    setGuestLeaderboardStatus('loading');
    setGuestLeaderboardError(null);

    loadFirestoreService()
      .then(({ subscribeToPublicLeaderboard }) => {
        if (cancelled) return;
        unsub = subscribeToPublicLeaderboard(
          (items) => {
            setPublicLeaderboard(items);
            setHasPublicLeaderboardLoaded(true);
            setGuestLeaderboardStatus('ready');
            setGuestLeaderboardError(null);
          },
          (err) => {
            console.warn('Public leaderboard listener notice:', err);
            setGuestLeaderboardStatus('error');
            setGuestLeaderboardError(
              formatUserFriendlyFirestoreError(err, 'Unable to sync public rankings. Please check your connection and retry.')
            );
          }
        );
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('Failed to load leaderboard listener:', err);
        setGuestLeaderboardStatus('error');
        setGuestLeaderboardError(
          formatUserFriendlyFirestoreError(err, 'Failed to load public leaderboard module. Please check your connection and retry.')
        );
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [showGuestLeaderboard, user, guestLeaderboardRetryTick]);

  // Real-time Firestore sync (F11: strictly scoped by role and active approval status; admin collections bounded by default)
  useEffect(() => {
    const plan = getSubscriptionPlan({
      hasUser: Boolean(user),
      isAdmin,
      isApprovedMember,
      linkedMemberId: linkedMember?.id,
    });

    if (!plan.members && !plan.sessions && plan.checkInsMode === 'none' && !plan.usersDirectory) {
      pendingDetectorRef.current.reset();
      hasCheckedInitialPendingRef.current = false;
      initialAdminLoadSettledRef.current = false;
      initialMembersSettledRef.current = false;
      initialSessionsSettledRef.current = false;
      initialCheckInsSettledRef.current = false;
      lastSyncedDataSignatureRef.current = null;
      historicalSessionsRef.current = [];
      historicalCheckInsRef.current = [];
      setHasLoadedAllHistory(false);
      if (!user) {
        setMembers([]);
        setSessions([]);
        setCheckIns([]);
        setAllUsers([]);
      }
      return;
    }

    let cancelled = false;
    let unsubMembers: (() => void) | undefined;
    let unsubSessions: (() => void) | undefined;
    let unsubCheckIns: (() => void) | undefined;
    let unsubUsers: (() => void) | undefined;

    const updateSettledFlag = () => {
      if (
        initialMembersSettledRef.current &&
        initialSessionsSettledRef.current &&
        initialCheckInsSettledRef.current
      ) {
        initialAdminLoadSettledRef.current = true;
      }
    };

    loadFirestoreService()
      .then((svc) => {
        if (cancelled) return;

        if (plan.members) {
          unsubMembers = svc.subscribeToMembers(
            (remoteMembers) => {
              setMembers(remoteMembers);
              saveStoredMembers(remoteMembers);
              setFirestoreError(null);
              initialMembersSettledRef.current = true;
              updateSettledFlag();
            },
            (err) => {
              setFirestoreError(formatUserFriendlyFirestoreError(err, 'Could not sync members directory. Please refresh and try again.'));
            }
          );
        }

        if (plan.sessions) {
          unsubSessions = svc.subscribeToSessions(
            (remoteSessions) => {
              const merged = isAdmin
                ? mergeBoundedWithHistory(historicalSessionsRef.current, remoteSessions)
                : remoteSessions;
              setSessions(merged);
              saveStoredSessions(merged);
              setFirestoreError(null);
              initialSessionsSettledRef.current = true;
              updateSettledFlag();
            },
            (err) => {
              setFirestoreError(formatUserFriendlyFirestoreError(err, 'Could not sync sessions. Please refresh and try again.'));
            },
            isAdmin ? { minDate: adminMinSessionDate } : undefined
          );
        }

        if (plan.checkInsMode === 'all') {
          unsubCheckIns = svc.subscribeToAllCheckIns(
            (remoteCheckIns) => {
              const merged = mergeBoundedWithHistory(historicalCheckInsRef.current, remoteCheckIns);
              setCheckIns(merged);
              saveStoredCheckIns(merged);
              setFirestoreError(null);
              initialCheckInsSettledRef.current = true;
              updateSettledFlag();
            },
            (err) => {
              setFirestoreError(formatUserFriendlyFirestoreError(err, 'Could not sync attendance records. Please refresh and try again.'));
            },
            { minMonthKey: adminMinMonthKey }
          );
        } else if (plan.checkInsMode === 'self' && linkedMember?.id) {
          unsubCheckIns = svc.subscribeToMemberCheckIns(
            linkedMember.id,
            (remoteCheckIns) => {
              setCheckIns(remoteCheckIns);
              saveStoredCheckIns(remoteCheckIns);
              setFirestoreError(null);
              initialCheckInsSettledRef.current = true;
              updateSettledFlag();
            },
            (err) => {
              setFirestoreError(formatUserFriendlyFirestoreError(err, 'Could not sync attendance records. Please refresh and try again.'));
            }
          );
        }

        if (plan.usersDirectory) {
          unsubUsers = svc.subscribeToUsers(
            (remoteUsers) => {
              setAllUsers(remoteUsers);
              if (!hasCheckedInitialPendingRef.current) {
                hasCheckedInitialPendingRef.current = true;
                const initialCount = remoteUsers.filter((u) => u.status === 'pending' && isApplicationSubmitted(u)).length;
                if (initialCount > 0) {
                  setInitialPendingToastCount(initialCount);
                }
              }
              const newAlerts = pendingDetectorRef.current.processUsers(remoteUsers);
              if (newAlerts.length > 0) {
                const latest = newAlerts[newAlerts.length - 1];
                setNewRequestToast(latest);
                newAlerts.forEach((u) => {
                  triggerBrowserNotification(u);
                });
              }
            },
            (err: any) => {
              console.error('Failed to sync users directory:', err);
              setFirestoreError(formatUserFriendlyFirestoreError(err, 'User directory sync failed. Please refresh and try again.'));
            }
          );
        } else {
          pendingDetectorRef.current.reset();
          hasCheckedInitialPendingRef.current = false;
        }
      })
      .catch((err: any) => {
        console.warn('Failed to initialize Firestore listeners:', err);
        if (!cancelled) {
          setFirestoreError(
            formatUserFriendlyFirestoreError(err, 'Could not connect to club database. Please check your connection and retry.')
          );
        }
      });

    return () => {
      cancelled = true;
      unsubMembers?.();
      unsubSessions?.();
      unsubCheckIns?.();
      unsubUsers?.();
    };
  }, [user, isAdmin, isApprovedMember, linkedMember?.id, adminMinMonthKey, adminMinSessionDate]);

  // On-demand full history fetch for bounded admin views
  const handleLoadAllHistory = useCallback(async () => {
    if (!isAdmin || isLoadingHistory || hasLoadedAllHistory) return;
    setIsLoadingHistory(true);
    try {
      const { fetchAllSessionsHistory, fetchAllCheckInsHistory } = await loadFirestoreService();
      const [allSessions, allCheckIns] = await Promise.all([
        fetchAllSessionsHistory(),
        fetchAllCheckInsHistory(),
      ]);
      historicalSessionsRef.current = allSessions;
      historicalCheckInsRef.current = allCheckIns;
      setSessions((prev) => mergeBoundedWithHistory(allSessions, prev));
      setCheckIns((prev) => mergeBoundedWithHistory(allCheckIns, prev));
      setHasLoadedAllHistory(true);
    } catch (err: any) {
      setFirestoreError(formatUserFriendlyFirestoreError(err, 'Failed to load historical records. Please try again.'));
    } finally {
      setIsLoadingHistory(false);
    }
  }, [isAdmin, isLoadingHistory, hasLoadedAllHistory]);

  // Request browser notification permission when an admin logs in
  useEffect(() => {
    if (isAdmin && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      requestNotificationPermission().catch(() => {});
    }
  }, [isAdmin]);

  // Auto-dismiss initial pending toast after 8 seconds
  useEffect(() => {
    if (!initialPendingToastCount) return;
    const t = setTimeout(() => {
      setInitialPendingToastCount(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [initialPendingToastCount]);

  // Auto-dismiss new request in-app toast after 8 seconds
  useEffect(() => {
    if (!newRequestToast) return;
    const t = setTimeout(() => {
      setNewRequestToast(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [newRequestToast]);

  // Real-time Club Notifications subscription for logged in user
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }

    let cancelled = false;
    let unsub: (() => void) | undefined;

    loadFirestoreService()
      .then(({ subscribeToUserNotifications }) => {
        if (cancelled) return;
        unsub = subscribeToUserNotifications(
          user.uid,
          (items) => {
            setNotifications(items);
          },
          (err) => {
            console.warn('Notifications subscription notice:', err);
          }
        );
      })
      .catch((err) => {
        console.warn('Notifications listener load notice:', err);
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [user]);

  // Automated 30-Minute Meeting Reminders Scheduled Sweep (Admin-only, visible tab only, single-batch)
  useEffect(() => {
    if (!user || !isAdmin) return;

    const runSweep = () => {
      if (!isTabVisible()) return;
      loadFirestoreService()
        .then(({ checkAndSend30MinuteReminders }) => checkAndSend30MinuteReminders())
        .catch((err) => {
          console.warn('30-minute reminder sweep notice:', err);
        });
    };

    runSweep();

    const interval = setInterval(runSweep, 60000);
    const onVisibilityChange = () => {
      if (isTabVisible()) {
        runSweep();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [user, isAdmin]);

  // Handle URL query parameters or captured deep link state for instant scan opening
  useEffect(() => {
    if (typeof window !== 'undefined' && isApprovedMember) {
      const p = new URLSearchParams(window.location.search);
      const hasScanParam = p.get('verify') === 'attendance' || p.get('sessionId') || p.get('checkin') || p.get('s') || p.get('t');
      if (hasScanParam || getPendingCheckIn()) {
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
      notesOrOptions?: string | { token?: string; notes?: string }
    ): Promise<{ success: boolean; message: string; record?: CheckInRecord; isDuplicate?: boolean }> => {
      const { recordCheckInAtomic } = await loadFirestoreService();
      // Only explicit door-staff manual_entry passes operatorUid; admin self-scans stay recordSelfCheckIn
      const operatorUid = isAdmin && method === 'manual_entry' ? user?.uid : undefined;
      const options =
        typeof notesOrOptions === 'object' && notesOrOptions !== null
          ? { ...notesOrOptions, operatorUid }
          : { notes: notesOrOptions, operatorUid };
      return recordCheckInAtomic(sessionId, memberId, method, options);
    },
    [isAdmin, user]
  );

  // Admin-Only Record Deletion Execution (Session, Member Profile, or Attendance Check-in)
  const handleExecuteRecordDeletion = async (
    target: DeleteRecordTarget,
    permanent: boolean,
    options?: { deleteAttendance?: boolean; reason?: string }
  ) => {
    if (!isAdmin) {
      throw new Error('Unauthorized: Only administrators can delete club records.');
    }

    try {
      const { adminDeleteSession, adminDeleteMember, adminDeleteCheckIn } = await loadFirestoreService();
      if (target.type === 'session') {
        await adminDeleteSession(target.id, target.session?.title, permanent);
      } else if (target.type === 'member') {
        await adminDeleteMember(target.id, target.member?.name, permanent, options);
      } else if (target.type === 'checkin') {
        await adminDeleteCheckIn(
          target.id,
          target.checkIn?.memberName,
          target.checkIn?.sessionTitle,
          options?.reason || ''
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
      const { updateSessionInFirestore, createSessionInFirestore } = await loadFirestoreService();
      if (editingSession) {
        const isRescheduled = isSessionRescheduled(editingSession, sessionPayload);
        await updateSessionInFirestore(sessionPayload, undefined, isRescheduled);
      } else {
        await createSessionInFirestore(sessionPayload);
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

  const handleUpdateSessionStatus = async (sessionId: string, status: SessionStatus, mode?: CheckInMode) => {
    if (!isAdmin) return;
    try {
      const {
        completeSession,
        cancelSession,
        reopenSession,
        setSessionCheckInMode,
        updateSessionInFirestore,
      } = await loadFirestoreService();
      const target = sessions.find((s) => s.id === sessionId);
      if (status === 'completed') {
        await completeSession(sessionId);
      } else if (status === 'cancelled') {
        await cancelSession(sessionId, target?.title || sessionId);
      } else if (status === 'scheduled') {
        if (target && (target.status === 'completed' || target.status === 'cancelled')) {
          await reopenSession(sessionId, mode || 'auto');
        } else if (target && mode) {
          await setSessionCheckInMode(sessionId, mode);
        } else if (target) {
          const nextMode = mode || target.checkInMode || 'auto';
          await updateSessionInFirestore({ ...target, status, checkInMode: nextMode });
        }
      } else if (target) {
        const nextMode = mode || target.checkInMode || 'auto';
        await updateSessionInFirestore({ ...target, status, checkInMode: nextMode });
      }
      setFirestoreError(null);
    } catch (err: any) {
      console.error('Failed to update session status:', err);
      setFirestoreError(formatUserFriendlyFirestoreError(err, 'Failed to update session status. Please try again.'));
      throw err;
    }
  };

  const handleAddMember = async (newMember: Member): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Unauthorized: Only administrators can register builders.');
    }
    try {
      const { createMemberAndApprove, addMemberToFirestore } = await loadFirestoreService();
      if (newMember.authUid) {
        // Atomic create and approve in a single writeBatch (R6, R7, R15)
        await createMemberAndApprove(
          newMember.authUid,
          {
            name: newMember.name,
            handle: newMember.handle,
            email: newMember.email,
            phone: newMember.phone,
            studentId: newMember.studentId,
            role: newMember.role,
            tracks: newMember.tracks,
            university: newMember.university,
            department: newMember.department,
            major: newMember.major,
            semester: newMember.semester,
            avatarUrl: newMember.avatarUrl,
            bio: newMember.bio,
            githubUrl: newMember.githubUrl,
            linkedinUrl: newMember.linkedinUrl,
            portfolioUrl: newMember.portfolioUrl,
            showLinksPublicly: newMember.showLinksPublicly,
          }
        );
      } else {
        await addMemberToFirestore(newMember, {
          email: newMember.email,
          phone: newMember.phone,
          studentId: newMember.studentId,
          university: newMember.university || 'Tongmyong University',
          department: newMember.department,
          major: newMember.major,
          semester: newMember.semester,
        });
      }
      setIsAddMemberOpen(false);
      setPrefillMember(null);
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
        const { approveExistingMember } = await loadFirestoreService();
        await approveExistingMember(req.id, matchedMemberId);
        setFirestoreError(null);
      } else {
        const decoded = decodeApplication(req);
        setEditingMember(null);
        setPrefillMember({
          name: decoded.applicantName || req.displayName,
          email: req.email,
          handle: decoded.applicantHandle || `@${req.email?.split('@')[0] || 'builder'}`,
          authUid: req.id,
          studentId: decoded.applicantStudentId,
          university: 'Tongmyong University',
          tracks: decoded.applicantTrack ? [decoded.applicantTrack] : undefined,
          githubUrl: decoded.githubUrl,
          linkedinUrl: decoded.linkedinUrl,
          portfolioUrl: decoded.portfolioUrl,
          showLinksPublicly: decoded.showLinksPublicly,
        });
        setIsAddMemberOpen(true);
      }
    } catch (err: any) {
      console.error('Failed to approve membership request:', err);
      setFirestoreError(formatUserFriendlyFirestoreError(err, 'Failed to approve request. Please try again.'));
    }
  };

  const handleRejectMembershipRequest = async (userId: string) => {
    if (!isAdmin) return;
    try {
      const { rejectUserMembershipLink } = await loadFirestoreService();
      await rejectUserMembershipLink(userId);
      setFirestoreError(null);
    } catch (err: any) {
      console.error('Failed to reject membership request:', err);
      setFirestoreError(formatUserFriendlyFirestoreError(err, 'Failed to reject request. Please try again.'));
    }
  };

  const handleUpdateMember = async (updated: Member): Promise<void> => {
    if (!isAdmin) {
      throw new Error('Unauthorized: Only administrators can update builder profiles.');
    }
    try {
      const { updateMemberInFirestore } = await loadFirestoreService();
      await updateMemberInFirestore(updated);
      setEditingMember(null);
    } catch (err: any) {
      console.error('Failed to update member:', err);
      throw err;
    }
  };

  // Strict Privacy: Public leaderboard reads exclusively from publicLeaderboard collection
  const safePublicLeaderboardItems: PublicLeaderboardItem[] = publicLeaderboard;

  // First-run backfill confirmation banner visibility (no automatic write on initial load)
  const shouldPromptFirstRunBackfill = Boolean(
    isAdmin &&
    hasPublicLeaderboardLoaded &&
    publicLeaderboard.length === 0 &&
    members.length > 0 &&
    !firstRunBackfillDismissed
  );

  const backfillPreviewSummary = useMemo(
    () => (shouldPromptFirstRunBackfill ? computeBackfillPreviewSummary(members) : null),
    [shouldPromptFirstRunBackfill, members]
  );

  const currentLeaderboardDataSignature = useMemo(
    () => computeLeaderboardDataSignature(members, sessions, checkIns),
    [members, sessions, checkIns]
  );

  // Capture initial baseline signature once initial admin snapshot loads settle so open-tab idle doesn't trigger a no-op write
  useEffect(() => {
    if (
      isAdmin &&
      initialAdminLoadSettledRef.current &&
      lastSyncedDataSignatureRef.current === null
    ) {
      lastSyncedDataSignatureRef.current = currentLeaderboardDataSignature;
    }
  }, [isAdmin, currentLeaderboardDataSignature]);

  const handleConfirmFirstRunBackfill = async () => {
    if (!isAdmin || backfillPromptBusy) return;
    setBackfillPromptBusy(true);
    setBackfillPromptStatus(null);
    try {
      const { backfillPublicLeaderboard } = await loadFirestoreService();
      const res = await backfillPublicLeaderboard();
      const now = Date.now();
      lastAutoRecomputeAtRef.current = now;
      lastSyncedDataSignatureRef.current = currentLeaderboardDataSignature;
      recentAutoRecomputeMsRef.current = pruneHourlyTimestamps(
        [...recentAutoRecomputeMsRef.current, now],
        now
      );
      setBackfillPromptStatus(
        `Public leaderboard initialized (${res.totalBackfilled} published, ${res.totalRemoved} pruned).`
      );
      setFirstRunBackfillDismissed(true);
    } catch (err: any) {
      setBackfillPromptStatus(formatUserFriendlyFirestoreError(err, 'Backfill failed. Check admin permissions and try again.'));
    } finally {
      setBackfillPromptBusy(false);
    }
  };

  // Debounced open-tab auto-recompute (only when live data changed, checkIns <= 1500, >=5m debounce, <=6 runs/hour, visible tab)
  useEffect(() => {
    if (
      !shouldTriggerDebouncedRecompute({
        isAdmin,
        hasSettledInitialLoad: initialAdminLoadSettledRef.current,
        isTabVisible: isTabVisible(),
        hasExistingProjection: hasPublicLeaderboardLoaded && publicLeaderboard.length > 0,
        lastAutoRecomputeAtMs: lastAutoRecomputeAtRef.current,
        dataSignature: currentLeaderboardDataSignature,
        lastSyncedDataSignature: lastSyncedDataSignatureRef.current,
        recentRecomputeTimestampsMs: recentAutoRecomputeMsRef.current,
        checkInCount: checkIns.length,
      })
    ) {
      return;
    }

    const recomputeSource = resolveLeaderboardRecomputeSource({
      hasLoadedAllHistory,
      hasLiveData: members.length > 0,
    });
    if (recomputeSource === 'skip') return;

    const scheduledSignature = currentLeaderboardDataSignature;
    const timer = setTimeout(() => {
      if (!isTabVisible()) return;
      if (checkIns.length > MAX_AUTO_RECOMPUTE_CHECKINS) return;
      if (scheduledSignature === lastSyncedDataSignatureRef.current) return;
      loadFirestoreService()
        .then(async ({ backfillPublicLeaderboard, recomputeAndSaveLeaderboard }) => {
          if (recomputeSource === 'live_full') {
            await recomputeAndSaveLeaderboard(members, sessions, checkIns);
          } else {
            await backfillPublicLeaderboard();
          }
        })
        .then(() => {
          const now = Date.now();
          lastAutoRecomputeAtRef.current = now;
          lastSyncedDataSignatureRef.current = scheduledSignature;
          recentAutoRecomputeMsRef.current = pruneHourlyTimestamps(
            [...recentAutoRecomputeMsRef.current, now],
            now
          );
        })
        .catch((err) => {
          console.warn('Debounced leaderboard recompute notice:', err);
        });
    }, AUTO_RECOMPUTE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    isAdmin,
    hasLoadedAllHistory,
    hasPublicLeaderboardLoaded,
    publicLeaderboard.length,
    members,
    sessions,
    checkIns,
    currentLeaderboardDataSignature,
  ]);

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
            {guestLeaderboardStatus === 'error' && guestLeaderboardError && (
              <div
                role="alert"
                className="mb-4 p-4 rounded-2xl bg-red-950/70 border border-red-500/40 text-red-100 text-xs flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{guestLeaderboardError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setGuestLeaderboardRetryTick((n) => n + 1)}
                  className="min-h-11 px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/35 border border-red-500/50 text-red-100 font-bold font-mono uppercase tracking-wider cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Retry</span>
                </button>
              </div>
            )}

            {guestLeaderboardStatus === 'loading' && publicLeaderboard.length === 0 && guestTab === 'leaderboard' && (
              <div className="mb-4 p-4 rounded-2xl bg-zinc-900/70 border border-white/10 text-zinc-300 text-xs font-mono flex items-center gap-2.5">
                <RefreshCw className="h-4 w-4 text-[#b5ff00] animate-spin shrink-0" />
                <span>Loading live leaderboard rankings...</span>
              </div>
            )}

            <Suspense fallback={<p className="py-10 text-center font-mono text-zinc-400 text-xs">Loading Public Hub...</p>}>
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
            </Suspense>
          </main>

          <footer className="mt-auto border-t border-white/10 bg-black/80 py-6 text-center text-xs text-zinc-400">
            Den of Builders &copy; 2026 · Attendance &amp; Participation Hub
          </footer>
        </div>
      );
    }

    if (routeNotFound) {
      return (
        <div className="min-h-dvh tech-grid flex flex-col justify-center font-sans">
          <Suspense fallback={null}>
            <NotFoundView
              invalidRoute={routeNotFound}
              actionLabel="Return to Sign In"
              onReturnHome={() => {
                setRouteNotFound(null);
                if (typeof window !== 'undefined') {
                  window.history.replaceState({}, '', '/#/home');
                }
              }}
            />
          </Suspense>
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
    (u) => (u.status === 'pending' || u.status === 'approved_waiting_response') && isApplicationSubmitted(u)
  ).length;
  const unreadNotificationsCount = notifications.filter((n) => !n.read && !n.dismissed).length;

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
    isBackupOpen ||
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

      {/* Floating Island Navigation (Desktop top center, Mobile bottom) */}
      <Suspense fallback={null}>
        <IslandNav
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          onOpenQuickScan={() => setIsScannerOpen(true)}
          onOpenNewSession={() => {
            setEditingSession(null);
            setIsNewSessionOpen(true);
          }}
          onOpenGuide={() => setIsGuideOpen(true)}
          onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
          pendingRequestsCount={pendingRequestsCount}
          unreadNotificationsCount={unreadNotificationsCount}
          onOpenNotifications={() => setIsNotificationsOpen(true)}
          onOpenAuditLogs={() => setIsAuditLogsOpen(true)}
          onOpenBackup={() => setIsBackupOpen(true)}
          onOpenMore={() => setIsMoreOpen(true)}
          onOpenEditProfile={() => setIsEditProfileOpen(true)}
          onViewPass={() => {
            if (linkedMember) setSelectedPassMember(linkedMember);
          }}
          isModalOpen={isAnyModalOpen}
          onToggleSidebar={() => dispatchChrome({ type: 'toggleFromLogo' })}
          isSidebarOpen={chromeState.isSidebarOpen}
          isDesktopTopBarVisible={navChrome.topBarVisible}
          logoButtonRef={desktopLogoButtonRef}
        />
      </Suspense>



      <AnimatePresence>
        {firestoreError && (
          <m.div
            key="firestore-error"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit="exit"
            role="alert"
            className="bg-red-950/90 border-b border-red-800 px-4 py-2 text-xs text-red-200 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
              <span className="break-words">{firestoreError}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setFirestoreError(null);
                  refreshProfile();
                }}
                className="min-h-11 px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800/70 text-red-100 font-mono font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                aria-label="Retry loading profile and data"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={() => setFirestoreError(null)}
                className="min-w-11 min-h-11 flex items-center justify-center text-red-300 hover:text-white cursor-pointer rounded-lg"
                aria-label="Dismiss alert"
              >
                ✕
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* Real-time Admin Alert Toast for Incoming Pending Requests */}
      <AnimatePresence>
        {newRequestToast && (
          <m.div
            key={`toast-${newRequestToast.id}`}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 max-w-sm w-[calc(100vw-2rem)] p-4 rounded-2xl bg-[#0c0e14]/95 border-2 border-[#b5ff00]/60 shadow-[0_0_30px_rgba(181,255,0,0.25)] backdrop-blur-xl flex items-start gap-3"
            role="status"
            aria-live="polite"
          >
            <div className="w-10 h-10 rounded-xl bg-[#b5ff00]/10 border border-[#b5ff00]/40 flex items-center justify-center text-[#b5ff00] shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#b5ff00] font-bold">
                  New Builder Request
                </span>
                <button
                  type="button"
                  onClick={() => setNewRequestToast(null)}
                  className="min-w-11 min-h-11 -mr-2 -mt-2 flex items-center justify-center text-white/60 hover:text-white text-xs cursor-pointer rounded-lg"
                  aria-label="Dismiss toast"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm font-bold text-white font-display truncate mt-0.5">
                {newRequestToast.displayName || 'New Builder'}
              </p>
              <p className="text-xs text-zinc-400 font-mono truncate">
                {newRequestToast.email}
              </p>
              <button
                type="button"
                onClick={() => {
                  setNewRequestToast(null);
                  handleSelectTab('requests');
                }}
                className="mt-2.5 min-h-11 px-3 py-1.5 rounded-lg bg-[#b5ff00] text-black font-mono font-bold text-xs hover:bg-[#c2ff26] transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span>Review Request</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* Real-time Admin Alert Toast for Initial Pending Requests on First Load */}
      <AnimatePresence>
        {initialPendingToastCount !== null && (
          <m.div
            key="initial-pending-toast"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 max-w-sm w-[calc(100vw-2rem)] p-4 rounded-2xl bg-[#0c0e14]/95 border-2 border-[#b5ff00]/60 shadow-[0_0_30px_rgba(181,255,0,0.25)] backdrop-blur-xl flex items-start gap-3"
            role="status"
            aria-live="polite"
          >
            <div className="w-10 h-10 rounded-xl bg-[#b5ff00]/10 border border-[#b5ff00]/40 flex items-center justify-center text-[#b5ff00] shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#b5ff00] font-bold">
                  Pending Review
                </span>
                <button
                  type="button"
                  onClick={() => setInitialPendingToastCount(null)}
                  className="min-w-11 min-h-11 -mr-2 -mt-2 flex items-center justify-center text-white/60 hover:text-white text-xs cursor-pointer rounded-lg"
                  aria-label="Dismiss toast"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm font-bold text-white font-display mt-0.5">
                {initialPendingToastCount} {initialPendingToastCount === 1 ? 'request' : 'requests'} waiting for review
              </p>
              <button
                type="button"
                onClick={() => {
                  setInitialPendingToastCount(null);
                  handleSelectTab('requests');
                }}
                className="mt-2.5 min-h-11 px-3 py-1.5 rounded-lg bg-[#b5ff00] text-black font-mono font-bold text-xs hover:bg-[#c2ff26] transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <span>View Requests</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* First-Run Public Leaderboard Backfill Confirmation Prompt (Admin Only) */}
      {(shouldPromptFirstRunBackfill || backfillPromptStatus) && isAdmin && (
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-4 lg:pt-20">
          {shouldPromptFirstRunBackfill && backfillPreviewSummary ? (
            <div
              role="region"
              aria-label="Initialize public leaderboard"
              className="rounded-2xl border border-[#00F0FF]/40 bg-[#0c0e14]/90 p-4 text-xs space-y-2.5 shadow-lg"
            >
              <div className="flex items-start gap-2.5">
                <Info className="w-4 h-4 text-[#00F0FF] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1 flex-1">
                  <p className="font-bold text-white font-display uppercase tracking-wide">
                    Initialize Empty Public Leaderboard Projection?
                  </p>
                  <p className="text-zinc-300 leading-relaxed">
                    Ready to publish{' '}
                    <strong className="text-[#b5ff00]">{backfillPreviewSummary.eligibleCount}</strong> active builders
                    (excluding {backfillPreviewSummary.excludedInactiveCount} inactive and{' '}
                    {backfillPreviewSummary.excludedOptOutCount} opted-out) to{' '}
                    <code className="font-mono">publicLeaderboard</code>. Writes derived non-PII fields:{' '}
                    <span className="font-mono text-zinc-200">{backfillPreviewSummary.fieldsWritten.join(', ')}</span>.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <button
                  type="button"
                  onClick={handleConfirmFirstRunBackfill}
                  disabled={backfillPromptBusy}
                  className="min-h-11 px-4 py-2 rounded-xl bg-[#00F0FF] hover:bg-[#3bf4ff] text-black font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  {backfillPromptBusy ? 'Writing...' : 'Confirm & Backfill'}
                </button>
                <button
                  type="button"
                  onClick={() => setFirstRunBackfillDismissed(true)}
                  className="min-h-11 px-4 py-2 rounded-xl bg-zinc-900 border border-white/15 text-zinc-200 font-bold uppercase tracking-wider cursor-pointer"
                >
                  Not Now
                </button>
              </div>
            </div>
          ) : backfillPromptStatus ? (
            <div
              role="status"
              className="rounded-2xl border border-[#b5ff00]/30 bg-[#0c0e14]/90 px-4 py-2.5 text-xs text-[#b5ff00] flex items-center justify-between gap-2"
            >
              <span>{backfillPromptStatus}</span>
              <button
                type="button"
                onClick={() => setBackfillPromptStatus(null)}
                aria-label="Dismiss status"
                className="min-w-11 min-h-11 flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Workspace Content Shell: Full Width Main Viewport (Sidebar opens as an overlay drawer) */}
      <div className="flex-1 flex w-full max-w-7xl mx-auto items-stretch">
        {/* Main Viewport Content */}
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 pt-4 lg:pt-24 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-12 focus:outline-none"
        >
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="py-10 space-y-4"
            >
              <div className="h-28 rounded-3xl glass-panel animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="h-24 rounded-2xl glass-panel animate-pulse" />
                <div className="h-24 rounded-2xl glass-panel animate-pulse" />
                <div className="h-24 rounded-2xl glass-panel animate-pulse" />
              </div>
              <p className="text-center font-mono text-zinc-400 text-xs">Loading section...</p>
            </div>
          }
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {routeNotFound ? (
              <m.div key="not-found" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full min-w-0">
                <NotFoundView
                  invalidRoute={routeNotFound}
                  onReturnHome={() => handleSelectTab('home')}
                />
              </m.div>
            ) : (
            <>
            {activeTab === 'home' && (
              <m.div key="home" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full min-w-0">
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
              <m.div key="leaderboard" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full min-w-0">
                <PublicLeaderboardView
                  items={safePublicLeaderboardItems}
                  onOpenLogin={signInWithGoogle}
                />
              </m.div>
            )}

            {activeTab === 'kiosk' && (
              <m.div key="kiosk" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full min-w-0">
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
              <m.div key="sessions" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full min-w-0">
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
                  onCheckInToSession={(sId, mId) => handleRecordCheckIn(sId, mId, 'manual_entry')}
                  onRemoveCheckIn={(checkIn) => {
                    if (!isAdmin) return;
                    setDeleteTarget({
                      type: 'checkin',
                      id: checkIn.id,
                      checkIn,
                    });
                  }}
                  onUpdateSessionStatus={handleUpdateSessionStatus}
                  isHistoryBounded={isAdmin}
                  isLoadingHistory={isLoadingHistory}
                  hasLoadedAllHistory={hasLoadedAllHistory}
                  historyStartDate={adminMinSessionDate}
                  onLoadAllHistory={handleLoadAllHistory}
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
              <m.div key="participation" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full min-w-0">
                <MonthlyParticipationView
                  members={members}
                  sessions={sessions}
                  checkIns={checkIns}
                  isAdmin={isAdmin}
                  onOpenAdminLogin={() => setIsAdminLoginOpen(true)}
                  onOpenScanner={() => setIsScannerOpen(true)}
                  onViewMemberPass={(m) => setSelectedPassMember(m)}
                  isHistoryBounded={isAdmin}
                  isLoadingHistory={isLoadingHistory}
                  hasLoadedAllHistory={hasLoadedAllHistory}
                  historyStartMonthKey={adminMinMonthKey}
                  onLoadAllHistory={handleLoadAllHistory}
                />
              </m.div>
            )}

            {activeTab === 'members' && (
              <m.div key="members" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full min-w-0">
                <MembersView
                  members={members}
                  checkIns={checkIns}
                  sessions={sessions}
                  pendingRequests={allUsers.filter(
                    (u) => u.status === 'pending' || u.status === 'approved_waiting_response'
                  )}
                  allUsers={allUsers}
                  isAdmin={isAdmin}
                  isHistoryBounded={isAdmin}
                  isLoadingHistory={isLoadingHistory}
                  hasLoadedAllHistory={hasLoadedAllHistory}
                  historyStartMonthKey={adminMinMonthKey}
                  onLoadAllHistory={handleLoadAllHistory}
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
                  onDeleteMember={async (member) => {
                    if (!isAdmin) return;
                    const linkedUser = allUsers.find(
                      (u) => u.id === member.authUid || u.memberId === member.id
                    );
                    const isTargetSuperAdmin = Boolean(
                      linkedUser?.email?.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim()
                    );
                    let isTargetDelegatedAdmin = false;
                    const targetUid = member.authUid || linkedUser?.id;
                    if (!isTargetSuperAdmin && targetUid) {
                      const { checkIsAdmin } = await loadFirestoreService();
                      isTargetDelegatedAdmin = await checkIsAdmin(targetUid).catch(() => false);
                    }
                    setDeleteTarget({
                      type: 'member',
                      id: member.id,
                      member,
                      isTargetSuperAdmin,
                      isTargetDelegatedAdmin,
                    });
                  }}
                  onReactivateMember={async (member) => {
                    if (!isAdmin) return;
                    try {
                      const { reactivateMember } = await loadFirestoreService();
                      await reactivateMember(member.id);
                    } catch (err: any) {
                      console.error('Failed to reactivate member:', err);
                      setFirestoreError(formatUserFriendlyFirestoreError(err, 'Failed to reactivate member. Please try again.'));
                    }
                  }}
                  onViewMemberPass={(m) => setSelectedPassMember(m)}
                />
              </m.div>
            )}

            {activeTab === 'requests' && (
              <m.div key="requests" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="w-full min-w-0">
                {isAdmin ? (
                  <PendingRequests
                    members={members}
                    onOpenAddMemberWithPrefill={(prefill) => {
                      setEditingMember(null);
                      setPrefillMember(prefill);
                      setIsAddMemberOpen(true);
                    }}
                  />
                ) : (
                  <div className="max-w-2xl mx-auto py-12 px-4 text-center">
                    <div className="glass-panel p-8 rounded-3xl border border-amber-500/30 space-y-5 spatial-card">
                      <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
                        <ShieldAlert className="w-7 h-7" />
                      </div>
                      <div className="space-y-2">
                        <h2 className="text-xl font-bold font-display uppercase tracking-tight text-white">
                          Administrator Access Required
                        </h2>
                        <p className="text-sm text-zinc-300 leading-relaxed">
                          You are signed in as <span className="text-[#b5ff00] font-mono font-semibold">{user?.email || 'unknown'}</span>. This account is not an administrator. Ask the Super Administrator to make this account an admin, or sign in with the admin account.
                        </p>
                      </div>
                      <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => signOutUser()}
                          className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-mono text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                        >
                          <LogOut className="w-4 h-4 text-red-400" />
                          <span>Sign In with Admin Account</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectTab('home')}
                          className="px-4 py-2.5 rounded-xl bg-[#b5ff00] hover:bg-[#c4ff26] text-black font-mono text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                        >
                          <span>Back to Home</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </m.div>
            )}
            </>
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
          </div>
        </div>
      </footer>

      {/* Unified Primary Navigation Sidebar Drawer (Desktop Overlay at >= lg, Mobile Drawer at < lg) */}
      <AnimatePresence>
        {(isMoreOpen || navChrome.sidebarVisible) && (
          <div
            id="primary-sidebar-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Primary Navigation Menu"
            className="fixed inset-0 z-50 flex"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (navChrome.sidebarVisible) {
                  dispatchChrome({ type: 'escape' });
                }
                if (isMoreOpen) {
                  setIsMoreOpen(false);
                }
              }
            }}
          >
            {/* Backdrop Scrim */}
            <m.div
              variants={fade}
              initial="hidden"
              animate="show"
              exit="exit"
              transition={{ duration: reducedMotion ? 0 : 0.2 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => {
                if (navChrome.sidebarVisible) {
                  dispatchChrome({ type: 'scrimClick' });
                }
                if (isMoreOpen) {
                  setIsMoreOpen(false);
                }
              }}
              aria-hidden="true"
            />

            {/* Drawer Panel */}
            <m.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={reducedMotion ? { duration: 0 } : spring.sheet}
              className="relative w-80 max-w-[85vw] h-full flex flex-col z-10 shadow-2xl bg-[#0c0e14]"
            >
              <Suspense fallback={null}>
                <Sidebar
                  activeTab={activeTab}
                  onSelectTab={(tab) => {
                    handleSelectTab(tab);
                    if (navChrome.sidebarVisible) {
                      dispatchChrome({ type: 'selectDestination' });
                    }
                    if (isMoreOpen) {
                      setIsMoreOpen(false);
                    }
                  }}
                  pendingRequestsCount={pendingRequestsCount}
                  onOpenGuide={() => {
                    if (navChrome.sidebarVisible) dispatchChrome({ type: 'close' });
                    if (isMoreOpen) setIsMoreOpen(false);
                    setIsGuideOpen(true);
                  }}
                  onOpenAuditLogs={() => {
                    if (navChrome.sidebarVisible) dispatchChrome({ type: 'close' });
                    if (isMoreOpen) setIsMoreOpen(false);
                    setIsAuditLogsOpen(true);
                  }}
                  onOpenBackup={() => {
                    if (navChrome.sidebarVisible) dispatchChrome({ type: 'close' });
                    if (isMoreOpen) setIsMoreOpen(false);
                    setIsBackupOpen(true);
                  }}
                  onViewPass={() => {
                    if (navChrome.sidebarVisible) dispatchChrome({ type: 'close' });
                    if (isMoreOpen) setIsMoreOpen(false);
                    if (linkedMember) setSelectedPassMember(linkedMember);
                  }}
                  onOpenEditProfile={() => {
                    if (navChrome.sidebarVisible) dispatchChrome({ type: 'close' });
                    if (isMoreOpen) setIsMoreOpen(false);
                    setIsEditProfileOpen(true);
                  }}
                  isDrawer={true}
                  isMobileDrawer={isMoreOpen}
                  onClose={() => {
                    if (navChrome.sidebarVisible) dispatchChrome({ type: 'close' });
                    if (isMoreOpen) setIsMoreOpen(false);
                  }}
                  onCloseMobileDrawer={() => setIsMoreOpen(false)}
                  closeButtonRef={desktopSidebarCloseRef}
                  className="h-full w-full border-r border-white/10"
                />
              </Suspense>
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
        defaultHost={linkedMember?.name || user?.displayName || ''}
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

      {/* Builder Self Profile Editing Modal (Voluntary or Mandatory after approval) */}
      {(isEditProfileOpen || isMandatoryProfileRequired) && user && (
        <EditProfileModal
          isOpen={isEditProfileOpen || isMandatoryProfileRequired}
          isMandatory={isMandatoryProfileRequired}
          onClose={() => {
            setIsEditProfileOpen(false);
            setMandatoryProfileDismissed(true);
          }}
          member={
            linkedMember || {
              id: profile?.memberId || profile?.approvedMemberId || user.uid,
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
          memberPrivate={memberPrivate}
          onSignOut={signOutUser}
          onProfileUpdated={(updated) => {
            refreshProfile();
            if (updated) {
              setSelectedPassMember(updated);
            }
          }}
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

      {/* Super-Admin Database Backup & Recovery Modal */}
      <AdminBackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        members={members}
        users={allUsers}
        sessions={sessions}
      />
      </Suspense>
    </div>
  );
}
