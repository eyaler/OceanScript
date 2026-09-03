import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/parser.js';
import { compile } from '../src/compile.js';

const build = (body, cast = '- a: fish, size 1, speed 2\n- b: whale, size 4\n') => compile(parseScript(`# Cast\n${cast}\n# Scene: S\n${body}`));

test('sequencing, non-blocking and sync', () => {
  const tl = build(`@a appears at (0, -3, 0)
@a swims to (4, -3, 0)
@a swims to (8, -3, 0) over 1s &
@b appears at (0, -5, 0)
@b waits 3s
- sync
@a waits 1s
`);
  const segs = tl.actors.a.segments;
  assert.equal(segs[0].type, 'place');
  assert.equal(segs[1].t0, 0); assert.equal(segs[1].t1, 2);        // 4m at 2 m/s
  assert.equal(segs[2].t0, 2); assert.equal(segs[2].t1, 3);        // explicit 1s, non-blocking
  assert.equal(tl.actors.b.segments[0].t0, 2);                     // starts when the & line starts
  assert.equal(tl.meta.duration, 2 + 3 + 1 + 1.5);                 // wait 3 (sync) + wait 1 + tail
});

test('default durations use distance and speed, dialog blocks', () => {
  const tl = build(`@a appears at (0, -3, 0)
**A:** Hi
@a swims to (10, -3, 0)
`);
  const sub = tl.subtitles[0];
  assert.equal(sub.speaker, 'A'); assert.equal(sub.actor, 'a'); assert.equal(sub.kind, 'dialog');
  assert.ok(sub.t1 >= 1.6);
  assert.equal(tl.actors.a.segments[1].t0, sub.t1);
  assert.equal(tl.actors.a.segments[1].t1 - tl.actors.a.segments[1].t0, 5);
});

test('scenes hide actors that do not act in them', () => {
  const tl = compile(parseScript(`# Cast
- a: fish
- b: fish
# Scene: one
@a appears at (0, -3, 0)
@b appears at (2, -3, 0)
@a waits 1s
# Scene: two
> time: night
@a swims left 2 over 1s
`));
  const vb = tl.actors.b.visibility;
  assert.deepEqual(vb, [{ t: 0, visible: true }, { t: 1, visible: false }]);
  const va = tl.actors.a.visibility;
  assert.deepEqual(va, [{ t: 0, visible: true }, { t: 1, visible: false }, { t: 1, visible: true }]);
  assert.equal(tl.env.length, 2);
  assert.equal(tl.env[1].transition, 0);                           // instant at a scene start
  assert.equal(tl.markers.filter((m) => m.kind === 'scene').length, 2);
});

test('camera defaults, follow and undeclared actors', () => {
  const tl = build(`@c swims to (1, -3, 0) over 1s
@camera follows @c from behind distance 3 &
@camera shakes for 0.5s
`);
  assert.ok(tl.warnings.some((w) => /not declared/.test(w)));
  assert.equal(tl.cast.c.kind, 'fish');
  assert.equal(tl.camera.segments[0].type, 'place');               // default camera
  const follow = tl.camera.segments.find((s) => s.type === 'follow');
  assert.equal(follow.actor, 'c'); assert.equal(follow.frame, 'local'); assert.deepEqual(follow.offset.map(Math.round), [0, 1, -3]);
  assert.equal(tl.camera.shakes[0].t1 - tl.camera.shakes[0].t0, 0.5);
});

test('carry, orbit, effects and overlays', () => {
  const tl = build(`@a appears at (0, -3, 0)
@b appears at (5, -5, 0)
@b carries @a
@a swims around @b 2 times over 4s
@a glows for 1s &
- title "T" for 2s
- fade out 1s
`);
  const follow = tl.actors.a.segments.find((s) => s.type === 'follow');
  assert.equal(follow.actor, 'b'); assert.equal(follow.attached, true);
  const orbit = tl.actors.a.segments.find((s) => s.type === 'orbit');
  assert.equal(orbit.loops, 2); assert.equal(orbit.center.actor, 'b');
  assert.equal(tl.actors.a.effects[0].type, 'glow');
  assert.deepEqual(tl.overlays.filter((o) => !o.hold).map((o) => o.type), ['title', 'fade']);
  assert.equal(tl.overlays[1].t0, orbit.t1 + 2);
});
