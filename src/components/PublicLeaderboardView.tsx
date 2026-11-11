import React, { useState, useMemo, useEffect } from 'react';
import { PublicLeaderboardItem } from '../types';
import { useAuth } from '../firebase/AuthContext';
import { DEMO_LEADERBOARD_ITEMS } from '../config/demoLeaderboardData';
import { backfillPublicLeaderboard } from '../firebase/firestoreService';
import { Podium } from './leaderboard/Podium';
import { RankingList, LeaderboardPeriod } from './leaderboard/RankingList';
import { HallOfFame } from './leaderboard/HallOfFame';
import { MemberProfileModal } from './leaderboard/MemberProfileModal';
import { ShareCardModal } from './leaderboard/ShareCardModal';
import { getSeoulMonthKey } from '../config/tierConfig';
import {
  Trophy,
  Crown,
  Sparkles,
  Flame,
  LogIn,
  RefreshCw,
  QrCode,
  Zap,
  Shield,
  Layers,
  ChevronRight,
  Info,
  Search,
} from 'lucide-react';
import { m } from 'motion/react';

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
  const { user, isAdmin, signInWithGoogle } = useAuth();

  // FX Toggle state saved in localStorage (with prefers-reduced-motion check)
  const [fxEnabled, setFxEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return false;
    const saved = localStorage.getItem('dob_leaderboard_fx');
    return saved !== null ? saved === 'true' : true;
  });

  const toggleFx = () => {
    setFxEnabled((prev) => {
      const next = !prev;
      localStorage.setItem('dob_leaderboard_fx', String(next));
      return next;
    });
  };

  // Check URL ?demo=1 or dev mode fallback (Requirement 3)
  const isDemoMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const searchParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash || '';
    const hasParam = searchParams.get('demo') === '1' || hash.includes('demo=1');
    const isDevEmpty = Boolean(import.meta.env.DEV && items.length === 0);
    return hasParam || isDevEmpty;
  }, [items.length]);

  // Active items: use real items, or demo items only when demo mode is active
  const activeItems: PublicLeaderboardItem[] = useMemo(() => {
    if (items && items.length > 0) {
      return items;
    }
    if (isDemoMode) {
      return DEMO_LEADERBOARD_ITEMS;
    }
    return [];
  }, [items, isDemoMode]);

  // Selected period state: 'all_time' (default) | 'this_month' (semester omitted)
  const [selectedPeriod, setSelectedPeriod] = useState<LeaderboardPeriod>('all_time');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<string>('all');

  // Modals state
  const [selectedMember, setSelectedMember] = useState<PublicLeaderboardItem | null>(null);
  const [selectedMemberRank, setSelectedMemberRank] = useState<number | undefined>(undefined);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [shareCardMember, setShareCardMember] = useState<PublicLeaderboardItem | null>(null);
  const [shareCardRank, setShareCardRank] = useState<number | undefined>(undefined);
  const [isShareCardOpen, setIsShareCardOpen] = useState(false);

  // Admin backfill status
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const handleAdminBackfill = async () => {
    if (!isAdmin) return;
    setBackfilling(true);
    setBackfillMessage(null);
    try {
      const res = await backfillPublicLeaderboard();
      setBackfillMessage(`Synced ${res.totalBackfilled} builders!`);
      setTimeout(() => setBackfillMessage(null), 4000);
    } catch (err: any) {
      setBackfillMessage('Backfill error: ' + (err?.message || 'Check permissions'));
    } finally {
      setBackfilling(false);
    }
  };

  const handleSelectMember = (item: PublicLeaderboardItem, rank?: number) => {
    setSelectedMember(item);
    setSelectedMemberRank(rank);
    setIsProfileModalOpen(true);
  };

  const handleOpenShareCard = (item: PublicLeaderboardItem, rank?: number) => {
    setIsProfileModalOpen(false);
    setShareCardMember(item);
    setShareCardRank(rank);
    setIsShareCardOpen(true);
  };

  // Active month resolution: If Seoul current month (e.g. 2026-11) has recorded check-ins, use it;
  // otherwise fallback to the most recent month key with recorded check-ins (e.g. 2026-10).
  const activeMonthKey = useMemo(() => {
    const seoulMonth = getSeoulMonthKey();
    const hasCurrentMonthData = activeItems.some(
      (item) => (item.monthlyCheckIns?.[seoulMonth] || 0) > 0
    );
    if (hasCurrentMonthData) return seoulMonth;
    const allMonths = new Set<string>();
    activeItems.forEach((item) => {
      const monthly = item.monthlyCheckIns;
      if (monthly) {
        Object.keys(monthly).forEach((m) => {
          if ((monthly[m] || 0) > 0) allMonths.add(m);
        });
      }
    });
    const sorted = Array.from(allMonths).sort().reverse();
    return sorted[0] || seoulMonth;
  }, [activeItems]);

  // Compute period points and period check-ins for each item (omitting semester)
  const periodRankedItems = useMemo(() => {
    const mapped = activeItems.map((item) => {
      let periodPoints = 0;
      let periodCheckIns = 0;

      if (selectedPeriod === 'this_month') {
        periodCheckIns = item.monthlyCheckIns?.[activeMonthKey] || 0;
        periodPoints = periodCheckIns * 10;
      } else {
        periodPoints = item.totalPoints ?? item.points ?? 0;
        periodCheckIns = item.totalCheckIns || 0;
      }

      return {
        ...item,
        displayPoints: periodPoints,
        displayCheckIns: periodCheckIns,
      };
    });

    mapped.sort((a, b) => {
      if (b.displayPoints !== a.displayPoints) {
        return b.displayPoints - a.displayPoints;
      }
      return b.displayCheckIns - a.displayCheckIns;
    });

    return mapped;
  }, [activeItems, selectedPeriod, activeMonthKey]);

  // Filter ranked items by search and track
  const filteredRankedItems = useMemo(() => {
    return periodRankedItems.filter((item) => {
      if (selectedTrack !== 'all' && !item.tracks?.includes(selectedTrack as any)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const name = (item.displayName || item.name || '').toLowerCase();
        const handle = (item.handle || '').toLowerCase();
        const role = (item.role || '').toLowerCase();
        return name.includes(q) || handle.includes(q) || role.includes(q);
      }
      return true;
    });
  }, [periodRankedItems, selectedTrack, searchQuery]);

  // Top 3 Podium items for active period (respecting filters)
  const topThree = useMemo(() => filteredRankedItems.slice(0, 3), [filteredRankedItems]);

  // Guild aggregate KPIs starting from All time and then this month
  const totalBuilders = activeItems.length;
  const totalAllTimePoints = useMemo(() => {
    return activeItems.reduce((acc, i) => acc + (i.totalPoints ?? i.points ?? 0), 0);
  }, [activeItems]);

  const totalMonthPoints = useMemo(() => {
    return activeItems.reduce(
      (acc, i) => acc + ((i.monthlyCheckIns?.[activeMonthKey] || 0) * 10),
      0
    );
  }, [activeItems, activeMonthKey]);

  const recordStreak = useMemo(() => {
    return activeItems.reduce(
      (max, i) => Math.max(max, i.bestStreak || i.currentStreak || 0),
      0
    );
  }, [activeItems]);

  return (
    <div className={`relative min-h-screen space-y-8 pb-16 ${fxEnabled ? '' : 'reduced-fx'}`}>
      {/* Optional subtle scanlines overlay if FX is enabled */}
      {fxEnabled && (
        <div className="fixed inset-0 scanlines-overlay z-0 opacity-40 pointer-events-none" />
      )}

      {/* Demo Mode Notice Banner if active */}
      {isDemoMode && items.length === 0 && (
        <div className="relative z-10 px-4 py-2.5 rounded-2xl bg-[#2DE2E6]/10 border border-[#2DE2E6]/30 text-[#2DE2E6] text-xs font-rajdhani font-bold flex items-center justify-between gap-3 shadow-[0_0_20px_rgba(45,226,230,0.18)] backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>
              DEMO SIMULATION ACTIVE (?demo=1) · Displaying simulated guild profiles for visual inspection.
            </span>
          </div>
          <span className="text-[10px] font-orbitron uppercase text-zinc-400">
            Preview Mode
          </span>
        </div>
      )}

      {/* Hero Cyber Header */}
      <div className="relative rounded-[28px] bg-[#0c0e14]/85 border border-white/10 p-6 sm:p-10 overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.1)] grain-overlay z-10">
        {/* Neon Ambient Glows */}
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-[#FF7A1A]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-[#2DE2E6]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-[#FF7A1A]/15 border border-[#FF7A1A]/35 text-[#FF7A1A] text-xs font-orbitron font-black uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_15px_rgba(255,122,26,0.25)]">
                <Crown className="w-3.5 h-3.5 text-[#FF7A1A]" />
                Public Hall of Builders
              </span>
              <span className="text-zinc-600 font-mono">·</span>
              <span className="text-zinc-400 text-xs font-rajdhani font-semibold tracking-wide">
                Live Builder &amp; Workshop Rankings · Seoul Timezone (KST)
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-black font-orbitron text-white/92 uppercase tracking-tight">
              Guild Attendance &amp; Participation
            </h1>

            <p className="text-xs sm:text-sm font-sans font-normal text-white/60 max-w-2xl leading-relaxed">
              Official public telemetry recognizing builder consistency, sprint hack streaks, and workshop achievements.
              {!user && ' Sign in with your Google account to log verified check-ins and rank on the leaderboard.'}
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="shrink-0 flex flex-wrap items-center gap-2.5">
            {/* FX ON / OFF Toggle */}
            <button
              type="button"
              onClick={toggleFx}
              title="Toggle Cyber FX and Scanline Animations"
              className={`btn-glossy-secondary px-4 py-2 rounded-full text-xs font-orbitron font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 min-h-11 ${
                fxEnabled
                  ? 'text-[#FF7A1A] border-[#FF7A1A]/40'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>FX: {fxEnabled ? 'ON' : 'OFF'}</span>
            </button>

            {!user ? (
              <button
                type="button"
                onClick={() => {
                  if (onOpenLogin) onOpenLogin();
                  else signInWithGoogle();
                }}
                className="btn-glossy-primary px-6 py-2.5 rounded-full text-black font-orbitron font-black text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer min-h-11"
              >
                <LogIn className="w-4 h-4 text-black" />
                <span>Sign In with Google</span>
              </button>
            ) : hasActiveSession || onOpenScanner ? (
              <button
                type="button"
                onClick={onOpenScanner}
                className="px-5 py-2.5 rounded-xl bg-[#2DE2E6] hover:bg-[#3be5e9] text-black font-orbitron font-black text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(45,226,230,0.35)] flex items-center gap-2 cursor-pointer border border-white/20 min-h-11 active:scale-95"
              >
                <QrCode className="w-4 h-4 text-black" />
                <span>Check In to Session</span>
              </button>
            ) : null}

            {/* Admin Backfill Button */}
            {isAdmin && (
              <button
                type="button"
                onClick={handleAdminBackfill}
                disabled={backfilling}
                title="Synchronize and backfill the publicLeaderboard collection from active roster"
                className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/15 text-xs font-orbitron font-bold text-zinc-200 transition-all flex items-center gap-2 cursor-pointer min-h-11 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#00F0FF] ${backfilling ? 'animate-spin' : ''}`} />
                <span>{backfilling ? 'Syncing...' : 'Sync Leaderboard'}</span>
              </button>
            )}
          </div>
        </div>

        {backfillMessage && (
          <div className="mt-3 p-2.5 rounded-xl bg-[#00F0FF]/15 border border-[#00F0FF]/40 text-[#00F0FF] text-xs font-rajdhani font-bold flex items-center gap-2">
            <Info className="w-4 h-4" />
            <span>{backfillMessage}</span>
          </div>
        )}

        {/* Live Guild KPIs: starting from All time and then this month */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-8 pt-6 border-t border-white/10 relative z-10">
          <div className="p-4 rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/10 glass-card-hairline">
            <span className="text-[11px] font-rajdhani uppercase tracking-wider text-white/60 font-bold block">
              Active Builders
            </span>
            <span className="text-2xl sm:text-3xl font-orbitron font-black text-white/92 mt-1 block tabular-nums num-grad-silver">
              {totalBuilders}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/10 glass-card-hairline">
            <span className="text-[11px] font-rajdhani uppercase tracking-wider text-white/60 font-bold block">
              All Time Points
            </span>
            <span className="text-2xl sm:text-3xl font-orbitron font-black text-[#FF7A1A] mt-1 block tabular-nums num-grad-ember">
              {totalAllTimePoints}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/10 glass-card-hairline">
            <span className="text-[11px] font-rajdhani uppercase tracking-wider text-white/60 font-bold block">
              This Month Points
            </span>
            <span className="text-2xl sm:text-3xl font-orbitron font-black text-[#FFB36B] mt-1 block tabular-nums">
              {totalMonthPoints}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-white/[0.03] backdrop-blur-sm border border-white/10 glass-card-hairline">
            <span className="text-[11px] font-rajdhani uppercase tracking-wider text-white/60 font-bold flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-[#FF7A1A]" />
              <span>Record Streak</span>
            </span>
            <span className="text-2xl sm:text-3xl font-orbitron font-black text-[#2DE2E6] mt-1 block tabular-nums num-grad-aqua">
              {recordStreak} <span className="text-xs text-white/40 font-normal">sessions</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {activeItems.length === 0 ? (
        /* Empty State for Real Visitors when no one is on the board yet (Requirement 3) */
        <div className="rounded-3xl bg-white/[0.04] backdrop-blur-md border border-white/10 p-12 sm:p-16 text-center space-y-4 shadow-[0_0_40px_rgba(0,0,0,0.6)] glass-card-hairline">
          <div className="w-16 h-16 rounded-2xl bg-[#FF7A1A]/10 border border-[#FF7A1A]/30 mx-auto flex items-center justify-center text-[#FF7A1A] shadow-[0_0_20px_rgba(255,122,26,0.25)]">
            <Trophy className="w-8 h-8" />
          </div>

          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="font-orbitron font-black text-lg sm:text-xl text-white/92 uppercase">
              No Builders on the Board Yet
            </h3>
            <p className="font-rajdhani text-sm text-white/60 leading-relaxed">
              Be the first guild member to check in to an active workshop session to claim the #1 Champion Throne on the public board!
            </p>
          </div>

          <div className="pt-2 flex items-center justify-center gap-3">
            {!user ? (
              <button
                type="button"
                onClick={() => {
                  if (onOpenLogin) onOpenLogin();
                  else signInWithGoogle();
                }}
                className="px-5 py-2.5 rounded-xl bg-[#FF6A00] hover:bg-[#FF7A1A] text-black font-orbitron font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(255,106,0,0.4)] cursor-pointer"
              >
                Sign In to Join
              </button>
            ) : isAdmin ? (
              <button
                type="button"
                onClick={handleAdminBackfill}
                className="px-5 py-2.5 rounded-xl bg-[#00F0FF] hover:bg-[#2bf3ff] text-black font-orbitron font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(0,240,255,0.4)] cursor-pointer"
              >
                Backfill Roster into Public Leaderboard
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Controls: Period Tabs & Search & Track Filter - Positioned BEFORE Top Guild Podium */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2">
            {/* Animated sliding pill tabs: All Time first, then This Month */}
            <div className="relative inline-flex rounded-2xl bg-white/[0.03] p-1 border border-white/[0.08] backdrop-blur-md">
              <button
                type="button"
                onClick={() => setSelectedPeriod('all_time')}
                className={`relative px-4 py-2 rounded-xl font-orbitron text-xs font-bold uppercase tracking-wider transition-colors z-10 cursor-pointer ${
                  selectedPeriod === 'all_time' ? 'text-black' : 'text-white/58 hover:text-white'
                }`}
              >
                {selectedPeriod === 'all_time' && (
                  <m.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#E879F9] shadow-[0_0_16px_rgba(232,121,249,0.35)] -z-10"
                  />
                )}
                All Time
              </button>

              <button
                type="button"
                onClick={() => setSelectedPeriod('this_month')}
                className={`relative px-4 py-2 rounded-xl font-orbitron text-xs font-bold uppercase tracking-wider transition-colors z-10 cursor-pointer ${
                  selectedPeriod === 'this_month' ? 'text-black' : 'text-white/58 hover:text-white'
                }`}
              >
                {selectedPeriod === 'this_month' && (
                  <m.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#FFB36B] via-[#FF7A1A] to-[#FF4D2E] shadow-[0_0_16px_rgba(255,122,26,0.35)] -z-10"
                  />
                )}
                This Month
              </button>
            </div>

            {/* Search & Track Filter */}
            <div className="flex items-center gap-2 flex-1 md:max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/38" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search builder or handle..."
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-xs font-rajdhani font-semibold text-white/92 placeholder-white/38 focus:outline-none focus:border-white/20 transition-colors min-h-10"
                />
              </div>

              <select
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(e.target.value)}
                aria-label="Filter tracks"
                className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-xs font-rajdhani font-semibold text-white/70 focus:outline-none min-h-10 cursor-pointer"
              >
                <option value="all">All Tracks</option>
                <option value="Hardware & Robotics">Hardware &amp; Robotics</option>
                <option value="Software & Systems">Software &amp; Systems</option>
                <option value="AI & Embedded">AI &amp; Embedded</option>
                <option value="Open Hack & Demo">Open Hack &amp; Demo</option>
              </select>
            </div>
          </div>

          {/* Top 3 Podium */}
          <Podium
            topItems={topThree}
            onSelectMember={handleSelectMember}
            disableAnimation={!fxEnabled}
            periodLabel={selectedPeriod === 'this_month' ? 'Monthly' : 'All Time'}
          />

          {/* Hall of Fame: Past Monthly Champions */}
          <HallOfFame
            items={activeItems}
            onSelectMember={(item) => handleSelectMember(item)}
          />

          {/* Ranking List: Periods, Search, Filters, Rank Delta */}
          <RankingList
            items={activeItems}
            selectedPeriod={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
            onSelectMember={handleSelectMember}
            disableAnimation={!fxEnabled}
            searchQuery={searchQuery}
            selectedTrack={selectedTrack}
            showControls={false}
          />
        </div>
      )}

      {/* Builder Profile Telemetry Modal */}
      <MemberProfileModal
        item={selectedMember}
        rank={selectedMemberRank}
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        onOpenShareCard={handleOpenShareCard}
        disableAnimation={!fxEnabled}
      />

      {/* Builder Share Card Modal */}
      <ShareCardModal
        item={shareCardMember}
        rank={shareCardRank}
        isOpen={isShareCardOpen}
        onClose={() => setIsShareCardOpen(false)}
      />
    </div>
  );
};
