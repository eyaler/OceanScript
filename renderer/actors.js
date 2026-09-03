// Procedural sea-creature rigs.  Every rig is built facing +z with a body
// length of ~1 unit and exposes update(t, state) where state holds the
// current speed, emotion, effects and talking flag.  Rigs are deterministic:
// all motion is a function of t.
import * as THREE from 'three';
import { toHex } from './colors.js';
import { rng } from './ocean.js';

const TAU = Math.PI * 2;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.55, metalness: 0.05, ...opts });
}
function tintVertexBelly(geo, top, belly, threshold = -0.15) {
  const n = geo.attributes.normal, c = new Float32Array(n.count * 3);
  const t = new THREE.Color(top), b = new THREE.Color(belly), tmp = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    const k = THREE.MathUtils.smoothstep(-n.getY(i), -threshold, 0.6);
    tmp.copy(t).lerp(b, k);
    c.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
function lighten(hex, k) { const c = new THREE.Color(hex); return c.lerp(new THREE.Color(1, 1, 1), k); }
function darken(hex, k) { const c = new THREE.Color(hex); return c.lerp(new THREE.Color(0, 0, 0), k); }
function finShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
function eyes(parent, color, { z = 0.32, x = 0.13, y = 0.1, r = 0.07, look = 0 } = {}) {
  const g = new THREE.Group();
  const white = mat('#ffffff', { roughness: 0.3 });
  const black = mat('#101418', { roughness: 0.25 });
  const list = [];
  const brows = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), white);
    e.position.set(sx * x, y, z);
    const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 10, 8), black);
    p.position.set(sx * r * 0.35, 0, r * 0.7);
    e.add(p);
    g.add(e);
    list.push(e);
    // eyebrow: a thin dark bar above the eye, tilted inward when angry
    const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 1.9, r * 0.28, r * 0.3), black);
    brow.position.set(sx * x, y + r * 1.25, z + r * 0.3);
    brow.visible = false;
    brow.userData.sx = sx;
    g.add(brow);
    brows.push(brow);
  }
  parent.add(g);
  parent.userData.brows = (parent.userData.brows || []).concat(brows);
  return { group: g, eyes: list, brows };
}
function setBrows(rig, face, emo) {
  const brows = rig.inner?.userData?.brows;
  if (!brows) return;
  const angry = emo === 'angry' || (face.smile != null && face.smile < -0.5 && emo !== 'sad' && emo !== 'crying' && emo !== 'lonely');
  const sad = emo === 'sad' || emo === 'crying' || emo === 'lonely';
  for (const b of brows) {
    b.visible = angry || sad;
    b.rotation.z = angry ? -b.userData.sx * 0.45 : sad ? b.userData.sx * 0.35 : 0;
  }
}
function mouth(parent, { z = 0.48, y = -0.06, w = 0.14 } = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(w * 0.5, 10, 8), mat('#3a1520', { roughness: 0.4 }));
  m.position.set(0, y, z);
  m.scale.set(1, 0.35, 0.5);
  parent.add(m);
  return m;
}

// ---- articulated mouth ------------------------------------------------------------
// A mouth that can open (lip-sync), smile or frown, and show teeth.  Built at
// (0, y, z) facing +z.  `set(face)` applies { mouthOpen, smile, teeth }.
function makeMouth(parent, { z = 0.48, y = -0.06, w = 0.12, h = 0.06, teethCount = 6, teethSize = 0.018, lipColor = '#3a1520', teethDefault = false } = {}) {
  const g = new THREE.Group();
  g.position.set(0, y, z);
  const cavity = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mat('#4a1220', { roughness: 0.6 }));
  cavity.scale.set(w, h * 0.05, w * 0.35);
  cavity.position.z = -w * 0.25; // recessed into the head
  g.add(cavity);
  const teethMat = mat('#f6f6f0', { roughness: 0.4 });
  const teeth = new THREE.Group();
  for (let i = 0; i < teethCount; i++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(teethSize, teethSize * 2.4, 5), teethMat);
    const u = teethCount === 1 ? 0 : (i / (teethCount - 1)) * 2 - 1;
    tooth.position.set(u * w * 0.75, teethSize * 0.3, w * 0.22 * (1 - u * u * 0.6));
    tooth.rotation.x = Math.PI;
    teeth.add(tooth);
  }
  teeth.visible = teethDefault;
  g.add(teeth);
  const arc = Math.PI * 0.75;
  const smile = new THREE.Mesh(new THREE.TorusGeometry(w * 0.9, Math.max(0.006, w * 0.07), 6, 24, arc), mat(lipColor, { roughness: 0.5 }));
  smile.position.z = w * 0.3;
  g.add(smile);
  parent.add(g);
  const api = { group: g, cavity, teeth, smile, w, h, teethDefault, talkOpen: 0 };
  api.set = (face) => {
    const open = Math.max(0, Math.min(1, face.mouthOpen || 0));
    cavity.scale.set(w, h * (0.05 + open * 0.95), w * 0.35);
    cavity.position.y = -h * open * 0.45;
    const sm = face.smile || 0;
    if (Math.abs(sm) < 0.08) { smile.rotation.z = -Math.PI / 2 - arc / 2; smile.scale.set(1, 0.06, 1); smile.position.y = 0; }
    else if (sm > 0) { smile.rotation.z = -Math.PI / 2 - arc / 2; smile.scale.set(1, 0.25 + 0.75 * sm, 1); smile.position.y = w * 0.55 * sm; }
    else { smile.rotation.z = Math.PI / 2 - arc / 2; smile.scale.set(1, 0.25 + 0.75 * -sm, 1); smile.position.y = w * 0.55 * sm; }
    smile.visible = open < 0.35;
    teeth.visible = !!face.teeth || teethDefault || open > 0.25;
    teeth.position.y = open * h * 0.1;
  };
  api.set({ mouthOpen: 0, smile: 0.1, teeth: false });
  return api;
}

