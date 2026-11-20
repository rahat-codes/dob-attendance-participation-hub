import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_PAGE_SIZE,
  ReadOnlyFirestoreClient,
  RestReadOnlyFirestoreClient,
  readAllPaginated,
  redactSensitiveErrorText,
  resolveTargetConfigFromEnv,
} from './firestoreReadOnlyClient.ts';

export const MEMBER_REQUIRED_FIELDS = [
  'id',
  'name',
  'handle',
  'role',
  'tracks',
  'joinedDate',
  'status',
] as const;

export const ALLOWED_MEMBER_ROLES = new Set<string>([
  'Member',
  'Project Leader',
  'Vice President',
  'President',
  'Founder',
  'Lead',
  'Builder',
  'Apprentice',
]);

export const ALLOWED_MEMBER_STATUSES = new Set<string>(['Active', 'Probationary', 'Inactive']);

export const CANONICAL_BUILDER_TRACKS = new Set<string>([
  'Hardware & Robotics',
  'Software & Systems',
  'AI & Embedded',
  'Open Hack & Demo',
]);

export const PUBLIC_MEMBER_WHITELIST = new Set<string>([
  'id',
  'name',
  'handle',
  'role',
  'tracks',
  'joinedDate',
  'status',
  'avatarUrl',
  'bio',
  'leaderboardOptOut',
  'authUid',
  'createdAt',
  'githubUrl',
  'linkedinUrl',
  'portfolioUrl',
  'showLinksPublicly',
]);

export function isValidFirestoreId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9_\-]+$/.test(value)
  );
}

