/**
 * Acting: a score the canvas performs, rather than frames an agent sends.
 *
 * The constraint that shapes all of this is that an agent cannot animate. A
 * tool call is a round trip of hundreds of milliseconds and a walk cycle is
 * sixty frames a second, so anything driven call-by-call is a slideshow. What
 * an agent CAN do is say what happens and when — and that is a score. It hands
 * over the whole sequence, the page plays it on its own clock, and the agent is
 * free to narrate over the top instead of babysitting a tween.
 *
 * The second decision is that a performance is **presentational**. Every beat
 * here produces an offset applied on top of a layer's real position; none of it
 * touches the document. A three-second walk would otherwise write a hundred and
 * eighty mutations through undo and into IndexedDB, and undoing it afterwards
 * would step back through the animation frame by frame. A move that is meant to
 * stick commits once, at the end, as a single edit.
 *
 * Everything in this file is arithmetic on a normalised time, so the whole
 * vocabulary can be asserted on in a test — what a jump does at its apex, that
 * a shake is centred, that every beat ends where it started.
 */

/** What a beat does to a layer at one instant, on top of where the layer is. */
export interface Pose {
    /** Canvas units, added to the layer's position. */
    dx: number;
    dy: number;
    /** Degrees, added to the layer's own rotation. */
    rotate: number;
    /** Multipliers about the layer's centre. */
    scaleX: number;
    scaleY: number;
    /** Multiplier on the layer's own opacity. */
    opacity: number;
}

export const AT_REST: Pose = { dx: 0, dy: 0, rotate: 0, scaleX: 1, scaleY: 1, opacity: 1 };

export const MOVES = [
    "walk", "jump", "shake", "surprised", "scared", "nod", "enter", "exit",
] as const;
export type MoveName = (typeof MOVES)[number];

/** How long each reads as, before anything overrides it. */
export const DEFAULT_DURATION: Record<MoveName, number> = {
    walk: 1600,
    jump: 700,
    shake: 800,
    surprised: 900,
    scared: 1400,
    nod: 600,
    enter: 900,
    exit: 900,
};

