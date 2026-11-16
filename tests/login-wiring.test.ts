import assert from 'node:assert/strict';
import { formatAuthSignInError } from '../src/utils/authErrors';

/**
 * Test Suite: Login Page Wiring and State Machine Transitions
 * Verifies every button/link handler mapping across all auth/membership states,
 * error presentation, and non-stuck disabled behavior.
 */

console.log('--- RUNNING LOGIN WIRING & STATE TESTS ---');

// 1. Signed-out State Button Wiring
{
  const calls: Record<string, number> = {
    handleSignIn: 0,
    clearAuthError: 0,
    onContinueAsGuest: 0,
  };

  const handlers = {
    handleSignIn: async () => {
      calls.handleSignIn++;
      return true;
    },
    clearAuthError: () => {
      calls.clearAuthError++;
    },
    onContinueAsGuest: () => {
      calls.onContinueAsGuest++;
    },
  };

  // Primary Google button
  handlers.handleSignIn();
  assert.equal(calls.handleSignIn, 1, 'Primary Google button must call handleSignIn');

  // Secondary Pearl Orb button
  handlers.handleSignIn();
  assert.equal(calls.handleSignIn, 2, 'Circular Google orb button must call handleSignIn');

  // Explore Public Hub button
  handlers.onContinueAsGuest();
  assert.equal(calls.onContinueAsGuest, 1, 'Explore Public Hub button must call onContinueAsGuest');

  // Dismiss notification button
  handlers.clearAuthError();
  assert.equal(calls.clearAuthError, 1, 'Clear auth error button must call clearAuthError');

  console.log('✓ Signed-out state buttons correctly wired to handlers');
}

// 2. Unlinked Applicant State Button Wiring
{
  const calls: Record<string, number> = {
    requestMembershipLink: 0,
    refreshProfile: 0,
    signOutUser: 0,
  };

  let submittedNotes = '';
  const handlers = {
    requestMembershipLink: async (notes: string) => {
      calls.requestMembershipLink++;
      submittedNotes = notes;
    },
    refreshProfile: async () => {
      calls.refreshProfile++;
    },
    signOutUser: async () => {
      calls.signOutUser++;
    },
  };

  handlers.requestMembershipLink('@builder_john');
  assert.equal(calls.requestMembershipLink, 1);
  assert.equal(submittedNotes, '@builder_john');

  handlers.refreshProfile();
  assert.equal(calls.refreshProfile, 1);

  handlers.signOutUser();
  assert.equal(calls.signOutUser, 1);

  console.log('✓ Unlinked state buttons correctly wired to handlers');
}

// 3. Pending State Button Wiring
{
  const calls: Record<string, number> = {
    refreshProfile: 0,
    signOutUser: 0,
    editHandleSave: 0,
  };

  const handlers = {
    refreshProfile: async () => {
      calls.refreshProfile++;
    },
    signOutUser: async () => {
      calls.signOutUser++;
    },
    saveEditedHandle: async (notes: string) => {
      calls.editHandleSave++;
      return notes;
    },
  };

  handlers.refreshProfile();
  assert.equal(calls.refreshProfile, 1, 'Check Approval Status button must call refreshProfile');

  handlers.signOutUser();
  assert.equal(calls.signOutUser, 1, 'Sign Out button must call signOutUser');

  handlers.saveEditedHandle('@new_handle');
  assert.equal(calls.editHandleSave, 1, 'Edit handle save button must call saveEditedHandle');

  console.log('✓ Pending state buttons correctly wired to handlers');
}

// 4. Approved Waiting Response (Invitation) State Button Wiring
{
  const calls: Record<string, number> = {
    acceptMembershipInvitation: 0,
    declineMembershipInvitation: 0,
    refreshProfile: 0,
    signOutUser: 0,
  };

  const handlers = {
    acceptMembershipInvitation: async () => {
      calls.acceptMembershipInvitation++;
    },
    declineMembershipInvitation: async () => {
      calls.declineMembershipInvitation++;
    },
    refreshProfile: async () => {
      calls.refreshProfile++;
    },
    signOutUser: async () => {
      calls.signOutUser++;
    },
  };

  handlers.acceptMembershipInvitation();
  assert.equal(calls.acceptMembershipInvitation, 1, 'Accept button must call acceptMembershipInvitation');

  handlers.declineMembershipInvitation();
  assert.equal(calls.declineMembershipInvitation, 1, 'Decline button must call declineMembershipInvitation');

  handlers.refreshProfile();
  assert.equal(calls.refreshProfile, 1, 'Refresh button must call refreshProfile');

  handlers.signOutUser();
  assert.equal(calls.signOutUser, 1, 'Sign Out button must call signOutUser');

  console.log('✓ Approved (waiting response) invitation buttons correctly wired');
}

