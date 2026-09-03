# The troupe

Ready-made art that ships with the theatre. Anything in here is on stage
seconds after a conversation starts — no generation, no cutting — which is the
whole point: the minutes an agent does not spend on art round-trips are the
minutes the story gets.

## A pack

One folder per pack, holding **precut** webp pieces and a `manifest.json`:

```
static/troupe/
  woodland/
    manifest.json
    forest-day.webp
    wolf.webp
    wolf-leaping.webp
    big-oak.webp
```

- **Actors and scenery are transparent cut-outs** — no background, no white
  margin, no drop shadow baked in. The page adds its own shadow.
- **Backdrops are full-bleed** cards, ideally wide (21:9-ish) so the camera has
  somewhere to go. Torn edges are fine; a white sheet around them is not.
- webp or png, reasonably large — a backdrop fills the whole stage, so 1600px+
  wide is worth it; scenery and actors want ~400px+ on their long side, or the
  camera pushing in on them finds pixels.

## The manifest

```json
{
    "name": "woodland",
    "description": "A daylight forest: trees, mushrooms, a wolf and a girl.",
    "pieces": {
        "forest-day": {
            "kind": "backdrop",
            "file": "forest-day.webp",
            "mood": ["sunny", "calm"],
            "description": "far trees and sky, empty middle"
        },
        "wolf": {
            "kind": "actor",
            "file": "wolf.webp",
            "take": "wolf",
            "description": "standing, side on, facing left"
        },
        "wolf-leaping": {
            "kind": "actor",
            "file": "wolf-leaping.webp",
            "take": "wolf",
            "description": "mid-leap, facing left"
        },
        "big-oak": { "kind": "scenery", "file": "big-oak.webp" }
    }
}
```

- `kind` is one of `backdrop | midground | foreground | scenery | actor` and
  decides how a piece arrives (backdrops and scene layers at stage width,
  everything else cut-out sized).
- `midground` and `foreground` are **scene layers**: full-width slices of one
  set, transparent where the layer behind should show through, drawn to stack
  exactly on that pack's backdrop. Three files, one room, instant parallax —
  the bedroom pack is the pattern.
- `take` groups pieces that are **the same character in another pose** —
  exactly as alternate audio takes work. This is what makes mid-scene costume
  changes (`becomes`) usable off the shelf, so when you draw a character, draw
  two or three poses and give them one `take`.
- `description` and `mood` are for the agent choosing between pieces; write
  them the way the sound manifest does.
- Note which way a character faces in the `description` — the agent can flip
  them, but only if it knows.
- **Record the generation prompt** in a top-level `"stylePrompt"` field on the
  manifest — the actual prompt the pack's images were made with. It is the only
  way an agent can later generate a new piece that matches the pack: the style
  lives in the prompt, and nothing the pixels can say will reproduce it.

## Uncut sheets

A sheet that has not been cut yet can sit next to the packs, named with its
grid: `woodland-props.5x5.webp`. It is listed as a sheet and the agent is told
to run it through `piece_sheet` — useful for bulk drops, slower than precut.

## After adding or changing anything

```
node tools/troupe.mjs
```

regenerates `src/lib/collage/troupe.ts`, which is what the page actually
reads. Commit both.

## The shelf

`static/troupe/manifest.json` controls the small human-facing shelf without
changing the packs themselves. `shelf.assorted` defines the ordered everyday
piles and may combine packs or select only particular `kinds` (useful for a
clearly labelled actor pile). `shelf.themes` lists only packs complete enough
to offer as a whole themed set. Run the generator after editing it too.
