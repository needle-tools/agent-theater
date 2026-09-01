import { describe, it, expect, beforeEach, vi } from "vitest";
import { Collage, type ImageLayer } from "../src/lib/collage/model.js";
import { loadDoc, saveDoc, clearDoc } from "../src/lib/collage/persistence.js";
import { alphaMask, maskHit } from "../src/lib/collage/imaging.js";

/**
 * The rule this file exists to enforce: a data: URL must never reach
 * localStorage. It is the obvious shortcut, it works for exactly one small
 * image, and it then fails with a quota error thrown from somewhere unrelated.
 */

class MemoryStorage implements Storage {
    private map = new Map<string, string>();
    /** Roughly the real limit, so an oversized write fails here too. */
    constructor(private readonly quota = 5_000_000) {}
    get length() { return this.map.size; }
    key(i: number) { return [...this.map.keys()][i] ?? null; }
    getItem(key: string) { return this.map.get(key) ?? null; }
    setItem(key: string, value: string) {
        const total = [...this.map.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
        if (total + key.length + value.length > this.quota) {
            const error = new Error("QuotaExceededError");
            error.name = "QuotaExceededError";
            throw error;
        }
        this.map.set(key, value);
    }
    removeItem(key: string) { this.map.delete(key); }
    clear() { this.map.clear(); }
}

beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
});

function collageWithImages(count: number, src: string, storageKey: (i: number) => string | null) {
    let n = 0;
    const collage = new Collage({ newId: prefix => `${prefix}-${++n}` });
    collage.addFrame({ presetId: "a4-portrait" });
    for (let i = 0; i < count; i++) {
        collage.addImage({
            src,
            storageKey: storageKey(i),
            label: `image ${i}`,
            natural: { width: 800, height: 800 },
        });
    }
    return collage;
}

describe("saving the document", () => {
    it("strips blob URLs, because they are meaningless in the next session", () => {
        const collage = collageWithImages(2, "blob:http://localhost/abc-123", i => `key-${i}`);
        saveDoc(collage.list(), collage.listFrames());

        const doc = loadDoc()!;
        expect(doc.layers).toHaveLength(2);
        for (const layer of doc.layers as ImageLayer[]) {
            expect(layer.src).toBe("");
            // The key is what actually survives — it is how the bytes are found.
            expect(layer.storageKey).toMatch(/^key-/);
        }
    });

    it("keeps a plain URL, which reloads from its own server", () => {
        const collage = collageWithImages(1, "https://cdn.example.test/a.png", () => null);
        saveDoc(collage.list(), collage.listFrames());
        expect((loadDoc()!.layers[0] as ImageLayer).src).toBe("https://cdn.example.test/a.png");
    });

    it("stays small with many images, because the bytes are not in it", () => {
        // A real data URL for a photo is megabytes; ten would blow the quota.
        const dataUrl = `data:image/png;base64,${"A".repeat(600_000)}`;
        const collage = collageWithImages(10, dataUrl, i => `key-${i}`);
        expect(saveDoc(collage.list(), collage.listFrames())).toBe(true);
        expect(localStorage.getItem("needle-collage/doc/v1")!.length).toBeLessThan(20_000);
    });

    it("survives a full quota instead of taking the page down", () => {
        // storageKey null means the src is kept — which is exactly the case
        // that can overflow. It must return false, not throw.
        const collage = collageWithImages(20, `data:image/png;base64,${"A".repeat(600_000)}`, () => null);
        expect(() => saveDoc(collage.list(), collage.listFrames())).not.toThrow();
        expect(saveDoc(collage.list(), collage.listFrames())).toBe(false);
    });

    it("round-trips frames and the view", () => {
        const collage = collageWithImages(1, "blob:x", () => "key-0");
        saveDoc(collage.list(), collage.listFrames(), { x: 12, y: -40, zoom: 0.8 });
        const doc = loadDoc()!;
        expect(doc.frames).toHaveLength(1);
        expect(doc.frames[0].presetId).toBe("a4-portrait");
        expect(doc.view).toEqual({ x: 12, y: -40, zoom: 0.8 });
    });

    it("ignores a document it cannot understand", () => {
        localStorage.setItem("needle-collage/doc/v1", "{not json");
        expect(loadDoc()).toBeNull();
        localStorage.setItem("needle-collage/doc/v1", JSON.stringify({ version: 99, layers: [], frames: [] }));
        expect(loadDoc()).toBeNull();
    });

    it("clears cleanly", () => {
        const collage = collageWithImages(1, "blob:x", () => "key-0");
        saveDoc(collage.list(), collage.listFrames());
        clearDoc();
        expect(loadDoc()).toBeNull();
    });
});

