import React, { useState, useMemo } from 'react';
import { PublicLeaderboardItem } from '../../types';
import { TierBadge } from './TierBadge';
import {
  getSeoulMonthKey,
  getSeoulPreviousMonthKey,
  getTier,
} from '../../config/tierConfig';
import {
  Search,
  ArrowUp,
  ArrowDown,
  Minus,
  Flame,
  ChevronRight,
} from 'lucide-react';
import { m } from 'motion/react';
import { fadeUp } from '../../motion/presets';
import { SecureAvatar } from '../common/SecureAvatar';

export type LeaderboardPeriod = 'all_time' | 'this_month';

interface RankingListProps {
  items: PublicLeaderboardItem[];
  selectedPeriod: LeaderboardPeriod;
  onPeriodChange?: (period: LeaderboardPeriod) => void;
  onSelectMember: (item: PublicLeaderboardItem, rank: number) => void;
  disableAnimation?: boolean;
  searchQuery?: string;
  selectedTrack?: string;
  showControls?: boolean;
}

export const RankingList: React.FC<RankingListProps> = ({
  items,
  selectedPeriod,
  onPeriodChange,
  onSelectMember,
  disableAnimation = false,
  searchQuery: externalSearchQuery,
  selectedTrack: externalSelectedTrack,
  showControls = false,
}) => {
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const [internalSelectedTrack, setInternalSelectedTrack] = useState<string>('all');

  const searchQuery = externalSearchQuery !== undefined ? externalSearchQuery : internalSearchQuery;
  const setSearchQuery = setInternalSearchQuery;
  const selectedTrack = externalSelectedTrack !== undefined ? externalSelectedTrack : internalSelectedTrack;
  const setSelectedTrack = setInternalSelectedTrack;

  const currentMonthKey = useMemo(() => {
    const seoulMonth = getSeoulMonthKey();
    const hasCurrentMonthData = items.some(
      (item) => (item.monthlyCheckIns?.[seoulMonth] || 0) > 0
    );
    if (hasCurrentMonthData) return seoulMonth;
    const allMonths = new Set<string>();
    items.forEach((item) => {
      const monthly = item.monthlyCheckIns;
      if (monthly) {
        Object.keys(monthly).forEach((m) => {
          if ((monthly[m] || 0) > 0) allMonths.add(m);
        });
      }
    });
    const sorted = Array.from(allMonths).sort().reverse();
    return sorted[0] || seoulMonth;
  }, [items]);

  const prevMonthKey = useMemo(() => {
    const [y, m] = currentMonthKey.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [currentMonthKey]);

  // Compute ranked list for each period
  const rankedEntries = useMemo(() => {
    // 1. Calculate previous month rankings (for rankDelta comparison)
    const prevMonthRankMap = new Map<string, number>();
    const prevSorted = [...items]
      .map((item) => {
        const count = item.monthlyCheckIns?.[prevMonthKey] || 0;
        return { id: item.id, points: count * 10, count };
      })
      .filter((p) => p.points > 0)
      .sort((a, b) => b.points - a.points);

    prevSorted.forEach((p, idx) => {
      prevMonthRankMap.set(p.id, idx + 1);
    });

    // 2. Calculate current period points
    const mapped = items.map((item) => {
      let periodPoints = 0;
      let periodCheckIns = 0;

      if (selectedPeriod === 'this_month') {
        periodCheckIns = item.monthlyCheckIns?.[currentMonthKey] || 0;
        periodPoints = periodCheckIns * 10;
      } else {
        // all_time (default)
        periodPoints = item.totalPoints ?? item.points ?? 0;
        periodCheckIns = item.totalCheckIns || 0;
      }

      return {
        item,
        periodPoints,
        periodCheckIns,
      };
    });

    // 3. Sort by periodPoints descending, then periodCheckIns descending
    mapped.sort((a, b) => {
      if (b.periodPoints !== a.periodPoints) {
        return b.periodPoints - a.periodPoints;
      }
      return b.periodCheckIns - a.periodCheckIns;
    });

    // 4. Assign rank & compute delta for 'this_month'
    return mapped.map((entry, idx) => {
      const rank = idx + 1;
      let rankDelta: number | null = null;
      let isNew = false;

      if (selectedPeriod === 'this_month') {
        if (prevMonthRankMap.has(entry.item.id)) {
          const prevRank = prevMonthRankMap.get(entry.item.id)!;
          rankDelta = prevRank - rank; // positive = moved up
        } else if (entry.periodPoints > 0) {
          isNew = true;
        }
      }

      return {
        ...entry,
        rank,
        rankDelta,
        isNew,
      };
    });
  }, [items, selectedPeriod, currentMonthKey, prevMonthKey]);

  // Filter by search & track
  const filteredEntries = useMemo(() => {
    return rankedEntries.filter(({ item }) => {
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
  }, [rankedEntries, selectedTrack, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Control Bar: Sliding Period Tabs & Search (only shown if showControls is true) */}
      {showControls && (
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2">
          {/* Animated sliding pill tabs: All Time first, then This Month */}
          <div className="relative inline-flex rounded-2xl bg-white/[0.03] p-1 border border-white/[0.08] backdrop-blur-md">
            <button
              type="button"
              onClick={() => onPeriodChange?.('all_time')}
              className={`relative px-4 py-2 rounded-xl font-orbitron text-xs font-bold uppercase tracking-wider transition-colors z-10 cursor-pointer ${
                selectedPeriod === 'all_time' ? 'text-black' : 'text-white/58 hover:text-white'
              }`}
            >
              {selectedPeriod === 'all_time' && (
                <m.div
                  layoutId="activePeriodTabIndicator"
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#E879F9] shadow-[0_0_16px_rgba(232,121,249,0.35)] -z-10"
                />
              )}
              All Time
            </button>

            <button
              type="button"
              onClick={() => onPeriodChange?.('this_month')}
              className={`relative px-4 py-2 rounded-xl font-orbitron text-xs font-bold uppercase tracking-wider transition-colors z-10 cursor-pointer ${
                selectedPeriod === 'this_month' ? 'text-black' : 'text-white/58 hover:text-white'
              }`}
            >
              {selectedPeriod === 'this_month' && (
                <m.div
                  layoutId="activePeriodTabIndicator"
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
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
      )}

      {/* Table Header */}
      <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-[11px] font-rajdhani font-bold uppercase tracking-widest text-white/40">
        <div className="col-span-1 text-center">Rank</div>
        <div className="col-span-5">Builder</div>
        <div className="col-span-2 text-center">Tier</div>
        {selectedPeriod === 'this_month' && (
          <div className="col-span-1 text-center">Change</div>
        )}
        <div className={`${selectedPeriod === 'this_month' ? 'col-span-1' : 'col-span-2'} text-right`}>
          Streak
        </div>
        <div className="col-span-2 text-right">Points</div>
      </div>

      {/* Rankings Entries */}
      <div className="space-y-2">
        {filteredEntries.length === 0 ? (
          <div className="p-12 text-center rounded-3xl bg-white/[0.02] border border-white/5 text-white/40 font-rajdhani text-sm">
            No builder profiles match your filter criteria.
          </div>
        ) : (
          filteredEntries.map(({ item, rank, periodPoints, rankDelta, isNew }) => {
            const displayName = item.displayName || item.name;
            const initials = displayName
              .split(' ')
              .map((n) => n[0])
              .join('')
              .substring(0, 2)
              .toUpperCase();

            const isTop3 = rank <= 3;
            const tier = getTier(item.totalPoints ?? item.points ?? 0);

            // Dynamic hover border bloom matching member's tier
            const hoverBloomClass =
              tier.level === 'LEGEND'
                ? 'hover:border-[#FF7A1A]/40 hover:shadow-[0_0_20px_rgba(255,122,26,0.18)]'
                : tier.level === 'ELITE'
                ? 'hover:border-[#E879F9]/40 hover:shadow-[0_0_20px_rgba(232,121,249,0.18)]'
                : tier.level === 'BUILDER'
                ? 'hover:border-[#2DE2E6]/40 hover:shadow-[0_0_20px_rgba(45,226,230,0.16)]'
                : 'hover:border-white/20 hover:shadow-[0_0_14px_rgba(255,255,255,0.06)]';

            return (
              <m.div
                key={item.id}
                variants={disableAnimation ? undefined : fadeUp}
                onClick={() => onSelectMember(item, rank)}
                className={`p-3.5 sm:px-5 sm:py-3.5 rounded-2xl border transition-all duration-150 ease-out cursor-pointer flex flex-col sm:grid sm:grid-cols-12 gap-2 sm:gap-3 items-start sm:items-center hover:-translate-y-0.5 ${hoverBloomClass} ${
                  isTop3
                    ? 'bg-white/[0.045] border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                    : 'bg-white/[0.025] border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                }`}
              >
                {/* Mobile Rank + Top Info */}
                <div className="flex items-center justify-between w-full sm:w-auto sm:col-span-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-orbitron font-black text-xs sm:text-sm text-center tabular-nums px-2 py-0.5 rounded-lg ${
                        rank === 1
                          ? 'bg-[#F5C56B]/20 text-[#F5C56B] border border-[#F5C56B]/40'
                          : rank === 2
                          ? 'bg-[#E6EEF9]/20 text-[#E6EEF9] border border-[#E6EEF9]/40'
                          : rank === 3
                          ? 'bg-[#E6A06A]/20 text-[#E6A06A] border border-[#E6A06A]/40'
                          : 'text-white/40'
                      }`}
                    >
                      #{rank}
                    </span>

                    {/* Mobile Only Points preview */}
                    <span className="sm:hidden font-orbitron font-black text-sm num-grad-ember ml-auto">
                      {periodPoints} pts
                    </span>
                  </div>
                </div>

                {/* Builder Info: Avatar, Name, Handle */}
                <div className="flex items-center gap-3 w-full sm:col-span-5">
                  <SecureAvatar
                    src={item.avatarUrl || item.avatar}
                    name={displayName}
                    alt={displayName}
                    size={40}
                    shape="rounded"
                    className="shrink-0 border border-white/10"
                    fallbackClassName="font-orbitron font-black text-xs text-[#2DE2E6]"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-orbitron font-bold text-xs sm:text-sm text-white/92 truncate">
                        {displayName}
                      </span>
                      {item.role && (
                        <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-rajdhani uppercase text-white/58">
                          {item.role}
                        </span>
                      )}
                    </div>
                    {item.handle && (
                      <p className="font-rajdhani text-[11px] text-white/40 truncate">
                        {item.handle}
                      </p>
                    )}
                  </div>
                </div>

                {/* Tier Badge */}
                <div className="sm:col-span-2 sm:text-center w-full sm:w-auto">
                  <TierBadge points={item.totalPoints ?? item.points ?? 0} size="xs" disableAnimation={disableAnimation} />
                </div>

                {/* Rank Delta: STRICTLY only visible on 'this_month' tab */}
                {selectedPeriod === 'this_month' && (
                  <div className="sm:col-span-1 sm:text-center flex items-center sm:justify-center gap-1 text-xs font-orbitron font-bold">
                    {isNew ? (
                      <span className="px-1.5 py-0.5 rounded bg-[#2DE2E6]/15 text-[#2DE2E6] border border-[#2DE2E6]/30 text-[10px]">
                        NEW
                      </span>
                    ) : rankDelta && rankDelta > 0 ? (
                      <span className="text-[#34D399] flex items-center gap-0.5">
                        <ArrowUp className="w-3 h-3" />
                        {rankDelta}
                      </span>
                    ) : rankDelta && rankDelta < 0 ? (
                      <span className="text-[#FB7185] flex items-center gap-0.5">
                        <ArrowDown className="w-3 h-3" />
                        {Math.abs(rankDelta)}
                      </span>
                    ) : (
                      <span className="text-white/25 flex items-center">
                        <Minus className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                )}

                {/* Streak */}
                <div className={`${selectedPeriod === 'this_month' ? 'sm:col-span-1' : 'sm:col-span-2'} sm:text-right hidden sm:flex items-center justify-end gap-1 font-orbitron text-xs font-bold text-[#FF7A1A]`}>
                  <Flame className="w-3 h-3 text-[#FF7A1A]" />
                  <span>{item.currentStreak || 0}</span>
                </div>

                {/* Points */}
                <div className="sm:col-span-2 sm:text-right hidden sm:flex items-center justify-end gap-2 font-orbitron">
                  <span className="text-sm font-black tabular-nums text-white/92">
                    {periodPoints}
                  </span>
                  <span className="text-[10px] text-white/40 font-bold uppercase">
                    pts
                  </span>
                  <ChevronRight className="w-4 h-4 text-white/30 ml-1" />
                </div>
              </m.div>
            );
          })
        )}
      </div>
    </div>
  );
};