export function isValidPhotoUrl(url: unknown): boolean {
  if (url === null || url === '') return true;
  if (typeof url !== 'string' || url.length > 500) return false;
  const hostOk = /^https:\/\/[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}([/?#][^\s]*)?$/.test(
    url
  );
  if (!hostOk) return false;
  if (/^https:\/\/([^/?#]+\.)?localhost([/?#].*)?$/i.test(url)) return false;
  if (/^https:\/\/([0-9]{1,3}\.){3}[0-9]{1,3}([/?#:].*)?$/i.test(url)) return false;
  return true;
}

export function isValidAvatarUrl(url: unknown): boolean {
  if (isValidPhotoUrl(url)) return true;
  return (
    typeof url === 'string' &&
    url.length <= 150000 &&
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url)
  );
}

export function isValidGitHubUrl(url: unknown): boolean {
  if (url === null || url === '') return true;
  return (
    typeof url === 'string' &&
    url.length <= 100 &&
    /^https:\/\/github\.com\/[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(url)
  );
}

export function isValidLinkedInUrl(url: unknown): boolean {
  if (url === null || url === '') return true;
  return (
    typeof url === 'string' &&
    url.length <= 150 &&
    !/.*\.\..*/.test(url) &&
    /^https:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9._%-]{3,100}\/?$/.test(url)
  );
}

export function isValidPortfolioUrl(url: unknown): boolean {
  if (url === null || url === '') return true;
  if (typeof url !== 'string' || url.length > 200) return false;
  const ok = /^https:\/\/[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}([/?#][^\s]*)?$/.test(
    url
  );
  if (!ok) return false;
  if (/^https:\/\/([^/?#]+\.)?localhost([/?#].*)?$/i.test(url)) return false;
  return true;
}

export interface MemberRecordFinding {
  docId: string;
  compatibleWithIsValidMember: boolean;
  whitelistCompatible: boolean;
  idMatchesDocId: boolean;
  missingFields: string[];
  invalidFields: string[];
  extraNonWhitelistKeys: string[];
  availableAuthoritativeHints: string[];
}

export interface MemberAuditReport {
  auditType: 'members';
  projectId: string;
  databaseId: string;
  auditedAt: string;
  pagesRead: number;
  totalScanned: number;
  fullyCompatibleCount: number;
  rulesCompatibleOnlyCount: number;
  incompatibleCount: number;
  idMismatchCount: number;
  whitelistIncompatibleCount: number;
  missingFieldCounts: Record<string, number>;
  invalidFieldCounts: Record<string, number>;
  extraNonWhitelistKeyCounts: Record<string, number>;
  affectedRecords: MemberRecordFinding[];
}

/**
 * Validates one member document strictly against `/staging/firestore.rules.phase1`
 * `isValidMember(data)` (`L222-239`), `id === doc.id`, and `PUBLIC_MEMBER_WHITELIST`.
 * Never returns personal member values.
 */
export function validateMemberRecord(
  docId: string,
  data: Record<string, unknown>
): MemberRecordFinding {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const extraNonWhitelistKeys: string[] = [];

  for (const reqField of MEMBER_REQUIRED_FIELDS) {
    if (!(reqField in data) || data[reqField] === undefined || data[reqField] === null) {
      missingFields.push(reqField);
    }
  }

  let idMatchesDocId = true;
  if ('id' in data && data.id !== undefined && data.id !== null) {
    if (!isValidFirestoreId(data.id)) {
      invalidFields.push('id');
      idMatchesDocId = false;
    } else if (data.id !== docId) {
      invalidFields.push('id');
      idMatchesDocId = false;
    }
  } else {
    idMatchesDocId = false;
  }

  if ('name' in data && data.name !== undefined && data.name !== null) {
    if (typeof data.name !== 'string' || data.name.trim().length === 0 || data.name.length > 100) {
      invalidFields.push('name');
    }
  }

  if ('handle' in data && data.handle !== undefined && data.handle !== null) {
    if (typeof data.handle !== 'string' || data.handle.trim().length === 0 || data.handle.length > 50) {
      invalidFields.push('handle');
    }
  }

  if ('role' in data && data.role !== undefined && data.role !== null) {
    if (typeof data.role !== 'string' || !ALLOWED_MEMBER_ROLES.has(data.role)) {
      invalidFields.push('role');
    }
  }

  if ('tracks' in data && data.tracks !== undefined && data.tracks !== null) {
    if (!Array.isArray(data.tracks) || data.tracks.length === 0 || data.tracks.length > 10) {
      invalidFields.push('tracks');
    } else {
      const badItems = data.tracks.some(
        (t) => typeof t !== 'string' || t.trim().length === 0 || !CANONICAL_BUILDER_TRACKS.has(t)
      );
      if (badItems) {
        invalidFields.push('tracks');
      }
    }
  }

  if ('joinedDate' in data && data.joinedDate !== undefined && data.joinedDate !== null) {
    if (typeof data.joinedDate !== 'string' || data.joinedDate.trim().length === 0 || data.joinedDate.length > 50) {
      invalidFields.push('joinedDate');
    }
  }

  if ('status' in data && data.status !== undefined && data.status !== null) {
    if (typeof data.status !== 'string' || !ALLOWED_MEMBER_STATUSES.has(data.status)) {
      invalidFields.push('status');
    }
  }

  if ('avatarUrl' in data && data.avatarUrl !== undefined) {
    if (!isValidAvatarUrl(data.avatarUrl)) {
      invalidFields.push('avatarUrl');
    }
  }

  if ('bio' in data && data.bio !== undefined && data.bio !== null) {
    if (typeof data.bio !== 'string' || data.bio.length > 500) {
      invalidFields.push('bio');
    }
  }

  if ('leaderboardOptOut' in data && data.leaderboardOptOut !== undefined && data.leaderboardOptOut !== null) {
    if (typeof data.leaderboardOptOut !== 'boolean') {
      invalidFields.push('leaderboardOptOut');
    }
  }

  if ('showLinksPublicly' in data && data.showLinksPublicly !== undefined && data.showLinksPublicly !== null) {
    if (typeof data.showLinksPublicly !== 'boolean') {
      invalidFields.push('showLinksPublicly');
    }
  }

  if ('readAnnouncementIds' in data && data.readAnnouncementIds !== undefined && data.readAnnouncementIds !== null) {
    if (!Array.isArray(data.readAnnouncementIds) || data.readAnnouncementIds.length > 100) {
      invalidFields.push('readAnnouncementIds');
    }
  }

  if ('githubUrl' in data && data.githubUrl !== undefined && !isValidGitHubUrl(data.githubUrl)) {
    invalidFields.push('githubUrl');
  }
  if ('linkedinUrl' in data && data.linkedinUrl !== undefined && !isValidLinkedInUrl(data.linkedinUrl)) {
    invalidFields.push('linkedinUrl');
  }
  if ('portfolioUrl' in data && data.portfolioUrl !== undefined && !isValidPortfolioUrl(data.portfolioUrl)) {
    invalidFields.push('portfolioUrl');
  }

  for (const key of Object.keys(data)) {
    if (!PUBLIC_MEMBER_WHITELIST.has(key)) {
      extraNonWhitelistKeys.push(key);
    }
  }
  extraNonWhitelistKeys.sort();

  const availableAuthoritativeHints: string[] = [];
  if (typeof data.authUid === 'string' && data.authUid.trim().length > 0) {
    availableAuthoritativeHints.push('has_linked_authUid');
  }
  if (typeof data.createdAt === 'string' && data.createdAt.trim().length > 0) {
    availableAuthoritativeHints.push('has_createdAt_string');
  } else if (
    data.createdAt &&
    typeof data.createdAt === 'object' &&
    (data.createdAt as { __firestoreType?: string }).__firestoreType === 'timestamp'
  ) {
    availableAuthoritativeHints.push('has_createdAt_timestamp');
  }

  const uniqueInvalid = Array.from(new Set(invalidFields)).sort();
  const compatibleWithIsValidMember =
    missingFields.length === 0 && uniqueInvalid.length === 0 && idMatchesDocId;
  const whitelistCompatible = extraNonWhitelistKeys.length === 0;

  return {
    docId,
    compatibleWithIsValidMember,
    whitelistCompatible,
    idMatchesDocId,
    missingFields: missingFields.sort(),
    invalidFields: uniqueInvalid,
    extraNonWhitelistKeys,
    availableAuthoritativeHints,
  };
}

export async function runMemberAudit(
  client: ReadOnlyFirestoreClient,
  options: { pageSize?: number } = {}
): Promise<MemberAuditReport> {
  await client.verifyTargetDatabase();
  const { documents, pagesRead } = await readAllPaginated(
    client,
    'members',
    options.pageSize ?? DEFAULT_PAGE_SIZE
  );

  const missingFieldCounts: Record<string, number> = {};
  const invalidFieldCounts: Record<string, number> = {};
  const extraNonWhitelistKeyCounts: Record<string, number> = {};
  const affectedRecords: MemberRecordFinding[] = [];

  let fullyCompatibleCount = 0;
  let rulesCompatibleOnlyCount = 0;
  let incompatibleCount = 0;
  let idMismatchCount = 0;
  let whitelistIncompatibleCount = 0;

  for (const doc of documents) {
    const finding = validateMemberRecord(doc.id, doc.data);
    if (!finding.idMatchesDocId && 'id' in doc.data && doc.data.id !== undefined && doc.data.id !== null) {
      idMismatchCount += 1;
    }

    for (const f of finding.missingFields) {
      missingFieldCounts[f] = (missingFieldCounts[f] || 0) + 1;
    }
    for (const f of finding.invalidFields) {
      invalidFieldCounts[f] = (invalidFieldCounts[f] || 0) + 1;
    }
    for (const k of finding.extraNonWhitelistKeys) {
      extraNonWhitelistKeyCounts[k] = (extraNonWhitelistKeyCounts[k] || 0) + 1;
    }

    if (!finding.whitelistCompatible) {
      whitelistIncompatibleCount += 1;
    }

    if (finding.compatibleWithIsValidMember && finding.whitelistCompatible) {
      fullyCompatibleCount += 1;
    } else {
      if (finding.compatibleWithIsValidMember) {
        rulesCompatibleOnlyCount += 1;
      } else {
        incompatibleCount += 1;
      }
      affectedRecords.push(finding);
    }
  }

  return {
    auditType: 'members',
    projectId: client.target.projectId,
    databaseId: client.target.databaseId,
    auditedAt: new Date().toISOString(),
    pagesRead,
    totalScanned: documents.length,
    fullyCompatibleCount,
    rulesCompatibleOnlyCount,
    incompatibleCount,
    idMismatchCount,
    whitelistIncompatibleCount,
    missingFieldCounts,
    invalidFieldCounts,
    extraNonWhitelistKeyCounts,
    affectedRecords,
  };
}

function parseOutFlag(argv: string[]): string | undefined {
  const idx = argv.indexOf('--out');
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const target = resolveTargetConfigFromEnv();
  const client = new RestReadOnlyFirestoreClient(target);
  const report = await runMemberAudit(client);
  const jsonOutput = JSON.stringify(report, null, 2);

  const outPath = parseOutFlag(process.argv.slice(2));
  if (outPath) {
    const resolved = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, jsonOutput + '\n', 'utf8');
    console.error(`Wrote anonymized member audit report to ${resolved}`);
  }
  console.log(jsonOutput);
}

const isCliEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCliEntry) {
  main().catch((err) => {
    console.error(`Member audit aborted: ${redactSensitiveErrorText(err)}`);
    process.exit(1);
  });
}
