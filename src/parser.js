// Markdown screenplay parser: turns an OceanScript .md file into a flat list
// of statements (cast, scenes, env settings, actions, dialog, directives).
//
// The grammar is line based and deliberately forgiving.  See docs/SCRIPT_FORMAT.md.

export const ENV_KEYS = new Set([
  'time', 'water', 'waves', 'depth', 'floor', 'visibility', 'caustics',
  'bubbles', 'rays', 'seaweed', 'coral', 'rocks', 'transition', 'sun', 'plankton',
  'backdrop', 'style', 'clouds', 'sky', 'fog', 'interior',
]);

export const DIRECTIONS = {
  left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
  forward: [0, 0, 1], front: [0, 0, 1], back: [0, 0, -1], backward: [0, 0, -1], away: [0, 0, -1],
  top: [0, 1, 0], bottom: [0, -1, 0], above: [0, 1, 0], below: [0, -1, 0],
};

export const EMOTIONS = new Set([
  'happy', 'sad', 'scared', 'afraid', 'excited', 'sleepy', 'tired', 'angry', 'calm',
  'curious', 'surprised', 'neutral', 'proud', 'lonely', 'crying',
]);

export class ParseError extends Error {
  constructor(msg, line, text) {
    super(`line ${line}: ${msg}${text ? `\n    ${text}` : ''}`);
    this.line = line;
  }
}

// ---------- small token helpers -------------------------------------------

const TIME_RE = /(?:^|[\s(])(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)(?=$|[\s),])/i;
export function parseTime(str) {
  if (str == null) return null;
  const m = String(str).match(TIME_RE);
  if (!m) {
    const n = Number(str);
    return Number.isFinite(n) ? n : null;
  }
  const v = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  if (u === 'ms') return v / 1000;
  if (u.startsWith('m')) return v * 60;
  return v;
}

// Extract a `(x, y[, z])` tuple.  Returns { pos, rest } where rest is the text
// with the tuple removed.
const POS_RE = /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(-?\d+(?:\.\d+)?)\s*)?\)/;
export function takePos(text) {
  const m = text.match(POS_RE);
  if (!m) return { pos: null, rest: text };
  const pos = [parseFloat(m[1]), parseFloat(m[2]), m[3] != null ? parseFloat(m[3]) : 0];
  return { pos, rest: text.replace(m[0], ' ') };
}

// Extract an explicit duration: `over 3s`, `for 2s`, `in 500ms`, `(3s)`, `3s` trailing.
const DUR_RE = /\b(?:over|for|in|during|taking|lasting)\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)\b/i;
const DUR_PAREN_RE = /\(\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)\s*\)/i;
const DUR_BARE_RE = /(?:^|\s)(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)(?=$|\s|,)/i;
export function takeDuration(text) {
  for (const re of [DUR_RE, DUR_PAREN_RE, DUR_BARE_RE]) {
    const m = text.match(re);
    if (m) return { duration: parseTime(`${m[1]}${m[2]}`), rest: text.replace(m[0], ' ') };
  }
  return { duration: null, rest: text };
}

const REF_RE = /@([\p{L}\p{N}_-]+)/u;
export function takeRef(text) {
  const m = text.match(REF_RE);
  if (!m) return { ref: null, rest: text };
  return { ref: m[1], rest: text.replace(m[0], ' ') };
}

export function takeAllRefs(text) {
  const refs = [];
  let rest = text;
  for (;;) {
    const r = takeRef(rest);
    if (!r.ref) break;
    refs.push(r.ref);
    rest = r.rest;
  }
  return { refs, rest };
}

