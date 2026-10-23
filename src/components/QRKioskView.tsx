import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  QrCode,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Users,
  MapPin,
  Clock,
  Sparkles,
  CheckCircle,
  Download,
  Copy,
  Check,
  AlertTriangle,
  RefreshCw,
  Search,
  ArrowLeft,
} from 'lucide-react';
import { m } from 'motion/react';
import { Session, Member, CheckInRecord, CheckInMethod } from '../types';
import { generateQRCodeDataUrl, encodeSessionQRPayload, playCheckInChime } from '../utils/qrUtils';
import { generateSecureToken, formatBackupCode } from '../utils/token';
import { writeKioskToken } from '../firebase/firestoreService';
import { getSessionState, formatTimeInClubTz, formatInClubTz } from '../utils/sessionWindow';
import { downloadCSV, generateAttendanceCSV } from '../utils/storage';
import { TOKEN_ROTATION_SECONDS } from '../config/constants';

interface QRKioskViewProps {
  sessions: Session[];
  members: Member[];
  checkIns: CheckInRecord[];
  isAdmin?: boolean;
  onOpenAdminLogin?: () => void;
  onRecordCheckIn: (
    sessionId: string,
    memberId: string,
    method: CheckInMethod
  ) => Promise<{ success: boolean; message: string; record?: CheckInRecord; isDuplicate?: boolean }> | { success: boolean; message: string; record?: CheckInRecord; isDuplicate?: boolean };
  onOpenScanner: () => void;
  onCloseCheckIn?: (sessionId: string) => void;
  activeKioskSessionId?: string | null;
  onExitKiosk?: () => void;
}

