import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  User,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, googleProvider } from './authClient';
import { SUPER_ADMIN_EMAIL } from '../config/constants';
import type { Member, MemberPrivate, UserProfile } from '../types';
import { captureAndStoreDeepLink } from '../utils/deepLink';
import { singleFlight } from '../utils/singleFlight';
import { ApplicationInput, isApplicationSubmitted } from '../utils/application';
import { getUserState } from '../utils/userStateMachine';
import { resolveAuthFirestoreLoadFailure } from './lazyFirestore';
import { formatUserFriendlyFirestoreError } from '../utils/firestoreErrors';
import { formatAuthSignInError } from '../utils/authErrors';

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
  | 'deactivated'
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
  submitApplicationForm: (application: import('../utils/application').ApplicationInput) => Promise<void>;
  reRequestAccess: (appOrNotes?: import('../utils/application').ApplicationInput | string) => Promise<void>;
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
  submitApplicationForm: async () => {},
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
  const privateUnsubRef = useRef<(() => void) | null>(null);

  const activeMemberIdRef = useRef<string | null>(null);
  const memberLoadSeqRef = useRef(0);

  // Capture any incoming deep link params (?s=...&t=...) immediately on load
  useEffect(() => {
    captureAndStoreDeepLink();
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  // Loads linked member profile and private data in real time (lazy-loading Firestore SDK on demand)
  const loadMemberData = useCallback(async (memberId: string) => {
    activeMemberIdRef.current = memberId;
    const seq = ++memberLoadSeqRef.current;
    if (memberUnsubRef.current) {
      memberUnsubRef.current();
      memberUnsubRef.current = null;
    }
    if (privateUnsubRef.current) {
      privateUnsubRef.current();
      privateUnsubRef.current = null;
    }

    let firestoreModule: typeof import('firebase/firestore');
    let configModule: typeof import('./config');
    try {
      [firestoreModule, configModule] = await Promise.all([
        import('firebase/firestore'),
        import('./config'),
      ]);
    } catch (err) {
      if (seq !== memberLoadSeqRef.current) return;
      const failure = resolveAuthFirestoreLoadFailure(err);
      setAuthError(failure.authError);
      return;
    }
    if (seq !== memberLoadSeqRef.current) return;
    const { doc, onSnapshot } = firestoreModule;
    const { db } = configModule;

    const memberRef = doc(db, 'members', memberId);
    memberUnsubRef.current = onSnapshot(
      memberRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Member;
          setLinkedMember((prev) => ({
            ...data,
            id: snap.id || data.id,
            // Keep any real-time private attributes merged in
            studentId: data.studentId || prev?.studentId,
            phone: data.phone || prev?.phone,
            university: data.university || prev?.university,
            department: data.department || prev?.department,
            major: data.major || prev?.major,
            semester: data.semester || prev?.semester,
            profileCompleted: data.profileCompleted || prev?.profileCompleted,
          }));
        } else {
          setLinkedMember(null);
        }
      },
      (err) => {
        console.warn('Member profile subscription notice:', err);
      }
    );

    const privRef = doc(db, 'memberPrivate', memberId);
    privateUnsubRef.current = onSnapshot(
      privRef,
      (privSnap) => {
        if (privSnap.exists()) {
          const pData = privSnap.data() as MemberPrivate;
          setMemberPrivate(pData);
          setLinkedMember((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              studentId: pData.studentId || prev.studentId,
              phone: pData.phone || prev.phone,
              university: pData.university || prev.university,
              department: pData.department || prev.department,
              major: pData.major || prev.major,
              semester: pData.semester || prev.semester,
              profileCompleted: pData.profileCompleted ?? prev.profileCompleted,
            };
          });
        } else {
          setMemberPrivate(null);
        }
      },
      (err) => {
        console.warn('Member private subscription notice:', err);
        setMemberPrivate(null);
      }
    );
  }, []);

  // Resolves user profile and subscribes to real-time status updates using singleFlight deduplication
  const attachUserListeners = useCallback(
    async (currentUser: User) => {
      return singleFlight(currentUser.uid, async () => {
        try {
          const [{ doc, onSnapshot }, { db }, { checkIsAdmin, ensureUserProfile }] = await Promise.all([
            import('firebase/firestore'),
            import('./config'),
            import('./firestoreService'),
          ]);

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
            const errorMsg = formatUserFriendlyFirestoreError(
              ensureErr,
              'We could not register your request. Please try again or contact an admin.'
            );
            setRegistrationError({ code, message: errorMsg });
            setAuthError(errorMsg);
            setLoading(false);
            return;
          }

          if (initProfile.memberId) {
            void loadMemberData(initProfile.memberId);
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
                const updatedProfile = { id: snap.id, ...(snap.data() as any) } as UserProfile;
                setProfile(updatedProfile);

                // Check if admin status changed
                const freshAdmin = await checkIsAdmin(currentUser.uid, currentUser.email);
                if (auth.currentUser?.uid !== currentUser.uid) return;
                setIsAdmin(freshAdmin);

                if (updatedProfile.memberId) {
                  if (activeMemberIdRef.current !== updatedProfile.memberId) {
                    void loadMemberData(updatedProfile.memberId);
                  }
                } else {
                  activeMemberIdRef.current = null;
                  memberLoadSeqRef.current += 1;
                  if (memberUnsubRef.current) {
                    memberUnsubRef.current();
                    memberUnsubRef.current = null;
                  }
                  if (privateUnsubRef.current) {
                    privateUnsubRef.current();
                    privateUnsubRef.current = null;
                  }
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
                message: formatUserFriendlyFirestoreError(
                  err,
                  'Unable to sync user profile. Please check permissions or contact an admin.'
                ),
              });
              setLoading(false);
            }
          );
        } catch (err: any) {
          if (auth.currentUser?.uid !== currentUser.uid) return;
          console.error('Failed to attach user profile:', err);
          const failure = resolveAuthFirestoreLoadFailure(err);
          setRegistrationError(failure.registrationError);
          setAuthError(failure.authError);
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
        const friendly = formatAuthSignInError(err);
        if (friendly) {
          setAuthError(friendly);
        }
      });

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      clearAuthError();

      if (currentUser) {
        await attachUserListeners(currentUser);
      } else {
        // Sign-out cleanup
        activeMemberIdRef.current = null;
        if (profileUnsubRef.current) profileUnsubRef.current();
        if (memberUnsubRef.current) memberUnsubRef.current();
        if (privateUnsubRef.current) privateUnsubRef.current();
        profileUnsubRef.current = null;
        memberUnsubRef.current = null;
        privateUnsubRef.current = null;
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
      if (privateUnsubRef.current) privateUnsubRef.current();
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
          const friendlyRedirect = formatAuthSignInError(redirectErr);
          if (friendlyRedirect) {
            setAuthError(friendlyRedirect);
          }
          return false;
        }
      }

      const friendly = formatAuthSignInError(err);
      if (friendly) {
        setAuthError(friendly);
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
      if (privateUnsubRef.current) privateUnsubRef.current();
      profileUnsubRef.current = null;
      memberUnsubRef.current = null;
      privateUnsubRef.current = null;

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
      activeMemberIdRef.current = null;
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
      const { updateUserSelfProfile } = await import('./firestoreService');
      await updateUserSelfProfile(user.uid, { requestedNotes: notes });
    } catch (err: any) {
      setAuthError(formatUserFriendlyFirestoreError(err, 'Failed to update notes.'));
      throw err;
    }
  };

  const submitApplicationForm = async (application: ApplicationInput) => {
    if (!user) return;
    try {
      const { submitApplication } = await import('./firestoreService');
      await submitApplication(user.uid, application);
    } catch (err: any) {
      setAuthError(formatUserFriendlyFirestoreError(err, 'Failed to submit application.'));
      throw err;
    }
  };

  const reRequestAccess = async (appOrNotes?: ApplicationInput | string) => {
    if (!user) return;
    try {
      const { reRequestMembership } = await import('./firestoreService');
      await reRequestMembership(user.uid, appOrNotes);
    } catch (err: any) {
      setAuthError(formatUserFriendlyFirestoreError(err, 'Failed to re-submit membership request.'));
      throw err;
    }
  };

  const requestMembershipLink = async (notes?: string, displayName?: string) => {
    if (!user) return;
    try {
      const { requestMembershipLink: requestLink } = await import('./firestoreService');
      await requestLink(user.uid, notes, displayName);
    } catch (err: any) {
      setAuthError(formatUserFriendlyFirestoreError(err, 'Failed to submit membership request.'));
      throw err;
    }
  };

  const acceptMembershipInvitation = async () => {
    if (!user) return;
    try {
      const { acceptMembershipInvitation: acceptOffer } = await import('./firestoreService');
      await acceptOffer(user.uid);
    } catch (err: any) {
      setAuthError(formatUserFriendlyFirestoreError(err, 'Failed to accept membership invitation.'));
      throw err;
    }
  };

  const declineMembershipInvitation = async () => {
    if (!user) return;
    try {
      const { declineMembershipInvitation: declineOffer } = await import('./firestoreService');
      await declineOffer(user.uid);
    } catch (err: any) {
      setAuthError(formatUserFriendlyFirestoreError(err, 'Failed to decline membership invitation.'));
      throw err;
    }
  };

  const isSuperAdmin = Boolean(
    user?.email &&
    user.emailVerified &&
    user.email.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase().trim()
  );

  // Derive authoritative phase state machine using pure state machine helper
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
  } else {
    const userState = getUserState(profile, linkedMember);
    if (userState === 'active') {
      membershipPhase = 'active';
    } else if (userState === 'approved_waiting') {
      membershipPhase = 'approved_waiting_response';
    } else if (userState === 'suspended') {
      membershipPhase = 'suspended';
    } else if (userState === 'declined') {
      membershipPhase = 'declined';
    } else if (userState === 'deactivated') {
      membershipPhase = 'deactivated';
    } else {
      // unlinked or pending: check whether user actually submitted the form
      if (!isApplicationSubmitted(profile)) {
        membershipPhase = 'unlinked';
      } else {
        membershipPhase = 'pending';
      }
    }
  }

  const isApprovedMember = Boolean(
    profile?.status === 'active' &&
    profile?.memberId &&
    linkedMember &&
    linkedMember.status !== 'Inactive'
  );

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
        submitApplicationForm,
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
