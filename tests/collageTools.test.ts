import { describe, it, expect } from "vitest";
import { Collage, type AddFrameSpec, type Frame, type ImageLayer } from "../src/lib/collage/model.js";
import { arrange as computeLayout, type LayoutMode } from "../src/lib/collage/layout.js";
import {
    FREE_PAGE, fitAround,
    type ArrangeOptions, type CollageEvent, type CollageStudio, type ExportFormat, type ExportOptions,
} from "../src/lib/collage/studio.js";
import { createCollageTools, type WebMcpToolDef } from "../src/lib/collage/tools.js";
import type { LoadedImage } from "../src/lib/collage/imaging.js";

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

    const studio: CollageStudio = {
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

    const tools = createCollageTools(studio);
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
            expect(tool.name).toMatch(/^collage_[a-z_]+$/);
            expect(tool.description.length).toBeGreaterThan(20);
            expect((tool.inputSchema as { type?: string }).type).toBe("object");
            expect(typeof tool.execute).toBe("function");
        }
    });

    it("never throws at the browser, whatever it is handed", async () => {
        const { tools } = fakeStudio();
        for (const tool of tools) {
            // collage_watch blocks on purpose; an already-aborted signal is how
            // a caller cancels one, and it must come back rather than reject.
            const options = tool.name === "collage_watch" ? { signal: AbortSignal.abort() } : undefined;
            for (const args of [undefined, {}, { id: "nope" }, { url: 12 }, { format: "gif" }, { layout: "spiral" }]) {
                await expect(tool.execute(args as any, options)).resolves.toBeTruthy();
            }
        }
    });
});

