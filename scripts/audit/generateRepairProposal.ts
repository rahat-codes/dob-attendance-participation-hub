import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MemberAuditReport,
  MemberRecordFinding,
  runMemberAudit,
} from './auditMembers.ts';
import {
  NotificationAuditReport,
  NotificationRecordFinding,
  runNotificationAudit,
} from './auditNotifications.ts';
import {
  RestReadOnlyFirestoreClient,
  redactSensitiveErrorText,
  resolveTargetConfigFromEnv,
} from './firestoreReadOnlyClient.ts';

export type AuthoritativeSourceRule = {
  field: string;
  action: 'backfill_if_missing' | 'manual_review' | 'isolate_to_memberPrivate' | 'strip_counter_key';
  requiresHumanConfirmation: boolean;
  authoritativeSources: string[];
  notes: string;
};

export interface MemberRepairProposalItem {
  docId: string;
  neverOverwriteExistingValidFields: true;
  derivableConfirmationsNeeded: AuthoritativeSourceRule[];
  humanConfirmationRequiredFields: AuthoritativeSourceRule[];
  extraKeysAction: Array<{
    key: string;
    destination: 'memberPrivate' | 'remove_from_public';
    notes: string;
  }>;
}

export interface NotificationRepairProposalItem {
  docId: string;
  classification: NotificationRecordFinding['classification'];
  action: 'propose_scoped_id_patch' | 'manual_orphan_review_archive_or_delete' | 'manual_schema_review';
  proposedPatch: { id: string } | null;
  preservesHistoricalFields: boolean;
  historicalExtraFieldNames: string[];
  reason: string;
}

export interface CombinedRepairProposalReport {
  reportType: 'dob_hub_phase2b_repair_proposal';
  generatedAt: string;
  executionMode: 'DRY_RUN_PROPOSAL_ONLY_ZERO_WRITES';
  projectId: string;
  databaseId: string;
  memberSummary: {
    totalScanned: number;
    fullyCompatibleCount: number;
    membersWithProposalsCount: number;
    autoDerivableCandidatesCount: number;
    humanConfirmationRequiredCount: number;
  };
  memberProposals: MemberRepairProposalItem[];
  notificationSummary: {
    totalScanned: number;
    compatibleCount: number;
    scopedIdRepairCandidatesCount: number;
    orphanedManualReviewCount: number;
    otherIncompatibleCount: number;
  };
  notificationProposals: NotificationRepairProposalItem[];
}

const PRIVATE_PII_KEYS = new Set<string>([
  'email',
  'phone',
  'studentId',
  'university',
  'department',
  'major',
  'semester',
]);

const AUTHORITATIVE_MEMBER_FIELD_SOURCES: Record<string, Omit<AuthoritativeSourceRule, 'field'>> = {
  id: {
    action: 'backfill_if_missing',
    requiresHumanConfirmation: false,
    authoritativeSources: [
      'Firestore document ID (`doc.id`) after confirming no colliding `users/{uid}.memberId` or `checkIns` reference mismatch',
    ],
    notes: 'Only populates missing `id` or aligns verified doc ID match; never overwrites a differing ID without human confirmation.',
  },
  joinedDate: {
    action: 'manual_review',
    requiresHumanConfirmation: true,
    authoritativeSources: [
      'Earliest `checkIns` record (`checkedInAt`) for this `docId` (converted to Asia/Seoul YYYY-MM-DD)',
      '`members/{docId}.createdAt` ISO date prefix',
      'Linked `users/{authUid}.approvedAt` or `users/{authUid}.createdAt`',
      'Historical club onboarding CSV / `auditLogs` intake record',
    ],
    notes: 'Requires Super Admin verification if no authoritative timestamp/check-in source exists. Never invent today’s date.',
  },
  tracks: {
    action: 'manual_review',
    requiresHumanConfirmation: true,
    authoritativeSources: [
      'Linked `users/{authUid}.applicantTrack`',
      'Dominant `sessions.track` across historical `checkIns` for this member',
      '`publicLeaderboard/{docId}.tracks` or official club sprint roster',
    ],
    notes: 'Never assign an arbitrary default track; confirm track discipline with club leadership.',
  },
  role: {
    action: 'manual_review',
    requiresHumanConfirmation: true,
    authoritativeSources: [
      '`publicLeaderboard/{docId}.role`',
      '`admins/{authUid}` + `auditLogs` (`update_member` / `grant_admin`)',
      'Official Den of Builders officer roster',
    ],
    notes: 'Human confirmation mandatory; never auto-assign `Member` or executive ranks without roster verification.',
  },
  status: {
    action: 'manual_review',
    requiresHumanConfirmation: true,
    authoritativeSources: [
      'Linked `users/{authUid}.status` (`active` vs `declined` / `suspended`)',
      '`auditLogs` (`deactivate_member` / `restore_member`)',
      'Recent `checkIns` attendance records',
    ],
    notes: 'Human confirmation mandatory to avoid accidentally activating deactivated members or deactivating active builders.',
  },
  name: {
    action: 'manual_review',
    requiresHumanConfirmation: true,
    authoritativeSources: [
      'Linked `users/{authUid}.applicantName` / `displayName`',
      '`publicLeaderboard/{docId}.name`',
      'Club membership intake record',
    ],
    notes: 'Human confirmation required before updating identity display fields.',
  },
  handle: {
    action: 'manual_review',
    requiresHumanConfirmation: true,
    authoritativeSources: [
      'Linked `users/{authUid}.applicantHandle`',
      '`publicLeaderboard/{docId}.handle`',
      'Unique handle check via `isHandleTaken` (`src/utils/reuseHelpers.ts`)',
    ],
    notes: 'Handle is immutable for non-admin updates; verify uniqueness before proposing backfill.',
  },
};

