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
// The one import, and it is as pure as this file: the effect catalogue is
// data and arithmetic, needed only for how long a solo effect beat lasts.
import { findEffect } from "./effects.js";

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
    "walk", "jump", "shake", "surprised", "scared", "nod", "bow", "turn", "enter", "exit",
] as const;
export type MoveName = (typeof MOVES)[number];

/**
 * How long a camera move takes when nobody says.
 *
 * Slow enough to read as a camera rather than a cut. An agent that wants a
 * snap or a long drift sets `duration` — that control is the whole point of
 * making the camera a beat instead of something that happens automatically.
 */
export const DEFAULT_CAMERA_MS = 1800;

/**
 * A breath between one person finishing and the next one starting.
 *
 * Added automatically, because nobody writing a scene remembers to write it and
 * every scene needs it: lines run back to back sound like a list being read
 * out, where the gap is what makes it an exchange. Only between DIFFERENT
 * speakers — somebody carrying on after their own line is one person talking,
 * and a pause there is a hesitation, which is a thing to write on purpose.
 *
 * Short. It is a breath, not a silence, and an agent that wants a real pause
 * has `wait` for it.
 */
export const BREATH_MS = 700;

/**
 * Reaching for a thing, and letting one go. The reach is quicker than the
 * fall: picking up is intent, dropping is gravity, and gravity takes a moment
 * to finish bouncing.
 */
export const TAKE_MS = 450;
export const DROP_MS = 650;

/** How long each reads as, before anything overrides it. */
/**
 * How long each reads as, before anything overrides it.
 *
 * Unhurried. A play is watched, not scrubbed through, and every one of these
 * was originally set by looking at the move on its own — where it looked right
 * — rather than in a scene, where the whole thing went past like a slideshow on
 * fast forward. An agent that wants a snap still sets `duration`.
 */
export const DEFAULT_DURATION: Record<MoveName, number> = {
    walk: 2400,
    jump: 1000,
    shake: 1100,
    surprised: 1300,
    scared: 1900,
    nod: 900,
    bow: 1600,
    turn: 800,
    // Brisk, unlike the rest. An entrance is not the scene, it is the moment
    // before it — and the build-up plays them one after another, so four
    // characters arriving at a considered pace is five seconds of nothing
    // happening before the first line. The slow numbers below are for acting;
    // these two are stagecraft.
    enter: 650,
    exit: 650,
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
    /**
     * Whether the layer is mirrored. Baked into every frame for the same
     * reason rotation is: the animation replaces the transform outright, so a
     * flipped character animated without it would snap the right way round for
     * the length of the beat.
     */
    flip?: boolean;
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
        case "turn": {
            /*
             * A paper cut-out turning around: edge-on at the middle, like a
             * card flipped between two fingers, with a small lift as it goes.
             *
             * The flip itself is committed to the document before this plays,
             * the same way a walk's travel is — so these frames run relative to
             * the FINAL facing. -cos starts at -1 (how they looked before) and
             * ends at +1 (how they look now), passing through zero, which is
             * the moment the paper is side-on to the audience.
             */
            const spin = smooth(time);
            return {
                ...AT_REST,
                scaleX: -Math.cos(Math.PI * spin),
                scaleY: 1 - arc(time) * 0.05,
                dy: -arc(time) * size * 0.03,
            };
        }
        case "bow": {
            // Down from the waist and back up, held a moment at the bottom.
            // A picture has no waist, so the bend is faked the way a puppet
            // does it: pivot forward, squash a little, and drop by less than
            // the rotation would imply — the feet stay on the floor.
            const down = time < 0.35 ? smooth(time / 0.35)
                : time < 0.65 ? 1
                    : 1 - smooth((time - 0.65) / 0.35);
            return {
                ...AT_REST,
                dy: down * size * 0.06,
                rotate: down * 16,
                scaleY: 1 - down * 0.1,
                scaleX: 1 + down * 0.03,
            };
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
    do?: MoveName | (string & {});
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
    /** A built-in move, or "clip:<name>" routed to the gesture hand. */
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
    // Much slower than reading speed, on purpose and after watching people try
    // to read it. The line is revealed a character at a time while the scene
    // moves under it, and it vanishes the moment the beat ends — so it needs
    // long enough to arrive, THEN long enough to be read, and the first number
    // that felt generous while writing it felt like a flashcard on screen.
    return Math.min(14_000, Math.max(3200, 900 + text.length * 105));
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
        // The older cue system knows only the built-ins; clips arrived with
        // plan() and never grew backwards into this path.
        const move = MOVES.includes(cue?.do as MoveName) ? (cue!.do as MoveName) : null;
        if (cue?.do && !move) {
            problems.push({ index, reason: `"${cue.do}" is not a move. Use one of: ${MOVES.join(", ")}` });
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
    const facing = context.flip ? -1 : 1;
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
                `scale(${(pose.scaleX * facing).toFixed(4)}, ${pose.scaleY.toFixed(4)})`,
            opacity: pose.opacity * (context.opacity ?? 1),
        });
    }
    return frames;
}

