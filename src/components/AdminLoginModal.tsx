import React from 'react';
import {
  ShieldCheck,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../firebase/AuthContext';
import { ModalSheet } from './ModalSheet';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenManageAdmins?: () => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onOpenManageAdmins,
}) => {
  const { user, linkedMember, isAdmin, isSuperAdmin, signOutUser, handleSignIn, signingIn } = useAuth();

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Account & Access"
      subtitle="Verified identity, permissions, and club authority tier"
      icon={<ShieldCheck className="w-5 h-5 text-[#b5ff00]" />}
      maxWidth="md"
    >
      {user ? (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-[#0e1017]/80 border border-white/5 neu-inset space-y-2.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400">Signed in as:</span>
              <span className="text-white font-bold truncate max-w-[200px]">{user.displayName || user.email}</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400">Email:</span>
              <span className="text-zinc-300 truncate max-w-[200px]">{user.email}</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400">Authority Role:</span>
              <span className={`font-bold uppercase ${isAdmin ? 'text-[#b5ff00]' : 'text-zinc-300'}`}>
                {isSuperAdmin ? 'Super Administrator' : isAdmin ? 'Administrator' : 'Club Member'}
              </span>
            </div>
            {linkedMember && (
              <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-white/5">
                <span className="text-zinc-400">Roster Identity:</span>
                <span className="text-[#b5ff00] font-bold">{linkedMember.name} ({linkedMember.handle})</span>
              </div>
            )}
          </div>

          {!isAdmin && (
            <div className="p-3.5 rounded-2xl bg-zinc-950 border border-white/5 text-xs text-zinc-400 space-y-1">
              <p className="font-semibold text-zinc-200">Standard Member Permissions</p>
              <p className="text-xs leading-relaxed text-zinc-400">
                You can scan kiosk QR codes to check in, view digital passes, and access personal statistics. Administrator privileges are granted and managed by the Super Administrator.
              </p>
            </div>
          )}

          {isSuperAdmin && onOpenManageAdmins && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenManageAdmins();
              }}
              className="w-full py-3 px-4 rounded-xl bg-[#b5ff00]/15 hover:bg-[#b5ff00]/25 text-[#b5ff00] border border-[#b5ff00]/40 text-xs font-bold font-mono uppercase tracking-wider transition-all cursor-pointer min-h-11"
            >
              Manage Administrators →
            </button>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={async () => {
                await signOutUser();
                onClose();
              }}
              className="flex-1 py-3 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-xs text-zinc-300 font-mono transition-colors cursor-pointer flex items-center justify-center gap-2 min-h-11"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-center py-2">
          <p className="text-sm text-zinc-400">
            Sign in with your Google account to access attendance verification and club privileges.
          </p>
          <button
            type="button"
            onClick={async () => {
              const ok = await handleSignIn();
              if (ok) onClose();
            }}
            disabled={signingIn}
            className="w-full py-3.5 px-4 rounded-xl bg-[#b5ff00] hover:bg-[#c6ff24] text-black text-sm font-bold font-display uppercase tracking-wider transition-all cursor-pointer min-h-11 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span>{signingIn ? 'Connecting...' : 'Sign in with Google'}</span>
          </button>
        </div>
      )}
    </ModalSheet>
  );
};
