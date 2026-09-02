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
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port, url: `http://${host}:${server.address().port}` }));
  });
}
