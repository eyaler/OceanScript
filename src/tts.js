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
import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (which('edge-tts') || pyHas('edge_tts')) return 'edge';
  if (pyHas('gtts')) return 'gtts';
  return 'none';
}

// ---- Hebrew vowel pointing (nikud) -------------------------------------------
// Unpointed Hebrew is ambiguous, so TTS engines mispronounce many words.  Before
// synthesis, Hebrew lines are sent to Dicta's Nakdan service (cached) and the
// vocalised text is spoken instead.  Authors can override any line with a
// `he-tts:` continuation line (pointed text or phonetic respelling).
const NAKDAN_URL = process.env.NAKDAN_URL || 'https://nakdan-5-3.loadbalancer.dicta.org.il/api';
export function stripNikud(text) { return text.replace(/[\u0591-\u05C7]/g, ''); }
export async function addNikud(text, cacheDir) {
  if (!/[\u05D0-\u05EA]/.test(text)) return text;
  if (/[\u05B0-\u05C7]/.test(text)) return text; // already pointed by the author
  const key = createHash('sha1').update('nakdan|' + text).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${key}.nikud.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).pointed;
  const body = JSON.stringify({ task: 'nakdan', data: text, genre: 'modern', addmorph: false, keepmetagim: false, keepqq: false, nodageshdefmem: false, patachma: false });
  const r = spawnSync('curl', ['-sS', '-m', '40', '-H', 'Content-Type: application/json', '-d', body, NAKDAN_URL], { encoding: 'utf8', env: { ...process.env, SSL_CERT_FILE: process.env.SSL_CERT_FILE || '/root/.ccr/ca-bundle.crt' } });
  let pointed = text;
  try {
    const tokens = JSON.parse(r.stdout);
    pointed = tokens.map((t) => (t.sep || !t.options || !t.options.length) ? t.word : t.options[0].replace(/\|/g, '')).join('');
  } catch { return text; }
  writeFileSync(file, JSON.stringify({ text, pointed }));
  return pointed;
}

// Pronunciation glossary: `- word: pointed` entries from a `# Pronunciation`
// section.  Every occurrence of the bare word is replaced by the pointed form,
// also when it carries Hebrew prefix letters (ו, ה, ב, כ, ל, מ, ש), so the
// pronunciation is consistent across the script.
const HEB_PREFIX = '[וּהבכלמש]{0,3}';
// Second-person Hebrew homographs whose pointing depends on the addressee's gender.
export const HEBREW_DEFAULT_GLOSSARY = {
  'לך|to:m': 'לְךָ', 'לך|to:f': 'לָךְ',
  'אותך|to:m': 'אוֹתְךָ', 'אותך|to:f': 'אוֹתָךְ',
  'שלך|to:m': 'שֶׁלְּךָ', 'שלך|to:f': 'שֶׁלָּךְ',
  'איתך|to:m': 'אִתְּךָ', 'איתך|to:f': 'אִתָּךְ',
  'עליך|to:m': 'עָלֶיךָ', 'עליך|to:f': 'עָלַיִךְ',
  'בשבילך|to:m': 'בִּשְׁבִילְךָ', 'בשבילך|to:f': 'בִּשְׁבִילֵךְ',
  'ממך|to:m': 'מִמְּךָ', 'ממך|to:f': 'מִמֵּךְ',
  'אליך|to:m': 'אֵלֶיךָ', 'אליך|to:f': 'אֵלַיִךְ',
  'מצאת|to:m': 'מָצָאתָ', 'מצאת|to:f': 'מָצָאתְ',
  'עזרת|to:m': 'עָזַרְתָּ', 'עזרת|to:f': 'עָזַרְתְּ',
  'אמרת|to:m': 'אָמַרְתָּ', 'אמרת|to:f': 'אָמַרְתְּ',
  'ראית|to:m': 'רָאִיתָ', 'ראית|to:f': 'רָאִיתְ',
  'הצלת|to:m': 'הִצַּלְתָּ', 'הצלת|to:f': 'הִצַּלְתְּ',
};