export function buildMemberRepairProposal(
  finding: MemberRecordFinding
): MemberRepairProposalItem | null {
  const fieldsNeedingAttention = Array.from(
    new Set([...finding.missingFields, ...finding.invalidFields])
  ).sort();

  if (fieldsNeedingAttention.length === 0 && finding.extraNonWhitelistKeys.length === 0) {
    return null;
  }

  const derivableConfirmationsNeeded: AuthoritativeSourceRule[] = [];
  const humanConfirmationRequiredFields: AuthoritativeSourceRule[] = [];

  for (const field of fieldsNeedingAttention) {
    const spec = AUTHORITATIVE_MEMBER_FIELD_SOURCES[field];
    if (field === 'id' && !finding.missingFields.includes('id') && !finding.idMatchesDocId) {
      // An existing mismatched `id` differs from docId and must be reviewed by a human
      humanConfirmationRequiredFields.push({
        field,
        action: 'manual_review',
        requiresHumanConfirmation: true,
        authoritativeSources: [
          'Cross-check `doc.id` vs existing `id`, `users/{uid}.memberId`, and `checkIns.memberId`',
        ],
        notes: 'Existing `id` differs from Firestore document ID (`doc.id`); confirm authoritative key before modifying.',
      });
      continue;
    }

    if (spec) {
      const rule: AuthoritativeSourceRule = { field, ...spec };
      if (rule.requiresHumanConfirmation) {
        humanConfirmationRequiredFields.push(rule);
      } else {
        derivableConfirmationsNeeded.push(rule);
      }
    } else {
      humanConfirmationRequiredFields.push({
        field,
        action: 'manual_review',
        requiresHumanConfirmation: true,
        authoritativeSources: ['Member profile / Super Admin inspection of `members/{docId}`'],
        notes: `Invalid or non-conforming optional field "${field}" under staging \`isValidMember\` rules.`,
      });
    }
  }

  const extraKeysAction = finding.extraNonWhitelistKeys.map((key) => ({
    key,
    destination: (PRIVATE_PII_KEYS.has(key) ? 'memberPrivate' : 'remove_from_public') as
      | 'memberPrivate'
      | 'remove_from_public',
    notes: PRIVATE_PII_KEYS.has(key)
      ? 'Preserve non-empty value into `memberPrivate/{docId}` (without overwriting existing populated `memberPrivate` keys), then strip from public `members/{docId}`.'
      : 'Non-whitelisted legacy/derived field (e.g., cached counter or metadata); verify unused before removing from public `members/{docId}`.',
  }));

  return {
    docId: finding.docId,
    neverOverwriteExistingValidFields: true,
    derivableConfirmationsNeeded,
    humanConfirmationRequiredFields,
    extraKeysAction,
  };
}

