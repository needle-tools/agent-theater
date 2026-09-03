import { describe, it, expect } from "vitest";
import { delayAfter } from "../src/lib/collage/typed.js";

describe("the typing clock", () => {
    it("breathes after a full stop or a dash, and not mid-word", () => {
        // The pause is what makes typed text read as speech rather than as a
        // teleprinter: sentences land, then the next one starts.
        expect(delayAfter(".", 20, 300)).toBe(320);
        expect(delayAfter("-", 20, 300)).toBe(320);
        expect(delayAfter("—", 20, 300)).toBe(320);
        expect(delayAfter("e", 20, 300)).toBe(20);
        expect(delayAfter(" ", 20, 300)).toBe(20);
    });
});
