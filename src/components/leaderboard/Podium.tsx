import React from 'react';
import { PublicLeaderboardItem } from '../../types';
import { TierBadge } from './TierBadge';
import { Crown, Medal, Flame, Sparkles } from 'lucide-react';
import { m } from 'motion/react';
import { SecureAvatar } from '../common/SecureAvatar';

interface PodiumProps {
  topItems: PublicLeaderboardItem[];
  onSelectMember: (item: PublicLeaderboardItem, rank: number) => void;
  disableAnimation?: boolean;
}

export const Podium: React.FC<PodiumProps> = ({
  topItems,
  onSelectMember,
  disableAnimation = false,
}) => {
  if (topItems.length === 0) return null;

  const first = topItems[0] || null;
  const second = topItems[1] || null;
  const third = topItems[2] || null;

  const renderCard = (
    item: PublicLeaderboardItem | null,
    rank: 1 | 2 | 3,
    heightClass: string
  ) => {
    if (!item) {
      return (
        <div
          className={`flex-1 rounded-3xl bg-white/[0.02] border border-white/5 p-6 flex flex-col items-center justify-center text-white/40 font-rajdhani text-xs ${heightClass}`}
        >
          <span>Slot #{rank} Open</span>
        </div>
      );
    }

    const isFirst = rank === 1;
    const isSecond = rank === 2;
    const isThird = rank === 3;

    // Sophisticated glass card styling with hairline border & layered soft glow
    let cardWrapperStyle = '';
    let rankBadgeStyle = '';
    let avatarRingStyle = '';
    let numClass = '';

    if (isFirst) {
      cardWrapperStyle = `bg-white/[0.04] backdrop-blur-xl border border-[#F5C56B]/35 ${
        disableAnimation ? 'soft-glow-gold' : 'conic-rim-gold soft-glow-gold'
      }`;
      rankBadgeStyle =
        'bg-gradient-to-r from-[#F5C56B] to-[#FF9F1C] text-black shadow-[0_0_20px_rgba(245,197,107,0.4)]';
      avatarRingStyle = 'ring-2 ring-[#F5C56B]/70 ring-offset-2 ring-offset-[#07080C]';
      numClass = 'num-grad-gold';
    } else if (isSecond) {
      cardWrapperStyle =
        'bg-white/[0.035] backdrop-blur-xl border border-white/10 soft-glow-silver';
      rankBadgeStyle =
        'bg-gradient-to-r from-[#E6EEF9] to-[#9FB3C8] text-black shadow-[0_0_14px_rgba(230,238,249,0.3)]';
      avatarRingStyle = 'ring-2 ring-[#E6EEF9]/60 ring-offset-2 ring-offset-[#07080C]';
      numClass = 'num-grad-silver';
    } else {
      cardWrapperStyle =
        'bg-white/[0.03] backdrop-blur-xl border border-white/10 soft-glow-bronze';
      rankBadgeStyle =
        'bg-gradient-to-r from-[#E6A06A] to-[#B8663A] text-black shadow-[0_0_14px_rgba(230,160,106,0.3)]';
      avatarRingStyle = 'ring-2 ring-[#E6A06A]/60 ring-offset-2 ring-offset-[#07080C]';
      numClass = 'num-grad-bronze';
    }

    const displayName = item.displayName || item.name;
    const initials = displayName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

    const points = item.totalPoints ?? item.points ?? 0;

    return (
      <m.div
        whileHover={disableAnimation ? undefined : { y: -4 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={() => onSelectMember(item, rank)}
        className={`relative flex-1 rounded-3xl p-5 sm:p-7 flex flex-col items-center justify-between text-center cursor-pointer transition-all ${cardWrapperStyle} ${heightClass} ${
          isFirst ? 'order-1 sm:order-2 z-20' : isSecond ? 'order-2 sm:order-1 z-10' : 'order-3 sm:order-3 z-10'
        }`}
      >
        {/* Metallic sheen sweep for #1 Gold champion only, isolated inside rounded-3xl overflow-hidden so the top badge is never clipped */}
        {isFirst && !disableAnimation && (
          <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none z-0">
            <div className="gold-sheen-sweep-bar" />
          </div>
        )}

        {/* Top Rank Badge */}
        <div className="absolute -top-3.5 inset-x-0 flex justify-center pointer-events-none z-20">
          {isFirst ? (
            <span
              className={`px-3.5 py-1 rounded-full font-orbitron font-black text-xs uppercase tracking-wider flex items-center gap-1.5 ${rankBadgeStyle}`}
            >
              <Crown className="w-3.5 h-3.5 fill-black text-black" />
              #1 CHAMPION
            </span>
          ) : isSecond ? (
            <span
              className={`px-3 py-0.5 rounded-full font-orbitron font-bold text-xs uppercase tracking-wider flex items-center gap-1 ${rankBadgeStyle}`}
            >
              <Medal className="w-3 h-3 text-black" />
              #2 SILVER
            </span>
          ) : (
            <span
              className={`px-3 py-0.5 rounded-full font-orbitron font-bold text-xs uppercase tracking-wider flex items-center gap-1 ${rankBadgeStyle}`}
            >
              <Medal className="w-3 h-3 text-black" />
              #3 BRONZE
            </span>
          )}
        </div>

        {/* Builder Avatar */}
        <div className="mt-4 flex flex-col items-center">
          <div className="relative">
            <SecureAvatar
              src={item.avatarUrl || item.avatar}
              name={displayName}
              alt={displayName}
              className={`w-20 h-20 sm:w-24 sm:h-24 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] ${avatarRingStyle}`}
              fallbackClassName="font-orbitron font-black text-2xl sm:text-3xl text-white/90"
            />

            {/* Sparkle badge for #1 */}
            {isFirst && !disableAnimation && (
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-r from-[#F5C56B] to-[#FF9F1C] text-black flex items-center justify-center shadow-[0_0_10px_rgba(245,197,107,0.6)]">
                <Sparkles className="w-3.5 h-3.5 fill-black" />
              </div>
            )}
          </div>

          {/* Builder Name & Handle */}
          <div className="mt-3.5 space-y-0.5">
            <h3 className="font-orbitron font-black text-base sm:text-lg text-white/92 tracking-tight">
              {displayName}
            </h3>
            {item.handle && (
              <p className="font-rajdhani text-xs text-white/58 font-semibold tracking-wide">
                {item.handle}
              </p>
            )}
          </div>

          {/* Tier Badge */}
          <div className="mt-2.5">
            <TierBadge points={points} size="sm" disableAnimation={disableAnimation} />
          </div>
        </div>

        {/* Podium Bottom Stats */}
        <div className="w-full mt-6 pt-4 border-t border-white/[0.08] grid grid-cols-2 gap-2 text-center">
          <div className="p-2 rounded-xl bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <span className="block text-[10px] font-rajdhani uppercase tracking-wider text-white/58 font-bold">
              Total Points
            </span>
            <span className={`block font-orbitron font-black text-lg sm:text-xl tabular-nums ${numClass}`}>
              {points}
            </span>
          </div>

          <div className="p-2 rounded-xl bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <span className="block text-[10px] font-rajdhani uppercase tracking-wider text-white/58 font-bold flex items-center justify-center gap-0.5">
              <Flame className="w-3 h-3 text-[#FF7A1A]" />
              Streak
            </span>
            <span className="block font-orbitron font-black text-lg sm:text-xl text-[#FF7A1A] tabular-nums">
              {item.currentStreak || 0}
            </span>
          </div>
        </div>
      </m.div>
    );
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#FF7A1A] shadow-[0_0_8px_rgba(255,122,26,0.8)]" />
          <h2 className="font-orbitron font-bold text-xs uppercase tracking-widest text-white/58">
            Top Guild Podium
          </h2>
        </div>
        <span className="text-[11px] font-rajdhani text-white/40 font-semibold uppercase tracking-wider">
          Tap builder to view telemetry
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-end justify-center gap-4 sm:gap-6 pt-5 pb-2">
        {renderCard(second, 2, 'sm:min-h-[350px]')}
        {renderCard(first, 1, 'sm:min-h-[390px]')}
        {renderCard(third, 3, 'sm:min-h-[330px]')}
      </div>
    </div>
  );
};
