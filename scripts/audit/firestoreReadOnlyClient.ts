import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export const EXPECTED_PROJECT_ID = 'operating-display-798sv' as const;
export const EXPECTED_DATABASE_ID = 'ai-studio-denofbuildersatt-42d7846f-ad64-451a-ad75-5301b71e1953' as const;
export const DEFAULT_PAGE_SIZE = 300;
export const BATCH_GET_MAX_DOCS = 100;

export interface AuditTargetConfig {
  projectId: string;
  databaseId: string;
}

export interface RawFirestoreDocument {
  id: string;
  path: string;
  data: Record<string, unknown>;
}

export interface PaginatedQueryPage {
  documents: RawFirestoreDocument[];
  nextPageToken?: string;
}

export interface ReadOnlyFirestoreClient {
  readonly target: AuditTargetConfig;
  verifyTargetDatabase(): Promise<{ resourceName: string; type?: string; locationId?: string }>;
  listCollectionPage(
    collectionName: string,
    pageSize: number,
    pageToken?: string
  ): Promise<PaginatedQueryPage>;
  batchCheckDocumentsExist(
    collectionName: string,
    documentIds: string[]
  ): Promise<Map<string, boolean>>;
}

export class TargetVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetVerificationError';
  }
}

export class ReadOnlyAuditAccessError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'ReadOnlyAuditAccessError';
    this.statusCode = statusCode;
  }
}

/**
 * Strips any potential bearer tokens or query secrets from error strings before logging.
 */
export function redactSensitiveErrorText(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input ?? 'Unknown error');
  return raw
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/ya29\.[A-Za-z0-9\-_]+/g, '[REDACTED_TOKEN]')
    .replace(/1\/\/[A-Za-z0-9\-_]+/g, '[REDACTED_REFRESH_TOKEN]')
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]');
}

/**
 * Verifies that the target project and named Firestore database strictly match
 * DOB-Hub production invariants. Refuses `(default)` or substituted targets.
 */
export function assertValidTargetConfig(
  candidate: Partial<AuditTargetConfig>,
  appletConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json')
): AuditTargetConfig {
  const projectId = String(candidate.projectId ?? '').trim();
  const databaseId = String(candidate.databaseId ?? '').trim();

  if (!projectId) {
    throw new TargetVerificationError('Target verification failed: projectId is empty.');
  }
  if (!databaseId || databaseId === '(default)' || databaseId === 'default') {
    throw new TargetVerificationError(
      `Target verification failed: refusing default/empty Firestore database "${databaseId || '<empty>'}". Must target "${EXPECTED_DATABASE_ID}".`
    );
  }
  if (projectId !== EXPECTED_PROJECT_ID) {
    throw new TargetVerificationError(
      `Target verification failed: expected projectId "${EXPECTED_PROJECT_ID}" but got "${projectId}". Refusing silent project substitution.`
    );
  }
  if (databaseId !== EXPECTED_DATABASE_ID) {
    throw new TargetVerificationError(
      `Target verification failed: expected databaseId "${EXPECTED_DATABASE_ID}" but got "${databaseId}".`
    );
  }

  if (fs.existsSync(appletConfigPath)) {
    const raw = fs.readFileSync(appletConfigPath, 'utf8');
    const parsed = JSON.parse(raw) as { projectId?: string; firestoreDatabaseId?: string };
    if (parsed.projectId && parsed.projectId !== projectId) {
      throw new TargetVerificationError(
        `Target verification failed: firebase-applet-config.json projectId "${parsed.projectId}" does not match "${projectId}".`
      );
    }
    if (parsed.firestoreDatabaseId && parsed.firestoreDatabaseId !== databaseId) {
      throw new TargetVerificationError(
        `Target verification failed: firebase-applet-config.json firestoreDatabaseId "${parsed.firestoreDatabaseId}" does not match "${databaseId}".`
      );
    }
  }

  return { projectId, databaseId };
}

export function resolveTargetConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  appletConfigPath?: string
): AuditTargetConfig {
  const projectId = env.DOB_AUDIT_PROJECT_ID || EXPECTED_PROJECT_ID;
  const databaseId = env.DOB_AUDIT_DATABASE_ID || EXPECTED_DATABASE_ID;
  return assertValidTargetConfig({ projectId, databaseId }, appletConfigPath);
}

/**
 * Decodes a single Firestore REST v1 Value object into plain JS types.
 * Uses a safe tag object `{ __firestoreType: 'timestamp', iso: ... }` for Timestamps so
 * audit validators can distinguish Timestamps from ISO strings cleanly.
 */
