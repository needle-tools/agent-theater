/**
 * The scene tools.
 *
 * Separate from the collage tools because they are a different job: those are
 * for making things, these are for deciding which things are in which scene and
 * where they stand in it. An agent building a show uses both — it draws the
 * cast with piece_add and then blocks them with these.
 *
 * The one idea to hold on to: a stage does not own its layers. It records where
 * they stand while it is playing. So the same character appears in scene one and
 * scene three at different places, and recolouring it changes it in both.
 */
import { MOVES, plan as planScene, type Beat } from "./perform.js";
import { creditsFor } from "./billboard.js";
import { findSound, soundCatalogue, soundNames } from "./audio.js";
import { ENTRANCES, PLANES, type Placement, type Stage } from "./stage.js";
import type { Layer } from "./model.js";
import type { CollageStudio } from "./studio.js";
import type { ToolResult, WebMcpToolDef } from "./tools.js";

const ok = (text: string, structured?: object): ToolResult => ({
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
});

const fail = (text: string, structured?: object): ToolResult => ({ ...ok(text, structured), isError: true });

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * A boolean from an agent, which is not always a boolean.
 *
 * Models send `"false"`, `"no"` and `0` for false often enough that a plain
 * `!== false` check reads every one of them as true — and the failure is
 * silent, because the tool does exactly what it was asked and the caller sees
 * the opposite. `rehearse: "false"` played a scene that was meant to be written
 * quietly. Same lesson as `str()`: never trust the shape, only the meaning.
 */
const bool = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const word = value.trim().toLowerCase();
        if (["false", "no", "off", "0", ""].includes(word)) return false;
        if (["true", "yes", "on", "1"].includes(word)) return true;
    }
    return fallback;
};


