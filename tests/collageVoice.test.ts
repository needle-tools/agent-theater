import { describe, expect, it } from "vitest";
import { createPrompter, spokenLength } from "../src/lib/collage/speech.js";
import { voicesOf, spokenBy } from "../src/lib/collage/show.js";
import { plan as planScene, readingTime } from "../src/lib/collage/perform.js";
import { DEFAULT_SUBTITLE_VOICE, subtitleVoiceTiming } from "../src/lib/subtitleVoice/index.js";
import type { Stage } from "../src/lib/collage/stage.js";

const voice = { ...DEFAULT_SUBTITLE_VOICE };
const stageWith = (cast: Stage["cast"], script: Stage["script"] = []): Stage => ({
    id: "s1", name: "A scene", backdrop: null, cast, script,
});

describe("a scene's lightweight voices", () => {
    it("keeps exactly the three-parameter voices that were cast", () => {
        const stage = stageWith([
            { id: "a", x: 0, y: 0, voice },
            { id: "b", x: 0, y: 0 },
        ]);
        expect(voicesOf(stage).get("a")).toEqual({ speed: 1, age: 0.5, tone: 0.5 });
        expect(voicesOf(stage).has("b")).toBe(false);
    });

    it("ignores obsolete named-model voices in old documents", () => {
        const stage = stageWith([{ id: "a", x: 0, y: 0, voice: "af_heart" } as unknown as Stage["cast"][number]]);
        expect(voicesOf(stage).has("a")).toBe(false);
    });

    it("plans with exactly the duration used by WebAudio", () => {
        const stage = stageWith(
            [{ id: "a", x: 0, y: 0, voice }],
            [{ id: "a", say: "Hello world!" }],
        );
        const { plan } = planScene(stage.script, spokenBy(stage));
        expect(plan.beats[0].duration).toBe(spokenLength({ text: "Hello world!", voice }));
        expect(plan.beats[0].duration).toBeGreaterThan(subtitleVoiceTiming("Hello world!", voice).duration * 1000);
    });

    it("falls back to reading time for silent parts", () => {
        const stage = stageWith([{ id: "a", x: 0, y: 0 }], [{ id: "a", say: "Hi" }]);
        expect(planScene(stage.script, spokenBy(stage)).plan.beats[0].duration).toBe(readingTime("Hi"));
    });
});

describe("the speech queue without browser audio", () => {
    it("sequences bubbles and reports them as unvoiced", async () => {
        const prompter = createPrompter();
        const log: string[] = [];
        const line = (name: string) => prompter.speak(
            { text: name, voice },
            {
                fallback: 40,
                begin: (_ms, voiced) => log.push(`${name}:in:${voiced}`),
                end: () => log.push(`${name}:out`),
            },
        );
        await Promise.all([line("one"), line("two")]);
        expect(log).toEqual(["one:in:false", "one:out", "two:in:false", "two:out"]);
    });

    it("stops the active turn and drops queued turns", async () => {
        const prompter = createPrompter();
        const log: string[] = [];
        const lines = ["one", "two"].map(name => prompter.speak(
            { text: name },
            { fallback: 300, begin: () => log.push(`${name}:in`), end: () => log.push(`${name}:out`) },
        ));
        await new Promise(resolve => setTimeout(resolve, 60));
        prompter.hush();
        await Promise.all(lines);
        expect(log).toEqual(["one:in", "one:out"]);
        expect(prompter.busy).toBe(false);
    });

    it("uses null for silent lines", () => {
        expect(spokenLength({ text: "Hello" })).toBeNull();
        expect(spokenLength({ text: "Hello", voice: null })).toBeNull();
    });
});
