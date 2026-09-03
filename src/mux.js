// Finalises a rendered (video-only) file: writes SRT/VTT sidecars, builds the
// voice track and muxes audio + a soft subtitle track into the output.
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findFfmpeg } from './ffmpeg.js';
import { toSrt, toVtt, langCode3 } from './subtitles.js';
import { synthesizeAll, mixTrack, writeManifest } from './tts.js';

export async function finalize(timeline, videoFile, out, args = {}, log = console.error) {
  const ff = findFfmpeg();
  const isMp4 = /\.(mp4|m4v|mov)$/i.test(out);
  const lang = timeline.meta.lang;
  const base = out.replace(/\.[^.]+$/, '');
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  // subtitles
  const range = args.range || null;
  const srt = `${base}.srt`, vtt = `${base}.vtt`;
  writeFileSync(srt, toSrt(timeline, range));
  writeFileSync(vtt, toVtt(timeline, range));
  log(`subtitles: ${srt}, ${vtt}`);

  // audio: voice + music
  let audio = null;
  const wantVoice = args.voice !== false && timeline.meta.tts !== 'none';
  const music = args.music ?? (timeline.meta.music ? path.resolve(timeline.meta.scriptDir, timeline.meta.music) : null);
  const extAudio = args.audio ?? (timeline.meta.audio ? path.resolve(timeline.meta.scriptDir, timeline.meta.audio) : null);
  if (extAudio) {
    if (!existsSync(extAudio)) throw new Error(`audio file not found: ${extAudio}`);
    audio = extAudio;
  } else {
    let clips = [];
    if (wantVoice) {
      const res = await synthesizeAll(timeline, { engine: args.ttsEngine ?? timeline.meta.tts, cacheDir: args.ttsCache, log });
      clips = res.clips;
      if (clips.length) writeManifest(clips, `${base}.voice.json`);
    }
    const resolveAsset = (f) => path.resolve(timeline.meta.scriptDir, f);
    const hasMusic = music || (timeline.music || []).length || (timeline.sounds || []).length || (timeline.overlays || []).some((o) => o.type === 'clip');
    if (clips.length || hasMusic) {
      audio = `${base}.audio.wav`;
      mixTrack(timeline, clips, audio, { music, musicVolume: timeline.meta.musicVolume, resolveAsset, range, log });
    }
  }

  // mux
  const ffargs = ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoFile];
  if (audio) ffargs.push('-i', audio);
  const subIn = ffargs.length / 2 - 1;
  if (!args.noSubTrack) ffargs.push('-i', srt);
  ffargs.push('-map', '0:v:0');
  if (audio) ffargs.push('-map', '1:a:0');
  if (!args.noSubTrack) ffargs.push('-map', `${audio ? 2 : 1}:s:0`);
  ffargs.push('-c:v', 'copy');
  if (audio) ffargs.push('-c:a', isMp4 ? 'aac' : 'libopus', '-b:a', '160k', `-metadata:s:a:0`, `language=${langCode3(lang)}`);
  if (!args.noSubTrack) ffargs.push('-c:s', isMp4 ? 'mov_text' : 'webvtt', `-metadata:s:s:0`, `language=${langCode3(lang)}`, `-metadata:s:s:0`, `title=${lang}`);
  if (isMp4) ffargs.push('-movflags', '+faststart');
  const tmp = `${base}.muxing${path.extname(out)}`;
  ffargs.push(tmp);
  const r = spawnSync(ff.path, ffargs, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg mux failed: ${r.stderr}`);
  if (path.resolve(tmp) !== path.resolve(out)) { rmSync(out, { force: true }); renameSync(tmp, out); }
  if (audio && audio.endsWith('.audio.wav') && !args.keepAudio) rmSync(audio, { force: true });
  log(`muxed ${audio ? 'audio + ' : ''}${args.noSubTrack ? '' : `soft subtitles (${lang}) `}-> ${out}`);
  return out;
}

// `oceanscript mux`: re-localise an existing render without re-rendering frames.
export async function muxCommand(scriptFile, args) {
  const { prepareTimeline } = await import('./timing.js');
  const video = args.video;
  if (!video || !existsSync(video)) throw new Error('mux needs --video <rendered file>');
  const guess = video.replace(/\.video(\.[^.]+)$/, '$1').replace(/\.[^.]+$/, '.timing.json');
  const outGuess = args.out || video.replace(/(\.[^.]+)$/, `.${args.lang || 'x'}$1`);
  const timingFile = args.timingFile ?? (existsSync(guess) ? guess : outGuess.replace(/\.[^.]+$/, '.timing.json'));
  const timeline = await prepareTimeline(scriptFile, { lang: args.lang, tts: args.tts, timing: args.timing, timingFile });
  for (const w of timeline.warnings) console.error('warning:', w);
  const out = args.out || video.replace(/(\.[^.]+)$/, `.${timeline.meta.lang}$1`);
  if (path.resolve(out) === path.resolve(video)) {
    const copy = video.replace(/(\.[^.]+)$/, '.video$1');
    copyFileSync(video, copy);
    return finalize(timeline, copy, out, args);
  }
  return finalize(timeline, video, out, args);
}
