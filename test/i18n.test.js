import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/parser.js';
import { compile } from '../src/compile.js';
import { toSrt, toVtt } from '../src/subtitles.js';

const SRC = `---
lang: en
---
# Cast
- narrator: voice "en-US-GuyNeural"
  he: voice "he-IL-AvriNeural"
- caspion: fish, label "Caspion", voice "en-US-AnaNeural" pitch 10
  he: label "כספיון", voice "he-IL-HilaNeural" pitch 30 rate 8
- mother (Mother Whale): whale
  he: label "אמא לווייתנית"
# Scene: S
- title "Caspion" for 2s
  he: כספיון
@caspion appears at (0, -3, 0)
**Caspion:** Hello there, everybody!
  he: שלום לכולם!
**Mother Whale:** Welcome.
> Narrator: Once upon a time.
  he: היה היה.
- caption "Text" for 1s
  he: טקסט
`;

test('translations attach to lines and cast, source language sets the timing', () => {
  const en = compile(parseScript(SRC));
  const he = compile(parseScript(SRC), { lang: 'he' });
  assert.equal(en.meta.lang, 'en'); assert.equal(he.meta.lang, 'he');
  assert.deepEqual(en.subtitles.map((s) => [s.t0, s.t1]), he.subtitles.map((s) => [s.t0, s.t1]));
  assert.deepEqual(en.actors, he.actors);
  assert.equal(he.subtitles[0].text, 'שלום לכולם!'); assert.equal(he.subtitles[0].speaker, 'כספיון');
  assert.equal(he.subtitles[0].texts.en, 'Hello there, everybody!');
  assert.equal(he.subtitles[1].text, 'Welcome.');                      // untranslated line falls back
  assert.equal(he.subtitles[1].actor, 'mother');                       // resolved through the English label
  assert.equal(he.subtitles[1].speaker, 'אמא לווייתנית');
  assert.equal(he.subtitles[2].kind, 'narration'); assert.equal(he.subtitles[2].voiceOwner, 'narrator');
  assert.deepEqual(he.subtitles[2].voice, { voice: 'he-IL-AvriNeural', pitch: 0, rate: 0 });
  assert.deepEqual(he.subtitles[0].voice, { voice: 'he-IL-HilaNeural', pitch: 30, rate: 8 });
  assert.equal(he.subtitles[3].spoken, false);                          // captions are not voiced
  assert.equal(he.overlays[0].text, 'כספיון'); assert.equal(en.overlays[0].text, 'Caspion');
  assert.equal(he.cast.narrator.kind, 'narrator');
  assert.ok(!('narrator' in he.actors));
  assert.equal(en.meta.burnSubtitles, false);
});

test('srt and vtt output', () => {
  const he = compile(parseScript(SRC), { lang: 'he' });
  const srt = toSrt(he);
  assert.match(srt, /^1\n00:00:02,000 --> 00:00:0\d,\d{3}\nכספיון: שלום לכולם!\n/);
  assert.match(srt, /\nהיה היה\.\n/);
  const vtt = toVtt(he);
  assert.ok(vtt.startsWith('WEBVTT'));
  assert.match(vtt, /<i>היה היה\.<\/i>/);
});
