// Text-to-speech voice track: synthesises every spoken subtitle with a
// per-character voice, caches the clips, and mixes them at their timeline
// positions (speeding a clip up slightly when it is longer than its slot).
//
// Engines: `edge` (Microsoft Edge neural voices via the edge-tts Python CLI,
// many languages incl. Hebrew, per-voice pitch/rate), `gtts` (Google
// Translate voice via gTTS, one voice per language, pitch-shifted per
// character with ffmpeg), `none`.
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findFfmpeg } from './ffmpeg.js';

const DEFAULT_VOICES = {
  edge: {
    en: { narrator: 'en-US-GuyNeural', female: 'en-US-JennyNeural', male: 'en-US-ChristopherNeural', child: 'en-US-AnaNeural' },
    he: { narrator: 'he-IL-AvriNeural', female: 'he-IL-HilaNeural', male: 'he-IL-AvriNeural', child: 'he-IL-HilaNeural' },
    ar: { narrator: 'ar-EG-ShakirNeural', female: 'ar-EG-SalmaNeural', male: 'ar-EG-ShakirNeural', child: 'ar-EG-SalmaNeural' },
    fr: { narrator: 'fr-FR-HenriNeural', female: 'fr-FR-DeniseNeural', male: 'fr-FR-HenriNeural', child: 'fr-FR-EloiseNeural' },
    de: { narrator: 'de-DE-ConradNeural', female: 'de-DE-KatjaNeural', male: 'de-DE-ConradNeural', child: 'de-DE-KatjaNeural' },
    es: { narrator: 'es-ES-AlvaroNeural', female: 'es-ES-ElviraNeural', male: 'es-ES-AlvaroNeural', child: 'es-ES-ElviraNeural' },
  },
};
const GTTS_LANG = { he: 'iw', iw: 'iw' };

