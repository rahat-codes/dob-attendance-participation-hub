import { UserProfile } from '../types';
import { isApplicationSubmitted } from './application';

/**
 * Detects newly arriving or re-submitted pending membership requests while the admin has the portal open.
 * - Suppresses all existing requests during the initial snapshot.
 * - Ignores users who just signed in without submitting an application.
 * - Triggers once per submission timestamp (supporting re-applications).
 */
export class PendingRequestDetector {
  private seenSubmissions = new Map<string, string>();
  private isInitial = true;

  constructor(initialSeenUids?: string[]) {
    if (initialSeenUids && initialSeenUids.length > 0) {
      initialSeenUids.forEach((id) => this.seenSubmissions.set(id, 'initial'));
      this.isInitial = false;
    }
  }

  /**
   * Evaluates the latest list of users from the Firestore listener snapshot.
   * Returns newly submitted or re-submitted pending applications (empty on initial snapshot).
   */
  public processUsers(users: UserProfile[]): UserProfile[] {
    const currentSubmittedPending = users.filter(
      (u) => u.status === 'pending' && isApplicationSubmitted(u)
    );

    if (this.isInitial) {
      currentSubmittedPending.forEach((u) => {
        this.seenSubmissions.set(u.id, u.membershipRequestedAt || 'legacy');
      });
      this.isInitial = false;
      return [];
    }

    const newArrivals: UserProfile[] = [];
    for (const u of currentSubmittedPending) {
      const currentToken = u.membershipRequestedAt || 'submitted';
      const lastToken = this.seenSubmissions.get(u.id);

      if (!lastToken || lastToken !== currentToken) {
        this.seenSubmissions.set(u.id, currentToken);
        newArrivals.push(u);
      }
    }

    return newArrivals;
  }

  public getSeenCount(): number {
    return this.seenSubmissions.size;
  }

  public reset(): void {
    this.seenSubmissions.clear();
    this.isInitial = true;
  }
}

/**
 * Triggers a native browser notification if granted by the user.
 */
export function triggerBrowserNotification(user: UserProfile): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    try {
      new Notification('DOB Hub: New Builder Request', {
        body: `${user.displayName || user.email || 'A builder'} requested to join the guild.`,
        icon: '/dob_logo-192.png',
        tag: `dob-request-${user.id}`,
      });
      return true;
    } catch (err) {
      console.warn('Browser notification failed:', err);
      return false;
    }
  }

  return false;
}

/**
 * Prompts the browser notification permission prompt if in default state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  if (Notification.permission === 'default') {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }

  return Notification.permission;
}
