import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Plus,
  QrCode,
  CheckCircle2,
  Trash2,
  Edit3,
  Search,
  Filter,
  Layers,
  Download,
  UserCheck,
  UserPlus,
  X,
  Lock,
} from 'lucide-react';
import { Session, Member, CheckInRecord, BuilderTrack, SessionStatus, CheckInMode } from '../types';
import { downloadCSV, generateAttendanceCSV } from '../utils/storage';
import { getSessionTemporalInfo, formatTimeInClubTz, formatInClubTz } from '../utils/sessionWindow';
import { m, AnimatePresence } from 'motion/react';
import { fadeUp, fade, stagger } from '../motion/presets';

interface SessionsViewProps {
  sessions: Session[];
  members: Member[];
  checkIns: CheckInRecord[];
  isAdmin?: boolean;
  onOpenAdminLogin?: () => void;
  onOpenNewSession: () => void;
  onEditSession?: (session: Session) => void;
  onLaunchKioskForSession: (sessionId: string) => void;
  onCheckInToSession: (sessionId: string, memberId: string) => void;
  onRemoveCheckIn: (checkIn: CheckInRecord) => void;
  onUpdateSessionStatus?: (sessionId: string, status: SessionStatus, mode?: CheckInMode) => void;
  onDeleteSession?: (session: Session) => void;
}