/**
 * The frames a HELD thing plays while its holder acts.
 *
 * Only the translation: the basket goes where the hand goes, but it does not
 * squash when the holder jumps or lean when they walk — a held cut-out is a
 * rigid prop, and deforming it with its carrier looks like jelly. The rider's
 * own rotation and facing are baked in for the same reason the holder's are:
 * the animation replaces the transform outright.
 */
export function rideKeyframes(
    move: MoveName,
    context: MoveContext,
    rider: { rotation?: number; flip?: boolean; opacity?: number },
    samples = SAMPLES,
): Keyframe[] {
    const frames: Keyframe[] = [];
    const facing = rider.flip ? -1 : 1;
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const pose = poseFor(move, t, context);
        const dx = pose.dx - context.dx;
        const dy = pose.dy - context.dy;
        frames.push({
            offset: t,
            transform:
                `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) ` +
                `rotate(${(rider.rotation ?? 0).toFixed(2)}deg) ` +
                `scale(${facing}, 1)`,
            // The rider keeps its own opacity throughout: fading is the
            // holder's beat, not the basket's.
            opacity: rider.opacity ?? 1,
        });
    }
    return frames;
}

/** One thing that happens, in a scene where things happen one at a time. */
/**
 * Where the camera looks.
 *
 * Named pieces rather than coordinates, for the same reason arrange takes a
 * word: an agent asked for a viewport rectangle is doing arithmetic it cannot
 * check, and it cannot see the result until it asks for a picture. "Look at
 * these two" is a thing it actually knows.
 */
export interface CameraMove {
    /** Frame these pieces, or "all" for the whole scene. */
    on: string[] | "all";
    /**
     * How much of the view they fill. 1 is snug; 0.6 leaves room around them.
     * Below 1 pulls back, above 1 pushes in past the edges.
     */
    tight?: number;
}

export interface Beat {
    id?: string;
    /**
     * Do nothing, for this long. Seconds.
     *
     * A scene made only of lines runs them back to back, and back to back is
     * not how anybody talks: the pause after a line is where it lands, and the
     * pause before an answer is where the answer is being thought of. There was
     * no way to write one — every beat had to be somebody doing something.
     */
    wait?: number;
    /** What they do — a built-in move, or "clip:<name>" for a recorded one. */
    do?: MoveName | (string & {});
    say?: string;
    /** A noise, fired as the beat starts. Rides along with whatever else it does. */
    sound?: string;
    /** Move the view rather than anybody in it. */
    camera?: CameraMove;
    /**
     * Run this beat AT THE SAME TIME as the one before it.
     *
     * Bounded simultaneity, not a timeline: a beat either follows the previous
     * one or rides along with it, and that is the whole system. It exists
     * because reaction is what scenes are made of — B recoils WHILE A shouts —
     * and a strictly sequential scene reads as a slideshow. Full overlapping
     * timelines were rejected on purpose; this buys most of their value at
     * almost none of their cost.
     */
    with?: boolean;
    /**
     * Pick something up: the id of a cast member this one starts holding.
     * The object animates into the hand and then belongs to the holder —
     * they move as one until a `drop`.
     */
    take?: string;
    /** Put something down where it is: the id of a held cast member. */
    drop?: string;
    /**
     * A canned particle effect played over this character as the beat runs:
     * paper stars, a poof of dust, confetti, hearts, rain. Rides along with
     * a move or a line; alone it takes its own moment.
     */
    effect?: string;
    /**
     * Swap this character's picture for another one, at this beat.
     *
     * A costume change, and the only way a cut-out can do anything its drawing
     * does not already do: a bird with its wings folded cannot open them, but
     * it can become the drawing of a bird with its wings open, standing in the
     * same place at the same size. Ask for both on the same sheet and they will
     * match.
     */
    becomes?: string;
    to?: { x?: number; y?: number };
    duration?: number;
}

