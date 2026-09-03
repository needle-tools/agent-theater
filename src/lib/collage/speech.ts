/** One speech queue and one timing authority for every bubble on the page. */
import { readingTime } from "./perform.js";
import {
    playSubtitleVoice,
    revealedSubtitleLength,
    subtitleVoiceTiming,
    type SubtitleVoice,
    type SubtitleVoicePlayback,
} from "../subtitleVoice/index.js";

const TICK_MS = 40;
const BREATH_MS = 320;
const TAIL_MS = 450;
const DUCK_OVER_MS = 900;

/**
 * How long to wait for a voice to START before going on without it.
 * A suspended audio context answers resume() with a promise that never
 * settles, and it would sit in the queue every bubble waits in — one line that
 * never begins is a scene that never finishes. Shown silently instead.
 */
const VOICE_START_MS = 4000;

export interface Speech {
    text: string;
    voice?: SubtitleVoice | null;
}

export interface Turn {
    begin?(ms: number, voiced: boolean): void;
    show?(progress: number): void;
    end?(): void;
    fallback?: number;
    dropped?(): boolean;
}

export function spokenLength(line: Speech): number | null {
    if (!line.voice) return null;
    return Math.round(subtitleVoiceTiming(line.text.trim(), line.voice).duration * 1000) + TAIL_MS + BREATH_MS;
}

export interface Prompter {
    speak(line: Speech, turn?: Turn): Promise<void>;
    hush(): void;
    readonly touched: boolean;
    readonly generation: number;
    onTouch(run: () => void): () => void;
    readonly busy: boolean;
    readonly mute: boolean;
    duckWith(duck: ((ms: number) => void) | null): void;
    setLevel(level: number): void;
}

export function createPrompter(): Prompter {
    let chain: Promise<void> = Promise.resolve();
    let era = 0;
    let waiting = 0;
    let playing: SubtitleVoicePlayback | null = null;
    let duck: ((ms: number) => void) | null = null;
    let touched = false;
    let level = 1;
    const waiters = new Set<() => void>();
    const gestures = ["pointerdown", "keydown", "touchstart"] as const;
    const noticed = () => {
        if (touched) return;
        touched = true;
        for (const type of gestures) window.removeEventListener(type, noticed, true);
        const due = [...waiters];
        waiters.clear();
        for (const run of due) run();
    };
    if (typeof window !== "undefined") {
        for (const type of gestures) window.addEventListener(type, noticed, true);
    }
    const canSpeak = typeof window !== "undefined"
        && !!(window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

    const rest = (ms: number, mine: number) => new Promise<void>(resolve => {
        const done = () => {
            clearTimeout(timer);
            clearInterval(poll);
            resolve();
        };
        const timer = setTimeout(done, ms);
        const poll = setInterval(() => {
            if (mine !== era) done();
        }, 60);
    });

    /** A voice, or nothing, within a fixed time. Never rejects, never hangs.
     *  One that turns up late is stopped: its line has already been and gone. */
    const starting = (line: Speech) => new Promise<SubtitleVoicePlayback | null>(resolve => {
        let gaveUp = false;
        const timer = setTimeout(() => {
            gaveUp = true;
            console.warn(`[speech] "${line.text.slice(0, 40)}" did not start in time — said in silence.`);
            resolve(null);
        }, VOICE_START_MS);
        playSubtitleVoice(line.text, line.voice!, level).then(
            playback => {
                clearTimeout(timer);
                if (gaveUp) return playback.stop();
                resolve(playback);
            },
            error => {
                clearTimeout(timer);
                console.warn(`[speech] "${line.text.slice(0, 40)}" could not be played:`, error);
                if (!gaveUp) resolve(null);
            });
    });

    const utter = async (line: Speech, turn: Turn, mine: number) => {
        if (turn.dropped?.()) return;
        let playback: SubtitleVoicePlayback | null = null;
        if (line.voice && touched && canSpeak) playback = await starting(line);
        if (mine !== era || turn.dropped?.()) {
            playback?.stop();
            return;
        }

        playing = playback;
        const audioMs = playback ? playback.timing.duration * 1000 : null;
        const bubbleMs = audioMs !== null ? audioMs + TAIL_MS : turn.fallback ?? readingTime(line.text);
        try {
            turn.begin?.(bubbleMs, !!playback);
            if (audioMs !== null && audioMs >= DUCK_OVER_MS) duck?.(audioMs);
            const started = performance.now();
            await new Promise<void>(resolve => {
                const stop = () => {
                    clearInterval(timer);
                    resolve();
                };
                const timer = setInterval(() => {
                    if (mine !== era) return stop();
                    const elapsedMs = performance.now() - started;
                    if (elapsedMs >= bubbleMs) return stop();
                    if (playback) {
                        const characters = revealedSubtitleLength(line.text, playback.timing, elapsedMs / 1000);
                        turn.show?.(characters / Math.max(1, line.text.length));
                    } else {
                        turn.show?.(Math.min(1, elapsedMs / bubbleMs));
                    }
                }, TICK_MS);
            });
        } finally {
            playback?.stop();
            if (playing === playback) playing = null;
            turn.show?.(1);
            turn.end?.();
        }
        if (playback && mine === era) await rest(BREATH_MS, mine);
    };

    return {
        get busy() { return waiting > 0; },
        get mute() { return !canSpeak; },
        get touched() { return touched; },
        get generation() { return era; },
        onTouch(run) {
            if (touched) {
                run();
                return () => {};
            }
            waiters.add(run);
            return () => waiters.delete(run);
        },
        duckWith(next) { duck = next; },
        setLevel(next) { level = Math.max(0, Math.min(1, next)); },
        speak(line, turn = {}) {
            const spoken: Speech = { text: line.text.trim(), voice: line.voice ?? null };
            if (!spoken.text) return Promise.resolve();
            const mine = era;
            waiting++;
            const run = chain.then(() => (mine === era ? utter(spoken, turn, mine) : undefined));
            chain = run.then(() => {}, error => {
                console.warn(`[speech] "${spoken.text.slice(0, 40)}" failed while being said:`, error);
            });
            return run.then(() => {}, () => {}).finally(() => waiting--);
        },
        hush() {
            era++;
            playing?.stop();
            playing = null;
        },
    };
}

export const prompter: Prompter = createPrompter();
