import React, { useState, useMemo } from 'react';
import {
  Trophy,
  Crown,
  Medal,
  Flame,
  Search,
  LogIn,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { PublicLeaderboardItem, BuilderTrack } from '../types';
import { useAuth } from '../firebase/AuthContext';
import { m } from 'motion/react';
import { fadeUp, stagger } from '../motion/presets';

interface PublicLeaderboardViewProps {
  items: PublicLeaderboardItem[];
  onOpenLogin: () => void;
  onRefreshLeaderboard?: () => void;
  isRefreshing?: boolean;
  onOpenScanner?: () => void;
  hasActiveSession?: boolean;
}

export const PublicLeaderboardView: React.FC<PublicLeaderboardViewProps> = ({
  items,
  onOpenLogin,
  onRefreshLeaderboard,
  isRefreshing = false,
  onOpenScanner,
  hasActiveSession,
}) => {
  const { user, isAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'points' | 'attendance' | 'streak'>('points');

  const filteredItems = useMemo(() => {
    return items
      .filter((item) => {
        if (selectedTrack !== 'all' && !item.tracks?.includes(selectedTrack as BuilderTrack)) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchName = item.name.toLowerCase().includes(q);
          const matchHandle = item.handle.toLowerCase().includes(q);
          const matchRole = item.role.toLowerCase().includes(q);
          return matchName || matchHandle || matchRole;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'points') {
          return (b.points || 0) - (a.points || 0) || b.totalCheckIns - a.totalCheckIns;
        }
        if (sortBy === 'attendance') {
          return b.totalCheckIns - a.totalCheckIns || (b.points || 0) - (a.points || 0);
        }
        return b.currentStreak - a.currentStreak || (b.points || 0) - (a.points || 0);
      });
  }, [items, selectedTrack, searchQuery, sortBy]);

  const totalBuilders = items.length;
  const totalCheckInsAcrossGuild = items.reduce((acc, i) => acc + (i.totalCheckIns || 0), 0);
  const highestStreak = items.reduce((max, i) => Math.max(max, i.currentStreak || 0), 0);

  return (
    <div className="space-y-8 py-2">
      {/* Hero Banner */}
      <div className="relative rounded-3xl glass-panel p-6 sm:p-10 spatial-card overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#b5ff00]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00] text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 neu-raised-sm">
                <Sparkles className="h-3.5 w-3.5 text-[#b5ff00]" />
                Public Hall of Builders
              </span>
              <span className="text-zinc-600 font-mono">·</span>
              <span className="text-zinc-400 text-xs font-mono">Live Guild Rankings</span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-black font-display text-white uppercase tracking-tight">
              Attendance &amp; Participation Leaderboard
            </h1>

            <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl leading-relaxed">
              Real-time rankings honoring builder consistency, workshop hack streaks, and guild participation.
              {!user && ' Sign in with your Google account to record attendance at today’s session.'}
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-3">
            {user && (hasActiveSession || onOpenScanner) ? (
              <button
                type="button"
                onClick={onOpenScanner}
                aria-label="Check in to active session"
                className="px-5 py-3 rounded-2xl bg-[#b5ff00] hover:bg-[#c4ff26] active:scale-[0.98] text-black font-display font-black text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(181,255,0,0.3)] flex items-center gap-2.5 cursor-pointer border border-white/20 min-h-[44px]"
              >
                <LogIn className="h-4 w-4 text-black" />
                <span>Check In to Active Session</span>
              </button>
            ) : user && isAdmin && onRefreshLeaderboard ? (
              <button
                type="button"
                onClick={onRefreshLeaderboard}
                disabled={isRefreshing}
                aria-label="Refresh leaderboard rankings"
                className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-xs font-mono font-bold text-zinc-200 transition-all flex items-center gap-2 cursor-pointer min-h-[44px]"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-[#b5ff00] ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>{isRefreshing ? 'Refreshing...' : 'Refresh Leaderboard'}</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* Public Overview KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-8 pt-6 border-t border-white/10 relative z-10">
          <div className="p-4 rounded-2xl bg-[#0e1017]/80 border border-white/5 neu-inset">
            <p className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
              Active Builders
            </p>
            <p className="text-xl sm:text-3xl font-black font-display text-white mt-1">
              {totalBuilders}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-[#0e1017]/80 border border-white/5 neu-inset">
            <p className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
              Total Check-Ins
            </p>
            <p className="text-xl sm:text-3xl font-display font-black text-[#b5ff00] mt-1">
              {totalCheckInsAcrossGuild}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-[#0e1017]/80 border border-white/5 neu-inset">
            <p className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1">
              <Flame className="h-3.5 w-3.5 text-orange-400" />
              <span>Record Streak</span>
            </p>
            <p className="text-xl sm:text-3xl font-display font-black text-orange-400 mt-1">
              {highestStreak} <span className="text-xs text-zinc-400 font-normal">sessions</span>
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by builder name, handle, or guild role..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0e1017]/80 border border-white/10 neu-inset text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-[#b5ff00]/60 min-h-[44px]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedTrack}
            onChange={(e) => setSelectedTrack(e.target.value)}
            aria-label="Filter by track"
            className="px-3 py-2 rounded-xl bg-[#141720] border border-white/10 text-xs font-mono text-zinc-300 focus:outline-none min-h-[44px]"
          >
            <option value="all">All Tracks</option>
            <option value="Hardware & Robotics">Hardware &amp; Robotics</option>
            <option value="Software & Systems">Software &amp; Systems</option>
            <option value="AI & Embedded">AI &amp; Embedded</option>
            <option value="Open Hack & Demo">Open Hack &amp; Demo</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            aria-label="Sort rankings by"
            className="px-3 py-2 rounded-xl bg-[#141720] border border-white/10 text-xs font-mono text-zinc-300 focus:outline-none min-h-[44px]"
          >
            <option value="points">Sort: Total Points</option>
            <option value="attendance">Sort: Attendance Count</option>
            <option value="streak">Sort: Active Streak</option>
          </select>
        </div>
      </div>

      {/* Rankings List */}
      <m.div variants={stagger()} initial="hidden" animate="show" className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="p-12 text-center rounded-3xl glass-panel text-zinc-500 text-xs font-mono">
            No builder profiles match your search filter.
          </div>
        ) : (
          filteredItems.map((item, index) => {
            const isTop3 = index < 3;
            const isAnimated = index < 12;
            return (
              <m.div
                key={item.id}
                variants={isAnimated ? fadeUp : undefined}
                className={`p-4 sm:p-5 rounded-2xl transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  index === 0
                    ? 'glass-panel border-[#b5ff00]/50 shadow-[0_0_20px_rgba(181,255,0,0.15)] ring-1 ring-[#b5ff00]/30'
                    : 'glass-panel border-white/5'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 text-center shrink-0">
                    {index === 0 ? (
                      <Crown className="h-6 w-6 text-yellow-400 mx-auto" />
                    ) : index === 1 ? (
                      <Medal className="h-6 w-6 text-zinc-300 mx-auto" />
                    ) : index === 2 ? (
                      <Medal className="h-6 w-6 text-amber-600 mx-auto" />
                    ) : (
                      <span className="font-mono font-bold text-xs text-zinc-500">#{index + 1}</span>
                    )}
                  </div>

                  <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/10 overflow-hidden flex items-center justify-center font-display font-black text-sm text-[#b5ff00] shrink-0">
                    {item.avatarUrl ? (
                      <img
                        src={item.avatarUrl}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        width={48}
                        height={48}
                      />
                    ) : (
                      item.name.substring(0, 2).toUpperCase()
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold font-display text-white">{item.name}</h3>
                      <span className="px-2 py-0.5 rounded-lg bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00] text-[10px] font-mono font-bold uppercase">
                        {item.role}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 font-mono mt-0.5">{item.handle}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {item.tracks?.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-md bg-black/60 border border-white/5 text-[10px] text-zinc-400 font-mono">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 sm:gap-6 border-t sm:border-t-0 border-white/5 pt-3 sm:pt-0 shrink-0 font-mono">
                  <div className="text-right">
                    <span className="text-xs uppercase text-zinc-400 font-semibold block">Attendance</span>
                    <span className="text-base sm:text-lg font-black text-white">{item.totalCheckIns}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs uppercase text-zinc-400 font-semibold block">Streak</span>
                    <span className="text-base sm:text-lg font-black text-[#b5ff00] flex items-center gap-1 justify-end">
                      <Flame className="h-3.5 w-3.5 text-orange-400" />
                      {item.currentStreak}
                    </span>
                  </div>
                  <div className="text-right pl-2 sm:pl-3 border-l border-white/10">
                    <span className="text-xs uppercase text-zinc-400 font-semibold block">Points</span>
                    <span className="text-base sm:text-lg font-black text-yellow-400">{item.points || 0}</span>
                  </div>
                </div>
              </m.div>
            );
          })
        )}
      </m.div>
    </div>
  );
};
