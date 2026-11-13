import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Crown,
  Lock,
  AlertTriangle,
  History,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { Member, UserProfile, BuilderRole, AuditLog } from '../types';
import {
  grantAdminRole,
  revokeAdminRole,
  checkIsAdmin,
  subscribeToAuditLogs,
  createAuditLog,
  SUPER_ADMIN_EMAIL,
} from '../firebase/firestoreService';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../firebase/AuthContext';
import { ModalSheet } from './ModalSheet';
import { toJsDate } from '../utils/sessionWindow';

interface RoleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: Member;
  linkedUser?: UserProfile | null;
  onRoleUpdated?: (updatedMember: Member) => void;
}

const CLUB_ROLES: { role: BuilderRole; label: string; desc: string }[] = [
  { role: 'President', label: 'President', desc: 'Guild Executive Head & Lead Organizer' },
  { role: 'Vice President', label: 'Vice President', desc: 'Executive Officer & Operations Lead' },
  { role: 'Project Leader', label: 'Project Leader', desc: 'Hardware/Software Sprint Track Coordinator' },
  { role: 'Member', label: 'Member', desc: 'Active Workshop Builder & Craftsman' },
];

export const RoleManagementModal: React.FC<RoleManagementModalProps> = ({
  isOpen,
  onClose,
  member,
  linkedUser,
  onRoleUpdated,
}) => {
  const { user } = useAuth();
  const isSuperAdmin = Boolean(
    user?.email &&
    user.emailVerified &&
    user.email.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim()
  );

  const [selectedClubRole, setSelectedClubRole] = useState<BuilderRole>(member.role);
  const [isAdminPermission, setIsAdminPermission] = useState<boolean>(false);

  const [savingClubRole, setSavingClubRole] = useState(false);
  const [togglingAdmin, setTogglingAdmin] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    setSelectedClubRole(member.role);
    if (linkedUser?.id) {
      checkIsAdmin(linkedUser.id, linkedUser.email).then(setIsAdminPermission);
    }
  }, [member, linkedUser]);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = subscribeToAuditLogs((logs) => {
      const relevant = logs.filter(
        (l) => l.details.includes(member.id) || (linkedUser && l.details.includes(linkedUser.id))
      );
      setAuditLogs(relevant.slice(0, 10));
    });
    return () => unsub();
  }, [isOpen, member.id, linkedUser]);

  const handleSaveClubRole = async () => {
    setSavingClubRole(true);
    setMessage(null);
    try {
      await updateDoc(doc(db, 'members', member.id), { role: selectedClubRole });
      await createAuditLog('update_member', `Changed guild role for "${member.name}" (${member.id}) to ${selectedClubRole}`);
      setMessage({ type: 'success', text: `Club role updated to ${selectedClubRole}!` });
      if (onRoleUpdated) {
        onRoleUpdated({ ...member, role: selectedClubRole });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to update club role.' });
    } finally {
      setSavingClubRole(false);
    }
  };

  const handleToggleAdminPermission = async () => {
    if (!linkedUser) {
      setMessage({ type: 'error', text: 'This member has no linked Google account yet.' });
      return;
    }
    if (!isSuperAdmin) {
      setMessage({
        type: 'error',
        text: `Only the designated Super Administrator (${SUPER_ADMIN_EMAIL}) can grant or revoke application admin access.`,
      });
      return;
    }

    const action = isAdminPermission ? 'revoke' : 'grant';
    const actionLabel = isAdminPermission ? 'Revoke admin access' : 'Grant admin access';
    if (!window.confirm(`${actionLabel} for "${linkedUser.displayName || linkedUser.email}"?\n\nAuth UID: ${linkedUser.id}\nEmail: ${linkedUser.email}`)) {
      return;
    }

    setTogglingAdmin(true);
    setMessage(null);
    try {
      if (isAdminPermission) {
        await revokeAdminRole(linkedUser.id, linkedUser.email);
        setIsAdminPermission(false);
        setMessage({ type: 'success', text: `Revoked admin privileges from ${linkedUser.email}.` });
      } else {
        await grantAdminRole(linkedUser.id, linkedUser.email);
        setIsAdminPermission(true);
        setMessage({ type: 'success', text: `Granted admin privileges to ${linkedUser.email}.` });
      }
    } catch (err: any) {
      const code = err?.code ? `[${err.code}] ` : '';
      setMessage({ type: 'error', text: `${code}${err?.message || 'Failed to update admin permissions.'}` });
    } finally {
      setTogglingAdmin(false);
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Role & Permissions Management"
      subtitle={`Manage authority and guild status for ${member.name}`}
      icon={<ShieldCheck className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-11"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-xs font-sans">
        {message && (
          <div
            className={`p-3 rounded-xl flex items-center gap-2 ${
              message.type === 'success'
                ? 'bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00]'
                : 'bg-red-950/60 border border-red-800 text-red-300'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#b5ff00]" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {/* Member Card Summary */}
        <div className="p-3.5 rounded-2xl bg-[#0d0f15] border border-white/10 neu-inset flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#141720] border border-white/10 neu-raised-sm flex items-center justify-center font-display font-black text-sm text-[#b5ff00]">
              {member.name.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{member.name}</h3>
              <p className="text-xs text-zinc-400 font-mono">
                {member.handle}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="px-3 py-1 rounded-full bg-[#b5ff00]/15 border border-[#b5ff00]/40 text-[#b5ff00] text-xs font-mono font-bold uppercase neu-raised-sm">
              {member.role}
            </span>
          </div>
        </div>

        {/* Section 1: Club Leadership Roles */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-1.5">
              <Crown className="h-3.5 w-3.5 text-[#b5ff00]" />
              <span>1. Club Leadership Role</span>
            </label>
            <span className="text-xs text-zinc-400 font-mono">Any Admin Authorized</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CLUB_ROLES.map(({ role, label, desc }) => {
              const selected = selectedClubRole === role;
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSelectedClubRole(role)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer min-h-11 ${
                    selected
                      ? 'bg-[#b5ff00]/15 border-[#b5ff00]/60 text-white neu-raised-sm ring-1 ring-[#b5ff00]/40'
                      : 'bg-[#141720] border-white/5 neu-button text-zinc-300 hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">{label}</span>
                    {selected && <span className="text-[#b5ff00] text-xs font-bold">✓</span>}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 leading-normal">{desc}</p>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSaveClubRole}
            disabled={savingClubRole || selectedClubRole === member.role}
            className="w-full py-3 px-4 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] disabled:opacity-40 text-black font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 min-h-11"
          >
            {savingClubRole ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-black" />
                <span>Updating Club Role...</span>
              </>
            ) : (
              <span>Save Club Role</span>
            )}
          </button>
        </div>

        {/* Section 2: Application Administrator Permissions (Super-Admin Enforced) */}
        <div className="space-y-3 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-amber-400" />
              <span>2. Application Admin Privileges</span>
            </label>
            <span className="text-xs font-mono text-amber-400">Super-Admin Protected</span>
          </div>

          {!linkedUser ? (
            <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-600/40 text-xs text-amber-200 flex items-start gap-2.5 neu-inset">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-amber-300 block">No Active Google Auth Account Linked</span>
                <span className="text-amber-200/80 leading-normal block">
                  This member roster entry is not linked to an active user ID. Admin permissions require an authoritative Firebase Auth UID in <code className="px-1 py-0.5 bg-black/60 rounded font-mono text-[10px]">admins/{'{uid}'}</code>. The builder must first sign in with Google and have their account linked before portal admin privileges can be granted.
                </span>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2 rounded-xl bg-black/40 border border-white/5 text-[11px] font-mono text-zinc-400 space-y-1">
              <div className="flex items-center justify-between">
                <span>Target Auth UID:</span>
                <span className="text-white font-bold select-all">{linkedUser.id}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Target Email:</span>
                <span className="text-zinc-200 select-all">{linkedUser.email}</span>
              </div>
            </div>
          )}

          <div className="p-3.5 rounded-2xl bg-[#0d0f15] border border-white/10 neu-inset flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="font-bold text-white text-xs">
                Portal Admin Access:{' '}
                <span className={isAdminPermission ? 'text-[#b5ff00]' : 'text-zinc-400'}>
                  {isAdminPermission ? 'Active Administrator' : 'Standard Member'}
                </span>
              </p>
              <p className="text-xs text-zinc-400 mt-0.5 leading-normal">
                Allows managing workshop sessions, launching the Kiosk screen, and approving applicant requests.
              </p>
            </div>

            {isSuperAdmin ? (
              <button
                type="button"
                onClick={handleToggleAdminPermission}
                disabled={togglingAdmin || !linkedUser}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer whitespace-nowrap min-h-11 ${
                  isAdminPermission
                    ? 'bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-300'
                    : 'bg-[#b5ff00] hover:bg-[#c6ff24] text-black font-bold'
                } ${!linkedUser ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {togglingAdmin ? 'Updating...' : isAdminPermission ? 'Revoke Admin' : 'Grant Admin'}
              </button>
            ) : (
              <div className="px-2.5 py-1.5 rounded-xl bg-black/60 border border-white/5 text-zinc-400 text-xs font-mono flex items-center gap-1 neu-inset self-start sm:self-auto">
                <Lock className="h-3.5 w-3.5 text-zinc-500" />
                <span>Super-Admin Only</span>
              </div>
            )}
          </div>

          {!isSuperAdmin && (
            <p className="text-xs text-zinc-400 font-mono leading-normal">
              Only the designated Super Administrator can grant or revoke application admin permissions.
            </p>
          )}
        </div>

        {/* Section 3: Audit Trail Log */}
        {auditLogs.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-zinc-800">
            <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-xs">
              <History className="h-3.5 w-3.5 text-[#b5ff00]" />
              <span>Security Audit History</span>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-850 text-xs font-mono text-zinc-400 flex items-start justify-between gap-2"
                >
                  <div>
                    <p className="text-zinc-200">{log.details}</p>
                    <p className="text-zinc-500 mt-0.5">By: {log.performedByEmail}</p>
                  </div>
                  <span className="text-zinc-500 shrink-0">
                    {toJsDate(log.timestamp).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalSheet>
  );
};
