/**
 * Normalization, validation, and sanitization utilities for builder social & portfolio links.
 * Enforces strict HTTPS, canonical URLs, and prevents dangerous schemes (javascript:, data:).
 */

export interface LinkValidationResult {
  valid: boolean;
  canonicalUrl?: string;
  error?: string;
}

/**
 * Normalizes and validates a GitHub profile input.
 * Allowed formats: "user", "@user", "github.com/user", "https://github.com/user".
 * Username rules: 1-39 alphanumeric/hyphen characters, cannot start or end with a hyphen.
 */
export function normalizeGitHubUrl(input?: string): LinkValidationResult {
  if (!input || !input.trim()) {
    return { valid: false, error: 'GitHub profile URL is required.' };
  }

  const clean = input.trim().replace(/^@/, '');

  // Check for dangerous protocols
  if (/^(javascript|data|vbscript|file):/i.test(clean)) {
    return { valid: false, error: 'Invalid URL protocol.' };
  }

  // Extract username
  let username = clean;
  const match = clean.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)\/?$/i);
  if (match) {
    username = match[1];
  } else if (/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(username)) {
    // Valid standalone username
  } else {
    return {
      valid: false,
      error: 'Please enter a valid GitHub username or URL (e.g. github.com/username).',
    };
  }

  return {
    valid: true,
    canonicalUrl: `https://github.com/${username}`,
  };
}

/**
 * Normalizes and validates a LinkedIn profile input.
 * Allowed formats: "in/slug", "slug", "linkedin.com/in/slug", "https://www.linkedin.com/in/slug".
 * Slug rules: 3-100 characters of alphanumeric, hyphens, underscores, or URL-encoded symbols.
 */
export function normalizeLinkedInUrl(input?: string): LinkValidationResult {
  if (!input || !input.trim()) {
    return { valid: false, error: 'LinkedIn profile URL is required.' };
  }

  const clean = input.trim();

  // Check for dangerous protocols
  if (/^(javascript|data|vbscript|file):/i.test(clean)) {
    return { valid: false, error: 'Invalid URL protocol.' };
  }

  let slug = clean;
  const match = clean.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([a-zA-Z0-9_%-]{3,100})\/?/i);
  if (match) {
    slug = match[1];
  } else if (clean.startsWith('in/')) {
    slug = clean.slice(3).replace(/\/$/, '');
  }

  if (!/^[a-zA-Z0-9_%-]{3,100}$/.test(slug)) {
    return {
      valid: false,
      error: 'Please enter a valid LinkedIn profile URL (e.g. linkedin.com/in/username).',
    };
  }

  return {
    valid: true,
    canonicalUrl: `https://www.linkedin.com/in/${slug}`,
  };
}

/**
 * Normalizes and validates an optional personal portfolio URL.
 * Enforces HTTPS, rejects localhost, credentials (@ in authority), private IP addresses, and length <= 200.
 */
export function normalizePortfolioUrl(input?: string): LinkValidationResult {
  if (!input || !input.trim()) {
    return { valid: true, canonicalUrl: '' }; // Optional
  }

  let clean = input.trim();
  if (!/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }

  if (clean.length > 200) {
    return { valid: false, error: 'Portfolio URL cannot exceed 200 characters.' };
  }

  try {
    const url = new URL(clean);
    if (url.protocol !== 'https:') {
      return { valid: false, error: 'Portfolio URL must use secure HTTPS.' };
    }

    // No credentials
    if (url.username || url.password) {
      return { valid: false, error: 'Portfolio URL cannot contain embedded credentials.' };
    }

    const host = url.hostname.toLowerCase();
    // Reject localhost and IP addresses
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^[0-9.]+$/.test(host) ||
      host.includes(':') // IPv6
    ) {
      return { valid: false, error: 'Portfolio URL cannot point to localhost or private IP addresses.' };
    }

    // Must have a valid dot in domain
    if (!host.includes('.') || host.endsWith('.')) {
      return { valid: false, error: 'Please enter a valid public domain name.' };
    }

    return {
      valid: true,
      canonicalUrl: url.toString(),
    };
  } catch {
    return { valid: false, error: 'Please provide a valid URL format.' };
  }
}
