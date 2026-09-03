// Audio-driven timing: when a script uses `timing: audio`, every spoken line's
// slot is the longest voice clip among all available languages plus padding.
// The resulting per-line durations are shared by every language (and every
// chunk of a parallel render), so the frames stay identical across languages.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadTimeline } from './load.js';
import { synthesizeAll } from './tts.js';

const PAD = 0.45;      // seconds of air after each clip
const MIN_SLOT = 1.2;

export function availableLanguages(timeline) {
  const langs = new Set([timeline.meta.sourceLang]);
  for (const s of timeline.subtitles) for (const l of Object.keys(s.texts || {})) langs.add(l);
  return [...langs];
}

/**
 * Resolves line durations from the voice clips of every language.
 * Returns { lineDurations, languages, engine }.
 */
export async function resolveLineDurations(file, opts = {}, log = console.error) {
  const base = loadTimeline(file, { ...opts, lineDurations: undefined, lang: undefined });
  const langs = availableLanguages(base);
  const lineDurations = {};
  let engine = 'none';
  for (const lang of langs) {
    const tl = loadTimeline(file, { ...opts, lineDurations: undefined, lang });
    const res = await synthesizeAll(tl, { engine: opts.tts ?? tl.meta.tts, cacheDir: opts.ttsCache, log });
    engine = res.engine;
    if (res.engine === 'none') break;
    for (const c of res.clips) {
      const need = Math.max(MIN_SLOT, c.duration + PAD);
      lineDurations[c.sub.key] = Math.max(lineDurations[c.sub.key] ?? 0, need);
    }
  }
  return { lineDurations, languages: langs, engine };
}

/**
 * Loads the timeline for rendering/muxing, applying audio timing when the
 * script asks for it.  `opts.timingFile` reads/writes the resolved durations
 * so a later `mux` (or a parallel chunk) uses exactly the same timing.
 */
export async function prepareTimeline(file, opts = {}, log = console.error) {
  let timeline = loadTimeline(file, opts);
  if (timeline.meta.timing !== 'audio') return timeline;
  let lineDurations = null;
  // A committed `<script>.timing.json` next to the script pins the timing for every render.
  const pinned = file.replace(/\.md$/i, '.timing.json');
  if (!opts.timingFile && existsSync(pinned)) opts = { ...opts, timingFile: pinned };
  if (opts.timingFile && existsSync(opts.timingFile)) {
    lineDurations = JSON.parse(readFileSync(opts.timingFile, 'utf8')).lineDurations;
    log(`timing: using ${opts.timingFile}`);
  } else {
    const res = await resolveLineDurations(file, opts, log);
    lineDurations = res.lineDurations;
    if (res.engine === 'none') { log('timing: audio requested but no TTS engine is available; using text timing'); return timeline; }
    log(`timing: audio, ${Object.keys(lineDurations).length} spoken lines sized by the longest clip across ${res.languages.join(', ')}`);
    if (opts.timingFile) writeFileSync(opts.timingFile, JSON.stringify({ languages: res.languages, lineDurations }, null, 2));
  }
  timeline = loadTimeline(file, { ...opts, lineDurations });
  timeline.meta.lineDurations = lineDurations;
  return timeline;
}
