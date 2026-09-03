/**
 * Recorded motion: imperfection you can perform.
 *
 * The built-in moves are mathematics, and they look like it — a programmed
 * wobble is exactly too perfect, which is why the acting reads as software.
 * A clip is the other thing: somebody grabbed a piece and MOVED it, and the
 * samples of that gesture become keyframes any piece can replay. The little
 * hitches and overshoots a hand cannot help making are the whole value; no
 * easing function produces them.
 *
 * Clips are recorded by a person and only ever played by the agent. They are
 * stored per browser, sized relative to the piece that performs them — a
 * gesture recorded on a large prop scales down to a mouse — and played on the
 * `translate` property, deliberately: the pose system owns `transform`, so a
 * clip composes with a beat instead of fighting it, and a talking clip can run
 * under a walk without either noticing the other.
 */
import { SHIPPED_CLIPS } from "./clipLibrary.js";

export interface ClipFrame {
    /** 0..1 through the clip. */
    t: number;
    /** Offset from where the gesture started, in units of the piece's height. */
    dx: number;
    dy: number;
}

export interface Clip {
    name: string;
    seconds: number;
    frames: ClipFrame[];
    /**
     * Where the gesture ENDED, in units of the piece's height — the journey
     * that is subtracted out of `frames` so a clip loops in place. Kept so a
     * preview can replay the real gesture; in a play, travel still belongs to
     * the walk a clip rides on. Absent when the gesture stayed put.
     */
    travel?: { dx: number; dy: number };
}

/** A raw pointer sample, straight off a drag. */
export interface ClipSample {
    at: number;
    x: number;
    y: number;
}

const KEY = "needle-collage/clips/v1";

/** Enough frames to keep a hand's character; few enough to store and replay. */
const FRAMES = 48;

/** Shorter than this is a click that twitched, not a gesture. */
const MIN_SECONDS = 0.35;

/**
 * Names with a job. A clip called "talk" replaces the programmed talking
 * wobble for every speaker; "sway" replaces the idle sway. Record those two
 * once by hand and the whole company inherits the imperfection.
 */
export const TALK_CLIP = "talk";
export const SWAY_CLIP = "sway";

/**
 * Turn a drag into a clip.
 *
 * Three normalisations, each with a reason:
 *  - offsets are divided by the piece's height, so the gesture is "half my
 *    body up" rather than "80 pixels up" and scales with whoever performs it;
 *  - the samples are resampled to a fixed count on an even clock, because
 *    pointer events arrive whenever they like and a replay needs frames;
 *  - the linear drift from first to last sample is subtracted, so the clip
 *    ends where it began. A gesture is a performance, not a journey — travel
 *    belongs to `walk`, which knows how to commit it to the document. Without
 *    this, replaying a clip would leave the picture disagreeing with the
 *    document by the length of the recording.
 */
export function clipFromSamples(name: string, samples: ClipSample[], size: number): Clip | null {
    if (samples.length < 4 || size <= 0) return null;
    const start = samples[0];
    const seconds = (samples[samples.length - 1].at - start.at) / 1000;
    if (seconds < MIN_SECONDS) return null;

    const driftX = samples[samples.length - 1].x - start.x;
    const driftY = samples[samples.length - 1].y - start.y;

    const frames: ClipFrame[] = [];
    for (let i = 0; i < FRAMES; i++) {
        const t = i / (FRAMES - 1);
        const clock = start.at + t * seconds * 1000;
        const after = samples.findIndex(sample => sample.at >= clock);
        const b = after <= 0 ? samples[Math.max(0, after)] : samples[after];
        const a = after <= 0 ? b : samples[after - 1];
        const span = Math.max(1, b.at - a.at);
        const mix = after <= 0 ? 0 : Math.min(1, (clock - a.at) / span);
        const x = a.x + (b.x - a.x) * mix - start.x - driftX * t;
        const y = a.y + (b.y - a.y) * mix - start.y - driftY * t;
        frames.push({
            t: Math.round(t * 1000) / 1000,
            dx: Math.round((x / size) * 1000) / 1000,
            dy: Math.round((y / size) * 1000) / 1000,
        });
    }
    const clip: Clip = { name, seconds: Math.round(seconds * 100) / 100, frames };
    // A journey worth remembering: more than a twentieth of a body. Below
    // that it is pointer noise, and storing it would make every clip claim
    // to travel.
    const travel = { dx: Math.round((driftX / size) * 1000) / 1000, dy: Math.round((driftY / size) * 1000) / 1000 };
    if (Math.hypot(travel.dx, travel.dy) >= 0.05) clip.travel = travel;
    return clip;
}

/**
 * A clip as Web Animations keyframes for a piece of a given height.
 *
 * On the `translate` property — see the module note. The pose system replaces
 * `transform` wholesale while a beat runs; two systems writing one property
 * means one of them loses, and a clip that cancelled the walk it was riding
 * would be worse than no clip.
 */
