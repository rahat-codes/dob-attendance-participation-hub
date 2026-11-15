# DOB-Hub Cost & Quota Notes

This note models Firestore read/write consumption for `publicLeaderboard` recomputes against the **Firebase Spark (Free Tier)** daily quota:
- **Free Daily Reads**: `50,000 reads / day`
- **Free Daily Writes**: `20,000 writes / day`
- **Free Daily Deletes**: `20,000 deletes / day`

---

## 1. Per-Recompute Read / Write Math

Every leaderboard recompute commits a diffed `publicLeaderboard` batch (`<= 400` ops/batch) plus `1` audit log write (`auditLogs/{logId}`):

- **Full Collection Backfill (`backfillPublicLeaderboard` — manual admin Sync button, or bounded fallback below threshold)**:
  `Estimated Reads = members + sessions + checkIns + publicLeaderboard`
  - Reads all `members`, `sessions`, and `checkIns` collections plus existing `publicLeaderboard` doc IDs.
- **In-Memory Full-History Recompute (`recomputeAndSaveLeaderboard` — after admin clicks *Load all history*)**:
  `Estimated Reads = publicLeaderboard` (reads only existing `publicLeaderboard` docs; `members`, `sessions`, and `checkIns` are already in browser memory).
- **Writes**: `<= eligibleMembers + optedOutOrInactiveRemovals + 1 auditLog`.

Assuming a typical guild snapshot of `~100` active members (`100` `publicLeaderboard` docs) and `~40` sessions:

| Dataset Scale (`checkIns`) | Mode | Reads / Single Run | Writes / Single Run | Open-Tab Auto Recompute | Manual Sync Only (10h active workshop) | % of 50k Free Read Quota / Day |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **100 check-ins** | `backfill_full` | `100 + 40 + 100 + 100 = 340` reads | `~101` writes | Enabled (`<= 6/hr`) -> max `2,040` reads/hr | ~3–5 manual syncs = `1,020–1,700` reads | Auto max 10h: **40.8%** / Manual: **3.4%** |
| **100 check-ins** | `in_memory` | `100` reads | `~101` writes | Enabled (`<= 6/hr`) -> max `600` reads/hr | `300–500` reads | Auto max 10h: **12.0%** / Manual: **1.0%** |
| **500 check-ins** | `backfill_full` | `100 + 40 + 500 + 100 = 740` reads | `~101` writes | Enabled (`<= 6/hr`) -> max `4,440` reads/hr | ~3–5 manual syncs = `2,220–3,700` reads | Auto max 10h: **88.8%** / Manual: **7.4%** |
| **500 check-ins** | `in_memory` | `100` reads | `~101` writes | Enabled (`<= 6/hr`) -> max `600` reads/hr | `300–500` reads | Auto max 10h: **12.0%** / Manual: **1.0%** |
| **3,000 check-ins** | `backfill_full` | `100 + 40 + 3,000 + 100 = 3,240` reads | `~101` writes | **DISABLED (`checkIns > 1,500`)** -> `0` auto reads | 1 manual Sync = `3,240` reads (15 runs max/day before 50k) | Auto: **0%** / 1 manual Sync: **6.5%** |
| **3,000 check-ins** | `in_memory` | `100` reads | `~101` writes | **DISABLED (`checkIns > 1,500`)** -> `0` auto reads | Manual Sync always reads full collections cleanly | Auto: **0%** |

---

## 2. Client Guardrails Preventing Runaway Quota Drain

Five stacked gates prevent redundant open-tab Firestore reads/writes (`src/utils/stats.ts` & `src/App.tsx`):

1. **Hard Volume Cutoff (`MAX_AUTO_RECOMPUTE_CHECKINS = 1500`)**: Once `checkIns.length > 1500`, `shouldTriggerDebouncedRecompute` always returns `false`. Automatic open-tab recomputes stop completely and **only the manual Sync button** (`PublicLeaderboardView` -> `backfillPublicLeaderboard`) runs on explicit admin click + confirmation.
2. **Data-Change Fingerprint (`computeLeaderboardDataSignature`)**: Below 1,500 check-ins, open-tab recompute skips unless at least one check-in, session, or member status/opt-out/profile field changed since initial settle or the last completed recompute.
3. **5-Minute Debounce (`AUTO_RECOMPUTE_DEBOUNCE_MS = 300,000`)**: Batches rapid check-in bursts during a meeting into 1 trailing recompute.
4. **Hourly Cap (`MAX_AUTO_RECOMPUTES_PER_HOUR = 6`)**: Hard cap of **6 automatic open-tab recomputes per hour** per admin session using `pruneHourlyTimestamps`.
5. **Visible-Tab & First-Run Confirmation Gate**: Paused when `document.visibilityState === 'hidden'`, and first-run backfill requires explicit admin confirmation.

---

## 3. Scaling Above 3,000 Check-Ins (`SERVER_AGGREGATION_THRESHOLD_DOCS`)

- At **3,000 check-ins**, `backfillPublicLeaderboard` reads `~3,240` documents per manual click (`16` manual backfills in a single day would exceed 50,000 reads).
- **Trigger Point**: Even with auto-recompute disabled above `1,500` check-ins, once `checkIns` approaches `3,000` documents, migrate aggregation to an incremental **Cloud Function (`onDocumentWritten` on `checkIns/{id}`)** on Blaze to maintain per-member counters in `O(1)` reads.
