import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  User,
  signInWithPopup,
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
  signInWithGoogle: () => Promise<boolean>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
  refreshProfile: () => Promise<void>;
  submitApplicantNotes: (notes: string) => Promise<void>;
  reRequestAccess: (notes?: string) => Promise<void>;
  requestMembershipLink: (notes?: string) => Promise<void>;
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
  membershipPhase: 'loading',
  membershipState: 'loading',
  isAdmin: false,
  isSuperAdmin: false,
  isApprovedMember: false,
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
    memberUnsubRef.current = onSnapshot(memberRef, (snap) => {
      if (snap.exists()) {
        setLinkedMember(snap.data() as Member);
      } else {
        setLinkedMember(null);
      }
    });

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

  // Resolves user profile and subscribes to real-time status updates
  const attachUserListeners = useCallback(
    async (currentUser: User) => {
      try {
        const adminStatus = await checkIsAdmin(currentUser.uid, currentUser.email);
        setIsAdmin(adminStatus);

        // Ensure user document exists with least privilege
        const initProfile = await ensureUserProfile(
          currentUser.uid,
          currentUser.email || '',
          currentUser.displayName || 'Club Builder',
          currentUser.photoURL || undefined
        );
        setProfile(initProfile);

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
            if (snap.exists()) {
              const updatedProfile = snap.data() as UserProfile;
              setProfile(updatedProfile);

              // Check if admin status changed
              const freshAdmin = await checkIsAdmin(currentUser.uid, currentUser.email);
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
            console.warn('Profile listener error:', err);
            setLoading(false);
          }
        );
      } catch (err: any) {
        console.error('Failed to attach user profile:', err);
        setAuthError(err?.message || 'Failed to initialize account.');
        setLoading(false);
      }
    },
    [loadMemberData]
  );

  // Authentication state watcher
  useEffect(() => {
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
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (profileUnsubRef.current) profileUnsubRef.current();
      if (memberUnsubRef.current) memberUnsubRef.current();
    };
  }, [attachUserListeners, clearAuthError]);

  const signInWithGoogle = async (): Promise<boolean> => {
    setSigningIn(true);
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user) {
        await attachUserListeners(result.user);
        return true;
      }
      return false;
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setAuthError(err?.message || 'Google sign-in failed.');
      }
      return false;
    } finally {
      setSigningIn(false);
    }
  };

  const signOutUser = async (): Promise<void> => {
    try {
      if (profileUnsubRef.current) profileUnsubRef.current();
      if (memberUnsubRef.current) memberUnsubRef.current();
      profileUnsubRef.current = null;
      memberUnsubRef.current = null;

      await signOut(auth);
      setUser(null);
      setProfile(null);
      setLinkedMember(null);
      setMemberPrivate(null);
      setIsAdmin(false);
    } catch (err: any) {
      setAuthError(err?.message || 'Sign out failed.');
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
    }
  };

  const requestMembershipLink = async (notes?: string) => {
    if (!user) return;
    try {
      await requestLink(user.uid, notes);
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to submit membership request.');
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
  if (loading) {
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
    membershipPhase = 'pending';
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
        membershipPhase,
        membershipState: membershipPhase,
        isAdmin,
        isSuperAdmin,
        isApprovedMember,
        signInWithGoogle,
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
