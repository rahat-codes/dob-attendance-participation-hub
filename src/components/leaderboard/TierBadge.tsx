import React from 'react';
import { TierLevel, getTier } from '../../config/tierConfig';
import { Shield, Sparkles, Flame, Zap } from 'lucide-react';

interface TierBadgeProps {
  points?: number;
  level?: TierLevel;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
  disableAnimation?: boolean;
}

export const TierBadge: React.FC<TierBadgeProps> = ({
  points = 0,
  level,
  size = 'sm',
  showLabel = true,
  className = '',
  disableAnimation = false,
}) => {
  const tier = level
    ? level === 'LEGEND'
      ? getTier(50)
      : level === 'ELITE'
      ? getTier(25)
      : level === 'BUILDER'
      ? getTier(10)
      : getTier(0)
    : getTier(points);

  const sizeClasses = {
    xs: {
      wrap: 'px-2 py-0.5 text-[10px] gap-1',
      icon: 'w-2.5 h-2.5',
    },
    sm: {
      wrap: 'px-2.5 py-0.5 text-xs gap-1.5',
      icon: 'w-3 h-3',
    },
    md: {
      wrap: 'px-3 py-1 text-xs gap-2',
      icon: 'w-3.5 h-3.5',
    },
    lg: {
      wrap: 'px-4 py-1.5 text-sm gap-2.5',
      icon: 'w-4 h-4',
    },
  }[size];

  // Refined visual styles with layered soft glows and conic rims
  let badgeStyle = '';
  let iconColor = '';

  if (tier.level === 'LEGEND') {
    badgeStyle = `bg-gradient-to-r from-[#FFD27A]/15 via-[#FF7A1A]/15 to-[#FF3D6E]/15 text-[#FFD27A] border border-[#FF7A1A]/40 ${
      disableAnimation ? 'soft-glow-ember' : 'conic-rim-legend soft-glow-ember'
    }`;
    iconColor = 'text-[#FF7A1A] fill-[#FF7A1A]/40';
  } else if (tier.level === 'ELITE') {
    badgeStyle = `bg-gradient-to-r from-[#8B5CF6]/15 to-[#E879F9]/15 text-[#E879F9] border border-[#8B5CF6]/40 ${
      disableAnimation ? 'soft-glow-violet' : 'conic-rim-elite soft-glow-violet'
    }`;
    iconColor = 'text-[#E879F9] fill-[#8B5CF6]/30';
  } else if (tier.level === 'BUILDER') {
    badgeStyle =
      'bg-gradient-to-r from-[#2DE2E6]/10 to-[#3B82F6]/10 text-[#2DE2E6] border border-[#2DE2E6]/35 soft-glow-aqua';
    iconColor = 'text-[#2DE2E6]';
  } else {
    // ROOKIE
    badgeStyle =
      'bg-gradient-to-r from-[#8B95A7]/15 to-[#D5DBE6]/10 text-[#D5DBE6] border border-[#8B95A7]/30 shadow-[0_0_12px_rgba(139,149,167,0.12)]';
    iconColor = 'text-[#D5DBE6]';
  }

  const renderIcon = () => {
    switch (tier.level) {
      case 'LEGEND':
        return <Flame className={`${sizeClasses.icon} ${iconColor} shrink-0`} />;
      case 'ELITE':
        return <Zap className={`${sizeClasses.icon} ${iconColor} shrink-0`} />;
      case 'BUILDER':
        return <Sparkles className={`${sizeClasses.icon} ${iconColor} shrink-0`} />;
      default:
        return <Shield className={`${sizeClasses.icon} ${iconColor} shrink-0`} />;
    }
  };

  return (
    <span
      className={`inline-flex items-center font-rajdhani font-bold uppercase tracking-wider rounded-lg backdrop-blur-md transition-all ${sizeClasses.wrap} ${badgeStyle} ${className}`}
      title={`${tier.name} Tier (${tier.minPoints}${tier.maxPoints ? `-${tier.maxPoints}` : '+'} pts)`}
    >
      {renderIcon()}
      {showLabel && <span>{tier.name}</span>}
    </span>
  );
};
