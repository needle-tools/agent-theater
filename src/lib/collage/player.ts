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
import { keyframesFor, rideKeyframes, type MoveName, type Plan, type PlannedBeat } from "./perform.js";

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
    /**
     * Say a line aloud and hold its bubble for as long as the saying takes.
     *
     * The player hands the whole line over rather than driving the bubble
     * itself, because the clock a spoken line runs on is not the scene's — it
     * belongs to the one queue that every bubble on the page shares, and only
     * that queue knows whether somebody else is still talking. `ms` is the
     * planned length, used when there is no voice for the line.
     *
     * Resolves when the line is finished or has been cut off.
     */
    voice(id: string, line: string, ms: number): Promise<void>;
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
     * Perform a recorded clip. The player cannot build these frames itself —
     * clips live in the browser's storage, which this module deliberately
     * knows nothing about.
     */
    gesture(id: string, clip: string, duration: number): Promise<void>;
    /** Animate an object into this holder's hand, then attach it. */
    take(holder: string, item: string, duration: number): Promise<void>;
    /** Detach a held object and let it fall where it is. */
    drop(holder: string, item: string, duration: number): Promise<void>;
    /** Who is attached to this cast member right now. */
    riders(id: string): string[];
    /** Throw a canned particle effect over this cast member. */
    effect(id: string, name: string, duration: number): Promise<void>;
    /**
     * Keep a traveller in frame: pan the camera along with a walk or jump
     * when its destination would leave the screen. Optional — a page without
     * a camera simply lets them go.
     */
    follow?(id: string, dx: number, dy: number, duration: number): void;
    /**
     * Fade the paper to a colour — a beat's weather change. "paper" is the
     * house colour. Optional: a page without a canvas has no paper.
     */
    paper?(color: string): void;
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
 * Play a plan.
 *
 * Stopping is honoured between beats and mid-beat: a scene that could only be
 * abandoned at a boundary would keep going for a second after the person asked
 * it to stop, which is exactly the moment they will press it again.
 */
export function play(plan: Plan, hand: Stagehand): Playing {
    let stopped = false;
    // A set, not a single slot. One animation was enough when strictly one
    // thing happened at a time; a `with` group runs several at once, and a
    // single slot meant stop() could only cancel the last.
    const animations = new Set<Animation>();

    // Taken off stage before the first beat, and put back by their own
    // entrance. Done synchronously, before anything is awaited, so there is not
    // even one frame in which the whole cast is standing there.
    // Present first, hidden second: an arrival is in both lists — on stage for
    // this chapter, but not until their own entrance plays.
    for (const id of plan.present ?? []) hand.setGone(id, false);
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
        // The weather turns as the beat starts; the fade runs on its own
        // clock, so it costs the beat nothing.
        if (beat.background) hand.paper?.(beat.background);

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
        if (beat.take) doing.push(hand.take(beat.id, beat.take, beat.duration));
        if (beat.drop) doing.push(hand.drop(beat.id, beat.drop, beat.duration));
        if (beat.effect) doing.push(hand.effect(beat.id, beat.effect, beat.duration));
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
        // A recorded move is somebody's hand, replayed; the pose mathematics
        // below is only for the built-ins.
        if (beat.move!.startsWith("clip:")) {
            return hand.gesture(beat.id, beat.move!.slice(5), beat.duration);
        }
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
        // Narrowed by hand: the clip branch above returned, so what is left
        // is a built-in the type system lost track of at the startsWith.
        const frames = keyframesFor(beat.move as MoveName, {
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

        // A traveller who would walk out of the frame takes the camera with
        // them — the follow is the world-canvas's tracking shot, and the hand
        // decides whether it is needed at all.
        if (beat.travel && (beat.travel.dx || beat.travel.dy)) {
            hand.follow?.(beat.id, beat.travel.dx, beat.travel.dy, beat.duration);
        }

        /*
         * Whatever this one is holding rides along: the same translation, the
         * rider's own facing, none of the squash — a held cut-out is a rigid
         * prop in a hand, and deforming it with its carrier looks like jelly.
         */
        for (const riderId of hand.riders(beat.id)) {
            const riderElement = hand.elementFor(riderId);
            if (!riderElement || typeof riderElement.animate !== "function") continue;
            const rider = hand.stateOf(riderId);
            animations.add(riderElement.animate(
                rideKeyframes(beat.move as MoveName, {
                    size: layer.size,
                    dx: beat.travel?.dx ?? 0,
                    dy: beat.travel?.dy ?? 0,
                }, rider),
                { duration: beat.duration, easing: "linear", fill: "none" }));
        }

        try {
            await animation.finished;
        } catch {
            // Cancelling an animation rejects. That is a stop, not a fault.
        }
        animations.delete(animation);
        if (!stopped && beat.move === "exit") hand.setGone(beat.id, true);
    }

    /**
     * Hand the line to the prompter and wait for it to be finished with.
     *
     * Nothing here about typing or timing any more. A line that took its length
     * from the beat could be revealed while the previous character's voice was
     * still going — the plan sequences beats, but only the prompter sequences
     * *sound*, and two `with` beats are simultaneous by design.
     */
    async function speak(beat: PlannedBeat): Promise<void> {
        await hand.voice(beat.id, beat.say!, beat.duration);
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
            for (const animation of [...animations]) animation.cancel();
            animations.clear();
            // Anything still being said is NOT cancelled here, because the
            // prompter is not the scene's to cancel — the page shares it.
            // Whoever stops the scene hushes it, in the same breath.
        },
    };
}
