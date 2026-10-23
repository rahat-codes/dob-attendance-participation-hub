import React, { useEffect, useRef, useId, useState } from 'react';
import { X } from 'lucide-react';
import { m, AnimatePresence } from 'motion/react';
import { fade, sheetUp, scaleIn } from '../motion/presets';

export interface ModalSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
  hasUnsavedChanges?: boolean;
  ariaLabelledBy?: string;
  hideCloseButton?: boolean;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  fullHeightOnMobile?: boolean;
}

const maxWidthMap = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  '4xl': 'sm:max-w-4xl',
  full: 'sm:max-w-5xl',
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 640;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 639px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
};

export const ModalSheet: React.FC<ModalSheetProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  headerActions,
  children,
  footer,
  maxWidth = 'lg',
  hasUnsavedChanges = false,
  ariaLabelledBy,
  hideCloseButton = false,
  className = '',
  bodyClassName = '',
  headerClassName = '',
  footerClassName = '',
  fullHeightOnMobile = false,
}) => {
  const generatedTitleId = useId();
  const titleId = ariaLabelledBy || generatedTitleId;
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const pointerDownTargetRef = useRef<EventTarget | null>(null);
  const openTimeRef = useRef<number>(0);
  const isMobile = useIsMobile();

  // Safe dismiss handler honoring unsaved changes
  const handleSafeClose = () => {
    if (hasUnsavedChanges) {
      return;
    }
    onClose();
  };

  // Body scroll lock & Escape key & Focus restore
  useEffect(() => {
    if (!isOpen) {
      // Restore focus immediately when modal starts closing
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
      }
      return;
    }

    openTimeRef.current = Date.now();
    previousActiveElement.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;

    // Prevent layout shift from scrollbar disappearing
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleSafeClose();
      }

      // Focus trap
      if (e.key === 'Tab' && dialogRef.current) {
        const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Initial focus into dialog
    const timer = setTimeout(() => {
      if (dialogRef.current) {
        const focusable = dialogRef.current.querySelector<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])'
        );
        if (focusable) {
          focusable.focus();
        } else {
          dialogRef.current.focus();
        }
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, hasUnsavedChanges]);

  return (
    <AnimatePresence>
      {isOpen && (
        <m.div
          key="modal-backdrop"
          variants={fade}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed inset-0 z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 sm:pt-8 md:pt-12 sm:pb-8 overflow-y-auto bg-black/80 backdrop-blur-md"
          onPointerDown={(e) => {
            pointerDownTargetRef.current = e.target;
          }}
          onClick={(e) => {
            // Prevent mobile ghost-click dismissal within 250ms of modal opening
            if (Date.now() - openTimeRef.current < 250) {
              return;
            }
            // Only close if pointer originated on backdrop AND clicked on backdrop
            if (e.target === e.currentTarget && pointerDownTargetRef.current === e.currentTarget) {
              handleSafeClose();
            }
            pointerDownTargetRef.current = null;
          }}
          role="presentation"
        >
          <m.div
            key="modal-panel"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            variants={isMobile ? sheetUp : scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className={`w-full ${maxWidthMap[maxWidth]} bg-[#0f1118] border border-white/10 sm:rounded-2xl rounded-t-3xl shadow-[0_25px_65px_-12px_rgba(0,0,0,0.95),0_0_1px_1px_rgba(255,255,255,0.1)] flex flex-col ${
              fullHeightOnMobile ? 'h-[92dvh] sm:h-auto' : 'max-h-[92dvh] sm:max-h-[85dvh]'
            } sm:my-auto outline-none overflow-hidden ${className}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile pull indicator */}
            <div className="w-full flex sm:hidden items-center justify-center pt-2.5 pb-1">
              <div className="w-10 h-1 rounded-full bg-zinc-700/60" />
            </div>

            {/* Sticky Header */}
            {(title || !hideCloseButton) && (
              <header
                className={`sticky top-0 z-10 flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 bg-[#121520]/95 backdrop-blur-lg border-b border-white/[0.08] shrink-0 ${headerClassName}`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  {icon && (
                    <div className="p-2 rounded-xl bg-zinc-900 border border-white/10 text-[#b5ff00] shrink-0">
                      {icon}
                    </div>
                  )}
                  <div className="min-w-0">
                    {title && (
                      <h2
                        id={titleId}
                        className="text-base sm:text-lg font-bold text-white font-display truncate leading-snug tracking-tight uppercase"
                      >
                        {title}
                      </h2>
                    )}
                    {subtitle && (
                      <p className="text-xs text-zinc-400 truncate mt-0.5 font-sans leading-normal">
                        {subtitle}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {headerActions}
                  {!hideCloseButton && (
                    <button
                      type="button"
                      onClick={handleSafeClose}
                      aria-label="Close dialog"
                      className="min-w-11 min-h-11 w-11 h-11 flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#b5ff00]"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </header>
            )}

            {/* Scrollable Body */}
            <div
              className={`flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar ${bodyClassName}`}
            >
              {children}
            </div>

            {/* Sticky Footer */}
            {footer && (
              <footer
                className={`sticky bottom-0 z-10 px-4 sm:px-6 py-3.5 sm:py-4 bg-[#121520]/95 backdrop-blur-lg border-t border-white/[0.08] pb-safe shrink-0 ${footerClassName}`}
              >
                {footer}
              </footer>
            )}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
};
