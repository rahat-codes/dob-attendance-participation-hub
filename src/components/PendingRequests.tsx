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
  ChevronDown,
  ChevronUp,
  Globe,
  ExternalLink,
} from 'lucide-react';
import { UserProfile, Member, BuilderTrack } from '../types';
import {
  subscribeToPendingUsers,
  approveExistingMember,
  rejectUserMembershipLink,
  activateDirectly,
  archiveMemberHandle,
} from '../firebase/firestoreService';
import { SecureAvatar } from './common/SecureAvatar';
import { SafeExternalLink } from './common/SafeExternalLink';
import { findReuseCandidates, parseApplicantNotes } from '../utils/reuseHelpers';
import { decodeApplication, isApplicationSubmitted } from '../utils/application';
import { getUserState } from '../utils/userStateMachine';

interface PendingRequestsProps {
  members: Member[];
  onOpenAddMemberWithPrefill?: (prefill: {
    name?: string;
    email?: string;
    handle?: string;
    authUid?: string;
    studentId?: string;
    university?: string;
    tracks?: BuilderTrack[];
    githubUrl?: string;
    linkedinUrl?: string;
    portfolioUrl?: string;
    showLinksPublicly?: boolean;
  }) => void;
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

  // Filter state
  const [statusFilter, setStatusFilter] = useState<'actionable' | 'all' | 'pending' | 'approved_waiting_response' | 'declined'>('actionable');

  // Search query state
  const [searchQuery, setSearchQuery] = useState('');

  // Mapping of user.id -> selected memberId to link to
  const [selectedMatches, setSelectedMatches] = useState<Record<string, string>>({});

  // Action processing state (e.g. approving/rejecting user id)
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Modals state
  const [confirmRejectUser, setConfirmRejectUser] = useState<UserProfile | null>(null);
  const [linkConfirmTarget, setLinkConfirmTarget] = useState<{ user: UserProfile; member: Member } | null>(null);

  // Unsubmitted sign-ins accordion collapse state
  const [showUnsubmitted, setShowUnsubmitted] = useState(false);

  // 1. Snapshot Listener for all users
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

  // Separate submitted applications from users who only signed in
  const submittedApplications = pendingUsers.filter((u) => isApplicationSubmitted(u));
  const unsubmittedUsers = pendingUsers.filter((u) => !isApplicationSubmitted(u));

  const handleSelectMember = (userId: string, memberId: string) => {
    setSelectedMatches((prev) => ({
      ...prev,
      [userId]: memberId,
    }));
  };

  // 2. Action: Approve and set status to Approved — Waiting for User Response
  const handleApprove = async (user: UserProfile, targetMemberId?: string) => {
    const chosenMemberId = targetMemberId || selectedMatches[user.id] || user.approvedMemberId;
    if (!chosenMemberId) {
      // If no member selected, launch add member modal with prefilled application data
      if (onOpenAddMemberWithPrefill) {
        const decoded = decodeApplication(user);
        onOpenAddMemberWithPrefill({
          name: decoded.applicantName || user.displayName,
          email: user.email,
          handle: decoded.applicantHandle || `@${user.email?.split('@')[0] || 'builder'}`,
          authUid: user.id,
          studentId: decoded.applicantStudentId,
          university: 'Tongmyong University',
          tracks: decoded.applicantTrack ? [decoded.applicantTrack] : undefined,
          githubUrl: decoded.githubUrl,
          linkedinUrl: decoded.linkedinUrl,
          portfolioUrl: decoded.portfolioUrl,
          showLinksPublicly: decoded.showLinksPublicly,
        });
      }
      return;
    }

    const targetMember = members.find((m) => m.id === chosenMemberId);
    if (targetMember && !targetMemberId) {
      // Show explicit confirmation modal before linking existing builder
      setLinkConfirmTarget({ user, member: targetMember });
      return;
    }

    await executeApproveLink(user, chosenMemberId);
  };

