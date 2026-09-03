import { describe, it, expect, vi } from "vitest";
import { Collage, type AddFrameSpec, type Frame, type ImageLayer } from "../src/lib/collage/model.js";
import { arrange as computeLayout, type LayoutMode } from "../src/lib/collage/layout.js";
import {
    FREE_PAGE, fitAround,
    type ArrangeOptions, type CollageEvent, type CollageStudio, type ExportFormat, type ExportOptions,
} from "../src/lib/collage/studio.js";
import { createAllCollageTools, createCollageTools, type WebMcpToolDef } from "../src/lib/collage/tools.js";
import type { LoadedImage } from "../src/lib/collage/imaging.js";
import type { Plan } from "../src/lib/collage/perform.js";
import { SILENT } from "../src/lib/collage/audio.js";
import { onAgentAvatarSheet, setAgentAvatarSheet } from "../src/lib/collage/agentAvatar.js";

/**
 * The tools are the agent's whole surface onto the collage, so what is tested
 * here is mostly refusals: an agent that is told clearly why something did not
 * work can fix it, and one that gets a thrown exception cannot.
 *
 * A fake studio stands in for the browser — no canvas, no image decoding — so
 * these run in node alongside everything else.
 */

interface FakeOptions {
    /** Pretend every image is this big. */
    natural?: { width: number; height: number };
    coverage?: number;
    failLoading?: boolean;
    /** Pretend the background remover is unreachable. */
    cutUnavailable?: boolean;
}

function fakeStudio(options: FakeOptions = {}) {
    let n = 0;
    const collage = new Collage({ newId: prefix => `${prefix}-${++n}` });
    const images = new Map<string, LoadedImage>();
    const exports: Array<{ frameId: string; format: ExportFormat; options: ExportOptions }> = [];
    const previews: string[] = [];
    const cuts: string[] = [];
    const events: CollageEvent[] = [];
    const waiters = new Set<() => void>();
    const selectionWatchers = new Set<() => void>();
    const captures: Array<{ ids: string[]; region: unknown }> = [];
    let seq = 0;
    let pagePreset = FREE_PAGE;
    let selection: string[] = [];

    const studio: CollageStudio & { played: Plan[]; shows: string[][]; holds: boolean[] } = {
        collage,
        images,
        async addImage(url, opts = {}) {
            if (options.failLoading) throw new Error("the server said 404");
            const natural = options.natural ?? { width: 1200, height: 1200 };
            const coverage = options.coverage ?? 0.4;
            const layer = collage.addImage({
                src: url,
                label: opts.label,
                natural,
                x: opts.x,
                y: opts.y,
                width: opts.width,
            });
            const loaded = {
                src: url,
                image: null as any,
                width: natural.width,
                height: natural.height,
                tainted: false,
                crop: { x: 0, y: 0, width: 1, height: 1 },
                colors: ["#C82828"],
                coverage,
                mask: null,
            } satisfies LoadedImage;
            images.set(layer.id, loaded);
            if (opts.removeBackground !== false) cuts.push(layer.id);
            const background = options.cutUnavailable
                ? { ok: false, reason: "the remover could not be loaded." }
                : coverage < 0.95
                    ? { ok: false, skipped: true, reason: "already a cut-out." }
                    : { ok: true };
            return { layer, loaded, background };
        },
        async removeBackgroundFor(id) {
            cuts.push(id);
            if (options.cutUnavailable) return { ok: false, reason: "the remover could not be loaded." };
            return { ok: true };
        },
        async restore() { return 0; },
        // Publishing needs a real store; the fake only satisfies the shape.
        async loadPublished() { return 0; },
        storedDoc() { return { version: 1 as const, savedAt: 0, layers: [], frames: [] }; },
        async storedAssets() { return []; },
        // Slicing and tracing need decoded pixels; the tools only see results.
        async addPieces() { throw new Error("the fake studio does not slice"); },
        async traceToSvg() { return { ok: false, reason: "the fake studio does not trace" }; },
        // Files are bytes and a canvas; the tools never touch either, so the
        // fake only has to satisfy the shape.
        async saveFile() { return { blob: new Blob(), filename: "fake.collage.png" }; },
        async openFile() { return 0; },
        onSettle() { return () => { /* nothing to stop */ }; },
        settle() { /* the fake has no view to animate */ },
        // No canvas to act on, so a scene is accepted and finishes at once —
        // which is what lets the tools be tested without a clock.
        played: [] as Plan[],
        shows: [] as string[][],
        setPerformer() { /* the fake is its own performer */ },
        setStopper() { /* nothing is playing to stop */ },
        stopScene() { /* nor here */ },
        stopShow() { /* nor this */ },
        setSpeaker() { /* the fake is deaf */ },
        get speaker() { return SILENT; },
        showing: null as string | null,
        holding: false,
        onShowChanged() { return () => { /* the fake never changes */ }; },
        get billboard() { return null; },
        get busyStage() { return null; },
        // The fake has no canvas to draw crops on, so a sheet is reported as
        // arriving whole. The cutting itself is tested against gridCells.
        async addSheet() { return []; },
        // The fake plays a whole show instantly, so the tools can be tested for
        // what they say rather than for how long they take.
        holds: [] as boolean[],
        async playShow(ids?: string[], opts?: { hold?: boolean }) {
            const stages = ids?.length
                ? ids.map(id => collage.getStage(id)).filter(Boolean)
                : collage.listStages();
            (studio as any).shows.push(stages.map((s: any) => s.id));
            (studio as any).holds.push(opts?.hold === true);
            return { timings: stages.map((s: any, i: number) => (
                { stage: s.id, name: s.name, at: i * 1000, duration: 1000 })), duration: stages.length * 1000 };
        },
        get performing() { return false; },
        async playScene(plan: Plan) {
            (studio as any).played.push(plan);
            for (const beat of plan.beats) {
                if (!beat.travel) continue;
                const layer = collage.get(beat.id);
                if (layer) collage.update(beat.id, { x: layer.x + beat.travel.dx, y: layer.y + beat.travel.dy });
            }
        },
        save() { /* nothing to persist in a fake */ },
        async clear() { collage.restore([], []); },
        get page() { return collage.listFrames()[0] ?? null; },
        get pagePreset() { return pagePreset; },
        setPage(presetId: string) {
            pagePreset = presetId;
            for (const frame of collage.listFrames()) collage.removeFrame(frame.id);
            return presetId === FREE_PAGE
                ? collage.addFrame({ name: "Canvas", x: -400, y: -300, width: 800, height: 600 })
                : collage.addFrame({ presetId });
        },
        refitPage() { /* nothing to re-fit in a fake */ },
        setPageBackground(background: string) {
            const frame = collage.listFrames()[0];
            return frame ? collage.updateFrame(frame.id, { background }) : null;
        },
        get selection() { return selection; },
        setSelection(ids: string[]) {
            const live = new Set(collage.list().map(l => l.id));
            selection = [...new Set(ids)].filter(id => live.has(id));
            for (const w of [...selectionWatchers]) w();
        },
        onSelectionChanged(callback: () => void) {
            selectionWatchers.add(callback);
            return () => { selectionWatchers.delete(callback); };
        },
        selectionBounds(ids?: string[]) {
            const chosen = ids?.length ? ids : selection;
            return chosen.length ? collage.contentBounds(chosen) : null;
        },
        async capture(options = {}) {
            const ids = options.ids?.length ? options.ids : selection;
            const region = options.region
                ?? collage.contentBounds(ids.length ? ids : undefined)
                ?? { x: 0, y: 0, width: 100, height: 100 };
            captures.push({ ids: [...ids], region });
            return {
                dataUrl: "data:image/png;base64,ZmFrZQ==",
                region,
                ids: [...ids],
                width: Math.round(region.width),
                height: Math.round(region.height),
            };
        },
        record(kind, summary, by = "human", detail) {
            events.push({ seq: ++seq, at: 0, kind, summary, by, ...(detail ? { detail } : {}) });
            for (const wake of [...waiters]) wake();
        },
        eventsSince(since: number) { return events.filter(e => e.seq > since); },
        waitForEvents(since: number, timeoutMs: number, signal?: AbortSignal) {
            const ready = events.filter(e => e.seq > since);
            if (ready.length || signal?.aborted) return Promise.resolve(ready);
            return new Promise<CollageEvent[]>(resolve => {
                const finish = (result: CollageEvent[]) => {
                    waiters.delete(wake);
                    clearTimeout(timer);
                    resolve(result);
                };
                const wake = () => finish(events.filter(e => e.seq > since));
                const timer = setTimeout(() => finish([]), timeoutMs);
                waiters.add(wake);
            });
        },
        addFrame(spec: AddFrameSpec, fitContents: boolean) {
            const frame = collage.addFrame(spec);
            if (!fitContents) return frame;
            const contents = collage.contentBounds();
            if (!contents) return collage.updateFrame(frame.id, { x: -frame.width / 2, y: -frame.height / 2 })!;
            return collage.updateFrame(frame.id, fitAround(contents, frame.width / frame.height))!;
        },
        arrange(frameId: string, mode: LayoutMode, opts: ArrangeOptions = {}) {
            const frame = collage.getFrame(frameId)!;
            const inside = opts.ids?.length
                ? opts.ids.map(id => collage.get(id)!).filter(Boolean)
                : collage.layersIn(frameId);
            if (!inside.length) return 0;
            for (const p of computeLayout(inside, frame, mode, opts)) {
                collage.update(p.id, { x: p.x, y: p.y, width: p.width, height: p.height, rotation: p.rotation });
            }
            return inside.length;
        },
        async preview(frameId) {
            previews.push(frameId);
            return "data:image/jpeg;base64,ZmFrZQ==";
        },
        async exportFrame(frameId, format, opts = {}) {
            exports.push({ frameId, format, options: opts });
            return { summary: `exported ${format}`, code: format === "html" ? "<div></div>" : undefined };
        },
    };

    const tools = createAllCollageTools(studio);
    return {
        studio,
        collage,
        exports,
        previews,
        cuts,
        captures,
        tool: (name: string) => byName(tools, name),
        tools,
    };
}

