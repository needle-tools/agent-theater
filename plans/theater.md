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

---

# Reported, 2026-09-03

From a run of "The Paper Bird Learns to Fly" — four scenes, 54 pieces. Seven
things were wrong with it, and they fall into three groups: broken, missing,
and available-but-unused. The third group is the interesting one, because
everything in it works and none of it was reached for.

## Fixed

**The saved play was full of holes.** The exported PNG had the sky punched out
in yellow and black speckles. Not the export: the backdrop had been through the
background remover, which looks for a *subject*, found the trees, and threw the
sky away. Backdrops are trimmed by `paperBox` now — arithmetic that can crop
blank paper and cannot decide that any of the picture is blank. Files saved
before that carry the damage and cannot be repaired.

**No pauses between speakers.** There was no way to write one: every beat had to
be somebody doing something. `wait` is a beat with nothing in it, and a 700ms
breath now goes in automatically between two *different* speakers. Not within
one person's own lines — that pause is a hesitation, which is deliberate.

## Built in response

**One character, several pictures.** A cut-out can only do what its drawing
does. `becomes` on a beat swaps the picture while the part keeps its place,
size and rotation — a bird with folded wings becomes the drawing of a bird with
open wings, standing where it stood. Ask for both on the same sheet and they
match. The costume is presentational: a scene played again opens in the first
one.

## Also built in response

**Nothing idles.** Between beats the stage is completely still, which reads as a
freeze rather than as a pause. Every character is a cut-out with no motion of
its own, so a scene with a long line in it is a photograph with text over it. A
slow per-character sway during a show costs nothing and is the difference
between a set and a diorama. Built: about a degree, offset per character from a
hash of its id so no two are in step, and on the `rotate` property rather than
`transform` — a beat animates `transform` through the Web Animations API, which
replaces the property outright, so the two compose instead of cancelling.

**The camera is never used, and so parallax never happens.** Camera beats exist,
`stage_script` asks for at least two and complains afterwards when there are
none, and it is still not being reached for. Parallax is the casualty: three
depth planes that only mean anything while the view is moving. The fix was
not more advice. A scene with no camera beats now gets an establishing move and
a push-in on its first speaker for free, so the default is a scene that moves.
The cost is real and is the right way round: a scene that wants one held wide
shot has to say so, and a held shot is a decision where a scene that never moves
because nobody thought about it is not.

**The music never changes.** Every scene can name its own bed, and they end up
with one between them. Nothing points this out: `stage_create` accepts whatever
it is given and says nothing about the shape of the whole show. `theater_start` now says so
when three or more scenes share one bed, in the NEXT line, where it is read.

## Still open

**Nothing checks that a feature is reachable.** `becomes` was built end to end —
the beat, the player, the canvas — and left out of the stage_script schema, so
no agent could use it. It typechecked, it had tests, and the tests exercised the
layer below the one that was missing. Everything that reaches an agent goes
through a tool schema, and nothing verifies that the schema mentions it.

**A missing tool reads as a refusal.** Asked to remove two empty scenes left
over from a reload, an agent had nothing between "leave them" and "clear the
whole canvas" — and correctly declined the second. The absence of a precise
tool made the safe answer the useless one, and from the outside it looked like
caution rather than a gap. `stage_remove` exists now; the general lesson is that
every edit a person can make by hand wants a tool of its own, or the agent ends
up choosing between doing nothing and doing too much.

**Nothing checks a show as a whole.** Every warning so far is about one scene,
or one placement. Nobody looks at four scenes together and says the middle two
are the same scene twice, or that nothing changes pace from beginning to end.

## The pattern worth naming

Five of the seven were features that already existed and were not used. Advice
in a tool description is weak — it is read once, in a list of twenty other
descriptions, at the moment the agent is deciding something else. Two things
have actually worked: making the *reply* say what is wrong after the fact
(`thin`, "standing in mid-air", "NEXT:"), and making the good thing the
default so that not deciding produces it. Prefer both over another sentence in
a description.

---

# Wanted: more than one play at a time

Today there is exactly one saved play, and it is a singleton by construction:
`needle-collage/doc/v1` in localStorage holds the document, one IndexedDB store
holds the image blobs, and a sweep deletes any blob no live layer refers to.
Starting something new means clearing the stage, which throws the old one away.
Saving to a file is the only way to keep a play, and loading it back *adds* to
whatever is already there rather than opening it.

That is the wrong shape for how this is actually used. A play takes an hour of
casting and blocking and scripting; wanting a second one is not a reason to lose
the first.

## What it should be

**A new play starts a new save, and the old one stays.** The document key becomes
a library — several documents, each with an id, a title and a modified date —
and the page opens whichever was last in front. "New play" is then the cheap
operation it sounds like, rather than a destructive one that needs a warning.