export const QRKioskView: React.FC<QRKioskViewProps> = ({
  sessions,
  members,
  checkIns,
  isAdmin = false,
  onOpenAdminLogin,
  onRecordCheckIn,
  onOpenScanner,
  onCloseCheckIn,
  activeKioskSessionId,
  onExitKiosk,
}) => {
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    activeKioskSessionId || sessions.find((s) => s.status === 'scheduled')?.id || sessions[0]?.id || ''
  );

  useEffect(() => {
    if (activeKioskSessionId && sessions.some((s) => s.id === activeKioskSessionId)) {
      setSelectedSessionId(activeKioskSessionId);
    }
  }, [activeKioskSessionId, sessions]);

  const [currentToken, setCurrentToken] = useState<string>(() => generateSecureToken());
  const [prevToken, setPrevToken] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(TOKEN_ROTATION_SECONDS);
  const [searchMemberQuery, setSearchMemberQuery] = useState<string>('');
  const [hasCopiedLink, setHasCopiedLink] = useState<boolean>(false);
  const [manualCheckInStatus, setManualCheckInStatus] = useState<string | null>(null);

  const currentSession = sessions.find((s) => s.id === selectedSessionId) || sessions[0];
  const sessionCheckIns = checkIns.filter((c) => c.sessionId === currentSession?.id);
  const checkedInMemberIds = new Set(sessionCheckIns.map((c) => c.memberId));

  const sessionState = currentSession ? getSessionState(currentSession) : null;
  const isOpen = sessionState?.phase === 'open';

  // Rotation callback
  const rotateToken = useCallback(async () => {
    if (!currentSession || !isOpen || !isAdmin) return;

    const nextToken = generateSecureToken();
    setPrevToken(currentToken);
    setCurrentToken(nextToken);
    setCountdown(TOKEN_ROTATION_SECONDS);

    try {
      await writeKioskToken(currentSession.id, nextToken, currentToken);
    } catch (err) {
      console.warn('Failed to commit rotated kiosk token:', err);
    }
  }, [currentSession, isOpen, isAdmin, currentToken]);

  // Initial token registration on session open
  useEffect(() => {
    if (currentSession && isOpen && isAdmin) {
      writeKioskToken(currentSession.id, currentToken, prevToken).catch(() => {});
    }
  }, [currentSession?.id, isOpen, isAdmin]);

  // Real 45s countdown ticker & rotation trigger
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          rotateToken();
          return TOKEN_ROTATION_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, rotateToken]);

  // Regenerate QR data URL whenever currentToken or session changes
  useEffect(() => {
    if (!currentSession) return;
    const payload = encodeSessionQRPayload(currentSession.id, currentToken);

    generateQRCodeDataUrl(payload, {
      width: 440,
      darkColor: '#08090d',
      lightColor: '#ffffff',
      errorCorrectionLevel: 'M',
    }).then((url) => {
      setQrDataUrl(url);
    });
  }, [currentSession, currentToken]);

  // Screen Wake Lock API to prevent display sleep during kiosk check-in
  useEffect(() => {
    let wakeLock: any = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && (navigator as any).wakeLock) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Silently catch wake lock rejections
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, []);

  // Synchronize fullscreen state with browser fullscreenchange event
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleCopyBackupLink = () => {
    if (!currentSession) return;
    const link = encodeSessionQRPayload(currentSession.id, currentToken);
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(link);
      setHasCopiedLink(true);
      setTimeout(() => setHasCopiedLink(false), 2500);
    }
  };

  const handleExportCSV = () => {
    if (!currentSession) return;
    const csv = generateAttendanceCSV(sessionCheckIns, members, sessions);
    downloadCSV(`den-of-builders-attendance-${currentSession.date}.csv`, csv);
  };

  const handleManualCheckIn = async (memberId: string) => {
    if (!currentSession) return;
    const mem = members.find((m) => m.id === memberId);
    if (mem?.status === 'Inactive') {
      setManualCheckInStatus(`Cannot check in ${mem.name}: Member status is Inactive.`);
      setTimeout(() => setManualCheckInStatus(null), 4000);
      return;
    }

    try {
      const res = await onRecordCheckIn(currentSession.id, memberId, 'manual_entry');
      if (soundEnabled) {
        playCheckInChime(res.success ? 'success' : 'warning');
      }
      setManualCheckInStatus(res.message);
      setTimeout(() => setManualCheckInStatus(null), 3000);
    } catch (err: any) {
      setManualCheckInStatus(err?.message || 'Check-in failed');
      setTimeout(() => setManualCheckInStatus(null), 4000);
    }
  };

  const filteredRoster = members.filter((m) => {
    if (m.status === 'Inactive') return false;
    if (searchMemberQuery.trim()) {
      const q = searchMemberQuery.toLowerCase();
      return m.name.toLowerCase().includes(q) || m.handle.toLowerCase().includes(q);
    }
    return true;
  });

  const isOverCapacity =
    currentSession?.maxCapacity && sessionCheckIns.length > currentSession.maxCapacity;

  return (
    <div className="space-y-6">
      {/* Fullscreen Overlay Exit Kiosk Button (always reachable in fullscreen mode) */}
      {isFullscreen && onExitKiosk && (
        <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
          <button
            type="button"
            onClick={onExitKiosk}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-black/85 backdrop-blur-md border border-[#b5ff00]/50 text-[#b5ff00] text-xs font-bold uppercase tracking-wider shadow-2xl hover:bg-black transition-all cursor-pointer min-h-11"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Exit Kiosk</span>
          </button>
        </div>
      )}

      {/* Kiosk Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          {onExitKiosk && (
            <button
              type="button"
              onClick={onExitKiosk}
              aria-label="Exit Kiosk and return to Meetings"
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 hover:border-[#b5ff00]/40 text-xs font-bold uppercase tracking-wider text-zinc-200 hover:text-[#b5ff00] transition-colors cursor-pointer min-h-11 focus-visible:ring-2 focus-visible:ring-[#b5ff00]"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Meetings</span>
            </button>
          )}

          <div className="p-2 rounded-2xl bg-zinc-900 border border-white/10">
            <img
              src="/dob_logo-192.png"
              alt="Den of Builders"
              className="w-8 h-8 object-contain"
              width={32}
              height={32}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/logo.svg';
              }}
            />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black font-display uppercase tracking-tight text-white flex items-center gap-2">
              <span>Entrance Check-In Kiosk</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#b5ff00]/15 text-[#b5ff00] font-bold">
                Projector Mode
              </span>
            </h1>
            <p className="text-xs text-zinc-400">
              High-visibility rotating gate display with phone-camera auto check-in
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {sessions.length > 1 && (
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              aria-label="Select session for kiosk"
              className="px-3 py-2 rounded-xl bg-[#141720] border border-white/10 text-xs font-mono text-zinc-200 focus:outline-none min-h-[44px]"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date} — {s.title}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-label={soundEnabled ? 'Mute audio' : 'Enable audio'}
            className="p-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-white/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4 text-[#b5ff00]" /> : <VolumeX className="h-4 w-4" />}
          </button>

          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="p-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-white/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            onClick={handleExportCSV}
            aria-label="Export session attendance as CSV"
            className="px-3.5 py-2.5 rounded-xl bg-[#141720] hover:bg-zinc-800 border border-white/10 text-xs font-mono text-zinc-200 flex items-center gap-1.5 min-h-[44px] cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-[#b5ff00]" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </div>

      {manualCheckInStatus && (
        <div className="p-3 rounded-2xl bg-zinc-900 border border-[#b5ff00]/40 text-xs font-mono text-[#b5ff00] animate-in fade-in flex items-center justify-between">
          <span>{manualCheckInStatus}</span>
          <button onClick={() => setManualCheckInStatus(null)} className="text-zinc-500 hover:text-white px-2 py-1">
            ✕
          </button>
        </div>
      )}

      {currentSession ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Main Stage: QR Projection Card */}
          <div className="lg:col-span-7 xl:col-span-8 rounded-3xl glass-panel p-6 sm:p-10 spatial-card border border-white/10 text-center flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-[#b5ff00]/5 rounded-full blur-3xl pointer-events-none" />

            <div className="space-y-2 mb-6">
              <span className="px-3 py-1 rounded-xl bg-[#b5ff00]/15 border border-[#b5ff00]/40 text-[#b5ff00] text-xs font-mono font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${isOpen ? 'bg-[#b5ff00] animate-ping' : 'bg-zinc-500'}`} />
                {isOpen ? 'Check-In Window Active' : 'Check-In Closed'}
              </span>
              <h2 className="text-2xl sm:text-3xl font-black font-display text-white uppercase tracking-tight">
                {currentSession.title}
              </h2>
              <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-mono text-zinc-400">
                <span className="flex items-center gap-1 text-zinc-300">
                  <Clock className="h-3.5 w-3.5 text-[#b5ff00]" />
                  <span>
                    {formatTimeInClubTz(currentSession.startAt)} – {formatTimeInClubTz(currentSession.endAt)} (KST)
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-[#b5ff00]" />
                  <span>{currentSession.location}</span>
                </span>
              </div>
            </div>

            {/* Responsive QR Code Display using min(80vw, 70dvh, 640px) */}
            <div
              className="relative p-3 sm:p-5 rounded-3xl bg-white shadow-[0_0_50px_rgba(181,255,0,0.25)] border-4 border-zinc-950 inline-flex items-center justify-center transition-transform hover:scale-[1.01] max-w-full"
              style={{
                width: 'min(80vw, 70dvh, 640px)',
                height: 'min(80vw, 70dvh, 640px)',
              }}
            >
              {qrDataUrl ? (
                <m.img
                  key={currentToken}
                  src={qrDataUrl}
                  alt="Session Check-In QR Code"
                  initial={{ opacity: 0.85 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="w-full h-full object-contain block"
                  loading="eager"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-800 font-mono text-xs">
                  Generating secure code...
                </div>
              )}
            </div>

            {/* Countdown Progress Bar reflecting real 45s next rotation */}
            <div className="w-full max-w-md mt-6 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 text-[#b5ff00]" />
                  <span>Rotating Security Token</span>
                </span>
                <span className="font-bold text-white">{countdown}s</span>
              </div>
              <div className="h-2 w-full rounded-full bg-zinc-900 border border-white/5 overflow-hidden">
                <m.div
                  key={currentToken}
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: TOKEN_ROTATION_SECONDS, ease: 'linear' }}
                  className="h-full bg-[#b5ff00] rounded-full shadow-[0_0_10px_rgba(181,255,0,0.8)]"
                />
              </div>
            </div>

            {/* Backup Code Display */}
            <div className="mt-6 p-4 rounded-2xl bg-[#0e1017] border border-white/10 neu-inset w-full max-w-md text-center space-y-1">
              <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
                Camera Unavailable? Use 8-Character Backup Code:
              </span>
              <div className="flex items-center justify-center gap-3">
                <span className="font-mono text-2xl font-black text-[#b5ff00] tracking-widest select-all">
                  {formatBackupCode(currentToken)}
                </span>
                <button
                  onClick={handleCopyBackupLink}
                  aria-label="Copy check-in link"
                  className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  {hasCopiedLink ? <Check className="h-4 w-4 text-[#b5ff00]" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Right Rail: Real-time Attendance & Door Staff Tools */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-6">
            {/* Live Count & Soft Capacity Card */}
            <div className="p-6 rounded-3xl glass-panel border border-white/10 spatial-card space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-bold flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#b5ff00]" />
                  <span>Live Attendance Count</span>
                </span>
                {currentSession.maxCapacity && (
                  <span className={`text-xs font-mono font-bold ${isOverCapacity ? 'text-amber-400' : 'text-zinc-400'}`}>
                    {sessionCheckIns.length} / {currentSession.maxCapacity} Capacity
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black font-display text-white">
                  {sessionCheckIns.length}
                </span>
                <span className="text-xs font-mono text-zinc-400">builders checked in</span>
              </div>

              {isOverCapacity && (
                <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-600/60 text-amber-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                  <span>
                    Soft room capacity ({currentSession.maxCapacity}) exceeded. Members are not blocked, but please check lab seating.
                  </span>
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <button
                  onClick={onOpenScanner}
                  className="flex-1 py-3 px-4 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] text-black text-xs font-bold font-display uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_15px_rgba(181,255,0,0.25)] min-h-[44px]"
                >
                  Door Staff Scanner
                </button>
              </div>
            </div>

            {/* Quick Manual Check-In List for Door Staff */}
            <div className="p-6 rounded-3xl glass-panel border border-white/10 spatial-card space-y-3">
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-300 flex items-center justify-between">
                <span>Roster Fast Check-In</span>
                <span className="text-zinc-500 text-[11px] font-normal">{filteredRoster.length} active builders</span>
              </h3>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                <input
                  type="text"
                  value={searchMemberQuery}
                  onChange={(e) => setSearchMemberQuery(e.target.value)}
                  placeholder="Quick search builder name..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#0e1017] border border-white/10 text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-none min-h-[40px]"
                />
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                {filteredRoster.map((member) => {
                  const isCheckedIn = checkedInMemberIds.has(member.id);
                  return (
                    <div
                      key={member.id}
                      className="p-2.5 rounded-xl bg-[#0e1017]/70 border border-white/5 flex items-center justify-between gap-2 text-xs font-mono"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-white truncate">{member.name}</p>
                        <p className="text-[11px] text-zinc-500 truncate">{member.handle}</p>
                      </div>

                      {isCheckedIn ? (
                        <span className="px-2.5 py-1 rounded-lg bg-[#b5ff00]/15 text-[#b5ff00] text-[10px] font-bold uppercase shrink-0">
                          Checked In
                        </span>
                      ) : (
                        <button
                          onClick={() => handleManualCheckIn(member.id)}
                          aria-label={`Check in ${member.name}`}
                          className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-[#b5ff00] hover:text-black text-zinc-300 text-[11px] font-bold uppercase transition-colors shrink-0 cursor-pointer min-h-[36px]"
                        >
                          Check In
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center rounded-3xl glass-panel text-zinc-500 text-xs font-mono">
          No scheduled sessions found. Please schedule a session first.
        </div>
      )}
    </div>
  );
};
