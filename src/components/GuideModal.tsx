import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Check,
  Copy,
  Globe,
  Radio,
  QrCode,
  Users,
  Calendar,
} from 'lucide-react';
import { getAppBaseUrl } from '../utils/qrUtils';
import { ModalSheet } from './ModalSheet';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenKiosk: () => void;
  onOpenScanner: () => void;
  isAdmin?: boolean;
  onOpenAdminLogin?: () => void;
}

export const GuideModal: React.FC<GuideModalProps> = ({
  isOpen,
  onClose,
  onOpenKiosk,
  onOpenScanner,
  isAdmin = false,
  onOpenAdminLogin,
}) => {
  const [activeTab, setActiveTab] = useState<'launch' | 'workflows' | 'exports'>('launch');
  const [copiedLink, setCopiedLink] = useState(false);

  const activeAppUrl = getAppBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : '');

  const handleCopyLink = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(activeAppUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  return (
    <ModalSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Club Operations & Guide"
      subtitle="How to publish, share with members, and run club check-ins"
      icon={
        <img
          src="/dob_logo-192.png"
          alt="Den of Builders"
          className="w-6 h-6 object-contain shrink-0"
          width={24}
          height={24}
        />
      }
      maxWidth="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-zinc-400 font-mono">
            Den of Builders Hub
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-11"
          >
            Close Guide
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Tab Navigation */}
        <div className="flex gap-2 p-1 bg-black/40 rounded-2xl border border-white/5 neu-inset overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('launch')}
            className={`flex-1 py-2 px-3 rounded-xl font-bold uppercase tracking-wider transition-all cursor-pointer font-mono text-xs whitespace-nowrap min-h-11 ${
              activeTab === 'launch'
                ? 'bg-[#141720] text-[#b5ff00] border border-[#b5ff00]/30 neu-raised-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Publish &amp; Share
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('workflows')}
            className={`flex-1 py-2 px-3 rounded-xl font-bold uppercase tracking-wider transition-all cursor-pointer font-mono text-xs whitespace-nowrap min-h-11 ${
              activeTab === 'workflows'
                ? 'bg-[#141720] text-[#b5ff00] border border-[#b5ff00]/30 neu-raised-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Check-In Flow
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('exports')}
            className={`flex-1 py-2 px-3 rounded-xl font-bold uppercase tracking-wider transition-all cursor-pointer font-mono text-xs whitespace-nowrap min-h-11 ${
              activeTab === 'exports'
                ? 'bg-[#141720] text-[#b5ff00] border border-[#b5ff00]/30 neu-raised-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            CSV Exports
          </button>
        </div>

        {/* Tab 1: Launch */}
        {activeTab === 'launch' && (
          <div className="space-y-4 text-xs text-zinc-300">
            <div className="rounded-2xl glass-panel p-4 sm:p-5 space-y-3 border border-[#b5ff00]/40">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white uppercase font-display text-sm flex items-center gap-2">
                  <Globe className="w-4 h-4 text-[#b5ff00]" />
                  <span>Public Club Hub URL</span>
                </span>
                <span className="text-xs text-[#b5ff00] font-mono font-semibold">Active &amp; Ready</span>
              </div>
              <div className="p-3 bg-black/60 rounded-xl border border-white/10 flex items-center justify-between gap-2 overflow-x-auto">
                <span className="font-mono text-xs text-zinc-200 truncate select-all">{activeAppUrl}</span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b5ff00] text-black font-bold font-mono text-xs shrink-0 cursor-pointer hover:bg-[#c4ff26] min-h-11"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-2xl bg-zinc-950 border border-white/5 space-y-2">
                <div className="flex items-center gap-2 text-white font-bold text-xs">
                  <Radio className="w-4 h-4 text-[#b5ff00]" />
                  <span>1. Launch Kiosk</span>
                </div>
                <p className="text-zinc-400 text-xs leading-relaxed">
                  Open the Live Kiosk tab on a meeting room projector, monitor, or tablet. The kiosk automatically rotates encrypted tokens every 45s.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenKiosk();
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-[#b5ff00] font-mono text-xs font-bold border border-white/10 transition-colors cursor-pointer min-h-11 mt-1"
                >
                  Open Kiosk Tab →
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-950 border border-white/5 space-y-2">
                <div className="flex items-center gap-2 text-white font-bold text-xs">
                  <QrCode className="w-4 h-4 text-[#b5ff00]" />
                  <span>2. Builders Check-In</span>
                </div>
                <p className="text-zinc-400 text-xs leading-relaxed">
                  Builders scan the screen with their phone camera or with the in-app scanner. Attendance verifies instantly with sound &amp; streak tracking.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenScanner();
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-[#b5ff00] font-mono text-xs font-bold border border-white/10 transition-colors cursor-pointer min-h-11 mt-1"
                >
                  Launch Scanner →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Workflows */}
        {activeTab === 'workflows' && (
          <div className="space-y-3 text-xs text-zinc-300">
            <div className="rounded-2xl p-4 bg-[#0d0f15] border border-white/5 neu-inset space-y-1.5">
              <span className="font-bold uppercase text-[#b5ff00] font-mono block text-xs">
                1. Phone Camera Direct Deep-Link Check-In
              </span>
              <p className="text-zinc-400 leading-relaxed text-xs">
                Members don&apos;t need to install any app. Pointing standard camera at the kiosk QR opens the deep-link. If authenticated, check-in completes automatically within seconds.
              </p>
            </div>

            <div className="rounded-2xl p-4 bg-[#0d0f15] border border-white/5 neu-inset space-y-1.5">
              <span className="font-bold uppercase text-[#b5ff00] font-mono block text-xs">
                2. 8-Character Backup Code
              </span>
              <p className="text-zinc-400 leading-relaxed text-xs">
                If a member&apos;s camera is unavailable, the kiosk displays an 8-character backup code (e.g. <span className="font-mono text-white">ABCD-EFGH</span>) that members can enter directly in the scanner modal.
              </p>
            </div>

            <div className="rounded-2xl p-4 bg-[#0d0f15] border border-white/5 neu-inset space-y-1.5">
              <span className="font-bold uppercase text-[#b5ff00] font-mono block text-xs">
                3. Door Staff Manual Verification
              </span>
              <p className="text-zinc-400 leading-relaxed text-xs">
                Organizers can scan member passes from the kiosk or check in builders directly from the session roster with recorded audit trail logging.
              </p>
            </div>
          </div>
        )}

        {/* Tab 3: Exports */}
        {activeTab === 'exports' && (
          <div className="space-y-3 text-xs text-zinc-300">
            <div className="rounded-2xl p-4 bg-[#0d0f15] border border-white/5 neu-inset space-y-2">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <FileSpreadsheet className="h-4 w-4 text-[#b5ff00]" />
                <span>Secure Spreadsheet Exporting</span>
              </div>
              <p className="text-zinc-400 leading-relaxed text-xs">
                All CSV exports include UTF-8 Byte Order Marks (BOM) so Korean builder names open correctly in Microsoft Excel, and implement formula injection protection.
              </p>
              <div className="pt-2 space-y-2 text-xs text-zinc-400 font-mono">
                <p>&bull; <strong className="text-zinc-200">Session Attendance CSV:</strong> Available on Sessions &amp; Kiosk views.</p>
                <p>&bull; <strong className="text-zinc-200">Builder Roster CSV:</strong> Available in the Builders tab (includes private contact data for administrators).</p>
                <p>&bull; <strong className="text-zinc-200">Monthly Participation CSV:</strong> Available in the Monthly Participation tab.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalSheet>
  );
};
