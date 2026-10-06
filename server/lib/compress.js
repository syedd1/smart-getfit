// Brotli/gzip for text responses (pages, CSS, JS, sitemap). Each body is compressed
// once and cached, not on every request. A reverse proxy that compresses (Caddy's
// `encode`) leaves already-encoded responses alone, so this is safe behind one and
// gives hosts without one compression too.
import zlib from 'node:zlib';

const MIN_BYTES = 1024;

export function pickEncoding(req) {
  const accepted = (req.get('accept-encoding') || '').toLowerCase();
  const allows = (name) => new RegExp(`(^|,)\\s*${name}\\s*(;\\s*q=(?!0(\\.0*)?\\s*(,|$))[\\d.]+)?\\s*(,|$)`).test(accepted);
  if (allows('br')) return 'br';
  if (allows('gzip')) return 'gzip';
  return 'identity';
}

function encode(buffer, encoding) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length },
    });
  }
  return zlib.gzipSync(buffer, { level: 6 });
}

// A cache of encoded bodies, keyed by the caller (e.g. URL path + file mtime).
export function createCompressionCache() {
  const cache = new Map();
  return {
    send(req, res, key, body, type) {
      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
      res.vary('Accept-Encoding').type(type);
      const encoding = buffer.length >= MIN_BYTES ? pickEncoding(req) : 'identity';
      if (encoding === 'identity') return res.send(buffer);
      const id = `${encoding}:${key}`;
      if (!cache.has(id)) cache.set(id, encode(buffer, encoding));
      return res.set('Content-Encoding', encoding).send(cache.get(id));
    },
    clear: () => cache.clear(),
  };
}
