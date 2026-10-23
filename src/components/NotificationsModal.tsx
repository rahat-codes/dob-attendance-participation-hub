import React, { useState, useEffect } from 'react';
import {
  Bell,
  Calendar,
  Clock,
  MapPin,
  Trash2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Settings,
  Sparkles,
  Check,
} from 'lucide-react';
import { ClubNotification, UserNotificationPreferences } from '../types';
import {
  markNotificationAsRead,
  markAllNotificationsAsRead,
  dismissNotification,
  requestBrowserNotificationPermission,
} from '../firebase/firestoreService';
import { useAuth } from '../firebase/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { ModalSheet } from './ModalSheet';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: ClubNotification[];
  onNavigateToSession?: (sessionId: string) => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  notifications,
  onNavigateToSession,
}) => {
  const { user, profile } = useAuth();
  const [filter, setFilter] = useState<'all' | 'unread' | 'reminders'>('all');
  const [showPreferences, setShowPreferences] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>('default');

  const [prefs, setPrefs] = useState<UserNotificationPreferences>(() => {
    return (
      profile?.notificationPreferences || {
        enabled: true,
        meetingAnnouncements: true,
        meetingReminders: true,
      }
    );
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSavedMessage, setPrefsSavedMessage] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setBrowserPermission(Notification.permission);
    }
  }, [isOpen]);

  useEffect(() => {
    if (profile?.notificationPreferences) {
      setPrefs(profile.notificationPreferences);
    }
  }, [profile]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredNotifications = notifications.filter((n) => {
    if (filter === 'unread') return !n.read;
    if (filter === 'reminders') return n.type === 'meeting_reminder_30m';
    return true;
  });

  const handleRequestPermission = async () => {
    const res = await requestBrowserNotificationPermission();
    setBrowserPermission(res);
  };

  const handleSavePreferences = async (newPrefs: UserNotificationPreferences) => {
    setPrefs(newPrefs);
    if (!user) return;
    setSavingPrefs(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        notificationPreferences: newPrefs,
        updatedAt: new Date().toISOString(),
      });
      setPrefsSavedMessage(true);
      setTimeout(() => setPrefsSavedMessage(false), 2000);
    } catch (err) {
      console.warn('Failed to save notification preferences:', err);
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleNotificationClick = async (notif: ClubNotification) => {
    if (!notif.read) {
      await markNotificationAsRead(notif.id);
    }
    if (notif.sessionId && onNavigateToSession) {
      onNavigateToSession(notif.sessionId);
      onClose();
    }
  };

  const getNotificationIcon = (type: ClubNotification['type']) => {
    switch (type) {
      case 'meeting_published':
        return (
          <div className="h-8 w-8 rounded-xl bg-[#b5ff00]/15 border border-[#b5ff00]/30 flex items-center justify-center text-[#b5ff00] shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
        );
      case 'meeting_reminder_30m':
        return (
          <div className="h-8 w-8 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
            <Clock className="h-4 w-4" />
          </div>
        );
      case 'meeting_rescheduled':
        return (
          <div className="h-8 w-8 rounded-xl bg-blue-500/15 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0">
            <RefreshCw className="h-4 w-4" />
          </div>
        );
      case 'meeting_cancelled':
        return (
          <div className="h-8 w-8 rounded-xl bg-red-500/15 border border-red-500/40 flex items-center justify-center text-red-400 shrink-0">
            <AlertTriangle className="h-4 w-4" />
          </div>
        );
    }
  };

  const getTypeBadge = (type: ClubNotification['type']) => {
    switch (type) {
      case 'meeting_published':
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00] text-xs font-mono font-bold uppercase">
            New Meeting
          </span>
        );
      case 'meeting_reminder_30m':
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/40 text-amber-400 text-xs font-mono font-bold uppercase">
            30-Min Alert
          </span>
        );
      case 'meeting_rescheduled':
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/40 text-blue-400 text-xs font-mono font-bold uppercase">
            Rescheduled
          </span>
        );
      case 'meeting_cancelled':
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/40 text-red-400 text-xs font-mono font-bold uppercase">
            Cancelled
          </span>
        );
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Meeting Notifications"
      subtitle="Automated session alerts &amp; schedule updates"
      icon={<Bell className="w-5 h-5 text-[#b5ff00]" />}
      headerActions={
        <button
          type="button"
          onClick={() => setShowPreferences(!showPreferences)}
          className={`min-w-11 min-h-11 w-11 h-11 flex items-center justify-center rounded-xl transition-colors cursor-pointer ${
            showPreferences ? 'bg-zinc-800 text-[#b5ff00]' : 'text-zinc-400 hover:text-white hover:bg-white/10'
          }`}
          title="Notification Settings"
          aria-label="Notification Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      }
      maxWidth="xl"
      footer={
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 w-full">
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (user?.uid) {
                  markAllNotificationsAsRead(user.uid, notifications);
                }
              }}
              className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold text-[#b5ff00] hover:text-[#c4ff26] font-mono transition-colors cursor-pointer flex items-center justify-center gap-1.5 min-h-11 border border-[#b5ff00]/30 rounded-xl bg-[#b5ff00]/10"
            >
              <Check className="h-4 w-4" />
              <span>Mark All as Read ({unreadCount})</span>
            </button>
          ) : (
            <span className="text-xs text-zinc-400 font-mono hidden sm:inline">All notifications up to date</span>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-11"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Preferences Panel */}
        {showPreferences && (
          <div className="p-4 rounded-2xl bg-[#0d0f15] border border-white/10 neu-inset space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-white font-mono">
                Notification Preferences
              </span>
              {prefsSavedMessage && (
                <span className="text-xs font-mono text-[#b5ff00]">Preferences Saved!</span>
              )}
            </div>

            <div className="space-y-2 text-xs">
              <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/60 border border-white/5 cursor-pointer min-h-11">
                <div>
                  <div className="font-semibold text-zinc-200">New Meeting Publications</div>
                  <div className="text-zinc-400 text-xs">Receive alerts when new workshops are scheduled</div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.meetingAnnouncements}
                  onChange={(e) =>
                    handleSavePreferences({ ...prefs, meetingAnnouncements: e.target.checked })
                  }
                  className="w-5 h-5 accent-[#b5ff00] rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/60 border border-white/5 cursor-pointer min-h-11">
                <div>
                  <div className="font-semibold text-zinc-200">30-Minute Meeting Alerts</div>
                  <div className="text-zinc-400 text-xs">Remind me 30 minutes before workshops start</div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.meetingReminders}
                  onChange={(e) =>
                    handleSavePreferences({ ...prefs, meetingReminders: e.target.checked })
                  }
                  className="w-5 h-5 accent-[#b5ff00] rounded cursor-pointer"
                />
              </label>

              {browserPermission !== 'granted' && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleRequestPermission}
                    className="w-full py-2.5 px-3 rounded-xl bg-[#b5ff00]/15 hover:bg-[#b5ff00]/25 text-[#b5ff00] border border-[#b5ff00]/40 font-mono text-xs font-bold transition-all cursor-pointer min-h-11"
                  >
                    Enable Browser Push Notifications
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Filter Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar p-1 bg-black/60 rounded-2xl border border-white/5 neu-inset">
          {[
            { key: 'all', label: `All (${notifications.length})` },
            { key: 'unread', label: `Unread (${unreadCount})` },
            { key: 'reminders', label: '30-Min Alerts' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key as any)}
              className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer text-xs whitespace-nowrap min-h-9 ${
                filter === tab.key
                  ? 'bg-zinc-800 text-[#b5ff00] font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* List of Notifications */}
        <div className="space-y-2.5">
          {filteredNotifications.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-400 font-mono border border-dashed border-zinc-800 rounded-2xl">
              No notifications to display.
            </div>
          ) : (
            filteredNotifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => handleNotificationClick(notif)}
                className={`p-3.5 rounded-2xl transition-all cursor-pointer relative space-y-2.5 ${
                  notif.read
                    ? 'glass-panel opacity-80 hover:opacity-100 hover:border-white/20'
                    : 'glass-panel border-[#b5ff00]/40 shadow-[0_4px_16px_rgba(0,0,0,0.5),0_0_12px_rgba(181,255,0,0.1)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {getNotificationIcon(notif.type)}
                    <div>
                      <div className="flex items-center gap-2">
                        {getTypeBadge(notif.type)}
                        {!notif.read && (
                          <span className="h-2 w-2 rounded-full bg-[#b5ff00]" />
                        )}
                      </div>
                      <h4 className="text-sm font-bold text-white font-display mt-1">
                        {notif.title}
                      </h4>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissNotification(notif.id);
                    }}
                    className="min-w-9 min-h-9 w-9 h-9 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                    title="Dismiss notification"
                    aria-label="Dismiss notification"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-xs text-zinc-300 leading-relaxed font-mono pl-11">
                  {notif.message}
                </p>

                {(notif.sessionDate || notif.sessionLocation || notif.sessionTime) && (
                  <div className="ml-11 flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-400 pt-1 border-t border-zinc-800/60">
                    {notif.sessionDate && (
                      <span className="flex items-center gap-1 text-zinc-300">
                        <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                        <span>{notif.sessionDate}</span>
                      </span>
                    )}
                    {notif.sessionTime && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-zinc-500" />
                        <span>{notif.sessionTime}</span>
                      </span>
                    )}
                    {notif.sessionLocation && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-[#b5ff00]" />
                        <span className="truncate max-w-[200px]">{notif.sessionLocation}</span>
                      </span>
                    )}
                  </div>
                )}

                <div className="ml-11 flex items-center justify-between text-xs text-zinc-400 font-mono pt-1">
                  <span>{new Date(notif.createdAt).toLocaleDateString()}</span>
                  {notif.sessionId && (
                    <span className="text-[#b5ff00] hover:underline flex items-center gap-1 font-bold">
                      <span>View Session</span>
                      <ExternalLink className="h-3 w-3" />
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </ModalSheet>
  );
};
