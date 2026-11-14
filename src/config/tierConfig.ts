import { getMonthKeyInClubTz } from '../utils/sessionWindow';
import { DEFAULT_CLUB_TIMEZONE } from './constants';

export type TierLevel = 'ROOKIE' | 'BUILDER' | 'ELITE' | 'LEGEND';

export interface TierDefinition {
  level: TierLevel;
  name: string;
  minPoints: number;
  maxPoints: number | null;
  colorHex: string;
  gradient: [string, string] | [string, string, string];
  gradientCss: string;
  softGlow: string;
  description: string;
}

/**
 * Centralized Leaderboard Palette & Design Tokens
 */
export const LEADERBOARD_THEME = {
  // Page Foundation
  bg: '#07080C',
  textPrimary: 'rgba(255, 255, 255, 0.92)',
  textSecondary: 'rgba(255, 255, 255, 0.58)',
  textMuted: 'rgba(255, 255, 255, 0.38)',

  // DOB Brand Ember Gradient
  brandEmber: {
    start: '#FFB36B',
    mid: '#FF7A1A',
    end: '#FF4D2E',
    gradientCss: 'linear-gradient(135deg, #FFB36B 0%, #FF7A1A 50%, #FF4D2E 100%)',
    softGlow: '0 0 24px rgba(255, 122, 26, 0.25), 0 0 64px rgba(255, 77, 46, 0.12)',
  },

  // Aurora Background Blobs
  aurora: {
    ember: '#FF5A1F', // ~12% opacity
    indigo: '#4C3BFF', // ~10% opacity
    teal: '#14B8C4', // ~8% opacity
  },

  // Podium Color Systems
  podium: {
    gold: {
      from: '#F5C56B',
      to: '#FF9F1C',
      gradientCss: 'linear-gradient(135deg, #F5C56B 0%, #FF9F1C 100%)',
      glow: '0 0 28px rgba(245, 197, 107, 0.35), 0 0 64px rgba(255, 159, 28, 0.18)',
      sheen: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.22) 50%, transparent 100%)',
    },
    silver: {
      from: '#E6EEF9',
      to: '#9FB3C8',
      gradientCss: 'linear-gradient(135deg, #E6EEF9 0%, #9FB3C8 100%)',
      glow: '0 0 20px rgba(230, 238, 249, 0.2), 0 0 48px rgba(159, 179, 200, 0.1)',
    },
    bronze: {
      from: '#E6A06A',
      to: '#B8663A',
      gradientCss: 'linear-gradient(135deg, #E6A06A 0%, #B8663A 100%)',
      glow: '0 0 20px rgba(230, 160, 106, 0.2), 0 0 48px rgba(184, 102, 58, 0.1)',
    },
  },

  // Indicator / Delta Chips
  chips: {
    up: '#34D399', // Emerald success
    down: '#FB7185', // Rose down
    newChip: '#2DE2E6', // Aqua chip
  },

  // Glass Card Baseline
  glassCard: {
    bg: 'rgba(255, 255, 255, 0.04)',
    border: 'linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.02) 100%)',
    innerHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.08)',
  },
};

/**
 * Refined Tier System with sophisticated multi-stop gradients & layered glows
 */
export const TIER_CONFIG: Record<TierLevel, TierDefinition> = {
  ROOKIE: {
    level: 'ROOKIE',
    name: 'Rookie',
    minPoints: 0,
    maxPoints: 9,
    colorHex: '#D5DBE6',
    gradient: ['#8B95A7', '#D5DBE6'],
    gradientCss: 'linear-gradient(135deg, #8B95A7 0%, #D5DBE6 100%)',
    softGlow: '0 0 16px rgba(139, 149, 167, 0.18)',
    description: 'Beginning the engineering journey in the Den of Builders.',
  },
  BUILDER: {
    level: 'BUILDER',
    name: 'Builder',
    minPoints: 10,
    maxPoints: 24,
    colorHex: '#2DE2E6',
    gradient: ['#2DE2E6', '#3B82F6'],
    gradientCss: 'linear-gradient(135deg, #2DE2E6 0%, #3B82F6 100%)',
    softGlow: '0 0 24px rgba(45, 226, 230, 0.22), 0 0 54px rgba(59, 130, 246, 0.1)',
    description: 'Active club builder with consistent workshop participation.',
  },
  ELITE: {
    level: 'ELITE',
    name: 'Elite',
    minPoints: 25,
    maxPoints: 49,
    colorHex: '#E879F9',
    gradient: ['#8B5CF6', '#E879F9'],
    gradientCss: 'linear-gradient(135deg, #8B5CF6 0%, #E879F9 100%)',
    softGlow: '0 0 24px rgba(232, 121, 249, 0.28), 0 0 60px rgba(139, 92, 246, 0.14)',
    description: 'Veteran builder with proven dedication across guild sessions.',
  },
  LEGEND: {
    level: 'LEGEND',
    name: 'Legend',
    minPoints: 50,
    maxPoints: null,
    colorHex: '#FF7A1A',
    gradient: ['#FFD27A', '#FF7A1A', '#FF3D6E'],
    gradientCss: 'linear-gradient(135deg, #FFD27A 0%, #FF7A1A 50%, #FF3D6E 100%)',
    softGlow: '0 0 28px rgba(255, 122, 26, 0.35), 0 0 70px rgba(255, 61, 110, 0.18)',
    description: 'Hall of fame guild master with legendary consistency.',
  },
};

