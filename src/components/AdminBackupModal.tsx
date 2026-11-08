/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Database,
  Download,
  AlertTriangle,
  ShieldAlert,
  CheckCircle,
  ExternalLink,
  Wrench,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { ModalSheet } from './ModalSheet';
import { exportFullBackupJSON, executeMemberDataRepair, executeUserStateRepair } from '../firebase/firestoreService';
import { SUPER_ADMIN_EMAIL } from '../config/constants';
import { useAuth } from '../firebase/AuthContext';
import { Member, UserProfile } from '../types';
import {
  prepareMemberDataRepair,
  prepareUserStateRepair,
  MemberDataRepairItem,
  UserStateRepairItem,
} from '../utils/repairTools';

interface AdminBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  members?: Member[];
  users?: UserProfile[];
}

export const AdminBackupModal: React.FC<AdminBackupModalProps> = ({
  isOpen,
  onClose,
  members = [],
  users = [],
}) => {
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPiiConfirm, setShowPiiConfirm] = useState(false);

  // Repair tool state
  const [memberRepairPlan, setMemberRepairPlan] = useState<MemberDataRepairItem[] | null>(null);
  const [userRepairPlan, setUserRepairPlan] = useState<UserStateRepairItem[] | null>(null);
  const [repairing, setRepairing] = useState(false);

  const isSuperAdmin = user?.email?.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim();

  const handleExport = async (includePII: boolean) => {
    setExporting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await exportFullBackupJSON({ includePII });
      setStatusMessage(
        includePII
          ? 'Full database backup (including memberPrivate & user PII) downloaded successfully.'
          : 'Sanitized database backup (excluding private PII) downloaded successfully.'
      );
      setShowPiiConfirm(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to generate database backup.');
    } finally {
      setExporting(false);
    }
  };

  const handlePreviewMemberRepair = () => {
    setErrorMessage(null);
    const plan = prepareMemberDataRepair(members);
    setMemberRepairPlan(plan);
    if (plan.length === 0) {
      setStatusMessage('Member Data Integrity Check: All member documents match public whitelist. No private fields found in public docs.');
    }
  };

  const handleExecuteMemberRepair = async () => {
    if (!memberRepairPlan || memberRepairPlan.length === 0) return;
    setRepairing(true);
    setErrorMessage(null);
    try {
      const count = await executeMemberDataRepair(memberRepairPlan);
      setStatusMessage(`Member Data Repair Completed: Safely purged private fields from ${count} member documents (synced to memberPrivate).`);
      setMemberRepairPlan(null);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to execute member data repair.');
    } finally {
      setRepairing(false);
    }
  };

  const handlePreviewUserRepair = () => {
    setErrorMessage(null);
    const plan = prepareUserStateRepair(users, members);
    setUserRepairPlan(plan);
    if (plan.length === 0) {
      setStatusMessage('User State Integrity Check: All user accounts are properly synchronized with the roster.');
    }
  };

  const handleExecuteUserRepair = async () => {
    if (!userRepairPlan || userRepairPlan.length === 0) return;
    setRepairing(true);
    setErrorMessage(null);
    try {
      const count = await executeUserStateRepair(userRepairPlan);
      setStatusMessage(`User State Repair Completed: Synchronized ${count} user account documents.`);
      setUserRepairPlan(null);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to execute user state repair.');
    } finally {
      setRepairing(false);
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={() => {
        setShowPiiConfirm(false);
        setErrorMessage(null);
        setStatusMessage(null);
        setMemberRepairPlan(null);
        setUserRepairPlan(null);
        onClose();
      }}
      title="Database Operations & Integrity"
      subtitle="Super Administrator Data Operations & Repair"
      icon={<Database className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth="2xl"
      footer={
        <div className="flex items-center justify-end w-full">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-11"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-5 py-1">
        {/* Managed Backups & Access Policy Notice */}
        <div className="p-4 rounded-xl bg-blue-950/30 border border-blue-500/30 text-xs text-blue-200 space-y-2">
          <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-blue-400 font-mono">
            <ExternalLink className="w-4 h-4" />
            <span>Cloud Firestore Managed Backups &amp; Enforcement</span>
          </div>
          <p className="leading-relaxed">
            For automated daily/weekly disaster recovery and Point-in-Time Recovery (PITR), please check and configure backup schedules directly in the{' '}
            <strong className="text-white">Firebase Console</strong> under{' '}
            <span className="font-mono text-zinc-300">Firestore &gt; Backups</span>.
          </p>
          <p className="text-[11px] text-blue-300/80 leading-relaxed border-t border-blue-500/20 pt-2 font-mono">
            Notice: Super Administrator restriction for JSON backup export is enforced in application UI logic. In Firestore Security Rules, all administrators currently hold read permissions on these collections.
          </p>
        </div>

        {/* Super Admin Access Control Gate */}
        {!isSuperAdmin ? (
          <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 space-y-2">
            <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-amber-400 font-mono">
              <ShieldAlert className="w-4 h-4" />
              <span>Restricted Access</span>
            </div>
            <p>
              Database backups and integrity repairs are restricted to the Super Administrator.
              Your current logged-in account does not hold database export privileges.
            </p>
          </div>
        ) : (
          <>
            {/* Status Feedback */}
            {statusMessage && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{statusMessage}</span>
              </div>
            )}

            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-200 flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Section 1: Backup Exports */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Download className="w-4 h-4 text-[#b5ff00]" />
                <span>Database JSON Backups</span>
              </h3>

              {showPiiConfirm ? (
                <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/50 text-xs text-red-200 space-y-3">
                  <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-red-400 font-mono">
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                    <span>Warning: Personal Data (PII) Export</span>
                  </div>
                  <p className="leading-relaxed text-zinc-200">
                    This backup file contains confidential and personally identifiable information (PII), including:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-zinc-300 font-mono text-[11px]">
                    <li>Member email addresses and phone numbers</li>
                    <li>Student identification numbers &amp; university majors</li>
                    <li>Private user profile documents and Google UID mappings</li>
                  </ul>
                  <div className="flex items-center gap-2.5 pt-2">
                    <button
                      type="button"
                      disabled={exporting}
                      onClick={() => handleExport(true)}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer min-h-10 disabled:opacity-50"
                    >
                      {exporting ? 'Exporting...' : 'I Confirm, Export PII'}
                    </button>
                    <button
                      type="button"
                      disabled={exporting}
                      onClick={() => setShowPiiConfirm(false)}
                      className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer min-h-10"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Sanitized Export */}
                  <div className="p-4 rounded-xl bg-zinc-900/70 border border-white/10 space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="font-bold text-xs text-white uppercase tracking-wider font-mono">
                        Sanitized Backup
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Exports public rosters, sessions, and attendance history. Excludes all private member personal info.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={exporting}
                      onClick={() => handleExport(false)}
                      className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-white/10 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-11 disabled:opacity-50"
                    >
                      <Download className="w-4 h-4 text-[#b5ff00]" />
                      <span>{exporting ? 'Exporting...' : 'Download Sanitized JSON'}</span>
                    </button>
                  </div>

                  {/* Full Export with PII */}
                  <div className="p-4 rounded-xl bg-zinc-900/70 border border-red-500/20 space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="font-bold text-xs text-red-300 uppercase tracking-wider font-mono">
                        Full Backup (With PII)
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Complete database snapshot including builder contact directories, student IDs, and user accounts.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={exporting}
                      onClick={() => setShowPiiConfirm(true)}
                      className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-950/40 hover:bg-red-900/40 text-red-300 border border-red-500/40 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-11 disabled:opacity-50"
                    >
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span>Export Full (With PII)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Section 2: Data Integrity & Repair Tools (Dry-Run First) */}
            <div className="space-y-3 pt-3 border-t border-zinc-800">
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <Wrench className="w-4 h-4 text-[#b5ff00]" />
                  <span>Data Integrity &amp; Repair Operations (Dry-Run First)</span>
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Scans database records for legacy private PII or inconsistent state bindings. Repairs are dry-run first, batched in atomic transactions, and logged to audit logs.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Tool 1: Member Data Repair */}
                <div className="p-4 rounded-xl bg-zinc-900/70 border border-white/10 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <span className="font-bold text-xs text-white uppercase tracking-wider font-mono block">
                      Member PII Purge &amp; Sync
                    </span>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Removes sensitive PII (emails, phone numbers, counters) from public <span className="font-mono text-zinc-300">members</span> docs and preserves them in <span className="font-mono text-zinc-300">memberPrivate</span>.
                    </p>
                    {memberRepairPlan && (
                      <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300">
                        Dry run result: <strong>{memberRepairPlan.length}</strong> member documents require cleanup.
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={repairing}
                      onClick={handlePreviewMemberRepair}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer min-h-10 disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#b5ff00]" />
                      <span>Preview Member Repair (Dry Run)</span>
                    </button>

                    {memberRepairPlan && memberRepairPlan.length > 0 && (
                      <button
                        type="button"
                        disabled={repairing}
                        onClick={handleExecuteMemberRepair}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#b5ff00] hover:bg-[#a3e600] text-black text-xs font-bold uppercase tracking-wider cursor-pointer min-h-10 disabled:opacity-50"
                      >
                        {repairing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                        <span>Execute Repair ({memberRepairPlan.length} Docs)</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Tool 2: User State Alignment */}
                <div className="p-4 rounded-xl bg-zinc-900/70 border border-white/10 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <span className="font-bold text-xs text-white uppercase tracking-wider font-mono block">
                      User State Alignment
                    </span>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Detects active accounts with inactive or missing roster records, or declined accounts with lingering IDs, and brings them into alignment.
                    </p>
                    {userRepairPlan && (
                      <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300">
                        Dry run result: <strong>{userRepairPlan.length}</strong> user accounts require state alignment.
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={repairing}
                      onClick={handlePreviewUserRepair}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer min-h-10 disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#b5ff00]" />
                      <span>Preview User State Repair (Dry Run)</span>
                    </button>

                    {userRepairPlan && userRepairPlan.length > 0 && (
                      <button
                        type="button"
                        disabled={repairing}
                        onClick={handleExecuteUserRepair}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#b5ff00] hover:bg-[#a3e600] text-black text-xs font-bold uppercase tracking-wider cursor-pointer min-h-10 disabled:opacity-50"
                      >
                        {repairing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                        <span>Execute State Repair ({userRepairPlan.length} Users)</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalSheet>
  );
};
