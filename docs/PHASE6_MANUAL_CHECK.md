# Phase 6 Real-Browser Manual Verification Checklist

Execute these checks in a real Chromium / Safari / Firefox browser before release.
Test widths: **320 px, 360 px, 390 px, 412 px, 768 px, 1024 px, 1280 px**.
Test roles: **Guest**, **Member** (approved & linked), and **Admin**.

---

## A. Viewport Matrix & Responsive Overflow (All Roles)

1. **320 px × 568 px (`guest`)**: Open login view, switch to Guest Public Hub (`Leaderboard`, `Meetings`, `Guild Guide`), confirm zero horizontal scrollbar (`document.documentElement.scrollWidth <= window.innerWidth`).
2. **320 px × 568 px (`member`)**: Sign in, navigate every member tab (`Home`, `Sessions`, `Leaderboard`, `Attendance`), open Mobile More drawer, confirm zero horizontal overflow and no clipped cards.
3. **320 px × 568 px (`admin`)**: Open `Sessions` (with roster modal), `Members` (with filter pills & CSV export modal), `Requests`, and `Kiosk`, confirming zero horizontal overflow.
4. **360 px × 800 px (`guest`, `member`, `admin`)**: Verify sticky mobile bottom bar & Island navigation do not overlap footer links or action buttons.
5. **390 px × 844 px (`guest`, `member`, `admin`)**: Verify QR scanner modal, digital builder pass modal, and podium cards render centered without clipping.
6. **412 px × 915 px (`guest`, `member`, `admin`)**: Verify Member Profile Modal and Notification Preferences checkboxes align cleanly.
7. **768 px × 1024 px (`guest`, `member`, `admin`)**: Verify tablet transition between mobile sheet chrome and desktop controls (`sm:` / `md:` breakpoints), zero overlapping badges.
8. **1024 px × 768 px (`guest`, `member`, `admin`)**: Verify floating top IslandNav (`lg:`), drawer toggle from logo button, and 2/3-column grid alignment.
9. **1280 px × 800 px (`guest`, `member`, `admin`)**: Verify desktop max-width container (`max-w-7xl`), charts (`ParticipationTrends`), and Kiosk dual-column layout.

---

## B. On-Screen Keyboard Open & 200% Zoom

10. **Mobile On-Screen Keyboard (`320 px` / `390 px`, `member`)**: Focus `QRScannerModal` manual backup token input and `ApplicationForm` fields with virtual keyboard open; confirm submit buttons remain scrollable into view and are not trapped under fixed bottom nav (`isModalOpen` hides IslandNav).
11. **Mobile On-Screen Keyboard (`360 px` / `412 px`, `admin`)**: Focus `NewSessionModal`, `AddMemberModal`, and `RecordDeleteModal` reason input with virtual keyboard open; confirm modals scroll cleanly with `max-h-[90dvh]`.
12. **200% Browser Zoom (`1280 px` desktop -> effective 640 px CSS viewport, `guest`, `member`, `admin`)**: Confirm no horizontal overflow, readable text wrapping on all buttons/badges, and functional navigation drawer/bottom bar without hidden actions.

---

## C. Dark & Light Theme, Contrast & Keyboard Accessibility

13. **Default Dark Theme Preservation (`guest`, `member`, `admin`)**: Clear `localStorage` (`localStorage.removeItem('dob_theme')`) and reload; verify app boots in dark theme (`data-theme="dark"`) with original dark colors preserved.
14. **Opt-In Light Theme Persistence (`member`, `admin`)**: Toggle theme button to Light (`data-theme="light"`), reload browser, confirm light theme persists via `dob_theme` in `localStorage` and all surfaces/text remain legible at WCAG AA contrast (`>= 4.5:1`).
15. **Keyboard Navigation & Focus Visible (`guest`, `member`, `admin`)**: Press `Tab` through `Skip to main content`, IslandNav links, theme toggle, drawer toggle, and icon buttons; confirm clear focus ring (`#b5ff00`) and `Escape` closes drawers/modals and restores focus to trigger.
16. **Touch Target Minimum (`320 px` – `412 px`)**: Inspect interactive buttons/links/dismiss (`✕`) buttons with DevTools element ruler; verify clickable area is at least `44 × 44 px` (`min-h-11` / `min-w-11`).

---

## D. Error Handling, 404 & Signed-Out Flows

17. **Invalid URL / Hash 404 (`guest`, `member`)**: Visit `/#/nonexistent-route` and `/unknown-path`; confirm `NotFoundView` renders cleanly with working "Return Home / Sign In" button.
18. **ErrorBoundary Recovery & Guarded Chunk Reload**: Simulate a failing lazy chunk import in DevTools Network (offline single chunk -> switch tab); verify one automatic guarded reload (`sessionStorage.getItem('dob_chunk_reload_attempted') === '1'`). Simulate repeated runtime crash; verify fallback screen displays with "Return to Home" & "Reload App" and no PII/UIDs/tokens in console.
19. **Signed-Out Action Routing (`guest`)**: Click "Sign In to Join" / "Sign In with Google" from Guest Hub; confirm smooth transition into Google Sign-In flow without broken states.
