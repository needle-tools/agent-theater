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
    return { name, seconds: Math.round(seconds * 100) / 100, frames };
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
 * The same clip as CSS text, for taking a recorded gesture out of the page.
 * `em` rather than px so the CSS scales the way the runtime does.
 */
export function clipToCss(clip: Clip, emPerSize = 10): string {
    const stops = clip.frames
        .filter((_, index) => index % 4 === 0 || index === clip.frames.length - 1)
        .map(frame =>
            `    ${(frame.t * 100).toFixed(1)}% { translate: ` +
            `${(frame.dx * emPerSize).toFixed(2)}em ${(frame.dy * emPerSize).toFixed(2)}em; }`)
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

export function listClips(): Clip[] {
    return read();
}

export function findClip(name: string): Clip | null {
    return read().find(clip => clip.name === name) ?? null;
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
