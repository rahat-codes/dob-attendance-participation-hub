import React, { useEffect } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Calendar,
  Clock,
  MapPin,
  Flame,
  QrCode,
  Sparkles,
} from 'lucide-react';
import { m } from 'motion/react';
import { Member, Session, CheckInRecord } from '../types';
import { playCheckInChime } from '../utils/qrUtils';
import { ModalSheet } from './ModalSheet';
import { ease, spring } from '../motion/presets';
import { useMotionSafe } from '../motion/useMotionSafe';

export interface AttendanceConfirmationData {
  member: Member;
  session: Session;
  record?: CheckInRecord;
  isDuplicate?: boolean;
  message?: string;
  isOwnDevice?: boolean;
}

interface AttendanceConfirmationModalProps {
  data: AttendanceConfirmationData | null;
  onClose: () => void;
  onViewPass?: (member: Member) => void;
}

export const AttendanceConfirmationModal: React.FC<AttendanceConfirmationModalProps> = ({
  data,
  onClose,
  onViewPass,
}) => {
  const { reduced } = useMotionSafe();

  useEffect(() => {
    if (!data) return;

    if (data.isDuplicate) {
      playCheckInChime('warning');
    } else {
      playCheckInChime('success');
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([120, 60, 120]);
        } catch {
          // ignore haptic error
        }
      }
    }
  }, [data]);

  if (!data) return null;

  const { member, session, record, isDuplicate } = data;
  const isSelf = data.isOwnDevice !== false;
  const isLate = record?.status === 'late';

  return (
    <ModalSheet
      isOpen={!!data}
      onClose={onClose}
      title={isDuplicate ? 'Attendance Logged' : isLate ? 'Attendance Logged (Late)' : 'Attendance Confirmed'}
      subtitle={session.title}
      icon={
        isDuplicate ? (
          <AlertCircle className="w-5 h-5 text-amber-400" />
        ) : isLate ? (
          <Clock className="w-5 h-5 text-amber-400" />
        ) : (
          <CheckCircle2 className="w-5 h-5 text-[#b5ff00]" />
        )
      }
      maxWidth="lg"
      footer={
        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full">
          {onViewPass && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onViewPass(member);
              }}
              className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-[#141720] hover:bg-[#191c27] border border-white/10 text-zinc-200 text-xs font-bold font-display uppercase tracking-wider flex items-center justify-center gap-2 transition-all neu-button cursor-pointer min-h-11"
            >
              <QrCode className="h-4 w-4 text-[#b5ff00]" />
              <span>View My Digital Pass</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] text-black text-xs font-bold font-display uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-[0_0_20px_rgba(181,255,0,0.4)] active:scale-98 min-h-11"
          >
            <CheckCircle2 className="h-4 w-4 text-black" />
            <span>Done / Keep Exploring</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-center py-2">
        {/* Celebration Badge with Spring Pop and Path Draw */}
        <div className="flex flex-col items-center space-y-2">
          <div className="relative">
            <m.div
              initial={reduced ? { opacity: 0 } : { scale: 0.8, opacity: 0 }}
              animate={reduced ? { opacity: 1 } : { scale: 1, opacity: 1 }}
              transition={spring.pop}
              className={`h-16 w-16 sm:h-20 sm:w-20 rounded-full flex items-center justify-center border-2 ${
                isDuplicate
                  ? 'border-amber-400/60 bg-amber-400/10 text-amber-400'
                  : isLate
                  ? 'border-amber-400/80 bg-amber-400/15 text-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.3)]'
                  : 'border-[#b5ff00] bg-[#b5ff00]/15 text-[#b5ff00] shadow-[0_0_35px_rgba(181,255,0,0.4)]'
              }`}
            >
              {isDuplicate ? (
                <AlertCircle className="h-8 w-8 sm:h-10 sm:w-10" />
              ) : isLate ? (
                <Clock className="h-8 w-8 sm:h-10 sm:w-10" />
              ) : (
                <svg
                  className="h-8 w-8 sm:h-10 sm:w-10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <m.path
                    d="M20 6L9 17L4 12"
                    initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.35, ease: ease.out }}
                  />
                </svg>
              )}
            </m.div>
            {!isDuplicate && (
              <span className="absolute -bottom-1 -right-1 bg-black rounded-full p-1 border border-[#b5ff00]/60">
                <Sparkles className="h-3.5 w-3.5 text-[#b5ff00]" />
              </span>
            )}
          </div>

          <div className="space-y-1" role="status" aria-live="polite">
            <h3 className="text-lg sm:text-xl font-black font-display uppercase tracking-tight text-white leading-tight">
              {isDuplicate ? (
                isSelf ? (
                  'You are already marked as an attendee!'
                ) : (
                  `${member.name} is already marked as an attendee!`
                )
              ) : isLate ? (
                isSelf ? (
                  <span>
                    You have been marked as <span className="text-amber-400">late attendee</span>!
                  </span>
                ) : (
                  <span>
                    {member.name} has been marked as <span className="text-amber-400">late attendee</span>!
                  </span>
                )
              ) : isSelf ? (
                <span>
                  You have been marked as <span className="text-[#b5ff00]">attendee</span>!
                </span>
              ) : (
                <span>
                  {member.name} has been marked as <span className="text-[#b5ff00]">attendee</span>!
                </span>
              )}
            </h3>

            <p className="text-xs text-zinc-400 max-w-sm mx-auto">
              {isDuplicate
                ? 'Your attendance for this workshop is already registered in the Den of Builders club ledger.'
                : 'Welcome! Your check-in was successfully recorded and synced with the live guild ledger.'}
            </p>
          </div>
        </div>

        {/* Session Card Info */}
        <div className="rounded-2xl bg-[#0d0f15]/90 border border-white/10 neu-inset p-4 text-left space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase text-zinc-400 font-semibold tracking-wider">
              Workshop Session
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-bold uppercase">
              {session.track}
            </span>
          </div>

          <div>
            <h4 className="text-sm sm:text-base font-bold font-display uppercase tracking-tight text-white">{session.title}</h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-400 font-mono pt-2 border-t border-white/5">
            <div className="flex items-center gap-1.5 truncate">
              <Calendar className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span>{session.date}</span>
            </div>
            <div className="flex items-center gap-1.5 truncate">
              <Clock className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span>{session.startTime} – {session.endTime}</span>
            </div>
            <div className="sm:col-span-2 flex items-center gap-1.5 truncate text-zinc-300">
              <MapPin className="h-3.5 w-3.5 text-[#b5ff00] shrink-0" />
              <span className="truncate">{session.location}</span>
            </div>
          </div>
        </div>

        {/* Attendee Profile & Stats Card */}
        <div className="rounded-2xl bg-[#0d0f15]/90 border border-white/10 neu-inset p-4 flex items-center justify-between gap-3 text-left">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-[#141720] border border-[#b5ff00]/40 flex items-center justify-center font-bold font-display text-base text-[#b5ff00] shrink-0 neu-raised-sm">
              {member.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold font-display text-sm text-white truncate">
                  {member.name}
                </span>
                <span className="text-xs font-mono text-[#b5ff00] uppercase font-semibold">
                  {member.role}
                </span>
              </div>
              <div className="text-xs text-zinc-400 font-mono truncate">{member.handle}</div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0 font-mono">
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#141720] border border-white/10 text-xs neu-raised-sm">
              <Flame className="h-3.5 w-3.5 text-[#b5ff00]" />
              <span className="font-bold text-[#b5ff00]">{member.currentStreak || 0}d</span>
              <span className="text-zinc-400 text-xs">streak</span>
            </div>
            <div className="text-xs text-zinc-400">
              <span className="font-bold text-zinc-200">{member.totalCheckIns || 0}</span> sessions
            </div>
          </div>
        </div>
      </div>
    </ModalSheet>
  );
};
