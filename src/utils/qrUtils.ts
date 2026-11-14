import QRCode from 'qrcode';

export interface DecodedQRPayload {
  kind: 'session' | 'member' | 'backup_code' | 'unknown';
  sessionId?: string;
  token?: string;
  sessionCode?: string;
  memberId?: string;
  memberHandle?: string;
  rawText: string;
}

/**
 * Generates a high quality QR Code as a Data URL image.
 */
export async function generateQRCodeDataUrl(
  text: string,
  options?: {
    darkColor?: string;
    lightColor?: string;
    width?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }
): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      width: options?.width || 360,
      margin: 1.5,
      color: {
        dark: options?.darkColor || '#0a0a0c',
        light: options?.lightColor || '#f9fafb',
      },
      errorCorrectionLevel: options?.errorCorrectionLevel || 'M',
    });
  } catch (err) {
    console.error('Failed to generate QR code:', err);
    return '';
  }
}

/**
 * Resolves the canonical base URL for mobile QR code deep-links.
 * Priority:
 * 1. import.meta.env.VITE_PUBLIC_BASE_URL
 * 2. window.location.origin
 */
export function getAppBaseUrl(): string {
  const envUrl = ((import.meta as any).env?.VITE_PUBLIC_BASE_URL || '').trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
}

/**
 * Encodes session check-in deep-link: ${baseUrl}/?s=${sessionId}&t=${token}
 */
export function encodeSessionQRPayload(sessionId: string, token: string): string {
  const base = getAppBaseUrl();
  return `${base}/?s=${encodeURIComponent(sessionId)}&t=${encodeURIComponent(token)}`;
}

/**
 * Encodes door-staff member pass: JSON containing only memberId
 */
export function encodeMemberPassPayload(memberId: string, memberHandle?: string): string {
  return JSON.stringify(memberHandle ? { memberId, memberHandle } : { memberId });
}

/**
 * Downloads a data URL image as a file
 */
export function downloadDataUrlAsImage(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Decodes and standardizes arbitrary scanned QR string or input code
 */
export function parseScannedQR(scanned: string): DecodedQRPayload {
  const trimmed = (scanned || '').trim();
  if (!trimmed) {
    return { kind: 'unknown', rawText: '' };
  }

  // 1. Check for JSON Member Pass (JSON containing memberId)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.memberId && typeof parsed.memberId === 'string') {
        return {
          kind: 'member',
          memberId: parsed.memberId.trim(),
          rawText: trimmed,
        };
      }
      if (parsed.sessionId && parsed.token) {
        return {
          kind: 'session',
          sessionId: String(parsed.sessionId).trim(),
          token: String(parsed.token).trim(),
          rawText: trimmed,
        };
      }
    } catch {
      // Continue to URL / string checks
    }
  }

  // 2. Check for URL deep-link (?s=...&t=...)
  if (trimmed.includes('?s=') || trimmed.includes('&s=') || trimmed.includes('?sessionId=') || trimmed.includes('http://') || trimmed.includes('https://')) {
    try {
      // Attempt URL parse; if relative, prepend a dummy origin for searchParams parsing
      const parseableUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://dummy.local/${trimmed.replace(/^\/+/, '')}`;
      const url = new URL(parseableUrl);

      const s = url.searchParams.get('s') || url.searchParams.get('sessionId');
      const t = url.searchParams.get('t') || url.searchParams.get('token') || url.searchParams.get('checkin');
      const m = url.searchParams.get('m') || url.searchParams.get('memberId');

      if (s && t) {
        return {
          kind: 'session',
          sessionId: s.trim(),
          token: t.trim(),
          rawText: trimmed,
        };
      }

      if (m) {
        return {
          kind: 'member',
          memberId: m.trim(),
          rawText: trimmed,
        };
      }
    } catch {
      // Fall through
    }
  }

  // 3. Check for 8-character backup code (e.g. "ABCD-EFGH" or "ABCDEFGH")
  const cleanCode = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleanCode.length === 8) {
    return {
      kind: 'backup_code',
      token: cleanCode,
      rawText: trimmed,
    };
  }

  // 4. Member ID prefix pattern (mem_...)
  if (trimmed.startsWith('mem_')) {
    return {
      kind: 'member',
      memberId: trimmed,
      rawText: trimmed,
    };
  }

  return {
    kind: 'unknown',
    rawText: trimmed,
  };
}

export { playCheckInChime, playSuccessChime, playWarningChime, playErrorChime } from './audio';