describe("restoring", () => {
    it("puts the layers and frames back, keeping their ids", () => {
        const original = collageWithImages(3, "blob:x", i => `key-${i}`);
        const ids = original.list().map(l => l.id);
        saveDoc(original.list(), original.listFrames());

        const doc = loadDoc()!;
        const restored = new Collage();
        restored.restore(doc.layers, doc.frames);

        expect(restored.list().map(l => l.id)).toEqual(ids);
        expect(restored.listFrames()).toHaveLength(1);
    });

    it("keeps new layers in front of restored ones", () => {
        const original = collageWithImages(3, "blob:x", i => `key-${i}`);
        saveDoc(original.list(), original.listFrames());
        const doc = loadDoc()!;

        const restored = new Collage();
        restored.restore(doc.layers, doc.frames);
        const added = restored.addImage({ src: "x", natural: { width: 10, height: 10 } });

        // Without carrying the high-water mark across a restore, the new layer
        // would land at z=1 and hide behind everything already there.
        expect(added.z).toBeGreaterThan(Math.max(...doc.layers.map(l => l.z)));
        expect(restored.list().at(-1)!.id).toBe(added.id);
    });
});

describe("alpha hit testing", () => {
    /** A bitmap with one opaque rectangle in it. */
    function bitmap(size: number, box: { x: number; y: number; w: number; h: number }) {
        const data = new Uint8ClampedArray(size * size * 4);
        for (let y = box.y; y < box.y + box.h; y++) {
            for (let x = box.x; x < box.x + box.w; x++) data[(y * size + x) * 4 + 3] = 255;
        }
        return { data, width: size, height: size };
    }

    const full = { x: 0, y: 0, width: 1, height: 1 };

    it("hits the picture and misses the empty corner", () => {
        // Opaque only in the middle: the corners of the box are transparent.
        const mask = alphaMask(bitmap(100, { x: 30, y: 30, w: 40, h: 40 }), 64);
        expect(maskHit(mask, full, 0.5, 0.5)).toBe(true);
        expect(maskHit(mask, full, 0.02, 0.02)).toBe(false);
        expect(maskHit(mask, full, 0.98, 0.98)).toBe(false);
    });

    it("maps through the crop, so a cropped layer still tests the right pixels", () => {
        const mask = alphaMask(bitmap(100, { x: 50, y: 0, w: 50, h: 100 }), 64);
        // The layer shows only the right-hand half, which is entirely opaque.
        const rightHalf = { x: 0.5, y: 0, width: 0.5, height: 1 };
        expect(maskHit(mask, rightHalf, 0.1, 0.5)).toBe(true);
        // The left-hand half is entirely empty.
        const leftHalf = { x: 0, y: 0, width: 0.5, height: 1 };
        expect(maskHit(mask, leftHalf, 0.1, 0.5)).toBe(false);
    });

    it("falls back to the box when the pixels could not be read", () => {
        // A cross-origin image has no mask; it must stay pickable rather than
        // becoming a layer nobody can select.
        expect(maskHit(null, full, 0.01, 0.99)).toBe(true);
    });

    it("rejects a point outside the layer entirely", () => {
        const mask = alphaMask(bitmap(50, { x: 0, y: 0, w: 50, h: 50 }), 32);
        expect(maskHit(mask, full, 1.4, 0.5)).toBe(false);
        expect(maskHit(mask, full, -0.1, 0.5)).toBe(false);
    });
});