export interface PlannedBeat {
    id: string;
    /** Runs alongside the previous beat instead of after it. */
    with: boolean;
    // `move` may also be "clip:<name>"; the player routes those to the
    // gesture hand instead of the pose mathematics.
    /** Another layer to draw in this one's place from here on. */
    becomes: string | null;
    /** A cast member this one picks up as the beat starts. */
    take: string | null;
    /** A held cast member this one lets go of. */
    drop: string | null;
    /** A canned particle effect played over this character. */
    effect: string | null;
    /** A built-in move, or "clip:<name>" routed to the gesture hand. */
    move: MoveName | (string & {}) | null;
    say: string | null;
    sound: string | null;
    camera: CameraMove | null;
    /** Where this beat leaves the layer, relative to where it started. */
    travel: { dx: number; dy: number } | null;
    duration: number;
}

export interface Plan {
    beats: PlannedBeat[];
    /** End to end. Beats marked `with` overlap their predecessor and count once. */
    duration: number;
    /**
     * Who is not on stage yet when the scene begins.
     *
     * Beats run one after another, so somebody whose entrance is the third beat
     * would otherwise stand in full view through the first two and then fade
     * in — which looks like a glitch, because it is one. Hidden here and
     * revealed by their own entrance, which the player does as it starts.
     */
    hidden?: string[];
}

/**
 * Where a line's real length comes from, when somebody is going to speak it.
 *
 * Reading time is a guess — a good one, but a guess about an eye rather than a
 * measurement of a mouth. The lightweight voice has a deterministic timing
 * plan, so the timetable can use that same plan before playback and fall back
 * to reading time only for silent parts.
 */