export function decodeFirestoreValue(val: Record<string, unknown> | undefined): unknown {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('integerValue' in val) {
    const n = Number(val.integerValue);
    return Number.isSafeInteger(n) ? n : String(val.integerValue);
  }
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) {
    return {
      __firestoreType: 'timestamp',
      value: String(val.timestampValue),
    };
  }
  if ('referenceValue' in val) return String(val.referenceValue);
  if ('bytesValue' in val) return `[bytes:${String(val.bytesValue).length}]`;
  if ('geoPointValue' in val) return val.geoPointValue;
  if ('arrayValue' in val) {
    const arr = val.arrayValue as { values?: Record<string, unknown>[] } | undefined;
    const values = Array.isArray(arr?.values) ? arr.values : [];
    return values.map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const mapObj = val.mapValue as { fields?: Record<string, Record<string, unknown>> } | undefined;
    return decodeFirestoreFields(mapObj?.fields ?? {});
  }
  return undefined;
}

export function decodeFirestoreFields(
  fields: Record<string, Record<string, unknown>> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [key, value] of Object.entries(fields)) {
    out[key] = decodeFirestoreValue(value);
  }
  return out;
}

interface AuthorizedUserAdcFile {
  type?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
}

async function resolveAccessTokenFromAdc(env: Record<string, string | undefined> = process.env): Promise<string> {
  const directToken = env.FIRESTORE_ACCESS_TOKEN?.trim();
  if (directToken) {
    return directToken;
  }

  const candidatePaths = [
    env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'),
  ].filter((p): p is string => Boolean(p && p.trim().length > 0));

  for (const adcPath of candidatePaths) {
    if (!fs.existsSync(adcPath)) continue;
    const parsed = JSON.parse(fs.readFileSync(adcPath, 'utf8')) as AuthorizedUserAdcFile;
    if (parsed.type === 'service_account') {
      throw new TargetVerificationError(
        'Refusing raw service account key file in this workflow. Use Application Default Credentials (`gcloud auth application-default login`) for an authorized user.'
      );
    }
    if (parsed.type === 'authorized_user' && parsed.client_id && parsed.client_secret && parsed.refresh_token) {
      const body = new URLSearchParams({
        client_id: parsed.client_id,
        client_secret: parsed.client_secret,
        refresh_token: parsed.refresh_token,
        grant_type: 'refresh_token',
      });
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!resp.ok) {
        throw new ReadOnlyAuditAccessError(
          `ADC token refresh failed with HTTP ${resp.status}. Re-run \`gcloud auth application-default login\`.`,
          resp.status
        );
      }
      const tokenPayload = (await resp.json()) as { access_token?: string };
      if (!tokenPayload.access_token) {
        throw new ReadOnlyAuditAccessError('ADC token refresh returned no access_token.');
      }
      return tokenPayload.access_token;
    }
  }

  try {
    const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (token) {
      return token;
    }
  } catch (err) {
    throw new ReadOnlyAuditAccessError(
      `No Application Default Credentials available (${redactSensitiveErrorText(err)}). Run \`gcloud auth application-default login\` locally first.`
    );
  }

  throw new ReadOnlyAuditAccessError('Unable to obtain a temporary ADC access token.');
}

/**
 * Strictly read-only Firestore REST v1 client.
 * Only executes HTTP GET (`databases.get`, `documents.list`) and HTTP POST `:batchGet`.
 * Contains zero write/patch/commit/delete methods.
 */
export class RestReadOnlyFirestoreClient implements ReadOnlyFirestoreClient {
  public readonly target: AuditTargetConfig;
  private accessTokenPromise: Promise<string>;

  constructor(target: AuditTargetConfig, accessTokenOverride?: string) {
    this.target = assertValidTargetConfig(target);
    this.accessTokenPromise = accessTokenOverride
      ? Promise.resolve(accessTokenOverride)
      : resolveAccessTokenFromAdc();
  }