function which(cmd) { const r = spawnSync('which', [cmd], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; }
function pyHas(mod) { return spawnSync('python3', ['-c', `import ${mod}`], { stdio: 'ignore' }).status === 0; }

export function detectEngine(preferred = 'auto') {
  if (preferred && preferred !== 'auto') return preferred;
  if (which('edge-tts') || pyHas('edge_tts')) return 'edge';
  if (pyHas('gtts')) return 'gtts';
  return 'none';
}

function proxyArgs() {
  const p = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY;
  return p ? ['--proxy', p] : [];
}

function pickVoice(engine, lang, sub, cast) {
  const l = lang.split('-')[0];
  const explicit = sub.voice;
  const owner = sub.voiceOwner ? cast[sub.voiceOwner] : null;
  const defaults = DEFAULT_VOICES[engine]?.[l] || DEFAULT_VOICES.edge?.[l] || DEFAULT_VOICES.edge.en;
  let name = explicit?.voice || null;
  if (!name) {
    if (sub.kind === 'narration') name = defaults.narrator;
    else if (owner && owner.size <= 0.8) name = defaults.child;
    else if (owner && /(mother|mom|mama|queen|girl|sister|אמא|מלכה)/i.test(owner.name + ' ' + owner.label)) name = defaults.female;
    else name = defaults.male;
  }
  return { voice: name, pitch: explicit?.pitch ?? 0, rate: explicit?.rate ?? 0 };
}

function probeDuration(ff, file) {
  const r = spawnSync(ff.path, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function synthesize(engine, text, v, lang, outFile) {
  if (engine === 'edge') {
    const args = [...proxyArgs(), '--voice', v.voice, '--text', text, '--write-media', outFile];
    if (v.pitch) args.push(`--pitch=${v.pitch >= 0 ? '+' : ''}${Math.round(v.pitch)}Hz`);
    if (v.rate) args.push(`--rate=${v.rate >= 0 ? '+' : ''}${Math.round(v.rate)}%`);
    const cmd = which('edge-tts') ? ['edge-tts', args] : ['python3', ['-m', 'edge_tts', ...args]];
    const r = spawnSync(cmd[0], cmd[1], { encoding: 'utf8', env: { ...process.env, SSL_CERT_FILE: process.env.SSL_CERT_FILE || '/root/.ccr/ca-bundle.crt' } });
    if (r.status !== 0 || !existsSync(outFile) || statSync(outFile).size === 0) throw new Error(`edge-tts failed: ${(r.stderr || '').trim().split('\n').pop()}`);
    return;
  }
  if (engine === 'gtts') {
    const gl = GTTS_LANG[lang.split('-')[0]] || lang.split('-')[0];
    const r = spawnSync('python3', ['-c', 'import sys; from gtts import gTTS; gTTS(sys.argv[1], lang=sys.argv[2]).save(sys.argv[3])', text, gl, outFile], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`gTTS failed: ${(r.stderr || '').trim().split('\n').pop()}`);
    return;
  }
  throw new Error(`unknown tts engine ${engine}`);
}

/**
 * Synthesises all spoken subtitles.  Returns { engine, clips: [{sub, file, duration, voice}] }.
 */
export async function synthesizeAll(timeline, { engine = 'auto', cacheDir, log = console.error } = {}) {
  engine = detectEngine(engine);
  if (engine === 'none') return { engine, clips: [] };
  const ff = findFfmpeg();
  if (!ff) throw new Error('ffmpeg is required for the voice track');
  cacheDir = cacheDir || path.join('out', '.tts-cache');
  mkdirSync(cacheDir, { recursive: true });
  const lang = timeline.meta.lang;
  const clips = [];
  const spoken = timeline.subtitles.filter((s) => s.spoken && s.text);
  let made = 0;
  for (const sub of spoken) {
    const v = pickVoice(engine, lang, sub, timeline.cast);
    const key = createHash('sha1').update(JSON.stringify([engine, lang, v, sub.text])).digest('hex').slice(0, 16);
    const file = path.join(cacheDir, `${key}.mp3`);
    if (!existsSync(file) || statSync(file).size === 0) {
      await synthesize(engine, sub.text, v, lang, file);
      made++;
    }
    const duration = probeDuration(ff, file);
    if (!duration) throw new Error(`could not read duration of ${file}`);
    clips.push({ sub, file, duration, voice: v });
  }
  log(`tts (${engine}, ${lang}): ${clips.length} lines, ${made} synthesised, ${clips.length - made} cached`);
  return { engine, clips };
}

/**
 * Mixes clips (and optional music) into one audio file spanning the timeline.
 * A clip longer than its subtitle slot is sped up (atempo, max 1.45x); if it
 * still overflows the slot a warning is logged.
 */
export function mixTrack(timeline, clips, outFile, { music = null, musicVolume = 0.25, voiceVolume = 1, log = console.error } = {}) {
  const ff = findFfmpeg();
  const duration = timeline.meta.duration;
  const inputs = [];
  const filters = [];
  const mixed = [];
  clips.forEach((c, i) => {
    const slot = c.sub.t1 - c.sub.t0;
    let tempo = 1;
    if (c.duration > slot + 0.2) {
      tempo = Math.min(1.45, c.duration / slot);
      const fitted = c.duration / tempo;
      if (fitted > slot + 0.4) log(`warning: line ${c.sub.line} voice (${c.duration.toFixed(1)}s) overflows its ${slot.toFixed(1)}s slot even at ${tempo.toFixed(2)}x: "${c.sub.text.slice(0, 40)}"`);
    }
    inputs.push('-i', c.file);
    const chain = [`aresample=48000`, `aformat=channel_layouts=stereo`];
    if (Math.abs(tempo - 1) > 0.01) chain.push(`atempo=${tempo.toFixed(4)}`);
    chain.push(`volume=${voiceVolume}`, `adelay=${Math.round(c.sub.t0 * 1000)}|${Math.round(c.sub.t0 * 1000)}`);
    filters.push(`[${i}:a]${chain.join(',')}[v${i}]`);
    mixed.push(`[v${i}]`);
  });
  if (music) {
    const idx = clips.length;
    inputs.push('-stream_loop', '-1', '-i', music);
    filters.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${musicVolume},atrim=0:${duration.toFixed(3)}[m]`);
    mixed.push('[m]');
  }
  if (mixed.length === 0) {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${duration.toFixed(3)}[out]`);
  } else {
    filters.push(`${mixed.join('')}amix=inputs=${mixed.length}:normalize=0:duration=longest,apad,atrim=0:${duration.toFixed(3)}[out]`);
  }
  const args = ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', outFile];
  const r = spawnSync(ff.path, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg mix failed: ${r.stderr}`);
  return outFile;
}

// Writes a JSON manifest next to the audio (useful for inspection / lip-sync work).
export function writeManifest(clips, file) {
  writeFileSync(file, JSON.stringify(clips.map((c) => ({ t0: c.sub.t0, slot: c.sub.t1 - c.sub.t0, duration: c.duration, speaker: c.sub.speaker, kind: c.sub.kind, voice: c.voice, text: c.sub.text, clip: c.file })), null, 2));
}
