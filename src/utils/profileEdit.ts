import { BuilderTrack, Member, MemberPrivate } from '../types';
import { CLIENT_SCHEMA_VERSION } from '../config/constants';
import { formatUserFriendlyFirestoreError, sanitizeDiagnosticLabel } from './firestoreErrors';
import {
  normalizeGitHubUrl,
  normalizeLinkedInUrl,
  normalizePortfolioUrl,
  sanitizeAuthPhotoUrl,
} from './profileLinks';

export type ProfileStepName =
  | 'precheck'
  | 'acceptInvitation'
  | 'members'
  | 'memberPrivate'
  | 'publicLeaderboard'
  | 'users';

export interface ProfileStepWarning {
  step: 'publicLeaderboard' | 'users';
  code: string;
  message: string;
  diagnosticCode?: string;
}

export interface ProfileUpdateResult {
  success: boolean;
  message?: string;
  failedStep?: ProfileStepName;
  failedOperation?: string;
  failedCollection?: string;
  errorCode?: string;
  diagnosticCode?: string;
  warnings?: ProfileStepWarning[];
  appliedMemberPatch?: Record<string, unknown>;
}

export interface ProfileEditFormInput {
  name: string;
  email?: string;
  phone?: string;
  studentId?: string;
  university?: string;
  department?: string;
  major?: string;
  semester?: string;
  avatarUrl?: string;
  bio?: string;
  tracks: BuilderTrack[];
  leaderboardOptOut?: boolean;
  githubUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  showLinksPublicly?: boolean;
}

export interface ProfileDiffOptions {
  targetMemberId: string;
  currentUid?: string;
  isMandatory?: boolean;
  nowIso?: string;
}

export interface MemberProfileDiffPlan {
  memberPatch: Record<string, unknown>;
  privatePatch: Record<string, unknown>;
  publicLeaderboardAction: 'none' | 'delete' | 'update';
  publicLeaderboardPatch: Record<string, unknown>;
  userDocPatch: Record<string, unknown> | null;
  authProfilePatch: { displayName?: string; photoURL?: string } | null;
  nextState: {
    name: string;
    avatarUrl: string;
    bio: string;
    tracks: BuilderTrack[];
    leaderboardOptOut: boolean;
    githubUrl: string;
    linkedinUrl: string;
    portfolioUrl: string;
    showLinksPublicly: boolean;
    email: string;
    phone: string;
    studentId: string;
    university: string;
    department: string;
    major: string;
    semester: string;
  };
}

function tracksEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function extractFirebaseErrorCode(err: unknown): string {
  const rawCode = typeof (err as any)?.code === 'string' ? (err as any).code.trim() : '';
  if (rawCode) return rawCode;
  const msg =
    typeof err === 'string'
      ? err
      : err instanceof Error
      ? err.message
      : typeof (err as any)?.message === 'string'
      ? (err as any).message
      : '';
  const lower = msg.toLowerCase();
  if (lower.includes('missing or insufficient permissions') || lower.includes('permission-denied')) {
    return 'permission-denied';
  }
  if (lower.includes('client is offline') || lower.includes('unavailable')) {
    return 'unavailable';
  }
  if (lower.includes('not-found') || lower.includes('no document to update')) {
    return 'not-found';
  }
  if (lower.includes('deadline-exceeded') || lower.includes('timed out')) {
    return 'deadline-exceeded';
  }
  return 'unknown';
}

export function stepToCollectionName(step: ProfileStepName): string {
  switch (step) {
    case 'precheck':
    case 'users':
      return 'users';
    case 'acceptInvitation':
      return 'users+members';
    case 'members':
      return 'members';
    case 'memberPrivate':
      return 'memberPrivate';
    case 'publicLeaderboard':
      return 'publicLeaderboard';
  }
}

export function buildProfileDiagnosticCode(opts: {
  step: ProfileStepName;
  operation?: string;
  code?: string;
}): string {
  const safeStep = sanitizeDiagnosticLabel(opts.step);
  const safeOp = sanitizeDiagnosticLabel(opts.operation || 'write');
  const safeCode = sanitizeDiagnosticLabel(opts.code || 'unknown');
  return `step=${safeStep} op=${safeOp} code=${safeCode} v=${CLIENT_SCHEMA_VERSION}`;
}

