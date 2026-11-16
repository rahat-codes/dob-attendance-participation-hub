/**
 * Translates raw Firebase/Firestore errors (including JSON-encoded handleFirestoreError messages)
 * into clean, user-friendly guidance without exposing raw internal JSON payloads or UIDs.
 */
export function formatUserFriendlyFirestoreError(
  err: unknown,
  fallback: string = 'Something went wrong while saving your changes. Please try again.'
): string {
  if (!err) return fallback;

  const rawMessage =
    typeof err === 'string'
      ? err
      : err instanceof Error
      ? err.message
      : typeof (err as any)?.message === 'string'
      ? (err as any).message
      : String(err);

  const rawCode = typeof (err as any)?.code === 'string' ? (err as any).code.toLowerCase() : '';

  let extractedMessage = rawMessage;
  let operationPath = '';

  if (rawMessage.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawMessage);
      if (parsed && typeof parsed.error === 'string') {
        extractedMessage = parsed.error;
      }
      if (parsed && typeof parsed.path === 'string') {
        operationPath = parsed.path;
      }
    } catch {
      // Keep rawMessage if not valid JSON
    }
  }

  const lower = extractedMessage.toLowerCase();

  if (
    rawCode === 'permission-denied' ||
    lower.includes('permission-denied') ||
    lower.includes('missing or insufficient permissions')
  ) {
    if (operationPath.startsWith('users/')) {
      return 'Could not save your account update due to a permission or validation check. Please verify your inputs, refresh your session, or contact an administrator if this persists.';
    }
    if (operationPath.startsWith('members/') || operationPath.startsWith('memberPrivate/')) {
      return 'Could not update your builder profile due to a permission check. Please verify all fields (links, avatar URL, bio length) and refresh your session.';
    }
    return 'Permission check failed for this action. Please refresh your session or sign out and back in.';
  }

  if (
    rawCode === 'unavailable' ||
    lower.includes('client is offline') ||
    lower.includes('network')
  ) {
    return 'Network unavailable while connecting to the club database. Please check your connection and try again.';
  }

  if (rawCode === 'deadline-exceeded' || lower.includes('timed out')) {
    return 'The request timed out. Please check your connection and try again.';
  }

  return extractedMessage.trim() || fallback;
}
