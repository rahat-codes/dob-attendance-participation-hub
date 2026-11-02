import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  LogOut,
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  UserPlus,
  Trash2,
  Database,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../firebase/AuthContext';
import { ModalSheet } from './ModalSheet';
import { UserProfile, AdminDoc } from '../types';
import {
  subscribeToAdmins,
  subscribeToUsers,
  grantAdminRole,
  revokeAdminRole,
  checkRequestPipeline,
  RequestPipelineCheckResult,
  SUPER_ADMIN_EMAIL,
} from '../firebase/firestoreService';
import firebaseConfig from '../../firebase-applet-config.json';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenManageAdmins?: () => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onOpenManageAdmins,
}) => {
  const { user, linkedMember, isAdmin, isSuperAdmin, signOutUser, handleSignIn, signingIn } = useAuth();

  // Diagnostics State
  const [pipelineResult, setPipelineResult] = useState<RequestPipelineCheckResult | null>(null);
  const [runningPipelineCheck, setRunningPipelineCheck] = useState(false);

  // Super Admin Management State
  const [adminsList, setAdminsList] = useState<{ uid: string; data: AdminDoc }[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [adminsError, setAdminsError] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [processingUid, setProcessingUid] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Subscribe to Admins and Users when Super Admin has modal open
  useEffect(() => {
    if (!isOpen || !isSuperAdmin) return;

    const unsubAdmins = subscribeToAdmins(
      (list) => {
        setAdminsList(list);
        setAdminsError(null);
      },
      (err: any) => {
        const code = err?.code ? `[${err.code}] ` : '';
        setAdminsError(`Admins sync error: ${code}${err?.message || 'Access denied'}`);
      }
    );

    const unsubUsers = subscribeToUsers(
      (list) => {
        setAllUsers(list);
        setUsersError(null);
      },
      (err: any) => {
        const code = err?.code ? `[${err.code}] ` : '';
        setUsersError(`Users sync error: ${code}${err?.message || 'Access denied'}`);
      }
    );

    return () => {
      unsubAdmins();
      unsubUsers();
    };
  }, [isOpen, isSuperAdmin]);

  const handleRunPipelineCheck = async () => {
    if (!user) return;
    setRunningPipelineCheck(true);
    try {
      const res = await checkRequestPipeline(user.uid);
      setPipelineResult(res);
    } catch (err: any) {
      console.error('Pipeline check unexpected error:', err);
    } finally {
      setRunningPipelineCheck(false);
    }
  };

  const handleGrantAdmin = async (targetUser: UserProfile) => {
    if (!window.confirm(`Grant application administrator privileges to "${targetUser.displayName || targetUser.email}"?\n\nAuth UID: ${targetUser.id}\nEmail: ${targetUser.email}`)) {
      return;
    }
    setProcessingUid(targetUser.id);
    setActionMessage(null);
    try {
      await grantAdminRole(targetUser.id, targetUser.email);
      setActionMessage({
        type: 'success',
        text: `Successfully granted administrator privileges to ${targetUser.email}.`,
      });
    } catch (err: any) {
      const code = err?.code ? `[${err.code}] ` : '';
      setActionMessage({
        type: 'error',
        text: `Failed to grant admin: ${code}${err?.message || 'Permission denied'}`,
      });
    } finally {
      setProcessingUid(null);
    }
  };

  const handleRevokeAdmin = async (adminUid: string, adminEmail: string) => {
    if (adminEmail.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim()) {
      alert('The designated Super Administrator cannot be revoked.');
      return;
    }
    if (!window.confirm(`Revoke application administrator privileges from "${adminEmail}"?\n\nAuth UID: ${adminUid}`)) {
      return;
    }
    setProcessingUid(adminUid);
    setActionMessage(null);
    try {
      await revokeAdminRole(adminUid, adminEmail);
      setActionMessage({
        type: 'success',
        text: `Successfully revoked administrator privileges from ${adminEmail}.`,
      });
    } catch (err: any) {
      const code = err?.code ? `[${err.code}] ` : '';
      setActionMessage({
        type: 'error',
        text: `Failed to revoke admin: ${code}${err?.message || 'Permission denied'}`,
      });
    } finally {
      setProcessingUid(null);
    }
  };

  const filteredUsers = allUsers.filter((u) => {
    if (!userSearchQuery.trim()) return true;
    const q = userSearchQuery.toLowerCase();
    return (
      u.displayName?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.id?.toLowerCase().includes(q)
    );
  });

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Account & Access"
      subtitle="Verified identity, permissions, and club authority tier"
      icon={<ShieldCheck className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth={isSuperAdmin ? 'lg' : 'md'}
    >
      {user ? (
        <div className="space-y-4 text-xs font-sans">
          {/* Identity & Status Card */}
          <div className="p-4 rounded-2xl bg-[#0e1017]/80 border border-white/5 neu-inset space-y-2.5 font-mono">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Signed in as:</span>
              <span className="text-white font-bold truncate max-w-[220px]">{user.displayName || user.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Email:</span>
              <span className="text-zinc-300 truncate max-w-[220px]">{user.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Status Tier:</span>
              <span
                className={`font-bold uppercase px-2 py-0.5 rounded text-[11px] ${
                  isSuperAdmin
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : isAdmin
                    ? 'bg-[#b5ff00]/15 text-[#b5ff00] border border-[#b5ff00]/40'
                    : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                }`}
              >
                {isSuperAdmin ? 'Super Administrator' : isAdmin ? 'Administrator' : 'Club Member'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Auth UID:</span>
              <span className="text-zinc-200 select-all text-[11px] font-bold truncate max-w-[220px]" title={user.uid}>
                {user.uid}
              </span>
            </div>

            {/* Firestore Project & Database ID */}
            <div className="pt-2 border-t border-white/5 space-y-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 flex items-center gap-1">
                  <Database className="w-3 h-3 text-zinc-400" />
                  Firebase Project:
                </span>
                <span className="text-zinc-300 font-bold select-all">{firebaseConfig.projectId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 flex items-center gap-1">
                  <Database className="w-3 h-3 text-zinc-400" />
                  Firestore DB ID:
                </span>
                <span className="text-zinc-300 font-bold select-all truncate max-w-[220px]" title={firebaseConfig.firestoreDatabaseId}>
                  {firebaseConfig.firestoreDatabaseId}
                </span>
              </div>
            </div>

            {linkedMember && (
              <div className="flex items-center justify-between pt-1 border-t border-white/5">
                <span className="text-zinc-400">Roster Identity:</span>
                <span className="text-[#b5ff00] font-bold">{linkedMember.name} ({linkedMember.handle})</span>
              </div>
            )}
          </div>

          {/* Admin Diagnostics Pipeline Check (Admins only) */}
          {isAdmin && (
            <div className="p-3.5 rounded-2xl bg-[#0c0e14] border border-white/10 neu-raised-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#b5ff00]" />
                  <span className="font-bold text-white text-xs font-mono uppercase tracking-wider">
                    Request Pipeline Check
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRunPipelineCheck}
                  disabled={runningPipelineCheck}
                  className="px-3 py-1.5 rounded-lg bg-[#b5ff00] hover:bg-[#c2ff26] text-black font-bold font-mono text-[11px] uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${runningPipelineCheck ? 'animate-spin' : ''}`} />
                  <span>{runningPipelineCheck ? 'Checking...' : 'Run Pipeline Check'}</span>
                </button>
              </div>

              {pipelineResult && (
                <div className="space-y-2 pt-2 border-t border-white/5 font-mono text-[11px]">
                  {/* Item a: can read users collection */}
                  <div className="flex items-start justify-between p-2 rounded-xl bg-black/40 border border-white/5">
                    <div>
                      <span className="text-zinc-300 font-semibold block">Users Collection Read Permission</span>
                      {pipelineResult.canReadUsers.error && (
                        <span className="text-red-400 text-[10px] block mt-0.5">
                          {pipelineResult.canReadUsers.errorCode ? `[${pipelineResult.canReadUsers.errorCode}] ` : ''}
                          {pipelineResult.canReadUsers.error}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 flex items-center gap-1 font-bold">
                      {pipelineResult.canReadUsers.pass ? (
                        <span className="text-[#b5ff00] flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" /> FAIL
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Item b: count of users by status */}
                  <div className="p-2 rounded-xl bg-black/40 border border-white/5 space-y-1">
                    <span className="text-zinc-300 font-semibold block">Users Count by Status:</span>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 text-[10px] text-zinc-400 pt-0.5">
                      <div className="p-1 rounded bg-zinc-900 border border-white/5">
                        <span className="text-amber-400 font-bold block">{pipelineResult.userCounts.pending}</span>
                        <span>pending</span>
                      </div>
                      <div className="p-1 rounded bg-zinc-900 border border-white/5">
                        <span className="text-cyan-400 font-bold block">{pipelineResult.userCounts.approved_waiting_response}</span>
                        <span>waiting</span>
                      </div>
                      <div className="p-1 rounded bg-zinc-900 border border-white/5">
                        <span className="text-[#b5ff00] font-bold block">{pipelineResult.userCounts.active}</span>
                        <span>active</span>
                      </div>
                      <div className="p-1 rounded bg-zinc-900 border border-white/5">
                        <span className="text-zinc-400 font-bold block">{pipelineResult.userCounts.declined}</span>
                        <span>declined</span>
                      </div>
                      <div className="p-1 rounded bg-zinc-900 border border-white/5">
                        <span className="text-red-400 font-bold block">{pipelineResult.userCounts.suspended}</span>
                        <span>suspended</span>
                      </div>
                    </div>
                  </div>

                  {/* Item c: admins/{myUid} exists */}
                  <div className="flex items-start justify-between p-2 rounded-xl bg-black/40 border border-white/5">
                    <div>
                      <span className="text-zinc-300 font-semibold block">admins/{'{myUid}'} Record</span>
                      <span className="text-zinc-500 text-[10px] block">
                        Exists: {pipelineResult.adminDocExists.exists ? 'Yes (Portal Admin)' : 'No (Super Admin or Standard Member)'}
                      </span>
                      {pipelineResult.adminDocExists.error && (
                        <span className="text-red-400 text-[10px] block mt-0.5">
                          {pipelineResult.adminDocExists.errorCode ? `[${pipelineResult.adminDocExists.errorCode}] ` : ''}
                          {pipelineResult.adminDocExists.error}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 flex items-center gap-1 font-bold">
                      {pipelineResult.adminDocExists.pass ? (
                        <span className="text-[#b5ff00] flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" /> FAIL
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Item d: can read members and sessions */}
                  <div className="flex items-start justify-between p-2 rounded-xl bg-black/40 border border-white/5">
                    <div>
                      <span className="text-zinc-300 font-semibold block">Members &amp; Sessions Read Permissions</span>
                      {pipelineResult.canReadMembersAndSessions.membersError && (
                        <span className="text-red-400 text-[10px] block mt-0.5">
                          Members: {pipelineResult.canReadMembersAndSessions.membersErrorCode ? `[${pipelineResult.canReadMembersAndSessions.membersErrorCode}] ` : ''}
                          {pipelineResult.canReadMembersAndSessions.membersError}
                        </span>
                      )}
                      {pipelineResult.canReadMembersAndSessions.sessionsError && (
                        <span className="text-red-400 text-[10px] block mt-0.5">
                          Sessions: {pipelineResult.canReadMembersAndSessions.sessionsErrorCode ? `[${pipelineResult.canReadMembersAndSessions.sessionsErrorCode}] ` : ''}
                          {pipelineResult.canReadMembersAndSessions.sessionsError}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 flex items-center gap-1 font-bold">
                      {pipelineResult.canReadMembersAndSessions.pass ? (
                        <span className="text-[#b5ff00] flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" /> FAIL
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Feedback Messages */}
          {actionMessage && (
            <div
              className={`p-3 rounded-xl flex items-center gap-2 text-xs font-mono ${
                actionMessage.type === 'success'
                  ? 'bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00]'
                  : 'bg-red-950/60 border border-red-800 text-red-300'
              }`}
            >
              {actionMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#b5ff00]" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              )}
              <span>{actionMessage.text}</span>
            </div>
          )}

          {/* Super Admin Section: Full Administrator Management by Signed-In User */}
          {isSuperAdmin && (
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-400" />
                  <span className="font-bold text-white text-sm font-display uppercase tracking-wider">
                    Administrators Management
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-md font-bold uppercase">
                  Super Admin Only
                </span>
              </div>

              {/* Error Banners */}
              {adminsError && (
                <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-[11px] font-mono">
                  {adminsError}
                </div>
              )}
              {usersError && (
                <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-[11px] font-mono">
                  {usersError}
                </div>
              )}

              {/* 1. Current Admins List */}
              <div className="space-y-2">
                <span className="text-zinc-300 font-bold uppercase tracking-wider font-mono text-[11px] block">
                  Current Portal Administrators ({adminsList.length + 1})
                </span>

                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {/* Super Admin Entry (Cannot be revoked) */}
                  <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-500/30 flex items-center justify-between gap-2 font-mono text-[11px]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold">{SUPER_ADMIN_EMAIL}</span>
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold uppercase">
                          Permanent Super Admin
                        </span>
                      </div>
                      <span className="text-zinc-500 text-[10px]">Root authority owner</span>
                    </div>
                    <span className="text-zinc-500 text-[10px] italic">Non-revocable</span>
                  </div>

                  {/* Delegated Admins from admins collection */}
                  {adminsList.map((a) => (
                    <div
                      key={a.uid}
                      className="p-2.5 rounded-xl bg-zinc-950 border border-white/5 flex items-center justify-between gap-2 font-mono text-[11px]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-white font-bold truncate">{a.data.email}</span>
                          <span className="text-[10px] text-zinc-500 shrink-0 select-all" title={a.uid}>
                            ({a.uid.slice(0, 6)}...{a.uid.slice(-4)})
                          </span>
                        </div>
                        <span className="text-zinc-500 text-[10px]">
                          Granted: {a.data.grantedAt ? new Date(a.data.grantedAt).toLocaleDateString() : 'Active'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevokeAdmin(a.uid, a.data.email)}
                        disabled={processingUid === a.uid}
                        className="px-2.5 py-1 rounded-lg bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-300 font-mono font-bold text-[10px] uppercase transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{processingUid === a.uid ? 'Revoking...' : 'Revoke'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 2. Grant Admin from Signed-In Users */}
              <div className="space-y-2 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-300 font-bold uppercase tracking-wider font-mono text-[11px]">
                    Grant Admin by Signed-In User ({allUsers.length})
                  </span>
                  <div className="relative w-48">
                    <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search user..."
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      className="w-full pl-7 pr-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-[11px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {filteredUsers.length === 0 ? (
                    <div className="p-3 text-center text-zinc-500 font-mono text-xs">
                      No signed-in users found.
                    </div>
                  ) : (
                    filteredUsers.map((u) => {
                      const isAlreadyAdmin =
                        u.email?.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim() ||
                        adminsList.some((a) => a.uid === u.id);

                      return (
                        <div
                          key={u.id}
                          className="p-2.5 rounded-xl bg-zinc-950 border border-white/5 flex items-center justify-between gap-2 font-mono text-[11px]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="text-white font-bold truncate">{u.displayName || 'Builder'}</span>
                              <span className="text-zinc-400 text-[10px] truncate">&lt;{u.email}&gt;</span>
                              <span className="text-zinc-600 text-[9px] select-all shrink-0">
                                ({u.id.slice(0, 5)}...{u.id.slice(-4)})
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                              <span
                                className={`px-1 rounded text-[9px] font-bold uppercase ${
                                  u.status === 'active'
                                    ? 'bg-[#b5ff00]/15 text-[#b5ff00]'
                                    : u.status === 'pending'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-zinc-800 text-zinc-400'
                                }`}
                              >
                                {u.status}
                              </span>
                              {isAlreadyAdmin && (
                                <span className="text-[#b5ff00] font-bold text-[10px]">
                                  • Admin Active
                                </span>
                              )}
                            </div>
                          </div>

                          {!isAlreadyAdmin ? (
                            <button
                              type="button"
                              onClick={() => handleGrantAdmin(u)}
                              disabled={processingUid === u.id}
                              className="px-2.5 py-1.5 rounded-lg bg-[#b5ff00] hover:bg-[#c2ff26] text-black font-mono font-bold text-[10px] uppercase transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50 shrink-0"
                            >
                              <UserPlus className="w-3 h-3" />
                              <span>{processingUid === u.id ? 'Granting...' : 'Make Administrator'}</span>
                            </button>
                          ) : (
                            <span className="text-zinc-500 text-[10px] shrink-0 font-mono">
                              Administrator
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {!isAdmin && (
            <div className="p-3.5 rounded-2xl bg-zinc-950 border border-white/5 text-xs text-zinc-400 space-y-1">
              <p className="font-semibold text-zinc-200">Standard Member Permissions</p>
              <p className="text-xs leading-relaxed text-zinc-400">
                You can scan kiosk QR codes to check in, view digital passes, and access personal statistics. Administrator privileges are granted and managed by the Super Administrator.
              </p>
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={async () => {
                await signOutUser();
                onClose();
              }}
              className="btn-glossy-secondary flex-1 py-3 px-5 rounded-full text-xs text-zinc-300 font-mono transition-colors cursor-pointer flex items-center justify-center gap-2 min-h-11"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-center py-2">
          <p className="text-sm text-zinc-400">
            Sign in with your Google account to access attendance verification and club privileges.
          </p>
          <button
            type="button"
            onClick={async () => {
              const ok = await handleSignIn();
              if (ok) onClose();
            }}
            disabled={signingIn}
            className="btn-glossy-primary w-full py-3.5 px-6 rounded-full text-black text-sm font-bold font-display uppercase tracking-wider cursor-pointer min-h-11 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span>{signingIn ? 'Connecting...' : 'Sign in with Google'}</span>
          </button>
        </div>
      )}
    </ModalSheet>
  );
};
