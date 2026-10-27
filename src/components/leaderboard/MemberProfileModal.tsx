import React from 'react';
import { PublicLeaderboardItem } from '../../types';
import { TierBadge } from './TierBadge';
import { getNextTierProgress } from '../../config/tierConfig';
import {
  X,
  Trophy,
  Flame,
  CheckCircle2,
  Share2,
  Calendar,
} from 'lucide-react';
import { m, AnimatePresence } from 'motion/react';

interface MemberProfileModalProps {
  item: PublicLeaderboardItem | null;
  rank?: number;
  isOpen: boolean;
  onClose: () => void;
  onOpenShareCard: (item: PublicLeaderboardItem, rank?: number) => void;
  disableAnimation?: boolean;
}

export const MemberProfileModal: React.FC<MemberProfileModalProps> = ({
  item,
  rank,
  isOpen,
  onClose,
  onOpenShareCard,
  disableAnimation = false,
}) => {
  if (!isOpen || !item) return null;

  const displayName = item.displayName || item.name;
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const totalPoints = item.totalPoints ?? item.points ?? 0;
  const totalCheckIns = item.totalCheckIns || 0;
  const currentStreak = item.currentStreak || 0;
  const bestStreak = item.bestStreak || currentStreak;

  const progress = getNextTierProgress(totalPoints);

  // Requirement 7: STRICTLY "First Check-In" & "3-Streak" only
  const hasFirstCheckIn = totalCheckIns >= 1;
  const hasThreeStreak = bestStreak >= 3 || currentStreak >= 3;

  const monthlyEntries = Object.entries(item.monthlyCheckIns || {}).sort((a, b) =>
    b[0].localeCompare(a[0])
  );

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-[#07080C]/85 backdrop-blur-xl"
        />

        {/* Modal Window */}
        <m.div
          initial={disableAnimation ? undefined : { scale: 0.96, opacity: 0, y: 12 }}
          animate={disableAnimation ? undefined : { scale: 1, opacity: 1, y: 0 }}
          exit={disableAnimation ? undefined : { scale: 0.96, opacity: 0, y: 12 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="relative w-full max-w-lg rounded-3xl bg-[#07080C]/95 border border-white/[0.12] shadow-[0_24px_64px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)] overflow-hidden z-10 flex flex-col max-h-[90vh]"
        >
          {/* Header Banner */}
          <div className="relative p-6 sm:p-7 pb-5 bg-gradient-to-b from-white/[0.06] to-transparent border-b border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="absolute top-5 right-5 p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/58 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div className="relative shrink-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/[0.04] border border-white/[0.12] overflow-hidden flex items-center justify-center font-orbitron font-black text-2xl text-white/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                  {item.avatarUrl || item.avatar ? (
                    <img
                      src={item.avatarUrl || item.avatar}
                      alt={displayName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{initials}</span>
                  )}
                </div>
                {rank && (
                  <span className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-lg bg-gradient-to-r from-[#FFB36B] to-[#FF4D2E] text-black font-orbitron font-black text-[10px] shadow-[0_0_12px_rgba(255,122,26,0.4)]">
                    #{rank}
                  </span>
                )}
              </div>

              {/* Title & Metadata */}
              <div className="min-w-0 flex-1 pr-6">
                <h3 className="font-orbitron font-black text-lg sm:text-xl text-white/92 truncate">
                  {displayName}
                </h3>
                {item.handle && (
                  <p className="font-rajdhani text-xs font-semibold text-white/58 mt-0.5">
                    {item.handle}
                  </p>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <TierBadge points={totalPoints} size="xs" disableAnimation={disableAnimation} />
                  {item.role && (
                    <span className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[10px] font-rajdhani uppercase font-bold text-white/58">
                      {item.role}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Tracks */}
            {item.tracks && item.tracks.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {item.tracks.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] font-rajdhani text-white/40"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Modal Body */}
          <div className="p-6 space-y-6 overflow-y-auto">
            {/* Tier Progress Bar with Moving Highlight and Glowing End Cap */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <div className="flex items-center justify-between text-xs font-rajdhani font-bold">
                <span className="text-white/58 uppercase tracking-wider">
                  Tier Progression
                </span>
                {progress.nextTier ? (
                  <span className="text-[#2DE2E6]">
                    {progress.pointsToNext} pts to {progress.nextTier.name}
                  </span>
                ) : (
                  <span className="text-[#FF7A1A]">MAX TIER REACHED</span>
                )}
              </div>

              {/* Progress Track */}
              <div className="relative w-full h-2.5 rounded-full bg-black/50 border border-white/[0.08] overflow-hidden">
                <div
                  className="relative h-full bg-gradient-to-r from-[#2DE2E6] via-[#E879F9] to-[#FF7A1A] transition-all duration-500 rounded-full progress-streak-bar flex items-center justify-end"
                  style={{ width: `${progress.progressPercent}%` }}
                >
                  {/* Glowing End Cap */}
                  {progress.progressPercent > 4 && (
                    <span className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#FFFFFF] mr-0.5" />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] font-orbitron text-white/40">
                <span>{progress.currentTier.name} ({progress.currentTier.minPoints} pts)</span>
                <span>{progress.nextTier ? `${progress.nextTier.name} (${progress.nextTier.minPoints} pts)` : 'Legend'}</span>
              </div>
            </div>

            {/* Telemetry Stat Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-2xl bg-white/[0.025] border border-white/[0.06] text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <span className="block text-[10px] font-rajdhani uppercase font-bold text-white/40">
                  Total Points
                </span>
                <span className="block font-orbitron font-black text-xl num-grad-ember mt-0.5">
                  {totalPoints}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-white/[0.025] border border-white/[0.06] text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <span className="block text-[10px] font-rajdhani uppercase font-bold text-white/40">
                  Check-Ins
                </span>
                <span className="block font-orbitron font-black text-xl text-white/92 mt-0.5">
                  {totalCheckIns}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-white/[0.025] border border-white/[0.06] text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <span className="block text-[10px] font-rajdhani uppercase font-bold text-white/40 flex items-center justify-center gap-1">
                  <Flame className="w-3 h-3 text-[#FF7A1A]" />
                  Current
                </span>
                <span className="block font-orbitron font-black text-xl text-[#FF7A1A] mt-0.5">
                  {currentStreak}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-white/[0.025] border border-white/[0.06] text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <span className="block text-[10px] font-rajdhani uppercase font-bold text-white/40">
                  Best Streak
                </span>
                <span className="block font-orbitron font-black text-xl text-[#2DE2E6] mt-0.5">
                  {bestStreak}
                </span>
              </div>
            </div>

            {/* Requirement 7: STRICTLY only "First Check-In" & "3-Streak" badges */}
            <div>
              <h4 className="font-orbitron font-bold text-xs uppercase tracking-widest text-white/58 mb-3 flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-[#FF7A1A]" />
                Guild Achievements
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 1. First Check-In */}
                <div
                  className={`p-3.5 rounded-2xl border transition-all flex items-start gap-3 ${
                    hasFirstCheckIn
                      ? 'bg-gradient-to-br from-[#2DE2E6]/10 to-[#3B82F6]/5 border-[#2DE2E6]/30 soft-glow-aqua text-white'
                      : 'bg-white/[0.02] border-white/5 text-white/30'
                  }`}
                >
                  <div
                    className={`p-2 rounded-xl shrink-0 ${
                      hasFirstCheckIn
                        ? 'bg-[#2DE2E6]/20 text-[#2DE2E6]'
                        : 'bg-white/5 text-white/30'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-orbitron font-bold text-xs block text-white/92">
                      First Check-In
                    </span>
                    <p className="font-rajdhani text-[11px] text-white/58 mt-0.5 leading-tight">
                      {hasFirstCheckIn
                        ? 'Attended first official guild workshop session'
                        : 'Attend 1 workshop session to unlock'}
                    </p>
                  </div>
                </div>

                {/* 2. 3-Streak */}
                <div
                  className={`p-3.5 rounded-2xl border transition-all flex items-start gap-3 ${
                    hasThreeStreak
                      ? 'bg-gradient-to-br from-[#FFD27A]/10 via-[#FF7A1A]/10 to-[#FF3D6E]/5 border-[#FF7A1A]/30 soft-glow-ember text-white'
                      : 'bg-white/[0.02] border-white/5 text-white/30'
                  }`}
                >
                  <div
                    className={`p-2 rounded-xl shrink-0 ${
                      hasThreeStreak
                        ? 'bg-[#FF7A1A]/20 text-[#FF7A1A]'
                        : 'bg-white/5 text-white/30'
                    }`}
                  >
                    <Flame className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-orbitron font-bold text-xs block text-white/92">
                      3-Streak
                    </span>
                    <p className="font-rajdhani text-[11px] text-white/58 mt-0.5 leading-tight">
                      {hasThreeStreak
                        ? 'Maintained a consecutive 3-session attendance streak'
                        : 'Attend 3 consecutive sessions to unlock'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Monthly Check-In Breakdown */}
            {monthlyEntries.length > 0 && (
              <div>
                <h4 className="font-orbitron font-bold text-xs uppercase tracking-widest text-white/58 mb-2 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#2DE2E6]" />
                  Monthly Participation Activity
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {monthlyEntries.map(([mKey, count]) => (
                    <div
                      key={mKey}
                      className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.06] flex items-center justify-between"
                    >
                      <span className="font-orbitron text-xs text-white/70">
                        {mKey}
                      </span>
                      <span className="font-rajdhani font-bold text-xs text-[#2DE2E6]">
                        {count} check-ins
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer with Share Card trigger */}
          <div className="p-4 sm:p-5 border-t border-white/[0.08] bg-white/[0.02] flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/70 font-rajdhani font-bold text-xs uppercase tracking-wider transition-all cursor-pointer min-h-11"
            >
              Close
            </button>

            <button
              type="button"
              onClick={() => onOpenShareCard(item, rank)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#FFB36B] via-[#FF7A1A] to-[#FF4D2E] hover:opacity-95 text-black font-orbitron font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(255,122,26,0.35)] cursor-pointer min-h-11 active:scale-95"
            >
              <Share2 className="w-4 h-4 text-black" />
              <span>Generate Share Card</span>
            </button>
          </div>
        </m.div>
      </div>
    </AnimatePresence>
  );
};
