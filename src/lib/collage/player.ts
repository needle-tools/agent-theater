/**
 * Playing a scene, one beat at a time.
 *
 * The browser does the animating. Each beat becomes a keyframe set handed to
 * the Web Animations API, which runs `transform` and `opacity` on the
 * compositor — so a beat stays smooth while the main thread is busy, and it
 * demonstrably is: tracing an image blocks it for seconds.
 *
 * Sequential throughout. A beat starts when the last one ends, which is a
 * narrowing rather than a limitation: an agent handed a timeline writes a
 * timeline, and then owns the problem of two beats disagreeing about where
 * somebody is. It is also how a play reads — the eye is meant to know where to
 * look.
 *
 * Travel is committed BEFORE its beat plays, and the beat then animates in from
 * behind. The alternative is holding the end state with `fill: forwards` and
 * swapping it for a real position afterwards, and the swap is one frame of
 * flicker every time anybody walks.
 */
import { keyframesFor, type Plan, type PlannedBeat } from "./perform.js";

export interface Stagehand {
    /** The element drawing a layer, if it is on screen. */
    elementFor(id: string): Element | null;
    /** What the layer already is, so a beat builds on it rather than replacing it. */
    stateOf(id: string): { size: number; rotation: number; opacity: number; flip: boolean };
    /** Move a layer for real. Called before a travelling beat animates. */
    commit(id: string, dx: number, dy: number): void;
    /**
     * Mirror a layer for real. Called before a turn animates, for the same
     * reason travel commits first: the document ends up where the beat says,
     * and the animation runs from the old appearance back to it.
     */
    turn(id: string): void;
    /** Put a line above somebody, or take it away. */
    say(id: string, line: string | null, progress: number): void;
    /** True once a layer has left, so it stays gone rather than snapping back. */
    setGone(id: string, gone: boolean): void;
    /** Make a noise. Fired as a beat begins, and not waited for. */
    cue(id: string): void;
    /**
     * Draw one layer in another's place, from now on.
     *
     * A costume change. The position, size and rotation stay with the part
     * rather than the picture, so a bird that becomes a flying bird is in the
     * same spot at the same scale — which is the only way the swap reads as the
     * same character rather than as a cut.
     */
    wear(id: string, becomes: string | null): void;
    /**
     * Move the view to frame these layers over this long.
     *
     * Separate from the moves because the camera is not on the stage: nothing
     * about the scene changes when it moves, and a layer animation cannot
     * express it — the whole world has to slide, not one picture in it.
     */
    camera(ids: string[] | "all", tight: number, duration: number): Promise<void>;
}

export interface Playing {
    /** Resolves when the scene is over, or when it is stopped. */
    finished: Promise<void>;
    stop(): void;
}

/**
 * Bubbles are typed in over the first part of their life, then held to be read.
 *
 * Most of it, so the words appear at something close to the speed they would
 * be spoken, with a beat at the end to finish reading. Typing faster than that
 * is a line that has arrived before the eye has got to it and then sits there
 * fully formed — which reads as a caption rather than as somebody talking.
 */
const TYPING_SHARE = 0.72;
/** How often a bubble redraws while typing. Smooth enough; not a frame loop. */
const TYPING_TICK_MS = 40;

/**
 * Play a plan.
 *
 * Stopping is honoured between beats and mid-beat: a scene that could only be
 * abandoned at a boundary would keep going for a second after the person asked
 * it to stop, which is exactly the moment they will press it again.
 */
