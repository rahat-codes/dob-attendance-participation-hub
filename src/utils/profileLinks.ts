/**
 * Normalization, validation, and sanitization utilities for builder social & portfolio links.
 * Synchronized with tests/fixtures/profile-links.json and Firestore security rules validators.
 */

export interface LinkValidationResult {
  valid: boolean;
  canonicalUrl?: string;
  error?: string;
}

export interface LinkNormalizationOptions {
  allowEmpty?: boolean;
}

const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const LINKEDIN_SLUG_REGEX = /^[a-zA-Z0-9._%-]{3,100}$/;
const PORTFOLIO_HOST_REGEX =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

/**
 * Shared Firestore-compatible regex patterns kept in lockstep with docs/RULES_LINKS_FIX.md.
 */
export const PROFILE_LINK_RULES_REGEX = {
  github: /^https:\/\/github\.com\/[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/,
  linkedin: /^https:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9._%-]{3,100}\/?$/,
  portfolio:
    /^https:\/\/[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}([/?#][^\s]*)?$/,
  portfolioLocalhost: /^https:\/\/([^/?#]+\.)?localhost([/?#].*)?$/,
} as const;

/**
 * Filters an external auth photo URL so only short https:// URLs are written to
 * Firebase Auth profiles or users/{uid}.photoURL. Never returns data: URLs.
 */
export function sanitizeAuthPhotoUrl(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 500 && /^https:\/\/.+/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

/**
 * Normalizes and validates a GitHub profile input.
 * Canonical format: "https://github.com/<user>" (1-39 chars).
 */
export function normalizeGitHubUrl(
  input?: string,
  options?: LinkNormalizationOptions
): LinkValidationResult {
  const clean = (input || '').trim();
  if (!clean) {
    if (options?.allowEmpty) {
      return { valid: true, canonicalUrl: '' };
    }
    return {
      valid: false,
      error: 'GitHub URL must look like https://github.com/your-username',
    };
  }

  const stripped = clean.replace(/^@/, '');

  if (/^(javascript|data|vbscript|file):/i.test(stripped)) {
    return { valid: false, error: 'GitHub URL uses an unsupported protocol.' };
  }
  if (/\s/.test(stripped) || /[^\x21-\x7E]/.test(stripped)) {
    return {
      valid: false,
      error: 'GitHub URL must look like https://github.com/your-username',
    };
  }

  let username = '';
  const urlMatch = stripped.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/?$/i
  );
  if (urlMatch) {
    username = urlMatch[1];
  } else if (
    !stripped.includes('/') &&
    !stripped.includes(':') &&
    !stripped.includes('?') &&
    !stripped.includes('#')
  ) {
    username = stripped;
  } else {
    return {
      valid: false,
      error: 'GitHub URL must look like https://github.com/your-username',
    };
  }

  if (!GITHUB_USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      error: 'GitHub URL must look like https://github.com/your-username',
    };
  }

  const canonicalUrl = `https://github.com/${username}`;
  if (canonicalUrl.length > 100 || !PROFILE_LINK_RULES_REGEX.github.test(canonicalUrl)) {
    return {
      valid: false,
      error: 'GitHub URL must look like https://github.com/your-username',
    };
  }

  return {
    valid: true,
    canonicalUrl,
  };
}

/**
 * Normalizes and validates a LinkedIn profile input.
 * Canonical format: "https://www.linkedin.com/in/<slug>"
 * (letters, digits, '.', '-', '_', '%', 3-100 chars, optional trailing slash, no '..').
 */
export function normalizeLinkedInUrl(
  input?: string,
  options?: LinkNormalizationOptions
): LinkValidationResult {
  const clean = (input || '').trim();
  if (!clean) {
    if (options?.allowEmpty) {
      return { valid: true, canonicalUrl: '' };
    }
    return {
      valid: false,
      error: 'LinkedIn URL must look like https://www.linkedin.com/in/your-name',
    };
  }

  if (/^(javascript|data|vbscript|file):/i.test(clean)) {
    return { valid: false, error: 'LinkedIn URL uses an unsupported protocol.' };
  }
  if (/\s/.test(clean) || /[^\x21-\x7E]/.test(clean)) {
    return {
      valid: false,
      error: 'LinkedIn URL must look like https://www.linkedin.com/in/your-name',
    };
  }

  let slug = '';
  const urlMatch = clean.match(
    /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#]+)\/?$/i
  );
  if (urlMatch) {
    slug = urlMatch[1];
  } else if (/^in\/([^/?#]+)\/?$/i.test(clean)) {
    slug = clean.slice(3).replace(/\/$/, '');
  } else if (
    !clean.includes('/') &&
    !clean.includes(':') &&
    !clean.includes('?') &&
    !clean.includes('#')
  ) {
    slug = clean;
  } else {
    return {
      valid: false,
      error: 'LinkedIn URL must look like https://www.linkedin.com/in/your-name',
    };
  }

  if (!LINKEDIN_SLUG_REGEX.test(slug) || slug.includes('..')) {
    return {
      valid: false,
      error: 'LinkedIn URL must look like https://www.linkedin.com/in/your-name',
    };
  }

  const canonicalUrl = `https://www.linkedin.com/in/${slug}`;
  if (canonicalUrl.length > 150 || !PROFILE_LINK_RULES_REGEX.linkedin.test(canonicalUrl)) {
    return {
      valid: false,
      error: 'LinkedIn URL must look like https://www.linkedin.com/in/your-name',
    };
  }

  return {
    valid: true,
    canonicalUrl,
  };
}

/**
 * Normalizes and validates an optional personal portfolio URL.
 * Enforces HTTPS only, optional path/query/fragment, max 200 chars after normalization,
 * rejects localhost, embedded credentials, custom ports, and IP hosts.
 */
export function normalizePortfolioUrl(input?: string): LinkValidationResult {
  if (!input || !input.trim()) {
    return { valid: true, canonicalUrl: '' };
  }

  const raw = input.trim();

  if (/^(javascript|data|vbscript|file):/i.test(raw)) {
    return { valid: false, error: 'Portfolio URL must start with https://' };
  }

  if (/\s/.test(raw)) {
    return { valid: false, error: 'Portfolio URL cannot contain spaces.' };
  }

  if (/[^\x21-\x7E]/.test(raw)) {
    return {
      valid: false,
      error: 'Portfolio URL cannot contain non-ASCII characters or unicode lookalikes.',
    };
  }

  let clean = raw;
  if (!/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }

  try {
    const url = new URL(clean);
    if (url.protocol !== 'https:') {
      return {
        valid: false,
        error: 'Portfolio URL must use https:// (for example, https://your-site.dev)',
      };
    }

    if (url.username || url.password) {
      return { valid: false, error: 'Portfolio URL cannot contain embedded credentials.' };
    }

    if (url.port) {
      return { valid: false, error: 'Portfolio URL cannot specify custom ports.' };
    }

    const host = url.hostname.toLowerCase();

    if (host.includes('xn--')) {
      return {
        valid: false,
        error: 'Portfolio URL cannot contain internationalized/punycode hostnames.',
      };
    }

    if (
      host.startsWith('[') ||
      host.includes(':') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host)
    ) {
      return {
        valid: false,
        error: 'Portfolio URL must use a public domain name, not an IP address.',
      };
    }

    if (host === 'localhost' || host.endsWith('.localhost')) {
      return { valid: false, error: 'Portfolio URL cannot point to localhost.' };
    }

    if (!PORTFOLIO_HOST_REGEX.test(host)) {
      return {
        valid: false,
        error: 'Portfolio URL must use a public domain (for example, https://your-site.dev)',
      };
    }

    const canonicalUrl = url.toString();
    if (canonicalUrl.length > 200) {
      return { valid: false, error: 'Portfolio URL cannot exceed 200 characters.' };
    }

    if (
      !PROFILE_LINK_RULES_REGEX.portfolio.test(canonicalUrl) ||
      PROFILE_LINK_RULES_REGEX.portfolioLocalhost.test(canonicalUrl)
    ) {
      return {
        valid: false,
        error: 'Portfolio URL must use a valid public https:// domain.',
      };
    }

    return {
      valid: true,
      canonicalUrl,
    };
  } catch {
    return {
      valid: false,
      error: 'Portfolio URL must look like https://your-site.dev',
    };
  }
}
