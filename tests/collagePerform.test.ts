import { describe, it, expect } from "vitest";
import {
    AT_REST, BREATH_MS, DEFAULT_CAMERA_MS, DEFAULT_DURATION, MOVES, compose, plan as planScene, poseFor,
    readingTime, restingPlaces, score, stateAt, type MoveName,
} from "../src/lib/collage/perform.js";

/**
 * The acting vocabulary.
 *
 * All of it is arithmetic on a normalised time, which is the point: an agent
 * cannot animate — a tool call is a round trip and a walk cycle is sixty frames
 * a second — so it hands over a score and the page plays it. That makes the
 * whole vocabulary assertable without a browser.
 *
 * The invariant that matters most is that a beat leaves nothing behind. Poses
 * are layered on top of a layer's real position, so a move that ended slightly
 * off would leave the picture disagreeing with the document by a little more
 * every time it played.
 */

const context = { size: 200, dx: 0, dy: 0 };
const near = (a: number, b: number, slack = 0.02) => Math.abs(a - b) <= slack;

describe("every move", () => {
    it("starts at rest", () => {
        // `enter` is the exception by definition: arriving from somewhere else
        // is the whole move. Everything else must begin exactly where the
        // layer already is, or it pops on its first frame.
        for (const move of MOVES) {
            if (move === "enter") continue;
            const pose = poseFor(move, 0, context);
            expect(near(pose.dx, 0), `${move} dx`).toBe(true);
            expect(near(pose.dy, 0), `${move} dy`).toBe(true);
            expect(near(pose.scaleX, 1), `${move} scaleX`).toBe(true);
            expect(near(pose.scaleY, 1), `${move} scaleY`).toBe(true);
        }
    });

    it("enter starts away and lands at rest", () => {
        const start = poseFor("enter", 0, context);
        expect(start.opacity).toBeCloseTo(0, 3);
        expect(start.dy).toBeGreaterThan(0);
        const end = poseFor("enter", 1, context);
        expect(near(end.dy, 0)).toBe(true);
        expect(near(end.scaleX, 1)).toBe(true);
        expect(end.opacity).toBeCloseTo(1, 3);
    });

    it("returns to rest, unless it went somewhere or left", () => {
        // A beat that ends off-centre drags the layer away from where the
        // document says it is, a little more on every play.
        for (const move of MOVES) {
            if (move === "walk" || move === "jump" || move === "exit") continue;
            const pose = poseFor(move, 1, context);
            expect(near(pose.dx, 0), `${move} dx`).toBe(true);
            expect(near(pose.dy, 0), `${move} dy`).toBe(true);
            expect(near(pose.rotate, 0, 0.2), `${move} rotate`).toBe(true);
            expect(near(pose.scaleX, 1), `${move} scaleX`).toBe(true);
            expect(near(pose.scaleY, 1), `${move} scaleY`).toBe(true);
            expect(near(pose.opacity, 1), `${move} opacity`).toBe(true);
        }
    });

    it("stays finite and sane at every point along it", () => {
        for (const move of MOVES) {
            for (let i = 0; i <= 20; i++) {
                const pose = poseFor(move, i / 20, { size: 200, dx: 300, dy: -80 });
                for (const [key, value] of Object.entries(pose)) {
                    expect(Number.isFinite(value), `${move} ${key}`).toBe(true);
                }
                expect(pose.scaleX).toBeGreaterThan(0.5);
                expect(pose.scaleY).toBeGreaterThan(0.5);
                expect(pose.opacity).toBeGreaterThanOrEqual(0);
                expect(pose.opacity).toBeLessThanOrEqual(1);
            }
        }
    });

    it("clamps a time outside the beat rather than extrapolating", () => {
        for (const move of MOVES) {
            expect(poseFor(move, -5, context)).toEqual(poseFor(move, 0, context));
            expect(poseFor(move, 9, context)).toEqual(poseFor(move, 1, context));
        }
    });

    it("scales with the layer, so a small sprite makes a small movement", () => {
        const small = poseFor("jump", 0.5, { size: 50, dx: 0, dy: 0 });
        const large = poseFor("jump", 0.5, { size: 500, dx: 0, dy: 0 });
        expect(Math.abs(large.dy)).toBeGreaterThan(Math.abs(small.dy) * 5);
    });
});

