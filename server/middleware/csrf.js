// CSRF protection for the admin API, in two independent layers:
//  1. Same-origin check: state-changing requests carrying a foreign Origin (or a
//     cross-site Sec-Fetch-Site) are refused — this also covers the login form.
//  2. Token check: authenticated POST/PUT/DELETE must send X-CSRF-Token, an HMAC of
//     the session, which a cross-site page cannot read or compute.
import crypto from 'node:crypto';
import { HttpError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// In production only SITE_URL's origin is accepted; in development the address the
// server is actually reached on (localhost, a LAN IP for phone testing) also counts.
export function sameOrigin({ siteUrl, isProduction }) {
  const siteOrigin = new URL(siteUrl).origin;
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    const allowed = origin
      ? origin === siteOrigin || (!isProduction && origin === `${req.protocol}://${req.get('host')}`)
      : !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
    return allowed ? next() : next(new HttpError(403, 'cross_origin', 'Request refused.'));
  };
}

export function createCsrf({ secret }) {
  const tokenFor = (session) => crypto.createHmac('sha256', secret).update(`csrf:${session.token_hash}`).digest('base64url');

  function verify(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const sent = req.get('x-csrf-token') || '';
    const expected = tokenFor(req.adminSession);
    const ok = sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
    return ok ? next() : next(new HttpError(403, 'csrf_failed', 'Your session token is missing or out of date. Reload the page and try again.'));
  }

  return { tokenFor, verify };
}
