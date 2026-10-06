// Environment configuration, validated once at startup. In production, missing or
// weak secrets stop the server instead of running insecurely.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { formatIssues } from './lib/validate.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLACEHOLDER = /change[-_ ]?me|replace[-_ ]?me|example|placeholder|^x+$/i;
const optionalText = z.string().trim().transform((s) => s || undefined).optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SITE_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
  TRUST_PROXY: z.string().default('false'),
  DATABASE_PATH: z.string().min(1).default('var/smart-getfit.db'),
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  ADMIN_PATH: z.string().regex(/^\/[a-z0-9][a-z0-9-]{2,63}$/, 'must look like /admin or /manage-7f3a').default('/admin'),
  ADMIN_USERNAME: optionalText,
  ADMIN_PASSWORD_HASH: optionalText,
  SESSION_SECRET: optionalText,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
});

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

// "loopback" / "1" / "true" / "false" / "10.0.0.1,10.0.0.2" → Express "trust proxy" value.
function parseTrustProxy(value) {
  const v = value.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === '') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new ConfigError(formatIssues(parsed.error));
  const c = parsed.data;
  const production = c.NODE_ENV === 'production';

  const problems = [];
  const adminConfigured = Boolean(c.ADMIN_USERNAME || c.ADMIN_PASSWORD_HASH);
  if (production || adminConfigured) {
    if (!c.ADMIN_USERNAME) problems.push('ADMIN_USERNAME is required');
    if (!c.ADMIN_PASSWORD_HASH) problems.push('ADMIN_PASSWORD_HASH is required (generate it with: npm run hash-password)');
    else if (!c.ADMIN_PASSWORD_HASH.startsWith('$argon2id$')) problems.push('ADMIN_PASSWORD_HASH must be an Argon2id hash (starts with $argon2id$)');
  }
  if (production || c.SESSION_SECRET) {
    if (!c.SESSION_SECRET) problems.push('SESSION_SECRET is required');
    else if (c.SESSION_SECRET.length < 32) problems.push('SESSION_SECRET must be at least 32 characters (generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
    else if (PLACEHOLDER.test(c.SESSION_SECRET) || new Set(c.SESSION_SECRET).size < 10) problems.push('SESSION_SECRET looks like a placeholder; use a random value');
  }
  if (production && !c.SITE_URL.startsWith('https://')) problems.push('SITE_URL must use https:// in production');
  if (problems.length) throw new ConfigError(problems);

  const resolve = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
  return Object.freeze({
    env: c.NODE_ENV,
    isProduction: production,
    host: c.HOST,
    port: c.PORT,
    siteUrl: c.SITE_URL.replace(/\/+$/, ''),
    trustProxy: parseTrustProxy(c.TRUST_PROXY),
    databasePath: c.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(c.DATABASE_PATH),
    uploadDir: resolve(c.UPLOAD_DIR),
    dataDir: path.join(ROOT, 'data'),
    publicDir: path.join(ROOT, 'public'),
    adminPath: c.ADMIN_PATH,
    admin: c.ADMIN_USERNAME && c.ADMIN_PASSWORD_HASH
      ? Object.freeze({ username: c.ADMIN_USERNAME, passwordHash: c.ADMIN_PASSWORD_HASH })
      : null,
    sessionSecret: c.SESSION_SECRET || null,
    logLevel: c.LOG_LEVEL || (c.NODE_ENV === 'test' ? 'silent' : production ? 'info' : 'debug'),
  });
}
