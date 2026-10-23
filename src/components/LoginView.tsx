import React, { useState } from 'react';
import { useAuth } from '../firebase/AuthContext';
import { m } from 'motion/react';
import { fadeUp } from '../motion/presets';
import {
  ShieldAlert,
  ShieldCheck,
  User,
  LogOut,
  RefreshCw,
  Send,
  AlertCircle,
  Sparkles,
  Lock,
  ArrowRight,
  HelpCircle,
  Trophy,
} from 'lucide-react';

interface LoginViewProps {
  onContinueAsGuest?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onContinueAsGuest }) => {
  const {
    user,
    profile,
    membershipState,
    handleSignIn,
    signOutUser,
    authError,
    clearAuthError,
    refreshProfile,
    requestMembershipLink,
    acceptMembershipInvitation,
    declineMembershipInvitation,
    signingIn,
    loading,
  } = useAuth();

  const [requestedHandle, setRequestedHandle] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [requestSubmittedSuccess, setRequestSubmittedSuccess] = useState(false);
  const [isRespondingToOffer, setIsRespondingToOffer] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);

  const handleAcceptOffer = async () => {
    setIsRespondingToOffer(true);
    setRespondError(null);
    try {
      await acceptMembershipInvitation();
    } catch (err: any) {
      setRespondError(err.message || 'Failed to accept membership invitation.');
    } finally {
      setIsRespondingToOffer(false);
    }
  };

  const handleDeclineOffer = async () => {
    if (!window.confirm('Are you sure you want to decline this membership invitation?')) {
      return;
    }
    setIsRespondingToOffer(true);
    setRespondError(null);
    try {
      await declineMembershipInvitation();
    } catch (err: any) {
      setRespondError(err.message || 'Failed to decline membership invitation.');
    } finally {
      setIsRespondingToOffer(false);
    }
  };

  const handleSubmitLinkRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingRequest(true);
    try {
      await requestMembershipLink(requestedHandle);
      setRequestSubmittedSuccess(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0b0e] tech-grid text-zinc-100 flex flex-col justify-center items-center px-4 py-12 selection:bg-[#b5ff00]/25 selection:text-[#b5ff00] relative overflow-hidden">
      {/* Spatial ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#b5ff00]/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[350px] h-[350px] bg-orange-500/4 rounded-full blur-[90px] pointer-events-none" />

      <m.div variants={fadeUp} initial="hidden" animate="show" className="w-full max-w-md relative z-10">
        {/* Brand Card Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3.5 rounded-3xl glass-panel neu-raised shadow-2xl mb-4 spatial-card">
            <img
              src="/dob_logo.png"
              alt="Den of Builders"
              className="w-14 h-14 object-contain"
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-white uppercase">
            Den of Builders
          </h1>
          <p className="text-xs uppercase font-bold tracking-[0.2em] text-[#b5ff00] mt-1 font-mono">
            Attendance &amp; Participation Hub
          </p>
        </div>

        {/* State 1 & 2: Not Signed In / Signing In / Error */}
        {(!user || membershipState === 'not_authenticated' || membershipState === 'signing_in' || membershipState === 'error') && (
          <div className="glass-panel rounded-3xl p-6 sm:p-8 spatial-card space-y-6">
            <div className="space-y-2 text-center">
              <h2 className="text-lg font-bold text-white font-display uppercase tracking-tight">Workshop &amp; Meeting Check-In</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Sign in with your Google account to scan workshop QR codes, track your build streak, and view active meeting sessions.
              </p>
            </div>

            {authError && (
              <div className="p-4 rounded-2xl bg-red-950/70 border border-red-500/40 text-red-200 text-xs space-y-2.5 neu-raised-sm">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                  <div className="flex-1">
                    <p className="font-semibold text-red-200">Google Authentication Notice</p>
                    <p className="text-[11.5px] text-red-300/90 mt-1 leading-relaxed">{authError}</p>
                  </div>
                  <button
                    onClick={clearAuthError}
                    className="text-red-400 hover:text-red-200 text-xs p-1"
                    title="Dismiss notification"
                  >
                    ✕
                  </button>
                </div>
                <div className="pt-2 border-t border-red-500/20 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSignIn}
                    disabled={signingIn}
                    className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/35 text-red-100 border border-red-500/40 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                  >
                    <RefreshCw className={`h-3 w-3 ${signingIn ? 'animate-spin' : ''}`} />
                    <span>Retry Sign-In</span>
                  </button>
                  {onContinueAsGuest && (
                    <button
                      type="button"
                      onClick={onContinueAsGuest}
                      className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/10 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                    >
                      <Trophy className="h-3 w-3 text-[#b5ff00]" />
                      <span>Browse Public Hub</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleSignIn}
              disabled={signingIn || loading}
              className="w-full py-3.5 px-4 rounded-2xl bg-[#b5ff00] hover:bg-[#c4ff26] active:scale-[0.99] text-black font-bold text-sm tracking-wide transition-all shadow-[0_0_20px_rgba(181,255,0,0.25)] flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-white/30"
            >
              {signingIn ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-black" />
                  <span>Connecting to Google...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Sign In with Google</span>
                </>
              )}
            </button>

            {onContinueAsGuest && (
              <button
                type="button"
                onClick={onContinueAsGuest}
                className="w-full py-3 px-4 rounded-2xl bg-[#141720] hover:bg-[#1c202d] text-zinc-200 hover:text-white border border-[#b5ff00]/40 neu-button font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 cursor-pointer font-mono shadow-[0_0_15px_rgba(181,255,0,0.15)]"
              >
                <Trophy className="h-4 w-4 text-[#b5ff00]" />
                <span>Explore Public Hub (Leaderboard &amp; Meetings)</span>
              </button>
            )}

            <div className="pt-2 border-t border-white/10 text-center">
              <p className="text-[11px] text-zinc-500 font-mono">
                Authorized for Den of Builders members &amp; organizers.
              </p>
            </div>
          </div>
        )}

        {/* State 3: Loading Profile */}
        {user && membershipState === 'loading_profile' && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-8 backdrop-blur-xl shadow-2xl text-center space-y-4">
            <RefreshCw className="h-8 w-8 text-[#b5ff00] animate-spin mx-auto" />
            <h2 className="text-base font-bold text-white">Verifying Builder Credentials...</h2>
            <p className="text-xs text-zinc-400">
              Retrieving member profile and access level for {user.email}.
            </p>
          </div>
        )}

        {/* State 6: Authenticated but Not Linked to Member */}
        {user && membershipState === 'unlinked' && (
          <div className="bg-zinc-900/90 border border-amber-800/60 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Account Not Linked to Member</h2>
                <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate max-w-[240px]">
                  {user.email}
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Your Google account is signed in, but it is not linked to a registered builder profile in the club directory.
            </p>

            {requestSubmittedSuccess ? (
              <div className="p-4 rounded-xl bg-[#b5ff00]/10 border border-[#b5ff00]/30 text-xs text-zinc-200 space-y-1">
                <p className="font-bold text-[#b5ff00] flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" />
                  Request Submitted
                </p>
                <p className="text-[11px] text-zinc-400">
                  Please ask an administrator at today's meeting to approve your membership link.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmitLinkRequest} className="space-y-3">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
                  Your Builder Handle or Name
                </label>
                <input
                  type="text"
                  required
                  value={requestedHandle}
                  onChange={(e) => setRequestedHandle(e.target.value)}
                  placeholder="@yourhandle or Full Name"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-[#b5ff00]"
                />
                <button
                  type="submit"
                  disabled={isSubmittingRequest}
                  className="w-full py-2.5 px-4 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Request Membership Link</span>
                </button>
              </form>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-zinc-800/80 gap-2">
              <button
                onClick={refreshProfile}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Check Status</span>
              </button>
              <button
                onClick={signOutUser}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="h-3 w-3" />
                <span>Switch Account</span>
              </button>
            </div>
          </div>
        )}

        {/* State 7: Membership Pending Admin Approval */}
        {user && membershipState === 'pending' && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-5 text-center">
            <div className="inline-flex p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mx-auto">
              <RefreshCw className="h-6 w-6 animate-spin" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Membership Pending Approval</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Your builder profile request for <span className="text-zinc-200 font-mono">{user.email}</span> is awaiting verification by club administrators.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-left text-xs text-zinc-400">
              <p className="font-semibold text-zinc-300">Next Steps:</p>
              <p className="text-[11px] mt-1">
                1. Inform the session host or organizer during the meeting.
                <br />
                2. Once approved in the directory, you will receive an invitation here to accept.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-2">
              <button
                onClick={refreshProfile}
                className="w-full py-2.5 px-4 rounded-xl bg-[#b5ff00] hover:bg-[#a3e600] text-black font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Check Approval Status</span>
              </button>
              <button
                onClick={signOutUser}
                className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}

        {/* State 7B: Approved — Waiting for User Response (Invitation Ready) */}
        {user && membershipState === 'approved_waiting_response' && (
          <div className="bg-zinc-900/90 border border-cyan-500/40 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-5 text-center spatial-card relative overflow-hidden">
            <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-cyan-500 via-[#b5ff00] to-cyan-400" />
            <div className="inline-flex p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mx-auto shadow-lg shadow-cyan-500/10">
              <Sparkles className="h-7 w-7 text-cyan-300 animate-bounce" />
            </div>
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-500/15 border border-cyan-500/30 px-3 py-1 rounded-full inline-block">
                Approved — Waiting for User Response
              </span>
              <h2 className="text-lg font-bold text-white font-display uppercase tracking-tight">
                Membership Invitation Approved!
              </h2>
              <p className="text-xs text-zinc-300 leading-relaxed max-w-sm mx-auto">
                An administrator has approved your membership request for{' '}
                <span className="text-white font-mono font-semibold">{user.email}</span>.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-zinc-950/80 border border-white/10 text-left text-xs space-y-2 neu-inset">
              <div className="flex items-center gap-2 text-cyan-300 font-bold">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>Next Step: Complete Account Activation</span>
              </div>
              <p className="text-[11.5px] text-zinc-300 leading-relaxed">
                Click <strong>Accept Invitation</strong> below to link your Google account UID to the roster, receive your verified builder pass, and enable meeting check-in.
              </p>
            </div>

            {respondError && (
              <div className="p-3 rounded-xl bg-red-950/70 border border-red-500/40 text-red-200 text-xs text-left flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <span>{respondError}</span>
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={handleAcceptOffer}
                disabled={isRespondingToOffer}
                className="w-full py-3 px-4 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] active:scale-[0.99] text-black font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(181,255,0,0.3)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isRespondingToOffer ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-black" />
                ) : (
                  <ShieldCheck className="h-4 w-4 text-black" />
                )}
                <span>Accept Invitation &amp; Activate Pass</span>
              </button>

              <button
                type="button"
                onClick={handleDeclineOffer}
                disabled={isRespondingToOffer}
                className="w-full py-2.5 px-4 rounded-xl bg-[#141720] hover:bg-red-950/50 hover:text-red-300 border border-white/10 text-zinc-400 font-semibold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span>Decline Invitation</span>
              </button>
            </div>

            <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={refreshProfile}
                className="text-zinc-400 hover:text-white flex items-center gap-1.5 cursor-pointer text-[11px]"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={signOutUser}
                className="text-zinc-500 hover:text-red-400 flex items-center gap-1.5 cursor-pointer text-[11px]"
              >
                <LogOut className="h-3 w-3" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}

        {/* State 7C: Declined Membership */}
        {user && membershipState === 'declined' && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-4 text-center">
            <div className="inline-flex p-3 rounded-2xl bg-zinc-800 border border-zinc-700 text-zinc-400 mx-auto">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h2 className="text-base font-bold text-white">Membership Invitation Declined</h2>
            <p className="text-xs text-zinc-400">
              The membership invitation for <span className="text-zinc-200 font-mono">{user.email}</span> was declined. If this was a mistake, you can submit a new request.
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <button
                onClick={() => requestMembershipLink()}
                className="py-2.5 px-4 rounded-xl bg-[#b5ff00] text-black font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
              >
                Re-apply for Membership
              </button>
              <button
                onClick={signOutUser}
                className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}

        {/* State 8: Suspended or Inactive */}
        {user && membershipState === 'suspended' && (
          <div className="bg-zinc-900/90 border border-red-900/60 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-4 text-center">
            <div className="inline-flex p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 mx-auto">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h2 className="text-base font-bold text-white">Account Inactive</h2>
            <p className="text-xs text-zinc-400">
              This account has been flagged as inactive. Please contact club administration to reactivate your builder access.
            </p>
            <button
              onClick={signOutUser}
              className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        )}

        {/* State 9: General Error */}
        {user && membershipState === 'error' && (
          <div className="bg-zinc-900/90 border border-red-900/60 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-4 text-center">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
            <h2 className="text-base font-bold text-white">System Error</h2>
            <p className="text-xs text-red-300">{authError || 'An unexpected error occurred.'}</p>
            <div className="flex gap-2 justify-center pt-2">
              <button
                onClick={refreshProfile}
                className="py-2 px-4 rounded-xl bg-[#b5ff00] text-black font-bold text-xs cursor-pointer"
              >
                Retry
              </button>
              <button
                onClick={signOutUser}
                className="py-2 px-4 rounded-xl bg-zinc-800 text-zinc-200 text-xs cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}
      </m.div>
    </div>
  );
};
