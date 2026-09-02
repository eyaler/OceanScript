// Locates an ffmpeg binary.  Preference order:
//   1. $FFMPEG (explicit path)
//   2. `ffmpeg` on PATH
//   3. the static build bundled with the imageio-ffmpeg Python package
//   4. Playwright's bundled ffmpeg (VP8/WebM only)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

let cached = null;

export function findFfmpeg() {
  if (cached) return cached;
  const candidates = [];
  if (process.env.FFMPEG) candidates.push({ path: process.env.FFMPEG, source: 'env' });
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) candidates.push({ path: which.stdout.trim(), source: 'path' });
  try {
    const out = execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out && existsSync(out)) candidates.push({ path: out, source: 'imageio-ffmpeg' });
  } catch { /* ignore */ }
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pw) {
    try {
      for (const d of readdirSync(pw)) if (d.startsWith('ffmpeg')) {
        const p = `${pw}/${d}/ffmpeg-linux`;
        if (existsSync(p)) candidates.push({ path: p, source: 'playwright' });
      }
    } catch { /* ignore */ }
  }
  for (const c of candidates) {
    const probe = spawnSync(c.path, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    c.h264 = /\blibx264\b/.test(probe.stdout);
    c.vp9 = /\blibvpx-vp9\b/.test(probe.stdout);
    c.vp8 = /\blibvpx\b/.test(probe.stdout);
    c.aac = /\baac\b/.test(probe.stdout);
    cached = c;
    return c;
  }
  return null;
}
