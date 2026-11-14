import React from 'react';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';

export interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onResetToHome?: () => void;
}

export function sanitizeRuntimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    // Strip overly verbose stacks or accidental URLs/tokens while keeping useful diagnostics
    return error.message.trim().slice(0, 180);
  }
  return 'An unexpected interface error occurred.';
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: sanitizeRuntimeErrorMessage(error),
    };
  }

  componentDidCatch(error: unknown) {
    // Keep console error silent in production unless needed during local dev
    if (import.meta.env.DEV) {
      console.error('Root ErrorBoundary caught:', error);
    }
  }

  private handleReturnHome = () => {
    if (typeof window !== 'undefined') {
      try {
        window.history.replaceState({ tab: 'home' }, '', '#/home');
      } catch {
        window.location.hash = '#/home';
      }
    }
    this.props.onResetToHome?.();
    this.setState({ hasError: false, errorMessage: '' });
  };

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="min-h-dvh tech-grid flex items-center justify-center p-4"
          style={{
            backgroundColor: 'var(--bg-app, #0a0b0e)',
            color: 'var(--text-main, #f4f4f5)',
          }}
        >
          <div className="w-full max-w-md rounded-3xl glass-panel p-6 sm:p-8 text-center space-y-5 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" aria-hidden="true" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-black font-display uppercase tracking-tight">
                Something Went Wrong
              </h1>
              <p className="text-xs leading-relaxed opacity-80">
                Den of Builders hit an unexpected display error. Your check-in records and data remain safe.
              </p>
              {this.state.errorMessage && (
                <p className="text-[11px] font-mono px-3 py-2 rounded-xl bg-black/30 border border-white/10 break-words">
                  {this.state.errorMessage}
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleReturnHome}
                className="btn-glossy-primary flex-1 min-h-11 px-4 py-2.5 rounded-xl font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
              >
                <Home className="w-4 h-4" aria-hidden="true" />
                <span>Return to Home</span>
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="btn-glossy-secondary flex-1 min-h-11 px-4 py-2.5 rounded-xl font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>Reload App</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
