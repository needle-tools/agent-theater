import { describe, it, expect } from "vitest";
import { Collage, type Frame } from "../src/lib/collage/model.js";
import { exportHtml } from "../src/lib/collage/exportHtml.js";
import { fitAround } from "../src/lib/collage/studio.js";

/**
 * The exported HTML lands in someone else's website, so it is held to the
 * standards of code you would hand over: no dependencies, nothing that can
 * collide with the host page, real text, and no way for a tool argument to
 * write CSS or markup of its own.
 */

function scene() {
    let n = 0;
    const collage = new Collage({ newId: prefix => `${prefix}-${++n}` });
    const frame = collage.addFrame({ presetId: "og-1200x630", x: 0, y: 0, width: 1200, height: 630 });
    const image = collage.addImage({
        src: "https://cdn.example.test/sneaker.png",
        label: "red sneaker",
        natural: { width: 1000, height: 1000 },
        crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
        x: 300,
        y: 63,
        width: 600,
    });
    const text = collage.addText({ text: "Summer", x: 60, y: 60, fontSize: 120 });
    return { collage, frame, image, text };
}

describe("html export", () => {
    it("positions everything in percentages, so it scales with its container", () => {
        const { collage, frame } = scene();
        const html = exportHtml(collage.layersIn(frame.id), frame);

        expect(html).toContain("aspect-ratio: 1200 / 630;");
        expect(html).toContain("left: 25%;");
        expect(html).toContain("width: 50%;");
        // No absolute pixel geometry anywhere in the layout.
        expect(html).not.toMatch(/(left|top|width|height):\s*-?\d+(\.\d+)?px/);
    });

    it("sizes type in container units so a headline scales with the collage", () => {
        const { collage, frame } = scene();
        const html = exportHtml(collage.layersIn(frame.id), frame);
        expect(html).toContain("container-type: inline-size;");
        expect(html).toContain("cqw;");
    });

    it("keeps text as text, and images with their alt text", () => {
        const { collage, frame } = scene();
        const html = exportHtml(collage.layersIn(frame.id), frame);
        expect(html).toContain(">Summer</p>");
        expect(html).toContain('alt="red sneaker"');
    });

    it("shows only the cropped part of the source", () => {
        const { collage, frame } = scene();
        const html = exportHtml(collage.layersIn(frame.id), frame);
        // A 0.6-wide crop means the inner image is 1/0.6 = 166.67% wide,
        // shifted left by 0.2/0.6 of its own width.
        expect(html).toContain("width: 166.6667%;");
        expect(html).toContain("left: -33.3333%;");
    });

    it("namespaces every class it emits", () => {
        const { collage, frame } = scene();
        const html = exportHtml(collage.layersIn(frame.id), frame, { className: "my-collage" });
        const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/));
        expect(classes.length).toBeGreaterThan(0);
        for (const name of classes) expect(name.startsWith("my-collage")).toBe(true);
    });

    it("refuses to let a colour argument write CSS", () => {
        const { collage, frame, image } = scene();
        collage.update(image.id, { style: { silhouette: "red; } body { display: none; } .x {" } });
        const html = exportHtml(collage.layersIn(frame.id), frame);
        expect(html).not.toContain("display: none");
        expect(html).toContain("background: #000000;");
    });

    it("escapes text rather than letting it become markup", () => {
        const { collage, frame } = scene();
        collage.addText({ text: `<script>alert("x")</script>`, x: 0, y: 0 });
        const html = exportHtml(collage.layersIn(frame.id), frame);
        expect(html).not.toContain("<script>alert");
        expect(html).toContain("&lt;script&gt;");
    });

    it("substitutes resolved sources, for a snippet that carries its own images", () => {
        const { collage, frame, image } = scene();
        const html = exportHtml(collage.layersIn(frame.id), frame, {
            sources: { [image.id]: "data:image/png;base64,AAAA" },
        });
        expect(html).toContain('src="data:image/png;base64,AAAA"');
        expect(html).not.toContain("cdn.example.test");
    });

    it("emits a whole page in document mode and a fragment otherwise", () => {
        const { collage, frame } = scene();
        const fragment = exportHtml(collage.layersIn(frame.id), frame);
        const page = exportHtml(collage.layersIn(frame.id), frame, { document: true });
        expect(fragment).not.toContain("<!doctype html>");
        expect(page).toContain("<!doctype html>");
        expect(page).toContain("<title>Social card (og:image)</title>");
    });

    it("makes motion opt-in and lets the reader switch it off", () => {
        const { collage, frame } = scene();
        const still = exportHtml(collage.layersIn(frame.id), frame);
        const lively = exportHtml(collage.layersIn(frame.id), frame, { interactive: true });
        expect(still).not.toContain("transition");
        expect(lively).toContain("prefers-reduced-motion");
    });

    it("draws a silhouette as a masked element, not as a background behind the image", () => {
        const { collage, frame, image } = scene();
        collage.update(image.id, { style: { silhouette: "#222C20" } });
        const html = exportHtml(collage.layersIn(frame.id), frame);

        // A background on an <img> paints behind its pixels, so the photo would
        // cover the colour. The shape has to be an empty, masked element.
        expect(html).not.toContain("<img src=");
        expect(html).toContain('role="img" aria-label="red sneaker"');
        expect(html).toContain("mask-image: var(--src);");
        expect(html).toContain("background: #222C20;");
        // And the mask still needs the source, which now travels as a property.
        expect(html).toContain("--src: url(");
    });

    it("keeps the image element when there is no silhouette", () => {
        const { collage, frame } = scene();
        const html = exportHtml(collage.layersIn(frame.id), frame);
        expect(html).toContain("<img src=");
        expect(html).not.toContain("--src:");
    });

    it("draws the outline as a ring of shadows around the alpha edge", () => {
        const { collage, frame, image } = scene();
        collage.update(image.id, { style: { outline: { width: 12, color: "#FFFFFF" } } });
        const html = exportHtml(collage.layersIn(frame.id), frame);
        expect([...html.matchAll(/drop-shadow\(/g)]).toHaveLength(8);
    });
});

describe("fitting a frame to the contents", () => {
    it("covers the contents and keeps the frame's aspect ratio", () => {
        const contents = { x: 0, y: 0, width: 800, height: 200 };
        const fitted = fitAround(contents, 210 / 297);
        expect(fitted.width / fitted.height).toBeCloseTo(210 / 297, 5);
        expect(fitted.x).toBeLessThanOrEqual(contents.x);
        expect(fitted.x + fitted.width).toBeGreaterThanOrEqual(contents.x + contents.width);
        expect(fitted.y + fitted.height).toBeGreaterThanOrEqual(contents.y + contents.height);
    });

    it("stays centred on what it wraps", () => {
        const contents = { x: 100, y: 50, width: 400, height: 400 };
        const fitted = fitAround(contents, 1);
        expect(fitted.x + fitted.width / 2).toBeCloseTo(300, 5);
        expect(fitted.y + fitted.height / 2).toBeCloseTo(250, 5);
    });
});
