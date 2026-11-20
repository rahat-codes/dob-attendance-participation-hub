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
import { isValidFirestoreId } from './auditMembers.ts';

export const NOTIFICATION_REQUIRED_FIELDS = [
  'id',
  'userId',
  'title',
  'message',
  'createdAt',
] as const;

export const NOTIFICATION_ALLOWED_FIELDS = new Set<string>([
  'id',
  'userId',
  'title',
  'message',
  'type',
  'read',
  'dismissed',
  'createdAt',
  'sessionId',
  'sessionDate',
  'sessionLocation',
  'sessionTime',
]);

export const ALLOWED_NOTIFICATION_TYPES = new Set<string>([
  'announcement',
  'reminder',
  'system',
  'meeting_published',
  'meeting_reminder_30m',
  'meeting_rescheduled',
  'meeting_cancelled',
]);

export type NotificationAuditClassification =
  | 'compatible'
  | 'id_repair_candidate'
  | 'orphaned'
  | 'other_incompatible';

export type NotificationUserStatus =
  | 'exists'
  | 'missing_field'
  | 'invalid_format'
  | 'nonexistent_user';

export interface NotificationRecordFinding {
  docId: string;
  classification: NotificationAuditClassification;
  userStatus: NotificationUserStatus;
  idMissing: boolean;
  idMismatch: boolean;
  missingFields: string[];
  invalidFields: string[];
  historicalExtraFieldNames: string[];
  eligibleForStagedIdRepair: boolean;
}

export interface NotificationAuditReport {
  auditType: 'notifications';
  projectId: string;
  databaseId: string;
  auditedAt: string;
  pagesRead: number;
  totalScanned: number;
  uniqueValidUserIdsChecked: number;
  countsByClass: Record<NotificationAuditClassification, number>;
  missingIdCount: number;
  mismatchedIdCount: number;
  missingUserIdCount: number;
  invalidUserIdCount: number;
  nonexistentTargetUserCount: number;
  missingOrInvalidCreatedAtCount: number;
  docsWithHistoricalExtraFieldsCount: number;
  historicalExtraFieldNameCounts: Record<string, number>;
  affectedRecords: NotificationRecordFinding[];
}

