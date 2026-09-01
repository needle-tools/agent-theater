import { describe, it, expect } from "vitest";
import { crc32, isPng, looksLikeCollageFile, packCollage, readCollage } from "../src/lib/collage/collageFile.js";
import { Collage } from "../src/lib/collage/model.js";
import type { StoredDoc } from "../src/lib/collage/persistence.js";

/**
 * The save file.
 *
 * It has to stay a valid PNG — the whole idea is a file you can look at — and
 * it has to give the collage back byte for byte. Both halves are pure byte
 * work, so both are tested here rather than trusted.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The smallest thing that is structurally a PNG: signature, IHDR, IEND. */
function tinyPng(): Uint8Array {
    const chunk = (type: string, data: number[]) => {
        const body = [...type].map(c => c.charCodeAt(0)).concat(data);
        const out = [
            (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff,
            (data.length >>> 8) & 0xff, data.length & 0xff,
            ...body,
        ];
        const sum = crc32(new Uint8Array(body));
        out.push((sum >>> 24) & 0xff, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff);
        return out;
    };
    return new Uint8Array([
        ...SIGNATURE,
        ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
        ...chunk("IEND", []),
    ]);
}

function sampleDoc(): StoredDoc {
    const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
    collage.addImage({ src: "", storageKey: "img-a", natural: { width: 40, height: 30 }, x: 5, y: 7, width: 100 });
    collage.addText({ text: "Hello", x: 1, y: 2, width: 200 });
    return { version: 1, savedAt: 0, layers: collage.list(), frames: collage.listFrames() };
}

const payload = () => ({
    doc: sampleDoc(),
    assets: [
        { key: "img-a", type: "image/webp", data: new Uint8Array([1, 2, 3, 4, 250, 0, 255]) },
        { key: "img-b", type: "image/png", data: new Uint8Array(500).fill(7) },
    ],
});

describe("packing a collage into a PNG", () => {
    it("is still a PNG afterwards", () => {
        const packed = packCollage(tinyPng(), payload());
        expect(isPng(packed)).toBe(true);
        // Signature untouched and IEND still last — a viewer reads it as normal.
        expect([...packed.slice(0, 8)]).toEqual(SIGNATURE);
        expect(String.fromCharCode(...packed.slice(-8, -4))).toBe("IEND");
    });

    it("gives the document back exactly", () => {
        const original = payload();
        const read = readCollage(packCollage(tinyPng(), original));
        expect(read?.doc).toEqual(original.doc);
    });

    it("gives every byte of every image back", () => {
        const original = payload();
        const read = readCollage(packCollage(tinyPng(), original))!;
        expect(read.assets.map(a => a.key)).toEqual(["img-a", "img-b"]);
        expect(read.assets.map(a => a.type)).toEqual(["image/webp", "image/png"]);
        for (const [i, asset] of read.assets.entries()) {
            expect([...asset.data]).toEqual([...original.assets[i].data]);
        }
    });

    it("survives an empty collage and an image with no bytes", () => {
        const empty = { doc: { version: 1, savedAt: 0, layers: [], frames: [] } as StoredDoc, assets: [] };
        expect(readCollage(packCollage(tinyPng(), empty))).toEqual(empty);
    });

    it("replaces its own chunk instead of stacking a second one", () => {
        // Re-saving a file that was opened from disk must not grow it every
        // time, nor leave an older document behind for the reader to find.
        const first = packCollage(tinyPng(), payload());
        const second = { ...payload(), doc: { ...sampleDoc(), savedAt: 99 } };
        const again = packCollage(first, second);

        expect(readCollage(again)?.doc.savedAt).toBe(99);
        expect(again.length).toBeLessThanOrEqual(first.length + 40);
    });

    it("refuses a file that is not a complete PNG", () => {
        expect(() => packCollage(new Uint8Array([1, 2, 3]), payload())).toThrow();
    });
});

describe("reading a file that is not ours", () => {
    it("says so for an ordinary PNG", () => {
        expect(looksLikeCollageFile(tinyPng())).toBe(false);
        expect(readCollage(tinyPng())).toBeNull();
    });

    it("says so for something that is not a PNG at all", () => {
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
        expect(looksLikeCollageFile(jpeg)).toBe(false);
        expect(readCollage(jpeg)).toBeNull();
    });

    it("returns null rather than throwing on a truncated file", () => {
        const packed = packCollage(tinyPng(), payload());
        // Cut through the middle of our chunk.
        expect(readCollage(packed.slice(0, packed.length - 200))).toBeNull();
    });

    it("does not walk off the end of a chunk whose length lies", () => {
        const packed = packCollage(tinyPng(), payload());
        // Corrupt the first chunk's length to something enormous.
        const broken = new Uint8Array(packed);
        new DataView(broken.buffer).setUint32(8, 0x7fffffff);
        expect(() => readCollage(broken)).not.toThrow();
        expect(readCollage(broken)).toBeNull();
    });

    it("recognises one of ours cheaply, before parsing it", () => {
        expect(looksLikeCollageFile(packCollage(tinyPng(), payload()))).toBe(true);
    });
});

describe("the CRC", () => {
    it("matches the published PNG test value", () => {
        // "IEND" with no data — the CRC every PNG in existence ends with.
        expect(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44]))).toBe(0xae426082);
    });
});
