import React, { useState } from 'react';
import {
  Flame,
  Award,
  Zap,
  Shield,
  Trophy,
  Hammer,
  CheckCircle2,
  Lock,
  Sparkles,
  Target,
  Clock,
  Compass,
} from 'lucide-react';
import { Member } from '../types';

export interface MilestoneBadge {
  id: string;
  title: string;
  category: 'streak' | 'attendance' | 'mastery';
  description: string;
  requirementText: string;
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Titanium';
  icon: React.ComponentType<{ className?: string }>;
  isUnlocked: boolean;
  currentValue: number;
  targetValue: number;
  progressPercent: number;
}

export function computeMemberBadges(
  member: Member,
  stats?: { total: number; streak: number; bestStreak: number }
): MilestoneBadge[] {
  const total = stats?.total ?? member.totalCheckIns ?? 0;
  const streak = stats?.streak ?? member.currentStreak ?? 0;
  const bestStreak = stats?.bestStreak ?? member.bestStreak ?? 0;

  const badges: MilestoneBadge[] = [
    {
      id: 'first_spark',
      title: 'First Spark',
      category: 'attendance',
      description: 'Checked into your first workshop session in the Den.',
      requirementText: '1 check-in',
      tier: 'Bronze',
      icon: Zap,
      isUnlocked: total >= 1,
      currentValue: total,
      targetValue: 1,
      progressPercent: Math.min(100, Math.round((total / 1) * 100)),
    },
    {
      id: 'frequent_builder',
      title: 'Frequent Builder',
      category: 'attendance',
      description: 'Completed 10 build sessions across software and hardware labs.',
      requirementText: '10 total check-ins',
      tier: 'Bronze',
      icon: Hammer,
      isUnlocked: total >= 10,
      currentValue: total,
      targetValue: 10,
      progressPercent: Math.min(100, Math.round((total / 10) * 100)),
    },
    {
      id: 'veteran_craftsman',
      title: 'Veteran Craftsman',
      category: 'attendance',
      description: 'Reached 25 sessions in the workshop, demonstrating true commitment.',
      requirementText: '25 total check-ins',
      tier: 'Silver',
      icon: Shield,
      isUnlocked: total >= 25,
      currentValue: total,
      targetValue: 25,
      progressPercent: Math.min(100, Math.round((total / 25) * 100)),
    },
    {
      id: 'guild_pillar',
      title: 'Guild Pillar',
      category: 'attendance',
      description: 'Logged 40+ sessions, cementing your status as a cornerstone builder.',
      requirementText: '40 total check-ins',
      tier: 'Gold',
      icon: Trophy,
      isUnlocked: total >= 40,
      currentValue: total,
      targetValue: 40,
      progressPercent: Math.min(100, Math.round((total / 40) * 100)),
    },
    {
      id: 'iron_streak',
      title: 'Iron Streak',
      category: 'streak',
      description: 'Attended 3 consecutive workshop sprints without missing a beat.',
      requirementText: '3 session streak',
      tier: 'Bronze',
      icon: Flame,
      isUnlocked: streak >= 3 || bestStreak >= 3,
      currentValue: Math.max(streak, bestStreak),
      targetValue: 3,
      progressPercent: Math.min(100, Math.round((Math.max(streak, bestStreak) / 3) * 100)),
    },
    {
      id: 'master_of_cadence',
      title: 'Master of Cadence',
      category: 'streak',
      description: 'Maintained a 7-session active attendance streak.',
      requirementText: '7 session streak',
      tier: 'Silver',
      icon: Clock,
      isUnlocked: streak >= 7 || bestStreak >= 7,
      currentValue: Math.max(streak, bestStreak),
      targetValue: 7,
      progressPercent: Math.min(100, Math.round((Math.max(streak, bestStreak) / 7) * 100)),
    },
    {
      id: 'perfect_cadence',
      title: 'Perfect Attendance',
      category: 'streak',
      description: 'Achieved a legendary 10+ session unbroken workshop streak.',
      requirementText: '10 session streak',
      tier: 'Titanium',
      icon: Award,
      isUnlocked: streak >= 10 || bestStreak >= 10,
      currentValue: Math.max(streak, bestStreak),
      targetValue: 10,
      progressPercent: Math.min(100, Math.round((Math.max(streak, bestStreak) / 10) * 100)),
    },
    {
      id: 'century_builder',
      title: 'Grand Architect',
      category: 'mastery',
      description: 'Logged 50 lifetime sessions in the Den of Builders.',
      requirementText: '50 total check-ins',
      tier: 'Titanium',
      icon: Compass,
      isUnlocked: total >= 50,
      currentValue: total,
      targetValue: 50,
      progressPercent: Math.min(100, Math.round((total / 50) * 100)),
    },
  ];

  return badges;
}