function byName(tools: WebMcpToolDef[], name: string): WebMcpToolDef {
    const tool = tools.find(t => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}; have: ${tools.map(t => t.name).join(", ")}`);
    return tool;
}

const textOf = (result: { content: Array<any> }) =>
    result.content.filter(c => c.type === "text").map(c => c.text).join("\n");

describe("tool surface", () => {
    it("every tool is MCP-shaped", () => {
        const { tools } = fakeStudio();
        expect(tools.length).toBeGreaterThan(0);
        for (const tool of tools) {
            expect(tool.name).toMatch(/^(piece|stage|show|theater)_[a-z_]+$/);
            expect(tool.description.length).toBeGreaterThan(20);
            expect((tool.inputSchema as { type?: string }).type).toBe("object");
            expect(typeof tool.execute).toBe("function");
        }
    });

    it("never throws at the browser, whatever it is handed", async () => {
        const { tools } = fakeStudio();
        for (const tool of tools) {
            // show_watch blocks on purpose; an already-aborted signal is how
            // a caller cancels one, and it must come back rather than reject.
            const options = tool.name === "show_watch" ? { signal: AbortSignal.abort() } : undefined;
            for (const args of [undefined, {}, { id: "nope" }, { url: 12 }, { format: "gif" }, { layout: "spiral" }]) {
                await expect(tool.execute(args as any, options)).resolves.toBeTruthy();
            }
        }
    });
});

describe("adding images", () => {
    it("takes a data URL and reports what it got", async () => {
        const { tool } = fakeStudio({ natural: { width: 800, height: 600 }, coverage: 0.3 });
        const result = await tool("piece_add").execute({ url: "data:image/png;base64,AAA", label: "sneaker" });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain("800×600px");
    });

    it("removes the background by default, without being asked", async () => {
        const { tool, cuts } = fakeStudio({ coverage: 1 });
        const result = await tool("piece_add").execute({ url: "https://example.test/photo.jpg" });
        expect(cuts).toHaveLength(1);
        expect(textOf(result)).toContain("Background removed");
        expect((result.structuredContent as any).background.removed).toBe(true);
    });

    it("says so in the description, so an agent knows not to go elsewhere first", () => {
        const { tool } = fakeStudio();
        const description = tool("piece_add").description;
        expect(description).toMatch(/background is removed automatically/i);
        expect(description).toMatch(/do NOT\s+open FastCut/i);
    });

    it("leaves an image that is already a cut-out alone", async () => {
        const { tool } = fakeStudio({ coverage: 0.2 });
        const result = await tool("piece_add").execute({ url: "https://example.test/cut.png" });
        expect(textOf(result)).toContain("already a cut-out");
        expect((result.structuredContent as any).background.skipped).toBe(true);
    });

    it("skips the cut when told to, and does not pretend otherwise", async () => {
        const { tool, cuts } = fakeStudio({ coverage: 1 });
        const result = await tool("piece_add").execute({
            url: "https://example.test/photo.jpg",
            removeBackground: false,
        });
        expect(cuts).toHaveLength(0);
        expect(result.isError).toBeFalsy();
    });

    it("names the fallback when the remover is unavailable", async () => {
        const { tool } = fakeStudio({ coverage: 1, cutUnavailable: true });
        const result = await tool("piece_add").execute({ url: "https://example.test/photo.jpg" });
        // The layer is still added — a missing model must not lose the image.
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain("NOT removed");
        expect((result.structuredContent as any).background.removed).toBe(false);
    });

    it("can re-cut a layer that is already on the canvas", async () => {
        const { tool, cuts } = fakeStudio({ coverage: 1 });
        const added = await tool("piece_add").execute({
            url: "https://example.test/photo.jpg",
            removeBackground: false,
        });
        const id = (added.structuredContent as any).layer.id;
        const result = await tool("piece_recut").execute({ id });
        expect(result.isError).toBeFalsy();
        expect(cuts).toContain(id);
    });

    it("refuses to cut the background out of text", async () => {
        const { tool } = fakeStudio();
        const added = await tool("piece_text").execute({ text: "Summer" });
        const id = (added.structuredContent as any).layer.id;
        const result = await tool("piece_recut").execute({ id });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("no background");
    });

    it("refuses something that is not an image URL, and says what to pass", async () => {
        const { tool } = fakeStudio();
        const result = await tool("piece_add").execute({ url: "javascript:alert(1)" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("http(s)");
    });

    it("turns a loading failure into an explanation, not an exception", async () => {
        const { tool } = fakeStudio({ failLoading: true });
        const result = await tool("piece_add").execute({ url: "https://example.test/missing.png" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("404");
    });
});

describe("the output page", () => {
    it("never makes an agent create one first", async () => {
        // A page is a setting with a sensible default, not a thing to be built
        // before anything else can happen.
        const { tool, collage } = fakeStudio();
        await tool("piece_add").execute({ url: "https://example.test/a.png" });

        const arranged = await tool("piece_arrange").execute({ layout: "grid" });
        expect(arranged.isError).toBeFalsy();
        expect(collage.listFrames()).toHaveLength(1);

        const exported = await tool("show_export").execute({ format: "png" });
        expect(exported.isError).toBeFalsy();
    });

    it("replaces the page rather than stacking another one", async () => {
        const { tool, collage } = fakeStudio();
        await tool("show_page").execute({ page: "a4-portrait" });
        await tool("show_page").execute({ page: "og-1200x630" });
        // Two overlapping pages that could not be deleted was the bug.
        expect(collage.listFrames()).toHaveLength(1);
        expect(collage.listFrames()[0].presetId).toBe("og-1200x630");
    });

    it("rejects an unknown page by listing the real ones", async () => {
        const { tool } = fakeStudio();
        const result = await tool("show_page").execute({ page: "a2-poster" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("a4-portrait");
        expect(textOf(result)).toContain(FREE_PAGE);
    });

    it("reports the export size in the terms the person asked in", async () => {
        const { tool } = fakeStudio();
        const result = await tool("show_page").execute({ page: "a4-portrait" });
        expect(textOf(result)).toContain("2480×3508px");
        expect(textOf(result)).toContain("210×297mm");
    });

    it("accepts the free page, which has no fixed size", async () => {
        const { tool, studio } = fakeStudio();
        const result = await tool("show_page").execute({ page: FREE_PAGE });
        expect(result.isError).toBeFalsy();
        expect(studio.pagePreset).toBe(FREE_PAGE);
    });
});

describe("selecting and capturing", () => {
    async function withImages(n: number) {
        const kit = fakeStudio({ coverage: 0.2 });
        const ids: string[] = [];
        for (let i = 0; i < n; i++) {
            const added = await kit.tool("piece_add").execute({
                url: `https://example.test/${i}.png`,
                label: ["cactus", "lego man", "monstera", "sneaker"][i] ?? `thing ${i}`,
            });
            ids.push((added.structuredContent as any).layer.id);
        }
        return { ...kit, ids };
    }

    it("selects by name, which is how a person would say it", async () => {
        const { tool, studio } = await withImages(4);
        const result = await tool("piece_select").execute({ query: "cactus monstera" });
        expect(result.isError).toBeFalsy();
        expect(studio.selection).toHaveLength(2);
        expect(textOf(result)).toContain("cactus");
    });

    it("adds to a selection instead of replacing it when asked", async () => {
        const { tool, studio, ids } = await withImages(4);
        await tool("piece_select").execute({ ids: [ids[0]] });
        await tool("piece_select").execute({ ids: [ids[1]], add: true });
        expect(studio.selection).toEqual([ids[0], ids[1]]);
    });

    it("reports the current selection when asked nothing", async () => {
        const { tool, studio, ids } = await withImages(2);
        studio.setSelection([ids[0]]);
        const result = await tool("piece_select").execute({});
        expect(textOf(result)).toContain("Currently selected");
        expect(result.isError).toBeFalsy();
    });

    it("captures the selection as a real image", async () => {
        const { tool, studio, ids } = await withImages(3);
        studio.setSelection([ids[0], ids[1]]);
        const result = await tool("show_capture").execute({});

        const image = result.content.find(c => c.type === "image") as any;
        expect(image?.data).toBeTruthy();
        expect((result.structuredContent as any).ids).toEqual([ids[0], ids[1]]);
    });

    it("hands back the region, so a generated image can go back in its place", async () => {
        const { tool, studio, ids } = await withImages(2);
        studio.setSelection([ids[0]]);
        const result = await tool("show_capture").execute({});
        const region = (result.structuredContent as any).region;

        expect(region).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
        // The text has to say it too — that is what the agent acts on.
        expect(textOf(result)).toContain("piece_add");
        expect(textOf(result)).toContain(`x ${Math.round(region.x)}`);
    });

    it("takes an explicit rectangle over the selection", async () => {
        const { tool, captures, studio, ids } = await withImages(2);
        studio.setSelection([ids[0]]);
        await tool("show_capture").execute({ x: 10, y: 20, width: 300, height: 200 });
        expect(captures.at(-1)!.region).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    });

    it("refuses a rectangle with no area", async () => {
        const { tool } = await withImages(1);
        const result = await tool("show_capture").execute({ x: 0, y: 0, width: 0, height: 50 });
        expect(result.isError).toBe(true);
    });
});

