import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...props
}) => {
  const isDisabled = disabled || isLoading;

  // Base pill shape, min-height 44px for AA touch targets, visible lime focus ring
  const baseClasses =
    'relative inline-flex items-center justify-center font-display uppercase tracking-wider rounded-full cursor-pointer select-none transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b0e] disabled:pointer-events-none disabled:opacity-45 disabled:cursor-not-allowed';

  const sizeClasses: Record<ButtonSize, string> = {
    sm: 'min-h-[40px] px-4 text-xs gap-1.5 font-bold',
    md: 'min-h-[44px] px-5 py-2.5 text-xs font-bold gap-2',
    lg: 'min-h-[52px] px-7 py-3 text-sm font-extrabold gap-2.5',
  };

  const variantClasses: Record<ButtonVariant, string> = {
    primary: 'btn-glossy-primary',
    secondary: 'btn-glossy-secondary',
    danger: 'btn-glossy-danger',
    ghost:
      'bg-transparent hover:bg-white/[0.06] text-zinc-300 hover:text-white border border-transparent hover:border-white/10',
  };

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={isLoading}
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-current" aria-hidden="true" />
          <span>{children}</span>
        </>
      ) : (
        <>
          {leftIcon && <span className="shrink-0" aria-hidden="true">{leftIcon}</span>}
          <span>{children}</span>
          {rightIcon && <span className="shrink-0" aria-hidden="true">{rightIcon}</span>}
        </>
      )}
    </button>
  );
};