interface AttendanceBadgesProps {
  member: Member;
  stats?: { total: number; streak: number; bestStreak: number };
  mode?: 'full' | 'compact' | 'mini';
  className?: string;
}

export const AttendanceBadges: React.FC<AttendanceBadgesProps> = ({
  member,
  stats,
  mode = 'full',
  className = '',
}) => {
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all');
  const badges = computeMemberBadges(member, stats);

  const unlockedCount = badges.filter((b) => b.isUnlocked).length;

  const displayBadges = badges.filter((b) => {
    if (filter === 'unlocked') return b.isUnlocked;
    if (filter === 'locked') return !b.isUnlocked;
    return true;
  });

  // Mini mode: Just small icons for cards and table rows
  if (mode === 'mini') {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        {badges
          .filter((b) => b.isUnlocked)
          .slice(0, 4)
          .map((badge) => {
            const Icon = badge.icon;
            return (
              <div
                key={badge.id}
                title={`${badge.title} (${badge.requirementText})`}
                className={`h-5 w-5 rounded flex items-center justify-center text-[10px] ${
                  badge.tier === 'Titanium'
                    ? 'bg-[#b5ff00] text-black font-extrabold shadow-[0_0_8px_rgba(181,255,0,0.5)]'
                    : badge.tier === 'Gold'
                    ? 'bg-[#b5ff00]/15 text-[#b5ff00] border border-[#b5ff00]/30'
                    : badge.tier === 'Silver'
                    ? 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                    : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                }`}
              >
                <Icon className="h-3 w-3" />
              </div>
            );
          })}
        {unlockedCount > 4 && (
          <span className="text-[10px] text-zinc-500 font-mono">
            +{unlockedCount - 4}
          </span>
        )}
      </div>
    );
  }

  // Compact mode: Useful inside MemberPassModal
  if (mode === 'compact') {
    return (
      <div className={`space-y-2.5 ${className}`}>
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5 font-display uppercase tracking-tight">
            <Award className="h-3.5 w-3.5 text-[#b5ff00]" />
            <span>Attendance Milestones</span>
          </span>
          <span className="font-mono text-zinc-400 text-[11px] tabular-nums bg-black/50 px-2 py-0.5 rounded-lg border border-white/5 neu-inset">
            {unlockedCount} / {badges.length} Unlocked
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {badges.map((badge) => {
            const Icon = badge.icon;
            return (
              <div
                key={badge.id}
                className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
                  badge.isUnlocked
                    ? 'bg-[#141720] border-[#b5ff00]/30 text-zinc-200 neu-raised-sm'
                    : 'bg-[#0d0f15]/80 border-white/5 text-zinc-500 neu-inset'
                }`}
              >
                <div
                  className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                    badge.isUnlocked
                      ? 'bg-[#b5ff00]/15 text-[#b5ff00] border border-[#b5ff00]/30 shadow-xs'
                      : 'bg-black/60 text-zinc-600 border border-white/5'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold truncate leading-tight">
                    {badge.title}
                  </div>
                  <div className="text-[9px] text-zinc-500 truncate font-mono">
                    {badge.isUnlocked ? badge.tier : `${badge.currentValue}/${badge.targetValue}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Full interactive mode
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header & Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold font-display uppercase tracking-tight text-white">
            <Award className="h-4 w-4 text-[#b5ff00]" />
            <span>Builder Milestones &amp; Accolades</span>
          </div>
          <p className="text-[11px] text-zinc-400">
            Earned through continuous workshop attendance and streaks
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Segmented Filter */}
          <div className="flex items-center p-1 bg-black/60 border border-white/5 neu-inset rounded-2xl text-xs font-mono">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-xl font-medium transition-all cursor-pointer ${
                filter === 'all'
                  ? 'bg-[#141720] text-[#b5ff00] font-bold neu-raised-sm border border-[#b5ff00]/30 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({badges.length})
            </button>
            <button
              onClick={() => setFilter('unlocked')}
              className={`px-3 py-1 rounded-xl font-medium transition-all cursor-pointer ${
                filter === 'unlocked'
                  ? 'bg-[#141720] text-[#b5ff00] font-bold neu-raised-sm border border-[#b5ff00]/30 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Unlocked ({unlockedCount})
            </button>
            <button
              onClick={() => setFilter('locked')}
              className={`px-3 py-1 rounded-xl font-medium transition-all cursor-pointer ${
                filter === 'locked'
                  ? 'bg-[#141720] text-[#b5ff00] font-bold neu-raised-sm border border-[#b5ff00]/30 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Locked ({badges.length - unlockedCount})
            </button>
          </div>
        </div>
      </div>

      {/* Grid of Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {displayBadges.map((badge) => {
          const Icon = badge.icon;

          return (
            <div
              key={badge.id}
              className={`rounded-2xl border p-4 space-y-3 transition-all flex flex-col justify-between spatial-card ${
                badge.isUnlocked
                  ? 'bg-[#12141a]/90 border-white/10 hover:border-[#b5ff00]/40 shadow-[0_8px_25px_rgba(0,0,0,0.5)]'
                  : 'bg-[#0d0f15]/70 border-white/5 opacity-70 neu-inset'
              }`}
            >
              <div className="flex items-start gap-3.5">
                {/* Emblem Icon */}
                <div
                  className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${
                    badge.isUnlocked
                      ? badge.tier === 'Titanium'
                        ? 'bg-[#b5ff00] text-black border-[#b5ff00] shadow-[0_0_15px_rgba(181,255,0,0.5)] font-bold'
                        : badge.tier === 'Gold'
                        ? 'bg-[#b5ff00]/15 border-[#b5ff00]/40 text-[#b5ff00] neu-raised-sm'
                        : badge.tier === 'Silver'
                        ? 'bg-[#141720] border-white/10 text-zinc-200 neu-raised-sm'
                        : 'bg-[#141720] border-white/10 text-zinc-300 neu-raised-sm'
                      : 'bg-black/60 border-white/5 text-zinc-600 neu-inset'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-white truncate font-display">
                      {badge.title}
                    </h4>

                    {badge.isUnlocked ? (
                      <span className="text-[10px] font-mono text-[#b5ff00] uppercase font-bold flex items-center gap-1 bg-[#b5ff00]/10 px-2 py-0.5 rounded-md border border-[#b5ff00]/30">
                        <CheckCircle2 className="h-3 w-3 text-[#b5ff00]" />
                        <span>{badge.tier}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-md">
                        <Lock className="h-2.5 w-2.5" />
                        <span>Locked</span>
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-zinc-400 line-clamp-2 mt-1 leading-relaxed">
                    {badge.description}
                  </p>
                </div>
              </div>

              {/* Progress and Requirement Bar */}
              <div className="pt-2.5 border-t border-white/5 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-zinc-500">{badge.requirementText}</span>
                  <span className={badge.isUnlocked ? 'text-[#b5ff00] font-semibold' : 'text-zinc-400'}>
                    {badge.isUnlocked ? 'Unlocked' : `${badge.currentValue} / ${badge.targetValue} (${badge.progressPercent}%)`}
                  </span>
                </div>

                {/* Micro Progress Bar */}
                <div className="h-1.5 w-full bg-black/80 rounded-full overflow-hidden border border-white/5">
                  <div
                    className={`h-full transition-all duration-500 ${
                      badge.isUnlocked ? 'bg-[#b5ff00] shadow-[0_0_8px_rgba(181,255,0,0.6)]' : 'bg-zinc-700'
                    }`}
                    style={{ width: `${badge.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