export function formatStepFailureMessage(
  step: ProfileStepName,
  err: unknown,
  operation: string = 'write'
): {
  code: string;
  collection: string;
  operation: string;
  diagnosticCode: string;
  message: string;
} {
  const code = extractFirebaseErrorCode(err);
  const collectionName = stepToCollectionName(step);
  const contextPath = step === 'acceptInvitation' ? 'acceptInvitation' : `${collectionName}/`;
  const friendly = formatUserFriendlyFirestoreError(err, 'Failed to save your profile changes.', {
    path: contextPath,
    operation,
    step,
  });
  const stepLabel =
    step === 'precheck'
      ? 'account link check'
      : step === 'acceptInvitation'
      ? 'membership invitation acceptance'
      : step === 'members'
      ? 'builder profile'
      : step === 'memberPrivate'
      ? 'private contact details'
      : step === 'publicLeaderboard'
      ? 'public leaderboard sync'
      : 'account sync';
  const diagnosticCode = buildProfileDiagnosticCode({ step, operation, code });
  return {
    code,
    collection: collectionName,
    operation,
    diagnosticCode,
    message: `Could not update ${stepLabel} (${code}): ${friendly}`,
  };
}

/**
 * Builds a minimal, changed-fields-only patch plan between the loaded Member / MemberPrivate
 * records and the submitted form inputs.
 *
 * Invariants:
 * - Never defaults `tracks` to ['Software & Systems'] when unchanged.
 * - Editing only links produces a memberPatch containing only changed link fields.
 * - Never writes data: URLs into users/{uid}.photoURL or Firebase Auth profile.
 */