export function clipKeyframes(clip: Clip, size: number): Keyframe[] {
    return clip.frames.map(frame => ({
        offset: frame.t,
        translate: `${(frame.dx * size).toFixed(1)}px ${(frame.dy * size).toFixed(1)}px`,
    }));
}

/**
 * The gesture as it was actually performed: the subtracted travel put back,
 * so a recorded "run down" runs down. For previews — in a play the drift-free
 * form composes with the walk that owns the travel.
 */
export function clipPreviewKeyframes(
    clip: Clip, size: number, origin: { dx: number; dy: number } = { dx: 0, dy: 0 },
): Keyframe[] {
    const travel = clip.travel ?? { dx: 0, dy: 0 };
    return clip.frames.map(frame => ({
        offset: frame.t,
        translate: `${((origin.dx + frame.dx + travel.dx * frame.t) * size).toFixed(1)}px ` +
            `${((origin.dy + frame.dy + travel.dy * frame.t) * size).toFixed(1)}px`,
    }));
}

/** The bounding box of the performed gesture (travel included), in size units. */
export function clipExtent(clip: Clip): { minX: number; maxX: number; minY: number; maxY: number } {
    const travel = clip.travel ?? { dx: 0, dy: 0 };
    const xs = clip.frames.map(frame => frame.dx + travel.dx * frame.t);
    const ys = clip.frames.map(frame => frame.dy + travel.dy * frame.t);
    return {
        minX: Math.min(...xs, 0), maxX: Math.max(...xs, 0),
        minY: Math.min(...ys, 0), maxY: Math.max(...ys, 0),
    };
}

/**
 * The same clip as CSS text, for taking a recorded gesture out of the page.
 * `em` rather than px so the CSS scales the way the runtime does. Travel is
 * put back in: the copied keyframes match the preview card, not the internal
 * composition form.
 */
export function clipToCss(clip: Clip, emPerSize = 10): string {
    const travel = clip.travel ?? { dx: 0, dy: 0 };
    const stops = clip.frames
        .filter((_, index) => index % 4 === 0 || index === clip.frames.length - 1)
        .map(frame =>
            `    ${(frame.t * 100).toFixed(1)}% { translate: ` +
            `${((frame.dx + travel.dx * frame.t) * emPerSize).toFixed(2)}em ` +
            `${((frame.dy + travel.dy * frame.t) * emPerSize).toFixed(2)}em; }`)
        .join("\n");
    return `@keyframes clip-${clip.name} {\n${stops}\n}`;
}

// ── the drawer ───────────────────────────────────────────────────────────────

function read(): Clip[] {
    if (typeof localStorage === "undefined") return [];
    try {
        const raw = localStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function write(clips: Clip[]) {
    try {
        localStorage?.setItem(KEY, JSON.stringify(clips));
    } catch {
        // Storage full or private mode: the clip plays this session and is
        // lost on reload, which is worth neither a crash nor a dialog.
    }
}

/**
 * Everything performable: this browser's own recordings FIRST (newest at the
 * front — the take just performed is the one being looked for), then the
 * shipped library behind them. A local recording with a shipped name WINS —
 * the person's own take on "talk" beats the factory's, which is the entire
 * point of having a recorder.
 */
export function listClips(): Clip[] {
    const stored = read();
    const own = new Set(stored.map(clip => clip.name));
    return [...stored.slice().reverse(), ...SHIPPED_CLIPS.filter(clip => !own.has(clip.name))];
}

export function findClip(name: string): Clip | null {
    return read().find(clip => clip.name === name)
        ?? SHIPPED_CLIPS.find(clip => clip.name === name)
        ?? null;
}

/** Whether THIS browser recorded a clip by this name — shipped ones do not count. */
export function hasOwnClip(name: string): boolean {
    return read().some(clip => clip.name === name);
}

export function saveClip(clip: Clip): void {
    const clips = read().filter(existing => existing.name !== clip.name);
    clips.push(clip);
    write(clips);
}

export function deleteClip(name: string): void {
    write(read().filter(clip => clip.name !== name));
}

/** A safe name: what the beat vocabulary and CSS identifiers both accept. */
export function clipName(raw: string): string {
    return raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}

/**
 * The recorder itself: a mutable singleton, deliberately not reactive.
 *
 * The canvas reads `armed` inside pointer handlers — which run outside any
 * reactive scope anyway — and the menu owns the arming and the naming. One
 * shared flag beats threading a store through three components for a debug
 * tool.
 */
export const recorder = {
    armed: false,
    samples: [] as ClipSample[],
    /** Height of the piece the gesture is being performed on. */
    size: 0,
    /** Called by the canvas when a recorded drag ends. */
    onDone: null as ((samples: ClipSample[], size: number) => void) | null,
};
