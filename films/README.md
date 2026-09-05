# Films

One folder per film: the OceanScript screenplay, its assets, the pinned timing
and pronunciation (`*.timing.json`), the voice manifest and the subtitle files.
The rendered videos are too large for git and are published as assets of the
[`renders` release](https://github.com/eyaler/OceanScript/releases/tag/renders);
each folder's README links to them.

| film | script | video (1080p) | length |
| --- | --- | --- | --- |
| Pilot: כספיון הדג הקטן / Caspion the Little Fish (he + en) | [`pilot/caspion.md`](pilot/caspion.md) | [he](https://github.com/eyaler/OceanScript/releases/download/renders/caspion.he.1080p.mp4) · [en](https://github.com/eyaler/OceanScript/releases/download/renders/caspion.en.1080p.mp4) | 2:48 |
| S01E01: כספיון הולך לגן | [`s01e01/s01e01.md`](s01e01/s01e01.md) | [he](https://github.com/eyaler/OceanScript/releases/download/renders/s01e01.he.1080p.mp4) | 8:28 |
| S01E02: מק-כספיון (candidate) | [`s01e02/s01e02.md`](s01e02/s01e02.md) | [he](https://github.com/eyaler/OceanScript/releases/download/renders/s01e02.he.1080p.mp4) | 9:18 |
| S01E03: הדגים פשטו עם שחר (candidate) | [`s01e03/s01e03.md`](s01e03/s01e03.md) | [he](https://github.com/eyaler/OceanScript/releases/download/renders/s01e03.he.1080p.mp4) | 8:04 |

Render any of them with `node bin/oceanscript.js render films/<film>/<script>.md`
(add `--draft` for a quick preview), or with the Render workflow in the Actions
tab, which uploads the result to the release.
