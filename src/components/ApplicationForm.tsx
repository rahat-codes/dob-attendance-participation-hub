import React, { useState, useEffect } from 'react';
import {
  Send,
  User,
  AtSign,
  GraduationCap,
  Sparkles,
  Github,
  Linkedin,
  Globe,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  HelpCircle,
} from 'lucide-react';
import { BuilderTrack, UserProfile } from '../types';
import { ApplicationInput, validateApplication, decodeApplication } from '../utils/application';
import { normalizeGitHubUrl, normalizeLinkedInUrl, normalizePortfolioUrl } from '../utils/profileLinks';
import { formatUserFriendlyFirestoreError } from '../utils/firestoreErrors';
import { Switch } from '../ui/Switch';
import { BUILDER_TRACKS } from '../config/constants';

interface ApplicationFormProps {
  user: UserProfile;
  initialValues?: Partial<ApplicationInput>;
  isReapplying?: boolean;
  onSubmit: (app: ApplicationInput) => Promise<void>;
  onSignOut?: () => void;
}

const AVAILABLE_TRACKS: readonly BuilderTrack[] = BUILDER_TRACKS;

export const ApplicationForm: React.FC<ApplicationFormProps> = ({
  user,
  initialValues,
  isReapplying = false,
  onSubmit,
  onSignOut,
}) => {
  const decoded = decodeApplication(user);

  const [name, setName] = useState(initialValues?.applicantName || decoded.applicantName || user.displayName || '');
  const [handle, setHandle] = useState(
    initialValues?.applicantHandle || decoded.applicantHandle || `@${user.email?.split('@')[0] || 'builder'}`
  );
  const [studentId, setStudentId] = useState(initialValues?.applicantStudentId || decoded.applicantStudentId || '');
  const [track, setTrack] = useState<BuilderTrack>(
    initialValues?.applicantTrack || decoded.applicantTrack || 'Software & Systems'
  );
  const [github, setGithub] = useState(initialValues?.githubUrl || decoded.githubUrl || '');
  const [linkedin, setLinkedin] = useState(initialValues?.linkedinUrl || decoded.linkedinUrl || '');
  const [portfolio, setPortfolio] = useState(initialValues?.portfolioUrl || decoded.portfolioUrl || '');
  const [note, setNote] = useState(initialValues?.applicantNote || decoded.applicantNote || '');
  const [showLinksPublicly, setShowLinksPublicly] = useState(
    initialValues?.showLinksPublicly ?? decoded.showLinksPublicly ?? true
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedData, setSubmittedData] = useState<ApplicationInput | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Canonical previews
  const previewHandle = handle.trim() ? (handle.startsWith('@') ? handle.trim() : `@${handle.trim()}`) : '@';
  const ghPreview = normalizeGitHubUrl(github).canonicalUrl;
  const liPreview = normalizeLinkedInUrl(linkedin).canonicalUrl;

  const currentPayload: Partial<ApplicationInput> = {
    applicantName: name,
    applicantHandle: handle,
    applicantStudentId: studentId.trim() || undefined,
    applicantTrack: track,
    applicantNote: note.trim() || undefined,
    githubUrl: github,
    linkedinUrl: linkedin,
    portfolioUrl: portfolio.trim() || undefined,
    showLinksPublicly,
  };

  const validation = validateApplication(currentPayload);

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Touch all required fields
    setTouched({
      applicantName: true,
      applicantHandle: true,
      githubUrl: true,
      linkedinUrl: true,
    });

    if (!validation.valid || !validation.sanitized) {
      const firstErr = Object.values(validation.errors)[0] || 'Please complete all required fields.';
      setError(firstErr);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(validation.sanitized);
      setSubmittedData(validation.sanitized);
    } catch (err: any) {
      setError(formatUserFriendlyFirestoreError(err, 'Failed to submit application. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedData) {
    return (
      <div className="bg-zinc-900/90 border border-[#b5ff00]/40 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-5 text-center">
        <div className="inline-flex p-3 rounded-2xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-[#b5ff00] mx-auto">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-base font-bold text-white">Application Submitted!</h2>
          <p className="text-xs text-zinc-300 leading-relaxed max-w-sm mx-auto">
            Your membership request for handle <span className="text-[#b5ff00] font-semibold">{submittedData.applicantHandle}</span> has been logged and queued for administrative review.
          </p>
        </div>
        <div className="p-3.5 rounded-xl bg-black/40 border border-zinc-800 text-left text-xs space-y-1.5 text-zinc-300">
          <div className="flex justify-between">
            <span className="text-zinc-500">Applicant:</span>
            <span className="font-semibold text-zinc-200">{submittedData.applicantName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Guild Track:</span>
            <span className="font-semibold text-zinc-200">{submittedData.applicantTrack}</span>
          </div>
          {submittedData.applicantStudentId && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Student ID:</span>
              <span className="font-mono text-zinc-200">{submittedData.applicantStudentId}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-zinc-500">Submitted At:</span>
            <span className="text-zinc-400">{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
        <div className="pt-2">
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-5 text-left">
      <div className="text-center sm:text-left space-y-1 border-b border-zinc-800/80 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[#b5ff00]/10 border border-[#b5ff00]/20 text-[#b5ff00]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {isReapplying ? 'Re-Apply for Guild Membership' : 'Builder Membership Application'}
              </h2>
              <p className="text-[11.5px] text-zinc-400">
                {isReapplying
                  ? 'Update your credentials and re-submit your membership application for admin review.'
                  : 'Welcome to Den of Builders! Please complete your credentials to join our guild roster.'}
              </p>
            </div>
          </div>
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="text-zinc-400 hover:text-red-400 p-2 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1 transition-colors"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-300 flex items-center gap-2 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4 text-xs font-sans">
        {/* Full Name & Handle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1">
            <label htmlFor="applicantName" className="font-semibold text-zinc-300 flex items-center gap-1">
              <span>Full Name</span>
              <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <User className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <input
                id="applicantName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => handleBlur('applicantName')}
                placeholder="Ada Lovelace"
                maxLength={100}
                required
                aria-describedby={validation.errors.applicantName ? 'applicantName-err' : undefined}
                className="w-full pl-9 pr-3 py-2 bg-black/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#b5ff00]"
              />
            </div>
            {touched.applicantName && validation.errors.applicantName && (
              <p id="applicantName-err" className="text-[11px] text-red-400">
                {validation.errors.applicantName}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="applicantHandle" className="font-semibold text-zinc-300 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span>Builder Handle</span>
                <span className="text-red-400" aria-hidden="true">*</span>
              </span>
              <span className="text-[10.5px] text-[#b5ff00] font-mono">{previewHandle}</span>
            </label>
            <div className="relative">
              <AtSign className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <input
                id="applicantHandle"
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                onBlur={() => handleBlur('applicantHandle')}
                placeholder="@handle"
                maxLength={30}
                required
                aria-describedby={validation.errors.applicantHandle ? 'applicantHandle-err' : undefined}
                className="w-full pl-9 pr-3 py-2 bg-black/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 font-mono focus:outline-none focus:border-[#b5ff00]"
              />
            </div>
            {touched.applicantHandle && validation.errors.applicantHandle && (
              <p id="applicantHandle-err" className="text-[11px] text-red-400">
                {validation.errors.applicantHandle}
              </p>
            )}
          </div>
        </div>

        {/* Student ID & Track */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1">
            <label htmlFor="applicantStudentId" className="font-semibold text-zinc-300 flex items-center justify-between">
              <span>Student ID (Optional)</span>
              <span className="text-[10px] text-zinc-500">4-20 chars</span>
            </label>
            <div className="relative">
              <GraduationCap className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
              <input
                id="applicantStudentId"
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="20261234"
                maxLength={20}
                className="w-full pl-9 pr-3 py-2 bg-black/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 font-mono focus:outline-none focus:border-[#b5ff00]"
              />
            </div>
            {validation.errors.applicantStudentId && (
              <p className="text-[11px] text-red-400">{validation.errors.applicantStudentId}</p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="applicantTrack" className="font-semibold text-zinc-300 flex items-center gap-1">
              <span>Primary Guild Track</span>
              <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <select
              id="applicantTrack"
              value={track}
              onChange={(e) => setTrack(e.target.value as BuilderTrack)}
              className="w-full px-3 py-2 bg-black/50 border border-zinc-800 rounded-xl text-zinc-100 focus:outline-none focus:border-[#b5ff00]"
            >
              {AVAILABLE_TRACKS.map((t) => (
                <option key={t} value={t} className="bg-zinc-900 text-zinc-100">
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Social & Professional Links */}
        <div className="pt-2 border-t border-zinc-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-zinc-200">Online Portfolios & Profiles</span>
            <span className="text-[10.5px] text-zinc-400">Required by guild administration</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1">
              <label htmlFor="githubUrl" className="font-semibold text-zinc-300 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Github className="h-3.5 w-3.5 text-zinc-400" />
                  <span>GitHub Profile</span>
                  <span className="text-red-400" aria-hidden="true">*</span>
                </span>
                {ghPreview && <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[120px]">{ghPreview}</span>}
              </label>
              <input
                id="githubUrl"
                type="text"
                value={github}
                onChange={(e) => setGithub(e.target.value)}
                onBlur={() => handleBlur('githubUrl')}
                placeholder="github.com/username or @username"
                required
                aria-describedby={validation.errors.githubUrl ? 'githubUrl-err' : undefined}
                className="w-full px-3 py-2 bg-black/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#b5ff00]"
              />
              {touched.githubUrl && validation.errors.githubUrl && (
                <p id="githubUrl-err" className="text-[11px] text-red-400">
                  {validation.errors.githubUrl}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor="linkedinUrl" className="font-semibold text-zinc-300 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Linkedin className="h-3.5 w-3.5 text-blue-400" />
                  <span>LinkedIn Profile</span>
                  <span className="text-red-400" aria-hidden="true">*</span>
                </span>
                {liPreview && <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[120px]">{liPreview}</span>}
              </label>
              <input
                id="linkedinUrl"
                type="text"
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                onBlur={() => handleBlur('linkedinUrl')}
                placeholder="linkedin.com/in/username"
                required
                aria-describedby={validation.errors.linkedinUrl ? 'linkedinUrl-err' : undefined}
                className="w-full px-3 py-2 bg-black/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#b5ff00]"
              />
              {touched.linkedinUrl && validation.errors.linkedinUrl && (
                <p id="linkedinUrl-err" className="text-[11px] text-red-400">
                  {validation.errors.linkedinUrl}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="portfolioUrl" className="font-semibold text-zinc-300 flex items-center gap-1">
              <Globe className="h-3.5 w-3.5 text-zinc-400" />
              <span>Personal Website or Portfolio (Optional)</span>
            </label>
            <input
              id="portfolioUrl"
              type="text"
              value={portfolio}
              onChange={(e) => setPortfolio(e.target.value)}
              placeholder="https://myprojects.dev"
              maxLength={200}
              className="w-full px-3 py-2 bg-black/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#b5ff00]"
            />
            {validation.errors.portfolioUrl && (
              <p className="text-[11px] text-red-400">{validation.errors.portfolioUrl}</p>
            )}
          </div>

          {/* Public links switch & disclosure */}
          <div className="p-3 rounded-xl bg-black/30 border border-zinc-800/80 flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <span className="font-semibold text-zinc-200">Show links on public leaderboard</span>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Your GitHub, LinkedIn and portfolio links will be shown on the public leaderboard so visitors can find you. You can turn this off any time in Edit Profile.
              </p>
            </div>
            <Switch
              checked={showLinksPublicly}
              onChange={setShowLinksPublicly}
              label="Public Links"
            />
          </div>
        </div>

        {/* Short Note */}
        <div className="space-y-1">
          <label htmlFor="applicantNote" className="font-semibold text-zinc-300 flex items-center justify-between">
            <span>Introduction / Message to Admins (Optional)</span>
            <span className="text-[10.5px] text-zinc-500">{note.length}/300</span>
          </label>
          <textarea
            id="applicantNote"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Tell us about the projects you want to build or your technical background..."
            className="w-full px-3 py-2 bg-black/50 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#b5ff00] resize-none"
          />
        </div>
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={submitting || !validation.valid}
          className="btn-glossy-primary w-full py-3 px-6 rounded-full text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 min-h-11 shadow-[0_0_20px_rgba(181,255,0,0.35)]"
        >
          {submitting ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin text-black" />
              <span>Submitting Application...</span>
            </>
          ) : (
            <>
              <Send className="h-4 w-4 text-black" />
              <span>{isReapplying ? 'Re-Submit Application' : 'Submit Membership Application'}</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};
