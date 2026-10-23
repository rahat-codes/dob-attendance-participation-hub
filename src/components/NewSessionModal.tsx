import React, { useState, useEffect } from 'react';
import { Calendar, Save, AlertCircle, RefreshCw, CheckCircle2, MapPin, Clock, Edit2 } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { Session, BuilderTrack, SessionStatus } from '../types';
import { ModalSheet } from './ModalSheet';
import { todayInClubTz, parseDateTimeInZone, formatDateInClubTz, formatInClubTz } from '../utils/sessionWindow';
import { DEFAULT_CLUB_TIMEZONE } from '../config/constants';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSession: (session: Session) => Promise<void> | void;
  existingSessionsCount?: number;
  initialSession?: Session | null;
}

const COMMON_LOCATIONS = [
  'Bay 4 Prototyping Workshop',
  'Innovation Lab · Room 302',
  'Hardware & Robotics Lab',
  'Systems & Firmware Hub',
  'Maker Space Main Lab',
];

const normalizeDateInput = (val: any): string => {
  if (!val) return todayInClubTz();
  if (typeof val === 'string') {
    if (val.includes('T')) return val.split('T')[0];
    if (val.includes(' ')) return val.split(' ')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  }
  return formatDateInClubTz(val);
};

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  isOpen,
  onClose,
  onSaveSession,
  existingSessionsCount = 0,
  initialSession,
}) => {
  const isEditing = !!initialSession;

  const [title, setTitle] = useState('');
  const [track, setTrack] = useState<BuilderTrack>('Hardware & Robotics');
  const [date, setDate] = useState(() => todayInClubTz());
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('21:30');
  const [location, setLocation] = useState('Bay 4 Prototyping Workshop');
  const [description, setDescription] = useState('');
  const [points, setPoints] = useState(25);
  const [maxCapacity, setMaxCapacity] = useState(24);
  const [status, setStatus] = useState<SessionStatus>('active');
  const [host, setHost] = useState('Rahat Mahadi');
  const [customCode, setCustomCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialSession) {
      setTitle(initialSession.title || '');
      setTrack(initialSession.track || 'Hardware & Robotics');
      setDate(normalizeDateInput(initialSession.date || initialSession.startAt));
      setStartTime(initialSession.startTime || '18:00');
      setEndTime(initialSession.endTime || '21:30');
      setLocation(initialSession.location || 'Bay 4 Prototyping Workshop');
      setDescription(initialSession.description || '');
      setPoints(initialSession.points || 25);
      setMaxCapacity(initialSession.maxCapacity || 24);
      setStatus(initialSession.status || 'active');
      setHost(initialSession.host || 'Guild Lead');
      setCustomCode(initialSession.sessionCode || '');
      setError(null);
      setSuccessMessage(null);
    } else {
      setTitle('');
      setTrack('Hardware & Robotics');
      setDate(todayInClubTz());
      setStartTime('18:00');
      setEndTime('21:30');
      setLocation('Bay 4 Prototyping Workshop');
      setDescription('');
      setPoints(25);
      setMaxCapacity(24);
      setStatus('active');
      setHost('Rahat Mahadi');
      setCustomCode('');
      setError(null);
      setSuccessMessage(null);
    }
  }, [initialSession, isOpen]);

  const [isManualDateMode, setIsManualDateMode] = useState(false);

  const hasUnsavedChanges = Boolean(
    (title.trim() && (!initialSession || title.trim() !== initialSession.title)) ||
    (initialSession && date !== normalizeDateInput(initialSession.date || initialSession.startAt)) ||
    (initialSession && startTime.trim() !== (initialSession.startTime || '')) ||
    (initialSession && endTime.trim() !== (initialSession.endTime || '')) ||
    (initialSession && location.trim() !== (initialSession.location || ''))
  );

  const adjustDateByDays = (deltaDays: number) => {
    try {
      const [y, m, d] = (date || todayInClubTz()).split('-').map(Number);
      const cur = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays, 12, 0, 0));
      const ny = cur.getUTCFullYear();
      const nm = String(cur.getUTCMonth() + 1).padStart(2, '0');
      const nd = String(cur.getUTCDate()).padStart(2, '0');
      setDate(`${ny}-${nm}-${nd}`);
    } catch {
      setDate(todayInClubTz());
    }
  };

  const setDateToDayOfWeek = (targetDay: number) => {
    try {
      const [y, m, d] = (date || todayInClubTz()).split('-').map(Number);
      const cur = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
      const currentDay = cur.getUTCDay();
      let diff = (targetDay - currentDay + 7) % 7;
      if (diff === 0) diff = 7;
      cur.setUTCDate(cur.getUTCDate() + diff);
      const ny = cur.getUTCFullYear();
      const nm = String(cur.getUTCMonth() + 1).padStart(2, '0');
      const nd = String(cur.getUTCDate()).padStart(2, '0');
      setDate(`${ny}-${nm}-${nd}`);
    } catch {
      setDate(todayInClubTz());
    }
  };

  const setQuickTimeRange = (start: string, end: string) => {
    setStartTime(start);
    setEndTime(end);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Session title is required.');
      return;
    }

    const cleanLocation = location.trim();
    if (!cleanLocation) {
      setError('Meeting location / room is required.');
      return;
    }

    if (cleanLocation.length > 150) {
      setError('Meeting location cannot exceed 150 characters.');
      return;
    }

    let finalSessionCode = customCode.trim().replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
    if (!finalSessionCode) {
      if (initialSession?.sessionCode) {
        finalSessionCode = initialSession.sessionCode;
      } else {
        const dateFormatted = date.replace(/-/g, '').substring(2);
        const randomSuffix = Math.floor(100 + Math.random() * 900);
        finalSessionCode = `DOB-${dateFormatted}-${randomSuffix}`;
      }
    }

    const tz = initialSession?.timezone || DEFAULT_CLUB_TIMEZONE;
    const startAtDate = parseDateTimeInZone(date, startTime.trim() || '18:00', tz);
    const endAtDate = parseDateTimeInZone(date, endTime.trim() || '21:30', tz);

    const sessionPayload: Session = {
      ...(initialSession || {}),
      id: initialSession?.id || `sess_${Date.now()}`,
      title: cleanTitle,
      track,
      date,
      startTime: startTime.trim() || '18:00',
      endTime: endTime.trim() || '21:30',
      startAt: Timestamp.fromDate(startAtDate),
      endAt: Timestamp.fromDate(endAtDate),
      timezone: tz,
      location: cleanLocation,
      description: description.trim() || 'Club builder sprint and hands-on laboratory session.',
      sessionCode: finalSessionCode,
      points: Number(points) || 20,
      maxCapacity: Number(maxCapacity) || 25,
      status,
      host: host.trim() || 'Guild Lead',
      createdAt: initialSession?.createdAt || new Date().toISOString(),
    };

    setIsSubmitting(true);
    try {
      await onSaveSession(sessionPayload);
      setSuccessMessage(isEditing ? 'Build session updated!' : 'Build session created!');
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('Session save failed:', err);
      setError(err?.message || 'Failed to save build session. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Build Session' : 'Schedule Build Session'}
      subtitle={isEditing ? 'Update meeting location, schedule, or details' : 'Configure workshop sprint details'}
      icon={<Calendar className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth="lg"
      hasUnsavedChanges={hasUnsavedChanges}
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-[#141720] hover:bg-[#191c27] text-zinc-300 text-xs font-semibold neu-button cursor-pointer disabled:opacity-50 min-h-11"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => {
              const form = document.getElementById('new-session-form') as HTMLFormElement | null;
              if (form) form.requestSubmit();
            }}
            disabled={isSubmitting}
            className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] text-black font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_20px_rgba(181,255,0,0.3)] active:scale-95 disabled:opacity-50 min-h-11"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-black" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4 text-black" />
                <span>{isEditing ? 'Save Changes' : 'Create Session'}</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <form id="new-session-form" onSubmit={handleSubmit} className="space-y-4 text-xs font-sans">
        {error && (
          <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 rounded-xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00] flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#b5ff00]" />
            <span>{successMessage}</span>
          </div>
        )}

        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Session Title</label>
          <input
            type="text"
            disabled={isSubmitting}
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Edge AI Camera & Sensor Fusion Night"
            autoComplete="off"
            enterKeyHint="next"
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Track</label>
            <select
              value={track}
              onChange={(e) => setTrack(e.target.value as BuilderTrack)}
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] cursor-pointer min-h-11 text-base sm:text-xs"
            >
              <option value="Hardware & Robotics">Hardware & Robotics</option>
              <option value="Software & Systems">Software & Systems</option>
              <option value="AI & Embedded">AI & Embedded</option>
              <option value="Open Hack & Demo">Open Hack & Demo</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SessionStatus)}
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] cursor-pointer min-h-11 text-base sm:text-xs"
            >
              <option value="active">Active Now (Kiosk Ready)</option>
              <option value="upcoming">Upcoming</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>

        {/* Date Section with Quick Presets, Calendar, and Direct Selectors */}
        <div className="space-y-2.5 p-3 rounded-2xl bg-zinc-950/70 border border-white/10 neu-raised-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-zinc-200 font-semibold text-xs flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-[#b5ff00]" />
              <span>Meeting Date &amp; Time</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsManualDateMode((prev) => !prev)}
                className="text-[11px] text-zinc-400 hover:text-[#b5ff00] flex items-center gap-1 font-mono transition-colors cursor-pointer"
                title="Toggle input mode"
              >
                <Edit2 className="h-3 w-3" />
                <span>{isManualDateMode ? 'Show Standard Pickers' : 'Type Raw YYYY-MM-DD'}</span>
              </button>
            </div>
          </div>

          {/* Formatted Date Banner */}
          <div className="p-2.5 rounded-xl bg-[#141720] border border-[#b5ff00]/30 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#b5ff00] animate-pulse" />
              <span className="text-xs font-bold text-white font-display">
                {formatInClubTz(date, undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <span className="text-xs font-mono text-[#b5ff00] font-semibold">
              {startTime} &ndash; {endTime}
            </span>
          </div>

          {/* Primary Pickers Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <span className="block text-[11px] text-zinc-400 font-mono mb-1">Date (YYYY-MM-DD)</span>
              {isManualDateMode ? (
                <input
                  type="text"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value.trim())}
                  placeholder="YYYY-MM-DD"
                  pattern="\d{4}-\d{2}-\d{2}"
                  title="Format: YYYY-MM-DD (e.g. 2026-10-17)"
                  className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] font-mono min-h-11 text-sm"
                />
              ) : (
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => {
                    if (e.target.value) setDate(e.target.value);
                  }}
                  style={{ colorScheme: 'dark' }}
                  className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] font-mono min-h-11 text-sm cursor-pointer"
                />
              )}
            </div>

            <div>
              <span className="block text-[11px] text-zinc-400 font-mono mb-1">Start Time (24h)</span>
              <input
                type="text"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="18:00"
                inputMode="numeric"
                enterKeyHint="next"
                className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] font-mono min-h-11 text-sm"
              />
            </div>

            <div>
              <span className="block text-[11px] text-zinc-400 font-mono mb-1">End Time (24h)</span>
              <input
                type="text"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="21:30"
                inputMode="numeric"
                enterKeyHint="next"
                className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] font-mono min-h-11 text-sm"
              />
            </div>
          </div>

          {/* Quick Date Presets Chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] font-mono">
            <span className="text-zinc-500 text-[10px] uppercase font-semibold mr-0.5">Quick Date:</span>
            <button
              type="button"
              onClick={() => setDate(todayInClubTz())}
              className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                date === todayInClubTz()
                  ? 'bg-[#b5ff00]/20 border-[#b5ff00] text-[#b5ff00] font-bold shadow-[0_0_10px_rgba(181,255,0,0.2)]'
                  : 'bg-[#141720] border-white/10 text-zinc-300 hover:text-white hover:border-[#b5ff00]/40'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => adjustDateByDays(1)}
              className="px-2.5 py-1 rounded-lg bg-[#141720] border border-white/10 text-zinc-300 hover:text-white hover:border-[#b5ff00]/40 transition-colors cursor-pointer"
            >
              +1 Day (Tomorrow)
            </button>
            <button
              type="button"
              onClick={() => adjustDateByDays(-1)}
              className="px-2.5 py-1 rounded-lg bg-[#141720] border border-white/10 text-zinc-300 hover:text-white hover:border-[#b5ff00]/40 transition-colors cursor-pointer"
            >
              -1 Day
            </button>
            <button
              type="button"
              onClick={() => setDateToDayOfWeek(5)}
              className="px-2.5 py-1 rounded-lg bg-[#141720] border border-white/10 text-zinc-300 hover:text-white hover:border-[#b5ff00]/40 transition-colors cursor-pointer"
            >
              This Fri
            </button>
            <button
              type="button"
              onClick={() => setDateToDayOfWeek(6)}
              className="px-2.5 py-1 rounded-lg bg-[#141720] border border-white/10 text-zinc-300 hover:text-white hover:border-[#b5ff00]/40 transition-colors cursor-pointer"
            >
              This Sat
            </button>
            <button
              type="button"
              onClick={() => adjustDateByDays(7)}
              className="px-2.5 py-1 rounded-lg bg-[#141720] border border-white/10 text-zinc-300 hover:text-white hover:border-[#b5ff00]/40 transition-colors cursor-pointer"
            >
              +7 Days
            </button>

            <span className="text-zinc-600 mx-1">|</span>
            <span className="text-zinc-500 text-[10px] uppercase font-semibold mr-0.5">Time:</span>
            <button
              type="button"
              onClick={() => setQuickTimeRange('18:00', '21:00')}
              className="px-2 py-1 rounded-lg bg-[#141720] border border-white/10 text-zinc-300 hover:text-white hover:border-[#b5ff00]/40 transition-colors cursor-pointer"
            >
              18:00–21:00
            </button>
            <button
              type="button"
              onClick={() => setQuickTimeRange('18:30', '21:30')}
              className="px-2 py-1 rounded-lg bg-[#141720] border border-white/10 text-zinc-300 hover:text-white hover:border-[#b5ff00]/40 transition-colors cursor-pointer"
            >
              18:30–21:30
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-zinc-300 font-medium flex items-center gap-1 text-xs">
              <MapPin className="h-3.5 w-3.5 text-[#b5ff00]" />
              <span>Meeting Location / Lab Room</span>
            </label>
          </div>
          <input
            type="text"
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Bay 4 Prototyping Workshop or Room 302"
            autoComplete="street-address"
            enterKeyHint="next"
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {COMMON_LOCATIONS.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setLocation(loc)}
                className={`text-xs px-2.5 py-1.5 rounded-xl border font-mono transition-colors cursor-pointer min-h-9 ${
                  location === loc
                    ? 'bg-[#b5ff00]/15 border-[#b5ff00]/40 text-[#b5ff00] font-bold neu-raised-sm'
                    : 'bg-[#141720] border-white/5 neu-button text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Max Capacity</label>
            <input
              type="number"
              value={maxCapacity}
              onChange={(e) => setMaxCapacity(Number(e.target.value))}
              min={1}
              inputMode="numeric"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] font-mono min-h-11 text-base sm:text-xs"
            />
          </div>
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Builder Pts</label>
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(Number(e.target.value))}
              min={5}
              inputMode="numeric"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] font-mono min-h-11 text-base sm:text-xs"
            />
          </div>
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Session Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Rahat Mahadi"
              autoComplete="name"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] min-h-11 text-base sm:text-xs"
            />
          </div>
        </div>

        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">
            Custom Check-in Code (Optional)
          </label>
          <input
            type="text"
            value={customCode}
            onChange={(e) => setCustomCode(e.target.value)}
            placeholder="Leave blank to auto-generate"
            autoCapitalize="characters"
            autoComplete="off"
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2 text-zinc-100 font-mono uppercase placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] min-h-11 text-base sm:text-xs"
          />
        </div>

        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Agenda / Description</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Hands-on workshop, robotics debugging, and guild systems review..."
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] min-h-16 text-base sm:text-xs"
          />
        </div>
      </form>
    </ModalSheet>
  );
};
