import { describe, it, expect } from "vitest";
import { createPrompter, spokenLength } from "../src/lib/collage/speech.js";
import {
    createVoices, findVoice, voiceCatalogue, voiceNames, MUTE, SPEECH_ENABLED,
    type Line, type Spoken, type Voices, type VoiceState,
} from "../src/lib/collage/voice.js";
import { linesOf, spokenBy, voicesOf } from "../src/lib/collage/show.js";
import { plan as planScene, readingTime } from "../src/lib/collage/perform.js";
import type { Stage } from "../src/lib/collage/stage.js";

/**
 * Voices, and the one queue everything speaks through.
 *
 * The model itself is not tested here and could not be: it is eighty megabytes
 * of weights fetched at runtime, and a unit test that downloaded it would be
 * testing somebody else's neural network. What IS testable is everything the
 * app decided around it — that a line's real length reaches the plan, that a
 * part with no voice is silent rather than defaulted, and above all that two
 * lines never overlap, which is the whole reason the prompter exists.
 */

/**
 * A voice box that answers instantly with whatever lengths a test names.
 *
 * `lineFor` returns a URL nothing will ever fetch, because in node there is no
 * Audio to fetch it with — which is exactly the shape the real thing takes when
 * a browser refuses autoplay, so the fallback path gets exercised for free.
 */
function fakeVoices(lengths: Record<string, number> = {}, state: VoiceState = "ready"): Voices {
    const key = (text: string, voice: string) => `${voice}\n${text}`;
    return {
        async learn() {},
        warm() {},
        forget() {},
        state,
        trouble: null,
        lengthOf: (text, voice) => lengths[key(text, voice)] ?? null,
        lineFor: (text, voice): Spoken | null =>
            lengths[key(text, voice)] === undefined
                ? null
                : { url: "blob:nothing", seconds: lengths[key(text, voice)] / 1000 },
    };
}

const stageWith = (cast: Stage["cast"], script: Stage["script"] = []): Stage => ({
    id: "s1", name: "A scene", backdrop: null, cast, script,
});

describe("speech being switched off", () => {
    it("asks for no model and reports a decision rather than a fault", () => {
        // The distinction the tools lean on: "off" is a build that never tried,
        // "unavailable" is one that tried and could not. Reporting the first as
        // the second sends somebody hunting a broken model nobody asked for.
        expect(SPEECH_ENABLED).toBe(false);
        expect(createVoices().state).toBe("off");
        expect(createVoices().lineFor("anything", "af_heart")).toBeNull();
    });

    it("leaves the prompter mute, so bubbles do not wait for a voice", async () => {
        const prompter = createPrompter(createVoices());
        expect(prompter.mute).toBe(true);
        // Still sequenced and still shown — only never heard.
        let held = 0;
        await prompter.speak({ text: "a line", voice: "af_heart" },
            { fallback: 30, begin: (ms, voiced) => { held = ms; expect(voiced).toBe(false); } });
        expect(held).toBe(30);
    });

    it("is not mute merely because the model is still loading", () => {
        // The difference that decides whether a bubble bothers to try again
        // later. Loading is a "not yet"; off and unavailable are "no".
        expect(createPrompter(fakeVoices({}, "working")).mute).toBe(false);
        expect(createPrompter(fakeVoices({}, "idle")).mute).toBe(false);
        expect(createPrompter(fakeVoices({}, "unavailable")).mute).toBe(true);
    });
});

describe("the voice catalogue", () => {
    it("offers only voices it can actually find", () => {
        for (const id of voiceNames()) expect(findVoice(id)).not.toBeNull();
    });

    it("says something about each one, so the choice is not arbitrary", () => {
        // The same rule the sound catalogue follows. A bare list of ids gets
        // the first one picked every time and a whole cast in one voice.
        const catalogue = voiceCatalogue();
        expect(catalogue).toHaveLength(voiceNames().length);
        for (const line of catalogue) expect(line.length).toBeGreaterThan(40);
    });

    it("has more than one voice per accent and gender, so a cast can differ", () => {
        const male = voiceNames().filter(id => findVoice(id)!.gender === "male");
        const british = voiceNames().filter(id => findVoice(id)!.accent === "british");
        expect(male.length).toBeGreaterThan(2);
        expect(british.length).toBeGreaterThan(2);
    });
});

