import React from 'react';

export type OrbVariant = 'accent' | 'pearl' | 'onyx';
export type OrbSize = 'sm' | 'md' | 'lg';

export interface IconOrbProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: OrbVariant;
  size?: OrbSize;
  icon: React.ReactNode;
  'aria-label': string; // Enforced accessibility
  badgeCount?: number;
}

export const IconOrb: React.FC<IconOrbProps> = ({
  variant = 'onyx',
  size = 'md',
  icon,
  'aria-label': ariaLabel,
  badgeCount,
  className = '',
  type = 'button',
  disabled,
  ...props
}) => {
  const sizeClasses: Record<OrbSize, string> = {
    sm: 'w-11 h-11 text-xs', // 44px min touch target
    md: 'w-[52px] h-[52px] text-sm',
    lg: 'w-16 h-16 text-base',
  };

  const variantClasses: Record<OrbVariant, string> = {
    accent: 'orb-accent',
    pearl: 'orb-pearl',
    onyx: 'orb-onyx',
  };

  return (
    <button
      type={type}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`orb ${sizeClasses[size]} ${variantClasses[variant]} cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b0e] disabled:pointer-events-none disabled:opacity-40 ${className}`}
      {...props}
    >
      {/* Specular highlight glint */}
      <span
        className="absolute top-1.5 left-2 w-2.5 h-1.5 rounded-full bg-white/40 blur-[0.5px] pointer-events-none"
        aria-hidden="true"
      />
      
      <span className="relative z-10 flex items-center justify-center pointer-events-none">
        {icon}
      </span>

      {/* Glossy notification badge dot / count */}
      {typeof badgeCount === 'number' && badgeCount > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white font-mono font-bold text-[10px] flex items-center justify-center border-2 border-[#0a0b0e] shadow-[0_0_8px_rgba(239,68,68,0.8)] z-20 pointer-events-none animate-in zoom-in"
          aria-label={`${badgeCount} unread`}
        >
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </button>
  );
};
