// Pure-function evaluation of a compiled timeline at time t.
// Everything here is deterministic: no Date.now(), no accumulated state.
// Results are memoised per frame (call `beginFrame(t)` before evaluating).

const EPS = 1e-4;
const DT = 1 / 30;

const v3 = (a) => [a[0], a[1], a[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a); return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 1]; };
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const smoother = (u) => { u = clamp01(u); return u * u * u * (u * (u * 6 - 15) + 10); };

export const EASES = {
  linear: (u) => clamp01(u),
  smooth: smoother,
  ease: smoother,
  in: (u) => { u = clamp01(u); return u * u; },
  out: (u) => { u = clamp01(u); return 1 - (1 - u) * (1 - u); },
  snap: (u) => (u >= 1 ? 1 : 0),
  bouncy: (u) => { u = clamp01(u); const s = 1.70158 * 1.2; return 1 + (--u) * u * ((s + 1) * u + s); },
  elastic: (u) => { u = clamp01(u); if (u === 0 || u === 1) return u; return Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * (2 * Math.PI) / 3) + 1; },
};

// Spherical-ish interpolation for unit direction vectors.
function slerp(a, b, u) {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  if (d > 0.9995) return norm(lerp(a, b, u));
  if (d < -0.9995) { // opposite: rotate around the y axis
    const ang = Math.PI * u;
    const c = Math.cos(ang), s = Math.sin(ang);
    return norm([a[0] * c - a[2] * s, a[1], a[0] * s + a[2] * c]);
  }
  const th = Math.acos(d);
  const sa = Math.sin((1 - u) * th) / Math.sin(th);
  const sb = Math.sin(u * th) / Math.sin(th);
  return norm(add(scale(a, sa), scale(b, sb)));
}

