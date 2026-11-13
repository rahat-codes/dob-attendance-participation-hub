import React, { useState, useMemo } from 'react';
import {
  Users,
  Plus,
  Flame,
  QrCode,
  Search,
  X,
  SlidersHorizontal,
  ArrowUpDown,
  Award,
  Download,
  Edit3,
  Trash2,
  Trophy,
  Crown,
  Clock,
  Sparkles,
  CheckCircle2,
  Calendar,
  ArrowRight,
  TrendingUp,
  Lock,
  UserCheck,
  ShieldAlert,
  Check,
  XCircle,
  Mail,
  UserPlus,
  ShieldCheck,
} from 'lucide-react';
import { Member, BuilderRole, BuilderTrack, Session, CheckInRecord, UserProfile } from '../types';
import { AttendanceBadges } from './AttendanceBadges';
import { RoleManagementModal } from './RoleManagementModal';
import { downloadCSV, generateMembersRosterCSV } from '../utils/storage';
import { computeMemberStats } from '../utils/stats';
import { toJsDate } from '../utils/sessionWindow';
import { m } from 'motion/react';
import { fadeUp, stagger } from '../motion/presets';
import { SecureAvatar } from './common/SecureAvatar';

interface MembersViewProps {
  members: Member[];
  checkIns?: CheckInRecord[];
  sessions?: Session[];
  pendingRequests?: UserProfile[];
  allUsers?: UserProfile[];
  isAdmin?: boolean;
  onOpenAdminLogin?: () => void;
  onOpenAddMember: () => void;
  onApproveRequest?: (userProfile: UserProfile, matchedMemberId?: string) => void;
  onRejectRequest?: (userId: string) => void;
  onViewMemberPass: (member: Member) => void;
  onEditMember?: (member: Member) => void;
  onDeleteMember?: (member: Member) => void;
  onReactivateMember?: (member: Member) => void;
}

