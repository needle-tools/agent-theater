import { describe, expect, it } from "vitest";
import { actorForLayer, greetingForActor, voiceForActor } from "../src/lib/collage/characterVoice.js";
import { TROUPE } from "../src/lib/collage/troupe.js";

const piece = (id: string) => TROUPE.find(candidate => candidate.id === id)!;

describe("character voices", () => {
    it("recognises actors but not scenery from troupe layer labels", () => {
        expect(actorForLayer({ label: "fairy-tale/giant", src: "elsewhere" })?.id).toBe("fairy-tale/giant");
        expect(actorForLayer({ label: "fairy-tale/apple", src: "elsewhere" })).toBeNull();
    });

    it("keeps every suggested voice inside the three public controls", () => {
        for (const actor of TROUPE.filter(candidate => candidate.kind === "actor")) {
            const voice = voiceForActor(actor);
            expect(Object.keys(voice).sort()).toEqual(["age", "speed", "tone"]);
            expect(voice.speed).toBeGreaterThanOrEqual(0);
            expect(voice.speed).toBeLessThanOrEqual(2);
            expect(voice.age).toBeGreaterThanOrEqual(0);
            expect(voice.age).toBeLessThanOrEqual(1);
            expect(voice.tone).toBeGreaterThanOrEqual(0);
            expect(voice.tone).toBeLessThanOrEqual(1);
        }
    });

    it("makes a giant lower and slower than a fairy", () => {
        const giant = voiceForActor(piece("fairy-tale/giant"));
        const fairy = voiceForActor(piece("fairy-tale/fairy"));
        expect(giant.tone).toBeLessThan(fairy.tone);
        expect(giant.speed).toBeLessThan(fairy.speed);
        expect(giant.age).toBeGreaterThan(fairy.age);
    });

    it("chooses the same short greeting for the same actor", () => {
        expect(greetingForActor(piece("animals/rabbit"))).toBe(greetingForActor(piece("animals/rabbit")));
        expect(["Hi!", "Hello!", "Oh, hello!"]).toContain(greetingForActor(piece("animals/rabbit")));
    });
});
