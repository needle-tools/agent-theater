/**
 * The WebMCP tools for the collage page.
 *
 * The shape of this API is an argument about how an agent should work with a
 * visual medium. Three things follow from that:
 *
 *  - It can *look*. `show_look` hands back an actual picture, so the
 *    agent can see that two cut-outs overlap instead of inferring it from
 *    coordinates. Every mutating tool ends by suggesting a look.
 *  - It does not do arithmetic it cannot check. `piece_arrange` takes a word
 *    ("packed") and does the geometry here, where the frame's real size is
 *    known.
 *  - It is told when the result will be bad. Resolution warnings ride along in
 *    describe and export rather than waiting for someone to print the page.
 *
 * Tool definitions are re-sent on every turn of the conversation, so the
 * descriptions stay terse; detail belongs in the result text, which is only
 * paid for when the tool is actually called.
 */
import { FONTS, FRAME_PRESETS, findFont, outputSize, type Frame, type ImageLayer, type Layer, type TextLayer } from "./model.js";
import { LAYOUT_MODES, type LayoutMode } from "./layout.js";
import { checkFrame } from "./quality.js";
import { FREE_PAGE, type CollageStudio, type ExportFormat } from "./studio.js";

import { createStageTools } from "./stageTools.js";
import { artPrompt } from "./artPrompt.js";
import { createTroupeTool } from "./troupeTool.js";
import { TROUPE } from "./troupe.js";
import { noteCall } from "./toolLog.js";
import { listClips } from "./clips.js";
import { idleSet } from "./idleSet.js";
import { publishingTools } from "./publishing.js";
import { DEFAULT_AGENT_AVATAR_SHEET, getAgentAvatarSheet, setAgentAvatarSheet } from "./agentAvatar.js";
import { notifyAgentActivity } from "../room/activity.js";

export interface ToolResult {
    content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
    >;
    structuredContent?: object;
    isError?: boolean;
}

export interface WebMcpToolDef {
    name: string;
    title?: string;
    description: string;
    inputSchema: object;
    annotations?: object;
    /** WebMCP passes an AbortSignal, which a long-running tool must honour. */
    execute: (args: any, options?: { signal?: AbortSignal }) => Promise<ToolResult>;
}

const ok = (text: string, structured?: object): ToolResult => ({
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
});

const fail = (text: string, structured?: object): ToolResult => ({ ...ok(text), ...(structured ? { structuredContent: structured } : {}), isError: true });

/**
 * How long a tool will block before answering "still going".
 *
 * An agent driving a browser has its own timeout on the call, and it is
 * shorter than the work can be: the first cut-out on a cold cache pulls tens
 * of megabytes of model before it does any cutting. When the caller gives up,
 * the page carries on regardless — so the outcome is not lost, but the agent
 * is left believing nothing happened, which is worse than being told to wait.
 *
 * So: answer inside the window, say the work is running, and point at
 * show_watch. Twenty seconds is under every browser-automation timeout seen
 * so far and long enough that a warm cut still answers in one call.
 */
const PATIENCE_MS = 20_000;

/** Whichever comes first: the work, or the promise that it is still running. */
async function within<T>(work: Promise<T>, waiting: () => ToolResult): Promise<ToolResult | { value: T }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), PATIENCE_MS); });
    const winner = await Promise.race([work.then(value => ({ value })), patience]);
    clearTimeout(timer);
    return winner ?? waiting();
}

/**
 * What an agent putting on a show actually needs.
 *
 * Tool definitions are re-sent on every turn of a conversation, so the surface
 * is not free — every tool an agent will never use is paid for in every message
 * and read past when it is choosing what to do. This is the theatre: get
 * pictures in, put them in scenes, block them, act them, look.
 *
 * Left out on purpose, and still there for the person: arranging a collage,
 * tracing to vector, paper sizes, exporting a PNG or a page, styling a cut-out.
 * Those are real features with real interfaces — a menu item, a button, a
 * picker — and none of them is a thing an agent needs in order to stage a play.
 */
const THEATRE = new Set([
    "theater_start", "theater_avatar", "theater_art_prompt", "theater_background", "theater_clear",
    "piece_list", "piece_add", "piece_copy", "piece_sheet", "piece_text",
    "piece_move", "piece_remove", "piece_say", "show_look", "show_watch",
]);

export function createCollageTools(studio: CollageStudio): WebMcpToolDef[] {
    // Scene tools alongside the canvas ones, and both reachable from a batch:
    // staging a scene is blocking a cast, which is many small placements and
    // exactly the thing worth doing in one call. The troupe drawer registers
    // only when there is something in it — a tool surface is paid for on
    // every turn, and an empty drawer is not worth its line.
    const troupe = createTroupeTool(studio);
    const tools = [
        ...buildTools(studio).filter(tool => THEATRE.has(tool.name)),
        ...(troupe ? [troupe] : []),
        ...createStageTools(studio),
        ...publishingTools(studio),
    ];
    return [...tools, batchTool(studio, tools)].map(tool => reportChanges(studio, tool));
}

/** Every tool, registered or not — the tests exercise the ones a person still reaches. */
export function createAllCollageTools(studio: CollageStudio): WebMcpToolDef[] {
    const tools = [...buildTools(studio), ...createStageTools(studio)];
    return [...tools, batchTool(studio, tools)];
}

/**
 * Tell the agent what it missed.
 *
 * A person keeps editing while an agent thinks, so anything the agent believes
 * about the canvas can be stale by the time it acts — and the failure is quiet:
 * it moves a layer that is no longer where it thought, or reports a result
 * confidently having never looked. Polling would fix it and no agent reliably
 * remembers to poll.
 *
 * So every result carries a line when something has happened since that agent
 * last called anything. Only when there is something to say: an agent told
 * "nothing changed" fifteen times a minute learns to skip the line.
 */
function reportChanges(studio: CollageStudio, tool: WebMcpToolDef): WebMcpToolDef {
    return {
        ...tool,
        async execute(args: unknown, options?: { signal?: AbortSignal }) {
            const since = seen;
            const began = performance.now();
            const result = await tool.execute(args, options);
            // Logged here rather than in each tool, so a tool cannot be added
            // and quietly not appear in the record.
            noteCall({
                tool: tool.name,
                ms: performance.now() - began,
                ok: !result.isError,
                args,
                // Text parts only. An image part is a screenshot of the canvas,
                // and a base64 PNG per call is the one thing that would make
                // this log too big to open.
                reply: result.content
                    .map(part => (part.type === "text" ? part.text : `[${part.mimeType}]`))
                    .join(" | "),
            });
            const events = studio.eventsSince(since);
            seen = events.length ? events[events.length - 1].seq : since;

            /*
             * Point at the guide, once, on the way past.
             *
             * WebMCP has no way for a page to hand an agent instructions — no
             * skills, no prompts, no server instructions; tools are the entire
             * surface, and "skills" is an open question in the explainer rather
             * than an API. So the only thing a page can be sure an agent sees
             * is the reply to a call it already made, and this is that: an
             * agent that started somewhere in the middle gets told where the
             * beginning is, whether or not it read the tool list closely.
             *
             * Once per page load, and not on theater_start itself, because a
             * pointer to the thing you are already reading is noise.
             */
            const guide = !greeted && tool.name !== "theater_start";
            greeted = true;

            // The clip drawer is the person's other stage door: /record in a
            // second tab writes to the same localStorage, so a fresh read here
            // catches a move recorded seconds ago. First call baselines.
            const drawer = listClips();
            const before = knownClips ?? new Set(drawer.map(clip => clip.name));
            const recorded = knownClips ? drawer.filter(clip => !before.has(clip.name)) : [];
            knownClips = new Set(drawer.map(clip => clip.name));

            // Its own doing is not news; the person's is.
            const theirs = events.filter(event => event.by === "human");
            if (!theirs.length && !guide && !recorded.length) return result;
            const what = !theirs.length ? "" : theirs.length === 1
                ? theirs[0].summary
                : `${theirs.length} things happened, the last: ${theirs[theirs.length - 1].summary}`;
            /*
             * An ADD is not just news — it is direction. Somebody who drags a
             * new sticker onto the stage mid-conversation is saying "this
             * belongs in the story", the way somebody handing an actor a prop
             * mid-rehearsal is. Said outright, because "meanwhile, an image
             * was added" was read as a changelog and ignored.
             */
            const added = theirs.some(event =>
                event.kind === "image-added" || event.kind === "text-added");
            return {
                ...result,
                content: [
                    ...result.content,
                    ...(guide ? [{
                        type: "text" as const,
                        text:
                            `This page is a theatre and you are directing it. Call theater_start before ` +
                            `you build anything: it says what the page can do, and — more importantly — ` +
                            `what is already on it. This canvas is saved in the browser and comes back ` +
                            `by itself, so there may be a play here from another conversation that you ` +
                            `should be continuing rather than starting a second one beside.`,
                    }] : []),
                    ...(theirs.length ? [{
                        type: "text" as const,
                        text: `Meanwhile, the person was working: ${what}` +
                            (added
                                ? ` THEY PUT NEW PIECES ON THE STAGE — that is direction, not decoration. ` +
                                  `Look with piece_list or show_look, and work what they added into the ` +
                                  `story: cast it in a chapter, give it a line, let the plot notice it.`
                                : ""),
                    }] : []),
                    ...(recorded.length ? [{
                        type: "text" as const,
                        text: `The person just RECORDED NEW MOVES by hand: ${recorded
                            .map(clip => `"clip:${clip.name}"${clip.travel ? " (travels)" : ""}`)
                            .join(", ")}. They are usable right now as a beat's do — a recorded ` +
                            `move is a performance, so prefer it over a built-in where it fits, ` +
                            `and one marked (travels) really carries its performer across the paper.`,
                    }] : []),
                ],
            };
        },
    };
}

/**
 * Which page this is, and whether anybody can see it.
 *
 * Two problems that only show up from the agent's side of the wire. Tools are
 * registered per page, so two tabs on this site publish two identical sets and
 * an agent has no way to tell which one a call reached — the symptom is a reply
 * describing a canvas that does not match the one on screen. And a tab can be
 * in the background, where everything works and nobody sees any of it; an agent
 * that has just played a whole show to a hidden tab should say so rather than
 * report success.
 *
 * The id is per page load and deliberately short: it exists to be compared
 * between two replies, not to be meaningful.
 */
const PAGE_KEY = "theatre:page";

function whichPage(): { id: string; hidden: boolean; others: boolean } {
    if (typeof document === "undefined") return { id: "server", hidden: false, others: false };
    const held = (window as unknown as { __theatrePage?: string });
    if (!held.__theatrePage) {
        held.__theatrePage = Math.random().toString(36).slice(2, 7);
        // Claimed once, at first ask. The newest page to load owns the key, so
        // any page that later reads back somebody else's id knows it is not the
        // only one — which is as close to counting tabs as a page can get
        // without a lock or a broadcast channel.
        try {
            localStorage.setItem(PAGE_KEY, held.__theatrePage);
        } catch {
            // Private mode, or storage full. Not knowing about other tabs is a
            // missing warning, not a broken page.
        }
    }
    let claimed: string | null = null;
    try {
        claimed = localStorage.getItem(PAGE_KEY);
    } catch { /* as above */ }
    return {
        id: held.__theatrePage,
        hidden: document.visibilityState === "hidden",
        others: !!claimed && claimed !== held.__theatrePage,
    };
}

