import React, { useState } from 'react';
import {
  User,
  Phone,
  Lock,
  Camera,
  CheckCircle2,
  AlertCircle,
  Save,
  RefreshCw,
} from 'lucide-react';
import { Member, BuilderTrack } from '../types';
import { updateMemberSelfProfile } from '../firebase/firestoreService';
import { ModalSheet } from './ModalSheet';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: Member;
  onProfileUpdated?: (updated: Member) => void;
}

const AVAILABLE_TRACKS: BuilderTrack[] = [
  'Hardware & Robotics',
  'Software & Systems',
  'AI & Embedded',
  'Open Hack & Demo',
];

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  member,
  onProfileUpdated,
}) => {
  const [name, setName] = useState(member.name || '');
  const [email, setEmail] = useState(member.email || '');
  const [phone, setPhone] = useState(member.phone || '');
  const [university, setUniversity] = useState(member.university || '');
  const [department, setDepartment] = useState(member.department || '');
  const [major, setMajor] = useState(member.major || '');
  const [semester, setSemester] = useState(member.semester || '');
  const [avatarUrl, setAvatarUrl] = useState(member.avatarUrl || member.photoURL || '');
  const [bio, setBio] = useState(member.bio || '');
  const [selectedTracks, setSelectedTracks] = useState<BuilderTrack[]>(member.tracks || []);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasUnsavedChanges = Boolean(
    name !== member.name ||
    email !== (member.email || '') ||
    phone !== (member.phone || '') ||
    bio !== (member.bio || '')
  );

  const handleTrackToggle = (track: BuilderTrack) => {
    setSelectedTracks((prev) =>
      prev.includes(track) ? prev.filter((t) => t !== track) : [...prev, track]
    );
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('Please choose an image under 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setError('Name is required.');
      return;
    }

    const cleanEmail = email.trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please provide a valid email address.');
      return;
    }

    const cleanPhone = phone.trim();
    if (cleanPhone && !/^[+0-9\s\-()]{7,25}$/.test(cleanPhone)) {
      setError('Please provide a valid phone number (digits, +, -, spaces only).');
      return;
    }

    setSaving(true);
    try {
      const res = await updateMemberSelfProfile(member.id, {
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        university: university.trim(),
        department: department.trim(),
        major: major.trim(),
        semester: semester.trim(),
        avatarUrl: avatarUrl.trim(),
        bio: bio.trim(),
        tracks: selectedTracks,
      });

      if (res.success) {
        setSuccess('Profile updated successfully!');
        if (onProfileUpdated) {
          onProfileUpdated({
            ...member,
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            university: university.trim(),
            department: department.trim(),
            major: major.trim(),
            semester: semester.trim(),
            avatarUrl: avatarUrl.trim(),
            bio: bio.trim(),
            tracks: selectedTracks,
          });
        }
        setTimeout(() => {
          onClose();
        }, 700);
      } else {
        setError(res.message || 'Failed to update builder profile.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to update builder profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Builder Profile"
      subtitle="Update personal credentials and academic information"
      icon={<User className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth="lg"
      hasUnsavedChanges={hasUnsavedChanges}
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-[#141720] hover:bg-[#191c27] text-zinc-300 text-xs font-semibold neu-button transition-colors cursor-pointer min-h-11"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const form = document.getElementById('edit-profile-form') as HTMLFormElement | null;
              if (form) form.requestSubmit();
            }}
            disabled={saving}
            className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] text-black font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-[0_0_15px_rgba(181,255,0,0.3)] active:scale-95 min-h-11"
          >
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-black" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4 text-black" />
                <span>Save Changes</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <form id="edit-profile-form" onSubmit={handleSubmit} className="space-y-4 text-xs font-sans">
        {error && (
          <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-3 rounded-xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00] flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#b5ff00]" />
            <span>{success}</span>
          </div>
        )}

        {/* Photo & Identity Banner */}
        <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-[#0d0f15] border border-white/10 neu-inset">
          <div className="relative group shrink-0">
            <div className="w-14 h-14 rounded-2xl bg-[#141720] border-2 border-[#b5ff00]/40 overflow-hidden flex items-center justify-center font-display font-black text-lg text-[#b5ff00] neu-raised-sm">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                name.substring(0, 2).toUpperCase() || 'DB'
              )}
            </div>
            <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
              <Camera className="h-5 w-5 text-white" />
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="min-w-0 flex-1">
            <label className="block text-zinc-300 font-medium mb-1 text-xs">
              Avatar Image URL / Upload
            </label>
            <input
              type="text"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://... or click avatar to upload"
              className="w-full bg-[#12141a] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
          </div>
        </div>

        {/* Name & Email */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Rahat Mahadi"
              autoComplete="name"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
          </div>

          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="builder@example.com"
              autoComplete="email"
              inputMode="email"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
          </div>
        </div>

        {/* Phone & Semester */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Phone Number</label>
            <div className="relative">
              <Phone className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+880 1712-345678"
                autoComplete="tel"
                inputMode="tel"
                enterKeyHint="next"
                className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl pl-10 pr-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Semester / Cohort Term</label>
            <input
              type="text"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              placeholder="e.g. 6th Semester / Spring 2026"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
          </div>
        </div>

        {/* University & Department & Major */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">University</label>
            <input
              type="text"
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
              placeholder="e.g. BRAC University"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
          </div>

          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Department</label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. CSE / EEE"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
          </div>

          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Major</label>
            <input
              type="text"
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              placeholder="e.g. Computer Science"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
          </div>
        </div>

        {/* Bio */}
        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Bio / Specialties</label>
          <textarea
            rows={2}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Hardware hacking, robotics firmware, embedded machine learning..."
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-16 text-base sm:text-xs"
          />
        </div>

        {/* Tracks */}
        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Guild Specialty Tracks</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {AVAILABLE_TRACKS.map((t) => {
              const active = selectedTracks.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTrackToggle(t)}
                  className={`px-3 py-2.5 rounded-xl text-left border text-xs font-mono transition-all cursor-pointer min-h-11 flex items-center justify-between ${
                    active
                      ? 'bg-[#b5ff00]/15 border-[#b5ff00]/50 text-[#b5ff00] font-bold neu-raised-sm'
                      : 'bg-[#141720] border-white/5 neu-button text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span>{t}</span>
                  {active && <span className="w-2 h-2 rounded-full bg-[#b5ff00]" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Immutable Security Notice */}
        <div className="p-3.5 rounded-2xl bg-[#0d0f15]/80 border border-white/5 neu-inset text-xs text-zinc-400 flex items-start gap-2.5">
          <Lock className="h-4 w-4 shrink-0 text-[#b5ff00] mt-0.5" />
          <div>
            <span className="font-semibold text-zinc-300">Protected Guild Fields:</span>
            <p className="mt-0.5 text-zinc-400 leading-normal">
              Club Role (<span className="text-[#b5ff00] font-mono">{member.role}</span>) and Attendance Milestones ({member.totalCheckIns || 0} check-ins, {member.currentStreak || 0} streak) are authoritatively managed and verified by Administrators.
            </p>
          </div>
        </div>
      </form>
    </ModalSheet>
  );
};
