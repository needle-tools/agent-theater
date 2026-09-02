/**
 * The WebMCP tools for the collage page.
 *
 * The shape of this API is an argument about how an agent should work with a
 * visual medium. Three things follow from that:
 *
 *  - It can *look*. `collage_preview` hands back an actual picture, so the
 *    agent can see that two cut-outs overlap instead of inferring it from
 *    coordinates. Every mutating tool ends by suggesting a look.
 *  - It does not do arithmetic it cannot check. `collage_arrange` takes a word
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
 * collage_watch. Twenty seconds is under every browser-automation timeout seen
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
    "collage_describe", "collage_add_image", "collage_add_text",
    "collage_transform", "collage_remove", "collage_preview", "collage_watch",
]);

export function createCollageTools(studio: CollageStudio): WebMcpToolDef[] {
    // Scene tools alongside the canvas ones, and both reachable from a batch:
    // staging a scene is blocking a cast, which is many small placements and
    // exactly the thing worth doing in one call.
    const tools = [
        ...buildTools(studio).filter(tool => THEATRE.has(tool.name)),
        ...createStageTools(studio),
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
            const result = await tool.execute(args, options);
            const events = studio.eventsSince(since);
            seen = events.length ? events[events.length - 1].seq : since;
            // Its own doing is not news; the person's is.
            const theirs = events.filter(event => event.by === "human");
            if (!theirs.length) return result;
            const what = theirs.length === 1
                ? theirs[0].summary
                : `${theirs.length} things happened, the last: ${theirs[theirs.length - 1].summary}`;
            return {
                ...result,
                content: [
                    ...result.content,
                    { type: "text" as const, text: `Meanwhile, the person was working: ${what}` },
                ],
            };
        },
    };
}

/** The last event this agent has been told about. */
let seen = 0;

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
 *  - **One animation.** The canvas eases a change it is told about, so a batch
 *    settles as a single motion instead of twenty overlapping ones.
 */
