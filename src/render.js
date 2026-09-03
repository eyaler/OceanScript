// Headless rendering: drives the renderer page frame by frame with Playwright
// and pipes PNG frames into ffmpeg.  Because every frame is a pure function of
// time, capture failures are retried (relaunching the browser if needed) and
// the frame range can be split into chunks rendered by parallel processes.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTimeline } from './timing.js';
import { startServer } from './server.js';
import { findFfmpeg } from './ffmpeg.js';
import { finalize } from './mux.js';
import { prepareAssets } from './assets.js';

export const CHROMIUM_ARGS = [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--no-sandbox', '--disable-dev-shm-usage',
  '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars',
];
const SCREENSHOT_TIMEOUT = 120000;
const MAX_RETRIES = 4;

export async function launchBrowser({ headed = false } = {}) {
  const { chromium } = await import('playwright');
  const opts = { headless: !headed, args: CHROMIUM_ARGS };
  try {
    return await chromium.launch(opts);
  } catch (err) {
    // Fall back to the pre-installed browser if Playwright's revision is missing.
    const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const candidates = [`${pw}/chromium`, `${pw}/chromium/chrome`, ...(existsSync(pw) ? readdirSync(pw).filter((d) => d.startsWith('chromium-')).map((d) => `${pw}/${d}/chrome-linux/chrome`) : [])];
    for (const c of candidates) {
      if (existsSync(c) && statSync(c).isFile()) {
        try { return await chromium.launch({ ...opts, executablePath: c }); } catch { /* next */ }
      }
    }
    throw err;
  }
}

// A renderer page that can be re-created after a failure.
class RenderPage {
  constructor(url, width, height, headed) { Object.assign(this, { url, width, height, headed, browser: null, page: null }); }
  async open() {
    await this.close();
    this.browser = await launchBrowser({ headed: this.headed });
    const context = await this.browser.newContext({ viewport: { width: this.width, height: this.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    this.page = await context.newPage();
    this.page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.error('[page]', msg.text()); });
    this.page.on('pageerror', (err) => console.error('[page error]', err.message));
    await this.page.goto(`${this.url}/?headless=1`);
    await this.page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    const gl = await this.page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); if (!g) return null; const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'webgl'; });
    if (!gl) throw new Error('WebGL is not available in the browser');
    return gl;
  }
  async capture(t) {
    await this.page.evaluate((tt) => window.__seek(tt), t);
    return this.page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', timeout: SCREENSHOT_TIMEOUT });
  }
  async captureWithRetry(t) {
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try { return await this.capture(t); } catch (err) {
        lastErr = err;
        console.error(`  capture of t=${t.toFixed(3)} failed (${String(err.message).split('\n')[0]}); relaunching browser (attempt ${attempt + 1}/${MAX_RETRIES})`);
        try { await this.open(); } catch (e) { lastErr = e; }
      }
    }
    throw lastErr;
  }
  async close() { if (this.browser) { try { await this.browser.close(); } catch { /* ignore */ } this.browser = null; this.page = null; } }
}

function videoArgs(ff, out, args) {
  const isMp4 = /\.(mp4|m4v|mov)$/i.test(out);
  if (isMp4) {
    if (!ff.h264) throw new Error(`this ffmpeg (${ff.path}) cannot encode H.264; use -o file.webm or install a full ffmpeg`);
    return ['-c:v', 'libx264', '-preset', args.preset || 'medium', '-crf', String(args.crf ?? 18), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  }
  return ff.vp9 ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(args.crf ?? 30), '-pix_fmt', 'yuv420p'] : ['-c:v', 'libvpx', '-b:v', '6M', '-pix_fmt', 'yuv420p'];
}

