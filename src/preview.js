// Live preview: serves the renderer, recompiles the script when it changes.
import { statSync } from 'node:fs';
import { loadTimeline } from './load.js';
import { startServer } from './server.js';
import { prepareAssets } from './assets.js';

export async function preview(file, args = {}) {
  let cached = null, cachedMtime = 0, cachedError = null;
  const get = () => {
    const mtime = statSync(file).mtimeMs;
    if (!cached || mtime !== cachedMtime) {
      try {
        cached = loadTimeline(file, { fps: args.fps, width: args.width, height: args.height, lang: args.lang });
        cached.meta.burnSubtitles = true;
        prepareAssets(cached);
        cachedError = null;
        for (const w of cached.warnings) console.error('warning:', w);
        console.error(`compiled ${file}: ${cached.meta.duration.toFixed(2)}s`);
      } catch (err) {
        cachedError = String(err.message || err);
        console.error('compile error:', cachedError);
        if (!cached) throw err;
        cached.warnings = [`COMPILE ERROR: ${cachedError}`];
      }
      cachedMtime = mtime;
    }
    return cached;
  };
  get();
  const { url } = await startServer({
    port: Number(args.port || 8765),
    dynamic: {
      '/timeline.json': () => ({ body: JSON.stringify(get()) }),
      '/timeline.version': () => { get(); return { body: `${cachedMtime}:${cachedError ? 'err' : 'ok'}`, type: 'text/plain' }; },
    },
    extraRoots: { '/script/': get().meta.scriptDir, '/cache/': (await import('node:path')).resolve('out/.asset-cache') },
  });
  console.error(`preview: ${url}/   (space = play/pause, arrows = step, shift+arrows = 5s)`);
  console.error('edit the script and the preview reloads automatically');
  await new Promise(() => {});
}
