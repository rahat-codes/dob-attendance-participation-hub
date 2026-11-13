import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  ShieldCheck,
  Search,
  Trash2,
  UserCheck,
  Bell,
  Clock,
} from 'lucide-react';
import { AuditLog } from '../types';
import { subscribeToAuditLogs } from '../firebase/firestoreService';
import { ModalSheet } from './ModalSheet';
import { toJsDate } from '../utils/sessionWindow';

interface AuditLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuditLogsModal: React.FC<AuditLogsModalProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'deletions' | 'roles' | 'notifications' | 'approvals'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const unsub = subscribeToAuditLogs(
      (items) => {
        setLogs(items);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, [isOpen]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (categoryFilter === 'deletions') {
        if (!log.action.includes('delete') && !log.action.includes('deactivate')) return false;
      } else if (categoryFilter === 'roles') {
        if (!log.action.includes('role') && !log.action.includes('admin')) return false;
      } else if (categoryFilter === 'notifications') {
        if (!log.action.includes('notify')) return false;
      } else if (categoryFilter === 'approvals') {
        if (!log.action.includes('approve') && !log.action.includes('reject')) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          log.details.toLowerCase().includes(q) ||
          Boolean(log.performedByEmail && log.performedByEmail.toLowerCase().includes(q)) ||
          log.action.toLowerCase().includes(q) ||
          Boolean(log.targetName && log.targetName.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [logs, categoryFilter, searchQuery]);

  const getActionBadge = (action: AuditLog['action']) => {
    if (action.includes('delete') || action.includes('deactivate')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-950/70 border border-red-500/40 text-red-400 text-xs font-mono font-bold uppercase">
          <Trash2 className="h-3 w-3" />
          <span>{action.replace('_', ' ')}</span>
        </span>
      );
    }
    if (action.includes('admin') || action.includes('role')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-950/70 border border-purple-500/40 text-purple-300 text-xs font-mono font-bold uppercase">
          <ShieldCheck className="h-3 w-3 text-purple-400" />
          <span>{action.replace('_', ' ')}</span>
        </span>
      );
    }
    if (action.includes('notify')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-950/70 border border-blue-500/40 text-blue-300 text-xs font-mono font-bold uppercase">
          <Bell className="h-3 w-3 text-blue-400" />
          <span>{action.replace('_', ' ')}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-bold uppercase">
        <UserCheck className="h-3 w-3 text-emerald-400" />
        <span>{action.replace('_', ' ')}</span>
      </span>
    );
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Security & Operations Audit Trail"
      subtitle={`${logs.length} logged events · Append-only ledger`}
      icon={<History className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth="3xl"
      footer={
        <div className="flex items-center justify-end w-full">
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
        {/* Filters Strip */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            {/* Category tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar p-1 bg-black/60 rounded-2xl border border-white/5 neu-inset">
              {[
                { key: 'all', label: 'All' },
                { key: 'deletions', label: 'Deletions' },
                { key: 'roles', label: 'Roles' },
                { key: 'notifications', label: 'Notifications' },
                { key: 'approvals', label: 'Approvals' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setCategoryFilter(tab.key as any)}
                  className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer text-xs whitespace-nowrap min-h-9 ${
                    categoryFilter === tab.key
                      ? 'bg-zinc-800 text-[#b5ff00] font-bold shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search audit events..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-[#b5ff00] min-h-11 text-base sm:text-xs"
              />
            </div>
          </div>
        </div>

        {/* Audit Log Entries List */}
        <div className="space-y-2.5">
          {loading ? (
            <div className="py-12 text-center text-xs text-zinc-400 font-mono">
              Loading security audit ledger...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-400 font-mono border border-dashed border-zinc-800 rounded-2xl">
              No audit log entries matching current criteria.
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 transition-colors space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {getActionBadge(log.action)}
                    {log.targetName && (
                      <span className="text-xs font-bold text-white font-display">
                        {log.targetName}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{toJsDate(log.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                <p className="text-xs text-zinc-200 font-mono leading-relaxed">
                  {log.details}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-800/60 text-xs text-zinc-400 font-mono">
                  <span>
                    By: <span className="text-zinc-300 font-semibold">{log.performedByEmail}</span>
                  </span>
                  <span className="text-zinc-500">ID: {log.id}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </ModalSheet>
  );
};