/** The last event this agent has been told about. */
let seen = 0;
/** Whether the agent has been pointed at theater_start yet, this page load. */
let greeted = false;
/**
 * The clip names the agent has been told exist. The tool description lists
 * the drawer as it stood at registration and cannot be re-sent — but the
 * person can record a new move on /record mid-conversation, and it works
 * the moment it is saved. So new names are news, delivered the same way the
 * person's stage edits are: in the reply to whatever the agent calls next.
 */
let knownClips: Set<string> | null = null;

/**
 * Run several tools in one call.
 *
 * Not a scripting tool, deliberately. "Let the agent write code" is the obvious
 * reading of the same wish, and it means handing an arbitrary string to eval on
 * the person's own origin — with their canvas, their IndexedDB and their
 * session sitting right there. A list of calls buys nearly all of the same
 * power and none of that: every step is a tool that already exists, with its
 * arguments already validated, and nothing new is reachable that was not
 * reachable before.
 *
 * What it does buy:
 *
 *  - **One round trip.** An agent driving a browser pays a timeout and a slow
 *    hop per call, so twenty moves as twenty calls is the difference between
 *    a second and a minute.
 *  - **One undo.** "Spread the heroes out" is one intention; it should come
 *    back in one step rather than being unpicked move by move.
 *  - **One readable sequence.** The canvas deals steps 125ms apart, so several
 *    changes stay quick but can still be followed by the person watching.
 */
function batchTool(studio: CollageStudio, tools: WebMcpToolDef[]): WebMcpToolDef {
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    return {
        name: "theater_batch",
        title: "Run several collage tools as one batch",
        description:
            "Run a list of collage tools in order, in one call. Use it whenever you know more than one step " +
            "in advance — moving six layers, styling a set, building a layout — because it is one round trip " +
            "instead of six, it undoes as a single step, and the canvas deals the changes 125ms apart. Each step " +
            "is { tool, args } exactly as you would have called it. Steps see what earlier steps did, so ids " +
            "from a piece_add step are usable later in the same batch.",
        inputSchema: {
            type: "object",
            properties: {
                steps: {
                    type: "array",
                    description: "The calls, in order.",
                    items: {
                        type: "object",
                        properties: {
                            tool: { type: "string", description: `A collage tool name, e.g. "piece_move".` },
                            args: { type: "object", description: "That tool's own arguments." },
                        },
                        required: ["tool"],
                    },
                },
                stopOnError: {
                    type: "boolean",
                    description:
                        "Stop at the first failure rather than carrying on. Default true — a later step " +
                        "usually assumes the earlier ones worked.",
                },
            },
            required: ["steps"],
        },
        async execute(args: { steps?: Array<{ tool?: string; args?: unknown }>; stopOnError?: boolean }) {
            const steps = Array.isArray(args?.steps) ? args.steps : [];
            if (!steps.length) return fail(`Pass "steps" — a list of { tool, args } to run in order.`);
            if (steps.length > MAX_BATCH) {
                return fail(
                    `${steps.length} steps is more than the ${MAX_BATCH} this runs at once. Send them in ` +
                    `smaller batches, looking with show_look between them.`);
            }

            // Named before anything runs, so a typo does not leave half a batch
            // applied and the other half unexplained.
            const unknown = steps.filter(step => !byName.has(str(step?.tool)) || str(step?.tool) === "theater_batch");
            if (unknown.length) {
                return fail(
                    `${unknown.map(s => `"${str(s?.tool) || "(missing)"}"`).join(", ")} — not a tool that can ` +
                    `run in a batch. Available: ${[...byName.keys()].join(", ")}.`);
            }

            const stopOnError = bool(args?.stopOnError, true);
            // One motion and one undo entry for the whole list.
            studio.settle();
            const outcomes: Array<{ tool: string; ok: boolean; text: string }> = [];
            await studio.collage.batch(async () => {
                for (let index = 0; index < steps.length; index++) {
                    const step = steps[index];
                    // Keep one network round trip and one undo entry, but deal
                    // the visible changes one at a time so a batch reads as a
                    // short sequence rather than everything popping at once.
                    if (index) await new Promise(resolve => setTimeout(resolve, 125));
                    const tool = byName.get(str(step.tool))!;
                    notifyAgentActivity(tool.name, step.args ?? {});
                    let result: ToolResult;
                    try {
                        result = await tool.execute(step.args ?? {});
                    } catch (error) {
                        result = fail(`threw: ${message(error)}`);
                    }
                    const text = result.content
                        .map(part => (part.type === "text" ? part.text : "[image]"))
                        .join(" ");
                    outcomes.push({ tool: tool.name, ok: !result.isError, text });
                    if (result.isError && stopOnError) break;
                }
            });

            const failed = outcomes.filter(o => !o.ok).length;
            const ran = outcomes.length;
            const lines = outcomes.map((o, i) => `${i + 1}. ${o.tool} — ${o.ok ? "" : "FAILED: "}${o.text}`);
            const summary = failed
                ? `${ran - failed} of ${steps.length} steps worked${ran < steps.length ? `, then it stopped` : ""}.`
                : `All ${ran} steps ran.`;
            return {
                ...ok(
                    `${summary}\n${lines.join("\n")}\n\nLook at the result with show_look.`,
                    { ran, failed, outcomes }),
                ...(failed && stopOnError ? { isError: true } : {}),
            };
        },
    };
}

/** How many steps one batch will run. Enough for a layout, short of a program. */
const MAX_BATCH = 40;

