import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('headless render produces frames and a video', { skip: process.env.OCEANSCRIPT_SKIP_RENDER_TEST === '1', timeout: 180000 }, async () => {
  const { render } = await import('../src/render.js');
  const dir = mkdtempSync(path.join(process.env.SCRATCHPAD || tmpdir(), 'oceanscript-'));
  const out = path.join(dir, 'test.mp4');
  await render('examples/caspion.md', { start: 3, end: 3.1, scale: 0.25, frames: path.join(dir, 'frames'), out });
  const frames = readdirSync(path.join(dir, 'frames'));
  assert.equal(frames.length, 3);
  assert.ok(existsSync(out) && statSync(out).size > 1000);
});
