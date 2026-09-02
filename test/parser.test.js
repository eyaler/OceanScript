import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, parseCastLine, parseActorAction, parseDirective, parseTime, takePos, takeDuration } from '../src/parser.js';

test('time and position helpers', () => {
  assert.equal(parseTime('3s'), 3);
  assert.equal(parseTime('500ms'), 0.5);
  assert.equal(parseTime('1.5 min'), 90);
  assert.deepEqual(takePos('swims to (1, -2.5, 3) over 2s').pos, [1, -2.5, 3]);
  assert.deepEqual(takePos('at (4, 5)').pos, [4, 5, 0]);
  assert.equal(takeDuration('swims left over 2.5s').duration, 2.5);
  assert.equal(takeDuration('waits (3s)').duration, 3);
  assert.equal(takeDuration('nothing').duration, null);
});

test('cast lines', () => {
  const a = parseCastLine('caspion: fish, silver, size 0.6, label "Caspion"', 1);
  assert.equal(a.name, 'caspion'); assert.equal(a.kind, 'fish'); assert.equal(a.color, 'silver'); assert.equal(a.size, 0.6); assert.equal(a.label, 'Caspion');
  const b = parseCastLine('whaley (Little Whale): baby whale, blue', 2);
  assert.equal(b.kind, 'whale'); assert.equal(b.sizeHint, 'baby'); assert.equal(b.label, 'Little Whale'); assert.equal(b.color, 'blue');
  const c = parseCastLine('friends: school, #ffcc00, count 20', 3);
  assert.equal(c.kind, 'school'); assert.equal(c.color, '#ffcc00'); assert.equal(c.count, 20);
  assert.throws(() => parseCastLine('nonsense', 4));
});

test('actor actions', () => {
  let a = parseActorAction('fish', 'swims to (1, 2, 3) over 4s', 1);
  assert.equal(a.verb, 'move'); assert.deepEqual(a.target.pos, [1, 2, 3]); assert.equal(a.duration, 4); assert.equal(a.nonBlocking, false);
  a = parseActorAction('fish', 'swims near @whale over 2s &', 1);
  assert.equal(a.target.actor, 'whale'); assert.equal(a.target.near, true); assert.equal(a.nonBlocking, true);
  a = parseActorAction('fish', 'swims left 5', 1);
  assert.equal(a.direction, 'left'); assert.equal(a.amount, 5);
  a = parseActorAction('fish', 'dives to depth 6', 1);
  assert.equal(a.direction, 'down'); assert.equal(a.absoluteDepth, -6);
  a = parseActorAction('fish', 'surfaces over 3s', 1);
  assert.equal(a.absoluteDepth, -0.3);
  a = parseActorAction('friends', 'swims around @caspion 2 times over 8s', 1);
  assert.equal(a.verb, 'orbit'); assert.equal(a.count, 2); assert.equal(a.duration, 8);
  a = parseActorAction('friends', 'circles @caspion once', 1);
  assert.equal(a.count, 1);
  a = parseActorAction('fish', 'enters from right to (10, -6, 0) over 3s', 1);
  assert.equal(a.verb, 'enter'); assert.equal(a.direction, 'right'); assert.deepEqual(a.target.pos, [10, -6, 0]);
  a = parseActorAction('fish', 'exits left', 1);
  assert.equal(a.verb, 'exit'); assert.equal(a.direction, 'left');
  a = parseActorAction('fish', 'feels very sad', 1);
  assert.equal(a.verb, 'emote'); assert.equal(a.emotion, 'sad');
  a = parseActorAction('fish', 'is afraid', 1);
  assert.equal(a.emotion, 'scared');
  a = parseActorAction('fish', 'looks at the camera', 1);
  assert.equal(a.verb, 'look'); assert.equal(a.target.actor, 'camera');
  a = parseActorAction('fish', 'follows @whale beside', 1);
  assert.equal(a.verb, 'follow'); assert.equal(a.view, 'side');
  a = parseActorAction('fish', 'spins 3 times over 2s', 1);
  assert.equal(a.verb, 'spin'); assert.equal(a.count, 3);
  a = parseActorAction('fish', 'says "Hello there!" to @whale', 1);
  assert.equal(a.verb, 'say'); assert.equal(a.quote, 'Hello there!'); assert.equal(a.target.actor, 'whale');
  a = parseActorAction('jelly', 'carries @caspion', 1);
  assert.equal(a.verb, 'carry'); assert.equal(a.target.actor, 'caspion');
  a = parseActorAction('fish', 'grows to size 2 over 1s', 1);
  assert.equal(a.verb, 'scale'); assert.equal(a.size, 2);
  assert.throws(() => parseActorAction('fish', 'teleports to (1,2,3)', 1), /unknown action verb/);
  assert.throws(() => parseActorAction('fish', 'swims', 1), /move needs a target/);
});