describe("the moves themselves", () => {
    it("jump goes up, not down, and peaks in the middle", () => {
        // Up is negative y, which is the kind of thing that is wrong once and
        // then wrong everywhere.
        const apex = poseFor("jump", 0.5, context);
        expect(apex.dy).toBeLessThan(0);
        expect(apex.dy).toBeLessThan(poseFor("jump", 0.2, context).dy);
        expect(apex.dy).toBeLessThan(poseFor("jump", 0.8, context).dy);
    });

    it("jump squashes on the way out and stretches at the top", () => {
        const launch = poseFor("jump", 0.02, context);
        const apex = poseFor("jump", 0.5, context);
        expect(launch.scaleY).toBeLessThan(1);
        expect(launch.scaleX).toBeGreaterThan(1);
        expect(apex.scaleY).toBeGreaterThan(1);
    });

    it("shake dies away rather than stopping at full strength", () => {
        let early = 0, late = 0;
        for (let i = 0; i < 40; i++) {
            early = Math.max(early, Math.abs(poseFor("shake", i / 200, context).dx));
            late = Math.max(late, Math.abs(poseFor("shake", 0.8 + i / 200, context).dx));
        }
        expect(late).toBeLessThan(early / 2);
    });

    it("shake is side to side, not up and down", () => {
        for (let i = 1; i < 20; i++) {
            expect(poseFor("shake", i / 20, context).dy).toBe(0);
        }
    });

    it("surprised is big and slow; scared is small and shrinking", () => {
        const surprised = poseFor("surprised", 0.25, context);
        const scared = poseFor("scared", 0.5, context);
        expect(surprised.scaleY).toBeGreaterThan(1);
        expect(surprised.dy).toBeLessThan(0);
        expect(scared.scaleY).toBeLessThan(1);
        expect(scared.rotate).toBeLessThan(0);
    });

    it("walk arrives where it was sent, and bobs on the way", () => {
        const travel = { size: 200, dx: 400, dy: 0 };
        expect(poseFor("walk", 1, travel).dx).toBeCloseTo(400, 5);
        expect(poseFor("walk", 0, travel).dx).toBeCloseTo(0, 5);
        // Bobbing means the vertical offset is not simply zero throughout.
        const heights = Array.from({ length: 20 }, (_, i) => poseFor("walk", i / 20, travel).dy);
        expect(Math.min(...heights)).toBeLessThan(-1);
    });

    it("enter fades in and exit fades out", () => {
        expect(poseFor("enter", 0, context).opacity).toBeCloseTo(0, 3);
        expect(poseFor("enter", 1, context).opacity).toBeCloseTo(1, 3);
        expect(poseFor("exit", 1, context).opacity).toBeCloseTo(0, 3);
    });
});

describe("composing", () => {
    it("adds offsets and multiplies scales, so neither beat wins", () => {
        const a = { dx: 10, dy: -5, rotate: 3, scaleX: 1.1, scaleY: 0.9, opacity: 0.5 };
        const b = { dx: -4, dy: 2, rotate: -1, scaleX: 2, scaleY: 2, opacity: 0.5 };
        expect(compose(a, b)).toEqual({
            dx: 6, dy: -3, rotate: 2, scaleX: 2.2, scaleY: 1.8, opacity: 0.25,
        });
    });

    it("leaves a pose alone when composed with rest", () => {
        const pose = poseFor("scared", 0.4, context);
        expect(compose(pose, AT_REST)).toEqual(pose);
    });
});