describe("a scene's lines", () => {
    it("belong only to parts that were cast with a voice", () => {
        const stage = stageWith(
            [{ id: "a", x: 0, y: 0, voice: "af_heart" }, { id: "b", x: 0, y: 0 }],
            [{ id: "a", say: "Hello" }, { id: "b", say: "Nothing from me" }]);
        expect(voicesOf(stage).get("a")).toBe("af_heart");
        // Absent, not defaulted. A part nobody chose a voice for is silent, and
        // quietly handing it a narrator's voice would be choosing for them.
        expect(voicesOf(stage).has("b")).toBe(false);
        expect(linesOf(stage)).toEqual([{ text: "Hello", voice: "af_heart" }]);
    });

    it("skips beats that are not somebody speaking", () => {
        const stage = stageWith(
            [{ id: "a", x: 0, y: 0, voice: "af_heart" }],
            [{ id: "a", do: "jump" }, { camera: { on: "all" } }, { wait: 1 }, { id: "a", say: "  " }]);
        expect(linesOf(stage)).toEqual([]);
    });
});

describe("the plan", () => {
    it("times a spoken line by the speaking, not by the reading", () => {
        const stage = stageWith(
            [{ id: "a", x: 0, y: 0, voice: "af_heart" }],
            [{ id: "a", say: "Hi" }]);
        // "Hi" reads fast and is spoken slowly — deliberately opposite, so a
        // plan that ignored the voice would be obvious rather than close.
        const voices = fakeVoices({ "af_heart\nHi": 9000 });
        const { plan } = planScene(stage.script, spokenBy(stage, voices));
        expect(readingTime("Hi")).toBeLessThan(5000);
        // The audio, plus the moment of bubble after it and the breath before
        // the next thing — the whole turn, which is what the show will take.
        expect(plan.beats[0].duration).toBe(spokenLength(voices, { text: "Hi", voice: "af_heart" }));
        expect(plan.beats[0].duration).toBeGreaterThan(9000);
    });

    it("falls back to reading time for a line nobody has spoken yet", () => {
        const stage = stageWith(
            [{ id: "a", x: 0, y: 0, voice: "af_heart" }],
            [{ id: "a", say: "Hi" }]);
        // Cast with a voice, but the model has not got to it — a show started
        // while the download was still going. Reading time, not zero.
        const { plan } = planScene(stage.script, spokenBy(stage, fakeVoices({})));
        expect(plan.beats[0].duration).toBe(readingTime("Hi"));
    });

    it("is unchanged when nothing has a voice at all", () => {
        const script = [{ id: "a", say: "Hi" }, { id: "a", do: "jump" as const }];
        const withoutVoices = planScene(script).plan;
        const withSilentCast = planScene(script, spokenBy(stageWith([{ id: "a", x: 0, y: 0 }]), MUTE)).plan;
        expect(withSilentCast.duration).toBe(withoutVoices.duration);
    });
});

