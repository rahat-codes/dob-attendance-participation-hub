import React, { useState, useEffect } from 'react';
import { UserPlus, AlertCircle, RefreshCw, CheckCircle2, Camera } from 'lucide-react';
import { Member, BuilderRole, BuilderTrack } from '../types';
import { ModalSheet } from './ModalSheet';
import { processProfilePhoto } from '../utils/imageUtils';
import { SecureAvatar } from './common/SecureAvatar';

interface AddMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddMember: (member: Member) => Promise<void> | void;
  onUpdateMember?: (member: Member) => Promise<void> | void;
  initialMember?: Member | null;
  prefill?: {
    name?: string;
    email?: string;
    handle?: string;
    authUid?: string;
    studentId?: string;
    university?: string;
  } | null;
}

export const AddMemberModal: React.FC<AddMemberModalProps> = ({
  isOpen,
  onClose,
  onAddMember,
  onUpdateMember,
  initialMember,
  prefill,
}) => {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [studentId, setStudentId] = useState('');
  const [university, setUniversity] = useState('Tongmyong University');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [role, setRole] = useState<BuilderRole>('Builder');
  const [bio, setBio] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<BuilderTrack[]>(['Hardware & Robotics']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (initialMember) {
      setName(initialMember.name);
      setHandle(initialMember.handle);
      setEmail(initialMember.email || '');
      setStudentId(initialMember.studentId || '');
      setUniversity(initialMember.university || 'Tongmyong University');
      setAvatarUrl(initialMember.avatarUrl || initialMember.photoURL || '');
      setRole(initialMember.role);
      setBio(initialMember.bio || '');
      setSelectedTracks(initialMember.tracks || ['Hardware & Robotics']);
      setFormError(null);
      setFormSuccess(null);
    } else if (prefill) {
      setName(prefill.name || '');
      setHandle(prefill.handle || '');
      setEmail(prefill.email || '');
      setStudentId(prefill.studentId || '');
      setUniversity(prefill.university || 'Tongmyong University');
      setAvatarUrl('');
      setRole('Builder');
      setBio('');
      setSelectedTracks(['Hardware & Robotics']);
      setFormError(null);
      setFormSuccess(null);
    } else {
      setName('');
      setHandle('');
      setEmail('');
      setStudentId('');
      setUniversity('Tongmyong University');
      setAvatarUrl('');
      setRole('Builder');
      setBio('');
      setSelectedTracks(['Hardware & Robotics']);
      setFormError(null);
      setFormSuccess(null);
    }
  }, [initialMember, prefill, isOpen]);

  const hasUnsavedChanges = Boolean(
    name.trim() || handle.trim() || email.trim() || studentId.trim() || bio.trim() || avatarUrl.trim() || (university !== 'Tongmyong University')
  );

  const toggleTrack = (track: BuilderTrack) => {
    if (selectedTracks.includes(track)) {
      if (selectedTracks.length > 1) {
        setSelectedTracks(selectedTracks.filter((t) => t !== track));
      }
    } else {
      setSelectedTracks([...selectedTracks, track]);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessingImage(true);
    setFormError(null);
    try {
      // Accepts any sized image file and auto-scales/center-crops to ~25KB JPEG
      const optimized = await processProfilePhoto(file, 256, 0.85);
      setAvatarUrl(optimized);
    } catch (err: any) {
      console.error('Image processing error:', err);
      setFormError('Could not process this image. Please choose another image file.');
    } finally {
      setProcessingImage(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setFormError('Builder name is required.');
      return;
    }

    const cleanHandle = handle.trim();
    if (!cleanHandle) {
      setFormError('Builder handle is required.');
      return;
    }
    const formattedHandle = cleanHandle.startsWith('@') ? cleanHandle : `@${cleanHandle}`;

    const cleanEmail = email.trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormError('Please provide a valid email address.');
      return;
    }

    setIsSubmitting(true);
    try {
      let finalAvatarUrl = avatarUrl.trim();
      if (finalAvatarUrl.startsWith('data:image/') && finalAvatarUrl.length > 80000) {
        try {
          finalAvatarUrl = await processProfilePhoto(finalAvatarUrl, 256, 0.85);
        } catch (imgErr) {
          console.warn('Could not re-compress data URL, continuing with original:', imgErr);
        }
      }

      if (initialMember && onUpdateMember) {
        const updated: Member = {
          ...initialMember,
          name: cleanName,
          handle: formattedHandle,
          email: cleanEmail || initialMember.email,
          studentId: studentId.trim() || undefined,
          university: university.trim() || 'Tongmyong University',
          avatarUrl: finalAvatarUrl || initialMember.avatarUrl,
          role,
          tracks: selectedTracks.length > 0 ? selectedTracks : ['Hardware & Robotics'],
          bio: bio.trim(),
        };
        await onUpdateMember(updated);
        setFormSuccess('Builder profile updated successfully!');
      } else {
        const newMember: Member = {
          id: `mem_${Date.now()}`,
          name: cleanName,
          handle: formattedHandle,
          email: cleanEmail || `${formattedHandle.replace('@', '')}@denofbuilders.org`,
          studentId: studentId.trim() || undefined,
          university: university.trim() || 'Tongmyong University',
          avatarUrl: finalAvatarUrl || undefined,
          ...(prefill?.authUid ? { authUid: prefill.authUid } : {}),
          role,
          tracks: selectedTracks.length > 0 ? selectedTracks : ['Hardware & Robotics'],
          joinedDate: new Date().toISOString().split('T')[0],
          status: 'Active',
          totalCheckIns: 0,
          currentStreak: 0,
          bestStreak: 0,
          bio: bio.trim() || 'New member of Den of Builders.',
        };
        await onAddMember(newMember);
        setFormSuccess(`Successfully registered ${cleanName} in the guild roster!`);
      }
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('Builder save error:', err);
      setFormError(err?.message || 'Failed to save builder profile. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isEditing = Boolean(initialMember);

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Builder Profile' : 'Register Club Builder'}
      subtitle={isEditing ? `Update details for ${initialMember?.name}` : 'Add a craftsman to Den of Builders roster'}
      icon={<UserPlus className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth="md"
      hasUnsavedChanges={hasUnsavedChanges}
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="flex-1 sm:flex-initial py-2.5 px-4 rounded-xl bg-[#141720] hover:bg-[#191c27] text-zinc-300 font-bold uppercase tracking-wider text-xs neu-button transition-colors cursor-pointer disabled:opacity-50 min-h-11"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => {
              const form = document.getElementById('add-member-form') as HTMLFormElement | null;
              if (form) form.requestSubmit();
            }}
            disabled={isSubmitting}
            className="flex-1 sm:flex-initial py-2.5 px-5 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] text-black font-bold uppercase tracking-wider text-xs transition-all cursor-pointer shadow-[0_0_15px_rgba(181,255,0,0.3)] active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 min-h-11"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-black" />
                <span>Saving...</span>
              </>
            ) : (
              <span>{isEditing ? 'Save Changes' : 'Add Builder'}</span>
            )}
          </button>
        </div>
      }
    >
      <form id="add-member-form" onSubmit={handleSubmit} className="space-y-4 text-xs font-sans">
        {formError && (
          <div className="p-3 rounded-xl bg-red-950/70 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{formError}</span>
          </div>
        )}

        {formSuccess && (
          <div className="p-3 rounded-xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00] text-xs flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#b5ff00]" />
            <span>{formSuccess}</span>
          </div>
        )}

        {/* Photo & Identity Banner */}
        <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-[#0d0f15] border border-white/10 neu-inset">
          <div className="relative group shrink-0">
            <div className="w-14 h-14 rounded-2xl border-2 border-[#b5ff00]/40 overflow-hidden flex items-center justify-center neu-raised-sm relative">
              {processingImage ? (
                <RefreshCw className="h-6 w-6 text-[#b5ff00] animate-spin" />
              ) : (
                <SecureAvatar
                  src={avatarUrl}
                  name={name}
                  size={56}
                  shape="rounded"
                  fallbackClassName="font-display font-black text-lg text-[#b5ff00]"
                />
              )}
            </div>
            <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
              <Camera className="h-5 w-5 text-white" />
              <input
                type="file"
                accept="image/*"
                disabled={processingImage}
                onChange={handlePhotoUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="min-w-0 flex-1">
            <label className="block text-zinc-300 font-medium mb-1 text-xs">
              Builder Photo (Any size, auto-centered)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="Upload photo or paste URL"
                className="w-full bg-[#12141a] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
              />
              <label className="shrink-0 px-3 py-2 rounded-xl bg-[#1f2330] hover:bg-[#282d3e] text-zinc-200 border border-white/10 text-xs font-semibold cursor-pointer flex items-center gap-1.5 transition-colors min-h-11">
                <Camera className="w-4 h-4 text-[#b5ff00]" />
                <span>Upload</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={processingImage}
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Builder Full Name</label>
          <input
            type="text"
            required
            disabled={isSubmitting}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Maya Chen"
            autoComplete="name"
            enterKeyHint="next"
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors disabled:opacity-50 min-h-11 text-base sm:text-xs"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Builder Handle</label>
            <input
              type="text"
              required
              disabled={isSubmitting}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@mayac"
              autoComplete="username"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] font-mono transition-colors disabled:opacity-50 min-h-11 text-base sm:text-xs"
            />
          </div>
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Guild Role</label>
            <select
              value={role}
              disabled={isSubmitting}
              onChange={(e) => setRole(e.target.value as BuilderRole)}
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] cursor-pointer disabled:opacity-50 min-h-11 text-base sm:text-xs"
            >
              <option value="Member">Member</option>
              <option value="Project Leader">Project Leader</option>
              <option value="Vice President">Vice President</option>
              <option value="President">President</option>
              <option value="Builder">Builder</option>
              <option value="Lead">Lead</option>
              <option value="Founder">Founder</option>
              <option value="Apprentice">Apprentice</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Email Address</label>
          <input
            type="email"
            disabled={isSubmitting}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="maya.chen@buildlab.io"
            autoComplete="email"
            inputMode="email"
            enterKeyHint="next"
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors disabled:opacity-50 min-h-11 text-base sm:text-xs"
          />
        </div>

        {/* Student ID & University */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Student ID</label>
            <input
              type="text"
              disabled={isSubmitting}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="e.g. 20241234"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] font-mono transition-colors disabled:opacity-50 min-h-11 text-base sm:text-xs"
            />
          </div>

          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">University</label>
            <input
              type="text"
              required
              disabled={isSubmitting}
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
              placeholder="Tongmyong University"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors disabled:opacity-50 min-h-11 text-base sm:text-xs"
            />
          </div>
        </div>

        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Primary Tracks</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(
              [
                'Hardware & Robotics',
                'Software & Systems',
                'AI & Embedded',
                'Open Hack & Demo',
              ] as BuilderTrack[]
            ).map((t) => {
              const checked = selectedTracks.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => toggleTrack(t)}
                  className={`p-3 rounded-xl border text-left text-xs transition-all cursor-pointer disabled:opacity-50 min-h-11 flex items-center justify-between ${
                    checked
                      ? 'bg-[#b5ff00]/15 border-[#b5ff00]/50 text-[#b5ff00] font-bold neu-raised-sm'
                      : 'bg-[#141720] border-white/5 neu-button text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span>{t}</span>
                  {checked && <span className="w-2 h-2 rounded-full bg-[#b5ff00]" />}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">Bio / Specialties</label>
          <textarea
            rows={2}
            disabled={isSubmitting}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="e.g. High-speed circuit design, FPGA verilog..."
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] resize-none disabled:opacity-50 min-h-16 text-base sm:text-xs"
          />
        </div>
      </form>
    </ModalSheet>
  );
};
