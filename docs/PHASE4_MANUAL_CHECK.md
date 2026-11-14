# Phase 4 Manual Verification Checklist & Architectural Decisions

## Architectural Decision: Session Capacity (`maxCapacity`) Enforcement

- **Decision**: Session `maxCapacity` is enforced as a **soft warning only** (non-blocking), **not** a hard rejection.
- **UI Behavior**:
  - When `maxCapacity > 0` (`undefined` or `0` = unlimited), `QRKioskView` and `SessionsView` display `checkedInCount / maxCapacity` and surface an amber capacity advisory once `checkedInCount >= maxCapacity` (in Roster) or `checkedInCount > maxCapacity` (on Kiosk).
  - Self check-in (`recordSelfCheckIn`) and admin door check-in (`recordAdminManualCheckIn`) **never block** a builder due to capacity.
- **Rationale**: Late or standing-room builders must never lose attendance credit because of an estimated room cap, and client-side queries cannot atomically enforce `checkIns` collection counts under `firestore.rules` without a centralized counter bottleneck.

---

## Manual End-to-End Verification Checklist (Pre-Deploy / Preview)

Run these checks manually in browser preview with two sessions (1 active member + 1 admin account) plus an incognito window:

### 1. Live Kiosk QR Projection & Token Rotation (`F2`, `F3`)
- [ ] Admin opens **QR Kiosk** on desktop/projector for a `scheduled` session within `openMinutesBefore` (default 15m before start).
- [ ] Confirm QR renders cleanly at both mobile (`320px`) and widescreen (`1440px`), displaying the rotating **8-char formatted backup code (`XXXX-XXXX`)** and **45-second countdown ring**.
- [ ] Watch Network/Firestore writes or UI countdown across 2 rotation cycles (45s + 45s): `sessionTokens/{sessionId}` writes `token`, distinct `prevToken`, and `rotatedAt: serverTimestamp()`.
- [ ] Confirm previous token remains accepted within the **30s grace window** immediately after rotation and rejected once expired.

### 2. Deep Link Check-In Flow (`?s=...&t=...`) (`F3`)
- [ ] Scan or copy the kiosk QR URL (`${origin}/?s=<sessionId>&t=<8-char-token>`).
- [ ] Paste into an **incognito / signed-out** mobile browser.
- [ ] Confirm query parameters (`?s=` and `?t=`) are **immediately stripped from the address bar** via `history.replaceState` before sign-in completes (`sessionStorage` preserves pending check-in).
- [ ] Sign in as an approved active member -> Scanner modal opens automatically and records self check-in (`method: 'camera_scan'`) using the captured token, then clears pending storage so page refresh does not re-trigger.

### 3. Member Self Check-In Modal (`F3`, `F5`, `F20 Finding H`)
- [ ] **Scheduled Session Inside Window**: Open Scanner on a session whose `status === 'scheduled'` and `checkInMode === 'auto'` inside `[startAt - openMinutesBefore, endAt + graceMinutesAfter]`. Confirm state evaluates to **Open** (not blocked by Finding H's old `status !== 'active'` bug).
- [ ] **Manual Backup Code Entry (`code_input`)**: Enter the kiosk's `XXXX-XXXX` backup code (with or without hyphen, lower or uppercase). Confirm check-in succeeds with `method: 'code_input'`.
- [ ] **Double-Tap / Idempotency**: Tap Submit twice rapidly on slow network. Confirm button stays disabled during flight and only **one** document exists at `checkIns/{sessionId}_{memberId}` (no duplicates, clear `"already checked in"` feedback).
- [ ] **Error States**:
  - Camera permission denied -> clear guidance + smooth fallback to `XXXX-XXXX` backup code tab.
  - Offline (`navigator.onLine === false`) -> explicit offline message without spinner hang.
  - Closed / Cancelled / Expired session -> distinct phase-specific message (`upcoming` shows opening time, `cancelled` / `closed` explains closure).

### 4. Admin Self Check-In vs. Door-Staff Manual Entry (`F4`, `F6`)
- [ ] **Admin Self Check-In**: Signed-in Admin scans QR / enters backup code in Scanner Modal. Verify `recordCheckInAtomic` does **not** pass `operatorUid` -> writes through `recordSelfCheckIn` (`method: 'camera_scan' | 'code_input'`, `authUid == adminUid`, rotating `token`).
- [ ] **Door-Staff Pass Scan**: Admin opens Scanner and scans a member's QR pass (`{"memberId":"mem_..."}`). Verify `method: 'manual_entry'` is dispatched cleanly to `recordAdminManualCheckIn` (`verifiedBy: adminUid`, `checkedInAt: serverTimestamp()`, audit log written).
- [ ] **Session Roster Manual Add / + Quick**: In **Sessions -> Roster Drawer**, click `Add` / `+ Quick`. Confirm double-tap lock disables the row button while submitting and writes `manual_entry` cleanly.

### 5. Complete / Close & Reopen Session (`F6`)
- [ ] Click **Complete / Close Check-In** from Roster or Kiosk. Confirm `completeSession` commits in **one atomic batch** (`status: 'completed'`, `checkInMode: 'closed'`, `closedAt`, `updatedAt`, plus `auditLogs` entry).
- [ ] Subsequent self check-in attempt on that session is rejected cleanly in UI and by `sessionOpen` rule.
- [ ] Click **Reopen Session** -> `reopenSession` commits atomic batch resetting `status: 'scheduled'` and `checkInMode: 'auto'` + audit log.

### 6. Role-Scoped Listeners (`F11`)
- [ ] Sign in as a **Pending / Declined** user -> inspect browser DevTools network/console: zero permission errors; `members`, `sessions`, `checkIns`, and `users` collection listeners are **not attached**.
- [ ] Sign in as an **Active Non-Admin Member** -> `subscribeToMemberCheckIns(memberId)` listens strictly to `where('memberId', '==', linkedMember.id)`; no `users` directory listener or reminder sweep triggered.
- [ ] Sign in as an **Admin** -> full operational listeners attach cleanly.

### 7. Zero Capacity & Soft Warning Edge Cases
- [ ] Create a session with `points: 0` and `maxCapacity: 0` -> confirm `points: 0` and `maxCapacity: 0` (displayed as `Unlimited`) persist cleanly without reverting to `10` or `25`.
- [ ] Create/edit a session with `maxCapacity: 2` and check in 3 builders -> confirm amber capacity notice appears without blocking the 3rd check-in.