describe("adding images", () => {
    it("takes a data URL and reports what it got", async () => {
        const { tool } = fakeStudio({ natural: { width: 800, height: 600 }, coverage: 0.3 });
        const result = await tool("collage_add_image").execute({ url: "data:image/png;base64,AAA", label: "sneaker" });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain("800×600px");
    });

    it("removes the background by default, without being asked", async () => {
        const { tool, cuts } = fakeStudio({ coverage: 1 });
        const result = await tool("collage_add_image").execute({ url: "https://example.test/photo.jpg" });
        expect(cuts).toHaveLength(1);
        expect(textOf(result)).toContain("Background removed");
        expect((result.structuredContent as any).background.removed).toBe(true);
    });

    it("says so in the description, so an agent knows not to go elsewhere first", () => {
        const { tool } = fakeStudio();
        const description = tool("collage_add_image").description;
        expect(description).toMatch(/background is removed automatically/i);
        expect(description).toMatch(/do NOT\s+open FastCut/i);
    });

    it("leaves an image that is already a cut-out alone", async () => {
        const { tool } = fakeStudio({ coverage: 0.2 });
        const result = await tool("collage_add_image").execute({ url: "https://example.test/cut.png" });
        expect(textOf(result)).toContain("already a cut-out");
        expect((result.structuredContent as any).background.skipped).toBe(true);
    });

    it("skips the cut when told to, and does not pretend otherwise", async () => {
        const { tool, cuts } = fakeStudio({ coverage: 1 });
        const result = await tool("collage_add_image").execute({
            url: "https://example.test/photo.jpg",
            removeBackground: false,
        });
        expect(cuts).toHaveLength(0);
        expect(result.isError).toBeFalsy();
    });

    it("names the fallback when the remover is unavailable", async () => {
        const { tool } = fakeStudio({ coverage: 1, cutUnavailable: true });
        const result = await tool("collage_add_image").execute({ url: "https://example.test/photo.jpg" });
        // The layer is still added — a missing model must not lose the image.
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain("NOT removed");
        expect((result.structuredContent as any).background.removed).toBe(false);
    });

    it("can re-cut a layer that is already on the canvas", async () => {
        const { tool, cuts } = fakeStudio({ coverage: 1 });
        const added = await tool("collage_add_image").execute({
            url: "https://example.test/photo.jpg",
            removeBackground: false,
        });
        const id = (added.structuredContent as any).layer.id;
        const result = await tool("collage_remove_background").execute({ id });
        expect(result.isError).toBeFalsy();
        expect(cuts).toContain(id);
    });

    it("refuses to cut the background out of text", async () => {
        const { tool } = fakeStudio();
        const added = await tool("collage_add_text").execute({ text: "Summer" });
        const id = (added.structuredContent as any).layer.id;
        const result = await tool("collage_remove_background").execute({ id });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("no background");
    });

    it("refuses something that is not an image URL, and says what to pass", async () => {
        const { tool } = fakeStudio();
        const result = await tool("collage_add_image").execute({ url: "javascript:alert(1)" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("http(s)");
    });

    it("turns a loading failure into an explanation, not an exception", async () => {
        const { tool } = fakeStudio({ failLoading: true });
        const result = await tool("collage_add_image").execute({ url: "https://example.test/missing.png" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("404");
    });
});

describe("the output page", () => {
    it("never makes an agent create one first", async () => {
        // A page is a setting with a sensible default, not a thing to be built
        // before anything else can happen.
        const { tool, collage } = fakeStudio();
        await tool("collage_add_image").execute({ url: "https://example.test/a.png" });

        const arranged = await tool("collage_arrange").execute({ layout: "grid" });
        expect(arranged.isError).toBeFalsy();
        expect(collage.listFrames()).toHaveLength(1);

        const exported = await tool("collage_export").execute({ format: "png" });
        expect(exported.isError).toBeFalsy();
    });

    it("replaces the page rather than stacking another one", async () => {
        const { tool, collage } = fakeStudio();
        await tool("collage_set_page").execute({ page: "a4-portrait" });
        await tool("collage_set_page").execute({ page: "og-1200x630" });
        // Two overlapping pages that could not be deleted was the bug.
        expect(collage.listFrames()).toHaveLength(1);
        expect(collage.listFrames()[0].presetId).toBe("og-1200x630");
    });

    it("rejects an unknown page by listing the real ones", async () => {
        const { tool } = fakeStudio();
        const result = await tool("collage_set_page").execute({ page: "a2-poster" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("a4-portrait");
        expect(textOf(result)).toContain(FREE_PAGE);
    });

    it("reports the export size in the terms the person asked in", async () => {
        const { tool } = fakeStudio();
        const result = await tool("collage_set_page").execute({ page: "a4-portrait" });
        expect(textOf(result)).toContain("2480×3508px");
        expect(textOf(result)).toContain("210×297mm");
    });

    it("accepts the free page, which has no fixed size", async () => {
        const { tool, studio } = fakeStudio();
        const result = await tool("collage_set_page").execute({ page: FREE_PAGE });
        expect(result.isError).toBeFalsy();
        expect(studio.pagePreset).toBe(FREE_PAGE);
    });
});

describe("selecting and capturing", () => {
    async function withImages(n: number) {
        const kit = fakeStudio({ coverage: 0.2 });
        const ids: string[] = [];
        for (let i = 0; i < n; i++) {
            const added = await kit.tool("collage_add_image").execute({
                url: `https://example.test/${i}.png`,
                label: ["cactus", "lego man", "monstera", "sneaker"][i] ?? `thing ${i}`,
            });
            ids.push((added.structuredContent as any).layer.id);
        }
        return { ...kit, ids };
    }

    it("selects by name, which is how a person would say it", async () => {
        const { tool, studio } = await withImages(4);
        const result = await tool("collage_select").execute({ query: "cactus monstera" });
        expect(result.isError).toBeFalsy();
        expect(studio.selection).toHaveLength(2);
        expect(textOf(result)).toContain("cactus");
    });

    it("adds to a selection instead of replacing it when asked", async () => {
        const { tool, studio, ids } = await withImages(4);
        await tool("collage_select").execute({ ids: [ids[0]] });
        await tool("collage_select").execute({ ids: [ids[1]], add: true });
        expect(studio.selection).toEqual([ids[0], ids[1]]);
    });

    it("reports the current selection when asked nothing", async () => {
        const { tool, studio, ids } = await withImages(2);
        studio.setSelection([ids[0]]);
        const result = await tool("collage_select").execute({});
        expect(textOf(result)).toContain("Currently selected");
        expect(result.isError).toBeFalsy();
    });

    it("captures the selection as a real image", async () => {
        const { tool, studio, ids } = await withImages(3);
        studio.setSelection([ids[0], ids[1]]);
        const result = await tool("collage_capture").execute({});

        const image = result.content.find(c => c.type === "image") as any;
        expect(image?.data).toBeTruthy();
        expect((result.structuredContent as any).ids).toEqual([ids[0], ids[1]]);
    });

    it("hands back the region, so a generated image can go back in its place", async () => {
        const { tool, studio, ids } = await withImages(2);
        studio.setSelection([ids[0]]);
        const result = await tool("collage_capture").execute({});
        const region = (result.structuredContent as any).region;

        expect(region).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
        // The text has to say it too — that is what the agent acts on.
        expect(textOf(result)).toContain("collage_add_image");
        expect(textOf(result)).toContain(`x ${Math.round(region.x)}`);
    });

    it("takes an explicit rectangle over the selection", async () => {
        const { tool, captures, studio, ids } = await withImages(2);
        studio.setSelection([ids[0]]);
        await tool("collage_capture").execute({ x: 10, y: 20, width: 300, height: 200 });
        expect(captures.at(-1)!.region).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    });

    it("refuses a rectangle with no area", async () => {
        const { tool } = await withImages(1);
        const result = await tool("collage_capture").execute({ x: 0, y: 0, width: 0, height: 50 });
        expect(result.isError).toBe(true);
    });
});

describe("watching", () => {
    it("returns as soon as something happens", async () => {
        const { tool, studio } = fakeStudio();
        const watching = tool("collage_watch").execute({ cursor: 0, timeoutSeconds: 5 });
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

        const first = await tool("collage_watch").execute({ cursor: 0, timeoutSeconds: 1 });
        const cursor = (first.structuredContent as any).nextCursor;
        expect((first.structuredContent as any).events).toHaveLength(2);

        studio.record("image-added", "three", "human");
        const second = await tool("collage_watch").execute({ cursor, timeoutSeconds: 1 });
        expect((second.structuredContent as any).events.map((e: any) => e.summary)).toEqual(["three"]);
    });

    it("comes back empty rather than hanging when nothing happens", async () => {
        const { tool } = fakeStudio();
        const result = await tool("collage_watch").execute({ cursor: 0, timeoutSeconds: 1 });
        expect(result.isError).toBeFalsy();
        expect((result.structuredContent as any).idle).toBe(true);
        // It has to say how to carry on, or the loop stops here.
        expect(textOf(result)).toContain("Call again");
    });

    it("starts from now when given no cursor, instead of replaying history", async () => {
        const { tool, studio } = fakeStudio();
        studio.record("image-added", "something that happened before anyone was watching");
        const result = await tool("collage_watch").execute({ timeoutSeconds: 1 });
        expect((result.structuredContent as any).events).toHaveLength(0);
    });
});

describe("arranging", () => {
    it("lays out what is inside the frame and points at the preview", async () => {
        const { tool, collage } = fakeStudio();
        for (let i = 0; i < 4; i++) await tool("collage_add_image").execute({ url: `https://example.test/${i}.png` });
        await tool("collage_set_page").execute({ page:"square-1080" });

        const result = await tool("collage_arrange").execute({ layout: "packed" });
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain("collage_preview");

        const frame = collage.listFrames()[0];
        for (const layer of collage.layersIn(frame.id)) {
            expect(layer.x).toBeGreaterThanOrEqual(frame.x - 1);
            expect(layer.x + layer.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
        }
    });

    it("says so plainly when the frame is empty", async () => {
        const { tool } = fakeStudio();
        await tool("collage_set_page").execute({ page:"square-1080" });
        const result = await tool("collage_arrange").execute({ layout: "grid" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("collage_add_image");
    });
});

describe("styling", () => {
    it("applies a silhouette and can take it away again", async () => {
        const { tool, collage } = fakeStudio();
        const added = await tool("collage_add_image").execute({ url: "https://example.test/a.png" });
        const id = (added.structuredContent as any).layer.id;

        await tool("collage_style").execute({ id, silhouette: "#826AED" });
        expect((collage.get(id) as ImageLayer).style.silhouette).toBe("#826AED");

        await tool("collage_style").execute({ id, silhouette: null });
        expect((collage.get(id) as ImageLayer).style.silhouette).toBeNull();
    });

    it("refuses to style text, and says why", async () => {
        const { tool } = fakeStudio();
        const added = await tool("collage_add_text").execute({ text: "Summer" });
        const id = (added.structuredContent as any).layer.id;
        const result = await tool("collage_style").execute({ id, shadow: true });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("image layers");
    });
});

describe("looking at the result", () => {
    it("hands back an actual image, not a description of one", async () => {
        const { tool } = fakeStudio();
        await tool("collage_set_page").execute({ page:"square-1080" });
        const result = await tool("collage_preview").execute({});
        const image = result.content.find(c => c.type === "image") as any;
        expect(image).toBeTruthy();
        expect(image.mimeType).toBe("image/jpeg");
        expect(image.data).toBe("ZmFrZQ==");
    });

    it("warns about resolution in the preview, before anything is exported", async () => {
        const { tool } = fakeStudio({ natural: { width: 120, height: 120 } });
        await tool("collage_add_image").execute({ url: "https://example.test/tiny.png" });
        await tool("collage_set_page").execute({ page:"a4-portrait" });
        await tool("collage_arrange").execute({ layout: "grid" });

        const result = await tool("collage_preview").execute({});
        expect(textOf(result)).toMatch(/soft/i);
    });
});

describe("exporting", () => {
    it("passes the format through and repeats any resolution warning", async () => {
        const { tool, exports } = fakeStudio({ natural: { width: 100, height: 100 } });
        await tool("collage_add_image").execute({ url: "https://example.test/tiny.png" });
        await tool("collage_set_page").execute({ page:"a4-portrait" });
        await tool("collage_arrange").execute({ layout: "grid" });

        const result = await tool("collage_export").execute({ format: "html", interactive: true });
        expect(result.isError).toBeFalsy();
        expect(exports[0]).toMatchObject({ format: "html", options: { interactive: true } });
        expect(textOf(result)).toContain("Heads up");
    });

    it("clamps dpi rather than trusting the number it was given", async () => {
        const { tool, exports } = fakeStudio();
        await tool("collage_set_page").execute({ page:"a4-portrait" });
        await tool("collage_export").execute({ format: "png", dpi: 9000 });
        expect(exports[0].options.dpi).toBe(600);
    });

    it("rejects a format it does not have", async () => {
        const { tool } = fakeStudio();
        await tool("collage_set_page").execute({ page:"a4-portrait" });
        const result = await tool("collage_export").execute({ format: "svg" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("png, print, html or embed");
    });
});

describe("describing", () => {
    it("says the canvas is empty rather than returning nothing", async () => {
        const { tool } = fakeStudio();
        const result = await tool("collage_describe").execute({});
        expect(textOf(result)).toContain("collage_add_image");
        expect(textOf(result)).toContain("collage_set_page");
    });

    it("lists frames, layers and any resolution problem in one call", async () => {
        const { tool } = fakeStudio({ natural: { width: 100, height: 100 } });
        await tool("collage_add_image").execute({ url: "https://example.test/a.png", label: "sneaker" });
        await tool("collage_set_page").execute({ page:"a4-portrait" });
        await tool("collage_arrange").execute({ layout: "grid" });

        const text = textOf(await tool("collage_describe").execute({}));
        expect(text).toContain("A4 portrait");
        expect(text).toContain("sneaker");
        expect(text).toContain("Resolution:");
    });
});
