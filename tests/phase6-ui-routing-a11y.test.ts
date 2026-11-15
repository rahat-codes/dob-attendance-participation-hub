/**
 * Phase 6 Behavioral Tests:
 * - resolveAppRoute (deep links, valid tabs, /index.html normalization, 404 on unknown hash or pathname)
 * - theme.ts (resolveTheme, toggleTheme, default dark fallback)
 * - ErrorBoundary (getDerivedStateFromError, sanitizeRuntimeErrorMessage truncation & fallback)
 * - CSS variables & Public HTML meta contract verification
 */

import fs from 'fs';
import path from 'path';
import { resolveAppRoute, VALID_ROUTES } from '../src/utils/routing';
import { resolveTheme, toggleTheme, THEME_STORAGE_KEY } from '../src/utils/theme';
import {
  ErrorBoundary,
  sanitizeRuntimeErrorMessage,
  redactSensitiveText,
  isChunkLoadError,
  formatSafeBoundaryLog,
  tryGuardedChunkReload,
  CHUNK_RELOAD_STORAGE_KEY,
} from '../src/components/common/ErrorBoundary';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, message: string) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message} -> expected=${String(expected)}, actual=${String(actual)}`);
    failed++;
  }
}

function runPhase6Tests() {
  console.log('\n========================================');
  console.log('PHASE 6 UI, ROUTING, THEME & ERROR BOUNDARY TESTS');
  console.log('========================================\n');

  // 1. Route resolution & 404 detection
  console.log('1. resolveAppRoute & 404 Handling');
  assertEq(VALID_ROUTES.length, 7, 'Single source of truth defines 7 canonical workspace routes');

  const rootEmpty = resolveAppRoute({ pathname: '/', search: '', hash: '' });
  assertEq(rootEmpty.isNotFound, false, 'Root / with empty hash is valid');
  assertEq(rootEmpty.tab, null, 'Empty hash delegates to saved/default tab');

  const indexSlash = resolveAppRoute({ pathname: '/index.html', search: '', hash: '#/' });
  assertEq(indexSlash.isNotFound, false, '/index.html with #/ is valid');

  const validHash = resolveAppRoute({ pathname: '/', search: '', hash: '#/Leaderboard' });
  assertEq(validHash.isNotFound, false, 'Recognizes #/Leaderboard case-insensitively');
  assertEq(validHash.tab, 'leaderboard', 'Normalizes tab slug to lowercase');

  const deepLink = resolveAppRoute({ pathname: '/', search: '?s=sess_123&t=tok_abc', hash: '' });
  assertEq(deepLink.isNotFound, false, 'Deep-link QR query params are not treated as 404');
  assertEq(deepLink.hasDeepLinkCheckIn, true, 'Detects deep-link QR params accurately');
  assertEq(deepLink.tab, 'home', 'Deep-link check-in routes to home tab');

  const badHash = resolveAppRoute({ pathname: '/', search: '', hash: '#/unknown-admin-panel' });
  assertEq(badHash.isNotFound, true, 'Unknown hash route triggers 404 isNotFound');
  assertEq(badHash.invalidRoute, '#/unknown-admin-panel', 'Preserves invalid hash label for 404 screen');

  const badPathname = resolveAppRoute({ pathname: '/does-not-exist', search: '', hash: '' });
  assertEq(badPathname.isNotFound, true, 'Unknown pathname triggers 404 isNotFound');
  assertEq(badPathname.invalidRoute, '/does-not-exist', 'Preserves invalid pathname for 404 screen');

  // 2. Dark / Light Theme Helpers
  console.log('\n2. Theme Utilities (CSS Variable Switching)');
  assertEq(THEME_STORAGE_KEY, 'dob_theme', 'Uses consistent storage key dob_theme');
  assertEq(resolveTheme('light'), 'light', 'Resolves explicit light preference');
  assertEq(resolveTheme('dark'), 'dark', 'Resolves explicit dark preference');
  assertEq(resolveTheme(null), 'dark', 'Defaults to dark when storage value missing');
  assertEq(resolveTheme('sepia'), 'dark', 'Rejects arbitrary theme strings cleanly to dark');
  assertEq(toggleTheme('dark'), 'light', 'Toggles dark -> light');
  assertEq(toggleTheme('light'), 'dark', 'Toggles light -> dark');

  // 3. ErrorBoundary State Derivation
  console.log('\n3. Root ErrorBoundary State Derivation');
  const errState = ErrorBoundary.getDerivedStateFromError(new Error('Widget crashed during render'));
  assertEq(errState.hasError, true, 'getDerivedStateFromError marks hasError = true');
  assertEq(errState.errorMessage, 'Widget crashed during render', 'Captures error message safely');

  const fallbackErr = sanitizeRuntimeErrorMessage(undefined);
  assertEq(
    fallbackErr,
    'An unexpected interface error occurred.',
    'Provides safe default message for non-Error throws'
  );

  const oversizedMsg = sanitizeRuntimeErrorMessage(new Error('X'.repeat(300)));
  assertEq(oversizedMsg.length, 180, 'Bounds long runtime error messages cleanly to 180 chars');

  const rawLeaky =
    'Failed for alice.kim@example.com with uid=uid_secret_123 and token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123def456 at https://dob.app/?s=sess1&t=tok999';
  const safeLog = formatSafeBoundaryLog(new Error(rawLeaky));
  assert(
    !safeLog.message.includes('alice.kim@example.com') &&
      !safeLog.message.includes('uid_secret_123') &&
      !safeLog.message.includes('eyJhbGci') &&
      !safeLog.message.includes('tok999'),
    'formatSafeBoundaryLog strips emails, UIDs, JWT/long tokens, and query tokens'
  );
  assertEq(
    redactSensitiveText('userId: user_abc987 email test@dob.club').includes('user_abc987'),
    false,
    'redactSensitiveText scrubs userId fields cleanly'
  );

  const chunkErr = new TypeError('Failed to fetch dynamically imported module: https://dob.app/assets/SessionsView-123.js');
  assertEq(isChunkLoadError(chunkErr), true, 'Detects dynamic import chunk load failure');
  assertEq(isChunkLoadError(new Error('Normal component error')), false, 'Does not treat normal errors as chunk load errors');

  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
  let reloadCount = 0;
  const firstReload = tryGuardedChunkReload(chunkErr, mockStorage, () => {
    reloadCount += 1;
  });
  const secondReload = tryGuardedChunkReload(chunkErr, mockStorage, () => {
    reloadCount += 1;
  });
  const nonChunkReload = tryGuardedChunkReload(new Error('Other crash'), new Map() as any, () => {
    reloadCount += 1;
  });
  assertEq(firstReload, true, 'Triggers guarded reload once on lazy-chunk load failure');
  assertEq(secondReload, false, 'Blocks infinite reload loop once sessionStorage flag is set');
  assertEq(store.get(CHUNK_RELOAD_STORAGE_KEY), '1', 'Persists CHUNK_RELOAD_STORAGE_KEY in sessionStorage');
  assertEq(reloadCount, 1, 'Reload callback invoked exactly once');
  assertEq(nonChunkReload, false, 'Never triggers chunk reload for non-chunk errors');

  // 4. CSS Variable Theme & Public Meta Verification
  console.log('\n4. CSS Variables & Public Meta Contract');
  const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf-8');
  assert(cssContent.includes("[data-theme='light']"), 'index.css defines [data-theme=\'light\'] variable overrides');
  assert(cssContent.includes('--bg-app:'), 'index.css defines --bg-app CSS variable');
  assert(cssContent.includes('--text-main:'), 'index.css defines --text-main CSS variable');
  assert(cssContent.includes('button:focus-visible'), 'index.css defines visible focus outline for buttons');

  const htmlContent = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
  assert(htmlContent.includes('<title>Den of Builders'), 'index.html sets descriptive <title>');
  assert(htmlContent.includes('name="description"'), 'index.html includes meta description');
  assert(htmlContent.includes('property="og:title"'), 'index.html includes og:title');
  assert(htmlContent.includes('property="og:description"'), 'index.html includes og:description');
  assert(htmlContent.includes('viewport-fit=cover'), 'index.html sets responsive mobile viewport-fit=cover');

  const loginContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/LoginView.tsx'), 'utf-8');
  assert(
    loginContent.includes('/dob_logo-192.png') && !loginContent.includes('/dob_logo.png'),
    'LoginView loads compact /dob_logo-192.png instead of unoptimized /dob_logo.png'
  );

  console.log('\n========================================');
  console.log(`PHASE 6 TEST SUITE: Passed: ${passed} | Failed: ${failed}`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase6Tests();
