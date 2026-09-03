import { describe, expect, it } from "vitest";
import { estimateSubtitleTextDuration, timeSubtitleTokens } from "../src/lib/subtitleVoice/timing.js";
import {
    articulationNuclei,
    normalizeGibberishVoice,
    babbleMotion,
    beginSilent,
    dampedFormant,
    harmonicAmplitude,
    lowFormantOnsetMix,
    sentencePitchContour,
    spreadVowelFormants,
    syllableRhythmWeights,
    usesConsonantTexture,
    voiceAcoustics,
    voiceProcessing,
    vowelFormants,
    vowelVoiceProfile,
    wordNuclei,
    wordReleaseGap,
} from "../src/lib/subtitleVoice/synth.js";
import { vowelKind, vowelNuclei } from "../src/lib/subtitleVoice/vowels.js";
import { pronounceToken, pronunciationVowels } from "../src/lib/subtitleVoice/phonemes.js";
import {
    DEFAULT_SUBTITLE_VOICE,
    normalizeSubtitleVoice,
    revealedSubtitleLength,
    subtitleVoiceOptions,
    subtitleVoiceTiming,
} from "../src/lib/subtitleVoice/index.js";

describe("public subtitle voice", () => {
    it("exposes exactly speed, age and tone", () => {
        expect(Object.keys(DEFAULT_SUBTITLE_VOICE)).toEqual(["speed", "age", "tone"]);
        expect(normalizeSubtitleVoice({ speed: 8, age: -1, tone: 4 })).toEqual({
            speed: 2, age: 0, tone: 1,
        });
    });

    it("uses the requested consumer mappings", () => {
        expect(subtitleVoiceOptions({ speed: 0, age: 0, tone: 0 })).toMatchObject({
            speed: 1, age: -1, pitch: -1,
        });
        expect(subtitleVoiceOptions(DEFAULT_SUBTITLE_VOICE)).toMatchObject({
            speed: 1.7, age: 0, pitch: 0,
        });
        expect(subtitleVoiceOptions({ speed: 2, age: 1, tone: 1 })).toMatchObject({
            speed: 2, age: 1, pitch: 1,
        });
    });

    it("holds completed words visible through the same silence used by audio", () => {
        const text = "Hello world!";
        const timing = subtitleVoiceTiming(text, DEFAULT_SUBTITLE_VOICE);
        const first = timing.tokens[0];
        expect(timing.audibleEnds[0]).toBeLessThan(first.end);
        expect(revealedSubtitleLength(text, timing, timing.audibleEnds[0])).toBe(first.text.length);
        expect(revealedSubtitleLength(text, timing, first.end - 0.001)).toBe(first.text.length);
    });
});

describe("subtitle voice timing", () => {
    it("preserves FastVid's calibrated duration estimates", () => {
        expect(estimateSubtitleTextDuration("Hello, brave new world!")).toBeCloseTo(2.0970060145947267, 12);
        expect(estimateSubtitleTextDuration("Dr. Fox found 12 fireflies.")).toBeCloseTo(2.6200244744025376, 12);
        expect(estimateSubtitleTextDuration("Wait — really?")).toBeCloseTo(1.556813802696945, 12);
    });

    it("allocates every token in order inside the estimated line", () => {
        const text = "Hello, brave new world!";
        const timings = timeSubtitleTokens(text);
        expect(timings.map(token => token.text)).toEqual(["Hello,", " brave", " new", " world!"]);
        expect(timings[0].start).toBe(0);
        expect(timings.every((token, index) => index === 0 || token.start >= timings[index - 1].end)).toBe(true);
        expect(timings.at(-1)?.end).toBeLessThan(estimateSubtitleTextDuration(text));
    });

    it("changes duration inversely with authoring speed", () => {
        expect(estimateSubtitleTextDuration("A reasonably long subtitle.", 2))
            .toBeCloseTo(estimateSubtitleTextDuration("A reasonably long subtitle.", 1) / 2);
    });

    it("retains FastVid's unequal word weighting", () => {
        const [longWord, shortWord] = timeSubtitleTokens("Extraordinary cat");
        expect(longWord.end - longWord.start).toBeGreaterThan((shortWord.end - shortWord.start) * 1.5);
    });

    it("adds stress-timed phrase focus without changing FastVid's total duration", () => {
        const text = "hello world! how can I help you?";
        const timings = timeSubtitleTokens(text);
        const byWord = Object.fromEntries(timings.map(token => [token.text.trim().replace(/[!?]/g, "").toLowerCase(), token]));
        const duration = (word: string) => byWord[word].end - byWord[word].start;

        expect(byWord.world.prominence).toBeGreaterThan(byWord.hello.prominence ?? 0);
        expect(byWord.help.prominence).toBeGreaterThan(byWord.can.prominence ?? 0);
        expect(byWord.help.prominence).toBeGreaterThan(byWord.you.prominence ?? 0);
        expect(duration("help")).toBeGreaterThan(duration("can"));
        expect(timings.at(-1)?.end).toBeLessThan(estimateSubtitleTextDuration(text));
    });

    it("lets rhythm—not audio compression—control timing contrast", () => {
        const text = "how can I help you?";
        const even = timeSubtitleTokens(text, 1, 0);
        const expressive = timeSubtitleTokens(text, 1, 1);
        const exaggerated = timeSubtitleTokens(text, 1, 2);
        const ratio = (tokens: typeof even) => {
            const help = tokens.find(token => token.text.trim() === "help")!;
            const can = tokens.find(token => token.text.trim() === "can")!;
            return (help.end - help.start) / (can.end - can.start);
        };
        expect(ratio(expressive)).toBeGreaterThan(ratio(even) * 1.4);
        expect(ratio(exaggerated)).toBeGreaterThan(ratio(expressive) * 1.25);
        expect(expressive.at(-1)?.end).toBeCloseTo(even.at(-1)!.end, 12);
        expect(exaggerated.at(-1)?.end).toBeCloseTo(even.at(-1)!.end, 12);
    });
});

