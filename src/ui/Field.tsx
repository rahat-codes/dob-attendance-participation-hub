import React, { useId } from 'react';

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
  containerClassName?: string;
}

export const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  (
    {
      label,
      helperText,
      error,
      required,
      leftAddon,
      rightAddon,
      id,
      className = '',
      containerClassName = '',
      disabled,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const describedBy = [
      error ? errorId : null,
      helperText ? helperId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    return (
      <div className={`space-y-1.5 ${containerClassName}`}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold font-display uppercase tracking-wider text-zinc-300"
          >
            {label}
            {required && (
              <span className="text-red-400 font-bold ml-1" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}

        <div className="relative flex items-center">
          {leftAddon && (
            <div className="absolute left-3.5 text-zinc-500 pointer-events-none flex items-center">
              {leftAddon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            required={required}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className={`w-full min-h-[44px] rounded-[14px] bg-[#0d0f15]/80 border text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-600 transition-all focus:outline-none focus:border-[#b5ff00] focus:ring-1 focus:ring-[#b5ff00] shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] disabled:opacity-40 disabled:cursor-not-allowed ${
              error
                ? 'border-red-500/80 bg-red-950/20'
                : 'border-white/10 hover:border-white/20'
            } ${leftAddon ? 'pl-10' : 'pl-3.5'} ${rightAddon ? 'pr-10' : 'pr-3.5'} ${className}`}
            {...props}
          />

          {rightAddon && (
            <div className="absolute right-3.5 text-zinc-500 flex items-center">
              {rightAddon}
            </div>
          )}
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-400 font-sans flex items-center gap-1 mt-1">
            <span>{error}</span>
          </p>
        )}

        {!error && helperText && (
          <p id={helperId} className="text-[11px] text-zinc-500 font-sans mt-1">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Field.displayName = 'Field';