function batchTool(studio: CollageStudio, tools: WebMcpToolDef[]): WebMcpToolDef {
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    return {
        name: "collage_batch",
        title: "Run several collage tools at once",
        description:
            "Run a list of collage tools in order, in one call. Use it whenever you know more than one step " +
            "in advance — moving six layers, styling a set, building a layout — because it is one round trip " +
            "instead of six, it undoes as a single step, and the canvas animates it as one motion. Each step " +
            "is { tool, args } exactly as you would have called it. Steps see what earlier steps did, so ids " +
            "from a collage_add_image step are usable later in the same batch.",
        inputSchema: {
            type: "object",
            properties: {
                steps: {
                    type: "array",
                    description: "The calls, in order.",
                    items: {
                        type: "object",
                        properties: {
                            tool: { type: "string", description: `A collage tool name, e.g. "collage_transform".` },
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
                    `smaller batches, looking with collage_preview between them.`);
            }

            // Named before anything runs, so a typo does not leave half a batch
            // applied and the other half unexplained.
            const unknown = steps.filter(step => !byName.has(str(step?.tool)) || str(step?.tool) === "collage_batch");
            if (unknown.length) {
                return fail(
                    `${unknown.map(s => `"${str(s?.tool) || "(missing)"}"`).join(", ")} — not a tool that can ` +
                    `run in a batch. Available: ${[...byName.keys()].join(", ")}.`);
            }

            const stopOnError = args?.stopOnError !== false;
            // One motion and one undo entry for the whole list.
            studio.settle();
            const outcomes: Array<{ tool: string; ok: boolean; text: string }> = [];
            await studio.collage.batch(async () => {
                for (const step of steps) {
                    const tool = byName.get(str(step.tool))!;
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
                    `${summary}\n${lines.join("\n")}\n\nLook at the result with collage_preview.`,
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
            if (!frame) return { error: fail(`There is no page with id "${id}". Call collage_describe to see it.`) };
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
        if (typeof id !== "string" || !id) return { error: fail(`Pass the "id" of a layer. Call collage_describe to list them.`) };
        const layer = collage.get(id);
        if (!layer) return { error: fail(`There is no layer with id "${id}". Call collage_describe for what is on the canvas.`) };
        return { layer };
    };

    return [
        {
            name: "collage_describe",
            title: "Describe the collage",
            annotations: { readOnlyHint: true },
            description:
                "Everything on the canvas, the output page, and any resolution problems. " +
                "Call before changing anything, and call collage_preview to actually see it.",
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
                          `Use collage_set_page for a fixed size like a4-portrait.`,
                    layers.length
                        ? `Layers (back to front):\n${layers.map(describeLayer).join("\n")}`
                        : `The canvas is empty. Add photos with collage_add_image — backgrounds come off automatically.`,
                ];
                if (studio.selection.length) {
                    const chosen = studio.selection.map(id => collage.get(id)).filter(Boolean) as Layer[];
                    parts.push(
                        `Selected: ${chosen.map(l => `"${l.label}" [${l.id}]`).join(", ")}. ` +
                        `collage_capture returns a picture of just these.`);
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
            name: "collage_add_image",
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
                        removeBackground: args?.removeBackground,
                        slice: args?.slice,
                        heal: args?.heal,
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
                        `with the same image: follow it with collage_watch, then collage_describe.`,
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
                                  `collage_preview and try again, or leave it as one layer.`
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
                            `Ids: ${pieces.map(p => p.id).join(", ")}. Look with collage_preview.`,
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
                        `Arrange it with collage_arrange, then look with collage_preview.`,
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
            name: "collage_remove_background",
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
                    return ok(`Cut the background out of "${found.layer.label}". Look at it with collage_preview.`, { layer });
                } catch (error) {
                    return fail(`Background removal failed: ${message(error)}`);
                }
            },
        },
        {
            name: "collage_add_text",
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
            name: "collage_set_text",
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
                    return fail(`${found.layer.id} is an image. Use collage_style or collage_transform for that.`);

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
            name: "collage_set_page",
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
                          `${inside.length} layer(s) fall inside it — collage_arrange will fit them.`) +
                    ` ${behind}`,
                    { frame, page, background: frame.background, layersInside: inside.length });
            },
        },
        {
            name: "collage_arrange",
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
                    return fail(`Nothing to arrange in "${resolved.frame.name}" — add images with collage_add_image first.`);
                return ok(
                    `Arranged ${count} layer(s) in "${resolved.frame.name}" as a ${mode}. Call collage_preview to see it.`,
                    { frameId: resolved.frame.id, layout: mode, count });
            },
        },
        {
            name: "collage_transform",
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
                    width: { type: "number", description: "Exact canvas width. Height follows the aspect ratio." },
                    scale: { type: "number", description: "Multiply the current size, 0.05–20. Ignored if width is given." },
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
                if (patch.width === undefined && num(args?.scale)) {
                    const factor = Math.min(20, Math.max(0.05, args.scale));
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
            name: "collage_trace",
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
            name: "collage_style",
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
            name: "collage_remove",
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
                if (!layer) return fail(`There is nothing with id "${id}". Call collage_describe.`);
                return ok(`Removed "${layer.label}".`, { layer });
            },
        },
        {
            name: "collage_select",
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
                if (!chosen.length) return fail(`Nothing matched. Call collage_describe to see what is on the canvas.`);
                const region = studio.selectionBounds();
                return ok(
                    `Selected ${chosen.length}: ${chosen.map(l => `"${l.label}"`).join(", ")}. ` +
                    `Capture them with collage_capture.`,
                    { selection: studio.selection, region });
            },
        },
        {
            name: "collage_capture",
            title: "Capture part of the canvas as an image",
            annotations: { readOnlyHint: true },
            description:
                "Return an image of part of the canvas — the current selection by default, or given layers, " +
                "or an explicit rectangle. Layers give you those layers alone, on their own, with nothing " +
                "behind them; a rectangle gives you everything inside it. Use it to send a piece of the " +
                "collage to something that makes pictures; the result comes back with the exact region, so " +
                "a generated image can be dropped into the same place with collage_add_image.",
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
                                    `collage_add_image with x ${Math.round(r.x)}, y ${Math.round(r.y)}, width ${Math.round(r.width)}.`,
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
            name: "collage_watch",
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
                if (args?.preview !== false) {
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
            name: "collage_preview",
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
            name: "collage_export",
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
                        interactive: args?.interactive,
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

function truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
