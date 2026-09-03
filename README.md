# OceanScript

Render 3D underwater animations – in the spirit of the 2004 Israeli film
*Caspion the Little Fish* – from a plain markdown screenplay.

```
examples/caspion.md  ──parse──▶  timeline.json  ──render──▶  caspion.mp4
   (markdown script)              (keyframed tracks)          (headless Three.js + ffmpeg)
```

You write a script like this:

```markdown
# Cast
- caspion: fish, silver, size 0.6
- whaley (Little Whale): baby whale, blue

# Scene: The Crying Whale
> time: day, water: blue, depth: medium, floor: sand

@whaley appears at (4, -6, -2)
@camera cuts to (-4, -4, 9) looking at @whaley
@whaley feels sad
@whaley cries for 4s &
@caspion enters from left to (-1, -5, 1) over 3s
**Caspion:** Why are you crying, little whale?
**Little Whale:** I lost my mother in the storm...
@camera orbits @whaley distance 11 over 10s &
@caspion swims around @whaley 2 times over 8s
```

and get a video with a procedurally animated ocean (waves, caustics, light rays,
bubbles, seaweed, coral), cartoon sea creatures that swim, turn, emote and talk,
a scripted camera, per-character text-to-speech voices and a soft subtitle
track.  Translations live next to the source lines (`he: ...`), and because
timing always comes from the source line, every language renders identical
frames: `--lang he` gives Hebrew title cards, subtitles and voices on the same
video.

The full language is described in [docs/SCRIPT_FORMAT.md](docs/SCRIPT_FORMAT.md).
Two examples ship with the repo: `examples/caspion.md` (a five-scene retelling,
English and Hebrew) and `examples/great-journey/great-journey.md` (every asset
type: 2D backdrops and sprites, glTF models, illustration cards, video clips,
music, sound effects, custom fonts, credits, a pelican flight and a whale
swallowing the hero).

## Install

```bash
npm install                 # three + playwright
pip install imageio-ffmpeg  # optional: a static ffmpeg with H.264 (or use any ffmpeg on $PATH)
```

Rendering uses Playwright's Chromium.  If it is not installed yet run
`npx playwright install chromium`.  No GPU is needed – frames are rendered
with SwiftShader when there is no hardware acceleration.

## Use

```bash
# validate the script and print the scene timings
node bin/oceanscript.js check examples/caspion.md

# live preview in a browser (recompiles when you save the script)
node bin/oceanscript.js preview examples/caspion.md      # http://127.0.0.1:8765/

# render the video (soft subtitles + voice track in the script's language)
node bin/oceanscript.js render examples/caspion.md --jobs 3 -o out/caspion.mp4

# the same frames with Hebrew title card, subtitles and voices
node bin/oceanscript.js render examples/caspion.md --jobs 3 --lang he -o out/caspion.he.mp4
# ...or without re-rendering, reusing the frames of an existing render
# (title cards, image captions and credits stay in the rendered language)
node bin/oceanscript.js mux examples/caspion.md --video out/caspion.mp4 --lang he -o out/caspion.he.mp4

# prove two renders share the same frames (per-frame PSNR; "inf" = identical)
scripts/compare-renders.sh out/caspion.en.mp4 out/caspion.he.mp4

# quick low-res render of one part
node bin/oceanscript.js render examples/caspion.md --scale 0.5 --start 20 --end 30

# dump the compiled timeline
node bin/oceanscript.js parse examples/caspion.md -o out/caspion.json
```

Render options: `--fps`, `--width/--height`, `--scale`, `--start/--end` (seconds),
`--jobs N` (parallel browser processes; frames are deterministic so chunks are
concatenated losslessly), `--lang code`, `--burn-subtitles`, `--no-voice`,
`--tts edge|gtts|none`, `--timing audio`, `--music file`, `--audio file`,
`--frames dir` (keep PNGs), `--no-video`, `--crf`, `--headed`.

Voices need `pip install edge-tts` (Microsoft neural voices, Hebrew included) or
`pip install gTTS` as a fallback; `--tts none` renders silent video.  Each
render also writes `<out>.srt`, `<out>.vtt` and `<out>.voice.json` (clip
timings) next to the video.
Set `$FFMPEG` to use a specific ffmpeg binary.

## How the pipeline works

1. **`src/parser.js`** – reads the markdown line by line into statements: cast
   entries, scenes, environment settings, actor/camera actions, dialog and
   directives.  Verbs are matched with a synonym lexicon (`swims to`, `moves to`,
   `goes to`, `darts to` ... all mean *move*), and arguments (positions, `@refs`,
   durations, counts, `distance N` ...) are extracted from the rest of the line.
