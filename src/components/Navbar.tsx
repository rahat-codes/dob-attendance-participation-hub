import React, { useState, useEffect, useRef } from 'react';
import {
  Scan,
  Plus,
  ShieldCheck,
  User,
  LogOut,
  Lock,
  Bell,
  ChevronDown,
  Menu,
  QrCode,
  Sparkles,
  RefreshCw,
  Database,
  BookOpen,
} from 'lucide-react';
import { m, AnimatePresence } from 'motion/react';
import { Member } from '../types';
import { useAuth } from '../firebase/AuthContext';
import { SUPER_ADMIN_EMAIL } from '../config/constants';
import { scaleIn, spring } from '../motion/presets';

export type NavigationTab =
  | 'home'
  | 'leaderboard'
  | 'kiosk'
  | 'scanner'
  | 'participation'
  | 'sessions'
  | 'members'
  | 'requests'
  | 'verify';

interface NavbarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  onOpenQuickScan: () => void;
  onOpenNewSession: () => void;
  onOpenGuide: () => void;
  onOpenAdminLogin?: () => void;
  members: Member[];
  pendingRequestsCount?: number;
  unreadNotificationsCount?: number;
  onOpenNotifications?: () => void;
  onOpenAuditLogs?: () => void;
  onOpenBackup?: () => void;
  onOpenMore?: () => void;
  onOpenEditProfile?: () => void;
  onViewPass?: () => void;
  onToggleSidebar?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  onOpenQuickScan,
  onOpenNewSession,
  onOpenGuide,
  onOpenAdminLogin,
  members,
  pendingRequestsCount = 0,
  unreadNotificationsCount = 0,
  onOpenNotifications,
  onOpenAuditLogs,
  onOpenBackup,
  onOpenMore,
  onOpenEditProfile,
  onViewPass,
  onToggleSidebar,
}) => {
  const { user, profile, linkedMember, isAdmin, signOutUser, handleSignIn, signingIn } = useAuth();
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const avatarMenuRef = useRef<HTMLDivElement>(null);

  // Close desktop avatar menu on outside click or Escape key
  useEffect(() => {
    if (!isAvatarMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target as Node)) {
        setIsAvatarMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAvatarMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAvatarMenuOpen]);

  const tabTitles: Record<NavigationTab, string> = {
    home: 'Home',
    sessions: isAdmin ? 'Meetings' : 'Sessions',
    participation: 'Monthly Stats',
    members: 'Builders Roster',
    leaderboard: 'Leaderboard',
    kiosk: 'Live Kiosk',
    scanner: 'Scan QR',
    requests: 'Requests',
    verify: 'Verify Access',
  };

  return (
    <header className="sticky top-0 z-30 w-full border-b border-white/[0.08] bg-[#0c0e14]/95 backdrop-blur-2xl shadow-[0_4px_30px_rgba(0,0,0,0.5)] pt-safe">
      <div className="mx-auto flex h-16 w-full items-center justify-between px-3 sm:px-6 lg:px-8 gap-2 sm:gap-4">
        {/* Left Section: Brand Logo + Section Indicator */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Logo Brand Link */}
          <button
            type="button"
            onClick={() => onSelectTab(isAdmin ? 'sessions' : 'home')}
            className="flex items-center gap-2 sm:gap-2.5 text-left group transition-all shrink min-w-0 cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none p-1"
            title="Den of Builders Hub"
          >
            <div className="relative p-1 rounded-xl bg-zinc-900/60 border border-white/10 neu-raised-sm group-hover:border-[#b5ff00]/40 transition-all flex items-center justify-center shrink-0">
              <img
                src="/dob_logo-192.png"
                alt="Den of Builders"
                className="w-7 h-7 sm:w-8 sm:h-8 object-contain drop-shadow-[0_0_8px_rgba(181,255,0,0.3)] group-hover:rotate-12 transition-transform duration-500 shrink-0"
                width={32}
                height={32}
                loading="eager"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = '/logo.svg';
                }}
              />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-display font-black tracking-tight text-xs sm:text-base lg:text-lg uppercase group-hover:text-[#b5ff00] transition-colors leading-none text-white truncate">
                Den of Builders
              </span>
              <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500 mt-1 leading-none whitespace-nowrap font-mono">
                Attendance Hub
              </span>
            </div>
          </button>
        </div>

        {/* Center Section: Top Navigation for 1024px and up (lg:flex) */}
        <nav
          aria-label="Desktop Primary Navigation"
          className="hidden lg:flex items-center gap-1 lg:gap-1.5 bg-[#141720]/80 p-1 rounded-xl border border-white/5 neu-inset"
        >
          <button
            type="button"
            onClick={() => onSelectTab('sessions')}
            aria-current={activeTab === 'sessions' ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
              activeTab === 'sessions'
                ? 'bg-[#1e2230] text-[#b5ff00] font-bold border border-[#b5ff00]/30 shadow-[0_2px_8px_rgba(181,255,0,0.15)]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Sessions
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('participation')}
            aria-current={activeTab === 'participation' ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
              activeTab === 'participation'
                ? 'bg-[#1e2230] text-[#b5ff00] font-bold border border-[#b5ff00]/30 shadow-[0_2px_8px_rgba(181,255,0,0.15)]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Participation
          </button>

          <button
            type="button"
            onClick={() => onSelectTab(isAdmin ? 'members' : 'leaderboard')}
            aria-current={activeTab === 'members' || activeTab === 'leaderboard' ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
              activeTab === 'members' || activeTab === 'leaderboard'
                ? 'bg-[#1e2230] text-[#b5ff00] font-bold border border-[#b5ff00]/30 shadow-[0_2px_8px_rgba(181,255,0,0.15)]'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {isAdmin ? 'Builders' : 'Leaderboard'}
          </button>

          {isAdmin ? (
            <button
              type="button"
              onClick={() => onSelectTab('requests')}
              aria-current={activeTab === 'requests' ? 'page' : undefined}
              className={`relative px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                activeTab === 'requests'
                  ? 'bg-[#1e2230] text-[#b5ff00] font-bold border border-[#b5ff00]/30 shadow-[0_2px_8px_rgba(181,255,0,0.15)]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>Admin</span>
              {pendingRequestsCount > 0 && (
                <span className="ml-1.5 px-1 py-0.2 rounded-full bg-amber-400 text-black text-[9px] font-bold">
                  {pendingRequestsCount}
                </span>
              )}
            </button>
          ) : (
            onOpenAdminLogin && (
              <button
                type="button"
                onClick={onOpenAdminLogin}
                className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-zinc-400 hover:text-[#b5ff00] transition-colors cursor-pointer flex items-center gap-1"
              >
                <Lock className="w-3 h-3" />
                <span>Admin</span>
              </button>
            )
          )}
        </nav>

        {/* Right Section: Global Actions (1 primary action + 1 avatar/menu button; or 1 Sign In button) */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 flex-nowrap">
          {user ? (
            <>
              {/* Primary Action: Scan QR (hidden on Home tab where Hero scan action is prominent) */}
              {activeTab !== 'home' && (
                <m.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={onOpenQuickScan}
                  aria-label="Scan QR Code"
                  className="flex items-center justify-center gap-1.5 p-2 sm:px-3.5 sm:py-2 text-xs font-bold text-black bg-[#b5ff00] hover:bg-[#c4ff26] rounded-xl transition-colors whitespace-nowrap shadow-[0_0_15px_rgba(181,255,0,0.3)] cursor-pointer uppercase tracking-wider font-mono border border-white/20 min-h-[44px] min-w-[44px] sm:min-w-0 sm:min-h-11 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                  title="Scan Meeting QR Code"
                >
                  <Scan className="h-4 w-4 stroke-[2.5] shrink-0" />
                  <span className="hidden sm:inline">SCAN QR</span>
                </m.button>
              )}

              {/* Single Avatar/Menu Button */}
              <div className="relative" ref={avatarMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsAvatarMenuOpen(!isAvatarMenuOpen)}
                  className="flex items-center gap-1.5 p-1 rounded-xl bg-[#141720] border border-white/10 neu-button hover:border-white/20 transition-all cursor-pointer min-h-[44px] min-w-[44px] justify-center focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
                  aria-expanded={isAvatarMenuOpen}
                  aria-haspopup="true"
                  aria-label="Open user account menu"
                >
                  <div className="relative">
                    {linkedMember?.avatarUrl || user.photoURL ? (
                      <img
                        src={linkedMember?.avatarUrl || user.photoURL || ''}
                        alt="avatar"
                        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover border border-[#b5ff00]/40 shrink-0"
                        width={32}
                        height={32}
                      />
                    ) : (
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-[#b5ff00] shrink-0">
                        <User className="h-4 w-4" />
                      </div>
                    )}
                    <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-[#b5ff00] ring-2 ring-[#0c0e14]" />
                  </div>
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-zinc-400 transition-transform hidden sm:block ${
                      isAvatarMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Avatar Dropdown Menu */}
                <AnimatePresence>
                  {isAvatarMenuOpen && (
                    <m.div
                      role="menu"
                      variants={scaleIn}
                      initial="hidden"
                      animate="show"
                      exit="exit"
                      style={{ transformOrigin: 'top right' }}
                      className="absolute right-0 mt-2 w-56 rounded-2xl glass-modal p-2 shadow-2xl z-50 border border-white/10 neu-raised"
                    >
                      <div className="p-2.5 border-b border-white/5 mb-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-white truncate font-display">
                            {linkedMember ? linkedMember.name : user.displayName || 'Club Builder'}
                          </span>
                          {isAdmin ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#b5ff00]/15 text-[#b5ff00] border border-[#b5ff00]/30 uppercase shrink-0">
                              Admin
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-800 text-zinc-300 border border-zinc-700 uppercase shrink-0">
                              Member
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        {linkedMember && onViewPass && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setIsAvatarMenuOpen(false);
                              onViewPass();
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.06] rounded-xl transition-colors cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
                          >
                            <QrCode className="h-4 w-4 text-[#b5ff00] shrink-0" />
                            <span>Digital Member Pass</span>
                          </button>
                        )}

                        {onOpenEditProfile && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setIsAvatarMenuOpen(false);
                              onOpenEditProfile();
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.06] rounded-xl transition-colors cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
                          >
                            <User className="h-4 w-4 text-zinc-400 shrink-0" />
                            <span>Edit Builder Profile</span>
                          </button>
                        )}

                        {onOpenBackup && user?.email?.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim() && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setIsAvatarMenuOpen(false);
                              onOpenBackup();
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-[#b5ff00] hover:bg-[#b5ff00]/10 rounded-xl transition-colors cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
                          >
                            <Database className="h-4 w-4 text-[#b5ff00] shrink-0" />
                            <span>Database Backup</span>
                          </button>
                        )}

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setIsAvatarMenuOpen(false);
                            onOpenGuide();
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.06] rounded-xl transition-colors cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
                        >
                          <BookOpen className="h-4 w-4 text-zinc-400 shrink-0" />
                          <span>Hub Guide &amp; Rules</span>
                        </button>

                        <div className="pt-1 mt-1 border-t border-white/5">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setIsAvatarMenuOpen(false);
                              signOutUser();
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-xl transition-colors cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
                          >
                            <LogOut className="h-4 w-4 shrink-0" />
                            <span>Sign Out</span>
                          </button>
                        </div>
                      </div>
                    </m.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenGuide}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono text-zinc-300 hover:text-white bg-[#141720] hover:bg-zinc-800 border border-white/10 rounded-xl transition-colors cursor-pointer min-h-[44px]"
                title="Hub Guide &amp; Documentation"
                aria-label="Attendance Guide"
              >
                <BookOpen className="h-4 w-4 text-[#b5ff00] shrink-0" />
                <span className="hidden sm:inline">Guide</span>
              </button>
              <button
                type="button"
                onClick={handleSignIn}
                disabled={signingIn}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-black bg-[#b5ff00] hover:bg-[#c4ff26] disabled:opacity-50 rounded-xl cursor-pointer min-h-[44px] min-w-[44px] font-mono uppercase tracking-wider shadow-[0_0_12px_rgba(181,255,0,0.3)] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none shrink-0"
              >
                {signingIn ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span className="hidden sm:inline">Signing In...</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    <span>Sign In</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