// Resolves gender-tagged entries for one line: `word|to:f` applies when the
// addressee is female, `word|speaker:m` when the speaker is male; untagged
// entries always apply.  Returns a flat word -> pointed map.
export function resolveGlossary(glossary, { speakerGender = null, addresseeGender = null } = {}) {
  const out = {};
  for (const [key, val] of Object.entries(glossary || {})) {
    const m = key.match(/^(.*)\|(to|speaker):(m|f)$/);
    if (!m) { out[key] = val; continue; }
    const g = m[2] === 'to' ? addresseeGender : speakerGender;
    const want = m[3] === 'f' ? 'female' : 'male';
    if (g === want) out[m[1]] = val;
    else if (g == null && m[3] === 'm' && !(m[1] in out)) out[m[1]] = val; // unknown: masculine default
  }
  return out;
}

export function applyGlossary(text, glossary) {
  if (!glossary || !Object.keys(glossary).length) return text;
  const entries = Object.entries(glossary).sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [word, pointed] of entries) {
    const bare = stripNikud(word);
    const re = new RegExp(`(^|[^\\p{L}\\u0591-\\u05C7])(${HEB_PREFIX})(${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}\\u0591-\\u05C7])`, 'gu');
    out = out.replace(re, (m, pre, prefix) => `${pre}${prefix}${pointed}`);
  }
  return out;
}

// Mouth-opening envelope of a clip (25 Hz RMS, normalised), for coarse lip-sync.
export function clipEnvelope(ff, file, rate = 25) {
  const r = spawnSync(ff.path, ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 2));
  const win = Math.round(8000 / rate);
  const rms = [];
  for (let i = 0; i + win <= pcm.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += pcm[j] * pcm[j];
    rms.push(Math.sqrt(sum / win));
  }
  if (!rms.length) return null;
  const sorted = [...rms].sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.95)] || 1;
  // light smoothing, then normalise with a soft knee so quiet consonants still move the mouth
  const out = rms.map((v, i) => {
    const a = rms[Math.max(0, i - 1)], b = rms[Math.min(rms.length - 1, i + 1)];
    const x = (0.25 * a + 0.5 * v + 0.25 * b) / ref;
    return Math.round(Math.min(1, Math.pow(Math.max(0, x), 0.7)) * 100) / 100;
  });
  return out;
}

// Attaches a mouth envelope to every spoken subtitle (clips come from the cache).
export async function attachEnvelopes(timeline, opts = {}) {
  const res = await synthesizeAll(timeline, opts);
  const ff = findFfmpeg();
  for (const c of res.clips) {
    const env = clipEnvelope(ff, c.file);
    if (env) { c.sub.envelope = env; c.sub.envelopeRate = 25; }
  }
  return res;
}

