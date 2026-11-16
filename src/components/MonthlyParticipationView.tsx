import React, { useState, useMemo } from 'react';
import {
  Download,
  Calendar,
  Flame,
  Award,
  Users,
  CheckCircle2,
  TrendingUp,
  Search,
  Filter,
  BarChart3,
  Layers,
  Sparkles,
  Lock,
  Trophy,
  Crown,
  Medal,
  LayoutGrid,
  List,
  QrCode,
} from 'lucide-react';
import { Member, Session, CheckInRecord, BuilderTrack, BuilderTier } from '../types';
import {
  calculateMonthlyStats,
  formatMonthLabel,
  getAvailableMonthKeys,
  downloadCSV,
  generateAttendanceCSV,
  generateMonthlyReportCSV,
} from '../utils/storage';
import { AttendanceBadges } from './AttendanceBadges';
import { ParticipationTrends } from './ParticipationTrends';
import { formatTimeInClubTz } from '../utils/sessionWindow';
import { computeMemberStats } from '../utils/stats';

interface MonthlyParticipationViewProps {
  members: Member[];
  sessions: Session[];
  checkIns: CheckInRecord[];
  isAdmin?: boolean;
  onOpenAdminLogin?: () => void;
  onOpenScanner: () => void;
  onViewMemberPass: (member: Member) => void;
  isHistoryBounded?: boolean;
  isLoadingHistory?: boolean;
  hasLoadedAllHistory?: boolean;
  historyStartMonthKey?: string;
  onLoadAllHistory?: () => void;
}