describe("writing a score", () => {
    it("follows on from the same layer's last move when no time is given", () => {
        // Writing a scene should be a list of things happening, not arithmetic.
        const { score: plan, problems } = score([
            { id: "a", do: "walk", to: { x: 200 } },
            { id: "a", do: "jump" },
        ]);
        expect(problems).toEqual([]);
        expect(plan.cues[0].start).toBe(0);
        expect(plan.cues[1].start).toBe(DEFAULT_DURATION.walk);
    });

    it("lets two layers act at the same time", () => {
        const { score: plan } = score([
            { id: "a", do: "walk" },
            { id: "b", do: "shake" },
        ]);
        expect(plan.cues[0].start).toBe(0);
        expect(plan.cues[1].start).toBe(0);
    });

    it("honours an explicit time", () => {
        const { score: plan } = score([{ id: "a", do: "jump", at: 2500 }]);
        expect(plan.cues[0].start).toBe(2500);
    });

    it("lets a layer speak while it moves", () => {
        // Speech does not hold up the next move — it is the moves that queue.
        const { score: plan } = score([
            { id: "a", do: "walk" },
            { id: "a", say: "on my way" },
            { id: "a", do: "jump" },
        ]);
        const [walk, say, jump] = plan.cues;
        expect(say.start).toBe(walk.end);
        expect(jump.start).toBe(walk.end);
    });

    it("gives a longer line longer to be read", () => {
        expect(readingTime("Hi")).toBeLessThan(readingTime("A considerably longer thing to say out loud"));
        // Capped, so a monologue pasted into one beat cannot hold the scene.
        expect(readingTime("x".repeat(500))).toBeLessThanOrEqual(14_000);
        // And a floor, because a two-word line still has to be seen at all.
        expect(readingTime("Hi")).toBeGreaterThanOrEqual(3000);
    });

    it("names what is wrong instead of guessing", () => {
        const { problems } = score([
            { id: "", do: "walk" },
            { id: "a", do: "moonwalk" as MoveName },
            { id: "a" },
        ]);
        expect(problems).toHaveLength(3);
        expect(problems[0].reason).toMatch(/id/);
        expect(problems[1].reason).toMatch(/moonwalk/);
        expect(problems[2].reason).toMatch(/do.*say|say.*do/);
    });

    it("refuses a score that would run for hours", () => {
        const { problems } = score([{ id: "a", do: "shake", at: 500_000 }]);
        expect(problems.some(p => /longer than/.test(p.reason))).toBe(true);
    });
});

describe("playing it back", () => {
    const sizeOf = () => 200;

    it("has nobody acting before the first cue", () => {
        const { score: plan } = score([{ id: "a", do: "jump", at: 1000 }]);
        expect(stateAt(plan, 0, sizeOf).get("a")?.pose ?? AT_REST).toEqual(AT_REST);
    });

    it("layers two beats on the same actor at once", () => {
        // Walking and surprised together should do both, rather than one of
        // them winning — deciding which wins is deciding wrongly.
        const { score: plan } = score([
            { id: "a", do: "walk", to: { x: 400 }, duration: 1000 },
            { id: "a", do: "surprised", at: 200, duration: 400 },
        ]);
        const pose = stateAt(plan, 400, sizeOf).get("a")!.pose;
        expect(pose.dx).toBeGreaterThan(0);
        expect(pose.dy).toBeLessThan(0);
    });

    it("shows a line while it is being said, and types it in", () => {
        const { score: plan } = score([{ id: "a", say: "Hello there", duration: 1000 }]);
        expect(stateAt(plan, 10, sizeOf).get("a")?.say).toBe("Hello there");
        expect(stateAt(plan, 100, sizeOf).get("a")!.saying).toBeLessThan(0.2);
        expect(stateAt(plan, 900, sizeOf).get("a")!.saying).toBeGreaterThan(0.8);
        // And it is gone once its time is up.
        expect(stateAt(plan, 1200, sizeOf).get("a")?.say ?? null).toBeNull();
    });

    it("keeps a layer gone after it exits", () => {
        const { score: plan } = score([{ id: "a", do: "exit", duration: 500 }]);
        expect(stateAt(plan, 800, sizeOf).get("a")!.gone).toBe(true);
    });

    it("leaves nothing behind once a returning beat is over", () => {
        const { score: plan } = score([{ id: "a", do: "shake", duration: 500 }]);
        const after = stateAt(plan, 900, sizeOf).get("a")?.pose ?? AT_REST;
        expect(after).toEqual(AT_REST);
    });
});

describe("where everyone ends up", () => {
    it("commits only the beats that travel", () => {
        // The performance is presentational; this is the single edit that makes
        // a walk across the stage still be across the stage afterwards.
        const { score: plan } = score([
            { id: "a", do: "walk", to: { x: 300 } },
            { id: "a", do: "shake" },
            { id: "b", do: "surprised", to: { x: 999 } },
        ]);
        const resting = restingPlaces(plan);
        expect(resting.get("a")).toEqual({ dx: 300, dy: 0 });
        expect(resting.has("b")).toBe(false);
    });

    it("adds up several journeys by the same actor", () => {
        const { score: plan } = score([
            { id: "a", do: "walk", to: { x: 200 } },
            { id: "a", do: "jump", to: { x: 50, y: -30 } },
        ]);
        expect(restingPlaces(plan).get("a")).toEqual({ dx: 250, dy: -30 });
    });
});