export const MembersView: React.FC<MembersViewProps> = ({
  members,
  checkIns = [],
  sessions = [],
  pendingRequests = [],
  allUsers = [],
  isAdmin = false,
  onOpenAdminLogin,
  onOpenAddMember,
  onApproveRequest,
  onRejectRequest,
  onViewMemberPass,
  onEditMember,
  onDeleteMember,
  onReactivateMember,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [trackFilter, setTrackFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'attendance' | 'streak' | 'name' | 'newest'>('attendance');
  const [roleModalMember, setRoleModalMember] = useState<Member | null>(null);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: members.length,
      President: 0,
      'Vice President': 0,
      'Project Leader': 0,
      Member: 0,
      Founder: 0,
      Lead: 0,
      Builder: 0,
      Apprentice: 0,
    };
    members.forEach((m) => {
      if (counts[m.role] !== undefined) {
        counts[m.role]++;
      }
    });
    return counts;
  }, [members]);

  // Live derived stats map for each member
  const memberStatsMap = useMemo(() => {
    const map = new Map<string, { total: number; streak: number; bestStreak: number; points: number }>();
    members.forEach((m) => {
      map.set(m.id, computeMemberStats(m, sessions, checkIns));
    });
    return map;
  }, [members, sessions, checkIns]);

  // Map each member to their most recent session check-in
  const latestCheckInByMemberId = useMemo(() => {
    const map = new Map<string, CheckInRecord>();
    if (!checkIns || checkIns.length === 0) return map;
    const sorted = [...checkIns].sort(
      (a, b) => toJsDate(b.checkedInAt || b.timestamp).getTime() - toJsDate(a.checkedInAt || a.timestamp).getTime()
    );
    for (const c of sorted) {
      if (!map.has(c.memberId)) {
        map.set(c.memberId, c);
      }
    }
    return map;
  }, [checkIns]);

  // Overall most frequent attendee in the guild
  const mostFrequentAttendee = useMemo<Member | null>(() => {
    if (!members || members.length === 0) return null;
    return [...members].sort((a, b) => {
      const aStats = memberStatsMap.get(a.id);
      const bStats = memberStatsMap.get(b.id);
      return (bStats?.total ?? 0) - (aStats?.total ?? 0) || (bStats?.streak ?? 0) - (aStats?.streak ?? 0);
    })[0];
  }, [members, memberStatsMap]);

  const topAttendeeLatestCheckIn = useMemo<CheckInRecord | null>(() => {
    if (!mostFrequentAttendee) return null;
    return latestCheckInByMemberId.get(mostFrequentAttendee.id) || null;
  }, [mostFrequentAttendee, latestCheckInByMemberId]);

  const totalGuildCheckIns = useMemo(() => {
    return checkIns && checkIns.length > 0
      ? checkIns.length
      : Array.from(memberStatsMap.values()).reduce((acc, s) => acc + s.total, 0);
  }, [checkIns, memberStatsMap]);

  const handleExportRosterCSV = () => {
    const csvContent = generateMembersRosterCSV(members, sessions, checkIns);
    const dateStamp = new Date().toISOString().split('T')[0];
    downloadCSV(`den-of-builders-roster-${dateStamp}.csv`, csvContent);
  };

  const filteredMembers = useMemo(() => {
    return members
      .filter((m) => {
        if (roleFilter !== 'all' && m.role !== roleFilter) return false;
        if (trackFilter !== 'all' && !m.tracks.includes(trackFilter as BuilderTrack)) return false;

        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const cleanQ = q.startsWith('@') ? q.substring(1) : q;
          const matchName = m.name.toLowerCase().includes(q);
          const matchHandle =
            m.handle.toLowerCase().includes(q) ||
            m.handle.toLowerCase().replace('@', '').includes(cleanQ);
          const matchRole = m.role.toLowerCase().includes(q);
          const matchEmail = m.email ? m.email.toLowerCase().includes(q) : false;
          const matchTracks = m.tracks.some((t) => t.toLowerCase().includes(q));
          const matchBio = m.bio ? m.bio.toLowerCase().includes(q) : false;
          return matchName || matchHandle || matchRole || matchEmail || matchTracks || matchBio;
        }
        return true;
      })
      .sort((a, b) => {
        const aStats = memberStatsMap.get(a.id);
        const bStats = memberStatsMap.get(b.id);
        if (sortBy === 'attendance') return (bStats?.total ?? 0) - (aStats?.total ?? 0) || (bStats?.streak ?? 0) - (aStats?.streak ?? 0);
        if (sortBy === 'streak') return (bStats?.streak ?? 0) - (aStats?.streak ?? 0) || (bStats?.total ?? 0) - (aStats?.total ?? 0);
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'newest') return b.joinedDate.localeCompare(a.joinedDate);
        return 0;
      });
  }, [members, roleFilter, trackFilter, searchQuery, sortBy, memberStatsMap]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-white uppercase">
            Builder Guild Directory
          </h1>
          <p className="text-xs text-zinc-400">
            Active engineers, hardware craftsmen, and apprentices of Den of Builders
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isAdmin ? (
            <>
              <button
                onClick={handleExportRosterCSV}
                className="btn-glossy-secondary flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-300 rounded-full transition-all whitespace-nowrap cursor-pointer font-mono"
                title="Export complete roster to CSV for external database management"
              >
                <Download className="h-3.5 w-3.5 text-zinc-400 group-hover:text-[#b5ff00]" />
                <span>Export Roster (CSV)</span>
              </button>

              <button
                onClick={onOpenAddMember}
                className="btn-glossy-primary flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-black rounded-full uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer font-mono"
              >
                <Plus className="h-4 w-4 text-black" />
                <span>Add Builder</span>
              </button>
            </>
          ) : (
            onOpenAdminLogin && (
              <button
                onClick={onOpenAdminLogin}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-[#b5ff00]/60 hover:text-white rounded-full transition-all whitespace-nowrap cursor-pointer"
                title="Sign in as Admin to manage members, add builders, or export data"
              >
                <Lock className="h-3.5 w-3.5 text-[#b5ff00]" />
                <span>Admin Roster Login</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* Pending Membership Link Requests (Admin Only) */}
      {isAdmin && pendingRequests.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-zinc-950 p-5 sm:p-6 space-y-4 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-amber-500 to-amber-300" />
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-base font-bold font-display uppercase tracking-tight text-white">
                    Pending Membership Approval Requests
                  </h2>
                  <span className="text-[10px] font-mono text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold">
                    {pendingRequests.length} Waiting
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  New builders have signed in with Google and requested authorization to access the meeting hub
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
            {pendingRequests.map((req) => {
              const emailMatch = members.find(
                (m) => m.email && m.email.toLowerCase().trim() === req.email.toLowerCase().trim()
              );
              const handleMatch = req.requestedNotes
                ? members.find(
                    (m) =>
                      m.handle.toLowerCase().replace('@', '') ===
                        req.requestedNotes?.toLowerCase().replace('@', '') ||
                      m.name.toLowerCase() === req.requestedNotes?.toLowerCase()
                  )
                : null;
              const autoMatch = emailMatch || handleMatch;

              return (
                <div
                  key={req.id}
                  className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-3 flex flex-col justify-between hover:border-amber-500/40 transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">
                          {req.displayName || 'Google User'}
                        </div>
                        <div className="text-xs text-zinc-400 font-mono flex items-center gap-1.5 mt-0.5 truncate">
                          <Mail className="h-3 w-3 shrink-0 text-zinc-500" />
                          <span className="truncate">{req.email}</span>
                        </div>
                      </div>
                      {req.status === 'approved_waiting_response' ? (
                        <span className="text-[10px] font-mono text-cyan-300 uppercase bg-cyan-500/15 px-2 py-0.5 rounded border border-cyan-500/30 shrink-0 font-bold">
                          Approved — Waiting for User Response
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-amber-400 uppercase bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 shrink-0 font-semibold">
                          Pending
                        </span>
                      )}
                    </div>

                    {req.status === 'approved_waiting_response' && (
                      <div className="p-2 rounded bg-cyan-950/40 border border-cyan-500/30 text-[11px] text-cyan-200">
                        Approved by admin. Waiting for applicant to respond &amp; accept invitation.
                      </div>
                    )}

                    {req.requestedNotes && (
                      <div className="p-2 rounded bg-zinc-950 border border-zinc-850 text-xs">
                        <span className="text-[10px] text-zinc-500 uppercase font-mono block">
                          Claimed Handle / Notes:
                        </span>
                        <span className="text-zinc-200 font-mono font-medium">
                          {req.requestedNotes}
                        </span>
                      </div>
                    )}

                    {autoMatch ? (
                      <div className="p-2 rounded bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-xs space-y-0.5">
                        <span className="text-[10px] text-[#b5ff00] uppercase font-mono font-bold flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Matches Existing Profile:
                        </span>
                        <span className="text-white font-semibold">{autoMatch.name}</span>
                        <span className="text-zinc-400 font-mono text-[11px] block">
                          {autoMatch.handle} · {autoMatch.role}
                        </span>
                      </div>
                    ) : (
                      <div className="p-2 rounded bg-zinc-950 border border-zinc-850 text-[11px] text-zinc-400">
                        No pre-existing roster profile found. Approving will create a new builder record.
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
                    <button
                      onClick={() => onApproveRequest?.(req, autoMatch?.id)}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#b5ff00] hover:bg-[#a3e600] text-black font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      <span>
                        {req.status === 'approved_waiting_response'
                          ? 'Re-Approve Link'
                          : autoMatch
                          ? 'Approve Application'
                          : 'Register & Link'}
                      </span>
                    </button>
                    {onRejectRequest && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Are you sure you want to reject the membership request for "${req.displayName || req.email}"?`)) {
                            onRejectRequest(req.id);
                          }
                        }}
                        className="py-1.5 px-2.5 rounded-lg bg-zinc-800 hover:bg-red-950/60 hover:text-red-400 text-zinc-400 text-xs font-semibold transition-colors cursor-pointer"
                        title="Dismiss Request"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Attendance Summary Card (Top Attendee Spotlight & Recent Session Check-ins by Builder) */}
      <div className="rounded-3xl glass-panel p-5 sm:p-6 space-y-5 spatial-card">
        {/* Header of the Attendance Summary Card */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-2xl bg-[#141720] border border-[#b5ff00]/40 neu-raised-sm flex items-center justify-center text-[#b5ff00]">
              <Trophy className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold font-display uppercase tracking-tight text-white">
                  Attendance Summary
                </h2>
                <span className="text-[10px] font-mono text-[#b5ff00] bg-[#b5ff00]/10 border border-[#b5ff00]/30 px-2.5 py-0.5 rounded-lg neu-raised-sm font-semibold uppercase">
                  Guild Leaderboard &amp; Activity
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Most frequent attendee spotlight and latest session check-ins across builders
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <div className="px-3 py-1.5 rounded-xl bg-[#0d0f15]/80 border border-white/5 neu-inset text-zinc-300">
              <span className="text-zinc-500 text-[10px] uppercase mr-1.5">Total Check-ins:</span>
              <span className="font-bold text-[#b5ff00] tabular-nums">{totalGuildCheckIns}</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-[#0d0f15]/80 border border-white/5 neu-inset text-zinc-300">
              <span className="text-zinc-500 text-[10px] uppercase mr-1.5">Active Builders:</span>
              <span className="font-bold text-zinc-100 tabular-nums">
                {members.filter((m) => (m.totalCheckIns || 0) > 0).length} / {members.length}
              </span>
            </div>
          </div>
        </div>

        {/* 2-Column Split: Most Frequent Attendee (Left) & Recent Session Check-ins by Builder (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left Column (5 cols): Most Frequent Attendee Spotlight */}
          <div className="lg:col-span-5 rounded-2xl border border-[#b5ff00]/40 bg-gradient-to-br from-[#141720] via-[#0d0f15] to-[#0a0b0e] p-5 flex flex-col justify-between space-y-4 relative overflow-hidden neu-raised shadow-[0_0_25px_rgba(181,255,0,0.08)]">
            <div className="absolute -top-12 -right-12 w-28 h-28 bg-[#b5ff00]/10 rounded-full blur-2xl pointer-events-none" />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold font-mono uppercase tracking-wider text-[#b5ff00] bg-[#b5ff00]/10 border border-[#b5ff00]/30 px-2.5 py-1 rounded-full">
                  <Crown className="h-3.5 w-3.5 text-[#b5ff00]" />
                  <span>Most Frequent Attendee</span>
                </span>
                <span className="text-[11px] font-mono font-bold text-zinc-400">
                  #1 Guild Member
                </span>
              </div>

              {mostFrequentAttendee ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 pt-1">
                    <SecureAvatar
                      src={mostFrequentAttendee.avatarUrl}
                      name={mostFrequentAttendee.name}
                      size={48}
                      shape="rounded"
                      className="border-2 border-[#b5ff00] shadow-[0_0_15px_rgba(181,255,0,0.25)] shrink-0"
                      fallbackClassName="font-bold font-display text-lg text-[#b5ff00]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold font-display text-white truncate">
                          {mostFrequentAttendee.name}
                        </h3>
                        <span className="text-[10px] font-mono font-semibold text-[#b5ff00] uppercase bg-zinc-900 px-1.5 py-0.5 rounded border border-[#b5ff00]/30">
                          {mostFrequentAttendee.role}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono truncate">
                        {mostFrequentAttendee.handle}
                      </div>
                      <div className="text-[11px] text-zinc-500 font-sans mt-0.5 line-clamp-1">
                        {mostFrequentAttendee.tracks.join(' · ')}
                      </div>
                    </div>
                  </div>

                  {/* Top Attendee Stats */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-800/80 font-mono">
                    <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80 text-center">
                      <span className="text-[10px] text-zinc-500 uppercase block">Check-ins</span>
                      <span className="text-base font-bold text-zinc-100 tabular-nums">
                        {mostFrequentAttendee.totalCheckIns}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80 text-center">
                      <span className="text-[10px] text-zinc-500 uppercase block">Current</span>
                      <span className="text-base font-bold text-[#b5ff00] tabular-nums flex items-center justify-center gap-0.5">
                        <Flame className="h-3.5 w-3.5" />
                        {mostFrequentAttendee.currentStreak}d
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80 text-center">
                      <span className="text-[10px] text-zinc-500 uppercase block">Best Streak</span>
                      <span className="text-base font-bold text-amber-400 tabular-nums">
                        {mostFrequentAttendee.bestStreak}d
                      </span>
                    </div>
                  </div>

                  {/* Most Recent Check-in for Top Attendee */}
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 uppercase">
                      <span className="flex items-center gap-1 text-zinc-300 font-semibold">
                        <Clock className="h-3 w-3 text-[#b5ff00]" />
                        <span>Most Recent Session Check-in</span>
                      </span>
                      {topAttendeeLatestCheckIn && (
                        <span className="text-[#b5ff00] font-mono font-bold">
                          {topAttendeeLatestCheckIn.date}
                        </span>
                      )}
                    </div>
                    {topAttendeeLatestCheckIn ? (
                      <div>
                        <div className="text-xs font-semibold text-zinc-100 truncate">
                          {topAttendeeLatestCheckIn.sessionTitle}
                        </div>
                        <div className="text-[11px] text-zinc-400 font-mono mt-0.5 flex items-center gap-2">
                          <span>Track: {topAttendeeLatestCheckIn.track}</span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">{topAttendeeLatestCheckIn.method.replace('_', ' ')}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-500 italic">
                        No individual session check-in logs recorded yet.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-500 py-6 text-center">
                  No builders in guild directory yet.
                </div>
              )}
            </div>

            {mostFrequentAttendee && (
              <button
                onClick={() => onViewMemberPass(mostFrequentAttendee)}
                className="w-full flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-bold font-display uppercase tracking-wider text-black bg-[#b5ff00] hover:bg-[#c6ff24] rounded-lg transition-all cursor-pointer shadow-xs"
              >
                <QrCode className="h-3.5 w-3.5 text-black" />
                <span>View Champion Pass</span>
              </button>
            )}
          </div>

          {/* Right Column (7 cols): Recent Session Check-ins for Each Builder */}
          <div className="lg:col-span-7 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#00d2ef]" />
                <h3 className="text-xs sm:text-sm font-bold font-display uppercase text-zinc-100">
                  Most Recent Session Check-ins by Builder
                </h3>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">
                {members.length} Guild Builders
              </span>
            </div>

            {/* Scrollable list of each builder's latest check-in */}
            <div className="max-h-72 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {members.map((m) => {
                const latest = latestCheckInByMemberId.get(m.id);
                return (
                  <div
                    key={m.id}
                    className="p-2.5 rounded-lg bg-zinc-950/90 border border-zinc-800/80 flex items-center justify-between gap-3 hover:border-zinc-700 transition-all text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <SecureAvatar
                        src={m.avatarUrl}
                        name={m.name}
                        size={32}
                        shape="rounded"
                        className="border border-zinc-800 shrink-0"
                        fallbackClassName="text-xs font-bold font-display text-zinc-300"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-bold text-zinc-200 truncate">{m.name}</span>
                          <span className="text-[10px] font-mono text-zinc-500 truncate">{m.handle}</span>
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          {latest ? (
                            <span className="flex items-center gap-1 text-zinc-300">
                              <CheckCircle2 className="h-3 w-3 text-[#b5ff00] shrink-0" />
                              <span className="font-mono text-[#b5ff00] font-semibold">{latest.date}:</span>
                              <span className="truncate">{latest.sessionTitle}</span>
                            </span>
                          ) : (
                            <span className="text-zinc-600 italic">No check-in record logged yet</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 font-mono">
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 tabular-nums">
                        {memberStatsMap.get(m.id)?.total ?? 0} {(memberStatsMap.get(m.id)?.total ?? 0) === 1 ? 'check-in' : 'check-ins'}
                      </span>
                      <button
                        onClick={() => onViewMemberPass(m)}
                        className="p-1 text-zinc-400 hover:text-[#b5ff00] hover:bg-zinc-900 rounded transition-colors cursor-pointer"
                        title={`View pass for ${m.name}`}
                      >
                        <QrCode className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
              <span>Showing latest recorded attendance timestamp for every registered builder</span>
              <span className="text-zinc-400">{checkIns.length} total logs stored</span>
            </div>
          </div>
        </div>
      </div>

      {/* Prominent Search and Filter Bar */}
      <div className="space-y-3">
        {/* Full-width Search Bar */}
        <div className="relative w-full">
          <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchQuery('');
            }}
            placeholder="Search builders by name, @handle, role (Founder, Lead...), track, or email..."
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset focus:border-[#b5ff00] rounded-2xl pl-10 pr-10 py-2.5 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none transition-colors font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] neu-button rounded-xl transition-colors cursor-pointer"
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Role Filter Tabs with Dynamic Live Count Badges */}
            <div className="flex items-center p-1 bg-black/60 border border-white/5 rounded-2xl neu-inset overflow-x-auto max-w-full">
              {(['all', 'President', 'Vice President', 'Project Leader', 'Member', 'Lead'] as const).map((r) => {
                const count = roleCounts[r] ?? 0;
                const isSelected = roleFilter === r;
                return (
                  <button
                    key={r}
                    onClick={() => setRoleFilter(r)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap cursor-pointer text-xs font-mono ${
                      isSelected
                        ? 'bg-[#181b24] text-[#b5ff00] font-bold border border-[#b5ff00]/30 shadow-[0_2px_8px_rgba(181,255,0,0.15)]'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span>{r === 'all' ? 'All Roles' : r}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                        isSelected
                          ? 'bg-[#b5ff00]/20 text-[#b5ff00]'
                          : 'bg-zinc-900 text-zinc-500'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Track Filter Dropdown */}
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-500" />
              <select
                value={trackFilter}
                onChange={(e) => setTrackFilter(e.target.value)}
                className="bg-[#141720] border border-white/10 neu-button rounded-xl px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-[#b5ff00] cursor-pointer text-xs font-mono"
              >
                <option value="all">All Tracks</option>
                <option value="Hardware & Robotics">Hardware & Robotics</option>
                <option value="Software & Systems">Software & Systems</option>
                <option value="AI & Embedded">AI & Embedded</option>
                <option value="Open Hack & Demo">Open Hack & Demo</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 text-zinc-400">
              <ArrowUpDown className="h-3 w-3 text-zinc-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-[#b5ff00] cursor-pointer text-xs"
              >
                <option value="attendance">Sort: Most Check-ins</option>
                <option value="streak">Sort: Longest Streak</option>
                <option value="name">Sort: Name (A-Z)</option>
                <option value="newest">Sort: Recently Joined</option>
              </select>
            </div>

            {/* Results Counter */}
            <span className="text-zinc-500 font-mono tabular-nums whitespace-nowrap text-xs">
              {filteredMembers.length} of {members.length} builders
            </span>
          </div>
        </div>

        {/* Active Filters Summary Strip */}
        {(searchQuery || roleFilter !== 'all' || trackFilter !== 'all') && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] font-mono">
            <span className="text-zinc-500">Active filters:</span>
            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
                <span>&ldquo;{searchQuery}&rdquo;</span>
                <button
                  onClick={() => setSearchQuery('')}
                  className="hover:text-white cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {roleFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00]">
                <span>Role: {roleFilter}</span>
                <button
                  onClick={() => setRoleFilter('all')}
                  className="hover:text-white cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {trackFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                <span>Track: {trackFilter}</span>
                <button
                  onClick={() => setTrackFilter('all')}
                  className="hover:text-white cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            <button
              onClick={() => {
                setSearchQuery('');
                setRoleFilter('all');
                setTrackFilter('all');
              }}
              className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2 ml-1 cursor-pointer"
            >
              Reset all
            </button>
          </div>
        )}
      </div>

      {/* Members Grid or Empty Search State */}
      {filteredMembers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50 p-12 text-center space-y-3">
          <div className="h-10 w-10 mx-auto rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-200 font-display">No builders match your search</h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1">
              No results found for &ldquo;{searchQuery}&rdquo;. Try another name, handle, or clear filters.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => {
                setSearchQuery('');
                setRoleFilter('all');
                setTrackFilter('all');
              }}
              className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
            >
              Reset Search & Filters
            </button>
          </div>
        </div>
      ) : (
        <m.div variants={stagger()} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMembers.map((member, index) => (
            <m.div
              key={member.id}
              variants={index < 12 ? fadeUp : undefined}
              className="rounded-2xl border border-zinc-800/80 bg-zinc-950 p-5 space-y-4 hover:border-[#b5ff00]/40 transition-colors flex flex-col justify-between group shadow-sm hover:shadow-[0_0_20px_rgba(181,255,0,0.06)]"
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <SecureAvatar
                      src={member.avatarUrl}
                      name={member.name}
                      size={40}
                      shape="rounded"
                      className="border border-zinc-800 group-hover:border-[#b5ff00]/40 shrink-0 transition-colors"
                      fallbackClassName="font-bold font-display text-sm text-[#b5ff00]"
                    />
                    <div className="truncate">
                      <h3 className="text-sm font-bold font-display text-white group-hover:text-[#b5ff00] transition-colors truncate">{member.name}</h3>
                      <div className="text-xs text-zinc-400 font-mono truncate">{member.handle}</div>
                      {isAdmin ? (
                        <div className="text-[11px] text-[#b5ff00]/90 font-mono truncate mt-0.5" title={member.email}>
                          {member.email}
                        </div>
                      ) : (
                        <div className="text-[10px] text-zinc-500 font-mono truncate mt-0.5 flex items-center gap-1">
                          <Lock className="h-2.5 w-2.5 text-zinc-600" />
                          <span>Contact locked (Admin only)</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[11px] font-mono text-[#b5ff00] font-semibold uppercase">
                      {member.role}
                    </span>
                    {member.status === 'Inactive' && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 uppercase font-semibold">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>

                {/* Bio */}
                {member.bio && (
                  <p className="text-xs text-zinc-400 mt-3 line-clamp-2">{member.bio}</p>
                )}

                {/* Tracks */}
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-zinc-400">
                  {member.tracks.map((t, i) => (
                    <span key={t}>
                      {i > 0 && <span className="mr-1.5 text-zinc-700">·</span>}
                      <span>{t}</span>
                    </span>
                  ))}
                </div>

                {/* Milestones Mini Strip */}
                <div className="mt-3 pt-2.5 flex items-center justify-between border-t border-zinc-800/80">
                  <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">Milestones</span>
                  <AttendanceBadges member={member} stats={memberStatsMap.get(member.id)} mode="mini" />
                </div>

                {/* Latest Session Check-In */}
                {(() => {
                  const latest = latestCheckInByMemberId.get(member.id);
                  return (
                    <div className="mt-2.5 pt-2 flex items-center justify-between border-t border-zinc-800/80 text-[11px] font-mono">
                      <span className="text-zinc-500 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-zinc-500" />
                        <span>Latest:</span>
                      </span>
                      {latest ? (
                        <span
                          className="text-zinc-300 truncate max-w-[170px] text-right"
                          title={`${latest.sessionTitle} (${latest.date})`}
                        >
                          <span className="text-[#b5ff00] font-semibold">{latest.date}</span> · {latest.sessionTitle}
                        </span>
                      ) : (
                        <span className="text-zinc-600 italic">No check-in logged</span>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Stats row & Pass CTA */}
              <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs">
                  <div>
                    <span className="text-zinc-500 block text-[10px] font-mono uppercase">Total</span>
                    <span className="font-mono tabular-nums text-zinc-100 font-bold">
                      {memberStatsMap.get(member.id)?.total ?? 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px] font-mono uppercase">Streak</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-950/60 border border-orange-500/40 text-orange-400 text-xs font-mono font-bold shadow-[0_0_8px_rgba(249,115,22,0.15)] mt-0.5">
                      <Flame className="h-3.5 w-3.5 text-orange-400 fill-orange-400 animate-pulse" />
                      <span className="text-orange-200">{memberStatsMap.get(member.id)?.streak ?? 0}</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {isAdmin && (
                    <button
                      onClick={() => setRoleModalMember(member)}
                      className="p-1.5 text-zinc-400 hover:text-[#b5ff00] hover:bg-zinc-900 rounded-full transition-colors cursor-pointer"
                      title="Manage club role and admin permissions"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-[#b5ff00]" />
                    </button>
                  )}

                  {isAdmin && onEditMember && (
                    <button
                      onClick={() => onEditMember(member)}
                      className="p-1.5 text-zinc-400 hover:text-[#b5ff00] hover:bg-zinc-900 rounded-full transition-colors cursor-pointer"
                      title="Edit builder profile"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {isAdmin && member.status === 'Inactive' && onReactivateMember && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReactivateMember(member);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-mono font-bold uppercase text-[#b5ff00] bg-[#b5ff00]/10 hover:bg-[#b5ff00]/20 border border-[#b5ff00]/40 rounded-full transition-colors cursor-pointer"
                      title="Reactivate builder and route linked account through approval"
                    >
                      <UserCheck className="h-3 w-3" />
                      <span>Reactivate</span>
                    </button>
                  )}

                  {isAdmin && onDeleteMember && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteMember(member);
                      }}
                      className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/15 border border-transparent hover:border-red-500/30 rounded-full transition-all cursor-pointer"
                      title="Delete builder"
                      aria-label={`Delete builder ${member.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => onViewMemberPass(member)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-200 bg-zinc-900 border border-zinc-800 hover:border-[#b5ff00]/60 hover:text-[#b5ff00] rounded-full transition-all cursor-pointer"
                  >
                    <QrCode className="h-3.5 w-3.5 text-[#b5ff00]" />
                    <span>Pass</span>
                  </button>
                </div>
              </div>
            </m.div>
          ))}
        </m.div>
      )}

      {/* Role & Permissions Management Modal */}
      {roleModalMember && (
        <RoleManagementModal
          isOpen={!!roleModalMember}
          onClose={() => setRoleModalMember(null)}
          member={roleModalMember}
          linkedUser={
            allUsers.find((u) => u.memberId === roleModalMember.id || u.id === roleModalMember.authUid) || null
          }
          onRoleUpdated={(updated) => {
            setRoleModalMember(null);
          }}
        />
      )}
    </div>
  );
};