export const MonthlyParticipationView: React.FC<MonthlyParticipationViewProps> = React.memo(({
  members,
  sessions,
  checkIns,
  isAdmin = false,
  onOpenAdminLogin,
  onOpenScanner,
  onViewMemberPass,
  isHistoryBounded = false,
  isLoadingHistory = false,
  hasLoadedAllHistory = false,
  historyStartMonthKey,
  onLoadAllHistory,
}) => {
  const availableMonths = useMemo(
    () => getAvailableMonthKeys(sessions, checkIns),
    [sessions, checkIns]
  );

  const [selectedMonth, setSelectedMonth] = useState<string>(
    availableMonths[0] || '2026-10'
  );

  // Sync selectedMonth if availableMonths updates
  React.useEffect(() => {
    if (availableMonths.length > 0 && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  // Search & Filters for check-in records table
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTrackFilter, setSelectedTrackFilter] = useState<string>('all');
  const [activeLeaderboardTab, setActiveLeaderboardTab] = useState<'attendance' | 'streak'>('attendance');
  const [displayMode, setDisplayMode] = useState<'cards' | 'table'>('cards');

  // Compute live member stats map for accurate unforgeable streaks and check-ins
  const memberStatsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeMemberStats>>();
    members.forEach((m) => {
      map.set(m.id, computeMemberStats(m, sessions, checkIns));
    });
    return map;
  }, [members, sessions, checkIns]);

  // Top 5 builders based on their current streak count
  const topStreakBuilders = useMemo(() => {
    return [...members]
      .filter((m) => m.status !== 'Inactive')
      .map((m) => {
        const stats = memberStatsMap.get(m.id) || { total: 0, streak: 0, bestStreak: 0, points: 0, lateCount: 0 };
        return {
          ...m,
          currentStreak: stats.streak,
          bestStreak: stats.bestStreak,
          totalCheckIns: stats.total,
          points: stats.points,
        };
      })
      .sort(
        (a, b) =>
          (b.currentStreak || 0) - (a.currentStreak || 0) ||
          (b.totalCheckIns || 0) - (a.totalCheckIns || 0)
      )
      .slice(0, 5);
  }, [members, memberStatsMap]);

  // Calculate monthly stats for the active month
  const currentMonthStats = useMemo(
    () => calculateMonthlyStats(selectedMonth, members, sessions, checkIns),
    [selectedMonth, members, sessions, checkIns]
  );

  // Find previous month for comparison
  const previousMonthKey = useMemo(() => {
    const idx = availableMonths.indexOf(selectedMonth);
    if (idx >= 0 && idx + 1 < availableMonths.length) {
      return availableMonths[idx + 1];
    }
    return null;
  }, [availableMonths, selectedMonth]);

  const prevMonthStats = useMemo(() => {
    if (!previousMonthKey) return null;
    return calculateMonthlyStats(previousMonthKey, members, sessions, checkIns);
  }, [previousMonthKey, members, sessions, checkIns]);

  // Delta calculations
  const checkInGrowth = useMemo(() => {
    if (!prevMonthStats || prevMonthStats.totalCheckIns === 0) return null;
    const diff = currentMonthStats.totalCheckIns - prevMonthStats.totalCheckIns;
    const pct = Math.round((diff / prevMonthStats.totalCheckIns) * 100);
    return pct;
  }, [currentMonthStats, prevMonthStats]);

  const memberMap = useMemo(() => {
    const map = new Map<string, Member>();
    members.forEach((m) => map.set(m.id, m));
    return map;
  }, [members]);

  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    sessions.forEach((s) => map.set(s.id, s));
    return map;
  }, [sessions]);

  // Filtered check-in records for current month (authoritatively joined against active/existing members & sessions)
  const monthlyRecords = useMemo(() => {
    return checkIns.filter((c) => {
      const mem = memberMap.get(c.memberId);
      const sess = sessionMap.get(c.sessionId);
      if (!mem || !sess || sess.status === 'cancelled' || sess.deletedAt) return false;

      const recordMonthKey = c.monthKey || sess.date?.substring(0, 7) || c.date?.substring(0, 7);
      if (recordMonthKey !== selectedMonth) return false;

      const track = sess.track || c.track || '';
      if (selectedTrackFilter !== 'all' && track !== selectedTrackFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mName = mem.name || c.memberName || '';
        const mHandle = mem.handle || c.memberHandle || '';
        const sTitle = sess.title || c.sessionTitle || '';
        return (
          mName.toLowerCase().includes(q) ||
          mHandle.toLowerCase().includes(q) ||
          sTitle.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [checkIns, memberMap, sessionMap, selectedMonth, selectedTrackFilter, searchQuery]);

  // Month sessions
  const currentMonthSessions = useMemo(() => {
    return sessions
      .filter((s) => s.status !== 'cancelled' && !s.deletedAt && (s.date || '').startsWith(selectedMonth))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }, [sessions, selectedMonth]);

  // Helper for builder tier determination
  const getBuilderTier = (monthlyCount: number, totalSessions: number): BuilderTier => {
    const rate = totalSessions > 0 ? (monthlyCount / totalSessions) * 100 : 0;
    if (rate >= 90) return 'Guild Architect';
    if (rate >= 65) return 'Master Craftsman';
    if (rate >= 40) return 'Active Builder';
    return 'Novice Maker';
  };

  const handleExportAttendance = () => {
    const csv = generateAttendanceCSV(monthlyRecords, members, sessions);
    downloadCSV(`den-of-builders-attendance-${selectedMonth}.csv`, csv);
  };

  const handleExportSummary = () => {
    const csv = generateMonthlyReportCSV(currentMonthStats);
    downloadCSV(`den-of-builders-monthly-report-${selectedMonth}.csv`, csv);
  };

  return (
    <div className="space-y-8 w-full min-w-0">
      {/* Header and Month Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-zinc-400">
            <span>Den of Builders</span>
            <span aria-hidden="true">/</span>
            <span>Guild Operations</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#b5ff00]">Attendance Intelligence</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-white uppercase mt-1">
            Monthly Participation Analytics
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Real-time tracking of builder sessions, member consistency, and check-in rates
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Month selector dropdown */}
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-full px-3.5 min-h-11 focus-within:border-[#b5ff00]">
            <Calendar className="h-4 w-4 text-[#b5ff00] shrink-0" aria-hidden="true" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="Select month"
              className="bg-transparent text-xs font-semibold text-zinc-200 focus:outline-none cursor-pointer min-h-11"
            >
              {availableMonths.map((mKey) => (
                <option key={mKey} value={mKey} className="bg-zinc-950 text-zinc-200">
                  {formatMonthLabel(mKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Export Dropdown / Buttons (Admin Only) */}
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin ? (
              <>
                <button
                  type="button"
                  onClick={handleExportSummary}
                  className="btn-glossy-secondary min-h-11 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-200 rounded-full transition-all cursor-pointer font-mono"
                  title="Download Monthly Summary CSV"
                >
                  <Download className="h-3.5 w-3.5 text-zinc-300" aria-hidden="true" />
                  <span>Report CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportAttendance}
                  className="btn-glossy-secondary min-h-11 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-200 rounded-full transition-all cursor-pointer font-mono"
                  title="Download Raw Attendance Log CSV"
                >
                  <Download className="h-3.5 w-3.5 text-zinc-300" aria-hidden="true" />
                  <span>Raw CSV</span>
                </button>
              </>
            ) : (
              onOpenAdminLogin && (
                <button
                  type="button"
                  onClick={onOpenAdminLogin}
                  className="min-h-11 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-zinc-300 bg-zinc-950 border border-zinc-800 hover:border-[#b5ff00]/50 hover:text-white rounded-full transition-all cursor-pointer"
                  title="Admin login required to export data"
                >
                  <Lock className="h-3 w-3 text-[#b5ff00]" aria-hidden="true" />
                  <span>Admin Reports</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {isAdmin && isHistoryBounded && !hasLoadedAllHistory && onLoadAllHistory && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-zinc-900/70 border border-white/10 text-xs font-mono text-zinc-300">
          <span>
            Live sync shows check-ins since {historyStartMonthKey || 'recent months'} (current + prior 2 months).
          </span>
          <button
            type="button"
            onClick={onLoadAllHistory}
            disabled={isLoadingHistory}
            className="min-h-11 px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-white/15 text-[#b5ff00] font-bold cursor-pointer disabled:opacity-50"
          >
            {isLoadingHistory ? 'Loading full archive...' : 'Load all history'}
          </button>
        </div>
      )}

      {/* KPI Cards Grid (4 columns, single elevation) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Check-Ins */}
        <div className="rounded-3xl glass-panel-interactive p-5 sm:p-6 space-y-2 spatial-card">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono uppercase">
            <span>Total Check-ins</span>
            <div className="p-2 rounded-xl bg-[#141720] border border-[#b5ff00]/30 neu-raised-sm">
              <Users className="h-4 w-4 text-[#b5ff00]" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-zinc-100 tabular-nums">
              {currentMonthStats.totalCheckIns}
            </span>
            {checkInGrowth !== null && (
              <span
                className={`text-xs font-mono font-medium px-2 py-0.5 rounded-md neu-inset ${
                  checkInGrowth >= 0 ? 'text-[#b5ff00]' : 'text-rose-400'
                }`}
              >
                {checkInGrowth >= 0 ? `+${checkInGrowth}%` : `${checkInGrowth}%`} vs last mo.
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">
            Across {currentMonthStats.totalSessions} scheduled workshop sessions
          </div>
        </div>

        {/* Card 2: Active Participation Rate */}
        <div className="rounded-3xl glass-panel-interactive p-5 sm:p-6 space-y-2 spatial-card">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono uppercase">
            <span>Guild Participation Rate</span>
            <CheckCircle2 className="h-4 w-4 text-[#b5ff00]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-zinc-100 tabular-nums">
              {currentMonthStats.activeRatePercent}%
            </span>
            <span className="text-xs text-zinc-400 font-mono">
              ({currentMonthStats.uniqueBuilders} / {members.length} active)
            </span>
          </div>
          {/* Visual progress bar */}
          <div className="h-1.5 w-full bg-black rounded-full overflow-hidden border border-zinc-800">
            <div
              className="h-full bg-[#b5ff00] transition-all duration-500 shadow-[0_0_8px_rgba(181,255,0,0.5)]"
              style={{ width: `${currentMonthStats.activeRatePercent}%` }}
            />
          </div>
        </div>

        {/* Card 3: Average Attendance / Session */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950 p-5 space-y-2 hover:border-cyan-500/30 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono uppercase">
            <span>Avg. Builders / Session</span>
            <TrendingUp className="h-4 w-4 text-[#00d2ef]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-zinc-100 tabular-nums">
              {currentMonthStats.averageAttendancePerSession}
            </span>
            <span className="text-xs text-zinc-500 font-mono">builders/session</span>
          </div>
          <div className="text-[11px] text-zinc-500">
            Capacity target: 18–24 builders
          </div>
        </div>

        {/* Card 4: Top Builder Track */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950 p-5 space-y-2 hover:border-purple-500/30 transition-colors">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-mono uppercase">
            <span>Leading Focus Track</span>
            <Layers className="h-4 w-4 text-[#ac4bff]" />
          </div>
          <div className="text-lg font-bold text-zinc-100 font-display truncate">
            {Object.entries(currentMonthStats.trackBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Hardware'}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
            {Object.entries(currentMonthStats.trackBreakdown).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} track check-ins logged
          </div>
        </div>
      </div>

      {/* Participation Trends Section (Weekly Check-in Velocity with Recharts) */}
      <ParticipationTrends
        selectedMonth={selectedMonth}
        monthLabel={currentMonthStats.monthLabel}
        checkIns={checkIns}
        sessions={sessions}
      />

      {/* Monthly Session Attendance Breakdown & Track Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Monthly Sessions Agenda & Headcounts (7 cols) */}
        <div className="lg:col-span-7 rounded-3xl glass-panel p-6 sm:p-7 space-y-4 spatial-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold font-display uppercase tracking-tight text-white">
                {currentMonthStats.monthLabel} Session Schedule & Attendance
              </h2>
              <p className="text-xs text-zinc-400">
                Turnout per scheduled build night and clinic
              </p>
            </div>
            <span className="text-xs font-mono text-[#b5ff00] font-semibold bg-black/60 px-2.5 py-1 rounded-xl border border-white/5 neu-inset">
              {currentMonthSessions.length} Sessions
            </span>
          </div>

          <div className="space-y-3">
            {currentMonthSessions.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500 border border-dashed border-white/10 rounded-2xl bg-black/30 neu-inset">
                No sessions logged for {currentMonthStats.monthLabel}.
              </div>
            ) : (
              currentMonthSessions.map((session) => {
                const count = checkIns.filter((c) => c.sessionId === session.id).length;
                const capacity = session.maxCapacity || 25;
                const fillPercent = Math.min(100, Math.round((count / capacity) * 100));

                return (
                  <div
                    key={session.id}
                    className="p-3.5 rounded-2xl bg-[#0d0f15]/80 border border-white/5 neu-inset space-y-2 hover:border-white/15 transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-zinc-200">
                          {session.title}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-1">
                          <span className="font-mono text-[#b5ff00]">{session.date}</span>
                          <span aria-hidden="true">·</span>
                          <span>{session.startTime}</span>
                          <span aria-hidden="true">·</span>
                          <span>{session.location}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-mono font-bold text-zinc-100 tabular-nums">
                          {count}
                        </span>
                        <span className="text-[11px] text-zinc-500 font-mono"> / {capacity}</span>
                        <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                          {fillPercent}% fill
                        </div>
                      </div>
                    </div>

                    {/* Fill bar */}
                    <div className="h-1.5 w-full bg-black/60 rounded-full overflow-hidden border border-white/5">
                      <div
                        className="h-full bg-[#b5ff00] transition-all duration-300 shadow-[0_0_8px_rgba(181,255,0,0.6)]"
                        style={{ width: `${fillPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Track Volume & Distribution (5 cols) */}
        <div className="lg:col-span-5 rounded-3xl glass-panel p-6 sm:p-7 space-y-4 spatial-card">
          <div>
            <h2 className="text-sm font-semibold font-display uppercase tracking-tight text-white">
              Track Participation Breakdown
            </h2>
            <p className="text-xs text-zinc-400">
              Distribution of builder engagement across club tracks
            </p>
          </div>

          <div className="space-y-4 pt-1">
            {(
              [
                'Hardware & Robotics',
                'Software & Systems',
                'AI & Embedded',
                'Open Hack & Demo',
              ] as BuilderTrack[]
            ).map((track) => {
              const count = currentMonthStats.trackBreakdown[track] || 0;
              const total = currentMonthStats.totalCheckIns || 1;
              const pct = Math.round((count / total) * 100);

              return (
                <div key={track} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-200">{track}</span>
                    <span className="font-mono tabular-nums text-zinc-400">
                      {count} check-ins ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                    <div
                      className={`h-full transition-all duration-500 ${
                        track === 'Hardware & Robotics'
                          ? 'bg-[#b5ff00]'
                          : track === 'Software & Systems'
                          ? 'bg-[#00d2ef]'
                          : track === 'AI & Embedded'
                          ? 'bg-[#ac4bff]'
                          : 'bg-[#0066ff]'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-zinc-800 text-[11px] text-zinc-400 space-y-1">
            <div className="flex items-center justify-between">
              <span>Club Target:</span>
              <span className="font-mono text-zinc-300">Min. 70% Monthly Active Rate</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Current Status:</span>
              <span className="font-mono text-[#b5ff00] font-semibold">
                {currentMonthStats.activeRatePercent >= 70 ? 'Target Met (Nominal)' : 'Under Target'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top 5 Streak Leaderboard Section */}
      <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950 p-6 space-y-5 shadow-[0_0_30px_rgba(249,115,22,0.06)] relative overflow-hidden">
        {/* Subtle background ambient gradients */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-[#b5ff00]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-wrap items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 rounded-lg bg-orange-500/20 border border-orange-500/40 items-center justify-center text-orange-400">
                <Flame className="h-4 w-4 fill-orange-400 animate-pulse" />
              </span>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-orange-400">
                Guild Consistency Arena
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
                Top 5 Streakers
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold font-display uppercase tracking-tight text-white flex items-center gap-2">
              <span>Top 5 Streak Leaderboard</span>
              <Trophy className="h-4 w-4 text-amber-400" />
            </h2>
            <p className="text-xs text-zinc-400 max-w-2xl">
              Honoring the top 5 builders with the longest active consecutive workshop streaks. Consistency is the true hallmark of craft.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="px-3.5 py-1.5 rounded-full bg-orange-950/40 border border-orange-500/30 text-xs font-mono text-orange-300 flex items-center gap-1.5 shadow-[0_0_15px_rgba(249,115,22,0.15)]">
              <Flame className="h-4 w-4 text-orange-400 fill-orange-400 animate-pulse" />
              <span>Target: <strong className="text-white">5+ Continuous Sessions</strong></span>
            </div>
          </div>
        </div>

        {/* Top 5 Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 relative z-10">
          {topStreakBuilders.map((builder, index) => {
            const isFirst = index === 0;
            const isSecond = index === 1;
            const isThird = index === 2;

            const rankBadge = isFirst
              ? { text: '#1 Champion', style: 'border-amber-400/50 bg-amber-500/15 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.25)]', icon: Crown }
              : isSecond
              ? { text: '#2 Contender', style: 'border-zinc-300/40 bg-zinc-300/10 text-zinc-200', icon: Medal }
              : isThird
              ? { text: '#3 Vanguard', style: 'border-amber-700/40 bg-amber-700/10 text-amber-400', icon: Medal }
              : { text: `#${index + 1} Builder`, style: 'border-zinc-800 bg-zinc-900 text-zinc-400', icon: Trophy };

            const RankIcon = rankBadge.icon;

            return (
              <div
                key={builder.id}
                className={`relative rounded-2xl p-4 flex flex-col justify-between transition-all group hover:scale-[1.02] ${
                  isFirst
                    ? 'border-2 border-amber-400/50 bg-gradient-to-b from-amber-950/40 via-zinc-950 to-zinc-950 shadow-[0_0_25px_rgba(251,191,36,0.15)]'
                    : isSecond
                    ? 'border border-zinc-400/40 bg-gradient-to-b from-zinc-900/60 to-zinc-950 hover:border-zinc-300/60'
                    : isThird
                    ? 'border border-amber-800/40 bg-gradient-to-b from-amber-950/20 to-zinc-950 hover:border-amber-700/60'
                    : 'border border-zinc-800/80 bg-zinc-950 hover:border-zinc-700'
                }`}
              >
                <div>
                  {/* Top Rank Header & Gamified Flame Badge */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border ${rankBadge.style}`}>
                      <RankIcon className="h-3 w-3" />
                      <span>{rankBadge.text}</span>
                    </span>

                    {/* Small Flame Icon with current streak number */}
                    <div
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-950/70 border border-orange-500/50 text-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.3)]"
                      title={`${builder.currentStreak} consecutive workshop sessions`}
                    >
                      <Flame className="h-3.5 w-3.5 text-orange-400 fill-orange-400 animate-pulse" />
                      <span className="font-mono font-black text-xs text-orange-200">
                        {builder.currentStreak}
                      </span>
                    </div>
                  </div>

                  {/* Builder Avatar & Info */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-11 w-11 rounded-xl flex items-center justify-center font-bold font-display text-base shrink-0 transition-transform group-hover:scale-105 ${
                        isFirst
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-400/60 shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                          : isSecond
                          ? 'bg-zinc-400/20 text-zinc-200 border border-zinc-400/50'
                          : isThird
                          ? 'bg-amber-700/20 text-amber-300 border border-amber-700/50'
                          : 'bg-zinc-900 text-[#b5ff00] border border-zinc-800'
                      }`}
                    >
                      {builder.name.charAt(0)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="text-xs font-bold font-display text-white truncate group-hover:text-[#b5ff00] transition-colors">
                        {builder.name}
                      </h3>
                      <p className="text-[11px] text-zinc-500 font-mono truncate">
                        {builder.handle}
                      </p>
                      <span className="text-[10px] font-mono text-zinc-400 block mt-0.5">
                        {builder.role}
                      </span>
                    </div>
                  </div>

                  {/* Streak Stats Highlight */}
                  <div className="mt-3.5 pt-3 border-t border-zinc-800/80 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-zinc-500">Current Streak:</span>
                      <span className="text-orange-400 font-bold flex items-center gap-1">
                        <Flame className="h-3 w-3 fill-orange-400" />
                        <span>{builder.currentStreak} sessions</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-zinc-500">Best Streak:</span>
                      <span className="text-zinc-300 font-semibold">{builder.bestStreak} sessions</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-zinc-500">Total Check-ins:</span>
                      <span className="text-zinc-300">{builder.totalCheckIns}</span>
                    </div>
                  </div>
                </div>

                {/* Footer Pass Action */}
                <div className="mt-3 pt-2.5 border-t border-zinc-800/60">
                  <button
                    type="button"
                    onClick={() => onViewMemberPass(builder)}
                    className="w-full min-h-11 flex items-center justify-center gap-1.5 py-2 px-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-[#b5ff00]/50 rounded-xl text-xs font-mono text-zinc-200 hover:text-white transition-all cursor-pointer"
                  >
                    <QrCode className="h-3.5 w-3.5 text-[#b5ff00]" aria-hidden="true" />
                    <span>View Pass</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Builder Monthly Leaderboard & Streak Consistency */}
      <div className="rounded-3xl glass-panel p-6 sm:p-7 space-y-5 spatial-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold font-display uppercase tracking-tight text-white flex items-center gap-2">
              <Award className="h-5 w-5 text-[#b5ff00]" />
              <span>Builder Consistency & Leaderboard</span>
            </h2>
            <p className="text-xs text-zinc-400">
              Ranked participation, attendance rate, and streak status for {currentMonthStats.monthLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* View Mode Toggle: Cards vs Table */}
            <div className="flex items-center p-1 bg-black/60 rounded-2xl border border-white/5 neu-inset text-xs">
              <button
                onClick={() => setDisplayMode('cards')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
                  displayMode === 'cards'
                    ? 'bg-[#141720] text-[#b5ff00] font-bold neu-raised-sm border border-[#b5ff00]/30 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Cards view with gamified streak badges"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Cards</span>
              </button>
              <button
                onClick={() => setDisplayMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
                  displayMode === 'table'
                    ? 'bg-[#141720] text-[#b5ff00] font-bold neu-raised-sm border border-[#b5ff00]/30 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Tabular data view"
              >
                <List className="h-3.5 w-3.5" />
                <span>Table</span>
              </button>
            </div>

            {/* Ranking metric filter: By Attendance vs By Streak */}
            <div className="flex items-center p-1 bg-black/60 rounded-2xl border border-white/5 neu-inset text-xs">
              <button
                onClick={() => setActiveLeaderboardTab('attendance')}
                className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
                  activeLeaderboardTab === 'attendance'
                    ? 'bg-[#141720] text-[#b5ff00] font-bold neu-raised-sm border border-[#b5ff00]/30 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Rank by Turnout
              </button>
              <button
                onClick={() => setActiveLeaderboardTab('streak')}
                className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer ${
                  activeLeaderboardTab === 'streak'
                    ? 'bg-[#141720] text-orange-400 font-bold neu-raised-sm border border-orange-500/30 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Rank by Streak
              </button>
            </div>
          </div>
        </div>

        {/* Member Display Cards View (Gamified flame streak badges) */}
        {displayMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pt-1">
            {currentMonthStats.topBuilders
              .slice()
              .sort((a, b) =>
                activeLeaderboardTab === 'attendance'
                  ? b.monthlyCount - a.monthlyCount || b.streak - a.streak
                  : b.streak - a.streak || b.monthlyCount - a.monthlyCount
              )
              .map((item, idx) => {
                const tier = getBuilderTier(item.monthlyCount, currentMonthStats.totalSessions);
                return (
                  <div
                    key={item.member.id}
                    className="rounded-2xl border border-zinc-800/90 bg-zinc-950 p-4 space-y-3.5 hover:border-[#b5ff00]/40 transition-all flex flex-col justify-between group shadow-sm hover:shadow-[0_0_20px_rgba(181,255,0,0.06)]"
                  >
                    <div className="space-y-3">
                      {/* Card Header: Rank # & Gamified Streak Badge with Flame Icon */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-zinc-500 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800">
                          Rank #{idx + 1}
                        </span>

                        {/* Gamified Flame Streak Badge */}
                        <div
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-950/60 border border-orange-500/40 text-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.2)]"
                          title={`Current streak: ${item.streak} consecutive sessions`}
                        >
                          <Flame className="h-3.5 w-3.5 text-orange-400 fill-orange-400 animate-pulse" />
                          <span className="font-mono font-bold text-xs text-orange-200">{item.streak}</span>
                          <span className="text-[10px] text-orange-400/80 font-mono uppercase font-semibold">Streak</span>
                        </div>
                      </div>

                      {/* Builder Info */}
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-xl bg-zinc-900 border border-zinc-800 group-hover:border-[#b5ff00]/40 flex items-center justify-center font-bold font-display text-sm text-[#b5ff00] shrink-0 transition-colors">
                          {item.member.name.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold font-display text-white group-hover:text-[#b5ff00] transition-colors truncate">
                            {item.member.name}
                          </h3>
                          <div className="text-xs text-zinc-500 font-mono truncate">
                            {item.member.handle}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-mono text-zinc-400">
                              {item.member.role}
                            </span>
                            <span className="text-zinc-700">·</span>
                            <span
                              className={`text-[10px] font-mono font-semibold ${
                                tier === 'Guild Architect'
                                  ? 'text-[#b5ff00]'
                                  : tier === 'Master Craftsman'
                                  ? 'text-purple-400'
                                  : tier === 'Active Builder'
                                  ? 'text-cyan-400'
                                  : 'text-zinc-400'
                              }`}
                            >
                              {tier}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Monthly Sessions & Progress */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-zinc-500 text-[11px]">Monthly Sessions:</span>
                          <span className="text-zinc-200 font-bold tabular-nums">
                            {item.monthlyCount} / {currentMonthStats.totalSessions} ({item.participationRate}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                          <div
                            className="h-full bg-[#b5ff00] transition-all duration-300"
                            style={{ width: `${item.participationRate}%` }}
                          />
                        </div>
                      </div>

                      {/* Milestones mini strip */}
                      <div className="pt-2 flex items-center justify-between border-t border-zinc-800/80">
                        <span className="text-[10px] text-zinc-500 font-mono uppercase">Milestones</span>
                        <AttendanceBadges
                          member={item.member}
                          mode="mini"
                          stats={{
                            total: memberStatsMap.get(item.member.id)?.total ?? 0,
                            streak: item.streak,
                            bestStreak: item.bestStreak,
                          }}
                        />
                      </div>
                    </div>

                    {/* Card Footer: Pass CTA */}
                    <div className="pt-2.5 border-t border-zinc-800/80">
                      <button
                        type="button"
                        onClick={() => onViewMemberPass(item.member)}
                        className="w-full min-h-11 flex items-center justify-center gap-1.5 py-2 px-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-[#b5ff00]/50 rounded-xl text-xs font-mono text-zinc-200 hover:text-white transition-all cursor-pointer"
                      >
                        <QrCode className="h-3.5 w-3.5 text-[#b5ff00]" aria-hidden="true" />
                        <span>View Pass</span>
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          /* Dense Leaderboard Table */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 font-medium">
                  <th className="py-2.5 px-3 w-12 text-center">#</th>
                  <th className="py-2.5 px-3">Builder</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Monthly Sessions</th>
                  <th className="py-2.5 px-3">Participation</th>
                  <th className="py-2.5 px-3">Current Streak</th>
                  <th className="py-2.5 px-3">Tier</th>
                  <th className="py-2.5 px-3">Milestones</th>
                  <th className="py-2.5 px-3 text-right">Pass</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {currentMonthStats.topBuilders
                  .slice()
                  .sort((a: any, b: any) =>
                    activeLeaderboardTab === 'attendance'
                      ? b.monthlyCount - a.monthlyCount || b.streak - a.streak
                      : b.streak - a.streak || b.monthlyCount - a.monthlyCount
                  )
                  .map((item: any, idx: number) => {
                    const tier = getBuilderTier(item.monthlyCount, currentMonthStats.totalSessions);
                    return (
                      <tr key={item.member.id} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-3 text-center font-mono text-zinc-500 tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-zinc-200">{item.member.name}</div>
                          <div className="text-[11px] text-zinc-500 font-mono">{item.member.handle}</div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="text-zinc-400">{item.member.role}</span>
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-zinc-200">
                          {item.monthlyCount} / {currentMonthStats.totalSessions}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono tabular-nums text-zinc-300 w-9">
                              {item.participationRate}%
                            </span>
                            <div className="h-1.5 w-16 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#b5ff00]"
                                style={{ width: `${item.participationRate}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-950/40 border border-orange-500/30 text-orange-400 font-medium shadow-[0_0_8px_rgba(249,115,22,0.15)]">
                            <Flame className="h-3.5 w-3.5 text-orange-400 fill-orange-400 animate-pulse" />
                            <span className="font-bold text-orange-200">{item.streak}</span>
                            <span className="text-[10px] text-orange-400/80 uppercase">streak</span>
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`text-[11px] font-medium ${
                              tier === 'Guild Architect'
                                ? 'text-[#b5ff00] font-semibold'
                                : tier === 'Master Craftsman'
                                ? 'text-purple-400'
                                : tier === 'Active Builder'
                                ? 'text-cyan-400'
                                : 'text-zinc-400'
                            }`}
                          >
                            {tier}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <AttendanceBadges
                            member={item.member}
                            mode="mini"
                            stats={{
                              total: memberStatsMap.get(item.member.id)?.total ?? 0,
                              streak: item.streak,
                              bestStreak: item.bestStreak,
                            }}
                          />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => onViewMemberPass(item.member)}
                            aria-label={`View builder pass for ${item.member.name}`}
                            className="min-h-11 min-w-11 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-mono transition-colors cursor-pointer"
                          >
                            Pass
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filterable Check-in Activity Log */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Check-in Verification Log ({monthlyRecords.length} Entries)
            </h2>
            <p className="text-xs text-zinc-400">
              Audit trail of scanned builder sessions for {currentMonthStats.monthLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:flex-initial min-w-[180px]">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search builder or session in activity log"
                placeholder="Search builder or session..."
                className="w-full min-h-11 bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-[#b5ff00]"
              />
            </div>

            {/* Track Filter */}
            <select
              value={selectedTrackFilter}
              onChange={(e) => setSelectedTrackFilter(e.target.value)}
              aria-label="Filter check-in log by track"
              className="min-h-11 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-[#b5ff00] cursor-pointer"
            >
              <option value="all">All Tracks</option>
              <option value="Hardware & Robotics">Hardware & Robotics</option>
              <option value="Software & Systems">Software & Systems</option>
              <option value="AI & Embedded">AI & Embedded</option>
              <option value="Open Hack & Demo">Open Hack & Demo</option>
            </select>
          </div>
        </div>

        {/* Table of Records */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 font-medium">
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Builder</th>
                <th className="py-2.5 px-3">Session</th>
                <th className="py-2.5 px-3">Track</th>
                <th className="py-2.5 px-3 text-right">Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {monthlyRecords.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500 text-xs">
                    No check-in records match the current filter.
                  </td>
                </tr>
              ) : (
                monthlyRecords.map((record) => {
                  const mem = memberMap.get(record.memberId);
                  const sess = sessionMap.get(record.sessionId);
                  const displayName = mem?.name || record.memberName || 'Club Builder';
                  const displayHandle = mem?.handle || record.memberHandle || '';
                  const displaySession = sess?.title || record.sessionTitle || 'Workshop Session';
                  const displayTrack = sess?.track || record.track || '—';
                  return (
                    <tr key={record.id} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-zinc-400 whitespace-nowrap">
                        {formatTimeInClubTz(record.checkedInAt || record.timestamp)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-zinc-200">{displayName}</div>
                        <div className="text-[11px] text-zinc-500 font-mono">{displayHandle}</div>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-300 max-w-xs truncate">
                        {displaySession}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400 whitespace-nowrap">
                        {displayTrack}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="font-mono text-[10px] text-[#b5ff00] uppercase font-semibold">
                          {(record.method || 'code_input').replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
