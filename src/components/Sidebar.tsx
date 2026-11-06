import React from 'react';
import {
  Home,
  Calendar,
  TrendingUp,
  Trophy,
  Users,
  Monitor,
  UserCheck,
  History,
  Sparkles,
  QrCode,
  ShieldCheck,
  User,
  LogOut,
  ChevronRight,
  ExternalLink,
  Database,
} from 'lucide-react';
import { NavigationTab } from './Navbar';
import { useAuth } from '../firebase/AuthContext';
import { SUPER_ADMIN_EMAIL } from '../config/constants';
import { SecureAvatar } from './common/SecureAvatar';

interface SidebarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  pendingRequestsCount?: number;
  onOpenGuide: () => void;
  onOpenAuditLogs?: () => void;
  onOpenBackup?: () => void;
  onViewPass?: () => void;
  onOpenEditProfile?: () => void;
  className?: string;
  isMobileDrawer?: boolean;
  onCloseMobileDrawer?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  pendingRequestsCount = 0,
  onOpenGuide,
  onOpenAuditLogs,
  onOpenBackup,
  onViewPass,
  onOpenEditProfile,
  className = '',
  isMobileDrawer = false,
  onCloseMobileDrawer,
}) => {
  const { user, linkedMember, isAdmin, signOutUser } = useAuth();

  const handleItemClick = (tab: NavigationTab) => {
    onSelectTab(tab);
    if (isMobileDrawer && onCloseMobileDrawer) {
      onCloseMobileDrawer();
    }
  };

  const navItems = [
    {
      id: 'home' as NavigationTab,
      label: 'Home',
      description: 'Member overview & check-in',
      icon: Home,
      show: true,
    },
    {
      id: 'sessions' as NavigationTab,
      label: isAdmin ? 'Meetings' : 'Sessions',
      description: isAdmin ? 'Create & manage sessions' : 'Upcoming workshops',
      icon: Calendar,
      show: true,
    },
    {
      id: 'participation' as NavigationTab,
      label: 'Monthly Stats',
      description: 'Attendance & consistency',
      icon: TrendingUp,
      show: true,
    },
    {
      id: 'leaderboard' as NavigationTab,
      label: 'Leaderboard',
      description: 'Public rankings & streaks',
      icon: Trophy,
      show: true,
    },
    {
      id: 'members' as NavigationTab,
      label: 'Builders Roster',
      description: 'Guild member directory',
      icon: Users,
      show: true,
    },
  ];

  const adminItems = [
    {
      id: 'kiosk' as NavigationTab,
      label: 'Live Kiosk',
      description: 'Projector display & code',
      icon: Monitor,
      show: isAdmin,
    },
    {
      id: 'requests' as NavigationTab,
      label: 'Member Requests',
      description: 'Review applicants',
      icon: UserCheck,
      badge: pendingRequestsCount > 0 ? pendingRequestsCount : undefined,
      show: isAdmin,
    },
  ];

  return (
    <aside
      aria-label="Primary Navigation Sidebar"
      className={`flex flex-col bg-[#0c0e14]/90 backdrop-blur-2xl border-r border-white/[0.08] ${className}`}
    >
      {/* Sidebar Header / Brand (Only in Mobile Drawer mode; Desktop has top navbar) */}
      {isMobileDrawer && (
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-xl bg-zinc-900/60 border border-white/10 neu-raised-sm">
              <img
                src="/dob_logo-192.png"
                alt="Den of Builders"
                className="w-7 h-7 object-contain drop-shadow-[0_0_8px_rgba(181,255,0,0.3)]"
                width={28}
                height={28}
              />
            </div>
            <div>
              <span className="font-display font-black text-sm uppercase text-white tracking-tight block leading-tight">
                Den of Builders
              </span>
              <span className="text-[10px] font-mono text-[#b5ff00] uppercase tracking-wider block">
                Primary Navigation
              </span>
            </div>
          </div>
          {onCloseMobileDrawer && (
            <button
              type="button"
              onClick={onCloseMobileDrawer}
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              aria-label="Close sidebar menu"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 no-scrollbar">
        {/* Section 1: Primary Navigation */}
        <div className="space-y-1">
          <div className="px-3 pb-2 text-[10px] font-bold font-mono uppercase tracking-[0.18em] text-zinc-500 flex items-center justify-between">
            <span>Primary Sections</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#b5ff00]/60" />
          </div>

          <div className="space-y-1">
            {navItems
              .filter((item) => item.show)
              .map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleItemClick(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer group min-h-11 focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none ${
                      isActive
                        ? 'bg-[#181b24] text-[#b5ff00] border border-[#b5ff00]/30 shadow-[0_2px_12px_rgba(181,255,0,0.15)] font-bold'
                        : 'text-zinc-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        isActive ? 'text-[#b5ff00]' : 'text-zinc-400 group-hover:text-zinc-200'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-display uppercase tracking-wide truncate">
                        {item.label}
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate font-mono hidden xl:block">
                        {item.description}
                      </div>
                    </div>
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#b5ff00] shrink-0 shadow-[0_0_8px_rgba(181,255,0,0.8)]" />
                    )}
                  </button>
                );
              })}
          </div>
        </div>

        {/* Section 2: Admin Operations */}
        {isAdmin && (
          <div className="space-y-1 pt-2 border-t border-white/[0.06]">
            <div className="px-3 pb-2 text-[10px] font-bold font-mono uppercase tracking-[0.18em] text-zinc-500 flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3 text-[#b5ff00]" />
              <span>Admin Operations</span>
            </div>

            <div className="space-y-1">
              {adminItems
                .filter((item) => item.show)
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleItemClick(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer group min-h-11 focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none ${
                        isActive
                          ? 'bg-[#181b24] text-[#b5ff00] border border-[#b5ff00]/30 shadow-[0_2px_12px_rgba(181,255,0,0.15)] font-bold'
                          : 'text-zinc-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          isActive ? 'text-[#b5ff00]' : 'text-zinc-400 group-hover:text-zinc-200'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-display uppercase tracking-wide truncate">
                          {item.label}
                        </div>
                      </div>
                      {item.badge !== undefined && (
                        <span className="flex h-4 min-w-4 px-1.5 items-center justify-center rounded-full bg-amber-400 text-black text-[10px] font-bold font-mono shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}

              {onOpenAuditLogs && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenAuditLogs();
                    if (isMobileDrawer && onCloseMobileDrawer) onCloseMobileDrawer();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-all cursor-pointer group min-h-11 border border-transparent focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:outline-none"
                >
                  <History className="h-4 w-4 shrink-0 text-purple-400/80 group-hover:text-purple-300" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-display uppercase tracking-wide truncate">
                      Security Audit Log
                    </div>
                  </div>
                </button>
              )}

              {onOpenBackup && user?.email?.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim() && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenBackup();
                    if (isMobileDrawer && onCloseMobileDrawer) onCloseMobileDrawer();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-all cursor-pointer group min-h-11 border border-transparent focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
                >
                  <Database className="h-4 w-4 shrink-0 text-[#b5ff00]/80 group-hover:text-[#b5ff00]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-display uppercase tracking-wide truncate">
                      Database Backup
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Section 3: Guild Tools & Quick Actions */}
        <div className="space-y-1 pt-2 border-t border-white/[0.06]">
          <div className="px-3 pb-2 text-[10px] font-bold font-mono uppercase tracking-[0.18em] text-zinc-500">
            Resources & Pass
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                onOpenGuide();
                if (isMobileDrawer && onCloseMobileDrawer) onCloseMobileDrawer();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-zinc-400 hover:text-white hover:bg-white/[0.04] transition-all cursor-pointer group min-h-11 border border-transparent focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
            >
              <Sparkles className="h-4 w-4 shrink-0 text-[#b5ff00]/80 group-hover:text-[#b5ff00]" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-display uppercase tracking-wide truncate">
                  Guild Handbook
                </div>
                <div className="text-[10px] text-zinc-500 truncate font-mono hidden xl:block">
                  Scoring &amp; ranks guide
                </div>
              </div>
            </button>

            {linkedMember && onViewPass && (
              <button
                type="button"
                onClick={() => {
                  onViewPass();
                  if (isMobileDrawer && onCloseMobileDrawer) onCloseMobileDrawer();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-zinc-400 hover:text-[#b5ff00] hover:bg-white/[0.04] transition-all cursor-pointer group min-h-11 border border-transparent focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
              >
                <QrCode className="h-4 w-4 shrink-0 text-[#b5ff00]" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-display uppercase tracking-wide truncate">
                    Digital Member Pass
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate font-mono hidden xl:block">
                    Your personal check-in QR
                  </div>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar Footer: Builder Profile Card & Smooth Log Out */}
      {user && (
        <div className="p-3 border-t border-white/[0.08] bg-zinc-950/60 space-y-2">
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-zinc-900/60 border border-white/5 neu-inset">
            <SecureAvatar
              src={linkedMember?.avatarUrl || user.photoURL}
              name={linkedMember?.name || user.displayName}
              size={32}
              className="border border-[#b5ff00]/40 shrink-0"
              fallbackClassName="text-xs font-bold text-[#b5ff00]"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-white truncate font-display">
                {linkedMember ? linkedMember.name : user.displayName || 'Club Builder'}
              </div>
              <div className="text-[10px] text-zinc-400 font-mono truncate">
                {linkedMember ? linkedMember.handle : user.email}
              </div>
            </div>

            {onOpenEditProfile && (
              <button
                type="button"
                onClick={() => {
                  onOpenEditProfile();
                  if (isMobileDrawer && onCloseMobileDrawer) onCloseMobileDrawer();
                }}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
                title="Edit Profile"
                aria-label="Edit Profile"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={async () => {
              if (isMobileDrawer && onCloseMobileDrawer) onCloseMobileDrawer();
              await signOutUser();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-red-950/20 hover:bg-red-950/50 border border-red-500/20 hover:border-red-500/40 text-red-300 hover:text-red-200 text-xs font-bold font-mono uppercase tracking-wider transition-all cursor-pointer min-h-10 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
            title="Log out of account"
            aria-label="Log out of account"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Log Out</span>
          </button>
        </div>
      )}
    </aside>
  );
};
