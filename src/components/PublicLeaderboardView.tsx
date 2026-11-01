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
import { getSeoulMonthKey, getSeoulSemesterInfo } from '../config/tierConfig';
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
} from 'lucide-react';

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

  // Selected period state: 'this_month' | 'semester' | 'all_time'
  const [selectedPeriod, setSelectedPeriod] = useState<LeaderboardPeriod>('this_month');

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

  const semesterInfo = useMemo(() => getSeoulSemesterInfo(), []);

  // Compute period points and period check-ins for each item
  const periodRankedItems = useMemo(() => {
    const mapped = activeItems.map((item) => {
      let periodPoints = 0;
      let periodCheckIns = 0;

      if (selectedPeriod === 'this_month') {
        periodCheckIns = item.monthlyCheckIns?.[activeMonthKey] || 0;
        periodPoints = periodCheckIns * 10;
      } else if (selectedPeriod === 'semester') {
        const months = semesterInfo.monthKeys;
        periodCheckIns = months.reduce(
          (sum, mKey) => sum + (item.monthlyCheckIns?.[mKey] || 0),
          0
        );
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
  }, [activeItems, selectedPeriod, activeMonthKey, semesterInfo]);

  // Top 3 Podium items for active period
  const topThree = useMemo(() => periodRankedItems.slice(0, 3), [periodRankedItems]);

  // Guild aggregate KPIs
  const totalBuilders = activeItems.length;
  const totalPeriodPoints = useMemo(() => {
    return periodRankedItems.reduce((acc, i) => acc + (i.displayPoints || 0), 0);
  }, [periodRankedItems]);

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
      <div className="relative rounded-3xl bg-white/[0.04] backdrop-blur-md border border-white/10 p-6 sm:p-10 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.7)] z-10 glass-card-hairline">
        {/* Neon Ambient Glows */}
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-[#FF7A1A]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-[#2DE2E6]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-xl bg-[#FF7A1A]/15 border border-[#FF7A1A]/35 text-[#FF7A1A] text-xs font-orbitron font-black uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_15px_rgba(255,122,26,0.25)]">
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
              className={`px-3 py-2 rounded-xl border text-xs font-orbitron font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 min-h-11 ${
                fxEnabled
                  ? 'bg-[#FF7A1A]/10 border-[#FF7A1A]/40 text-[#FF7A1A] shadow-[0_0_12px_rgba(255,122,26,0.2)]'
                  : 'bg-zinc-900 border-white/10 text-zinc-400 hover:text-zinc-200'
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
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#FFB36B] via-[#FF7A1A] to-[#FF4D2E] hover:brightness-110 text-black font-orbitron font-black text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(255,122,26,0.35)] flex items-center gap-2 cursor-pointer border border-white/20 min-h-11 active:scale-95"
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

        {/* Live Guild KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-8 pt-6 border-t border-white/10 relative z-10">
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
              {selectedPeriod === 'this_month' ? 'Monthly Points' : selectedPeriod === 'semester' ? 'Semester Points' : 'Total Guild Points'}
            </span>
            <span className="text-2xl sm:text-3xl font-orbitron font-black text-[#FF7A1A] mt-1 block tabular-nums num-grad-ember">
              {totalPeriodPoints}
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
          {/* Top 3 Podium */}
          <Podium
            topItems={topThree}
            onSelectMember={handleSelectMember}
            disableAnimation={!fxEnabled}
            periodLabel={selectedPeriod === 'this_month' ? 'Monthly' : selectedPeriod === 'semester' ? 'Semester' : 'Total'}
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