const QUOTE_RE = /["“”„«»]([^"“”„«»]*)["“”„«»]/u;
export function takeQuote(text) {
  const m = text.match(QUOTE_RE);
  if (!m) return { quote: null, rest: text };
  return { quote: m[1].trim(), rest: text.replace(m[0], ' ') };
}

const COUNT_RE = /\b(\d+(?:\.\d+)?)\s*(?:x|times?|loops?|laps?|turns?|circles?|rounds?)\b/i;
export function takeCount(text) {
  let m = text.match(COUNT_RE);
  if (m) return { count: parseFloat(m[1]), rest: text.replace(m[0], ' ') };
  m = text.match(/\b(once|twice|thrice)\b/i);
  if (m) return { count: { once: 1, twice: 2, thrice: 3 }[m[1].toLowerCase()], rest: text.replace(m[0], ' ') };
  return { count: null, rest: text };
}

// `keyword N` -> number, e.g. `distance 4`, `size 0.5`, `radius 3`, `height 2`
export function takeKeyNumber(text, keys) {
  const re = new RegExp(`\\b(?:${keys.join('|')})\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?)\\b`, 'i');
  const m = text.match(re);
  if (!m) return { value: null, rest: text };
  return { value: parseFloat(m[1]), rest: text.replace(m[0], ' ') };
}

export function takeDirection(text) {
  const m = text.match(/\b(left|right|up|down|forward|front|backward|back|away|top|bottom|above|below)\b/i);
  if (!m) return { dir: null, rest: text };
  return { dir: m[1].toLowerCase(), rest: text.replace(m[0], ' ') };
}

export function takeNumber(text) {
  const m = text.match(/(?:^|\s)(-?\d+(?:\.\d+)?)(?=$|\s|,)/);
  if (!m) return { value: null, rest: text };
  return { value: parseFloat(m[1]), rest: text.replace(m[0], ' ') };
}

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

// ---------- verb lexicon -----------------------------------------------------

// Each entry: [regex on the lower-cased action text, canonical verb]
// The regex is anchored to the start of the action text (after `@name`).
const ACTOR_VERBS = [
  [/^(?:feels?|is|becomes?|gets?|looks?|seems?|acts?)\s+(?:very\s+|a bit\s+|so\s+|really\s+)?(happy|sad|scared|afraid|excited|sleepy|tired|angry|calm|curious|surprised|neutral|proud|lonely|crying)\b/, 'emote'],
  [/^(?:appears?|is|starts?|begins?|spawns?|pops? up)\b/, 'place'],
  [/^(?:enters?|comes? in|arrives?|swims? in|shows? up)\b/, 'enter'],
  [/^(?:exits?|leaves?|swims? (?:away|off|out)|goes? (?:away|off|out)|departs?)\b/, 'exit'],
  [/^(?:smiles?|grins?|beams?|smirks?)\b/, 'smile'],
  [/^(?:frowns?|scowls?|pouts?|sulks?)\b/, 'frown'],
  [/^(?:shows?|bares?|flashes?|reveals?)\s+(?:its|his|her|their)?\s*teeth\b/, 'teeth'],
  [/^(?:hides?|covers?)\s+(?:its|his|her|their)?\s*teeth\b/, 'noteeth'],
  [/^(?:opens?)\s+(?:its|his|her|their)?\s*mouth\b/, 'openmouth'],
  [/^(?:closes?|shuts?)\s+(?:its|his|her|their)?\s*mouth\b/, 'closemouth'],
  [/^(?:blinks?)\b/, 'blink'],
  [/^(?:winks?)\b/, 'wink'],
  [/^(?:yawns?)\b/, 'yawn'],
  [/^(?:gasps?)\b/, 'gasp'],
  [/^(?:hides?|disappears?|vanishes?|is gone|goes? invisible)\b/, 'hide'],
  [/^(?:shows?|reappears?|becomes? visible)\b/, 'show'],
  [/^(?:circles?|orbits?|swims? (?:around|round)|goes? (?:around|round)|spirals?)\b/, 'orbit'],
  [/^(?:follows?|swims? (?:with|behind|after)|stays? (?:with|near|by)|accompan(?:y|ies)|tags? along)\b/, 'follow'],
  [/^(?:swallows?|eats?|gulps?(?: down)?|devours?|engulfs?)\b/, 'swallow'],
  [/^(?:spits?(?: out)?|coughs? up|lets? out|frees?|sets? free)\b/, 'spit'],
  [/^(?:swims?|moves?|goes?|glides?|drifts?|floats?|travels?|heads?|rushes?|darts?|dashes?|flees?|hurries?|sinks?|rises?|dives?|surfaces?|approaches?|chases?|flies|fly|flys?|soars?|walks?|runs?|crawls?|scuttles?|lands?|takes? off)\b/, 'move'],
  [/^(?:stops? following|stops?|halts?|pauses?|freezes?)\b/, 'stop'],
  [/^(?:looks?|faces?|turns? (?:to|toward|towards)|watches?|stares?|glances?)\b/, 'look'],
  [/^(?:waits?|idles?|rests?|hovers?|lingers?|sleeps?|stays?)\b/, 'wait'],
  [/^(?:says?|speaks?|shouts?|whispers?|asks?|answers?|replies?|calls?|cries? out|sings?|tells?|exclaims?)\b/, 'say'],
  [/^(?:spins?|twirls?|rolls?|somersaults?|flips?|tumbles?)\b/, 'spin'],
  [/^(?:wiggles?|wobbles?|dances?|shakes?|shivers?|trembles?|jiggles?)\b/, 'wiggle'],
  [/^(?:jumps?|leaps?|breach(?:es)?|hops?|bounces?)\b/, 'jump'],
  [/^(?:nods?|agrees?|bows?)\b/, 'nod'],
  [/^(?:grows?|shrinks?|scales?|becomes? (?:bigger|smaller|huge|tiny))\b/, 'scale'],
  [/^(?:blows?|spits?|makes?|releases?|emits?)\s+bubbles?\b/, 'bubbles'],
  [/^(?:cries|weeps|sobs)\b/, 'cry'],
  [/^(?:sprays?|spouts?|blows? water|squirts?)\b/, 'spout'],
  [/^(?:glows?|lights? up|shines?|sparkles?)\b/, 'glow'],
  [/^(?:speed|sets? speed|goes? at)\b/, 'speed'],
  [/^(?:carries|picks? up|holds?|grabs?|lifts?|takes?)\b/, 'carry'],
  [/^(?:drops?|releases?|lets? go(?: of)?|puts? down)\b/, 'drop'],
];

const CAMERA_VERBS = [
  [/^(?:cuts?|jumps?|snaps?)\b/, 'cut'],
  [/^(?:moves?|pans?|dollies|dolly|travels?|glides?|flies|flys?|goes?|pushes? in|pulls? (?:out|back)|tracks?|drifts?|floats?)\b/, 'move'],
  [/^(?:looks?|points?|aims?|turns?|faces?|watches?)\b/, 'look'],
  [/^(?:follows?|tracks?|stays? (?:on|with)|locks? (?:on|onto))\b/, 'follow'],
  [/^(?:orbits?|circles?|revolves?|swings? around)\b/, 'orbit'],
  [/^(?:shakes?|rumbles?|trembles?|quakes?)\b/, 'shake'],
  [/^(?:zooms?|fov|sets? fov)\b/, 'zoom'],
  [/^(?:stops?|holds?|freezes?|stays?|waits?)\b/, 'stop'],
];

const DIRECTIVES = [
  [/^(?:wait|pause|hold|beat|rest|delay)\b/, 'wait'],
  [/^(?:sync|wait for all|join|all done|meanwhile ends|then)\b/, 'sync'],
  [/^iris\s*in\b/, 'irisIn'],
  [/^iris\s*(?:out|close)\b/, 'irisOut'],
  [/^fade\s*in\b/, 'fadeIn'],
  [/^fade\s*(?:out|to)\b/, 'fadeOut'],
  [/^(?:image|picture|card|plate|illustration|logo)\b/, 'image'],
  [/^(?:credits?|roll credits|scroll)\b/, 'credits'],
  [/^(?:music|song|soundtrack|score)\b/, 'music'],
  [/^(?:sound|sfx|effect|noise|play)\b/, 'sound'],
  [/^(?:clip|video|footage|movie)\b/, 'clip'],
  [/^(?:black|blackout|darkness)\b/, 'black'],
  [/^(?:title|title card|chapter|heading)\b/, 'title'],
  [/^(?:caption|text|subtitle|narration|narrate|note)\b/, 'caption'],
  [/^(?:cut|hard cut|smash cut)\b/, 'cut'],
  [/^(?:marker|mark|bookmark)\b/, 'marker'],
  [/^(?:speed|time scale|timescale)\b/, 'speed'],
];

function matchVerb(list, text) {
  for (const [re, verb] of list) {
    const m = text.match(re);
    if (m) return { verb, match: m, rest: text.slice(m[0].length) };
  }
  return null;
}

// ---------- cast parsing -------------------------------------------------------

const KINDS = new Set([
  'fish', 'whale', 'shark', 'octopus', 'jellyfish', 'turtle', 'crab', 'school',
  'dolphin', 'seahorse', 'starfish', 'ray', 'eel', 'squid', 'narrator', 'voice',
  'bird', 'pelican', 'bubble', 'sprite', 'model',
]);
const KIND_ALIASES = {
  fishes: 'fish', minnow: 'fish', goldfish: 'fish', clownfish: 'fish', sardine: 'fish', tuna: 'fish',
  whales: 'whale', calf: 'whale', humpback: 'whale', orca: 'whale',
  sharks: 'shark', 'great white': 'shark',
  octopi: 'octopus', octopuses: 'octopus', squid: 'squid', kraken: 'octopus',
  jelly: 'jellyfish', jellies: 'jellyfish', medusa: 'jellyfish',
  tortoise: 'turtle', turtles: 'turtle',
  crabs: 'crab', lobster: 'crab',
  shoal: 'school', flock: 'school', swarm: 'school', 'school of fish': 'school',
  dolphins: 'dolphin', porpoise: 'dolphin',
  stingray: 'ray', manta: 'ray', 'manta ray': 'ray',
  'sea horse': 'seahorse', seahorses: 'seahorse',
  'sea star': 'starfish', star: 'starfish',
  eels: 'eel', 'moray': 'eel',
  seagull: 'bird', gull: 'bird', birds: 'bird', albatross: 'bird', pelicans: 'pelican', stork: 'pelican', heron: 'pelican',
  image: 'sprite', picture: 'sprite', cutout: 'sprite', drawing: 'sprite', illustration: 'sprite',
  gltf: 'model', glb: 'model', mesh: 'model',
  bubbles: 'bubble', balloon: 'bubble',
};

const COLOR_WORDS = new Set([
  'silver', 'gold', 'golden', 'blue', 'red', 'green', 'yellow', 'orange', 'pink', 'purple',
  'violet', 'white', 'black', 'grey', 'gray', 'brown', 'teal', 'cyan', 'turquoise', 'navy',
  'lime', 'magenta', 'coral', 'salmon', 'ivory', 'beige', 'tan', 'crimson', 'maroon', 'olive',
  'indigo', 'lavender', 'peach', 'mint', 'aqua', 'azure', 'sky', 'sand', 'copper', 'bronze',
  'pearl', 'rainbow', 'striped',
]);

export function parseCastLine(text, line) {
  // - name: kind, color, size N, label "Display", speed N, count N
  // - name (Display Name): kind ...
  const m = text.match(/^([\p{L}\p{N}_-]+)\s*(?:\(([^)]+)\))?\s*[:=–-]\s*(.+)$/u);
  if (!m) throw new ParseError('cast entry must look like `- name: kind, color, size 1`', line, text);
  const name = m[1];
  const actor = { name, kind: 'fish', color: null, size: null, label: m[2] ? m[2].trim() : null, speed: null, count: null, style: null, i18n: {} };
  const attrs = parseCastAttrs(m[3]);
  Object.assign(actor, attrs);
  if (attrs.kind) actor.kind = attrs.kind;
  if (/^(narrator|voice|קריין|מספר)$/i.test(name) && actor.kind === 'fish' && !/\bfish\b/i.test(m[3])) actor.kind = 'narrator';
  return actor;
}

