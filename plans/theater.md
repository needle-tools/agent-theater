# The theatre show player

Turning the collage canvas into something an agent can stage a play on: named
stages with a cast, a vocabulary of skills the cast can perform, and a show mode
that runs the stages one after another while the agent narrates aloud.

Status: **planned**. The performance engine (`perform.ts`, `collage_perform`)
exists and works; everything below either builds on it or replaces it for a
stated reason.

---

## What decides the design

Four constraints, in the order they matter.

**An agent cannot animate.** A tool call is a round trip of hundreds of
milliseconds; a walk cycle is sixty frames a second. Anything driven call by
call is a slideshow. The agent hands over a whole script and the page plays it —
already true of `collage_perform`, and the rule the rest follows.

**The agent narrates live.** ChatGPT voice is speaking while the show runs, so
`show_play` must return at once with the timings rather than blocking for the
length of a scene. Timing information in the result is what lets narration land
on the beat.

**A person is editing at the same time.** The canvas stays a canvas. Anything
the agent believes about positions can be stale by the time it acts, so every
tool result carries what changed underneath since that agent last looked.

**Nothing transient touches the document.** A three-second walk is not 180 edits
in undo and IndexedDB. Animation is presentational; only deliberate moves commit.

---

## Data model

Three new things, all on the existing document so they save and restore with it.

```ts
interface Stage {
    id: string;
    name: string;
    /** Layer id of the backdrop, drawn behind the cast and never acting. */
    backdrop: string | null;
    /** Who is on this stage, and where they stand while it plays. */
    cast: Array<{
        id: string;                       // an existing layer
        x: number; y: number;             // where it sits ON THIS STAGE
        width?: number;
        rotation?: number;
        /** How it arrives during build-up. */
        entrance?: EntranceName;
        /** Paint order within the stage. */
        z?: number;
    }>;
    /** What happens once the stage has built up. */
    script: Beat[];
    /** Seconds held after the script before moving on. 0 = go straight on. */
    hold?: number;
}

interface Show {
    stages: string[];    // stage ids, in running order
    /** Where the show is now, when one is running. */
    at?: { stage: number; started: number };
}
```

The crucial choice: **a stage references layers, it does not own them.** A layer
belongs to the canvas; a stage records where that layer stands *while this stage
plays*. So one character can appear in scenes one and three at different spots
without being duplicated, and editing the character edits it everywhere.

Placements are per-stage; the document's own `x`/`y` is what the canvas shows
when no stage is active.

---

## Skills

All eight existing moves plus the three groups asked for. Each is a keyframe set
with a natural duration, sized against the layer it plays on so a small sprite
makes a small movement.

**Acting** (on a cast member)
`walk` `jump` `shake` `surprised` `scared` `nod` `think` `wave` `point` `laugh`
`cry` `angry` `sleep` `dance` `fall` `turn`

**Staging** (getting on and off, and swapping)
`enter` `exit` `slideIn(side)` `dropIn` `riseUp` `growIn` `spinIn` `swap(with)`

**Camera and stage** (on the whole stage, not one actor)
`stageShake` `zoomTo(id)` `pan(to)` `flash` `dim(except)` `spotlight(id)`

Camera skills are the one place a beat does not target a cast member. They apply
to the stage's own transform, which is a wrapper element around the cast —
already how the canvas draws the world, so this is a second transform on a
second wrapper rather than anything new.

`say` stays as it is: a bubble above a cast member, typed in, held for reading
time.

---

## Engine: keyframes instead of a compositor

Sequential-only playback is the reason to change engines, and it is worth being
explicit about why.

The current engine composes: two beats on one layer at the same instant add
their offsets, which needs a `requestAnimationFrame` loop that samples every
active beat each frame and sums them. That is the right design for overlapping
beats and the wrong one for a queue.

With one beat at a time, each becomes a **keyframe set handed to the Web
Animations API**. What that buys:

- `transform` and `opacity` animations run on the **compositor**, so a beat stays
  smooth while the main thread is busy — and it demonstrably is: a trace blocks
  it for seconds.
- The browser owns timing, easing and interruption. No frame loop of ours.
- Beats become data (`Keyframe[]` plus a duration), which stays as testable as
  the pose functions are now.

What it costs: composition, which is exactly what we are giving up anyway.

`perform.ts` keeps its shape — a vocabulary of named moves, pure and testable —
but each move returns keyframes rather than a pose at time *t*. The existing
tests translate almost directly: "ends at rest" becomes "the last keyframe is
the identity transform", which is a stronger statement and easier to check.

---

## Tool surface

Authoring stays as it is, trimmed. The show is new, and small.

