import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseScript } from './parser.js';
import { compile } from './compile.js';

// Reads a markdown screenplay and compiles it into a timeline.
export function loadTimeline(file, opts = {}) {
  const src = readFileSync(file, 'utf8');
  const script = parseScript(src, { filename: file });
  const timeline = compile(script, opts);
  timeline.meta.scriptDir = path.dirname(path.resolve(file));
  timeline.meta.scriptName = path.basename(file, path.extname(file));
  return timeline;
}
