# DOB-Hub Phase 2B — Super Admin Production Audit & Verification Runbook

This runbook governs the **strictly read-only** pre-deployment verification workflow for DOB-Hub Phase 1.

> **Target Invariants (Hard-Pinned in Audit Scripts)**
> - **Firebase Project ID**: `operating-display-798sv`
> - **Firestore Database ID**: `ai-studio-denofbuildersatt-42d7846f-ad64-451a-ad75-5301b71e1953`
> - **Staged Rules File**: `staging/firestore.rules.phase1` (`sha256: 7cd695c9a15dcf0a157c777fdbcbd349cda392d82d79f60a210b700f79e1938e`)
> - **Production Rules File**: `firestore.rules` (do NOT modify or deploy during audit)

---

## 1. Prerequisites & Required Least-Privilege IAM Permissions

### Software
- Node.js `>= 22.18.0` (verified in `package.json`)
- Dependencies already installed (`npm ci` — zero additional packages required)
- Google Cloud CLI (`gcloud`) locally authenticated as the authorized Super Admin / Cloud operator

### IAM Roles (Read-Only for Phase 2B Audit)
Do **not** use Owner/Editor roles for routine read-only audits when narrow roles suffice:
- **Firestore Data & Database Metadata Inspection**:
  - `roles/datastore.viewer` (grants `datastore.databases.get`, `datastore.entities.get`, `datastore.entities.list` on `ai-studio-denofbuildersatt-42d7846f-ad64-451a-ad75-5301b71e1953`)
- **Firebase Auth Domain Inspection (Console / CLI)**:
  - `roles/firebaseauth.viewer`
- **GCP API Key & Service Usage Inspection (Console)**:
  - `roles/serviceusage.serviceUsageViewer`
  - `roles/serviceusage.apiKeysViewer` (or Cloud Console **APIs & Services → Credentials** viewer)
- **Later, Only When Authorized for Native Backup Export**:
  - `roles/datastore.importExportAdmin` + GCS bucket `roles/storage.objectCreator` on the backup bucket only

---

## 2. Task 1 — Temporary Local ADC Authentication & Target Guard

Never embed service account JSON keys in the repository, never pass raw credentials in logs, and never use `(default)`:

```bash
# 1. Authenticate locally using ephemeral Application Default Credentials
gcloud auth application-default login

# 2. Verify active GCP project matches operating-display-798sv
gcloud config set project operating-display-798sv
gcloud config get-value project

# 3. Verify Firebase CLI targets the same project (optional check)
firebase use operating-display-798sv

# 4. Run unit tests FIRST using synthetic fixtures (proves read-only scripts & abort guards)
npx tsx tests/production-audit.test.ts
```

Before reading any collection, the scripts automatically verify:
1. `DOB_AUDIT_PROJECT_ID` (default `operating-display-798sv`) strictly matches `firebase-applet-config.json` and `operating-display-798sv`.
2. `DOB_AUDIT_DATABASE_ID` (default `ai-studio-denofbuildersatt-42d7846f-ad64-451a-ad75-5301b71e1953`) is non-empty, non-`(default)`, and matches `firebase-applet-config.json`.
3. `GET https://firestore.googleapis.com/v1/projects/operating-display-798sv/databases/ai-studio-denofbuildersatt-42d7846f-ad64-451a-ad75-5301b71e1953` succeeds and returns matching resource metadata. Any mismatch aborts immediately with exit code `1`.

---

## 3. Running Read-Only Audits & Repair Proposal Generation (Authorized Operator Only)

All outputs contain **only aggregate counts, field names, and anonymized document IDs** (no member names, emails, phones, student IDs, handles, notification titles, notification messages, or access tokens).

```bash
# Step A: Run anonymized Members audit (paginated over > 500 docs via HTTP GET)
npx tsx scripts/audit/auditMembers.ts --out /tmp/dob-members-audit.json

# Step B: Run anonymized Notifications audit (paginated + batched users/:batchGet)
npx tsx scripts/audit/auditNotifications.ts --out /tmp/dob-notifications-audit.json

# Step C: Generate strictly dry-run Repair Proposal from the two anonymized reports
npx tsx scripts/audit/generateRepairProposal.ts \
  --members-report /tmp/dob-members-audit.json \
  --notifications-report /tmp/dob-notifications-audit.json \
  --out /tmp/dob-repair-proposal.json

# Step D (Optional cleanup after reviewing reports)
rm -f /tmp/dob-members-audit.json /tmp/dob-notifications-audit.json /tmp/dob-repair-proposal.json
```