describe("watching", () => {
    it("returns as soon as something happens", async () => {
        const { tool, studio } = fakeStudio();
        const watching = tool("show_watch").execute({ cursor: 0, timeoutSeconds: 5 });
        studio.record("layer-moved", "A person moved \"sneaker\".", "human");

        const result = await watching;
        expect(textOf(result)).toContain("moved");
        expect(textOf(result)).toContain("[person]");
        expect((result.structuredContent as any).events).toHaveLength(1);
    });

    it("hands back a cursor so nothing is missed between calls", async () => {
        const { tool, studio } = fakeStudio();
        studio.record("image-added", "one", "agent");
        studio.record("image-added", "two", "human");

        const first = await tool("show_watch").execute({ cursor: 0, timeoutSeconds: 1 });
        const cursor = (first.structuredContent as any).nextCursor;
        expect((first.structuredContent as any).events).toHaveLength(2);

        studio.record("image-added", "three", "human");
        const second = await tool("show_watch").execute({ cursor, timeoutSeconds: 1 });
        expect((second.structuredContent as any).events.map((e: any) => e.summary)).toEqual(["three"]);
    });

    it("comes back empty rather than hanging when nothing happens", async () => {
        const { tool } = fakeStudio();
        const result = await tool("show_watch").execute({ cursor: 0, timeoutSeconds: 1 });
        expect(result.isError).toBeFalsy();
        expect((result.structuredContent as any).idle).toBe(true);
        // It has to say how to carry on, or the loop stops here.
        expect(textOf(result)).toContain("Call again");
    });

    it("starts from now when given no cursor, instead of replaying history", async () => {
        const { tool, studio } = fakeStudio();
        studio.record("image-added", "something that happened before anyone was watching");
        const result = await tool("show_watch").execute({ timeoutSeconds: 1 });
        expect((result.structuredContent as any).events).toHaveLength(0);
    });
});