// ---- emotions -------------------------------------------------------------------
const EMO = {
  neutral:   { wag: 1,   pitch: 0,     bounce: 0,   tremble: 0, eye: 1,   eyeY: 1,   roll: 0 },
  happy:     { wag: 1.4, pitch: 0.1,   bounce: 0.6, tremble: 0, eye: 1.1, eyeY: 1,   roll: 0 },
  excited:   { wag: 1.9, pitch: 0.15,  bounce: 1.2, tremble: 0, eye: 1.2, eyeY: 1,   roll: 0 },
  proud:     { wag: 0.9, pitch: 0.3,   bounce: 0.2, tremble: 0, eye: 1,   eyeY: 0.8, roll: 0 },
  sad:       { wag: 0.45, pitch: -0.35, bounce: 0,  tremble: 0, eye: 1,   eyeY: 0.7, roll: 0 },
  lonely:    { wag: 0.5, pitch: -0.25, bounce: 0,   tremble: 0, eye: 1,   eyeY: 0.75, roll: 0 },
  crying:    { wag: 0.4, pitch: -0.4,  bounce: 0,   tremble: 0.3, eye: 1, eyeY: 0.5, roll: 0 },
  scared:    { wag: 1.2, pitch: -0.1,  bounce: 0,   tremble: 1, eye: 1.35, eyeY: 1.2, roll: 0 },
  surprised: { wag: 0.6, pitch: 0.1,   bounce: 0,   tremble: 0, eye: 1.5, eyeY: 1.4, roll: 0 },
  sleepy:    { wag: 0.3, pitch: -0.15, bounce: 0,   tremble: 0, eye: 1,   eyeY: 0.25, roll: 0.1 },
  angry:     { wag: 1.3, pitch: -0.15, bounce: 0,   tremble: 0.2, eye: 0.9, eyeY: 0.6, roll: 0 },
  calm:      { wag: 0.7, pitch: 0,     bounce: 0,   tremble: 0, eye: 1,   eyeY: 0.9, roll: 0 },
  curious:   { wag: 0.9, pitch: 0.1,   bounce: 0.2, tremble: 0, eye: 1.2, eyeY: 1.1, roll: 0.25 },
};

// Shared animation driver: applies emotion + effects to an inner pivot.
function animateCommon(rig, t, state) {
  const emo = EMO[state.emotion] || EMO.neutral;
  const inner = rig.inner;
  const seed = rig.seed;
  const size = rig.size;
  const sp = state.speed;
  inner.rotation.set(0, 0, 0);
  inner.position.set(0, 0, 0);
  // idle bob
  inner.position.y += Math.sin(t * 1.4 + seed) * 0.05 + emo.bounce * Math.abs(Math.sin(t * 4.5 + seed)) * 0.12;
  inner.rotation.x = -emo.pitch * (sp > 1 ? 0.3 : 1);
  inner.rotation.z = emo.roll + Math.sin(t * 0.9 + seed) * 0.03;
  if (emo.tremble) { inner.position.x += Math.sin(t * 38 + seed) * 0.025 * emo.tremble; inner.rotation.z += Math.sin(t * 41) * 0.05 * emo.tremble; }
  // eyes (emotion size + blinks / winks)
  const face = state.face || {};
  if (rig.eyeMeshes) rig.eyeMeshes.forEach((e, i) => {
    const closed = i === 0 ? Math.max(face.blink || 0, face.wink || 0) : (face.blink || 0);
    e.scale.set(emo.eye, Math.max(0.06, emo.eye * emo.eyeY * (1 - closed)), emo.eye);
  });
  // effects
  let talking = false;
  for (const fx of state.effects) {
    const u = fx.u;
    switch (fx.type) {
      case 'spin': inner.rotation.y += TAU * fx.count * smoother(u); break;
      case 'wiggle': inner.rotation.z += Math.sin(t * 22) * 0.25 * Math.sin(Math.PI * u); inner.position.x += Math.sin(t * 22) * 0.06; break;
      case 'nod': inner.rotation.x += Math.sin(u * TAU * 2) * 0.25; break;
      case 'talk': talking = true; break;
      case 'glow': if (rig.glowMats) for (const m of rig.glowMats) m.emissiveIntensity = (rig.baseGlow ?? 0) + 0.8 * Math.sin(Math.PI * u) * (0.75 + 0.25 * Math.sin(t * 6)); break;
      default: break;
    }
  }
  if (!state.effects.some((f) => f.type === 'glow') && rig.glowMats) for (const m of rig.glowMats) m.emissiveIntensity = rig.baseGlow ?? 0;
  setBrows(rig, face, state.emotion);
  if (rig.mouth) {
    rig.mouth.set({ mouthOpen: face.mouthOpen ?? (talking ? 0.35 + 0.65 * Math.abs(Math.sin(t * 9 + seed)) : 0), smile: face.smile ?? 0.15, teeth: face.teeth });
  } else if (rig.mouthMesh) {
    const open = face.mouthOpen != null ? 0.3 + 0.7 * face.mouthOpen : (talking ? 0.35 + 0.65 * Math.abs(Math.sin(t * 9 + seed)) : 0.35);
    rig.mouthMesh.scale.y = open;
  }
  if (talking) inner.rotation.x += (face.mouthOpen ?? 0.5) * 0.06 * Math.sin(t * 9 + seed);
  return emo;
}
const smoother = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * u * (u * (u * 6 - 15) + 10); };

// ---- rigs -------------------------------------------------------------------------

