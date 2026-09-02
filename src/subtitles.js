// SRT / WebVTT writers for the timeline's subtitle track.
const ISO639_2 = { en: 'eng', he: 'heb', iw: 'heb', ar: 'ara', fr: 'fre', de: 'ger', es: 'spa', it: 'ita', pt: 'por', ru: 'rus', ja: 'jpn', zh: 'chi', ko: 'kor', nl: 'dut', pl: 'pol', tr: 'tur', sv: 'swe', el: 'gre', hi: 'hin', yi: 'yid' };
export function langCode3(lang) { return ISO639_2[String(lang).toLowerCase().split('-')[0]] || 'und'; }

function ts(sec, sep) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), f = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(f).padStart(3, '0')}`;
}

// Subtitle cues: one per subtitle entry, speaker prefixed for dialog.
export function cues(timeline) {
  return timeline.subtitles
    .filter((s) => s.text)
    .map((s) => ({ t0: s.t0, t1: s.t1, text: s.kind === 'dialog' && s.speaker ? `${s.speaker}: ${s.text}` : s.text, kind: s.kind }))
    .sort((a, b) => a.t0 - b.t0);
}

export function toSrt(timeline) {
  return cues(timeline).map((c, i) => `${i + 1}\n${ts(c.t0, ',')} --> ${ts(c.t1, ',')}\n${c.text}\n`).join('\n') + '\n';
}

export function toVtt(timeline) {
  return 'WEBVTT\n\n' + cues(timeline).map((c, i) => `${i + 1}\n${ts(c.t0, '.')} --> ${ts(c.t1, '.')}\n${c.kind === 'narration' ? `<i>${c.text}</i>` : c.text}\n`).join('\n') + '\n';
}
