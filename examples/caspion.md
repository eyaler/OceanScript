---
title: Caspion the Little Fish
lang: en
fps: 24
width: 1280
height: 720
tts: edge
timing: audio
---

<!-- An OceanScript screenplay loosely based on Paul Kor's "Caspion" stories.
     Lines starting with @ are actions, > lines are narration or scene settings,
     - lines are directives, **Name:** lines are dialog.
     A trailing & makes a line non-blocking (the next line starts at the same time).
     A `he: ...` line right after a dialog, narration, title or caption line is its Hebrew
     translation; timing always comes from the source line, so every language renders the
     same frames.  Render with `--lang he` for Hebrew subtitles, title card and voices. -->

# Cast
- narrator: voice "en-US-GuyNeural"
  he: voice "he-IL-AvriNeural"
- caspion: fish, silver, size 0.6, label "Caspion", voice "en-US-AnaNeural" pitch 10 rate 5
  he: label "כספיון", voice "he-IL-HilaNeural" pitch 30 rate 8
- whaley (Little Whale): baby whale, blue, size 4, voice "en-US-AnaNeural" pitch -5 rate -5
  he: label "לווייתן קטן", voice "he-IL-HilaNeural" pitch 12 rate -6
- mother (Mother Whale): whale, navy, size 10, voice "en-US-JennyNeural" pitch -12 rate -8
  he: label "אמא לווייתנית", voice "he-IL-HilaNeural" pitch -12 rate -10
- shark: shark, gray, size 4, voice "en-US-ChristopherNeural" pitch -25 rate -10
  he: label "כריש", voice "he-IL-AvriNeural" pitch -25 rate -12
- octopus: octopus, red, size 1.6, voice "en-US-GuyNeural" pitch -8
  he: label "תמנון", voice "he-IL-AvriNeural" pitch -6 rate -4
- jelly (Jellyfish): jellyfish, pink, size 1
  he: label "מדוזה"
- friends: school, gold, count 14, size 0.35
  he: label "החברים"

# Scene: The Reef
> time: day, water: turquoise, waves: gentle, depth: shallow, floor: reef

- fade in 2s &
- title "Caspion the Little Fish" for 4s &
  he: כספיון הדג הקטן
@camera cuts to (0, -2, 14) looking at (0, -3, 0)
@friends appears at (-2, -3.5, -3)
@caspion appears at (-14, -3, 3)
@camera follows @caspion from the side distance 3 &
@caspion swims to (1, -3, 1) over 5s
> Narrator: Caspion was a small silver fish who loved to swim faster and farther than all the others. &
  he: כספיון היה דג כסוף קטן, שאהב לשחות מהר יותר ורחוק יותר מכל האחרים.
@friends swims around @caspion 1 time over 6s &
@caspion feels happy
@caspion spins twice
- sync
**Caspion:** Come on, everybody! Let's see what's beyond the reef!
  he: בואו, כולם! בואו נראה מה יש מעבר לשונית!
@friends looks at @caspion
@caspion looks at @friends
- wait 1s
@camera follows @caspion from behind distance 3 &
@caspion swims right 14 over 5s &
> Narrator: But his friends were afraid to leave the reef, so Caspion set out alone. &
  he: אבל חבריו פחדו לעזוב את השונית, וכספיון יצא לדרך לבדו.
- wait 5s

# Scene: The Crying Whale
> time: day, water: blue, depth: medium, floor: sand, visibility: 45
@whaley appears at (4, -6, -2)
@whaley looks at (-6, -6, 4)
@camera cuts to (-5, -4, 8) looking at @whaley
@whaley feels sad
@whaley cries for 4s &
> Narrator: Far from home, Caspion heard someone crying.
  he: הרחק מהבית, שמע כספיון מישהו בוכה.
@caspion enters from left to (-1, -5, 1) over 3s
@caspion looks at @whaley
**Caspion:** Why are you crying, little whale?
  he: למה אתה בוכה, לווייתן קטן?
**Little Whale:** I lost my mother in the storm... I'm all alone.
  he: איבדתי את אמא שלי בסערה... אני לגמרי לבד.
