// Phase 2 static preview server — zero dependencies.
// Serves public/ with the production CSP so the port can be verified before the
// Express server exists (Phase 4 replaces this file).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.svg': 'image/svg+xml',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'self'",
  'frame-src https://www.google.com https://maps.google.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

async function resolveFile(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const candidates = [clean, `${clean}.html`, path.join(clean, 'index.html')];
  for (const rel of candidates) {
    const abs = path.join(PUBLIC, rel);
    if (!abs.startsWith(PUBLIC + path.sep) && abs !== PUBLIC) return null; // path traversal
    try {
      if ((await fs.stat(abs)).isFile()) return abs;
    } catch { /* try next */ }
  }
  return null;
}

http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    const file = await resolveFile(new URL(req.url, 'http://x').pathname);
    const status = file ? 200 : 404;
    const target = file || path.join(PUBLIC, '404.html');
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
    res.end(await fs.readFile(target));
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(await fs.readFile(path.join(PUBLIC, '500.html')).catch(() => 'Server error'));
  }
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT}`));
