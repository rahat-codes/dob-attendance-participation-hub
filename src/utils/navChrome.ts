/**
 * Desktop & Mobile Navigation Chrome State Machine
 *
 * Enforces pure navigation layout logic:
 * - Desktop (>= 1024px) & not blocked: exactly one bar visible (top bar OR sidebar drawer).
 * - Mobile (< 1024px): sidebarVisible is false; mobile bottom island nav handles navigation.
 * - Blocked (profile completion gate, loading, signed out, guest hub): neither desktop bar opens.
 * - Resizing below lg (1024px) closes the desktop sidebar (mobile drawer takes over).
 * - Resizing up to lg never automatically reopens the sidebar (top bar visible by default).
 */

export interface NavChromeStateInput {
  isDesktop: boolean;
  isSidebarOpen: boolean;
  isBlocked: boolean;
}

export interface NavChromeStateOutput {
  topBarVisible: boolean;
  sidebarVisible: boolean;
}

export type NavChromeEvent =
  | { type: 'toggleFromLogo' }
  | { type: 'close' }
  | { type: 'selectDestination' }
  | { type: 'escape' }
  | { type: 'scrimClick' }
  | { type: 'resizeToMobile' }
  | { type: 'resizeToDesktop' }
  | { type: 'routeChange' }
  | { type: 'signOut' }
  | { type: 'blocked' };

export const CLOSE_SIDEBAR_ON_SELECT = true;

/**
 * Pure function: calculates visibility of top bar and sidebar.
 */
export function getNavChromeState(input: NavChromeStateInput): NavChromeStateOutput {
  const { isDesktop, isSidebarOpen, isBlocked } = input;

  // When the app is blocked (profile-completion gate, loading, signed out, guest hub)
  if (isBlocked) {
    return {
      topBarVisible: false,
      sidebarVisible: false,
    };
  }

  // Mobile layout (< 1024px)
  if (!isDesktop) {
    return {
      topBarVisible: false,
      sidebarVisible: false,
    };
  }

  // Desktop layout (>= 1024px): exactly one bar visible
  if (isSidebarOpen) {
    return {
      topBarVisible: false,
      sidebarVisible: true,
    };
  }

  return {
    topBarVisible: true,
    sidebarVisible: false,
  };
}

export interface ChromeReducerState {
  isSidebarOpen: boolean;
  isDesktop: boolean;
  isBlocked: boolean;
}

/**
 * Pure reducer: processes user/system navigation events.
 */
export function navChromeReducer(
  state: ChromeReducerState,
  event: NavChromeEvent
): ChromeReducerState {
  switch (event.type) {
    case 'toggleFromLogo':
      if (state.isBlocked || !state.isDesktop) {
        return state;
      }
      return {
        ...state,
        isSidebarOpen: !state.isSidebarOpen,
      };

    case 'close':
    case 'escape':
    case 'scrimClick':
      if (!state.isSidebarOpen) return state;
      return {
        ...state,
        isSidebarOpen: false,
      };

    case 'selectDestination':
      if (CLOSE_SIDEBAR_ON_SELECT) {
        return {
          ...state,
          isSidebarOpen: false,
        };
      }
      return state;

    case 'resizeToMobile':
      // Resizing below lg closes the desktop sidebar
      return {
        ...state,
        isDesktop: false,
        isSidebarOpen: false,
      };

    case 'resizeToDesktop':
      // Resizing up to desktop sets isDesktop true, but NEVER automatically re-opens the sidebar
      return {
        ...state,
        isDesktop: true,
        isSidebarOpen: false,
      };

    case 'routeChange':
      // Route change closes the sidebar
      return {
        ...state,
        isSidebarOpen: false,
      };

    case 'signOut':
    case 'blocked':
      return {
        ...state,
        isBlocked: true,
        isSidebarOpen: false,
      };

    default:
      return state;
  }
}
