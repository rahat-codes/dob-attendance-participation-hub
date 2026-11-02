import React from 'react';

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  id,
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className = '',
}) => {
  const switchId = id || `switch-${Math.random().toString(36).substring(2, 9)}`;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <div className={`flex items-center justify-between gap-4 py-1.5 ${className}`}>
      {label && (
        <div className="flex-1 cursor-pointer" onClick={() => !disabled && onChange(!checked)}>
          <label
            htmlFor={switchId}
            className={`text-xs font-semibold font-display uppercase tracking-wide block ${
              disabled ? 'text-zinc-500' : 'text-zinc-200'
            }`}
          >
            {label}
          </label>
          {description && (
            <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed font-sans">
              {description}
            </p>
          )}
        </div>
      )}

      {/* Interactive Switch Element with 44px touch hit box */}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        onKeyDown={handleKeyDown}
        className={`relative inline-flex items-center shrink-0 w-14 h-8 p-1 rounded-full cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b0e] disabled:opacity-40 disabled:cursor-not-allowed ${
          checked
            ? 'bg-[#b5ff00] shadow-[0_0_16px_rgba(181,255,0,0.4)] border border-white/40'
            : 'bg-[#141720] border border-white/10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]'
        }`}
      >
        {/* Pearl round glossy knob with specular shine */}
        <span
          className={`relative block w-6 h-6 rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.5),inset_0_1px_1px_#ffffff] transition-transform duration-200 ease-out pointer-events-none ${
            checked
              ? 'translate-x-6 bg-gradient-to-b from-white via-zinc-100 to-zinc-300'
              : 'translate-x-0 bg-gradient-to-b from-zinc-200 via-zinc-300 to-zinc-400'
          }`}
        >
          {/* Knob Specular Glint */}
          <span className="absolute top-1 left-1.5 w-1.5 h-1 rounded-full bg-white/70 blur-[0.3px]" />
        </span>
      </button>
    </div>
  );
};
