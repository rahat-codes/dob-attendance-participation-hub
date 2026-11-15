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

export const CHUNK_RELOAD_STORAGE_KEY = 'dob_chunk_reload_attempted';

const CHUNK_ERROR_PATTERNS = [
  'chunkloaderror',
  'loading chunk',
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'unable to preload css',
];

export function redactSensitiveText(input: string): string {
  return input
    // Redact query parameters in URLs that may carry session/kiosk tokens
    .replace(/\?[^\s"'`)]+/g, '?[REDACTED]')
    // Redact email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    // Redact bearer/JWT/Firebase-like long tokens (24+ base64url chars)
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_.-]{10,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(?:uid|userId|token|authUid)[=:\s"']+[A-Za-z0-9_-]{6,}\b/gi, '[REDACTED_CRED]');
}

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const combined = `${name} ${message}`.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => combined.includes(pattern));
}

export function formatSafeBoundaryLog(error: unknown): { name: string; message: string } {
  const rawName = error instanceof Error && error.name ? error.name : 'RuntimeError';
  const rawMessage =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string'
      ? error
      : 'Unexpected UI exception';
  return {
    name: rawName.slice(0, 64),
    message: redactSensitiveText(rawMessage).trim().slice(0, 180),
  };
}

export function tryGuardedChunkReload(
  error: unknown,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
  reloadFn?: () => void
): boolean {
  if (!isChunkLoadError(error)) return false;

  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
      ? window.sessionStorage
      : null;

  if (!targetStorage) return false;

  try {
    if (targetStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) === '1') {
      return false;
    }
    targetStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, '1');
  } catch {
    return false;
  }

  const doReload =
    reloadFn ||
    (typeof window !== 'undefined' ? () => window.location.reload() : undefined);
  doReload?.();
  return true;
}

export function sanitizeRuntimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return redactSensitiveText(error.message.trim()).slice(0, 180);
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
    const safeLog = formatSafeBoundaryLog(error);
    if (tryGuardedChunkReload(error)) {
      return;
    }
    if (import.meta.env.DEV) {
      console.error('Root ErrorBoundary caught:', safeLog);
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