// ---- general gender agreement for Hebrew --------------------------------------
// Dicta's morphological analysis lists every pointing of a word with a code
// whose gender field lives in bits 21-22 (the word's own gender: verbs,
// participles, adjectives) or bits 39-40 (the gender of a pronominal suffix:
// לך / אותך / שלך ...).  When a word's options are "gender twins" (same lemma,
// codes differing only in one of those fields), the right one is chosen:
//   * suffix twins and second-person past verbs (...ת) follow the addressee,
//   * words in a clause with אני follow the speaker,
//   * words in a clause with אתה / את follow the addressee,
//   * anything else is left unpointed (the writer's spelling stands).
// Only those words get pointed, so easy words stay clean.  Feminine second
// person past forms get an explicit final shva (מָצָאתְ) so engines close the
// syllable.
const VERB_GENDER_XOR = (1n << 21n) | (1n << 22n);
const SUFFIX_GENDER_XOR = (1n << 39n) | (1n << 40n);
const FEM_VERB_BIT = 1n << 22n;   // calibrated on מָצָאת / מָצָאתָ
const FEM_SUFFIX_BIT = 1n << 40n;
async function nakdanMorph(text, cacheDir) {
  const key = createHash('sha1').update('nakdan-morph|' + text).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${key}.morph.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const body = JSON.stringify({ task: 'nakdan', data: text, genre: 'modern', addmorph: true, keepmetagim: false, keepqq: false, nodageshdefmem: false, patachma: false });
  const r = spawnSync('curl', ['-sS', '-m', '40', '-H', 'Content-Type: application/json', '-d', body, NAKDAN_URL], { encoding: 'utf8', env: { ...process.env, SSL_CERT_FILE: process.env.SSL_CERT_FILE || '/root/.ccr/ca-bundle.crt' } });
  let tokens;
  try { tokens = JSON.parse(r.stdout); } catch { return null; }
  writeFileSync(file, JSON.stringify(tokens));
  return tokens;
}
export async function agreeGender(text, { speakerGender = null, addresseeGender = null } = {}, cacheDir, log = () => {}) {
  if (!/[\u05D0-\u05EA]/.test(text)) return text;
  const tokens = await nakdanMorph(stripNikud(text), cacheDir);
  if (!tokens) return text;
  const hasAni = /(^|[^\p{L}])אני([^\p{L}]|$)/u.test(text);
  const hasAta = /(^|[^\p{L}])(אתה|את)([^\p{L}]|$)/u.test(text);
  if (/(^|[^\p{L}])אתה([^\p{L}]|$)/u.test(text) && addresseeGender === 'female') log('warning: the text says אתה (masculine "you") but the addressee is female');
  const warned = new Set();
  const warnOnce = (m) => { if (!warned.has(m)) { warned.add(m); log(m); } };
  // walk the original text token by token so existing nikud / glossary results are preserved
  let out = '';
  let pos = 0;
  const plain = stripNikud(text);
  for (const t of tokens) {
    if (t.sep) continue;
    const word = t.word;
    const at = plain.indexOf(word, pos);
    if (at < 0) continue;
    // map plain index -> original text index (skip nikud marks)
    let oi = 0, pi = 0;
    while (pi < at) { if (!/[\u0591-\u05C7]/.test(text[oi])) pi++; oi++; }
    let oe = oi, pe = 0;
    while (pe < word.length) { if (!/[\u0591-\u05C7]/.test(text[oe])) pe++; oe++; }
    while (oe < text.length && /[\u0591-\u05C7]/.test(text[oe])) oe++;
    const original = text.slice(oi, oe);
    out += text.slice(pos === 0 && out === '' ? 0 : lastEnd, oi);
    pos = at + word.length;
    var lastEnd = oe;
    if (/[\u05B0-\u05C7]/.test(original)) { out += original; continue; } // already pointed by author/glossary
    // readings in Dicta's ranking order; only twins that include the best reading count
    const opts = (t.options || []).flatMap((o, rank) => (o[1] || []).map((m) => ({ form: o[0].replace(/\|/g, ''), code: BigInt(m[0]), lemma: m[1], rank })));
    let chosen = null;
    const isSecondSuffix = (f) => /ך[\u05B8\u05B0]$/.test(f);   // ends in ךָ (masc) or ךְ (fem)
    outer: for (let i = 0; i < opts.length; i++) for (let j = 0; j < opts.length; j++) {
      const a = opts[i], b = opts[j];
      if (i === j || a.lemma !== b.lemma || a.form === b.form) continue;
      if (Math.min(a.rank, b.rank) !== 0 || Math.max(a.rank, b.rank) > 3) continue;
      const x = a.code ^ b.code;
      let femBit = null, who = null;
      if (x === SUFFIX_GENDER_XOR) {
        if (!(isSecondSuffix(a.form) && isSecondSuffix(b.form))) continue;      // third-person suffixes are not ours to change
        femBit = FEM_SUFFIX_BIT; who = 'to';
      } else if (x === VERB_GENDER_XOR) {
        femBit = FEM_VERB_BIT;
        if (/ת$/.test(word) && /ת\u05BC?\u05B8$/.test(a.form) !== /ת\u05BC?\u05B8$/.test(b.form)) who = 'to';   // second person past: one twin ends in תָּ
        else if (hasAni) who = 'speaker';
        else if (hasAta) who = 'to';
        else continue;
      } else continue;
      const g = who === 'to' ? addresseeGender : speakerGender;
      if (!g) { warnOnce(`warning: "${word}" depends on the ${who === 'to' ? 'addressee' : 'speaker'}'s gender, which is unknown`); continue; }
      const fem = (a.code & femBit) !== 0n ? a : b;
      const masc = fem === a ? b : a;
      chosen = g === 'female' ? fem.form : masc.form;
      if (g === 'female' && /ת$/.test(chosen)) chosen += '\u05B0';
      break outer;
    }
    out += chosen ?? original;
  }
  out += text.slice(lastEnd ?? 0);
  return out;
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
  if (engine === 'elevenlabs') {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
    const voiceId = v.voice || process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
    const body = JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, speed: 1 + (v.rate || 0) / 100 } });
    const r = spawnSync('curl', ['-sS', '-m', '120', '-f', '-o', outFile, '-H', `xi-api-key: ${key}`, '-H', 'Content-Type: application/json', '-H', 'Accept: audio/mpeg', '-d', body, `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`], { encoding: 'utf8' });
    if (r.status !== 0 || !existsSync(outFile) || statSync(outFile).size === 0) throw new Error(`elevenlabs failed: ${(r.stderr || '').trim().split('\n').pop()}`);
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
  const wantNikud = timeline.meta.nikud === true && lang.split('-')[0] === 'he';
  const scriptGlossary = (timeline.meta.pronunciation || {})[lang] || (timeline.meta.pronunciation || {})[lang.split('-')[0]] || {};
  const glossaryAll = lang.split('-')[0] === 'he' ? { ...HEBREW_DEFAULT_GLOSSARY, ...scriptGlossary } : scriptGlossary;
  for (const sub of spoken) {
    const v = pickVoice(engine, lang, sub, timeline.cast);
    let spokenText = (sub.texts && (sub.texts[`${lang}-tts`] || sub.texts[`${lang.split('-')[0]}-tts`])) || sub.text;
    if (wantNikud) spokenText = await addNikud(spokenText, cacheDir);
    const glossary = resolveGlossary(glossaryAll, { speakerGender: sub.speakerGender, addresseeGender: sub.addresseeGender });
    spokenText = applyGlossary(spokenText, glossary);
    if (lang.split('-')[0] === 'he' && timeline.meta.agreement !== false && sub.kind === 'dialog') {
      spokenText = await agreeGender(spokenText, { speakerGender: sub.speakerGender, addresseeGender: sub.addresseeGender }, cacheDir, (m) => log(`line ${sub.line}: ${m}`));
    }
    sub.spokenText = spokenText;
    const key = createHash('sha1').update(JSON.stringify([engine, lang, v, spokenText])).digest('hex').slice(0, 16);
    const file = path.join(cacheDir, `${key}.mp3`);
    if (!existsSync(file) || statSync(file).size === 0) {
      await synthesize(engine, spokenText, v, lang, file);
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
export function mixTrack(timeline, clips, outFile, { music = null, musicVolume = 0.25, voiceVolume = 1, resolveAsset = (f) => f, range = null, log = console.error } = {}) {
  const ff = findFfmpeg();
  const duration = timeline.meta.duration;
  const inputs = [];
  const filters = [];
  const mixed = [];
  let nIn = 0;
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
    filters.push(`[${nIn}:a]${chain.join(',')}[v${i}]`);
    mixed.push(`[v${i}]`);
    nIn++;
  });
  // Scene music: each entry plays (looped) from t0 to t1 with a fade-out; a
  // script-level `music:` becomes one entry spanning the film.
  const musicEntries = [...(timeline.music || [])];
  if (music && musicEntries.length === 0) musicEntries.push({ t0: 0, t1: duration, file: music, volume: musicVolume, offset: 0, loop: true, fadeOut: 2 });
  musicEntries.forEach((m, i) => {
    const file = resolveAsset(m.file);
    if (!existsSync(file)) { log(`warning: music file not found: ${file}`); return; }
    const len = Math.max(0.1, Math.min(duration, m.t1) - m.t0);
    inputs.push(...(m.loop ? ['-stream_loop', '-1'] : []), '-ss', String(m.offset || 0), '-i', file);
    const fade = Math.min(m.fadeOut ?? 1.5, len / 2);
    const chain = [`aresample=48000`, `aformat=channel_layouts=stereo`, `atrim=0:${len.toFixed(3)}`, `afade=t=in:st=0:d=${Math.min(0.5, len / 4).toFixed(3)}`, `afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade.toFixed(3)}`, `volume=${m.volume ?? musicVolume}`, `adelay=${Math.round(m.t0 * 1000)}|${Math.round(m.t0 * 1000)}`];
    filters.push(`[${nIn}:a]${chain.join(',')}[m${i}]`);
    mixed.push(`[m${i}]`);
    nIn++;
  });
  (timeline.sounds || []).forEach((snd, i) => {
    const file = snd.builtin ? path.resolve(REPO_ROOT, 'assets', snd.file) : resolveAsset(snd.file);
    if (!existsSync(file)) { log(`warning: sound file not found: ${file}`); return; }
    inputs.push('-ss', String(snd.offset || 0), '-i', file);
    filters.push(`[${nIn}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${snd.volume ?? 1},adelay=${Math.round(snd.t * 1000)}|${Math.round(snd.t * 1000)}[s${i}]`);
    mixed.push(`[s${i}]`);
    nIn++;
  });
  // Ambience bed (soft underwater wash), looped under everything
  if (timeline.meta.ambience !== false && timeline.meta.ambience !== 'off') {
    const amb = path.resolve(REPO_ROOT, 'assets', 'sfx', 'underwater.wav');
    if (existsSync(amb)) {
      const vol = typeof timeline.meta.ambience === 'number' ? timeline.meta.ambience : 0.12;
      inputs.push('-stream_loop', '-1', '-i', amb);
      filters.push(`[${nIn}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${duration.toFixed(3)},volume=${vol}[amb]`);
      mixed.push('[amb]');
      nIn++;
    }
  }
  // Video clips with sound
  (timeline.overlays || []).filter((o) => o.type === 'clip' && o.volume > 0).forEach((o, i) => {
    const file = resolveAsset(o.src);
    if (!existsSync(file)) return;
    const probe = spawnSync(ff.path, ['-hide_banner', '-i', file], { encoding: 'utf8' });
    if (!/Audio:/.test(probe.stderr || '')) return;
    const len = o.t1 - o.t0;
    inputs.push('-ss', String(o.offset || 0), '-t', len.toFixed(3), '-i', file);
    filters.push(`[${nIn}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${o.volume},adelay=${Math.round(o.t0 * 1000)}|${Math.round(o.t0 * 1000)}[c${i}]`);
    mixed.push(`[c${i}]`);
    nIn++;
  });
  const voiceLabels = mixed.filter((l) => l.startsWith('[v'));
  const musicLabels = mixed.filter((l) => l.startsWith('[m'));
  const otherLabels = mixed.filter((l) => !l.startsWith('[v') && !l.startsWith('[m'));
  if (mixed.length === 0) {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${duration.toFixed(3)}[out]`);
  } else if (voiceLabels.length && musicLabels.length) {
    // duck the music under the voices (side-chain compression), then mix everything
    filters.push(`${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:normalize=0:duration=longest,apad,atrim=0:${duration.toFixed(3)},asplit=2[voice][sc]`);
    filters.push(`${musicLabels.join('')}amix=inputs=${musicLabels.length}:normalize=0:duration=longest,apad,atrim=0:${duration.toFixed(3)}[music]`);
    filters.push(`[music][sc]sidechaincompress=threshold=0.015:ratio=7:attack=40:release=700:makeup=1[ducked]`);
    const finals = ['[voice]', '[ducked]', ...otherLabels];
    filters.push(`${finals.join('')}amix=inputs=${finals.length}:normalize=0:duration=longest,apad,atrim=0:${duration.toFixed(3)}[out]`);
  } else {
    filters.push(`${mixed.join('')}amix=inputs=${mixed.length}:normalize=0:duration=longest,apad,atrim=0:${duration.toFixed(3)}[out]`);
  }
  // partial renders: keep only the rendered time range, re-based to 0
  let mapLabel = '[out]';
  if (range && (range.start > 0 || range.end < duration)) {
    filters.push(`[out]atrim=${range.start.toFixed(3)}:${Math.min(duration, range.end).toFixed(3)},asetpts=PTS-STARTPTS[cut]`);
    mapLabel = '[cut]';
  }
  const args = ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', mapLabel, '-c:a', 'pcm_s16le', outFile];
  const r = spawnSync(ff.path, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg mix failed: ${r.stderr}`);
  return outFile;
}

// Writes a JSON manifest next to the audio (useful for inspection / lip-sync work).
export function writeManifest(clips, file) {
  writeFileSync(file, JSON.stringify(clips.map((c) => ({ t0: c.sub.t0, slot: c.sub.t1 - c.sub.t0, duration: c.duration, speaker: c.sub.speaker, kind: c.sub.kind, voice: c.voice, text: c.sub.text, spoken: c.sub.spokenText, clip: c.file })), null, 2));
}
