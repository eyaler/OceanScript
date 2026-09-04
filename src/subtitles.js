// SRT / WebVTT writers for the timeline's subtitle track.
const ISO639_2 = { en: 'eng', he: 'heb', iw: 'heb', ar: 'ara', fr: 'fre', de: 'ger', es: 'spa', it: 'ita', pt: 'por', ru: 'rus', ja: 'jpn', zh: 'chi', ko: 'kor', nl: 'dut', pl: 'pol', tr: 'tur', sv: 'swe', el: 'gre', hi: 'hin', yi: 'yid' };
export function langCode3(lang) { return ISO639_2[String(lang).toLowerCase().split('-')[0]] || 'und'; }

function ts(sec, sep) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), f = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(f).padStart(3, '0')}`;
}

// Subtitle cues: one per subtitle entry.  Dialog is prefixed with the speaker
// only when asked (`subtitle_speakers: on` in the front matter or `--speakers`).
export function wantSpeakers(timeline, opts = {}) {
  if (opts.speakers != null) return !!opts.speakers;
  const v = timeline.meta.subtitleSpeakers;
  return v === true || v === 'on' || v === 'yes';
}
// Readable cues: at most two lines of about MAX_LINE characters.  A long line
// is split at sentence and clause boundaries into several cues that share the
// line's time in proportion to their length (never shorter than MIN_CUE).
const MAX_LINE = 40;
const MIN_CUE = 1.0;
function wrapLines(text, max = MAX_LINE) {
  const words = text.split(/\s+/).filter(Boolean);
  if (text.length <= max || words.length < 2) return [text];
  // balanced two-line break closest to the middle, preferring a punctuation mark
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    if (a.length > max || b.length > max) continue;
    const score = Math.abs(a.length - b.length) - (/[,.!?…:;]$/.test(a) ? 8 : 0);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  if (best) return best.lines;
  // no split keeps both halves under the limit: break at the word nearest the middle
  let cut = 1, bestD = Infinity;
  for (let i = 1; i < words.length; i++) { const d = Math.abs(words.slice(0, i).join(' ').length - text.length / 2); if (d < bestD) { bestD = d; cut = i; } }
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}
function splitChunks(text, max = MAX_LINE * 2) {
  if (text.length <= max) return [text];
  // sentence boundaries first, then clauses, then plain word packing
  const units = text.match(/[^.!?…]+[.!?…]*\s*/g)?.map((u) => u.trim()).filter(Boolean) || [text];
  const pieces = [];
  for (const u of units) {
    if (u.length <= max) { pieces.push(u); continue; }
    const clauses = u.match(/[^,;:]+[,;:]*\s*/g)?.map((c) => c.trim()).filter(Boolean) || [u];
    for (const c of clauses) {
      if (c.length <= max) { pieces.push(c); continue; }
      let cur = '';
      for (const w of c.split(/\s+/)) { if ((cur + ' ' + w).trim().length > max && cur) { pieces.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
      if (cur) pieces.push(cur);
    }
  }
  // pack pieces greedily into chunks of at most `max` characters
  const chunks = [];
  let cur = '';
  for (const p of pieces) {
    if ((cur + ' ' + p).trim().length > max && cur) { chunks.push(cur); cur = p; } else cur = (cur + ' ' + p).trim();
  }
  if (cur) chunks.push(cur);
  return chunks;
}
export function cues(timeline, range = null, opts = {}) {
  const start = range ? range.start : 0;
  const end = range ? range.end : Infinity;
  const prefix = wantSpeakers(timeline, opts);
  const out = [];
  for (const s of timeline.subtitles) {
    if (!s.text || s.t1 <= start || s.t0 >= end) continue;
    const t0 = Math.max(0, s.t0 - start), t1 = Math.min(end, s.t1) - start;
    const chunks = splitChunks(s.text);
    const total = chunks.reduce((a, c) => a + c.length, 0) || 1;
    let t = t0;
    chunks.forEach((c, i) => {
      const share = (t1 - t0) * (c.length / total);
      const c0 = t, c1 = i === chunks.length - 1 ? t1 : Math.min(t1, t + Math.max(MIN_CUE, share));
      t = c1;
      const lines = wrapLines(i === 0 && prefix && s.kind === 'dialog' && s.speaker ? `${s.speaker}: ${c}` : c);
      out.push({ t0: c0, t1: c1, text: lines.join('\n'), kind: s.kind });
    });
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

export function toSrt(timeline, range = null, opts = {}) {
  return cues(timeline, range, opts).map((c, i) => `${i + 1}\n${ts(c.t0, ',')} --> ${ts(c.t1, ',')}\n${c.text}\n`).join('\n') + '\n';
}

export function toVtt(timeline, range = null, opts = {}) {
  // `line:90%` keeps the cue near the bottom of the frame in every player
  return 'WEBVTT\n\n' + cues(timeline, range, opts).map((c, i) => `${i + 1}\n${ts(c.t0, '.')} --> ${ts(c.t1, '.')} line:90% align:center\n${c.kind === 'narration' ? `<i>${c.text}</i>` : c.text}\n`).join('\n') + '\n';
}
