#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTimeline } from '../src/load.js';

const HELP = `oceanscript – render 3D ocean animations from a markdown screenplay

usage:
  oceanscript parse   <script.md> [-o timeline.json]     compile and print the timeline
  oceanscript render  <script.md> [options]              render to a video
  oceanscript preview <script.md> [--port N]             live preview in a browser
  oceanscript check   <script.md>                        validate and list warnings
  oceanscript voices  <script.md> [--lang he] [--phonetic]  synthesise the voices, transcribe them back with Whisper and flag lines that do not read as written
  oceanscript subtitles <script.md> [--lang he] [--speakers] [-o base]  write <base>.srt and .vtt from the script (no video needed)
  oceanscript mux     <script.md> --video <file> [--lang he] [-o out]
                                                         add voice + subtitles in another language to an
                                                         existing render (frames are identical, so no re-render)

render options:
  -o, --out <file>        output video (default: out/<name>.mp4)
  --fps <n>               frames per second (default: front matter or 24)
  --width <n> --height <n>
  --scale <f>             scale resolution (0.5 = quick preview)
  --start <s> --end <s>   render only part of the timeline (seconds)
  --frames <dir>          also keep PNG frames in this directory
  --no-video              only write frames
  --audio <file>          mux an audio file (or set audio: in front matter)
  --crf <n>               x264 quality (default 18)
  --lang <code>           language for subtitles, title cards and voice (default: script's lang)
  --burn-subtitles        draw subtitles into the frames instead of a soft subtitle track
  --no-voice              skip the text-to-speech voice track
  --tts <engine>          edge (default when installed), gtts, none
  --timing audio          let voice clip lengths set the dialog durations (changes the video!)
  --music <file>          background music mixed under the voices
  --jobs <n>              render in n parallel browser processes and concatenate
  --headed                show the browser while rendering
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a.startsWith('--no-')) args[camel(a.slice(5))] = false;
    else if (a.startsWith('--')) {
      const key = camel(a.slice(2));
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) { args[key] = next; i++; } else args[key] = true;
    } else args._.push(a);
  }
  return args;
}
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const file = args._[1];
  if (!cmd || args.help || (cmd !== 'help' && !file)) { console.log(HELP); process.exit(cmd ? 1 : 0); }
  const opts = {};
  if (args.fps) opts.fps = Number(args.fps);
  if (args.width) opts.width = Number(args.width);
  if (args.height) opts.height = Number(args.height);
  if (args.lang) opts.lang = String(args.lang);
  if (args.burnSubtitles) opts.burnSubtitles = true;
  if (args.tts) opts.tts = String(args.tts);
  if (args.timing) opts.timing = String(args.timing);

  if (cmd === 'parse' || cmd === 'check') {
    const { prepareTimeline } = await import('../src/timing.js');
    const timeline = args.noTiming ? loadTimeline(file, opts) : await prepareTimeline(file, { ...opts, timingFile: args.timingFile }, (m) => console.error(m));
    for (const w of timeline.warnings) console.error('warning:', w);
    if (cmd === 'check') {
      console.log(`ok: ${timeline.meta.duration.toFixed(2)}s, ${timeline.meta.frames} frames @ ${timeline.meta.fps}fps, ${Object.keys(timeline.actors).length} actors, ${timeline.subtitles.length} subtitles, ${timeline.markers.filter((m) => m.kind === 'scene').length} scenes, lang ${timeline.meta.lang} (available: ${[...new Set(timeline.subtitles.flatMap((s) => Object.keys(s.texts || {})))].join(', ')})`);
      for (const m of timeline.markers) if (m.kind === 'scene') console.log(`  ${m.t.toFixed(2).padStart(8)}s  ${m.label}`);
      return;
    }
    const json = JSON.stringify(timeline, null, 2);
    if (args.out) { mkdirSync(path.dirname(args.out), { recursive: true }); writeFileSync(args.out, json); console.error(`wrote ${args.out}`); }
    else process.stdout.write(json + '\n');
    return;
  }
  if (cmd === 'render') {
    const { render } = await import('../src/render.js');
    await render(file, { ...opts, ...args });
    return;
  }
  if (cmd === 'subtitles') {
    const { prepareTimeline } = await import('../src/timing.js');
    const { toSrt, toVtt } = await import('../src/subtitles.js');
    const timeline = await prepareTimeline(file, { ...opts, timingFile: args.timingFile }, (m) => console.error(m));
    const base = (args.out ? String(args.out) : file.replace(/\.md$/, '') + `.${timeline.meta.lang}`).replace(/\.(srt|vtt)$/, '');
    const subOpts = { speakers: args.speakers != null ? !!args.speakers : undefined };
    writeFileSync(`${base}.srt`, toSrt(timeline, null, subOpts));
    writeFileSync(`${base}.vtt`, toVtt(timeline, null, subOpts));
    console.error(`wrote ${base}.srt, ${base}.vtt (${timeline.subtitles.length} cues, speakers ${subOpts.speakers ?? timeline.meta.subtitleSpeakers ? 'on' : 'off'})`);
    return;
  }
  if (cmd === 'voices') {
    const { prepareTimeline } = await import('../src/timing.js');
    const { synthesizeAll, writeManifest } = await import('../src/tts.js');
    const { spawnSync } = await import('node:child_process');
    const timeline = await prepareTimeline(file, { ...opts, timingFile: args.timingFile }, (m) => console.error(m));
    const res = await synthesizeAll(timeline, { engine: opts.tts ?? timeline.meta.tts, cacheDir: args.ttsCache, log: (m) => console.error(m) });
    const manifest = file.replace(/\.md$/, '') + `.${timeline.meta.lang}.voice.json`;
    writeManifest(res.clips, manifest);
    console.error(`wrote ${manifest} (${res.clips.length} clips)`);
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-voices.py');
    const r = spawnSync('python3', [script, manifest, '--lang', timeline.meta.lang, ...(args.phonetic ? ['--phonetic'] : []), ...(args.model ? ['--model', String(args.model)] : [])], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  if (cmd === 'mux') {
    const { muxCommand } = await import('../src/mux.js');
    await muxCommand(file, { ...opts, ...args });
    return;
  }
  if (cmd === 'preview') {
    const { preview } = await import('../src/preview.js');
    await preview(file, { ...opts, ...args });
    return;
  }
  console.log(HELP);
  process.exit(1);
}

main().catch((err) => { console.error(err.stack || String(err)); process.exit(1); });