export function classifyNotificationRecord(
  docId: string,
  data: Record<string, unknown>,
  userExistsMap: Map<string, boolean>
): NotificationRecordFinding {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const historicalExtraFieldNames: string[] = [];

  for (const field of NOTIFICATION_REQUIRED_FIELDS) {
    if (!(field in data) || data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  }

  for (const key of Object.keys(data)) {
    if (!NOTIFICATION_ALLOWED_FIELDS.has(key)) {
      historicalExtraFieldNames.push(key);
    }
  }
  historicalExtraFieldNames.sort();

  // Inspect ID strictly without mutating
  const idMissing = !('id' in data) || data.id === undefined || data.id === null;
  let idMismatch = false;
  if (!idMissing) {
    if (!isValidFirestoreId(data.id) || data.id !== docId) {
      idMismatch = true;
      invalidFields.push('id');
    }
  }

  // Inspect userId + existence
  let userStatus: NotificationUserStatus;
  const rawUserId = data.userId;
  if (!('userId' in data) || rawUserId === undefined || rawUserId === null || rawUserId === '') {
    userStatus = 'missing_field';
  } else if (!isValidFirestoreId(rawUserId)) {
    userStatus = 'invalid_format';
    invalidFields.push('userId');
  } else if (userExistsMap.get(rawUserId) !== true) {
    userStatus = 'nonexistent_user';
  } else {
    userStatus = 'exists';
  }

  // Inspect content/schema fields matching staging isValidNotification (`L325-343`)
  if ('title' in data && data.title !== undefined && data.title !== null) {
    if (typeof data.title !== 'string' || data.title.length === 0 || data.title.length > 150) {
      invalidFields.push('title');
    }
  }
  if ('message' in data && data.message !== undefined && data.message !== null) {
    if (typeof data.message !== 'string' || data.message.length === 0 || data.message.length > 1000) {
      invalidFields.push('message');
    }
  }
  if ('createdAt' in data && data.createdAt !== undefined && data.createdAt !== null) {
    if (typeof data.createdAt !== 'string' || data.createdAt.length === 0 || data.createdAt.length > 50) {
      invalidFields.push('createdAt');
    }
  }
  if ('type' in data && data.type !== undefined) {
    if (typeof data.type !== 'string' || !ALLOWED_NOTIFICATION_TYPES.has(data.type)) {
      invalidFields.push('type');
    }
  }
  if ('read' in data && data.read !== undefined && typeof data.read !== 'boolean') {
    invalidFields.push('read');
  }
  if ('dismissed' in data && data.dismissed !== undefined && typeof data.dismissed !== 'boolean') {
    invalidFields.push('dismissed');
  }
  if ('sessionId' in data && data.sessionId !== undefined) {
    if (typeof data.sessionId !== 'string' || data.sessionId.length > 128) {
      invalidFields.push('sessionId');
    }
  }
  if ('sessionDate' in data && data.sessionDate !== undefined) {
    if (typeof data.sessionDate !== 'string' || data.sessionDate.length > 50) {
      invalidFields.push('sessionDate');
    }
  }
  if ('sessionLocation' in data && data.sessionLocation !== undefined) {
    if (typeof data.sessionLocation !== 'string' || data.sessionLocation.length > 150) {
      invalidFields.push('sessionLocation');
    }
  }
  if ('sessionTime' in data && data.sessionTime !== undefined) {
    if (typeof data.sessionTime !== 'string' || data.sessionTime.length > 50) {
      invalidFields.push('sessionTime');
    }
  }

  const uniqueMissing = Array.from(new Set(missingFields)).sort();
  const uniqueInvalid = Array.from(new Set(invalidFields)).sort();

  const nonIdMissing = uniqueMissing.filter((f) => f !== 'id');
  const nonIdInvalid = uniqueInvalid.filter((f) => f !== 'id');

  // Staged rule (`isValidLegacyNotificationIdRepair` at L348-359):
  // Permitted ONLY when docId is valid, id is missing or != docId, userId is valid & target exists.
  const eligibleForStagedIdRepair =
    isValidFirestoreId(docId) &&
    (idMissing || idMismatch) &&
    userStatus === 'exists';

  let classification: NotificationAuditClassification;
  if (userStatus !== 'exists') {
    classification = 'orphaned';
  } else if (nonIdMissing.length > 0 || nonIdInvalid.length > 0) {
    classification = 'other_incompatible';
  } else if (idMissing || idMismatch) {
    classification = 'id_repair_candidate';
  } else if (historicalExtraFieldNames.length > 0) {
    // Full schema `isValidNotification` enforces hasOnly(12 keys); historical extra keys without
    // an ID issue cannot pass full `isValidNotification` updates and are flagged as `other_incompatible`.
    classification = 'other_incompatible';
  } else {
    classification = 'compatible';
  }

  return {
    docId,
    classification,
    userStatus,
    idMissing,
    idMismatch,
    missingFields: uniqueMissing,
    invalidFields: uniqueInvalid,
    historicalExtraFieldNames,
    eligibleForStagedIdRepair,
  };
}

export async function runNotificationAudit(
  client: ReadOnlyFirestoreClient,
  options: { pageSize?: number } = {}
): Promise<NotificationAuditReport> {
  await client.verifyTargetDatabase();
  const { documents, pagesRead } = await readAllPaginated(
    client,
    'notifications',
    options.pageSize ?? DEFAULT_PAGE_SIZE
  );

  // Collect all unique valid userId references first for batched existence verification
  const candidateUserIds = new Set<string>();
  for (const doc of documents) {
    const rawUserId = doc.data.userId;
    if (isValidFirestoreId(rawUserId)) {
      candidateUserIds.add(rawUserId);
    }
  }

  const uniqueValidUserIds = Array.from(candidateUserIds);
  const userExistsMap = await client.batchCheckDocumentsExist('users', uniqueValidUserIds);

  const countsByClass: Record<NotificationAuditClassification, number> = {
    compatible: 0,
    id_repair_candidate: 0,
    orphaned: 0,
    other_incompatible: 0,
  };
  const historicalExtraFieldNameCounts: Record<string, number> = {};
  const affectedRecords: NotificationRecordFinding[] = [];

  let missingIdCount = 0;
  let mismatchedIdCount = 0;
  let missingUserIdCount = 0;
  let invalidUserIdCount = 0;
  let nonexistentTargetUserCount = 0;
  let missingOrInvalidCreatedAtCount = 0;
  let docsWithHistoricalExtraFieldsCount = 0;

  for (const doc of documents) {
    const finding = classifyNotificationRecord(doc.id, doc.data, userExistsMap);
    countsByClass[finding.classification] += 1;

    if (finding.idMissing) missingIdCount += 1;
    if (finding.idMismatch) mismatchedIdCount += 1;
    if (finding.userStatus === 'missing_field') missingUserIdCount += 1;
    if (finding.userStatus === 'invalid_format') invalidUserIdCount += 1;
    if (finding.userStatus === 'nonexistent_user') nonexistentTargetUserCount += 1;
    if (finding.missingFields.includes('createdAt') || finding.invalidFields.includes('createdAt')) {
      missingOrInvalidCreatedAtCount += 1;
    }
    if (finding.historicalExtraFieldNames.length > 0) {
      docsWithHistoricalExtraFieldsCount += 1;
      for (const extra of finding.historicalExtraFieldNames) {
        historicalExtraFieldNameCounts[extra] = (historicalExtraFieldNameCounts[extra] || 0) + 1;
      }
    }

    if (finding.classification !== 'compatible') {
      affectedRecords.push(finding);
    }
  }

  return {
    auditType: 'notifications',
    projectId: client.target.projectId,
    databaseId: client.target.databaseId,
    auditedAt: new Date().toISOString(),
    pagesRead,
    totalScanned: documents.length,
    uniqueValidUserIdsChecked: uniqueValidUserIds.length,
    countsByClass,
    missingIdCount,
    mismatchedIdCount,
    missingUserIdCount,
    invalidUserIdCount,
    nonexistentTargetUserCount,
    missingOrInvalidCreatedAtCount,
    docsWithHistoricalExtraFieldsCount,
    historicalExtraFieldNameCounts,
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
  const report = await runNotificationAudit(client);
  const jsonOutput = JSON.stringify(report, null, 2);

  const outPath = parseOutFlag(process.argv.slice(2));
  if (outPath) {
    const resolved = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, jsonOutput + '\n', 'utf8');
    console.error(`Wrote anonymized notification audit report to ${resolved}`);
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
    console.error(`Notification audit aborted: ${redactSensitiveErrorText(err)}`);
    process.exit(1);
  });
}