**The menu grows a list.** It is already down to Save, Load and Clear, so this is
the natural third thing: the plays in this browser, newest first, with the one
you are in marked. Clear stops meaning "throw the work away" and starts meaning
"empty this play", which is a much less frightening button.

**The agent gets the same view.** `theater_start` says what is on this page; it
should be able to say what else is in the drawer, and `stage_*` should have a
sibling for switching between plays. Otherwise the person and the agent are
looking at different libraries.

## What makes it harder than it looks

**The image blobs are shared and the sweep is global.** Two plays that both use
the same cut-out should not store it twice, and deleting one play must not
delete a picture the other is still standing on. The sweep currently asks "is
any live layer using this key" against a single document; it would have to ask
it against every document in the library, and be certain it has them all before
it deletes anything. Getting that wrong destroys the other play silently, which
is the worst failure this codebase could have.

**Storage is finite and nobody is watching it.** One play with fifty pieces is
already tens of megabytes of blobs. A drawer full of them will hit a quota, and
the failure mode of localStorage and IndexedDB under pressure is an exception at
save time — which currently just logs. A library needs a size somewhere in the
interface, and a story for what happens when the browser says no.

**Undo does not know about plays.** History is per-document today. Switching
plays mid-edit either carries the history across, which lets you undo into
somebody else's play, or drops it, which loses work quietly. Per-play history
is the honest answer and needs `Collage` to own more than one.

## Then: publishing

If the drawer works, the obvious next step is getting a play out of the browser
and to somebody else. The `.play.png` already carries everything — pieces,
scenes, script, title — so the format is done; what is missing is a place to put
it and a way to open one without downloading it first.

Worth saying plainly before any of it is built: publishing turns a private
document into a public one, and everything in this file so far has assumed the
canvas is the person's own. A published play carries generated artwork, the
name they gave it, and whatever their agent wrote — so it needs an explicit
step, a visible URL, and a way back out. Not a checkbox in a menu.

---

# Review, 2026-09-03: why the plays are shallow

The tool surface is 20 tools and mechanically sound — an agent can get art,
cut it, cast it, script it and play it, and the recent fixes mean it can also
check its own work. The plays are still thin. Two ceilings, and they are
different problems.

## The acting ceiling (yes, partly "skills")

**Nobody can face the other way.** *Built.* `flip` on the placement (per scene,
because the wolf faces left in the forest and right outside the cottage), a
`turn` move that spins the cut-out like a card — edge-on at the midpoint — and
commits the flip the way a walk commits its travel. The primitive is "the
artwork is mirrored" rather than "facing: left", because nobody can know which
way a drawing natively faces except by looking at it.

**Nine moves, all generic.** walk, jump, shake, surprised, scared, nod, bow,
enter, exit. Nothing to point with, laugh with, cry with, sleep, dance, fall,
or hand somebody something. The phase-4 vocabulary never got built, and a
scene's emotional range is capped by it.

**Strictly one thing at a time.** *Built:* `with: true` runs a beat alongside
its predecessor — bounded simultaneity, not a timeline. A group is as long as
its longest member, no breath is inserted in front of a deliberate overlap,
and the player cancels every member on stop. Fixing this exposed something
worse: a beat with both a move and a line silently DROPPED the move — every
`{do: "surprised", say: "…"}` an agent ever wrote played as standing still.
They run together now, which alone accounts for a lot of "no animation".

**Speakers stand still while speaking.** *Built:* a quick small bob on the
`translate` property while a line types — composing with the sway on `rotate`
and with a beat's own `transform`, so somebody can bob while walking and both
read.

## The story ceiling (not skills — the flow)

**Nothing ever asks for a story.** *Addressed in words.* theater_start now
opens with THE STORY COMES FIRST — who wants what, what stands in the way,
what changes, said to the person in two sentences before any art — and
stage_script asks that every scene turn on something. Words are the weak tool
(see the pattern below), so if plays stay shallow the next step is structural:
a story the tools require, not request.

**Everything is written blind, upfront, once.** *Built:* `show_play` takes
`hold: true` — play some scenes, hold the stage lit and scored on the last
frame, narrate, write the next scene having seen this one, continue; a call
without hold brings the curtain down. The scene-by-scene loop is now the
recommended default in the guide.

**The budget goes to assets.** Three generations and a cutting pass dominate
the session; the script gets what is left. This is why the troupe matters more
than it looks: it is not a convenience, it is where the storytelling budget
comes from.

## The troupe — pipeline built, awaiting packs

The plumbing is in and idle: `static/troupe/README.md` documents the pack
convention (precut webps + manifest, `take` grouping poses for `becomes`,
`<name>.5x5.webp` for uncut sheets), `tools/troupe.mjs` (`npm run troupe`)
generates the catalogue module, and `theater_troupe` lists-and-adds — and
unregisters itself entirely while the drawer is empty, so the empty state
costs zero tool surface. theater_start points at the drawer first once packs
exist. What remains is the art itself.

