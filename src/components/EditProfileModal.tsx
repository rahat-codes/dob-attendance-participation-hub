import React, { useState, useEffect, useRef } from 'react';
import {
  User,
  Phone,
  Lock,
  Camera,
  CheckCircle2,
  AlertCircle,
  Save,
  RefreshCw,
  Trophy,
  ShieldCheck,
  Sparkles,
  LogOut,
  Globe,
  Share2,
} from 'lucide-react';
import { Member, BuilderTrack, MemberPrivate } from '../types';
import { updateMemberSelfProfile } from '../firebase/firestoreService';
import { ModalSheet } from './ModalSheet';
import { processProfilePhoto } from '../utils/imageUtils';
import { SecureAvatar } from './common/SecureAvatar';
import { Switch } from '../ui/Switch';
import { normalizeGitHubUrl, normalizeLinkedInUrl, normalizePortfolioUrl } from '../utils/profileLinks';
import { formatUserFriendlyFirestoreError } from '../utils/firestoreErrors';
import { BUILDER_TRACKS } from '../config/constants';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: Member;
  memberPrivate?: MemberPrivate | null;
  isMandatory?: boolean;
  onSignOut?: () => void;
  onProfileUpdated?: (updated: Member) => void;
}

const AVAILABLE_TRACKS: readonly BuilderTrack[] = BUILDER_TRACKS;

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  member,
  memberPrivate,
  isMandatory = false,
  onSignOut,
  onProfileUpdated,
}) => {
  const [name, setName] = useState(member.name || '');
  const [email, setEmail] = useState(member.email || memberPrivate?.email || '');
  const [phone, setPhone] = useState(member.phone || memberPrivate?.phone || '');
  const [studentId, setStudentId] = useState(member.studentId || memberPrivate?.studentId || '');
  const [university, setUniversity] = useState(member.university || memberPrivate?.university || 'Tongmyong University');
  const [department, setDepartment] = useState(member.department || memberPrivate?.department || '');
  const [major, setMajor] = useState(member.major || memberPrivate?.major || '');
  const [semester, setSemester] = useState(member.semester || memberPrivate?.semester || '');
  const [avatarUrl, setAvatarUrl] = useState(member.avatarUrl || member.photoURL || '');
  const [bio, setBio] = useState(member.bio || '');
  const [selectedTracks, setSelectedTracks] = useState<BuilderTrack[]>(member.tracks || []);
  const [showOnLeaderboard, setShowOnLeaderboard] = useState<boolean>(!member.leaderboardOptOut);

  // Social & portfolio links
  const [githubUrl, setGithubUrl] = useState(member.githubUrl || '');
  const [linkedinUrl, setLinkedinUrl] = useState(member.linkedinUrl || '');
  const [portfolioUrl, setPortfolioUrl] = useState(member.portfolioUrl || '');
  const [showLinksPublicly, setShowLinksPublicly] = useState<boolean>(member.showLinksPublicly ?? true);

  const initializedSessionKeyRef = useRef<string | null>(null);
  const appliedPrivateRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      initializedSessionKeyRef.current = null;
      appliedPrivateRef.current = false;
      return;
    }

    const sessionKey = member.id;
    const isFreshOpen = initializedSessionKeyRef.current !== sessionKey;
    if (isFreshOpen) {
      initializedSessionKeyRef.current = sessionKey;
      appliedPrivateRef.current = Boolean(memberPrivate);
      setName(member.name || '');
      setEmail(member.email || memberPrivate?.email || '');
      setPhone(member.phone || memberPrivate?.phone || '');
      setStudentId(member.studentId || memberPrivate?.studentId || '');
      setUniversity(member.university || memberPrivate?.university || 'Tongmyong University');
      setDepartment(member.department || memberPrivate?.department || '');
      setMajor(member.major || memberPrivate?.major || '');
      setSemester(member.semester || memberPrivate?.semester || '');
      setAvatarUrl(member.avatarUrl || member.photoURL || '');
      setBio(member.bio || '');
      setSelectedTracks(member.tracks && member.tracks.length > 0 ? member.tracks : ['Software & Systems']);
      setShowOnLeaderboard(!member.leaderboardOptOut);
      setGithubUrl(member.githubUrl || '');
      setLinkedinUrl(member.linkedinUrl || '');
      setPortfolioUrl(member.portfolioUrl || '');
      setShowLinksPublicly(member.showLinksPublicly ?? true);
      setError(null);
      setSuccess(null);
    } else if (memberPrivate && !appliedPrivateRef.current) {
      // Backfill late-arriving private fields only if the user hasn't typed into them yet
      appliedPrivateRef.current = true;
      if (memberPrivate.email) setEmail((prev) => prev || memberPrivate.email || '');
      if (memberPrivate.phone) setPhone((prev) => prev || memberPrivate.phone || '');
      if (memberPrivate.studentId) setStudentId((prev) => prev || memberPrivate.studentId || '');
      if (memberPrivate.university) setUniversity((prev) => (prev && prev !== 'Tongmyong University' ? prev : memberPrivate.university || prev));
      if (memberPrivate.department) setDepartment((prev) => prev || memberPrivate.department || '');
      if (memberPrivate.major) setMajor((prev) => prev || memberPrivate.major || '');
      if (memberPrivate.semester) setSemester((prev) => prev || memberPrivate.semester || '');
    }
  }, [isOpen, member, memberPrivate]);

  const [saving, setSaving] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasUnsavedChanges = Boolean(
    name !== (member.name || '') ||
    email !== (member.email || memberPrivate?.email || '') ||
    phone !== (member.phone || memberPrivate?.phone || '') ||
    studentId !== (member.studentId || memberPrivate?.studentId || '') ||
    university !== (member.university || memberPrivate?.university || 'Tongmyong University') ||
    department !== (member.department || memberPrivate?.department || '') ||
    major !== (member.major || memberPrivate?.major || '') ||
    semester !== (member.semester || memberPrivate?.semester || '') ||
    avatarUrl !== (member.avatarUrl || member.photoURL || '') ||
    bio !== (member.bio || '') ||
    showOnLeaderboard !== !member.leaderboardOptOut ||
    githubUrl !== (member.githubUrl || '') ||
    linkedinUrl !== (member.linkedinUrl || '') ||
    portfolioUrl !== (member.portfolioUrl || '') ||
    showLinksPublicly !== (member.showLinksPublicly ?? true)
  );

  const handleTrackToggle = (track: BuilderTrack) => {
    setSelectedTracks((prev) =>
      prev.includes(track) ? prev.filter((t) => t !== track) : [...prev, track]
    );
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessingImage(true);
    setError(null);
    try {
      const optimized = await processProfilePhoto(file, 256, 0.85);
      setAvatarUrl(optimized);
    } catch (err: any) {
      console.error('Image processing error:', err);
      setError('Could not process this image. Please choose another image file.');
    } finally {
      setProcessingImage(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 100) {
      setError('Full Name must be between 1 and 100 characters.');
      return;
    }

    if (bio.trim().length > 500) {
      setError('Bio cannot exceed 500 characters.');
      return;
    }

    const trimmedAvatar = avatarUrl.trim();
    if (trimmedAvatar.toLowerCase().startsWith('http://')) {
      setError('Avatar URL must use https:// or be uploaded as an image file.');
      return;
    }
    if (trimmedAvatar.startsWith('https://') && trimmedAvatar.length > 500) {
      setError('Avatar HTTPS URL cannot exceed 500 characters.');
      return;
    }

    const cleanStudentId = studentId.trim();
    if (isMandatory && !cleanStudentId) {
      setError('Student ID is mandatory for club roster registration.');
      return;
    }

    const cleanEmail = email.trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please provide a valid email address.');
      return;
    }

    const cleanPhone = phone.trim();
    if (isMandatory && !cleanPhone) {
      setError('Phone number is mandatory for member communication and check-in confirmation.');
      return;
    }
    if (cleanPhone && !/^[+0-9\s\-()]{7,25}$/.test(cleanPhone)) {
      setError('Please provide a valid phone number (digits, +, -, spaces only).');
      return;
    }

    if (isMandatory && selectedTracks.length === 0) {
      setError('Please select at least one guild specialty track.');
      return;
    }

    let canonicalGh = githubUrl.trim();
    if (canonicalGh) {
      const ghRes = normalizeGitHubUrl(canonicalGh);
      if (!ghRes.valid) {
        setError(ghRes.error || 'Invalid GitHub URL.');
        return;
      }
      canonicalGh = ghRes.canonicalUrl || canonicalGh;
    }

    let canonicalLi = linkedinUrl.trim();
    if (canonicalLi) {
      const liRes = normalizeLinkedInUrl(canonicalLi);
      if (!liRes.valid) {
        setError(liRes.error || 'Invalid LinkedIn URL.');
        return;
      }
      canonicalLi = liRes.canonicalUrl || canonicalLi;
    }

    let canonicalPf = portfolioUrl.trim();
    if (canonicalPf) {
      const pfRes = normalizePortfolioUrl(canonicalPf);
      if (!pfRes.valid) {
        setError(pfRes.error || 'Invalid portfolio URL.');
        return;
      }
      canonicalPf = pfRes.canonicalUrl || canonicalPf;
    }

    setSaving(true);
    try {
      let finalAvatarUrl = avatarUrl.trim();
      if (finalAvatarUrl.startsWith('data:image/') && finalAvatarUrl.length > 80000) {
        try {
          finalAvatarUrl = await processProfilePhoto(finalAvatarUrl, 256, 0.85);
        } catch (imgErr) {
          console.warn('Could not re-compress data URL, continuing with original:', imgErr);
        }
      }

      const res = await updateMemberSelfProfile(member.id, {
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        studentId: cleanStudentId,
        university: university.trim() || 'Tongmyong University',
        department: department.trim(),
        major: major.trim(),
        semester: semester.trim(),
        avatarUrl: finalAvatarUrl,
        bio: bio.trim(),
        tracks: selectedTracks,
        leaderboardOptOut: !showOnLeaderboard,
        githubUrl: canonicalGh,
        linkedinUrl: canonicalLi,
        portfolioUrl: canonicalPf,
        showLinksPublicly,
      });

      if (res.success) {
        setSuccess(isMandatory ? 'Profile setup complete! Welcome to Den of Builders!' : 'Profile updated successfully!');
        if (onProfileUpdated) {
          onProfileUpdated({
            ...member,
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            studentId: cleanStudentId,
            university: university.trim() || 'Tongmyong University',
            department: department.trim(),
            major: major.trim(),
            semester: semester.trim(),
            avatarUrl: finalAvatarUrl,
            bio: bio.trim(),
            tracks: selectedTracks,
            leaderboardOptOut: !showOnLeaderboard,
            githubUrl: canonicalGh,
            linkedinUrl: canonicalLi,
            portfolioUrl: canonicalPf,
            showLinksPublicly,
            profileCompleted: true,
          });
        }
        setTimeout(() => {
          onClose();
        }, 900);
      } else {
        setError(formatUserFriendlyFirestoreError(res.message, 'Failed to update builder profile.'));
      }
    } catch (err: any) {
      setError(formatUserFriendlyFirestoreError(err, 'Failed to update builder profile.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={isMandatory ? () => {} : onClose}
      hideCloseButton={isMandatory}
      title={isMandatory ? 'Mandatory Builder Profile Setup' : 'Edit Builder Profile'}
      subtitle={
        isMandatory
          ? 'Welcome to Den of Builders! Please complete your required membership credentials to activate your attendance pass and participate in meetings.'
          : 'Update personal credentials, links, and academic information'
      }
      icon={isMandatory ? <ShieldCheck className="w-5 h-5 text-[#b5ff00]" /> : <User className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth="lg"
      hasUnsavedChanges={hasUnsavedChanges}
      footer={
        <div className="flex items-center justify-between sm:justify-end gap-3 w-full">
          {isMandatory ? (
            onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                disabled={saving}
                className="btn-glossy-secondary px-4 py-2.5 rounded-full text-zinc-400 hover:text-red-400 text-xs font-semibold cursor-pointer min-h-11 flex items-center gap-1.5"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            ) : null
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="btn-glossy-secondary flex-1 sm:flex-initial px-5 py-2.5 rounded-full text-zinc-300 text-xs font-semibold cursor-pointer min-h-11"
            >
              Cancel
            </button>
          )}

          <button
            type="submit"
            form="edit-profile-form"
            disabled={saving}
            className="btn-glossy-primary flex-1 sm:flex-initial px-6 py-2.5 rounded-full text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 min-h-11 shadow-[0_0_20px_rgba(181,255,0,0.35)]"
          >
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-black" />
                <span>Saving Profile...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4 text-black" />
                <span>{isMandatory ? 'Complete & Activate Pass' : 'Save Changes'}</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <form id="edit-profile-form" onSubmit={handleSubmit} className="space-y-4 text-xs font-sans">
        {isMandatory && (
          <div className="p-3.5 rounded-2xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-xs text-zinc-200 space-y-1.5 neu-raised-sm">
            <div className="flex items-center gap-2 font-bold text-[#b5ff00]">
              <Sparkles className="h-4 w-4" />
              <span>Membership Approved — Mandatory Profile Setup</span>
            </div>
            <p className="text-[11.5px] text-zinc-300 leading-relaxed">
              Before you can check in to workshop meetings and view your verified builder pass, club guidelines require completing your student ID, phone number, and specialty tracks.
            </p>
          </div>
        )}

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
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">
              Full Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
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

        {/* Student ID & Phone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">
              Student ID {isMandatory && <span className="text-red-400 font-bold">*</span>}
            </label>
            <input
              type="text"
              required={isMandatory}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="e.g. 20241234"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2 text-zinc-100 font-mono focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
          </div>

          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">
              Phone Number {isMandatory && <span className="text-red-400 font-bold">*</span>}
            </label>
            <div className="relative">
              <Phone className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="tel"
                required={isMandatory}
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
        </div>

        {/* Social & Portfolio Links */}
        <div className="space-y-3 p-3.5 rounded-2xl bg-[#0d0f15] border border-white/10 neu-inset">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200 text-xs flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-[#b5ff00]" />
              Builder Links & Portfolio
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="show-links-toggle" className="text-[11px] text-zinc-400 cursor-pointer">
                Public on Leaderboard
              </label>
              <Switch
                id="show-links-toggle"
                checked={showLinksPublicly}
                onChange={setShowLinksPublicly}
                aria-label="Make links public on leaderboard"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 mb-1 text-[11px]">GitHub Profile</label>
              <input
                type="text"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/username or @username"
                className="w-full bg-[#12141a] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1 text-[11px]">LinkedIn Profile</label>
              <input
                type="text"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/username"
                className="w-full bg-[#12141a] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1 text-[11px]">Personal Portfolio URL (Optional)</label>
            <input
              type="text"
              value={portfolioUrl}
              onChange={(e) => setPortfolioUrl(e.target.value)}
              placeholder="https://yourportfolio.dev"
              className="w-full bg-[#12141a] border border-white/10 neu-inset rounded-xl px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
          </div>
        </div>

        {/* University & Semester */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-zinc-300 font-medium mb-1.5 text-xs">University</label>
            <input
              type="text"
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
              placeholder="Tongmyong University"
              enterKeyHint="next"
              className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-11 text-base sm:text-xs"
            />
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

        {/* Department & Major */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            maxLength={500}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Hardware hacking, robotics firmware, embedded machine learning..."
            className="w-full bg-[#0d0f15] border border-white/10 neu-inset rounded-xl px-3.5 py-2.5 text-zinc-100 focus:outline-none focus:border-[#b5ff00] transition-colors min-h-16 text-base sm:text-xs"
          />
        </div>

        {/* Tracks */}
        <div>
          <label className="block text-zinc-300 font-medium mb-1.5 text-xs">
            Guild Specialty Tracks {isMandatory && <span className="text-red-400 font-bold">*</span>}
          </label>
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

        {/* Public Leaderboard Privacy & Opt-Out Toggle */}
        <div className="p-4 rounded-2xl bg-[#0d0f15] border border-white/10 neu-raised-sm flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-[#FF6A00]" />
              <label htmlFor="public-leaderboard-toggle" className="font-semibold text-zinc-200 text-xs cursor-pointer">
                Show me on the public leaderboard
              </label>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              When enabled, your display name, builder rank, points, and tier appear on the public esports leaderboard. If turned off, you are completely omitted from the public collection.
            </p>
          </div>
          <Switch
            id="public-leaderboard-toggle"
            checked={showOnLeaderboard}
            onChange={setShowOnLeaderboard}
            aria-label="Show me on the public leaderboard"
          />
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