2. **`src/compile.js`** – walks the statements with a time cursor and emits a
   **timeline**: per-actor position *segments* (`place`, `to`, `orbit`,
   `follow`, `hold`), visibility, looks, emotions, effects and scale tracks; the
   camera's position/look/fov/shake tracks; environment entries; subtitles;
   overlays.  Blocking lines advance the cursor, `&` lines don't, scenes
   synchronise.  Default durations come from distance ÷ creature speed.
3. **`renderer/timeline.js`** – evaluates the timeline as a *pure function of
   time* (memoised per frame).  Segments are resolved lazily and recursively: a
   `to` segment starts wherever the previous segment left the actor, `follow`
   and `swims near @x` read the other actor's position at the same instant, and
   headings are derived from velocity with smoothed turns.  Nothing depends on
   frame order, so any frame can be rendered in isolation and renders are
   deterministic.
4. **`renderer/ocean.js`** – the environment: Gerstner-wave surface shader
   (viewed from above or below), seabed with procedural caustics, instanced
   seaweed/rocks/coral, bubble and plankton particles, additive light rays,
   sky/water background and lighting – all driven by uniforms from the resolved
   scene settings, cross-faded between scenes.
5. **`renderer/actors.js`** – procedural rigs for each creature kind with
   speed-driven swimming, emotion modifiers (tail speed, pitch, eye size,
   trembling), talking mouths and effects (spin, wiggle, glow, bubbles, tears,
   spout).
6. **`src/render.js`** – starts a local static server, opens the renderer page in
   headless Chromium, calls `window.__seek(t)` for every frame, screenshots the
   page (WebGL canvas + HTML title cards) and pipes PNGs into ffmpeg
   (`libx264` for `.mp4`, VP9/VP8 for `.webm`).  A failed capture relaunches the
   browser and retries the same frame, and `--jobs N` renders frame ranges in
   parallel processes and concatenates them.
7. **`src/tts.js`, `src/subtitles.js`, `src/mux.js`** – synthesise one clip per
   spoken line (cached by text + voice), mix them at their timeline positions
   (with optional music), write SRT/VTT, and mux audio plus a soft subtitle
   track onto the video-only render.  `oceanscript mux` runs just this step on
   an existing render for another language.
   `src/preview.js` serves the same page with a scrubber and hot reload.

## Extending

* **New verb** – add a regex to `ACTOR_VERBS`/`CAMERA_VERBS` in `src/parser.js`,
  handle its arguments in `parseActorAction`, and emit tracks for it in
  `src/compile.js` (`compileActor`/`compileCamera`).  The evaluator in
  `renderer/timeline.js` already understands `place/to/orbit/follow/hold`
  segments and generic effects, so most verbs need no renderer changes.
* **Your own artwork** – `sprite` actors take any PNG/SVG, `model` actors any
  glTF/GLB, `backdrop:` any image, `- clip` any video: no code needed.
* **New creature** – add a `buildX()` rig in `renderer/actors.js` returning
  `{ group, inner, animate(t, state) }`, register it in `createActorRig`, and add
  the kind (with default size/speed) to `KIND_DEFAULTS` in `src/compile.js` and
  `KINDS` in `src/parser.js`.
* **New setting** – add the key to `ENV_KEYS` in `src/parser.js` and resolve it in
  `resolveEnv()` in `renderer/ocean.js`.
* **New language** – add `xx: ...` lines under the text lines and cast entries;
  default voices per language live in `DEFAULT_VOICES` in `src/tts.js`.
* **New TTS engine** – add a case to `synthesize()` in `src/tts.js`.

## Music

`examples/music/` holds six public-domain recordings (pre-1923 78 rpm
transfers from the Internet Archive, see `examples/music/CREDITS.md`) used by
the example: Offenbach's Barcarolle, Solveig's Song, In the Hall of the
Mountain King, The Swan, Morning Mood and the Blue Danube.  Scene music is
ducked automatically under the voices.

## Rendering long or high-resolution films on GitHub

The container behind a Claude session renders at roughly one 720p frame per
second and git refuses files over 100 MB, so long or 1080p films are rendered
by the **Render** workflow (`.github/workflows/render.yml`) instead: run it
from the Actions tab with a script, language, resolution and number of parallel
chunks.  Frames are deterministic, so the chunks render in parallel on separate
runners and are concatenated losslessly; the final job adds voices and
subtitles and uploads the video to a GitHub Release (assets may be up to 2 GB).
A 35-minute film at 1080p in 12 chunks takes about two hours.

Renders made inside a session are committed to the `renders` branch (files
under 100 MB) and, when under 30 MB, attached to the chat.

## Tests

```bash
npm test
```

Parser, compiler and evaluator tests run in Node.  The render smoke test needs
Chromium and is skipped when `OCEANSCRIPT_SKIP_RENDER_TEST=1`.
