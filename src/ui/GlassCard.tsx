import React from 'react';

export type GlassCardVariant = 'default' | 'inset' | 'interactive' | 'onyx';

export interface GlassCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: GlassCardVariant;
  headerIcon?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  variant = 'default',
  headerIcon,
  title,
  subtitle,
  headerAction,
  children,
  className = '',
  ...props
}) => {
  const variantStyles: Record<GlassCardVariant, string> = {
    default:
      'bg-[#12141a]/75 border border-white/[0.08] shadow-[0_12px_36px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.12)]',
    inset:
      'bg-[#0a0c10]/85 border border-white/[0.05] shadow-[inset_0_2px_6px_rgba(0,0,0,0.85),inset_0_-1px_0_rgba(255,255,255,0.04)]',
    interactive:
      'bg-[#12141a]/75 border border-white/[0.08] shadow-[0_12px_36px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.12)] hover:border-[#b5ff00]/40 hover:shadow-[0_16px_44px_rgba(0,0,0,0.8),0_0_20px_rgba(181,255,0,0.1)] transition-all duration-200 cursor-pointer',
    onyx:
      'bg-[#0c0e14]/90 border border-white/[0.09] shadow-[0_16px_40px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.15)]',
  };

  return (
    <div
      className={`relative rounded-[28px] p-6 sm:p-7 overflow-hidden grain-overlay ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {/* Optional Top Specular Hairline */}
      <div
        className="absolute top-0 inset-x-8 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none"
        aria-hidden="true"
      />

      {(title || headerIcon || headerAction) && (
        <div className="flex items-center justify-between gap-3 mb-5 pb-3 border-b border-white/[0.06] relative z-10">
          <div className="flex items-center gap-3 min-w-0">
            {headerIcon && <div className="shrink-0">{headerIcon}</div>}
            <div className="min-w-0">
              {title && (
                <h3 className="text-base sm:text-lg font-bold font-display uppercase tracking-tight text-white truncate">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="text-xs text-zinc-400 font-sans mt-0.5 truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      )}

      <div className="relative z-10">{children}</div>
    </div>
  );
};
