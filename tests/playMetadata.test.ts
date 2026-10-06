import { describe, expect, it } from "vitest";
import { playLanguage } from "../src/lib/collage/language.js";
import { plan, readingTime } from "../src/lib/collage/perform.js";

describe("published play metadata", () => {
    it("normalizes explicit language codes without guessing from the browser", () => {
        expect(playLanguage("DE_de")).toBe("de-de");
        expect(playLanguage("en")).toBe("en");
        expect(playLanguage(undefined)).toBe("und");
        expect(playLanguage("not a language")).toBe("und");
    });

    it("keeps a narrator passage attached to its timed beat", () => {
        const line = "The moon waited until everyone had gone home.";
        const result = plan([{ narration: line }, { id: "moon", do: "nod" }]);
        expect(result.problems).toEqual([]);
        expect(result.plan.beats[0].narration).toBe(line);
        expect(result.plan.beats[0].duration).toBe(readingTime(line));
        expect(result.plan.duration).toBe(readingTime(line) + 900);
    });
});