export function play(plan: Plan, hand: Stagehand): Playing {
    let stopped = false;
    // Sets, not single slots. One animation and one typing timer was enough
    // when strictly one thing happened at a time; a `with` group runs several
    // at once, and a single slot meant stop() could only cancel the last.
    const animations = new Set<Animation>();
    const typings = new Set<ReturnType<typeof setInterval>>();

    const clear = () => {
        for (const timer of typings) clearInterval(timer);
        typings.clear();
    };

    // Taken off stage before the first beat, and put back by their own
    // entrance. Done synchronously, before anything is awaited, so there is not
    // even one frame in which the whole cast is standing there.
    for (const id of plan.hidden ?? []) hand.setGone(id, true);

    const finished = (async () => {
        for (let at = 0; at < plan.beats.length; at++) {
            if (stopped) break;
            // A beat and everything riding along with it play as one group;
            // the scene moves on when the whole group is done.
            const group = [plan.beats[at]];
            while (at + 1 < plan.beats.length && plan.beats[at + 1].with) {
                group.push(plan.beats[++at]);
            }
            await Promise.all(group.map(beat => playBeat(beat)));
        }
        clear();
    })();

    async function playBeat(beat: PlannedBeat): Promise<void> {
        // Fired first and not awaited, so a sting lands on the movement rather
        // than after it. A beat with only a sound takes no time at all.
        if (beat.sound) hand.cue(beat.sound);
        // Before anything moves, so a beat that both changes costume and acts
        // does the acting in the new one.
        if (beat.becomes) hand.wear(beat.id, beat.becomes);
        // Started before the move so a beat can do both: the camera pushes in
        // while the person it is pushing in on takes their step.
        const framing = beat.camera
            ? hand.camera(beat.camera.on, beat.camera.tight ?? 1, beat.duration)
            : null;
        // The document is told where this ends up first; the animation then
        // runs from minus the journey back to zero. A turn commits its flip the
        // same way, and the frames play out relative to the new facing.
        if (beat.travel) hand.commit(beat.id, beat.travel.dx, beat.travel.dy);
        if (beat.move === "turn") hand.turn(beat.id);

        /*
         * Acting and speaking run together.
         *
         * They used to be either/or: `if (say) return speak(beat)` — which
         * silently dropped the move from every beat that had both. Agents
         * write `{do: "surprised", say: "..."}` constantly, so most of the
         * acting in every play so far was discarded before it reached the
         * stage, and the plays looked exactly as still as that implies.
         */
        const doing: Array<Promise<void>> = [];
        if (beat.move) doing.push(act(beat));
        if (beat.say) doing.push(speak(beat));
        if (doing.length) {
            await Promise.all(doing);
            return;
        }
        // Nothing to act and nothing to say: a camera beat takes the camera's
        // time, a wait takes its own, and anything else is instant.
        if (framing) return framing;
        return wait(beat.duration);
    }

    async function act(beat: PlannedBeat): Promise<void> {
        const element = hand.elementFor(beat.id);
        if (!element || typeof element.animate !== "function") {
            // No element to animate — the layer is off screen or the browser
            // has no Web Animations. The scene still has to take its time, or
            // narration written against it lands early.
            return wait(beat.duration);
        }

        const layer = hand.stateOf(beat.id);
        // act() is only ever queued for beats with a move; the null in the
        // type is the say-only shape of the same interface.
        const frames = keyframesFor(beat.move!, {
            size: layer.size,
            dx: beat.travel?.dx ?? 0,
            dy: beat.travel?.dy ?? 0,
            rotation: layer.rotation,
            opacity: layer.opacity,
            flip: layer.flip,
        });
        hand.setGone(beat.id, false);
        const animation = element.animate(frames, {
            duration: beat.duration, easing: "linear", fill: "none",
        });
        animations.add(animation);
        try {
            await animation.finished;
        } catch {
            // Cancelling an animation rejects. That is a stop, not a fault.
        }
        animations.delete(animation);
        if (!stopped && beat.move === "exit") hand.setGone(beat.id, true);
    }

    async function speak(beat: PlannedBeat): Promise<void> {
        const line = beat.say!;
        const started = performance.now();
        hand.say(beat.id, line, 0);
        // A timer rather than an animation: the bubble is text being revealed,
        // not a transform, so there is nothing for the compositor to do.
        await new Promise<void>(resolve => {
            const timer = setInterval(() => {
                const elapsed = performance.now() - started;
                if (stopped || elapsed >= beat.duration) {
                    clearInterval(timer);
                    typings.delete(timer);
                    resolve();
                    return;
                }
                hand.say(beat.id, line, Math.min(1, elapsed / beat.duration / TYPING_SHARE));
            }, TYPING_TICK_MS);
            typings.add(timer);
        });
        hand.say(beat.id, null, 0);
    }

    function wait(ms: number): Promise<void> {
        return new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            // Stopping must not leave the scene waiting out a beat nobody can
            // see, so the check runs alongside rather than after.
            const poll = setInterval(() => {
                if (!stopped) return;
                clearTimeout(timer);
                clearInterval(poll);
                resolve();
            }, 60);
            setTimeout(() => clearInterval(poll), ms + 100);
        });
    }

    return {
        finished,
        stop() {
            stopped = true;
            clear();
            for (const animation of [...animations]) animation.cancel();
            animations.clear();
        },
    };
}
