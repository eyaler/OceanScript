import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/parser.js';
import { compile } from '../src/compile.js';
import { TimelineEvaluator } from '../renderer/timeline.js';

const near = (a, b, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const build = (body) => new TimelineEvaluator(compile(parseScript(`# Cast\n- a: fish, size 1, speed 2\n- b: whale, size 4, speed 2\n# Scene: S\n${body}`)));

test('positions interpolate between segments and stay put afterwards', () => {
  const ev = build(`@a appears at (0, -3, 0)
@a swims to (4, -3, 0) over 2s linear
- wait 1s
@a swims to (4, -7, 0) over 2s linear
`);
  ev.beginFrame();
  assert.ok(near(ev.pos('a', 0), [0, -3, 0]));
  assert.ok(near(ev.pos('a', 1), [2, -3, 0]));
  assert.ok(near(ev.pos('a', 2.5), [4, -3, 0]));
  assert.ok(near(ev.pos('a', 4), [4, -5, 0]));
  assert.ok(near(ev.pos('a', 100), [4, -7, 0]));
  assert.ok(near(ev.heading('a', 1), [1, 0, 0]));
  assert.ok(near(ev.heading('a', 4.5), [0, -1, 0], 0.05));
  assert.ok(near(ev.heading('a', 2.5), [1, 0, 0], 0.05));   // keeps the last heading when still
});

test('follow tracks the other actor, near stops short, orbit circles', () => {
  const ev = build(`@a appears at (0, -3, 0)
@b appears at (10, -3, 0)
@b swims to (10, -3, 10) over 5s linear &
@a follows @b (0, 6, 0) &
- wait 5s
@a stops
@a swims near @b over 1s
@a swims around @b radius 3 1 time over 4s linear
`);
  ev.beginFrame();
  const b = ev.pos('b', 2.5);
  const a = ev.pos('a', 2.5);
  assert.ok(near(a, [b[0], b[1] + 6, b[2]]));
  const stop = ev.pos('a', 6.1);
  const bEnd = ev.pos('b', 6.1);
  const dist = Math.hypot(stop[0] - bEnd[0], stop[1] - bEnd[1], stop[2] - bEnd[2]);
  assert.ok(dist > 4 && dist < 5, `stopped ${dist} from the whale`);   // stopDistance = 4*0.9 + 1*0.9 + 0.5
  const c1 = ev.pos('a', 8.1), c2 = ev.pos('a', 9.1);
  const r1 = Math.hypot(c1[0] - bEnd[0], c1[2] - bEnd[2]);
  const r2 = Math.hypot(c2[0] - bEnd[0], c2[2] - bEnd[2]);
  assert.ok(Math.abs(r2 - 3) < 0.3, `orbit radius ${r2}`);
  assert.ok(r1 > 0);
});

test('visibility, emotions, scale and camera', () => {
  const ev = build(`@a appears at (0, -3, 0)
@a feels scared
@a waits 1s
@a hides
@a waits 1s
@a shows
@a grows to size 2 over 1s
@camera cuts to (0, 0, 10) looking at @a
@camera zooms to 30 over 1s
`);
  ev.beginFrame();
  assert.equal(ev.visible('a', 0.5), true);
  assert.equal(ev.visible('a', 1.5), false);
  assert.equal(ev.visible('a', 2.5), true);
  assert.equal(ev.emotion('a', 0.5), 'scared');
  assert.equal(ev.emotion('a', 20), 'neutral');            // scared fades after a while
  assert.ok(Math.abs(ev.scale('a', 3) - 2) < 1e-6);
  assert.ok(near(ev.cameraPos(2.5), [0, -2, 14]));            // default camera until the cut at t=3
  assert.ok(near(ev.cameraPos(3.5), [0, 0, 10]));
  assert.ok(near(ev.cameraLook(3.5), [0, -3 + 0.15, 0]));
  assert.equal(ev.cameraFov(3), 50);
  assert.equal(ev.cameraFov(4.5), 30);
});