export interface Timings {
    /** Milliseconds this line takes aloud, or null if it will not be spoken. */
    saying(text: string, id: string): number | null;
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
export function plan(beats: Beat[], timings?: Timings): { plan: Plan; problems: ScoreProblem[] } {
    const problems: ScoreProblem[] = [];
    const planned: PlannedBeat[] = [];
    /** Who spoke last, so a change of speaker can be given room. */
    let lastSpeaker: string | null = null;

    for (const [index, beat] of beats.entries()) {
        const camera = beat?.camera && (Array.isArray(beat.camera.on) || beat.camera.on === "all")
            ? { on: beat.camera.on, ...(typeof beat.camera.tight === "number" ? { tight: beat.camera.tight } : {}) }
            : null;
        // A pause is a beat about nobody, like a camera move. It needs no id
        // and it is the one beat whose whole content is its length.
        const wait = typeof beat?.wait === "number" && beat.wait > 0
            ? Math.min(10_000, beat.wait * 1000)
            : null;
        const id = typeof beat?.id === "string" ? beat.id.trim() : "";
        // A camera beat is about the view, and a pause is about nothing at all,
        // so neither needs somebody to be about.
        if (!id && !camera && !wait) {
            problems.push({ index, reason: `every beat needs an "id" naming who it is about` });
            continue;
        }
        const move = beat?.do ?? null;
        // "clip:<name>" is a recorded move. Whether the recording exists is a
        // browser question the tool layer answers; the plan only carries it.
        const isClip = typeof move === "string" && move.startsWith("clip:");
        if (move && !isClip && !MOVES.includes(move as MoveName)) {
            problems.push({ index, reason: `"${move}" is not a move. Use one of: ${MOVES.join(", ")}` });
            continue;
        }
        const say = typeof beat?.say === "string" && beat.say.trim() ? beat.say.trim() : null;
        const sound = typeof beat?.sound === "string" && beat.sound.trim() ? beat.sound.trim() : null;
        const becomes = typeof beat?.becomes === "string" && beat.becomes.trim()
            ? beat.becomes.trim()
            : null;
        const take = typeof beat?.take === "string" && beat.take.trim() ? beat.take.trim() : null;
        const drop = typeof beat?.drop === "string" && beat.drop.trim() ? beat.drop.trim() : null;
        // Whether the effect EXISTS is the tool layer's question, like clips.
        const effect = typeof beat?.effect === "string" && beat.effect.trim()
            ? beat.effect.trim()
            : null;
        // Same string-boolean lesson as `rehearse`: agents send "true". The
        // first beat has nothing to ride along with, so it can never be `with`.
        const together = planned.length > 0 &&
            (beat?.with === true || String(beat?.with ?? "").trim().toLowerCase() === "true");
        if (!move && !say && !sound && !camera && !wait && !becomes && !take && !drop && !effect) {
            problems.push({
                index,
                reason:
                    `a beat must have a "do", a "say", a "sound", a "camera", a "wait", a "becomes", a "take", a "drop" or an "effect"`,
            });
            continue;
        }

        const duration = Math.min(30_000, Math.max(0,
            typeof beat?.duration === "number" && beat.duration > 0
                ? beat.duration
                : wait ? wait
                    : isClip ? 1200
                    : move ? DEFAULT_DURATION[move as MoveName]
                    : take ? TAKE_MS
                    : drop ? DROP_MS
                    // An effect that IS the beat gets its natural length; one
                    // riding a move or a line takes that beat's time instead.
                    : (!say && !camera && effect)
                        ? Math.round((findEffect(effect)?.seconds ?? 1) * 1000)
                    // A spoken line is as long as the speaking takes; an unspoken
                    // one is as long as it takes to read.
                    : say ? timings?.saying(say, id) ?? readingTime(say)
                        // A camera move takes real time and is the point of the
                        // beat, so it gets a length worth watching.
                        : camera ? DEFAULT_CAMERA_MS
                            // A sound on its own takes no time: it fires and the
                            // scene carries on over it, which is what a sting is.
                            : 0));

        const travel = move && !isClip && TRAVELS.has(move as MoveName) && beat?.to
            ? { dx: typeof beat.to.x === "number" ? beat.to.x : 0,
                dy: typeof beat.to.y === "number" ? beat.to.y : 0 }
            : null;

        // The breath goes in as a beat of its own rather than as padding on the
        // one that follows, so the timeline an agent narrates against says
        // where the silence is instead of hiding it inside somebody's line.
        // Not before a `with` beat: simultaneous lines are deliberate, and a
        // breath in front of one would push it out of the overlap it asked for.
        if (say && lastSpeaker && lastSpeaker !== id && !together) {
            planned.push({
                id: "", with: false, becomes: null, take: null, drop: null, effect: null,
                move: null, say: null, sound: null, camera: null, travel: null, duration: BREATH_MS,
            });
        }
        if (say) lastSpeaker = id;

        planned.push({
            id, with: together, becomes, take, drop, effect, move, say, sound, camera, travel, duration,
        });
    }

    // Simultaneous beats count once: a group is as long as its longest member,
    // which is also how the player will actually run it.
    let duration = 0;
    let groupMax = 0;
    for (const beat of planned) {
        if (!beat.with) {
            duration += groupMax;
            groupMax = 0;
        }
        groupMax = Math.max(groupMax, beat.duration);
    }
    duration += groupMax;
    if (duration > MAX_PERFORMANCE_MS) {
        problems.push({
            index: -1,
            reason: `the scene runs ${Math.round(duration / 1000)}s, longer than the ` +
                `${MAX_PERFORMANCE_MS / 1000}s limit. Split it across scenes.`,
        });
    }
    return { plan: { beats: planned, duration }, problems };
}