export function buildNotificationRepairProposal(
  finding: NotificationRecordFinding
): NotificationRepairProposalItem | null {
  if (finding.classification === 'compatible') {
    return null;
  }

  if (finding.classification === 'id_repair_candidate' && finding.eligibleForStagedIdRepair) {
    return {
      docId: finding.docId,
      classification: finding.classification,
      action: 'propose_scoped_id_patch',
      proposedPatch: { id: finding.docId },
      preservesHistoricalFields: true,
      historicalExtraFieldNames: finding.historicalExtraFieldNames,
      reason:
        'Target user exists in `users/` and only `id` is missing/mismatched. Staged `isValidLegacyNotificationIdRepair` permits admin `{ id: doc.id }` update while preserving `userId` and historical fields.',
    };
  }

  if (finding.classification === 'orphaned') {
    return {
      docId: finding.docId,
      classification: finding.classification,
      action: 'manual_orphan_review_archive_or_delete',
      proposedPatch: null,
      preservesHistoricalFields: true,
      historicalExtraFieldNames: finding.historicalExtraFieldNames,
      reason: `Cannot use staged ID repair (${finding.userStatus}): staged rules require existing \`users/{userId}\`. Retain in cold archive or review for admin deletion.`,
    };
  }

  const nonIdProblems = Array.from(
    new Set([...finding.missingFields, ...finding.invalidFields].filter((f) => f !== 'id'))
  );
  return {
    docId: finding.docId,
    classification: 'other_incompatible',
    action: 'manual_schema_review',
    proposedPatch: null,
    preservesHistoricalFields: true,
    historicalExtraFieldNames: finding.historicalExtraFieldNames,
    reason:
      nonIdProblems.length > 0
        ? `Incompatible core/optional fields beyond \`id\`: [${nonIdProblems.join(', ')}]. Verify authoritative values or archive before schema enforcement.`
        : 'Contains historical extra keys outside the 12-key `isValidNotification` allowlist without an `id` defect; future full-document edits will require stripping or retaining read-only.',
  };
}

export function buildCombinedRepairProposalReport(
  memberReport: MemberAuditReport,
  notificationReport: NotificationAuditReport
): CombinedRepairProposalReport {
  if (
    memberReport.projectId !== notificationReport.projectId ||
    memberReport.databaseId !== notificationReport.databaseId
  ) {
    throw new Error(
      'Cannot combine audit reports from differing target projects or Firestore databases.'
    );
  }

  const memberProposals: MemberRepairProposalItem[] = [];
  let autoDerivableCandidatesCount = 0;
  let humanConfirmationRequiredCount = 0;

  for (const finding of memberReport.affectedRecords) {
    const proposal = buildMemberRepairProposal(finding);
    if (!proposal) continue;
    memberProposals.push(proposal);
    if (proposal.derivableConfirmationsNeeded.length > 0 || proposal.extraKeysAction.length > 0) {
      autoDerivableCandidatesCount += 1;
    }
    if (proposal.humanConfirmationRequiredFields.length > 0) {
      humanConfirmationRequiredCount += 1;
    }
  }

  const notificationProposals: NotificationRepairProposalItem[] = [];
  for (const finding of notificationReport.affectedRecords) {
    const proposal = buildNotificationRepairProposal(finding);
    if (proposal) {
      notificationProposals.push(proposal);
    }
  }

  return {
    reportType: 'dob_hub_phase2b_repair_proposal',
    generatedAt: new Date().toISOString(),
    executionMode: 'DRY_RUN_PROPOSAL_ONLY_ZERO_WRITES',
    projectId: memberReport.projectId,
    databaseId: memberReport.databaseId,
    memberSummary: {
      totalScanned: memberReport.totalScanned,
      fullyCompatibleCount: memberReport.fullyCompatibleCount,
      membersWithProposalsCount: memberProposals.length,
      autoDerivableCandidatesCount,
      humanConfirmationRequiredCount,
    },
    memberProposals,
    notificationSummary: {
      totalScanned: notificationReport.totalScanned,
      compatibleCount: notificationReport.countsByClass.compatible,
      scopedIdRepairCandidatesCount: notificationReport.countsByClass.id_repair_candidate,
      orphanedManualReviewCount: notificationReport.countsByClass.orphaned,
      otherIncompatibleCount: notificationReport.countsByClass.other_incompatible,
    },
    notificationProposals,
  };
}

function getArgValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const membersInputPath = getArgValue(argv, '--members-report');
  const notificationsInputPath = getArgValue(argv, '--notifications-report');
  const outPath = getArgValue(argv, '--out');

  let memberReport: MemberAuditReport;
  let notificationReport: NotificationAuditReport;

  if (membersInputPath && notificationsInputPath) {
    memberReport = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), membersInputPath), 'utf8')
    ) as MemberAuditReport;
    notificationReport = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), notificationsInputPath), 'utf8')
    ) as NotificationAuditReport;
  } else {
    const target = resolveTargetConfigFromEnv();
    const client = new RestReadOnlyFirestoreClient(target);
    memberReport = await runMemberAudit(client);
    notificationReport = await runNotificationAudit(client);
  }

  const proposal = buildCombinedRepairProposalReport(memberReport, notificationReport);
  const outputJson = JSON.stringify(proposal, null, 2);

  if (outPath) {
    const resolved = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, outputJson + '\n', 'utf8');
    console.error(`Wrote anonymized dry-run repair proposal to ${resolved}`);
  }
  console.log(outputJson);
}

const isCliEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCliEntry) {
  main().catch((err) => {
    console.error(`Repair proposal generation aborted: ${redactSensitiveErrorText(err)}`);
    process.exit(1);
  });
}