export interface MoveContext {
    /** The layer's height, so motion is proportional rather than absolute. */
    size: number;
    /** Distance still to travel, for the moves that go somewhere. */
    dx: number;
    dy: number;
    /**
     * What the layer already is, for the keyframes to build on.
     *
     * The Web Animations API *replaces* the property it animates, so a beat
     * that wrote only its own rotation would snap a tilted layer upright for
     * the length of the beat and back again afterwards. Same for opacity. The
     * layer's own values have to be part of every frame.
     */
    rotation?: number;
    opacity?: number;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** Ease that starts and stops gently — the default shape of a deliberate move. */
const smooth = (t: number) => t * t * (3 - 2 * t);
/** One rise and fall, peaking in the middle. Used wherever a beat must return. */
const arc = (t: number) => Math.sin(Math.PI * clamp01(t));

/**
 * The vocabulary.
 *
 * Every one of these returns to rest at t = 1 except `walk`, which arrives, and
 * `exit`, which leaves. That rule is what lets beats be layered and interrupted
 * without a layer slowly drifting away from where the document says it is.
 */
export function poseFor(move: MoveName, t: number, context: MoveContext): Pose {
    const time = clamp01(t);
    const { size, dx, dy } = context;
    switch (move) {
        case "walk": {
            const travelled = smooth(time);
            // Bobbing and a slight lean, at a rate independent of the distance,
            // so a long walk is more steps rather than bigger ones.
            const steps = 4;
            const bob = Math.abs(Math.sin(Math.PI * steps * time));
            return {
                dx: dx * travelled,
                dy: dy * travelled - bob * size * 0.035,
                rotate: Math.sin(Math.PI * 2 * steps * time) * 2.2,
                scaleX: 1,
                scaleY: 1 + bob * 0.02,
                opacity: 1,
            };
        }
        case "jump": {
            const height = arc(time) * size * 0.45;
            // Crouch, spring, land, recover. Each squash rises and falls inside
            // its own window rather than starting at full strength — a jump
            // that begins already squashed pops on its first frame, which is
            // the opposite of anticipation.
            const crouch = time < 0.18 ? arc(time / 0.18) : 0;
            const landing = time > 0.82 ? arc((time - 0.82) / 0.18) : 0;
            const squash = Math.max(crouch, landing);
            const stretch = arc(time) * 0.08;
            return {
                dx: dx * smooth(time),
                dy: dy * smooth(time) - height,
                rotate: 0,
                scaleX: 1 + squash * 0.12 - stretch * 0.5,
                scaleY: 1 - squash * 0.14 + stretch,
                opacity: 1,
            };
        }
        case "shake": {
            // Fast, and dying away — a shake that ends at full strength reads as
            // a cut rather than as a shake.
            const decay = 1 - time;
            return {
                ...AT_REST,
                dx: Math.sin(time * Math.PI * 14) * size * 0.045 * decay,
                rotate: Math.sin(time * Math.PI * 14) * 2.5 * decay,
            };
        }
        case "surprised": {
            // A jolt up and a snap back: fast out, slow settle.
            const jolt = time < 0.25 ? time / 0.25 : Math.pow(1 - (time - 0.25) / 0.75, 2);
            return {
                ...AT_REST,
                dy: -jolt * size * 0.12,
                scaleX: 1 + jolt * 0.06,
                scaleY: 1 + jolt * 0.14,
                rotate: Math.sin(time * Math.PI * 6) * 1.5 * (1 - time),
            };
        }
        case "scared": {
            // Shrinking away, leaning back, trembling — small and fast, where
            // surprise is big and slow.
            const cower = arc(time);
            return {
                dx: -cower * size * 0.05 + Math.sin(time * Math.PI * 22) * size * 0.012 * cower,
                dy: cower * size * 0.02,
                rotate: -cower * 7,
                scaleX: 1 - cower * 0.06,
                scaleY: 1 - cower * 0.08,
                opacity: 1,
            };
        }
        case "nod": {
            return { ...AT_REST, dy: -arc(time) * size * 0.05, rotate: arc(time) * 3 };
        }
        case "enter": {
            const in_ = smooth(time);
            return {
                ...AT_REST,
                dy: (1 - in_) * size * 0.4,
                scaleX: 0.9 + in_ * 0.1,
                scaleY: 0.9 + in_ * 0.1,
                opacity: in_,
            };
        }
        case "exit": {
            const out = smooth(time);
            return {
                ...AT_REST,
                dy: out * size * 0.35,
                scaleX: 1 - out * 0.12,
                scaleY: 1 - out * 0.12,
                opacity: 1 - out,
            };
        }
    }
}

/** Beats that leave the layer somewhere new, so the move is committed at the end. */
export const TRAVELS: ReadonlySet<MoveName> = new Set<MoveName>(["walk", "jump"]);
/** Beats after which the layer should be hidden rather than snapped back. */
export const LEAVES: ReadonlySet<MoveName> = new Set<MoveName>(["exit"]);

// ── The score ───────────────────────────────────────────────────────────────

/** One instruction, as an agent writes it. */
export interface Cue {
    /** Milliseconds from the start of the performance. Defaults to following on. */
    at?: number;
    /** Which layer. */
    id: string;
    /** What it does. */
    do?: MoveName;
    /** Where it ends up, for the moves that go somewhere. Canvas units. */
    to?: { x?: number; y?: number };
    /** What it says, in a bubble above it. */
    say?: string;
    /** Override the beat's own length, in milliseconds. */
    duration?: number;
}

/** A cue with its timing resolved, ready to be played. */
export interface ScoredCue {
    id: string;
    move: MoveName | null;
    say: string | null;
    start: number;
    end: number;
    to: { x?: number; y?: number } | null;
}

export interface Score {
    cues: ScoredCue[];
    /** When the last thing finishes. */
    duration: number;
}

/** How long a bubble stays up: long enough to read, scaled to its length. */
export function readingTime(text: string): number {
    return Math.min(6000, Math.max(1400, 400 + text.length * 55));
}

/** The longest performance that will be accepted, so nothing runs away. */
export const MAX_PERFORMANCE_MS = 120_000;
export const MAX_CUES = 80;

export interface ScoreProblem {
    index: number;
    reason: string;
}

/**
 * Turn cues into a timed score.
 *
 * `at` is optional and defaults to "after whatever this layer was last doing",
 * which is how a scene is usually written: this one walks in, *then* speaks,
 * *then* the other one reacts. Making every cue carry an absolute time turns
 * writing a scene into doing arithmetic, and arithmetic an agent cannot check
 * is exactly what this API tries to avoid everywhere else.
 */
export function score(cues: Cue[]): { score: Score; problems: ScoreProblem[] } {
    const problems: ScoreProblem[] = [];
    const scored: ScoredCue[] = [];
    /** When each layer is next free, for cues that do not name a time. */
    const freeAt = new Map<string, number>();

    for (const [index, cue] of cues.entries()) {
        const id = typeof cue?.id === "string" ? cue.id.trim() : "";
        if (!id) {
            problems.push({ index, reason: `every cue needs an "id" naming the layer it acts on` });
            continue;
        }
        const move = cue?.do ?? null;
        if (move && !MOVES.includes(move)) {
            problems.push({ index, reason: `"${move}" is not a move. Use one of: ${MOVES.join(", ")}` });
            continue;
        }
        const say = typeof cue?.say === "string" && cue.say.trim() ? cue.say.trim() : null;
        if (!move && !say) {
            problems.push({ index, reason: `a cue must have a "do" or a "say"` });
            continue;
        }

        const length = Math.min(30_000, Math.max(120,
            typeof cue?.duration === "number" && cue.duration > 0
                ? cue.duration
                : move
                    ? DEFAULT_DURATION[move]
                    : readingTime(say!)));

        const start = Math.max(0, typeof cue?.at === "number" ? cue.at : freeAt.get(id) ?? 0);
        const end = start + length;
        // A layer can move and speak at once, so speech does not hold up the
        // next move — it is the moves that queue.
        if (move) freeAt.set(id, end);
        else freeAt.set(id, Math.max(freeAt.get(id) ?? 0, start));

        scored.push({
            id,
            move,
            say,
            start,
            end,
            to: cue?.to && (typeof cue.to.x === "number" || typeof cue.to.y === "number")
                ? { ...(typeof cue.to.x === "number" ? { x: cue.to.x } : {}),
                    ...(typeof cue.to.y === "number" ? { y: cue.to.y } : {}) }
                : null,
        });
    }

    const duration = scored.reduce((longest, cue) => Math.max(longest, cue.end), 0);
    if (duration > MAX_PERFORMANCE_MS) {
        problems.push({
            index: -1,
            reason: `the whole thing runs ${Math.round(duration / 1000)}s, longer than the ` +
                `${MAX_PERFORMANCE_MS / 1000}s limit. Split it and play the next part when this one ends.`,
        });
    }
    return { score: { cues: scored, duration }, problems };
}

/** What is on screen for one layer at one moment. */
export interface Playing {
    pose: Pose;
    say: string | null;
    /** 0–1 through the bubble's life, for typing the words in. */
    saying: number;
    /** True once an `exit` has finished, so the layer stays gone. */
    gone: boolean;
}

/**
 * The state of the whole cast at a moment.
 *
 * Poses compose rather than replace: a layer that is walking and surprised at
 * the same time does both, because the alternative is deciding which one wins
 * and being wrong. Offsets add, scales multiply.
 */
export function stateAt(
    score: Score,
    time: number,
    sizeOf: (id: string) => number,
): Map<string, Playing> {
    const state = new Map<string, Playing>();
    const at = (id: string): Playing => {
        let playing = state.get(id);
        if (!playing) {
            playing = { pose: { ...AT_REST }, say: null, saying: 0, gone: false };
            state.set(id, playing);
        }
        return playing;
    };

    for (const cue of score.cues) {
        if (time < cue.start) continue;
        const done = time >= cue.end;
        const t = done ? 1 : (time - cue.start) / Math.max(1, cue.end - cue.start);

        if (cue.say) {
            if (!done) {
                const playing = at(cue.id);
                playing.say = cue.say;
                playing.saying = t;
            }
            continue;
        }
        if (!cue.move) continue;

        const playing = at(cue.id);
        if (done) {
            // A finished beat leaves nothing behind, except a departure.
            if (LEAVES.has(cue.move)) playing.gone = true;
            continue;
        }
        const size = Math.max(1, sizeOf(cue.id));
        const travel = cue.to ?? {};
        const pose = poseFor(cue.move, t, {
            size,
            dx: typeof travel.x === "number" ? travel.x : 0,
            dy: typeof travel.y === "number" ? travel.y : 0,
        });
        playing.pose = compose(playing.pose, pose);
        playing.gone = false;
    }
    return state;
}

/** Two poses at once. Offsets add, scales multiply — neither one wins. */
export function compose(a: Pose, b: Pose): Pose {
    return {
        dx: a.dx + b.dx,
        dy: a.dy + b.dy,
        rotate: a.rotate + b.rotate,
        scaleX: a.scaleX * b.scaleX,
        scaleY: a.scaleY * b.scaleY,
        opacity: a.opacity * b.opacity,
    };
}

/**
 * Where each travelling beat leaves its layer.
 *
 * Applied to the document once, when the performance ends, so a walk that
 * crossed the stage is still across the stage afterwards — and undoing it is
 * one step rather than a hundred and eighty.
 */
export function restingPlaces(score: Score): Map<string, { dx: number; dy: number }> {
    const moved = new Map<string, { dx: number; dy: number }>();
    for (const cue of score.cues) {
        if (!cue.move || !cue.to || !TRAVELS.has(cue.move)) continue;
        const so_far = moved.get(cue.id) ?? { dx: 0, dy: 0 };
        moved.set(cue.id, {
            dx: so_far.dx + (cue.to.x ?? 0),
            dy: so_far.dy + (cue.to.y ?? 0),
        });
    }
    return moved;
}

// ── Keyframes ───────────────────────────────────────────────────────────────

/**
 * A beat as the browser wants it.
 *
 * The pose functions above stay the definition of what each move *means* —
 * they are tuned, and every invariant worth having is asserted on them. This
 * turns one into keyframes by sampling it, so playback moves to the Web
 * Animations API without the vocabulary changing at all.
 *
 * Why hand it to the browser: `transform` and `opacity` animate on the
 * compositor, so a beat stays smooth while the main thread is busy. It
 * demonstrably is — tracing an image blocks it for seconds — and a scene that
 * stutters whenever something else happens is not a scene.
 */
export interface Keyframe {
    offset: number;
    transform: string;
    opacity: number;
    /** The DOM's own keyframe type is indexed; this keeps ours assignable. */
    [property: string]: string | number | undefined;
}

/** How finely a pose is sampled. Enough for the browser to interpolate between. */
const SAMPLES = 30;

/**
 * Keyframes for one beat, ending where the layer already is.
 *
 * Travelling moves are written *backwards*: the document is updated to the
 * destination first, and the animation runs from minus the journey to zero. It
 * comes to the same thing on screen and avoids the alternative, which is
 * holding the end state with `fill: forwards` and then swapping it for a real
 * position — one frame of which is a flicker, every time anybody walks.
 */
export function keyframesFor(move: MoveName, context: MoveContext, samples = SAMPLES): Keyframe[] {
    const frames: Keyframe[] = [];
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const pose = poseFor(move, t, context);
        const dx = pose.dx - context.dx;
        const dy = pose.dy - context.dy;
        frames.push({
            offset: t,
            transform:
                `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) ` +
                `rotate(${(pose.rotate + (context.rotation ?? 0)).toFixed(2)}deg) ` +
                `scale(${pose.scaleX.toFixed(4)}, ${pose.scaleY.toFixed(4)})`,
            opacity: pose.opacity * (context.opacity ?? 1),
        });
    }
    return frames;
}

