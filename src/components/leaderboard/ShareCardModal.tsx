import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PublicLeaderboardItem } from '../../types';
import { getTier } from '../../config/tierConfig';
import { X, Download, Share2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { m, AnimatePresence } from 'motion/react';

interface ShareCardModalProps {
  item: PublicLeaderboardItem | null;
  rank?: number;
  isOpen: boolean;
  onClose: () => void;
}

export const ShareCardModal: React.FC<ShareCardModalProps> = ({
  item,
  rank,
  isOpen,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [generating, setGenerating] = useState(true);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const drawCard = useCallback(async () => {
    if (!item || !canvasRef.current) return;
    setGenerating(true);

    const canvas = canvasRef.current;
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Requirement 8: Wait for fonts to be ready before drawing text
    if (typeof document !== 'undefined' && 'fonts' in document) {
      try {
        await document.fonts.ready;
      } catch {
        // Fallback gracefully
      }
    }

    const W = 1080;
    const H = 1350;
    const points = item.totalPoints ?? item.points ?? 0;
    const tier = getTier(points);
    const displayName = item.displayName || item.name;
    const initials = displayName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

    // 1. Deep Near-Black Background (#0a0b0e)
    ctx.fillStyle = '#0a0b0e';
    ctx.fillRect(0, 0, W, H);

    // 2. Cyber Tech Grid Background
    ctx.strokeStyle = 'rgba(255, 106, 0, 0.05)';
    ctx.lineWidth = 1.5;
    const gridSize = 40;
    for (let x = 0; x < W; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // 3. Top and Bottom Neon Radial Vignettes
    const topGrad = ctx.createRadialGradient(W / 2, 0, 50, W / 2, 0, 600);
    topGrad.addColorStop(0, 'rgba(255, 106, 0, 0.25)');
    topGrad.addColorStop(1, 'rgba(10, 11, 14, 0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, 700);

    const bottomGrad = ctx.createRadialGradient(W / 2, H, 50, W / 2, H, 600);
    bottomGrad.addColorStop(0, 'rgba(0, 240, 255, 0.2)');
    bottomGrad.addColorStop(1, 'rgba(10, 11, 14, 0)');
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(0, H - 700, W, 700);

    // 4. Outer Glowing Neon Frame
    const framePad = 48;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(framePad, framePad, W - framePad * 2, H - framePad * 2);

    // Corner Accents
    const cornerSize = 40;
    ctx.strokeStyle = '#FF6A00';
    ctx.lineWidth = 4;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(framePad, framePad + cornerSize);
    ctx.lineTo(framePad, framePad);
    ctx.lineTo(framePad + cornerSize, framePad);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(W - framePad - cornerSize, framePad);
    ctx.lineTo(W - framePad, framePad);
    ctx.lineTo(W - framePad, framePad + cornerSize);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(framePad, H - framePad - cornerSize);
    ctx.lineTo(framePad, H - framePad);
    ctx.lineTo(framePad + cornerSize, H - framePad);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(W - framePad - cornerSize, H - framePad);
    ctx.lineTo(W - framePad, H - framePad);
    ctx.lineTo(W - framePad, H - framePad - cornerSize);
    ctx.stroke();

    // 5. Header: Club Identity
    ctx.fillStyle = '#FF6A00';
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DEN OF BUILDERS // GUILD RANKING', W / 2, 130);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '600 18px Rajdhani, sans-serif';
    ctx.fillText('OFFICIAL PARTICIPATION & ATTENDANCE RECORD', W / 2, 165);

    // 6. Avatar: with fallback to initials if tainted or failed
    const avatarCenterX = W / 2;
    const avatarCenterY = 330;
    const avatarRadius = 110;

    let imageDrawn = false;
    const avatarSrc = item.avatarUrl || item.avatar;
    if (avatarSrc) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = avatarSrc;
          // Set a timeout to prevent hang
          setTimeout(reject, 2500);
        });

        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(
          img,
          avatarCenterX - avatarRadius,
          avatarCenterY - avatarRadius,
          avatarRadius * 2,
          avatarRadius * 2
        );
        ctx.restore();
        imageDrawn = true;
      } catch {
        // Avatar tainted or failed, draw initials instead
        imageDrawn = false;
      }
    }

    if (!imageDrawn) {
      // Draw sleek initials avatar
      ctx.fillStyle = '#141720';
      ctx.beginPath();
      ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 80px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials, avatarCenterX, avatarCenterY);
      ctx.textBaseline = 'alphabetic';
    }

    // Avatar Neon Rim Ring
    ctx.strokeStyle = tier.colorHex;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarRadius + 4, 0, Math.PI * 2);
    ctx.stroke();

    // 7. Builder Name & Handle
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 48px Orbitron, sans-serif';
    ctx.fillText(displayName, W / 2, 510);

    if (item.handle) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '700 26px Rajdhani, sans-serif';
      ctx.fillText(item.handle, W / 2, 550);
    }

    // 8. Tier Pill
    const tierPillY = 600;
    const tierPillW = 320;
    const tierPillH = 50;
    ctx.fillStyle = 'rgba(18, 20, 26, 0.85)';
    ctx.strokeStyle = tier.colorHex;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(W / 2 - tierPillW / 2, tierPillY, tierPillW, tierPillH, 25);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = tier.colorHex;
    ctx.font = '900 24px Orbitron, sans-serif';
    ctx.fillText(`${tier.name.toUpperCase()} TIER`, W / 2, tierPillY + 33);

    // 9. Main Stats Hero Box
    const statBoxY = 690;
    const statBoxW = 860;
    const statBoxH = 260;
    ctx.fillStyle = 'rgba(18, 20, 26, 0.9)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(W / 2 - statBoxW / 2, statBoxY, statBoxW, statBoxH, 28);
    ctx.fill();
    ctx.stroke();

    // Inner columns: Rank, Points, Streak, Check-Ins
    const colCount = 4;
    const colW = statBoxW / colCount;
    const startX = W / 2 - statBoxW / 2;

    const stats = [
      { label: 'GUILD RANK', value: rank ? `#${rank}` : 'Top Builder', color: '#F5C56B' },
      { label: 'TOTAL POINTS', value: `${points}`, color: '#FF7A1A' },
      { label: 'ACTIVE STREAK', value: `${item.currentStreak || 0}`, color: '#2DE2E6' },
      { label: 'CHECK-INS', value: `${item.totalCheckIns || 0}`, color: 'rgba(255, 255, 255, 0.92)' },
    ];

    stats.forEach((s, idx) => {
      const cx = startX + colW * idx + colW / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
      ctx.font = '700 18px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.label, cx, statBoxY + 70);

      ctx.fillStyle = s.color;
      ctx.font = '900 48px Orbitron, sans-serif';
      ctx.fillText(s.value, cx, statBoxY + 150);

      if (idx < colCount - 1) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(startX + colW * (idx + 1), statBoxY + 40);
        ctx.lineTo(startX + colW * (idx + 1), statBoxY + statBoxH - 40);
        ctx.stroke();
      }
    });

    // 10. Achievements Ribbon
    const hasFirstCheckIn = (item.totalCheckIns || 0) >= 1;
    const hasThreeStreak = (item.bestStreak || item.currentStreak || 0) >= 3;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '700 20px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VERIFIED ACHIEVEMENTS', W / 2, 1010);

    const badgeW = 380;
    const badgeH = 70;
    const badgeY = 1040;

    // Badge 1: First Check-In (Aqua)
    const b1X = W / 2 - badgeW - 20;
    ctx.fillStyle = hasFirstCheckIn ? 'rgba(45, 226, 230, 0.12)' : 'rgba(255, 255, 255, 0.03)';
    ctx.strokeStyle = hasFirstCheckIn ? '#2DE2E6' : 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(b1X, badgeY, badgeW, badgeH, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = hasFirstCheckIn ? '#2DE2E6' : 'rgba(255, 255, 255, 0.3)';
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.fillText('FIRST CHECK-IN', b1X + badgeW / 2, badgeY + 42);

    // Badge 2: 3-Streak (Ember)
    const b2X = W / 2 + 20;
    ctx.fillStyle = hasThreeStreak ? 'rgba(255, 122, 26, 0.14)' : 'rgba(255, 255, 255, 0.03)';
    ctx.strokeStyle = hasThreeStreak ? '#FF7A1A' : 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.roundRect(b2X, badgeY, badgeW, badgeH, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = hasThreeStreak ? '#FF7A1A' : 'rgba(255, 255, 255, 0.3)';
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.fillText('3-SESSION STREAK', b2X + badgeW / 2, badgeY + 42);

    // 11. Footer Watermark
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '600 18px Rajdhani, sans-serif';
    ctx.fillText('DEN OF BUILDERS // ATTENDANCE & PARTICIPATION HUB', W / 2, 1220);

    const dateStr = new Date().toISOString().split('T')[0];
    ctx.fillStyle = '#FF7A1A';
    ctx.font = 'bold 16px Orbitron, sans-serif';
    ctx.fillText(`VERIFIED ON ${dateStr}`, W / 2, 1255);

    try {
      const url = canvas.toDataURL('image/png');
      setDataUrl(url);
    } catch (err) {
      console.warn('Canvas export tainted, continuing without dataUrl preview:', err);
    } finally {
      setGenerating(false);
    }
  }, [item, rank]);

  useEffect(() => {
    if (isOpen && item) {
      drawCard();
    }
  }, [isOpen, item, drawCard]);

  const handleDownload = () => {
    if (!dataUrl && canvasRef.current) {
      try {
        const url = canvasRef.current.toDataURL('image/png');
        downloadImage(url);
      } catch {
        // ignore
      }
    } else if (dataUrl) {
      downloadImage(dataUrl);
    }
  };

  const downloadImage = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `dob-guild-card-${item?.handle || item?.name || 'builder'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share && canvasRef.current) {
      try {
        canvasRef.current.toBlob(async (blob) => {
          if (!blob) return;
          const file = new File([blob], 'dob-ranking-card.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: `${item?.displayName || item?.name} - Den of Builders Ranking`,
              text: `Check out my guild attendance and ranking in Den of Builders!`,
              files: [file],
            });
          } else {
            await navigator.share({
              title: `${item?.displayName || item?.name} - Den of Builders Ranking`,
              text: `Check out my guild ranking in Den of Builders!`,
              url: window.location.href,
            });
          }
        }, 'image/png');
      } catch {
        // Share cancelled or unavailable
      }
    } else {
      handleDownload();
    }
  };

  if (!isOpen || !item) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/85 backdrop-blur-md"
        />

        <m.div
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          className="relative w-full max-w-md rounded-3xl bg-[#0e1017]/95 backdrop-blur-xl border border-white/10 shadow-[0_0_50px_rgba(255,122,26,0.18)] glass-card-hairline overflow-hidden z-10 flex flex-col max-h-[95vh]"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between">
            <div>
              <h3 className="font-orbitron font-black text-sm uppercase text-white/92">
                Builder Esports Share Card
              </h3>
              <p className="font-rajdhani text-xs text-white/60">
                1080x1350 High-Res Verified Guild Telemetry
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Card Preview */}
          <div className="p-5 flex-1 overflow-y-auto flex flex-col items-center justify-center bg-black/40">
            <canvas ref={canvasRef} className="hidden" />

            {generating ? (
              <div className="py-20 flex flex-col items-center gap-3 text-zinc-400 font-orbitron text-xs">
                <RefreshCw className="w-7 h-7 text-[#FF7A1A] animate-spin" />
                <span>Synthesizing Cyber Card...</span>
              </div>
            ) : dataUrl ? (
              <div className="relative rounded-2xl overflow-hidden border border-white/15 shadow-[0_0_30px_rgba(0,0,0,0.8)] max-w-[280px] sm:max-w-[320px]">
                <img
                  src={dataUrl}
                  alt="Esports Ranking Share Card"
                  className="w-full h-auto object-contain"
                />
              </div>
            ) : (
              <div className="py-12 text-zinc-500 font-mono text-xs">
                Preview unavailable; click Download below to export image.
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="p-4 sm:p-5 border-t border-white/10 bg-[#0d0f15] flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 font-rajdhani font-bold text-xs uppercase cursor-pointer min-h-11"
            >
              Close
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleNativeShare}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-orbitron font-bold text-xs uppercase flex items-center gap-1.5 cursor-pointer min-h-11"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>

              <button
                type="button"
                onClick={handleDownload}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#FFB36B] via-[#FF7A1A] to-[#FF4D2E] text-black font-orbitron font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_20px_rgba(255,122,26,0.35)] cursor-pointer min-h-11 active:scale-95 border border-white/20"
              >
                <Download className="w-4 h-4 text-black" />
                <span>Download PNG</span>
              </button>
            </div>
          </div>
        </m.div>
      </div>
    </AnimatePresence>
  );
};