describe("the camera", () => {
    it("takes a beat of its own, with nobody in it", () => {
        // A camera beat is about the view, so requiring an "id" would mean
        // naming somebody it is not about.
        const { plan, problems } = planScene([{ camera: { on: "all" } }]);
        expect(problems).toEqual([]);
        expect(plan.beats).toHaveLength(1);
        expect(plan.beats[0].camera).toEqual({ on: "all" });
    });

    it("lasts as long as the agent says, because that is the whole point", () => {
        const { plan } = planScene([
            { camera: { on: ["a"] } },
            { camera: { on: ["a", "b"], tight: 0.6 }, duration: 3000 },
        ]);
        expect(plan.beats[0].duration).toBe(DEFAULT_CAMERA_MS);
        expect(plan.beats[1].duration).toBe(3000);
        expect(plan.beats[1].camera).toEqual({ on: ["a", "b"], tight: 0.6 });
    });

    it("rides along with a move, so one beat can push in on somebody stepping", () => {
        const { plan, problems } = planScene([
            { id: "a", do: "walk", to: { x: 200 }, camera: { on: ["a"], tight: 1.3 } },
        ]);
        expect(problems).toEqual([]);
        expect(plan.beats[0].move).toBe("walk");
        expect(plan.beats[0].camera?.tight).toBe(1.3);
    });

    it("still refuses a beat that does nothing at all", () => {
        const { problems } = planScene([{ id: "a" }]);
        expect(problems).toHaveLength(1);
    });
});

describe("pauses", () => {
    it("is a beat about nobody, needing only its length", () => {
        const { plan, problems } = planScene([{ wait: 2 }]);
        expect(problems).toEqual([]);
        expect(plan.beats).toHaveLength(1);
        expect(plan.beats[0].duration).toBe(2000);
        expect(plan.beats[0].say).toBeNull();
    });

    it("puts a breath between two different people speaking", () => {
        // Lines run back to back sound like a list being read out. The gap is
        // what makes it an exchange, and nobody writing a scene remembers it.
        const { plan } = planScene([
            { id: "a", say: "Where are you going?" },
            { id: "b", say: "To my grandmother's." },
        ]);
        expect(plan.beats).toHaveLength(3);
        expect(plan.beats[1].say).toBeNull();
        expect(plan.beats[1].duration).toBe(BREATH_MS);
    });

    it("does not break up one person carrying on", () => {
        // A pause in the middle of somebody's own speech is a hesitation, which
        // is a thing to write on purpose rather than to be given.
        const { plan } = planScene([
            { id: "a", say: "I was going to say something." },
            { id: "a", say: "But I have forgotten it." },
        ]);
        expect(plan.beats).toHaveLength(2);
    });

    it("caps a pause, so one cannot hold the show", () => {
        expect(planScene([{ wait: 600 }]).plan.beats[0].duration).toBe(10_000);
    });
});

describe("changing costume", () => {
    /**
     * The only way a cut-out does something its drawing does not already do. A
     * bird with folded wings cannot open them; it can become the drawing of a
     * bird with open wings, standing in the same place at the same size.
     */
    it("is a beat in its own right, needing nothing else", () => {
        const { plan, problems } = planScene([{ id: "bird", becomes: "bird-flying" }]);
        expect(problems).toEqual([]);
        expect(plan.beats[0].becomes).toBe("bird-flying");
        expect(plan.beats[0].move).toBeNull();
    });

    it("rides along with a move, so the change happens as they act", () => {
        const { plan } = planScene([
            { id: "bird", becomes: "bird-flying", do: "jump" },
        ]);
        expect(plan.beats[0].becomes).toBe("bird-flying");
        expect(plan.beats[0].move).toBe("jump");
    });

    it("carries nothing when nobody asked for one", () => {
        const { plan } = planScene([{ id: "a", do: "nod" }]);
        expect(plan.beats[0].becomes).toBeNull();
    });
});