describe("multilingual vowel space", () => {
    it.each([
        ["a", "a"], ["ü", "u"], ["ω", "o"], ["и", "i"], ["え", "e"], ["ു", "u"], ["َ", "a"],
    ] as const)("maps %s to %s", (character, expected) => {
        expect(vowelKind(character)).toBe(expected);
    });

    it("finds vowel nuclei across scripts and gives abjads a neutral fallback", () => {
        expect(vowelNuclei("Привет").map(value => value.kind)).toEqual(["i", "e"]);
        expect(vowelNuclei("こんにちは").map(value => value.kind)).toEqual(["o", "i", "i", "a"]);
        expect(vowelNuclei("بت")).toEqual([{ kind: "a", offset: 0.5 }]);
    });
});

describe("English pronunciation", () => {
    it("maps standalone a e i o u directly onto all five formant targets", () => {
        expect(["a", "e", "i", "o", "u"].map(value => pronunciationVowels(value)[0].kind))
            .toEqual(["a", "e", "i", "o", "u"]);
    });

    it("uses dictionary pronunciations for irregular common words", () => {
        const there = pronounceToken("there");
        expect(there.source).toBe("lexicon");
        expect(there.phones.map(value => value.symbol)).toEqual(["DH", "EH", "R"]);
        expect(pronunciationVowels("there")).toHaveLength(1);
        expect(pronounceToken("they’re").phones.map(value => value.symbol)).toEqual(["DH", "EH", "R"]);
    });

    it("treats silent final e as a vowel modifier, not a second syllable", () => {
        expect(pronunciationVowels("make")).toMatchObject([{ symbol: "EY", kind: "e", glide: "i" }]);
        expect(pronunciationVowels("stone")).toMatchObject([{ symbol: "OW", kind: "o", glide: "u" }]);
    });

    it("keeps a diphthong inside one vowel gesture", () => {
        expect(pronunciationVowels("loud")).toMatchObject([{ symbol: "AW", kind: "a", glide: "u" }]);
    });

    it("scales articulation from all syllables down to one broad mouth shape", () => {
        expect(wordNuclei("hello").map(value => value.symbol)).toEqual(["AH", "OW"]);
        expect(wordNuclei("recipe", "syllable")).toHaveLength(3);
        expect(wordNuclei("hello", "word")).toMatchObject([{ symbol: "AH", kind: "a", glide: "u", stress: 1 }]);
        expect(wordNuclei("hello", "super-coarse")).toMatchObject([{ symbol: "A", kind: "a", glide: "u", stress: 1 }]);
    });

    it("shares coarse mouth shapes without dropping words or crossing sentences", () => {
        const words = ["Hello", "there!", "How", "can", "I", "help", "you?"];
        expect(articulationNuclei(words, "syllable").map(value => value.length)).toEqual([2, 1, 1, 1, 1, 1, 1]);
        expect(articulationNuclei(words, "word").map(value => value.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
        expect(articulationNuclei(words, "coarse").map(value => value.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
        expect(articulationNuclei(words, "super-coarse").map(value => value.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
        const coarse = articulationNuclei(words, "coarse");
        expect(coarse[0]).toEqual(coarse[1]);
        expect(coarse[1]).not.toEqual(coarse[2]);
        const superCoarse = articulationNuclei(words, "super-coarse");
        expect(superCoarse[2]).toEqual(superCoarse[5]);
        expect(superCoarse[5]).not.toEqual(superCoarse[6]);
    });

    it("retains the script-aware fallback outside plain English spelling", () => {
        expect(pronounceToken("Привет").source).toBe("script");
        expect(pronunciationVowels("Привет").map(value => value.kind)).toEqual(["i", "e"]);
    });
});

describe("voice controls", () => {
    it("silences future WebAudio envelopes immediately, before scheduled playback", () => {
        const events: Array<[number, number]> = [];
        const gain = {
            value: 1,
            setValueAtTime(value: number, at: number) { events.push([value, at]); },
        };
        beginSilent(gain, 4.2);
        expect(gain.value).toBe(0);
        expect(events).toEqual([[0, 4.2]]);
    });

    it("clamps persisted or external values", () => {
        expect(normalizeGibberishVoice({ speed: 99, pitch: -4, age: 2, rhythm: 9, vowelSpread: -3, smoothing: 8, fullness: 9, babble: -2 })).toMatchObject({
            speed: 2.5,
            pitch: -1,
            age: 1,
            rhythm: 2,
            vowelSpread: 0,
            smoothing: 3,
            fullness: 2,
            babble: 0,
            articulation: "syllable",
        });
    });

    it("uses the requested character defaults", () => {
        expect(normalizeGibberishVoice()).toMatchObject({
            speed: 1.7,
            timbre: -1,
            depth: -1,
            pause: 0.06,
            rhythm: 1.8,
            vowelSpread: 0.2,
            smoothing: 0,
            fullness: 0.65,
            babble: 1,
            articulation: "syllable",
            breathiness: 1,
            rumbleCut: 60,
            compression: 0.42,
            drive: 1,
            volume: 0.7,
        });
    });

    it("maps the exposed processing controls to safe WebAudio values", () => {
        const clean = voiceProcessing({ compression: 0, rumbleCut: -20, drive: 9 });
        const dense = voiceProcessing({ compression: 1, rumbleCut: 900, drive: 0 });
        expect(clean).toMatchObject({ rumbleCut: 60, drive: 2, ratio: 1, threshold: -8 });
        expect(dense).toMatchObject({ rumbleCut: 600, drive: 0.35, ratio: 27, threshold: -36 });
        expect(dense.release).toBeGreaterThan(clean.release);
    });

    it("focuses overlapping formants without averaging the voice contour", () => {
        const original = dampedFormant(2850, 175, 0, 2);
        const moderate = dampedFormant(2850, 175, 1, 2);
        const strong = dampedFormant(2850, 175, 3, 2);
        expect(original.q).toBeCloseTo(2850 / 175, 12);
        expect(moderate.q).toBeGreaterThan(original.q);
        expect(strong.q).toBeGreaterThan(moderate.q);
        expect(strong.gain).toBeLessThan(moderate.gain);
    });

    it("fills the source with low/mid harmonics without adding a subharmonic", () => {
        const leanRatio = harmonicAmplitude(5, 0.75, 0) / harmonicAmplitude(1, 0.75, 0);
        const fullRatio = harmonicAmplitude(5, 0.75, 2) / harmonicAmplitude(1, 0.75, 2);
        expect(fullRatio).toBeGreaterThan(leanRatio * 2);
        expect(harmonicAmplitude(1, 0.75, 2)).toBeGreaterThan(0);
    });

    it("models babble as speed-aware jaw motion rather than noise", () => {
        expect(babbleMotion({ babble: 0 })).toMatchObject({
            amount: 0,
            gainDepth: 0,
            firstFormantHz: 0,
            secondFormantHz: -0,
        });
        const animated = babbleMotion({ babble: 2, speed: 1 });
        expect(animated.gainDepth).toBe(0.3);
        expect(animated.firstFormantHz).toBe(156);
        expect(animated.secondFormantHz).toBe(-84);
        expect(babbleMotion({ babble: 2, speed: 2 }).rateHz).toBeGreaterThan(animated.rateHz);
    });

    it("does not add a detached noise onset to t/th sounds", () => {
        const thisOnset = pronounceToken("this").phones[0];
        expect(thisOnset).toMatchObject({ type: "consonant", symbol: "DH" });
        if (thisOnset.type !== "consonant") throw new Error("Expected consonant onset");
        expect(usesConsonantTexture(thisOnset)).toBe(false);
    });

    it("eases in only the rumbling low formant at a word onset", () => {
        expect(lowFormantOnsetMix(vowelFormants("i")[0], true)).toBe(0.16);
        expect(lowFormantOnsetMix(vowelFormants("i")[1], true)).toBe(1);
        expect(lowFormantOnsetMix(vowelFormants("a")[0], true)).toBe(1);
        expect(lowFormantOnsetMix(vowelFormants("i")[0], false)).toBe(1);
    });

    it("keeps all five vowel targets far apart in F1/F2 space", () => {
        const kinds = ["a", "e", "i", "o", "u"] as const;
        for (let left = 0; left < kinds.length; left++) {
            for (let right = left + 1; right < kinds.length; right++) {
                const a = vowelFormants(kinds[left]);
                const b = vowelFormants(kinds[right]);
                expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(250);
            }
        }
    });

    it("anchors upper formants so every vowel retains one speaker identity", () => {
        const kinds = ["a", "e", "i", "o", "u"] as const;
        const upperFormants = kinds.map(kind => vowelFormants(kind).slice(2).join(","));
        expect(new Set(upperFormants)).toEqual(new Set(["2850,3600"]));
    });

    it("moves vowels continuously from flat through natural to exaggerated", () => {
        const kinds = ["a", "e", "i", "o", "u"] as const;
        const flat = kinds.map(kind => spreadVowelFormants(kind, 0));
        expect(new Set(flat.map(value => value.join(","))).size).toBe(1);
        for (const kind of kinds) expect(spreadVowelFormants(kind, 1)).toEqual(vowelFormants(kind));

        const center = spreadVowelFormants("i", 0);
        const natural = spreadVowelFormants("i", 1);
        const exaggerated = spreadVowelFormants("i", 2);
        expect(Math.hypot(exaggerated[0] - center[0], exaggerated[1] - center[1]))
            .toBeGreaterThan(Math.hypot(natural[0] - center[0], natural[1] - center[1]) * 1.7);
    });

    it("keeps one coherent vowel profile in every age and pitch quadrant", () => {
        const kinds = ["a", "e", "i", "o", "u"] as const;
        const quadrants = [
            { pitch: -1, age: -1, vowelSpread: 1 },
            { pitch: -1, age: 1, vowelSpread: 1 },
            { pitch: 1, age: -1, vowelSpread: 1 },
            { pitch: 1, age: 1, vowelSpread: 1 },
        ];

        for (const voice of quadrants) {
            const acoustics = voiceAcoustics(voice);
            const profiles = kinds.map(kind => vowelVoiceProfile(kind, voice));
            for (const [kindIndex, profile] of profiles.entries()) {
                expect(profile.bandwidths).toEqual(profiles[0].bandwidths);
                expect(profile.gains).toEqual(profiles[0].gains);
                // Every band belongs to the same vocal tract, rather than each
                // receiving a different male/female/age transform.
                profile.formants.forEach((frequency, band) => {
                    expect(frequency / vowelFormants(kinds[kindIndex])[band]).toBeCloseTo(profile.scale, 10);
                    for (const pitchMultiplier of [1, 1.24]) {
                        const currentFundamental = acoustics.fundamental * pitchMultiplier;
                        const nearestHarmonic = Math.max(1, Math.round(frequency / currentFundamental))
                            * currentFundamental;
                        expect(Math.abs(frequency - nearestHarmonic))
                            .toBeLessThanOrEqual(profile.bandwidths[band] / 2 + 1e-8);
                    }
                });
            }

            for (let left = 0; left < profiles.length; left++) {
                for (let right = left + 1; right < profiles.length; right++) {
                    expect(Math.hypot(
                        profiles[left].formants[0] - profiles[right].formants[0],
                        profiles[left].formants[1] - profiles[right].formants[1],
                    )).toBeGreaterThan(200);
                }
            }
        }
    });

    it("reserves an audible silent tail in every ordinary word slot", () => {
        expect(wordReleaseGap(0.25)).toBeCloseTo(0.0132);
        expect(wordReleaseGap(0.5)).toBeCloseTo(0.0132);
        expect(wordReleaseGap(0.08)).toBeCloseTo(0.011904);
        expect(wordReleaseGap(0.25, 0.55)).toBeCloseTo(0.096);
        expect(wordReleaseGap(0.25, 0)).toBe(0);
        expect(wordReleaseGap(0.25, 1)).toBeCloseTo(0.15);
        expect(wordReleaseGap(0.25, 1, ".")).toBeCloseTo(0.195);
    });

    it("moves pitch and tract depth independently", () => {
        const center = voiceAcoustics();
        const low = voiceAcoustics({ pitch: -1 });
        const high = voiceAcoustics({ pitch: 1 });
        const young = voiceAcoustics({ age: -1 });
        const old = voiceAcoustics({ age: 1 });
        const deep = voiceAcoustics({ depth: 1 });
        expect(high.fundamental).toBeGreaterThan(low.fundamental);
        expect(high.fundamental / center.fundamental).toBeGreaterThan(2);
        expect(young.fundamental / old.fundamental).toBeGreaterThan(1.3);
        expect(deep.tractScale).toBeLessThan(1);
    });

    it("compensates the large source-energy change across the character axes", () => {
        const lowOld = voiceAcoustics({ pitch: -1, age: 1 });
        const highYoung = voiceAcoustics({ pitch: 1, age: -1 });
        expect(lowOld.levelCompensation).toBeGreaterThan(1.5);
        expect(highYoung.levelCompensation).toBeLessThan(0.6);
    });

    it("progressively suppresses isolated upper harmonics only above the midpoint", () => {
        const low = vowelVoiceProfile("a", { pitch: -1 });
        const middle = vowelVoiceProfile("a", { pitch: 0 });
        const high = vowelVoiceProfile("a", { pitch: 1 });
        const upperToLower = (profile: typeof low) => (
            (profile.gains[2] + profile.gains[3]) / (profile.gains[0] + profile.gains[1])
        );
        expect(upperToLower(low)).toBeCloseTo(upperToLower(middle), 12);
        expect(upperToLower(high)).toBeLessThan(upperToLower(middle) * 0.75);
        expect(high.bandwidths[3]).toBeGreaterThan(middle.bandwidths[3]);
    });
});

describe("sentence prosody", () => {
    const ending = (text: string) => sentencePitchContour(timeSubtitleTokens(text)).at(-1)?.multiplier ?? 0;

    it("raises questions and settles statements", () => {
        expect(ending("Are we there yet?")).toBeGreaterThan(1.15);
        expect(ending("We are there now.")).toBeLessThan(0.9);
    });

    it("keeps a comma open and gives each spoken syllable its own melodic gesture", () => {
        const comma = sentencePitchContour(timeSubtitleTokens("Well, perhaps."));
        const commaEnd = comma.findLast(point => point.at <= timeSubtitleTokens("Well, perhaps.")[0].end);
        expect(commaEnd?.multiplier).toBeGreaterThan(1);

        const oneSyllable = sentencePitchContour(timeSubtitleTokens("Cat."));
        const manySyllables = sentencePitchContour(timeSubtitleTokens("Extraordinary."));
        expect(manySyllables.length).toBeGreaterThan(oneSyllable.length + 5);
        expect(Math.max(...manySyllables.map(point => point.multiplier))
            - Math.min(...manySyllables.map(point => point.multiplier))).toBeGreaterThan(0.2);
    });

    it("makes the stressed half of hello longer than its unstressed opening", () => {
        const vowels = pronunciationVowels("hello");
        const weights = syllableRhythmWeights(vowels);
        expect(vowels.map(vowel => vowel.stress)).toEqual([0, 1]);
        expect(weights[1]).toBeGreaterThan(weights[0] * 1.8);
        expect(syllableRhythmWeights(vowels, 0)).toEqual([1, 1]);
        const exaggerated = syllableRhythmWeights(vowels, 2);
        expect(exaggerated[1] / exaggerated[0]).toBeGreaterThan(weights[1] / weights[0]);
    });
});