A library of ready assets in `static/troupe/`, mirroring the audio pipeline
exactly (manifest → generated module → catalogue the agent reads):

- **Precut wins over sheets.** Precut transparent webps skip the 30 MB model
  download and the cutting pass entirely — the first scene can exist seconds
  after the conversation starts. Sheets-to-cut are still worth accepting for
  bulk drops.
- Convention: `static/troupe/<pack>/<label>.webp` for precut pieces, plus a
  `manifest.json` per pack naming each piece's kind (backdrop | scenery |
  actor), mood tags, and which pieces are the same character in another pose
  (`take`, exactly as sounds do it). Sheets: `<name>.<cols>x<rows>.webp`, grid
  read from the filename.
- `tools/troupe.mjs` generates `troupe.ts`; a `theater_troupe` tool lists the
  catalogue the way `show_sounds` does, and `piece_add` takes the local path.
- The same-character-other-pose grouping is what makes `becomes` usable off
  the shelf.

## Progressive playback — built

`show_play` holds between calls: no title card on resume, music surviving the
hold, curtain call only on a call without `hold`. Untested against a real
voice agent yet; the thing to watch is whether it actually uses the loop or
still fires everything in one call.

## TODO: the tempo panel (debug tools)

Every timing in the show — ms per character, move durations, breath, hold,
sway, typing share — is a constant somebody guessed. A debug section in the
menu with sliders that change them LIVE during a rehearsal, persisted in
localStorage, with a "copy settings" button that puts the JSON on the
clipboard — so the person tunes by eye and hands the numbers back to be made
the defaults. The knobs live in one `tempo` object that perform.ts reads
instead of its constants.

---

# Wanted, 2026-09-03: looser stages, recorded motion, things holding things

Three ideas from watching real plays get made. They share a theme: the stage
is currently more formal than the toy it wants to be.

## Looser stages — depth as a treatment, not a requirement

A scene currently wants dedicated backdrop art before it feels like a place.
The idea: let plays happen in the open — on the bare paper — with depth as a
VISUAL TREATMENT instead of an art requirement. An object sent to the back
plane gets pushed back visually: scaled down, desaturated, or rendered as a
flat fill with transparency — a paper silhouette at dusk — and front-plane
decoration likewise darkened or translucent. Then a play is just objects
moving across the screen and the available space.

Most of the machinery exists. The silhouette fill is already in LayerStyle
and both renderers; the scene tint knows what colour the room is; planes
already exist per placement. What is missing is the automatic treatment
(plane + no backdrop → silhouette in the tint at some alpha) and loosening
the camera and parallax, which both currently sit down when there is no
backdrop: stageRect() should fall back to the cast's own bounds as anchor.

## The motion recorder — imperfection you can perform

Programmed easing is exactly too perfect, and that is why the wobbles read
as software. The tool: press record, drag a piece around (or wiggle it, for
a talking motion), stop, name it. The samples become keyframes — times and
positions normalised, offsets stored relative to the piece's own size so a
clip scales across scenes — playable through the same WAAPI path as the
built-in moves.

Two uses, and the second is the bigger one:
- A clip becomes a move an agent can call: `do: "clip:limp"` alongside walk
  and jump, listed in the stage_script enum like everything else.
- A clip can REPLACE a built-in: record a hand-made talking wobble and an
  idle sway once, and every character inherits the human imperfection.

Clips live in localStorage with export-as-JSON (and export-as-CSS-keyframes
for use outside), managed from a small record control in the menu's debug
corner. Recording is a person's act; the agent only ever plays clips.

## Parenting — hold, carry, sit, drop

The agent needs things to belong to other things: a character holds a
basket, sits on a vehicle, and they move together; later the basket is
dropped and stays where it fell.

Design decision to make early: children do NOT become DOM children. Nesting
would make transforms compose for free and destroy z-ordering across planes
(a rider must be able to paint on a different plane than the vehicle).
Instead: `on: <parentId>` on the placement, `at` becoming parent-relative
while attached, and the child riding the parent's beats by receiving the
same translation keyframes — identical deltas, so a walk moves both as one.
Rotating/scaling poses (jump squash) will not perfectly deform the child
with the parent; accepted, cut-outs are rigid props in hands anyway.

Beats: `take` (animate the object into the holder's slot over ~300ms, THEN
set the parent — reparenting must read as a reach, not a teleport), `drop`
(detach, small fall to the ground line, stays). stage_describe reports who
holds what. Save format carries `on` through renamedIn like everything else.

## Suggested order

Recorder first (it feeds everything: better talk, better sway, custom moves
for free), then parenting (biggest scene-vocabulary win), then loose stages
(mostly treatment + two fallbacks). Each is buildable alone.
