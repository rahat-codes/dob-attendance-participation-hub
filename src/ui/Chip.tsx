import React from 'react';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const Chip: React.FC<ChipProps> = ({
  active = false,
  count,
  icon,
  children,
  className = '',
  ...props
}) => {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`relative inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-display uppercase tracking-wider font-bold transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b0e] ${
        active
          ? 'bg-[#b5ff00] text-black shadow-[0_0_14px_rgba(181,255,0,0.35),inset_0_1px_0_rgba(255,255,255,0.6)] border border-white/40'
          : 'bg-[#141720]/80 text-zinc-400 hover:text-zinc-200 hover:bg-[#1b1f2b] border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
      } ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
      {typeof count === 'number' && (
        <span
          className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            active ? 'bg-black/20 text-black' : 'bg-black/40 text-zinc-400'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
};
