import { describe, it, expect } from "vitest";
import { Collage, type AddFrameSpec, type Frame, type ImageLayer } from "../src/lib/collage/model.js";
import { arrange as computeLayout, type LayoutMode } from "../src/lib/collage/layout.js";
import { fitAround, type ArrangeOptions, type CollageStudio, type ExportFormat, type ExportOptions } from "../src/lib/collage/studio.js";
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
            for (const args of [undefined, {}, { id: "nope" }, { url: 12 }, { format: "gif" }, { layout: "spiral" }]) {
                await expect(tool.execute(args as any)).resolves.toBeTruthy();
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

describe("frames", () => {
    it("tells the agent to add a frame before it can arrange or export", async () => {
        const { tool } = fakeStudio();
        await tool("collage_add_image").execute({ url: "https://example.test/a.png" });

        const arranged = await tool("collage_arrange").execute({ layout: "grid" });
        expect(arranged.isError).toBe(true);
        expect(textOf(arranged)).toContain("collage_add_frame");

        const exported = await tool("collage_export").execute({ format: "png" });
        expect(exported.isError).toBe(true);
        expect(textOf(exported)).toContain("collage_add_frame");
    });

    it("asks which frame once there is more than one", async () => {
        const { tool } = fakeStudio();
        await tool("collage_add_frame").execute({ preset: "a4-portrait" });
        await tool("collage_add_frame").execute({ preset: "og-1200x630" });
        const result = await tool("collage_arrange").execute({ layout: "grid" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("frameId");
    });

    it("rejects an unknown preset by listing the real ones", async () => {
        const { tool } = fakeStudio();
        const result = await tool("collage_add_frame").execute({ preset: "a2-poster" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("a4-portrait");
    });

    it("reports the export size in the terms the person asked in", async () => {
        const { tool } = fakeStudio();
        const result = await tool("collage_add_frame").execute({ preset: "a4-portrait" });
        expect(textOf(result)).toContain("2480×3508px");
        expect(textOf(result)).toContain("210×297mm");
    });

    it("wraps a custom paper size when no preset fits", async () => {
        const { tool, collage } = fakeStudio();
        const result = await tool("collage_add_frame").execute({ widthMm: 100, heightMm: 150, name: "postcard" });
        expect(result.isError).toBeFalsy();
        expect(collage.listFrames()[0].physical).toEqual({ width: 100, height: 150, unit: "mm" });
    });
});

describe("arranging", () => {
    it("lays out what is inside the frame and points at the preview", async () => {
        const { tool, collage } = fakeStudio();
        for (let i = 0; i < 4; i++) await tool("collage_add_image").execute({ url: `https://example.test/${i}.png` });
        await tool("collage_add_frame").execute({ preset: "square-1080" });

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
        await tool("collage_add_frame").execute({ preset: "square-1080" });
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
        await tool("collage_add_frame").execute({ preset: "square-1080" });
        const result = await tool("collage_preview").execute({});
        const image = result.content.find(c => c.type === "image") as any;
        expect(image).toBeTruthy();
        expect(image.mimeType).toBe("image/jpeg");
        expect(image.data).toBe("ZmFrZQ==");
    });

    it("warns about resolution in the preview, before anything is exported", async () => {
        const { tool } = fakeStudio({ natural: { width: 120, height: 120 } });
        await tool("collage_add_image").execute({ url: "https://example.test/tiny.png" });
        await tool("collage_add_frame").execute({ preset: "a4-portrait" });
        await tool("collage_arrange").execute({ layout: "grid" });

        const result = await tool("collage_preview").execute({});
        expect(textOf(result)).toMatch(/soft/i);
    });
});

describe("exporting", () => {
    it("passes the format through and repeats any resolution warning", async () => {
        const { tool, exports } = fakeStudio({ natural: { width: 100, height: 100 } });
        await tool("collage_add_image").execute({ url: "https://example.test/tiny.png" });
        await tool("collage_add_frame").execute({ preset: "a4-portrait" });
        await tool("collage_arrange").execute({ layout: "grid" });

        const result = await tool("collage_export").execute({ format: "html", interactive: true });
        expect(result.isError).toBeFalsy();
        expect(exports[0]).toMatchObject({ format: "html", options: { interactive: true } });
        expect(textOf(result)).toContain("Heads up");
    });

    it("clamps dpi rather than trusting the number it was given", async () => {
        const { tool, exports } = fakeStudio();
        await tool("collage_add_frame").execute({ preset: "a4-portrait" });
        await tool("collage_export").execute({ format: "png", dpi: 9000 });
        expect(exports[0].options.dpi).toBe(600);
    });

    it("rejects a format it does not have", async () => {
        const { tool } = fakeStudio();
        await tool("collage_add_frame").execute({ preset: "a4-portrait" });
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
        expect(textOf(result)).toContain("collage_add_frame");
    });

    it("lists frames, layers and any resolution problem in one call", async () => {
        const { tool } = fakeStudio({ natural: { width: 100, height: 100 } });
        await tool("collage_add_image").execute({ url: "https://example.test/a.png", label: "sneaker" });
        await tool("collage_add_frame").execute({ preset: "a4-portrait" });
        await tool("collage_arrange").execute({ layout: "grid" });

        const text = textOf(await tool("collage_describe").execute({}));
        expect(text).toContain("A4 portrait");
        expect(text).toContain("sneaker");
        expect(text).toContain("Resolution:");
    });
});
