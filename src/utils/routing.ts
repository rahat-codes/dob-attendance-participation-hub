export type NavigationTab =
  | 'home'
  | 'leaderboard'
  | 'kiosk'
  | 'scanner'
  | 'participation'
  | 'sessions'
  | 'members'
  | 'requests'
  | 'verify';

export const VALID_ROUTES: readonly NavigationTab[] = [
  'home',
  'sessions',
  'participation',
  'members',
  'leaderboard',
  'kiosk',
  'requests',
] as const;

export interface RouteResolution {
  tab: NavigationTab | null;
  isNotFound: boolean;
  invalidRoute: string | null;
  hasDeepLinkCheckIn: boolean;
}

export function resolveAppRoute(locationLike: {
  pathname?: string;
  search?: string;
  hash?: string;
}): RouteResolution {
  const pathname = (locationLike.pathname || '/').trim() || '/';
  const search = locationLike.search || '';
  const hash = locationLike.hash || '';

  const params = new URLSearchParams(search);
  const hasDeepLinkCheckIn = Boolean(
    params.get('sessionId') ||
      params.get('checkin') ||
      params.get('s') ||
      params.get('t') ||
      params.get('verify')
  );

  // Unknown non-root pathname triggers 404 unless deep-link params exist on root
  const normalizedPath = pathname === '/index.html' ? '/' : pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath !== '/') {
    return {
      tab: null,
      isNotFound: true,
      invalidRoute: pathname,
      hasDeepLinkCheckIn: false,
    };
  }

  if (hasDeepLinkCheckIn) {
    return {
      tab: 'home',
      isNotFound: false,
      invalidRoute: null,
      hasDeepLinkCheckIn: true,
    };
  }

  const trimmedHash = hash.trim();
  if (!trimmedHash || trimmedHash === '#' || trimmedHash === '#/') {
    return {
      tab: null,
      isNotFound: false,
      invalidRoute: null,
      hasDeepLinkCheckIn: false,
    };
  }

  const slug = trimmedHash.replace(/^#\/?/, '').split('?')[0].toLowerCase();
  if ((VALID_ROUTES as readonly string[]).includes(slug)) {
    return {
      tab: slug as NavigationTab,
      isNotFound: false,
      invalidRoute: null,
      hasDeepLinkCheckIn: false,
    };
  }

  return {
    tab: null,
    isNotFound: true,
    invalidRoute: trimmedHash,
    hasDeepLinkCheckIn: false,
  };
}
