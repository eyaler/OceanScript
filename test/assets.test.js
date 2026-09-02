import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from '../src/parser.js';
import { compile } from '../src/compile.js';

const SRC = `---
font: assets/f.ttf
---
# Cast
- cop: sprite, image "assets/cop.svg", size 2
  he: label "שוטר"
- boat: model "assets/boat.glb" animation "Rock"
- pelican: pelican
- whale: whale
- caspion: fish
# Scene: S
> backdrop: assets/city.svg, style: flat, clouds: many
- music "assets/theme.wav" volume 0.3
@whale swallows @caspion
@whale waits 1s
@whale spits out @caspion
@pelican flies to (10, 5, 0) over 3s
@pelican carries @caspion
@cop appears at (0, 0, 0)
@boat appears at (1, 0, 0)
- sound "assets/splash.wav" volume 0.5 from 2s
- image "assets/book.png" for 2s
  he: כותרת
- clip "assets/making.mp4" for 3s from 10s
- credits "A | B | C" for 4s
- music stop 1s
- fade out to white 1s
`;

test('new kinds, assets, swallow/spit, media directives', () => {
  const tl = compile(parseScript(SRC));
  assert.equal(tl.cast.cop.kind, 'sprite'); assert.equal(tl.cast.cop.image, 'assets/cop.svg'); assert.equal(tl.cast.cop.labels.he, 'שוטר');
  assert.equal(tl.cast.boat.kind, 'model'); assert.equal(tl.cast.boat.animation, 'Rock');
  assert.equal(tl.cast.pelican.kind, 'pelican');
  const c = tl.actors.caspion;
  assert.equal(c.segments[1].type, 'follow'); assert.equal(c.segments[1].actor, 'whale'); assert.equal(c.segments[1].attached, true);
  assert.deepEqual(c.visibility.map((v) => v.visible), [true, false, true]);      // swallowed, then spat out
  assert.equal(c.segments[2].type, 'to'); assert.ok(c.segments[2].arc > 0);
  const carry = c.segments.find((s) => s.type === 'follow' && s.actor === 'pelican');
  assert.ok(carry && carry.offset[2] > 0.5);                                         // held in the beak
  assert.deepEqual(tl.env[0].settings, { backdrop: 'assets/city.svg', style: 'flat', clouds: 'many' });
  assert.equal(tl.music.length, 1); assert.equal(tl.music[0].volume, 0.3); assert.equal(tl.music[0].fadeOut, 1);
  assert.equal(tl.sounds[0].volume, 0.5); assert.equal(tl.sounds[0].offset, 2);
  const types = tl.overlays.map((o) => o.type);
  assert.deepEqual(types, ['image', 'clip', 'credits', 'fade']);
  assert.equal(tl.overlays[1].offset, 10); assert.equal(tl.overlays[3].color, 'white');
  assert.deepEqual(tl.overlays[2].lines, ['A', 'B', 'C']);
  assert.equal(compile(parseScript(SRC), { lang: 'he' }).overlays[0].caption, 'כותרת');
  assert.deepEqual([...tl.assets].sort(), ['assets/boat.glb', 'assets/book.png', 'assets/city.svg', 'assets/cop.svg', 'assets/f.ttf', 'assets/making.mp4']);
  assert.equal(tl.music[0].t1, tl.overlays[2].t1);                                  // music stops at the credits' end
});
