// Compiles a parsed script into a timeline: absolute-time tracks for actors,
// camera, environment, subtitles and overlays.  The renderer evaluates the
// timeline as a pure function of time, so rendering is deterministic.

import { DIRECTIONS } from './parser.js';

export const KIND_DEFAULTS = {
  fish:      { size: 0.6, speed: 4 },
  shark:     { size: 3.5, speed: 5 },
  whale:     { size: 8,   speed: 3 },
  octopus:   { size: 1.5, speed: 2 },
  jellyfish: { size: 1,   speed: 1.2 },
  turtle:    { size: 1.2, speed: 2 },
  crab:      { size: 0.4, speed: 1 },
  school:    { size: 0.4, speed: 3.5, count: 12 },
  dolphin:   { size: 2.5, speed: 6 },
  seahorse:  { size: 0.4, speed: 0.8 },
  starfish:  { size: 0.4, speed: 0.3 },
  ray:       { size: 2,   speed: 3 },
  eel:       { size: 1.5, speed: 2.5 },
  squid:     { size: 1.2, speed: 3 },
};
const SIZE_HINTS = { tiny: 0.5, small: 0.7, little: 0.7, big: 1.5, large: 1.5, huge: 2.5, giant: 3, baby: 0.5 };
const KIND_COLORS = {
  fish: 'silver', shark: 'gray', whale: '#3b6fb6', octopus: '#c2452d', jellyfish: '#ff9ad5',
  turtle: '#4f8f3a', crab: '#e2542b', school: '#f5b73b', dolphin: '#7e9fc4', seahorse: '#f2c14e',
  starfish: '#ff7f50', ray: '#556677', eel: '#4c6b3a', squid: '#d88ca6',
};
const CAMERA_SPEED = 6;
const OFFSCREEN = { left: 25, right: 25, up: 14, down: 14, top: 14, bottom: 14, above: 14, below: 14, forward: 30, front: 30, back: 30, backward: 30, away: 30 };

const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (n) => Math.round(n * 1000) / 1000;

function dialogDuration(text) {
  const chars = text.replace(/\s+/g, '').length;
  return Math.min(8, Math.max(1.6, 0.9 + chars * 0.065));
}

