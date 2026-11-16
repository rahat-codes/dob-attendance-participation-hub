export function getActiveAuthHostname(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }
  return '';
}

export function formatAuthSignInError(
  err: unknown,
  hostname: string = getActiveAuthHostname()
): string | null {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';

  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/user-cancelled'
  ) {
    return null;
  }

  if (code === 'auth/network-request-failed') {
    return 'Network error connecting to sign-in service. Please check your connection and try again.';
  }

  if (code === 'auth/unauthorized-domain') {
    const trimmedHost = hostname.trim();
    if (trimmedHost) {
      return `Domain "${trimmedHost}" is not authorized for authentication. Please ask an admin to add "${trimmedHost}" under Firebase Console -> Authentication -> Settings -> Authorized domains.`;
    }
    return 'This domain is not authorized for authentication. Please contact an admin.';
  }

  return "Sign-in isn't available on this address; contact an admin";
}
