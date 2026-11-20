import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BATCH_GET_MAX_DOCS,
  EXPECTED_DATABASE_ID,
  EXPECTED_PROJECT_ID,
  PaginatedQueryPage,
  RawFirestoreDocument,
  ReadOnlyAuditAccessError,
  ReadOnlyFirestoreClient,
  TargetVerificationError,
  assertValidTargetConfig,
  decodeFirestoreFields,
  readAllPaginated,
  redactSensitiveErrorText,
  resolveTargetConfigFromEnv,
} from '../scripts/audit/firestoreReadOnlyClient.ts';
import { MemberAuditReport, runMemberAudit } from '../scripts/audit/auditMembers.ts';
import { NotificationAuditReport, runNotificationAudit } from '../scripts/audit/auditNotifications.ts';
import {
  CombinedRepairProposalReport,
  buildCombinedRepairProposalReport,
} from '../scripts/audit/generateRepairProposal.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function assertThrowsSync(fn: () => void, expectedErrorName: string, message: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof Error, `${message} (expected throw, succeeded instead)`);
  assert(
    caught.name === expectedErrorName,
    `${message} (expected ${expectedErrorName}, got ${caught.name}: ${caught.message})`
  );
}

async function assertRejectsAsync(
  fn: () => Promise<unknown>,
  expectedErrorName: string,
  message: string
): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof Error, `${message} (expected rejection, resolved instead)`);
  assert(
    caught.name === expectedErrorName,
    `${message} (expected ${expectedErrorName}, got ${caught.name}: ${caught.message})`
  );
}

class SyntheticReadOnlyFirestoreClient implements ReadOnlyFirestoreClient {
  public readonly target = {
    projectId: EXPECTED_PROJECT_ID,
    databaseId: EXPECTED_DATABASE_ID,
  };
  public readonly listCalls: Array<{ collectionName: string; pageSize: number; pageToken?: string }> = [];
  public readonly batchCheckCalls: string[][] = [];
  public simulateHttpError: number | null = null;
  public simulateCyclicToken = false;

  private collections = new Map<string, RawFirestoreDocument[]>();

  public seedCollection(collectionName: string, docs: RawFirestoreDocument[]): void {
    const sorted = [...docs].sort((a, b) => a.id.localeCompare(b.id));
    this.collections.set(collectionName, sorted);
  }

  public async verifyTargetDatabase(): Promise<{ resourceName: string; type: string }> {
    if (this.simulateHttpError) {
      throw new ReadOnlyAuditAccessError(
        `Simulated HTTP ${this.simulateHttpError}`,
        this.simulateHttpError
      );
    }
    assertValidTargetConfig(this.target);
    return {
      resourceName: `projects/${this.target.projectId}/databases/${this.target.databaseId}`,
      type: 'FIRESTORE_NATIVE',
    };
  }

  public async listCollectionPage(
    collectionName: string,
    pageSize: number,
    pageToken?: string
  ): Promise<PaginatedQueryPage> {
    if (this.simulateHttpError) {
      throw new ReadOnlyAuditAccessError(
        `Simulated HTTP ${this.simulateHttpError}`,
        this.simulateHttpError
      );
    }
    this.listCalls.push({ collectionName, pageSize, pageToken });
    const docs = this.collections.get(collectionName) || [];
    if (this.simulateCyclicToken && docs.length > 0) {
      return { documents: docs.slice(0, pageSize), nextPageToken: 'offset:0' };
    }
    const offset = pageToken ? Number(pageToken.replace('offset:', '')) : 0;
    const slice = docs.slice(offset, offset + pageSize);
    const nextOffset = offset + slice.length;
    return {
      documents: slice,
      nextPageToken: nextOffset < docs.length ? `offset:${nextOffset}` : undefined,
    };
  }