function runFfmpeg(ff, ffargs, { stdin = 'ignore' } = {}) {
  const proc = spawn(ff.path, ['-y', '-hide_banner', '-loglevel', 'error', ...ffargs], { stdio: [stdin, 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
    proc.on('error', reject);
  });
  return { proc, done };
}

export async function render(file, args = {}) {
  const t0 = Date.now();
  const scale = args.scale ? Number(args.scale) : 1;
  let out = args.out;
  const ff = args.video === false ? null : findFfmpeg();
  if (args.video !== false && !ff) throw new Error('ffmpeg not found. Install ffmpeg, set $FFMPEG, or `pip install imageio-ffmpeg`.');
  const timingFile = args.timingFile ?? (out ? out.replace(/\.[^.]+$/, '.timing.json') : null);
  const timeline = await prepareTimeline(file, { fps: args.fps, width: args.width, height: args.height, lang: args.lang, burnSubtitles: args.burnSubtitles, tts: args.tts, timing: args.timing, ttsCache: args.ttsCache, timingFile }, args.quiet ? () => {} : console.error);
  if (scale !== 1) {
    timeline.meta.width = Math.round(timeline.meta.width * scale / 2) * 2;
    timeline.meta.height = Math.round(timeline.meta.height * scale / 2) * 2;
  }
  if (!args.quiet) for (const w of timeline.warnings) console.error('warning:', w);
  const { fps, width, height, duration } = timeline.meta;
  const startT = args.start != null ? Number(args.start) : 0;
  const endT = args.end != null ? Math.min(duration, Number(args.end)) : duration;
  const startFrame = args.startFrame != null ? Number(args.startFrame) : Math.floor(startT * fps);
  const endFrame = args.endFrame != null ? Number(args.endFrame) : Math.max(startFrame + 1, Math.ceil(endT * fps));
  const total = endFrame - startFrame;

  if (!out) out = path.join('out', `${timeline.meta.scriptName}.${ff?.h264 ? 'mp4' : 'webm'}`);
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  if (timeline.meta.lineDurations && args.raw !== true && !existsSync(out.replace(/\.[^.]+$/, '.timing.json'))) {
    writeFileSync(out.replace(/\.[^.]+$/, '.timing.json'), JSON.stringify({ lineDurations: timeline.meta.lineDurations }, null, 2));
  }
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const framesDir = args.frames ? path.resolve(args.frames) : null;
  if (framesDir) mkdirSync(framesDir, { recursive: true });
  // Frames go to a video-only file; finalize() adds audio and soft subtitles.
  const raw = args.raw === true;
  const videoOnly = raw ? out : out.replace(/(\.[^.]+)$/, '.video$1');

  // ---- parallel chunks ---------------------------------------------------------
  const jobs = Math.max(1, Math.floor(Number(args.jobs || 1)));
  if (jobs > 1 && ff && total >= jobs * 2) {
    console.error(`rendering ${total} frames (${width}x${height} @ ${fps}fps) in ${jobs} parallel chunks -> ${out}`);
    const chunkDir = path.resolve(path.dirname(out), `.${path.basename(out)}.chunks`);
    rmSync(chunkDir, { recursive: true, force: true });
    mkdirSync(chunkDir, { recursive: true });
    const ext = path.extname(out);
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/oceanscript.js');
    const per = Math.ceil(total / jobs);
    const chunks = [];
    for (let i = 0; i < jobs; i++) {
      const a = startFrame + i * per, b = Math.min(endFrame, a + per);
      if (a >= b) break;
      chunks.push({ i, a, b, file: path.join(chunkDir, `chunk_${String(i).padStart(2, '0')}${ext}`) });
    }
    await Promise.all(chunks.map((c) => new Promise((resolve, reject) => {
      const cargs = [cli, 'render', file, '--start-frame', String(c.a), '--end-frame', String(c.b), '-o', c.file, '--quiet', '--jobs', '1', '--raw'];
      for (const k of ['fps', 'width', 'height', 'scale', 'crf', 'preset', 'lang', 'tts']) if (args[k] != null) cargs.push(`--${k}`, String(args[k]));
      if (args.burnSubtitles) cargs.push('--burn-subtitles');
      if (timeline.meta.lineDurations) cargs.push('--timing-file', out.replace(/\.[^.]+$/, '.timing.json'));
      if (framesDir) cargs.push('--frames', framesDir);
      const child = spawn(process.execPath, cargs, { stdio: ['ignore', 'inherit', 'pipe'] });
      let last = Date.now();
      child.stderr.on('data', (d) => {
        const s = d.toString();
        if (/failed|error|warning|relaunch/i.test(s) || Date.now() - last > 15000) { process.stderr.write(`[chunk ${c.i}] ${s.trim().split('\n').pop()}\n`); last = Date.now(); }
      });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`chunk ${c.i} (frames ${c.a}-${c.b}) failed with code ${code}`))));
      child.on('error', reject);
    })));
    const list = path.join(chunkDir, 'list.txt');
    writeFileSync(list, chunks.map((c) => `file '${c.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const ffargs = ['-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'copy', '-movflags', '+faststart', videoOnly];
    await runFfmpeg(ff, ffargs).done;
    rmSync(chunkDir, { recursive: true, force: true });
    if (!raw) await finalize(timeline, videoOnly, out, args);
    console.error(`done in ${fmt((Date.now() - t0) / 1000)} -> ${out}`);
    return out;
  }

  // ---- single process --------------------------------------------------------------
  if (!args.quiet) console.error(`rendering ${total} frames (${width}x${height} @ ${fps}fps, ${(total / fps).toFixed(2)}s) -> ${args.video === false ? framesDir : out}`);
  const { cacheDir } = prepareAssets(timeline, { log: args.quiet ? () => {} : console.error });
  if (timeline.meta.lipsync !== false && args.voice !== false && timeline.meta.tts !== 'none') {
    const { attachEnvelopes } = await import('./tts.js');
    try { await attachEnvelopes(timeline, { engine: args.tts ?? timeline.meta.tts, cacheDir: args.ttsCache, log: args.quiet ? () => {} : console.error }); }
    catch (err) { console.error('warning: lip-sync envelopes unavailable:', err.message); }
  }
  const { server, url } = await startServer({
    dynamic: { '/timeline.json': () => ({ body: JSON.stringify(timeline) }) },
    extraRoots: { '/script/': timeline.meta.scriptDir, '/cache/': cacheDir },
  });
  const rp = new RenderPage(url, width, height, !!args.headed);
  const gl = await rp.open();
  if (!args.quiet) console.error(`webgl: ${gl}`);

  let ffmpeg = null;
  if (ff) {
    const ffargs = ['-f', 'image2pipe', '-framerate', String(fps), '-i', '-', ...videoArgs(ff, out, args), videoOnly];
    ffmpeg = runFfmpeg(ff, ffargs, { stdin: 'pipe' });
    ffmpeg.proc.stdin.on('error', () => {});
  }
  const write = (buf) => new Promise((resolve) => { if (!ffmpeg) return resolve(); if (!ffmpeg.proc.stdin.write(buf)) ffmpeg.proc.stdin.once('drain', resolve); else resolve(); });

  let lastLog = Date.now();
  const tStart = Date.now();
  try {
    for (let i = startFrame; i < endFrame; i++) {
      const png = await rp.captureWithRetry(i / fps);
      if (framesDir) writeFileSync(path.join(framesDir, `frame_${String(i).padStart(6, '0')}.png`), png);
      await write(png);
      const done = i - startFrame + 1;
      if (Date.now() - lastLog > 3000 || done === total) {
        const el = (Date.now() - tStart) / 1000;
        const rate = done / el;
        console.error(`  frame ${done}/${total} (${(100 * done / total).toFixed(1)}%)  ${rate.toFixed(1)} fps  eta ${fmt((total - done) / Math.max(rate, 1e-6))}`);
        lastLog = Date.now();
      }
    }
  } finally {
    if (ffmpeg) ffmpeg.proc.stdin.end();
    await rp.close();
    server.close();
  }
  if (ffmpeg) await ffmpeg.done;
  if (ff && !raw) await finalize(timeline, videoOnly, out, args);
  if (!args.quiet) console.error(`done in ${fmt((Date.now() - t0) / 1000)}${ff ? ` -> ${out}` : ''}`);
  return out;
}

function fmt(s) { s = Math.round(s); return s >= 3600 ? `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`; }