If preferred without local ADC file discovery, supply a short-lived token cleanly in subshell env (never echo or save to disk):
```bash
FIRESTORE_ACCESS_TOKEN="$(gcloud auth application-default print-access-token)" \
  npx tsx scripts/audit/auditMembers.ts --out /tmp/dob-members-audit.json
```

---

## 4. Task 5 — Backup Verification Preparation Checklist

Do **not** mark the backup gate `PASS` until every item below has recorded timestamped proof:

1. **Application-Level JSON Backup**:
   - Sign in as `rahatmdmahadihasan@gmail.com` → **Admin → Database Operations & Integrity → Full Backup (With PII)** (`exportFullBackupJSON({ includePII: true })`).
   - Confirm `_metadata[0].includesPII === true`, verify non-zero collection counts match production, compute SHA-256 checksum, and store in encrypted offline storage.
2. **Native Managed Firestore Export**:
   - Verify private GCS destination bucket (`gs://<BACKUP_BUCKET>`) exists with Uniform Bucket-Level Access and retention policy.
   - Verify export targets `--database='ai-studio-denofbuildersatt-42d7846f-ad64-451a-ad75-5301b71e1953'` and `--project=operating-display-798sv` (`gcloud firestore exports`).
3. **GCS Archive Accessibility & Operation Completion**:
   - Confirm export long-running operation shows `done: true` and `SUCCEEDED` (`gcloud firestore operations describe <OP_NAME>`).
   - Confirm `.overall_export_metadata` and namespace files exist in `gs://<BACKUP_BUCKET>/<export-prefix>/`.
4. **Export Metadata & Document Counts**:
   - Compare exported entity counts (excluding ephemeral `sessionTokens`) against the audit `totalScanned` counts (`members`, `notifications`, `users`, `sessions`, `checkIns`).
5. **Database Scope**:
   - Explicitly confirm export was captured from `ai-studio-denofbuildersatt-42d7846f-ad64-451a-ad75-5301b71e1953`, **not** `(default)`.
6. **Recovery Procedure & Isolated Restore Rehearsal**:
   - Verify Point-in-Time Recovery (PITR) status in **Firebase Console → Firestore → Backups**.
   - Rehearse `gcloud firestore import` from a sanitized/staging export in an isolated staging project (`dob-hub-staging`, never prod!) and confirm rules rollback readiness via `firestore.rules.prev` and Console Rules Version History.

---

## 5. Task 6 — Firebase Auth & Google Cloud API Key Verification Checklist

### Firebase Authentication (`operating-display-798sv`)
1. Open **Firebase Console → Project `operating-display-798sv` → Authentication → Settings → Authorized domains**.
2. Confirm **`dob-hub.vercel.app`** and **`operating-display-798sv.firebaseapp.com`** are present.
3. Review every remaining domain (`localhost`, `*.run.app`, staging hosts): remove unauthorized or retired origins.
4. Open **Authentication → Sign-in method → Google**: confirm enabled and confirm its Web SDK OAuth Client ID aligns with `oAuthClientId` in `firebase-applet-config.json`.

### Google Cloud Browser API Key (`operating-display-798sv`)
1. Open **Google Cloud Console → APIs & Services → Credentials → Browser key** (matching `apiKey` in `firebase-applet-config.json`; never paste key into tickets/reports).
2. **Application Restrictions (HTTP Referrers)**:
   - Confirm **Websites** restriction is enabled (never `None` or `*`).
   - Confirm exact origins: `https://dob-hub.vercel.app/*` and `https://operating-display-798sv.firebaseapp.com/*`.
3. **API Restrictions**:
   - Codebase `/src/` imports only `firebase/app`, `firebase/auth`, and `firebase/firestore` (`identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `firestore.googleapis.com`).
   - **Mandatory Pre-Restriction Traffic Check**: Inspect **GCP Console → APIs & Services → Enabled APIs & Services** (traffic by credential) and live Chrome DevTools Network requests (`googleapis.com`) during Google Sign-In + QR Check-In to confirm whether `firebaseinstallations.googleapis.com` or `recaptchaenterprise.googleapis.com` (referenced by `recaptchaSiteKey` in `firebase-applet-config.json`) are actively called before finalizing the restricted API allowlist.
   - Remove unused APIs (Cloud SQL, Maps, Storage, Admin, Generative Language, etc.).