  private get databaseResourcePrefix(): string {
    return `projects/${this.target.projectId}/databases/${this.target.databaseId}`;
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const token = await this.accessTokenPromise;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      const errText = redactSensitiveErrorText(await response.text().catch(() => ''));
      if (response.status === 401 || response.status === 403) {
        throw new ReadOnlyAuditAccessError(
          `Firestore read access denied (HTTP ${response.status}) on ${this.databaseResourcePrefix}: ${errText}`,
          response.status
        );
      }
      if (response.status === 404) {
        throw new ReadOnlyAuditAccessError(
          `Firestore target resource not found (HTTP 404) on ${this.databaseResourcePrefix}: ${errText}`,
          404
        );
      }
      throw new ReadOnlyAuditAccessError(
        `Firestore read error (HTTP ${response.status}): ${errText}`,
        response.status
      );
    }
    return (await response.json()) as T;
  }

  public async verifyTargetDatabase(): Promise<{
    resourceName: string;
    type?: string;
    locationId?: string;
  }> {
    const url = `https://firestore.googleapis.com/v1/${this.databaseResourcePrefix}`;
    const meta = await this.requestJson<{
      name?: string;
      type?: string;
      locationId?: string;
    }>(url, { method: 'GET' });

    const expectedSuffix = `/projects/${this.target.projectId}/databases/${this.target.databaseId}`;
    const actualName = String(meta.name || '');
    if (!actualName.endsWith(expectedSuffix) && actualName !== this.databaseResourcePrefix) {
      throw new TargetVerificationError(
        `Remote database metadata mismatch: expected suffix "${expectedSuffix}", got "${actualName}".`
      );
    }

    return {
      resourceName: actualName || this.databaseResourcePrefix,
      type: meta.type,
      locationId: meta.locationId,
    };
  }

  public async listCollectionPage(
    collectionName: string,
    pageSize: number = DEFAULT_PAGE_SIZE,
    pageToken?: string
  ): Promise<PaginatedQueryPage> {
    const safePageSize = Math.max(1, Math.min(pageSize, 500));
    const params = new URLSearchParams({
      pageSize: String(safePageSize),
      orderBy: '__name__',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const url = `https://firestore.googleapis.com/v1/${this.databaseResourcePrefix}/documents/${encodeURIComponent(
      collectionName
    )}?${params.toString()}`;

    const payload = await this.requestJson<{
      documents?: Array<{
        name: string;
        fields?: Record<string, Record<string, unknown>>;
      }>;
      nextPageToken?: string;
    }>(url, { method: 'GET' });

    const documents: RawFirestoreDocument[] = (payload.documents || []).map((docObj) => {
      const segments = docObj.name.split('/');
      const docId = segments[segments.length - 1] || '';
      return {
        id: docId,
        path: `${collectionName}/${docId}`,
        data: decodeFirestoreFields(docObj.fields),
      };
    });

    return {
      documents,
      nextPageToken: payload.nextPageToken,
    };
  }

  public async batchCheckDocumentsExist(
    collectionName: string,
    documentIds: string[]
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const uniqueIds = Array.from(new Set(documentIds.filter((id) => id.length > 0)));
    for (const id of uniqueIds) {
      results.set(id, false);
    }
    if (uniqueIds.length === 0) return results;

    for (let i = 0; i < uniqueIds.length; i += BATCH_GET_MAX_DOCS) {
      const chunk = uniqueIds.slice(i, i + BATCH_GET_MAX_DOCS);
      const resourceNames = chunk.map(
        (id) => `${this.databaseResourcePrefix}/documents/${collectionName}/${id}`
      );
      const url = `https://firestore.googleapis.com/v1/${this.databaseResourcePrefix}/documents:batchGet`;
      const responseItems = await this.requestJson<
        Array<{
          found?: { name: string };
          missing?: string;
        }>
      >(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: resourceNames,
          mask: { fieldPaths: ['id'] },
        }),
      });

      for (const item of responseItems) {
        if (item.found?.name) {
          const id = item.found.name.split('/').pop() || '';
          if (id) results.set(id, true);
        } else if (item.missing) {
          const id = item.missing.split('/').pop() || '';
          if (id && !results.has(id)) results.set(id, false);
        }
      }
    }

    return results;
  }
}

/**
 * Iterates through an entire collection using paginated document-ID reads.
 * Guards against cyclic `nextPageToken` responses.
 */
export async function readAllPaginated(
  client: ReadOnlyFirestoreClient,
  collectionName: string,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<{ documents: RawFirestoreDocument[]; pagesRead: number }> {
  const allDocs: RawFirestoreDocument[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;
  let pagesRead = 0;

  while (true) {
    const page = await client.listCollectionPage(collectionName, pageSize, nextToken);
    pagesRead += 1;
    allDocs.push(...page.documents);

    if (!page.nextPageToken) {
      break;
    }
    if (seenTokens.has(page.nextPageToken)) {
      throw new ReadOnlyAuditAccessError(
        `Pagination safety abort: repeated nextPageToken detected while scanning "${collectionName}".`
      );
    }
    seenTokens.add(page.nextPageToken);
    nextToken = page.nextPageToken;
  }

  return { documents: allDocs, pagesRead };
}