// Body pattern textures (spots / stripes in an accent colour), deterministic.
function patternTexture(kind, base, accent, seed = 1) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = accent;
  const r = rng(seed * 31 + 5);
  if (kind === 'spots') {
    for (let i = 0; i < 26; i++) { const x = r() * 256, y = 20 + r() * 88, rad = 5 + r() * 9; ctx.beginPath(); ctx.ellipse(x, y, rad, rad * 0.8, 0, 0, TAU); ctx.fill(); }
  } else if (kind === 'stripes') {
    for (let i = 0; i < 9; i++) { const x = 20 + i * 26 + (r() - 0.5) * 6; ctx.fillRect(x, 10, 9 + r() * 4, 108); }
  } else if (kind === 'bands') {
    for (let i = 0; i < 4; i++) { const y = 16 + i * 30; ctx.fillRect(0, y, 256, 12); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function buildFish(color, { detail = 'high', shape = 'fish', pattern = null, accent = null, seed = 1 } = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const bodyGeo = tintVertexBelly(new THREE.SphereGeometry(0.5, detail === 'low' ? 10 : 24, detail === 'low' ? 8 : 16), color, lighten(color, 0.45));
  const bodyMat = pattern
    ? new THREE.MeshStandardMaterial({ map: patternTexture(pattern, '#ffffff', accent || '#ffffff', seed), color: new THREE.Color(color), vertexColors: true, roughness: 0.4, metalness: 0.15 })
    : mat(color, { vertexColors: true, roughness: 0.4, metalness: 0.15 });
  if (pattern) bodyMat.map = patternTexture(pattern, color, accent || darken(color, 0.4).getStyle(), seed), bodyMat.color.set('#ffffff');
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(0.32, 0.5, 1);
  inner.add(body);
  const finMat = mat(darken(color, 0.15), { side: THREE.DoubleSide, roughness: 0.6 });
  // tail
  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.45);
  const tailFin = new THREE.Mesh(finShape([[0, 0], [0, -0.3], [0.03, -0.32], [0.05, 0], [0.03, 0.32], [0, 0.3]]).rotateY(Math.PI / 2), finMat);
  tailFin.scale.set(1, 1, 1);
  tailFin.position.z = -0.22;
  const tailFin2 = new THREE.Mesh(finShape([[0, 0], [0.42, -0.34], [0.34, 0], [0.42, 0.34]]).rotateY(-Math.PI / 2), finMat);
  tail.add(tailFin2);
  inner.add(tail);
  // dorsal fin
  const dorsal = new THREE.Mesh(finShape([[0, 0], [0.2, 0.18], [-0.1, 0.24], [-0.3, 0.1], [-0.25, 0]]).rotateY(-Math.PI / 2), finMat);
  dorsal.position.set(0, 0.2, 0.05);
  inner.add(dorsal);
  // pectorals
  const pecs = [];
  for (const sx of [-1, 1]) {
    const pec = new THREE.Mesh(finShape([[0, 0], [0.22, -0.06], [0.2, -0.16], [0, -0.06]]), finMat);
    pec.position.set(sx * 0.14, -0.05, 0.12);
    pec.rotation.y = sx * Math.PI / 2;
    pec.rotation.z = -sx * 0.3;
    inner.add(pec);
    pecs.push({ mesh: pec, sx });
  }
  let eyeMeshes = null, mouthMesh = null, mouthRig = null;
  if (detail !== 'low') {
    eyeMeshes = eyes(inner, color, { z: 0.33, x: 0.12, y: 0.1, r: 0.075 }).eyes;
    mouthRig = makeMouth(inner, { z: 0.45, y: -0.07, w: 0.075, h: 0.045, teethCount: 4, teethSize: 0.01 });
  }
  const rig = { group: g, inner, tail, pecs, eyeMeshes, mouthMesh, mouth: mouthRig, kind: 'fish' };
  rig.animate = (t, state) => {
    const emo = animateCommon(rig, t, state);
    const wag = (3.5 + Math.min(12, state.speed * 2.2)) * emo.wag;
    const amp = (0.22 + Math.min(0.35, state.speed * 0.06)) * (0.6 + 0.4 * emo.wag);
    tail.rotation.y = Math.sin(t * wag + rig.seed) * amp;
    body.rotation.y = Math.sin(t * wag + rig.seed - 0.8) * amp * 0.12;
    for (const p of pecs) p.mesh.rotation.z = -p.sx * (0.3 + Math.sin(t * wag * 0.6 + p.sx) * 0.25);
  };
  return rig;
}

function buildShark(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const body = new THREE.Mesh(tintVertexBelly(new THREE.SphereGeometry(0.5, 28, 18), color, '#e6ecef', -0.05), mat(color, { vertexColors: true, roughness: 0.6 }));
  body.scale.set(0.22, 0.3, 1);
  body.position.z = 0;
  inner.add(body);
  const finMat = mat(darken(color, 0.1), { side: THREE.DoubleSide, roughness: 0.7 });
  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.47);
  const tailFin = new THREE.Mesh(finShape([[0, 0], [0.3, 0.4], [0.2, 0.05], [0.24, -0.22], [0, -0.05]]).rotateY(-Math.PI / 2), finMat);
  tail.add(tailFin);
  inner.add(tail);
  const dorsal = new THREE.Mesh(finShape([[0.1, 0], [-0.02, 0.32], [-0.28, 0.02]]).rotateY(-Math.PI / 2), finMat);
  dorsal.position.set(0, 0.24, 0.02);
  inner.add(dorsal);
  const pecs = [];
  for (const sx of [-1, 1]) {
    const pec = new THREE.Mesh(finShape([[0, 0], [0.32, -0.18], [0.36, -0.28], [-0.05, -0.1]]), finMat);
    pec.position.set(sx * 0.16, -0.08, 0.1);
    pec.rotation.y = sx * Math.PI / 2;
    pec.rotation.z = -sx * 0.55;
    inner.add(pec);
    pecs.push({ mesh: pec, sx });
  }
  const eyeMeshes = eyes(inner, color, { z: 0.36, x: 0.13, y: 0.06, r: 0.045 }).eyes;
  const mouthRig = makeMouth(inner, { z: 0.38, y: -0.11, w: 0.11, h: 0.07, teethCount: 7, teethSize: 0.014, lipColor: '#5a1622', teethDefault: true });
  const rig = { group: g, inner, tail, pecs, eyeMeshes, mouth: mouthRig, kind: 'shark' };
  rig.animate = (t, state) => {
    const emo = animateCommon(rig, t, state);
    const wag = (2.2 + Math.min(6, state.speed * 1.2)) * emo.wag;
    tail.rotation.y = Math.sin(t * wag + rig.seed) * 0.35;
    body.rotation.y = Math.sin(t * wag + rig.seed - 0.9) * 0.05;
  };
  return rig;
}