### Authoring (already exists)

`collage_describe` `collage_add_image` `collage_add_text` `collage_set_text`
`collage_transform` `collage_style` `collage_trace` `collage_arrange`
`collage_set_page` `collage_select` `collage_remove` `collage_remove_background`
`collage_capture` `collage_preview` `collage_export` `collage_batch`
`collage_watch`

`collage_perform` is **replaced** by `stage_script` + `show_play`. Playing an
ad-hoc sequence outside a stage stops being a thing you can do — a beat belongs
to a scene.

### The show (new)

| Tool | What it does |
|---|---|
| `stage_create` | Make a named stage. Optionally set the backdrop and the running order. |
| `stage_cast` | Put layers on a stage: who, where, how big, how they enter. Replaces or adds. |
| `stage_script` | The beat list for a stage. Sequential, one beat at a time. |
| `stage_describe` | Every stage, its cast, its script, and where the show is up to. |
| `show_play` | Enter show mode and run from a stage. Returns at once with the timeline. |
| `show_stop` | Leave show mode, back to the canvas as it was. |

`stage_script` takes the same cue shape as today minus the timing arithmetic,
because sequential playback means a beat starts when the last one ends:

```
stage_script({ stage: "rooftop", beats: [
  { id: "hero-1", do: "walk", to: { x: 300 } },
  { id: "hero-1", say: "Nobody followed me." },
  { id: "hero-2", do: "enter" },
  { id: "hero-1", do: "surprised" },
  { with: "stage", do: "zoomTo", target: "hero-2" }
]})
```

`with: "stage"` is how a camera beat is written, so the target of every beat is
explicit and an agent never has to know which skills are camera skills.

---

## Show mode

A mode, not a view. Editing chrome disappears, the surround darkens, and the
canvas plays.

Each stage runs the same three phases:

1. **Build-up** — backdrop fades in, then cast members arrive in their `entrance`
   order, staggered. Generated, not scripted: an agent that had to write the
   build-up for every scene would write six near-identical scripts.
2. **The script** — beats in order.
3. **Hand-off** — hold for `hold` seconds, fade out, next stage fades in.

`show_play` returns immediately with each stage's start time and duration, so a
narrating agent knows when to say what without polling. `collage_watch` still
reports progress for anything that wants to follow along.

---

## Seeing the person's edits

A cursor per agent session over the existing event log. Every tool result gains
a line when anything has happened since that agent's last call:

> 3 layers changed since you last looked — 2 moved by the person.

Only when there is something to say, so a working agent is not told "nothing
changed" fifteen times a minute. This closes the failure seen earlier in the
session, where an agent acted on a picture of the canvas that was two minutes
old and reported the result confidently.

---

## Phases

**1 — Stages.** The data model, `stage_create` / `stage_cast` / `stage_describe`,
persistence, and the canvas drawing one stage at a time. No animation changes.
Testable end to end: build three stages, reload, they are still there.

**2 — Keyframe engine.** Port the eight existing moves to keyframes and WAAPI,
sequential queue, `stage_script`. Existing tests carry over. `collage_perform`
goes.

**3 — Show mode.** Build-up, hand-off, `show_play` / `show_stop`, the darkened
surround. This is when it first looks like a show.

**4 — The rest of the skills.** Acting, staging and camera groups. Cheap once
the engine is in: each is keyframes and a duration.

**5 — Sound.** A manifest mapping cue names to files, `sound` beats in a script,
music per stage with cross-fade. Waiting on the actual files; the hooks are
designed so adding them is a manifest edit rather than a code change.

Each phase leaves the thing working. Nothing here needs a big-bang cutover
except the engine swap in phase 2, which is one file and its tests.

---

## Risks worth naming

**The engine swap is a real rewrite.** `perform.ts` is 350 lines with 29 tests.
Keyframes are a better fit, but this is a rewrite and not a refactor, and the
argument for it rests entirely on sequential playback staying sequential. If
overlapping beats come back, the compositor was right.

**Per-stage placement fights the canvas.** A person dragging a character while a
stage is active is editing the stage's placement, not the document's — and that
needs to be obvious in the interface, or edits will appear to vanish when the
stage changes.

**Build-up is generated, so it will be wrong sometimes.** A scene that wants a
specific arrival will need a way to override it. `entrance` per cast member is
the first answer; a full custom build-up script is the escape hatch if that is
not enough.

**Voice timing is open.** The agent knows the timings and can narrate to them,
but nothing synchronises the two. If drift turns out to matter, the fix is for
the show to emit beat-boundary events the agent can follow — which the event log
already supports.