describe("arranging", () => {
    it("lays out what is inside the frame and points at the preview", async () => {
        const { tool, collage } = fakeStudio();
        for (let i = 0; i < 4; i++) await tool("piece_add").execute({ url: `https://example.test/${i}.png` });
        await tool("show_page").execute({ page:"square-1080" });

        const result = await tool("piece_arrange").execute({ layout: "packed" });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain("show_look");

        const frame = collage.listFrames()[0];
        for (const layer of collage.layersIn(frame.id)) {
            expect(layer.x).toBeGreaterThanOrEqual(frame.x - 1);
            expect(layer.x + layer.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
        }
    });

    it("says so plainly when the frame is empty", async () => {
        const { tool } = fakeStudio();
        await tool("show_page").execute({ page:"square-1080" });
        const result = await tool("piece_arrange").execute({ layout: "grid" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("piece_add");
    });
});

describe("styling", () => {
    it("applies a silhouette and can take it away again", async () => {
        const { tool, collage } = fakeStudio();
        const added = await tool("piece_add").execute({ url: "https://example.test/a.png" });
        const id = (added.structuredContent as any).layer.id;

        await tool("piece_style").execute({ id, silhouette: "#826AED" });
        expect((collage.get(id) as ImageLayer).style.silhouette).toBe("#826AED");

        await tool("piece_style").execute({ id, silhouette: null });
        expect((collage.get(id) as ImageLayer).style.silhouette).toBeNull();
    });

    it("refuses to style text, and says why", async () => {
        const { tool } = fakeStudio();
        const added = await tool("piece_text").execute({ text: "Summer" });
        const id = (added.structuredContent as any).layer.id;
        const result = await tool("piece_style").execute({ id, shadow: true });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("image layers");
    });
});

describe("looking at the result", () => {
    it("hands back an actual image, not a description of one", async () => {
        const { tool } = fakeStudio();
        await tool("show_page").execute({ page:"square-1080" });
        const result = await tool("show_look").execute({});
        const image = result.content.find(c => c.type === "image") as any;
        expect(image).toBeTruthy();
        expect(image.mimeType).toBe("image/jpeg");
        expect(image.data).toBe("ZmFrZQ==");
    });

    it("warns about resolution in the preview, before anything is exported", async () => {
        const { tool } = fakeStudio({ natural: { width: 120, height: 120 } });
        await tool("piece_add").execute({ url: "https://example.test/tiny.png" });
        await tool("show_page").execute({ page:"a4-portrait" });
        await tool("piece_arrange").execute({ layout: "grid" });

        const result = await tool("show_look").execute({});
        expect(textOf(result)).toMatch(/soft/i);
    });
});

describe("exporting", () => {
    it("passes the format through and repeats any resolution warning", async () => {
        const { tool, exports } = fakeStudio({ natural: { width: 100, height: 100 } });
        await tool("piece_add").execute({ url: "https://example.test/tiny.png" });
        await tool("show_page").execute({ page:"a4-portrait" });
        await tool("piece_arrange").execute({ layout: "grid" });

        const result = await tool("show_export").execute({ format: "html", interactive: true });
        expect(result.isError).toBeFalsy();
        expect(exports[0]).toMatchObject({ format: "html", options: { interactive: true } });
        expect(textOf(result)).toContain("Heads up");
    });

    it("clamps dpi rather than trusting the number it was given", async () => {
        const { tool, exports } = fakeStudio();
        await tool("show_page").execute({ page:"a4-portrait" });
        await tool("show_export").execute({ format: "png", dpi: 9000 });
        expect(exports[0].options.dpi).toBe(600);
    });

    it("rejects a format it does not have", async () => {
        const { tool } = fakeStudio();
        await tool("show_page").execute({ page:"a4-portrait" });
        const result = await tool("show_export").execute({ format: "svg" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("png, print, html or embed");
    });
});

describe("describing", () => {
    it("says the canvas is empty rather than returning nothing", async () => {
        const { tool } = fakeStudio();
        const result = await tool("piece_list").execute({});
        expect(textOf(result)).toContain("piece_add");
        expect(textOf(result)).toContain("show_page");
    });

    it("lists frames, layers and any resolution problem in one call", async () => {
        const { tool } = fakeStudio({ natural: { width: 100, height: 100 } });
        await tool("piece_add").execute({ url: "https://example.test/a.png", label: "sneaker" });
        await tool("show_page").execute({ page:"a4-portrait" });
        await tool("piece_arrange").execute({ layout: "grid" });

        const text = textOf(await tool("piece_list").execute({}));
        expect(text).toContain("A4 portrait");
        expect(text).toContain("sneaker");
        expect(text).toContain("Resolution:");
    });
});

describe("running several tools at once", () => {
    /**
     * A batch is the safe reading of "let the agent write code". Every step is
     * a tool that already exists with its arguments already validated, so
     * nothing becomes reachable that was not reachable one call at a time —
     * unlike handing a string to eval on the person's own origin.
     */
    async function withText() {
        const fake = fakeStudio();
        await fake.tool("piece_text").execute({ text: "Hello" });
        return { ...fake, id: fake.collage.list()[0].id, batch: fake.tool("theater_batch") };
    }

    it("runs the steps in order", async () => {
        const { batch, collage, id } = await withText();
        const result = await batch.execute({
            steps: [
                { tool: "piece_move", args: { id, x: 100, y: 50 } },
                { tool: "piece_move", args: { id, rotation: 15 } },
                { tool: "piece_set_text", args: { id, text: "Goodbye" } },
            ],
        });

        expect(result.isError).toBeFalsy();
        const layer = collage.get(id) as any;
        expect([layer.x, layer.y, layer.rotation, layer.text]).toEqual([100, 50, 15, "Goodbye"]);
    });

    it("undoes the whole batch as one step", async () => {
        const { batch, collage, id } = await withText();
        const before = collage.get(id)!;
        const origin = [before.x, before.y, before.rotation];

        await batch.execute({
            steps: [
                { tool: "piece_move", args: { id, x: 300 } },
                { tool: "piece_move", args: { id, y: 400 } },
                { tool: "piece_move", args: { id, rotation: 30 } },
            ],
        });
        collage.undo();

        const after = collage.get(id)!;
        expect([after.x, after.y, after.rotation]).toEqual(origin);
    });

    it("stops at the first failure by default, and says which", async () => {
        const { batch, collage, id } = await withText();
        const y = collage.get(id)!.y;
        const result = await batch.execute({
            steps: [
                { tool: "piece_move", args: { id, x: 100 } },
                { tool: "piece_move", args: { id: "img-nope", x: 5 } },
                { tool: "piece_move", args: { id, y: 999 } },
            ],
        });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toMatch(/FAILED/);
        // The third never ran, so the second's failure is not hidden by it.
        expect(collage.get(id)!.y).toBe(y);
        expect((result.structuredContent as any).ran).toBe(2);
    });

    it("carries on through failures when told to", async () => {
        const { batch, collage, id } = await withText();
        const result = await batch.execute({
            stopOnError: false,
            steps: [
                { tool: "piece_move", args: { id: "img-nope", x: 5 } },
                { tool: "piece_move", args: { id, y: 250 } },
            ],
        });

        expect((result.structuredContent as any).ran).toBe(2);
        expect(collage.get(id)!.y).toBe(250);
    });

    it("refuses an unknown tool before running anything", async () => {
        // Named up front, so a typo does not leave half a batch applied and the
        // rest unexplained.
        const { batch, collage, id } = await withText();
        const x = collage.get(id)!.x;
        const result = await batch.execute({
            steps: [
                { tool: "piece_move", args: { id, x: 700 } },
                { tool: "piece_teleport", args: {} },
            ],
        });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("piece_teleport");
        expect(collage.get(id)!.x).toBe(x);
    });

    it("refuses to nest itself", async () => {
        const { batch } = await withText();
        const result = await batch.execute({ steps: [{ tool: "theater_batch", args: { steps: [] } }] });
        expect(result.isError).toBe(true);
    });

    it("refuses an empty or oversized list rather than half-doing it", async () => {
        const { batch } = await withText();
        expect((await batch.execute({ steps: [] })).isError).toBe(true);

        const many = Array.from({ length: 41 }, () => ({ tool: "piece_list", args: {} }));
        const tooMany = await batch.execute({ steps: many });
        expect(tooMany.isError).toBe(true);
        expect(textOf(tooMany)).toMatch(/smaller batches/);
    });
});

describe("the surface an agent actually sees", () => {
    /**
     * Definitions are re-sent on every turn of a conversation, so a tool an
     * agent will never use is paid for in every message and read past every
     * time it chooses what to do. The registered set is the theatre; the rest
     * are features with interfaces of their own.
     */
    it("is the theatre and nothing else", () => {
        const { studio } = fakeStudio();
        // theater_troupe registers only when packs are installed, so it is
        // filtered here rather than pinned — this list must not change when
        // somebody adds art to static/troupe/.
        const names = createCollageTools(studio).map(t => t.name)
            .filter(name => name !== "theater_troupe").sort();
        expect(names).toEqual([
            "piece_add", "piece_copy", "piece_list", "piece_move", "piece_remove", "piece_sheet", "piece_text",
            "show_list", "show_load", "show_look", "show_play", "show_publish", "show_save",
            "show_sounds", "show_stop", "show_title", "show_watch",
            "stage_cast", "stage_create", "stage_describe", "stage_remove", "stage_script",
            "theater_art_prompt", "theater_avatar", "theater_batch", "theater_clear", "theater_start",
        ]);
    });

    it("leaves the authoring features out, not deleted", () => {
        // They are still reachable — a menu item, a button, a picker — because
        // a person tracing a sprite to vector is a real thing to want. It is
        // just not a thing an agent needs in order to stage a play.
        const { studio } = fakeStudio();
        const everything = createAllCollageTools(studio).map(t => t.name);
        for (const left of ["piece_arrange", "piece_trace", "show_export", "piece_style"]) {
            expect(everything).toContain(left);
        }
    });

    it("has nothing left called collage", () => {
        // The names are the first thing an agent reads, and this is a theatre.
        const { studio } = fakeStudio();
        for (const tool of createAllCollageTools(studio)) {
            expect(tool.name.startsWith("collage_")).toBe(false);
        }
    });
});

describe("the floating agent's selected pet", () => {
    it("accepts exact local bytes and refuses URLs the page would fetch remotely", async () => {
        const { studio } = fakeStudio();
        const avatar = createCollageTools(studio).find(t => t.name === "theater_avatar")!;
        const seen: Array<string | null> = [];
        const off = onAgentAvatarSheet(sheet => seen.push(sheet?.name ?? null));

        const remote = await avatar.execute({ url: "https://example.test/seedy.webp", name: "Seedy" });
        expect(remote.isError).toBe(true);
        expect(textOf(remote)).toContain("local pet sheet");

        const local = await avatar.execute({
            url: "data:image/webp;base64,UklGRg==",
            name: "Seedy",
        });
        expect(local.isError).toBeFalsy();
        expect(local.structuredContent).toMatchObject({ name: "Seedy", columns: 8, rows: 11 });
        expect(seen.at(-1)).toBe("Seedy");

        const fallback = await avatar.execute({ url: "default" });
        expect(fallback.isError).toBeFalsy();
        expect(fallback.structuredContent).toMatchObject({ name: "Codey", default: true });
        expect(seen.at(-1)).toBe("Codey");

        off();
        setAgentAvatarSheet(null);
    });
});

describe("the guide", () => {
    /**
     * The failure this exists to catch is not a crash. It is an agent reading
     * "2 scenes" and reporting "everything is still there" while both scenes
     * are empty and would play as still pictures of a backdrop. A status line
     * gets repeated back as a status line; a sentence saying what to do next
     * gets acted on.
     */
    const guideOf = async (studio: any) => {
        const start = createCollageTools(studio).find(t => t.name === "theater_start")!;
        const result = await start.execute({});
        return {
            text: result.content.map((c: any) => c.text).join("\n"),
            data: result.structuredContent as any,
        };
    };

    it("offers the actual selected Codex pet only when its local sheet is readable", async () => {
        const { studio } = fakeStudio();
        const { text } = await guideOf(studio);
        expect(text).toContain("ACTUAL selected Codex pet");
        expect(text).toContain("selected-avatar-id");
        expect(text).toContain("data:image/webp;base64");
        expect(text).toContain("Codey, the bundled default");
    });

    it("sends an empty canvas to the artwork, not to the scenes", async () => {
        const { studio } = fakeStudio();
        const { text } = await guideOf(studio);
        expect(text).toContain("NEXT: there is nothing to stage");
        expect(text).toContain("theater_art_prompt");
    });

    it("says a scene with nobody in it will play as a still picture", async () => {
        const { studio, collage } = fakeStudio();
        collage.addImage({ src: "a", natural: { width: 100, height: 100 } });
        collage.addStage({ name: "Der Waldweg" });
        const { text, data } = await guideOf(studio);
        expect(text).toContain("EMPTY");
        expect(text).toContain(`"Der Waldweg"`);
        expect(text).toContain("still picture");
        expect(text).toContain("stage_cast");
        expect(data.stages[0].cast).toBe(0);
    });

    it("asks for a script once a chapter has somebody in it", async () => {
        // Planes are retired: a chapter with a cast and no script is simply
        // waiting for its story, and that is the next thing to say.
        const { studio, collage } = fakeStudio();
        const layer = collage.addImage({ src: "a", natural: { width: 100, height: 100 } });
        const stage = collage.addStage({ name: "Der Waldweg" });
        collage.updateStage(stage.id, { cast: [{ id: layer.id }] });
        const { text } = await guideOf(studio);
        expect(text).toContain("nothing to do");
        expect(text).toContain("stage_script");
    });

    it("moves on to the script once the scene has depth in it", async () => {
        const { studio, collage } = fakeStudio();
        const tree = collage.addImage({ src: "t", natural: { width: 100, height: 100 } });
        const her = collage.addImage({ src: "a", natural: { width: 100, height: 100 } });
        const stage = collage.addStage({ name: "Der Waldweg" });
        collage.updateStage(stage.id, {
            cast: [{ id: tree.id, x: 0, y: 0, plane: "back" }, { id: her.id, x: 0, y: 0 }],
        });
        const { text } = await guideOf(studio);
        expect(text).toContain("nothing to do");
        expect(text).toContain("stage_script");
    });

    it("asks for a title last, when the play would otherwise run", async () => {
        const { studio, collage } = fakeStudio();
        const tree = collage.addImage({ src: "t", natural: { width: 100, height: 100 } });
        const layer = collage.addImage({ src: "a", natural: { width: 100, height: 100 } });
        const stage = collage.addStage({ name: "Der Waldweg" });
        collage.updateStage(stage.id, {
            cast: [{ id: tree.id, x: 0, y: 0, plane: "back" }, { id: layer.id, x: 0, y: 0 }],
            script: [{ id: layer.id, do: "nod" }],
        });
        const { text } = await guideOf(studio);
        expect(text).toContain("no name");
        expect(text).toContain("show_title");
    });
});

describe("reading a chapter back", () => {
    /*
     * The rule the old fraction system existed to enforce still holds, just
     * without the fractions: what stage_describe SAYS must be what stage_cast
     * and piece_move ACCEPT — the layer's own world units — or the agent
     * cannot check its own work.
     */
    const sceneWith = (spot: { x: number; y: number; width: number }) => {
        const { studio, collage } = fakeStudio();
        const tree = collage.addImage({
            src: "tree", natural: { width: 100, height: 200 }, ...spot,
        });
        const stage = collage.addStage({ name: "the wood" });
        collage.updateStage(stage.id, { cast: [{ id: tree.id, as: "the old tree" }] });
        return { studio, collage, ids: { tree: tree.id } };
    };

    const describe = async (studio: any) => {
        const tool = createCollageTools(studio).find(t => t.name === "stage_describe")!;
        const result = await tool.execute({});
        return result.content.map((c: any) => c.text).join("\n");
    };

    it("answers in world units — the same numbers piece_list speaks", async () => {
        const { studio } = sceneWith({ x: 450, y: 250, width: 100 });
        const text = await describe(studio);
        expect(text).toContain("at 450, 250");
        expect(text).toContain("100 wide");
        expect(text).toContain("as the old tree");
    });

    it("reports where the piece actually stands, not where anything placed it", async () => {
        // Casting never moved it; a later world edit is what the readback
        // must reflect.
        const { studio, collage, ids } = sceneWith({ x: 450, y: 250, width: 100 });
        collage.update(ids.tree, { x: 1200 });
        expect(await describe(studio)).toContain("at 1200, 250");
    });
});

describe("wearing another picture", () => {
    it("refuses a costume that does not exist", async () => {
        // The failure this catches is silent otherwise: the beat is accepted,
        // the swap finds no layer, and the character simply does not change —
        // which looks like the feature not working rather than a typo.
        const { studio, collage } = fakeStudio();
        const bird = collage.addImage({ src: "b", natural: { width: 100, height: 100 } });
        const stage = collage.addStage({ name: "the branch" });
        collage.updateStage(stage.id, { cast: [{ id: bird.id, x: 0, y: 0 }] });

        const script = createCollageTools(studio).find(t => t.name === "stage_script")!;
        const result = await script.execute({
            stage: stage.id,
            rehearse: false,
            beats: [{ id: bird.id, becomes: "bird-flying" }],
        });
        expect(result.isError).toBe(true);
        expect(result.content.map(part => ("text" in part ? part.text : "")).join(" "))
            .toContain("bird-flying");
    });

    it("takes one that does, without it having to be in the cast", async () => {
        // A costume is a picture this character turns into, not somebody else
        // in the scene — so it is not cast and must not have to be.
        const { studio, collage } = fakeStudio();
        const bird = collage.addImage({ src: "b", natural: { width: 100, height: 100 } });
        const flying = collage.addImage({ src: "f", natural: { width: 140, height: 90 } });
        const stage = collage.addStage({ name: "the branch" });
        collage.updateStage(stage.id, { cast: [{ id: bird.id, x: 0, y: 0 }] });

        const script = createCollageTools(studio).find(t => t.name === "stage_script")!;
        const result = await script.execute({
            stage: stage.id,
            rehearse: false,
            beats: [{ id: bird.id, do: "jump", becomes: flying.id }],
        });
        expect(result.isError).toBeUndefined();
        expect(collage.getStage(stage.id)!.script[0].becomes).toBe(flying.id);
    });
});

describe("a speech is several bubbles", () => {
    it("expands an array of lines into consecutive beats for one speaker", async () => {
        const { studio, collage } = fakeStudio();
        const bird = collage.addImage({ src: "b", natural: { width: 100, height: 100 } });
        const stage = collage.addStage({ name: "the branch" });
        collage.updateStage(stage.id, { cast: [{ id: bird.id, x: 0, y: 0 }] });

        const script = createCollageTools(studio).find(t => t.name === "stage_script")!;
        const result = await script.execute({
            stage: stage.id,
            rehearse: false,
            beats: [{ id: bird.id, do: "nod", say: ["One.", "Two.", "Three."] }],
        });
        expect(result.isError).toBeUndefined();

        const kept = collage.getStage(stage.id)!.script;
        // Three beats, one line each — the move rides the first, the rest are
        // the same speaker carrying on.
        expect(kept).toHaveLength(3);
        expect(kept.map(beat => beat.say)).toEqual(["One.", "Two.", "Three."]);
        expect(kept[0].do).toBe("nod");
        expect(kept[1].do).toBeUndefined();
        expect(kept.every(beat => beat.id === bird.id)).toBe(true);
    });
});

describe("arriving at a page that already has a play on it", () => {
    /**
     * The canvas restores itself from the browser, and the tools do not exist
     * until it has — so anything an agent is told about the page is the whole
     * truth by the time it can ask. What it did not know was that this is the
     * case, so a new conversation would start a second play beside the first.
     */
    const first = async (studio: any, tool: string) => {
        const found = createCollageTools(studio).find(t => t.name === tool)!;
        const result = await found.execute({});
        return result.content.map((part: any) => part.text ?? "").join("\n");
    };

    it("says the page remembers, in the guide", async () => {
        const { studio } = fakeStudio();
        const text = await first(studio, "theater_start");
        expect(text).toContain("IT REMEMBERS");
        expect(text).toContain("CHECK BEFORE YOU BUILD");
    });

    it("says it again on the way past, for an agent that never asked", async () => {
        // The nudge is appended to the FIRST reply of a page load, whatever was
        // called — the only thing a page can be sure an agent reads. That
        // once-ness is module state, so the module is reloaded here rather than
        // reaching for a reset that exists only for this test.
        vi.resetModules();
        const fresh: typeof import("../src/lib/collage/tools.js") =
            await import("../src/lib/collage/tools.js?fresh-page" as string);
        const { studio } = fakeStudio();
        const tool = fresh.createCollageTools(studio as never).find(t => t.name === "piece_list")!;
        const result = await tool.execute({});
        const text = result.content.map((part: any) => part.text ?? "").join(" ");

        expect(text).toContain("theater_start");
        expect(text).toMatch(/saved in the browser|comes back by itself/);
    });

    it("says it once and then stops, because a nag is not information", async () => {
        vi.resetModules();
        const fresh: typeof import("../src/lib/collage/tools.js") =
            await import("../src/lib/collage/tools.js?one-nudge" as string);
        const { studio } = fakeStudio();
        const tools = fresh.createCollageTools(studio as never);
        const list = tools.find(t => t.name === "piece_list")!;

        await list.execute({});
        const second = await list.execute({});
        expect(second.content.map((part: any) => part.text ?? "").join(" "))
            .not.toContain("theater_start");
    });
});

describe("taking a scene out", () => {
    /**
     * There was no way to. An agent asked to remove two empty scenes left over
     * from a reload had nothing between "leave them" and "clear the whole
     * canvas", and correctly refused to do the second — so the tidying could
     * not happen at all. The absence of a precise tool made the safe answer the
     * useless one.
     */
    const withScenes = () => {
        const { studio, collage } = fakeStudio();
        const layer = collage.addImage({ src: "a", natural: { width: 100, height: 100 } });
        const keep = collage.addStage({ name: "the wood" });
        collage.updateStage(keep.id, { cast: [{ id: layer.id, x: 0, y: 0 }] });
        const empty = collage.addStage({ name: "Scene 2" });
        return { studio, collage, layer, keep, empty };
    };

    const remove = async (studio: any, stages: unknown) => {
        const tool = createCollageTools(studio).find(t => t.name === "stage_remove")!;
        const result = await tool.execute({ stages });
        return { result, text: result.content.map((p: any) => p.text ?? "").join(" ") };
    };

    it("removes the scenes named and leaves the rest", async () => {
        const { studio, collage, keep, empty } = withScenes();
        const { text } = await remove(studio, [empty.id]);
        expect(collage.listStages().map(s => s.id)).toEqual([keep.id]);
        expect(text).toContain("the wood");
    });

    it("leaves every picture on the canvas", async () => {
        // A scene records where things stand; it does not own them. Removing
        // the scene an actor was in must not remove the actor.
        const { studio, collage, layer, keep } = withScenes();
        await remove(studio, [keep.id]);
        expect(collage.get(layer.id)).toBeTruthy();
    });

    it("removes nothing at all when one of the ids is wrong", async () => {
        // Half a deletion is worse than none: the caller cannot tell which half.
        const { studio, collage, empty } = withScenes();
        const { result } = await remove(studio, [empty.id, "stage-nope"]);
        expect(result.isError).toBe(true);
        expect(collage.listStages()).toHaveLength(2);
    });

    it("takes ids, not descriptions", async () => {
        const { studio } = withScenes();
        const { result } = await remove(studio, []);
        expect(result.isError).toBe(true);
    });

    it("can be undone, like anything else", async () => {
        const { studio, collage, empty } = withScenes();
        await remove(studio, [empty.id]);
        collage.undo();
        expect(collage.listStages()).toHaveLength(2);
    });
});

describe("playing scene by scene", () => {
    /**
     * The alternative to scheduling the whole plot upfront. A held show stays
     * lit with its music playing and its last frame standing, the agent
     * narrates and writes the next scene having SEEN this one, and continues —
     * which is also the only way a voice narration can actually stay in sync.
     */
    const ready = () => {
        const { studio, collage } = fakeStudio();
        const s1 = collage.addStage({ name: "Scene one" });
        const s2 = collage.addStage({ name: "Scene two" });
        const play = createCollageTools(studio).find(t => t.name === "show_play")!;
        return { studio, play, s1, s2 };
    };

    it("passes the hold through, and says what holding means", async () => {
        const { studio, play, s1 } = ready();
        const result = await play.execute({ stages: [s1.id], hold: true });
        const text = result.content.map((p: any) => p.text ?? "").join(" ");
        expect((studio as any).holds).toEqual([true]);
        expect(text).toContain("HOLD");
        expect(text).toContain("Scene one");
        expect(text).toMatch(/hold.*off.*last call|curtain/i);
    });

    it("lets a held show be continued rather than refusing it as a restart", async () => {
        const { studio, play, s2 } = ready();
        (studio as any).showing = "stage-1";
        (studio as any).holding = true;
        const result = await play.execute({ stages: [s2.id] });
        expect(result.isError).toBeUndefined();
    });

    it("still refuses while a show is actually running", async () => {
        const { studio, play, s2 } = ready();
        (studio as any).showing = "stage-1";
        (studio as any).holding = false;
        const result = await play.execute({ stages: [s2.id] });
        expect(result.isError).toBe(true);
    });
});

describe("the troupe drawer", () => {
    // These run against the real generated catalogue, so they exist only now
    // that a pack is installed — the tool unregisters when the drawer is empty.
    const drawer = (studio: any) =>
        createCollageTools(studio).find(t => t.name === "theater_troupe")!;

    it("lists the catalogue with descriptions to choose by", async () => {
        const { studio } = fakeStudio();
        const result = await drawer(studio).execute({});
        const text = result.content.map((p: any) => p.text ?? "").join("\n");
        expect(text).toContain("forest/tree-oak");
        expect(text).toContain("Scenery");
    });

    it("adds a piece without sending it through the remover", async () => {
        // The whole promise of precut: nothing to wait for, and no model pass
        // that could decide part of the picture is background.
        const { studio, collage } = fakeStudio();
        void collage;
        const result = await drawer(studio).execute({ add: ["forest/lantern"] });
        expect(result.isError).toBeUndefined();
        const text = result.content.map((p: any) => p.text ?? "").join(" ");
        expect(text).toContain("forest/lantern");
        // The fake records every layer that was sent to the cutter.
        expect((studio as any).cuts ?? []).not.toContain(
            studio.collage.listAll()[0]?.id);
    });

    it("adds nothing at all when one id is wrong", async () => {
        const { studio } = fakeStudio();
        const result = await drawer(studio).execute({ add: ["forest/lantern", "forest/dragon"] });
        expect(result.isError).toBe(true);
        expect(studio.collage.listAll()).toHaveLength(0);
    });
});

describe("casting touches the world only when asked", () => {
    /*
     * Chapters do not size or place anybody. The world's arrangement is the
     * blocking; x/y/width on a cast entry are a courtesy edit to the LAYER,
     * in world units, and leaving them out means "exactly as they stand".
     */
    const staged = () => {
        const { studio, collage } = fakeStudio();
        const stage = collage.addStage({ name: "the wood" });
        collage.setActiveStage(stage.id);
        const cast = createCollageTools(studio).find(t => t.name === "stage_cast")!;
        return { studio, collage, stage, cast };
    };

    it("leaves a piece exactly where and how big it stands", async () => {
        const { collage, stage, cast } = staged();
        const tree = collage.addImage({
            src: "tree", natural: { width: 100, height: 200 }, width: 100, x: 320, y: 45,
        });
        await cast.execute({ stage: stage.id, cast: [{ id: tree.id, as: "the tree" }] });

        const layer = collage.own(tree.id)!;
        expect(layer).toMatchObject({ x: 320, y: 45, width: 100 });
        // And the membership records no position at all.
        const member = collage.getStage(stage.id)!.cast[0];
        expect(member.x).toBeUndefined();
        expect(member.width).toBeUndefined();
    });

    it("moves and resizes the layer itself when coordinates are passed", async () => {
        const { collage, stage, cast } = staged();
        const tree = collage.addImage({
            src: "tree", natural: { width: 100, height: 200 }, width: 100, x: 0, y: 0,
        });
        await cast.execute({
            stage: stage.id,
            cast: [{ id: tree.id, x: 700, y: -80, width: 140 }],
        });

        // The edit landed in the world — visible to every chapter and to
        // piece_list — not in some scene-private ledger.
        collage.setActiveStage(null);
        expect(collage.own(tree.id)).toMatchObject({ x: 700, y: -80, width: 140 });
    });

    it("survives a re-cast without drifting", async () => {
        // Re-casting somebody to change their entrance must not move or
        // resize them: membership edits are membership edits.
        const { collage, stage, cast } = staged();
        const tree = collage.addImage({
            src: "tree", natural: { width: 100, height: 200 }, width: 100, x: 320, y: 45,
        });
        await cast.execute({ stage: stage.id, cast: [{ id: tree.id, x: 500, width: 120 }] });
        await cast.execute({ stage: stage.id, cast: [{ id: tree.id, entrance: "fade" }] });

        expect(collage.own(tree.id)).toMatchObject({ x: 500, width: 120 });
        const member = collage.getStage(stage.id)!.cast[0];
        expect(member.entrance).toBe("fade");
    });

    it("gives troupe actors a fitting voice unless MCP supplies one", async () => {
        const { collage, stage, cast } = staged();
        const giant = collage.addImage({
            src: "/troupe/fairy-tale/giant.webp", label: "fairy-tale/giant",
            natural: { width: 100, height: 200 }, width: 100, x: 0, y: 0,
        });
        await cast.execute({ stage: stage.id, cast: [{ id: giant.id }] });
        const automatic = collage.getStage(stage.id)!.cast[0].voice!;
        expect(Object.keys(automatic).sort()).toEqual(["age", "speed", "tone"]);
        expect(automatic.tone).toBeLessThan(0.5);

        const chosen = { speed: 1.8, age: 0.1, tone: 0.9 };
        await cast.execute({ stage: stage.id, cast: [{ id: giant.id, voice: chosen }] });
        expect(collage.getStage(stage.id)!.cast[0].voice).toEqual(chosen);
    });
});