/** One thing that happens, in a scene where things happen one at a time. */
export interface Beat {
    id: string;
    do?: MoveName;
    say?: string;
    to?: { x?: number; y?: number };
    duration?: number;
}

export interface PlannedBeat {
    id: string;
    move: MoveName | null;
    say: string | null;
    /** Where this beat leaves the layer, relative to where it started. */
    travel: { dx: number; dy: number } | null;
    duration: number;
}

export interface Plan {
    beats: PlannedBeat[];
    /** End to end, since nothing overlaps. */
    duration: number;
}

/**
 * Turn a script into a plan.
 *
 * Sequential, with no timing arithmetic anywhere: a beat starts when the last
 * one ends. That was a deliberate narrowing — an agent given a timeline writes
 * a timeline, and then owns the problem of two beats disagreeing about who is
 * where. One thing at a time is also how a play reads: the eye is meant to know
 * where to look.
 */
export function plan(beats: Beat[]): { plan: Plan; problems: ScoreProblem[] } {
    const problems: ScoreProblem[] = [];
    const planned: PlannedBeat[] = [];

    for (const [index, beat] of beats.entries()) {
        const id = typeof beat?.id === "string" ? beat.id.trim() : "";
        if (!id) {
            problems.push({ index, reason: `every beat needs an "id" naming who it is about` });
            continue;
        }
        const move = beat?.do ?? null;
        if (move && !MOVES.includes(move)) {
            problems.push({ index, reason: `"${move}" is not a move. Use one of: ${MOVES.join(", ")}` });
            continue;
        }
        const say = typeof beat?.say === "string" && beat.say.trim() ? beat.say.trim() : null;
        if (!move && !say) {
            problems.push({ index, reason: `a beat must have a "do" or a "say"` });
            continue;
        }

        const duration = Math.min(30_000, Math.max(120,
            typeof beat?.duration === "number" && beat.duration > 0
                ? beat.duration
                : move ? DEFAULT_DURATION[move] : readingTime(say!)));

        const travel = move && TRAVELS.has(move) && beat?.to
            ? { dx: typeof beat.to.x === "number" ? beat.to.x : 0,
                dy: typeof beat.to.y === "number" ? beat.to.y : 0 }
            : null;

        planned.push({ id, move, say, travel, duration });
    }

    const duration = planned.reduce((total, beat) => total + beat.duration, 0);
    if (duration > MAX_PERFORMANCE_MS) {
        problems.push({
            index: -1,
            reason: `the scene runs ${Math.round(duration / 1000)}s, longer than the ` +
                `${MAX_PERFORMANCE_MS / 1000}s limit. Split it across scenes.`,
        });
    }
    return { plan: { beats: planned, duration }, problems };
}