function whaleProfile(kind) {
  // (z, r) pairs from nose to tail; length 1
  if (kind === 'dolphin') return [[0.5, 0.0], [0.47, 0.035], [0.42, 0.05], [0.36, 0.09], [0.25, 0.13], [0.1, 0.15], [-0.05, 0.145], [-0.2, 0.11], [-0.33, 0.07], [-0.43, 0.04], [-0.5, 0.02]];
  return [[0.5, 0.0], [0.48, 0.09], [0.44, 0.16], [0.36, 0.23], [0.25, 0.27], [0.1, 0.29], [0.0, 0.29], [-0.15, 0.26], [-0.28, 0.19], [-0.38, 0.12], [-0.45, 0.07], [-0.5, 0.04]];
}
// radius of the profile at z (linear interpolation)
function profileRadius(prof, z) {
  for (let i = 0; i < prof.length - 1; i++) {
    const [z0, r0] = prof[i], [z1, r1] = prof[i + 1];
    if (z <= z0 && z >= z1) { const u = (z0 - z) / Math.max(1e-6, z0 - z1); return r0 + (r1 - r0) * u; }
  }
  return prof[prof.length - 1][1];
}
// Lathe of a (z, r) profile slice, revolved around +z.  phi = 0 is the underside.
function latheSlice(prof, zMin, zMax, { segments = 40, phiStart = 0, phiLength = Math.PI * 2, scale = 1 } = {}) {
  const pts = [];
  const zs = prof.map((p) => p[0]).filter((z) => z < zMax && z > zMin);
  const all = [zMin, ...zs, zMax].sort((a, b) => a - b); // ascending: outward-facing normals
  for (const z of all) pts.push(new THREE.Vector2(Math.max(0.001, profileRadius(prof, z) * scale), z * scale));
  const geo = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  geo.rotateX(Math.PI / 2); // lathe y -> +z ; lathe z (r cos phi) -> -y  => phi = 0 is the bottom
  geo.scale(1, 0.85, 1);
  geo.computeVertexNormals();
  return geo;
}
function baleenBarsTexture(dark = '#2a0b12', light = '#f2f2f4', bars = 28) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = dark; ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = light;
  const w = 512 / bars;
  for (let i = 0; i < bars; i++) ctx.fillRect(i * w + w * 0.3, 0, w * 0.4, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildWhale(color, { kind = 'whale', accent = null, baleen = false } = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const prof = whaleProfile(kind);
  const accentHex = accent ? toHex(accent, '#8a3fb0') : null;
  const bodyMat = mat(color, { roughness: 0.5 });
  const bellyMat = mat(lighten(color, kind === 'dolphin' ? 0.55 : 0.15), { roughness: 0.5 });
  const Z_JAW = 0.06;            // the mouth reaches back to here
  const A = kind === 'dolphin' ? 0.75 : 1.0;   // half-angle of the jaw sector (radians)
  // rear body (full revolution) + upper front (everything but the jaw sector)
  const rear = new THREE.Mesh(latheSlice(prof, -0.5, Z_JAW), bodyMat);
  const upper = new THREE.Mesh(latheSlice(prof, Z_JAW, 0.5, { phiStart: A, phiLength: Math.PI * 2 - 2 * A }), bodyMat);
  inner.add(rear, upper);
  // dark mouth interior with baleen bars; only visible when the jaw opens
  const interiorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a1420'), roughness: 0.9, side: THREE.DoubleSide });
  if (baleen) { interiorMat.map = baleenBarsTexture(); interiorMat.map.repeat.set(2, 1); interiorMat.color.set('#ffffff'); }
  const interior = new THREE.Mesh(latheSlice(prof, Z_JAW, 0.5, { scale: 0.93 }), interiorMat);
  inner.add(interior);
  // lower jaw: the bottom sector of the front, hinged at its back edge
  const jawPivot = new THREE.Group();
  jawPivot.position.set(0, -0.02, Z_JAW);
  const jawGeo = latheSlice(prof, Z_JAW, 0.5, { phiStart: Math.PI * 2 - A, phiLength: 2 * A, scale: 1.0 });
  jawGeo.translate(0, 0.02, -Z_JAW);
  const jaw = new THREE.Mesh(jawGeo, bellyMat);
  jawPivot.add(jaw);
  inner.add(jawPivot);
  // the baleen shows between the lips as a striped band along the seam
  let seamBands = [];
  if (baleen) {
    const bandMat = new THREE.MeshStandardMaterial({ map: baleenBarsTexture('#111116', '#f4f4f6', 40), roughness: 0.6, side: THREE.DoubleSide });
    bandMat.map.repeat.set(3, 1);
    for (const [ps, pl] of [[A - 0.02, 0.34], [Math.PI * 2 - A - 0.32, 0.34]]) {
      const band = new THREE.Mesh(latheSlice(prof, Z_JAW + 0.02, 0.49, { phiStart: ps, phiLength: pl, scale: 1.012 }), bandMat);
      inner.add(band);
      seamBands.push(band);
    }
  }
  const finMat = mat(accentHex || darken(color, 0.1), { side: THREE.DoubleSide, roughness: 0.6 });
  // flukes (horizontal)
  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.48);
  const fluke = new THREE.Mesh(finShape([[0, 0.02], [0.36, -0.14], [0.3, -0.2], [0.05, -0.16], [0, -0.14], [-0.05, -0.16], [-0.3, -0.2], [-0.36, -0.14]]).rotateX(Math.PI / 2), finMat);
  fluke.scale.set(kind === 'dolphin' ? 0.7 : 1, 1, 1);
  tail.add(fluke);
  inner.add(tail);
  // pectoral flippers, swept back along the body
  const pecs = [];
  for (const sx of [-1, 1]) {
    const pec = new THREE.Mesh(finShape([[0, 0], [0.26, -0.08], [0.3, -0.16], [0.05, -0.12]]), finMat);
    pec.position.set(sx * (kind === 'dolphin' ? 0.12 : 0.23), -0.1, 0.1);
    pec.rotation.y = sx * Math.PI / 2;
    pec.rotation.z = -sx * 0.5;
    inner.add(pec);
    pecs.push({ mesh: pec, sx });
  }
  const dorsal = new THREE.Mesh(finShape([[0.08, 0], [-0.02, kind === 'dolphin' ? 0.16 : 0.08], [-0.18, 0]]).rotateY(-Math.PI / 2), finMat);
  dorsal.position.set(0, (kind === 'dolphin' ? 0.13 : 0.24) * 0.85, -0.1);
  inner.add(dorsal);
  // flush eyes: flattened discs on the head surface, purple iris for the film look
  const eyeZ = kind === 'dolphin' ? 0.3 : 0.3;
  const rz = profileRadius(prof, eyeZ);
  const eyeMeshes = [];
  for (const sx of [-1, 1]) {
    const ang = 0.35; // above the equator
    const e = new THREE.Mesh(new THREE.SphereGeometry(kind === 'dolphin' ? 0.03 : 0.065, 16, 12), mat('#ffffff', { roughness: 0.3 }));
    e.position.set(sx * rz * Math.cos(ang) * 0.97, rz * 0.85 * Math.sin(ang), eyeZ);
    e.scale.set(1, 1.1, 0.45);
    e.lookAt(sx * 2, e.position.y + 0.3, eyeZ + 0.2);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(kind === 'dolphin' ? 0.018 : 0.036, 12, 10), mat(accentHex || '#101418', { roughness: 0.3 }));
    iris.position.set(0, 0.005, 0.03);
    iris.scale.set(1, 1, 0.5);
    e.add(iris);
    inner.add(e);
    eyeMeshes.push(e);
  }
  const blowhole = new THREE.Mesh(new THREE.CircleGeometry(0.02, 12), mat('#0b0b10'));
  blowhole.position.set(0, profileRadius(prof, 0.15) * 0.85 + 0.002, 0.15);
  blowhole.rotation.x = -Math.PI / 2;
  inner.add(blowhole);
  // mouth API used by the face system
  const mouth = {
    set: (face) => {
      const open = Math.max(0, Math.min(1, face.mouthOpen || 0));
      jawPivot.rotation.x = open * 0.55;
      interior.visible = open > 0.03;
    },
  };
  mouth.set({ mouthOpen: 0 });
  const rig = { group: g, inner, tail, pecs, eyeMeshes, mouth, kind, blowhole: new THREE.Vector3(0, 0.26, 0.15), tearColor: accentHex, eyePositions: eyeMeshes.map((e) => e.position.clone()) };
  rig.animate = (t, state) => {
    const emo = animateCommon(rig, t, state);
    const wag = (1.3 + Math.min(4, state.speed * 0.5)) * emo.wag;
    tail.rotation.x = Math.sin(t * wag + rig.seed) * 0.35;
    for (const p of pecs) p.mesh.rotation.z = -p.sx * (0.5 + Math.sin(t * wag * 0.7 + p.sx) * 0.2);
  };
  return rig;
}

