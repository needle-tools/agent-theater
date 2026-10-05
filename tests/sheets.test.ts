import { describe, expect, it } from "vitest";
import { SHEET_MAX_BYTES, SHEET_TTL_MS, sheetExpired, sheetKey, sheetType } from "../src/lib/server/sheets";

describe("temporary sheet uploads", () => {
    const png = Uint8Array.from([
        137, 80, 78, 71, 13, 10, 26, 10,
        0, 0, 0, 13, 73, 72, 68, 82,
        0, 0, 0, 2, 0, 0, 0, 3,
        8, 6, 0, 0, 0, 0, 0, 0, 0,
    ]);

    it("accepts matching PNG data with sane dimensions", () => {
        expect(sheetType(png, "image/png")).toBe("png");
        expect(sheetType(png, "image/webp")).toBeNull();
        const enormous = png.slice();
        enormous.set([0, 0, 32, 1], 16);
        expect(sheetType(enormous, "image/png")).toBeNull();
    });

    it("accepts a valid WebP container and rejects mismatched bytes", () => {
        const webp = Uint8Array.from([82, 73, 70, 70, 8, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);
        expect(sheetType(webp, "image/webp")).toBe("webp");
        expect(sheetType(webp, "image/png")).toBeNull();
    });

    it("restricts stored keys and expires sheets after two hours", () => {
        const id = `${"a".repeat(32)}.png`;
        expect(sheetKey(id)).toBe(`plays/sheets/${id}`);
        expect(sheetKey("../assets/other.png")).toBeNull();
        expect(SHEET_MAX_BYTES).toBe(5 * 1024 * 1024);
        expect(sheetExpired(new Date(1000), 1000 + SHEET_TTL_MS - 1)).toBe(false);
        expect(sheetExpired(new Date(1000), 1000 + SHEET_TTL_MS)).toBe(true);
    });
});
