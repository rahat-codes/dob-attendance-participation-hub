# DOB-Hub Leaderboard Recompute Cost & Quota Notes

This note models Firestore read/write consumption for `publicLeaderboard` recomputes against the **Firebase Spark (Free Tier)** daily quota:
- **Free Daily Reads**: `50,000 reads / day`
- **Free Daily Writes**: `20,000 writes / day`
- **Free Daily Deletes**: `20,000 deletes / day`

---

## 1. Per-Recompute Read / Write Math

Every leaderboard recompute commits a diffed `publicLeaderboard` batch (`<= 400` ops/batch) plus `1` audit log write (`auditLogs/{logId}`):

- **Full Collection Backfill (`backfillPublicLeaderboard` — default when admin listeners are bounded)**:
  `Estimated Reads = members + sessions + checkIns + publicLeaderboard`
  - Reads all `members`, `sessions`, and `checkIns` collections plus existing `publicLeaderboard` doc IDs.
- **In-Memory Full-History Recompute (`recomputeAndSaveLeaderboard` — after admin clicks *Load all history*)**:
  `Estimated Reads = publicLeaderboard` (reads only existing `publicLeaderboard` docs; `members`, `sessions`, and `checkIns` are already in browser memory).
- **Writes**: `<= eligibleMembers + optedOutOrInactiveRemovals + 1 auditLog`.

Assuming a typical guild snapshot of `~100` active members (`100` `publicLeaderboard` docs) and `~40` sessions:

| Dataset Scale (`checkIns`) | Mode | Reads / Single Run | Writes / Single Run | 6 Runs / Hr (1 hr active) | 10 Hrs Open Tab (`60` max runs/day at 6/hr cap) | % of 50k Free Read Quota / 10h |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **100 check-ins** | `backfill_full` | `100 + 40 + 100 + 100 = 340` reads | `~101` writes | `2,040` reads | `20,400` reads | **40.8%** |
| **100 check-ins** | `in_memory` | `100` reads | `~101` writes | `600` reads | `6,000` reads | **12.0%** |
| **500 check-ins** | `backfill_full` | `100 + 40 + 500 + 100 = 740` reads | `~101` writes | `4,440` reads | `44,400` reads | **88.8%** |
| **500 check-ins** | `in_memory` | `100` reads | `~101` writes | `600` reads | `6,000` reads | **12.0%** |
| **3,000 check-ins** | `backfill_full` | `100 + 40 + 3,000 + 100 = 3,240` reads | `~101` writes | `19,440` reads | **194,400 reads (EXCEEDS 50k after ~15 runs)** | **388.8% (Exceeds Spark)** |
| **3,000 check-ins** | `in_memory` | `100` reads | `~101` writes | `600` reads | `6,000` reads | **12.0%** |

---

## 2. Client Guardrails Preventing Runaway Quota Drain

Without client guards, an open admin tab or rapid check-in burst during a workshop would repeatedly re-scan full collections. Four stacked gates prevent redundant runs:

1. **Data-Change Fingerprint (`computeLeaderboardDataSignature`)**: Open-tab recompute skips unless at least one check-in, session, or member status/opt-out/profile field actually changed since the last settled snapshot or last completed recompute. Idle open tabs trigger **0** recompute reads/writes.
2. **5-Minute Debounce (`AUTO_RECOMPUTE_DEBOUNCE_MS = 300,000`)**: Batches rapid workshop check-in bursts (e.g., 50 members scanning within 3 minutes) into **1** trailing recompute instead of 50.
3. **Hourly Cap (`MAX_AUTO_RECOMPUTES_PER_HOUR = 6`)**: Hard cap of **6 automatic open-tab recomputes per hour per admin session** using a rolling 60-minute timestamp window (`pruneHourlyTimestamps`). Even on an active 2-hour workshop, automatic runs stay `<= 12`.
4. **Visible-Tab & Confirmation Gate**: Paused when the admin tab is hidden (`document.visibilityState === 'hidden'`), and first-run backfill requires explicit admin confirmation instead of running silently on load.

---

## 3. Scaling Above 3,000 Check-Ins (`SERVER_AGGREGATION_THRESHOLD_DOCS`)

- At **3,000+ check-ins**, `16` full-collection `backfillPublicLeaderboard` calls in a single day exhaust the **50,000 free reads/day** budget (`16 × 3,240 = 51,840`), before even counting normal app listeners or CSV exports.
- **Trigger Point**: Once `checkIns` approaches `2,000–3,000` documents (or >1 admin keeps full-day monitoring tabs open concurrently), upgrade to Blaze / move aggregation to an incremental **Cloud Function (`onDocumentWritten` on `checkIns/{id}`)** maintaining per-member counters in `O(1)` reads instead of client full-collection sweeps.
