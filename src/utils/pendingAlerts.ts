import { UserProfile } from '../types';

/**
 * Detects newly arriving pending membership requests while the admin has the portal open.
 * - Suppresses all existing requests during the initial snapshot.
 * - Deduplicates by user ID so each user only triggers an alert once.
 */
export class PendingRequestDetector {
  private seenUids = new Set<string>();
  private isInitial = true;

  constructor(initialSeenUids?: string[]) {
    if (initialSeenUids && initialSeenUids.length > 0) {
      initialSeenUids.forEach((id) => this.seenUids.add(id));
      this.isInitial = false;
    }
  }

  /**
   * Evaluates the latest list of users from the Firestore listener snapshot.
   * Returns newly arrived pending users (empty on initial snapshot).
   */
  public processUsers(users: UserProfile[]): UserProfile[] {
    const currentPending = users.filter((u) => u.status === 'pending');

    if (this.isInitial) {
      currentPending.forEach((u) => this.seenUids.add(u.id));
      this.isInitial = false;
      return [];
    }

    const newArrivals: UserProfile[] = [];
    for (const u of currentPending) {
      if (!this.seenUids.has(u.id)) {
        this.seenUids.add(u.id);
        newArrivals.push(u);
      }
    }

    return newArrivals;
  }

  public getSeenCount(): number {
    return this.seenUids.size;
  }

  public reset(): void {
    this.seenUids.clear();
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
