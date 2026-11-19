import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeGitHubUrl,
  normalizeLinkedInUrl,
  normalizePortfolioUrl,
  PROFILE_LINK_RULES_REGEX,
} from '../src/utils/profileLinks';
import {
  buildMemberProfileDiff,
  executeIsolatedProfileUpdate,
  formatStepFailureMessage,
} from '../src/utils/profileEdit';
import { formatUserFriendlyFirestoreError } from '../src/utils/firestoreErrors';
import { CLIENT_SCHEMA_VERSION } from '../src/config/constants';
import type { Member, MemberPrivate } from '../src/types';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS: ${name}`);
}

interface LinkVector {
  input: string;
  valid: boolean;
  canonical?: string;
  note?: string;
}

interface LinkFixtures {
  github: LinkVector[];
  linkedin: LinkVector[];
  portfolio: LinkVector[];
}

// Mirror proposed Firestore rules regexes (docs/RULES_LINKS_FIX.md) in JS for parity testing
function rulesIsValidGitHub(url: string | null): boolean {
  if (url === null || url === '') return true;
  return (
    typeof url === 'string' &&
    url.length <= 100 &&
    PROFILE_LINK_RULES_REGEX.github.test(url)
  );
}

function rulesIsValidLinkedIn(url: string | null): boolean {
  if (url === null || url === '') return true;
  return (
    typeof url === 'string' &&
    url.length <= 150 &&
    !url.includes('..') &&
    PROFILE_LINK_RULES_REGEX.linkedin.test(url)
  );
}

function rulesIsValidPortfolio(url: string | null): boolean {
  if (url === null || url === '') return true;
  return (
    typeof url === 'string' &&
    url.length <= 200 &&
    PROFILE_LINK_RULES_REGEX.portfolio.test(url) &&
    !PROFILE_LINK_RULES_REGEX.portfolioLocalhost.test(url)
  );
}

async function run() {
  console.log('Running Profile Edit Diff, Step Isolation & Link Fixture Tests...');

  const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/profile-links.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as LinkFixtures;

  await test(`GitHub fixtures (${fixtures.github.length} vectors) match client normalizer and rules regex`, () => {
    assert.ok(fixtures.github.length >= 10);
    for (const vec of fixtures.github) {
      const res = normalizeGitHubUrl(vec.input, { allowEmpty: true });
      assert.equal(res.valid, vec.valid, `GitHub client verdict mismatch for "${vec.input}" (${vec.note})`);
      if (vec.valid) {
        assert.equal(res.canonicalUrl, vec.canonical, `GitHub canonical mismatch for "${vec.input}"`);
        assert.equal(
          rulesIsValidGitHub(res.canonicalUrl!),
          true,
          `Proposed rules rejected canonical GitHub URL "${res.canonicalUrl}"`
        );
      } else if (/^https?:\/\//i.test(vec.input)) {
        assert.equal(
          rulesIsValidGitHub(vec.input),
          false,
          `Proposed rules wrongly accepted invalid GitHub URL "${vec.input}"`
        );
      }
    }
    const cleared = normalizeGitHubUrl('', { allowEmpty: true });
    assert.equal(cleared.valid, true);
    assert.equal(cleared.canonicalUrl, '');
  });

  await test(`LinkedIn fixtures (${fixtures.linkedin.length} vectors) match client normalizer and rules regex`, () => {
    assert.ok(fixtures.linkedin.length >= 10);
    for (const vec of fixtures.linkedin) {
      const res = normalizeLinkedInUrl(vec.input, { allowEmpty: true });
      assert.equal(res.valid, vec.valid, `LinkedIn client verdict mismatch for "${vec.input}" (${vec.note})`);
      if (vec.valid) {
        assert.equal(res.canonicalUrl, vec.canonical, `LinkedIn canonical mismatch for "${vec.input}"`);
        assert.equal(
          rulesIsValidLinkedIn(res.canonicalUrl!),
          true,
          `Proposed rules rejected canonical LinkedIn URL "${res.canonicalUrl}"`
        );
      } else if (/^https?:\/\//i.test(vec.input)) {
        assert.equal(
          rulesIsValidLinkedIn(vec.input),
          false,
          `Proposed rules wrongly accepted invalid LinkedIn URL "${vec.input}"`
        );
      }
    }
    const cleared = normalizeLinkedInUrl('', { allowEmpty: true });
    assert.equal(cleared.valid, true);
    assert.equal(cleared.canonicalUrl, '');
  });

  await test(`Portfolio fixtures (${fixtures.portfolio.length} vectors) match client normalizer and rules regex`, () => {
    assert.ok(fixtures.portfolio.length >= 15);
    for (const vec of fixtures.portfolio) {
      const res = normalizePortfolioUrl(vec.input);
      assert.equal(res.valid, vec.valid, `Portfolio client verdict mismatch for "${vec.input}" (${vec.note})`);
      if (vec.valid) {
        assert.equal(res.canonicalUrl, vec.canonical, `Portfolio canonical mismatch for "${vec.input}"`);
        assert.equal(
          rulesIsValidPortfolio(res.canonicalUrl!),
          true,
          `Proposed rules rejected canonical Portfolio URL "${res.canonicalUrl}"`
        );
      } else if (/^https?:\/\//i.test(vec.input) && !vec.input.startsWith('https://user') && !vec.input.startsWith('https://127.') && !vec.input.startsWith('https://192.') && !vec.input.startsWith('https://[') && !vec.input.includes(':8080')) {
        assert.equal(
          rulesIsValidPortfolio(vec.input),
          false,
          `Proposed rules wrongly accepted invalid Portfolio URL "${vec.input}"`
        );
      }
    }
    assert.equal(rulesIsValidPortfolio('https://site.dev?a=1#sec'), true, 'Proposed rules accept query/fragment without slash');
    assert.equal(rulesIsValidPortfolio('https://localhost?a=1'), false, 'Proposed rules block localhost with query');
  });

  const baseMember: Partial<Member> = {
    id: 'mem_legacy_1',
    authUid: 'uid_member_1',
    name: 'Iuliia Gafurova',
    handle: '@iuliia',
    role: 'Member',
    tracks: ['AI & Embedded'],
    status: 'Active',
    avatarUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    bio: 'Building ML tools',
    leaderboardOptOut: false,
    showLinksPublicly: true,
    githubUrl: '',
    linkedinUrl: '',
    portfolioUrl: '',
  };

  const basePrivate: Partial<MemberPrivate> = {
    email: 'member@example.com',
    phone: '010-1234-5678',
    studentId: '20251508',
    university: 'Tongmyong University',
    profileCompleted: true,
    profileCompletedAt: '2026-01-01T00:00:00.000Z',
  };

  await test('buildMemberProfileDiff emits only changed link keys on links-only edit and never defaults tracks or touches private/user docs', () => {
    const diff = buildMemberProfileDiff(
      baseMember,
      basePrivate,
      {
        name: 'Iuliia Gafurova',
        avatarUrl: baseMember.avatarUrl,
        bio: baseMember.bio,
        tracks: ['AI & Embedded'],
        leaderboardOptOut: false,
        githubUrl: '@iuliia-dev',
        linkedinUrl: 'https://linkedin.com/in/iuliia.gafurova/',
        portfolioUrl: 'iuliia.dev/projects?tab=ai#top',
        showLinksPublicly: true,
        email: basePrivate.email,
        phone: basePrivate.phone,
        studentId: basePrivate.studentId,
        university: basePrivate.university,
      },
      {
        targetMemberId: 'mem_legacy_1',
        currentUid: 'uid_member_1',
        isMandatory: false,
        nowIso: '2026-11-18T00:00:00.000Z',
      }
    );

    assert.equal(diff.valid, true);
    if (!diff.valid) return;
    assert.deepEqual(Object.keys(diff.plan.memberPatch).sort(), ['githubUrl', 'linkedinUrl', 'portfolioUrl']);
    assert.equal(diff.plan.memberPatch.githubUrl, 'https://github.com/iuliia-dev');
    assert.equal(diff.plan.memberPatch.linkedinUrl, 'https://www.linkedin.com/in/iuliia.gafurova');
    assert.equal(diff.plan.memberPatch.portfolioUrl, 'https://iuliia.dev/projects?tab=ai#top');
    assert.equal('tracks' in diff.plan.memberPatch, false, 'Unchanged tracks must not be sent');
    assert.deepEqual(diff.plan.privatePatch, {}, 'Private doc should not be written on links-only edit');
    assert.equal(diff.plan.userDocPatch, null, 'User doc must not be written when name/photo unchanged');
    assert.equal(diff.plan.authProfilePatch, null);
    assert.equal(diff.plan.publicLeaderboardAction, 'update');
  });

  await test('buildMemberProfileDiff never defaults empty tracks to Software & Systems when unchanged', () => {
    const legacyNoTracks: Partial<Member> = { ...baseMember, tracks: [] };
    const diff = buildMemberProfileDiff(
      legacyNoTracks,
      basePrivate,
      {
        name: 'Iuliia Gafurova',
        tracks: [],
        githubUrl: 'https://github.com/octocat',
      },
      { targetMemberId: 'mem_legacy_1', currentUid: 'uid_member_1', isMandatory: false }
    );
    assert.equal(diff.valid, true);
    if (!diff.valid) return;
    assert.equal('tracks' in diff.plan.memberPatch, false, 'Must never inject default track on legacy doc');
  });

  await test('buildMemberProfileDiff writes empty string when clearing links and never forwards data: URLs to users/auth', () => {
    const memberWithLinks: Partial<Member> = {
      ...baseMember,
      githubUrl: 'https://github.com/octocat',
      linkedinUrl: 'https://www.linkedin.com/in/iuliia.gafurova',
      portfolioUrl: 'https://site.dev/',
    };
    const diff = buildMemberProfileDiff(
      memberWithLinks,
      basePrivate,
      {
        name: 'Iuliia Updated',
        avatarUrl: 'data:image/jpeg;base64,/9j/NEWIMAGE==',
        tracks: ['AI & Embedded'],
        githubUrl: '',
        linkedinUrl: '',
        portfolioUrl: '',
        showLinksPublicly: true,
      },
      { targetMemberId: 'mem_legacy_1', currentUid: 'uid_member_1', isMandatory: false }
    );
    assert.equal(diff.valid, true);
    if (!diff.valid) return;
    assert.equal(diff.plan.memberPatch.githubUrl, '');
    assert.equal(diff.plan.memberPatch.linkedinUrl, '');
    assert.equal(diff.plan.memberPatch.portfolioUrl, '');
    assert.equal(diff.plan.publicLeaderboardPatch.githubUrl, '');
    assert.equal(diff.plan.publicLeaderboardPatch.linkedinUrl, '');
    assert.equal(diff.plan.publicLeaderboardPatch.portfolioUrl, '');
    assert.ok(diff.plan.userDocPatch, 'Name change syncs displayName');
    assert.equal(diff.plan.userDocPatch?.displayName, 'Iuliia Updated');
    assert.equal('photoURL' in (diff.plan.userDocPatch || {}), false, 'Must strip data: URL from users/{uid}.photoURL');
    assert.equal('photoURL' in (diff.plan.authProfilePatch || {}), false, 'Must strip data: URL from auth.updateProfile');
  });

  await test('executeIsolatedProfileUpdate aborts before memberPrivate (profileCompleted) when members step fails and hides UIDs', async () => {
    const diff = buildMemberProfileDiff(
      baseMember,
      { ...basePrivate, profileCompleted: false },
      {
        name: 'Iuliia Gafurova',
        tracks: ['AI & Embedded'],
        githubUrl: 'https://github.com/octocat',
        studentId: '20251508',
      },
      { targetMemberId: 'mem_legacy_1', currentUid: 'uid_member_1', isMandatory: true }
    );
    assert.equal(diff.valid, true);
    if (!diff.valid) return;

    let privateCalled = false;
    let pubCalled = false;
    let userCalled = false;

    const rawPermErr = new Error(
      JSON.stringify({
        error: 'Missing or insufficient permissions.',
        authInfo: { userId: 'TVE6rPuwvfcZDJjGv3t9ESJ1t8v1', email: 'pun15h3r321@gmail.com' },
        path: 'members/mem_legacy_1',
      })
    );

    const res = await executeIsolatedProfileUpdate(diff.plan, {
      updateMemberDoc: async () => {
        throw rawPermErr;
      },
      mergeMemberPrivateDoc: async () => {
        privateCalled = true;
      },
      publicLeaderboardDocExists: async () => true,
      updatePublicLeaderboardDoc: async () => {
        pubCalled = true;
      },
      deletePublicLeaderboardDoc: async () => {},
      updateUserDoc: async () => {
        userCalled = true;
      },
      updateAuthProfile: async () => {},
      logError: () => {},
      logWarn: () => {},
    });

    assert.equal(res.success, false);
    assert.equal(res.failedStep, 'members');
    assert.equal(res.errorCode, 'permission-denied');
    assert.equal(privateCalled, false, 'Must never mark memberPrivate profileCompleted if members write failed');
    assert.equal(pubCalled, false);
    assert.equal(userCalled, false);
    assert.ok(res.message && !res.message.includes('TVE6rPuwvfcZDJjGv3t9ESJ1t8v1'), 'Must not leak UID');
    assert.ok(res.message && !res.message.includes('pun15h3r321@gmail.com'), 'Must not leak email');
  });

  await test('executeIsolatedProfileUpdate isolates non-critical step (c) publicLeaderboard and step (d) users failures', async () => {
    const diff = buildMemberProfileDiff(
      baseMember,
      basePrivate,
      {
        name: 'Iuliia Renamed',
        tracks: ['AI & Embedded'],
        githubUrl: 'https://github.com/octocat',
      },
      { targetMemberId: 'mem_legacy_1', currentUid: 'uid_member_1', isMandatory: false }
    );
    assert.equal(diff.valid, true);
    if (!diff.valid) return;

    let memberSaved = false;
    const res = await executeIsolatedProfileUpdate(diff.plan, {
      updateMemberDoc: async () => {
        memberSaved = true;
      },
      mergeMemberPrivateDoc: async () => {},
      publicLeaderboardDocExists: async () => true,
      updatePublicLeaderboardDoc: async () => {
        throw { code: 'permission-denied', message: 'Denied publicLeaderboard' };
      },
      deletePublicLeaderboardDoc: async () => {},
      updateUserDoc: async () => {
        throw { code: 'unavailable', message: 'Offline users write' };
      },
      updateAuthProfile: async () => {},
      logError: () => {},
      logWarn: () => {},
    });

    assert.equal(memberSaved, true);
    assert.equal(res.success, true, 'Non-critical leaderboard/users failures must not fail core save');
    assert.equal(res.warnings?.length, 2);
    assert.equal(res.warnings?.[0].step, 'publicLeaderboard');
    assert.equal(res.warnings?.[1].step, 'users');
  });

  await test('formatStepFailureMessage returns step label, collection, diagnosticCode, and redacts sensitive data', () => {
    const formatted = formatStepFailureMessage(
      'memberPrivate',
      {
        code: 'permission-denied',
        message: 'Missing or insufficient permissions for user@example.com /TVE6rPuwvfcZDJjGv3t9ESJ1t8v1',
      },
      'merge'
    );
    assert.equal(formatted.code, 'permission-denied');
    assert.equal(formatted.collection, 'memberPrivate');
    assert.equal(formatted.operation, 'merge');
    assert.ok(formatted.message.includes('private contact details'));
    assert.ok(formatted.message.includes('permission-denied'));
    assert.ok(!formatted.message.includes('Permission check failed for this action.'));
    assert.ok(!formatted.message.includes('TVE6rPuwvfcZDJjGv3t9ESJ1t8v1'));
    assert.ok(!formatted.message.includes('user@example.com'));
    assert.equal(
      formatted.diagnosticCode,
      `step=memberPrivate op=merge code=permission-denied v=${CLIENT_SCHEMA_VERSION}`
    );

    const acceptFmt = formatStepFailureMessage(
      'acceptInvitation',
      { code: 'permission-denied', message: 'Missing or insufficient permissions.' },
      'batchWrite'
    );
    assert.equal(acceptFmt.collection, 'users+members');
    assert.ok(acceptFmt.message.includes('membership invitation'));
    assert.ok(!acceptFmt.message.includes('Permission check failed for this action.'));
  });

  await test('formatUserFriendlyFirestoreError maps native FirebaseError via explicit context path', () => {
    const nativeErr = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    const msg = formatUserFriendlyFirestoreError(nativeErr, 'Fallback', {
      path: 'memberPrivate/',
      operation: 'merge',
      step: 'memberPrivate',
    });
    assert.ok(msg.toLowerCase().includes('private contact details'));
    assert.ok(!msg.includes('Permission check failed for this action.'));
  });

  await test('buildMemberProfileDiff for mandatory setup with missing id/authUid and null memberPrivate populates required patches cleanly', () => {
    const legacyPendingMember: Partial<Member> = {
      name: 'Iuliia Gafurova',
      handle: '@iuliia',
      role: 'Member',
      tracks: ['Software & Systems'],
      status: 'Active',
    };
    const diff = buildMemberProfileDiff(
      legacyPendingMember,
      null,
      {
        name: 'Iuliia Gafurova',
        email: 'gafurovaiullia@gmail.com',
        phone: '+82 10-5555-1234',
        studentId: '20251508',
        university: 'Tongmyong University',
        tracks: ['AI & Embedded'],
      },
      {
        targetMemberId: 'mem_iuliia_1',
        currentUid: 'uid_iuliia_1',
        isMandatory: true,
        nowIso: '2026-11-18T12:00:00.000Z',
      }
    );
    assert.equal(diff.valid, true);
    if (!diff.valid) return;
    assert.deepEqual(Object.keys(diff.plan.memberPatch).sort(), ['authUid', 'id', 'tracks']);
    assert.equal(diff.plan.memberPatch.id, 'mem_iuliia_1');
    assert.equal(diff.plan.memberPatch.authUid, 'uid_iuliia_1');
    assert.deepEqual(diff.plan.memberPatch.tracks, ['AI & Embedded']);
    assert.equal(diff.plan.privatePatch.studentId, '20251508');
    assert.equal(diff.plan.privatePatch.phone, '+82 10-5555-1234');
    assert.equal(diff.plan.privatePatch.profileCompleted, true);
    assert.equal(diff.plan.privatePatch.profileCompletedAt, '2026-11-18T12:00:00.000Z');
  });

  console.log(`Passed ${passed} profile edit tests.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
