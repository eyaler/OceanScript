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
| `fps` | frames per second | 24 |
| `width`, `height` | output resolution | 1280×720 |
| `audio` | audio file (relative to the script) muxed into the video | |
| `subtitles` | `false` disables the on-screen subtitles | true |
| `tail` | seconds of padding after the last action | 1.5 |
| `duration` | force a total duration | |

## Cast

A `# Cast` heading starts the cast list.  Each list item declares an actor:

```markdown
- name: kind, colour, size N, speed N, count N, label "Display Name"
- name (Display Name): kind ...
```

* **kind**: `fish`, `shark`, `whale`, `dolphin`, `octopus`, `squid`, `jellyfish`,
  `turtle`, `crab`, `ray`, `eel`, `seahorse`, `starfish`, `school` (a shoal of
  small fish; `count N` sets how many).  Words such as `baby`, `small`, `big`,
  `huge` scale the default size.
* **colour**: a colour name (`silver`, `gold`, `blue`, `navy`, `pink`, ...) or `#hex`.
* **size**: body length in metres.  **speed**: metres per second for default move
  durations.
* **label**: the name shown in subtitles (defaults to the capitalised name).

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
| `water` | `blue`, `turquoise`, `green`, `dark`, `night`, `tropical` or `#hex` |
| `waves` | `flat`, `calm`, `gentle`, `medium`, `choppy`, `rough`, `storm` or a number |
| `depth` | `surface`, `shallow`, `medium`, `deep`, `abyss` or metres (seabed depth) |
| `floor` | `sand`, `reef`, `rock`, `kelp`, `beach`, `none` |
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
| follow | `@caspion follows @whale beside` (`behind`, `front`, `above`, `below`) or with offset `follows @whale (0, 1, -2)`; ends at the actor's next move or `@caspion stops` |
| look | `@whale looks at @caspion`, `looks at the camera`, `faces left` |
| wait | `@whale waits 2s` |
| say | `@caspion says "Hello!"`, `@caspion: Hello!`, `**Caspion:** Hello!` |
| emotion | `@whale feels sad` – `happy`, `excited`, `proud`, `sad`, `lonely`, `crying`, `scared`, `surprised`, `sleepy`, `angry`, `calm`, `curious`, `neutral` |
| spin | `@caspion spins 3 times over 2s` |
| wiggle | `@caspion wiggles for 3s` |
| jump | `@dolphin jumps height 3 over 1.5s` (an arc; breaches if at the surface) |
| nod | `@turtle nods` |
| scale | `@puffer grows to size 2 over 1s`, `shrinks` |
| bubbles / cry / spout / glow | `@caspion blows bubbles for 2s`, `@whale cries for 3s`, `@whale spouts`, `@jelly glows for 3s` |
| speed | `@shark speed 8` (metres per second for later default durations) |
| carry / drop | `@jelly carries @caspion` ... `@jelly drops @caspion` |
| ease | add `linear`, `smooth`, `snap`, `bouncy` or `elastic` to any move |

Movement sets the facing direction automatically, with smooth turns and banking.
Emotions change the animation (tail speed, pitch, eyes, trembling).

## Camera

`@camera` is an actor with its own verbs:

| action | example |
| --- | --- |
| cut | `@camera cuts to (0, -2, 12) looking at (0, -3, 0)`, `cuts to @whale` |
| move | `@camera moves to (5, -4, 10) over 4s`, `moves to @whale distance 9` |
| look | `@camera looks at @shark over 1s` |
| follow | `@camera follows @caspion from behind distance 3 height 1` (`side`, `front`, `above`) |
| orbit | `@camera orbits @whale distance 12 over 10s` |
| shake | `@camera shakes for 1s strength 2` |
| zoom | `@camera zooms to 30 over 2s` (field of view in degrees) |
| stop | `@camera stops` (freezes where it is) |

The camera is clamped just above the seabed and never sits exactly on the surface.

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
| `- fade in 2s`, `- fade out 2s`, `- black 1s` | fades |
| `- title "text" for 4s` | centred title card (`subtitle "..."` adds a second line) |
| `- caption "text" for 3s` | subtitle without a speaker |
| `- cut` | the next settings change is instant instead of cross-fading |
| `- marker "name"` | marker on the preview scrubber |

Comments: `<!-- ... -->`.  Lines in `_italics_` are stage directions and are ignored.