export function buildMemberProfileDiff(
  loadedMember: Partial<Member>,
  loadedPrivate: Partial<MemberPrivate> | null | undefined,
  input: ProfileEditFormInput,
  options: ProfileDiffOptions
): { valid: true; plan: MemberProfileDiffPlan } | { valid: false; error: string } {
  const nowIso = options.nowIso || new Date().toISOString();
  const cleanName = (input.name || '').trim();
  if (!cleanName || cleanName.length > 100) {
    return { valid: false, error: 'Full Name must be between 1 and 100 characters.' };
  }

  const cleanBio = (input.bio || '').trim();
  if (cleanBio.length > 500) {
    return { valid: false, error: 'Bio cannot exceed 500 characters.' };
  }

  const cleanAvatar = (input.avatarUrl || '').trim();
  if (cleanAvatar.toLowerCase().startsWith('http://')) {
    return { valid: false, error: 'Avatar URL must use https:// or be uploaded as an image file.' };
  }
  if (cleanAvatar.startsWith('https://') && cleanAvatar.length > 500) {
    return { valid: false, error: 'Avatar HTTPS URL cannot exceed 500 characters.' };
  }
  if (cleanAvatar.startsWith('data:image/') && cleanAvatar.length > 150000) {
    return { valid: false, error: 'Uploaded avatar image is too large. Please choose a smaller image.' };
  }

  const ghRes = normalizeGitHubUrl(input.githubUrl, { allowEmpty: true });
  if (!ghRes.valid) {
    return { valid: false, error: ghRes.error || 'GitHub URL must look like https://github.com/your-username' };
  }
  const canonicalGithub = ghRes.canonicalUrl ?? '';

  const liRes = normalizeLinkedInUrl(input.linkedinUrl, { allowEmpty: true });
  if (!liRes.valid) {
    return { valid: false, error: liRes.error || 'LinkedIn URL must look like https://www.linkedin.com/in/your-name' };
  }
  const canonicalLinkedin = liRes.canonicalUrl ?? '';

  const pfRes = normalizePortfolioUrl(input.portfolioUrl);
  if (!pfRes.valid) {
    return { valid: false, error: pfRes.error || 'Portfolio URL must look like https://your-site.dev' };
  }
  const canonicalPortfolio = pfRes.canonicalUrl ?? '';

  const baseName = (loadedMember.name || '').trim();
  const baseAvatar = (loadedMember.avatarUrl || loadedMember.photoURL || '').trim();
  const baseBio = (loadedMember.bio || '').trim();
  const baseTracks = Array.isArray(loadedMember.tracks) ? loadedMember.tracks.slice(0, 10) : [];
  const formTracks = Array.isArray(input.tracks) ? input.tracks.slice(0, 10) : baseTracks;
  const baseOptOut = Boolean(loadedMember.leaderboardOptOut);
  const nextOptOut = input.leaderboardOptOut ?? baseOptOut;
  const baseGithub = (loadedMember.githubUrl || '').trim();
  const baseLinkedin = (loadedMember.linkedinUrl || '').trim();
  const basePortfolio = (loadedMember.portfolioUrl || '').trim();
  const baseShowLinks = loadedMember.showLinksPublicly ?? true;
  const nextShowLinks = input.showLinksPublicly ?? baseShowLinks;

  const memberPatch: Record<string, unknown> = {};
  if (!loadedMember.id && options.targetMemberId) {
    memberPatch.id = options.targetMemberId;
  }
  if (options.currentUid && !loadedMember.authUid) {
    memberPatch.authUid = options.currentUid;
  }
  if (cleanName !== baseName) {
    memberPatch.name = cleanName;
  }
  if (cleanAvatar !== baseAvatar) {
    memberPatch.avatarUrl = cleanAvatar;
  }
  if (cleanBio !== baseBio) {
    memberPatch.bio = cleanBio;
  }
  if (!tracksEqual(formTracks, baseTracks) && formTracks.length > 0) {
    memberPatch.tracks = formTracks;
  }
  if (nextOptOut !== baseOptOut) {
    memberPatch.leaderboardOptOut = nextOptOut;
  }
  if (canonicalGithub !== baseGithub) {
    memberPatch.githubUrl = canonicalGithub;
  }
  if (canonicalLinkedin !== baseLinkedin) {
    memberPatch.linkedinUrl = canonicalLinkedin;
  }
  if (canonicalPortfolio !== basePortfolio) {
    memberPatch.portfolioUrl = canonicalPortfolio;
  }
  if (nextShowLinks !== baseShowLinks) {
    memberPatch.showLinksPublicly = nextShowLinks;
  }

  // Private fields diff
  const baseEmail = (loadedPrivate?.email || loadedMember.email || '').trim().toLowerCase();
  const basePhone = (loadedPrivate?.phone || loadedMember.phone || '').trim();
  const baseStudentId = (loadedPrivate?.studentId || loadedMember.studentId || '').trim();
  const baseUniversity = (loadedPrivate?.university || loadedMember.university || '').trim();
  const baseDepartment = (loadedPrivate?.department || loadedMember.department || '').trim();
  const baseMajor = (loadedPrivate?.major || loadedMember.major || '').trim();
  const baseSemester = (loadedPrivate?.semester || loadedMember.semester || '').trim();

  const nextEmail = input.email !== undefined ? input.email.trim().toLowerCase() : baseEmail;
  const nextPhone = input.phone !== undefined ? input.phone.trim() : basePhone;
  const nextStudentId = input.studentId !== undefined ? input.studentId.trim() : baseStudentId;
  const nextUniversity = input.university !== undefined ? input.university.trim() : baseUniversity;
  const nextDepartment = input.department !== undefined ? input.department.trim() : baseDepartment;
  const nextMajor = input.major !== undefined ? input.major.trim() : baseMajor;
  const nextSemester = input.semester !== undefined ? input.semester.trim() : baseSemester;

  const privatePatch: Record<string, unknown> = {};
  if (nextEmail !== baseEmail) privatePatch.email = nextEmail;
  if (nextPhone !== basePhone) privatePatch.phone = nextPhone;
  if (nextStudentId !== baseStudentId) privatePatch.studentId = nextStudentId;
  if (nextUniversity !== baseUniversity) privatePatch.university = nextUniversity;
  if (nextDepartment !== baseDepartment) privatePatch.department = nextDepartment;
  if (nextMajor !== baseMajor) privatePatch.major = nextMajor;
  if (nextSemester !== baseSemester) privatePatch.semester = nextSemester;

  const hasPrivateDataChanges = Object.keys(privatePatch).length > 0;
  if (options.isMandatory || hasPrivateDataChanges) {
    privatePatch.updatedAt = nowIso;
    if (options.isMandatory && !loadedPrivate?.profileCompleted) {
      privatePatch.profileCompleted = true;
      privatePatch.profileCompletedAt = nowIso;
    } else if (options.isMandatory) {
      privatePatch.profileCompleted = true;
      if (!loadedPrivate?.profileCompletedAt) {
        privatePatch.profileCompletedAt = nowIso;
      }
    }
  }

  // Public leaderboard projection diff
  let publicLeaderboardAction: 'none' | 'delete' | 'update' = 'none';
  const publicLeaderboardPatch: Record<string, unknown> = {};

  if (memberPatch.leaderboardOptOut === true) {
    publicLeaderboardAction = 'delete';
  } else if (!nextOptOut) {
    if ('name' in memberPatch) {
      publicLeaderboardPatch.displayName = cleanName;
      publicLeaderboardPatch.name = cleanName;
    }
    if ('avatarUrl' in memberPatch) {
      publicLeaderboardPatch.avatar = cleanAvatar;
      publicLeaderboardPatch.avatarUrl = cleanAvatar;
    }
    const linksTouched =
      'githubUrl' in memberPatch ||
      'linkedinUrl' in memberPatch ||
      'portfolioUrl' in memberPatch ||
      'showLinksPublicly' in memberPatch;
    if (linksTouched) {
      publicLeaderboardPatch.showLinksPublicly = nextShowLinks;
      publicLeaderboardPatch.githubUrl = nextShowLinks ? canonicalGithub : '';
      publicLeaderboardPatch.linkedinUrl = nextShowLinks ? canonicalLinkedin : '';
      publicLeaderboardPatch.portfolioUrl = nextShowLinks ? canonicalPortfolio : '';
    }
    if (Object.keys(publicLeaderboardPatch).length > 0) {
      publicLeaderboardPatch.lastUpdated = nowIso;
      publicLeaderboardAction = 'update';
    }
  }

  // Account/Auth sync diff (NEVER write data: URLs to users.photoURL or auth.photoURL)
  let userDocPatch: Record<string, unknown> | null = null;
  let authProfilePatch: { displayName?: string; photoURL?: string } | null = null;

  const nameChanged = 'name' in memberPatch;
  const avatarCleared = 'avatarUrl' in memberPatch && cleanAvatar === '';
  const safeHttpsAvatar = 'avatarUrl' in memberPatch ? sanitizeAuthPhotoUrl(cleanAvatar) : '';
  const shouldUpdateSafePhoto = avatarCleared || Boolean(safeHttpsAvatar);

  if (options.currentUid && (nameChanged || shouldUpdateSafePhoto)) {
    userDocPatch = { updatedAt: nowIso };
    authProfilePatch = {};
    if (nameChanged) {
      userDocPatch.displayName = cleanName;
      authProfilePatch.displayName = cleanName;
    }
    if (shouldUpdateSafePhoto) {
      const nextSafePhoto = avatarCleared ? '' : safeHttpsAvatar;
      userDocPatch.photoURL = nextSafePhoto;
      authProfilePatch.photoURL = nextSafePhoto;
    }
  }

  return {
    valid: true,
    plan: {
      memberPatch,
      privatePatch,
      publicLeaderboardAction,
      publicLeaderboardPatch,
      userDocPatch,
      authProfilePatch,
      nextState: {
        name: cleanName,
        avatarUrl: cleanAvatar,
        bio: cleanBio,
        tracks: formTracks,
        leaderboardOptOut: nextOptOut,
        githubUrl: canonicalGithub,
        linkedinUrl: canonicalLinkedin,
        portfolioUrl: canonicalPortfolio,
        showLinksPublicly: nextShowLinks,
        email: nextEmail,
        phone: nextPhone,
        studentId: nextStudentId,
        university: nextUniversity,
        department: nextDepartment,
        major: nextMajor,
        semester: nextSemester,
      },
    },
  };
}

