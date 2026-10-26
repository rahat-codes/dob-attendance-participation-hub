/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Scan,
  TrendingUp,
  ShieldCheck,
  Lock,
  Trophy,
  LogIn,
  RefreshCw,
} from 'lucide-react';
import { m } from 'motion/react';
import { NavigationTab } from './Navbar';
import { useAuth } from '../firebase/AuthContext';

interface BottomTabBarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  onOpenQuickScan: () => void;
  onOpenMore?: () => void;
  onOpenAdminLogin?: () => void;
  pendingRequestsCount?: number;
  unreadNotificationsCount?: number;
  isModalOpen?: boolean;
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  onSelectTab,
  onOpenQuickScan,
  onOpenMore,
  onOpenAdminLogin,
  pendingRequestsCount = 0,
  isModalOpen = false,
}) => {
  const { user, isAdmin, handleSignIn, signingIn } = useAuth();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  // Keyboard-aware hiding: prevent bottom nav from covering form inputs or floating when keyboard opens
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleViewportChange = () => {
      const vv = window.visualViewport;
      if (vv) {
        // If visual viewport height is < 75% of window innerHeight, virtual keyboard is active
        setIsKeyboardVisible(vv.height < window.innerHeight * 0.75);
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        setIsKeyboardVisible(true);
      }
    };

    const handleFocusOut = () => {
      setIsKeyboardVisible(false);
    };

    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // Kiosk is a dedicated full-screen display mode; also hide when soft keyboard or modal dialog is open
  if (activeTab === 'kiosk' || isModalOpen || isKeyboardVisible) {
    return null;
  }

  const isSessionsActive = activeTab === 'sessions';
  const isParticipationActive = activeTab === 'participation';
  const isLeaderboardActive = activeTab === 'leaderboard';
  const isAdminActive = isAdmin
    ? activeTab === 'requests' || activeTab === 'members'
    : false;

  const handleAdminClick = () => {
    if (isAdmin) {
      if (pendingRequestsCount > 0) {
        onSelectTab('requests');
      } else if (activeTab === 'members') {
        onSelectTab('requests');
      } else {
        onSelectTab('members');
      }
    } else {
      if (onOpenAdminLogin) {
        onOpenAdminLogin();
      } else if (onOpenMore) {
        onOpenMore();
      } else {
        onSelectTab('members');
      }
    }
  };

  return (
    <nav
      aria-label="Mobile Navigation"
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-[#0c0e14]/95 backdrop-blur-2xl border-t border-white/[0.12] pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(0,0,0,0.8)] pointer-events-auto"
    >
      <div className="flex items-center justify-around h-14 landscape:h-12 sm:h-16 max-w-lg mx-auto px-2">
        {/* For Unauthenticated Guests: Sessions, Leaderboard, Sign In */}
        {!user ? (
          <>
            {/* Guest Tab 1: Sessions */}
            <m.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => onSelectTab('sessions')}
              aria-label="Sessions"
              aria-current={isSessionsActive ? 'page' : undefined}
              className={`flex flex-col items-center justify-center flex-1 h-full min-w-[44px] min-h-[44px] py-1 transition-colors cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none ${
                isSessionsActive ? 'text-[#b5ff00] font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Calendar className={`w-5 h-5 shrink-0 ${isSessionsActive ? 'text-[#b5ff00]' : 'text-zinc-400'}`} />
              <span className="text-[11px] font-medium tracking-tight mt-0.5 font-display">Sessions</span>
            </m.button>

            {/* Guest Tab 2: Leaderboard */}
            <m.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => onSelectTab('leaderboard')}
              aria-label="Leaderboard"
              aria-current={isLeaderboardActive ? 'page' : undefined}
              className={`flex flex-col items-center justify-center flex-1 h-full min-w-[44px] min-h-[44px] py-1 transition-colors cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none ${
                isLeaderboardActive ? 'text-[#b5ff00] font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Trophy className={`w-5 h-5 shrink-0 ${isLeaderboardActive ? 'text-[#b5ff00]' : 'text-zinc-400'}`} />
              <span className="text-[11px] font-medium tracking-tight mt-0.5 font-display">Leaderboard</span>
            </m.button>

            {/* Guest Tab 3: Sign In */}
            <m.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => handleSignIn()}
              disabled={signingIn}
              aria-label="Sign In with Google"
              className="flex flex-col items-center justify-center flex-1 h-full min-w-[44px] min-h-[44px] py-1 transition-colors cursor-pointer rounded-xl text-[#b5ff00] hover:text-[#c4ff26] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none"
            >
              {signingIn ? (
                <RefreshCw className="w-5 h-5 shrink-0 animate-spin" />
              ) : (
                <LogIn className="w-5 h-5 shrink-0" />
              )}
              <span className="text-[11px] font-bold tracking-tight mt-0.5 font-display">Sign In</span>
            </m.button>
          </>
        ) : (
          /* For Authenticated Users (Members & Admins) */
          <>
            {/* Tab 1: Sessions */}
            <m.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => onSelectTab('sessions')}
              aria-label="Sessions"
              aria-current={isSessionsActive ? 'page' : undefined}
              className={`flex flex-col items-center justify-center flex-1 h-full min-w-[44px] min-h-[44px] py-1 transition-colors cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none ${
                isSessionsActive ? 'text-[#b5ff00] font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="relative">
                <Calendar className={`w-5 h-5 shrink-0 ${isSessionsActive ? 'text-[#b5ff00]' : 'text-zinc-400'}`} />
              </div>
              <span className="text-[11px] font-medium tracking-tight mt-0.5 font-display">Sessions</span>
            </m.button>

            {/* Tab 2: Scan QR */}
            <m.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={onOpenQuickScan}
              aria-label="Scan QR Code"
              aria-current={activeTab === 'scanner' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center flex-1 h-full min-w-[44px] min-h-[44px] py-1 transition-colors cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none ${
                activeTab === 'scanner' ? 'text-[#b5ff00] font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="relative">
                <Scan className="w-5 h-5 shrink-0 stroke-[2.2]" />
              </div>
              <span className="text-[11px] font-medium tracking-tight mt-0.5 font-display">Scan</span>
            </m.button>

            {/* Tab 3: Participation */}
            <m.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => onSelectTab('participation')}
              aria-label="Participation"
              aria-current={isParticipationActive ? 'page' : undefined}
              className={`flex flex-col items-center justify-center flex-1 h-full min-w-[44px] min-h-[44px] py-1 transition-colors cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none ${
                isParticipationActive ? 'text-[#b5ff00] font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="relative">
                <TrendingUp className={`w-5 h-5 shrink-0 ${isParticipationActive ? 'text-[#b5ff00]' : 'text-zinc-400'}`} />
              </div>
              <span className="text-[11px] font-medium tracking-tight mt-0.5 font-display">Participation</span>
            </m.button>

            {/* Tab 4: Admin or More */}
            <m.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={handleAdminClick}
              aria-label={isAdmin ? 'Admin Management' : 'Admin & Directory'}
              aria-current={isAdminActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center flex-1 h-full min-w-[44px] min-h-[44px] py-1 transition-colors cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none ${
                isAdminActive ? 'text-[#b5ff00] font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="relative pointer-events-none">
                {isAdmin ? (
                  <ShieldCheck className={`w-5 h-5 shrink-0 ${isAdminActive ? 'text-[#b5ff00]' : 'text-zinc-400'}`} />
                ) : (
                  <Lock className="w-5 h-5 shrink-0 text-zinc-400" />
                )}
                {pendingRequestsCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-amber-400 text-black text-[10px] font-bold font-mono">
                    {pendingRequestsCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-medium tracking-tight mt-0.5 font-display pointer-events-none">
                {isAdmin ? 'Admin' : 'Builders'}
              </span>
            </m.button>
          </>
        )}
      </div>
    </nav>
  );
};
