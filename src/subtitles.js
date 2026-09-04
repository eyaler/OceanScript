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
export function cues(timeline, range = null, opts = {}) {
  const start = range ? range.start : 0;
  const end = range ? range.end : Infinity;
  const prefix = wantSpeakers(timeline, opts);
  return timeline.subtitles
    .filter((s) => s.text && s.t1 > start && s.t0 < end)
    .map((s) => ({ t0: Math.max(0, s.t0 - start), t1: Math.min(end, s.t1) - start, text: prefix && s.kind === 'dialog' && s.speaker ? `${s.speaker}: ${s.text}` : s.text, kind: s.kind }))
    .sort((a, b) => a.t0 - b.t0);
}

export function toSrt(timeline, range = null, opts = {}) {
  return cues(timeline, range, opts).map((c, i) => `${i + 1}\n${ts(c.t0, ',')} --> ${ts(c.t1, ',')}\n${c.text}\n`).join('\n') + '\n';
}

export function toVtt(timeline, range = null, opts = {}) {
  return 'WEBVTT\n\n' + cues(timeline, range, opts).map((c, i) => `${i + 1}\n${ts(c.t0, '.')} --> ${ts(c.t1, '.')}\n${c.kind === 'narration' ? `<i>${c.text}</i>` : c.text}\n`).join('\n') + '\n';
}
