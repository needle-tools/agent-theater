/**
 * Sound: music under a scene, and a noise on a beat.
 *
 * Two kinds, and they behave differently enough to be separate ideas.
 *
 * **Music** belongs to a scene. It starts when the scene does, loops for as
 * long as the scene lasts, and cross-fades into whatever the next scene wants —
 * cutting from one two-minute bed to another is the single most amateur sound a
 * show can make.
 *
 * **Cues** belong to a beat. They fire and finish. Several can overlap, because
 * a laugh landing while a sting is still ringing is fine and stopping the sting
 * to make room is not.
 *
 * Streamed rather than decoded. The music is two minutes a piece and Web Audio
 * would hold every one of them in memory as raw samples — tens of megabytes for
 * something an `<audio>` element streams off disk. Cross-fading needs nothing
 * more than two elements and a volume ramp.
 */
import { SOUNDS, type Sound, type SoundRole } from "./sounds.js";
export { SOUNDS, type Sound, type SoundRole } from "./sounds.js";

const byId = new Map(SOUNDS.map(sound => [sound.id, sound]));

export function findSound(id: string): Sound | null {
    return byId.get(id) ?? null;
}

/** The ids an agent may name in a given role. */
export function soundNames(...roles: SoundRole[]): string[] {
    return SOUNDS.filter(sound => roles.includes(sound.role)).map(sound => sound.id);
}

/**
 * One line per sound, for an agent choosing between them.
 *
 * The moods and the descriptions are the whole reason to have this: "a bed" is
 * not enough to pick between eight of them, and a list of bare ids makes the
 * choice arbitrary. Alternate takes of one prompt are marked, so an agent that
 * wants variety knows which ones are genuinely different.
 */
export function soundCatalogue(...roles: SoundRole[]): string[] {
    return SOUNDS.filter(sound => roles.includes(sound.role)).map(sound =>
        `${sound.id} — ${sound.description}` +
        `${sound.mood.length ? ` [${sound.mood.join(", ")}]` : ""}` +
        `${sound.take ? ` (one take of "${sound.take}")` : ""}`);
}

/**
 * Everything plays at the level it was made at.
 *
 * The beds and the cues were balanced against each other when they were
 * generated, so mixing them again here — a quieter bed, a louder sting —
 * would silently undo that work with numbers picked by someone who has not
 * heard them together. Volume is used for one thing only: fading, which is a
 * change over time rather than a change of level.
 */
const FULL = 1;
/** Long enough to be a change of mood rather than a splice. */
const CROSSFADE_MS = 1200;

export interface Speaker {
    /** Start a bed under the scene, fading out whatever was playing. */
    music(id: string | null): void;
    /** Fire and forget. Overlapping cues are allowed and expected. */
    cue(id: string): void;
    /** Silence, for leaving the show. */
    stop(): void;
    /**
     * Whether the browser has let us make a sound yet.
     *
     * Autoplay is blocked until the person has interacted with the page, and a
     * show started by an agent has had no interaction at all — so this can be
     * false through an entire performance, and the honest thing is to say so
     * rather than let the silence read as a missing feature.
     */
    readonly allowed: boolean;
}

/** A no-op speaker, for tests and for anywhere without a DOM. */
export const SILENT: Speaker = {
    music() {},
    cue() {},
    stop() {},
    allowed: true,
};

export function createSpeaker(): Speaker {
    if (typeof document === "undefined") return SILENT;

    let playing: HTMLAudioElement | null = null;
    let playingId: string | null = null;
    let blocked = false;

    /** Ramp an element's volume, then optionally stop it. */
    const fade = (element: HTMLAudioElement, to: number, ms: number, thenStop = false) => {
        const from = element.volume;
        const started = performance.now();
        const step = () => {
            const t = Math.min(1, (performance.now() - started) / ms);
            element.volume = Math.max(0, Math.min(1, from + (to - from) * t));
            if (t < 1) {
                requestAnimationFrame(step);
                return;
            }
            if (thenStop) {
                element.pause();
                element.src = "";
            }
        };
        requestAnimationFrame(step);
    };

    const start = (sound: Sound, loop: boolean): HTMLAudioElement | null => {
        const element = new Audio(sound.file);
        element.loop = loop;
        // A bed fades up; a cue simply starts, because a sting that faded in
        // would have its attack removed, and the attack is the sting.
        element.volume = loop ? 0 : FULL;
        const attempt = element.play();
        if (attempt) {
            attempt.catch(() => {
                // Autoplay refused. Remembered rather than retried: it will
                // keep refusing until the person touches the page, and a show
                // that retried on every cue would fill the console.
                blocked = true;
            });
        }
        if (loop) fade(element, FULL, CROSSFADE_MS);
        return element;
    };

    return {
        get allowed() {
            return !blocked;
        },

        music(id) {
            if (id === playingId) return;
            const previous = playing;
            playingId = id;
            playing = null;
            // Both at once for the length of the fade, which is what makes it a
            // change of mood rather than a splice.
            if (previous) fade(previous, 0, CROSSFADE_MS, true);
            if (!id) return;
            const sound = findSound(id);
            if (!sound) return;
            playing = start(sound, true);
        },

        cue(id) {
            const sound = findSound(id);
            if (!sound) return;
            // Not held onto: a cue is over in a few seconds and keeping a
            // handle would only invite somebody to stop it halfway.
            start(sound, false);
        },

        stop() {
            if (playing) fade(playing, 0, 400, true);
            playing = null;
            playingId = null;
        },
    };
}
