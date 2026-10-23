import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { ModalSheet } from './ModalSheet';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Delete',
  confirmVariant = 'danger',
  onConfirm,
  onClose,
}) => {
  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
      maxWidth="md"
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 sm:flex-initial px-4 py-2.5 text-xs font-semibold text-zinc-300 hover:text-white bg-[#141720] hover:bg-[#191c27] border border-white/10 neu-button rounded-xl transition-colors cursor-pointer min-h-11"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold font-display uppercase tracking-wider rounded-xl transition-all cursor-pointer active:scale-95 min-h-11 ${
              confirmVariant === 'danger'
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                : 'bg-[#b5ff00] hover:bg-[#c6ff24] text-black shadow-[0_0_15px_rgba(181,255,0,0.4)]'
            }`}
          >
            {confirmVariant === 'danger' && <Trash2 className="h-4 w-4" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-3 py-1">
        <p className="text-sm text-zinc-300 leading-relaxed">
          {message}
        </p>
      </div>
    </ModalSheet>
  );
};
