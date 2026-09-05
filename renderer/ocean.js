// The ocean environment: sky/water background, wave surface, seabed with
// caustics, seaweed, rocks, coral, bubbles, plankton and light rays.
import * as THREE from 'three';
import { toHex } from './colors.js';

// Deterministic PRNG (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const WATER = {
  blue:      { fog: '#1f6fb8', deep: '#062a52', shallow: '#4fa8e0', tint: '#2f7fc8' },
  turquoise: { fog: '#2aa6a8', deep: '#0b4f5a', shallow: '#7fe0d8', tint: '#3bbcb8' },
  green:     { fog: '#3a8f6a', deep: '#0d3a2a', shallow: '#7fcf9a', tint: '#3f9a70' },
  dark:      { fog: '#173f66', deep: '#06182e', shallow: '#3a6a94', tint: '#1f4d78' },
  night:     { fog: '#12294a', deep: '#050e1e', shallow: '#2a4a78', tint: '#1a3a60' },
  tropical:  { fog: '#33b5d6', deep: '#0a5477', shallow: '#9be7f5', tint: '#47c4e0' },
  black:     { fog: '#05070c', deep: '#010203', shallow: '#0d1420', tint: '#0a1018' },
  murky:     { fog: '#4a5a3a', deep: '#1c2414', shallow: '#7a8a5a', tint: '#55653f' },
  pink:      { fog: '#e9a7d8', deep: '#8c4a7c', shallow: '#ffd6f0', tint: '#f0b6e0' },
  yellow:    { fog: '#f2cf5a', deep: '#9a7a1e', shallow: '#fff0a8', tint: '#f6d86a' },
};
const TIME = {
  day:    { sun: '#fff4dc', sunI: 1.0,  amb: 0.55, sky: '#4f9ff5', horizon: '#cfe8ff', sunDir: [0.3, 1, 0.4], surface: '#dff4ff' },
  noon:   { sun: '#ffffff', sunI: 1.1,  amb: 0.6,  sky: '#3d8ff0', horizon: '#c8e6ff', sunDir: [0.05, 1, 0.1], surface: '#e8f8ff' },
  morning:{ sun: '#ffe7c2', sunI: 0.9,  amb: 0.5,  sky: '#79b6f5', horizon: '#ffd9b0', sunDir: [0.8, 0.6, 0.3], surface: '#ffe9d0' },
  sunset: { sun: '#ffb070', sunI: 0.75, amb: 0.4,  sky: '#5a4f9e', horizon: '#ff9a5c', sunDir: [0.9, 0.35, 0.2], surface: '#ffb37a' },
  dusk:   { sun: '#e0a0c0', sunI: 0.65, amb: 0.45, sky: '#2b2d6e', horizon: '#b06a8a', sunDir: [0.9, 0.25, 0.3], surface: '#c58fb5' },
  night:  { sun: '#a8c4ff', sunI: 0.4, amb: 0.3,  sky: '#050a1e', horizon: '#142446', sunDir: [-0.3, 1, 0.2], surface: '#6b8fd6' },
};
const WAVES = { none: 0, off: 0, flat: 0.05, calm: 0.15, gentle: 0.35, medium: 0.6, choppy: 0.9, rough: 1.3, storm: 1.8, stormy: 1.8 };
const DEPTH = { surface: -5, shallow: -8, medium: -14, deep: -24, abyss: -40 };
const DENSITY = { off: 0, none: 0, no: 0, false: 0, low: 0.5, few: 0.5, on: 1, yes: 1, true: 1, normal: 1, many: 2, lots: 2, high: 2, dense: 2 };

