# OceanScript – the markdown screenplay format

An OceanScript file is ordinary markdown.  The compiler reads it line by line and
turns each line into something that happens in the 3D ocean.  Anything it does not
understand is ignored with a warning, so you can keep notes in the file.

```markdown
---
title: Caspion the Little Fish
fps: 24
width: 1280
height: 720
---

# Cast
- caspion: fish, silver, size 0.6
- whaley (Little Whale): baby whale, blue

# Scene: The Reef
> time: day, water: turquoise, depth: shallow, floor: reef

@caspion enters from left to (0, -3, 0)
@camera follows @caspion from the side distance 3 &
**Caspion:** Let's see what's beyond the reef!
@caspion swims right 10 over 4s
- fade out 2s
```

## Timing model

Lines run **one after another**: each blocking line starts when the previous one
finishes.  Put `&` at the end of a line to make it **non-blocking**: the next line
starts at the same time.

```markdown
@whale swims to (10, -5, 0) over 6s &     <- starts at t
@caspion swims around @whale over 6s       <- also starts at t, blocks until t+6
- wait 2s                                  <- t+6 .. t+8
```

* `- sync` (or a `---` rule) waits for every running action to finish.
* A new `# Scene` heading always waits for everything to finish.
* Durations: `over 3s`, `for 2.5s`, `in 500ms`, `(3s)` or a trailing `3s`.
  When omitted the compiler picks a duration from the distance and the
  creature's speed (dialog: from the text length).

## Front matter

| key | meaning | default |
| --- | --- | --- |
| `title` | shown by `check` | |
| `lang` | language of the source text (`en`, `he`, ...) | en |
| `fps` | frames per second | 24 |
| `width`, `height` | output resolution | 1280×720 |
| `tts` | voice engine: `edge`, `gtts`, `none`, `auto` | auto |
| `timing` | `text` (dialog length estimated from the text) or `audio` (each spoken line lasts as long as its longest voice clip across all languages, plus padding) – both give identical frames in every language | text |
| `subtitles` | `burn` draws subtitles into the frames; otherwise they are a soft track | soft |
| `music` | background music file (relative to the script), looped under the voices | |
| `ambience` | `on` (or a gain such as `0.06`) adds a soft, slow underwater wash under everything | off |
| `sfx` | `off` disables the built-in effect sounds (sobs, bubbles, spouts, splashes) | on |
| `agreement` | `off` disables automatic Hebrew gender agreement | on |
| `music_volume` | music gain under the voices | 0.25 |
| `audio` | a finished audio file to mux instead of generating voices | |
| `tail` | seconds of padding after the last action | 1.5 |
| `duration` | force a total duration | |

## Languages, subtitles and voices

Every line of text can carry translations on the lines right after it, as
`<lang>: text`:

```markdown
**Caspion:** Why are you crying, little whale?
  he: למה אתה בוכה, לווייתן קטן?
> Narrator: Far from home, Caspion heard someone crying.
  he: הרחק מהבית, שמע כספיון מישהו בוכה.
- title "Caspion the Little Fish" for 4s
  he: כספיון הדג הקטן
```

The **timing always comes from the source line** (its text length or explicit
duration), so `--lang he` renders exactly the same frames as the source
language; only the title cards, the subtitle track and the voices change.
Untranslated lines fall back to the source text.  Right-to-left text is
handled automatically.

Subtitles are written as `<out>.srt` and `<out>.vtt` and muxed into the
video as a **soft subtitle track** (selectable in the player, off by default).
Pass `--burn-subtitles` (or `subtitles: burn`) to draw them into the frames.
Dialog cues are prefixed with the speaker's (localised) label; narration and
captions are not.

Voices are generated per line with a text-to-speech engine and placed at the
line's start.  With `timing: audio` (recommended when voices are on) the line's
duration is the longest clip among all languages plus 0.45 s, so nothing is
squeezed and the frames are still identical per language; the resolved
durations are saved as `<out>.timing.json` and reused by `oceanscript mux`.
With `timing: text` a clip longer than its slot is sped up a little (at most
1.45×) and a warning names the line if it still overflows.  Voices are chosen
per character and per language in the cast:

```markdown
# Cast
- narrator: voice "en-US-GuyNeural"
  he: voice "he-IL-AvriNeural"
- caspion: fish, silver, label "Caspion", voice "en-US-AnaNeural" pitch 10 rate 5
  he: label "כספיון", voice "he-IL-HilaNeural" pitch 30 rate 8
```

