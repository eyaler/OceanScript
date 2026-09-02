// Headless rendering: drives the renderer page frame by frame with Playwright
// and pipes PNG frames into ffmpeg.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadTimeline } from './load.js';
import { startServer } from './server.js';
import { findFfmpeg } from './ffmpeg.js';

export const CHROMIUM_ARGS = [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--no-sandbox', '--disable-dev-shm-usage',
  '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars',
];

export async function launchBrowser({ headed = false } = {}) {
  const { chromium } = await import('playwright');
  const opts = { headless: !headed, args: CHROMIUM_ARGS };
  try {
    return await chromium.launch(opts);
  } catch (err) {
    // Fall back to the pre-installed browser if Playwright's revision is missing.
    const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const candidates = [`${pw}/chromium`, `${pw}/chromium/chrome`, ...(existsSync(pw) ? (await import('node:fs')).readdirSync(pw).filter((d) => d.startsWith('chromium-')).map((d) => `${pw}/${d}/chrome-linux/chrome`) : [])];
    for (const c of candidates) {
      if (existsSync(c) && statSync(c).isFile()) {
        try { return await chromium.launch({ ...opts, executablePath: c }); } catch { /* next */ }
      }
    }
    throw err;
  }
}

export async function render(file, args = {}) {
  const t0 = Date.now();
  const scale = args.scale ? Number(args.scale) : 1;
  const timeline = loadTimeline(file, { fps: args.fps, width: args.width, height: args.height });
  if (scale !== 1) {
    timeline.meta.width = Math.round(timeline.meta.width * scale / 2) * 2;
    timeline.meta.height = Math.round(timeline.meta.height * scale / 2) * 2;
  }
  for (const w of timeline.warnings) console.error('warning:', w);
  const { fps, width, height, duration } = timeline.meta;
  const startT = args.start != null ? Number(args.start) : 0;
  const endT = args.end != null ? Math.min(duration, Number(args.end)) : duration;
  const startFrame = Math.floor(startT * fps);
  const endFrame = Math.max(startFrame + 1, Math.ceil(endT * fps));
  const total = endFrame - startFrame;

  const ff = args.video === false ? null : findFfmpeg();
  if (args.video !== false && !ff) throw new Error('ffmpeg not found. Install ffmpeg, set $FFMPEG, or `pip install imageio-ffmpeg`.');
  let out = args.out;
  if (!out) {
    const ext = ff?.h264 ? 'mp4' : 'webm';
    out = path.join('out', `${timeline.meta.scriptName}.${ext}`);
  }
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const framesDir = args.frames ? path.resolve(args.frames) : null;
  if (framesDir) mkdirSync(framesDir, { recursive: true });
  const audio = args.audio ?? (timeline.meta.audio ? path.resolve(timeline.meta.scriptDir, timeline.meta.audio) : null);
  if (audio && !existsSync(audio)) throw new Error(`audio file not found: ${audio}`);

  console.error(`rendering ${total} frames (${width}x${height} @ ${fps}fps, ${(endT - startT).toFixed(2)}s) -> ${args.video === false ? framesDir : out}`);

  const { server, url } = await startServer({
    dynamic: { '/timeline.json': () => ({ body: JSON.stringify(timeline) }) },
    extraRoots: { '/script/': timeline.meta.scriptDir },
  });
  const browser = await launchBrowser({ headed: !!args.headed });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.error('[page]', msg.text()); });
  page.on('pageerror', (err) => console.error('[page error]', err.message));
  await page.goto(`${url}/?headless=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const gl = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); if (!g) return null; const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'webgl'; });
  if (!gl) throw new Error('WebGL is not available in the browser');
  console.error(`webgl: ${gl}`);

  let ffmpeg = null;
  let ffmpegDone = null;
  if (ff) {
    const isMp4 = /\.(mp4|m4v|mov)$/i.test(out);
    const vcodec = isMp4 ? (ff.h264 ? ['-c:v', 'libx264', '-preset', args.preset || 'medium', '-crf', String(args.crf ?? 18), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'] : null)
      : (ff.vp9 ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(args.crf ?? 30), '-pix_fmt', 'yuv420p'] : ['-c:v', 'libvpx', '-b:v', '6M', '-pix_fmt', 'yuv420p']);
    if (!vcodec) throw new Error(`this ffmpeg (${ff.path}) cannot encode H.264; use -o file.webm or install a full ffmpeg`);
    const ffargs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
    if (audio) ffargs.push('-ss', String(startT), '-i', audio);
    ffargs.push(...vcodec);
    if (audio) ffargs.push('-c:a', isMp4 ? 'aac' : 'libopus', '-b:a', '160k', '-shortest', '-map', '0:v:0', '-map', '1:a:0');
    ffargs.push(out);
    ffmpeg = spawn(ff.path, ffargs, { stdio: ['pipe', 'inherit', 'inherit'] });
    ffmpegDone = new Promise((resolve, reject) => {
      ffmpeg.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
      ffmpeg.on('error', reject);
    });
    ffmpeg.stdin.on('error', () => {});
  }

  const write = (buf) => new Promise((resolve) => { if (!ffmpeg) return resolve(); if (!ffmpeg.stdin.write(buf)) ffmpeg.stdin.once('drain', resolve); else resolve(); });
  let lastLog = Date.now();
  const tStart = Date.now();
  for (let i = startFrame; i < endFrame; i++) {
    const t = i / fps;
    await page.evaluate((tt) => window.__seek(tt), t);
    const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    if (framesDir) writeFileSync(path.join(framesDir, `frame_${String(i).padStart(6, '0')}.png`), png);
    await write(png);
    const done = i - startFrame + 1;
    if (Date.now() - lastLog > 3000 || done === total) {
      const el = (Date.now() - tStart) / 1000;
      const rate = done / el;
      const eta = (total - done) / Math.max(rate, 1e-6);
      console.error(`  frame ${done}/${total} (${(100 * done / total).toFixed(1)}%)  ${rate.toFixed(1)} fps  eta ${fmt(eta)}`);
      lastLog = Date.now();
    }
  }
  if (ffmpeg) { ffmpeg.stdin.end(); await ffmpegDone; }
  await browser.close();
  server.close();
  console.error(`done in ${fmt((Date.now() - t0) / 1000)}${ff ? ` -> ${out}` : ''}`);
  return out;
}

function fmt(s) { s = Math.round(s); return s >= 3600 ? `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`; }
