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
} from 'lucide-react';
import { ModalSheet } from './ModalSheet';
import { exportFullBackupJSON } from '../firebase/firestoreService';
import { SUPER_ADMIN_EMAIL } from '../config/constants';
import { useAuth } from '../firebase/AuthContext';

interface AdminBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminBackupModal: React.FC<AdminBackupModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPiiConfirm, setShowPiiConfirm] = useState(false);

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

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={() => {
        setShowPiiConfirm(false);
        setErrorMessage(null);
        setStatusMessage(null);
        onClose();
      }}
      title="Database Backup & Export"
      subtitle="Super Administrator Data Operations"
      icon={<Database className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth="xl"
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
              Database backups are restricted to the Super Administrator (<span className="font-mono text-white">{SUPER_ADMIN_EMAIL}</span>).
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

            {/* PII Confirmation Modal Dialog */}
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
                <p className="text-zinc-300">
                  Confirm that you have authorized administrative cause to export this personal data and will store it securely in accordance with data privacy regulations.
                </p>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                {/* Option 1: Sanitized Export */}
                <div className="p-4 rounded-xl bg-zinc-900/70 border border-white/10 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="font-bold text-xs text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5 text-[#b5ff00]" />
                      <span>Sanitized Backup</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Exports sessions, attendance history, announcements, audit logs, and settings. Excludes all private member personal info (<span className="font-mono text-zinc-300">memberPrivate</span> &amp; <span className="font-mono text-zinc-300">users</span>).
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

                {/* Option 2: Full Export with PII */}
                <div className="p-4 rounded-xl bg-zinc-900/70 border border-red-500/20 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="font-bold text-xs text-red-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                      <span>Full Backup (With PII)</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Complete database snapshot including builder contact directories, student IDs, and user accounts. Requires explicit confirmation.
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
          </>
        )}
      </div>
    </ModalSheet>
  );
};