  const executeApproveLink = async (user: UserProfile, chosenMemberId: string) => {
    setProcessingId(user.id);
    setError(null);
    try {
      await approveExistingMember(user.id, chosenMemberId);
      const matchedName = members.find((m) => m.id === chosenMemberId)?.name || 'Builder Profile';
      setActionSuccessMessage(
        `Approved request for ${user.displayName || user.email} (Linked to ${matchedName}). Status set to 'Approved — Waiting for User Response'.`
      );
      setTimeout(() => setActionSuccessMessage(null), 5000);
      setLinkConfirmTarget(null);
      onStatusChange?.();
    } catch (err: any) {
      console.error('Failed to approve user:', err);
      setError(`Failed to approve request: ${err.message || 'Unknown error'}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDirectActivate = async (user: UserProfile, targetMemberId?: string) => {
    const chosenMemberId = targetMemberId || selectedMatches[user.id] || user.approvedMemberId;
    if (!chosenMemberId) {
      if (onOpenAddMemberWithPrefill) {
        const decoded = decodeApplication(user);
        onOpenAddMemberWithPrefill({
          name: decoded.applicantName || user.displayName,
          email: user.email,
          handle: decoded.applicantHandle || `@${user.email?.split('@')[0] || 'builder'}`,
          authUid: user.id,
          studentId: decoded.applicantStudentId,
          university: 'Tongmyong University',
          tracks: decoded.applicantTrack ? [decoded.applicantTrack] : undefined,
          githubUrl: decoded.githubUrl,
          linkedinUrl: decoded.linkedinUrl,
          portfolioUrl: decoded.portfolioUrl,
          showLinksPublicly: decoded.showLinksPublicly,
        });
      }
      return;
    }

    setProcessingId(user.id);
    setError(null);
    try {
      await activateDirectly(user.id, chosenMemberId);
      const matchedName = members.find((m) => m.id === chosenMemberId)?.name || 'Builder Profile';
      setActionSuccessMessage(
        `Directly activated ${user.displayName || user.email} and linked to ${matchedName}. Status is now Active.`
      );
      setTimeout(() => setActionSuccessMessage(null), 5000);
      onStatusChange?.();
    } catch (err: any) {
      console.error('Failed to directly activate user:', err);
      const code = err?.code ? `[${err.code}] ` : '';
      setError(`Failed to directly activate user: ${code}${err?.message || 'Unknown error'}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleArchiveAndCreateNew = async (user: UserProfile, oldMember: Member) => {
    setProcessingId(user.id);
    setError(null);
    try {
      const archivedHandle = await archiveMemberHandle(oldMember.id);
      setActionSuccessMessage(
        `Archived previous record handle (${oldMember.handle} -> ${archivedHandle}). You can now register a fresh profile with the freed handle.`
      );
      setTimeout(() => setActionSuccessMessage(null), 6000);

      if (onOpenAddMemberWithPrefill) {
        const decoded = decodeApplication(user);
        onOpenAddMemberWithPrefill({
          name: decoded.applicantName || user.displayName || oldMember.name,
          email: user.email || oldMember.email,
          handle: decoded.applicantHandle || oldMember.handle,
          authUid: user.id,
          studentId: decoded.applicantStudentId || oldMember.studentId,
          university: oldMember.university || 'Tongmyong University',
          tracks: decoded.applicantTrack ? [decoded.applicantTrack] : oldMember.tracks,
          githubUrl: decoded.githubUrl || oldMember.githubUrl,
          linkedinUrl: decoded.linkedinUrl || oldMember.linkedinUrl,
          portfolioUrl: decoded.portfolioUrl || oldMember.portfolioUrl,
          showLinksPublicly: decoded.showLinksPublicly ?? oldMember.showLinksPublicly,
        });
      }
    } catch (err: any) {
      console.error('Failed to archive previous member handle:', err);
      setError(`Failed to archive old record: ${err?.message || 'Unknown error'}`);
    } finally {
      setProcessingId(null);
    }
  };

  // 3. Action: Reject user and mark status as declined
  const handleConfirmReject = async () => {
    if (!confirmRejectUser) return;
    const userId = confirmRejectUser.id;
    setProcessingId(userId);
    setError(null);
    try {
      await rejectUserMembershipLink(userId);
      setActionSuccessMessage(`Membership request for ${confirmRejectUser.email} has been declined.`);
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

  const filteredUsers = submittedApplications.filter((req) => {
    // 1. Status filter
    if (statusFilter === 'actionable') {
      if (req.status !== 'pending' && req.status !== 'approved_waiting_response' && req.status) {
        return false;
      }
    } else if (statusFilter === 'pending') {
      if (req.status && req.status !== 'pending') return false;
    } else if (statusFilter === 'approved_waiting_response') {
      if (req.status !== 'approved_waiting_response') return false;
    } else if (statusFilter === 'declined') {
      if (req.status !== 'declined' && req.status !== 'suspended') return false;
    }

    // 2. Search query filter
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const app = decodeApplication(req);
    return (
      Boolean(req.displayName?.toLowerCase().includes(q)) ||
      Boolean(req.email?.toLowerCase().includes(q)) ||
      Boolean(app.applicantName?.toLowerCase().includes(q)) ||
      Boolean(app.applicantHandle?.toLowerCase().includes(q)) ||
      Boolean(app.applicantStudentId?.toLowerCase().includes(q)) ||
      Boolean(req.requestedNotes?.toLowerCase().includes(q))
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
              <span>{submittedApplications.filter((r) => r.status === 'pending' || !r.status).length} Actionable</span>
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Submitted applications awaiting organizer review and roster verification.
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
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Submitted Applications</span>
          <span className="text-xl font-bold text-white tabular-nums">
            {submittedApplications.length}
          </span>
        </div>
        <div className="p-4 rounded-2xl glass-panel neu-raised-sm space-y-1 spatial-card">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Awaiting Admin Action</span>
          <span className="text-xl font-bold text-amber-400 tabular-nums">
            {submittedApplications.filter((r) => r.status === 'pending' || !r.status).length}
          </span>
        </div>
        <div className="p-4 rounded-2xl glass-panel neu-raised-sm space-y-1 spatial-card">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Waiting for User Response</span>
          <span className="text-xl font-bold text-cyan-400 tabular-nums">
            {submittedApplications.filter((r) => r.status === 'approved_waiting_response').length}
          </span>
        </div>
        <div className="p-4 rounded-2xl glass-panel neu-raised-sm space-y-1 spatial-card">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Signed In (No Form Yet)</span>
          <span className="text-xl font-bold text-zinc-400 tabular-nums">
            {unsubmittedUsers.length}
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 pb-3 font-mono text-xs">
        <button
          type="button"
          onClick={() => setStatusFilter('actionable')}
          className={`px-3 py-1.5 rounded-xl cursor-pointer transition-all ${
            statusFilter === 'actionable'
              ? 'bg-[#b5ff00] text-black font-bold shadow-[0_0_10px_rgba(181,255,0,0.2)]'
              : 'bg-zinc-900/60 text-zinc-400 hover:text-white border border-white/5'
          }`}
        >
          Active Queue ({submittedApplications.filter((r) => r.status === 'pending' || r.status === 'approved_waiting_response' || !r.status).length})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('pending')}
          className={`px-3 py-1.5 rounded-xl cursor-pointer transition-all ${
            statusFilter === 'pending'
              ? 'bg-amber-400 text-black font-bold shadow-[0_0_10px_rgba(251,191,36,0.2)]'
              : 'bg-zinc-900/60 text-zinc-400 hover:text-white border border-white/5'
          }`}
        >
          Awaiting Admin ({submittedApplications.filter((r) => r.status === 'pending' || !r.status).length})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('approved_waiting_response')}
          className={`px-3 py-1.5 rounded-xl cursor-pointer transition-all ${
            statusFilter === 'approved_waiting_response'
              ? 'bg-cyan-400 text-black font-bold shadow-[0_0_10px_rgba(34,211,238,0.2)]'
              : 'bg-zinc-900/60 text-zinc-400 hover:text-white border border-white/5'
          }`}
        >
          Waiting on User ({submittedApplications.filter((r) => r.status === 'approved_waiting_response').length})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('declined')}
          className={`px-3 py-1.5 rounded-xl cursor-pointer transition-all ${
            statusFilter === 'declined'
              ? 'bg-red-500/80 text-white font-bold'
              : 'bg-zinc-900/60 text-zinc-400 hover:text-white border border-white/5'
          }`}
        >
          Declined ({submittedApplications.filter((r) => r.status === 'declined' || r.status === 'suspended').length})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-xl cursor-pointer transition-all ${
            statusFilter === 'all'
              ? 'bg-zinc-200 text-black font-bold'
              : 'bg-zinc-900/60 text-zinc-400 hover:text-white border border-white/5'
          }`}
        >
          All ({submittedApplications.length})
        </button>
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
              {submittedApplications.length === 0 ? 'No Pending Membership Applications' : 'No Matching Requests Found'}
            </h3>
            <p className="text-xs text-zinc-400 max-w-sm mx-auto mt-1">
              {submittedApplications.length === 0
                ? 'All club applicants have been reviewed. When new builders submit the registration form, their applications will appear here.'
                : 'Try adjusting your search query.'}
            </p>
          </div>
        </div>
      ) : (
        /* Requests Grid */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredUsers.map((req) => {
            const app = decodeApplication(req);
            const currentlyChosenMemberId = selectedMatches[req.id] || req.approvedMemberId || '';
            const isProcessing = processingId === req.id;
            const reuseCandidates = findReuseCandidates(members, req);

            return (
              <div
                key={req.id}
                className="rounded-[28px] p-5 sm:p-6 bg-[#0c0e14]/85 border border-white/10 hover:border-amber-500/40 shadow-[0_15px_40px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.1)] grain-overlay space-y-4 flex flex-col justify-between"
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
                            {app.applicantName || req.displayName || 'Google Account'}
                          </h3>
                          {req.status === 'approved_waiting_response' ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 uppercase font-bold flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                              <span>Approved — Waiting for User</span>
                            </span>
                          ) : req.status === 'declined' ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 uppercase font-bold flex items-center gap-1">
                              <XCircle className="h-3 w-3 text-red-400" />
                              <span>Declined</span>
                            </span>
                          ) : req.status === 'active' ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#b5ff00]/15 border border-[#b5ff00]/30 text-[#b5ff00] uppercase font-bold flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-[#b5ff00]" />
                              <span>Active</span>
                            </span>
                          ) : req.status === 'suspended' ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 uppercase font-semibold">
                              Suspended
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 uppercase font-semibold">
                              Pending
                            </span>
                          )}

                          {Boolean(req.status === 'declined' || (req.status === 'pending' && req.respondedAt)) && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 uppercase font-bold flex items-center gap-1">
                              <span>Re-applicant</span>
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-400 font-mono flex items-center gap-1.5 mt-0.5 truncate">
                          <Mail className="h-3 w-3 text-zinc-500 shrink-0" />
                          <span className="truncate">{req.email}</span>
                        </div>
                      </div>
                    </div>

                    {(req.membershipRequestedAt || req.createdAt) && (
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date((req.membershipRequestedAt || req.createdAt) as string).toLocaleDateString()}
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
                        The applicant has been notified. The account will activate automatically once they click &quot;Accept Invitation&quot; in their portal, or you can click &quot;Activate Directly&quot; below.
                      </p>
                    </div>
                  )}

                  {/* Status Banner for Declined */}
                  {req.status === 'declined' && (
                    <div className="p-3 rounded-2xl bg-red-950/30 border border-red-500/30 text-xs text-red-200 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-red-300">
                        <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                        <span>Request Declined</span>
                      </div>
                      <p className="text-xs text-zinc-300">
                        This request was previously declined. You can select a member profile and click Approve or Activate Directly to re-admit this user.
                      </p>
                    </div>
                  )}

                  {/* Structured Application Details Card */}
                  <div className="p-3.5 rounded-2xl bg-[#0d0f15]/80 border border-white/5 neu-inset text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
                      <div>
                        <span className="text-[10px] text-zinc-400 uppercase font-mono block">Builder Handle:</span>
                        <span className="text-[#b5ff00] font-mono font-bold text-sm">
                          {app.applicantHandle || '@builder'}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-zinc-400 uppercase font-mono block">Track:</span>
                        <span className="text-zinc-200 font-semibold">{app.applicantTrack}</span>
                      </div>
                    </div>

                    {app.applicantStudentId && (
                      <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                        <span className="text-zinc-400 font-mono text-[11px]">Student ID:</span>
                        <span className="text-zinc-200 font-mono font-semibold">{app.applicantStudentId}</span>
                      </div>
                    )}

                    {/* Verified External Profile Links */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {app.githubUrl && (
                        <SafeExternalLink
                          href={app.githubUrl}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-200 hover:text-white hover:border-[#b5ff00]"
                        >
                          <span>GitHub</span>
                          <ExternalLink className="h-3 w-3 text-zinc-500" />
                        </SafeExternalLink>
                      )}
                      {app.linkedinUrl && (
                        <SafeExternalLink
                          href={app.linkedinUrl}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-blue-300 hover:text-blue-200 hover:border-blue-500"
                        >
                          <span>LinkedIn</span>
                          <ExternalLink className="h-3 w-3 text-zinc-500" />
                        </SafeExternalLink>
                      )}
                      {app.portfolioUrl && (
                        <SafeExternalLink
                          href={app.portfolioUrl}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-cyan-300 hover:text-cyan-200 hover:border-cyan-500"
                        >
                          <span>Portfolio</span>
                          <ExternalLink className="h-3 w-3 text-zinc-500" />
                        </SafeExternalLink>
                      )}
                      {app.showLinksPublicly && (
                        <span className="text-[10px] font-mono text-zinc-500 ml-auto">
                          Links: Public
                        </span>
                      )}
                    </div>

                    {app.applicantNote && (
                      <div className="pt-1.5 border-t border-white/5">
                        <span className="text-[10.5px] text-zinc-400 uppercase font-mono block mb-0.5">Note to Organizers:</span>
                        <p className="text-zinc-300 text-[11px] leading-relaxed break-words font-sans">{app.applicantNote}</p>
                      </div>
                    )}
                  </div>

                  {/* Previous Builder Record Found (Reuse Candidates) */}
                  {reuseCandidates.length > 0 && (
                    <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-2.5">
                      <div className="flex items-center gap-1.5 font-bold text-amber-300">
                        <Sparkles className="h-4 w-4 shrink-0 text-amber-400" />
                        <span>Previous builder record found ({reuseCandidates[0].totalCheckIns || 0} check-ins)</span>
                      </div>
                      <p className="text-[11.5px] text-zinc-300 leading-relaxed">
                        Matching record: <strong className="text-white">{reuseCandidates[0].name}</strong> ({reuseCandidates[0].handle}) with status{' '}
                        <span className="font-mono text-amber-300 font-semibold">{reuseCandidates[0].status}</span>. You can restore this builder's previous participation history or archive the old handle to create a fresh record.
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setLinkConfirmTarget({ user: req, member: reuseCandidates[0] });
                          }}
                          disabled={isProcessing}
                          className="px-3 py-1.5 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] text-black font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>Reuse Record (Restores History)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchiveAndCreateNew(req, reuseCandidates[0])}
                          disabled={isProcessing}
                          className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <span>Create New Record (Archives Old Handle)</span>
                        </button>
                      </div>
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
                      <option value="">-- Register New Member Profile --</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.handle}) — {m.role} [{m.status}]
                        </option>
                      ))}
                    </select>

                    {!currentlyChosenMemberId ? (
                      <p className="text-xs text-zinc-400">
                        Click &quot;Register &amp; Link New&quot; below to add this applicant to the roster.
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Actions: Approve (Invite) | Activate Directly | Register New | Reject */}
                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/10">
                  {currentlyChosenMemberId ? (
                    <>
                      <button
                        onClick={() => handleApprove(req, currentlyChosenMemberId)}
                        disabled={isProcessing}
                        className="btn-glossy-primary flex-1 py-2.5 px-4 rounded-full text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 min-h-11"
                        title="Stages the approval and waits for user acceptance"
                      >
                        {isProcessing ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-black" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5 text-black" />
                        )}
                        <span>
                          {req.status === 'approved_waiting_response'
                            ? 'Re-Send Invite'
                            : 'Approve (Invite)'}
                        </span>
                      </button>

                      <button
                        onClick={() => handleDirectActivate(req, currentlyChosenMemberId)}
                        disabled={isProcessing}
                        className="btn-glossy-secondary py-2.5 px-4 rounded-full text-[#2DE2E6] font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 min-h-11"
                        title="Instantly activates this member without requiring acceptance"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#2DE2E6]" />
                        <span>Activate Directly</span>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleApprove(req)}
                      disabled={isProcessing}
                      className="btn-glossy-secondary flex-1 py-2.5 px-4 rounded-full text-[#2DE2E6] font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 min-h-11"
                    >
                      <UserPlus className="h-3.5 w-3.5 text-[#2DE2E6]" />
                      <span>Register &amp; Link New</span>
                    </button>
                  )}

                  {req.status !== 'declined' ? (
                    <button
                      onClick={() => setConfirmRejectUser(req)}
                      disabled={isProcessing}
                      className="btn-glossy-danger py-2.5 px-4 rounded-full text-xs font-semibold uppercase tracking-wider cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 min-h-11"
                      title="Decline membership access for this account"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Decline</span>
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsed Section: Signed in, no application yet */}
      {unsubmittedUsers.length > 0 && (
        <div className="pt-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={() => setShowUnsubmitted((prev) => !prev)}
            className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-950/60 hover:bg-zinc-900/60 border border-zinc-800/80 transition-colors text-left cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-zinc-800 text-zinc-400">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider block font-mono">
                  Signed in, no application submitted yet ({unsubmittedUsers.length})
                </span>
                <span className="text-[11px] text-zinc-500">
                  Users who signed in with Google but haven't submitted the registration form yet.
                </span>
              </div>
            </div>
            {showUnsubmitted ? (
              <ChevronUp className="h-4 w-4 text-zinc-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-zinc-400" />
            )}
          </button>

          {showUnsubmitted && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {unsubmittedUsers.map((u) => (
                <div
                  key={u.id}
                  className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800/80 space-y-2 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <SecureAvatar
                      src={u.photoURL}
                      name={u.displayName}
                      alt={u.displayName || 'Google User'}
                      size={32}
                      shape="rounded"
                      className="border border-white/5"
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-200 truncate">{u.displayName || 'Google User'}</p>
                      <p className="text-[11px] text-zinc-500 font-mono truncate">{u.email}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-zinc-900 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                    <span>Signed in: {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'Recent'}</span>
                    <span className="text-amber-500/80 font-semibold">Awaiting form</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Link Existing Member Confirmation Modal */}
      {linkConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-3xl glass-modal border border-cyan-500/40 p-6 space-y-4 shadow-[0_25px_60px_rgba(0,0,0,0.95)] text-zinc-100 spatial-card">
            <div className="flex items-center gap-3 border-b border-white/10 pb-3">
              <div className="p-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                <UserCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white uppercase font-display tracking-tight">
                  Link Existing Builder Profile
                </h3>
                <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate max-w-[260px]">
                  {linkConfirmTarget.user.email}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-zinc-400">Applicant:</span>
                <span className="text-white font-semibold truncate max-w-[200px]">{linkConfirmTarget.user.displayName || linkConfirmTarget.user.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Target Member:</span>
                <span className="text-[#b5ff00] font-bold truncate max-w-[200px]">{linkConfirmTarget.member.name} ({linkConfirmTarget.member.handle})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Member Status:</span>
                <span className="text-zinc-300">{linkConfirmTarget.member.status}</span>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              This action will link the applicant&apos;s Google account UID to this builder record and send them an invitation to accept ownership.
            </p>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setLinkConfirmTarget(null)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-[#141720] hover:bg-[#191c27] border border-white/10 text-xs text-zinc-300 font-semibold uppercase tracking-wider transition-colors cursor-pointer min-h-11"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeApproveLink(linkConfirmTarget.user, linkConfirmTarget.member.id)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] text-black font-bold text-xs uppercase tracking-wider transition-all cursor-pointer min-h-11 shadow-[0_0_15px_rgba(181,255,0,0.3)]"
              >
                Confirm Link &amp; Invite
              </button>
            </div>
          </div>
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
                  Decline Membership Request
                </h3>
                <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate max-w-[260px]">
                  {confirmRejectUser.email}
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Are you sure you want to decline this request? The user&apos;s status will be marked as <span className="text-red-400 font-mono font-semibold">declined</span>. They will see that their request was reviewed and can re-submit if needed.
            </p>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRejectUser(null)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-[#141720] hover:bg-[#191c27] border border-white/10 text-xs text-zinc-300 font-semibold uppercase tracking-wider neu-button transition-colors cursor-pointer min-h-11"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="flex-1 py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_15px_rgba(239,68,68,0.3)] active:scale-95 min-h-11"
              >
                Confirm Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