function tentacle(mat, { segments = 7, length = 0.6, radius = 0.06, taper = 0.25 } = {}) {
  const root = new THREE.Group();
  let parent = root;
  const joints = [];
  const segLen = length / segments;
  for (let i = 0; i < segments; i++) {
    const r0 = radius * (1 - (i / segments) * (1 - taper));
    const r1 = radius * (1 - ((i + 1) / segments) * (1 - taper));
    const geo = new THREE.CylinderGeometry(r1, r0, segLen, 8);
    geo.translate(0, segLen / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    const j = new THREE.Group();
    j.add(m);
    if (i === segments - 1) { const tip = new THREE.Mesh(new THREE.SphereGeometry(r1, 8, 6), mat); tip.position.y = segLen; j.add(tip); }
    parent.add(j);
    j.position.y = i === 0 ? 0 : segLen;
    parent = j;
    joints.push(j);
  }
  return { root, joints, segLen };
}

function buildOctopus(color, { kind = 'octopus' } = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const bodyMat = mat(color, { roughness: 0.5 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 18), bodyMat);
  if (kind === 'squid') { head.scale.set(0.55, 0.6, 1.2); head.position.set(0, 0.2, -0.1); }
  else { head.scale.set(1, 1.15, 0.95); head.position.set(0, 0.35, 0); }
  inner.add(head);
  if (kind === 'squid') {
    const finMat = mat(darken(color, 0.1), { side: THREE.DoubleSide });
    const fin = new THREE.Mesh(finShape([[0, 0], [0.35, -0.25], [0, -0.55], [-0.35, -0.25]]).rotateX(Math.PI / 2), finMat);
    fin.position.set(0, 0.25, -0.3);
    inner.add(fin);
  }
  const eyeMeshes = eyes(inner, color, { z: kind === 'squid' ? 0.28 : 0.4, x: 0.18, y: kind === 'squid' ? 0.2 : 0.4, r: 0.11 }).eyes;
  const tent = [];
  const n = kind === 'squid' ? 10 : 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + Math.PI / n;
    const tnt = tentacle(bodyMat, { segments: 7, length: kind === 'squid' ? 0.55 : 0.75, radius: kind === 'squid' ? 0.035 : 0.07 });
    tnt.root.position.set(Math.cos(a) * 0.25, kind === 'squid' ? 0.05 : 0.05, Math.sin(a) * 0.25 * (kind === 'squid' ? 0.8 : 1));
    tnt.root.rotation.set(0, 0, Math.PI); // hang down
    tnt.root.rotation.y = -a + Math.PI / 2;
    tnt.angle = a;
    inner.add(tnt.root);
    tent.push(tnt);
  }
  const mouthRig = makeMouth(inner, { z: kind === 'squid' ? 0.3 : 0.42, y: kind === 'squid' ? 0.02 : 0.18, w: 0.13, h: 0.08, teethCount: 5, teethSize: 0.016, lipColor: '#5a2a1a' });
  const rig = { group: g, inner, eyeMeshes, mouth: mouthRig, kind, yawOnly: true, tentacles: tent };
  rig.animate = (t, state) => {
    animateCommon(rig, t, state);
    const pulse = Math.sin(t * 2.2 + rig.seed);
    head.scale.y = (kind === 'squid' ? 0.6 : 1.15) + pulse * 0.05;
    for (let i = 0; i < tent.length; i++) {
      const tn = tent[i];
      const swim = Math.min(1, state.speed * 0.6);
      tn.root.rotation.x = 0.55 + swim * 0.6 + Math.sin(t * 2 + i) * 0.15; // outward flare
      for (let j = 0; j < tn.joints.length; j++) {
        const jt = tn.joints[j];
        jt.rotation.x = Math.sin(t * 2.4 + i * 0.8 + j * 0.7 + rig.seed) * 0.28 + (0.12 - swim * 0.1);
        jt.rotation.z = Math.cos(t * 1.7 + i * 1.1 + j * 0.5) * 0.12;
      }
    }
    inner.rotation.x += 0.15; // slight forward lean
  };
  return rig;
}

function buildJellyfish(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const c = new THREE.Color(color);
  const bellMat = new THREE.MeshPhysicalMaterial({ color: c, transparent: true, opacity: 0.55, roughness: 0.25, transmission: 0, emissive: c, emissiveIntensity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16, 0, TAU, 0, Math.PI * 0.55), bellMat);
  bell.scale.set(1, 0.75, 1);
  inner.add(bell);
  const innerMat = new THREE.MeshStandardMaterial({ color: lighten(color, 0.3), transparent: true, opacity: 0.35, emissive: c, emissiveIntensity: 0.5, depthWrite: false });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 12, 0, TAU, 0, Math.PI * 0.6), innerMat);
  core.scale.set(1, 0.7, 1);
  core.position.y = -0.05;
  inner.add(core);
  const tentMat = new THREE.MeshStandardMaterial({ color: lighten(color, 0.1), emissive: c, emissiveIntensity: 0.25, transparent: true, opacity: 0.85 });
  const tents = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const tn = tentacle(tentMat, { segments: 8, length: 1.2 + (i % 3) * 0.25, radius: 0.018, taper: 0.4 });
    tn.root.position.set(Math.cos(a) * 0.42, 0.02, Math.sin(a) * 0.42);
    tn.root.rotation.z = Math.PI; // hang down
    tents.push({ tn, a });
    inner.add(tn.root);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const tn = tentacle(tentMat, { segments: 6, length: 0.8, radius: 0.045, taper: 0.5 });
    tn.root.position.set(Math.cos(a) * 0.12, -0.05, Math.sin(a) * 0.12);
    tn.root.rotation.z = Math.PI;
    tents.push({ tn, a, arm: true });
    inner.add(tn.root);
  }
  const eyeMeshes = eyes(inner, color, { z: 0.36, x: 0.14, y: 0.12, r: 0.06 }).eyes;
  const rig = { group: g, inner, eyeMeshes, kind: 'jellyfish', yawOnly: true, glowMats: [bellMat, innerMat, tentMat], baseGlow: 0.35 };
  rig.animate = (t, state) => {
    animateCommon(rig, t, state);
    const ph = t * 2.2 + rig.seed;
    const pulse = Math.pow(Math.max(0, Math.sin(ph)), 1.5);
    bell.scale.set(1 + 0.1 * pulse - 0.05, 0.75 - 0.12 * pulse + 0.06, 1 + 0.1 * pulse - 0.05);
    core.scale.set(1 + 0.08 * pulse, 0.7 - 0.08 * pulse, 1 + 0.08 * pulse);
    inner.position.y += Math.sin(ph - 0.6) * 0.04;
    for (let i = 0; i < tents.length; i++) {
      const { tn, a } = tents[i];
      const drag = Math.min(1, state.speed * 0.8);
      for (let j = 0; j < tn.joints.length; j++) {
        const jt = tn.joints[j];
        jt.rotation.x = Math.sin(t * 1.6 + i * 0.7 + j * 0.6) * 0.16 + Math.cos(a) * drag * 0.15;
        jt.rotation.z = Math.cos(t * 1.3 + i * 0.9 + j * 0.5) * 0.14 + Math.sin(a) * drag * 0.15;
      }
    }
  };
  return rig;
}

