import React, { useEffect, useState } from 'react';
import { QrCode, Flame, Printer, Download, Award } from 'lucide-react';
import { Member } from '../types';
import { generateQRCodeDataUrl, encodeMemberPassPayload, downloadDataUrlAsImage } from '../utils/qrUtils';
import { AttendanceBadges } from './AttendanceBadges';
import { ModalSheet } from './ModalSheet';

interface MemberPassModalProps {
  member: Member | null;
  onClose: () => void;
}

export const MemberPassModal: React.FC<MemberPassModalProps> = ({ member, onClose }) => {
  const [activeTab, setActiveTab] = useState<'pass' | 'badges'>('pass');
  const [qrUrl, setQrUrl] = useState<string>('');

  useEffect(() => {
    if (!member) return;
    const payload = encodeMemberPassPayload(member.id, member.handle);
    generateQRCodeDataUrl(payload, {
      width: 360,
      darkColor: '#0a0a0c',
      lightColor: '#ffffff',
    }).then(setQrUrl);
  }, [member]);

  if (!member) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadQR = () => {
    if (!qrUrl) return;
    const cleanHandle = member.handle.replace(/[^a-zA-Z0-9_-]/g, '');
    downloadDataUrlAsImage(qrUrl, `den-of-builders-pass-${cleanHandle}.png`);
  };

  return (
    <ModalSheet
      isOpen={!!member}
      onClose={onClose}
      title={member.name}
      subtitle={`Official Builder Pass · ${member.handle}`}
      icon={
        <img
          src="/dob_logo-192.png"
          alt="Den of Builders"
          className="w-6 h-6 object-contain"
          width={24}
          height={24}
        />
      }
      maxWidth="md"
      footer={
        <div className="flex flex-wrap sm:flex-nowrap gap-2.5 w-full">
          <button
            type="button"
            onClick={handleDownloadQR}
            className="btn-glossy-secondary flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-full text-zinc-200 hover:text-[#b5ff00] text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-11"
            title="Download QR code image"
          >
            <Download className="h-4 w-4 text-[#b5ff00]" />
            <span>Download</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="btn-glossy-secondary flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-full text-zinc-200 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer min-h-11"
          >
            <Printer className="h-4 w-4 text-zinc-400" />
            <span>Print Pass</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-glossy-primary w-full sm:w-auto px-6 py-2.5 rounded-full text-black text-xs font-bold uppercase tracking-wider text-center cursor-pointer min-h-11"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Tab switcher: Pass vs Badges */}
        <div className="p-1 rounded-2xl bg-black/60 border border-white/5 neu-inset text-xs flex gap-1 font-display">
          <button
            type="button"
            onClick={() => setActiveTab('pass')}
            className={`flex-1 py-2 px-3 rounded-xl font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer font-mono min-h-11 ${
              activeTab === 'pass'
                ? 'bg-[#141720] text-[#b5ff00] border border-[#b5ff00]/30 neu-raised-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <QrCode className="h-4 w-4" />
            <span>Digital Pass</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('badges')}
            className={`flex-1 py-2 px-3 rounded-xl font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer font-mono min-h-11 ${
              activeTab === 'badges'
                ? 'bg-[#141720] text-[#b5ff00] border border-[#b5ff00]/30 neu-raised-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Award className="h-4 w-4" />
            <span>Badges</span>
          </button>
        </div>

        {activeTab === 'pass' ? (
          <div className="space-y-4">
            {/* High Contrast QR Code for Gate Scanning */}
            <div className="flex flex-col items-center">
              <div className="p-4 bg-white rounded-2xl shadow-[0_0_25px_rgba(181,255,0,0.25)] border border-white/40">
                {qrUrl ? (
                  <img
                    src={qrUrl}
                    alt={`${member.name}'s QR Pass`}
                    className="w-48 h-48 sm:w-52 sm:h-52 object-contain"
                    width={208}
                    height={208}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center">
                    <QrCode className="h-12 w-12 text-zinc-400 animate-pulse" />
                  </div>
                )}
              </div>
              <span className="text-xs text-zinc-400 font-mono mt-2 text-center">
                Scan at gate kiosk or host screen to record check-in
              </span>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-2 gap-2 text-center rounded-2xl bg-[#0d0f15] border border-white/5 neu-inset p-3.5">
              <div>
                <span className="text-xs text-zinc-400 block uppercase font-mono">Total Check-ins</span>
                <span className="text-base font-bold font-mono text-zinc-100 tabular-nums">
                  {member.totalCheckIns || 0}
                </span>
              </div>
              <div>
                <span className="text-xs text-zinc-400 block uppercase font-mono">Current Streak</span>
                <span className="text-base font-bold font-mono text-[#b5ff00] tabular-nums flex items-center justify-center gap-1">
                  <Flame className="h-4 w-4" />
                  {member.currentStreak || 0} sessions
                </span>
              </div>
            </div>

            {/* Compact Badges Strip */}
            <div className="rounded-2xl bg-[#0d0f15] border border-white/5 neu-inset p-3.5">
              <AttendanceBadges member={member} mode="compact" />
            </div>
          </div>
        ) : (
          /* Full Badges Tab */
          <div className="space-y-3">
            <AttendanceBadges member={member} mode="full" />
          </div>
        )}
      </div>
    </ModalSheet>
  );
};
