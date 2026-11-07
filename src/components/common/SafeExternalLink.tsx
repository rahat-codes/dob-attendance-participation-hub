import React from 'react';

interface SafeExternalLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

/**
 * Universal safe anchor component for user-provided URLs.
 * Strictly guarantees target="_blank" and rel="noopener noreferrer nofollow ugc".
 * Sanitizes against javascript: and data: URLs.
 */
export const SafeExternalLink: React.FC<SafeExternalLinkProps> = ({
  href,
  children,
  className = '',
  ariaLabel,
  ...rest
}) => {
  const safeHref = href && !/^(javascript|data|vbscript|file):/i.test(href.trim())
    ? href.trim()
    : '#';

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className={className}
      aria-label={ariaLabel}
      {...rest}
    >
      {children}
    </a>
  );
};
