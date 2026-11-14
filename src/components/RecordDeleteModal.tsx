import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Trash2,
  Archive,
  Calendar,
  Clock,
  MapPin,
  AlertCircle,
} from 'lucide-react';
import { Session, Member, CheckInRecord } from '../types';
import { ModalSheet } from './ModalSheet';

export type DeleteRecordType = 'session' | 'member' | 'checkin';

export interface DeleteRecordTarget {
  type: DeleteRecordType;
  id: string;
  session?: Session;
  member?: Member;
  checkIn?: CheckInRecord;
  relatedCheckInsCount?: number;
  isTargetSuperAdmin?: boolean;
  isTargetDelegatedAdmin?: boolean;
}

interface RecordDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: DeleteRecordTarget | null;
  onConfirmDelete: (
    target: DeleteRecordTarget,
    permanent: boolean,
    options?: { deleteAttendance?: boolean; reason?: string }
  ) => Promise<void>;
}

export const RecordDeleteModal: React.FC<RecordDeleteModalProps> = ({
  isOpen,
  onClose,
  target,
  onConfirmDelete,
}) => {
  const [deleteMode, setDeleteMode] = useState<'soft' | 'permanent'>('soft');
  const [confirmInput, setConfirmInput] = useState('');
  const [reason, setReason] = useState('');
  const [deleteAttendance, setDeleteAttendance] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && target) {
      setDeleteMode(target.type === 'checkin' ? 'permanent' : 'soft');
      setConfirmInput('');
      setReason('');
      setDeleteAttendance(false);
      setErrorMessage(null);
    }
  }, [isOpen, target]);

  if (!isOpen || !target) return null;

  const {
    type,
    session,
    member,
    checkIn,
    relatedCheckInsCount = 0,
    isTargetSuperAdmin = false,
    isTargetDelegatedAdmin = false,
  } = target;
  const isBlockedMemberAction = type === 'member' && isTargetSuperAdmin;
  const effectiveMode = type === 'checkin' ? 'permanent' : deleteMode;

  const getRecordTitle = () => {
    switch (type) {
      case 'session':
        return session?.title || 'Workshop Session';
      case 'member':
        return member?.name ? `${member.name} (${member.handle})` : 'Builder Profile';
      case 'checkin':
        return checkIn ? `Check-In Record: ${checkIn.memberName || checkIn.memberId}` : 'Attendance Record';
    }
  };

  const getRequiredConfirmationText = () => {
    switch (type) {
      case 'session':
        return session?.sessionCode || session?.title?.substring(0, 8).toUpperCase().replace(/\s+/g, '') || 'DELETE';
      case 'member':
        return member?.handle?.replace('@', '') || 'DELETE';
      case 'checkin':
        return 'DELETE';
    }
  };

  const requiredText = getRequiredConfirmationText();
  const isInputValidForPermanent = confirmInput.trim().toLowerCase() === requiredText.toLowerCase();
  const cleanReason = reason.trim();
  const isReasonValid = type !== 'checkin' || (cleanReason.length > 0 && cleanReason.length <= 300);

  const handleConfirm = async () => {
    if (type === 'checkin' && !cleanReason) {
      setErrorMessage('Please enter a reason for deleting this attendance check-in record.');
      return;
    }
    if (effectiveMode === 'permanent' && !isInputValidForPermanent) {
      setErrorMessage(`Please type "${requiredText}" to confirm permanent deletion.`);
      return;
    }

    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await onConfirmDelete(target, effectiveMode === 'permanent', {
        deleteAttendance,
        ...(type === 'checkin' ? { reason: cleanReason } : {}),
      });
      onClose();
    } catch (err: any) {
      console.error('Record deletion failed:', err);
      setErrorMessage(err?.message || 'Failed to complete deletion action. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title={type === 'session' ? 'Archive or Delete Session' : type === 'member' ? 'Remove Builder Profile' : 'Remove Attendance Check-In'}
      subtitle={getRecordTitle()}
      icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
      maxWidth="md"
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 sm:flex-initial px-4 py-2.5 text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl transition-colors cursor-pointer disabled:opacity-50 min-h-11"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={
              isDeleting ||
              isBlockedMemberAction ||
              !isReasonValid ||
              (effectiveMode === 'permanent' && !isInputValidForPermanent)
            }
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold font-display uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-md disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 min-h-11 ${
              effectiveMode === 'permanent'
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/30'
                : 'bg-[#b5ff00] hover:bg-[#c6ff24] text-black shadow-[#b5ff00]/20'
            }`}
          >
            {isDeleting ? (
              <span>Processing...</span>
            ) : type === 'checkin' ? (
              <>
                <Trash2 className="h-4 w-4" />
                <span>Delete Check-In</span>
              </>
            ) : effectiveMode === 'permanent' ? (
              <>
                <Trash2 className="h-4 w-4" />
                <span>Permanently Delete</span>
              </>
            ) : (
              <>
                <Archive className="h-4 w-4" />
                <span>
                  {type === 'session' ? 'Soft Delete & Archive' : 'Deactivate Profile'}
                </span>
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-xs font-sans">
        {/* Record Summary Box */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-zinc-400 uppercase text-xs">Target Record:</span>
            <span className="font-bold text-white truncate text-sm">{getRecordTitle()}</span>
          </div>

          {type === 'session' && session && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-zinc-400 font-mono text-xs pt-2 border-t border-zinc-800/80">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                <span>{session.date}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                <span>{session.startTime} – {session.endTime}</span>
              </div>
              <div className="col-span-full flex items-center gap-1.5 truncate">
                <MapPin className="h-3.5 w-3.5 text-[#b5ff00] shrink-0" />
                <span className="truncate">{session.location}</span>
              </div>
            </div>
          )}

          {type === 'checkin' && checkIn && (
            <div className="text-zinc-400 font-mono text-xs pt-1 space-y-1">
              <div>Member: <span className="text-zinc-200 font-semibold">{checkIn.memberName || checkIn.memberId}</span> {checkIn.memberHandle ? `(${checkIn.memberHandle})` : ''}</div>
              <div>Method: <span className="text-zinc-300">{checkIn.method}</span></div>
            </div>
          )}
        </div>

        {isBlockedMemberAction && (
          <div className="rounded-2xl border border-red-500/50 bg-red-950/50 p-3.5 space-y-1.5 text-red-200 text-xs">
            <div className="flex items-center gap-2 font-bold text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Super Administrator Protected</span>
            </div>
            <p className="leading-relaxed">
              The Super Administrator&apos;s roster profile and account cannot be deactivated or purged.
            </p>
          </div>
        )}

        {!isBlockedMemberAction && type === 'member' && isTargetDelegatedAdmin && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-950/40 p-3.5 space-y-1.5 text-amber-200 text-xs">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Delegated Administrator Notice</span>
            </div>
            <p className="leading-relaxed">
              This builder currently holds delegated administrator permissions (<span className="font-mono text-amber-300">admins/{member?.authUid || 'uid'}</span>).
              Deactivating their member profile revokes member check-in access and resets their linked user profile, while <span className="font-mono">admins/{'{uid}'}</span> admin access remains active until revoked separately in Administrators.
            </p>
          </div>
        )}

        {/* Mode Selector (Soft Archive vs Permanent Deletion) */}
        {type !== 'checkin' && (
          <div className="space-y-2">
            <label className="text-zinc-300 font-semibold block text-xs">
              Choose Action Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeleteMode('soft')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer min-h-11 ${
                  deleteMode === 'soft'
                    ? 'border-[#b5ff00]/60 bg-[#b5ff00]/10 text-white'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs">
                  <Archive className="h-4 w-4 text-[#b5ff00]" />
                  <span>{type === 'session' ? 'Soft Delete & Archive (Recommended)' : 'Deactivate Member'}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 leading-normal">
                  {type === 'session'
                    ? 'Cancels check-in, hides session from active list (deletedAt), and preserves check-ins & stats.'
                    : 'Disables check-in rights while preserving past attendance data.'}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setDeleteMode('permanent')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer min-h-11 ${
                  deleteMode === 'permanent'
                    ? 'border-red-500/80 bg-red-950/30 text-white'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs text-red-400">
                  <Trash2 className="h-4 w-4" />
                  <span>Permanent Purge</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 leading-normal">
                  {type === 'session'
                    ? `Irreversible! Deletes session, kiosk token, announcements, and ${relatedCheckInsCount} check-in(s).`
                    : 'Irreversible! Removes the record completely from Firestore.'}
                </p>
              </button>
            </div>
          </div>
        )}

        {/* Required Audit Reason for Check-In Deletion */}
        {type === 'checkin' && (
          <div className="rounded-2xl border border-amber-500/30 bg-zinc-950/80 p-3.5 space-y-2">
            <label htmlFor="checkin-delete-reason" className="text-xs text-zinc-200 font-semibold block">
              Reason for Deleting Check-In <span className="text-red-400">*</span>
            </label>
            <input
              id="checkin-delete-reason"
              type="text"
              required
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Accidental duplicate scan or builder did not stay"
              className="w-full bg-black border border-white/15 rounded-xl px-3 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] min-h-11 text-base sm:text-xs"
            />
            <p className="text-[11px] text-zinc-400 font-mono">
              Recorded permanently in the admin audit log alongside this check-in deletion.
            </p>
          </div>
        )}

        {/* Warning Callout */}
        {effectiveMode === 'permanent' && (
          <div className="rounded-2xl border border-red-500/40 bg-red-950/40 p-3.5 space-y-2 text-red-200 text-xs">
            <div className="flex items-center gap-2 font-bold text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Permanent Deletion Warning</span>
            </div>
            <p className="leading-relaxed text-zinc-300">
              {type === 'session'
                ? `Permanently deleting this session will cascade-delete the session document, its rotating kiosk token (sessionTokens), related announcements, and all ${relatedCheckInsCount} associated check-in record(s) in atomic batches. This action cannot be undone.`
                : type === 'member'
                ? `Permanently deleting ${member?.name || 'this builder'} immediately frees their handle (${member?.handle || ''}) and student ID for reuse. Their user login is reset to allow re-applying.`
                : 'Deleting this check-in removes the attendance record and logs the reason atomically in auditLogs.'}
            </p>

            {type === 'member' && (
              <div className="pt-2 border-t border-red-500/20">
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-black/40 border border-red-500/30 text-xs text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deleteAttendance}
                    onChange={(e) => setDeleteAttendance(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-700 text-red-500 focus:ring-0 cursor-pointer"
                  />
                  <div>
                    <span className="font-semibold text-white">
                      Also purge past attendance records {relatedCheckInsCount > 0 ? `(${relatedCheckInsCount} check-ins)` : ''}
                    </span>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-normal">
                      Default is unchecked (keeps past workshop history and session counts safe).
                    </p>
                  </div>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Permanent Deletion Guard Input */}
        {effectiveMode === 'permanent' && (
          <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-3.5 space-y-2">
            <label className="text-xs text-zinc-300 font-semibold block">
              To confirm permanent deletion, type{' '}
              <span className="font-mono text-red-400 font-bold select-all bg-black/60 px-1.5 py-0.5 rounded">
                {requiredText}
              </span>{' '}
              below:
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={`Type "${requiredText}"`}
              autoCapitalize="characters"
              autoComplete="off"
              className="w-full bg-zinc-950 border border-red-500/40 rounded-xl px-3 py-2.5 font-mono text-white focus:outline-none focus:border-red-400 min-h-11 text-base sm:text-xs"
            />
          </div>
        )}

        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-950/80 border border-red-800 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    </ModalSheet>
  );
};