export function compile(script, options = {}) {
  const meta = {
    title: script.meta.title ?? '',
    fps: Number(options.fps ?? script.meta.fps ?? 24),
    width: Number(options.width ?? script.meta.width ?? 1280),
    height: Number(options.height ?? script.meta.height ?? 720),
    audio: script.meta.audio ?? null,
    font: script.meta.font ?? null,
    subtitles: script.meta.subtitles ?? true,
    language: script.meta.language ?? script.meta.lang ?? null,
    tail: Number(script.meta.tail ?? 1.5),
  };
  const warnings = [...script.warnings];
  const warn = (line, msg) => warnings.push(`line ${line}: ${msg}`);

  // ---- cast ------------------------------------------------------------------
  const cast = {};
  const castOrder = [];
  function addActor(entry, line) {
    const kind = entry.kind || 'fish';
    const def = KIND_DEFAULTS[kind] || KIND_DEFAULTS.fish;
    let size = entry.size ?? def.size * (SIZE_HINTS[entry.sizeHint] ?? 1);
    cast[entry.name] = {
      name: entry.name,
      kind,
      label: entry.label ?? capitalize(entry.name.replace(/[_-]+/g, ' ')),
      color: entry.color ?? KIND_COLORS[kind] ?? 'silver',
      size,
      speed: entry.speed ?? def.speed * Math.max(0.5, Math.sqrt(size / def.size)),
      count: entry.count ?? def.count ?? 1,
      style: entry.style ?? null,
      index: castOrder.length,
      declared: line != null,
    };
    castOrder.push(entry.name);
    return cast[entry.name];
  }
  for (const c of script.cast) addActor(c, c.line);

  const actors = {};
  const est = {}; // estimated current position per actor (for default durations)
  function actorTracks(name, line) {
    if (name === 'camera') return camera;
    if (!cast[name]) {
      warn(line, `actor "@${name}" was not declared in the cast; assuming a fish`);
      addActor({ name, kind: 'fish' });
    }
    if (!actors[name]) {
      actors[name] = { segments: [], visibility: [], emotes: [], looks: [], effects: [], scales: [] };
    }
    return actors[name];
  }
  function home(name) {
    const c = cast[name];
    const n = Math.max(1, castOrder.length);
    return [round((c.index - (n - 1) / 2) * 3), -3, 0];
  }
  function ensurePlaced(name, t, line) {
    const tr = actorTracks(name, line);
    if (tr.segments.length === 0) {
      const pos = home(name);
      tr.segments.push({ type: 'place', t0: t, t1: t, pos });
      est[name] = pos;
    }
    if (!visibleInScene.has(name) && !hiddenExplicitly.has(name)) {
      tr.visibility.push({ t, visible: true });
      visibleInScene.add(name);
    }
    return tr;
  }
  function estPos(name) { return est[name] ?? home(name); }
  function speedOf(name) { return cast[name]?.speed ?? 4; }
  function sizeOf(name) { return name === 'camera' ? 0 : (cast[name]?.size ?? 1); }

  const camera = { segments: [], looks: [], fov: [], shakes: [] };
  let camEst = [0, -2, 14];

  const env = [];
  const subtitles = [];
  const overlays = [];
  const markers = [];

  // ---- time cursor ----------------------------------------------------------
  let cursor = 0;
  let maxEnd = 0;
  let pendingCut = false;
  let currentScene = null;
  let sceneJustStarted = true;
  let visibleInScene = new Set();
  let hiddenExplicitly = new Set();
  function advance(t0, dur, nonBlocking) {
    const t1 = t0 + Math.max(0, dur);
    maxEnd = Math.max(maxEnd, t1);
    if (!nonBlocking) cursor = t1;
    return t1;
  }

  const resolveTargetPos = (target, self) => {
    if (!target) return estPos(self);
    if (target.pos) return target.pos;
    if (target.home) return home(self);
    if (target.actor === 'camera') return camEst;
    const base = estPos(target.actor);
    return target.offset ? vadd(base, target.offset) : base;
  };

  // ---- statements -------------------------------------------------------------
  for (const st of script.statements) {
    if (st.type !== 'scene' && st.type !== 'env' && st.type !== 'note' && st.type !== 'beat') sceneJustStarted = false;
    switch (st.type) {
      case 'scene': {
        cursor = maxEnd;
        currentScene = st.name;
        sceneJustStarted = true;
        // Actors do not carry over between scenes unless they act in the new one.
        if (markers.some((m) => m.kind === 'scene')) {
          for (const name of Object.keys(actors)) actors[name].visibility.push({ t: cursor, visible: false });
        }
        visibleInScene = new Set();
        hiddenExplicitly = new Set();
        markers.push({ t: cursor, label: st.name, kind: 'scene' });
        break;
      }
      case 'beat': {
        markers.push({ t: cursor, label: st.name, kind: 'beat' });
        break;
      }
      case 'note':
        break;
      case 'env': {
        const settings = { ...st.settings };
        let transition = settings.transition != null ? Number(settings.transition) : (env.length === 0 || sceneJustStarted ? 0 : 2);
        if (pendingCut) { transition = 0; pendingCut = false; }
        delete settings.transition;
        const prev = env[env.length - 1];
        if (prev && Math.abs(prev.t - cursor) < 1e-6) Object.assign(prev.settings, settings);
        else env.push({ t: cursor, settings, transition });
        break;
      }
      case 'dialog': {
        const t0 = cursor;
        const dur = st.duration ?? dialogDuration(st.text);
        const t1 = advance(t0, dur, st.nonBlocking);
        const speakerName = st.speaker;
        let kind = 'dialog';
        let label = speakerName;
        let actorName = null;
        if (st.narration || !speakerName || /^(narrator|voice|vo|v\.o\.|מספר|קריין)$/i.test(speakerName)) {
          kind = 'narration';
          label = speakerName && !/^(narrator|voice|vo|v\.o\.)$/i.test(speakerName) ? speakerName : null;
          if (speakerName && cast[speakerName]) { kind = 'dialog'; label = cast[speakerName].label; actorName = speakerName; }
        } else if (cast[speakerName]) {
          label = cast[speakerName].label; actorName = speakerName;
        } else {
          const byLabel = castOrder.find((n) => cast[n].label.toLowerCase() === speakerName.toLowerCase());
          if (byLabel) { label = cast[byLabel].label; actorName = byLabel; }
        }
        subtitles.push({ t0, t1, kind, speaker: label, actor: actorName, text: st.text, color: actorName ? cast[actorName].color : null });
        if (actorName) {
          const tr = ensurePlaced(actorName, t0, st.line);
          tr.effects.push({ t0, t1, type: 'talk' });
          if (st.to && cast[st.to]) tr.looks.push({ t: t0, target: { actor: st.to } });
        }
        break;
      }
      case 'directive': {
        const t0 = cursor;
        switch (st.name) {
          case 'wait': advance(t0, st.duration ?? 1, false); break;
          case 'sync': cursor = maxEnd; break;
          case 'fadeIn': { const d = st.duration ?? 1; overlays.push({ type: 'fade', t0, t1: t0 + d, from: 1, to: 0 }); advance(t0, d, st.nonBlocking); break; }
          case 'fadeOut': { const d = st.duration ?? 1; overlays.push({ type: 'fade', t0, t1: t0 + d, from: 0, to: 1 }); advance(t0, d, st.nonBlocking); break; }
          case 'black': { const d = st.duration ?? 1; overlays.push({ type: 'fade', t0, t1: t0 + d, from: 1, to: 1 }); advance(t0, d, st.nonBlocking); break; }
          case 'title': { const d = st.duration ?? 3; overlays.push({ type: 'title', t0, t1: t0 + d, text: st.quote, subtitle: st.subtitle ?? null }); advance(t0, d, st.nonBlocking); break; }
          case 'caption': { const d = st.duration ?? dialogDuration(st.quote); subtitles.push({ t0, t1: t0 + d, kind: 'caption', speaker: null, text: st.quote }); advance(t0, d, st.nonBlocking); break; }
          case 'cut': pendingCut = true; break;
          case 'marker': markers.push({ t: t0, label: st.quote || 'marker', kind: 'marker' }); break;
          default: warn(st.line, `directive "${st.name}" is not supported yet; ignored`);
        }
        break;
      }
      case 'action': {
        if (st.actor === 'camera') compileCamera(st);
        else compileActor(st);
        break;
      }
      default:
        warn(st.line, `unknown statement type ${st.type}`);
    }
  }

  function compileActor(st) {
    const name = st.actor;
    const t0 = cursor;
    const size = sizeOf(name);
    const ease = st.ease ?? 'smooth';
    switch (st.verb) {
      case 'place': {
        const tr = actorTracks(name, st.line);
        const pos = st.target?.pos ?? (st.target?.actor ? vadd(resolveTargetPos(st.target, name), [0, 0, 0]) : home(name));
        tr.segments.push({ type: 'place', t0, t1: t0, pos });
        tr.visibility.push({ t: t0, visible: true });
        visibleInScene.add(name);
        hiddenExplicitly.delete(name);
        est[name] = pos;
        advance(t0, 0, true);
        break;
      }
      case 'enter': {
        const tr = actorTracks(name, st.line);
        const dir = DIRECTIONS[st.direction] || DIRECTIONS.left;
        const target = st.target ? resolveTargetPos(st.target, name) : (est[name] ?? home(name));
        const start = vadd(target, vscale(dir, -(OFFSCREEN[st.direction] ?? 25)));
        const dur = st.duration ?? Math.max(1, vdist(start, target) / speedOf(name));
        tr.segments.push({ type: 'place', t0, t1: t0, pos: start });
        tr.visibility.push({ t: t0, visible: true });
        visibleInScene.add(name);
        hiddenExplicitly.delete(name);
        tr.segments.push({ type: 'to', t0, t1: t0 + dur, target: { pos: target }, ease });
        est[name] = target;
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'exit': {
        const tr = ensurePlaced(name, t0, st.line);
        const dir = DIRECTIONS[st.direction] || DIRECTIONS.right;
        const from = estPos(name);
        const target = vadd(from, vscale(dir, OFFSCREEN[st.direction] ?? 25));
        const dur = st.duration ?? Math.max(1, vdist(from, target) / speedOf(name));
        tr.segments.push({ type: 'to', t0, t1: t0 + dur, target: { pos: target }, ease: 'in' });
        tr.visibility.push({ t: t0 + dur, visible: false });
        visibleInScene.delete(name);
        est[name] = target;
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'hide': {
        const tr = actorTracks(name, st.line);
        tr.visibility.push({ t: t0, visible: false });
        visibleInScene.delete(name);
        hiddenExplicitly.add(name);
        break;
      }
      case 'show': {
        hiddenExplicitly.delete(name);
        visibleInScene.delete(name);
        ensurePlaced(name, t0, st.line); // pushes the visibility entry
        break;
      }
      case 'move': {
        const tr = ensurePlaced(name, t0, st.line);
        const from = estPos(name);
        let target;
        if (st.target) {
          if (st.target.actor && st.target.actor !== 'camera') {
            const near = st.target.near || !st.target.offset;
            const stop = near ? (sizeOf(st.target.actor) * 0.9 + size * 0.9 + 0.5) : 0;
            target = { actor: st.target.actor, offset: st.target.offset ?? [0, 0, 0], stopDistance: stop };
          } else {
            target = { pos: resolveTargetPos(st.target, name) };
          }
        } else {
          const dir = DIRECTIONS[st.direction];
          const p = vadd(from, vscale(dir, st.amount ?? 4));
          if (st.absoluteDepth != null) p[1] = st.absoluteDepth;
          target = { pos: p };
        }
        const dest = target.pos ?? resolveTargetPos({ actor: target.actor, offset: target.offset }, name);
        const dur = st.duration ?? Math.max(0.6, vdist(from, dest) / speedOf(name));
        tr.segments.push({ type: 'to', t0, t1: t0 + dur, target, ease });
        est[name] = dest;
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'orbit': {
        const tr = ensurePlaced(name, t0, st.line);
        const center = st.target.pos ? { pos: st.target.pos } : { actor: st.target.actor, offset: st.target.offset ?? [0, 0, 0] };
        const radius = st.radius ?? st.distance ?? Math.max(2, (st.target.actor ? sizeOf(st.target.actor) : 0) * 0.9 + size * 1.5 + 1);
        const loops = st.count ?? 1;
        const dur = st.duration ?? Math.max(1, (loops * 2 * Math.PI * radius) / speedOf(name));
        tr.segments.push({ type: 'orbit', t0, t1: t0 + dur, center, radius, loops, clockwise: st.clockwise !== false, ease });
        const c = resolveTargetPos(center, name);
        est[name] = vadd(c, [radius, 0, 0]);
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'follow': {
        const tr = ensurePlaced(name, t0, st.line);
        const other = st.target.actor;
        const gap = sizeOf(other) * 0.8 + size * 0.8 + 0.5;
        let offset = st.target.offset;
        const view = st.view ?? 'behind';
        if (!offset) {
          offset = view === 'behind' ? [0, 0, -gap] : view === 'front' ? [0, 0, gap] : view === 'above' ? [0, gap, 0] : view === 'below' ? [0, -gap, 0] : [gap, 0, 0];
        }
        const dur = st.duration ?? Infinity;
        tr.segments.push({ type: 'follow', t0, t1: Number.isFinite(dur) ? t0 + dur : 1e9, actor: other, offset, frame: (view === 'behind' || view === 'front') ? 'local' : 'world' });
        est[name] = vadd(estPos(other), offset);
        if (Number.isFinite(dur)) advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'stop': {
        const tr = ensurePlaced(name, t0, st.line);
        tr.segments.push({ type: 'hold', t0, t1: t0 });
        break;
      }
      case 'look': {
        const tr = ensurePlaced(name, t0, st.line);
        if (st.target) tr.looks.push({ t: t0, target: st.target });
        else tr.looks.push({ t: t0, direction: DIRECTIONS[st.direction] });
        break;
      }
      case 'wait': {
        ensurePlaced(name, t0, st.line);
        advance(t0, st.duration ?? 1, st.nonBlocking);
        break;
      }
      case 'emote': {
        const tr = ensurePlaced(name, t0, st.line);
        tr.emotes.push({ t: t0, emotion: st.emotion });
        break;
      }
      case 'spin': case 'wiggle': case 'nod': case 'bubbles': case 'cry': case 'spout': case 'glow': {
        const tr = ensurePlaced(name, t0, st.line);
        const defaults = { spin: (st.count ?? 1) * 1, wiggle: 1.5, nod: 1, bubbles: 2, cry: 3, spout: 2, glow: 3 };
        const dur = st.duration ?? defaults[st.verb];
        tr.effects.push({ t0, t1: t0 + dur, type: st.verb, count: st.count ?? 1, strength: st.strength ?? 1 });
        if (st.verb === 'cry') tr.emotes.push({ t: t0, emotion: 'sad' });
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'jump': {
        const tr = ensurePlaced(name, t0, st.line);
        const from = estPos(name);
        const dur = st.duration ?? 1.2 + size * 0.1;
        const target = st.target ? { pos: resolveTargetPos(st.target, name) } : { pos: from };
        tr.segments.push({ type: 'to', t0, t1: t0 + dur, target, ease: 'linear', arc: st.height ?? (2 + size * 0.5) });
        est[name] = target.pos;
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'scale': {
        const tr = ensurePlaced(name, t0, st.line);
        const dur = st.duration ?? 1;
        const prev = tr.scales.length ? tr.scales[tr.scales.length - 1].to : 1;
        const to = st.size != null ? st.size / size : (prev * (st.factor ?? 1));
        tr.scales.push({ t0, t1: t0 + dur, to });
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'speed': {
        actorTracks(name, st.line);
        cast[name].speed = st.speed;
        break;
      }
      case 'carry': {
        const carrier = name;
        const carried = st.target.actor;
        ensurePlaced(carrier, t0, st.line);
        const tr = ensurePlaced(carried, t0, st.line);
        const offset = st.target.offset ?? [0, -sizeOf(carrier) * 0.25, 0];
        tr.segments.push({ type: 'follow', t0, t1: 1e9, actor: carrier, offset, frame: 'local', attached: true });
        est[carried] = vadd(estPos(carrier), offset);
        break;
      }
      case 'drop': {
        const carried = st.target?.actor;
        if (carried) {
          const tr = ensurePlaced(carried, t0, st.line);
          tr.segments.push({ type: 'hold', t0, t1: t0 });
        }
        break;
      }
      default:
        warn(st.line, `verb "${st.verb}" is not supported yet; ignored`);
    }
  }

  function compileCamera(st) {
    const t0 = cursor;
    const ease = st.ease ?? 'smooth';
    switch (st.verb) {
      case 'cut': {
        const pos = st.target?.pos ?? (st.target?.actor ? defaultCamOffset(st.target) : camEst);
        camera.segments.push({ type: 'place', t0, t1: t0, pos });
        camEst = pos;
        if (st.lookTarget) camera.looks.push({ t0, t1: t0, target: st.lookTarget });
        else if (st.target?.actor) camera.looks.push({ t0, t1: t0, target: { actor: st.target.actor } });
        break;
      }
      case 'move': {
        let target;
        if (st.target?.pos) target = { pos: st.target.pos };
        else if (st.target?.actor) target = { actor: st.target.actor, offset: st.target.offset ?? camOffsetFor(st.target.actor, st.view, st.distance, st.height) };
        else if (st.direction) target = { pos: vadd(camEst, vscale(DIRECTIONS[st.direction], st.amount ?? 4)) };
        else target = { pos: camEst };
        const dest = target.pos ?? vadd(estPos(target.actor), target.offset);
        const dur = st.duration ?? Math.max(1, vdist(camEst, dest) / CAMERA_SPEED);
        camera.segments.push({ type: 'to', t0, t1: t0 + dur, target, ease });
        camEst = dest;
        if (st.lookTarget) camera.looks.push({ t0, t1: t0 + Math.min(dur, 1), target: st.lookTarget });
        else if (st.target?.actor) camera.looks.push({ t0, t1: t0 + Math.min(dur, 1), target: { actor: st.target.actor } });
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'look': {
        const dur = st.duration ?? 1;
        camera.looks.push({ t0, t1: t0 + dur, target: st.target ?? { dir: DIRECTIONS[st.direction] } });
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'follow': {
        const other = st.target.actor;
        const view = st.view ?? 'behind';
        const offset = st.target.offset ?? camOffsetFor(other, view, st.distance, st.height);
        const dur = st.duration ?? Infinity;
        const blend = 1.0;
        camera.segments.push({ type: 'follow', t0, t1: Number.isFinite(dur) ? t0 + dur : 1e9, actor: other, offset, frame: (view === 'behind' || view === 'front') ? 'local' : 'world', blend });
        camera.looks.push({ t0, t1: t0 + blend, target: { actor: other } });
        camEst = vadd(estPos(other), offset);
        if (Number.isFinite(dur)) advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'orbit': {
        const other = st.target.actor;
        const center = other ? { actor: other, offset: st.target.offset ?? [0, 0, 0] } : { pos: st.target.pos };
        const radius = st.distance ?? st.radius ?? (other ? sizeOf(other) * 2.5 + 4 : 8);
        const loops = st.count ?? 1;
        const dur = st.duration ?? 8 * loops;
        camera.segments.push({ type: 'orbit', t0, t1: t0 + dur, center, radius, loops, clockwise: st.clockwise !== false, height: st.height ?? (other ? sizeOf(other) * 0.5 + 1 : 1), ease: 'linear', blend: 1 });
        camera.looks.push({ t0, t1: t0 + 1, target: center });
        camEst = vadd(other ? estPos(other) : center.pos, [radius, 0, 0]);
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'shake': {
        const dur = st.duration ?? 1;
        camera.shakes.push({ t0, t1: t0 + dur, strength: st.strength ?? 1 });
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'zoom': {
        const dur = st.duration ?? 1;
        camera.fov.push({ t0, t1: t0 + dur, to: st.fov });
        advance(t0, dur, st.nonBlocking);
        break;
      }
      case 'stop': {
        camera.segments.push({ type: 'hold', t0, t1: t0 });
        camera.looks.push({ t0, t1: t0, hold: true });
        if (st.duration) advance(t0, st.duration, st.nonBlocking);
        break;
      }
      default:
        warn(st.line, `camera verb "${st.verb}" is not supported yet; ignored`);
    }
  }

  function camOffsetFor(actorName, view, distance, height) {
    const s = sizeOf(actorName);
    const d = distance ?? s * 2.4 + 1.6;
    const h = height ?? s * 0.35 + 0.4;
    switch (view) {
      case 'front': return [0, h, d];
      case 'above': return [0, d, 0.01];
      case 'below': return [0, -d, 0.01];
      case 'side': return [d, h, 0];
      case 'behind': return [0, h, -d];
      default: return [d * 0.6, h, d * 0.8];
    }
  }
  function defaultCamOffset(target) {
    return vadd(estPos(target.actor), target.offset ?? camOffsetFor(target.actor, 'default'));
  }

  // ---- defaults & finalisation ----------------------------------------------
  if (!camera.segments.some((s) => s.t0 <= 1e-6)) {
    camera.segments.unshift({ type: 'place', t0: 0, t1: 0, pos: [0, -2, 14] });
  }
  if (!camera.looks.some((l) => l.t0 <= 1e-6)) {
    camera.looks.unshift({ t0: 0, t1: 0, target: { pos: [0, -3, 0] } });
  }
  if (env.length === 0 || env[0].t > 1e-6) env.unshift({ t: 0, settings: {}, transition: 0 });
  for (const name of Object.keys(actors)) {
    const tr = actors[name];
    tr.segments.sort((a, b) => a.t0 - b.t0);
    tr.visibility.sort((a, b) => a.t - b.t);
    tr.looks.sort((a, b) => a.t - b.t);
    tr.emotes.sort((a, b) => a.t - b.t);
    tr.effects.sort((a, b) => a.t0 - b.t0);
    tr.scales.sort((a, b) => a.t0 - b.t0);
  }
  camera.segments.sort((a, b) => a.t0 - b.t0);
  camera.looks.sort((a, b) => a.t0 - b.t0);
  // Declared but never used actors: keep them out of the scene.
  for (const name of castOrder) if (!actors[name]) warn(script.cast.find((c) => c.name === name)?.line ?? 0, `actor "@${name}" is declared but never used`);

  const duration = Number(options.duration ?? script.meta.duration ?? (maxEnd + meta.tail));
  meta.duration = Math.max(0.5, duration);
  meta.frames = Math.ceil(meta.duration * meta.fps);

  return { meta, cast, actors, camera, env, subtitles, overlays, markers, warnings };
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
