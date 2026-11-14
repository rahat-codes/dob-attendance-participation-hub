import React from 'react';
import { Compass, Home } from 'lucide-react';

interface NotFoundViewProps {
  invalidRoute?: string | null;
  onReturnHome: () => void;
  actionLabel?: string;
}

export const NotFoundView: React.FC<NotFoundViewProps> = ({
  invalidRoute,
  onReturnHome,
  actionLabel = 'Return to Hub',
}) => {
  return (
    <section
      aria-labelledby="not-found-heading"
      className="max-w-lg mx-auto py-12 px-4 text-center"
    >
      <div className="rounded-3xl glass-panel p-6 sm:p-10 space-y-5 shadow-2xl">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
          <Compass className="w-7 h-7" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <span className="inline-block text-xs font-mono font-bold uppercase tracking-widest text-amber-400">
            Error 404
          </span>
          <h1
            id="not-found-heading"
            className="text-2xl font-black font-display uppercase tracking-tight text-white"
          >
            Page Not Found
          </h1>
          <p className="text-xs text-zinc-400 leading-relaxed">
            The hub route{' '}
            {invalidRoute ? (
              <span className="font-mono text-zinc-200 px-1.5 py-0.5 rounded bg-white/5 break-all">
                {invalidRoute}
              </span>
            ) : (
              'you requested'
            )}{' '}
            does not exist or may have moved.
          </p>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={onReturnHome}
            className="btn-glossy-primary min-h-11 px-6 py-3 rounded-full font-display font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            <span>{actionLabel}</span>
          </button>
        </div>
      </div>
    </section>
  );
};
