// Asset preparation for the renderer: video clips are transcoded to WebM
// (headless Chromium has no H.264 decoder) into a cache next to the output,
// and the server exposes the script folder and that cache.
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { findFfmpeg } from './ffmpeg.js';

export function prepareAssets(timeline, { cacheDir = path.join('out', '.asset-cache'), log = console.error } = {}) {
  const missing = [];
  const rewrites = {};
  for (const rel of timeline.assets || []) {
    const abs = path.resolve(timeline.meta.scriptDir, rel);
    if (!existsSync(abs)) { missing.push(rel); continue; }
    if (/\.(mp4|mov|m4v|avi|mkv|mpg|mpeg|wmv)$/i.test(rel)) {
      const ff = findFfmpeg();
      if (!ff) { log(`warning: cannot transcode ${rel} without ffmpeg`); continue; }
      mkdirSync(cacheDir, { recursive: true });
      const key = createHash('sha1').update(abs + statSync(abs).mtimeMs).digest('hex').slice(0, 12);
      const outFile = path.resolve(cacheDir, `${key}.webm`);
      if (!existsSync(outFile)) {
        log(`transcoding ${rel} -> webm for the browser`);
        const r = spawnSync(ff.path, ['-y', '-hide_banner', '-loglevel', 'error', '-i', abs, '-an', '-c:v', ff.vp9 ? 'libvpx-vp9' : 'libvpx', '-b:v', '0', '-crf', '30', '-deadline', 'good', '-cpu-used', '4', '-vf', `scale='min(${timeline.meta.width},iw)':-2`, outFile], { encoding: 'utf8' });
        if (r.status !== 0) { log(`warning: transcode failed for ${rel}: ${r.stderr}`); continue; }
      }
      rewrites[rel] = `/cache/${path.basename(outFile)}`;
    }
  }
  for (const m of missing) log(`warning: asset not found: ${m}`);
  timeline.meta.assetUrls = Object.fromEntries((timeline.assets || []).map((rel) => [rel, rewrites[rel] || `/script/${rel.split('/').map(encodeURIComponent).join('/')}`]));
  return { cacheDir: path.resolve(cacheDir), missing };
}
