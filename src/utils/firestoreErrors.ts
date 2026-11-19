export interface FirestoreErrorContext {
  path?: string | null;
  operation?: string | null;
  step?: string | null;
}

/**
 * Strips potential emails or Firebase UID-like document IDs from diagnostic codes/labels.
 */
export function sanitizeDiagnosticLabel(value: string): string {
  return value
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/\/[A-Za-z0-9_-]{16,}/g, '/[id]')
    .trim();
}

/**
 * Translates raw Firebase/Firestore errors (including JSON-encoded handleFirestoreError messages)
 * into clean, user-friendly guidance without exposing raw internal JSON payloads or UIDs.
 */
export function formatUserFriendlyFirestoreError(
  err: unknown,
  fallback: string = 'Something went wrong while saving your changes. Please try again.',
  context?: FirestoreErrorContext
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
  let operationPath = context?.path ? String(context.path) : '';
  let operationType = context?.operation ? String(context.operation) : '';

  if (rawMessage.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawMessage);
      if (parsed && typeof parsed.error === 'string') {
        extractedMessage = parsed.error;
      }
      if (parsed && typeof parsed.path === 'string' && !operationPath) {
        operationPath = parsed.path;
      }
      if (parsed && typeof parsed.operationType === 'string' && !operationType) {
        operationType = parsed.operationType;
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
    if (context?.step === 'acceptInvitation' || operationPath.includes('acceptInvitation')) {
      return 'Could not activate your membership invitation due to a permission check. Please refresh your session or contact an organizer to verify your account link.';
    }
    if (operationPath.startsWith('users/')) {
      return 'Could not save your account update due to a permission or validation check. Please verify your inputs, refresh your session, or contact an administrator if this persists.';
    }
    if (operationPath.startsWith('memberPrivate/')) {
      return 'Could not save private contact details on your builder profile due to a permission check. Your account link or live Firestore rules may need an organizer check.';
    }
    if (operationPath.startsWith('members/')) {
      return 'Could not update your builder profile due to a permission check. Please verify all fields (links, avatar URL, bio length, tracks) and refresh your session.';
    }
    if (operationPath.startsWith('publicLeaderboard/')) {
      return 'Could not sync your public leaderboard entry due to a permission check. Please refresh your session or contact an organizer.';
    }
    if (operationPath.startsWith('checkIns/')) {
      return 'Could not record your check-in due to a permission or time-window check. Please ensure the session is open and your kiosk code is current.';
    }
    if (operationPath) {
      const safeCollection = sanitizeDiagnosticLabel(operationPath.split('/')[0] || 'record');
      const opLabel = operationType ? ` (${operationType})` : '';
      return `Permission check failed while accessing ${safeCollection}${opLabel}. Please refresh your session or contact an administrator.`;
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

  if (rawCode === 'not-found' || lower.includes('no document to update')) {
    if (operationPath.startsWith('members/') || operationPath.startsWith('memberPrivate/')) {
      return 'Your linked builder profile record could not be found. Please contact an administrator.';
    }
    return 'The requested record could not be found. Please refresh and try again.';
  }

  return sanitizeDiagnosticLabel(extractedMessage) || fallback;
}

