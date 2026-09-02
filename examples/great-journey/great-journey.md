---
title: Caspion's Great Journey
lang: en
fps: 24
width: 1280
height: 720
tts: edge
timing: audio
font: assets/title-font.ttf
font_family: TitleFont
---

<!-- A short demo covering the kinds of scenes and assets found in the original film:
     a whale swallowing the hero, a bubble ride, a pelican flight over land, a flat
     2D "picture book" city with a drawn character, an illustration card, live
     footage, music, a sound effect, a custom title font and scrolling credits. -->

# Cast
- narrator: voice "en-US-GuyNeural"
  he: voice "he-IL-AvriNeural"
- caspion: fish, silver, size 0.6, label "Caspion", voice "en-US-AnaNeural" pitch 10 rate 5
  he: label "כספיון", voice "he-IL-HilaNeural" pitch 30 rate 8
- whale: whale, black, size 12, voice "en-US-ChristopherNeural" pitch -20 rate -8
  he: label "לווייתן", voice "he-IL-AvriNeural" pitch -20 rate -8
- bubble: bubble, size 1.4
- pelican: pelican, white, size 2.2, voice "en-US-GuyNeural" pitch 15
  he: label "שקנאי", voice "he-IL-AvriNeural" pitch 15
- gull: bird, gray, size 0.9
- cop: sprite, image "assets/policeman.svg", size 3, label "Policeman", voice "en-US-ChristopherNeural"
  he: label "שוטר", voice "he-IL-AvriNeural"
- boat: model "assets/boat.glb" animation "Rock", size 4

# Scene: Inside the Whale
> time: day, water: blue, depth: medium, floor: sand, visibility: 35
- music "assets/theme.wav" volume 0.22
- fade in 1s &
- title "Caspion's Great Journey" for 3s &
  he: המסע הגדול של כספיון
@whale appears at (14, -8, -6)
@whale looks at (-10, -6, 4)
@caspion appears at (-4, -5, 2)
@camera cuts to (-3, -3, 12) looking at @caspion
@caspion looks at @whale
> Narrator: One day a great whale opened its mouth... and Caspion was swallowed whole!
  he: יום אחד פתח לווייתן ענק את פיו... וכספיון נבלע בשלמותו!
@whale swims near @caspion over 4s &
@camera follows @caspion from the side distance 4 &
- wait 3.5s
@whale swallows @caspion
- sound "assets/splash.wav" volume 0.8
- cut
> water: black, visibility: 6, caustics: off, rays: off, floor: none, bubbles: many
@camera cuts to (11, -7.5, -2) looking at (14, -8, -6)
- wait 1s
**Whale:** Oops. Hello, little fish. Let me get you out of there.
  he: אופס. שלום, דג קטן. תן לי להוציא אותך משם.
- cut
> water: blue, visibility: 35, caustics: on, rays: on, floor: sand, bubbles: on
@camera cuts to (2, -6, 3) looking at (9, -7.5, -3.5)
@whale spits out @caspion
@caspion feels surprised
**Caspion:** Whoa! What a ride!
  he: וואו! איזו נסיעה!

# Scene: The Bubble
> time: day, water: turquoise, depth: shallow, floor: reef
@bubble appears at (0, -5, 0)
@caspion appears at (0, -5, 0)
@bubble carries @caspion
@camera cuts to (-3, -4, 8) looking at @bubble
@camera follows @bubble from the front distance 5 &
> Narrator: A bubble carried Caspion up towards the light.
  he: בועה נשאה את כספיון מעלה, אל האור.
@bubble surfaces over 5s
@camera moves to (0, 2, 9) looking at (0, 0.5, 0) over 3s
@bubble drops @caspion
@bubble hides
- sound "assets/splash.wav" volume 0.6

# Scene: The Pelican
> time: day, water: blue, waves: gentle, clouds: on, depth: shallow, floor: sand
@caspion appears at (0, -0.5, 0)
@boat appears at (-9, 0.3, -8)
@boat looks left
@gull appears at (12, 9, -6)
@camera cuts to (0, 3, 12) looking at (0, 0.5, 0)
@gull flies to (-14, 10, -4) over 8s &
@pelican enters from right to (2, 2.5, 1) over 3s
@pelican looks at @caspion
**Pelican:** Hop in, little one. I know a place where the world is dry!
  he: קפוץ פנימה, קטנצ'יק. אני מכיר מקום שבו העולם יבש!
@pelican dives to (0, 0.2, 0) over 1.2s
@pelican carries @caspion
- sound "assets/splash.wav" volume 0.5 &
@camera follows @pelican from the side distance 7 height 1 &
@pelican flies to (0, 6, 0) over 3s
@pelican flies to (30, 9, -10) over 6s &
> Narrator: And up they went, over the waves and over the land.
  he: והם המריאו, מעל הגלים ומעל היבשה.
- sync

# Scene: The City
> style: flat, backdrop: assets/city.svg, floor: none, clouds: off, waves: none
@cop appears at (3, 0.2, 0)
@pelican appears at (-12, 5, -3)
@caspion appears at (-12, 5, -3)
@pelican carries @caspion
@camera cuts to (0, 2.5, 12) looking at (0, 2.5, 0)
@pelican flies to (-1, 3, 0) over 4s
@cop looks at @pelican
@cop feels excited
@cop wiggles for 2s &
**Policeman:** A fish in the sky! Now I have seen everything.
  he: דג בשמיים! עכשיו ראיתי הכול.
@caspion looks at @cop
**Caspion:** Hello down there! The world is simply wonderful, wet or dry!
  he: שלום לכם שם למטה! העולם פשוט נפלא, רטוב או יבש!
@pelican flies to (14, 5, 0) over 3s

# Scene: The Book
- image "assets/book-page.svg" for 4s
  he: מתוך הספר "כספיון הדג הקטן" מאת פאול קור
- clip "assets/making-of.mp4" for 3s from 1s
- music stop 1s
- credits "Caspion's Great Journey | based on the books by Paul Kor | rendered with OceanScript | music: a little sea shanty" for 6s
  he: המסע הגדול של כספיון | על פי ספריו של פאול קור | הופק עם OceanScript | מוזיקה: שיר ים קטן
- fade out to white 1s
