// Structured logging: one JSON object per line on stdout (info/debug) or stderr
// (warn/error). systemd/PM2 capture it; no log files to rotate here.
// Fields whose names look secret are redacted before anything is written.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SECRET_KEY = /pass(word)?|secret|token|cookie|authorization|hash|csrf/i;

function clean(value, depth = 0) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, stack: value.stack };
  }
  if (!value || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : clean(v, depth + 1);
  return out;
}

export function createLogger({ level = 'info', write } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const emit = write || ((lvl, line) => (LEVELS[lvl] >= LEVELS.warn ? process.stderr : process.stdout).write(`${line}\n`));
  const log = (lvl) => (msg, fields = {}) => {
    if (LEVELS[lvl] < threshold) return;
    emit(lvl, JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...clean(fields) }));
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}