function buildTurtle(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const shellMat = mat(color, { roughness: 0.6 });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 14, 0, TAU, 0, Math.PI / 2), shellMat);
  shell.scale.set(0.8, 0.45, 1);
  inner.add(shell);
  const plast = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 8, 0, TAU, Math.PI / 2, Math.PI / 2), mat(lighten(color, 0.5)));
  plast.scale.set(0.78, 0.18, 0.98);
  inner.add(plast);
  // shell pattern: rings of darker hexes (dodecahedra flattened)
  const patMat = mat(darken(color, 0.25));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.03, 6), patMat);
    const r = i === 0 ? 0 : 0.28;
    p.position.set(Math.cos(a) * r * 0.8, 0.2 + (i === 0 ? 0.04 : 0), Math.sin(a) * r);
    p.rotation.x = Math.cos(a) * 0.5 * (i === 0 ? 0 : 1);
    p.rotation.z = -Math.sin(a) * 0.4 * (i === 0 ? 0 : 1);
    inner.add(p);
  }
  const skin = mat(lighten(color, 0.25));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), skin);
  head.position.set(0, 0.02, 0.55);
  head.scale.set(0.9, 0.8, 1.2);
  inner.add(head);
  const eyeMeshes = eyes(head, color, { z: 0.1, x: 0.08, y: 0.05, r: 0.035 }).eyes;
  const mouthMesh = mouth(head, { z: 0.14, y: -0.03, w: 0.06 });
  const flips = [];
  for (const [sx, sz, big] of [[-1, 0.25, 1], [1, 0.25, 1], [-1, -0.3, 0.6], [1, -0.3, 0.6]]) {
    const f = new THREE.Mesh(finShape([[0, 0.05], [0.38 * big, 0.02], [0.44 * big, -0.06], [0.2 * big, -0.1], [0, -0.05]]).rotateX(-Math.PI / 2), mat(lighten(color, 0.25), { side: THREE.DoubleSide }));
    f.position.set(sx * 0.32, 0.02, sz);
    f.rotation.y = sx > 0 ? 0 : Math.PI;
    f.rotation.z = 0;
    inner.add(f);
    flips.push({ mesh: f, sx, sz });
  }
  const rig = { group: g, inner, eyeMeshes, mouthMesh, kind: 'turtle' };
  rig.animate = (t, state) => {
    animateCommon(rig, t, state);
    const f = 2 + Math.min(3, state.speed);
    for (const fl of flips) fl.mesh.rotation.z = (fl.sx > 0 ? 1 : -1) * Math.sin(t * f + rig.seed + (fl.sz < 0 ? 1.5 : 0)) * 0.45 * (fl.sz > 0 ? 1 : 0.5);
    head.position.z = 0.55 + Math.sin(t * f) * 0.02;
  };
  return rig;
}

function buildCrab(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const bodyMat = mat(color, { roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12), bodyMat);
  body.scale.set(1, 0.45, 0.7);
  inner.add(body);
  const eyeGroup = new THREE.Group();
  for (const sx of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), bodyMat);
    stalk.position.set(sx * 0.18, 0.28, 0.25);
    inner.add(stalk);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat('#ffffff'));
    e.position.set(sx * 0.18, 0.4, 0.25);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat('#101418'));
    p.position.set(0, 0.01, 0.05);
    e.add(p);
    inner.add(e);
    eyeGroup.add();
  }
  const legs = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const leg = tentacle(bodyMat, { segments: 2, length: 0.45, radius: 0.035, taper: 0.5 });
      leg.root.position.set(sx * 0.4, -0.05, -0.15 + i * 0.16);
      leg.root.rotation.z = sx * (Math.PI / 2 + 0.6);
      inner.add(leg.root);
      legs.push({ leg, sx, i });
    }
    const arm = tentacle(bodyMat, { segments: 2, length: 0.35, radius: 0.05, taper: 0.8 });
    arm.root.position.set(sx * 0.35, 0.02, 0.28);
    arm.root.rotation.z = sx * (Math.PI / 2 + 0.2);
    arm.root.rotation.x = -0.5;
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), bodyMat);
    claw.scale.set(1.1, 0.7, 1.4);
    claw.position.y = 0.38;
    const pincer = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), bodyMat);
    pincer.position.set(0.05, 0.12, 0.02);
    pincer.rotation.z = -0.4;
    claw.add(pincer);
    arm.joints[1].add(claw);
    inner.add(arm.root);
    legs.push({ leg: arm, sx, i: 3, arm: true, claw });
  }
  const mouthMesh = mouth(inner, { z: 0.34, y: -0.02, w: 0.1 });
  const rig = { group: g, inner, mouthMesh, kind: 'crab', yawOnly: true, sideways: true };
  rig.animate = (t, state) => {
    animateCommon(rig, t, state);
    const f = 4 + Math.min(8, state.speed * 3);
    for (const l of legs) {
      if (l.arm) { l.leg.joints[1].rotation.x = Math.sin(t * 2 + l.sx) * 0.15; l.claw.scale.x = 1.1 + Math.abs(Math.sin(t * 3 + l.sx)) * 0.15; continue; }
      const ph = t * f + l.i * 1.1 + (l.sx > 0 ? Math.PI : 0);
      l.leg.joints[0].rotation.x = Math.sin(ph) * 0.35 * Math.min(1, state.speed + 0.15);
      l.leg.joints[1].rotation.z = l.sx * (0.9 + Math.cos(ph) * 0.2);
    }
  };
  return rig;
}

function buildRay(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const geo = new THREE.PlaneGeometry(1.4, 1, 16, 12);
  geo.rotateX(-Math.PI / 2);
  // diamond-ish outline via vertex shaping
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const k = 1 - Math.abs(z) * 0.9;
    pos.setX(i, x * Math.max(0.05, k));
    pos.setY(i, -Math.abs(x) * 0.12);
  }
  geo.computeVertexNormals();
  tintVertexBelly(geo, color, lighten(color, 0.6));
  const body = new THREE.Mesh(geo, mat(color, { side: THREE.DoubleSide, vertexColors: true }));
  inner.add(body);
  const bump = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10), mat(color));
  bump.scale.set(1, 0.5, 1.4);
  inner.add(bump);
  const tailM = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.03, 0.9, 6), mat(color));
  tailM.rotation.x = Math.PI / 2;
  tailM.position.z = -0.9;
  inner.add(tailM);
  const eyeMeshes = eyes(inner, color, { z: 0.35, x: 0.12, y: 0.09, r: 0.04 }).eyes;
  const base = pos.array.slice();
  const rig = { group: g, inner, eyeMeshes, kind: 'ray' };
  rig.animate = (t, state) => {
    animateCommon(rig, t, state);
    const f = 2 + Math.min(4, state.speed);
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      pos.setY(i, base[i * 3 + 1] + Math.sin(t * f + z * 3 + rig.seed) * Math.abs(x) * Math.abs(x) * 0.45);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return rig;
}

