import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  UserCheck,
  XCircle,
  Mail,
  Clock,
  Search,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  UserPlus,
  RefreshCw,
  Users,
  Sparkles,
} from 'lucide-react';
import { UserProfile, Member } from '../types';
import {
  subscribeToPendingUsers,
  approveUserMembershipLink,
  rejectUserMembershipLink,
} from '../firebase/firestoreService';
import { SecureAvatar } from './common/SecureAvatar';

interface PendingRequestsProps {
  members: Member[];
  onOpenAddMemberWithPrefill?: (prefill: {
    name?: string;
    email?: string;
    handle?: string;
    authUid?: string;
    studentId?: string;
    university?: string;
  }) => void;
  // Optional external callback
  onStatusChange?: () => void;
}

export const PendingRequests: React.FC<PendingRequestsProps> = ({
  members,
  onOpenAddMemberWithPrefill,
  onStatusChange,
}) => {
  // Real-time Firestore snapshot state for pending users
  const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search query state
  const [searchQuery, setSearchQuery] = useState('');

  // Mapping of user.id -> selected memberId to link to
  const [selectedMatches, setSelectedMatches] = useState<Record<string, string>>({});

  // Action processing state (e.g. approving/rejecting user id)
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Rejection confirmation dialog state
  const [confirmRejectUser, setConfirmRejectUser] = useState<UserProfile | null>(null);

  // 1. Snapshot Listener for all users with status == 'pending'
  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToPendingUsers(
      (users) => {
        setPendingUsers(users);
        setLoading(false);
        setError(null);
      },
      (err: any) => {
        console.error('Failed to listen to pending users:', err);
        const code = err?.code ? `[${err.code}] ` : '';
        setError(`Could not sync pending requests: ${code}${err?.message || 'Access denied or network error'}`);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Helper: auto-detect matching member from members roster
  const getAutoMatchMember = (req: UserProfile): Member | undefined => {
    if (req.email) {
      const emailMatch = members.find(
        (m) => m.email && m.email.toLowerCase().trim() === req.email.toLowerCase().trim()
      );
      if (emailMatch) return emailMatch;
    }

    if (req.requestedNotes) {
      const cleanReqHandle = req.requestedNotes.toLowerCase().replace('@', '').trim();
      const handleMatch = members.find(
        (m) =>
          m.handle.toLowerCase().replace('@', '').trim() === cleanReqHandle ||
          m.name.toLowerCase().trim() === req.requestedNotes?.toLowerCase().trim()
      );
      if (handleMatch) return handleMatch;
    }

    return undefined;
  };

  const handleSelectMember = (userId: string, memberId: string) => {
    setSelectedMatches((prev) => ({
      ...prev,
      [userId]: memberId,
    }));
  };

  // 2. Action: Approve and set status to Approved — Waiting for User Response
  const handleApprove = async (user: UserProfile, targetMemberId?: string) => {
    const chosenMemberId = targetMemberId || selectedMatches[user.id] || user.approvedMemberId || getAutoMatchMember(user)?.id;
    if (!chosenMemberId) {
      // If no member selected, launch add member modal with prefilled data
      if (onOpenAddMemberWithPrefill) {
        onOpenAddMemberWithPrefill({
          name: user.displayName,
          email: user.email,
          handle: user.requestedNotes?.startsWith('@')
            ? user.requestedNotes
            : `@${user.requestedNotes || user.email?.split('@')[0] || 'builder'}`,
          authUid: user.id,
          studentId: (/^\d+$/.test(user.requestedNotes?.trim() || '')) ? user.requestedNotes?.trim() : undefined,
          university: 'Tongmyong University',
        });
      }
      return;
    }

    setProcessingId(user.id);
    setError(null);
    try {
      await approveUserMembershipLink(user.id, chosenMemberId);
      const matchedName = members.find((m) => m.id === chosenMemberId)?.name || 'Builder Profile';
      setActionSuccessMessage(
        `Approved request for ${user.displayName || user.email} (Linked to ${matchedName}). Status set to 'Approved — Waiting for User Response'.`
      );
      setTimeout(() => setActionSuccessMessage(null), 5000);
      onStatusChange?.();
    } catch (err: any) {
      console.error('Failed to approve user:', err);
      setError(`Failed to approve request: ${err.message || 'Unknown error'}`);
    } finally {
      setProcessingId(null);
    }
  };

  // 3. Action: Reject user and mark status as suspended
  const handleConfirmReject = async () => {
    if (!confirmRejectUser) return;
    const userId = confirmRejectUser.id;
    setProcessingId(userId);
    setError(null);
    try {
      await rejectUserMembershipLink(userId);
      setActionSuccessMessage(`Membership request for ${confirmRejectUser.email} has been rejected.`);
      setTimeout(() => setActionSuccessMessage(null), 4000);
      setConfirmRejectUser(null);
      onStatusChange?.();
    } catch (err: any) {
      console.error('Failed to reject user:', err);
      setError(`Failed to reject request: ${err.message || 'Unknown error'}`);
    } finally {
      setProcessingId(null);
    }
  };

  const filteredUsers = pendingUsers.filter((req) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      req.displayName?.toLowerCase().includes(q) ||
      req.email?.toLowerCase().includes(q) ||
      req.requestedNotes?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-white uppercase">
              Pending Membership Requests
            </h1>
            <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span>{pendingUsers.length} Pending</span>
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time listener on <span className="font-mono text-zinc-300">users</span> collection with status <span className="font-mono text-amber-400">'pending'</span>
          </p>
        </div>

        {/* Search */}
        <div className="relative min-w-[240px]">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by name, email, or handle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00]"
          />
        </div>
      </div>

      {/* Notifications & Banners */}
      {actionSuccessMessage && (
        <div className="p-3.5 rounded-xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-xs text-[#b5ff00] flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="font-semibold">{actionSuccessMessage}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800 text-xs text-red-200 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5 font-mono text-xs">
        <div className="p-4 rounded-2xl glass-panel neu-raised-sm space-y-1 spatial-card">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Total Open Requests</span>
          <span className="text-xl font-bold text-white tabular-nums">
            {pendingUsers.length}
          </span>
        </div>
        <div className="p-4 rounded-2xl glass-panel neu-raised-sm space-y-1 spatial-card">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Awaiting Admin Action</span>
          <span className="text-xl font-bold text-amber-400 tabular-nums">
            {pendingUsers.filter((r) => r.status === 'pending' || !r.status).length}
          </span>
        </div>
        <div className="p-4 rounded-2xl glass-panel neu-raised-sm space-y-1 spatial-card">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Waiting for User Response</span>
          <span className="text-xl font-bold text-cyan-400 tabular-nums">
            {pendingUsers.filter((r) => r.status === 'approved_waiting_response').length}
          </span>
        </div>
        <div className="p-4 rounded-2xl glass-panel neu-raised-sm space-y-1 spatial-card">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Auto-Matched to Roster</span>
          <span className="text-xl font-bold text-[#b5ff00] tabular-nums">
            {pendingUsers.filter((r) => !!getAutoMatchMember(r)).length}
          </span>
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-12 text-center space-y-3">
          <RefreshCw className="h-6 w-6 text-amber-400 animate-spin mx-auto" />
          <p className="text-xs text-zinc-400 font-mono">Listening for pending requests in Firestore...</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        /* Empty State */
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 p-12 text-center space-y-3">
          <div className="h-12 w-12 mx-auto rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500">
            <CheckCircle2 className="h-6 w-6 text-[#b5ff00]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white font-display uppercase tracking-tight">
              {pendingUsers.length === 0 ? 'No Pending Membership Requests' : 'No Matching Requests Found'}
            </h3>
            <p className="text-xs text-zinc-400 max-w-sm mx-auto mt-1">
              {pendingUsers.length === 0
                ? 'All club members who signed in are currently approved or linked. When new builders sign in during workshop meetings, their requests will appear here automatically.'
                : 'Try adjusting your search query.'}
            </p>
          </div>
        </div>
      ) : (
        /* Requests Grid */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredUsers.map((req) => {
            const autoMatch = getAutoMatchMember(req);
            const currentlyChosenMemberId =
              selectedMatches[req.id] || (autoMatch ? autoMatch.id : '');
            const isProcessing = processingId === req.id;

            return (
              <div
                key={req.id}
                className="rounded-3xl glass-panel p-5 sm:p-6 space-y-4 hover:border-amber-500/40 transition-all shadow-md flex flex-col justify-between spatial-card"
              >
                <div className="space-y-3.5">
                  {/* Card Header: User Google Identity */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <SecureAvatar
                        src={req.photoURL}
                        name={req.displayName}
                        alt={req.displayName || 'Google User'}
                        size={40}
                        shape="rounded"
                        className="border border-white/10 shrink-0 neu-raised-sm"
                        fallbackClassName="font-bold text-amber-400 text-sm"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-white truncate">
                            {req.displayName || 'Google Account'}
                          </h3>
                          {req.status === 'approved_waiting_response' ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 uppercase font-bold flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                              <span>Approved — Waiting for User Response</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 uppercase font-semibold">
                              Pending
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-400 font-mono flex items-center gap-1.5 mt-0.5 truncate">
                          <Mail className="h-3 w-3 text-zinc-500 shrink-0" />
                          <span className="truncate">{req.email}</span>
                        </div>
                      </div>
                    </div>

                    {req.membershipRequestedAt && (
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(req.membershipRequestedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {/* Status Banner for Approved — Waiting for User Response */}
                  {req.status === 'approved_waiting_response' && (
                    <div className="p-3 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-200 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-cyan-300">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-400" />
                        <span>Approved — Waiting for User Response</span>
                      </div>
                      <p className="text-xs text-zinc-300">
                        The applicant has been notified. The account will activate automatically once they click &quot;Accept Invitation&quot; in their portal.
                      </p>
                    </div>
                  )}

                  {/* Claimed Handle / Request Notes */}
                  {req.requestedNotes && (
                    <div className="p-3 rounded-2xl bg-[#0d0f15]/80 border border-white/5 neu-inset text-xs">
                      <span className="text-xs text-zinc-400 uppercase font-mono block">
                        Claimed Builder Handle / Notes:
                      </span>
                      <span className="text-white font-mono font-semibold">
                        {req.requestedNotes}
                      </span>
                    </div>
                  )}

                  {/* Target Member Linking Dropdown */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-mono uppercase tracking-wider text-zinc-300 font-semibold">
                      Link To Member Profile:
                    </label>
                    <select
                      value={currentlyChosenMemberId}
                      onChange={(e) => handleSelectMember(req.id, e.target.value)}
                      disabled={isProcessing}
                      className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-base sm:text-xs text-zinc-200 focus:outline-none focus:border-[#b5ff00] cursor-pointer min-h-11"
                    >
                      <option value="">-- Select Member or Register New --</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.handle}) — {m.role}
                        </option>
                      ))}
                    </select>

                    {autoMatch && !selectedMatches[req.id] ? (
                      <p className="text-xs text-[#b5ff00] font-mono flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>Auto-suggested: {autoMatch.name} ({autoMatch.handle})</span>
                      </p>
                    ) : !currentlyChosenMemberId ? (
                      <p className="text-xs text-zinc-400">
                        No member selected. Click &quot;Register &amp; Link New&quot; below to create a new profile for this user.
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Actions: Approve (Link to chosen) | Register New | Reject */}
                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/10">
                  {currentlyChosenMemberId ? (
                    <button
                      onClick={() => handleApprove(req, currentlyChosenMemberId)}
                      disabled={isProcessing}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] text-black font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(181,255,0,0.3)] active:scale-95 disabled:opacity-50"
                    >
                      {isProcessing ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-black" />
                      ) : (
                        <UserCheck className="h-3.5 w-3.5 text-black" />
                      )}
                      <span>
                        {req.status === 'approved_waiting_response'
                          ? 'Re-Approve Link'
                          : 'Approve Application'}
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleApprove(req)}
                      disabled={isProcessing}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-black font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(6,182,212,0.3)] active:scale-95 disabled:opacity-50"
                    >
                      <UserPlus className="h-3.5 w-3.5 text-black" />
                      <span>Register &amp; Link New</span>
                    </button>
                  )}

                  <button
                    onClick={() => setConfirmRejectUser(req)}
                    disabled={isProcessing}
                    className="py-2.5 px-3 rounded-xl bg-[#141720] hover:bg-red-950/60 hover:text-red-400 border border-white/10 neu-button text-zinc-400 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                    title="Reject and deny membership access"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rejection Confirmation Modal */}
      {confirmRejectUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-3xl glass-modal border border-red-500/40 p-6 space-y-4 shadow-[0_25px_60px_rgba(0,0,0,0.95),0_0_35px_rgba(239,68,68,0.2)] text-zinc-100 spatial-card">
            <div className="flex items-center gap-3 border-b border-white/10 pb-3">
              <div className="p-2.5 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400">
                <XCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase font-display tracking-tight">
                  Reject Membership Request
                </h3>
                <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate max-w-[260px]">
                  {confirmRejectUser.email}
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Are you sure you want to deny this request? The user&apos;s status will be set to <span className="text-red-400 font-mono font-semibold">suspended</span>, preventing them from accessing the attendance hub.
            </p>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRejectUser(null)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-[#141720] hover:bg-[#191c27] border border-white/10 text-xs text-zinc-300 font-semibold uppercase tracking-wider neu-button transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="flex-1 py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_15px_rgba(239,68,68,0.3)] active:scale-95"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