  public async batchCheckDocumentsExist(
    collectionName: string,
    documentIds: string[]
  ): Promise<Map<string, boolean>> {
    if (this.simulateHttpError) {
      throw new ReadOnlyAuditAccessError(
        `Simulated HTTP ${this.simulateHttpError}`,
        this.simulateHttpError
      );
    }
    const existingSet = new Set((this.collections.get(collectionName) || []).map((d) => d.id));
    const result = new Map<string, boolean>();
    const unique = Array.from(new Set(documentIds));
    for (let i = 0; i < unique.length; i += BATCH_GET_MAX_DOCS) {
      const chunk = unique.slice(i, i + BATCH_GET_MAX_DOCS);
      this.batchCheckCalls.push(chunk);
      for (const id of chunk) {
        result.set(id, existingSet.has(id));
      }
    }
    return result;
  }
}

async function runTests(): Promise<{
  memberReport: MemberAuditReport;
  notificationReport: NotificationAuditReport;
  proposalReport: CombinedRepairProposalReport;
}> {
  let passed = 0;
  async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  }

  await test('Target verification rejects wrong project, wrong database, default DB, and accepts exact target', () => {
    assertThrowsSync(
      () => assertValidTargetConfig({ projectId: 'other-project', databaseId: EXPECTED_DATABASE_ID }),
      'TargetVerificationError',
      'Must reject wrong projectId'
    );
    assertThrowsSync(
      () => assertValidTargetConfig({ projectId: EXPECTED_PROJECT_ID, databaseId: '(default)' }),
      'TargetVerificationError',
      'Must reject (default) database'
    );
    assertThrowsSync(
      () => assertValidTargetConfig({ projectId: EXPECTED_PROJECT_ID, databaseId: 'wrong-db' }),
      'TargetVerificationError',
      'Must reject wrong databaseId'
    );
    const valid = resolveTargetConfigFromEnv({});
    assert(valid.projectId === EXPECTED_PROJECT_ID, 'Expected projectId must resolve cleanly');
    assert(valid.databaseId === EXPECTED_DATABASE_ID, 'Expected databaseId must resolve cleanly');
  });

  await test('Firestore REST field decoder preserves strings, numbers, arrays, maps, booleans, nulls, and tags Timestamps', () => {
    const decoded = decodeFirestoreFields({
      id: { stringValue: 'notif_1' },
      read: { booleanValue: false },
      count: { integerValue: '42' },
      tags: { arrayValue: { values: [{ stringValue: 'AI & Embedded' }] } },
      createdAt: { timestampValue: '2026-01-01T00:00:00Z' },
      nested: { mapValue: { fields: { flag: { nullValue: null } } } },
    });
    assert(decoded.id === 'notif_1', 'stringValue decoded');
    assert(decoded.read === false, 'booleanValue decoded');
    assert(decoded.count === 42, 'integerValue decoded');
    assert(Array.isArray(decoded.tags) && decoded.tags[0] === 'AI & Embedded', 'arrayValue decoded');
    assert(
      typeof decoded.createdAt === 'object' &&
        decoded.createdAt !== null &&
        (decoded.createdAt as { __firestoreType?: string }).__firestoreType === 'timestamp',
      'timestampValue tagged distinctly from string'
    );
    assert((decoded.nested as Record<string, unknown>).flag === null, 'nullValue decoded');
  });

  await test('Permission/missing errors and tokens are safely handled and redacted', async () => {
    const redacted = redactSensitiveErrorText('Failed Bearer ya29.superSecretToken_12345 with key AIzaSySecretKey1234567890123');
    assert(!redacted.includes('ya29.superSecretToken'), 'Bearer token must be redacted');
    assert(!redacted.includes('AIzaSySecretKey'), 'API key must be redacted');

    const failingClient = new SyntheticReadOnlyFirestoreClient();
    failingClient.simulateHttpError = 403;
    await assertRejectsAsync(
      () => runMemberAudit(failingClient),
      'ReadOnlyAuditAccessError',
      '403 permission denied must abort safely'
    );

    const cyclicClient = new SyntheticReadOnlyFirestoreClient();
    cyclicClient.seedCollection('members', [{ id: 'mem_01', path: 'members/mem_01', data: {} }]);
    cyclicClient.simulateCyclicToken = true;
    await assertRejectsAsync(
      () => readAllPaginated(cyclicClient, 'members', 1),
      'ReadOnlyAuditAccessError',
      'Cyclic nextPageToken must abort cleanly'
    );
  });

  // Seed 650 synthetic members to verify > 500 pagination plus all compatibility edge cases
  const syntheticClient = new SyntheticReadOnlyFirestoreClient();
  const memberDocs: RawFirestoreDocument[] = [];
  for (let i = 1; i <= 645; i++) {
    const id = `mem_syn_${String(i).padStart(4, '0')}`;
    memberDocs.push({
      id,
      path: `members/${id}`,
      data: {
        id,
        name: `Synthetic Builder ${i}`,
        handle: `@syn_${i}`,
        role: 'Member',
        tracks: ['Software & Systems'],
        joinedDate: '2026-01-15',
        status: 'Active',
        authUid: `uid_syn_${i}`,
        portfolioUrl: `https://example.org/builder/${i}?tab=hw#top`,
      },
    });
  }
  // Edge case 1: missing id + joinedDate + extra PII keys
  memberDocs.push({
    id: 'mem_edge_missing',
    path: 'members/mem_edge_missing',
    data: {
      name: 'Alice Synthetic',
      handle: '@alice_syn',
      role: 'Member',
      tracks: ['Hardware & Robotics'],
      status: 'Active',
      email: 'alice.syn@example.com',
      phone: '010-9999-8888',
      studentId: '20269999',
      totalCheckIns: 12,
      authUid: 'uid_edge_1',
    },
  });
  // Edge case 2: id !== doc.id + malformed portfolioUrl & bad track & invalid role
  memberDocs.push({
    id: 'mem_edge_malformed',
    path: 'members/mem_edge_malformed',
    data: {
      id: 'mem_wrong_inner_id',
      name: 'Bob Synthetic',
      handle: '@bob_syn',
      role: 'Wizard',
      tracks: ['NonExistentTrack'],
      joinedDate: '2026-02-01',
      status: 'Active',
      portfolioUrl: 'http://localhost:3000/bad',
      bio: 'x'.repeat(505),
    },
  });
  // Edge case 3: missing tracks, missing status, missing name, missing handle
  memberDocs.push({
    id: 'mem_edge_sparse',
    path: 'members/mem_edge_sparse',
    data: {
      id: 'mem_edge_sparse',
      role: 'Member',
      joinedDate: '',
    },
  });
  // Edge case 4: valid base64 avatar + legacy PII key only (rules-compatible, whitelist-incompatible)
  memberDocs.push({
    id: 'mem_edge_whitelist_only',
    path: 'members/mem_edge_whitelist_only',
    data: {
      id: 'mem_edge_whitelist_only',
      name: 'Carol Synthetic',
      handle: '@carol_syn',
      role: 'Project Leader',
      tracks: ['AI & Embedded'],
      joinedDate: '2026-03-01',
      status: 'Probationary',
      avatarUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      university: 'Synthetic Univ',
    },
  });
  // Edge case 5: invalid status enum
  memberDocs.push({
    id: 'mem_edge_bad_status',
    path: 'members/mem_edge_bad_status',
    data: {
      id: 'mem_edge_bad_status',
      name: 'Dan Synthetic',
      handle: '@dan_syn',
      role: 'Member',
      tracks: ['Open Hack & Demo'],
      joinedDate: '2026-03-10',
      status: 'Archived',
    },
  });

  syntheticClient.seedCollection('members', memberDocs);

  // Seed 240 existing synthetic users + 550 synthetic notifications to verify > 500 pagination & batched user checks
  const userDocs: RawFirestoreDocument[] = [];
  for (let u = 1; u <= 240; u++) {
    const uid = `uid_secret_${u}`;
    userDocs.push({ id: uid, path: `users/${uid}`, data: { id: uid, status: 'active' } });
  }
  syntheticClient.seedCollection('users', userDocs);

  const notifDocs: RawFirestoreDocument[] = [];
  for (let n = 1; n <= 544; n++) {
    const id = `notif_syn_${String(n).padStart(4, '0')}`;
    const uid = `uid_secret_${((n - 1) % 240) + 1}`;
    notifDocs.push({
      id,
      path: `notifications/${id}`,
      data: {
        id,
        userId: uid,
        title: `Secret Meeting Title ${n}`,
        message: `Confidential Recipient Body ${n}`,
        type: 'meeting_reminder_30m',
        read: false,
        dismissed: false,
        createdAt: '2026-10-01T09:00:00Z',
      },
    });
  }
  // B1: missing id + historical fields + existing user
  notifDocs.push({
    id: 'notif_legacy_missing_id',
    path: 'notifications/notif_legacy_missing_id',
    data: {
      userId: 'uid_secret_1',
      title: 'Secret Meeting Title MissingId',
      message: 'Confidential Recipient Body MissingId',
      createdAt: '2025-11-01T10:00:00Z',
      legacySource: 'sheet_import',
      legacyBatch: 12,
    },
  });
  // B2: mismatched id + historical fields + existing user
  notifDocs.push({
    id: 'notif_legacy_mismatch_id',
    path: 'notifications/notif_legacy_mismatch_id',
    data: {
      id: 'legacy_old_id_99',
      userId: 'uid_secret_2',
      title: 'Secret Meeting Title Mismatch',
      message: 'Confidential Recipient Body Mismatch',
      createdAt: '2025-11-02T10:00:00Z',
      legacyFlag: true,
    },
  });
  // C1: orphaned missing userId
  notifDocs.push({
    id: 'notif_orphan_missing_user',
    path: 'notifications/notif_orphan_missing_user',
    data: {
      id: 'notif_orphan_missing_user',
      title: 'Secret Meeting Title Orphan1',
      message: 'Confidential Recipient Body Orphan1',
      createdAt: '2025-11-03T10:00:00Z',
    },
  });
  // C2: orphaned invalid userId format
  notifDocs.push({
    id: 'notif_orphan_invalid_user',
    path: 'notifications/notif_orphan_invalid_user',
    data: {
      id: 'notif_orphan_invalid_user',
      userId: 'bad/user$id',
      title: 'Secret Meeting Title Orphan2',
      message: 'Confidential Recipient Body Orphan2',
      createdAt: '2025-11-04T10:00:00Z',
    },
  });
  // C3: orphaned nonexistent userId
  notifDocs.push({
    id: 'notif_orphan_deleted_user',
    path: 'notifications/notif_orphan_deleted_user',
    data: {
      id: 'notif_orphan_deleted_user',
      userId: 'uid_deleted_999',
      title: 'Secret Meeting Title Orphan3',
      message: 'Confidential Recipient Body Orphan3',
      createdAt: '2025-11-05T10:00:00Z',
    },
  });
  // D1: other_incompatible (Timestamp createdAt + bad type, existing user)
  notifDocs.push({
    id: 'notif_other_bad_schema',
    path: 'notifications/notif_other_bad_schema',
    data: {
      id: 'notif_other_bad_schema',
      userId: 'uid_secret_3',
      title: 'Secret Meeting Title BadSchema',
      message: 'Confidential Recipient Body BadSchema',
      type: 'legacy_alert',
      createdAt: { __firestoreType: 'timestamp', value: '2025-11-06T10:00:00Z' },
    },
  });

  syntheticClient.seedCollection('notifications', notifDocs);

  let memberReport!: MemberAuditReport;
  let notificationReport!: NotificationAuditReport;
  let proposalReport!: CombinedRepairProposalReport;

  await test('Member audit handles > 500 paginated records and accurately categorizes missing, invalid, id-mismatch, and whitelist keys', async () => {
    memberReport = await runMemberAudit(syntheticClient, { pageSize: 250 });
    assert(memberReport.totalScanned === 650, `Expected 650 members, got ${memberReport.totalScanned}`);
    assert(memberReport.pagesRead === 3, `Expected 3 pages at pageSize 250, got ${memberReport.pagesRead}`);
    assert(memberReport.fullyCompatibleCount === 645, `Expected 645 fully compatible, got ${memberReport.fullyCompatibleCount}`);
    assert(memberReport.rulesCompatibleOnlyCount === 1, `Expected 1 rules-compatible-only, got ${memberReport.rulesCompatibleOnlyCount}`);
    assert(memberReport.incompatibleCount === 4, `Expected 4 incompatible, got ${memberReport.incompatibleCount}`);
    assert(memberReport.idMismatchCount === 1, `Expected 1 explicit inner id mismatch, got ${memberReport.idMismatchCount}`);
    assert(memberReport.whitelistIncompatibleCount === 2, `Expected 2 whitelist-incompatible, got ${memberReport.whitelistIncompatibleCount}`);
    assert(memberReport.missingFieldCounts.id === 1, 'Expected missing id count === 1');
    assert(memberReport.missingFieldCounts.joinedDate === 1, 'Expected missing joinedDate count === 1');
    assert(memberReport.invalidFieldCounts.role === 1, 'Expected invalid role count === 1');
    assert(memberReport.invalidFieldCounts.bio === 1, 'Expected invalid bio count === 1');
    assert(memberReport.invalidFieldCounts.portfolioUrl === 1, 'Expected invalid portfolioUrl count === 1');
  });

  await test('Notification audit handles > 500 records, uses chunked batched user existence checks, and classifies A/B/C/D accurately', async () => {
    notificationReport = await runNotificationAudit(syntheticClient, { pageSize: 200 });
    assert(notificationReport.totalScanned === 550, `Expected 550 notifications, got ${notificationReport.totalScanned}`);
    assert(notificationReport.pagesRead === 3, `Expected 3 pages at pageSize 200, got ${notificationReport.pagesRead}`);
    assert(
      syntheticClient.batchCheckCalls.length === 3,
      `Expected 3 batched user existence checks (241 IDs / 100), got ${syntheticClient.batchCheckCalls.length}`
    );
    assert(notificationReport.countsByClass.compatible === 544, 'Expected 544 Class A compatible');
    assert(notificationReport.countsByClass.id_repair_candidate === 2, 'Expected 2 Class B id_repair_candidate');
    assert(notificationReport.countsByClass.orphaned === 3, 'Expected 3 Class C orphaned');
    assert(notificationReport.countsByClass.other_incompatible === 1, 'Expected 1 Class D other_incompatible');
    assert(notificationReport.missingIdCount === 1, 'Expected missingIdCount === 1');
    assert(notificationReport.mismatchedIdCount === 1, 'Expected mismatchedIdCount === 1');
    assert(notificationReport.missingUserIdCount === 1, 'Expected missingUserIdCount === 1');
    assert(notificationReport.invalidUserIdCount === 1, 'Expected invalidUserIdCount === 1');
    assert(notificationReport.nonexistentTargetUserCount === 1, 'Expected nonexistentTargetUserCount === 1');
    assert(notificationReport.missingOrInvalidCreatedAtCount === 1, 'Expected missingOrInvalidCreatedAtCount === 1');
    assert(notificationReport.docsWithHistoricalExtraFieldsCount === 2, 'Expected 2 docs with historical extra fields');
  });

  await test('Dry-run repair proposal separates derivable vs human confirmation fields and enforces orphaned notification blocks', () => {
    proposalReport = buildCombinedRepairProposalReport(memberReport, notificationReport);
    assert(
      proposalReport.executionMode === 'DRY_RUN_PROPOSAL_ONLY_ZERO_WRITES',
      'Must mark executionMode strictly DRY_RUN_PROPOSAL_ONLY_ZERO_WRITES'
    );
    const missingMemberProposal = proposalReport.memberProposals.find((p) => p.docId === 'mem_edge_missing');
    assert(missingMemberProposal, 'Missing-field member must appear in proposals');
    assert(
      missingMemberProposal.derivableConfirmationsNeeded.some((r) => r.field === 'id'),
      'Missing id should be categorized cleanly as doc.id derivable'
    );
    assert(
      missingMemberProposal.humanConfirmationRequiredFields.some((r) => r.field === 'joinedDate'),
      'Missing joinedDate must require human confirmation / authoritative timestamp lookup'
    );
    assert(
      missingMemberProposal.extraKeysAction.some((k) => k.key === 'email' && k.destination === 'memberPrivate'),
      'Legacy email must route to memberPrivate'
    );
    assert(
      missingMemberProposal.extraKeysAction.some((k) => k.key === 'totalCheckIns' && k.destination === 'remove_from_public'),
      'Cached counter totalCheckIns must route to remove_from_public'
    );

    const mismatchedMemberProposal = proposalReport.memberProposals.find((p) => p.docId === 'mem_edge_malformed');
    assert(
      mismatchedMemberProposal &&
        mismatchedMemberProposal.humanConfirmationRequiredFields.some((r) => r.field === 'id'),
      'Non-missing id !== doc.id mismatch must require human confirmation instead of silent overwrite'
    );

    const repairableNotifs = proposalReport.notificationProposals.filter(
      (n) => n.action === 'propose_scoped_id_patch'
    );
    assert(repairableNotifs.length === 2, 'Only the 2 Class B notifications should propose scoped { id } patches');
    assert(
      repairableNotifs.every((n) => n.preservesHistoricalFields && n.proposedPatch?.id === n.docId),
      'Scoped notification patches must equal { id: docId } and preserve historical fields'
    );

    const orphanNotifs = proposalReport.notificationProposals.filter(
      (n) => n.classification === 'orphaned'
    );
    assert(
      orphanNotifs.length === 3 && orphanNotifs.every((n) => n.proposedPatch === null),
      'Orphaned notifications must NEVER propose an ID repair patch'
    );
  });

  await test('Anonymized reports contain ZERO member names, handles, PII, notification titles, messages, or userIds', () => {
    const serialized = JSON.stringify({ memberReport, notificationReport, proposalReport });
    const forbiddenLiterals = [
      'Alice Synthetic',
      'Bob Synthetic',
      '@alice_syn',
      '@bob_syn',
      'alice.syn@example.com',
      '010-9999-8888',
      '20269999',
      'Synthetic Univ',
      'Secret Meeting Title',
      'Confidential Recipient Body',
      'uid_secret_',
      'uid_deleted_999',
      'bad/user$id',
    ];
    for (const secret of forbiddenLiterals) {
      assert(!serialized.includes(secret), `Report leaked sensitive string "${secret}"`);
    }
  });

  await test('Static safety proof: audit utilities contain ZERO write/mutation APIs or HTTP write methods', () => {
    const auditFiles = [
      'scripts/audit/firestoreReadOnlyClient.ts',
      'scripts/audit/auditMembers.ts',
      'scripts/audit/auditNotifications.ts',
      'scripts/audit/generateRepairProposal.ts',
    ];
    const forbiddenPatterns = [
      /\bupdateDoc\b/,
      /\bsetDoc\b/,
      /\bdeleteDoc\b/,
      /\bwriteBatch\b/,
      /\.commit\s*\(/,
      /documents:commit/,
      /documents:write/,
      /method:\s*['"`](PATCH|DELETE|PUT)['"`]/i,
    ];
    for (const relPath of auditFiles) {
      const content = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
      for (const pattern of forbiddenPatterns) {
        assert(!pattern.test(content), `Forbidden write/mutation pattern ${pattern} found in ${relPath}`);
      }
    }
  });

  console.log(`\nALL ${passed} PRODUCTION AUDIT PREPARATION TESTS PASSED.`);
  return { memberReport, notificationReport, proposalReport };
}

runTests()
  .then(({ memberReport, notificationReport, proposalReport }) => {
    if (process.argv.includes('--print-example')) {
      console.log('\n--- EXAMPLE ANONYMIZED OUTPUT (SYNTHETIC DATA ONLY) ---');
      console.log(
        JSON.stringify(
          {
            memberAuditExcerpt: {
              ...memberReport,
              affectedRecords: memberReport.affectedRecords.slice(0, 2),
            },
            notificationAuditExcerpt: {
              ...notificationReport,
              affectedRecords: notificationReport.affectedRecords.slice(0, 3),
            },
            repairProposalExcerpt: {
              executionMode: proposalReport.executionMode,
              memberSummary: proposalReport.memberSummary,
              sampleMemberProposal: proposalReport.memberProposals[0],
              notificationSummary: proposalReport.notificationSummary,
              sampleNotificationProposals: proposalReport.notificationProposals.slice(0, 3),
            },
          },
          null,
          2
        )
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
