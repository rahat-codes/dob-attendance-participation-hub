import React, { useState, useEffect } from 'react';

export function sanitizeAvatarUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Reject malicious schemes immediately
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/html')) {
    return null;
  }

  // Allow standard web schemes, safe data URIs, or local relative paths
  if (
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    lower.startsWith('data:image/') ||
    lower.startsWith('/')
  ) {
    return trimmed;
  }

  return null;
}

export function getInitials(name?: string | null): string {
  if (!name || typeof name !== 'string') return '?';
  const clean = name.trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface SecureAvatarProps {
  src?: string | null;
  name?: string | null;
  alt?: string;
  size?: number | string; // e.g. 32, 40, 48, 64, 80, 96, 120 or '100%'
  className?: string;
  imgClassName?: string;
  fallbackClassName?: string;
  shape?: 'circle' | 'rounded';
  style?: React.CSSProperties;
}

export const SecureAvatar: React.FC<SecureAvatarProps> = ({
  src,
  name,
  alt,
  size,
  className = '',
  imgClassName = '',
  fallbackClassName = '',
  shape = 'circle',
  style,
}) => {
  const [loadError, setLoadError] = useState(false);
  const safeSrc = sanitizeAvatarUrl(src);

  // Reset load error if image source changes
  useEffect(() => {
    setLoadError(false);
  }, [src]);

  const initials = getInitials(name);
  const roundedClass = shape === 'circle' ? 'rounded-full' : 'rounded-2xl';

  const containerStyle: React.CSSProperties = {
    ...(size ? { width: typeof size === 'number' ? `${size}px` : size, height: typeof size === 'number' ? `${size}px` : size } : {}),
    ...style,
  };

  if (!safeSrc || loadError) {
    return (
      <div
        className={`inline-flex items-center justify-center font-bold select-none overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900 border border-white/10 text-white/90 ${roundedClass} ${className} ${fallbackClassName}`}
        style={containerStyle}
        aria-label={alt || name || 'Member avatar'}
        role="img"
      >
        <span className="leading-none tracking-tight">{initials}</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center justify-center overflow-hidden bg-neutral-900/60 ${roundedClass} ${className}`}
      style={containerStyle}
    >
      <img
        src={safeSrc}
        alt={alt || name || 'Member avatar'}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
        onError={() => setLoadError(true)}
        className={`w-full h-full object-cover select-none pointer-events-none ${roundedClass} ${imgClassName}`}
      />
    </div>
  );
};