test('camera actions', () => {
  let a = parseActorAction('camera', 'cuts to (0, -2, 12) looking at @whale', 1);
  assert.equal(a.actor, 'camera'); assert.equal(a.verb, 'cut'); assert.deepEqual(a.target.pos, [0, -2, 12]); assert.equal(a.lookTarget.actor, 'whale');
  a = parseActorAction('camera', 'follows @caspion from behind distance 3 height 1 &', 1);
  assert.equal(a.verb, 'follow'); assert.equal(a.view, 'behind'); assert.equal(a.distance, 3); assert.equal(a.height, 1); assert.equal(a.nonBlocking, true);
  a = parseActorAction('camera', 'orbits @whale distance 12 over 10s', 1);
  assert.equal(a.verb, 'orbit'); assert.equal(a.distance, 12); assert.equal(a.duration, 10);
  a = parseActorAction('camera', 'zooms to 30 over 2s', 1);
  assert.equal(a.verb, 'zoom'); assert.equal(a.fov, 30);
  a = parseActorAction('camera', 'shakes for 1s strength 2', 1);
  assert.equal(a.verb, 'shake'); assert.equal(a.strength, 2);
});

test('directives', () => {
  assert.deepEqual([parseDirective('wait 2s', 1).name, parseDirective('wait 2s', 1).duration], ['wait', 2]);
  const t = parseDirective('title "Chapter One" for 4s', 1);
  assert.equal(t.name, 'title'); assert.equal(t.quote, 'Chapter One'); assert.equal(t.duration, 4);
  assert.equal(parseDirective('fade in 1.5s', 1).name, 'fadeIn');
  assert.equal(parseDirective('fade out', 1).name, 'fadeOut');
  assert.equal(parseDirective('sync', 1).name, 'sync');
  assert.equal(parseDirective('caption "hi" for 2s &', 1).nonBlocking, true);
  assert.throws(() => parseDirective('explode', 1));
});

test('whole script', () => {
  const src = `---
title: Test
fps: 12
---
# Cast
- a: fish, red
- b: whale

# Scene: One
> time: night, waves: storm
<!-- a comment
   spanning lines -->
@a appears at (0, -3, 0)
@camera cuts to (0, -2, 10) looking at @a
**A:** Hello there
@a: Second line (2s) &
> Narrator: Some narration.
> Plain narration &
- wait 1s
_stage direction_
## Beat: two
@b enters from left
---
- fade out 1s
`;
  const s = parseScript(src);
  assert.equal(s.meta.title, 'Test'); assert.equal(s.meta.fps, 12);
  assert.equal(s.cast.length, 2);
  const types = s.statements.map((x) => x.type);
  assert.deepEqual(types, ['scene', 'env', 'action', 'action', 'dialog', 'dialog', 'dialog', 'dialog', 'directive', 'note', 'beat', 'action', 'directive', 'directive']);
  assert.deepEqual(s.statements[1].settings, { time: 'night', waves: 'storm' });
  const d = s.statements.filter((x) => x.type === 'dialog');
  assert.equal(d[0].speaker, 'A'); assert.equal(d[0].text, 'Hello there');
  assert.equal(d[1].speaker, 'a'); assert.equal(d[1].duration, 2); assert.equal(d[1].nonBlocking, true);
  assert.equal(d[2].narration, true); assert.equal(d[2].speaker, 'Narrator');
  assert.equal(d[3].nonBlocking, true); assert.equal(d[3].text, 'Plain narration');
  assert.equal(s.statements[12].name, 'sync');
  assert.equal(s.warnings.length, 0);
});
