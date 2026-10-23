const DEEP_LINK_STORAGE_KEY = 'dob_pending_checkin';

export interface PendingCheckInParams {
  sessionId: string;
  token: string;
}

/**
 * Extracts ?s=...&t=... deep-link query parameters on page load,
 * saves them in sessionStorage for uninterrupted authentication resumption,
 * and immediately cleans the browser address bar with history.replaceState.
 */
export function captureAndStoreDeepLink(): PendingCheckInParams | null {
  if (typeof window === 'undefined') return null;

  try {
    const url = new URL(window.location.href);
    const s = url.searchParams.get('s') || url.searchParams.get('sessionId');
    const t = url.searchParams.get('t') || url.searchParams.get('token') || url.searchParams.get('checkin');

    if (s && t) {
      const params: PendingCheckInParams = {
        sessionId: s.trim(),
        token: t.trim(),
      };

      try {
        sessionStorage.setItem(DEEP_LINK_STORAGE_KEY, JSON.stringify(params));
      } catch {
        // sessionStorage might be restricted in some iframe contexts
      }

      // Immediately scrub the sensitive token and params from address bar
      url.searchParams.delete('s');
      url.searchParams.delete('sessionId');
      url.searchParams.delete('t');
      url.searchParams.delete('token');
      url.searchParams.delete('checkin');
      const cleanUrl = url.pathname + (url.search ? url.search : '') + url.hash;
      window.history.replaceState({}, document.title, cleanUrl);

      return params;
    }
  } catch {
    // ignore
  }

  return getPendingCheckIn();
}

export function getPendingCheckIn(): PendingCheckInParams | null {
  try {
    const raw = sessionStorage.getItem(DEEP_LINK_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingCheckInParams;
  } catch {
    return null;
  }
}

export function clearPendingCheckIn(): void {
  try {
    sessionStorage.removeItem(DEEP_LINK_STORAGE_KEY);
  } catch {
    // ignore
  }
}