export function createStageTools(studio: CollageStudio): WebMcpToolDef[] {
    const { collage } = studio;

    /** The stage being talked about: the one named, or the one on screen. */
    const resolve = (id: string): { stage: Stage } | { error: ToolResult } => {
        if (id) {
            const stage = collage.getStage(id);
            return stage ? { stage } : { error: fail(`There is no stage with id "${id}". Call stage_describe.`) };
        }
        const showing = collage.activeStage;
        if (showing) return { stage: showing };
        const all = collage.listStages();
        if (all.length === 1) return { stage: all[0] };
        return {
            error: fail(all.length
                ? `Which stage? Pass "stage" — there are ${all.length} and none is being shown.`
                : `There are no stages yet. Make one with stage_create.`),
        };
    };

    /**
     * A fraction of the backdrop, in canvas coordinates.
     *
     * `at.y` is where the FEET go, not the top of the picture, because that is
     * what somebody placing an actor means: "standing on the ground" is a
     * statement about the bottom of them. Getting this backwards puts a tall
     * character's head where their boots should be and hangs the rest off the
     * bottom of the set.
     *
     * With no backdrop there is nothing to be a fraction of, and the honest
     * answer is none rather than a number relative to the whole canvas.
     */
    const placeOn = (
        floor: Layer | null,
        at: { x?: number; y?: number } | undefined,
        width: number,
        height: number,
        spread: { index: number; of: number } | null,
    ): { x: number; y: number } | null => {
        if (!floor) return null;
        const across = num(at?.x) ? at!.x!
            // Spread evenly along the ground: two actors at a third and two
            // thirds, one in the middle. Better than a pile in the corner, and
            // better than the canvas position they arrived with.
            : spread ? (spread.index + 1) / (spread.of + 1)
                : null;
        const up = num(at?.y) ? at!.y! : spread ? 0.92 : null;
        if (across === null || up === null) return null;
        return {
            x: floor.x + floor.width * across - width / 2,
            y: floor.y + floor.height * up - height,
        };
    };

    /**
     * A width that makes this piece the right height for the stage.
     *
     * Given as a fraction of the backdrop's height, because that is the only
     * measurement in the scene an agent can reason about: "half as tall as the
     * set" is a thing you can picture, and "two hundred and twenty canvas
     * units" is not.
     *
     * The default is a person's share of a stage. It is applied whenever nobody
     * has said otherwise, including to scenery — a tree at half the height of
     * the backdrop is wrong but sane, where a tree at its cut size is a tree
     * standing in front of the entire theatre.
     */
    const sizedToStage = (
        floor: Layer | null,
        layer: Layer,
        share: number | undefined,
    ): number | null => {
        if (!floor || layer.height <= 0) return null;
        // A piece as wide as the stage is a scene layer — a midground or
        // foreground slice — and slices keep the stage's width unless told
        // otherwise: sized "like a person" they would shrink to half a room.
        if (!num(share) && Math.abs(layer.width - floor.width) < 2) return null;
        const wanted = floor.height * (num(share) ? Math.max(0.02, Math.min(3, share!)) : 0.5);
        return (wanted / layer.height) * layer.width;
    };

    /**
     * Where a cast member stands, in the units it was placed with.
     *
     * The reason this exists is a bug that looked like the agent being stupid
     * and was not. It placed everybody in fractions of the backdrop — the units
     * stage_cast asks for — and then read the scene back in raw canvas
     * coordinates, which are the units nothing accepts. It could not check its
     * own work, so it stopped trusting the fractions and went back to guessing
     * absolute numbers, which is exactly what those fractions were introduced
     * to replace.
     *
     * Say it back in the language it was said in.
     */
    const relativeTo = (
        placement: Placement,
        floor: Layer | null,
    ): { x: number; feet: number; size: number } | null => {
        if (!floor || floor.width <= 0 || floor.height <= 0) return null;
        const layer = collage.get(placement.id);
        if (!layer) return null;
        const width = placement.width ?? layer.width;
        const height = layer.width > 0 ? (width / layer.width) * layer.height : layer.height;
        return {
            x: (placement.x + width / 2 - floor.x) / floor.width,
            // Feet, not the top: it is what "at" means, and the difference is
            // the whole of a tall thing.
            feet: (placement.y + height - floor.y) / floor.height,
            size: height / floor.height,
        };
    };

    const describeMember = (placement: Placement, floor: Layer | null): string => {
        const where = relativeTo(placement, floor);
        const name = `${placement.id}${placement.as ? ` as ${placement.as}` : ""}`;
        const at = where
            ? `at x ${where.x.toFixed(2)}, feet ${where.feet.toFixed(2)}, size ${where.size.toFixed(2)}`
            // No backdrop, nothing to be a fraction of. Raw units are all there
            // is, and saying so is better than implying they mean something.
            : `at ${Math.round(placement.x)}, ${Math.round(placement.y)} (no backdrop to measure against)`;
        return `${name} ${at}` +
            `${placement.flip ? " (flipped)" : ""}` +
            `${placement.plane && placement.plane !== "mid" ? ` [${placement.plane}]` : ""}` +
            `${placement.entrance ? ` (enters ${placement.entrance})` : ""}`;
    };

    /** Does any of this placement land on the backdrop at all? */
    const overlapsFloor = (
        placement: Placement,
        width: number,
        height: number,
        floor: Layer,
    ): boolean =>
        placement.x < floor.x + floor.width && placement.x + width > floor.x &&
        placement.y < floor.y + floor.height && placement.y + height > floor.y;

    return [
        {
            name: "stage_remove",
            title: "Take a scene out of the show",
            annotations: { readOnlyHint: false, destructiveHint: true },
            description:
                "Delete scenes by id. Only the scenes: every picture in them stays on the canvas, " +
                "because a scene records where things stand rather than owning them — so removing the " +
                "scene an actor was in does not remove the actor. Undoable, like anything else here. " +
                "This is the tool for tidying up a false start: two empty scenes left over from a " +
                "reload should be removed, not worked around, and NOT by clearing the whole canvas.",
            inputSchema: {
                type: "object",
                properties: {
                    stages: {
                        type: "array",
                        items: { type: "string" },
                        description: "Scene ids to delete. Call stage_describe for what there is.",
                    },
                },
                required: ["stages"],
            },
            async execute(args: { stages?: string[] }) {
                const wanted = (Array.isArray(args?.stages) ? args.stages : []).map(str).filter(Boolean);
                if (!wanted.length) {
                    return fail(`Pass "stages" — the ids of the scenes to delete.`);
                }
                // Named rather than described: "the empty ones" is a rule, and a
                // rule applied to somebody else's document deletes the wrong
                // thing eventually. Ids are checked before anything goes.
                const missing = wanted.filter(id => !collage.getStage(id));
                if (missing.length) {
                    return fail(
                        `No scene called ${missing.map(id => `"${id}"`).join(", ")}. Nothing was ` +
                        `removed — call stage_describe for the ids.`);
                }

                const gone = collage.batch(() =>
                    wanted.map(id => collage.removeStage(id)).filter(Boolean) as Stage[]);
                studio.save();
                studio.record("page-changed",
                    `${gone.length} scene(s) removed.`, "agent");

                const left = collage.listStages();
                return ok(
                    `Removed ${gone.map(stage => `"${stage.name}"`).join(", ")}. ` +
                    `Their pieces are still on the canvas. ` +
                    (left.length
                        ? `${left.length} scene(s) left: ${left.map(s => `"${s.name}"`).join(", ")}.`
                        : `No scenes left — the canvas shows everything at once again.`),
                    { removed: gone.map(stage => stage.id), stages: left });
            },
        },
        {
            name: "show_title",
            title: "Name the piece",
            annotations: { readOnlyHint: false },
            description:
                "Give the show a name. It opens on a title card over a dark stage before the first scene, " +
                "and the name heads the credits at the end. Worth doing: a play that starts by simply " +
                "beginning is a canvas moving, and one that starts with its name on the screen is a play. " +
                "The credits themselves are built from the cast — give each one an \"as\" in stage_cast and " +
                "they are listed as \"grandmother — played by …\".",
            inputSchema: {
                type: "object",
                properties: {
                    title: { type: "string", description: "What the piece is called. Pass '' to drop the card." },
                    byline: {
                        type: "string",
                        description:
                            "The smaller line under it — 'a play in two scenes', 'after Grimm'. Optional.",
                    },
                },
            },
            async execute(args: { title?: string; byline?: string }) {
                const title = typeof args?.title === "string" ? args.title.trim() : undefined;
                const byline = typeof args?.byline === "string" ? args.byline.trim() : undefined;
                if (title === undefined && byline === undefined) {
                    return fail(`Pass "title" — what the piece is called.`);
                }
                const billing = collage.setBilling({
                    ...(title !== undefined ? { title } : {}),
                    ...(byline !== undefined ? { byline } : {}),
                });
                studio.save();
                studio.record("page-changed",
                    billing.title ? `The show is called "${billing.title}".` : `The show lost its title.`,
                    "agent");

                const credits = creditsFor(collage.listStages(), id => collage.get(id)?.label ?? null);
                return ok(
                    (billing.title
                        ? `The show is called "${billing.title}"${billing.byline ? ` — ${billing.byline}` : ""}. ` +
                          `It opens on a title card.`
                        : `The title card is off.`) +
                    (credits.length
                        ? ` ${credits.length} in the credits` +
                          `${credits.some(c => !c.role)
                              ? `, though ${credits.filter(c => !c.role).length} of them are credited by ` +
                                `filename — give them an "as" in stage_cast to be named.`
                              : `.`}`
                        : ``),
                    { billing, credits });
            },
        },
        {
            name: "show_sounds",
            title: "What there is to play",
            annotations: { readOnlyHint: true },
            description:
                "Every piece of music and every sound effect, with what it sounds like. Call it once before " +
                "choosing: the ids alone do not tell you which of eight beds suits a scene, and picking by " +
                "name is picking at random.",
            inputSchema: { type: "object", properties: {} },
            async execute() {
                return ok([
                    `Music beds — one per scene, looping, cross-fading into the next:`,
                    ...soundCatalogue("bed").map(line => `  ${line}`),
                    ``,
                    `Stings and effects — for a beat's "sound":`,
                    ...soundCatalogue("cue", "sfx").map(line => `  ${line}`),
                    ``,
                    `Set a scene's bed with stage_create music, and fire a sting with a beat's sound.`,
                ].join("\n"), { beds: soundNames("bed"), cues: soundNames("cue", "sfx") });
            },
        },
        {
            name: "show_play",
            title: "Put the show on",
            description:
                "Run scenes. Pass hold:true to play SOME scenes and then HOLD — the stage stays lit, the " +
                "music keeps playing, and the last frame stands — so you can narrate what happened and " +
                "write the next scene AFTER seeing this one. Call again with the next stage to continue; " +
                "a call without hold ends with the curtain call and credits. This scene-by-scene loop is " +
                "how a play stays in step with a story being told aloud, and it is the better default. " +
                "Run the scenes one after another. Each one builds up — everybody with an entrance arrives — " +
                "then its script plays, then they leave and the next scene begins. Returns the whole timetable " +
                "at once and keeps playing, so you know when each scene starts and can narrate to it rather " +
                "than waiting. The build-up and the exits are made for you; you only write what happens in " +
                "between, with stage_script.",
            inputSchema: {
                type: "object",
                properties: {
                    stages: {
                        type: "array",
                        items: { type: "string" },
                        description: "Scene ids, in the order to play them. Omit for all of them, as created.",
                    },
                    hold: {
                        type: "boolean",
                        description:
                            "Hold the stage after these scenes instead of ending: lights stay down, music " +
                            "keeps playing, last frame stands. Continue with another show_play; end with " +
                            "one that leaves this off.",
                    },
                },
            },
            async execute(args: { stages?: string[]; hold?: boolean }) {
                // A held show is waiting to be continued — that is the point of
                // the hold, so continuing must not be refused as a restart.
                if (studio.showing && !studio.holding) {
                    return fail(`The show is already running. Stop it with show_stop before starting another.`);
                }
                const wanted = (Array.isArray(args?.stages) ? args.stages : []).map(str).filter(Boolean);
                const missing = wanted.filter(id => !collage.getStage(id));
                if (missing.length) {
                    return fail(`No scene called ${missing.map(id => `"${id}"`).join(", ")}. Call stage_describe.`);
                }
                if (!collage.listStages().length) {
                    return fail(`There are no scenes to play. Make one with stage_create.`);
                }

                const hold = bool(args?.hold, false);
                const { timings, duration } = studio.playShow(
                    wanted.length ? wanted : undefined, { hold });
                if (!timings.length) return fail(`Nothing to play.`);

                // Sound is the one thing that can fail silently, and an agent
                // narrating "and the music swells" over nothing is worse than
                // no music at all. Said plainly, in the reply it is reading
                // anyway, because there is no other channel to say it on.
                const silent = !studio.speaker.ready;
                // A show in a background tab runs perfectly and is seen by
                // nobody. Worth more than a note: it is the difference between
                // a performance and a rehearsal in an empty theatre, and an
                // agent that reported success would be reporting the wrong
                // thing entirely.
                const unseen = typeof document !== "undefined" && document.visibilityState === "hidden";
                return ok(
                    [`The show is running — ${timings.length} scene(s), ${(duration / 1000).toFixed(1)}s. ` +
                     `Narrate along with it; do not wait for it.`,
                     ...(hold
                         ? [`It will HOLD after "${timings[timings.length - 1].name}" — lights down, ` +
                            `music playing, last frame standing. Narrate, write the next scene now that ` +
                            `you have seen this one, then show_play again with the next stage. Leave ` +
                            `"hold" off on the last call to bring the curtain down.`]
                         : []),
                     ...(unseen
                         ? [`NOBODY CAN SEE THIS: the theatre tab is in the background or minimised, so ` +
                            `the show is playing where the person is not looking. Ask them to bring it ` +
                            `to the front — then show_stop and show_play again from the start.`]
                         : []),
                     ...(silent
                         ? [`NO SOUND YET: the browser refuses audio until the person has clicked or ` +
                            `typed on the page, and they have not. The music and the stings will not be ` +
                            `heard. Ask them to click the page — anywhere will do — and it will play ` +
                            `from then on. Do not narrate the music as though it were audible.`]
                         : []),
                     ...timings.map(t =>
                         `${(t.at / 1000).toFixed(1)}s  "${t.name}"  (${(t.duration / 1000).toFixed(1)}s)`),
                    ].join("\n"),
                    {
                        playing: true, timings, duration,
                        sound: silent ? "blocked" : "on",
                        visible: !unseen,
                    });
            },
        },
        {
            name: "show_stop",
            title: "Stop the show",
            annotations: { readOnlyHint: false },
            description:
                "Stop the show wherever it has got to. The scene it was on stays on screen, so the canvas is " +
                "left somewhere sensible rather than blank.",
            inputSchema: { type: "object", properties: {} },
            async execute() {
                if (!studio.showing) return ok(`Nothing was running.`, { stopped: false });
                const where = collage.activeStage?.name ?? "a scene";
                studio.stopShow();
                return ok(`Stopped during "${where}". It is still on screen.`, { stopped: true });
            },
        },
        {
            name: "stage_script",
            title: "Act out a scene",
            description:
                "Play a scene: who does what, and what they say, in order. Hand over the WHOLE scene in one " +
                "call — you cannot animate by calling a tool per frame, and you do not need to. The page " +
                "plays it and this returns at once with the timings, so you are free to narrate over the top. " +
                "One thing happens at a time: a beat starts when the last one ends, and there is no timing to " +
                "work out. The scene KEEPS its script, so show_play can run it again as part of the whole " +
                "show — pass rehearse:false to write it without playing it now. " +
                `Moves: ${MOVES.join(", ")}. "walk" and "jump" take a "to" and leave the layer there; ` +
                "everything else finishes exactly where it started.",
            inputSchema: {
                type: "object",
                properties: {
                    stage: { type: "string", description: "Which scene. Omit for the one being shown." },
                    rehearse: {
                        type: "boolean",
                        description: "Play it now as well as saving it. Default true.",
                    },
                    beats: {
                        type: "array",
                        description: "What happens, in order.",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string", description: "Who this beat is about." },
                                do: { type: "string", enum: [...MOVES], description: "What they do." },
                                say: { type: "string", description: "A line, in a bubble above them." },
                                sound: {
                                    type: "string",
                                    enum: soundNames("cue", "sfx"),
                                    description:
                                        "A sting fired as the beat starts. Rides along with a move rather " +
                                        "than taking its own time. Call show_sounds for what each is.",
                                },
                                to: {
                                    type: "object",
                                    description:
                                        "Where a walk or jump ends up, relative to now, in canvas units. " +
                                        "This is a FLAT stage seen from the front, so crossing it means " +
                                        "changing x — left and right. There is no into-the-distance to " +
                                        "walk into; y moves somebody up or down the picture, which is a " +
                                        "jump or a climb, not a journey.",
                                    properties: { x: { type: "number" }, y: { type: "number" } },
                                },
                                camera: {
                                    type: "object",
                                    description:
                                        "Move the view on this beat: push in on somebody, pull back to the " +
                                        "whole scene, or drift from one group to another. The camera keeps " +
                                        "moving for the beat's whole length, so \"duration\" is how slow it " +
                                        "is — 600ms is a snap, 3000ms is a drift. A camera beat needs no " +
                                        "\"id\"; it is about the view, not about anybody.",
                                    properties: {
                                        on: {
                                            description:
                                                "Layer ids to frame, or \"all\" for the whole scene.",
                                            oneOf: [
                                                { type: "array", items: { type: "string" } },
                                                { type: "string", enum: ["all"] },
                                            ],
                                        },
                                        tight: {
                                            type: "number",
                                            description:
                                                "How much of the view they fill. 1 is snug (default), 0.6 " +
                                                "leaves air around them, 1.4 is a close-up that crops.",
                                        },
                                    },
                                    required: ["on"],
                                },
                                becomes: {
                                    type: "string",
                                    description:
                                        "Another layer id to draw in this character's place from here " +
                                        "on — a costume change. The only way a cut-out can do something " +
                                        "its drawing does not already do: a bird with folded wings " +
                                        "cannot open them, but it can BECOME the drawing of a bird with " +
                                        "open wings, standing in the same place at the same size. Ask " +
                                        "for both on the same sheet and they will match. Lasts until the " +
                                        "scene ends or another beat changes it again.",
                                },
                                with: {
                                    type: "boolean",
                                    description:
                                        "Run this beat AT THE SAME TIME as the one before it — B recoils " +
                                        "while A shouts, two people speak over each other, the wolf " +
                                        "creeps while the girl talks. Reaction is what scenes are made " +
                                        "of; use this often.",
                                },
                                wait: {
                                    type: "number",
                                    description:
                                        "Seconds of nothing. A beat with only this in it is a pause — " +
                                        "before an answer that is being thought about, after a line that " +
                                        "needs to land, while somebody looks at something. Needs no " +
                                        "\"id\". A short breath between two different speakers is added " +
                                        "for you; this is for the ones that mean something.",
                                },
                                duration: { type: "number", description: "Override the beat's length, in ms." },
                            },
                        },
                    },
                },
                required: ["beats"],
            },
            async execute(args: { stage?: string; beats?: Beat[]; rehearse?: boolean }) {
                const beats = Array.isArray(args?.beats) ? args.beats : [];
                if (!beats.length) return fail(`Pass "beats" — what happens in the scene.`);
                const rehearse = bool(args?.rehearse, true);
                if (rehearse && studio.performing) {
                    return fail(`A scene is already playing. Wait for it to finish, or the two run over each other.`);
                }

                const found = resolve(str(args?.stage));
                if ("error" in found) return found.error;
                const stage = found.stage;
                if (rehearse && collage.activeStageId !== stage.id) collage.setActiveStage(stage.id);

                // Everyone in the script has to be in the scene, or the beat
                // plays against a layer nobody can see and the agent is told it
                // worked.
                const cast = new Set(stage.cast.map(member => member.id));
                // Camera beats name nobody, so they are not checked against
                // the cast — there is nobody in them to be absent.
                const absent = [...new Set(beats.filter(b => !b?.camera && !b?.wait)
                    .map(b => str(b?.id)).filter(Boolean))]
                    .filter(id => !cast.has(id));
                if (absent.length) {
                    return fail(
                        `${absent.map(id => `"${id}"`).join(", ")} ${absent.length === 1 ? "is" : "are"} not in ` +
                        `"${stage.name}". Put ${absent.length === 1 ? "it" : "them"} in with stage_cast first, ` +
                        `or the beats would play on somebody who is not on stage.`);
                }

                const unknown = beats.map(b => str(b?.sound)).filter(id => id && !findSound(id));
                if (unknown.length) {
                    return fail(
                        `No sound called ${unknown.map(id => `"${id}"`).join(", ")}. Call show_sounds.`);
                }

                // A costume has to exist to be worn. It does NOT have to be in
                // the cast: it is a picture this character turns into, not
                // somebody else in the scene.
                const missingLook = [...new Set(beats.map(b => str(b?.becomes)).filter(Boolean))]
                    .filter(id => !collage.get(id));
                if (missingLook.length) {
                    return fail(
                        `No layer called ${missingLook.map(id => `"${id}"`).join(", ")} to become. ` +
                        `A "becomes" is another picture of the same character — call piece_list for ` +
                        `what there is.`);
                }

                const { plan, problems } = planScene(beats);
                if (problems.length) {
                    return fail(["The scene has problems:", ...problems.map(
                        p => (p.index >= 0 ? `beat ${p.index + 1}: ${p.reason}` : p.reason))].join("\n"));
                }

                /*
                 * Say when a scene is thin.
                 *
                 * Every scene written against this so far has been three or
                 * four beats with one line each and no camera at all — correct,
                 * accepted, and dull. Nothing was telling anybody otherwise:
                 * the tool took what it was given and reported success, which
                 * reads as "that was right". This is the only moment where
                 * saying so can change anything.
                 */
                const thin: string[] = [];
                if (beats.length < 6) {
                    thin.push(
                        `${beats.length} beat(s) is a stage direction rather than a scene. Eight to ` +
                        `fifteen gives it somewhere to go.`);
                }
                if (!beats.some(beat => beat?.camera)) {
                    thin.push(
                        `No camera moves. Pull back to establish where we are, push in on whoever is ` +
                        `speaking when it matters — it is what makes this a scene instead of a diagram.`);
                }
                const lines = beats.filter(beat => str(beat?.say));
                if (lines.length && lines.every(beat => str(beat.say).length < 40)) {
                    thin.push(`Every line is very short. Let them actually talk to each other.`);
                }

                // Kept, not just played. A show runs its scenes one after
                // another and has to know what each of them does; a script that
                // only existed at the moment it was sent could be performed
                // once and never again, which is a rehearsal, not a play.
                collage.updateStage(stage.id, { script: beats });
                studio.save();

                // Deliberately not awaited: a scene runs for seconds and the
                // point is to talk over it, not to sit watching an animation
                // the caller cannot see.
                if (rehearse) {
                    void studio.playScene(plan).catch((error: unknown) => {
                        console.warn("[collage] the scene failed:", error);
                    });
                }

                let at = 0;
                let groupMax = 0;
                const timeline = plan.beats.map(beat => {
                    // A `with` beat shares its predecessor's start; the clock
                    // advances by the longest member once the group is done.
                    if (!beat.with) {
                        at += groupMax;
                        groupMax = 0;
                    }
                    // Null-safe on purpose: automatic breaths have no move and
                    // no line, and the old template threw on them.
                    const what = beat.move
                        ?? (beat.say ? `says "${beat.say.slice(0, 40)}"`
                            : beat.camera ? "camera"
                                : beat.id ? "waits" : "a breath");
                    const line = `${(at / 1000).toFixed(1)}s  ` +
                        `${beat.with ? "+ " : ""}${beat.id || "—"} ${what}`;
                    groupMax = Math.max(groupMax, beat.duration);
                    return line;
                });
                return ok(
                    [rehearse
                        ? `Playing "${stage.name}" — ${plan.beats.length} beats over ` +
                          `${(plan.duration / 1000).toFixed(1)}s. It is running now, so narrate along with it.`
                        // It said "Playing" either way, which was a lie half
                        // the time and the sort that costs an agent a whole
                        // turn wondering why nothing happened.
                        : `Written into "${stage.name}" — ${plan.beats.length} beats over ` +
                          `${(plan.duration / 1000).toFixed(1)}s. Not played; show_play will run it.`,
                     ...(thin.length
                         ? [``, `It is saved and it works, but it is thin:`,
                            ...thin.map(note => `  - ${note}`),
                            `Send stage_script again for this scene with a fuller version — it replaces ` +
                            `what is there, so there is nothing to undo first.`]
                         : []),
                     ...timeline].join("\n"),
                    {
                        playing: rehearse,
                        stage: stage.id,
                        duration: plan.duration,
                        beats: plan.beats,
                        ...(thin.length ? { thin } : {}),
                    });
            },
        },
        {
            name: "stage_create",
            title: "Make a scene",
            description:
                "Create a stage: a named scene with a backdrop and a cast. A stage does not own its layers — " +
                "it records where they stand while it plays — so one character can appear in two scenes at " +
                "different places without being duplicated, and restyling it changes it in both. Pass an " +
                "existing id to rename a stage or change its backdrop. Showing a stage makes the canvas show " +
                "that scene alone; everything else stays on the canvas, just not on this stage.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "An existing stage to change. Omit to make a new one." },
                    name: { type: "string", description: "What the scene is called, e.g. 'the rooftop'." },
                    backdrop: {
                        type: "string",
                        description:
                            "Layer id to draw behind everything. It never acts and never enters — it is the " +
                            "room, not somebody in it. Pass 'none' to remove it.",
                    },
                    music: {
                        type: "string",
                        enum: [...soundNames("bed"), "none"],
                        description:
                            "A bed to play under this scene, cross-fading in from the last one. Call " +
                            "show_sounds to hear what each is. 'none' removes it.",
                    },
                    musicEnd: {
                        type: "string",
                        enum: [...soundNames("bed"), "loop", "fade"],
                        description:
                            "What happens if the music runs out before the scene does: 'loop' (default), " +
                            "'fade' to let it die away, or the name of another bed to blend into.",
                    },
                    tint: {
                        type: "string",
                        description:
                            "A hex colour for the room around the stage while this scene plays, e.g. " +
                            "'#2A1F3D'. You do not normally need this: the page reads the backdrop's own " +
                            "colour and dims it. Set it when the mood wants something the picture does " +
                            "not say — a cold surround on a warm scene. Pass 'auto' to go back.",
                    },
                    hold: { type: "number", description: "Seconds to wait at the end before moving on." },
                    show: { type: "boolean", description: "Show this scene on the canvas. Default true for a new one." },
                },
            },
            async execute(args: {
                id?: string; name?: string; backdrop?: string; music?: string; musicEnd?: string;
                tint?: string; hold?: number; show?: boolean;
            }) {
                const id = str(args?.id);
                if (id && !collage.getStage(id)) {
                    return fail(`There is no stage with id "${id}". Call stage_describe to list them.`);
                }
                const backdrop = str(args?.backdrop);
                if (backdrop && backdrop !== "none" && !collage.get(backdrop)) {
                    return fail(`There is no layer "${backdrop}" to use as a backdrop. Call piece_list.`);
                }

                const music = str(args?.music);
                if (music && music !== "none" && !findSound(music)) {
                    return fail(
                        `There is no sound called "${music}". Call show_sounds for what there is.`);
                }
                const musicEnd = str(args?.musicEnd);
                if (musicEnd && musicEnd !== "loop" && musicEnd !== "fade" && !findSound(musicEnd)) {
                    return fail(
                        `"${musicEnd}" is not 'loop', 'fade', or a sound to blend into. Call show_sounds.`);
                }
                const tint = str(args?.tint);
                if (tint && tint !== "auto" && !/^#[0-9a-f]{3,8}$/i.test(tint)) {
                    return fail(`"${tint}" is not a hex colour like "#2A1F3D", and not 'auto'.`);
                }
                const patch = {
                    ...(str(args?.name) ? { name: str(args.name) } : {}),
                    ...(tint ? { tint: tint === "auto" ? "" : tint } : {}),
                    ...(backdrop ? { backdrop: backdrop === "none" ? null : backdrop } : {}),
                    ...(music ? { music: music === "none" ? null : music } : {}),
                    ...(musicEnd ? { musicEnd } : {}),
                    ...(num(args?.hold) ? { hold: Math.max(0, args.hold) } : {}),
                };
                const stage = id ? collage.updateStage(id, patch)! : collage.addStage(patch);
                // A new scene is shown by default: making one and not seeing it
                // is the kind of silence that reads as a failure.
                if (bool(args?.show, !id)) collage.setActiveStage(stage.id);
                studio.save();
                studio.record("page-changed",
                    `Scene "${stage.name}" was ${id ? "changed" : "created"}.`, "agent", { stage: stage.id });

                return ok(
                    `${id ? "Changed" : "Made"} the scene "${stage.name}" as ${stage.id}` +
                    `${stage.backdrop ? `, with ${stage.backdrop} behind it` : ""}` +
                    `${stage.music ? `, under "${stage.music}"` : ""}. ` +
                    `Put layers in it with stage_cast.`,
                    { stage });
            },
        },
        {
            name: "stage_cast",
            title: "Put layers in a scene",
            description:
                "Say who is in a scene and where they stand. Positions belong to THIS scene only — the same " +
                "layer stands somewhere else in another. Anyone already in it is moved; anyone new is added. " +
                "Give each one an \"as\" — who they are playing — and they are credited by name at the end. " +
                "Say how big with \"size\" (a fraction of the backdrop's height) and where with \"at\" " +
                "(fractions across and down); a piece arrives at whatever size it was cut at, which has " +
                "nothing to do with the scene it is going into. " +
                "Someone left out of a scene is not deleted, only absent from it. A layer keeps the position " +
                "it already has unless you give it one, so adding somebody does not fling them to the corner.",
            inputSchema: {
                type: "object",
                properties: {
                    stage: { type: "string", description: "Which scene. Omit for the one being shown." },
                    cast: {
                        type: "array",
                        description: "Who stands where.",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string", description: "The layer." },
                                at: {
                                    type: "object",
                                    description:
                                        "Where they stand ON THE BACKDROP, as fractions of it. USE THIS " +
                                        "rather than x/y. x: 0 is the left edge, 0.5 the middle, 1 the " +
                                        "right. y is where their FEET are: 0.9 is standing on the ground, " +
                                        "0.5 is halfway up, 0 is the top edge. You cannot see where the " +
                                        "backdrop is on the canvas, so a raw x/y is a guess — this is not.",
                                    properties: {
                                        x: { type: "number", description: "Across, 0–1." },
                                        y: { type: "number", description: "Feet, 0–1 from the top." },
                                    },
                                },
                                x: {
                                    type: "number",
                                    description:
                                        "Raw canvas x. Only if you know the canvas coordinates — prefer \"at\".",
                                },
                                y: { type: "number", description: "Raw canvas y. Prefer \"at\"." },
                                size: {
                                    type: "number",
                                    description:
                                        "How TALL they are as a fraction of the backdrop. 0.5 is half " +
                                        "its height, which is about right for a person; 0.15 for a " +
                                        "mushroom; 0.9 for a big tree. USE THIS rather than width — a " +
                                        "piece arrives at whatever size it was cut at, which has nothing " +
                                        "to do with the scene it is going into.",
                                },
                                width: {
                                    type: "number",
                                    description:
                                        "Raw canvas width; height follows its shape. Prefer \"size\".",
                                },
                                rotation: { type: "number", description: "Degrees, clockwise." },
                                entrance: {
                                    type: "string",
                                    enum: [...ENTRANCES],
                                    description: "How it arrives when the scene builds up.",
                                },
                                flip: {
                                    type: "boolean",
                                    description:
                                        "Mirror the artwork so they face the other way. A cut-out faces " +
                                        "whichever way it was drawn — look with show_look to see which — " +
                                        "and two people in conversation should face each other. The " +
                                        "\"turn\" move flips somebody mid-scene.",
                                },
                                plane: {
                                    type: "string",
                                    enum: [...PLANES],
                                    description:
                                        "How far back it stands: 'back', 'mid' (the default) or 'front'. " +
                                        "They paint in that order, and they slide by different amounts " +
                                        "when the camera moves — which is what makes a flat set look " +
                                        "deep. Trees and buildings at the back, the people in the middle, " +
                                        "a bush or a rock at the front.",
                                },
                                as: {
                                    type: "string",
                                    description:
                                        "Who this picture is playing — 'the grandmother', 'the wolf'. It " +
                                        "goes in the credits at the end as \"grandmother — played by …\", " +
                                        "so cast everybody who should be thanked.",
                                },
                            },
                            required: ["id"],
                        },
                    },
                    remove: {
                        type: "array",
                        items: { type: "string" },
                        description: "Layer ids to take out of this scene. They stay on the canvas.",
                    },
                },
            },
            async execute(args: {
                stage?: string;
                cast?: Array<Placement & { at?: { x?: number; y?: number }; size?: number }>;
                remove?: string[];
            }) {
                const found = resolve(str(args?.stage));
                if ("error" in found) return found.error;
                const stage = found.stage;

                const wanted = Array.isArray(args?.cast) ? args.cast : [];
                const dropped = new Set((Array.isArray(args?.remove) ? args.remove : []).map(str).filter(Boolean));
                if (!wanted.length && !dropped.size) {
                    return fail(`Nothing to do — pass "cast" to put layers in the scene, or "remove" to take them out.`);
                }

                const missing = wanted.map(m => str(m?.id)).filter(id => id && !collage.get(id));
                if (missing.length) {
                    return fail(
                        `No layer called ${missing.map(id => `"${id}"`).join(", ")}. Call piece_list for ` +
                        `what is on the canvas.`);
                }

                const cast = stage.cast.filter(member => !dropped.has(member.id));
                // The backdrop is the stage: it is the only rectangle in the
                // scene that means anything, and it is the thing an agent
                // placing somebody is imagining. Without one there is nothing
                // to be relative to and raw coordinates are all there is.
                const floor = stage.backdrop ? collage.get(stage.backdrop) : null;
                const offStage: string[] = [];

                for (const [index, member] of wanted.entries()) {
                    const id = str(member?.id);
                    if (!id) continue;
                    const layer = collage.get(id)!;
                    const at = cast.findIndex(existing => existing.id === id);
                    const previous = at >= 0 ? cast[at] : null;

                    /*
                     * Sized before it is placed, because "standing on the
                     * ground" is a statement about where the FEET are, and the
                     * feet are one height below the top.
                     *
                     * And sized against the backdrop, not against whatever the
                     * piece happened to be cut at. Every cell of a sheet comes
                     * in at the same width, so a 16:9 backdrop and a standing
                     * figure arrive the same width and therefore wildly
                     * different heights — the figure ends up three times taller
                     * than the stage it is meant to be standing on. It looked
                     * exactly as wrong as it sounds.
                     */
                    const width = num(member.width) ? member.width
                        // A piece already in the scene keeps the size it was
                        // given, unless this call says otherwise: re-casting
                        // somebody to change their entrance must not silently
                        // resize them back to the default.
                        : (previous && !num(member.size)) ? previous.width ?? layer.width
                            : sizedToStage(floor, layer, member.size) ?? previous?.width ?? layer.width;
                    const height = layer.width > 0 ? (width / layer.width) * layer.height : layer.height;

                    const spot = placeOn(floor, member.at, width, height,
                        // Nobody said where, and nobody has said before: spread
                        // them along the ground rather than leaving them
                        // wherever they happened to be lying on the canvas,
                        // which is how a cast ends up standing off the set.
                        previous ? null : { index, of: wanted.length });

                    const placement: Placement = {
                        id,
                        x: num(member.x) ? member.x : spot?.x ?? previous?.x ?? layer.x,
                        y: num(member.y) ? member.y : spot?.y ?? previous?.y ?? layer.y,
                        /*
                         * The width that was actually computed — which may be
                         * the stage-relative default. The first version stored
                         * only what the CALLER passed, so the sizedToStage
                         * default was computed, used to place the feet, and
                         * then thrown away: every piece cast without an
                         * explicit size stood at whatever width it arrived at.
                         * A play staged entirely from the troupe had lamps the
                         * size of monuments, and nobody had made an error.
                         */
                        ...(width !== layer.width ? { width } : {}),
                        ...(num(member.rotation)
                            ? { rotation: member.rotation }
                            : previous?.rotation !== undefined ? { rotation: previous.rotation } : {}),
                        ...(member.entrance && (ENTRANCES as readonly string[]).includes(member.entrance)
                            ? { entrance: member.entrance }
                            : previous?.entrance ? { entrance: previous.entrance } : {}),
                        ...(str(member.as) ? { as: str(member.as) }
                            : previous?.as ? { as: previous.as } : {}),
                        ...(member.plane && (PLANES as readonly string[]).includes(member.plane)
                            ? { plane: member.plane }
                            : previous?.plane ? { plane: previous.plane } : {}),
                        ...(typeof member.flip === "boolean" ? { flip: member.flip }
                            : previous?.flip ? { flip: previous.flip } : {}),
                    };
                    if (at >= 0) cast[at] = placement;
                    else cast.push(placement);

                    // Said rather than corrected. Somebody deliberately in the
                    // wings is a real thing to want; somebody there by accident
                    // is invisible, and the difference is not ours to guess.
                    if (floor && !overlapsFloor(placement, width, height, floor)) offStage.push(id);
                }

                const next = collage.updateStage(stage.id, { cast })!;
                studio.save();
                studio.record("page-changed",
                    `"${next.name}" now has ${next.cast.length} in it.`, "agent", { stage: next.id });

                const floorNow = next.backdrop ? collage.get(next.backdrop) : null;
                return ok(
                    `"${next.name}": ` +
                    `${next.cast.map(m => describeMember(m, floorNow)).join("; ")}\n` +
                    `${dropped.size ? `, ${dropped.size} taken out` : ""}. ` +
                    (offStage.length
                        ? `WARNING: ${offStage.map(id => `"${id}"`).join(", ")} ` +
                          `${offStage.length === 1 ? "is" : "are"} standing off the backdrop entirely and ` +
                          `will not be seen. Place with "at" — fractions of the backdrop, x 0–1 across and ` +
                          `y where the feet go — rather than raw canvas coordinates. `
                        : "") +
                    (collage.activeStageId === next.id
                        ? `It is the scene on screen — look with show_look.`
                        : `Show it with stage_describe show:"${next.id}".`),
                    { stage: next });
            },
        },
        {
            name: "stage_describe",
            title: "The scenes",
            annotations: { readOnlyHint: true },
            description:
                "Every scene, who is in it and where they stand, and which one the canvas is showing. Comes " +
                "before changing a scene, the way piece_list comes before changing the canvas. Pass " +
                "'show' to switch scenes, or 'none' to see the whole canvas again.",
            inputSchema: {
                type: "object",
                properties: {
                    show: {
                        type: "string",
                        description: "Switch the canvas to this scene first, or 'none' for the whole canvas.",
                    },
                },
            },
            async execute(args: { show?: string }) {
                const wanted = str(args?.show);
                if (wanted === "none") collage.setActiveStage(null);
                else if (wanted) {
                    if (!collage.getStage(wanted)) return fail(`There is no scene with id "${wanted}".`);
                    collage.setActiveStage(wanted);
                }

                const stages = collage.listStages();
                if (!stages.length) {
                    return ok(
                        `No scenes yet. Make one with stage_create, then put layers in it with stage_cast. ` +
                        `Until then the canvas shows everything at once, which is the right way to build the ` +
                        `pieces before deciding which scene each belongs to.`,
                        { stages: [], showing: null });
                }

                const showing = collage.activeStageId;
                const lines = stages.map(stage => {
                    const floor = stage.backdrop ? collage.get(stage.backdrop) : null;
                    const who = stage.cast.length
                        ? stage.cast.map(m => describeMember(m, floor)).join("; ")
                        : "nobody yet";
                    return `${stage.id} — "${stage.name}"${stage.id === showing ? "  [on screen]" : ""}` +
                        `${stage.backdrop ? `, backdrop ${stage.backdrop}` : ""}\n    ${who}`;
                });
                const floating = stages.flatMap(stage => {
                    const floor = stage.backdrop ? collage.get(stage.backdrop) : null;
                    if (!floor) return [];
                    return stage.cast
                        .filter(m => m.id !== stage.backdrop)
                        .filter(m => {
                            const where = relativeTo(m, floor);
                            return where && (where.feet < 0.6 || where.feet > 1.15);
                        })
                        .map(m => `${m.as || m.id} in "${stage.name}"`);
                });
                const billing = collage.billing;
                return ok(
                    [
                        billing.title
                            ? `"${billing.title}"${billing.byline ? ` — ${billing.byline}` : ""}, ` +
                              `${stages.length} scene(s):`
                            : `${stages.length} scene(s). The show has no title yet — show_title gives it ` +
                              `an opening card and heads the credits.`,
                        ...lines,
                        ...(floating.length
                            ? [`Standing in mid-air or through the floor: ${floating.join(", ")} — ` +
                               `their feet are in the top half of the backdrop, or below its bottom ` +
                               `edge. Unless that is deliberate, give them an "at" with y around 0.9.`]
                            : []),
                        showing
                            ? `The canvas is showing "${collage.activeStage?.name}", so piece_list and ` +
                              `show_look answer about that scene alone.`
                            : `The canvas is showing everything rather than one scene.`,
                    ].join("\n"),
                    { stages, showing, billing });
            },
        },
    ];
}
