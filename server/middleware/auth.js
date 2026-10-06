// Single-admin authentication with server-side sessions.
//
// Login → verify username + Argon2id password → new random 256-bit token →
// SHA-256 hash stored in SQLite → raw token only in an HttpOnly, SameSite=Strict cookie.
// Sessions end after 12 h, or after 2 h without activity, or on logout.
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { HttpError } from './errors.js';

export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000; // don't write last_seen_at on every request
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url
// Each Argon2 check holds 64 MiB; a flood of logins must not exhaust memory.
const MAX_CONCURRENT_PASSWORD_CHECKS = 2;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();
export const hashToken = (token) => sha256(token).toString('hex');

export function createAuth({ db, config, now = Date.now }) {
  const cookieName = config.isProduction ? '__Host-sgfn_admin' : 'sgfn_admin';
  const secure = config.isProduction;

  const insert = db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?)');
  const find = db.prepare('SELECT id, token_hash, created_at, expires_at, last_seen_at FROM sessions WHERE token_hash = ?');
  const touch = db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?');
  const removeByHash = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const removeStale = db.prepare('DELETE FROM sessions WHERE expires_at <= @now OR last_seen_at <= @idleBefore');

  function readToken(req) {
    for (const part of (req.headers.cookie || '').split(';')) {
      const eq = part.indexOf('=');
      if (eq !== -1 && part.slice(0, eq).trim() === cookieName) {
        const value = part.slice(eq + 1).trim();
        return TOKEN_FORMAT.test(value) ? value : null;
      }
    }
    return null;
  }

  function setCookie(res, token, maxAgeSeconds) {
    res.append('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`);
  }

  const isLive = (row, t) => row.expires_at > t && row.last_seen_at > t - SESSION_IDLE_MS;
  let checksRunning = 0;

  return {
    cookieName,

    // When the admin username or password hash differs from the one the sessions were
    // created under, every session is ended. Returns how many were revoked.
    revokeSessionsIfCredentialsChanged() {
      const fingerprint = config.admin
        ? crypto.createHash('sha256').update(`${config.admin.username}\n${config.admin.passwordHash}`).digest('hex')
        : 'admin-disabled';
      return db.transaction(() => {
        const stored = db.prepare("SELECT value FROM settings WHERE key = 'admin_credentials'").pluck().get();
        if (stored === fingerprint) return 0;
        const revoked = stored === undefined ? 0 : db.prepare('DELETE FROM sessions').run().changes;
        db.prepare("INSERT INTO settings (key, value) VALUES ('admin_credentials', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(fingerprint);
        return revoked;
      })();
    },

    // Always runs the Argon2 check, so a wrong username takes as long as a wrong password.
    async verifyCredentials(username, password) {
      if (!config.admin) return false;
      if (checksRunning >= MAX_CONCURRENT_PASSWORD_CHECKS) {
        throw new HttpError(503, 'busy', 'The server is busy. Please try again in a moment.');
      }
      checksRunning += 1;
      try {
        const userOk = crypto.timingSafeEqual(sha256(String(username)), sha256(config.admin.username));
        let passwordOk = false;
        try {
          passwordOk = await argon2.verify(config.admin.passwordHash, String(password));
        } catch {
          passwordOk = false;
        }
        return userOk && passwordOk;
      } finally {
        checksRunning -= 1;
      }
    },

    // Issues a fresh session (any session the browser already had is discarded).
    startSession(req, res) {
      const t = now();
      const previous = readToken(req);
      if (previous) removeByHash.run(hashToken(previous));
      removeStale.run({ now: t, idleBefore: t - SESSION_IDLE_MS });
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);
      insert.run(tokenHash, t, t + SESSION_LIFETIME_MS, t);
      setCookie(res, token, SESSION_LIFETIME_MS / 1000);
      return { token_hash: tokenHash, created_at: t, expires_at: t + SESSION_LIFETIME_MS, last_seen_at: t };
    },

    // The live session for this request, or null. Expired sessions are deleted on sight.
    currentSession(req) {
      const token = readToken(req);
      if (!token) return null;
      const row = find.get(hashToken(token));
      if (!row) return null;
      const t = now();
      if (!isLive(row, t)) {
        removeByHash.run(row.token_hash);
        return null;
      }
      if (t - row.last_seen_at > TOUCH_EVERY_MS) {
        touch.run(t, row.id);
        row.last_seen_at = t;
      }
      return row;
    },

    endSession(req, res) {
      const token = readToken(req);
      if (token) removeByHash.run(hashToken(token));
      setCookie(res, '', 0);
    },

    clearCookie(res) {
      setCookie(res, '', 0);
    },

    removeStaleSessions() {
      const t = now();
      return removeStale.run({ now: t, idleBefore: t - SESSION_IDLE_MS }).changes;
    },
  };
}

export function requireAuth(auth) {
  return (req, res, next) => {
    const session = auth.currentSession(req);
    if (!session) {
      auth.clearCookie(res);
      next(new HttpError(401, 'unauthenticated', 'Your session has ended. Please log in again.'));
      return;
    }
    req.adminSession = session;
    next();
  };
}