// Attributes shared by cast lines and their `lang:` continuation lines:
//   label "Name", voice "engine voice name", pitch N (Hz offset), rate N (% offset), size N, speed N, count N, colour, kind
export function parseCastAttrs(text) {
  const actor = {};
  let rest = text;
  const lab = rest.match(/\blabel\s*[:=]?\s*["“]([^"”]*)["”]/i);
  if (lab) { actor.label = lab[1].trim(); rest = rest.replace(lab[0], ' '); }
  const voice = rest.match(/\bvoice\s*[:=]?\s*["“]([^"”]*)["”]/i);
  if (voice) { actor.voice = voice[1].trim(); rest = rest.replace(voice[0], ' '); }
  const img = rest.match(/\b(?:image|picture|sprite)\s*[:=]?\s*["“]([^"”]*)["”]/i);
  if (img) { actor.image = img[1].trim(); actor.kind = 'sprite'; rest = rest.replace(img[0], ' '); }
  const mdl = rest.match(/\b(?:model|file|gltf|glb)\s*[:=]?\s*["“]([^"”]*)["”]/i);
  if (mdl) { actor.model = mdl[1].trim(); actor.kind = 'model'; rest = rest.replace(mdl[0], ' '); }
  const anim = rest.match(/\b(?:animation|clip)\s*[:=]?\s*["“]([^"”]*)["”]/i);
  if (anim) { actor.animation = anim[1].trim(); rest = rest.replace(anim[0], ' '); }
  if (/\bflip(?:ped)?\b/i.test(rest)) { actor.flip = true; rest = rest.replace(/\bflip(?:ped)?\b/i, ' '); }
  const pat = rest.match(/\b(spots|spotted|dots|dotted|stripes|striped|bands|banded)\b/i);
  if (pat) { const w = pat[1].toLowerCase(); actor.pattern = w.startsWith('sp') || w.startsWith('do') ? 'spots' : w.startsWith('st') ? 'stripes' : 'bands'; rest = rest.replace(pat[0], ' '); }
  const acc = rest.match(/\baccent\s*[:=]?\s*(#[0-9a-f]{3,8}|[a-z]+)/i);
  if (acc) { actor.accent = acc[1].toLowerCase(); rest = rest.replace(acc[0], ' '); }
  if (/\b(?:baleen|stripes|striped mouth)\b/i.test(rest)) { actor.baleen = true; rest = rest.replace(/\b(?:baleen|stripes|striped mouth)\b/i, ' '); }
  if (/\bbillboard\b/i.test(rest)) { actor.billboard = true; rest = rest.replace(/\bbillboard\b/i, ' '); }
  const q = takeQuote(rest);
  if (q.quote != null && actor.label == null) { actor.label = q.quote; rest = q.rest; }
  for (const key of ['size', 'speed', 'count', 'pitch', 'rate', 'volume']) {
    const r = takeKeyNumber(rest, [key, key === 'count' ? 'x' : key]);
    if (r.value != null) { actor[key] = r.value; rest = r.rest; }
  }
  const hex = rest.match(/#[0-9a-f]{3,8}\b/i);
  if (hex) { actor.color = hex[0]; rest = rest.replace(hex[0], ' '); }
  const parts = rest.split(/[,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const part of parts) {
    if (KINDS.has(part)) { actor.kind = part; continue; }
    if (KIND_ALIASES[part]) { actor.kind = KIND_ALIASES[part]; continue; }
    // "a small blue whale", "big grey shark"
    const ws = part.split(/\s+/);
    let matchedKind = false;
    for (const w of ws) {
      if (KINDS.has(w)) { actor.kind = w; matchedKind = true; }
      else if (KIND_ALIASES[w]) { actor.kind = KIND_ALIASES[w]; matchedKind = true; }
      else if (COLOR_WORDS.has(w) && !actor.color) actor.color = w;
      else if (['tiny', 'small', 'little', 'big', 'large', 'huge', 'giant', 'baby'].includes(w) && actor.size == null) {
        actor.sizeHint = w;
      } else if (['toon', 'cartoon', 'realistic', 'flat', 'shiny', 'glossy'].includes(w)) actor.style = w;
    }
    if (!matchedKind && !ws.some((w) => COLOR_WORDS.has(w)) && !actor.sizeHint && part.length) {
      // Unknown word – maybe a color name we don't know; keep as color if no color yet.
      if (!actor.color && /^[a-z]+$/.test(part)) actor.color = part;
    }
  }
  return actor;
}

// `he: ...` continuation lines attach a translation (or localised cast
// attributes) to the previous statement.
const LANG_LINE_RE = /^([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\s*:\s*(.+)$/;
export function matchLangLine(text) {
  const m = text.match(LANG_LINE_RE);
  if (!m) return null;
  if (/^(?:https?|ftp)$/i.test(m[1])) return null;
  return { lang: m[1].toLowerCase(), text: m[2].trim() };
}

// ---------- action parsing -----------------------------------------------------

function parseTarget(text) {
  // Returns { target, rest }: target = {pos:[..]} | {actor, offset?} | null
  const r = takeRef(text);
  if (r.ref) {
    const off = takePos(r.rest);
    const target = { actor: r.ref };
    if (off.pos) target.offset = off.pos;
    return { target, rest: off.rest };
  }
  const p = takePos(text);
  if (p.pos) return { target: { pos: p.pos }, rest: p.rest };
  if (/\bcamera\b/i.test(text)) return { target: { actor: 'camera' }, rest: text.replace(/\bthe camera\b|\bcamera\b/i, ' ') };
  return { target: null, rest: text };
}

export function parseActorAction(name, text, line) {
  const raw = text;
  let nonBlocking = false;
  text = text.trim();
  if (text.endsWith('&')) { nonBlocking = true; text = text.slice(0, -1).trim(); }
  if (/^\s*(?:and|also|meanwhile)\b/i.test(text)) { nonBlocking = true; text = text.replace(/^\s*(?:and|also|meanwhile)\b/i, '').trim(); }

  // `@name: text` / `@name says "text"` handled by the caller for the colon form.
  const lower = text.toLowerCase();
  const isCamera = name.toLowerCase() === 'camera';
  const mv = matchVerb(isCamera ? CAMERA_VERBS : ACTOR_VERBS, lower);
  if (!mv) throw new ParseError(`unknown ${isCamera ? 'camera' : 'action'} verb`, line, raw);

  const action = { type: 'action', actor: isCamera ? 'camera' : name, verb: mv.verb, nonBlocking, line, text: raw.trim() };
  // Keep the original-cased tail for quotes.
  let tail = text.slice(text.length - mv.rest.length);
  const dur = takeDuration(tail); tail = dur.rest; action.duration = dur.duration;
  const q = takeQuote(tail); if (q.quote != null) { action.quote = q.quote; tail = q.rest; }
  const cnt = takeCount(tail); if (cnt.count != null) { action.count = cnt.count; tail = cnt.rest; }
  for (const key of ['distance', 'radius', 'height', 'size', 'speed', 'depth', 'fov', 'offset', 'strength', 'scale']) {
    const r = takeKeyNumber(tail, [key]);
    if (r.value != null) { action[key] = r.value; tail = r.rest; }
  }
  const ease = tail.match(/\b(linear|ease|smooth|snap|bouncy|elastic)\b/i);
  if (ease) { action.ease = ease[1].toLowerCase(); tail = tail.replace(ease[0], ' '); }

  switch (mv.verb) {
    case 'place': case 'cut': {
      // camera: `cuts to (..) looking at @x`
      const look = tail.match(/\b(?:looking at|facing|toward|towards|aimed at|pointing at)\b(.*)$/i);
      if (look) { const lt = parseTarget(look[1]); action.lookTarget = lt.target; tail = tail.replace(look[0], ' '); }
      const t = parseTarget(tail); tail = t.rest;
      action.target = t.target;
      break;
    }
    case 'enter': case 'exit': {
      const d = takeDirection(tail); tail = d.rest;
      action.direction = d.dir || (mv.verb === 'enter' ? 'left' : 'right');
      const t = parseTarget(tail); tail = t.rest;
      action.target = t.target;
      break;
    }
    case 'move': {
      // `swims to X`, `swims toward @x`, `swims left 5`, `dives to depth 4`, `surfaces`
      const head = mv.match[0];
      const toward = /\b(?:toward|towards|near|closer to|after|at)\b/i.test(tail) || /^(?:approaches?|chases?)/.test(head);
      const t = parseTarget(tail); tail = t.rest;
      if (t.target) {
        action.target = t.target;
        if (toward && t.target.actor) action.target.near = true;
      } else {
        const d = takeDirection(tail); tail = d.rest;
        const n = takeNumber(tail); tail = n.rest;
        if (/^(?:sinks?|dives?)/.test(head) && !d.dir) {
          action.direction = 'down';
          action.amount = action.depth != null ? action.depth : (n.value ?? 3);
          if (action.depth != null) action.absoluteDepth = -Math.abs(action.depth);
        } else if (/^(?:rises?|surfaces?)/.test(head) && !d.dir) {
          action.direction = 'up';
          action.amount = n.value ?? 3;
          if (/^surfaces?/.test(head)) action.absoluteDepth = -0.3;
        } else if (d.dir) {
          action.direction = d.dir;
          action.amount = n.value ?? 4;
        } else if (/\bhome\b/i.test(tail)) {
          action.target = { home: true };
        } else {
          throw new ParseError('move needs a target: `(x, y, z)`, `@actor`, or a direction + distance', line, raw);
        }
      }
      if (/\b(?:from behind|from the side|from above|from the front|from below)\b/i.test(tail) && isCamera) {
        action.view = tail.match(/from (?:the )?(behind|side|above|front|below)/i)[1].toLowerCase();
      }
      break;
    }
    case 'orbit': {
      const t = parseTarget(tail); tail = t.rest;
      if (!t.target) throw new ParseError('orbit needs a center: `@actor` or `(x, y, z)`', line, raw);
      action.target = t.target;
      if (/\b(?:counter|anti)[- ]?clockwise|ccw\b/i.test(tail)) action.clockwise = false;
      break;
    }
    case 'follow': {
      const t = parseTarget(tail); tail = t.rest;
      if (!t.target || !t.target.actor) throw new ParseError('follow needs an `@actor`', line, raw);
      action.target = t.target;
      const view = tail.match(/\b(?:from (?:the )?)?(behind|side|above|front|below|beside|alongside|ahead)\b/i);
      action.view = view ? view[1].toLowerCase() : null;
      if (action.view === 'beside' || action.view === 'alongside') action.view = 'side';
      if (action.view === 'ahead') action.view = 'front';
      break;
    }
    case 'look': {
      const t = parseTarget(tail); tail = t.rest;
      if (t.target) action.target = t.target;
      else {
        const d = takeDirection(tail); tail = d.rest;
        if (d.dir) action.direction = d.dir;
        else if (/\bcamera|viewer|audience|us\b/i.test(tail)) action.target = { actor: 'camera' };
        else throw new ParseError('look needs a target: `@actor`, `(x, y, z)`, a direction, or `at the camera`', line, raw);
      }
      break;
    }
    case 'emote': {
      const word = mv.match[1];
      if (!EMOTIONS.has(word)) throw new ParseError(`unknown emotion "${word}" (known: ${[...EMOTIONS].join(', ')})`, line, raw);
      action.emotion = word === 'afraid' ? 'scared' : word === 'tired' ? 'sleepy' : word;
      break;
    }
    case 'say': {
      if (action.quote == null) {
        // allow `@x says hello there` without quotes
        const txt = tail.replace(/^\s*(?:to\s+@?\S+)?\s*/, '').trim();
        if (!txt) throw new ParseError('say needs text: `@name says "..."` or `@name: ...`', line, raw);
        action.quote = txt;
      }
      const to = takeRef(tail); if (to.ref) action.target = { actor: to.ref };
      break;
    }
    case 'smile': case 'frown': {
      const big = /\b(big|wide|broad|huge|widely)\b/i.test(tail);
      const small = /\b(small|slight|faint|little|slightly)\b/i.test(tail);
      action.value = (mv.verb === 'smile' ? 1 : -1) * (big ? 1 : small ? 0.35 : 0.7);
      if (/^(?:grins?)/.test(mv.match[0])) action.teeth = true;
      break;
    }
    case 'openmouth': {
      action.value = /\b(wide|widely|big)\b/i.test(tail) ? 1 : /\b(slightly|a little|a bit)\b/i.test(tail) ? 0.35 : 0.7;
      break;
    }
    case 'blink': {
      if (action.count == null) action.count = /\b(twice|two)\b/i.test(tail) ? 2 : /\b(three|thrice)\b/i.test(tail) ? 3 : 1;
      break;
    }
    case 'scale': {
      const n = takeNumber(tail);
      if (n.value != null) action.size = n.value;
      if (action.size == null) {
        const head = mv.match[0];
        action.factor = /shrink|smaller|tiny/.test(head) ? 0.5 : 2;
      }
      break;
    }
    case 'speed': {
      const n = takeNumber(tail);
      if (n.value != null) action.speed = n.value;
      if (action.speed == null) throw new ParseError('speed needs a number (units per second)', line, raw);
      break;
    }
    case 'zoom': {
      const n = takeNumber(tail);
      if (n.value != null) action.fov = n.value;
      if (action.fov == null) {
        if (/\bin\b/i.test(tail)) action.fov = 30;
        else if (/\bout\b/i.test(tail)) action.fov = 70;
        else throw new ParseError('zoom needs a fov number, e.g. `zooms to 35`', line, raw);
      }
      break;
    }
    case 'carry': case 'drop': case 'swallow': case 'spit': {
      const t = parseTarget(tail); tail = t.rest;
      if ((mv.verb === 'carry' || mv.verb === 'swallow') && (!t.target || !t.target.actor)) throw new ParseError(`${mv.verb} needs an \`@actor\``, line, raw);
      action.target = t.target;
      break;
    }
    default:
      break;
  }
  return action;
}

// ---------- directive parsing --------------------------------------------------

export function parseDirective(text, line) {
  const raw = text;
  let nonBlocking = false;
  text = text.trim();
  if (text.endsWith('&')) { nonBlocking = true; text = text.slice(0, -1).trim(); }
  const lower = text.toLowerCase();
  const mv = matchVerb(DIRECTIVES, lower);
  if (!mv) throw new ParseError('unknown directive', line, raw);
  const d = { type: 'directive', name: mv.verb, nonBlocking, line, text: raw.trim() };
  let tail = text.slice(text.length - mv.rest.length);
  if (d.name === 'music' && /^\s*(?:stops?|off|ends?|fades? out)\b/i.test(tail)) { d.file = null; d.stop = true; d.duration = takeDuration(tail).duration; return d; }
  const offEarly = tail.match(/\b(?:from|offset|starting at)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?\b/i);
  if (offEarly) { d.offset = parseFloat(offEarly[1]); tail = tail.replace(offEarly[0], ' '); }
  const dur = takeDuration(tail); tail = dur.rest; d.duration = dur.duration;
  const q = takeQuote(tail); if (q.quote != null) { d.quote = q.quote; tail = q.rest; }
  for (const key of ['volume', 'vol', 'gain']) {
    const r = takeKeyNumber(tail, [key]);
    if (r.value != null) { d.volume = r.value; tail = r.rest; break; }
  }
  const off = tail.match(/\b(?:from|offset|starting at)\s+(\d+(?:\.\d+)?)\s*s?\b/i);
  if (off) { d.offset = parseFloat(off[1]); tail = tail.replace(off[0], ' '); }
  if (d.duration == null) {
    const n = takeNumber(tail);
    if (n.value != null) { d.duration = n.value; tail = n.rest; }
  }
  if (d.name === 'fadeOut') {
    const c = tail.match(/\b(?:to\s+)?(white|black|blue|#[0-9a-f]{3,6})\b/i);
    d.color = c ? c[1].toLowerCase() : 'black';
  }
  if (d.name === 'fadeIn') {
    const c = tail.match(/\b(?:from\s+)?(white|black|blue|#[0-9a-f]{3,6})\b/i);
    d.color = c ? c[1].toLowerCase() : 'black';
  }
  if (['image', 'music', 'sound', 'clip'].includes(d.name)) {
    if (d.quote == null) throw new ParseError(`${d.name} needs a file path in quotes`, line, raw);
    d.file = d.quote;
    if (/^(?:stop|off|none|silence)$/i.test(d.quote) && d.name === 'music') d.file = null;
    if (/\bloop\b/i.test(tail)) d.loop = true;
    if (/\b(?:fit|cover|contain|stretch)\b/i.test(tail)) d.fit = tail.match(/\b(fit|cover|contain|stretch)\b/i)[1].toLowerCase();
  }
  if (d.name === 'credits') {
    if (d.quote == null) throw new ParseError('credits needs text in quotes; separate lines with |', line, raw);
    d.lines = d.quote.split(/\s*\|\s*/).map((l) => l.trim());
  }
  if ((d.name === 'title' || d.name === 'caption') && d.quote == null) {
    const t = tail.replace(/^[\s:]+/, '').trim();
    if (!t) throw new ParseError(`${d.name} needs text in quotes`, line, raw);
    d.quote = t;
  }
  if (d.name === 'marker' && d.quote == null) d.quote = tail.trim();
  if (d.name === 'title') {
    const sub = tail.match(/\bsubtitle\s+["“]([^"”]*)["”]/i);
    if (sub) d.subtitle = sub[1];
  }
  return d;
}

// ---------- front matter -------------------------------------------------------

function parseFrontMatter(lines) {
  const meta = {};
  if (lines[0]?.trim() !== '---') return { meta, consumed: 0 };
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '---') { i++; break; }
    const m = lines[i].match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^["'].*["']$/.test(v)) v = v.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = parseFloat(v);
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    meta[m[1]] = v;
  }
  return { meta, consumed: i };
}

// ---------- main entry ---------------------------------------------------------

export function parseScript(source, { filename = 'script.md' } = {}) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const { meta, consumed } = parseFrontMatter(lines);
  const script = { meta, cast: [], statements: [], warnings: [], filename, pronunciation: {} };

  let mode = 'body'; // or 'cast'
  let inComment = false;
  let inCodeFence = false;

  for (let idx = consumed; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    let line = lines[idx];

    // HTML comments (single or multi line)
    if (inComment) {
      if (line.includes('-->')) { inComment = false; line = line.slice(line.indexOf('-->') + 3); } else continue;
    }
    line = line.replace(/<!--.*?-->/g, '');
    if (line.includes('<!--')) { inComment = true; line = line.slice(0, line.indexOf('<!--')); }
    if (/^\s*```/.test(line)) { inCodeFence = !inCodeFence; continue; }
    if (inCodeFence) continue;

    const t = line.trim();
    if (!t) continue;
    if (/^(?:---+|\*\*\*+|___+)$/.test(t)) { script.statements.push({ type: 'directive', name: 'sync', line: lineNo, text: t }); continue; }

    // Translation / localisation continuation lines: `he: text`
    const lang = /^[-*+]\s/.test(t) ? null : matchLangLine(t);
    if (lang && !t.startsWith('>') && !t.startsWith('@') && !t.startsWith('**')) {
      if (mode === 'cast' && script.cast.length) {
        const c = script.cast[script.cast.length - 1];
        c.i18n[lang.lang] = { ...(c.i18n[lang.lang] || {}), ...parseCastAttrs(lang.text) };
        continue;
      }
      const last = script.statements[script.statements.length - 1];
      if (last && (last.type === 'dialog' || (last.type === 'directive' && ['title', 'caption', 'credits', 'image'].includes(last.name)))) {
        last.i18n = last.i18n || {};
        const txt = lang.text.replace(/^["“]|["”]$/g, '');
        const sub = txt.match(/\bsubtitle\s+["“]([^"”]*)["”]/i);
        last.i18n[lang.lang] = sub ? { text: txt.slice(0, sub.index).replace(/["“”]/g, '').trim(), subtitle: sub[1] } : { text: txt };
        continue;
      }
      script.warnings.push(`line ${lineNo}: translation line has nothing to attach to`);
      continue;
    }

    // Headings
    let m = t.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();
      if (/^(?:cast|characters|actors|dramatis personae)\b/i.test(title)) { mode = 'cast'; continue; }
      if (/^(?:pronunciation|pronounce|glossary|nikud|הגייה|ניקוד)\b/i.test(title)) { mode = 'pronunciation'; continue; }
      mode = 'body';
      if (level === 1) {
        const name = title.replace(/^(?:scene|act|part|chapter)\s*\d*\s*[:.\-–—]?\s*/i, '').trim() || title;
        script.statements.push({ type: 'scene', name, line: lineNo });
      } else {
        script.statements.push({ type: 'beat', name: title.replace(/^(?:beat|shot)\s*\d*\s*[:.\-–—]?\s*/i, '').trim() || title, line: lineNo });
      }
      continue;
    }

    if (mode === 'pronunciation') {
      m = t.match(/^[-*+]\s+(.*)$/);
      if (!m) continue;
      // - word: pointed form      or    - word (he): pointed form
      const pm = m[1].match(/^(\S+?)\s*(?:\(([a-z]{2,3})\))?\s*[:=→]\s*(.+)$/u);
      if (!pm) { script.warnings.push(`line ${lineNo}: pronunciation entry must look like \`- word: pointed form\``); continue; }
      const lang = (pm[2] || 'he').toLowerCase();
      script.pronunciation[lang] = script.pronunciation[lang] || {};
      script.pronunciation[lang][pm[1]] = pm[3].trim();
      continue;
    }
    if (mode === 'cast') {
      m = t.match(/^[-*+]\s+(.*)$/) || t.match(/^\d+[.)]\s+(.*)$/);
      if (!m) { script.warnings.push(`line ${lineNo}: ignored non-list line in cast section`); continue; }
      script.cast.push({ ...parseCastLine(m[1], lineNo), line: lineNo });
      continue;
    }

    // Blockquote: env setting or narration
    m = t.match(/^>\s?(.*)$/);
    if (m) {
      let body = m[1].trim();
      if (!body) continue;
      let nbNarr = false;
      if (body.endsWith('&')) { nbNarr = true; body = body.slice(0, -1).trim(); }
      let narrDur = null;
      const nd = body.match(/\(\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min)\w*\s*\)\s*$/i);
      if (nd) { narrDur = parseTime(`${nd[1]}${nd[2]}`); body = body.slice(0, nd.index).trim(); }
      const kv = body.match(/^([\p{L}_-]+)\s*:\s*(.+)$/u);
      if (kv && ENV_KEYS.has(kv[1].toLowerCase())) {
        // allow several: `> time: night, waves: choppy`
        const settings = {};
        for (const part of body.split(/\s*[,;]\s*(?=[\p{L}_-]+\s*:)/u)) {
          const p = part.match(/^([\p{L}_-]+)\s*:\s*(.+)$/u);
          if (!p) continue;
          const key = p[1].toLowerCase();
          if (!ENV_KEYS.has(key)) { script.warnings.push(`line ${lineNo}: unknown setting "${key}"`); continue; }
          let v = p[2].trim();
          if (/^-?\d+(\.\d+)?$/.test(v)) v = parseFloat(v);
          settings[key] = v;
        }
        script.statements.push({ type: 'env', settings, line: lineNo });
      } else {
        // `> Narrator: text` or plain narration
        const sp = body.match(/^\*{0,2}([\p{L}\p{N} _-]{1,40}?)\*{0,2}\s*:\s*(.+)$/u);
        if (sp && !/^https?$/i.test(sp[1])) {
          script.statements.push({ type: 'dialog', speaker: sp[1].trim(), text: sp[2].trim(), narration: true, duration: narrDur, nonBlocking: nbNarr, line: lineNo });
        } else {
          script.statements.push({ type: 'dialog', speaker: null, text: body, narration: true, duration: narrDur, nonBlocking: nbNarr, line: lineNo });
        }
      }
      continue;
    }

    // Action: @name ...
    m = t.match(/^@([\p{L}\p{N}_-]+)\s*(.*)$/u);
    if (m) {
      const name = m[1];
      let rest = m[2];
      // Dialog forms: `@name: text`, `@name says "text"`
      const colon = rest.match(/^[:：]\s*(.*)$/);
      if (colon) {
        let text = colon[1].trim();
        let nonBlocking = false;
        if (text.endsWith('&')) { nonBlocking = true; text = text.slice(0, -1).trim(); }
        const dur = takeDuration(text.match(/\(\s*\d+(?:\.\d+)?\s*(?:ms|s|sec|m|min)\w*\s*\)\s*$/) ? text : '');
        let duration = null;
        if (dur.duration != null) { duration = dur.duration; text = text.replace(/\(\s*\d+(?:\.\d+)?\s*(?:ms|s|sec|m|min)\w*\s*\)\s*$/, '').trim(); }
        text = text.replace(/^["“]|["”]$/g, '');
        script.statements.push({ type: 'dialog', speaker: name, text, duration, nonBlocking, line: lineNo });
        continue;
      }
      const action = parseActorAction(name, rest, lineNo);
      if (action.verb === 'say') {
        script.statements.push({ type: 'dialog', speaker: name, text: action.quote, duration: action.duration, nonBlocking: action.nonBlocking, to: action.target?.actor ?? null, line: lineNo });
      } else {
        script.statements.push(action);
      }
      continue;
    }

    // Bold dialog: **Name:** text / **Name**: text
    m = t.match(/^\*\*([^*]+?)\s*:?\*\*\s*:?\s*(.+)$/);
    if (m) {
      let text = m[2].trim();
      let nonBlocking = false;
      if (text.endsWith('&')) { nonBlocking = true; text = text.slice(0, -1).trim(); }
      const durM = text.match(/\(\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min)\w*\s*\)\s*$/i);
      let duration = null;
      if (durM) { duration = parseTime(`${durM[1]}${durM[2]}`); text = text.slice(0, durM.index).trim(); }
      script.statements.push({ type: 'dialog', speaker: m[1].trim(), text: text.replace(/^["“]|["”]$/g, ''), duration, nonBlocking, line: lineNo });
      continue;
    }

    // Directive list item
    m = t.match(/^[-*+]\s+(.*)$/) || t.match(/^\d+[.)]\s+(.*)$/);
    if (m) {
      // A list item that starts with @ is just an action in a list.
      const inner = m[1].trim();
      if (inner.startsWith('@')) { idx--; lines[idx + 1] = inner; continue; }
      script.statements.push(parseDirective(inner, lineNo));
      continue;
    }

    // Stage directions in italics or plain prose are ignored (kept as warnings for visibility).
    if (/^[_*].*[_*]$/.test(t)) { script.statements.push({ type: 'note', text: t.replace(/^[_*]+|[_*]+$/g, ''), line: lineNo }); continue; }
    script.warnings.push(`line ${lineNo}: ignored prose "${t.slice(0, 60)}"`);
  }
  return script;
}
