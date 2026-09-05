// Renderer bootstrap.  Loads the compiled timeline, builds the scene and
// exposes window.__seek(t) for headless frame capture, or runs an interactive
// preview with a scrubber.
import * as THREE from 'three';
import { TimelineEvaluator } from './timeline.js';
import { Ocean, resolveEnv, mixEnv } from './ocean.js';
import { createActorRig } from './actors.js';
import { isRtl } from './colors.js';

const params = new URLSearchParams(location.search);
const HEADLESS = params.get('headless') === '1';
if (HEADLESS) document.body.classList.add('headless');

const stage = document.getElementById('stage');
const $subs = document.getElementById('subs');
const $title = document.getElementById('title');
const $fade = document.getElementById('fade');

let timeline = null;
let ev = null;
let renderer, scene, camera, ocean;
let rigs = {};
let envParams = [];
let fxPool = null;
let width = 1280, height = 720;

function setupRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: params.get('draft') !== '1' && params.get('aa') !== '0', preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  stage.insertBefore(renderer.domElement, stage.firstChild);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1500);
  ocean = new Ocean(scene);
  fxPool = buildFxPool();
  scene.add(fxPool.points);
}

// Small pool of bubble sprites used for per-actor effects (bubbles, cry, spout).
function buildFxPool() {
  const MAX = 400;
  const pos = new Float32Array(MAX * 3), size = new Float32Array(MAX), col = new Float32Array(MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('psize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 720 } },
    vertexShader: `attribute float psize; attribute vec3 pcolor; uniform float uScale; varying vec3 vC; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = psize * uScale / max(1.0, -mv.z); vC = pcolor; vA = psize > 0.0 ? 1.0 : 0.0; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5 || vA <= 0.0) discard; float rim = smoothstep(0.3, 0.5, r); float hl = smoothstep(0.2, 0.0, length(d - vec2(-0.15,-0.15))); gl_FragColor = vec4(vC, (rim * 0.8 + hl * 0.7 + 0.1) * 0.9);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
 }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, geo, pos, size, col, MAX, used: 0 };
}
function fxReset() { fxPool.used = 0; fxPool.size.fill(0); }
function fxEmit(x, y, z, s, r, g, b) {
  if (fxPool.used >= fxPool.MAX) return;
  const i = fxPool.used++;
  fxPool.pos.set([x, y, z], i * 3); fxPool.size[i] = s; fxPool.col.set([r, g, b], i * 3);
}
function fxCommit() { fxPool.geo.attributes.position.needsUpdate = true; fxPool.geo.attributes.psize.needsUpdate = true; fxPool.geo.attributes.pcolor.needsUpdate = true; fxPool.points.material.uniforms.uScale.value = height; }

const assetCache = { textures: {}, gltfs: {}, images: {} };
function assetUrl(rel) { return (timeline.meta.assetUrls && timeline.meta.assetUrls[rel]) || ('/script/' + rel.split('/').map(encodeURIComponent).join('/')); }

async function preloadAssets(tl) {
  timeline = tl;
  const loader = new THREE.TextureLoader();
  const jobs = [];
  for (const rel of tl.assets || []) {
    const url = assetUrl(rel);
    if (/\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(rel)) {
      jobs.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          assetCache.textures[rel] = tex;
          assetCache.images[rel] = { width: img.naturalWidth || 1, height: img.naturalHeight || 1 };
          resolve();
        };
        img.onerror = () => { console.warn('asset failed to load: ' + rel); resolve(); };
        img.src = url;
      }));
    } else if (/\.(glb|gltf)$/i.test(rel)) {
      jobs.push(import('/vendor/three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new Promise((resolve) => {
        new GLTFLoader().load(url, (gltf) => { assetCache.gltfs[rel] = gltf; resolve(); }, undefined, (e) => { console.warn('model failed: ' + rel + ' ' + e); resolve(); });
      })));
    } else if (/\.(ttf|otf|woff2?)$/i.test(rel)) {
      const fam = tl.meta.fontFamily || 'ScriptFont';
      const face = new FontFace(fam, `url(${url})`);
      jobs.push(face.load().then((f) => { document.fonts.add(f); document.documentElement.style.setProperty('--script-font', `"${fam}"`); }).catch((e) => console.warn('font failed: ' + rel + ' ' + e)));
    } else if (/\.(webm|mp4|ogv)$/i.test(rel)) {
      // video clips are created on demand (see overlays); nothing to preload
    }
  }
  await Promise.all(jobs);
  if (tl.meta.fontFamily && !tl.meta.font) document.documentElement.style.setProperty('--script-font', `"${tl.meta.fontFamily}"`);
  for (const rel of Object.keys(assetCache.textures)) ocean.setBackdropTexture(rel, assetCache.textures[rel]);
}

function loadTimeline(tl) {
  timeline = tl;
  ev = new TimelineEvaluator(tl);
  width = tl.meta.width; height = tl.meta.height;
  renderer.setSize(width, height, false);
  stage.style.width = width + 'px'; stage.style.height = height + 'px';
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  // env params (cumulative settings)
  envParams = [];
  let cum = {};
  for (const e of tl.env) { cum = { ...cum, ...e.settings }; envParams.push(resolveEnv(cum)); }
  // rigs
  for (const r of Object.values(rigs)) scene.remove(r.group);
  rigs = {};
  let seed = 1;
  for (const name of Object.keys(tl.actors)) {
    const c = tl.cast[name];
    if (c.kind === 'narrator' || c.kind === 'voice') continue;
    const extra = {};
    if (c.kind === 'sprite') {
      extra.texture = assetCache.textures[c.image] || null;
      const im = assetCache.images[c.image];
      extra.aspect = im ? im.width / im.height : 1;
      if (!extra.texture) { console.warn(`sprite image missing for @${name}; using a fish`); c.kind = 'fish'; }
    }
    if (c.kind === 'model') {
      extra.gltf = assetCache.gltfs[c.model] || null;
      extra.three = { AnimationMixer: THREE.AnimationMixer, Box3: THREE.Box3, Vector3: THREE.Vector3 };
      if (!extra.gltf) { console.warn(`model missing for @${name}; using a fish`); c.kind = 'fish'; }
    }
    const rig = createActorRig(c, (seed++) * 17.3, extra);
    rigs[name] = rig;
    scene.add(rig.group);
  }
  stage.style.setProperty('--s', String(height / 720));
  fitStage();
  buildMarkers();
  const w = document.getElementById('warnings');
  if (tl.warnings?.length) { w.hidden = false; w.textContent = tl.warnings.join('\n'); } else w.hidden = true;
}

const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);

function seek(t) {
  if (!ev) return;
  const __t0 = performance.now();
  ev.beginFrame();
  // camera
  const cp0 = ev.cameraPos(t), cl = ev.cameraLook(t), sh = ev.cameraShake(t);
  // Camera clearance: never sit inside a character or prop.  Pushed out of
  // each actor's bounding sphere along the line from the actor; it is a pure
  // function of the timeline, so chunks and re-renders agree.
  const cp = [cp0[0], cp0[1], cp0[2]];
  for (const [name, tr] of Object.entries(timeline.actors)) {
    const c = timeline.cast[name];
    if (!c || c.kind === 'narrator' || c.kind === 'voice' || !ev.visible(name, t)) continue;
    const ap = ev.pos(name, t);
    const r = (c.kind === 'school' ? c.size * 1.2 : c.size * 0.55) + 0.35;
    const d = [cp[0] - ap[0], cp[1] - ap[1], cp[2] - ap[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l < r) {
      const n = l > 1e-4 ? [d[0] / l, d[1] / l, d[2] / l] : [cp[0] - cl[0], 0.2, cp[2] - cl[2]];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      cp[0] = ap[0] + n[0] / nl * r; cp[1] = ap[1] + n[1] / nl * r; cp[2] = ap[2] + n[2] / nl * r;
    }
  }
  camera.position.set(cp[0] + sh[0], cp[1] + sh[1], cp[2] + sh[2]);
  // keep the camera off the seabed / just off the surface plane
  const es = ev.envState(t);
  const p = mixEnv(envParams[es.prevIndex], envParams[es.index], es.blend);
  const floorAt = p.floorY + ocean.floorHeight(camera.position.x, camera.position.z) + 0.6;
  if (camera.position.y < floorAt) camera.position.y = floorAt;
  if (Math.abs(camera.position.y) < 0.35) camera.position.y = camera.position.y < 0 ? -0.35 : 0.35;
  camera.lookAt(cl[0], cl[1], cl[2]);
  camera.fov = ev.cameraFov(t);
  camera.updateProjectionMatrix();
  ocean.apply(p, t, camera, height);

  // actors
  fxReset();
  for (const [name, rig] of Object.entries(rigs)) {
    const visible = ev.visible(name, t);
    rig.group.visible = visible;
    if (!visible) continue;
    const pos = ev.pos(name, t);
    const h = ev.heading(name, t);
    const m = ev.motion(name, t);
    const sc = ev.scale(name, t) * rig.size;
    // anything closer to the lens than its own half-size would be sliced by the
    // near plane (floating eyes and mouths): hide it instead
    if (Math.hypot(pos[0] - camera.position.x, pos[1] - camera.position.y, pos[2] - camera.position.z) < sc * 0.5 + 0.25) { rig.group.visible = false; continue; }
    rig.group.scale.setScalar(sc);
    // idle drift (not part of the track so cameras can follow smoothly)
    const idle = rig.kind === 'school' ? 0.4 : 0.12;
    const bob = [Math.sin(t * 0.7 + rig.seed) * idle * 0.5, Math.sin(t * 1.1 + rig.seed) * idle, Math.cos(t * 0.5 + rig.seed) * idle * 0.5];
    rig.group.position.set(pos[0] + bob[0] * sc, pos[1] + bob[1] * sc, pos[2] + bob[2] * sc);
    // keep above the seabed
    const fy = p.floorY + ocean.floorHeight(pos[0], pos[2]) + sc * 0.4;
    if (rig.group.position.y < fy && rig.kind !== 'crab' && rig.kind !== 'starfish') rig.group.position.y = fy;
    if ((rig.kind === 'crab' || rig.kind === 'starfish') && rig.group.position.y < fy - sc * 0.2) rig.group.position.y = fy - sc * 0.2;
    // orientation
    const yaw = Math.atan2(h[0], h[2]);
    let pitch = rig.yawOnly ? 0 : Math.asin(Math.max(-1, Math.min(1, h[1])));
    pitch = Math.max(-0.7, Math.min(0.7, pitch));
    // banking from yaw rate
    const hPrev = ev.heading(name, t - 1 / 30);
    let dyaw = Math.atan2(h[0], h[2]) - Math.atan2(hPrev[0], hPrev[2]);
    if (dyaw > Math.PI) dyaw -= 2 * Math.PI; if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    const roll = rig.yawOnly ? 0 : Math.max(-0.6, Math.min(0.6, -dyaw * 30 * 0.12));
    if (rig.billboard) {
      // face the camera around y; mirror when heading points left of the camera's view
      const toCam = new THREE.Vector3().subVectors(camera.position, rig.group.position);
      const camYaw = Math.atan2(toCam.x, toCam.z);
      const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
      const facingLeft = (h[0] * right.x + h[2] * right.z) < -0.05;
      rig.group.rotation.set(0, camYaw, 0, 'YXZ');
      rig.group.scale.set(sc * ((facingLeft !== !!rig.flip) ? -1 : 1), sc, sc);
    } else {
      if (rig.fixedYaw) rig.group.rotation.set(0, 0, 0);
      else rig.group.rotation.set(-pitch, yaw + (rig.sideways ? Math.PI / 2 : 0), roll, 'YXZ');
    }
    rig.altitude = pos[1];
    const carrying = Object.values(timeline.actors).some((tr) => tr.segments.some((sg) => sg.type === 'follow' && sg.attached && sg.actor === name && sg.t0 <= t && t < sg.t1));
    const state = { speed: m.speed, emotion: ev.emotion(name, t), effects: ev.effects(name, t), face: ev.face(name, t), t, carrying };
    const eb = ev.emotionBlend(name, t);
    state.emotionFrom = eb.from; state.emotionU = eb.u;
    if (rig.wantsDistance) state.dist = ev.distance(name, t);
    rig.animate(t, state);
    // tear drops (cartoon: they grow at the eye and fall)
    if (rig.tears) for (const tr of rig.tears) tr.visible = false;
    const cryFx = state.effects.find((f) => f.type === 'cry');
    if (cryFx) {
      if (!rig.tears) {
        const tearMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(rig.tearColor || '#9fd8ff'), roughness: 0.25, transparent: true, opacity: 0.92 });
        rig.tears = [0, 1].map(() => {
          const grp = new THREE.Group();
          const drop = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), tearMat);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 14), tearMat);
          tip.position.y = 0.75;
          grp.add(drop, tip);
          scene.add(grp);
          return grp;
        });
      }
      rig.group.updateMatrixWorld(true);
      rig.tears.forEach((tear, i) => {
        const period = 1.4;
        const ph = ((cryFx.age + i * 0.7) % period) / period;
        let eye;
        if (rig.eyeMeshes && rig.eyeMeshes[i]) {
          eye = new THREE.Vector3();
          rig.eyeMeshes[i].getWorldPosition(eye);
          const eyeR = (rig.eyeMeshes[i].geometry.parameters?.radius || 0.05) * sc;
          eye.y -= eyeR * 0.8;                      // from the lower rim of the eye
        } else {
          eye = new THREE.Vector3((i ? 1 : -1) * 0.14, 0.06, 0.36).applyMatrix4(rig.group.matrixWorld);
        }
        const grow = Math.min(1, ph / 0.45);
        const fall = Math.max(0, (ph - 0.45) / 0.55);
        // a drop about the size of the eye itself
        const eyeSize = rig.eyeMeshes && rig.eyeMeshes[i] ? (rig.eyeMeshes[i].geometry.parameters?.radius || 0.05) * sc : sc * 0.06;
        const size = eyeSize * 0.9 * (0.4 + 0.6 * grow);
        tear.position.set(eye.x, eye.y - size * 0.6 - fall * fall * sc * 1.6, eye.z + size * 0.2);
        tear.scale.setScalar(size);
        tear.visible = true;
      });
    }
    if (rig.juice && !state.effects.some((f) => f.type === 'eat')) for (const m of rig.juice) m.visible = false;
    // a messy face after eating: orange smears around the mouth
    const messy = state.effects.find((f) => f.type === 'messy');
    if (messy || rig.smears) {
      if (!rig.smears) {
        const smearMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#e0741c'), roughness: 0.85 });
        const mp = rig.mouth?.group?.position || new THREE.Vector3(0, -0.05, 0.45);
        const rnd = (k) => { const x = Math.sin(k * 12.9898 + (rig.seed || 0)) * 43758.5453; return x - Math.floor(x); };
        rig.smears = [];
        for (let i = 0; i < 11; i++) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.045 + rnd(i) * 0.05, 8, 6), smearMat);
          b.position.set(mp.x + (rnd(i + 10) - 0.5) * 0.42, mp.y + (rnd(i + 20) - 0.5) * 0.3 + 0.03, mp.z - 0.03 + rnd(i + 30) * 0.04);
          b.scale.set(1.3, 1, 0.5);
          rig.inner.add(b);
          rig.smears.push(b);
        }
      }
      const k = messy ? Math.min(1, messy.age / 1.5, Math.max(0, (messy.t1 - t) / 1.5)) : 0;
      rig.smears.forEach((b, i) => { b.visible = k > 0.02; b.scale.set(1.3 * k, k, 0.5 * k); });
    }
    // particle effects in world space
    for (const fx of state.effects) {
      if (fx.type === 'eat') {
        // juice clouds the water around the eater: a soft orange murk that
        // swells while chewing and thins out afterwards, plus fine pulp specks
        const mp = rig.mouth?.group?.position || new THREE.Vector3(0, -0.05, 0.45);
        rig.group.updateMatrixWorld(true);
        const origin = mp.clone().applyMatrix4(rig.group.matrixWorld);
        if (!rig.juice) {
          // soft radial blobs (sprites) so the murk has no hard edge
          if (!window.__juiceTex) {
            const c = document.createElement('canvas'); c.width = c.height = 128;
            const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
            gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
            window.__juiceTex = new THREE.CanvasTexture(c);
          }
          rig.juice = [0, 1, 2, 3].map((i) => {
            const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: window.__juiceTex, color: new THREE.Color(i % 2 ? '#f7b733' : '#ef8a2a'), transparent: true, opacity: 0.35, depthWrite: false }));
            scene.add(m);
            return m;
          });
        }
        const u = fx.u, swell = Math.min(1, fx.age / 2.5), fadeOut = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
        rig.juice.forEach((m, i) => {
          const drift = fx.age * 0.1 * sc;
          m.position.set(origin.x + Math.sin(fx.age * 0.7 + i * 2.1) * 0.3 * sc + (i - 1.5) * 0.3 * sc * swell, origin.y + drift * (0.4 + i * 0.25) - 0.05 * sc, origin.z + Math.cos(fx.age * 0.5 + i) * 0.2 * sc + 0.4 * sc);
          const d = sc * (0.6 + (1.6 + i * 0.5) * swell);
          m.scale.set(d, d, 1);
          m.material.opacity = (0.4 - i * 0.06) * fadeOut;
          m.visible = true;
        });
        const n = 60, life = 5.0;
        for (let i = 0; i < n; i++) {
          const age = (fx.age + i * (life / n) * 1.7) % life;
          if (fx.age < i * 0.05) continue;
          const k = age / life;
          const a = i * 2.399 + fx.side, r = (0.1 + k * 1.4) * sc;
          const col = i % 3 === 0 ? [1, 0.72, 0.2] : i % 3 === 1 ? [0.95, 0.55, 0.12] : [1, 0.82, 0.4];
          fxEmit(origin.x + Math.cos(a) * r, origin.y + (k * 0.7 - k * k * 0.2) * sc + Math.sin(age * 3 + i) * 0.06 * sc, origin.z + Math.sin(a) * r * 0.7 + 0.15 * sc, (0.012 + 0.014 * (i % 3)) * sc, col[0], col[1], col[2]);
        }
      }
      if (fx.type === 'bubbles' || fx.type === 'cry' || fx.type === 'spout') {
        const n = fx.type === 'spout' ? 40 : fx.type === 'cry' ? 6 : 18;
        const local = fx.type === 'cry' ? (rig.eyePositions ? rig.eyePositions[1].clone() : new THREE.Vector3(0.14, 0.08, 0.36)) : fx.type === 'spout' ? (rig.blowhole || new THREE.Vector3(0, 0.3, 0.1)) : new THREE.Vector3(0, -0.05, 0.5);
        rig.group.updateMatrixWorld(true);
        const origin = local.clone().applyMatrix4(rig.group.matrixWorld);
        for (let i = 0; i < n; i++) {
          const life = fx.type === 'spout' ? 1.2 : 2.0;
          const age = ((fx.age * 1.0 + i * (life / n) * 1.7) % life);
          if (fx.age < i * 0.08) continue;
          const k = age / life;
          if (fx.type === 'spout') {
            const a = i * 2.399, r = k * 1.5 * sc;
            fxEmit(origin.x + Math.cos(a) * r * 0.4, origin.y + (4 * k - 5 * k * k) * sc * 1.2, origin.z + Math.sin(a) * r * 0.4, 0.08 * sc * (1 - k * 0.5), 0.95, 0.98, 1);
          } else {
            const side = fx.type === 'cry' ? (i % 2 ? 1 : -1) : 0;
            const wob = Math.sin(age * 5 + i) * 0.08 * sc;
            const ox = fx.type === 'cry' ? side * 0.14 * sc * 2 - 0.14 * sc : 0;
            const tc = fx.type === 'cry' && rig.tearColor ? new THREE.Color(rig.tearColor) : null;
            if (fx.type === 'cry' && tc) fxEmit(origin.x + ox + wob, origin.y - k * 1.6 * sc, origin.z + Math.cos(age * 4 + i) * 0.05 * sc, (0.05 + k * 0.02) * sc, tc.r, tc.g, tc.b);
            else fxEmit(origin.x + ox + wob, origin.y + k * 2.2 * sc + (fx.type === 'cry' ? -0.05 : 0), origin.z + Math.cos(age * 4 + i) * 0.05 * sc, (0.04 + k * 0.05) * sc * (fx.type === 'cry' ? 0.7 : 1), fx.type === 'cry' ? 0.6 : 1, fx.type === 'cry' ? 0.85 : 1, 1);
          }
        }
      }
    }
  }
  fxCommit();

  // overlays
  const subs = ev.subtitles(t);
  if (timeline.meta.burnSubtitles && subs.length) {
    $subs.innerHTML = subs.map((s) => {
      const a = Math.min(1, s.age / 0.25, s.remaining / 0.25);
      const dir = isRtl(s.text) ? 'rtl' : 'ltr';
      const spk = s.speaker && s.kind !== 'caption' ? `<span class="speaker" style="color:${s.color ? tint(s.color) : '#9fe0ff'}">${esc(s.speaker)}:</span>` : '';
      return `<div class="line ${s.kind}" dir="${dir}" style="opacity:${a.toFixed(3)}">${spk}${esc(s.text)}</div>`;
    }).join('<br>');
  } else $subs.innerHTML = '';
  let fade = 0, fadeColor = 'black', title = null, image = null, credits = null, clip = null, iris = null;
  for (const o of ev.overlays(t)) {
    if (o.type === 'fade') { const v = o.from + (o.to - o.from) * smooth(o.u); if (v >= fade) { fade = v; fadeColor = o.color || 'black'; } }
    if (o.type === 'iris') iris = o.from + (o.to - o.from) * smooth(o.u);
    if (o.type === 'title') title = o;
    if (o.type === 'image') image = o;
    if (o.type === 'credits') credits = o;
    if (o.type === 'clip') clip = o;
  }
  $fade.style.opacity = fade.toFixed(3);
  $fade.style.background = fadeColor;
  const $iris = document.getElementById('iris');
  if (iris != null) { $iris.style.opacity = 1; $iris.style.setProperty('--d', `${(iris * Math.hypot(width, height) * 1.02).toFixed(1)}px`); }
  else $iris.style.opacity = 0;
  const $img = document.getElementById('imagecard');
  if (image) {
    const url = assetUrl(image.src);
    if ($img.dataset.src !== url) { $img.querySelector('img').src = url; $img.dataset.src = url; }
    $img.querySelector('img').style.objectFit = image.fit === 'stretch' ? 'fill' : image.fit;
    $img.querySelector('.cap').textContent = image.caption || '';
    $img.style.opacity = Math.min(1, image.age / 0.5, image.remaining / 0.5).toFixed(3);
  } else $img.style.opacity = 0;
  const $cred = document.getElementById('credits');
  if (credits) {
    const key = credits.lines.join('|');
    if ($cred.dataset.key !== key) { $cred.dataset.key = key; $cred.querySelector('.roll').innerHTML = credits.lines.map((l) => `<div dir="${isRtl(l) ? 'rtl' : 'ltr'}">${esc(l)}</div>`).join(''); }
    const roll = $cred.querySelector('.roll');
    const travel = height + roll.offsetHeight;
    roll.style.transform = `translateY(${(height - credits.u * travel).toFixed(1)}px)`;
    $cred.style.opacity = 1;
  } else $cred.style.opacity = 0;
  const $clip = document.getElementById('clip');
  const video = $clip.querySelector('video');
  let clipReady = Promise.resolve();
  if (clip) {
    const url = assetUrl(clip.src);
    if (video.dataset.src !== url) { video.src = url; video.dataset.src = url; video.muted = true; video.preload = 'auto'; }
    video.style.objectFit = clip.fit === 'stretch' ? 'fill' : clip.fit;
    const target = (clip.offset || 0) + clip.age;
    clipReady = seekVideo(video, target);
    $clip.style.opacity = Math.min(1, clip.age / 0.3, clip.remaining / 0.3).toFixed(3);
  } else { $clip.style.opacity = 0; }
  if (title) {
    $title.style.opacity = Math.min(1, title.age / 0.8, title.remaining / 0.8).toFixed(3);
    $title.querySelector('.main').textContent = title.text;
    $title.querySelector('.main').dir = isRtl(title.text) ? 'rtl' : 'ltr';
    $title.querySelector('.sub').textContent = title.subtitle || '';
  } else $title.style.opacity = 0;

  const __t1 = performance.now();
  renderer.render(scene, camera);
  // WebGL queues the draw; a 1x1 readPixels forces the rasteriser to finish
  // here, so the draw bucket is honest and the screenshot bucket is readback + PNG
  try { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, window.__px || (window.__px = new Uint8Array(4))); } catch { /* ignore */ }
  window.__seekProfile = { evalMs: __t1 - __t0, drawMs: performance.now() - __t1 };
  return clipReady;
}
// Deterministic video frame selection: seek and wait for the frame to be decoded.
function seekVideo(video, time) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    if (video.readyState === 0) {
      video.addEventListener('loadedmetadata', () => { video.currentTime = time; }, { once: true });
      video.addEventListener('seeked', done);
      setTimeout(resolve, 8000);
      return;
    }
    if (Math.abs(video.currentTime - time) < 0.001) return resolve();
    video.addEventListener('seeked', done);
    video.currentTime = time;
    setTimeout(resolve, 8000);
  });
}
const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function tint(hex) { const c = new THREE.Color(hex); c.lerp(new THREE.Color(1, 1, 1), 0.45); return '#' + c.getHexString(); }

// ---- preview UI ---------------------------------------------------------------
function fitStage() {
  if (HEADLESS) { stage.style.transform = 'none'; return; }
  const availH = window.innerHeight - 40;
  const s = Math.min(window.innerWidth / width, availH / height);
  stage.style.transform = `scale(${s})`;
  stage.style.left = `${(window.innerWidth - width * s) / 2}px`;
}
function buildMarkers() {
  const m = document.getElementById('markers');
  m.innerHTML = '';
  for (const mk of timeline.markers) {
    if (mk.kind !== 'scene') continue;
    const s = document.createElement('span');
    s.style.left = `${(mk.t / timeline.meta.duration) * 100}%`;
    s.textContent = mk.label;
    m.appendChild(s);
  }
}

let playing = false, cur = 0, lastWall = 0;
function previewLoop(now) {
  requestAnimationFrame(previewLoop);
  if (!ev) return;
  if (playing) {
    const dt = Math.min(0.1, (now - lastWall) / 1000);
    cur += dt;
    if (cur >= timeline.meta.duration) { cur = 0; }
  }
  lastWall = now;
  const t0 = performance.now();
  seek(cur);
  const ms = performance.now() - t0;
  document.getElementById('time').textContent = cur.toFixed(2) + 's';
  document.getElementById('dur').textContent = timeline.meta.duration.toFixed(1) + 's';
  document.getElementById('fpsmeter').textContent = ms.toFixed(0) + 'ms/frame';
  document.getElementById('scrub').value = Math.round((cur / timeline.meta.duration) * 1000);
}

async function fetchTimeline() {
  const res = await fetch('/timeline.json?ts=' + Date.now(), { cache: 'no-store' });
  return { json: await res.json(), etag: res.headers.get('etag') || '' };
}

async function main() {
  setupRenderer();
  if (HEADLESS) {
    window.__load = (tl) => { loadTimeline(tl); return true; };
    // subtitles are muxed as a soft track unless burn-in was requested
    window.__seek = async (t) => { await seek(t); return window.__seekProfile || true; };
    window.__debug = (hide) => {
      const names = String(hide).split(',').filter(Boolean);
      for (const n of names) { if (ocean[n]) ocean[n].visible = false; }
      renderer.render(scene, camera);
      const es = ev.envState(0);
      return JSON.stringify(mixEnv(envParams[es.prevIndex], envParams[es.index], es.blend));
    };
    try { const { json } = await fetchTimeline(); await preloadAssets(json); loadTimeline(json); } catch (e) { console.warn('no timeline yet', e); }
    // warm up shaders
    if (ev) await seek(0);
    window.__ready = true;
    return;
  }
  const { json, etag } = await fetchTimeline();
  json.meta.burnSubtitles = true; // the preview always shows subtitles
  await preloadAssets(json);
  loadTimeline(json);
  let lastEtag = etag;
  window.addEventListener('resize', fitStage);
  document.getElementById('play').onclick = () => { playing = !playing; document.getElementById('play').textContent = playing ? '❚❚' : '▶'; };
  document.getElementById('scrub').oninput = (e) => { cur = (e.target.value / 1000) * timeline.meta.duration; };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); document.getElementById('play').click(); }
    if (e.code === 'ArrowRight') cur = Math.min(timeline.meta.duration, cur + (e.shiftKey ? 5 : 1 / timeline.meta.fps));
    if (e.code === 'ArrowLeft') cur = Math.max(0, cur - (e.shiftKey ? 5 : 1 / timeline.meta.fps));
    if (e.code === 'Home') cur = 0;
  });
  setInterval(async () => {
    try {
      const res = await fetch('/timeline.version', { cache: 'no-store' });
      const v = await res.text();
      if (v !== lastEtag) { lastEtag = v; const { json } = await fetchTimeline(); json.meta.burnSubtitles = true; await preloadAssets(json); loadTimeline(json); }
    } catch { /* ignore */ }
  }, 1000);
  playing = true;
  document.getElementById('play').textContent = '❚❚';
  requestAnimationFrame(previewLoop);
}
main();