function col(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
function density(v, def = 1) { if (v == null) return def; if (typeof v === 'number') return v; return DENSITY[String(v).toLowerCase()] ?? def; }

// Resolves cumulative script settings into a numeric parameter set.
export function resolveEnv(s = {}) {
  const wKey = String(s.water ?? 'blue').toLowerCase();
  const w = WATER[wKey] || (wKey.startsWith('#') ? { fog: wKey, deep: wKey, shallow: wKey, tint: wKey } : WATER.blue);
  const tKey = String(s.time ?? 'day').toLowerCase();
  const tm = TIME[tKey] || TIME.day;
  const floorType = String(s.floor ?? 'sand').toLowerCase();
  let floorY = typeof s.depth === 'number' ? -Math.abs(s.depth) : (DEPTH[String(s.depth ?? 'medium').toLowerCase()] ?? -14);
  const visibility = typeof s.visibility === 'number' ? s.visibility : 40;
  const waveAmp = typeof s.waves === 'number' ? s.waves : (WAVES[String(s.waves ?? 'gentle').toLowerCase()] ?? 0.35);
  const night = tKey === 'night' || tKey === 'dusk';
  const style = String(s.style ?? '3d').toLowerCase();
  const flat = style === 'flat' || style === 'book' || style === '2d';
  const skyOverride = typeof s.sky === 'string' && s.sky.startsWith('#') ? col(s.sky) : null;
  const land = floorType === 'land' || floorType === 'grass' || floorType === 'ground';
  if (land) floorY = 0.6;
  // old-film looks: `look: sepia` (or `old film`, `dream`), `look: noir` (black and
  // white); grain, vignette, flicker and scratches come with them and can be set
  // separately (`grain: off`, `scratches: many`)
  const look = String(s.look ?? s.film ?? 'normal').toLowerCase();
  const sepiaLook = /sepia|old|vintage|dream|archive|newsreel|silent|194|193/.test(look);
  const monoLook = !sepiaLook && /\bbw\b|b&w|mono|noir|gr[ae]y|black/.test(look);
  const filmLook = sepiaLook || monoLook || /film/.test(look);
  return {
    sepia: sepiaLook ? 1 : 0,
    mono: monoLook ? 1 : 0,
    grain: density(s.grain, filmLook ? 1 : 0),
    vignette: density(s.vignette, filmLook ? 1 : 0),
    flicker: density(s.flicker, filmLook ? 1 : 0),
    scratches: density(s.scratches, filmLook ? 1 : 0),
    flat: flat ? 1 : 0,
    land: land ? 1 : 0,
    clouds: density(s.clouds, tKey === 'night' ? 0.3 : 0.8),
    backdrop: s.backdrop && !/^(none|off|no|false)$/i.test(String(s.backdrop)) ? String(s.backdrop) : null,
    interior: s.interior && !/^(none|off|no|false)$/i.test(String(s.interior)) ? String(s.interior).toLowerCase() : null,
    skyOverride,
    fog: col(w.fog), deep: col(w.deep), shallow: col(w.shallow), tint: col(w.tint),
    sun: col(tm.sun), sunI: tm.sunI, amb: tm.amb, sky: col(tm.sky), horizon: col(tm.horizon), surface: col(tm.surface),
    sunDir: tm.sunDir,
    fogDensity: flat ? 0 : (typeof s.fog === 'number' ? s.fog : 1.6 / Math.max(5, visibility)),
    waveAmp,
    floorY,
    floorType,
    beach: floorType === 'beach' ? 1 : 0,
    caustics: density(s.caustics, night ? 0.4 : 1),
    rays: density(s.rays, night ? 0.3 : 1) * (tKey === 'night' ? 0.4 : 1),
    bubbles: density(s.bubbles, 1),
    plankton: density(s.plankton, 1),
    seaweed: density(s.seaweed, { reef: 1.6, sand: 0.7, rock: 0.35, none: 0, beach: 0.3, kelp: 2.5 }[floorType] ?? 0.7),
    coral: density(s.coral, { reef: 1.5, sand: 0.25, rock: 0.15, none: 0, beach: 0, kelp: 0.2 }[floorType] ?? 0.25),
    rocks: density(s.rocks, { reef: 0.5, sand: 0.15, rock: 1.6, none: 0, beach: 0.3, kelp: 0.4 }[floorType] ?? 0.15),
    sandColor: col({ sand: '#d8c68e', reef: '#cdb27c', rock: '#6f6d6a', beach: '#e6d5a0', kelp: '#8c7f55', none: '#4a4a4a', land: '#7cbf5a', grass: '#7cbf5a', ground: '#b48a5a' }[floorType] || '#d8c68e'),
    floorVisible: floorType === 'none' ? 0 : 1,
  };
}

export function mixEnv(a, b, u) {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const out = {};
  for (const k of Object.keys(b)) {
    const av = a[k], bv = b[k];
    if (Array.isArray(bv)) out[k] = bv.map((x, i) => av[i] + (x - av[i]) * u);
    else if (typeof bv === 'number') out[k] = av + (bv - av) * u;
    else out[k] = u < 0.5 ? av : bv;
  }
  return out;
}

const FOG_GLSL = `
  uniform vec3 uFogColor; uniform float uFogDensity;
  vec3 applyFog(vec3 color, float dist) {
    float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    return mix(color, uFogColor, clamp(f, 0.0, 1.0));
  }
`;

export class Ocean {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.params = resolveEnv({});
    this.t = 0;
    this.buildLights();
    this.buildBackground();
    this.buildSurface();
    this.buildFloor();
    this.buildSeaweed();
    this.buildRocksAndCoral();
    this.buildBubbles();
    this.buildPlankton();
    this.buildRays();
    this.buildClouds();
    this.buildInterior();
    this.scene.fog = new THREE.FogExp2(0x1f6fb8, 0.04);
    this.backdropTextures = {};
  }

  buildClouds() {
    // soft procedural cloud sprites, deterministic layout, drifting with time
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r = rng(77);
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 9; i++) {
      const x = 40 + r() * 176, y = 90 + r() * 90, rad = 30 + r() * 45;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.7)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cloudMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.95 });
    this.clouds = new THREE.Group();
    const r2 = rng(78);
    for (let i = 0; i < 26; i++) {
      const sp = new THREE.Sprite(this.cloudMat);
      sp.userData = { x: (r2() - 0.5) * 400, z: -80 - r2() * 260, y: 18 + r2() * 30, w: 30 + r2() * 60, spd: 0.4 + r2() * 0.8, i };
      this.clouds.add(sp);
    }
    this.group.add(this.clouds);
  }

  setBackdropTexture(name, tex) { this.backdropTextures[name] = tex; }

  buildInterior() {
    // inside the whale: a dark cavern with vertical baleen bars along the walls
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#e8e8ec';
    for (let x = 6; x < 512; x += 24) ctx.fillRect(x, 0, 9, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(10, 1);
    const geo = new THREE.CylinderGeometry(28, 28, 26, 64, 1, true);
    const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.BackSide, roughness: 0.9, fog: false });
    this.interior = new THREE.Group();
    const walls = new THREE.Mesh(geo, m);
    walls.rotation.z = Math.PI / 2;
    this.interior.add(walls);
    const roof = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: 0x03040a, side: THREE.BackSide, fog: false }));
    this.interior.add(roof);
    this.interior.visible = false;
    this.group.add(this.interior);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xbfe6ff, 0x1b3a5c, 0.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.position.set(10, 30, 10);
    this.fill = new THREE.DirectionalLight(0x88bbff, 0.25);
    this.fill.position.set(-10, -5, -10);
    this.group.add(this.hemi, this.sun, this.fill);
  }

  buildBackground() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    this.bgMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uDeep: { value: new THREE.Vector3() }, uShallow: { value: new THREE.Vector3() }, uSky: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() }, uCamY: { value: 0 }, uFog: { value: new THREE.Vector3() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uDeep, uShallow, uSky, uHorizon, uFog; uniform float uCamY; varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 c;
          if (uCamY > 0.0) {
            c = y > 0.0 ? mix(uHorizon, uSky, pow(clamp(y, 0.0, 1.0), 0.6)) : mix(uHorizon, uFog, clamp(-y * 6.0, 0.0, 1.0));
          } else {
            float depthDark = clamp(-uCamY / 30.0, 0.0, 0.8);
            vec3 up = mix(uShallow, uFog, 0.3);
            vec3 deep = mix(uDeep, uFog, 0.35);
            float k = smoothstep(0.12, 0.8, y);
            float d = smoothstep(-0.15, -0.8, y);
            c = mix(mix(uFog, up, k), deep, d);
            // exactly the fog colour at the horizon so fogged geometry blends seamlessly
            c = mix(c, uDeep, depthDark * 0.5 * (k + d));
          }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>

        }`,
    });
    this.bg = new THREE.Mesh(geo, this.bgMat);
    this.bg.frustumCulled = false;
    this.group.add(this.bg);
  }

  buildSurface() {
    const geo = new THREE.PlaneGeometry(700, 700, 200, 200);
    geo.rotateX(-Math.PI / 2);
    this.surfMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, fog: false,
      uniforms: {
        uTime: { value: 0 }, uAmp: { value: 0.3 }, uTint: { value: new THREE.Vector3() }, uSky: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() },
        uSurface: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0.3, 1, 0.4) },
        uFogColor: { value: new THREE.Vector3() }, uFogDensity: { value: 0.04 }, uCamY: { value: 0 }, uSunI: { value: 1 },
      },
      vertexShader: `
        uniform float uTime, uAmp; varying vec3 vWorld; varying vec3 vNormal;
        vec3 gerstner(vec2 p, float t, out vec3 n) {
          vec3 d = vec3(0.0); n = vec3(0.0, 1.0, 0.0);
          vec2 dirs[4]; float amps[4]; float lens[4]; float spds[4];
          dirs[0] = normalize(vec2(1.0, 0.3)); amps[0] = 0.55; lens[0] = 14.0; spds[0] = 1.1;
          dirs[1] = normalize(vec2(-0.4, 1.0)); amps[1] = 0.32; lens[1] = 8.0; spds[1] = 1.5;
          dirs[2] = normalize(vec2(0.7, -0.6)); amps[2] = 0.18; lens[2] = 4.5; spds[2] = 2.2;
          dirs[3] = normalize(vec2(-0.9, -0.2)); amps[3] = 0.1; lens[3] = 2.2; spds[3] = 3.0;
          for (int i = 0; i < 4; i++) {
            float k = 6.28318 / lens[i]; float a = amps[i] * uAmp; float q = 0.5 / (k * a * 4.0 + 1e-3);
            float ph = k * dot(dirs[i], p) - spds[i] * t;
            d.x += q * a * dirs[i].x * cos(ph); d.z += q * a * dirs[i].y * cos(ph); d.y += a * sin(ph);
            n.x -= dirs[i].x * k * a * cos(ph); n.z -= dirs[i].y * k * a * cos(ph);
          }
          n = normalize(n);
          return d;
        }
        void main(){
          vec3 n; vec3 d = gerstner(position.xz, uTime, n);
          vec3 p = position + d;
          vNormal = n; vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTint, uSky, uHorizon, uSurface, uSun, uSunDir; uniform float uCamY, uSunI, uTime;
        varying vec3 vWorld; varying vec3 vNormal;
        ${FOG_GLSL}
        void main(){
          vec3 V = normalize(cameraPosition - vWorld);
          float dist = length(cameraPosition - vWorld);
          vec3 N = normalize(vNormal);
          vec3 L = normalize(uSunDir);
          vec3 c;
          if (gl_FrontFacing) {
            float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
            vec3 skyRef = mix(uHorizon, uSky, 0.5);
            c = mix(uTint, skyRef, 0.25 + 0.7 * fres);
            vec3 H = normalize(L + V);
            float spec = pow(max(dot(N, H), 0.0), 220.0) * uSunI;
            c += uSun * spec * 1.5;
            c = applyFog(c, dist * 0.35);
          } else {
            float fres = pow(1.0 - max(dot(-N, V), 0.0), 2.0);
            float sparkle = pow(max(dot(reflect(-L, -N), V), 0.0), 60.0);
            float ripple = 0.5 + 0.5 * sin(vWorld.x * 0.7 + uTime * 1.3) * sin(vWorld.z * 0.9 - uTime * 0.9);
            c = mix(uSurface * 0.9, vec3(1.0), 0.35 * fres + 0.5 * sparkle) * (0.85 + 0.25 * ripple) * (0.5 + 0.6 * uSunI);
            c = mix(c, uFogColor * 1.3, 0.35 * (1.0 - fres));
            c = applyFog(c, dist);
          }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>

        }`,
    });
    this.surface = new THREE.Mesh(geo, this.surfMat);
    this.surface.frustumCulled = false;
    this.group.add(this.surface);
  }

  buildFloor() {
    const size = 800, seg = 200;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const r = rng(7);
    // low-frequency dunes + small ripples
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let h = Math.sin(x * 0.08 + 1.3) * Math.cos(z * 0.06 - 0.7) * 1.6 + Math.sin(x * 0.21 + z * 0.17) * 0.6 + Math.sin(x * 0.9) * Math.sin(z * 1.1) * 0.12;
      h += (r() - 0.5) * 0.08;
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uColor: { value: new THREE.Vector3(0.85, 0.78, 0.55) }, uCaustics: { value: 1 }, uSun: { value: new THREE.Vector3(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0.3, 1, 0.4) }, uAmb: { value: 0.5 }, uFogColor: { value: new THREE.Vector3() }, uFogDensity: { value: 0.04 },
        uBeach: { value: 0 }, uFloorY: { value: -14 }, uSunI: { value: 1 },
      },
      vertexShader: `
        uniform float uBeach, uFloorY; varying vec3 vWorld; varying vec3 vNormal;
        void main(){
          vec3 p = position;
          p.y += uBeach * max(0.0, (p.x - 12.0) * 0.32) * 1.0;
          p.y += uBeach * max(0.0, (p.x - 12.0)) * 0.0;
          if (uBeach > 0.5) p.y = max(p.y, uFloorY * -1.0 * 0.0 + p.y);
          vNormal = normalMatrix * normal;
          vec4 w = modelMatrix * vec4(p, 1.0); vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uTime, uCaustics, uAmb, uSunI; uniform vec3 uColor, uSun, uSunDir;
        varying vec3 vWorld; varying vec3 vNormal;
        ${FOG_GLSL}
        float caustic(vec2 p, float t){
          vec2 k = p;
          float c = abs(sin(k.x * 1.7 + t * 0.9 + sin(k.y * 2.3 + t * 0.7)));
          c *= abs(sin(k.y * 1.3 - t * 1.1 + sin(k.x * 1.9 - t * 0.5)));
          return c;
        }
        void main(){
          vec3 N = normalize(vNormal);
          float diff = max(dot(N, normalize(uSunDir)), 0.0);
          // sand speckle
          float speck = fract(sin(dot(floor(vWorld.xz * 6.0), vec2(12.9898, 78.233))) * 43758.5453) * 0.12;
          vec3 base = uColor * (0.92 + speck);
          float ca = caustic(vWorld.xz * 0.45, uTime) * 0.6 + caustic(vWorld.xz * 0.9 + 3.1, uTime * 1.3) * 0.4;
          ca = pow(ca, 2.2) * 1.8;
          float under = vWorld.y < 0.0 ? 1.0 : 0.0;
          float depthAtt = exp(vWorld.y * 0.045);
          vec3 light = uSun * (diff * 0.75 * uSunI + uAmb) + uSun * ca * uCaustics * under * uSunI * depthAtt;
          vec3 c = base * light;
          float dist = length(cameraPosition - vWorld);
          c = applyFog(c, dist);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>

        }`,
    });
    this.floor = new THREE.Mesh(geo, this.floorMat);
    this.floor.frustumCulled = false;
    this.group.add(this.floor);
    this.floorHeight = (x, z) => Math.sin(x * 0.08 + 1.3) * Math.cos(z * 0.06 - 0.7) * 1.6 + Math.sin(x * 0.21 + z * 0.17) * 0.6 + Math.sin(x * 0.9) * Math.sin(z * 1.1) * 0.12;
  }

  buildSeaweed() {
    const MAX = 700;
    const geo = new THREE.PlaneGeometry(0.5, 1, 1, 8);
    geo.translate(0, 0.5, 0);
    const r = rng(11);
    this.weedPhase = new Float32Array(MAX);
    this.weedMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 }, uFogColor: { value: new THREE.Vector3() }, uFogDensity: { value: 0.04 }, uSunI: { value: 1 }, uAmb: { value: 0.5 } },
      vertexShader: `
        uniform float uTime; attribute float phase; attribute vec3 tint; varying float vY; varying vec3 vWorld; varying vec3 vTint;
        void main(){
          vec3 p = position;
          float sway = sin(uTime * 1.4 + phase + p.y * 1.7) * 0.22 * p.y * p.y + sin(uTime * 0.6 + phase * 2.0) * 0.1 * p.y;
          p.x += sway; p.z += cos(uTime * 1.1 + phase) * 0.12 * p.y * p.y;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vWorld = w.xyz; vY = position.y; vTint = tint;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uSunI, uAmb; varying float vY; varying vec3 vWorld; varying vec3 vTint;
        ${FOG_GLSL}
        void main(){
          vec3 c = vTint * (0.35 + 0.65 * vY) * (0.5 + 0.6 * uSunI) * (0.6 + uAmb);
          c = applyFog(c, length(cameraPosition - vWorld));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>

        }`,
    });
    this.weed = new THREE.InstancedMesh(geo, this.weedMat, MAX);
    this.weed.frustumCulled = false;   // instances are re-placed per scene; a bounding sphere from the first frame would cull them later
    this.weed.frustumCulled = false;
    const phase = new Float32Array(MAX), tint = new Float32Array(MAX * 3);
    const m = new THREE.Matrix4();
    this.weedData = [];
    for (let i = 0; i < MAX; i++) {
      const rad = 8 + Math.pow(r(), 0.7) * 80, ang = r() * Math.PI * 2;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      const h = 1.2 + r() * 3.5;
      this.weedData.push({ x, z, h, rot: r() * Math.PI, w: 0.7 + r() * 0.8 });
      phase[i] = r() * Math.PI * 2;
      const g = new THREE.Color().setHSL(0.28 + r() * 0.12, 0.55, 0.3 + r() * 0.15);
      tint.set([g.r, g.g, g.b], i * 3);
      m.identity();
      this.weed.setMatrixAt(i, m);
    }
    geo.setAttribute('phase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('tint', new THREE.InstancedBufferAttribute(tint, 3));
    this.group.add(this.weed);
  }

  buildRocksAndCoral() {
    const r = rng(23);
    const MAXR = 160, MAXC = 220;
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x4f4a44, roughness: 1, metalness: 0, flatShading: true });
    this.rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), this.rockMat, MAXR);
    this.rocks.frustumCulled = false;
    this.rockData = [];
    for (let i = 0; i < MAXR; i++) {
      const rad = 6 + Math.pow(r(), 0.8) * 90, ang = r() * Math.PI * 2;
      this.rockData.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, s: 0.5 + r() * 2.2, ry: r() * 6, rx: r() * 0.6, sy: 0.5 + r() * 0.5 });
    }
    this.coralGeo = [new THREE.ConeGeometry(0.5, 1.6, 7), new THREE.SphereGeometry(0.7, 10, 8), new THREE.CylinderGeometry(0.15, 0.3, 1.4, 6), new THREE.TorusKnotGeometry(0.35, 0.12, 40, 6)];
    this.coralMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    this.corals = this.coralGeo.map((g) => new THREE.InstancedMesh(g, this.coralMat, Math.ceil(MAXC / 4)));
    for (const c of this.corals) c.frustumCulled = false;
    const palette = ['#ff6f61', '#ff9f43', '#f9e04b', '#c084fc', '#f472b6', '#34d399', '#fb7185', '#60a5fa'];
    this.coralData = [];
    for (let i = 0; i < MAXC; i++) {
      const rad = 4 + Math.pow(r(), 0.8) * 70, ang = r() * Math.PI * 2;
      const c = new THREE.Color(palette[Math.floor(r() * palette.length)]);
      this.coralData.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, s: 0.5 + r() * 1.4, ry: r() * 6, color: c });
    }
    this.rocks.frustumCulled = false;
    for (const c of this.corals) c.frustumCulled = false;
    this.group.add(this.rocks, ...this.corals);
  }

  buildBubbles() {
    const MAX = 900;
    const r = rng(41);
    const base = new Float32Array(MAX * 3), attr = new Float32Array(MAX * 3);
    for (let i = 0; i < MAX; i++) {
      base.set([(r() - 0.5) * 120, r() * 30, (r() - 0.5) * 120], i * 3);
      attr.set([0.4 + r() * 1.2, 0.06 + r() * 0.16, r() * 6.28], i * 3); // speed, size, phase
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
    geo.setAttribute('attr', new THREE.BufferAttribute(attr, 3));
    this.bubbleMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uFloorY: { value: -14 }, uCount: { value: 900 }, uFogColor: { value: new THREE.Vector3() }, uFogDensity: { value: 0.04 }, uScale: { value: 720 } },
      vertexShader: `
        uniform float uTime, uFloorY, uCount, uScale; attribute vec3 attr; varying float vAlpha; varying vec3 vWorld;
        void main(){
          float span = -uFloorY + 0.5;
          float y = uFloorY + mod(position.y + attr.x * uTime, span);
          vec3 p = vec3(position.x + sin(uTime * 1.3 + attr.z) * 0.25, y, position.z + cos(uTime * 1.1 + attr.z) * 0.25);
          vec4 w = modelMatrix * vec4(p, 1.0); vWorld = w.xyz;
          vec4 mv = viewMatrix * w;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = attr.y * uScale / max(1.0, -mv.z) * 1.6;
          float idx = float(gl_VertexID);
          vAlpha = idx < uCount ? 1.0 : 0.0;
          vAlpha *= smoothstep(0.0, 1.0, (0.0 - y) * 1.0);
        }`,
      fragmentShader: `
        varying float vAlpha; varying vec3 vWorld;
        ${FOG_GLSL}
        void main(){
          vec2 d = gl_PointCoord - 0.5; float r = length(d);
          if (r > 0.5 || vAlpha <= 0.0) discard;
          float rim = smoothstep(0.32, 0.5, r) * 0.9;
          float hl = smoothstep(0.18, 0.0, length(d - vec2(-0.15, -0.15))) * 0.8;
          float a = (rim + hl + 0.08) * vAlpha;
          float f = exp(-uFogDensity * uFogDensity * pow(length(cameraPosition - vWorld), 2.0));
          gl_FragColor = vec4(vec3(1.0), a * f * 0.85);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>

        }`,
    });
    this.bubbles = new THREE.Points(geo, this.bubbleMat);
    this.bubbles.frustumCulled = false;
    this.group.add(this.bubbles);
  }

  buildPlankton() {
    const MAX = 1200;
    const r = rng(53);
    const pos = new Float32Array(MAX * 3), attr = new Float32Array(MAX * 3);
    for (let i = 0; i < MAX; i++) {
      pos.set([r() * 60, r() * 40, r() * 60], i * 3);
      attr.set([r() * 6.28, 0.3 + r() * 0.7, r()], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('attr', new THREE.BufferAttribute(attr, 3));
    this.plankMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uDensity: { value: 1 }, uFogColor: { value: new THREE.Vector3() }, uFogDensity: { value: 0.04 }, uScale: { value: 720 }, uFloorY: { value: -14 } },
      vertexShader: `
        uniform float uTime, uDensity, uScale, uFloorY, uFogDensity; uniform vec3 uCam; attribute vec3 attr; varying float vA;
        void main(){
          vec3 box = vec3(60.0, 40.0, 60.0);
          vec3 drift = vec3(sin(uTime * 0.3 + attr.x) * 0.5 + uTime * 0.15, sin(uTime * 0.2 + attr.x * 2.0) * 0.3, cos(uTime * 0.25 + attr.x) * 0.5);
          vec3 p = mod(position + drift - uCam + box * 0.5, box) - box * 0.5 + uCam;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = attr.y * uScale / max(1.0, -mv.z) * 0.06 + 1.0;
          float visible = attr.z < uDensity ? 1.0 : 0.0;
          float under = p.y < 0.0 && p.y > uFloorY ? 1.0 : 0.0;
          vA = visible * under * exp(-uFogDensity * uFogDensity * dot(mv.xyz, mv.xyz)) * 0.5;
        }`,
      fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; if (length(d) > 0.5 || vA <= 0.0) discard; gl_FragColor = vec4(vec3(0.9, 0.95, 1.0), vA);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
 }`,
    });
    this.plankton = new THREE.Points(geo, this.plankMat);
    this.plankton.frustumCulled = false;
    this.group.add(this.plankton);
  }

  buildRays() {
    const N = 14;
    const r = rng(67);
    this.rayMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 }, uStrength: { value: 1 }, uColor: { value: new THREE.Vector3(1, 1, 1) } },
      vertexShader: `varying vec2 vUv; attribute float phase; varying float vPhase; void main(){ vUv = uv; vPhase = 0.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime, uStrength; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          float x = abs(vUv.x - 0.5) * 2.0;
          float edge = 1.0 - smoothstep(0.2, 1.0, x);
          float fall = pow(vUv.y, 1.8);
          float flick = 0.7 + 0.3 * sin(uTime * 0.8 + vUv.y * 4.0);
          gl_FragColor = vec4(uColor, edge * fall * flick * 0.16 * uStrength);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>

        }`,
    });
    this.rays = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, -0.5, 0);
    for (let i = 0; i < N; i++) {
      const m = new THREE.Mesh(geo, this.rayMat);
      const ang = r() * Math.PI * 2, rad = 4 + r() * 22;
      m.userData = { x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, w: 1.5 + r() * 4, h: 22 + r() * 18, tilt: (r() - 0.5) * 0.5, phase: r() * 6.28, spd: 0.05 + r() * 0.1 };
      m.frustumCulled = false;
      this.rays.add(m);
    }
    this.group.add(this.rays);
  }

  // Applies a resolved (possibly blended) parameter set.
  apply(p, t, camera, viewportHeight) {
    this.params = p;
    this.t = t;
    const v3 = (u, a) => u.value.set(a[0], a[1], a[2]);
    const camUnder = camera.position.y < 0 && !p.land;
    const flat = p.flat >= 0.5;
    const fogDensity = flat ? 0 : camUnder ? p.fogDensity : 0.004;
    const fogColor = camUnder ? p.fog : p.horizon;
    // backdrop image (2D plate) replaces the sky/water background
    const bdTex = p.backdrop ? this.backdropTextures[p.backdrop] : null;
    if (bdTex) { this.scene.background = bdTex; this.bg.visible = false; }
    else if (p.skyOverride) { this.scene.background = new THREE.Color(p.skyOverride[0], p.skyOverride[1], p.skyOverride[2]); this.bg.visible = false; }
    else { this.scene.background = null; this.bg.visible = true; }
    this.floor.visible = p.floorVisible >= 0.5 && !p.interior;
    this.interior.visible = !!p.interior;
    if (p.interior) {
      this.interior.position.set(camera.position.x, camera.position.y + 4, camera.position.z);
      this.interior.children[0].rotation.x = t * 0.02;
      this.bg.visible = false; this.scene.background = new THREE.Color(0x03040a);
    }
    this.surface.visible = (!(p.land >= 0.5) && p.waveAmp > 0.001) && !p.interior;
    this.clouds.visible = !camUnder && p.clouds > 0 && !bdTex;
    for (const sp of this.clouds.children) {
      const d = sp.userData;
      const drift = ((d.x + t * d.spd + 200) % 400) - 200;
      sp.position.set(camera.position.x + drift, d.y, camera.position.z + d.z);
      sp.scale.set(d.w, d.w * 0.55, 1);
      sp.material.opacity = Math.min(1, p.clouds) * 0.95;
      sp.visible = d.i < Math.round(26 * Math.min(1, p.clouds / 1.5));
    }
    this.scene.fog.color.setRGB(fogColor[0], fogColor[1], fogColor[2]);
    this.scene.fog.density = fogDensity;

    const depthAtt = camUnder ? 1 - Math.min(0.65, -camera.position.y / 40) : 1;
    this.hemi.color.setRGB(p.shallow[0], p.shallow[1], p.shallow[2]).lerp(new THREE.Color(1, 1, 1), flat ? 0.9 : 0.5);
    this.hemi.groundColor.setRGB(p.deep[0], p.deep[1], p.deep[2]).lerp(new THREE.Color(1, 1, 1), flat ? 0.7 : 0);
    this.hemi.intensity = flat ? 2.2 : (0.45 + p.amb) * depthAtt * 1.4;
    this.sun.color.setRGB(p.sun[0], p.sun[1], p.sun[2]);
    this.sun.intensity = flat ? 0.5 : p.sunI * 1.8 * depthAtt;
    this.sun.position.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).multiplyScalar(40);
    this.fill.intensity = 0.3 * depthAtt;

    v3(this.bgMat.uniforms.uDeep, p.deep); v3(this.bgMat.uniforms.uShallow, p.shallow); v3(this.bgMat.uniforms.uSky, p.sky); v3(this.bgMat.uniforms.uHorizon, p.horizon); v3(this.bgMat.uniforms.uFog, p.fog);
    this.bgMat.uniforms.uCamY.value = camera.position.y;
    this.bg.position.copy(camera.position);

    const sm = this.surfMat.uniforms;
    sm.uTime.value = t; sm.uAmp.value = p.waveAmp; v3(sm.uTint, p.tint); v3(sm.uSky, p.sky); v3(sm.uHorizon, p.horizon); v3(sm.uSurface, p.surface); v3(sm.uSun, p.sun);
    sm.uSunDir.value.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]); v3(sm.uFogColor, fogColor); sm.uFogDensity.value = fogDensity; sm.uCamY.value = camera.position.y; sm.uSunI.value = p.sunI;
    this.surface.position.set(camera.position.x, 0, camera.position.z);

    const fm = this.floorMat.uniforms;
    fm.uTime.value = t; v3(fm.uColor, p.sandColor); fm.uCaustics.value = p.caustics; v3(fm.uSun, p.sun); fm.uSunDir.value.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]);
    fm.uAmb.value = p.amb; v3(fm.uFogColor, fogColor); fm.uFogDensity.value = fogDensity; fm.uBeach.value = p.beach; fm.uFloorY.value = p.floorY; fm.uSunI.value = p.sunI;
    this.floor.position.y = p.floorY;
    fm.uCaustics.value = p.land >= 0.5 || flat ? 0 : p.caustics;

    // seaweed / rocks / coral placement (depends on floor height & density)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    const decoScale = p.land >= 0.5 ? 0 : 1;
    const weedCount = Math.min(this.weedData.length, Math.round(this.weedData.length * Math.min(1, p.seaweed / 2) * decoScale));
    const rockCount = Math.min(this.rockData.length, Math.round(this.rockData.length * Math.min(1, p.rocks / 2) * (p.land >= 0.5 ? 0.4 : 1)));
    const coralCount = Math.min(this.coralData.length, Math.round(this.coralData.length * Math.min(1, p.coral / 2) * decoScale));
    const decoKey = `${weedCount}|${rockCount}|${coralCount}|${p.floorY}|${p.beach}|${p.land}`;
    if (this.decoKeyApplied !== decoKey) {
      this.decoKeyApplied = decoKey;
      for (let i = 0; i < weedCount; i++) {
        const d = this.weedData[i];
        pos.set(d.x, p.floorY + this.floorHeight(d.x, d.z) + (p.beach ? Math.max(0, (d.x - 12) * 0.32) : 0) - 0.1, d.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.rot);
        s.set(d.w, d.h, 1);
        m.compose(pos, q, s);
        this.weed.setMatrixAt(i, m);
      }
      this.weed.count = weedCount;
      this.weed.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < rockCount; i++) {
        const d = this.rockData[i];
        pos.set(d.x, p.floorY + this.floorHeight(d.x, d.z) + (p.beach ? Math.max(0, (d.x - 12) * 0.32) : 0) - d.s * 0.3, d.z);
        q.setFromEuler(new THREE.Euler(d.rx, d.ry, 0));
        s.set(d.s, d.s * d.sy, d.s);
        m.compose(pos, q, s);
        this.rocks.setMatrixAt(i, m);
      }
      this.rocks.count = rockCount;
      this.rocks.instanceMatrix.needsUpdate = true;
      const per = this.corals.map(() => 0);
      for (let i = 0; i < coralCount; i++) {
        const d = this.coralData[i];
        const k = i % this.corals.length;
        const mesh = this.corals[k];
        pos.set(d.x, p.floorY + this.floorHeight(d.x, d.z) + (p.beach ? Math.max(0, (d.x - 12) * 0.32) : 0) + d.s * 0.5, d.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.ry);
        s.set(d.s, d.s, d.s);
        m.compose(pos, q, s);
        mesh.setMatrixAt(per[k], m);
        mesh.setColorAt(per[k], d.color);
        per[k]++;
      }
      this.corals.forEach((c, k) => { c.count = per[k]; c.instanceMatrix.needsUpdate = true; if (c.instanceColor) c.instanceColor.needsUpdate = true; });
    }
    // Nothing tall between the lens and what it looks at: blades close to the
    // camera's line of sight shrink away (a pure function of camera and time,
    // so every chunk agrees).  Anything the script places is left alone.
    {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const wc = this.weed.count;
      const key = `${cx.toFixed(3)}|${cy.toFixed(3)}|${cz.toFixed(3)}|${dir.x.toFixed(4)}|${dir.z.toFixed(4)}|${wc}|${p.floorY}`;
      if (this.occlusionKey !== key) {
        this.occlusionKey = key;
        for (let i = 0; i < wc; i++) {
          const d = this.weedData[i];
          const by = p.floorY + this.floorHeight(d.x, d.z) + (p.beach ? Math.max(0, (d.x - 12) * 0.32) : 0) - 0.1;
          const vx = d.x - cx, vy = by + d.h * 0.5 - cy, vz = d.z - cz;
          const along = vx * dir.x + vy * dir.y + vz * dir.z;
          let k = 1;
          if (along > -0.5 && along < 9) {
            const px = vx - dir.x * along, py = vy - dir.y * along, pz = vz - dir.z * along;
            const perp = Math.hypot(px, py, pz);
            const clear = 0.7 + Math.max(0, along) * 0.12;         // a cone that widens with distance
            k = perp >= clear ? 1 : Math.max(0, perp / clear);
            k = k * k * (3 - 2 * k);
          }
          pos.set(d.x, by, d.z);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.rot);
          s.set(d.w * Math.max(0.001, k), d.h * Math.max(0.001, k), 1);
          m.compose(pos, q, s);
          this.weed.setMatrixAt(i, m);
        }
        this.weed.instanceMatrix.needsUpdate = true;
      }
    }
    this.weedMat.uniforms.uTime.value = t; v3(this.weedMat.uniforms.uFogColor, fogColor); this.weedMat.uniforms.uFogDensity.value = fogDensity; this.weedMat.uniforms.uSunI.value = p.sunI; this.weedMat.uniforms.uAmb.value = p.amb;

    const bm = this.bubbleMat.uniforms;
    bm.uTime.value = t; bm.uFloorY.value = p.floorY; bm.uCount.value = Math.round(900 * Math.min(1, p.bubbles / 2)); v3(bm.uFogColor, fogColor); bm.uFogDensity.value = fogDensity; bm.uScale.value = viewportHeight;
    this.bubbles.position.set(Math.round(camera.position.x / 40) * 40, 0, Math.round(camera.position.z / 40) * 40);
    this.bubbles.visible = camUnder && p.bubbles > 0 && !flat;

    const pm = this.plankMat.uniforms;
    pm.uTime.value = t; pm.uCam.value.copy(camera.position); pm.uDensity.value = Math.min(1, p.plankton / 2); v3(pm.uFogColor, fogColor); pm.uFogDensity.value = fogDensity; pm.uScale.value = viewportHeight; pm.uFloorY.value = p.floorY;
    this.plankton.visible = camUnder && p.plankton > 0 && !flat;

    this.rayMat.uniforms.uTime.value = t;
    this.rayMat.uniforms.uStrength.value = p.rays * Math.max(0, 1 - (-camera.position.y) / 45);
    this.rayMat.uniforms.uColor.value.set(p.surface[0], p.surface[1], p.surface[2]);
    this.rays.visible = camUnder && p.rays > 0 && !flat;
    this.rays.position.set(camera.position.x, 0, camera.position.z);
    for (const ray of this.rays.children) {
      const d = ray.userData;
      const drift = Math.sin(t * d.spd + d.phase) * 1.5;
      ray.position.set(d.x + drift, 0.3, d.z);
      ray.scale.set(d.w, d.h, 1);
      // face the camera around the y axis, with a slight tilt in the sun direction
      const dx = camera.position.x - ray.position.x - camera.position.x, dz = camera.position.z - ray.position.z - camera.position.z;
      ray.rotation.set(0, Math.atan2(dx, dz), d.tilt * 0.3);
    }
  }
}