export const SessionsView: React.FC<SessionsViewProps> = ({
  sessions,
  members,
  checkIns,
  isAdmin = false,
  onOpenAdminLogin,
  onOpenNewSession,
  onEditSession,
  onLaunchKioskForSession,
  onCheckInToSession,
  onRemoveCheckIn,
  onUpdateSessionStatus,
  onDeleteSession,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'upcoming' | 'completed'>('all');
  const [trackFilter, setTrackFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSessionForRoster, setSelectedSessionForRoster] = useState<string | null>(
    sessions[0]?.id || null
  );
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const [manualAddMemberId, setManualAddMemberId] = useState('');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

  const filteredSessions = sessions
    .filter((s) => {
      if (statusFilter !== 'all') {
        const temporal = getSessionTemporalInfo(s);
        if (statusFilter === 'open' && !temporal.isOpenNow) return false;
        if (statusFilter === 'upcoming' && !temporal.isUpcoming) return false;
        if (statusFilter === 'completed' && !temporal.isClosed) return false;
      }
      if (trackFilter !== 'all' && s.track !== trackFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          s.title.toLowerCase().includes(q) ||
          (s.sessionCode && s.sessionCode.toLowerCase().includes(q)) ||
          s.location.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const aDate = a.date || '';
      const bDate = b.date || '';
      const dateCmp = bDate.localeCompare(aDate);
      if (dateCmp !== 0) return dateCmp;
      return (b.startTime || '').localeCompare(a.startTime || '');
    });

  const activeRosterSession = sessions.find((s) => s.id === selectedSessionForRoster) || sessions[0] || null;
  const rosterCheckIns = checkIns.filter((c) => c.sessionId === selectedSessionForRoster);
  const rosterMemberIds = new Set(rosterCheckIns.map((c) => c.memberId));
  const availableMembersToAdd = members.filter((m) => !rosterMemberIds.has(m.id));
  const filteredAvailableMembers = availableMembersToAdd.filter((m) => {
    if (!memberSearchQuery.trim()) return true;
    const q = memberSearchQuery.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.handle.toLowerCase().includes(q) ||
      (m.role && m.role.toLowerCase().includes(q))
    );
  });

  const handleExportSessionCSV = (session: Session) => {
    const records = checkIns.filter((c) => c.sessionId === session.id);
    const csvContent = generateAttendanceCSV(records, members, sessions);
    const cleanCode = (session.sessionCode || session.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadCSV(`den-of-builders-session-${cleanCode}-${session.date}.csv`, csvContent);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-white uppercase">
            Workshop Sessions Directory
          </h1>
          <p className="text-xs text-zinc-400">
            Build sprints, hardware clinics, and systems hack nights
          </p>
        </div>

        {isAdmin ? (
          <button
            onClick={onOpenNewSession}
            className="btn-glossy-primary flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-black rounded-full uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer font-mono"
          >
            <Plus className="h-4 w-4 text-black" />
            <span>New Build Session</span>
          </button>
        ) : (
          onOpenAdminLogin && (
            <button
              onClick={onOpenAdminLogin}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-zinc-300 bg-[#141720] hover:bg-[#1a1e2b] border border-white/10 neu-button hover:border-[#b5ff00]/60 hover:text-white rounded-xl transition-all whitespace-nowrap cursor-pointer"
              title="Sign in as Admin to create new sessions"
            >
              <Lock className="h-3.5 w-3.5 text-[#b5ff00]" />
              <span>Admin Session Controls</span>
            </button>
          )
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
          {/* Status Tabs */}
          <div className="flex items-center p-1 bg-[#0d0f15]/80 border border-white/5 rounded-2xl neu-inset overflow-x-auto max-w-full scrollbar-none shrink-0 w-full sm:w-auto">
            {(['all', 'open', 'upcoming', 'completed'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`flex-1 sm:flex-initial px-3.5 py-2 sm:py-1.5 rounded-xl font-medium transition-all capitalize cursor-pointer font-mono text-[11px] whitespace-nowrap shrink-0 min-h-[44px] sm:min-h-0 flex items-center justify-center ${
                  statusFilter === st
                    ? 'bg-[#181b24] text-[#b5ff00] font-bold border border-[#b5ff00]/30 shadow-[0_2px_8px_rgba(181,255,0,0.15)]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Track Filter */}
          <select
            value={trackFilter}
            onChange={(e) => setTrackFilter(e.target.value)}
            className="w-full sm:w-auto bg-[#141720] border border-white/10 neu-button rounded-xl px-3 py-2.5 sm:py-1.5 text-zinc-200 focus:outline-none focus:border-[#b5ff00] cursor-pointer font-mono text-xs min-h-[44px] sm:min-h-0"
          >
            <option value="all">All Tracks</option>
            <option value="Hardware & Robotics">Hardware & Robotics</option>
            <option value="Software & Systems">Software & Systems</option>
            <option value="AI & Embedded">AI & Embedded</option>
            <option value="Open Hack & Demo">Open Hack & Demo</option>
          </select>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl pl-8 pr-3 py-2.5 sm:py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] min-h-[44px] sm:min-h-0"
          />
        </div>
      </div>

      {/* Sessions Full Width List */}
      <m.div variants={stagger()} initial="hidden" animate="show" className="w-full space-y-3">
        {filteredSessions.length === 0 ? (
          <div className="rounded-3xl glass-panel p-8 text-center text-xs text-zinc-500 spatial-card">
            No sessions match the selected filters.
          </div>
        ) : (
          filteredSessions.map((session, index) => {
            const checkedCount = checkIns.filter((c) => c.sessionId === session.id).length;
            const isSelected = selectedSessionForRoster === session.id;
            const isAnimated = index < 12;

            return (
              <m.div
                key={session.id}
                variants={isAnimated ? fadeUp : undefined}
                onClick={() => {
                  setSelectedSessionForRoster(session.id);
                  setIsRosterOpen(true);
                }}
                className={`rounded-2xl p-4 sm:p-5 transition-all cursor-pointer spatial-card ${
                  isSelected && isRosterOpen
                    ? 'glass-panel border-[#b5ff00]/60 shadow-[0_10px_30px_rgba(0,0,0,0.6),0_0_20px_rgba(181,255,0,0.12)] ring-1 ring-[#b5ff00]/40'
                    : 'glass-panel-interactive'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 min-w-0">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
                      {(() => {
                        const temporal = getSessionTemporalInfo(session);
                        const isNow = temporal.temporalStatus === 'open_now';
                        const isUp = temporal.temporalStatus === 'upcoming';
                        const isCanc = temporal.temporalStatus === 'cancelled';
                        const label = isNow
                          ? 'OPEN NOW'
                          : isUp
                          ? (temporal.badgeVariant === 'upcoming_soon' ? `UPCOMING (${temporal.diffMinutes}M)` : 'UPCOMING')
                          : isCanc
                          ? 'CANCELLED'
                          : 'CLOSED';

                        return (
                          <span
                            className={`font-mono text-[11px] font-bold whitespace-nowrap shrink-0 ${
                              isNow
                                ? 'text-[#b5ff00]'
                                : isUp
                                ? (temporal.badgeVariant === 'upcoming_soon' ? 'text-amber-400' : 'text-cyan-400')
                                : isCanc
                                ? 'text-rose-400'
                                : 'text-zinc-500'
                            }`}
                          >
                            ● {label}
                          </span>
                        );
                      })()}
                      <span aria-hidden="true" className="text-zinc-700 shrink-0">
                        ·
                      </span>
                      <span className="text-zinc-400 truncate">{session.track}</span>
                      {session.sessionCode && (
                        <>
                          <span aria-hidden="true" className="text-zinc-700 shrink-0">·</span>
                          <span className="font-mono text-[#b5ff00] font-semibold whitespace-nowrap shrink-0">
                            {session.sessionCode}
                          </span>
                        </>
                      )}
                    </div>

                    <h3 className="text-base sm:text-lg font-bold font-display text-white break-words">
                      {session.title}
                    </h3>

                    {session.description && (
                      <p className="text-xs text-zinc-400 line-clamp-2">{session.description}</p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono font-bold text-zinc-100 tabular-nums whitespace-nowrap">
                      {checkedCount}
                      {session.maxCapacity && (
                        <span className="text-zinc-500 font-normal"> / {session.maxCapacity}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono whitespace-nowrap">attended</div>
                  </div>
                </div>

                <div className="mt-3.5 pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2.5 text-xs text-zinc-400 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
                    <span className="flex items-center gap-1 font-mono text-zinc-300 whitespace-nowrap" title={session.date}>
                      <Calendar className="h-3 w-3 text-[#b5ff00] shrink-0" />
                      <span>{formatInClubTz(session.date, undefined, { month: 'short', day: 'numeric', weekday: 'short' })}</span>
                    </span>
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <Clock className="h-3 w-3 text-zinc-500 shrink-0" />
                      <span className="font-mono">
                        {session.startAt ? formatTimeInClubTz(session.startAt) : session.startTime || ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 min-w-0">
                      <MapPin className="h-3 w-3 text-zinc-500 shrink-0" />
                      <span className="truncate max-w-[160px] sm:max-w-none">{session.location}</span>
                    </span>
                  </div>

                  {/* Card Actions (Wrap cleanly, min tap target friendly) */}
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    {/* View Roster Action Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSessionForRoster(session.id);
                        setIsRosterOpen(true);
                      }}
                      className="px-3 py-1.5 bg-[#141720] hover:bg-[#1a1e2b] border border-white/10 hover:border-[#b5ff00]/40 text-zinc-200 rounded-full text-[11px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer min-h-[36px]"
                      title="Inspect attendance roster"
                    >
                      <Users className="h-3.5 w-3.5 text-[#b5ff00] shrink-0" />
                      <span>Roster ({checkedCount})</span>
                    </button>

                    {isAdmin && onUpdateSessionStatus && (
                      <>
                        {session.checkInMode === 'open' ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateSessionStatus(session.id, session.status, 'closed');
                            }}
                            className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/40 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-[36px]"
                            title="Close check-in window"
                          >
                            Close check-in
                          </button>
                        ) : (
                          session.status !== 'cancelled' && session.status !== 'completed' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onUpdateSessionStatus(session.id, 'scheduled', 'open');
                              }}
                              className="px-3 py-1.5 bg-[#b5ff00]/15 hover:bg-[#b5ff00]/25 text-[#b5ff00] border border-[#b5ff00]/40 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-[36px]"
                              title="Open check-in now"
                            >
                              Open check-in now
                            </button>
                          )
                        )}
                        {session.status !== 'completed' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateSessionStatus(session.id, 'completed', 'closed');
                            }}
                            className="px-3 py-1.5 bg-[#141720] hover:bg-[#1a1e2b] text-zinc-300 border border-white/10 neu-button rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-[36px]"
                            title="Mark session as completed"
                          >
                            Mark completed
                          </button>
                        )}
                        {session.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateSessionStatus(session.id, 'cancelled', 'closed');
                            }}
                            className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 neu-button rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-[36px]"
                            title="Cancel session"
                          >
                            Cancel
                          </button>
                        )}
                        {(session.status === 'completed' || session.status === 'cancelled') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateSessionStatus(session.id, 'scheduled', 'auto');
                            }}
                            className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/40 neu-button rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-[36px]"
                            title="Reopen session (resets status to scheduled and check-in mode to auto)"
                          >
                            Reopen
                          </button>
                        )}
                      </>
                    )}

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExportSessionCSV(session);
                        }}
                        disabled={checkedCount === 0}
                        className="px-3 py-1.5 bg-[#141720] hover:bg-[#1a1e2b] border border-white/10 neu-button disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 rounded-full text-[11px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer min-h-[36px]"
                        title={checkedCount === 0 ? 'No check-ins recorded yet' : 'Export session check-ins as CSV'}
                      >
                        <Download className="h-3 w-3 text-zinc-400 shrink-0" />
                        <span>CSV</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLaunchKioskForSession(session.id);
                      }}
                      className="px-3 py-1.5 bg-[#b5ff00]/10 hover:bg-[#b5ff00]/20 text-[#b5ff00] border border-[#b5ff00]/40 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer min-h-[36px]"
                      title="Launch gate kiosk for this session"
                    >
                      <QrCode className="h-3 w-3 shrink-0" />
                      <span>Kiosk</span>
                    </button>

                    {isAdmin && onEditSession && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditSession(session);
                        }}
                        className="p-2 text-zinc-400 hover:text-[#b5ff00] hover:bg-white/[0.04] neu-button rounded-full transition-all cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center"
                        title="Edit session details & location"
                        aria-label={`Edit session ${session.title}`}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {isAdmin && onDeleteSession && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session);
                        }}
                        className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/15 border border-transparent hover:border-red-500/30 rounded-full transition-all cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center"
                        title="Delete workshop session"
                        aria-label={`Delete session ${session.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </m.div>
            );
          })
        )}
      </m.div>

      {/* Roster Modal / Bottom Sheet */}
      <AnimatePresence>
        {isRosterOpen && activeRosterSession && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Attendance Roster"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            {/* Backdrop */}
            <m.div
              variants={fade}
              initial="hidden"
              animate="show"
              exit="exit"
              className="fixed inset-0 bg-black/80 backdrop-blur-md cursor-pointer"
              onClick={() => setIsRosterOpen(false)}
              aria-hidden="true"
            />

            {/* Modal / Bottom Sheet Container */}
            <m.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 280 }}
              className="relative w-full sm:max-w-xl max-h-[85dvh] bg-[#0c0e14] border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 flex flex-col shadow-2xl z-10 overflow-hidden"
            >
              {/* Short Header + Single Close Button */}
              <div className="flex items-center justify-between pb-3.5 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Users className="h-5 w-5 text-[#b5ff00] shrink-0" />
                  <h3 className="text-base font-bold font-display text-white tracking-tight truncate">
                    Attendance Roster
                  </h3>
                  <span className="font-mono text-xs font-bold text-[#b5ff00] bg-[#b5ff00]/10 px-2 py-0.5 rounded-full border border-[#b5ff00]/30 shrink-0">
                    {rosterCheckIns.length}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setIsRosterOpen(false)}
                  className="w-11 h-11 flex items-center justify-center rounded-xl bg-[#141720] hover:bg-[#1a1e2b] text-zinc-400 hover:text-white border border-white/10 neu-button transition-colors cursor-pointer shrink-0"
                  aria-label="Close roster"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Scrollable Content Body */}
              <div className="overflow-y-auto pt-4 space-y-4 pr-1">
                {/* Quick Manual Add Member (Admin Only) */}
                {isAdmin && (
                  <div className="space-y-2.5 pb-3 border-b border-white/10">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 font-mono">
                        <UserPlus className="h-3.5 w-3.5 text-[#b5ff00]" />
                        <span>Manual Check-In</span>
                      </label>
                      <span className="text-[10px] text-zinc-400 font-mono">
                        {availableMembersToAdd.length} eligible
                      </span>
                    </div>

                    {availableMembersToAdd.length > 3 && (
                      <div className="relative">
                        <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        <input
                          type="text"
                          value={memberSearchQuery}
                          onChange={(e) => setMemberSearchQuery(e.target.value)}
                          placeholder="Filter by name, handle, role..."
                          className="w-full bg-[#090a0f] border border-white/10 neu-inset rounded-xl pl-7 pr-6 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00]"
                        />
                        {memberSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setMemberSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-white cursor-pointer"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <select
                        value={manualAddMemberId}
                        onChange={(e) => setManualAddMemberId(e.target.value)}
                        className="flex-1 min-w-0 bg-[#0d0f15] border border-white/15 neu-inset rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-[#b5ff00] focus:ring-1 focus:ring-[#b5ff00] cursor-pointer min-h-[44px] transition-all"
                      >
                        <option value="">
                          {filteredAvailableMembers.length === 0
                            ? 'No matching builders found'
                            : `Select builder (${filteredAvailableMembers.length} available)...`}
                        </option>
                        {filteredAvailableMembers.map((m) => (
                          <option key={m.id} value={m.id} className="bg-zinc-950 text-zinc-100 py-1">
                            {m.name} ({m.handle}) — {m.role}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        disabled={!manualAddMemberId}
                        onClick={() => {
                          if (manualAddMemberId) {
                            onCheckInToSession(activeRosterSession.id, manualAddMemberId);
                            setManualAddMemberId('');
                            setMemberSearchQuery('');
                          }
                        }}
                        className="px-4 py-2 bg-[#b5ff00] hover:bg-[#c6ff24] disabled:opacity-30 disabled:cursor-not-allowed text-black text-xs font-bold uppercase tracking-wider rounded-xl transition-all whitespace-nowrap cursor-pointer shadow-[0_0_15px_rgba(181,255,0,0.3)] active:scale-95 min-h-[44px] flex items-center gap-1.5 font-mono shrink-0"
                      >
                        <UserCheck className="h-4 w-4 stroke-[2.5]" />
                        <span>Add</span>
                      </button>
                    </div>

                    {availableMembersToAdd.length > 0 && !memberSearchQuery && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[10px] text-zinc-500 uppercase font-mono">Quick:</span>
                        {availableMembersToAdd.slice(0, 3).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              onCheckInToSession(activeRosterSession.id, m.id);
                            }}
                            className="px-2 py-0.5 rounded-lg bg-[#141720] hover:bg-[#1f2433] hover:text-[#b5ff00] border border-white/5 hover:border-[#b5ff00]/40 text-[11px] text-zinc-300 transition-all font-mono truncate max-w-[140px] cursor-pointer"
                            title={`Click to instantly add ${m.name}`}
                          >
                            + {m.name.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Checked In List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Recorded Check-Ins ({rosterCheckIns.length})</span>
                    <span className="font-mono text-zinc-500">
                      Cap: {activeRosterSession.maxCapacity || 'Unlimited'}
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {rosterCheckIns.length === 0 ? (
                      <div className="p-6 text-center text-xs text-zinc-500 border border-dashed border-white/10 rounded-2xl neu-inset">
                        No check-ins yet for this session.
                      </div>
                    ) : (
                      rosterCheckIns.map((item) => {
                        const mem = members.find((m) => m.id === item.memberId);
                        const displayName = mem?.name || item.memberName || 'Builder';
                        const displayHandle = mem?.handle || item.memberHandle || '';
                        const displayTime = item.checkedInAt
                          ? formatTimeInClubTz(item.checkedInAt)
                          : item.timestamp
                          ? formatTimeInClubTz(item.timestamp)
                          : '';
                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-[#0d0f15] border border-white/10 neu-inset text-xs min-w-0"
                          >
                            <div className="truncate pr-2 min-w-0">
                              <div className="font-semibold text-zinc-200 truncate">{displayName}</div>
                              <div className="text-[11px] text-zinc-500 font-mono truncate">
                                {displayHandle} · {displayTime}
                              </div>
                            </div>

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => onRemoveCheckIn(item)}
                                className="p-2 text-zinc-500 hover:text-red-400 hover:bg-white/[0.04] neu-button rounded-lg transition-colors cursor-pointer shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
                                title="Remove check-in record"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </m.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