`voice` names an engine voice (`edge-tts --list-voices`), `pitch` is a Hz
offset and `rate` a percentage.  Keep both small: neural voices sound
artificial when shifted far.  Characters without a voice get a default one
for the language (child-like for small creatures, a narrator voice for
narration).  A cast entry named `narrator` (or of kind `narrator`) is
voice-only and never appears in the scene.  Captions are shown but not spoken.

**Hebrew pronunciation.** Unpointed Hebrew is ambiguous, so names and
homographs are mispronounced.  Rather than pointing everything, list only the
difficult words in a `# Pronunciation` section; every occurrence is spoken with
the pointed form, consistently, also when the word carries a prefix letter
(וכספיון, לשונית):

```markdown
# Pronunciation
- כספיון: כַּסְפִּיּוֹן
- כסוף: כָּסוּף
- מעבר: מֵעֵבֶר
```

Point vowels only, and add a dagesh only where it changes the consonant (בּ, כּ,
פּ): the Edge voices misread a dagesh in ג, ד or ת after a vowel (גַּן becomes
"gyan", דּוֹתָן "devotan").  Common words are usually read correctly unpointed;
check doubtful ones by listening to the clips in `out/.tts-cache` (or transcribe
them with Whisper) before adding an entry.

**Gender agreement (general).** Many Hebrew forms are homographs whose
pointing depends on gender: לך is לְךָ to a male and לָךְ to a female; מצאת is
מָצָאתָ or מָצָאתְ; רוצה is רוֹצֶה or רוֹצָה.  Give every character a gender in
the cast and say who a line is spoken to, either `**Caspion (to Little
Whale):** ...` or `@caspion says "..." to @whaley`; when omitted, the addressee
is the previous different speaker in the conversation.  Before synthesis each
Hebrew line is analysed morphologically (Dicta) and every word whose readings
are gender twins is pointed for the right person: pronominal suffixes and
second-person past verbs follow the addressee, words in a clause with אני
follow the speaker, words in a clause with אתה / את follow the addressee, and
anything else is left as written.  Only those words are pointed, so easy words
stay clean.  Warnings name words whose gender cannot be resolved (unknown
addressee) and lines that say אתה to a female character.  Glossary entries
still override: `- מצאת [f]: מָצָאתְ` applies when the addressee is female,
`[m]` when male, `[speaker f]` / `[speaker m]` by the speaker's gender.
`agreement: off` disables the automatic step.

**Checking the voices.** `oceanscript voices script.md` synthesises every line
(cached), transcribes each clip back with Whisper (`pip install faster-whisper`)
and prints the lines whose transcript drifts from the text, lowest similarity
first; `--phonetic` adds an English-forced reading ("matzata" vs "matzat") for
judging vowels.  Use it after every text change: the Edge voices have quirks
(a dagesh in ג/ד/ת, a vowel appended to a sentence-final ת, so `הגננת` is
spoken as `הַגַנֶנֶט`), and this is how to catch them without listening to
every line.

A `he-tts:` line under a `he:` line replaces the spoken text of that one line
(phonetic respelling, or a fully pointed sentence).  `nikud: auto` in the
front matter points every Hebrew line with Dicta's Nakdan service instead
(off by default: it over-points easy words).  The text actually spoken is
written to `<out>.voice.json` for checking.

**Engines.** `edge` (free, Microsoft neural voices: he-IL-Avri/Hila, many
English voices) is the default.  `elevenlabs` is used automatically when
`ELEVENLABS_API_KEY` is set (per-character voices via `voice "<voice id>"`,
`ELEVENLABS_MODEL` defaults to `eleven_multilingual_v2`); it is markedly more
natural in Hebrew.  `gtts` is a last resort; `none` renders silent video.  The
same script renders identical frames whichever engine is used, provided the
saved `.timing.json` is reused.

## Cast

A `# Cast` heading starts the cast list.  Each list item declares an actor:

```markdown
- name: kind, colour, size N, speed N, count N, label "Display Name"
- name (Display Name): kind ...
```

* **accent** `accent purple` (fins, tongue, tears and iris of a whale in a second
  colour) and **baleen** (black-and-white baleen stripes over the mouth), for the
  film's signature whale: `- whale: whale, black, size 10, accent purple, baleen`.
* **pattern** for fish: `spots`, `stripes` or `bands` in the accent colour, e.g.
  `- puffer: fish, magenta, spots, accent yellow`.