/**
 * Returns the tier definition for a given points score.
 */
export function getTier(points: number): TierDefinition {
  const safePts = Math.max(0, points || 0);
  if (safePts >= 50) return TIER_CONFIG.LEGEND;
  if (safePts >= 25) return TIER_CONFIG.ELITE;
  if (safePts >= 10) return TIER_CONFIG.BUILDER;
  return TIER_CONFIG.ROOKIE;
}

/**
 * Calculates progress toward the next tier.
 */
export function getNextTierProgress(points: number): {
  currentTier: TierDefinition;
  nextTier: TierDefinition | null;
  pointsToNext: number;
  progressPercent: number;
} {
  const currentTier = getTier(points);
  const safePts = Math.max(0, points || 0);

  if (currentTier.level === 'LEGEND') {
    return {
      currentTier,
      nextTier: null,
      pointsToNext: 0,
      progressPercent: 100,
    };
  }

  let nextTier: TierDefinition;
  let targetPoints: number;
  let rangeStart: number;

  if (currentTier.level === 'ROOKIE') {
    nextTier = TIER_CONFIG.BUILDER;
    targetPoints = 10;
    rangeStart = 0;
  } else if (currentTier.level === 'BUILDER') {
    nextTier = TIER_CONFIG.ELITE;
    targetPoints = 25;
    rangeStart = 10;
  } else {
    nextTier = TIER_CONFIG.LEGEND;
    targetPoints = 50;
    rangeStart = 25;
  }

  const range = targetPoints - rangeStart;
  const progressInRange = safePts - rangeStart;
  const percent = Math.min(100, Math.max(0, Math.round((progressInRange / range) * 100)));

  return {
    currentTier,
    nextTier,
    pointsToNext: Math.max(0, targetPoints - safePts),
    progressPercent: percent,
  };
}

/**
 * Helper to get calendar parts in Asia/Seoul without browser timezone interference.
 */
function getSeoulCalendarParts(date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_CLUB_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return {
    year: parseInt(parts.find((p) => p.type === 'year')?.value || '2026', 10),
    month: parseInt(parts.find((p) => p.type === 'month')?.value || '1', 10),
    day: parseInt(parts.find((p) => p.type === 'day')?.value || '1', 10),
  };
}

/**
 * Helper to get current Date shifted cleanly for display/year/month reads in Asia/Seoul.
 */
export function getSeoulNow(date = new Date()): Date {
  const { year, month, day } = getSeoulCalendarParts(date);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Returns month key in Asia/Seoul (e.g. "2026-10") using Intl.DateTimeFormat (club timezone).
 */
export function getSeoulMonthKey(date = new Date()): string {
  return getMonthKeyInClubTz(date, DEFAULT_CLUB_TIMEZONE);
}

/**
 * Returns the previous completed month key in Asia/Seoul (e.g. "2026-09" when current is "2026-10")
 */
export function getSeoulPreviousMonthKey(date = new Date()): string {
  const { year, month } = getSeoulCalendarParts(date);
  const prev = new Date(Date.UTC(year, month - 2, 15, 12, 0, 0));
  const y = prev.getUTCFullYear();
  const m = String(prev.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export type SemesterSeason = 'Spring' | 'Fall' | 'Off-Season';

export interface SemesterInfo {
  season: SemesterSeason;
  label: string;
  year: number;
  monthKeys: string[];
  isActive: boolean;
}

/**
 * Semester definitions in Asia/Seoul:
 * Spring: March 1 - June 30 (months 03, 04, 05, 06)
 * Fall: September 1 - December 31 (months 09, 10, 11, 12)
 * Outside these ranges: Off-Season (Jan, Feb, Jul, Aug fall under All Time only)
 */
export function getSeoulSemesterInfo(date = new Date()): SemesterInfo {
  const { year, month } = getSeoulCalendarParts(date); // 1-12

  if (month >= 3 && month <= 6) {
    return {
      season: 'Spring',
      label: `Spring ${year}`,
      year,
      monthKeys: [
        `${year}-03`,
        `${year}-04`,
        `${year}-05`,
        `${year}-06`,
      ],
      isActive: true,
    };
  }

  if (month >= 9 && month <= 12) {
    return {
      season: 'Fall',
      label: `Fall ${year}`,
      year,
      monthKeys: [
        `${year}-09`,
        `${year}-10`,
        `${year}-11`,
        `${year}-12`,
      ],
      isActive: true,
    };
  }

  // Off-season months (Jan, Feb, Jul, Aug)
  const fallbackYear = month <= 2 ? year - 1 : year;
  const fallbackSeason = month <= 2 ? 'Fall' : 'Spring';
  const fallbackMonths = fallbackSeason === 'Fall'
    ? [`${fallbackYear}-09`, `${fallbackYear}-10`, `${fallbackYear}-11`, `${fallbackYear}-12`]
    : [`${fallbackYear}-03`, `${fallbackYear}-04`, `${fallbackYear}-05`, `${fallbackYear}-06`];

  return {
    season: 'Off-Season',
    label: `${fallbackSeason} ${fallbackYear} (Off-Season)`,
    year: fallbackYear,
    monthKeys: fallbackMonths,
    isActive: false,
  };
}
