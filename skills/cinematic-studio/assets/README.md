# Skill assets

What lives here, and what deliberately does not.

## Bundled: the fonts (`fonts/`)

The four OFL typefaces the look bible can name, one variable TTF per family with the SIL Open Font License text beside it. They are committed because the harness serves them to the browser at `/fonts/` on every render and a title card must not depend on the network. About 1.5 MB in total; `fonts/README.md` has the table with sources, commit and hashes.

| File | Size |
| --- | --- |
| `fonts/Inter.ttf` | 876 576 bytes |
| `fonts/PlayfairDisplay.ttf` | 300 724 bytes |
| `fonts/JetBrainsMono.ttf` | 187 208 bytes |
| `fonts/SpaceGrotesk.ttf` | 136 676 bytes |

## Downloaded on demand: the HDRIs

Environment maps are never committed. The `assets` command downloads them from Poly Haven (CC0) into `<data directory>/assets/hdri/` through the allowlisted downloader, verifies the pinned size and MD5 before the file is renamed into place, and records each one in `<data directory>/assets.json`, the asset ledger. The catalogue (`src/assets/catalogue.ts`) pins ten files, five HDRIs at 1k and 2k:

| HDRI | Lighting presets | 1k | 2k |
| --- | --- | --- | --- |
| Studio Small 09 | product-studio, three-point-soft, high-key, butterfly, overcast-soft, soft-cross | 1.6 MB | 6.3 MB |
| Brown Photostudio 02 | window, rembrandt | 1.6 MB | 6.5 MB |
| Studio Small 03 | low-key, split, rim-only, contre-jour, practical-glow, neon-rim | 1.7 MB | 6.7 MB |
| Kloofendal 48d Partly Cloudy (Pure Sky) | golden-hour | 1.4 MB | 5.5 MB |
| Moonless Golf | neon-night | 1.7 MB | 6.7 MB |

All ten together are about 40 MB. Commands:

```
node scripts/cli.ts assets                              # list the catalogue and what is installed
node scripts/cli.ts assets --fetch hdri:studio_small_09-1k,hdri:moonless_golf-1k
node scripts/cli.ts assets --all                        # every entry
node scripts/cli.ts assets --verify                     # re-hash every installed file against the ledger
node scripts/cli.ts assets --credits                    # CREDITS.md at <out>/CREDITS.md
node scripts/cli.ts assets --credits-path <path>        # CREDITS.md at the given path
```

When `--verify` finds a file that differs from the ledger it moves that file to `<file>.corrupt`, so the asset counts as not installed and the next `--fetch` of its id downloads it again; the command exits 1 with code `asset-integrity`.

A changed pin (Poly Haven re-exports a file) is a deliberate edit of the catalogue with a new date; the command never updates a pin from the network.

## Credits

`assets --credits` writes a CREDITS.md from the ledger and the font table above, so every deliverable can ship its attribution.
