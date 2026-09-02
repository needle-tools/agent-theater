/**
 * The scene tools.
 *
 * Separate from the collage tools because they are a different job: those are
 * for making things, these are for deciding which things are in which scene and
 * where they stand in it. An agent building a show uses both — it draws the
 * cast with collage_add_image and then blocks them with these.
 *
 * The one idea to hold on to: a stage does not own its layers. It records where
 * they stand while it is playing. So the same character appears in scene one and
 * scene three at different places, and recolouring it changes it in both.
 */
import { MOVES, plan as planScene, type Beat } from "./perform.js";
import { ENTRANCES, type Placement, type Stage } from "./stage.js";
import type { CollageStudio } from "./studio.js";
import type { ToolResult, WebMcpToolDef } from "./tools.js";

const ok = (text: string, structured?: object): ToolResult => ({
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
});

const fail = (text: string, structured?: object): ToolResult => ({ ...ok(text, structured), isError: true });

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

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

    return [
        {
            name: "show_play",
            title: "Put the show on",
            description:
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
                },
            },
            async execute(args: { stages?: string[] }) {
                if (studio.showing) {
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

                const { timings, duration } = studio.playShow(wanted.length ? wanted : undefined);
                if (!timings.length) return fail(`Nothing to play.`);

                return ok(
                    [`The show is running — ${timings.length} scene(s), ${(duration / 1000).toFixed(1)}s. ` +
                     `Narrate along with it; do not wait for it.`,
                     ...timings.map(t =>
                         `${(t.at / 1000).toFixed(1)}s  "${t.name}"  (${(t.duration / 1000).toFixed(1)}s)`),
                    ].join("\n"),
                    { playing: true, timings, duration });
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
                                to: {
                                    type: "object",
                                    description: "Where a walk or jump ends up, relative to now, in canvas units.",
                                    properties: { x: { type: "number" }, y: { type: "number" } },
                                },
                                duration: { type: "number", description: "Override the beat's length, in ms." },
                            },
                            required: ["id"],
                        },
                    },
                },
                required: ["beats"],
            },
            async execute(args: { stage?: string; beats?: Beat[]; rehearse?: boolean }) {
                const beats = Array.isArray(args?.beats) ? args.beats : [];
                if (!beats.length) return fail(`Pass "beats" — what happens in the scene.`);
                const rehearse = args?.rehearse !== false;
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
                const absent = [...new Set(beats.map(b => str(b?.id)).filter(Boolean))]
                    .filter(id => !cast.has(id));
                if (absent.length) {
                    return fail(
                        `${absent.map(id => `"${id}"`).join(", ")} ${absent.length === 1 ? "is" : "are"} not in ` +
                        `"${stage.name}". Put ${absent.length === 1 ? "it" : "them"} in with stage_cast first, ` +
                        `or the beats would play on somebody who is not on stage.`);
                }

                const { plan, problems } = planScene(beats);
                if (problems.length) {
                    return fail(["The scene has problems:", ...problems.map(
                        p => (p.index >= 0 ? `beat ${p.index + 1}: ${p.reason}` : p.reason))].join("\n"));
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
                const timeline = plan.beats.map(beat => {
                    const line = `${(at / 1000).toFixed(1)}s  ${beat.id} ` +
                        `${beat.move ?? `says "${beat.say!.slice(0, 40)}"`}`;
                    at += beat.duration;
                    return line;
                });
                return ok(
                    [`Playing "${stage.name}" — ${plan.beats.length} beats over ` +
                     `${(plan.duration / 1000).toFixed(1)}s. It is running now, so narrate along with it.`,
                     ...timeline].join("\n"),
                    { playing: true, stage: stage.id, duration: plan.duration, beats: plan.beats });
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
                    hold: { type: "number", description: "Seconds to wait at the end before moving on." },
                    show: { type: "boolean", description: "Show this scene on the canvas. Default true for a new one." },
                },
            },
            async execute(args: { id?: string; name?: string; backdrop?: string; hold?: number; show?: boolean }) {
                const id = str(args?.id);
                if (id && !collage.getStage(id)) {
                    return fail(`There is no stage with id "${id}". Call stage_describe to list them.`);
                }
                const backdrop = str(args?.backdrop);
                if (backdrop && backdrop !== "none" && !collage.get(backdrop)) {
                    return fail(`There is no layer "${backdrop}" to use as a backdrop. Call collage_describe.`);
                }

                const patch = {
                    ...(str(args?.name) ? { name: str(args.name) } : {}),
                    ...(backdrop ? { backdrop: backdrop === "none" ? null : backdrop } : {}),
                    ...(num(args?.hold) ? { hold: Math.max(0, args.hold) } : {}),
                };
                const stage = id ? collage.updateStage(id, patch)! : collage.addStage(patch);
                // A new scene is shown by default: making one and not seeing it
                // is the kind of silence that reads as a failure.
                if (args?.show === true || (args?.show !== false && !id)) collage.setActiveStage(stage.id);
                studio.save();
                studio.record("page-changed",
                    `Scene "${stage.name}" was ${id ? "changed" : "created"}.`, "agent", { stage: stage.id });

                return ok(
                    `${id ? "Changed" : "Made"} the scene "${stage.name}" as ${stage.id}` +
                    `${stage.backdrop ? `, with ${stage.backdrop} behind it` : ""}. ` +
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
                                x: { type: "number", description: "Canvas x in this scene." },
                                y: { type: "number", description: "Canvas y in this scene." },
                                width: { type: "number", description: "Width here; height follows its shape." },
                                rotation: { type: "number", description: "Degrees, clockwise." },
                                entrance: {
                                    type: "string",
                                    enum: [...ENTRANCES],
                                    description: "How it arrives when the scene builds up.",
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
            async execute(args: { stage?: string; cast?: Placement[]; remove?: string[] }) {
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
                        `No layer called ${missing.map(id => `"${id}"`).join(", ")}. Call collage_describe for ` +
                        `what is on the canvas.`);
                }

                const cast = stage.cast.filter(member => !dropped.has(member.id));
                for (const member of wanted) {
                    const id = str(member?.id);
                    if (!id) continue;
                    const layer = collage.get(id)!;
                    const at = cast.findIndex(existing => existing.id === id);
                    const previous = at >= 0 ? cast[at] : null;
                    const placement: Placement = {
                        id,
                        x: num(member.x) ? member.x : previous?.x ?? layer.x,
                        y: num(member.y) ? member.y : previous?.y ?? layer.y,
                        ...(num(member.width)
                            ? { width: member.width }
                            : previous?.width ? { width: previous.width } : {}),
                        ...(num(member.rotation)
                            ? { rotation: member.rotation }
                            : previous?.rotation !== undefined ? { rotation: previous.rotation } : {}),
                        ...(member.entrance && (ENTRANCES as readonly string[]).includes(member.entrance)
                            ? { entrance: member.entrance }
                            : previous?.entrance ? { entrance: previous.entrance } : {}),
                    };
                    if (at >= 0) cast[at] = placement;
                    else cast.push(placement);
                }

                const next = collage.updateStage(stage.id, { cast })!;
                studio.save();
                studio.record("page-changed",
                    `"${next.name}" now has ${next.cast.length} in it.`, "agent", { stage: next.id });

                return ok(
                    `"${next.name}" has ${next.cast.length} in it` +
                    `${dropped.size ? `, ${dropped.size} taken out` : ""}. ` +
                    (collage.activeStageId === next.id
                        ? `It is the scene on screen — look with collage_preview.`
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
                "before changing a scene, the way collage_describe comes before changing the canvas. Pass " +
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
                    const who = stage.cast.length
                        ? stage.cast
                            .map(m => `${m.id} at ${Math.round(m.x)}, ${Math.round(m.y)}` +
                                `${m.entrance ? ` (enters ${m.entrance})` : ""}`)
                            .join("; ")
                        : "nobody yet";
                    return `${stage.id} — "${stage.name}"${stage.id === showing ? "  [on screen]" : ""}` +
                        `${stage.backdrop ? `, backdrop ${stage.backdrop}` : ""}\n    ${who}`;
                });
                return ok(
                    [
                        `${stages.length} scene(s):`,
                        ...lines,
                        showing
                            ? `The canvas is showing "${collage.activeStage?.name}", so collage_describe and ` +
                              `collage_preview answer about that scene alone.`
                            : `The canvas is showing everything rather than one scene.`,
                    ].join("\n"),
                    { stages, showing });
            },
        },
    ];
}
