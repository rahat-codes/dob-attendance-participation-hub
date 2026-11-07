import { BuilderTrack, UserProfile } from '../types';
import { normalizeGitHubUrl, normalizeLinkedInUrl, normalizePortfolioUrl } from './profileLinks';
import { parseApplicantNotes } from './reuseHelpers';

export interface ApplicationInput {
  applicantName: string;
  applicantHandle: string;
  applicantStudentId?: string;
  applicantTrack: BuilderTrack;
  applicantNote?: string;
  githubUrl: string;
  linkedinUrl: string;
  portfolioUrl?: string;
  showLinksPublicly?: boolean;
}

export interface ApplicationValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  sanitized?: ApplicationInput;
}

const VALID_TRACKS: BuilderTrack[] = [
  'Hardware & Robotics',
  'Software & Systems',
  'AI & Embedded',
  'Open Hack & Demo',
];

/**
 * Strips dangerous control characters and internal delimiter symbols (·) from user input strings.
 */
function sanitizeString(str?: string): string {
  if (!str) return '';
  return str
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/·/g, '-')
    .trim();
}

/**
 * Validates a structured builder application.
 */
export function validateApplication(input: Partial<ApplicationInput>): ApplicationValidationResult {
  const errors: Record<string, string> = {};

  const cleanName = sanitizeString(input.applicantName);
  if (!cleanName || cleanName.length < 2 || cleanName.length > 100) {
    errors.applicantName = 'Full Name must be between 2 and 100 characters.';
  }

  let cleanHandle = sanitizeString(input.applicantHandle).replace(/^@+/, '');
  if (!cleanHandle || !/^[A-Za-z0-9_.-]{2,30}$/.test(cleanHandle)) {
    errors.applicantHandle = 'Builder handle must be 3-30 characters (letters, numbers, _, ., -).';
  } else {
    cleanHandle = `@${cleanHandle}`;
  }

  let cleanStudentId: string | undefined = sanitizeString(input.applicantStudentId);
  if (cleanStudentId) {
    if (!/^[A-Za-z0-9_-]{4,20}$/.test(cleanStudentId)) {
      errors.applicantStudentId = 'Student ID must be 4-20 alphanumeric characters or hyphens.';
    }
  } else {
    cleanStudentId = undefined;
  }

  const track = input.applicantTrack;
  if (!track || !VALID_TRACKS.includes(track)) {
    errors.applicantTrack = 'Please select a valid specialty track.';
  }

  const cleanNote = sanitizeString(input.applicantNote);
  if (cleanNote && cleanNote.length > 300) {
    errors.applicantNote = 'Note cannot exceed 300 characters.';
  }

  const ghRes = normalizeGitHubUrl(input.githubUrl);
  if (!ghRes.valid || !ghRes.canonicalUrl) {
    errors.githubUrl = ghRes.error || 'Valid GitHub profile URL is required.';
  }

  const liRes = normalizeLinkedInUrl(input.linkedinUrl);
  if (!liRes.valid || !liRes.canonicalUrl) {
    errors.linkedinUrl = liRes.error || 'Valid LinkedIn profile URL is required.';
  }

  let canonicalPortfolio = '';
  if (input.portfolioUrl && input.portfolioUrl.trim()) {
    const pfRes = normalizePortfolioUrl(input.portfolioUrl);
    if (!pfRes.valid) {
      errors.portfolioUrl = pfRes.error || 'Invalid portfolio URL.';
    } else {
      canonicalPortfolio = pfRes.canonicalUrl || '';
    }
  }

  const valid = Object.keys(errors).length === 0;

  return {
    valid,
    errors,
    sanitized: valid
      ? {
          applicantName: cleanName,
          applicantHandle: cleanHandle,
          applicantStudentId: cleanStudentId,
          applicantTrack: track as BuilderTrack,
          applicantNote: cleanNote || undefined,
          githubUrl: ghRes.canonicalUrl!,
          linkedinUrl: liRes.canonicalUrl!,
          portfolioUrl: canonicalPortfolio || undefined,
          showLinksPublicly: Boolean(input.showLinksPublicly),
        }
      : undefined,
  };
}

/**
 * Encodes an application into a human-readable summary for requestedNotes (legacy fallback),
 * with all delimiter injection characters (·) stripped.
 */
export function encodeApplication(app: ApplicationInput): string {
  const parts: string[] = [
    app.applicantHandle,
    `Track: ${app.applicantTrack}`,
    `Name: ${app.applicantName}`,
  ];
  if (app.applicantStudentId) {
    parts.push(`ID: ${app.applicantStudentId}`);
  }
  if (app.applicantNote) {
    parts.push(`Note: ${app.applicantNote}`);
  }
  return parts.join(' - ');
}

/**
 * Decodes application details from a user document, preferring structured fields
 * and falling back gracefully to legacy requestedNotes.
 */
export function decodeApplication(user?: UserProfile | null): Partial<ApplicationInput> {
  if (!user) return {};

  // If structured fields exist, return them directly
  if (user.applicantHandle || user.applicantName) {
    return {
      applicantName: user.applicantName || user.displayName,
      applicantHandle: user.applicantHandle || '',
      applicantStudentId: user.applicantStudentId || '',
      applicantTrack: user.applicantTrack || 'Software & Systems',
      applicantNote: user.applicantNote || '',
      githubUrl: user.githubUrl || '',
      linkedinUrl: user.linkedinUrl || '',
      portfolioUrl: user.portfolioUrl || '',
      showLinksPublicly: user.showLinksPublicly ?? true,
    };
  }

  // Legacy fallback
  const parsed = parseApplicantNotes(user.requestedNotes);
  return {
    applicantName: parsed.name || user.displayName || '',
    applicantHandle: parsed.handle ? `@${parsed.handle}` : `@${user.email?.split('@')[0] || 'builder'}`,
    applicantStudentId: parsed.studentId || '',
    applicantTrack: 'Software & Systems',
    applicantNote: '',
    githubUrl: '',
    linkedinUrl: '',
    portfolioUrl: '',
    showLinksPublicly: true,
  };
}

/**
 * Determines whether a user has genuinely submitted an application.
 * Returns false for users who just signed in without submitting an application.
 */
export function isApplicationSubmitted(user?: UserProfile | null): boolean {
  if (!user) return false;
  // A submitted application must have membershipRequestedAt or structured applicant data
  if (user.membershipRequestedAt) return true;
  if (user.applicantHandle && user.applicantName) return true;
  return false;
}