export interface ProfileUpdateExecutorDeps {
  updateMemberDoc: (patch: Record<string, unknown>) => Promise<void>;
  mergeMemberPrivateDoc: (patch: Record<string, unknown>) => Promise<void>;
  publicLeaderboardDocExists: () => Promise<boolean>;
  updatePublicLeaderboardDoc: (patch: Record<string, unknown>) => Promise<void>;
  deletePublicLeaderboardDoc: () => Promise<void>;
  updateUserDoc: (patch: Record<string, unknown>) => Promise<void>;
  updateAuthProfile: (patch: { displayName?: string; photoURL?: string }) => Promise<void>;
  logError?: (label: string, err: unknown) => void;
  logWarn?: (label: string, err: unknown) => void;
}

/**
 * Executes the 4 isolated profile save steps:
 *   (a) members/{id} update (critical)
 *   (b) memberPrivate/{id} merge (important; never sets profileCompleted unless (a) succeeded)
 *   (c) publicLeaderboard/{id} sync (non-critical: warn only, never blocks (a))
 *   (d) users/{uid} + Auth profile sync (non-critical: warn only, never writes data: photoURL)
 */
export async function executeIsolatedProfileUpdate(
  plan: MemberProfileDiffPlan,
  deps: ProfileUpdateExecutorDeps
): Promise<ProfileUpdateResult> {
  const logError = deps.logError || ((label, err) => console.error(label, err));
  const logWarn = deps.logWarn || ((label, err) => console.warn(label, err));
  const warnings: ProfileStepWarning[] = [];

  // Step (a): members/{id} update (critical)
  if (Object.keys(plan.memberPatch).length > 0) {
    try {
      await deps.updateMemberDoc(plan.memberPatch);
    } catch (err) {
      logError('updateMemberSelfProfile step (a) members update failed:', err);
      const formatted = formatStepFailureMessage('members', err, 'update');
      return {
        success: false,
        failedStep: 'members',
        failedOperation: formatted.operation,
        failedCollection: formatted.collection,
        errorCode: formatted.code,
        diagnosticCode: formatted.diagnosticCode,
        message: formatted.message,
      };
    }
  }

  // Step (b): memberPrivate/{id} merge (important; only after step (a) succeeded)
  if (Object.keys(plan.privatePatch).length > 0) {
    try {
      await deps.mergeMemberPrivateDoc(plan.privatePatch);
    } catch (err) {
      logError('updateMemberSelfProfile step (b) memberPrivate merge failed:', err);
      const formatted = formatStepFailureMessage('memberPrivate', err, 'merge');
      return {
        success: false,
        failedStep: 'memberPrivate',
        failedOperation: formatted.operation,
        failedCollection: formatted.collection,
        errorCode: formatted.code,
        diagnosticCode: formatted.diagnosticCode,
        message: formatted.message,
      };
    }
  }

  // Step (c): publicLeaderboard/{id} sync (non-critical)
  if (plan.publicLeaderboardAction !== 'none') {
    try {
      const exists = await deps.publicLeaderboardDocExists();
      if (exists) {
        if (plan.publicLeaderboardAction === 'delete') {
          await deps.deletePublicLeaderboardDoc();
        } else if (Object.keys(plan.publicLeaderboardPatch).length > 0) {
          await deps.updatePublicLeaderboardDoc(plan.publicLeaderboardPatch);
        }
      }
    } catch (pubErr) {
      logWarn('Public leaderboard projection sync notice:', pubErr);
      const formatted = formatStepFailureMessage('publicLeaderboard', pubErr, plan.publicLeaderboardAction === 'delete' ? 'delete' : 'update');
      warnings.push({
        step: 'publicLeaderboard',
        code: formatted.code,
        diagnosticCode: formatted.diagnosticCode,
        message: 'Saved your profile, though public leaderboard link preview sync will refresh shortly.',
      });
    }
  }

  // Step (d): users/{uid} + Auth displayName / https photoURL sync (non-critical)
  if (plan.userDocPatch || plan.authProfilePatch) {
    try {
      if (plan.authProfilePatch && Object.keys(plan.authProfilePatch).length > 0) {
        const safeAuthPatch: { displayName?: string; photoURL?: string } = {};
        if (plan.authProfilePatch.displayName) {
          safeAuthPatch.displayName = plan.authProfilePatch.displayName;
        }
        if (
          plan.authProfilePatch.photoURL !== undefined &&
          !plan.authProfilePatch.photoURL.startsWith('data:')
        ) {
          safeAuthPatch.photoURL = plan.authProfilePatch.photoURL;
        }
        if (Object.keys(safeAuthPatch).length > 0) {
          await deps.updateAuthProfile(safeAuthPatch);
        }
      }
      if (plan.userDocPatch && Object.keys(plan.userDocPatch).length > 0) {
        const safeUserPatch = { ...plan.userDocPatch };
        if (
          typeof safeUserPatch.photoURL === 'string' &&
          safeUserPatch.photoURL.startsWith('data:')
        ) {
          delete safeUserPatch.photoURL;
        }
        await deps.updateUserDoc(safeUserPatch);
      }
    } catch (userErr) {
      logWarn('Profile sync to auth/users completed with fallback:', userErr);
      const formatted = formatStepFailureMessage('users', userErr, 'update');
      warnings.push({
        step: 'users',
        code: formatted.code,
        diagnosticCode: formatted.diagnosticCode,
        message: 'Saved your builder profile, though account display sync hit a temporary notice.',
      });
    }
  }

  return {
    success: true,
    warnings: warnings.length > 0 ? warnings : undefined,
    appliedMemberPatch: plan.memberPatch,
  };
}