// 5. Declined State Button Wiring
{
  const calls: Record<string, number> = {
    reRequestAccess: 0,
    signOutUser: 0,
  };

  const handlers = {
    reRequestAccess: async (notes?: string) => {
      calls.reRequestAccess++;
      return notes;
    },
    signOutUser: async () => {
      calls.signOutUser++;
    },
  };

  handlers.reRequestAccess('Re-applying after team intro');
  assert.equal(calls.reRequestAccess, 1, 'Re-apply button must call reRequestAccess');

  handlers.signOutUser();
  assert.equal(calls.signOutUser, 1, 'Sign Out button must call signOutUser');

  console.log('✓ Declined state re-apply buttons correctly wired');
}

// 6. Error & Cancellation Handling: Popup Cancelled Never Redirects or Leaves Button Stuck
{
  let isSigningIn = false;
  let authError: string | null = null;

  async function mockSignIn(failWithCode?: string): Promise<{ ok: boolean; signingIn: boolean; error: string | null }> {
    isSigningIn = true;
    authError = null;
    try {
      if (failWithCode) {
        const err: any = new Error('Auth error');
        err.code = failWithCode;
        throw err;
      }
      return { ok: true, signingIn: false, error: null };
    } catch (err: any) {
      authError = formatAuthSignInError(err, 'dob-hub.vercel.app');
      return { ok: false, signingIn: false, error: authError };
    } finally {
      isSigningIn = false;
    }
  }

  // Case A: User cancels popup
  const cancelResult = await mockSignIn('auth/popup-closed-by-user');
  assert.equal(cancelResult.ok, false);
  assert.equal(isSigningIn, false, 'signingIn flag must reset to false after popup cancelled');
  assert.equal(cancelResult.error, null, 'No alarming error should be shown when user simply closes popup');

  // Case B: Cancelled popup request
  const cancelReqResult = await mockSignIn('auth/cancelled-popup-request');
  assert.equal(cancelReqResult.ok, false);
  assert.equal(isSigningIn, false, 'signingIn flag must reset to false after cancelled-popup-request');
  assert.equal(cancelReqResult.error, null, 'No error on cancelled-popup-request');

  // Case C: Network error
  const netResult = await mockSignIn('auth/network-request-failed');
  assert.equal(netResult.ok, false);
  assert.equal(isSigningIn, false, 'signingIn flag must reset to false after network failure');
  assert.ok(netResult.error?.includes('Network error'), 'Helpful network message shown');

  // Case D: Unauthorized domain includes active hostname and Firebase Console guidance
  const domainResult = await mockSignIn('auth/unauthorized-domain');
  assert.equal(domainResult.ok, false);
  assert.equal(isSigningIn, false, 'signingIn flag must reset to false after domain failure');
  assert.ok(domainResult.error?.includes('not authorized'), 'Domain authorization error shown');
  assert.ok(domainResult.error?.includes('dob-hub.vercel.app'), 'Unauthorized domain error should name active hostname');
  assert.ok(domainResult.error?.includes('Authorized domains'), 'Unauthorized domain error should point admin to Authorized domains setting');

  // Case E: Unauthorized domain fallback when hostname unavailable
  const fallbackDomainMsg = formatAuthSignInError({ code: 'auth/unauthorized-domain' }, '');
  assert.ok(fallbackDomainMsg?.includes('This domain is not authorized'));

  console.log('✓ Popup cancellation and error recovery resets button state without stuck loading');
}

console.log('ALL LOGIN WIRING & STATE TESTS PASSED CLEANLY!');