function buildEel(color, { kind = 'eel' } = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const bodyMat = mat(color, { roughness: 0.5 });
  const segs = kind === 'seahorse' ? 8 : 12;
  const tn = tentacle(bodyMat, { segments: segs, length: 1, radius: kind === 'seahorse' ? 0.09 : 0.07, taper: 0.2 });
  tn.root.rotation.x = -Math.PI / 2; // along -z? cylinder y -> we want body along z: rotate so +y -> -z (tail behind)
  tn.root.position.z = 0.5;
  inner.add(tn.root);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), bodyMat);
  head.position.z = 0.52;
  head.scale.set(1, 1, 1.4);
  inner.add(head);
  const eyeMeshes = eyes(head, color, { z: 0.06, x: 0.07, y: 0.05, r: 0.035 }).eyes;
  const mouthMesh = mouth(head, { z: 0.13, y: -0.02, w: 0.06 });
  if (kind === 'seahorse') {
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.16, 8), bodyMat);
    snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.02, 0.62);
    inner.add(snout);
    const fin = new THREE.Mesh(finShape([[0, 0], [0.12, 0.1], [0, 0.22], [-0.12, 0.1]]).rotateY(Math.PI / 2), mat(lighten(color, 0.3), { side: THREE.DoubleSide }));
    fin.position.set(0, 0.16, 0.15);
    inner.add(fin);
  } else {
    const finMat = mat(lighten(color, 0.2), { side: THREE.DoubleSide });
    const fin = new THREE.Mesh(finShape([[0, 0], [0, 0.09], [-1, 0.06], [-1, 0]]).rotateY(-Math.PI / 2).rotateY(Math.PI), finMat);
    fin.position.set(0, 0.05, 0.45);
    tn.joints[0].add();
    inner.add(fin);
  }
  const rig = { group: g, inner, eyeMeshes, mouthMesh, kind, yawOnly: kind === 'seahorse', upright: kind === 'seahorse' };
  rig.animate = (t, state) => {
    animateCommon(rig, t, state);
    const f = 3 + Math.min(6, state.speed * 1.5);
    for (let j = 0; j < tn.joints.length; j++) {
      const jt = tn.joints[j];
      if (kind === 'seahorse') {
        jt.rotation.x = 0.28 + Math.sin(t * 1.2 + rig.seed) * 0.03; // curl
        jt.rotation.z = Math.sin(t * f + j * 0.4) * 0.03;
      } else {
        jt.rotation.z = Math.sin(t * f - j * 0.8 + rig.seed) * (0.12 + Math.min(0.15, state.speed * 0.03));
      }
    }
    if (kind === 'seahorse') { inner.rotation.x = -Math.PI * 0.42; inner.position.y += 0.2; }
  };
  return rig;
}

function buildStarfish(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const bodyMat = mat(color, { roughness: 0.8 });
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), bodyMat);
  center.scale.set(1, 0.5, 1);
  inner.add(center);
  const arms = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const arm = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.5, 8), bodyMat);
    arm.geometry.translate(0, 0.25, 0);
    arm.scale.set(1, 1, 0.5);
    arm.rotation.z = -Math.PI / 2;
    const pivot = new THREE.Group();
    pivot.rotation.y = a;
    pivot.add(arm);
    inner.add(pivot);
    arms.push({ pivot, arm, a });
  }
  const eyeMeshes = eyes(inner, color, { z: 0.08, x: 0.06, y: 0.09, r: 0.03 }).eyes;
  const rig = { group: g, inner, eyeMeshes, kind: 'starfish', yawOnly: true, upright: true };
  rig.animate = (t, state) => {
    animateCommon(rig, t, state);
    for (const ar of arms) ar.arm.rotation.x = Math.sin(t * 1.2 + ar.a) * 0.15;
  };
  return rig;
}

function buildSchool(color, count) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const r = rng(101 + count);
  const members = [];
  const radius = 0.9 * Math.cbrt(count);
  for (let i = 0; i < count; i++) {
    const f = buildFish(color, { detail: 'low' });
    f.seed = r() * 100;
    f.size = 1;
    const off = new THREE.Vector3((r() - 0.5) * 2 * radius, (r() - 0.5) * radius, (r() - 0.5) * 2 * radius);
    f.group.scale.setScalar(0.8 + r() * 0.5);
    inner.add(f.group);
    members.push({ rig: f, off, ph: r() * TAU, spd: 0.5 + r() * 0.8 });
  }
  const rig = { group: g, inner, kind: 'school' };
  rig.animate = (t, state) => {
    for (const m of members) {
      const wob = new THREE.Vector3(Math.sin(t * m.spd + m.ph) * 0.35, Math.sin(t * m.spd * 0.7 + m.ph * 2) * 0.25, Math.cos(t * m.spd * 0.9 + m.ph) * 0.35);
      m.rig.group.position.copy(m.off).add(wob);
      m.rig.group.rotation.set(0, Math.sin(t * 0.6 + m.ph) * 0.2, 0);
      m.rig.animate(t, { ...state, speed: state.speed + 1, effects: [] });
    }
  };
  return rig;
}

export function createActorRig(cast, seed, extra = {}) {
  const color = toHex(cast.color);
  const special = createSpecialRig(cast, seed, extra);
  if (special) return special;
  let rig;
  switch (cast.kind) {
    case 'shark': rig = buildShark(color); break;
    case 'whale': rig = buildWhale(color, { kind: 'whale', accent: cast.accent, baleen: cast.baleen }); break;
    case 'dolphin': rig = buildWhale(color, { kind: 'dolphin', accent: cast.accent }); break;
    case 'octopus': rig = buildOctopus(color, { kind: 'octopus' }); break;
    case 'squid': rig = buildOctopus(color, { kind: 'squid' }); break;
    case 'jellyfish': rig = buildJellyfish(color); break;
    case 'turtle': rig = buildTurtle(color); break;
    case 'crab': rig = buildCrab(color); break;
    case 'ray': rig = buildRay(color); break;
    case 'eel': rig = buildEel(color, { kind: 'eel' }); break;
    case 'seahorse': rig = buildEel(color, { kind: 'seahorse' }); break;
    case 'starfish': rig = buildStarfish(color); break;
    case 'school': rig = buildSchool(color, Math.max(3, Math.round(cast.count || 12))); break;
    default: rig = buildFish(color, { pattern: cast.pattern || null, accent: cast.accent ? toHex(cast.accent) : null, seed: Math.round(seed) }); break;
  }
  rig.seed = seed;
  rig.size = cast.size;
  rig.group.scale.setScalar(cast.size);
  rig.name = cast.name;
  rig.color = color;
  return rig;
}

// ---- film-driven additions: birds, pelican, bubble, sprites, glTF models ----

