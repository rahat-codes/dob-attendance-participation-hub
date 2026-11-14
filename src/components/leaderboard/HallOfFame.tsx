import React, { useMemo } from 'react';
import { PublicLeaderboardItem } from '../../types';
import { getSeoulMonthKey } from '../../config/tierConfig';
import { Crown } from 'lucide-react';
import { SecureAvatar } from '../common/SecureAvatar';

interface HallOfFameProps {
  items: PublicLeaderboardItem[];
  onSelectMember: (item: PublicLeaderboardItem) => void;
}

interface MonthlyChampion {
  monthKey: string;
  monthTitle: string;
  champions: PublicLeaderboardItem[];
  pointsEarned: number;
}

export const HallOfFame: React.FC<HallOfFameProps> = ({ items, onSelectMember }) => {
  const currentMonthKey = useMemo(() => getSeoulMonthKey(), []);

  // Compute past monthly champions from monthlyCheckIns
  const pastChampions: MonthlyChampion[] = useMemo(() => {
    // 1. Gather all unique month keys across items
    const allMonths = new Set<string>();
    items.forEach((item) => {
      Object.keys(item.monthlyCheckIns || {}).forEach((mKey) => {
        allMonths.add(mKey);
      });
    });

    // 2. Exclude current in-progress month & sort descending
    const pastMonths = Array.from(allMonths)
      .filter((mKey) => mKey < currentMonthKey)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 6); // show up to last 6 months

    return pastMonths.map((mKey) => {
      const [yearStr, monthStr] = mKey.split('-');
      const dateObj = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1);
      const monthTitle = dateObj.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });

      const getMonthPts = (item: PublicLeaderboardItem) =>
        item.monthlyPoints?.[mKey] ??
        item.monthlyScores?.[mKey] ??
        (item.monthlyCheckIns?.[mKey] || 0) * 10;

      let maxPoints = 0;
      items.forEach((item) => {
        const pts = getMonthPts(item);
        if (pts > maxPoints) {
          maxPoints = pts;
        }
      });

      const champions = maxPoints > 0
        ? items.filter((item) => getMonthPts(item) === maxPoints)
        : [];

      return {
        monthKey: mKey,
        monthTitle,
        champions,
        pointsEarned: maxPoints,
      };
    }).filter((rec) => rec.champions.length > 0);
  }, [items, currentMonthKey]);

  if (pastChampions.length === 0) return null;

  return (
    <div className="rounded-3xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-xl p-5 sm:p-7 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-[#F5C56B]" />
          <h3 className="font-orbitron font-bold text-xs uppercase tracking-widest text-white/70">
            Hall of Fame // Monthly Champions
          </h3>
        </div>
        <span className="text-[11px] font-rajdhani text-white/40 font-semibold uppercase tracking-wider">
          Past Completed Months in Seoul
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {pastChampions.map(({ monthKey, monthTitle, champions, pointsEarned }) => {
          const champ = champions[0];
          const isTied = champions.length > 1;
          const displayName = champ.displayName || champ.name;
          const initials = displayName
            .split(' ')
            .map((n) => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();

          return (
            <div
              key={monthKey}
              onClick={() => onSelectMember(champ)}
              className="p-4 rounded-2xl bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.06] hover:border-[#F5C56B]/30 hover:shadow-[0_0_20px_rgba(245,197,107,0.12)] transition-all cursor-pointer flex items-center gap-3.5 group hover:-translate-y-0.5"
            >
              <div className="relative shrink-0">
                <SecureAvatar
                  src={champ.avatarUrl || champ.avatar}
                  name={displayName}
                  alt={displayName}
                  size={48}
                  shape="rounded"
                  className="border border-[#F5C56B]/40 shadow-[0_0_12px_rgba(245,197,107,0.2)] group-hover:scale-105 transition-transform"
                  fallbackClassName="font-orbitron font-black text-sm text-[#F5C56B]"
                />
                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gradient-to-r from-[#F5C56B] to-[#FF9F1C] flex items-center justify-center text-black shadow-[0_0_6px_rgba(245,197,107,0.6)]">
                  <Crown className="w-3 h-3 fill-black text-black" />
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <span className="block text-[10px] font-orbitron uppercase text-[#F5C56B] font-bold tracking-wider">
                  {monthTitle}
                </span>
                <span className="block font-orbitron font-black text-sm text-white/92 truncate mt-0.5">
                  {displayName}
                  {isTied && <span className="text-white/40 text-xs font-normal"> +{champions.length - 1}</span>}
                </span>
                <span className="block font-rajdhani text-xs text-white/58 font-semibold mt-0.5">
                  {pointsEarned} pts recorded
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
