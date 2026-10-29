# Bundled fonts

The four families the look bible's `typography.display` and `typography.body` may name. Each is one variable TrueType file copied unchanged from the google/fonts repository at commit `6157dfaa640ca5738b4d1a7070fe389c3036d7fc`, with its SIL Open Font License 1.1 text beside it as `<file stem>-OFL.txt`. `src/shared/typography/scale.ts` (`bundledFonts`) holds the same table in code and `tests/shared/typography/scale.test.ts` hashes the files against it.

| Family | File | google/fonts path | SHA-256 | License |
| --- | --- | --- | --- | --- |
| Inter | `Inter.ttf` | `ofl/inter/Inter[opsz,wght].ttf` | `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031` | OFL-1.1 (`Inter-OFL.txt`) |
| Space Grotesk | `SpaceGrotesk.ttf` | `ofl/spacegrotesk/SpaceGrotesk[wght].ttf` | `acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72` | OFL-1.1 (`SpaceGrotesk-OFL.txt`) |
| Playfair Display | `PlayfairDisplay.ttf` | `ofl/playfairdisplay/PlayfairDisplay[wght].ttf` | `c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6` | OFL-1.1 (`PlayfairDisplay-OFL.txt`) |
| JetBrains Mono | `JetBrainsMono.ttf` | `ofl/jetbrainsmono/JetBrainsMono[wght].ttf` | `48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda` | OFL-1.1 (`JetBrainsMono-OFL.txt`) |

Source URL pattern: `https://raw.githubusercontent.com/google/fonts/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/<google/fonts path>`.

## Reserved font names

The OFL lets the files be bundled and served, but a modified version may not carry a reserved name. Playfair Display declares "Playfair Display" as a Reserved Font Name in its license header; Inter, Space Grotesk and JetBrains Mono declare none in theirs. None of this matters as long as the rule below holds.

## The rule

These files are served to the browser by the harness at `/fonts/` (the `@font-face` rules come from `fontFaceCss` in `src/shared/typography/scale.ts`) and are never modified, subset, converted or renamed. A font update is a new copy from google/fonts at a new commit, with the commit and the SHA-256 values updated here and in `bundledFonts` together.
