# DOB-Hub Content Security Policy (CSP) Notes

## Policy Mode: Report-Only Until Reports Are Reviewed

`server.ts` intentionally emits `Content-Security-Policy-Report-Only` (never enforcing `Content-Security-Policy`) with `report-uri /api/csp-report`.

- **Why Report-Only right now**: Google OAuth popups/redirects, Identity Toolkit iframes, and dynamic Vite chunks can vary across browser extensions and webviews. Enforcing CSP before reviewing real browser violation logs could lock users out of sign-in.
- **Promotion Gate**: Keep `Content-Security-Policy-Report-Only` active in both staging and initial production until:
  1. Staging interactive checks (`docs/PHASE4_MANUAL_CHECK.md` and `docs/PHASE6_MANUAL_CHECK.md`) pass across Chrome, Safari, and Firefox with zero blocked `http_request` / `csp_report` errors.
  2. Production `csp_report` JSON logs collected via `POST /api/csp-report` are reviewed over a representative sign-in + kiosk + dashboard cycle and confirmed free of false positives.

---

## Google Sign-In & Firebase Domains to Verify Before Enforcing

Every sign-in flow (Google popup sign-in, `signInWithRedirect` fallback, silent token refresh, and Firestore WebChannel/streaming) must be tested in a real browser against these allowlisted origins before switching `Content-Security-Policy-Report-Only` to `Content-Security-Policy`:

| Directive | Allowlisted Origin / Source | Purpose in DOB-Hub |
| :--- | :--- | :--- |
| `script-src` | `'self'`, `'unsafe-inline'`, `https://apis.google.com` | Vite bundles + inline theme/SW cleanup script + Google API / OAuth client scripts |
| `frame-src` | `'self'`, `https://*.firebaseapp.com`, `https://accounts.google.com` | Firebase Auth iframe handler (`/__/auth/iframe`) & Google OAuth interactive chooser |
| `connect-src` | `'self'`, `https://accounts.google.com`, `https://identitytoolkit.googleapis.com`, `https://securetoken.googleapis.com`, `https://firestore.googleapis.com`, `https://*.googleapis.com`, `https://*.firebaseio.com`, `wss://*.firebaseio.com` | Google OAuth token exchange, Firebase Auth session refresh, Firestore RPC/listen streams, `/api/time` |
| `img-src` | `'self'`, `https:`, `data:`, `blob:` | Google account `photoURL` (`https://lh3.googleusercontent.com/...`), QR canvas exports, local icons |
| `style-src` | `'self'`, `'unsafe-inline'`, `https://fonts.googleapis.com` | Tailwind utility styles + Google Fonts stylesheet |
| `font-src` | `'self'`, `https://fonts.gstatic.com`, `data:` | Orbitron / Rajdhani font files |
| `object-src` / `base-uri` | `'none'` / `'self'` | Blocks plugin embeds and `<base>` tag hijacking |
