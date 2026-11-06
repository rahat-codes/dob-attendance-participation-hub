import React, { useState, useEffect, useRef } from 'react';
import {
  Home,
  Calendar,
  TrendingUp,
  Trophy,
  Users,
  Monitor,
  UserCheck,
  Scan,
  Bell,
  User,
  LogOut,
  HelpCircle,
  History,
  Database,
  Menu,
  Sparkles,
  QrCode,
  LogIn,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { NavigationTab } from '../components/Navbar';
import { useAuth } from '../firebase/AuthContext';
import { SUPER_ADMIN_EMAIL } from '../config/constants';
import { SecureAvatar } from '../components/common/SecureAvatar';
import { IconOrb } from './IconOrb';

export interface IslandNavProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  onOpenQuickScan: () => void;
  onOpenNewSession?: () => void;
  onOpenGuide: () => void;
  onOpenAdminLogin?: () => void;
  onOpenNotifications?: () => void;
  onOpenAuditLogs?: () => void;
  onOpenBackup?: () => void;
  onOpenMore?: () => void;
  onOpenEditProfile?: () => void;
  onViewPass?: () => void;
  pendingRequestsCount?: number;
  unreadNotificationsCount?: number;
  isModalOpen?: boolean;
}

export const IslandNav: React.FC<IslandNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenQuickScan,
  onOpenNewSession,
  onOpenGuide,
  onOpenAdminLogin,
  onOpenNotifications,
  onOpenAuditLogs,
  onOpenBackup,
  onOpenMore,
  onOpenEditProfile,
  onViewPass,
  pendingRequestsCount = 0,
  unreadNotificationsCount = 0,
  isModalOpen = false,
}) => {
  const { user, profile, linkedMember, isAdmin, signOutUser, handleSignIn, signingIn } = useAuth();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Keyboard-aware hiding via visualViewport to prevent covering form inputs
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleViewportChange = () => {
      const vv = window.visualViewport;
      if (vv) {
        setIsKeyboardVisible(vv.height < window.innerHeight * 0.75);
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        setIsKeyboardVisible(true);
      }
    };

    const handleFocusOut = () => {
      setIsKeyboardVisible(false);
    };

    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // Close desktop avatar menu on outside click or Escape
  useEffect(() => {
    if (!isUserMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUserMenuOpen]);

  // Fullscreen Kiosk mode hides regular navigation islands
  if (activeTab === 'kiosk' || isKeyboardVisible) {
    return null;
  }

  // Mobile Core 5-Slot items
  const mobileNavItems = [
    { id: 'home' as NavigationTab, label: 'Home', icon: Home },
    { id: 'sessions' as NavigationTab, label: 'Sessions', icon: Calendar },
    { id: 'scan' as const, label: 'Scan', icon: Scan, isScanAction: true },
    { id: 'leaderboard' as NavigationTab, label: 'Rankings', icon: Trophy },
    { id: 'more' as const, label: 'More', icon: Menu, isMoreAction: true },
  ];

  // Desktop Island Items
  const desktopNavItems = [
    { id: 'home' as NavigationTab, label: 'Home', icon: Home, show: true },
    { id: 'sessions' as NavigationTab, label: 'Sessions', icon: Calendar, show: true },
    { id: 'participation' as NavigationTab, label: 'Stats', icon: TrendingUp, show: true },
    { id: 'leaderboard' as NavigationTab, label: 'Leaderboard', icon: Trophy, show: true },
    { id: 'members' as NavigationTab, label: 'Roster', icon: Users, show: true },
    { id: 'requests' as NavigationTab, label: 'Requests', icon: UserCheck, badge: pendingRequestsCount, show: isAdmin },
  ];

  return (
    <>
      {/* =========================================================================
          1. MOBILE BOTTOM ISLAND (< lg / below 1024px)
          Floating pill, 12px above safe-area, max-w-lg, centered
          ========================================================================= */}
      <nav
        aria-label="Mobile Island Navigation"
        className={`lg:hidden fixed left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+8px)] z-40 max-w-[380px] mx-auto island-nav rounded-full px-2 py-1 shadow-2xl transition-all duration-200 ${
          isModalOpen ? 'opacity-30 pointer-events-none scale-95' : 'opacity-100 scale-100'
        }`}
      >
        <div className="flex items-center justify-between gap-0.5 px-0.5">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;

            // Center Scan Action Orb (compact tactile lime pill)
            if (item.isScanAction) {
              return (
                <button
                  key="scan-trigger"
                  type="button"
                  onClick={onOpenQuickScan}
                  aria-label="Open Camera QR Scanner"
                  className="relative -top-1 flex flex-col items-center justify-center p-0.5 rounded-full cursor-pointer transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00]"
                >
                  <span className="w-10 h-10 rounded-full orb-accent flex items-center justify-center shadow-[0_0_14px_rgba(181,255,0,0.4)]">
                    <Scan className="w-4 h-4 text-black" />
                  </span>
                  <span className="text-[9px] font-display font-extrabold text-[#b5ff00] mt-0.5 uppercase tracking-wider">
                    Scan
                  </span>
                </button>
              );
            }

            // More Menu Trigger (carries pending badges if secondary tabs have notifications)
            if (item.isMoreAction) {
              const hasBadge = (pendingRequestsCount > 0 && isAdmin) || unreadNotificationsCount > 0;

              return (
                <button
                  key="more-trigger"
                  type="button"
                  onClick={onOpenMore}
                  aria-label="Open More Menu and Settings"
                  className="relative flex flex-col items-center justify-center py-1 px-2.5 rounded-full text-zinc-400 hover:text-white transition-all cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00]"
                >
                  <div className="relative">
                    <Menu className="w-4 h-4" />
                    {hasBadge && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 border border-black animate-pulse" />
                    )}
                  </div>
                  <span className="text-[9px] font-display font-bold uppercase tracking-wider mt-0.5">
                    More
                  </span>
                </button>
              );
            }

            // Standard Tab Slots
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id as NavigationTab)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center py-1 px-2.5 rounded-full transition-all cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00] ${
                  isActive
                    ? 'text-black font-extrabold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {isActive && (
                  <span
                    className="absolute inset-0 rounded-full bg-[#b5ff00] shadow-[0_0_12px_rgba(181,255,0,0.35),inset_0_1px_0_rgba(255,255,255,0.6)] z-0"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10 flex flex-col items-center">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-black' : 'text-current'}`} />
                  <span className={`text-[9px] font-display uppercase tracking-wider mt-0.5 ${isActive ? 'text-black font-extrabold' : ''}`}>
                    {item.label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* =========================================================================
          2. DESKTOP FLOATING TOP ISLANDS (>= lg / 1024px and up)
          Centered detached pill for primary tabs + top-right utility island
          ========================================================================= */}
      <header
        aria-label="Desktop Island Navigation"
        className={`hidden lg:flex fixed top-[calc(env(safe-area-inset-top)+14px)] inset-x-8 z-40 items-center justify-between pointer-events-none transition-all duration-200 ${
          isModalOpen ? 'opacity-30 pointer-events-none' : 'opacity-100'
        }`}
      >
        {/* Left: Brand Identity Pill */}
        <div className="pointer-events-auto island-nav rounded-full px-4 py-2 flex items-center gap-3">
          <img
            src="/dob_logo-192.png"
            alt="Den of Builders"
            className="w-7 h-7 object-contain drop-shadow-[0_0_10px_rgba(181,255,0,0.4)]"
            width={28}
            height={28}
          />
          <div>
            <span className="font-display font-black text-xs uppercase tracking-tight text-white block leading-none">
              Den of Builders
            </span>
            <span className="text-[9px] font-mono text-[#b5ff00] uppercase tracking-widest block mt-0.5">
              Attendance Hub
            </span>
          </div>
        </div>

        {/* Center: Primary Navigation Island (Max 720px) */}
        <nav
          aria-label="Primary Tabs"
          className="pointer-events-auto island-nav rounded-full p-1.5 flex items-center gap-1 shadow-2xl"
        >
          {desktopNavItems
            .filter((item) => item.show)
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative px-4 py-2 rounded-full font-display text-xs uppercase tracking-wider font-bold transition-all cursor-pointer flex items-center gap-2 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00] ${
                    isActive
                      ? 'text-black font-extrabold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {isActive && (
                    <span
                      className="absolute inset-0 rounded-full bg-[#b5ff00] shadow-[0_0_16px_rgba(181,255,0,0.35),inset_0_1px_0_rgba(255,255,255,0.65)] z-0"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-black' : 'text-current'}`} />
                    <span>{item.label}</span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                          isActive ? 'bg-black text-[#b5ff00]' : 'bg-amber-500 text-black'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
        </nav>

        {/* Right: Utility & Profile Island */}
        <div className="pointer-events-auto flex items-center gap-2.5">
          {/* Quick Scan Action Orb */}
          <IconOrb
            variant="accent"
            size="sm"
            icon={<Scan className="w-4 h-4 text-black" />}
            aria-label="Quick Scan QR Code"
            onClick={onOpenQuickScan}
            title="Scan Workshop QR Code"
          />

          {/* Notifications Orb */}
          {onOpenNotifications && (
            <IconOrb
              variant="onyx"
              size="sm"
              icon={<Bell className="w-4 h-4" />}
              aria-label="View Meeting Notifications"
              badgeCount={unreadNotificationsCount}
              onClick={onOpenNotifications}
              title="Notifications"
            />
          )}

          {/* User Account Island / Avatar Popover */}
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
              aria-expanded={isUserMenuOpen}
              aria-label="Open Account Menu"
              className="island-nav rounded-full p-1 pl-1.5 pr-2.5 flex items-center gap-2 cursor-pointer transition-all hover:border-[#b5ff00]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00]"
            >
              <SecureAvatar
                src={linkedMember?.avatarUrl || user?.photoURL}
                name={linkedMember?.name || user?.displayName || 'Builder'}
                size={30}
                className="border border-[#b5ff00]/50"
                fallbackClassName="text-[11px] font-bold text-[#b5ff00]"
              />
              <span className="text-xs font-display font-bold text-white max-w-[90px] truncate">
                {linkedMember ? linkedMember.name.split(' ')[0] : user?.displayName?.split(' ')[0] || 'Builder'}
              </span>
            </button>

            {/* Desktop Account Popover Sheet */}
            {isUserMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 rounded-[24px] island-nav p-4 shadow-2xl space-y-3 z-50 animate-in fade-in zoom-in-95 duration-150">
                {/* Account Details Header */}
                <div className="border-b border-white/[0.08] pb-3">
                  <div className="flex items-center gap-2.5">
                    <SecureAvatar
                      src={linkedMember?.avatarUrl || user?.photoURL}
                      name={linkedMember?.name || user?.displayName}
                      size={36}
                      className="border border-[#b5ff00]/40"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold font-display text-white truncate">
                        {linkedMember?.name || user?.displayName || 'Builder'}
                      </p>
                      <p className="text-[11px] text-zinc-400 font-mono truncate">
                        {user?.email}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    {user?.email?.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim() ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-mono font-bold uppercase">
                        Super Admin
                      </span>
                    ) : isAdmin ? (
                      <span className="px-2 py-0.5 rounded-full bg-[#b5ff00]/20 text-[#b5ff00] border border-[#b5ff00]/40 text-[9px] font-mono font-bold uppercase">
                        Admin
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 text-[9px] font-mono font-bold uppercase">
                        Member
                      </span>
                    )}
                  </div>
                </div>

                {/* Account Menu Actions */}
                <div className="space-y-1 text-xs">
                  {onViewPass && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onViewPass();
                      }}
                      className="w-full px-3 py-2 rounded-xl text-left text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5 text-[#b5ff00]" />
                      <span>Digital Builder Pass</span>
                    </button>
                  )}

                  {onOpenEditProfile && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenEditProfile();
                      }}
                      className="w-full px-3 py-2 rounded-xl text-left text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      <User className="w-3.5 h-3.5 text-[#b5ff00]" />
                      <span>Edit Profile</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenGuide();
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Club Guide &amp; Scoring</span>
                  </button>

                  {isAdmin && onOpenAuditLogs && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenAuditLogs();
                      }}
                      className="w-full px-3 py-2 rounded-xl text-left text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5 text-amber-400" />
                      <span>Security Audit Logs</span>
                    </button>
                  )}

                  {isAdmin && onOpenBackup && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenBackup();
                      }}
                      className="w-full px-3 py-2 rounded-xl text-left text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      <Database className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Database Backup &amp; CSV</span>
                    </button>
                  )}
                </div>

                {/* Sign Out Button */}
                <div className="pt-2 border-t border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      signOutUser();
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-colors flex items-center gap-2 cursor-pointer font-bold text-xs"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Dedicated Instant Log Out Button */}
          {user && (
            <IconOrb
              variant="onyx"
              size="sm"
              icon={<LogOut className="w-4 h-4 text-red-400" />}
              aria-label="Log Out of Account"
              onClick={signOutUser}
              title="Log Out"
            />
          )}
        </div>
      </header>
    </>
  );
};