@camera orbits @whaley distance 11 over 10s &
@caspion swims near @whaley over 2s
@caspion feels curious
**Caspion:** Don't worry. I'll help you find her!
  he: אל תדאג. אני אעזור לך למצוא אותה!
@whaley feels happy
@caspion swims around @whaley 2 times over 8s &
@whaley looks at @caspion
- wait 4s

# Scene: The Shark
> time: dusk, water: dark, depth: deep, floor: rock, visibility: 30, rays: off
@whaley appears at (0, -9, -4)
@caspion appears at (-3, -8, -2)
@camera cuts to (-6, -7, 8) looking at @whaley
@caspion follows @whaley beside &
@whaley swims to (6, -9, -6) over 5s &
@camera follows @whaley from the side distance 12 &
- wait 5s
@shark enters from right to (14, -7, -4) over 3s &
@camera looks at @shark over 1s
@camera shakes for 1s &
@caspion feels scared
@whaley feels scared
**Shark:** Well, well... a snack and a dessert.
  he: ובכן, ובכן... חטיף, וגם קינוח.
@caspion stops
@shark swims near @caspion over 3s &
@caspion wiggles for 3s
@caspion: Help!
  he: הצילו!
@mother enters from left to (-4, -10, -10) over 4s &
@camera cuts to (2, -6, 14) looking at (2, -9, -6)
@mother looks at @shark
**Mother Whale:** Leave those little ones alone!
  he: עזוב את הקטנים האלה במנוחה!
@shark feels scared
@shark exits right over 2s
@whaley feels happy
@whaley swims near @mother over 3s
**Little Whale:** Mama! You found me!
  he: אמא! מצאת אותי!
@camera moves to @whaley distance 9 over 3s &
@whaley looks at @caspion
**Little Whale:** This is Caspion. He helped me!
  he: זה כספיון. הוא עזר לי!
@mother looks at @caspion
**Mother Whale:** Thank you, brave little fish.
  he: תודה לך, דג קטן ואמיץ.
@caspion feels proud
@caspion spins 3 times over 2s

# Scene: The Octopus and the Jellyfish
> time: day, water: blue, depth: medium, floor: reef, visibility: 40
@octopus appears at (3, -6, -2)
@jelly appears at (-5, -3, -3)
@caspion enters from left to (0, -5, 1) over 3s &
@camera cuts to (-3, -4, 8) looking at @octopus
- wait 3s
@caspion looks at @octopus
@octopus looks at @caspion
**Octopus:** So you want to see the world above the water, little fish?
  he: אז אתה רוצה לראות את העולם שמעל המים, דג קטן?
**Caspion:** More than anything!
  he: יותר מכל דבר בעולם!
@octopus wiggles for 2s
**Octopus:** Then my friend the jellyfish will carry you, with the sea held in her bell.
  he: אז חברתי המדוזה תישא אותך, עם הים שמור בתוך הפעמון שלה.
@jelly swims near @caspion over 4s
@jelly glows for 3s &
@jelly carries @caspion
@camera follows @jelly from the front distance 5 &
@jelly surfaces over 6s
@camera moves to (0, 1.5, 8) looking at (0, 0.3, 0) over 4s
> Narrator: And so Caspion rose up, up, up... until he saw the sky for the very first time.
  he: וכך עלה כספיון למעלה, למעלה, למעלה... עד שראה את השמיים בפעם הראשונה.
- wait 2s

# Scene: Home
> time: sunset, water: turquoise, waves: gentle, depth: shallow, floor: reef, visibility: 50
@friends appears at (2, -3, -3)
@jelly appears at (-8, -1, 0)
@jelly carries @caspion
@camera cuts to (0, -2, 9) looking at (0, -3, 0)
@jelly swims to (-2, -3, 1) over 4s
@jelly drops @caspion
@caspion swims to (0, -3, 0) over 2s
@friends swims around @caspion 2 times over 8s &
@caspion feels happy
@caspion looks at the camera
@caspion spins twice
**Caspion:** The world is simply wonderful... wet or dry!
  he: העולם פשוט נפלא... רטוב או יבש!
- caption "העולם פשוט נפלא, רטוב או יבש!" for 3s
  he: The world is simply wonderful, wet or dry!
@caspion blows bubbles for 2s
- wait 1s
- fade out 2s