function buildTools(studio: CollageStudio): WebMcpToolDef[] {
    const { collage } = studio;

    const describeLayer = (layer: Layer) => {
        const where = `at ${Math.round(layer.x)}, ${Math.round(layer.y)}, ${Math.round(layer.width)}×${Math.round(layer.height)}`;
        if (layer.kind === "text") return `${layer.id} — text "${truncate(layer.text, 40)}", ${where}`;
        const styles = [
            layer.style.silhouette ? `silhouette ${layer.style.silhouette}` : null,
            layer.style.outline ? `outline ${layer.style.outline.width}px` : null,
            layer.style.shadow ? "shadow" : null,
        ].filter(Boolean);
        return `${layer.id} — "${layer.label}" ${where}${styles.length ? `, ${styles.join(", ")}` : ""}`;
    };

    const describeFrame = (frame: Frame) => {
        const size = outputSize(frame);
        const kind = frame.physical
            ? `${frame.physical.width}×${frame.physical.height}mm paper`
            : `${size.width}×${size.height}px`;
        const inside = collage.layersIn(frame.id);
        return `${frame.id} — "${frame.name}" (${kind}), ${inside.length} layer(s) inside`;
    };

    /**
     * The page being worked on.
     *
     * There is always one: a canvas with nothing set gets a free-form page that
     * simply follows the contents. Making an agent create a frame before it
     * could arrange or preview anything was a step that taught it nothing.
     */
    const resolveFrame = (id: unknown): { frame: Frame } | { error: ToolResult } => {
        if (typeof id === "string" && id) {
            const frame = collage.getFrame(id);
            if (!frame) return { error: fail(`There is no page with id "${id}". Call piece_list to see it.`) };
            return { frame };
        }
        const frames = collage.listFrames();
        if (frames.length) return { frame: frames[0] };
        return { frame: studio.setPage(FREE_PAGE) };
    };

    /** The newest event sequence number, or 0 when nothing has happened. */
    const latestCursor = (): number => {
        const all = studio.eventsSince(0);
        return all.length ? all[all.length - 1].seq : 0;
    };

    const requireLayer = (id: unknown): { layer: Layer } | { error: ToolResult } => {
        if (typeof id !== "string" || !id) return { error: fail(`Pass the "id" of a layer. Call piece_list to list them.`) };
        const layer = collage.get(id);
        if (!layer) return { error: fail(`There is no layer with id "${id}". Call piece_list for what is on the canvas.`) };
        return { layer };
    };

    return [
        {
            name: "theater_start",
            title: "What this page is, and how to put on a show",
            annotations: { readOnlyHint: true },
            description:
                "READ THIS FIRST. What this page is, what the tools do, and the order to use them in. " +
                "Also says what is already here, so a show in progress can be picked up rather than " +
                "started over. Costs one call and saves several.",
            inputSchema: { type: "object", properties: {} },
            async execute() {
                const layers = collage.listAll();
                const stages = collage.listStages();
                const billing = collage.billing;
                const where = whichPage();
                const avatar = getAgentAvatarSheet();
                const avatarState = {
                    name: avatar.name,
                    columns: avatar.columns,
                    rows: avatar.rows,
                    default: avatar.src === DEFAULT_AGENT_AVATAR_SHEET.src,
                };

                const state = [
                    billing.title ? `The piece is called "${billing.title}".` : `The piece has no title yet.`,
                    layers.length ? `${layers.length} piece(s) on the canvas.` : `The canvas is empty.`,
                    stages.length
                        ? `${stages.length} scene(s): ${stages.map(stage =>
                            `"${stage.name}" (${stage.cast.length ? `${stage.cast.length} in it` : "EMPTY"}` +
                            `${stage.script.length ? "" : ", nothing scripted"})`).join(", ")}.`
                        : `No scenes yet.`,
                ].join(" ");

                /*
                 * What to do next, not just what is there.
                 *
                 * A state summary gets read as a status report and repeated back
                 * as one — "two scenes, everything still there" — which is true
                 * and useless when the two scenes are empty. Counts do not tell
                 * anybody that a scene with nobody in it will play as a still
                 * picture of a backdrop; a sentence saying so does.
                 *
                 * One next step, not a list. The first thing that is missing is
                 * the thing to do, and offering three options is how an agent
                 * picks the easiest rather than the first.
                 */
                const emptyStages = stages.filter(stage => !stage.cast.length);
                const unscripted = stages.filter(stage => stage.cast.length && !stage.script.length);
                // Every scene can name its own bed and they end up with one
                // between them, because nothing ever said otherwise. Only worth
                // raising once there are enough scenes for it to be audible.
                const beds = new Set(stages.map(stage => stage.music ?? ""));
                const sameBed = stages.length > 2 && beds.size === 1 && !beds.has("");
                /*
                 * The idle page is not actually blank: troupe pieces are strewn
                 * on it as decoration, and the person may have arranged them.
                 * They are not document — piece_list will not show them and a
                 * show replaces them — but an agent that cannot see them will
                 * describe an empty room to somebody looking at a full one.
                 * Touched pieces matter most: those are where somebody put
                 * them, and a pitch that builds on that arrangement lands
                 * better than one that ignores it.
                 */
                const strewn = !layers.length && idleSet.props.length
                    ? [
                        ``,
                        `THE PAGE IS NOT BLANK`,
                        `  Troupe pieces are strewn on the idle page as a random starting point (not yet ` +
                        `on the canvas, so piece_list does not show them):`,
                        `  ${idleSet.props.map(prop =>
                            `${prop.piece} at ${prop.x}%,${prop.y}%${prop.touched ? " (placed by the person)" : ""}`,
                        ).join("; ")}.`,
                        `  Pieces marked "placed by the person" were arranged by hand. The moment any real ` +
                        `piece is added, ALL of these become real layers exactly where they stand — so you ` +
                        `can riff on the arrangement as it is, and theater_clear deals a fresh one.`,
                    ]
                    : [];

                const next =
                    !layers.length
                        ? `NEXT: there is nothing to stage. Look at theater_troupe, then PITCH the ` +
                          `person 1–3 stories you could stage with what is in the drawer — one line ` +
                          `each, naming the pack. If you can generate images, one pitch may go beyond ` +
                          `the packs. Build only after they have picked.`
                    : !stages.length
                        ? `NEXT: there are pieces but no scenes — and the pieces may BE the brief. The ` +
                          `person can arrange stickers on the canvas themselves, and an arrangement is a ` +
                          `story pitch made with their hands: look at it with show_look and piece_list ` +
                          `before inventing anything. Who stands next to whom, what is big, what is far ` +
                          `away — read it like a scene, offer a short story that fits it, then build the ` +
                          `play from it: stage_create (each scene at its own spot on the canvas), ` +
                          `stage_cast, and stage_script for the moves, lines and speech bubbles.`
                    : emptyStages.length
                        ? `NEXT: ${emptyStages.map(stage => `"${stage.name}"`).join(" and ")} ` +
                          `${emptyStages.length === 1 ? "has" : "have"} nobody in ` +
                          `${emptyStages.length === 1 ? "it" : "them"} and will play as a still picture. ` +
                          `Call stage_cast with who is in that stretch of the story — the pieces already ` +
                          `stand where the person arranged them, so usually ids and "as" are all it takes.`
                    : unscripted.length
                        ? `NEXT: ${unscripted.map(stage => `"${stage.name}"`).join(" and ")} ` +
                          `${unscripted.length === 1 ? "has" : "have"} a cast but nothing to do. Call ` +
                          `stage_script with the whole scene — moves, lines, sounds, camera — in one call.`
                    : sameBed
                        ? `NEXT: every scene is playing the same music, so the whole show sounds like ` +
                          `one long moment. Give each its own bed with stage_create — call show_sounds ` +
                          `for what there is. It is the cheapest way to make four scenes feel like four.`
                    : !billing.title
                        ? `NEXT: the play works but has no name. Call show_title, then show_play.`
                        : `NEXT: it is ready. Call show_play and narrate over the top of it.`;

                return ok([
                    `This is a theatre. The canvas is one infinite flat world seen from above —`,
                    `orthographic, no perspective; depth is pieces stacked in front of each other, never`,
                    `things shrinking into the distance. The pictures on it are the cast and the set,`,
                    `scenes are places on the paper, and you are directing. A person is watching the`,
                    `same canvas and can rearrange it while you work — show_watch tells you what they`,
                    `changed.`,
                    ``,
                    `YOUR FLOATING AVATAR`,
                    `  Currently using ${avatar.name}${avatarState.default ? " (bundled default)" : " (the user's saved selection)"}.`,
                    `  If filesystem permissions allow, set the little agent on the stage to the user's`,
                    `  ACTUAL selected Codex pet with theater_avatar. Do not pick another installed pet.`,
                    `  Find selected-avatar-id in ~/.codex/config.toml. Its matching artwork is normally`,
                    `  inside /Applications/ChatGPT.app/Contents/Resources/app.asar under`,
                    `  webview/assets/<selected-id>-spritesheet*.webp; an already extracted copy or the`,
                    `  selected pet's folder under ~/.codex/pets is equally good. Read the local image`,
                    `  bytes, base64-encode them as a data:image/webp;base64 URL, and pass the whole`,
                    `  spritesheet unchanged. A local path or HTTPS URL will not work here.`,
                    `  For example, selected-avatar-id = "seedy" means use Seedy's spritesheet, even if`,
                    `  Clippy or another pet is also installed. If you cannot read those paths, leave`,
                    `  Codey, the bundled default, alone; this is optional and must not hold up the play.`,
                    ``,
                    `THE ONE THING TO GET RIGHT`,
                    `  A set is BUILT, not painted. Do not ask an image model for "a forest" and use what`,
                    `  comes back: that is one flat picture with the trunks, the ferns and the light baked`,
                    `  into it, and nothing in it can move, stand in front of anything, or slide past`,
                    `  anything as the camera pans. It is a photograph of a set.`,
                    `  Ask instead for separate cut-outs and assemble them here:`,
                    `    - scenery as separate cut-outs — a tree, a bush, a door, a rock, one per cell;`,
                    `    - the cast as separate cut-outs, full body, feet visible.`,
                    `  There are NO backdrop panels and NO depth planes. The play happens in the open, on`,
                    `  the paper itself: the canvas IS the world, whatever is arranged on it is the set,`,
                    `  and the stacking order on the paper is the paint order. Depth is a thing you`,
                    `  compose — a bush drawn over the path, a tree behind the house — not a setting.`,
                    ``,
                    `THIS STAGE IS FLAT, AND THAT IS THE POINT`,
                    `  It is a paper theatre seen from the front, not a 3D world. Everything is drawn`,
                    `  straight on, with no perspective and no vanishing point — a backdrop with a path`,
                    `  winding into the distance cannot be layered or parallaxed, it can only be stared`,
                    `  at. Depth comes from the three planes and nothing else.`,
                    `  So people move LEFT and RIGHT. A "walk" takes a "to" in canvas units and should`,
                    `  change x, not y: someone crossing the stage goes sideways, and someone walking`,
                    `  "into" the scene has nowhere to go. To make somebody arrive from far away, put`,
                    `  them on the back plane and move them forward a plane instead.`,
                    ``,
                    `IT REMEMBERS`,
                    `  Everything on this page is saved in this browser and comes back on its own — the`,
                    `  pieces, the scenes, the script, the title. The tools you are reading did not exist`,
                    `  until the saved play had finished loading, so what is listed under RIGHT NOW is`,
                    `  everything there is, and it is already here.`,
                    `  So when you arrive at this page, CHECK BEFORE YOU BUILD. If there is a play, carry`,
                    `  it on — add the scene it is missing, fix the thing that is wrong — rather than`,
                    `  starting another one beside it. Nothing is cleared between conversations, and two`,
                    `  half-finished plays on one canvas is the usual way this goes wrong.`,
                    ``,
                    `THE STORY COMES FIRST — OPEN BY PITCHING`,
                    `  Do not ask an empty question; bring ideas. Look at what the troupe holds`,
                    `  (theater_troupe) and pitch 1–3 stories you could stage with it — one line`,
                    `  each: who wants what, what stands in the way, what changes. Name the pack`,
                    `  each pitch would use, so choosing a story is choosing a look. If you can`,
                    `  generate images yourself, one pitch may go beyond the packs — say so; the`,
                    `  page cuts whatever you generate into pieces (theater_art_prompt writes the`,
                    `  prompt, piece_sheet does the cutting).`,
                    `  Let the person pick or redirect BEFORE you build anything. Every later`,
                    `  choice — which backdrops, which cast, what each scene is for — follows from`,
                    `  the story. A play built art-first is a slideshow with a plot attached, and`,
                    `  that is what every shallow play so far has been.`,
                    ``,
                    `THE ORDER OF WORK`,
                    ...(TROUPE.length
                        ? [`  1. theater_troupe FIRST: ready-made, precut art is already installed, and a`,
                           `     pack that fits the story is on stage in seconds instead of minutes. Only`,
                           `     generate what the drawer does not cover.`,
                           `  2. For anything missing, theater_art_prompt writes the prompt for the art the`,
                           `     STORY needs — once per kind: scenery,`]
                        : [`  1. theater_art_prompt writes the prompt for the art the STORY needs — once per`,
                           `     kind: scenery,`]),
                    `     actors. Ask for ONE FULL SHEET each time, never one picture at a time: 5 × 5,`,
                    `     which is 25 pieces from one generation. A sheet also comes back looking like`,
                    `     one set, where 25 separate generations come back looking like 25 different books.`,
                    `  2. piece_sheet brings each sheet in, one piece per cell.`,
                    `  3. show_title names the piece AND signs it: pass "credits" with the maker's`,
                    `     lines — story, direction, whose paper — rolled after the cast at the end.`,
                    `  4. stage_create per scene, each at its own spot on the canvas, with its music.`,
                    `     The play stays on the open paper; the camera does the framing.`,
                    `  5. stage_cast for everybody in that chapter's stretch of the story. Casting does`,
                    `     not move anybody — the arrangement on the paper IS the blocking; pass x/y only`,
                    `     to also rearrange the world. Give each an entrance and an "as" naming who they`,
                    `     play.`,
                    `  6. stage_script — moves, lines, sounds and camera moves, in order.`,
                    `  7. show_play. It returns at once with the timings; narrate over the top of it.`,
                    ``,
                    `WHAT ELSE TO KNOW`,
                    `  - One call, whole scene. You cannot animate by calling a tool per frame, and you`,
                    `    do not need to: hand over the entire script and the page performs it.`,
                    `  - Look before you judge. show_look returns a picture of the canvas — you are`,
                    `    staging something visual, and the ids alone will not tell you it looks wrong.`,
                    `  - theater_batch runs many calls at once when you already know what you want.`,
                    `  - piece_copy clones any piece — a flock from one sheep, the hero appearing at`,
                    `    three doors. A beat's "effect" throws paper over a moment (sparkles, poof,`,
                    `    confetti, hearts, rain), and "with": true plays a beat simultaneously with the`,
                    `    previous one, so two characters can act or speak at the same time.`,
                    ``,
                    `RIGHT NOW`,
                    `  This page: ${where.id}${where.hidden ? "  (NOT VISIBLE)" : ""}`,
                    ...(where.hidden
                        ? [`  The person cannot see this tab — it is in the background or minimised. ` +
                           `Everything below will happen where nobody is watching, and a show played ` +
                           `here plays to an empty room. Ask them to bring it to the front first.`]
                        : []),
                    ...(where.others
                        ? [`  More than one theatre page is open in this browser and each registers its ` +
                           `own copy of these tools. If a call seems to land somewhere unexpected, that ` +
                           `is why: check this id against the one in the last reply.`]
                        : []),
                    `  ${state}`,
                    `  ${next}`,
                    ...strewn,
                ].join("\n"), {
                    layers: layers.length,
                    stages: stages.map(stage => ({
                        id: stage.id,
                        name: stage.name,
                        cast: stage.cast.length,
                        backdrop: stage.backdrop,
                        beats: stage.script.length,
                    })),
                    billing,
                    next,
                    page: where.id,
                    visible: !where.hidden,
                    avatar: avatarState,
                });
            },
        },
        {
            name: "theater_avatar",
            title: "Use the person's selected Codex pet",
            description:
                "Set the floating agent to the user's actual selected Codex pet spritesheet. Call only " +
                "when local permissions let you discover and read that selected pet; pass the unchanged " +
                "local bytes as a data:image URL. Pass url 'default' to use bundled Codey. The standard " +
                "Codex pet grid is 8 columns by 11 rows.",
            inputSchema: {
                type: "object",
                properties: {
                    url: { type: "string", description: "The complete local pet sheet as a base64 data:image URL, or 'default'." },
                    name: { type: "string", description: "The selected pet's display name. Omit when url is 'default'." },
                    columns: { type: "number", description: "Sheet columns; standard Codex pets use 8." },
                    rows: { type: "number", description: "Sheet rows; standard Codex pets use 11." },
                },
                required: ["url"],
            },
            async execute(args: { url?: string; name?: string; columns?: number; rows?: number }) {
                const url = str(args?.url);
                const name = str(args?.name);
                if (url.toLowerCase() === "default") {
                    setAgentAvatarSheet(null);
                    return ok(
                        `Codey is now the floating agent. The bundled default spritesheet is active.`,
                        { name: "Codey", columns: 8, rows: 11, default: true },
                    );
                }
                if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) {
                    return fail(`Pass "default", or read the selected local pet sheet and pass its bytes as a base64 data:image URL.`);
                }
                if (!name) return fail(`Pass the selected pet's name.`);
                const columns = num(args?.columns) ? Math.round(args.columns) : 8;
                const rows = num(args?.rows) ? Math.round(args.rows) : 11;
                if (columns < 1 || columns > 16 || rows < 5 || rows > 24) {
                    return fail(`The spritesheet grid must have 1–16 columns and 5–24 rows.`);
                }
                setAgentAvatarSheet({ src: url, name, columns, rows });
                return ok(
                    `${name} is now the floating agent. The fifth row from the bottom is used while ` +
                    `thinking; the last two rows look toward the work.`,
                    { name, columns, rows },
                );
            },
        },
        {
            name: "theater_clear",
            title: "Clear the whole stage",
            description:
                "Start the theatre over: deletes EVERY piece, scene, script and title — including " +
                "whatever the person put there. Not undoable by you. Call it only when the person asked " +
                "for a restart or a clean canvas, and pass confirm: true. The paper then stays bare for " +
                "half a minute; only if nothing is built by then does the idle page deal a fresh scatter.",
            inputSchema: {
                type: "object",
                properties: {
                    confirm: {
                        type: "boolean",
                        description: "Must be true. The guard between \"restart\" and an accidental wipe.",
                    },
                },
                required: ["confirm"],
            },
            async execute(args: { confirm?: boolean }) {
                if (args?.confirm !== true) {
                    return fail(
                        `Not cleared. This deletes everything on the canvas — every piece and scene, ` +
                        `the person's arrangement included. Pass confirm: true if that is really wanted.`);
                }
                if (studio.showing) studio.stopShow();
                idleSet.clearedBy = "agent";
                await studio.clear();
                return ok(
                    `The set is struck: canvas, scenes and title are gone. The paper stays bare for ` +
                    `half a minute — room to build clean. If nothing is put down by then, the idle ` +
                    `page deals a fresh random scatter of troupe stickers as a new starting point.`);
            },
        },
        {
            name: "theater_background",
            title: "Recolour the paper",
            description:
                "Fade the canvas background to a colour — the stage lighting, not a backdrop. Use it " +
                "for mood: a deep blue for night, a hot ochre for a desert noon, back to 'paper' when " +
                "the story returns home. Works any time, mid-show included, and fades over about a " +
                "second. The dot grid stays; pieces are unaffected. Prefer muted, papery tones — the " +
                "cut-outs still have to read against it.",
            inputSchema: {
                type: "object",
                properties: {
                    color: {
                        type: "string",
                        description: `A hex colour like "#1B2440" — or "paper" for the house default.`,
                    },
                },
                required: ["color"],
            },
            async execute(args: { color?: string }) {
                const color = str(args?.color).toLowerCase();
                if (!color) return fail(`Pass "color" — a hex colour, or "paper" to reset.`);
                if (color !== "paper" && !/^#[0-9a-f]{3,8}$/i.test(color)) {
                    return fail(`"${color}" is not a hex colour like "#1B2440", and not "paper".`);
                }
                studio.collage.setBackground(color === "paper" ? "" : color);
                studio.save();
                studio.record("page-changed",
                    color === "paper" ? "The paper returns to its own colour." : `The paper fades to ${color}.`,
                    "agent");
                return ok(color === "paper"
                    ? `The paper fades back to its own colour.`
                    : `The paper fades to ${color}. Pass "paper" to undo the weather.`);
            },
        },
        {
            name: "theater_art_prompt",
            title: "Write the prompt for the artwork",
            annotations: { readOnlyHint: true },
            description:
                "Get a ready-to-use image-generation prompt for the art this show needs, then paste it " +
                "into whatever can draw. Ask for one SHEET — a grid of separate pictures in a single " +
                "image — because that is what piece_sheet cuts apart, and because one sheet comes back " +
                "looking like one set rather than nine unrelated drawings. " +
                "THREE kinds, and a scene needs all three: 'backgrounds' is the far plane only — sky, " +
                "distance, a ground line and nothing else; 'scenery' is the trees, bushes, doors and " +
                "rocks that stand in FRONT of it, one per cell, cut out on white; 'actors' is the cast, " +
                "full body with their feet visible. Do NOT ask for a finished-looking scene: a painting " +
                "with the trees already in it cannot be stood in front of, animated, or parallaxed, and " +
                "it is the single most common way a show ends up flat. " +
                "'layers' is the fourth, and the one that gives a scene depth: 25 SEGMENTS of a " +
                "midground band and a foreground band, each with open ragged ends so copies butt " +
                "together into a band as wide as the camera ever travels. Ask for these rather than " +
                "a full-width painted midground — a fixed-width strip has two hard edges, and a pan " +
                "or a pull-back reveals them. " +
                "All are written in one house style so the cast and the set match. Brand and " +
                "studio names in your topic are replaced with what they actually describe, and the " +
                "reply says which. " +
                "Ask for a FULL SHEET each time — 5 × 5 for actors and scenery, which is 25 pieces in " +
                "one go. A set is made of a lot of small things, and generating them one at a time is " +
                "the slowest possible way to build one. " +
                "The exception is a sheet of BIG things — a throne, a door, a wall, a tree meant to " +
                "fill the stage. Cells share the sheet's pixels, so 25 of them land around 250px each " +
                "and look soft the moment one is drawn large; ask for columns 3, rows 3 and each piece " +
                "gets two thirds again the size. Keep 5 × 5 for anything played small.",
            inputSchema: {
                type: "object",
                properties: {
                    kind: {
                        type: "string",
                        enum: ["actors", "backgrounds", "scenery", "layers"],
                        description:
                            "The far backdrop, the cut-out scenery that stands in front of it, the " +
                            "cast, or 'layers' — segments of a midground and a foreground band, made " +
                            "to be repeated side by side. A scene is built from a backdrop, layers " +
                            "for depth, scenery for detail and actors to play it.",
                    },
                    topic: {
                        type: "string",
                        description:
                            "What the play is about, in the words the person used — 'Little Red Riding " +
                            "Hood', 'a robot who loses a bolt'.",
                    },
                    columns: {
                        type: "number",
                        description:
                            "Cells across, 1–5. Leave it alone: the defaults are 5 × 5 for actors and " +
                            "scenery — 25 pieces from one generation — and a single column of 3 for " +
                            "backdrops, so each one is a full-width strip and comes back the panorama " +
                            "shape a stage needs rather than a square.",
                    },
                    rows: { type: "number", description: "Cells down, 1–5." },
                    shape: {
                        type: "string",
                        enum: ["wide", "square", "tall"],
                        description:
                            "The shape of one cell. For backdrops this is a real decision: 'wide' is a " +
                            "21:9 panorama for a scene people cross — a road, a forest, a hall — and is " +
                            "the default; 'tall' is for a scene with height in it, a tower, a cliff, a " +
                            "well. The camera pans across the one and up the other. Actors and scenery " +
                            "are square and should stay that way.",
                    },
                    subjects: {
                        type: "array",
                        items: { type: "string" },
                        description:
                            "What goes in each cell, in reading order. Worth giving: the defaults are a " +
                            "generic folk tale and you know the story. Keep the same order when you pass " +
                            "labels to piece_sheet and every piece arrives named.",
                    },
                },
                required: ["kind"],
            },
            async execute(args: {
                kind?: string; topic?: string; columns?: number; rows?: number;
                shape?: string; subjects?: string[];
            }) {
                const kind = args?.kind === "backgrounds" ? "backgrounds"
                    : args?.kind === "scenery" ? "scenery"
                        : "actors";
                const shape = args?.shape;
                const written = artPrompt({
                    kind,
                    ...(str(args?.topic) ? { topic: str(args.topic) } : {}),
                    ...(num(args?.columns) ? { columns: args.columns } : {}),
                    ...(num(args?.rows) ? { rows: args.rows } : {}),
                    ...(shape === "wide" || shape === "square" || shape === "tall" ? { shape } : {}),
                    ...(Array.isArray(args?.subjects) ? { subjects: args.subjects.map(str) } : {}),
                });

                const swapped = written.removed.length
                    ? `Note: ${written.removed.map(name => `"${name}"`).join(", ")} ` +
                      `${written.removed.length === 1 ? "was" : "were"} taken out of the topic and replaced ` +
                      `with what ${written.removed.length === 1 ? "it describes" : "they describe"}. Say so, ` +
                      `so the result is not a surprise.`
                    : null;

                const cells = written.columns * written.rows;
                return ok([
                    swapped,
                    // Agents paraphrase prompts. Every clause in this one was
                    // added because something came back wrong without it — the
                    // grid, the flatness, the white outlines, the uniqueness —
                    // so a helpful summary is a regeneration.
                    `PASS THIS PROMPT EXACTLY AS WRITTEN. Do not shorten it, summarise it, translate it ` +
                    `or write your own version: every rule in it is there because the picture came back ` +
                    `wrong without it, and the ones that look like fussy detail are the ones that matter ` +
                    `most. Copy it whole.`,
                    ...(cells < 9 && kind !== "backgrounds"
                        ? [`You asked for only ${cells} cells. A set needs a lot of small things and each ` +
                           `generation is a round trip — 5 × 5 is the default for a reason. Unless you ` +
                           `have a specific reason for ${cells}, call this again without columns/rows.`]
                        : []),
                    `Then bring the sheet back with piece_sheet(url, columns: ${written.columns}, ` +
                    `rows: ${written.rows}, as: "${kind === "backgrounds" ? "backgrounds" : "actors"}").`,
                    ...(kind === "backgrounds"
                        ? [`This is only the far plane. Ask for a "scenery" sheet too, or the scene will ` +
                           `be one flat card with nothing in front of it.`]
                        : []),
                    ``,
                    written.prompt,
                ].filter(Boolean).join("\n"), {
                    prompt: written.prompt,
                    columns: written.columns,
                    rows: written.rows,
                    subjects: written.subjects,
                    removed: written.removed,
                    as: kind,
                });
            },
        },
        {
            name: "piece_sheet",
            title: "Cut a sheet into pieces",
            description:
                "One image holding a grid of separate pictures becomes one piece per cell. This is how " +
                "art written by theater_art_prompt gets onto the canvas: an image model will not hand " +
                "over nine cut-outs, it hands over one sheet, and this is the other half of that. " +
                "'actors' cuts each cell out of its background so it can stand on a stage; 'backgrounds' " +
                "keeps each cell whole, because a backdrop IS a background and removing it would leave " +
                "nothing. Pass the same labels you gave as subjects and every piece arrives named.",
            inputSchema: {
                type: "object",
                properties: {
                    url: { type: "string", description: "http(s) or data: URL of the sheet." },
                    columns: { type: "number", description: "Cells across." },
                    rows: { type: "number", description: "Cells down." },
                    as: {
                        type: "string",
                        enum: ["actors", "backgrounds"],
                        description:
                            "What is on it. 'actors' is for anything that stands on a stage — use it for " +
                            "scenery too, since a tree is cut out exactly as a person is. 'backgrounds' " +
                            "is for the stages themselves: they are sized to fill a stage rather than " +
                            "scaled against each other. Both have their white surround removed.",
                    },
                    labels: {
                        type: "array",
                        items: { type: "string" },
                        description: "What each cell is, in reading order — left to right, then down.",
                    },
                },
                required: ["url", "columns", "rows", "as"],
            },
            async execute(args: {
                url?: string; columns?: number; rows?: number; as?: string; labels?: string[];
            }) {
                const url = str(args?.url);
                if (!url) return fail(`Pass a "url" — http(s) or data:.`);
                if (!/^(https?:|data:image\/)/i.test(url)) {
                    return fail(`"${truncate(url, 60)}" is not an image URL. Use http(s), or a data:image/… URL.`);
                }

                const columns = num(args?.columns) ? Math.round(args.columns) : 0;
                const rows = num(args?.rows) ? Math.round(args.rows) : 0;
                if (columns < 1 || rows < 1 || columns > 8 || rows > 8) {
                    return fail(
                        `"columns" and "rows" say how the sheet is divided, and both must be between 1 and ` +
                        `8. A 2 x 2 sheet of backdrops is columns: 2, rows: 2.`);
                }
                const labels = (Array.isArray(args?.labels) ? args.labels : []).map(str);
                const actors = args?.as !== "backgrounds";

                try {
                    // The grid is cut here, in the page. There is nothing to
                    // guess: three columns means thirds. Handing the whole
                    // sheet to the cutter and asking it to find the subjects
                    // spends a round trip re-deriving what it was already told,
                    // and when it answers with one object instead of three
                    // there is nothing to look at and no way to say why.
                    const work = studio.addSheet(url, {
                        columns, rows, labels,
                        // Everything is cut out, backdrops included: a
                        // generated backdrop is a torn paper card on a white
                        // sheet, and the sheet is not part of the picture.
                        removeBackground: true,
                        asBackdrop: !actors,
                        by: "agent",
                    });
                    const raced = await within(work, () => ok(
                        `Cutting the sheet — this is taking a while, which on a first call means the ` +
                        `background remover is still downloading (tens of megabytes, once per browser). ` +
                        `It is still running. Do NOT call this again with the same sheet: follow it with ` +
                        `show_watch, then piece_list.`,
                        { pending: true }));
                    if (!("value" in raced)) return raced;

                    const made = raced.value;
                    if (!made.length) return fail(`The sheet could not be cut — none of its cells came back.`);
                    if (made.length < columns * rows) {
                        return ok(
                            `${made.length} of ${columns * rows} cells came back: ` +
                            `${made.map(layer => `"${layer.label}" [${layer.id}]`).join(", ")}. ` +
                            `A cell that comes back empty is usually a blank one on the sheet. ` +
                            `Look with show_look.`,
                            { layers: made, pieces: made.length, as: actors ? "actors" : "backgrounds" });
                    }

                    return ok(
                        actors
                            ? `Cut into ${made.length} piece(s): ` +
                              `${made.map(layer => `"${layer.label}" [${layer.id}]`).join(", ")}. ` +
                              `Each is its own cut-out and can be cast, moved and animated. Look with show_look.`
                            : `Cut into ${made.length} backdrop(s): ` +
                              `${made.map(layer => `"${layer.label}" [${layer.id}]`).join(", ")}. ` +
                              `Each is ready to be a scene's backdrop — pass one to stage_create as ` +
                              `"backdrop". Look with show_look.`,
                        { layers: made, pieces: made.length, as: actors ? "actors" : "backgrounds" });
                } catch (error) {
                    return fail(`The sheet could not be cut — ${(error as Error).message}`);
                }
            },
        },
        {
            name: "piece_list",
            title: "Describe the collage",
            annotations: { readOnlyHint: true },
            description:
                "Everything on the canvas, the output page, and any resolution problems. " +
                "Call before changing anything, and call show_look to actually see it.",
            inputSchema: { type: "object", properties: {} },
            async execute() {
                const layers = collage.list();
                const frames = collage.listFrames();
                const quality = frames.map(frame => checkFrame(collage.layersIn(frame.id), frame));
                const warnings = quality.map(q => q.summary).filter(Boolean);

                const parts = [
                    frames.length
                        ? `Page: ${frames.map(describeFrame).join("\n")}`
                        : `Page: none set yet — it defaults to "${FREE_PAGE}", the canvas itself. ` +
                          `Use show_page for a fixed size like a4-portrait.`,
                    layers.length
                        ? `Layers (back to front):\n${layers.map(describeLayer).join("\n")}`
                        : `The canvas is empty. Add photos with piece_add — backgrounds come off automatically.`,
                ];
                if (studio.selection.length) {
                    const chosen = studio.selection.map(id => collage.get(id)).filter(Boolean) as Layer[];
                    parts.push(
                        `Selected: ${chosen.map(l => `"${l.label}" [${l.id}]`).join(", ")}. ` +
                        `show_capture returns a picture of just these.`);
                }
                if (warnings.length) parts.push(`Resolution:\n${warnings.join("\n")}`);

                return ok(parts.join("\n\n"), {
                    layers,
                    frames,
                    page: studio.pagePreset,
                    selection: studio.selection,
                    quality,
                    pages: [FREE_PAGE, ...FRAME_PRESETS.map(p => p.id)],
                });
            },
        },
        {
            name: "piece_add",
            title: "Add an image to the collage",
            description:
                "Put an image on the canvas from an http(s) or data: URL. " +
                "The background is removed automatically — this page cuts it out in the browser, so do NOT " +
                "open FastCut or any other tool first; just pass the original photo. " +
                "An image that is already transparent is left alone. Pass removeBackground: false to keep a " +
                "background on purpose. The result says what happened, and what to do if the cut could not run. " +
                "A picture holding several distinct objects — a poster, a sheet of stickers, things laid out " +
                "on a table — comes apart into one layer per object, each where it was, so what arrives is " +
                "editable rather than flat. That is usually the point of handing one over: generate the " +
                "picture, pass it here, and every part of it can then be moved, restyled or replaced. " +
                "Objects are found by transparency, which only separates things that do not touch. When they " +
                "DO touch — three figures standing together, anything posed as a group — pass \"regions\": " +
                "you can see the picture and the page cannot, so say where each subject is and it will be cut " +
                "out and cleaned up inside that box.",
            inputSchema: {
                type: "object",
                properties: {
                    url: { type: "string", description: "http(s) or data: URL of the original photo — no need to cut it out first." },
                    label: { type: "string", description: "A name you will recognise later, e.g. 'red sneaker'." },
                    removeBackground: { type: "boolean", description: "Default true. Set false only to keep the background deliberately." },
                    x: { type: "number", description: "Canvas x. Omit to place it automatically." },
                    y: { type: "number", description: "Canvas y." },
                    width: { type: "number", description: "Canvas width. Height follows the aspect ratio." },
                    slice: {
                        type: "boolean",
                        description:
                            "Default true. Set false to keep a picture of several things as one layer.",
                    },
                    heal: {
                        type: "boolean",
                        description:
                            "Default false. Also keep the scene behind the objects as a backdrop layer. " +
                            "Costs a second model download and a slow pass, so ask for it when the " +
                            "background is worth having, not by habit.",
                    },
                    regions: {
                        type: "array",
                        description:
                            "Where each subject is, for a picture whose subjects touch. Fractions of the " +
                            "image, 0–1, from the top left — not pixels, because you are looking at a " +
                            "resized copy. One box per thing you want as its own layer. Draw them generously: " +
                            "a box that clips a subject loses whatever it clipped, while a box that catches " +
                            "some of the neighbour is cleaned up.",
                        items: {
                            type: "object",
                            properties: {
                                x: { type: "number", description: "Left edge, 0–1." },
                                y: { type: "number", description: "Top edge, 0–1." },
                                width: { type: "number", description: "Width, 0–1." },
                                height: { type: "number", description: "Height, 0–1." },
                                label: { type: "string", description: "What it is, e.g. 'woman with the star cape'." },
                            },
                            required: ["x", "y", "width", "height"],
                        },
                    },
                },
                required: ["url"],
            },
            async execute(args: {
                url?: string; label?: string; removeBackground?: boolean;
                x?: number; y?: number; width?: number; slice?: boolean; heal?: boolean;
                regions?: Array<{ x?: number; y?: number; width?: number; height?: number; label?: string }>;
            }) {
                const url = str(args?.url);
                if (!url) return fail(`Pass a "url" — http(s) or data:.`);
                if (!/^(https?:|data:image\/)/i.test(url))
                    return fail(`"${truncate(url, 60)}" is not an image URL. Use http(s), or a data:image/… URL.`);

                // Boxes are fractions, and one given in pixels would silently
                // land off the edge of the image rather than failing, so it is
                // worth saying which mistake was made.
                const regions = Array.isArray(args?.regions) ? args.regions : [];
                const outOfRange = regions.find(r =>
                    ![r?.x, r?.y, r?.width, r?.height].every(v => typeof v === "number" && v >= 0 && v <= 1));
                if (outOfRange) {
                    return fail(
                        `Regions are fractions of the image between 0 and 1, not pixels — ` +
                        `${JSON.stringify(outOfRange)} is outside that. A box covering the left third of a ` +
                        `picture is { x: 0, y: 0, width: 0.33, height: 1 }, whatever the image's real size.`);
                }
                try {
                    // Kept running even if the caller stops waiting, so a slow
                    // first cut still lands on the canvas.
                    const work = studio.addImage(url, {
                        label: args?.label,
                        removeBackground: bool(args?.removeBackground, true),
                        slice: bool(args?.slice, true),
                        heal: bool(args?.heal, false),
                        regions: regions.length
                            ? regions.map(r => ({
                                x: r.x as number, y: r.y as number,
                                width: r.width as number, height: r.height as number,
                                ...(str(r.label) ? { label: str(r.label) } : {}),
                            }))
                            : undefined,
                        x: args?.x,
                        y: args?.y,
                        width: args?.width,
                        by: "agent",
                    });

                    const raced = await within(work, () => ok(
                        `Working on "${args?.label ?? "the image"}" — this is taking a while, which on a first ` +
                        `call means the background remover is still downloading (tens of megabytes, once per ` +
                        `browser). It is still running and will land on the canvas. Do NOT call this again ` +
                        `with the same image: follow it with show_watch, then piece_list.`,
                        { pending: true }));
                    if (!("value" in raced)) return raced;
                    const { layer, loaded, background, pieces } = raced.value;
                    const cutout = loaded.coverage < 0.95;
                    const notes = [
                        `${loaded.width}×${loaded.height}px`,
                        loaded.colors.length ? `colours ${loaded.colors.slice(0, 3).join(", ")}` : null,
                        loaded.tainted ? "pixels are not readable (served without CORS) — it displays but cannot be exported" : null,
                    ].filter(Boolean);

                    // Say plainly what happened to the background. An agent that
                    // is told the cut failed can route around it; one that is
                    // told nothing ships a collage of photo-shaped rectangles.
                    const cut = background.ok
                        ? "Background removed."
                        : background.skipped
                            ? "It was already a cut-out, so it was left as it is."
                            : `The background was NOT removed — ${background.reason}`;

                    // A picture that came apart is a different answer, and
                    // reporting it as one layer would send the agent looking for
                    // a layer that is only a sixth of what arrived.
                    // Regions were given but nothing came back in parts. Which
                    // reason gets reported matters: blaming the boxes when the
                    // cut-out itself failed sends the agent off redrawing boxes
                    // that were never the problem. The tell is whether the
                    // background came off at all.
                    if (regions.length && (!pieces || pieces.length <= 1)) {
                        return ok(
                            background.ok
                                ? `Added "${layer.label}" as ${layer.id}, but the ${regions.length} regions did ` +
                                  `not separate it. The background came off, so the boxes are the suspect — ` +
                                  `they are fractions of the image from the top left, 0–1. Look with ` +
                                  `show_look and try again, or leave it as one layer.`
                                : `Added "${layer.label}" as ${layer.id} with its background still on, so the ` +
                                  `regions never got a chance — ${background.reason ?? "the cut-out failed"}. ` +
                                  `This is not about where the boxes are.`,
                            {
                                layer,
                                regions: regions.length,
                                separated: false,
                                backgroundRemoved: background.ok,
                                reason: background.reason ?? null,
                            });
                    }

                    if (pieces && pieces.length > 1) {
                        const backdrop = !!background.backplate;
                        const objects = backdrop ? pieces.slice(1) : pieces;
                        return ok(
                            `"${layer.label}" held ${objects.length} separate things, so it came apart into ` +
                            `${objects.length} layers, each where it was in the picture` +
                            `${backdrop ? `, with the emptied scene behind them as "${pieces[0].label}"` : ""}. ` +
                            `Every one can be moved, restyled or replaced on its own. ` +
                            `Ids: ${pieces.map(p => p.id).join(", ")}. Look with show_look.`,
                            {
                                layers: pieces,
                                pieces: objects.length,
                                backdrop: backdrop ? pieces[0].id : null,
                                source: { width: loaded.width, height: loaded.height, colors: loaded.colors, tainted: loaded.tainted },
                            });
                    }

                    return ok(
                        `Added "${layer.label}" as ${layer.id} — ${notes.join(", ")}. ${cut} ` +
                        (cutout ? `Cropped to its visible shape. ` : "") +
                        `Arrange it with piece_arrange, then look with show_look.`,
                        {
                            layer,
                            background: { removed: background.ok, skipped: !!background.skipped, reason: background.reason ?? null },
                            source: { width: loaded.width, height: loaded.height, colors: loaded.colors, cutout, tainted: loaded.tainted },
                        });
                } catch (error) {
                    return fail(`Could not add that image: ${message(error)}`);
                }
            },
        },
        {
            name: "piece_recut",
            title: "Cut the background out of a layer",
            description:
                "Re-run background removal on an image already on the canvas — for one that was added with " +
                "removeBackground: false, or whose first cut came out wrong.",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string", description: "The layer's id." } },
                required: ["id"],
            },
            async execute(args: { id?: string }) {
                const found = requireLayer(args?.id);
                if ("error" in found) return found.error;
                if (found.layer.kind !== "image") return fail(`${found.layer.id} is text — there is no background to remove.`);
                try {
                    const result = await studio.removeBackgroundFor(found.layer.id);
                    if (!result.ok) return fail(result.reason ?? "The background could not be removed.");
                    const layer = collage.get(found.layer.id);
                    return ok(`Cut the background out of "${found.layer.label}". Look at it with show_look.`, { layer });
                } catch (error) {
                    return fail(`Background removal failed: ${message(error)}`);
                }
            },
        },
        {
            name: "piece_text",
            title: "Add text to the collage",
            description: "Put a headline or caption on the canvas. It stays real text in the exported HTML.",
            inputSchema: {
                type: "object",
                properties: {
                    text: { type: "string", description: "What it says." },
                    x: { type: "number" },
                    y: { type: "number" },
                    fontSize: { type: "number", description: "In canvas units. Default 48." },
                    color: { type: "string", description: "Any CSS colour." },
                    align: { type: "string", enum: ["left", "center", "right"] },
                    rotation: { type: "number", description: "Degrees of tilt." },
                },
                required: ["text"],
            },
            async execute(args: { text?: string; x?: number; y?: number; fontSize?: number; color?: string; align?: any; rotation?: number }) {
                const text = str(args?.text);
                if (!text) return fail(`Pass some "text".`);
                const layer = collage.addText({
                    text,
                    x: args?.x,
                    y: args?.y,
                    fontSize: args?.fontSize,
                    color: args?.color,
                    align: args?.align,
                    rotation: args?.rotation,
                });
                return ok(`Added text "${truncate(text, 40)}" as ${layer.id}.`, { layer });
            },
        },
        {
            name: "piece_set_text",
            title: "Change a text layer",
            description:
                "Rewrite a text layer, or restyle it: colour, size, typeface, alignment. " +
                `Typefaces: ${FONTS.map(f => f.id).join(", ")}.`,
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "The text layer's id." },
                    text: { type: "string", description: "What it should say." },
                    color: { type: "string", description: "Any CSS colour." },
                    fontSize: { type: "number", description: "In canvas units." },
                    font: { type: "string", description: `One of: ${FONTS.map(f => f.id).join(", ")}.` },
                    align: { type: "string", enum: ["left", "center", "right"] },
                },
                required: ["id"],
            },
            async execute(args: any) {
                const found = requireLayer(args?.id);
                if ("error" in found) return found.error;
                if (found.layer.kind !== "text")
                    return fail(`${found.layer.id} is an image. Use piece_style or piece_move for that.`);

                const patch: any = {};
                if (str(args?.text)) patch.text = str(args.text);
                if (str(args?.color)) patch.color = str(args.color);
                if (num(args?.fontSize) && args.fontSize > 0) patch.fontSize = args.fontSize;
                if (args?.align === "left" || args?.align === "center" || args?.align === "right") patch.align = args.align;
                if (str(args?.font)) {
                    const font = findFont(str(args.font));
                    if (!font) return fail(`"${args.font}" is not a typeface. Use one of: ${FONTS.map(f => f.id).join(", ")}.`);
                    patch.fontFamily = font.stack;
                    patch.fontWeight = font.weight;
                }
                if (!Object.keys(patch).length)
                    return fail(`Nothing to change — pass text, color, fontSize, font or align.`);

                const layer = collage.update(found.layer.id, patch) as TextLayer | null;
                if (!layer) return fail(`That layer went away.`);
                return ok(`"${truncate(layer.text, 40)}" updated.`, { layer });
            },
        },
        {
            name: "show_page",
            title: "Set the output page",
            description:
                "Choose what the collage is being made for, which sets the export size and shape. " +
                `"${FREE_PAGE}" means no fixed size — the output is simply whatever is on the canvas. ` +
                `Otherwise: ${FRAME_PRESETS.map(p => p.id).join(", ")}. ` +
                "There is only ever one page; calling this again changes it rather than adding another.",
            inputSchema: {
                type: "object",
                properties: {
                    page: {
                        type: "string",
                        description: `"${FREE_PAGE}", or one of: ${FRAME_PRESETS.map(p => p.id).join(", ")}.`,
                    },
                    background: {
                        type: "string",
                        description:
                            `What sits behind the layers: "transparent" for none, or any CSS colour. ` +
                            `Defaults to transparent on a free canvas and white on paper.`,
                    },
                },
                required: ["page"],
            },
            async execute(args: { page?: string; background?: string }) {
                const page = str(args?.page);
                if (page !== FREE_PAGE && !FRAME_PRESETS.some(p => p.id === page))
                    return fail(`"${page}" is not a page size. Use "${FREE_PAGE}", or one of: ${FRAME_PRESETS.map(p => p.id).join(", ")}.`);

                const frame = studio.setPage(page, str(args?.background) || undefined);
                const size = outputSize(frame);
                const inside = collage.layersIn(frame.id);
                const behind = frame.background === "transparent"
                    ? "Nothing behind it — a PNG export will be transparent."
                    : `Background ${frame.background}.`;
                return ok(
                    (page === FREE_PAGE
                        ? `The page now follows the canvas — it exports whatever is on it (currently ${size.width}×${size.height}px).`
                        : `The page is "${frame.name}", exporting at ${size.width}×${size.height}px` +
                          `${frame.physical ? ` (${frame.physical.width}×${frame.physical.height}mm at 300 dpi)` : ""}. ` +
                          `${inside.length} layer(s) fall inside it — piece_arrange will fit them.`) +
                    ` ${behind}`,
                    { frame, page, background: frame.background, layersInside: inside.length });
            },
        },
        {
            name: "piece_arrange",
            title: "Arrange the collage",
            description:
                `Lay the images out inside a frame: ${LAYOUT_MODES.join(", ")}. ` +
                "Does the geometry for you — every item keeps its aspect ratio and stays inside the frame.",
            inputSchema: {
                type: "object",
                properties: {
                    layout: { type: "string", enum: [...LAYOUT_MODES], description: "How to lay them out." },
                    frameId: { type: "string", description: "Which frame. Omit when there is only one." },
                    ids: { type: "array", items: { type: "string" }, description: "Only these layers. Omit for everything in the frame." },
                    padding: { type: "number", description: "Fraction of the frame kept clear at the edges, 0–0.4." },
                    gap: { type: "number", description: "Space between items, 0–0.5." },
                    seed: { type: "number", description: "For 'scatter' — same seed, same result." },
                },
                required: ["layout"],
            },
            async execute(args: { layout?: string; frameId?: string; ids?: string[]; padding?: number; gap?: number; seed?: number }) {
                const mode = LAYOUT_MODES.find(m => m === args?.layout);
                if (!mode) return fail(`"${args?.layout}" is not a layout. Use one of: ${LAYOUT_MODES.join(", ")}.`);
                const resolved = resolveFrame(args?.frameId);
                if ("error" in resolved) return resolved.error;

                const count = studio.arrange(resolved.frame.id, mode as LayoutMode, {
                    ids: args?.ids,
                    padding: args?.padding,
                    gap: args?.gap,
                    seed: args?.seed,
                });
                if (!count)
                    return fail(`Nothing to arrange in "${resolved.frame.name}" — add images with piece_add first.`);
                return ok(
                    `Arranged ${count} layer(s) in "${resolved.frame.name}" as a ${mode}. Call show_look to see it.`,
                    { frameId: resolved.frame.id, layout: mode, count });
            },
        },
        {
            name: "piece_move",
            title: "Move, scale or rotate a layer",
            description:
                "Change one layer's position, size, rotation or stacking order, by id. " +
                "Use `scale` to make it bigger or smaller relative to what it is now (1.5 is half " +
                "again, 0.5 is half), or `width` for an exact canvas size. Rotation is in degrees.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    x: { type: "number" },
                    y: { type: "number" },
                    width: { type: "number", description: "Exact canvas width. Height follows the aspect ratio. Clamped to 0.5–1.5× the current width — big jumps in size are how worlds get monsters." },
                    scale: { type: "number", description: "Multiply the current size, clamped to 0.5–1.5 per call. Ignored if width is given." },
                    rotation: { type: "number", description: "Degrees, clockwise. 0 is straight." },
                    order: { type: "string", enum: ["front", "back"], description: "Move it in front of or behind everything." },
                },
                required: ["id"],
            },
            async execute(args: { id?: string; x?: number; y?: number; width?: number; scale?: number; rotation?: number; order?: string }) {
                const found = requireLayer(args?.id);
                if ("error" in found) return found.error;
                const patch: any = {};
                for (const key of ["x", "y", "width", "rotation"] as const) {
                    if (num((args as any)[key])) patch[key] = (args as any)[key];
                }
                /*
                 * Resizes are clamped to half-to-half-again per call, for the
                 * hand and the agent alike. Every giant in every play so far
                 * was one unchecked width; a size that needs to change more
                 * than that is almost always a mistake, and the rare tree
                 * that really must double can be asked for twice.
                 */
                if (num(patch.width)) {
                    patch.width = Math.min(found.layer.width * 1.5,
                        Math.max(found.layer.width * 0.5, patch.width));
                }
                if (patch.width === undefined && num(args?.scale)) {
                    const factor = Math.min(1.5, Math.max(0.5, args.scale));
                    // Scaling about the centre, so a layer grows in place rather
                    // than creeping down and to the right.
                    const layer = found.layer;
                    patch.width = layer.width * factor;
                    patch.x = (num(args?.x) ? args.x! : layer.x) - (patch.width - layer.width) / 2;
                    const height = layer.height * factor;
                    patch.y = (num(args?.y) ? args.y! : layer.y) - (height - layer.height) / 2;
                }
                if (!Object.keys(patch).length && !args?.order)
                    return fail(`Nothing to change — pass x, y, width, scale, rotation or order.`);
                // Announced before the change, so the canvas eases it. A layer
                // that jumps gives no clue what moved; one that slides says so,
                // which is the difference between watching an agent work and
                // finding the picture already different.
                studio.settle();
                let layer = Object.keys(patch).length ? collage.update(found.layer.id, patch) : found.layer;
                if (args?.order === "front") layer = collage.bringToFront(found.layer.id);
                if (args?.order === "back") layer = collage.sendToBack(found.layer.id);
                return ok(`Updated ${describeLayer(layer!)}.`, { layer });
            },
        },
        {
            name: "piece_trace",
            title: "Trace a picture into vector shapes",
            description:
                "Replace an image layer's pixels with traced vector shapes. Two reasons to: it stays crisp at " +
                "any size, in print and in the HTML export, and it looks different — flat colour with hard " +
                "edges rather than a photograph. Not reversible except by undo, so say what it will do first.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "The image layer to trace." },
                    detail: {
                        type: "string",
                        enum: ["flat", "balanced", "fine"],
                        description:
                            "How much to keep. 'flat' is a poster of a few big shapes, 'fine' follows the " +
                            "photograph closely and makes a much larger file. Default 'balanced'.",
                    },
                },
                required: ["id"],
            },
            async execute(args: { id?: string; detail?: string }) {
                const id = str(args?.id);
                if (!id) return fail(`Pass the id of the layer to trace.`);
                const detail = str(args?.detail) as "flat" | "balanced" | "fine" | "";
                const result = await studio.traceToSvg(id, detail ? { detail } : {});
                if (!result.ok) return fail(result.reason ?? `"${id}" could not be traced.`);
                return ok(
                    `Traced into ${result.paths} shapes (${Math.round((result.bytes ?? 0) / 1024)} kB of SVG). ` +
                    `It is vector now — sharp at any size, and it exports as shapes rather than pixels.`,
                    { id, paths: result.paths, bytes: result.bytes });
            },
        },
        {
            name: "piece_style",
            title: "Style a cut-out",
            description:
                "Style one image layer using its own transparency: a flat silhouette fill, a sticker outline, " +
                "a drop shadow, or opacity. Pass null to remove one.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    silhouette: { type: ["string", "null"], description: "CSS colour to fill the shape with, or null." },
                    outlineColor: { type: ["string", "null"], description: "Sticker border colour, or null to remove." },
                    outlineWidth: { type: "number", description: "Border width in canvas units. Default 8." },
                    shadow: { type: ["boolean", "null"], description: "Drop shadow following the cut-out's shape." },
                    opacity: { type: "number", description: "0–1." },
                },
                required: ["id"],
            },
            async execute(args: any) {
                const found = requireLayer(args?.id);
                if ("error" in found) return found.error;
                if (found.layer.kind !== "image") return fail(`${found.layer.id} is text — styling applies to image layers.`);

                const style: any = {};
                if ("silhouette" in args) style.silhouette = typeof args.silhouette === "string" ? args.silhouette : null;
                if ("outlineColor" in args) {
                    style.outline = typeof args.outlineColor === "string"
                        ? { color: args.outlineColor, width: num(args.outlineWidth) ? args.outlineWidth : 8 }
                        : null;
                } else if (num(args?.outlineWidth) && (found.layer as ImageLayer).style.outline) {
                    style.outline = { ...(found.layer as ImageLayer).style.outline!, width: args.outlineWidth };
                }
                if ("shadow" in args) {
                    style.shadow = args.shadow
                        ? { x: 0, y: 10, blur: 22, color: "#222C20", opacity: 0.32 }
                        : null;
                }
                if (num(args?.opacity)) style.opacity = Math.min(1, Math.max(0, args.opacity));
                if (!Object.keys(style).length)
                    return fail(`Nothing to change — pass silhouette, outlineColor, shadow or opacity.`);

                const layer = collage.update(found.layer.id, { style });
                return ok(`Styled ${describeLayer(layer!)}.`, { layer });
            },
        },
        {
            name: "piece_copy",
            title: "Clone a layer",
            description:
                "Duplicate an existing layer, sharing its picture — a crowd of the same sheep, three " +
                "copies of the hero spawning at different doors, a forest from one tree. Each clone " +
                "is its own layer with its own id: cast them at different spots, on different planes, " +
                "in different scenes, and script them separately. Cheap — no generation, no cutting.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "The layer to clone." },
                    count: { type: "number", description: "How many clones, 1–12. Default 1." },
                    at: {
                        type: "array",
                        description:
                            "Where each clone goes, as {x, y} canvas coordinates (top-left). Fewer " +
                            "entries than clones and the rest fan out beside the original.",
                        items: {
                            type: "object",
                            properties: { x: { type: "number" }, y: { type: "number" } },
                        },
                    },
                },
                required: ["id"],
            },
            async execute(args: { id?: string; count?: number; at?: Array<{ x?: number; y?: number }> }) {
                const found = requireLayer(args?.id);
                if ("error" in found) return found.error;
                const layer = found.layer;
                if (layer.kind !== "image") {
                    return fail(`"${layer.label}" is text — copy text by calling piece_text again.`);
                }
                const count = Math.max(1, Math.min(12, num(args?.count) ? args.count! : 1));
                const spots = Array.isArray(args?.at) ? args.at : [];
                const made = [];
                for (let i = 0; i < count; i++) {
                    const spot = spots[i];
                    const clone = collage.addImage({
                        // The same picture and the same stored bytes: clones
                        // share their source, so a dozen sheep cost one image.
                        src: layer.src,
                        storageKey: layer.storageKey,
                        natural: layer.natural,
                        crop: layer.crop,
                        label: layer.label,
                        width: layer.width,
                        rotation: layer.rotation,
                        style: layer.style,
                        x: spot && num(spot.x) ? spot.x : layer.x + (i + 1) * layer.width * 0.45,
                        y: spot && num(spot.y) ? spot.y : layer.y + (i + 1) * layer.height * 0.12,
                    });
                    made.push(clone);
                }
                studio.save();
                return ok(
                    `Cloned "${layer.label}" ${count === 1 ? "once" : `${count} times`}: ` +
                    `${made.map(clone => clone.id).join(", ")}. Cast and script each by its own id.`,
                    { layers: made.map(clone => ({ id: clone.id, x: clone.x, y: clone.y })) });
            },
        },
        {
            name: "piece_remove",
            title: "Remove a layer or frame",
            annotations: { destructiveHint: true },
            description: "Take one layer or frame off the canvas, by id.",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
            },
            async execute(args: { id?: string }) {
                const id = args?.id;
                if (typeof id !== "string" || !id) return fail(`Pass the "id" of a layer or frame.`);
                const frame = collage.getFrame(id);
                if (frame) {
                    collage.removeFrame(id);
                    return ok(`Removed the frame "${frame.name}". The layers it covered are still on the canvas.`, { frame });
                }
                const layer = collage.remove(id);
                if (!layer) return fail(`There is nothing with id "${id}". Call piece_list.`);
                return ok(`Removed "${layer.label}".`, { layer });
            },
        },
        {
            name: "piece_say",
            title: "Have a piece say something now",
            description:
                "Put a spoken speech bubble over a piece RIGHT NOW, outside any play — the workbench " +
                "aside. Use it to react to what the person is doing (they placed a dragon: have the " +
                "knight gulp), to think out loud through a character while you build, or to let a piece " +
                "answer a question in its own voice. Same bubble and voice the piece would have in a " +
                "play. Pass an array to have it deliver several lines in a row. Not while a show is " +
                "playing — the script owns the stage then; give them a say beat instead.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Which piece speaks." },
                    say: {
                        anyOf: [
                            { type: "string" },
                            { type: "array", items: { type: "string" } },
                        ],
                        description: "The line — or lines, delivered one bubble after another.",
                    },
                },
                required: ["id", "say"],
            },
            async execute(args: { id?: string; say?: string | string[] }) {
                const id = str(args?.id);
                const lines = (Array.isArray(args?.say) ? args.say : [args?.say])
                    .map(line => (typeof line === "string" ? line.trim() : ""))
                    .filter(Boolean);
                if (!id || !lines.length) return fail(`Pass "id" and "say" — who speaks, and the line.`);
                const layer = collage.get(id);
                if (!layer) return fail(`There is nothing with id "${id}". Call piece_list.`);
                if (studio.showing) {
                    return fail(
                        `A show is playing and its script owns the stage. Stop it, or write the line ` +
                        `into the scene as a say beat.`);
                }
                for (const line of lines) await studio.narrate(id, line);
                return ok(
                    `"${layer.label}" said ${lines.map(line => `“${line}”`).join(", then ")}. ` +
                    `The bubble has already come and gone.`);
            },
        },
        {
            name: "piece_select",
            title: "Pick out layers",
            description:
                "Select layers by id or by words matching their names, so they can be captured, styled or " +
                "moved together. The person sees the same selection highlighted on the canvas.",
            inputSchema: {
                type: "object",
                properties: {
                    ids: { type: "array", items: { type: "string" }, description: "Exact layer ids." },
                    query: { type: "string", description: "Words to match against names, e.g. 'cactus plant'." },
                    add: { type: "boolean", description: "Add to what is already selected rather than replacing it." },
                },
            },
            async execute(args: { ids?: string[]; query?: string; add?: boolean }) {
                let ids: string[] = Array.isArray(args?.ids) ? args.ids.filter(id => typeof id === "string") : [];
                const query = str(args?.query);
                if (query) {
                    const words = query.toLowerCase().split(/[^a-z0-9#]+/).filter(Boolean);
                    ids = [...ids, ...collage.list()
                        .filter(l => words.some(w => `${l.label} ${l.kind}`.toLowerCase().includes(w)))
                        .map(l => l.id)];
                }
                if (!ids.length && !query) {
                    // No arguments at all is a question, not a command.
                    const current = studio.selection.map(id => collage.get(id)).filter(Boolean) as Layer[];
                    return ok(
                        current.length
                            ? `Currently selected: ${current.map(l => `"${l.label}" [${l.id}]`).join(", ")}.`
                            : `Nothing is selected. Pass "ids" or a "query".`,
                        { selection: studio.selection });
                }

                studio.setSelection(args?.add ? [...studio.selection, ...ids] : ids);
                const chosen = studio.selection.map(id => collage.get(id)).filter(Boolean) as Layer[];
                if (!chosen.length) return fail(`Nothing matched. Call piece_list to see what is on the canvas.`);
                const region = studio.selectionBounds();
                return ok(
                    `Selected ${chosen.length}: ${chosen.map(l => `"${l.label}"`).join(", ")}. ` +
                    `Capture them with show_capture.`,
                    { selection: studio.selection, region });
            },
        },
        {
            name: "show_capture",
            title: "Capture part of the canvas as an image",
            annotations: { readOnlyHint: true },
            description:
                "Return an image of part of the canvas — the current selection by default, or given layers, " +
                "or an explicit rectangle. Layers give you those layers alone, on their own, with nothing " +
                "behind them; a rectangle gives you everything inside it. Use it to send a piece of the " +
                "collage to something that makes pictures; the result comes back with the exact region, so " +
                "a generated image can be dropped into the same place with piece_add.",
            inputSchema: {
                type: "object",
                properties: {
                    ids: { type: "array", items: { type: "string" }, description: "Capture exactly these layers." },
                    x: { type: "number", description: "Explicit region in canvas units — needs all four." },
                    y: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                    maxSize: { type: "number", description: "Longest edge in pixels, 64–2048. Default 768." },
                    background: { type: "string", description: `A CSS colour behind it, or "transparent". Defaults to the page's.` },
                },
            },
            async execute(args: any) {
                const region = num(args?.x) && num(args?.y) && num(args?.width) && num(args?.height)
                    ? { x: args.x, y: args.y, width: args.width, height: args.height }
                    : undefined;
                if (region && (region.width <= 0 || region.height <= 0))
                    return fail(`A region needs a positive width and height.`);
                try {
                    const shot = await studio.capture({
                        ids: Array.isArray(args?.ids) ? args.ids : undefined,
                        region,
                        maxSize: num(args?.maxSize) ? args.maxSize : undefined,
                        background: typeof args?.background === "string"
                            ? (args.background === "transparent" ? null : args.background)
                            : undefined,
                    });
                    const [, mimeType = "image/png", data = ""] = /^data:([^;]+);base64,(.*)$/.exec(shot.dataUrl) ?? [];
                    if (!data) return fail(`The capture could not be encoded.`);
                    const r = shot.region;
                    return {
                        content: [
                            { type: "image", data, mimeType },
                            {
                                type: "text",
                                text:
                                    `${shot.width}×${shot.height}px of the canvas, covering ` +
                                    `x ${Math.round(r.x)}, y ${Math.round(r.y)}, ${Math.round(r.width)}×${Math.round(r.height)} ` +
                                    `and ${shot.ids.length} layer(s). To put something back in its place, call ` +
                                    `piece_add with x ${Math.round(r.x)}, y ${Math.round(r.y)}, width ${Math.round(r.width)}.`,
                            },
                        ],
                        structuredContent: { region: r, ids: shot.ids, width: shot.width, height: shot.height },
                    };
                } catch (error) {
                    return fail(`Could not capture that: ${message(error)}`);
                }
            },
        },
        {
            name: "show_watch",
            title: "Watch the collage for changes",
            annotations: { readOnlyHint: true },
            description:
                "Wait until something changes on the canvas, then return what happened — images added, " +
                "layers moved, styles changed, exports — together with a picture of the result, so you can " +
                "see what the person did and act on it. Blocks until there is news or the wait runs out, so " +
                "call it in a loop to follow along while they work. " +
                "Pass the `nextCursor` from the previous call so nothing is missed between calls.",
            inputSchema: {
                type: "object",
                properties: {
                    cursor: { type: "number", description: "The nextCursor from your last call. Omit to start from now." },
                    timeoutSeconds: { type: "number", description: "How long to wait, 1–30. Default 25." },
                    preview: { type: "boolean", description: "Include a picture of the canvas. Default true." },
                },
            },
            async execute(args: { cursor?: number; timeoutSeconds?: number; preview?: boolean }, options?: { signal?: AbortSignal }) {
                const timeout = Math.min(30, Math.max(1, args?.timeoutSeconds ?? 25)) * 1000;
                // No cursor means "from now": replaying an hour of history to
                // an agent that just started watching helps nobody.
                const cursor = num(args?.cursor) ? args.cursor : latestCursor();
                const events = await studio.waitForEvents(cursor, timeout, options?.signal);
                const nextCursor = events.length ? events[events.length - 1].seq : cursor;

                if (!events.length) {
                    // Deliberately no picture here. An idle tick is the common
                    // case in a watch loop, and paying for an image every time
                    // nothing happened would make following along unaffordable.
                    return ok(
                        `Nothing happened in the last ${Math.round(timeout / 1000)}s. ` +
                        `Call again with cursor ${nextCursor} to keep watching.`,
                        { events: [], nextCursor, idle: true });
                }

                const text =
                    events.map(e => `${e.by === "agent" ? "[agent]" : "[person]"} ${e.summary}`).join("\n") +
                    `\n\nCall again with cursor ${nextCursor} to keep watching.`;

                // Seeing the result is the difference between reacting and
                // guessing — "a person moved the cactus" says nothing about
                // whether the picture now works.
                if (bool(args?.preview, true)) {
                    try {
                        const shot = await studio.capture({ maxSize: 512 });
                        const [, mimeType = "image/png", data = ""] = /^data:([^;]+);base64,(.*)$/.exec(shot.dataUrl) ?? [];
                        if (data) {
                            return {
                                content: [
                                    { type: "image", data, mimeType },
                                    { type: "text", text },
                                ],
                                structuredContent: { events, nextCursor, idle: false, region: shot.region },
                            };
                        }
                    } catch {
                        // A canvas that cannot be drawn must not swallow the news.
                    }
                }
                return ok(text, { events, nextCursor, idle: false });
            },
        },
        {
            name: "show_look",
            title: "Look at the collage",
            annotations: { readOnlyHint: true },
            description:
                "Render a frame and return it as an image, so you can see what you made and fix what is wrong. " +
                "Call this after arranging or styling.",
            inputSchema: {
                type: "object",
                properties: {
                    frameId: { type: "string", description: "Which frame. Omit when there is only one." },
                    maxSize: { type: "number", description: "Longest edge in pixels, 240–1024. Default 640." },
                },
            },
            async execute(args: { frameId?: string; maxSize?: number }) {
                const resolved = resolveFrame(args?.frameId);
                if ("error" in resolved) return resolved.error;
                const maxSize = Math.min(1024, Math.max(240, Math.round(args?.maxSize ?? 640)));
                try {
                    const dataUrl = await studio.preview(resolved.frame.id, maxSize);
                    const [, mimeType = "image/jpeg", data = ""] = /^data:([^;]+);base64,(.*)$/.exec(dataUrl) ?? [];
                    if (!data) return fail(`The preview could not be encoded.`);
                    const quality = checkFrame(collage.layersIn(resolved.frame.id), resolved.frame);
                    return {
                        content: [
                            { type: "image", data, mimeType },
                            {
                                type: "text",
                                text: `"${resolved.frame.name}" with ${collage.layersIn(resolved.frame.id).length} layer(s).` +
                                    (quality.summary ? `\n\n${quality.summary}` : ""),
                            },
                        ],
                        structuredContent: { frameId: resolved.frame.id, quality },
                    };
                } catch (error) {
                    return fail(`Could not render the preview: ${message(error)}`);
                }
            },
        },
        {
            name: "show_export",
            title: "Export the collage",
            description:
                "Export a frame. 'png' downloads an image, 'print' opens the print dialogue (Save as PDF for paper), " +
                "'html' returns a self-contained snippet to paste into a website, 'embed' returns a full page to host.",
            inputSchema: {
                type: "object",
                properties: {
                    format: { type: "string", enum: ["png", "print", "html", "embed"], description: "What to produce." },
                    frameId: { type: "string", description: "Which frame. Omit when there is only one." },
                    dpi: { type: "number", description: "For png/print on paper frames. 72–600, default 300." },
                    inlineImages: { type: "boolean", description: "For html/embed: embed the images in the code so it needs no hosting." },
                    interactive: { type: "boolean", description: "For html/embed: add a subtle hover lift to each cut-out." },
                },
                required: ["format"],
            },
            async execute(args: { format?: string; frameId?: string; dpi?: number; inlineImages?: boolean; interactive?: boolean }) {
                const format = (["png", "print", "html", "embed"] as const).find(f => f === args?.format);
                if (!format) return fail(`"${args?.format}" is not a format. Use png, print, html or embed.`);
                const resolved = resolveFrame(args?.frameId);
                if ("error" in resolved) return resolved.error;
                const frame = resolved.frame;
                const dpi = Math.min(600, Math.max(72, Math.round(args?.dpi ?? 300)));

                const quality = checkFrame(collage.layersIn(frame.id), frame, dpi);
                try {
                    const output = await studio.exportFrame(frame.id, format as ExportFormat, {
                        dpi,
                        inlineImages: args?.inlineImages,
                        interactive: bool(args?.interactive, false),
                    });
                    const warning = quality.summary ? `\n\nHeads up: ${quality.summary}` : "";
                    return ok(`${output.summary}${warning}${output.code ? `\n\n${output.code}` : ""}`, {
                        frameId: frame.id,
                        format,
                        ...output.structured,
                        quality,
                    });
                } catch (error) {
                    return fail(`Export failed: ${message(error)}`);
                }
            },
        },
    ];
}

function num(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * Arguments arrive as whatever the model decided to send. A number where a
 * string was declared is a routine mistake, and it must come back as a sentence
 * the agent can act on — never as a TypeError thrown at the browser.
 */
function str(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * A boolean from an agent, which is not always a boolean.
 *
 * Models send `"false"`, `"no"` and `0` for false often enough that a plain
 * `!== false` check reads every one of them as true — and the failure is
 * silent, because the tool does exactly what it was asked while the caller sees
 * the opposite happen. `rehearse: "false"` played a scene that was meant to be
 * written quietly. Same lesson as `str()`: trust the meaning, not the shape.
 */
function bool(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const word = value.trim().toLowerCase();
        if (["false", "no", "off", "0", ""].includes(word)) return false;
        if (["true", "yes", "on", "1"].includes(word)) return true;
    }
    return fallback;
}

function truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
