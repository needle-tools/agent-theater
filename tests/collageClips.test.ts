import { describe, it, expect } from "vitest";
import {
    clipFromSamples, clipKeyframes, clipPreviewKeyframes, clipToCss, clipName,
} from "../src/lib/collage/clips.js";
import { plan as planScene } from "../src/lib/collage/perform.js";

/**
 * Recorded motion. The maths here is normalisation, and every rule exists so
 * a gesture recorded once on one piece plays honestly on any other: sized
 * against the performer, on an even clock, and ending where it began.
 */

const drag = (points: Array<[number, number, number]>) =>
    points.map(([at, x, y]) => ({ at, x, y }));

describe("turning a drag into a clip", () => {
    it("ends where it began, whatever the hand did", () => {
        // A gesture is a performance, not a journey. Travel belongs to walk,
        // which knows how to commit it to the document; a clip that drifted
        // would leave the picture disagreeing with the document by the length
        // of the recording, every time it played.
        const clip = clipFromSamples("wander", drag([
            [0, 100, 100], [200, 160, 90], [400, 210, 130], [600, 300, 200],
        ]), 100)!;
        expect(clip.frames[0].dx).toBeCloseTo(0, 2);
        expect(clip.frames[0].dy).toBeCloseTo(0, 2);
        expect(clip.frames[clip.frames.length - 1].dx).toBeCloseTo(0, 2);
        expect(clip.frames[clip.frames.length - 1].dy).toBeCloseTo(0, 2);
    });

    it("stores the gesture relative to the performer's size", () => {
        // "Half my body up", not "80 pixels up" — so a wobble recorded on a
        // big prop scales down to a mouse.
        const clip = clipFromSamples("hop", drag([
            [0, 0, 0], [100, 0, -40], [200, 0, -80], [300, 0, -40], [400, 0, 0],
        ]), 160)!;
        const peak = Math.min(...clip.frames.map(frame => frame.dy));
        expect(peak).toBeCloseTo(-0.5, 1);
    });

    it("remembers the journey it subtracted", () => {
        // The frames loop in place so a clip composes with a walk — but the
        // travel is kept, so a preview can replay the gesture as performed:
        // a recorded "run down" runs down instead of wobbling on the spot.
        const clip = clipFromSamples("run-down", drag([
            [0, 100, 100], [200, 160, 90], [400, 210, 130], [600, 300, 200],
        ]), 100)!;
        expect(clip.travel).toEqual({ dx: 2, dy: 1 });

        const preview = clipPreviewKeyframes(clip, 100);
        const last = String(preview[preview.length - 1].translate).split(" ").map(parseFloat);
        expect(last[0]).toBeCloseTo(200, 0);
        expect(last[1]).toBeCloseTo(100, 0);

        // A gesture that stayed put does not claim to travel.
        const hop = clipFromSamples("hop", drag([
            [0, 0, 0], [100, 0, -50], [200, 0, -100], [300, 0, -50], [400, 0, 0],
        ]), 100)!;
        expect(hop.travel).toBeUndefined();
    });

    it("refuses a twitch", () => {
        // Shorter than a third of a second is a click that moved, not a
        // gesture worth keeping.
        expect(clipFromSamples("blip", drag([[0, 0, 0], [80, 4, 2], [120, 0, 0], [200, 1, 1]]), 100))
            .toBeNull();
    });

    it("replays at the size of whoever performs it", () => {
        const clip = clipFromSamples("hop", drag([
            [0, 0, 0], [100, 0, -50], [200, 0, -100], [300, 0, -50], [400, 0, 0],
        ]), 100)!;
        const big = clipKeyframes(clip, 400);
        const dips = big.map(frame => parseFloat(String(frame.translate).split(" ")[1]));
        expect(Math.min(...dips)).toBeLessThan(-150);
    });

    it("exports CSS that scales the same way", () => {
        const clip = clipFromSamples("hop", drag([
            [0, 0, 0], [100, 0, -50], [200, 0, -100], [300, 0, -50], [400, 0, 0],
        ]), 100)!;
        const css = clipToCss(clip);
        expect(css).toContain("@keyframes clip-hop");
        expect(css).toContain("em");
    });

    it("makes names a beat vocabulary and CSS can both accept", () => {
        expect(clipName("  Mein Wackeln! ")).toBe("mein-wackeln");
        expect(clipName("TALK")).toBe("talk");
    });
});

describe("clips in a scene", () => {
    it("is a move like any other to the plan", () => {
        const { plan, problems } = planScene([{ id: "a", do: "clip:limp" }]);
        expect(problems).toEqual([]);
        expect(plan.beats[0].move).toBe("clip:limp");
    });

    it("takes the time it was performed in", () => {
        // A shipped clip's beat defaults to the recording's own length; a
        // clip nobody has heard of gets the old flat guess so the timetable
        // still holds together.
        const { plan } = planScene([{ id: "a", do: "clip:run-down" }]);
        expect(plan.beats[0].duration).toBe(1980);
        const { plan: unknown } = planScene([{ id: "a", do: "clip:limp" }]);
        expect(unknown.beats[0].duration).toBe(1200);
    });

    it("still refuses a move that is neither built-in nor a clip", () => {
        const { problems } = planScene([{ id: "a", do: "moonwalk" }]);
        expect(problems).toHaveLength(1);
    });
});
