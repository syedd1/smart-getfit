// In-memory fixed-window rate limiting, keyed by client IP by default.
// The store is the only stateful part: to share limits across several processes
// later, replace MemoryStore with one that has the same three methods.
import { HttpError } from './errors.js';

export class MemoryStore {
  constructor({ cleanupMs = 60_000 } = {}) {
    this.entries = new Map();
    this.timer = setInterval(() => this.prune(), cleanupMs);
    this.timer.unref();
  }

  // Count `amount` hits; returns the count and when the window (or block) ends.
  increment(key, windowMs, now = Date.now(), amount = 1) {
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.entries.set(key, entry);
    }
    entry.count += amount;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  // Current count without counting a hit (0 when the window has expired).
  peek(key, now = Date.now()) {
    const entry = this.entries.get(key);
    return entry && entry.resetAt > now ? { count: entry.count, resetAt: entry.resetAt } : { count: 0, resetAt: now };
  }

  // Keep a key blocked until `until` (used for login lockouts).
  blockUntil(key, until) {
    const entry = this.entries.get(key);
    if (entry && entry.resetAt < until) entry.resetAt = until;
  }

  reset(key) {
    this.entries.delete(key);
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
  }

  close() {
    clearInterval(this.timer);
  }
}

// options: name, windowMs, max, blockMs (extra lockout once exceeded), key(req), onLimited(info), now()
export function rateLimit({ name, windowMs, max, blockMs = 0, key = (req) => req.ip, onLimited, store = new MemoryStore(), now = Date.now }) {
  const keyFor = (req) => `${name}:${key(req)}`;

  const middleware = (req, res, next) => {
    const id = keyFor(req);
    const t = now();
    let { count, resetAt } = store.increment(id, windowMs, t);
    if (count === max + 1) {
      if (blockMs) {
        store.blockUntil(id, t + blockMs);
        resetAt = Math.max(resetAt, t + blockMs);
      }
      onLimited?.({ name, key: id, ip: req.ip, path: req.originalUrl });
    }
    const secondsLeft = Math.max(1, Math.ceil((resetAt - t) / 1000));
    res.set({
      'RateLimit-Limit': String(max),
      'RateLimit-Remaining': String(Math.max(0, max - count)),
      'RateLimit-Reset': String(secondsLeft),
    });
    if (count > max) {
      res.set('Retry-After', String(secondsLeft));
      next(new HttpError(429, 'too_many_requests', 'Too many requests. Please wait a moment and try again.'));
      return;
    }
    next();
  };

  middleware.resetFor = (req) => store.reset(keyFor(req));
  middleware.store = store;
  return middleware;
}

// A budget of `max` units per window, spent explicitly — e.g. one unit per uploaded
// file, which is only known after the request body is parsed.
//   precheck: middleware that refuses early once the budget is used up
//   spend(req, n): records n units; throws 429 (and records nothing) if they don't fit
export function quota({ name, windowMs, max, key = (req) => req.ip, onLimited, store = new MemoryStore(), now = Date.now }) {
  const keyFor = (req) => `${name}:${key(req)}`;
  const tooMany = (resetAt) => {
    const err = new HttpError(429, 'too_many_requests', 'Upload limit reached. Please wait and try again later.');
    err.retryAfter = Math.max(1, Math.ceil((resetAt - now()) / 1000));
    return err;
  };
  const withRetryAfter = (res, err) => res.set('Retry-After', String(err.retryAfter));

  return {
    store,
    precheck(req, res, next) {
      const { count, resetAt } = store.peek(keyFor(req), now());
      if (count < max) return next();
      const err = tooMany(resetAt);
      withRetryAfter(res, err);
      return next(err);
    },
    spend(req, res, amount) {
      const id = keyFor(req);
      const { count, resetAt } = store.peek(id, now());
      if (count + amount > max) {
        onLimited?.({ name, key: id, ip: req.ip, requested: amount, used: count });
        const err = tooMany(resetAt);
        withRetryAfter(res, err);
        throw err;
      }
      store.increment(id, windowMs, now(), amount);
    },
  };
}