function rotateY(v, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

const FACE_BY_EMOTION = {
  neutral:   { smile: 0.15, mouthOpen: 0, teeth: false },
  happy:     { smile: 0.7, mouthOpen: 0.05, teeth: false },
  excited:   { smile: 0.9, mouthOpen: 0.25, teeth: true, eyesWide: 0.3 },
  proud:     { smile: 0.55, mouthOpen: 0, teeth: false },
  sad:       { smile: -0.6, mouthOpen: 0, teeth: false },
  lonely:    { smile: -0.45, mouthOpen: 0, teeth: false },
  crying:    { smile: -0.8, mouthOpen: 0.3, teeth: false },
  scared:    { smile: -0.3, mouthOpen: 0.45, teeth: false, eyesWide: 0.5 },
  surprised: { smile: 0.1, mouthOpen: 0.7, teeth: false, eyesWide: 0.6 },
  sleepy:    { smile: 0.1, mouthOpen: 0.1, teeth: false },
  angry:     { smile: -0.6, mouthOpen: 0.2, teeth: true },
  calm:      { smile: 0.25, mouthOpen: 0, teeth: false },
  curious:   { smile: 0.25, mouthOpen: 0.15, teeth: false },
};

export class TimelineEvaluator {
  constructor(timeline) {
    this.tl = timeline;
    this.memo = new Map();
    this.depth = 0;
    this.envParams = null;
    const n = Math.max(1, Object.keys(timeline.cast).length);
    this.homes = {};
    for (const [name, c] of Object.entries(timeline.cast)) this.homes[name] = [(c.index - (n - 1) / 2) * 3, -3, 0];
  }

  beginFrame() { this.memo.clear(); }

  _memo(key, fn) {
    if (this.memo.has(key)) return this.memo.get(key);
    if (++this.depth > 400) { this.depth--; return fn.fallback ? fn.fallback() : [0, -3, 0]; }
    let v;
    try { v = fn(); } finally { this.depth--; }
    this.memo.set(key, v);
    return v;
  }

  tracks(name) { return name === 'camera' ? this.tl.camera : this.tl.actors[name]; }
  size(name) { return name === 'camera' ? 0 : (this.tl.cast[name]?.size ?? 1); }
  defaultPos(name) { return name === 'camera' ? [0, -2, 14] : (this.homes[name] ?? [0, -3, 0]); }

  activeSegment(name, t) {
    const tr = this.tracks(name);
    if (!tr) return null;
    let seg = null;
    for (const s of tr.segments) { if (s.t0 <= t + 1e-9) seg = s; else break; }
    return seg;
  }

  // Position of an actor/camera (track position, no idle motion).
  pos(name, t) {
    const key = `p|${name}|${t.toFixed(5)}`;
    return this._memo(key, () => {
      const seg = this.activeSegment(name, t);
      if (!seg) return this.defaultPos(name);
      return this.evalSegment(name, seg, t);
    });
  }

  // Where the actor is when `seg` starts: the previous segment (in script
  // order) evaluated at seg.t0.  Using list order rather than time makes
  // segments that start at the same instant (place + move) resolve correctly.
  segStart(name, seg) {
    const tr = this.tracks(name);
    const idx = tr.segments.indexOf(seg);
    const key = `s|${name}|${idx}`;
    return this._memo(key, () => {
      if (idx <= 0) return this.defaultPos(name);
      return this.evalSegment(name, tr.segments[idx - 1], seg.t0);
    });
  }

  resolveTarget(target, t, self) {
    if (!target) return this.defaultPos(self);
    if (target.pos) return v3(target.pos);
    if (target.home) return this.defaultPos(self);
    let p = this.pos(target.actor, t);
    if (target.offset) p = add(p, target.offset);
    return p;
  }

  evalSegment(name, seg, t) {
    const dur = Math.max(1e-6, seg.t1 - seg.t0);
    const u = clamp01((t - seg.t0) / dur);
    switch (seg.type) {
      case 'place': return v3(seg.pos);
      case 'hold': return this.segStart(name, seg);
      case 'to': {
        const start = this.segStart(name, seg);
        let dest = this.resolveTarget(seg.target, t, name);
        if (seg.target.stopDistance) {
          const d = sub(dest, start);
          const l = len(d);
          if (l > seg.target.stopDistance) dest = add(dest, scale(d, -seg.target.stopDistance / l));
          else dest = start;
        }
        const e = (EASES[seg.ease] || EASES.smooth)(u);
        const p = lerp(start, dest, e);
        if (seg.arc) p[1] += seg.arc * Math.sin(Math.PI * clamp01(u));
        return p;
      }
      case 'orbit': {
        const start = this.segStart(name, seg);
        const c0 = this.resolveTarget(seg.center, seg.t0, name);
        const c = this.resolveTarget(seg.center, t, name);
        const d0 = sub(start, c0);
        const dist0 = Math.hypot(d0[0], d0[2]);
        const phase0 = dist0 > 1e-3 ? Math.atan2(d0[2], d0[0]) : 0;
        const e = (EASES[seg.ease] || EASES.linear)(u);
        const ang = phase0 + (seg.clockwise ? -1 : 1) * 2 * Math.PI * seg.loops * e;
        const settle = smooth(Math.min(1, u * 5));
        const r = dist0 + (seg.radius - dist0) * settle;
        const y = start[1] + ((c[1] + (seg.height ?? 0)) - start[1]) * settle;
        return [c[0] + r * Math.cos(ang), y, c[2] + r * Math.sin(ang)];
      }
      case 'follow': {
        const other = this.pos(seg.actor, t);
        let off = seg.offset;
        if (seg.frame === 'local') {
          const h = this.heading(seg.actor, t);
          const yaw = Math.atan2(h[0], h[2]);
          off = rotateY(off, yaw);
        }
        const target = add(other, off);
        const blend = seg.blend ?? (seg.attached ? 0.5 : 1);
        if (blend > 0 && t < seg.t0 + blend) {
          const start = this.segStart(name, seg);
          return lerp(start, target, smoother((t - seg.t0) / blend));
        }
        return target;
      }
      default: return this.segStart(name, seg);
    }
  }

  // Velocity-based motion: { dir, speed }
  motion(name, t) {
    const key = `m|${name}|${t.toFixed(5)}`;
    return this._memo(key, () => {
      const a = this.pos(name, t);
      const b = this.pos(name, t - DT);
      const v = sub(a, b);
      const speed = len(v) / DT;
      return { dir: speed > 0.05 ? norm(v) : null, speed };
    });
  }

  lastMoveEnd(name, t) {
    const tr = this.tracks(name);
    let end = -Infinity;
    if (!tr) return end;
    for (const s of tr.segments) {
      if (s.t0 > t + 1e-9) break;
      if (s.type === 'to' || s.type === 'orbit' || s.type === 'follow') end = Math.max(end, Math.min(s.t1, t));
    }
    return end;
  }

  lookDir(name, look, t) {
    if (look.direction) return norm(look.direction);
    const target = look.target;
    const p = this.pos(name, t);
    let tp;
    if (target.actor === 'camera') tp = this.cameraPos(t);
    else tp = this.resolveTarget(target, t, name);
    const d = sub(tp, p);
    return len(d) > 1e-4 ? norm(d) : [1, 0, 0];
  }

  // Unit facing direction for an actor.
  heading(name, t) {
    const key = `h|${name}|${t.toFixed(5)}`;
    return this._memo(key, () => {
      const tr = this.tracks(name);
      if (!tr) return [1, 0, 0];
      const m = this.motion(name, t);
      const looks = tr.looks || [];
      let look = null;
      for (const l of looks) { if (l.t <= t + 1e-9) look = l; else break; }
      const moveEnd = this.lastMoveEnd(name, t);
      let raw;
      let eventT = -Infinity;
      const seg = this.activeSegment(name, t);
      // a passenger faces exactly where its carrier faces (rider on a bike, fish in a pouch)
      if (seg && seg.type === 'follow' && seg.attached && t >= seg.t0 + (seg.blend ?? 0.5)) return this.heading(seg.actor, t);
      if (m.dir) {
        raw = m.dir;
        if (seg) eventT = seg.t0;
      } else if (look && look.t >= moveEnd - 1e-6) {
        raw = this.lookDir(name, look, t);
        eventT = look.t;
      } else if (Number.isFinite(moveEnd) && moveEnd < t - 1e-6) {
        raw = this.heading(name, moveEnd - 1e-3);
        eventT = -Infinity;
      } else if (look) {
        raw = this.lookDir(name, look, t);
        eventT = look.t;
      } else {
        raw = [1, 0, 0];
      }
      // Smooth turns: blend from the heading just before the latest event.
      const turnTime = 0.35 + this.size(name) * 0.06;
      if (Number.isFinite(eventT) && t - eventT < turnTime && eventT > 1e-6) {
        const prev = this.heading(name, eventT - EPS);
        return slerp(prev, raw, smooth((t - eventT) / turnTime));
      }
      return raw;
    });
  }

  visible(name, t) {
    const tr = this.tracks(name);
    if (!tr) return false;
    let vis = null;
    for (const v of tr.visibility) { if (v.t <= t + 1e-9) vis = v.visible; else break; }
    if (vis == null) return tr.segments.length > 0 && tr.segments[0].t0 <= t;
    return vis;
  }

  emotion(name, t) {
    const tr = this.tracks(name);
    if (!tr) return 'neutral';
    let e = null;
    for (const x of tr.emotes) { if (x.t <= t + 1e-9) e = x; else break; }
    if (!e) return 'neutral';
    const transient = { scared: 10, surprised: 4, excited: 8, crying: 6 };
    if (transient[e.emotion] && t - e.t > transient[e.emotion]) return 'neutral';
    return e.emotion;
  }

  // The emotion a moment ago and how far the change has progressed (0..1 over
  // 0.6 s), so rigs can blend between the two instead of snapping
  emotionBlend(name, t) {
    const tr = this.tracks(name);
    if (!tr) return { from: 'neutral', u: 1 };
    const transient = { scared: 10, surprised: 4, excited: 8, crying: 6 };
    let changeT = -Infinity;
    for (const x of tr.emotes) {
      if (x.t <= t + 1e-9) { changeT = Math.max(changeT, x.t); if (transient[x.emotion] && x.t + transient[x.emotion] <= t) changeT = Math.max(changeT, x.t + transient[x.emotion]); }
      else break;
    }
    if (!Number.isFinite(changeT) || t - changeT >= 0.6) return { from: this.emotion(name, t), u: 1 };
    return { from: this.emotion(name, changeT - 1e-3), u: (t - changeT) / 0.6 };
  }

  // Facial state: { smile: -1..1, mouthOpen: 0..1, teeth, blink: 0..1, wink: 0..1 }
  face(name, t) {
    const key = `f|${name}|${t.toFixed(5)}`;
    return this._memo(key, () => {
      const tr = this.tracks(name);
      const emo = this.emotion(name, t);
      const base = FACE_BY_EMOTION[emo] || FACE_BY_EMOTION.neutral;
      const f = { smile: base.smile, mouthOpen: base.mouthOpen, teeth: base.teeth, blink: 0, wink: 0, eyesWide: base.eyesWide || 0 };
      if (!tr) return f;
      let smileSet = null, teethSet = null, mouthSet = null;
      for (const x of tr.face || []) {
        if (x.t > t + 1e-9) break;
        if (x.smile != null) smileSet = x.smile;
        if (x.teeth != null) teethSet = x.teeth;
        if (x.mouth != null) mouthSet = x.mouth;
      }
      if (smileSet != null) f.smile = smileSet;
      if (teethSet != null) f.teeth = teethSet;
      if (mouthSet != null) f.mouthOpen = Math.max(f.mouthOpen, mouthSet);
      for (const e of this.effects(name, t)) {
        const u = e.u;
        if (e.type === 'mouth') f.mouthOpen = Math.max(f.mouthOpen, (e.value ?? 0.7) * Math.sin(Math.PI * Math.min(1, u * 4)));
        if (e.type === 'yawn') { f.mouthOpen = Math.max(f.mouthOpen, Math.sin(Math.PI * u) * 0.9); f.blink = Math.max(f.blink, Math.sin(Math.PI * u) * 0.8); }
        if (e.type === 'gasp') { f.mouthOpen = Math.max(f.mouthOpen, 0.8 * (1 - u * 0.3)); f.eyesWide = 0.5; }
        if (e.type === 'blink') {
          const n = Math.max(1, e.count || 1);
          const phase = (u * n) % 1;
          f.blink = Math.max(f.blink, phase < 0.5 ? Math.min(1, phase * 4) : Math.max(0, 1 - (phase - 0.5) * 4));
        }
        if (e.type === 'wink') f.wink = Math.max(f.wink, Math.sin(Math.PI * u));
        if (e.type === 'eat') f.mouthOpen = Math.max(f.mouthOpen, 0.25 + 0.6 * Math.abs(Math.sin(e.age * 7)) * (u < 0.92 ? 1 : (1 - u) / 0.08));
        if (e.type === 'talk') {
          // lip-sync from the voice envelope when available, otherwise a generic rhythm
          const sub = e.line != null ? this.tl.subtitles.find((x) => x.line === e.line && x.t0 === e.t0) : null;
          let open;
          if (sub && sub.envelope && sub.envelope.length) {
            const rate = sub.envelopeRate || 25;
            const i = Math.max(0, (t - sub.t0) * rate);
            const i0 = Math.min(sub.envelope.length - 1, Math.floor(i)), i1 = Math.min(sub.envelope.length - 1, i0 + 1);
            const a = sub.envelope[i0] ?? 0, b = sub.envelope[i1] ?? 0;
            open = a + (b - a) * Math.min(1, i - i0);
          } else open = 0.35 + 0.65 * Math.abs(Math.sin(t * 9 + (this.tl.cast[name]?.index || 0)));
          f.mouthOpen = Math.max(f.mouthOpen, open);
        }
      }
      // automatic idle blinks: one short blink in every ~4 s window at a pseudo-random moment
      const seed = (this.tl.cast[name]?.index || 0) * 7.31;
      const period = 3.6 + ((seed * 13) % 1.7);
      const win = Math.floor((t + seed) / period);
      const frac = ((Math.sin(win * 12.9898 + seed) * 43758.5453) % 1 + 1) % 1;
      const tb = win * period + frac * (period - 0.3) - seed;
      const dt = t - tb;
      if (dt >= 0 && dt < 0.16) f.blink = Math.max(f.blink, dt < 0.08 ? dt / 0.08 : 1 - (dt - 0.08) / 0.08);
      return f;
    });
  }

  scale(name, t) {
    const tr = this.tracks(name);
    if (!tr || !tr.scales) return 1;
    let prev = 1;
    let cur = null;
    for (const s of tr.scales) { if (s.t0 <= t + 1e-9) { if (cur) prev = cur.to; cur = s; } else break; }
    if (!cur) return 1;
    const u = smoother((t - cur.t0) / Math.max(1e-6, cur.t1 - cur.t0));
    return prev + (cur.to - prev) * u;
  }

  // distance travelled since the start (metres), from the timeline itself so
  // every render chunk agrees: used to spin wheels and pedals
  distance(name, t) {
    const step = 0.05;
    const n = Math.max(0, Math.floor(t / step));
    if (!this._dist) this._dist = new Map();
    let d = this._dist.get(name);
    if (!d) { d = { sums: [0], last: this.pos(name, 0) }; this._dist.set(name, d); }
    while (d.sums.length <= n) {
      const k = d.sums.length;
      const p = this.pos(name, k * step);
      const vis = this.visible(name, k * step) && this.visible(name, (k - 1) * step);
      const dd = vis ? Math.hypot(p[0] - d.last[0], p[1] - d.last[1], p[2] - d.last[2]) : 0;
      d.sums.push(d.sums[k - 1] + (dd < 3 ? dd : 0));
      d.last = p;
    }
    const p = this.pos(name, t);
    const tail = Math.hypot(p[0] - d.last[0], p[1] - d.last[1], p[2] - d.last[2]);
    return d.sums[n] + (n === d.sums.length - 1 && tail < 3 ? tail : 0);
  }

  effects(name, t) {
    const tr = this.tracks(name);
    if (!tr || !tr.effects) return [];
    const out = [];
    for (const e of tr.effects) {
      if (e.t0 <= t && t < e.t1) out.push({ ...e, u: (t - e.t0) / Math.max(1e-6, e.t1 - e.t0), age: t - e.t0 });
    }
    return out;
  }

  // ---- camera ----------------------------------------------------------------
  cameraPos(t) { return this.pos('camera', t); }

  cameraShake(t) {
    let off = [0, 0, 0];
    for (const s of this.tl.camera.shakes || []) {
      if (t < s.t0 || t > s.t1) continue;
      const u = (t - s.t0) / Math.max(1e-6, s.t1 - s.t0);
      const env = Math.sin(Math.PI * u) * (s.strength ?? 1) * 0.25;
      off = add(off, [Math.sin(t * 43.7) * env, Math.sin(t * 57.3 + 1.3) * env, Math.sin(t * 31.1 + 2.1) * env * 0.5]);
    }
    return off;
  }

  lookEntryPos(index, t) {
    const looks = this.tl.camera.looks;
    const key = `cl|${index}|${t.toFixed(5)}`;
    return this._memo(key, () => {
      if (index < 0) return [0, -3, 0];
      const l = looks[index];
      let target;
      if (l.hold) target = this.lookEntryPos(index - 1, l.t0 - EPS);
      else if (l.target?.dir) target = add(this.cameraPos(t), l.target.dir);
      else {
        target = this.resolveTarget(l.target, t, 'camera');
        if (l.target?.actor && l.target.actor !== 'camera') target = add(target, [0, this.size(l.target.actor) * 0.15, 0]);
      }
      if (index > 0 && t < l.t1) {
        const prev = this.lookEntryPos(index - 1, t);
        return lerp(prev, target, smoother((t - l.t0) / Math.max(1e-6, l.t1 - l.t0)));
      }
      return target;
    });
  }

  cameraLook(t) {
    const looks = this.tl.camera.looks;
    let idx = -1;
    for (let i = 0; i < looks.length; i++) { if (looks[i].t0 <= t + 1e-9) idx = i; else break; }
    return this.lookEntryPos(idx, t);
  }

  cameraFov(t) {
    let prev = 50;
    let cur = null;
    for (const f of this.tl.camera.fov || []) { if (f.t0 <= t + 1e-9) { if (cur) prev = cur.to; cur = f; } else break; }
    if (!cur) return prev;
    const u = smoother((t - cur.t0) / Math.max(1e-6, cur.t1 - cur.t0));
    return prev + (cur.to - prev) * u;
  }

  // ---- env, subtitles, overlays ---------------------------------------------
  // Returns { index, blend, prevIndex } describing which env entries to mix.
  envState(t) {
    const env = this.tl.env;
    let idx = 0;
    for (let i = 0; i < env.length; i++) { if (env[i].t <= t + 1e-9) idx = i; else break; }
    const e = env[idx];
    if (idx > 0 && e.transition > 0 && t < e.t + e.transition) {
      return { index: idx, prevIndex: idx - 1, blend: smoother((t - e.t) / e.transition) };
    }
    return { index: idx, prevIndex: idx, blend: 1 };
  }

  subtitles(t) { return this.tl.subtitles.filter((s) => s.t0 <= t && t < s.t1).map((s) => ({ ...s, u: (t - s.t0) / Math.max(1e-6, s.t1 - s.t0), age: t - s.t0, remaining: s.t1 - t })); }
  overlays(t) { return this.tl.overlays.filter((o) => o.t0 <= t && t < o.t1).map((o) => ({ ...o, u: (t - o.t0) / Math.max(1e-6, o.t1 - o.t0), age: t - o.t0, remaining: o.t1 - t })); }
}
