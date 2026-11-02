import React, { useState, useEffect, useRef, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CameraOff,
  Upload,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Zap,
  Sparkles,
  Lock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Sliders,
} from 'lucide-react';
import { Session, Member, CheckInRecord, CheckInMethod } from '../types';
import { parseScannedQR, playCheckInChime } from '../utils/qrUtils';
import { useAuth } from '../firebase/AuthContext';
import { AttendanceConfirmationData } from './AttendanceConfirmationModal';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: Session[];
  members: Member[];
  onRecordCheckIn: (
    sessionId: string,
    memberId: string,
    method: CheckInMethod,
    notes?: string
  ) => Promise<{ success: boolean; message: string; record?: CheckInRecord; isDuplicate?: boolean }>;
  onAttendanceConfirmed?: (data: AttendanceConfirmationData) => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  sessions,
  members,
  onRecordCheckIn,
  onAttendanceConfirmed,
}) => {
  const { user, linkedMember, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'camera' | 'upload' | 'manual'>('camera');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Zoom management
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [hardwareZoomSupported, setHardwareZoomSupported] = useState<boolean>(false);
  const [minZoom, setMinZoom] = useState<number>(1);
  const [maxZoom, setMaxZoom] = useState<number>(5);
  const initialTouchDistanceRef = useRef<number | null>(null);
  const initialZoomRef = useRef<number>(1);

  // Success animation state
  const [showSuccessGlow, setShowSuccessGlow] = useState(false);
  const [confirmedAttendeeName, setConfirmedAttendeeName] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    title: string;
    details: string;
    timestamp: string;
  } | null>(null);

  // Manual code entry
  const [manualCode, setManualCode] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    sessions.find((s) => s.status === 'active')?.id || sessions[0]?.id || ''
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Stop camera stream cleanly
  const stopCamera = useCallback(() => {
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
  }, []);

  // Apply zoom to hardware track if supported
  const applyHardwareZoom = useCallback(async (zoomValue: number) => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const capabilities = (track.getCapabilities?.() || {}) as any;
      if (capabilities.zoom) {
        await (track as any).applyConstraints({
          advanced: [{ zoom: zoomValue }],
        });
      }
    } catch {
      // Hardware zoom application fallback to CSS zoom
    }
  }, []);

  const handleZoomChange = (newZoom: number) => {
    const clamped = Math.max(minZoom, Math.min(maxZoom, Number(newZoom.toFixed(1))));
    setZoomLevel(clamped);
    if (hardwareZoomSupported) {
      applyHardwareZoom(clamped);
    }
  };

  // Pinch-to-zoom touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialTouchDistanceRef.current = dist;
      initialZoomRef.current = zoomLevel;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialTouchDistanceRef.current !== null) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = currentDist / initialTouchDistanceRef.current;
      const targetZoom = initialZoomRef.current * ratio;
      handleZoomChange(targetZoom);
    }
  };

  const handleTouchEnd = () => {
    initialTouchDistanceRef.current = null;
  };

  // Process decoded QR payload
  const handleDecodedString = useCallback(
    async (rawString: string, source: CheckInMethod) => {
      if (isProcessing) return;
      setIsProcessing(true);

      if (!user) {
        setFeedback({
          type: 'error',
          title: 'Authentication Required',
          details: 'You must be signed in with Google to record workshop attendance.',
          timestamp: new Date().toLocaleTimeString(),
        });
        setIsProcessing(false);
        return;
      }

      const decoded = parseScannedQR(rawString);

      let targetSession: Session | undefined;
      let targetMember: Member | undefined;

      if (decoded.kind === 'session') {
        if (decoded.sessionId) {
          targetSession = sessions.find((s) => s.id === decoded.sessionId);
        }
        if (!targetSession && decoded.sessionCode) {
          targetSession = sessions.find(
            (s) => s.sessionCode && s.sessionCode.toLowerCase() === decoded.sessionCode?.toLowerCase()
          );
        }

        // Self-check-in uses the authenticated user's linked member ID ONLY
        if (!linkedMember) {
          if (soundEnabled) playCheckInChime('warning');
          setFeedback({
            type: 'warning',
            title: 'Account Not Linked',
            details: 'Your signed-in account is not linked to an approved builder profile in the directory.',
            timestamp: new Date().toLocaleTimeString(),
          });
          setIsProcessing(false);
          return;
        }
        targetMember = linkedMember;
      } else if (decoded.kind === 'member') {
        // Scanned a member pass: Only authorized admins can scan member passes
        if (!isAdmin) {
          if (soundEnabled) playCheckInChime('warning');
          setFeedback({
            type: 'warning',
            title: 'Member Pass Scanned',
            details: 'This is a personal builder pass. To check yourself in, please scan the meeting QR code displayed on the host screen.',
            timestamp: new Date().toLocaleTimeString(),
          });
          setIsProcessing(false);
          return;
        }

        targetSession =
          sessions.find((s) => s.id === selectedSessionId) ||
          sessions.find((s) => s.status === 'active');

        if (decoded.memberId) {
          targetMember = members.find((m) => m.id === decoded.memberId);
        }
        if (!targetMember && decoded.memberHandle) {
          const cleanHandle = decoded.memberHandle.startsWith('@')
            ? decoded.memberHandle
            : `@${decoded.memberHandle}`;
          targetMember = members.find(
            (m) => m.handle.toLowerCase() === cleanHandle.toLowerCase()
          );
        }
      } else {
        // Fallback match by session code
        const matchedByCode = sessions.find(
          (s) =>
            (s.sessionCode && s.sessionCode.toLowerCase() === rawString.toLowerCase()) ||
            s.id.toLowerCase() === rawString.toLowerCase()
        );
        if (matchedByCode) {
          targetSession = matchedByCode;
          if (linkedMember) targetMember = linkedMember;
        }
      }

      // Validations
      if (!targetSession) {
        if (soundEnabled) playCheckInChime('warning');
        setFeedback({
          type: 'warning',
          title: 'Unrecognized QR Code',
          details: 'Could not identify an active build session from this code. Please scan the official meeting QR code.',
          timestamp: new Date().toLocaleTimeString(),
        });
        setIsProcessing(false);
        return;
      }

      if (targetSession.status !== 'active' && !isAdmin) {
        if (soundEnabled) playCheckInChime('warning');
        setFeedback({
          type: 'warning',
          title: 'Session Check-In Closed',
          details: `Check-in is currently ${targetSession.status.toUpperCase()} for "${targetSession.title}".`,
          timestamp: new Date().toLocaleTimeString(),
        });
        setIsProcessing(false);
        return;
      }

      if (!targetMember) {
        if (soundEnabled) playCheckInChime('warning');
        setFeedback({
          type: 'warning',
          title: 'Builder Not Identified',
          details: 'Could not match this code with a registered member profile.',
          timestamp: new Date().toLocaleTimeString(),
        });
        setIsProcessing(false);
        return;
      }

      try {
        const res = await onRecordCheckIn(targetSession.id, targetMember.id, source);

        if (res.success) {
          if (soundEnabled) playCheckInChime('success');
          setShowSuccessGlow(true);
          setConfirmedAttendeeName(targetMember.name);
          setFeedback({
            type: 'success',
            title: 'Attendance Confirmed!',
            details: `${targetMember.name} recorded for ${targetSession.title}.`,
            timestamp: new Date().toLocaleTimeString(),
          });

          setTimeout(() => {
            setShowSuccessGlow(false);
            if (onAttendanceConfirmed && res.record && targetMember && targetSession) {
              onAttendanceConfirmed({
                member: targetMember,
                session: targetSession,
                record: res.record,
                isDuplicate: false,
                isOwnDevice: true,
              });
            }
          }, 1200);
        } else if (res.isDuplicate) {
          if (soundEnabled) playCheckInChime('warning');
          setFeedback({
            type: 'warning',
            title: 'Already Checked In',
            details: res.message,
            timestamp: new Date().toLocaleTimeString(),
          });
        } else {
          if (soundEnabled) playCheckInChime('warning');
          setFeedback({
            type: 'error',
            title: 'Check-In Verification Failed',
            details: res.message,
            timestamp: new Date().toLocaleTimeString(),
          });
        }
      } catch (err: any) {
        setFeedback({
          type: 'error',
          title: 'Network or Permission Error',
          details: err?.message || 'Failed to verify check-in in Firestore.',
          timestamp: new Date().toLocaleTimeString(),
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [
      isProcessing,
      user,
      linkedMember,
      isAdmin,
      sessions,
      selectedSessionId,
      members,
      soundEnabled,
      onRecordCheckIn,
      onAttendanceConfirmed,
    ]
  );

  // Scan frame animation loop
  const scanFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data) {
          handleDecodedString(code.data, 'camera_scan');
          return;
        }
      }
    }
    scanLoopRef.current = requestAnimationFrame(scanFrame);
  }, [handleDecodedString]);

  // Start Camera
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setIsScanning(true);
    try {
      let stream: MediaStream | null = null;
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        // Fallback: try basic video stream without strict facingMode or resolution constraints
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch {
          throw firstErr;
        }
      }

      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = (track.getCapabilities?.() || {}) as any;
        if (capabilities.zoom) {
          setHardwareZoomSupported(true);
          setMinZoom(capabilities.zoom.min || 1);
          setMaxZoom(capabilities.zoom.max || 5);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        scanLoopRef.current = requestAnimationFrame(scanFrame);
      }
    } catch (err: any) {
      console.warn('Camera stream error:', err);
      let msg = 'Could not access device camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission denied. Please allow camera permissions or enter the session code manually.';
      } else if (
        err.name === 'NotFoundError' ||
        err.name === 'DevicesNotFoundError' ||
        err.name === 'OverconstrainedError' ||
        err.message?.includes('Requested device not found')
      ) {
        msg = 'No video camera detected on this device.';
      } else {
        msg = `Camera unavailable (${err.message || err.name || 'Device error'}).`;
      }
      setCameraError(msg);
      setIsScanning(false);
    }
  }, [scanFrame]);

  // Lifecycle: handle camera start/stop and pause when tab is hidden
  useEffect(() => {
    if (isOpen && activeTab === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopCamera();
      } else if (document.visibilityState === 'visible' && isOpen && activeTab === 'camera') {
        startCamera();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopCamera();
    };
  }, [isOpen, activeTab, startCamera, stopCamera]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-xl p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-t-[32px] sm:rounded-[28px] bg-[#0c0e14]/95 border border-white/10 shadow-[0_30px_90px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.15)] grain-overlay overflow-hidden my-0 sm:my-6 max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 sm:px-6 py-3.5 bg-white/[0.02] shrink-0 sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[#b5ff00] shadow-[0_0_8px_rgba(181,255,0,0.8)] animate-pulse" />
            <h2 className="text-base font-bold font-display uppercase tracking-tight text-white">
              Meeting QR Scanner
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio chime toggle */}
            <button
              onClick={() => setSoundEnabled((prev) => !prev)}
              className="min-w-11 min-h-11 w-11 h-11 flex items-center justify-center rounded-xl bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title={soundEnabled ? 'Mute check-in sound' : 'Enable check-in sound'}
              aria-label={soundEnabled ? 'Mute check-in sound' : 'Enable check-in sound'}
            >
              {soundEnabled ? (
                <Volume2 className="h-4 w-4 text-[#b5ff00]" />
              ) : (
                <VolumeX className="h-4 w-4 text-zinc-600" />
              )}
            </button>
            <button
              onClick={onClose}
              aria-label="Close scanner modal"
              className="min-w-11 min-h-11 w-11 h-11 flex items-center justify-center rounded-xl bg-zinc-900 border border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#b5ff00]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="p-2 border-b border-white/10 bg-[#0d0f15]/80 shrink-0">
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-black/60 border border-white/5 neu-inset text-xs font-mono">
            <button
              onClick={() => setActiveTab('camera')}
              className={`min-h-11 py-2 px-3 rounded-xl font-semibold transition-all cursor-pointer flex items-center justify-center ${
                activeTab === 'camera'
                  ? 'bg-[#141720] text-[#b5ff00] neu-raised-sm font-bold border border-[#b5ff00]/30 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Live Camera
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`min-h-11 py-2 px-3 rounded-xl font-semibold transition-all cursor-pointer flex items-center justify-center ${
                activeTab === 'upload'
                  ? 'bg-[#141720] text-[#b5ff00] neu-raised-sm font-bold border border-[#b5ff00]/30 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Upload Photo
            </button>
            <button
              onClick={() => setActiveTab('manual')}
              className={`min-h-11 py-2 px-3 rounded-xl font-semibold transition-all cursor-pointer flex items-center justify-center ${
                activeTab === 'manual'
                  ? 'bg-[#141720] text-[#b5ff00] neu-raised-sm font-bold border border-[#b5ff00]/30 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Enter Code
            </button>
          </div>
        </div>

        {/* Body Viewport */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 overscroll-contain pb-safe">
          {/* Tab 1: Live Camera Viewport */}
          {activeTab === 'camera' && (
            <div className="space-y-4">
              <div
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className={`relative w-full aspect-square rounded-2xl bg-black border overflow-hidden flex items-center justify-center transition-all ${
                  showSuccessGlow
                    ? 'border-[#b5ff00] shadow-[0_0_50px_rgba(181,255,0,0.5)] ring-4 ring-[#b5ff00]/40'
                    : 'border-zinc-800'
                }`}
              >
                <video
                  ref={videoRef}
                  style={{ transform: `scale(${zoomLevel})` }}
                  className="w-full h-full object-cover transition-transform duration-75"
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Viewfinder Target Framing overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div
                    className={`w-64 h-64 border-2 rounded-2xl transition-all duration-300 relative ${
                      showSuccessGlow
                        ? 'border-[#b5ff00] bg-[#b5ff00]/15 scale-105'
                        : 'border-[#b5ff00]/50 border-dashed'
                    }`}
                  >
                    {/* Viewfinder Corners */}
                    <div className="absolute -top-1 -left-1 w-5 h-5 border-t-3 border-l-3 border-[#b5ff00]" />
                    <div className="absolute -top-1 -right-1 w-5 h-5 border-t-3 border-r-3 border-[#b5ff00]" />
                    <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-3 border-l-3 border-[#b5ff00]" />
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-3 border-r-3 border-[#b5ff00]" />
                  </div>
                </div>

                {/* Confetti & Success Animation Overlay */}
                {showSuccessGlow && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center gap-3 animate-in fade-in zoom-in-95 duration-200">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-full bg-[#b5ff00] flex items-center justify-center shadow-[0_0_35px_rgba(181,255,0,0.7)] animate-bounce">
                        <CheckCircle2 className="h-12 w-12 text-black" />
                      </div>
                      <div className="absolute -inset-3 rounded-full border-2 border-[#b5ff00]/40 animate-ping" />
                    </div>
                    <p className="text-base font-bold font-display uppercase tracking-wider text-[#b5ff00]">
                      Verified &amp; Confirmed!
                    </p>
                    {confirmedAttendeeName && (
                      <p className="text-xs text-white font-mono">{confirmedAttendeeName}</p>
                    )}
                  </div>
                )}

                {/* Camera error message */}
                {cameraError && (
                  <div className="absolute inset-0 bg-zinc-950/95 p-6 flex flex-col items-center justify-center text-center gap-3 animate-in fade-in">
                    <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                      <CameraOff className="h-6 w-6 text-rose-400" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-rose-200">{cameraError}</p>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        You can enter the workshop code directly or upload a QR image.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                      <button
                        onClick={() => setActiveTab('manual')}
                        className="px-3.5 py-2 rounded-xl bg-[#b5ff00] hover:bg-[#a3e600] text-black font-semibold text-xs transition-colors"
                      >
                        Enter Code Manually
                      </button>
                      <button
                        onClick={() => setActiveTab('upload')}
                        className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
                      >
                        Upload QR Image
                      </button>
                      <button
                        onClick={startCamera}
                        className="px-3 py-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
                      >
                        Retry Camera
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Supported Camera Zoom Controls */}
              <div className="p-3 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <Sliders className="h-3.5 w-3.5 text-[#b5ff00]" />
                    <span>Camera Zoom Control ({zoomLevel.toFixed(1)}x)</span>
                  </div>
                  <span className="text-[10px] text-zinc-500">Pinch or select preset</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleZoomChange(zoomLevel - 0.5)}
                    className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                    title="Zoom out"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>

                  <input
                    type="range"
                    min={minZoom}
                    max={maxZoom}
                    step={0.1}
                    value={zoomLevel}
                    onChange={(e) => handleZoomChange(Number(e.target.value))}
                    className="flex-1 accent-[#b5ff00] cursor-pointer"
                  />

                  <button
                    onClick={() => handleZoomChange(zoomLevel + 0.5)}
                    className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                    title="Zoom in"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Quick zoom presets */}
                <div className="flex items-center justify-center gap-2 pt-1 font-mono text-[11px]">
                  {[1, 1.5, 2, 3, 5].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => handleZoomChange(preset)}
                      className={`px-2.5 py-0.5 rounded-md border transition-colors cursor-pointer ${
                        Math.abs(zoomLevel - preset) < 0.1
                          ? 'bg-[#b5ff00]/20 border-[#b5ff00]/50 text-[#b5ff00] font-bold'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {preset}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Upload Photo */}
          {activeTab === 'upload' && (
            <div className="space-y-4 text-center">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-video rounded-2xl border-2 border-dashed border-zinc-800 hover:border-[#b5ff00]/60 bg-zinc-900/40 p-8 flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer"
              >
                <Upload className="h-8 w-8 text-[#b5ff00]" />
                <div>
                  <p className="text-xs font-bold text-white">Click to Select QR Code Photo</p>
                  <p className="text-[11px] text-zinc-500 mt-1">Supports PNG, JPG, or screenshot</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const img = new Image();
                      img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          ctx.drawImage(img, 0, 0);
                          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                          const code = jsQR(imgData.data, imgData.width, imgData.height);
                          if (code && code.data) {
                            handleDecodedString(code.data, 'camera_scan');
                          } else {
                            setFeedback({
                              type: 'warning',
                              title: 'QR Code Not Found',
                              details: 'Could not detect a clear QR code in this uploaded image. Try another screenshot.',
                              timestamp: new Date().toLocaleTimeString(),
                            });
                          }
                        }
                      };
                      img.src = ev.target?.result as string;
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </div>
            </div>
          )}

          {/* Tab 3: Manual Code Entry */}
          {activeTab === 'manual' && (
            <div className="space-y-4">
              <div>
                <label className="block text-zinc-300 font-medium text-xs mb-1">
                  Target Session
                </label>
                <select
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-xs text-zinc-200 focus:outline-none focus:border-[#b5ff00] min-h-11 cursor-pointer"
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} · {s.date} · {s.status.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-300 font-medium text-xs mb-1">
                  Meeting Code
                </label>
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  placeholder="e.g. DOB-2610-101"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck="false"
                  enterKeyHint="done"
                  className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-xs text-zinc-200 font-mono uppercase focus:outline-none focus:border-[#b5ff00] min-h-11"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  if (manualCode.trim()) {
                    handleDecodedString(manualCode.trim(), 'code_input');
                  }
                }}
                disabled={!manualCode.trim() || isProcessing}
                className="btn-glossy-primary w-full min-h-11 py-3.5 px-6 rounded-full disabled:opacity-50 text-black font-bold text-xs uppercase tracking-wider cursor-pointer flex items-center justify-center"
              >
                Verify Code &amp; Record Attendance
              </button>
            </div>
          )}

          {/* Feedback status cards */}
          {feedback && (
            <div
              className={`p-3.5 rounded-2xl border text-xs flex items-start gap-3 ${
                feedback.type === 'success'
                  ? 'bg-[#b5ff00]/10 border-[#b5ff00]/40 text-zinc-200'
                  : feedback.type === 'warning'
                  ? 'bg-amber-950/60 border-amber-800 text-amber-200'
                  : 'bg-red-950/60 border-red-800 text-red-200'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 text-[#b5ff00] shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle
                  className={`h-5 w-5 shrink-0 mt-0.5 ${
                    feedback.type === 'warning' ? 'text-amber-400' : 'text-red-400'
                  }`}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white">{feedback.title}</p>
                <p className="text-[11px] text-zinc-300 mt-0.5">{feedback.details}</p>
                <span className="text-[10px] text-zinc-500 font-mono mt-1 block">
                  Logged at {feedback.timestamp}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
