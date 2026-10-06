import { describe, expect, it } from "vitest";
import { publishRetryAfter } from "../src/lib/server/publishLimit.js";

describe("new-play rolling limits", () => {
    it("allows the fifth play in an hour and releases a slot when the oldest ages out", () => {
        expect(publishRetryAfter([0, 100, 200, 300])).toBe(0);
        expect(publishRetryAfter([0, 100, 200, 300, 3590])).toBe(10);
        expect(publishRetryAfter([0, 100, 200, 300, 3600])).toBe(0);
    });

    it("also caps ten plays across eight hours even when the hourly window is free", () => {
        const ages = [0, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 27000];
        expect(publishRetryAfter(ages)).toBe(1800);
        expect(publishRetryAfter(ages.slice(0, 9))).toBe(0);
    });

    it("uses the longer retry when both windows are full", () => {
        expect(publishRetryAfter([0, 60, 120, 180, 240, 4000, 8000, 12000, 16000, 28000])).toBe(3360);
    });
});
