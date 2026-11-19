import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatUserFriendlyFirestoreError } from '../src/utils/firestoreErrors';
import { normalizeLinkedInUrl, sanitizeAuthPhotoUrl } from '../src/utils/profileLinks';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  PASS: ${name}`);
}

console.log('Running Member Flows & Permissions Regression Tests...');

test('formatUserFriendlyFirestoreError translates JSON handleFirestoreError users/ permission error cleanly', () => {
  const raw = JSON.stringify({
    error: 'Missing or insufficient permissions.',
    authInfo: {
      userId: 'TVE6rPuwvfcZDJjGv3t9ESJ1t8v1',
      email: 'pun15h3r321@gmail.com',
      emailVerified: true,
      isAnonymous: false,
      tenantId: null,
      providerInfo: [{ providerId: 'google.com', email: 'pun15h3r321@gmail.com' }],
    },
    operationType: 'update',
    path: 'users/TVE6rPuwvfcZDJjGv3t9ESJ1t8v1',
  });

  const formatted = formatUserFriendlyFirestoreError(new Error(raw));
  assert.ok(!formatted.includes('authInfo'), 'Must never expose raw authInfo JSON');
  assert.ok(!formatted.includes('TVE6rPuwvfcZDJjGv3t9ESJ1t8v1'), 'Must never expose raw UID');
  assert.ok(formatted.toLowerCase().includes('account update'), 'Should guide user cleanly');
});

test('formatUserFriendlyFirestoreError translates memberPrivate/ & members/ permission error cleanly', () => {
  const raw = JSON.stringify({
    error: 'Missing or insufficient permissions.',
    operationType: 'write',
    path: 'memberPrivate/mem_123',
  });

  const formatted = formatUserFriendlyFirestoreError({ code: 'permission-denied', message: raw });
  assert.ok(formatted.toLowerCase().includes('builder profile'), 'Should explain builder profile failure');
  assert.ok(!formatted.includes('mem_123'), 'Should not dump internal path');
});

test('formatUserFriendlyFirestoreError translates offline/network and timeout errors cleanly', () => {
  assert.ok(
    formatUserFriendlyFirestoreError({ code: 'unavailable', message: 'Failed to get document because the client is offline.' })
      .toLowerCase()
      .includes('network unavailable')
  );
  assert.ok(
    formatUserFriendlyFirestoreError({ code: 'deadline-exceeded', message: 'Deadline exceeded' })
      .toLowerCase()
      .includes('timed out')
  );
});

test('sanitizeAuthPhotoUrl allows short https:// URLs and rejects http://, data URIs, and >500-char strings', () => {
  assert.equal(
    sanitizeAuthPhotoUrl('https://lh3.googleusercontent.com/a/ACg8ocK_example=s96-c'),
    'https://lh3.googleusercontent.com/a/ACg8ocK_example=s96-c'
  );
  assert.equal(sanitizeAuthPhotoUrl('http://example.com/avatar.jpg'), '');
  assert.equal(sanitizeAuthPhotoUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), '');
  assert.equal(sanitizeAuthPhotoUrl(`https://example.com/${'a'.repeat(500)}`), '');
  assert.equal(sanitizeAuthPhotoUrl(undefined), '');
});

test('normalizeLinkedInUrl accepts dotted slugs and non-www URLs while rejecting path traversal', () => {
  const withDots = normalizeLinkedInUrl('https://linkedin.com/in/iuliia.gafurova/');
  assert.equal(withDots.valid, true);
  assert.equal(withDots.canonicalUrl, 'https://www.linkedin.com/in/iuliia.gafurova');

  const handleOnly = normalizeLinkedInUrl('in/alex.smith_2026');
  assert.equal(handleOnly.valid, true);
  assert.equal(handleOnly.canonicalUrl, 'https://www.linkedin.com/in/alex.smith_2026');

  const traversal = normalizeLinkedInUrl('https://www.linkedin.com/in/foo..bar');
  assert.equal(traversal.valid, false);
});

test('firestore.rules scopes user & member self-updates by affectedKeys and tolerates legacy docs', () => {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert.ok(rulesText.includes('function isValidAvatarUrl(url)'), 'Expected isValidAvatarUrl helper');
  assert.ok(rulesText.includes('data:image/(png|jpeg|jpg|webp|gif);base64,'), 'Expected safe raster data URI regex');
  assert.ok(!rulesText.includes('svg+xml'), 'Must never allow SVG data URIs in avatar validator');
  assert.ok(rulesText.includes('function isMemberOwner(memberId, memberData)'), 'Expected isMemberOwner helper');
  assert.ok(rulesText.includes("memberData.authUid == ''"), 'Expected empty-string authUid tolerance');
  assert.ok(rulesText.includes('function isValidUserUpdate(newData, oldData)'), 'Expected affectedKeys user update validator');
  assert.ok(rulesText.includes('function isValidMemberSelfUpdate(newData, oldData)'), 'Expected affectedKeys member self-update validator');
  assert.ok(rulesText.includes("https://(www\\\\.)?linkedin\\\\.com/in/[a-zA-Z0-9._%-]{3,100}/?$"), 'Expected optional www and dots in isValidLinkedIn');
  assert.ok(rulesText.includes("!url.matches('.*\\\\.\\\\..*')"), 'Expected dot-dot traversal guard in isValidLinkedIn');
});