function buildBird(color, { kind = 'bird' } = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const bodyMat = mat(color, { roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), bodyMat);
  body.scale.set(0.3, 0.3, 0.9);
  inner.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.35, 10), bodyMat);
  neck.position.set(0, 0.2, 0.35); neck.rotation.x = -0.6;
  inner.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), bodyMat);
  head.position.set(0, 0.35, 0.48);
  inner.add(head);
  const eyeMeshes = eyes(head, color, { z: 0.08, x: 0.08, y: 0.04, r: 0.035 }).eyes;
  const beakMat = mat(kind === 'pelican' ? '#e0863a' : '#f2b233', { roughness: 0.5 });
  let pouch = null;
  if (kind === 'pelican') {
    // long upper bill + big pouch below it
    const bill = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.7, 8), beakMat);
    bill.rotation.x = Math.PI / 2; bill.position.set(0, 0.34, 0.9); bill.scale.set(1.6, 1, 0.6);
    inner.add(bill);
    pouch = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12, 0, TAU, Math.PI * 0.45, Math.PI * 0.55), mat('#d97a2e', { roughness: 0.6, side: THREE.DoubleSide }));
    pouch.position.set(0, 0.32, 0.75); pouch.scale.set(1, 1.3, 2);
    inner.add(pouch);
  } else {
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 8), beakMat);
    beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.33, 0.62);
    inner.add(beak);
  }
  const wingMat = mat(darken(color, 0.12), { side: THREE.DoubleSide, roughness: 0.8 });
  const wings = [];
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(finShape([[0, 0.05], [0.9, 0.12], [1.25, 0.02], [1.1, -0.12], [0.5, -0.18], [0, -0.1]]), wingMat);
    wing.rotation.y = -Math.PI / 2 * sx;
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.12, 0.08, 0.05);
    pivot.add(wing);
    inner.add(pivot);
    wings.push({ pivot, sx });
  }
  const tail = new THREE.Mesh(finShape([[0, 0], [0.18, -0.35], [0, -0.42], [-0.18, -0.35]]).rotateX(Math.PI / 2), wingMat);
  tail.position.set(0, 0.02, -0.4);
  inner.add(tail);
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), beakMat);
    leg.position.set(sx * 0.08, -0.2, -0.05);
    const foot = new THREE.Mesh(finShape([[0, 0], [0.08, -0.12], [0, -0.16], [-0.08, -0.12]]).rotateX(-Math.PI / 2), beakMat);
    foot.position.y = -0.11;
    leg.add(foot);
    inner.add(leg);
    legs.push(leg);
  }
  const rig = { group: g, inner, eyeMeshes, kind, carryPoint: new THREE.Vector3(0, 0.25, 0.8) };
  rig.animate = (t, state) => {
    animateCommon(rig, t, state);
    const flying = state.speed > 0.5 || (rig.altitude ?? 1) > 0.5;
    const f = flying ? 5 + Math.min(4, state.speed * 0.4) : 0.8;
    const amp = flying ? 0.55 : 0.08;
    for (const w of wings) w.pivot.rotation.z = w.sx * Math.sin(t * f + rig.seed) * amp;
    for (const l of legs) l.rotation.x = flying ? 0.9 : 0;
    inner.position.y += flying ? Math.sin(t * f + rig.seed - 1) * 0.05 : 0;
    if (pouch) pouch.scale.y = 1.3 + (state.carrying ? 0.5 : 0) + Math.sin(t * 2) * 0.03;
  };
  return rig;
}

function buildBubble(color) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const c = new THREE.Color(color);
  const m = new THREE.MeshPhysicalMaterial({ color: c, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), m);
  inner.add(sphere);
  const rim = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false }));
  inner.add(rim);
  const hl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  hl.position.set(-0.22, 0.28, 0.3);
  inner.add(hl);
  const rig = { group: g, inner, kind: 'bubble', yawOnly: true, upright: true };
  rig.animate = (t) => {
    const w = Math.sin(t * 2.1 + rig.seed) * 0.06;
    sphere.scale.set(1 + w, 1 - w * 0.8, 1 + w * 0.5);
    rim.scale.copy(sphere.scale);
  };
  return rig;
}

// A 2D image (PNG/SVG/JPEG) as a billboard cutout that flips to face its
// heading.  `texture` is preloaded by main.js; aspect comes from the image.
function buildSprite(texture, { aspect = 1, flip = false } = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const m = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, depthWrite: true });
  const h = 1, w = aspect;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  plane.position.y = 0;
  inner.add(plane);
  const rig = { group: g, inner, kind: 'sprite', billboard: true, flip, plane };
  rig.animate = (t, state) => {
    inner.position.y = Math.sin(t * 1.5 + rig.seed) * 0.03;
    inner.rotation.z = Math.sin(t * 1.1 + rig.seed) * 0.02;
    const bob = { happy: 0.08, excited: 0.14 }[state.emotion] || 0;
    inner.position.y += bob * Math.abs(Math.sin(t * 5));
    for (const fx of state.effects) {
      if (fx.type === 'wiggle') inner.rotation.z += Math.sin(t * 20) * 0.15;
      if (fx.type === 'spin') inner.rotation.y = TAU * fx.count * smoother(fx.u);
      if (fx.type === 'nod') inner.rotation.x = Math.sin(fx.u * TAU * 2) * 0.15;
    }
  };
  return rig;
}

// A glTF/GLB model normalised to a 1-unit length along its longest axis and
// facing +z.  Its first animation clip (or the named one) is driven by time.
function buildModel(gltf, { animation = null, AnimationMixer, Box3, Vector3 } = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const root = gltf.scene || gltf.scenes[0];
  const box = new Box3().setFromObject(root);
  const size = new Vector3(); box.getSize(size);
  const center = new Vector3(); box.getCenter(center);
  const len = Math.max(size.x, size.y, size.z) || 1;
  const holder = new THREE.Group();
  holder.add(root);
  root.position.sub(center);
  holder.scale.setScalar(1 / len);
  inner.add(holder);
  let mixer = null, action = null;
  if (gltf.animations && gltf.animations.length && AnimationMixer) {
    mixer = new AnimationMixer(root);
    const clip = (animation && gltf.animations.find((a) => a.name === animation)) || gltf.animations[0];
    action = mixer.clipAction(clip);
    action.play();
  }
  const rig = { group: g, inner, kind: 'model' };
  rig.animate = (t, state) => {
    if (mixer) { mixer.setTime(t * (1 + Math.min(1, state.speed * 0.1))); }
    inner.position.y = Math.sin(t * 1.2 + rig.seed) * 0.03;
  };
  return rig;
}

export function createSpecialRig(cast, seed, extra = {}) {
  let rig = null;
  switch (cast.kind) {
    case 'bird': rig = buildBird(toHex(cast.color), { kind: 'bird' }); break;
    case 'pelican': rig = buildBird(toHex(cast.color, '#f6f2ea'), { kind: 'pelican' }); break;
    case 'bubble': rig = buildBubble(toHex(cast.color, '#dff6ff')); break;
    case 'sprite': rig = buildSprite(extra.texture, { aspect: extra.aspect ?? 1, flip: cast.flip }); break;
    case 'model': rig = buildModel(extra.gltf, { animation: cast.animation, ...extra.three }); break;
    default: return null;
  }
  rig.seed = seed;
  rig.size = cast.size;
  rig.group.scale.setScalar(cast.size);
  rig.name = cast.name;
  rig.color = toHex(cast.color);
  return rig;
}
