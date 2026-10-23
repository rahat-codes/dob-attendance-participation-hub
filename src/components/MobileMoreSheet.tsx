import React from 'react';
import {
  Monitor,
  UserCheck,
  History,
  HelpCircle,
  LogOut,
  User,
  ShieldCheck,
  Trophy,
  Calendar,
  Sparkles,
  QrCode,
  TrendingUp,
  Users,
  Home,
  Bell,
  ExternalLink,
} from 'lucide-react';
import { ModalSheet } from './ModalSheet';
import { NavigationTab } from './Navbar';
import { useAuth } from '../firebase/AuthContext';

interface MobileMoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: NavigationTab) => void;
  onOpenGuide: () => void;
  onOpenAuditLogs?: () => void;
  onOpenEditProfile?: () => void;
  onViewPass?: () => void;
  onOpenNotifications?: () => void;
  pendingRequestsCount?: number;
  unreadNotificationsCount?: number;
}

export const MobileMoreSheet: React.FC<MobileMoreSheetProps> = ({
  isOpen,
  onClose,
  onSelectTab,
  onOpenGuide,
  onOpenAuditLogs,
  onOpenEditProfile,
  onViewPass,
  onOpenNotifications,
  pendingRequestsCount = 0,
  unreadNotificationsCount = 0,
}) => {
  const { user, profile, linkedMember, isAdmin, signOutUser } = useAuth();

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Menu & Controls"
      subtitle={user?.email || 'Den of Builders Hub'}
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* User Card / Access Level Summary */}
        <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-white/10 space-y-2">
          <div className="flex items-center gap-3">
            {linkedMember?.avatarUrl || user?.photoURL ? (
              <img
                src={linkedMember?.avatarUrl || user?.photoURL || ''}
                alt="avatar"
                className="w-10 h-10 rounded-full object-cover border border-[#b5ff00]/40 shrink-0"
                width={40}
                height={40}
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-[#b5ff00] shrink-0">
                <User className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-sm truncate font-display">
                  {linkedMember ? linkedMember.name : user?.displayName || 'Club Builder'}
                </h3>
                {isAdmin ? (
                  <span className="px-2 py-0.5 rounded-md bg-[#b5ff00]/15 text-[#b5ff00] border border-[#b5ff00]/30 text-[10px] font-bold uppercase font-mono">
                    Admin
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-bold uppercase font-mono">
                    Member
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 font-mono truncate">
                {linkedMember ? linkedMember.handle : user?.email}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-white/5 text-xs text-zinc-300 font-sans">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#b5ff00]" />
              {isAdmin ? 'Full System Authority' : 'Verified Guild Member'}
            </span>
            {linkedMember && onViewPass && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onViewPass();
                }}
                className="text-[#b5ff00] hover:underline font-semibold font-mono text-xs cursor-pointer py-1 px-2 rounded-md hover:bg-[#b5ff00]/10 focus-visible:ring-2 focus-visible:ring-[#b5ff00]"
              >
                View Pass
              </button>
            )}
          </div>
        </div>

        {/* Admin Section (Only for Admin) */}
        {isAdmin && (
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono px-1">
              Admin Operations
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => {
                  onSelectTab('kiosk');
                  onClose();
                }}
                className="w-full min-h-12 flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-[#b5ff00]/30 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
              >
                <div className="flex items-center gap-3">
                  <Monitor className="w-5 h-5 text-[#b5ff00] shrink-0" />
                  <div>
                    <div className="font-bold text-sm text-zinc-200">Live Kiosk Display</div>
                    <div className="text-xs text-zinc-400">Rotating QR code display for projector/tablet</div>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectTab('requests');
                  onClose();
                }}
                className="w-full min-h-12 flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-[#b5ff00]/30 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
              >
                <div className="flex items-center gap-3">
                  <UserCheck className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <div className="font-bold text-sm text-zinc-200 flex items-center gap-2">
                      <span>Pending Member Requests</span>
                      {pendingRequestsCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-black text-xs font-bold font-mono">
                          {pendingRequestsCount}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-400">Review new builder sign-up applications</div>
                  </div>
                </div>
              </button>

              {onOpenAuditLogs && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuditLogs();
                  }}
                  className="w-full min-h-12 flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-purple-400/30 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:outline-none"
                >
                  <div className="flex items-center gap-3">
                    <History className="w-5 h-5 text-purple-400 shrink-0" />
                    <div>
                      <div className="font-bold text-sm text-zinc-200">Security Audit Trail</div>
                      <div className="text-xs text-zinc-400">Immutable log of admin actions &amp; deletions</div>
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Guild Navigation & Records Section (Ensures members can reach Participation and Builders on mobile) */}
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono px-1">
            Guild Navigation
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onSelectTab('home');
                onClose();
              }}
              className="w-full min-h-12 flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-[#b5ff00]/30 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
            >
              <Home className="w-5 h-5 text-[#b5ff00] shrink-0" />
              <div>
                <div className="font-bold text-sm text-zinc-200">Member Home</div>
                <div className="text-xs text-zinc-400">Personal dashboard &amp; streaks</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectTab('sessions');
                onClose();
              }}
              className="w-full min-h-12 flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-[#b5ff00]/30 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
            >
              <Calendar className="w-5 h-5 text-[#b5ff00] shrink-0" />
              <div>
                <div className="font-bold text-sm text-zinc-200">Meetings &amp; Sessions</div>
                <div className="text-xs text-zinc-400">Schedule &amp; past meetings</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectTab('participation');
                onClose();
              }}
              className="w-full min-h-12 flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-[#b5ff00]/30 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
            >
              <TrendingUp className="w-5 h-5 text-[#b5ff00] shrink-0" />
              <div>
                <div className="font-bold text-sm text-zinc-200">Monthly Stats</div>
                <div className="text-xs text-zinc-400">Attendance analytics &amp; rates</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectTab('members');
                onClose();
              }}
              className="w-full min-h-12 flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-[#b5ff00]/30 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
            >
              <Users className="w-5 h-5 text-[#b5ff00] shrink-0" />
              <div>
                <div className="font-bold text-sm text-zinc-200">Builder Roster</div>
                <div className="text-xs text-zinc-400">Member directory &amp; tracks</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectTab('leaderboard');
                onClose();
              }}
              className="w-full min-h-12 flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 hover:border-[#b5ff00]/30 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none sm:col-span-2"
            >
              <Trophy className="w-5 h-5 text-[#b5ff00] shrink-0" />
              <div>
                <div className="font-bold text-sm text-zinc-200">Public Leaderboard &amp; Ranks</div>
                <div className="text-xs text-zinc-400">Verified club participation rankings</div>
              </div>
            </button>
          </div>
        </div>

        {/* Account & Operational Tools */}
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono px-1">
            Tools &amp; Assistance
          </div>
          <div className="grid grid-cols-1 gap-2">
            {onOpenNotifications && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenNotifications();
                }}
                className="w-full min-h-12 flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
              >
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-[#b5ff00] shrink-0" />
                  <div>
                    <div className="font-bold text-sm text-zinc-200">Notifications &amp; Reminders</div>
                    <div className="text-xs text-zinc-400">Meeting announcements and check-in reminders</div>
                  </div>
                </div>
                {unreadNotificationsCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-[#b5ff00] text-black text-xs font-bold font-mono">
                    {unreadNotificationsCount} new
                  </span>
                )}
              </button>
            )}

            {linkedMember && onOpenEditProfile && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenEditProfile();
                }}
                className="w-full min-h-12 flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
              >
                <User className="w-5 h-5 text-[#b5ff00] shrink-0" />
                <div>
                  <div className="font-bold text-sm text-zinc-200">Edit Builder Profile</div>
                  <div className="text-xs text-zinc-400">Update tracks, university, bio, and avatar</div>
                </div>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenGuide();
              }}
              className="w-full min-h-12 flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-white/5 text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
            >
              <HelpCircle className="w-5 h-5 text-zinc-400 shrink-0" />
              <div>
                <div className="font-bold text-sm text-zinc-200">Operational Guide &amp; FAQ</div>
                <div className="text-xs text-zinc-400">How check-ins, kiosks, and scoring work</div>
              </div>
            </button>
          </div>
        </div>

        {/* Sign Out Action */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              signOutUser();
            }}
            className="w-full min-h-12 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-200 font-bold text-sm transition-colors cursor-pointer active:scale-98 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out of Account</span>
          </button>
        </div>
      </div>
    </ModalSheet>
  );
};
