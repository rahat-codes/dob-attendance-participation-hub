import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  User,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider } from './config';
import { Member, MemberPrivate, UserProfile, UserStatus } from '../types';
import {
  ensureUserProfile,
  checkIsAdmin,
  SUPER_ADMIN_EMAIL,
  reRequestMembership,
  updateUserSelfProfile,
  acceptMembershipInvitation as acceptOffer,
  declineMembershipInvitation as declineOffer,
  requestMembershipLink as requestLink,
} from './firestoreService';
import { captureAndStoreDeepLink } from '../utils/deepLink';
import { singleFlight } from '../utils/singleFlight';

export type MembershipPhase =
  | 'loading'
  | 'signed_out'
  | 'not_authenticated'
  | 'signing_in'
  | 'loading_profile'
  | 'unlinked'
  | 'pending'
  | 'approved_waiting_response'
  | 'active'
  | 'declined'
  | 'suspended'
  | 'error';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  linkedMember: Member | null;
  memberPrivate: MemberPrivate | null;
  loading: boolean;
  signingIn: boolean;
  authError: string | null;
  membershipPhase: MembershipPhase;
  membershipState: MembershipPhase;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isApprovedMember: boolean;
  registrationError: { code: string; message: string } | null;
  retryRegistration: () => Promise<void>;
  handleSignIn: () => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
  refreshProfile: () => Promise<void>;
  submitApplicantNotes: (notes: string) => Promise<void>;
  reRequestAccess: (notes?: string) => Promise<void>;
  requestMembershipLink: (notes?: string, displayName?: string) => Promise<void>;
  acceptMembershipInvitation: () => Promise<void>;
  declineMembershipInvitation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  linkedMember: null,
  memberPrivate: null,
  loading: true,
  signingIn: false,
  authError: null,
  registrationError: null,
  retryRegistration: async () => {},
  membershipPhase: 'loading',
  membershipState: 'loading',
  isAdmin: false,
  isSuperAdmin: false,
  isApprovedMember: false,
  handleSignIn: async () => false,
  signInWithGoogle: async () => false,
  signOutUser: async () => {},
  clearAuthError: () => {},
  refreshProfile: async () => {},
  submitApplicantNotes: async () => {},
  reRequestAccess: async () => {},
  requestMembershipLink: async () => {},
  acceptMembershipInvitation: async () => {},
  declineMembershipInvitation: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [linkedMember, setLinkedMember] = useState<Member | null>(null);
  const [memberPrivate, setMemberPrivate] = useState<MemberPrivate | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [registrationError, setRegistrationError] = useState<{ code: string; message: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const profileUnsubRef = useRef<(() => void) | null>(null);
  const memberUnsubRef = useRef<(() => void) | null>(null);

  // Capture any incoming deep link params (?s=...&t=...) immediately on load
  useEffect(() => {
    captureAndStoreDeepLink();
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  // Loads linked member profile and private data
  const loadMemberData = useCallback(async (memberId: string) => {
    if (memberUnsubRef.current) {
      memberUnsubRef.current();
      memberUnsubRef.current = null;
    }

    const memberRef = doc(db, 'members', memberId);
    memberUnsubRef.current = onSnapshot(
      memberRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Member;
          setLinkedMember({
            ...data,
            id: snap.id || data.id,
          });
        } else {
          setLinkedMember(null);
        }
      },
      (err) => {
        console.warn('Member profile subscription notice:', err);
      }
    );

    try {
      const privRef = doc(db, 'memberPrivate', memberId);
      const privSnap = await getDoc(privRef);
      if (privSnap.exists()) {
        setMemberPrivate(privSnap.data() as MemberPrivate);
      } else {
        setMemberPrivate(null);
      }
    } catch {
      setMemberPrivate(null);
    }
  }, []);

  // Resolves user profile and subscribes to real-time status updates using singleFlight deduplication
  const attachUserListeners = useCallback(
    async (currentUser: User) => {
      return singleFlight(currentUser.uid, async () => {
        try {
          const adminStatus = await checkIsAdmin(currentUser.uid, currentUser.email);
          if (auth.currentUser?.uid !== currentUser.uid) return;
          setIsAdmin(adminStatus);

          let initProfile: UserProfile;
          try {
            // Ensure user document exists with least privilege and idempotent create-first
            initProfile = await ensureUserProfile(
              currentUser.uid,
              currentUser.email || '',
              currentUser.displayName || 'Club Builder',
              currentUser.photoURL || undefined
            );
            if (auth.currentUser?.uid !== currentUser.uid) return;
            setProfile(initProfile);
            setRegistrationError(null);
          } catch (ensureErr: any) {
            if (auth.currentUser?.uid !== currentUser.uid) return;
            console.error('Failed to register/ensure user profile:', ensureErr);
            const code = ensureErr?.code || (ensureErr?.message?.includes('permission-denied') ? 'permission-denied' : 'registration-failed');
            const errorMsg = `We could not register your request: [${code}]. Please try again or contact an admin.`;
            setRegistrationError({ code, message: errorMsg });
            setAuthError(errorMsg);
            setLoading(false);
            return;
          }

          if (initProfile.memberId) {
            loadMemberData(initProfile.memberId);
          }

          // Real-time listener for user profile
          if (profileUnsubRef.current) {
            profileUnsubRef.current();
          }

          const userRef = doc(db, 'users', currentUser.uid);
          profileUnsubRef.current = onSnapshot(
            userRef,
            async (snap) => {
              if (auth.currentUser?.uid !== currentUser.uid) return;
              if (snap.exists()) {
                const updatedProfile = snap.data() as UserProfile;
                setProfile(updatedProfile);

                // Check if admin status changed
                const freshAdmin = await checkIsAdmin(currentUser.uid, currentUser.email);
                if (auth.currentUser?.uid !== currentUser.uid) return;
                setIsAdmin(freshAdmin);

                if (updatedProfile.memberId) {
                  loadMemberData(updatedProfile.memberId);
                } else {
                  setLinkedMember(null);
                  setMemberPrivate(null);
                }
              }
              setLoading(false);
            },
            (err) => {
              if (auth.currentUser?.uid !== currentUser.uid) return;
              console.warn('Profile listener error:', err);
              const code = (err as any)?.code || (err?.message?.includes('permission-denied') ? 'permission-denied' : 'listener-error');
              setRegistrationError({
                code,
                message: `Unable to sync user profile [${code}]. Please check permissions or contact an admin.`,
              });
              setLoading(false);
            }
          );
        } catch (err: any) {
          if (auth.currentUser?.uid !== currentUser.uid) return;
          console.error('Failed to attach user profile:', err);
          setAuthError(err?.message || 'Failed to initialize account.');
          setLoading(false);
        }
      });
    },
    [loadMemberData]
  );

  const retryRegistration = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setRegistrationError(null);
    setAuthError(null);
    await attachUserListeners(user);
  }, [user, attachUserListeners]);

  // Authentication state watcher and redirect result handler
  useEffect(() => {
    // Check if returning from a mobile redirect sign-in flow (only reports errors; onAuthStateChanged handles attach)
    getRedirectResult(auth)
      .then((_result) => {
        // onAuthStateChanged is the authoritative listener attacher
      })
      .catch((err: any) => {
        console.error('Redirect sign-in error detail:', err);
        const code = err?.code || '';
        if (code === 'auth/popup-closed-by-user') {
          return;
        }
        if (code === 'auth/network-request-failed') {
          setAuthError('Network error connecting to sign-in service. Please check your connection.');
        } else if (code === 'auth/unauthorized-domain') {
          setAuthError('This domain is not authorized for authentication. Please contact an admin.');
        } else {
          setAuthError("Sign-in isn't available on this address; contact an admin");
        }
      });

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      clearAuthError();

      if (currentUser) {
        await attachUserListeners(currentUser);
      } else {
        // Sign-out cleanup
        if (profileUnsubRef.current) profileUnsubRef.current();
        if (memberUnsubRef.current) memberUnsubRef.current();
        profileUnsubRef.current = null;
        memberUnsubRef.current = null;
        setProfile(null);
        setLinkedMember(null);
        setMemberPrivate(null);
        setIsAdmin(false);
        setRegistrationError(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (profileUnsubRef.current) profileUnsubRef.current();
      if (memberUnsubRef.current) memberUnsubRef.current();
    };
  }, [attachUserListeners, clearAuthError]);

  const handleSignIn = useCallback(async (): Promise<boolean> => {
    setSigningIn(true);
    setAuthError(null);
    try {
      // Call signInWithPopup DIRECTLY with NO await or async work before it
      const result = await signInWithPopup(auth, googleProvider);
      return Boolean(result.user);
    } catch (err: any) {
      const code = err?.code || '';
      console.error('Sign-in error detail:', code, err);

      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/user-cancelled'
      ) {
        // User closed the popup window; never trigger redirect or display error
        return false;
      }

      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        // Fall back to redirect ONLY when popup is blocked or unsupported
        try {
          await signInWithRedirect(auth, googleProvider);
          return true;
        } catch (redirectErr: any) {
          console.error('Redirect sign-in error detail:', redirectErr);
          const redirectCode = redirectErr?.code || '';
          if (
            redirectCode === 'auth/popup-closed-by-user' ||
            redirectCode === 'auth/cancelled-popup-request' ||
            redirectCode === 'auth/user-cancelled'
          ) {
            return false;
          }
          if (redirectCode === 'auth/network-request-failed') {
            setAuthError('Network error connecting to sign-in service. Please check your connection and try again.');
          } else if (redirectCode === 'auth/unauthorized-domain') {
            setAuthError('This domain is not authorized for authentication. Please contact an admin.');
          } else {
            setAuthError("Sign-in isn't available on this address; contact an admin");
          }
          return false;
        }
      }

      if (code === 'auth/network-request-failed') {
        setAuthError('Network error connecting to sign-in service. Please check your connection and try again.');
      } else if (code === 'auth/unauthorized-domain') {
        setAuthError('This domain is not authorized for authentication. Please contact an admin.');
      } else {
        setAuthError("Sign-in isn't available on this address; contact an admin");
      }
      return false;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOutUser = async (): Promise<void> => {
    try {
      if (profileUnsubRef.current) profileUnsubRef.current();
      if (memberUnsubRef.current) memberUnsubRef.current();
      profileUnsubRef.current = null;
      memberUnsubRef.current = null;

      await signOut(auth);
    } catch (err: any) {
      console.warn('Sign out warning:', err);
    } finally {
      setUser(null);
      setProfile(null);
      setLinkedMember(null);
      setMemberPrivate(null);
      setIsAdmin(false);
      setAuthError(null);
      setRegistrationError(null);
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await attachUserListeners(user);
    }
  };

  const submitApplicantNotes = async (notes: string) => {
    if (!user) return;
    try {
      await updateUserSelfProfile(user.uid, { requestedNotes: notes });
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to update notes.');
    }
  };

  const reRequestAccess = async (notes?: string) => {
    if (!user) return;
    try {
      await reRequestMembership(user.uid, notes);
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to re-submit membership request.');
      throw err;
    }
  };

  const requestMembershipLink = async (notes?: string, displayName?: string) => {
    if (!user) return;
    try {
      await requestLink(user.uid, notes, displayName);
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to submit membership request.');
      throw err;
    }
  };

  const acceptMembershipInvitation = async () => {
    if (!user) return;
    try {
      await acceptOffer(user.uid);
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to accept membership invitation.');
      throw err;
    }
  };

  const declineMembershipInvitation = async () => {
    if (!user) return;
    try {
      await declineOffer(user.uid);
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to decline membership invitation.');
      throw err;
    }
  };

  const isSuperAdmin =
    Boolean(user?.email && user.email.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim());

  // Derive authoritative phase state machine
  let membershipPhase: MembershipPhase = 'loading';
  if (registrationError) {
    membershipPhase = 'error';
  } else if (loading) {
    membershipPhase = 'loading';
  } else if (!user) {
    membershipPhase = 'signed_out';
  } else if (!profile) {
    membershipPhase = 'loading_profile';
  } else if (isAdmin) {
    membershipPhase = 'active'; // Administrators have active hub access
  } else if (profile.status === 'active') {
    membershipPhase = 'active';
  } else if (profile.status === 'approved_waiting_response') {
    membershipPhase = 'approved_waiting_response';
  } else if (profile.status === 'suspended') {
    membershipPhase = 'suspended';
  } else if (profile.status === 'declined') {
    membershipPhase = 'declined';
  } else {
    // If pending, check if unlinked (user has not submitted a requested handle/notes yet)
    if (!profile.requestedNotes || !profile.requestedNotes.trim()) {
      membershipPhase = 'unlinked';
    } else {
      membershipPhase = 'pending';
    }
  }

  const isApprovedMember = Boolean(profile?.status === 'active' && profile?.memberId);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        linkedMember,
        memberPrivate,
        loading,
        signingIn,
        authError,
        registrationError,
        retryRegistration,
        membershipPhase,
        membershipState: membershipPhase,
        isAdmin,
        isSuperAdmin,
        isApprovedMember,
        handleSignIn,
        signInWithGoogle: handleSignIn,
        signOutUser,
        clearAuthError,
        refreshProfile,
        submitApplicantNotes,
        reRequestAccess,
        requestMembershipLink,
        acceptMembershipInvitation,
        declineMembershipInvitation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