describe("the prompter", () => {
    it("never lets two lines be in progress at once", async () => {
        const prompter = createPrompter(fakeVoices({}, "unavailable"));
        const log: string[] = [];
        const line = (name: string) => prompter.speak(
            { text: `${name} is talking`, voice: "af_heart" },
            { fallback: 40, begin: () => log.push(`${name}:in`), end: () => log.push(`${name}:out`) });

        // Queued together, in the same tick, which is the case that used to
        // overlap: a `with` beat, or two props introducing themselves.
        await Promise.all([line("one"), line("two"), line("three")]);

        expect(log).toEqual([
            "one:in", "one:out", "two:in", "two:out", "three:in", "three:out",
        ]);
    });

    it("sequences silent lines too", async () => {
        // A silent bubble talking over a spoken one is the same bug, just
        // harder to hear — so it goes through the same queue.
        const prompter = createPrompter(fakeVoices({}, "unavailable"));
        const log: string[] = [];
        await Promise.all([
            prompter.speak({ text: "spoken", voice: "af_heart" },
                { fallback: 30, begin: () => log.push("a:in"), end: () => log.push("a:out") }),
            prompter.speak({ text: "silent" },
                { fallback: 30, begin: () => log.push("b:in"), end: () => log.push("b:out") }),
        ]);
        expect(log).toEqual(["a:in", "a:out", "b:in", "b:out"]);
    });

    it("holds a bubble for the fallback when there is no audio", async () => {
        const prompter = createPrompter(fakeVoices({}, "unavailable"));
        let held = 0;
        const began = Date.now();
        await prompter.speak({ text: "a line", voice: "af_heart" },
            { fallback: 220, begin: ms => (held = ms) });
        expect(held).toBe(220);
        // Slack either way: timers are not promises about exact durations.
        expect(Date.now() - began).toBeGreaterThanOrEqual(180);
    });

    it("reveals the line as it goes rather than all at once", async () => {
        const prompter = createPrompter(fakeVoices({}, "unavailable"));
        const seen: number[] = [];
        await prompter.speak({ text: "a longer line to type out" },
            { fallback: 300, show: progress => seen.push(progress) });
        expect(seen.length).toBeGreaterThan(2);
        // Monotonic, and finished before the bubble is: the words are meant to
        // arrive slightly ahead of the mouth, not to trail it.
        expect(seen).toEqual([...seen].sort((a, b) => a - b));
        expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]);
    });

    it("drops a line whose bubble left before its turn came", async () => {
        const prompter = createPrompter(fakeVoices({}, "unavailable"));
        const log: string[] = [];
        let gone = false;
        const first = prompter.speak({ text: "first" },
            { fallback: 60, begin: () => log.push("first:in") });
        const second = prompter.speak({ text: "second" },
            { fallback: 60, dropped: () => gone, begin: () => log.push("second:in") });
        // Unmounted while it was still waiting behind the first one.
        gone = true;
        await Promise.all([first, second]);
        expect(log).toEqual(["first:in"]);
    });

    it("stops what is being said and forgets what was queued behind it", async () => {
        const prompter = createPrompter(fakeVoices({}, "unavailable"));
        const log: string[] = [];
        const lines = ["one", "two", "three"].map(name => prompter.speak(
            { text: name },
            { fallback: 400, begin: () => log.push(`${name}:in`), end: () => log.push(`${name}:out`) }));

        await new Promise(resolve => setTimeout(resolve, 60));
        prompter.hush();
        await Promise.all(lines);

        // The first one was cut off — it began and ended — and the two behind
        // it never began at all.
        expect(log).toEqual(["one:in", "one:out"]);
        expect(prompter.busy).toBe(false);
    });

    it("says nothing at all for an empty line", async () => {
        const prompter = createPrompter(fakeVoices({}, "unavailable"));
        let began = false;
        await prompter.speak({ text: "   " }, { begin: () => (began = true) });
        expect(began).toBe(false);
    });

    it("keeps going after a line that fails", async () => {
        // One line that throws must not take the rest of the page's speech
        // with it — the queue is shared and outlives any one bubble.
        const prompter = createPrompter(fakeVoices({}, "unavailable"));
        const log: string[] = [];
        const bad = prompter.speak({ text: "bad" }, {
            fallback: 20,
            begin: () => { throw new Error("this bubble is broken"); },
        });
        const good = prompter.speak({ text: "good" }, { fallback: 20, begin: () => log.push("good:in") });
        await Promise.all([bad.catch(() => {}), good]);
        expect(log).toEqual(["good:in"]);
    });
});

describe("a length quoted to the planner", () => {
    it("covers the whole turn, so the timetable is not short", () => {
        const voices = fakeVoices({ "af_heart\nHello": 1000 });
        const quoted = spokenLength(voices, { text: "Hello", voice: "af_heart" })!;
        // Longer than the audio: the bubble outlives the last syllable and a
        // breath follows it. A timetable counting only the audio would run
        // fast by a fraction of a second on every line of the play.
        expect(quoted).toBeGreaterThan(1000);
        expect(quoted).toBeLessThan(2000);
    });

    it("is null for a part with no voice, however well known the line", () => {
        const voices = fakeVoices({ "af_heart\nHello": 1000 });
        expect(spokenLength(voices, { text: "Hello" })).toBeNull();
        expect(spokenLength(voices, { text: "Hello", voice: null })).toBeNull();
    });
});
