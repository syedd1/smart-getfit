// Security headers for every response. The CSP allows no inline script or style;
// the only third party is the Google Maps embed on the Visit section.

// extraImgSrc: the admin page also shows local previews of chosen files (blob: URLs).
export function contentSecurityPolicy({ isProduction }, { extraImgSrc = '' } = {}) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self'${extraImgSrc ? ` ${extraImgSrc}` : ''}`,
    "font-src 'self'",
    "media-src 'self'",
    "connect-src 'self'",
    'frame-src https://www.google.com https://maps.google.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

// Uploaded files are only ever images; if one is opened directly it gets no
// script, no plugins and a sandboxed origin.
export const UPLOAD_CSP = "default-src 'none'; img-src 'self'; sandbox";

export function securityHeaders(config) {
  const csp = contentSecurityPolicy(config);
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    if (config.isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
