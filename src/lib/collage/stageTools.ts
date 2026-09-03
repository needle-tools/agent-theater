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
import { spokenBy } from "./show.js";
import { findSound, soundCatalogue, soundNames } from "./audio.js";
import { findClip, listClips } from "./clips.js";
import { EFFECTS, effectNames, findEffect } from "./effects.js";
import { prompter } from "./speech.js";
import { isSubtitleVoice, normalizeSubtitleVoice, type SubtitleVoice } from "../subtitleVoice/index.js";
import { ENTRANCES, PLANES, type Placement, type Stage } from "./stage.js";
import type { Layer } from "./model.js";
import { actorForLayer, autoVoiceFor, voiceForActor } from "./characterVoice.js";
import { clearSpot } from "./placement.js";
import type { CollageStudio } from "./studio.js";
import type { ToolResult, WebMcpToolDef } from "./tools.js";

const ok = (text: string, structured?: object): ToolResult => ({
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
});

const fail = (text: string, structured?: object): ToolResult => ({ ...ok(text, structured), isError: true });

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const voice = (value: unknown): SubtitleVoice | null =>
    isSubtitleVoice(value) ? normalizeSubtitleVoice(value) : null;

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
     * One member, said in the units the world speaks.
     *
     * There is no frame and no fraction any more: a chapter does not place
     * anybody, so the only honest position is the layer's own — the same
     * numbers piece_list reports and stage_cast accepts, so an agent can
     * read its own work back without a translation table.
     */
    const describeMember = (placement: Placement): string => {
        const name = `${placement.id}${placement.as ? ` as ${placement.as}` : ""}`;
        const layer = collage.own(placement.id);
        if (layer?.held) return `${name} (held by ${layer.held.by})`;
        const at = layer
            ? `at ${Math.round(layer.x)}, ${Math.round(layer.y)} (${Math.round(layer.width)} wide)`
            : `(layer missing)`;
        return `${name} ${at}` +
            `${placement.entrance ? ` (enters ${placement.entrance})` : ""}` +
            // Nobody is silent any more: a part with no cast voice speaks in
            // one dealt from its own name, so the honest label is "auto".
            `${placement.voice
                ? ` (voice speed ${placement.voice.speed}, age ${placement.voice.age}, tone ${placement.voice.tone})`
                : " (auto voice)"}`;
    };

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
                "they are listed as \"grandmother — played by …\". And SIGN YOUR WORK: pass \"credits\" " +
                "with the maker's lines — who wrote it, who directed, whose paper it is. A play was made " +
                "by somebody, and the roll is where it says so.",
            inputSchema: {
                type: "object",
                properties: {
                    title: { type: "string", description: "What the piece is called. Pass '' to drop the card." },
                    byline: {
                        type: "string",
                        description:
                            "The smaller line under it — 'a play in two scenes', 'after Grimm'. Optional.",
                    },
                    credits: {
                        type: "array",
                        items: { type: "string" },
                        description:
                            "The maker's lines, rolled at the end after the cast, under the house " +
                            "cactus. ALWAYS include a direction credit naming yourself — 'directed " +
                            "by <your model or product name>' — and, when they took part, the " +
                            "person: 'staged with <their name, if they told you it>'. More lines " +
                            "welcome: 'story after Grimm', 'paper cut-outs — the woodland pack'. " +
                            "Saved with the play; pass [] to clear.",
                    },
                },
            },
            async execute(args: { title?: string; byline?: string; credits?: string[] }) {
                const title = typeof args?.title === "string" ? args.title.trim() : undefined;
                const byline = typeof args?.byline === "string" ? args.byline.trim() : undefined;
                const makers = Array.isArray(args?.credits)
                    ? args.credits.map(str).filter(Boolean)
                    : undefined;
                if (title === undefined && byline === undefined && makers === undefined) {
                    return fail(`Pass "title" — what the piece is called.`);
                }
                const billing = collage.setBilling({
                    ...(title !== undefined ? { title } : {}),
                    ...(byline !== undefined ? { byline } : {}),
                    ...(makers !== undefined ? { credits: makers } : {}),
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
                const { timings, duration } = await studio.playShow(
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
                /*
                 * Whether anybody in this show can be heard, and whether that
                 * was the intention.
                 *
                 * Same rule as the music warning below it: an agent narrating
                 * "and the wolf growls" over a silent bubble is describing a
                 * performance that is not happening. The two cases are worth
                 * separating — a cast nobody gave voices to is a choice not yet
                 * made, and a cast with voices that will not load is a failure.
                 */
                const played = wanted.length
                    ? wanted.map(id => collage.getStage(id)).filter((s): s is Stage => !!s)
                    : collage.listStages();
                const voiced = played.some(stage => stage.cast.some(member => member.voice));
                // Off is not broken, and the two get told apart before anything
                // is said about either. Nagging an agent to cast voices in a
                // build that has no speech would be asking for work that cannot
                // pay off, and calling it a failure would send it looking for a
                // fault that does not exist.
                const speechOff = prompter.mute;
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
                     ...(speechOff
                         ? [`THE CAST DOES NOT SPEAK: this build has no speech engine, so every line ` +
                            `appears in a bubble and none of them is heard. Nothing is wrong and there ` +
                            `is nothing to switch on. Write the lines as you would anyway — they are ` +
                            `read, and they still set the pace of the scene — but do not narrate as ` +
                            `though the characters are audible.`]
                         : !voiced
                         ? [`NOBODY HAS A VOICE: every line will appear in a bubble and none of them ` +
                            `will be heard. Give each part a "voice" in stage_cast — different voices ` +
                            `for different parts — and the page speaks the lines itself. Until then, ` +
                            `do not narrate as though the characters are audible.`]
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
                "everything else finishes exactly where it started. A beat's \"take\" picks another " +
                "cast member up — it rides along through every later move until a \"drop\" lets it fall. " +
                "\"with\": true makes a beat run AT THE SAME TIME as the one before it, so two characters " +
                "can move or speak together. \"walk\" and \"jump\" travel to any canvas point — a hero can " +
                "cross the whole world, scene to scene, if the story sends them. An \"effect\" throws " +
                `paper over a beat: ${effectNames().join(", ")}.`,
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
                                do: {
                                    type: "string",
                                    // No enum: recorded clips extend the move
                                    // vocabulary after registration, and an
                                    // enum stamped at load time would refuse
                                    // every clip recorded since.
                                    description:
                                        `What they do: ${MOVES.join(", ")} — or a hand-recorded move ` +
                                        `as "clip:<name>". A clip marked "(travels)" was recorded as ` +
                                        `a journey: it really moves them across the paper and leaves ` +
                                        `them there, no "to" needed. The rest gesture in place` +
                                        (listClips().length
                                            ? `. Recorded so far: ${listClips()
                                                .map(clip => `clip:${clip.name}${clip.travel ? " (travels)" : ""}`)
                                                .join(", ")}.`
                                            : `.`),
                                },
                                say: {
                                    anyOf: [
                                        { type: "string" },
                                        { type: "array", items: { type: "string" } },
                                    ],
                                    description:
                                        "A line, in a bubble above them — or an ARRAY of lines: the same " +
                                        "speaker delivers them one after another, a fresh bubble each, " +
                                        "and the beat's move plays under the first. Several short " +
                                        "bubbles read far better than one long one.",
                                },
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
                                effect: {
                                    type: "string",
                                    enum: effectNames(),
                                    description:
                                        "A canned particle effect thrown over this character as the " +
                                        "beat runs — little paper shapes, in the style of the stage. " +
                                        "Rides along with a move or a line; alone it takes its own " +
                                        "moment. " +
                                        EFFECTS.map(effect => `"${effect.id}": ${effect.description}`).join(" "),
                                },
                                take: {
                                    type: "string",
                                    description:
                                        "The id of a cast member this character picks up. It animates " +
                                        "into their hand and then belongs to them — walks, jumps and " +
                                        "turns carry it along — until a \"drop\". A character holding " +
                                        "a basket, sitting on a vehicle, carrying a lantern: all this.",
                                },
                                drop: {
                                    type: "string",
                                    description:
                                        "The id of a held cast member to let go of. It falls to the " +
                                        "ground line and stays where it lands.",
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
                                background: {
                                    type: "string",
                                    description:
                                        "Fade the PAPER to this hex colour as the beat starts — the " +
                                        "weather changing mid-scene: dusk falling, a fire catching. " +
                                        "'paper' returns the house colour. Rides along with whatever " +
                                        "else the beat does; alone it takes no time and needs no id. " +
                                        "It stays until something changes it again.",
                                },
                                duration: { type: "number", description: "Override the beat's length, in ms." },
                            },
                        },
                    },
                },
                required: ["beats"],
            },
            async execute(args: { stage?: string; beats?: Beat[]; rehearse?: boolean }) {
                /*
                 * A speech is several bubbles, not one long one. `say` accepts
                 * an array of lines, expanded here — before validation, timing
                 * and the voice learning — into consecutive beats: the first
                 * keeps whatever else the beat was doing (its move, its
                 * sound), the rest are the same speaker simply carrying on.
                 * Everything downstream only ever sees one line per beat.
                 */
                const beats = (Array.isArray(args?.beats) ? args.beats : []).flatMap(beat => {
                    if (!Array.isArray((beat as { say?: unknown })?.say)) return [beat];
                    const lines = ((beat as unknown as { say: unknown[] }).say)
                        .filter(line => typeof line === "string" && line.trim())
                        .map(line => (line as string).trim());
                    if (!lines.length) return [{ ...beat, say: undefined }];
                    return lines.map((line, at) => at === 0
                        ? { ...beat, say: line }
                        : { id: (beat as { id?: string }).id, say: line } as Beat);
                });
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

                /*
                 * Learn the lines before timing them.
                 *
                 * The scene about to be written is the scene most likely to be
                 * heard next — rehearsed on this very call, or played moments
                 * later — so this is the earliest honest moment to synthesise
                 * it, and doing it here means show_play finds everything ready.
                 *
                 * Awaited, because the timeline in the reply is the thing the
                 * agent narrates from and a timeline of reading times for lines
                 * that will be spoken is a timeline that will not be kept.
                 */
                /*
                 * Hands are checked here because only the stage knows them. A
                 * take of something not in the scene, of the backdrop, or a
                 * chain (holding a thing that holds a thing) would each fail
                 * silently downstream in a different confusing way; refusing
                 * them by name is the whole cost of a paragraph.
                 */
                const handErrors: string[] = [];
                for (const [index, beat] of beats.entries()) {
                    for (const [field, target] of [["take", str(beat?.take)], ["drop", str(beat?.drop)]] as const) {
                        if (!target) continue;
                        if (!collage.own(target)) {
                            handErrors.push(`beat ${index + 1}: there is no piece "${target}" — call piece_list`);
                        } else if (field === "take" &&
                            collage.listAll().some(layer => layer.held?.by === target)) {
                            handErrors.push(
                                `beat ${index + 1}: "${target}" is itself holding something — ` +
                                `one level only, no chains`);
                        }
                    }
                    const wantedEffect = str((beat as { effect?: unknown })?.effect);
                    if (wantedEffect && !findEffect(wantedEffect)) {
                        handErrors.push(
                            `beat ${index + 1}: "${wantedEffect}" is not an effect. ` +
                            `There is: ${effectNames().join(", ")}`);
                    }
                }
                if (handErrors.length) {
                    return fail(["The scene has problems:", ...handErrors].join("\n"));
                }

                // Recorded moves: the plan carries them blind, so existence
                // and true length are settled here, where the drawer is.
                const unknownClips = [...new Set(beats
                    .map(b => (typeof b?.do === "string" && b.do.startsWith("clip:") ? b.do.slice(5) : ""))
                    .filter(Boolean))]
                    .filter(name => !findClip(name));
                if (unknownClips.length) {
                    const have = listClips().map(clip => `clip:${clip.name}`);
                    return fail(
                        `No recorded clip called ${unknownClips.map(n => `"${n}"`).join(", ")}. ` +
                        (have.length ? `There is: ${have.join(", ")}.` : `Nothing has been recorded ` +
                        `on this browser yet — clips are made by the person, in the menu.`));
                }
                // A clip beat without a duration takes the recording's own
                // length: the gesture was performed at a speed, and that speed
                // is part of it.
                const timed = beats.map(beat => {
                    if (typeof beat?.do !== "string" || !beat.do.startsWith("clip:") || beat.duration) {
                        return beat;
                    }
                    const clip = findClip(beat.do.slice(5));
                    return clip ? { ...beat, duration: clip.seconds * 1000 } : beat;
                });

                const scripted: Stage = { ...stage, script: timed };
                const { plan, problems } = planScene(timed,
                    spokenBy(scripted, id => autoVoiceFor(collage.own(id))));
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
                collage.updateStage(stage.id, { script: timed });
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
                "Create a chapter: a named stretch of the story, with its own cast, script and music. " +
                "Chapters do not own or move anything — the canvas is one continuous world, and a show " +
                "is the camera following the story across it: chapter one leaves the hero at the forest's " +
                "edge and chapter two picks her up exactly there. Walks and jumps really move the pieces; " +
                "when the show ends, the arrangement is put back the way it was at curtain-up. Pass an " +
                "existing id to rename a chapter.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "An existing stage to change. Omit to make a new one." },
                    name: { type: "string", description: "What the scene is called, e.g. 'the rooftop'." },
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
                    background: {
                        type: "string",
                        description:
                            "The PAPER's colour while this chapter plays — the scene's weather, e.g. " +
                            "'#1B2440' for night. Fades in as the chapter begins and stays until " +
                            "another chapter, beat, or theater_background changes it. 'paper' resets " +
                            "to the house colour. A beat can also change it mid-chapter.",
                    },
                    hold: { type: "number", description: "Seconds to wait at the end before moving on." },
                    show: { type: "boolean", description: "Show this scene on the canvas. Default true for a new one." },
                },
            },
            async execute(args: {
                id?: string; name?: string; backdrop?: string; music?: string; musicEnd?: string;
                tint?: string; background?: string; hold?: number; show?: boolean;
            }) {
                const id = str(args?.id);
                if (id && !collage.getStage(id)) {
                    return fail(`There is no stage with id "${id}". Call stage_describe to list them.`);
                }
                /*
                 * Backdrop panels are retired — the play happens on the open
                 * paper world. Refused by name rather than silently ignored,
                 * because an agent that thinks it set a backdrop will spend
                 * the rest of the scene placing people relative to it.
                 */
                if (str(args?.backdrop) && str(args?.backdrop) !== "none") {
                    return fail(
                        `There are no backdrop panels: the play happens on the open canvas, with the ` +
                        `pieces as they stand and the camera doing the framing. Cast big scenery on the ` +
                        `"back" plane instead if the place needs marking out.`);
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
                const paper = str(args?.background).toLowerCase();
                if (paper && paper !== "paper" && !/^#[0-9a-f]{3,8}$/i.test(paper)) {
                    return fail(`"${paper}" is not a hex colour like "#1B2440", and not 'paper'.`);
                }
                const patch = {
                    ...(str(args?.name) ? { name: str(args.name) } : {}),
                    ...(tint ? { tint: tint === "auto" ? "" : tint } : {}),
                    ...(paper ? { background: paper === "paper" ? "" : paper } : {}),
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
                "Say who is IN a chapter — who they play, which voice, how they arrive. Casting does not " +
                "move anybody: the canvas is one continuous world, every piece stands exactly where it " +
                "stands, and the arrangement on the paper IS the blocking. Pass x/y/width only to also " +
                "move or resize the piece in the world (same units piece_list reports); leave them out to " +
                "cast things right where they are. When you do place, leave AIR between pieces — at " +
                "least a piece's own width apart; a piece set on top of another is nudged aside to " +
                "clear paper. Give each an \"as\" — who they are playing — and they " +
                "are credited by name at the end. Someone left out of a chapter is not deleted, only " +
                "absent from its story.",
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
                                x: {
                                    type: "number",
                                    description:
                                        "Move them here (canvas x, top-left corner) while casting — the " +
                                        "same world units piece_list reports and piece_move takes. LEAVE " +
                                        "IT OUT to cast them exactly where they stand: the arrangement on " +
                                        "the canvas usually IS the blocking.",
                                },
                                y: { type: "number", description: "Canvas y (top-left corner). Leave out to keep their spot." },
                                width: {
                                    type: "number",
                                    description:
                                        "Resize them while casting (canvas units; height follows their " +
                                        "shape). Clamped to 0.5–1.5× the current width per call. Leave " +
                                        "out to keep their size — compare against piece_list's widths.",
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
                                as: {
                                    type: "string",
                                    description:
                                        "Who this picture is playing — 'the grandmother', 'the wolf'. It " +
                                        "goes in the credits at the end as \"grandmother — played by …\", " +
                                        "so cast everybody who should be thanked.",
                                },
                                voice: {
                                    type: "object",
                                    additionalProperties: false,
                                    properties: {
                                        speed: {
                                            type: "number", minimum: 0, maximum: 2,
                                            description: "0 is 1×, 1 is the default 1.7×, 2 is 2×.",
                                        },
                                        age: {
                                            type: "number", minimum: 0, maximum: 1,
                                            description: "0 young, 0.5 medium, 1 old.",
                                        },
                                        tone: {
                                            type: "number", minimum: 0, maximum: 1,
                                            description: "0 low, 0.5 medium, 1 high.",
                                        },
                                    },
                                    required: ["speed", "age", "tone"],
                                    description:
                                        "The character's complete voice: exactly speed, age and tone. " +
                                        "For troupe actors, leaving it out chooses a fitting voice from the " +
                                        "character; passing it overrides that choice. Vary age and tone across the cast.",
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
                cast?: Array<Placement>;
                remove?: string[];
            }) {
                const found = resolve(str(args?.stage));
                if ("error" in found) return found.error;
                const stage = found.stage;

                const wanted = Array.isArray(args?.cast) ? args.cast : [];
                const dropped = new Set((Array.isArray(args?.remove) ? args.remove : []).map(str).filter(Boolean));
                if (!wanted.length && !dropped.size) {
                    return fail(`Nothing to do — pass "cast" to put layers in the chapter, or "remove" to take them out.`);
                }

                const missing = wanted.map(m => str(m?.id)).filter(id => id && !collage.own(id));
                if (missing.length) {
                    return fail(
                        `No layer called ${missing.map(id => `"${id}"`).join(", ")}. Call piece_list for ` +
                        `what is on the canvas.`);
                }

                const cast = stage.cast.filter(member => !dropped.has(member.id));

                for (const member of wanted) {
                    const id = str(member?.id);
                    if (!id) continue;
                    const layer = collage.own(id)!;
                    const at = cast.findIndex(existing => existing.id === id);
                    const previous = at >= 0 ? cast[at] : null;
                    const actor = actorForLayer(layer);

                    /*
                     * Casting is MEMBERSHIP — who they play, which plane, how
                     * they arrive. Where they stand is the world's business:
                     * any x/y/width/rotation/flip passed here is a courtesy
                     * edit applied straight to the layer, in the same units
                     * piece_move uses, and leaving them out means "where they
                     * already are", which is usually the right answer — the
                     * person's arrangement is the blocking.
                     */
                    const layerPatch: Record<string, number | boolean> = {};
                    if (num(member.x)) layerPatch.x = member.x!;
                    if (num(member.y)) layerPatch.y = member.y!;
                    if (num(member.width)) {
                        // Half to half-again per call, like piece_move: every
                        // giant in every play so far was one unchecked width.
                        const own = collage.own(id)!;
                        layerPatch.width = Math.min(own.width * 1.5,
                            Math.max(own.width * 0.5, member.width!));
                    }
                    if (num(member.rotation)) layerPatch.rotation = member.rotation!;
                    if (typeof member.flip === "boolean") layerPatch.flip = member.flip;
                    if (Object.keys(layerPatch).length) collage.update(id, layerPatch);

                    const placement: Placement = {
                        id,
                        ...(member.entrance && (ENTRANCES as readonly string[]).includes(member.entrance)
                            ? { entrance: member.entrance }
                            : previous?.entrance ? { entrance: previous.entrance } : {}),
                        ...(str(member.as) ? { as: str(member.as) }
                            : previous?.as ? { as: previous.as } : {}),
                        ...(voice(member.voice) ? { voice: voice(member.voice)! }
                            : previous?.voice ? { voice: previous.voice }
                                : actor ? { voice: voiceForActor(actor) } : {}),
                    };
                    if (at >= 0) cast[at] = placement;
                    else cast.push(placement);
                }

                /*
                 * Agents place by coordinates they cannot feel the size of,
                 * and the result — often — is a scene stacked like a plate of
                 * leftovers: the bench on the tent, the gong on the crow.
                 * Any piece whose x/y THIS call set and whose centre landed
                 * in another piece's lap is walked to the nearest clear
                 * paper. Light overlaps are left alone: a lantern by a hand
                 * or a hat near a head is composition, not a pile.
                 */
                const placed = wanted.filter(m => num(m?.x) || num(m?.y)).map(m => str(m.id));
                const nudged: string[] = [];
                for (const id of placed) {
                    const layer = collage.own(id);
                    if (!layer || layer.held) continue;
                    const girth = Math.min(layer.width, layer.height);
                    const cx = layer.x + layer.width / 2;
                    const cy = layer.y + layer.height / 2;
                    const others = collage.listAll().filter(other =>
                        other.id !== id && !(other.held?.by === id) && !(layer.held?.by === other.id));
                    const crowded = others.some(other => {
                        const otherGirth = Math.min(other.width, other.height);
                        return Math.hypot(other.x + other.width / 2 - cx, other.y + other.height / 2 - cy)
                            < (girth + otherGirth) / 2 * 0.55;
                    });
                    if (!crowded) continue;
                    const spot = clearSpot(others, { x: cx, y: cy }, girth);
                    if (spot.x === cx && spot.y === cy) continue;
                    collage.update(id, {
                        x: spot.x - layer.width / 2,
                        y: spot.y - layer.height / 2,
                    });
                    nudged.push(layer.label);
                }

                const next = collage.updateStage(stage.id, { cast })!;
                studio.save();
                studio.record("page-changed",
                    `"${next.name}" now has ${next.cast.length} in it.`, "agent", { stage: next.id });

                return ok(
                    `"${next.name}": ` +
                    `${next.cast.map(m => describeMember(m)).join("; ")}` +
                    `${dropped.size ? `, ${dropped.size} taken out` : ""}. ` +
                    (nudged.length
                        ? `NOTE: ${nudged.map(label => `"${label}"`).join(", ")} landed on top of ` +
                          `other pieces and ${nudged.length === 1 ? "was" : "were"} nudged to clear ` +
                          `paper — leave more room between placements; a scene needs air. `
                        : "") +
                    (collage.activeStageId === next.id
                        ? `It is the chapter on screen — look with show_look.`
                        : `Show it with stage_describe show:"${next.id}".`),
                    { stage: next });
            },
        },
        {
            name: "stage_describe",
            title: "The scenes",
            annotations: { readOnlyHint: true },
            description:
                "Every chapter, who is in it, and which one is selected. Comes before changing a chapter, " +
                "the way piece_list comes before changing the canvas. Pass 'show' to point the canvas at " +
                "a chapter, or 'none' to stand back — the world stays visible either way.",
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
                    const who = stage.cast.length
                        ? stage.cast.map(m => describeMember(m)).join("; ")
                        : "nobody yet";
                    return `${stage.id} — "${stage.name}"${stage.id === showing ? "  [on screen]" : ""}` +
                        `\n    ${who}`;
                });
                const billing = collage.billing;
                return ok(
                    [
                        billing.title
                            ? `"${billing.title}"${billing.byline ? ` — ${billing.byline}` : ""}, ` +
                              `${stages.length} chapter(s):`
                            : `${stages.length} chapter(s). The show has no title yet — show_title gives it ` +
                              `an opening card and heads the credits.`,
                        ...lines,
                        showing
                            ? `"${collage.activeStage?.name}" is the chapter on screen: its cast stands on ` +
                              `its planes, and the whole world stays visible around it.`
                            : `No chapter is selected; the canvas shows the world as it is.`,
                    ].join("\n"),
                    { stages, showing, billing });
            },
        },
    ];
}
