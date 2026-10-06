// Preview server for Phases 2–3 (replaced by the Express server in Phase 4).
// Validates data/*.json, renders every page once at startup, then serves those pages
// plus public/ with the production CSP. Invalid data → it refuses to start.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, DataError } from '../server/services/catalogue.js';
import { renderSite } from '../server/views/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

let site;
try {
  site = renderSite(loadData({ dataDir: path.join(ROOT, 'data'), publicDir: PUBLIC }), { publicDir: PUBLIC });
} catch (err) {
  if (err instanceof DataError) {
    console.error(`Refusing to start: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const TYPES = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self'",
  "font-src 'self'", "media-src 'self'", "connect-src 'self'",
  'frame-src https://www.google.com https://maps.google.com',
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

async function staticFile(urlPath) {
  const abs = path.join(PUBLIC, path.normalize(decodeURIComponent(urlPath)));
  if (!abs.startsWith(PUBLIC + path.sep)) return null; // path traversal
  try {
    return (await fs.stat(abs)).isFile() ? abs : null;
  } catch {
    return null;
  }
}

const sendHtml = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
};

http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const route = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    if (site.pages.has(route)) return sendHtml(res, 200, site.pages.get(route));
    const file = await staticFile(pathname);
    if (!file) return sendHtml(res, 404, site.notFound);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(await fs.readFile(file));
  } catch (err) {
    console.error(err);
    sendHtml(res, 500, site.serverError);
  }
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT} (${site.pages.size} pages rendered)`));