test('AuthContext keeps member/memberPrivate listeners attached across same-memberId user updates and formats errors cleanly', () => {
  const authText = fs.readFileSync(path.resolve(process.cwd(), 'src/firebase/AuthContext.tsx'), 'utf8');
  assert.ok(authText.includes('activeMemberIdRef.current !== updatedProfile.memberId'), 'Expected listener guard on unchanged memberId');
  assert.ok(authText.includes('formatUserFriendlyFirestoreError('), 'Expected friendly error translation in AuthContext');
});

test('updateMemberSelfProfile pre-checks membership state, diffs only changed fields, and isolates 4 save steps', () => {
  const svcText = fs.readFileSync(path.resolve(process.cwd(), 'src/firebase/firestoreService.ts'), 'utf8');
  const editText = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/profileEdit.ts'), 'utf8');
  const startIdx = svcText.indexOf('export async function updateMemberSelfProfile(');
  const endIdx = svcText.indexOf('export async function recordCheckInAtomic', startIdx);
  const block = svcText.slice(startIdx, endIdx > startIdx ? endIdx : undefined);
  assert.ok(block.includes("userData.status === 'approved_waiting_response'"), 'Expected automatic invitation accept safety net');
  assert.ok(block.includes("memberData.status === 'Inactive'"), 'Expected Inactive member pre-check');
  assert.ok(block.includes('buildMemberProfileDiff('), 'Expected diff-only profile builder delegation');
  assert.ok(block.includes('executeIsolatedProfileUpdate('), 'Expected 4-step isolated executor delegation');
  assert.ok(block.includes('await updateDoc(memberRef, removeUndefinedFields(patch))'), 'Expected direct critical-path member patch update');
  assert.ok(editText.includes('memberPatch.id = options.targetMemberId'), 'Expected missing id backfill in profileEdit');
  assert.ok(editText.includes('Public leaderboard projection sync notice:'), 'Expected best-effort leaderboard sync isolation');
});

test('UI forms and App/PendingRequests wrap Firestore errors via formatUserFriendlyFirestoreError and guard legacy arrays', () => {
  const appText = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const pendingText = fs.readFileSync(path.resolve(process.cwd(), 'src/components/PendingRequests.tsx'), 'utf8');
  const appFormText = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ApplicationForm.tsx'), 'utf8');
  const addMemberText = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AddMemberModal.tsx'), 'utf8');
  const memberHomeText = fs.readFileSync(path.resolve(process.cwd(), 'src/components/MemberHomeView.tsx'), 'utf8');
  const membersViewText = fs.readFileSync(path.resolve(process.cwd(), 'src/components/MembersView.tsx'), 'utf8');

  assert.ok(appText.includes('formatUserFriendlyFirestoreError('), 'App.tsx should format Firestore errors');
  assert.ok(pendingText.includes('formatUserFriendlyFirestoreError('), 'PendingRequests.tsx should format Firestore errors');
  assert.ok(appFormText.includes('formatUserFriendlyFirestoreError('), 'ApplicationForm.tsx should format Firestore errors');
  assert.ok(addMemberText.includes('formatUserFriendlyFirestoreError('), 'AddMemberModal.tsx should format Firestore errors');
  assert.ok(memberHomeText.includes('Array.isArray(member.tracks)'), 'MemberHomeView.tsx should guard tracks array');
  assert.ok(membersViewText.includes('Array.isArray(m.tracks)'), 'MembersView.tsx should guard tracks array');
});

test('AuthContext, firestoreService, EditProfileModal, and LoginView never swallow member sync or acceptInvitation errors', () => {
  const authText = fs.readFileSync(path.resolve(process.cwd(), 'src/firebase/AuthContext.tsx'), 'utf8');
  const svcText = fs.readFileSync(path.resolve(process.cwd(), 'src/firebase/firestoreService.ts'), 'utf8');
  const editModalText = fs.readFileSync(path.resolve(process.cwd(), 'src/components/EditProfileModal.tsx'), 'utf8');
  const loginViewText = fs.readFileSync(path.resolve(process.cwd(), 'src/components/LoginView.tsx'), 'utf8');

  assert.ok(authText.includes('memberSyncError'), 'AuthContext must expose memberSyncError');
  assert.ok(authText.includes("source: 'members'"), 'AuthContext must surface members listener failures');
  assert.ok(authText.includes("source: 'memberPrivate'"), 'AuthContext must surface memberPrivate listener failures');

  assert.ok(svcText.includes("failedStep: 'acceptInvitation'"), 'updateMemberSelfProfile must isolate acceptInvitation failures');
  assert.ok(svcText.includes("failedStep: 'precheck'"), 'updateMemberSelfProfile must isolate precheck read failures');

  assert.ok(editModalText.includes('diagnosticCode'), 'EditProfileModal must display diagnosticCode');
  assert.ok(editModalText.includes('syncErrorMessage'), 'EditProfileModal must display syncErrorMessage');
  assert.ok(loginViewText.includes("memberSyncError?.source === 'members'"), 'LoginView must distinguish member listener failure from deactivated state');
});

console.log(`Passed ${passed} member flow tests.`);