* **eyes** `eyes 1.5` (or `big eyes`) scales a fish's eyes, and **forelock** (or
  `curly`) gives it a quiff on the forehead striped in the body and accent
  colours: `- dothan: fish, orange, bands, accent cyan, eyes 1.5, forelock`.
* **gender**: `male` or `female` (guessed from names like *mother* otherwise).
  It drives gender-dependent pronunciation (below) and default voices.
* **kind**: `fish`, `shark`, `whale`, `dolphin`, `octopus`, `squid`, `jellyfish`,
  `turtle`, `crab`, `ray`, `eel`, `seahorse`, `starfish`, `school` (a shoal of
  small fish; `count N` sets how many), `bird`, `pelican`, `bubble`, and two
  asset-backed kinds: `sprite` (a 2D image cutout: `image "assets/cop.svg"`,
  billboarded and mirrored to face its heading) and `model` (a glTF/GLB file:
  `model "assets/boat.glb" animation "Rock"`, normalised to `size` and driven by
  time).  Two procedural props: `bike` (a bicycle whose wheels and pedals turn
  with the distance it travels; `@caspion rides @bike`, then move the bike) and
  `mango` (a fruit that `splits` and can be eaten).  Words such as `baby`, `small`, `big`, `huge` scale the default size.
* **colour**: a colour name (`silver`, `gold`, `blue`, `navy`, `pink`, ...) or `#hex`.
* **size**: body length in metres.  **speed**: metres per second for default move
  durations.
* **label**: the name shown in subtitles (defaults to the capitalised name).
* **voice**, **pitch**, **rate**: text-to-speech voice (see *Languages, subtitles and voices*).
* A following `he: label "...", voice "..."` line localises the label and voice.

Actors used without a declaration become silver fish (with a warning).
Actor names may contain any letters, digits, `_` and `-` (Hebrew works).

## Scenes and settings

`# Scene: Name` (or any level-1 heading) starts a scene.  `##` headings are
beats – markers only.  A scene starts after everything from the previous scene
has finished, and **hides every actor**: actors reappear the first time they act
in the new scene (or explicitly with `appears`/`enters`).

Environment settings are blockquotes with `key: value` pairs:

```markdown
> time: dusk, water: dark, waves: choppy, depth: deep, floor: rock, visibility: 30
```

| key | values |
| --- | --- |
| `time` | `day`, `noon`, `morning`, `sunset`, `dusk`, `night` |
| `water` | `blue`, `turquoise`, `green`, `dark`, `night`, `tropical`, `black`, `murky`, `pink`, `yellow` or `#hex` |
| `waves` | `none`, `flat`, `calm`, `gentle`, `medium`, `choppy`, `rough`, `storm` or a number |
| `depth` | `surface`, `shallow`, `medium`, `deep`, `abyss` or metres (seabed depth) |
| `floor` | `sand`, `reef`, `rock`, `kelp`, `beach`, `land` (green ground above the water for scenes on shore), `none` |
| `style` | `3d` (default) or `flat` – a picture-book look: no fog, caustics, rays or particles, flat lighting |
| `backdrop` | an image (PNG/JPEG/SVG, relative to the script) shown as the whole background instead of sky and water; `none` to clear |
| `sky` | `#hex` solid sky/background colour |
| `clouds` | `off`, `low`, `on`, `many` – drifting clouds when the camera is above the water |
| `fog` | a fog density number to override `visibility` |
| `interior` | `whale` – inside the whale: a dark cavern with baleen bars around the camera (`none` to leave) |
| `visibility` | fog distance in metres (default 40) |
| `caustics`, `rays`, `bubbles`, `plankton`, `seaweed`, `coral`, `rocks` | `off`, `low`, `on`, `many` or a number |
| `transition` | seconds to cross-fade into these settings (default 2 mid-scene, 0 at a scene start) |

Settings accumulate: a later `> time: night` only changes the time of day.
Any other blockquote is **narration**: `> Narrator: text` or just `> text`.

## Coordinates

Positions are `(x, y, z)` in metres (`z` optional).  `y = 0` is the water
surface, negative is underwater.  `x` runs left to right, `z` toward the default
camera.  Directions: `left`, `right`, `up`, `down`, `forward`, `back`.

Targets can be a position `(x, y, z)`, an actor `@name`, an actor plus offset
`@name (2, 0, 0)`, or `the camera`.

## Actor actions

`@name verb ...`.  Verbs have several synonyms; the canonical forms:

| action | example |
| --- | --- |
| appear | `@caspion appears at (0, -3, 0)` |
| enter | `@shark enters from right to (10, -6, 0) over 3s` |
| exit | `@shark exits right over 2s` (hides when done) |
| hide / show | `@whale hides`, `@whale shows` |
| move | `@caspion swims to (4, -2, 1) over 3s`, `swims toward @whale`, `swims near @whale`, `swims left 5`, `dives 4`, `dives to depth 6`, `surfaces`, `goes home` |
| orbit | `@friends swims around @caspion 2 times over 8s`, `circles (0, -3, 0) radius 4` |
| follow | `@caspion follows @whale beside` (`behind`, `front`, `above`, `below`; behind, front and beside turn with the leader) or with offset `follows @whale (0, 1, -2)`; ends at the actor's next move or `@caspion stops` |
| look | `@whale looks at @caspion`, `looks at the camera`, `faces left` |
| wait | `@whale waits 2s` |
| say | `@caspion says "Hello!"`, `@caspion: Hello!`, `**Caspion:** Hello!` |
| emotion | `@whale feels sad` – `happy`, `excited`, `proud`, `sad`, `lonely`, `crying`, `scared`, `surprised`, `sleepy`, `angry`, `calm`, `curious`, `neutral` |
| face | `@whale smiles big`, `@shark grins` (teeth), `@fish frowns`, `@whale shows teeth` / `hides teeth`, `@whale opens mouth wide for 1s` / `closes mouth`, `@fish blinks twice`, `@octopus winks`, `@whale yawns`, `@caspion gasps` – smile and teeth persist until changed; emotions set sensible defaults (angry shows teeth and lowered brows, sad raises them) |
| spin | `@caspion spins 3 times over 2s` |
| wiggle | `@caspion wiggles for 3s` |
| jump | `@dolphin jumps height 3 over 1.5s` (an arc; breaches if at the surface) |
| nod | `@turtle nods` |
| scale | `@puffer grows to size 2 over 1s`, `shrinks` |
| bubbles / cry / spout / glow | `@caspion blows bubbles for 2s`, `@whale cries for 3s` (tear drops fall from the eyes in the accent colour, with a sob sound), `@whale spouts`, `@jelly glows for 3s`.  Crying, bubbles, spouts and jumps play built-in sound effects (`sfx: off` in the front matter disables them) |
| speed | `@shark speed 8` (metres per second for later default durations) |
| carry / drop | `@jelly carries @caspion` ... `@jelly drops @caspion` (pelicans hold the passenger in the pouch, bubbles inside, whales on the back) |
| ride / dismount | `@caspion rides @bike` (the same attachment seen from the rider: it sits on the saddle and faces where the bike goes; then `@bike moves right 4`, `@bike circles @gan`, `@bike wiggles` for a wobble) ... `@caspion dismounts` |
| split / eat / clean | `@mango splits` (the halves drift apart), `@caspion eats @mango over 5s` (chews the half on its side in four bites; pulp floats off and the face stays smeared with juice until `@caspion cleans` or about 25 s pass); `eats` a creature means `swallows` |
| swallow / spit | `@whale swallows @caspion` (attaches and hides), `@whale spits out @caspion` (reappears, tossed towards the camera) |
| fly / walk | `@pelican flies to (10, 6, 0) over 3s`, `@gull soars left 8`, `@crab walks right 2` – synonyms of *move* for creatures above the water |
| ease | add `linear`, `smooth`, `snap`, `bouncy` or `elastic` to any move |

Movement sets the facing direction automatically, with smooth turns and banking.
Emotions change the animation (tail speed, pitch, eyes, trembling) and the face
(smile, mouth, brows).  Fish, sharks, whales, dolphins and octopuses have an
articulated mouth; all creatures blink on their own every few seconds.

**Lip-sync.** While a character speaks, its mouth follows the loudness
envelope of its voice clip (25 samples per second), so the mouth moves with the
actual words.  This makes the frames depend on the language's audio; set
`lipsync: off` in the front matter to keep a generic talking motion and
identical frames in every language.

## Camera

`@camera` is an actor with its own verbs:

| action | example |
| --- | --- |
| cut | `@camera cuts to (0, -2, 12) looking at (0, -3, 0)`, `cuts to @whale` |
| move | `@camera moves to (5, -4, 10) over 4s`, `moves to @whale distance 9` |
| look | `@camera looks at @shark over 1s` |
| follow | `@camera follows @caspion from behind distance 3 height 1` (`side`, `front`, `above`; behind, side and front are relative to the actor's heading, so `side` is always a profile) |
| frame | `@camera frames @caspion and @dothan` (a two-shot: from the side of the line between them, far enough to hold both, a little above; `distance 3` overrides, `over 2s` moves there instead of cutting; one actor gives a close-up) |
| orbit | `@camera orbits @whale distance 12 over 10s` |
| shake | `@camera shakes for 1s strength 2` |
| zoom | `@camera zooms to 30 over 2s` (field of view in degrees) |
| stop | `@camera stops` (freezes where it is) |

The camera is clamped just above the seabed and never sits exactly on the surface.
It is also pushed out of every character's and prop's body (so a follow shot
never passes through the teacher), and anything closer to the lens than its own
half-size is hidden for those frames rather than sliced by the near plane.
Sweeping follow shots through a crowded set still look bad: prefer static cuts
or `frames` for dialogue.

## Dialog and text

```markdown
**Caspion:** Come on, everybody!            <- subtitle with speaker, blocks for its duration
**Caspion:** A short line (2s) &            <- explicit duration, non-blocking
@shark: Well, well...
> Narrator: Far from home, Caspion heard someone crying.
> Plain narration works too.
- caption "Text without a speaker" for 3s
- title "Chapter One" for 4s
```

Speaking actors get a small talking animation; the speaker label uses the
actor's colour.  Right-to-left text is detected automatically.

## Directives

| directive | effect |
| --- | --- |
| `- wait 2s` | advance time |
| `- sync` / `---` | wait for all running actions |
| `- fade in 2s`, `- fade out 2s`, `- fade out to white 1s`, `- black 1s` | fades (to black, white or `#hex`); a fade-out holds its colour until the next fade-in or iris-in |
| `- iris out 1s`, `- iris in 1s` | circle-iris transitions, as in the film's endings |
| `- title "text" for 4s` | centred title card (`subtitle "..."` adds a second line) |
| `- caption "text" for 3s` | subtitle without a speaker |
| `- image "assets/page.svg" for 4s` | full-frame illustration/photo card (`fit`, `cover` or `stretch`); a `he: ...` line under it is a localised caption |
| `- clip "assets/footage.mp4" for 5s from 12s` | live footage: the video (transcoded to WebM for the browser) plays full-frame from the given offset, with its own sound (`volume N`) |
| `- credits "line | line | line" for 8s` | scrolling credits; translatable with a `he:` line |
| `- music "assets/theme.wav" volume 0.3` ... `- music stop 2s` | scene music: loops from here until the next `music` line or `stop` (with a fade-out); `from 10s` starts inside the file.  Music is automatically ducked under the voices.  `examples/music/` ships public-domain recordings (see its CREDITS.md) |
| `- sound "assets/splash.wav" volume 0.8` | a sound effect at this moment (`&` is implied: it never blocks unless given a duration) |
| `- cut` | the next settings change is instant instead of cross-fading |
| `- marker "name"` | marker on the preview scrubber |

## Assets

Paths are relative to the script file.  Images (PNG, JPEG, WebP, SVG) work as
backdrops, sprites and cards; glTF/GLB files as models; WAV/MP3/OGG as music and
sounds; MP4/MOV/WebM as clips (`mp4` is transcoded to WebM once, into
`out/.asset-cache`).  `font: assets/title.ttf` in the front matter (with
`font_family: Name`) loads a custom font for title cards, subtitles (when burnt
in) and credits – useful for Hebrew display faces.

`examples/great-journey/` demonstrates every asset type: a flat 2D city
backdrop with a drawn policeman sprite, an illustration card, a hand-built
animated GLB boat, a pelican, a bubble ride, a whale swallowing the hero, music,
a splash and a video clip.

Comments: `<!-- ... -->`.  Lines in `_italics_` are stage directions and are ignored.

## What the format covers (and does not)

Reviewing the 2004 *Caspion* film scene by scene, the format now covers its
scenario types: underwater 3D scenes with reef, sand, rock and open water;
inside-the-whale darkness (`water: black`, `visibility: 6`, `floor: none`);
surface and sky shots with clouds, birds and boats; flights over land and a 2D
picture-book city (`style: flat` + `backdrop`); the whale family, shark attack,
octopuses, jellyfish, pelican; swallowing, bubble rides and carrying; Hebrew
title cards and credits; songs (scene music) and effects; illustration cards and
live "making of" footage as clips.  Not covered: lip-synced facial animation,
rigged humans and land animals as procedural rigs (use sprites or glTF models),
2D vector animation of the drawings themselves, and cross-dissolves between
scenes (fades only).
