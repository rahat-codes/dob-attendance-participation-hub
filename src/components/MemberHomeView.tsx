import React, { useState, useEffect } from 'react';
import {
  Member,
  Session,
  CheckInRecord,
  ClubNotification,
} from '../types';
import {
  Calendar,
  Clock,
  MapPin,
  Flame,
  CheckCircle2,
  QrCode,
  Sparkles,
  Award,
  Layers,
  ArrowRight,
  ShieldCheck,
  Bell,
  User,
} from 'lucide-react';
import { getSessionTemporalInfo, getTargetSession, formatTimeInClubTz, formatInClubTz } from '../utils/sessionWindow';
import { computeMemberStats } from '../utils/stats';
import { SecureAvatar } from './common/SecureAvatar';

interface MemberHomeViewProps {
  member: Member;
  sessions: Session[];
  checkIns: CheckInRecord[];
  notifications?: ClubNotification[];
  onOpenScanner: () => void;
  onViewPass: () => void;
  onOpenEditProfile?: () => void;
  onOpenNotifications?: () => void;
}

export const MemberHomeView: React.FC<MemberHomeViewProps> = ({
  member,
  sessions,
  checkIns,
  notifications = [],
  onOpenScanner,
  onViewPass,
  onOpenEditProfile,
  onOpenNotifications,
}) => {
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Compute live unforgeable stats from authoritative records
  const stats = computeMemberStats(member, sessions, checkIns, currentTime);

  // Determine target session using exact time-based logic (Open Now > Upcoming > Recent)
  const targetSession = getTargetSession(sessions, currentTime) || sessions[0];
  const temporalInfo = targetSession ? getSessionTemporalInfo(targetSession, currentTime) : null;

  // Member's personal check-ins
  const memberCheckIns = checkIns.filter((c) => c.memberId === member.id);
  const latestCheckIn = memberCheckIns[0];

  // Has member already checked into the target session?
  const isCheckedInToTarget = targetSession
    ? memberCheckIns.some((c) => c.sessionId === targetSession.id)
    : false;

  return (
    <div className="space-y-6">
      {/* Builder Profile Header Banner */}
      <div className="rounded-[28px] p-6 sm:p-8 bg-[#0c0e14]/85 border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.1)] grain-overlay relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#b5ff00]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 left-10 w-60 h-60 bg-orange-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-4 sm:gap-5">
            <button
              type="button"
              onClick={() => {
                if (onOpenEditProfile) {
                  onOpenEditProfile();
                } else if (onViewPass) {
                  onViewPass();
                }
              }}
              title="Click avatar to edit profile & photo"
              aria-label="Edit profile & avatar photo"
              className="relative group cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[#b5ff00] focus-visible:outline-none transition-transform active:scale-95 text-left"
            >
              <SecureAvatar
                src={member.avatarUrl}
                name={member.name}
                alt={member.name}
                shape="rounded"
                className="w-16 h-16 sm:w-20 sm:h-20 border-2 border-[#b5ff00]/40 group-hover:border-[#b5ff00] shadow-lg shadow-[#b5ff00]/10 transition-colors"
                fallbackClassName="font-display font-black text-2xl text-[#b5ff00]"
              />
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 rounded-full bg-[#b5ff00] border-2 border-[#141720] items-center justify-center shadow-[0_0_8px_rgba(181,255,0,0.8)]">
                <span className="h-1.5 w-1.5 rounded-full bg-black" />
              </span>
            </button>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-white font-display">
                  {member.name}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00] text-[11px] font-mono font-bold uppercase tracking-wider">
                  {member.role}
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                {member.handle}{member.email ? ` · ${member.email}` : ''}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {member.tracks.map((track) => (
                  <span
                    key={track}
                    className="px-2.5 py-0.5 rounded-full bg-zinc-950/80 border border-white/5 text-[10px] text-zinc-300 font-mono"
                  >
                    {track}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onOpenEditProfile && (
              <button
                onClick={onOpenEditProfile}
                className="btn-glossy-secondary px-4 py-2 rounded-full text-zinc-200 text-xs font-bold font-mono transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <User className="h-4 w-4 text-[#b5ff00]" />
                <span>Edit Profile</span>
              </button>
            )}

            <button
              onClick={onViewPass}
              className="btn-glossy-secondary px-5 py-2 rounded-full text-[#b5ff00] border-[#b5ff00]/40 text-xs font-bold font-mono transition-all cursor-pointer flex items-center gap-2"
            >
              <QrCode className="h-4 w-4 text-[#b5ff00]" />
              <span>Digital Builder Pass</span>
            </button>
          </div>
        </div>

        {/* Academic Profile Details Strip (if provided) */}
        {(member.university || member.studentId || member.department || member.major || member.semester || member.phone) && (
          <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center gap-3 text-xs text-zinc-400 font-mono">
            {member.university && (
              <span className="text-zinc-300">
                🏛️ {member.university}
              </span>
            )}
            {member.studentId && (
              <span className="text-zinc-300">
                🪪 ID: {member.studentId}
              </span>
            )}
            {member.department && (
              <span>· {member.department}</span>
            )}
            {member.major && (
              <span>({member.major})</span>
            )}
            {member.semester && (
              <span className="px-2 py-0.5 rounded-md bg-zinc-950 border border-white/5 neu-inset text-[10px] text-[#b5ff00]">
                {member.semester}
              </span>
            )}
            {member.phone && (
              <span className="text-zinc-500">· 📞 {member.phone}</span>
            )}
          </div>
        )}

        {/* Milestone Statistics Ribbon */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mt-6 pt-6 border-t border-white/10">
          <div className="p-3.5 rounded-2xl bg-[#0e1017]/80 border border-white/5 neu-inset">
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Total Check-Ins
            </p>
            <p className="text-xl sm:text-2xl font-black font-display text-white mt-0.5">
              {stats.total}
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-[#0e1017]/80 border border-white/5 neu-inset">
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 flex items-center gap-1">
              <Flame className="h-3 w-3 text-orange-400" />
              <span>Current Streak</span>
            </p>
            <p className="text-xl sm:text-2xl font-black font-display text-[#b5ff00] mt-0.5">
              {stats.streak} <span className="text-xs text-zinc-500 font-normal">sessions</span>
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-[#0e1017]/80 border border-white/5 neu-inset">
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Best Streak
            </p>
            <p className="text-xl sm:text-2xl font-black font-display text-zinc-200 mt-0.5">
              {stats.bestStreak} <span className="text-xs text-zinc-500 font-normal">sessions</span>
            </p>
          </div>
        </div>
      </div>

      {/* Unread Meeting Alerts Banner */}
      {notifications.some((n) => !n.read) && onOpenNotifications && (
        <div
          onClick={onOpenNotifications}
          className="rounded-2xl border border-[#b5ff00]/40 bg-[#b5ff00]/10 p-4 flex items-center justify-between gap-3 text-xs font-mono cursor-pointer hover:bg-[#b5ff00]/15 transition-all shadow-[0_0_20px_rgba(181,255,0,0.1)]"
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-[#b5ff00] text-black flex items-center justify-center shrink-0 font-bold">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <span className="font-bold text-white uppercase block">
                {notifications.filter((n) => !n.read).length} Unread Meeting Alert{notifications.filter((n) => !n.read).length > 1 ? 's' : ''}
              </span>
              <span className="text-zinc-400 text-[11px]">
                {notifications.find((n) => !n.read)?.title || 'Tap to view session details and RSVP'}
              </span>
            </div>
          </div>
          <span className="text-[#b5ff00] font-bold text-xs uppercase hover:underline shrink-0">
            View Alerts →
          </span>
        </div>
      )}

      {/* Target Meeting Action Section */}
      {targetSession ? (
        <div
          className={`rounded-[28px] p-6 sm:p-8 bg-[#0c0e14]/85 border shadow-[0_20px_60px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.1)] grain-overlay transition-all ${
            temporalInfo?.isOpenNow
              ? 'border-[#b5ff00]/40 shadow-[0_0_35px_rgba(181,255,0,0.15)] ring-1 ring-[#b5ff00]/30'
              : temporalInfo?.badgeVariant === 'upcoming_soon'
              ? 'border-amber-500/30'
              : 'border-white/10'
          }`}
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-3 flex-1">
              <div className="flex items-center gap-2.5">
                {temporalInfo?.badgeVariant === 'open_now' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#b5ff00]/20 border border-[#b5ff00]/50 text-[#b5ff00] text-xs font-bold uppercase tracking-wider font-mono shadow-[0_0_12px_rgba(181,255,0,0.25)]">
                    <span className="h-2 w-2 rounded-full bg-[#b5ff00] animate-ping" />
                    Open Now · Check-In Active
                  </span>
                ) : temporalInfo?.badgeVariant === 'upcoming_soon' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-400 text-xs font-bold uppercase tracking-wider font-mono shadow-[0_0_10px_rgba(245,158,11,0.2)]">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    {temporalInfo.label}
                  </span>
                ) : temporalInfo?.badgeVariant === 'upcoming' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-cyan-950/60 border border-cyan-500/30 text-cyan-400 text-xs font-bold uppercase tracking-wider font-mono shadow-[0_0_10px_rgba(6,182,212,0.15)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    {temporalInfo.label}
                  </span>
                ) : temporalInfo?.badgeVariant === 'cancelled' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-rose-950/60 border border-rose-500/30 text-rose-400 text-xs font-bold uppercase tracking-wider font-mono">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    Closed · Cancelled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-zinc-900/90 border border-zinc-700/60 text-zinc-400 text-xs font-bold uppercase tracking-wider font-mono">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                    Closed · Session Ended
                  </span>
                )}
                <span className="text-xs text-zinc-500 font-mono">
                  {targetSession.track}
                </span>
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-black text-white font-display">
                  {targetSession.title}
                </h2>
                {targetSession.description && (
                  <p className="text-xs text-zinc-400 mt-1 max-w-2xl line-clamp-2">
                    {targetSession.description}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-xs text-zinc-300 font-mono">
                <div className="flex items-center gap-1.5 bg-[#141720]/70 px-2.5 py-1 rounded-lg border border-white/5 neu-raised-sm">
                  <Calendar className="h-4 w-4 text-[#b5ff00]" />
                  <span>{targetSession.date}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-[#141720]/70 px-2.5 py-1 rounded-lg border border-white/5 neu-raised-sm">
                  <Clock className="h-4 w-4 text-[#b5ff00]" />
                  <span>
                    {targetSession.startTime} – {targetSession.endTime}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-[#141720]/70 px-2.5 py-1 rounded-lg border border-white/5 neu-raised-sm">
                  <MapPin className="h-4 w-4 text-[#b5ff00]" />
                  <span>{targetSession.location}</span>
                </div>
              </div>
            </div>

            {/* Check-In Action Button */}
            <div className="shrink-0 flex flex-col items-stretch sm:items-end justify-center gap-2">
              {isCheckedInToTarget ? (
                <div className="p-4 rounded-2xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-center sm:text-right neu-raised-sm">
                  <div className="inline-flex items-center gap-2 text-sm font-bold text-[#b5ff00]">
                    <CheckCircle2 className="h-5 w-5" />
                    <span>Attendance Recorded</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                    You are confirmed for this session!
                  </p>
                </div>
              ) : temporalInfo?.isOpenNow ? (
                <button
                  onClick={onOpenScanner}
                  className="btn-glossy-primary py-4 px-8 rounded-full text-black font-display font-black text-sm uppercase tracking-wider flex items-center justify-center gap-3 cursor-pointer group"
                >
                  <QrCode className="h-5 w-5 group-hover:scale-110 transition-transform text-black" />
                  <span>Scan Meeting QR Code</span>
                </button>
              ) : temporalInfo?.isUpcoming ? (
                <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/5 neu-inset text-center sm:text-right text-xs text-zinc-400 font-mono">
                  <span className="block text-zinc-300 font-semibold">
                    Check-in opens at {targetSession.startAt ? formatTimeInClubTz(targetSession.startAt) : targetSession.startTime || ''}
                  </span>
                  <span className="text-[11px] text-zinc-500">QR scanning will activate when session begins</span>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/5 neu-inset text-center sm:text-right text-xs text-zinc-500 font-mono">
                  <span>Session closed · Attendance concluded</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 rounded-3xl glass-panel text-center space-y-2">
          <Calendar className="h-8 w-8 text-zinc-600 mx-auto" />
          <h3 className="text-sm font-bold text-zinc-300">No Scheduled Sessions</h3>
          <p className="text-xs text-zinc-500">
            Check back soon or speak with club organizers for upcoming workshop schedules.
          </p>
        </div>
      )}

      {/* Personal Attendance History */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#b5ff00]" />
            <span>Your Attendance History ({memberCheckIns.length})</span>
          </h3>
          {latestCheckIn && (
            <span className="text-[11px] text-zinc-500 font-mono">
              Latest: {latestCheckIn.checkedInAt ? formatInClubTz(latestCheckIn.checkedInAt) : latestCheckIn.date || ''}
            </span>
          )}
        </div>

        {memberCheckIns.length === 0 ? (
          <div className="p-8 rounded-2xl bg-[#0e1017]/80 border border-white/5 neu-inset text-center">
            <p className="text-xs text-zinc-500">
              No check-in records yet. Scan the meeting QR code during today's workshop to record your first session!
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {memberCheckIns.slice(0, 10).map((record) => {
              const sess = sessions.find((s) => s.id === record.sessionId);
              const sessionTitle = sess?.title || record.sessionTitle || 'Workshop Session';
              const sessionDate = sess?.date || record.date || '';
              const recordTime = record.checkedInAt
                ? formatTimeInClubTz(record.checkedInAt)
                : record.timestamp
                ? formatTimeInClubTz(record.timestamp)
                : '';
              const trackInfo = sess?.track || record.track || '';

              return (
                <div
                  key={record.id}
                  className="p-4 rounded-2xl glass-panel-interactive flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="p-2.5 rounded-xl bg-[#141720] border border-[#b5ff00]/30 neu-raised-sm text-[#b5ff00] shrink-0">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white truncate font-display">
                        {sessionTitle}
                      </h4>
                      <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                        {sessionDate}{recordTime ? ` · ${recordTime}` : ''}{trackInfo ? ` · ${trackInfo}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    <span className="px-3 py-1 rounded-xl bg-zinc-950/80 border border-white/5 neu-inset text-[10px] font-mono text-zinc-300 uppercase">
                      {record.method.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
