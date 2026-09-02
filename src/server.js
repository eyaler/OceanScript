// Tiny static file server for the renderer (no dependencies).
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};

/**
 * Starts the server.  `dynamic` maps URL paths to functions returning
 * { body, type } (used for the compiled timeline).  `extraRoots` maps URL
 * prefixes to directories (used to expose the script's folder for audio/fonts).
 */
export function startServer({ dynamic = {}, extraRoots = {}, port = 0, host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (dynamic[p]) {
      const { body, type = 'application/json' } = dynamic[p](req);
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(body);
      return;
    }
    let file = null;
    for (const [prefix, dir] of Object.entries(extraRoots)) {
      if (p.startsWith(prefix)) { file = path.join(dir, p.slice(prefix.length)); break; }
    }
    if (!file) {
      if (p === '/') p = '/renderer/index.html';
      if (p.startsWith('/vendor/three/')) file = path.join(ROOT, 'node_modules/three', p.slice('/vendor/three/'.length));
      else file = path.join(ROOT, p);
    }
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found: ' + p); return; }
    const size = statSync(file).size;
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Range requests are required for <video> seeking in Chromium.
    const range = req.headers.range && req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if (range && size > 0) {
      let start = range[1] ? parseInt(range[1], 10) : Math.max(0, size - parseInt(range[2], 10));
      let end = range[2] && range[1] ? Math.min(size - 1, parseInt(range[2], 10)) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
      res.writeHead(206, { 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes', 'content-length': size });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port, url: `http://${host}:${server.address().port}` }));
  });
}
