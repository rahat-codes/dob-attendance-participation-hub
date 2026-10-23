import { TOKEN_ALPHABET, TOKEN_LENGTH } from '../config/constants';

/**
 * Generates a cryptographically random token from an unambiguous alphabet (no 0/O/1/I/L).
 */
export function generateSecureToken(length: number = TOKEN_LENGTH): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for non-browser environments / tests
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let result = '';
  for (let i = 0; i < length; i++) {
    result += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return result;
}

/**
 * Formats an 8-character token as ABCD-EFGH for human-readable backup code display.
 */
export function formatBackupCode(token: string): string {
  const cleaned = (token || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleaned.length === 8) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
  }
  return cleaned;
}

/**
 * Normalizes user-entered backup code (removes hyphens, spaces, and uppercases).
 */
export function normalizeTokenInput(input: string): string {
  return (input || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
