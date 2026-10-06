import { describe, it, expect, vi } from "vitest";
import { play } from "../src/lib/collage/player.js";
import { plan as planScene } from "../src/lib/collage/perform.js";

/**
 * The player, with a stagehand that only records.
 *
 * The element is the smallest thing the player will animate: something with an
 * `animate` that hands back a promise. What is being checked here is not the
 * animation but who is on stage while it happens.
 */
const element = () => ({
    animate: () => ({ finished: Promise.resolve(), cancel() {} }),
} as unknown as Element);

function stagehand() {
    const gone = new Set<string>();
    const said: string[] = [];
    const lights: string[] = [];
    return {
        gone,
        said,
        lights,
        hand: {
            elementFor: () => element(),
            stateOf: () => ({ size: 100, rotation: 0, opacity: 1, flip: false }),
            commit() {},
            turn() {},
            say() {},
            async voice(id: string, line: string) { said.push(`${id}: ${line}`); },
            setGone(id: string, away: boolean) {
                if (away) gone.add(id);
                else gone.delete(id);
            },
            cue() {},
            wear() {},
            async gesture() {},
            async take() {},
            async drop() {},
            riders: () => [],
            async effect() {},
            async camera() {},
            spotlight(ids: string[]) { lights.push(ids.join(",") || "off"); },
        },
    };
}

describe("who is on stage when a scene starts", () => {
    it("brings back somebody who exited in an earlier chapter", async () => {
        // The bug: exit sets gone, gone lasted the whole show, and a chapter
        // later the wolf was invisible — and silent with it, since a bubble is
        // not drawn over somebody who is not there. No error anywhere.
        const { hand, gone, said } = stagehand();
        gone.add("wolf");

        const { plan } = planScene([{ id: "wolf", say: "I am back." }]);
        await play({ ...plan, present: ["wolf"] }, hand).finished;

        expect(gone.has("wolf")).toBe(false);
        expect(said).toEqual(["wolf: I am back."]);
    });

    it("keeps an arrival off stage until their entrance plays", async () => {
        // Present AND hidden: in this chapter, but not yet in the room.
        const { hand, gone } = stagehand();
        const { plan } = planScene([
            { id: "gran", do: "nod" },
            { id: "wolf", do: "walk", to: { x: 200 } },
        ]);
        const playing = play({ ...plan, present: ["gran", "wolf"], hidden: ["wolf"] }, hand);
        expect(gone.has("wolf")).toBe(true);
        expect(gone.has("gran")).toBe(false);
        await playing.finished;
    });

    it("leaves somebody who exits gone for the rest of the scene", async () => {
        const { hand, gone } = stagehand();
        const { plan } = planScene([{ id: "wolf", do: "exit" }]);
        await play({ ...plan, present: ["wolf"] }, hand).finished;
        expect(gone.has("wolf")).toBe(true);
    });
});

describe("spotlight cues", () => {
    it("brings the house lights back after the beat by default", async () => {
        const { hand, lights } = stagehand();
        const { plan } = planScene([{ id: "wolf", say: "I found it!", spotlight: "wolf" }]);
        await play(plan, hand).finished;
        expect(lights).toEqual(["wolf", "off", "off"]);
    });

    it("holds a cue when asked, then clears it when the scene ends", async () => {
        const { hand, lights } = stagehand();
        let finishLine!: () => void;
        hand.voice = async () => new Promise<void>(resolve => { finishLine = resolve; });
        const { plan } = planScene([
            { spotlight: "wolf", spotlightHold: true, duration: 1 },
            { id: "wolf", say: "I am here." },
        ]);
        vi.useFakeTimers();
        try {
            const playing = play(plan, hand);
            await vi.advanceTimersByTimeAsync(2);
            expect(lights).toEqual(["wolf"]);
            finishLine();
            await playing.finished;
            expect(lights).toEqual(["wolf", "off"]);
        } finally { vi.useRealTimers(); }
    });
});
