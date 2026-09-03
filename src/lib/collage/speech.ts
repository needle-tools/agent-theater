/**
 * The prompter: one voice at a time, everywhere on the page.
 *
 * Every speech bubble this app draws now goes through here — the lines in a
 * show, the props introducing themselves on the empty stage, the note that
 * appears where you clicked to copy the prompt. They used to be three unrelated
 * clocks, which was fine while all three were silent. The moment they have
 * voices it stops being fine: two characters talking over each other is not a
 * scene, it is a noise, and no amount of per-site care fixes it because none of
 * the three sites knows the others exist.
 *
 * So there is one queue, and it owns two things that used to be owned
 * separately:
 *
 * **When a bubble appears.** Not when its beat starts, not after a CSS delay —
 * when its turn to be heard comes. A bubble that popped up while the previous
 * line was still being spoken would be a subtitle for the wrong sentence.
 *
 * **How fast it types.** The line is revealed against the length of its own
 * audio, so the words arrive as they are said. Where there is no audio — the
 * model is still downloading, the browser has not allowed sound yet, the voice
 * failed — it falls back to reading time and the bubble behaves exactly as it
 * did before any of this existed. That fallback is the normal case on a first
 * visit, and it has to be good rather than merely tolerable.
 *
 * The queue is strict, with one exception: `hush` cuts everything. A person
 * clicking something is entitled to an immediate answer, and making them wait
 * out an ambient line before their own feedback arrives is the wrong trade.
 */
import { readingTime } from "./perform.js";
import { createVoices, type Line, type Voices } from "./voice.js";

/**
 * How much of a line's life is spent typing it in.
 *
 * The rest is the bubble sitting there finished. With a voice this is what
 * keeps the words slightly ahead of the mouth rather than trailing it — the eye
 * reads a fraction faster than the ear hears, and a caption that lags its own
 * audio reads as broken sound rather than as slow text.
 */
export const TYPING_SHARE = 0.72;

/** How often a bubble redraws while typing. Smooth enough; not a frame loop. */
const TICK_MS = 40;

/**
 * A breath after a line before the next one starts.
 *
 * The same reason the score puts one between two speakers: lines run back to
 * back sound like a list being read out. Here it also covers the join — a new
 * bubble appearing in the same frame the last one vanished reads as one bubble
 * changing its mind.
 */
const BREATH_MS = 320;

/**
 * A moment of bubble left after the voice has stopped.
 *
 * A line whose bubble vanished on its last syllable feels cut off, and the
 * generated audio is trimmed close. Small enough not to be a pause.
 */
const TAIL_MS = 450;

/** Long enough to be worth pushing the music out of the way for. */
const DUCK_OVER_MS = 900;

/**
 * How long to wait for a line that is not ready yet.
 *
 * Only ever spent when the model is already loaded, where synthesis is a
 * fraction of a second and waiting is invisible. While the model is still
 * downloading this is skipped entirely — a hundred and fifty megabytes is not
 * something to hold a bubble open for, and the silent fallback is right there.
 */
const GRACE_MS = 1200;

/**
 * A line, and who says it.
 *
 * A missing voice is not "the default voice" — it is a line that is sequenced
 * but never heard. Silent bubbles have to go through the same queue as spoken
 * ones or a silent character would talk over a speaking one, which is the exact
 * bug the queue exists to prevent, just harder to hear.
 */
export interface Speech {
    text: string;
    voice?: string | null;
}

/** What a bubble wants told about its own line. */
export interface Turn {
    /**
     * Its turn has come. Given the whole length, so anything with its own
     * animation can match it — and whether it is actually being HEARD.
     *
     * The second half matters more than it looks. A line can reach this point
     * having failed to make a sound for reasons that are nobody's fault and are
     * not permanent: the model had not finished arriving, or the browser had not
     * been touched yet and refused to play. A bubble that wants to try again
     * later has no other way to know it needs to.
     */
    begin?(ms: number, voiced: boolean): void;
    /** How much of the line to show, 0 to 1. Called while it plays. */
    show?(progress: number): void;
    /** Finished, or cut off by a hush. Always called if `begin` was. */
    end?(): void;
    /** How long to hold the bubble when there is no audio. Reading time if unset. */
    fallback?: number;
    /**
     * Checked when the turn comes round: true drops the line unspoken.
     *
     * For bubbles that can leave before they are heard. A queued line belonging
     * to a component that has since unmounted would otherwise be spoken to an
     * empty page — and, worse, hold up everything behind it while it was.
     */
    dropped?(): boolean;
}

/**
 * How long a line occupies the queue, end to end, or null if it has no voice.
 *
 * The audio, the moment of bubble after it, and the breath before the next
 * thing can start. All three, because this is what a timetable is built from
 * and a timetable that counted only the audio would run fast by a third of a
 * second per line — half a minute across a play, which is the difference
 * between narration landing on the beat and narration landing on the wrong
 * scene.
 */
export function spokenLength(voices: Voices, line: Speech): number | null {
    if (!line.voice) return null;
    const ms = voices.lengthOf(line.text.trim(), line.voice);
    return ms === null ? null : ms + TAIL_MS + BREATH_MS;
}

export interface Prompter {
    /**
     * Say this, when nothing else is being said. Resolves when it is over.
     *
     * The promise resolves rather than rejects on a hush: being cut short is
     * a normal end to a line, and a caller that had to catch it would catch it
     * by writing the same empty block every time.
     */
    speak(line: Speech, turn?: Turn): Promise<void>;
    /**
     * Have these ready before anybody asks for them.
     *
     * Fire and forget. The point is that the first line of a scene is already
     * synthesised by the time the scene reaches it, so nothing is ever waiting
     * on the model with a bubble held open.
     */
    expect(lines: Speech[]): Promise<void>;
    /** Stop talking, now, and drop whatever was queued behind it. */
    hush(): void;
    /**
     * Whether the browser will let us make a sound yet.
     *
     * False until somebody has clicked, tapped or typed. Not a setting and not
     * something that can be asked for in advance — every browser refuses audio
     * on a page nobody has touched, and the only way to find out is to try. A
     * page that opens talking is not a thing the web allows.
     */
    readonly touched: boolean;
    /**
     * Bumped by every hush, so a caller can tell whether it was interrupted
     * while it was away.
     *
     * There is one case that needs this and it is not exotic: the first gesture
     * on the empty page is usually the click that copies the prompt, so the same
     * event both wakes the props up and calls for a note that outranks them. A
     * line that went off to be synthesised and came back has to be able to ask
     * whether the world moved on without it.
     */
    readonly generation: number;
    /**
     * Run this the first time the page is touched, or now if it already has
     * been. Returns a way to stop caring.
     *
     * For lines that were shown before anybody could hear them. The bubble has
     * already done its job as text; this is how it gets a second chance to be
     * speech.
     */
    onTouch(run: () => void): () => void;
    /** Whether anything is being said or waiting to be. */
    readonly busy: boolean;
    /**
     * Whether nothing will ever be heard, however long anybody waits.
     *
     * Speech switched off in this build, or tried and found impossible. Both are
     * settled answers, which is what separates them from "still loading" — and
     * a bubble that would otherwise arrange to say itself again later needs to
     * know the difference, or it arranges a second silent performance for an
     * audience that was never going to hear the first.
     */
    readonly mute: boolean;
    /**
     * Where to send a request to push the music down under dialogue.
     *
     * Set by whoever owns the speaker, because the prompter has no business
     * knowing whether there is a show on. Null on the pages where there is no
     * music, which is most of them.
     */
    duckWith(duck: ((ms: number) => void) | null): void;
    readonly voices: Voices;
}

export function createPrompter(voices: Voices = createVoices()): Prompter {
    /** The tail of the queue. Everything chains onto this. */
    let chain: Promise<void> = Promise.resolve();
    /**
     * Bumped by every hush.
     *
     * A queued line captures the number it was queued under and checks it when
     * its turn comes, so a hush silences things that have not started yet
     * without having to reach into a list and cancel them one by one.
     */
    let era = 0;
    let waiting = 0;
    let playing: HTMLAudioElement | null = null;
    let duck: ((ms: number) => void) | null = null;

    /*
     * Watch for the first sign of a person.
     *
     * Capture phase and on the window, because the gesture that counts is any
     * gesture at all: dragging a prop is one, so is a keystroke, and by the time
     * anything wants to speak it is too late to start asking. The listeners take
     * themselves off once they have fired — this only ever happens once per page
     * and a permanent listener on every pointerdown is a permanent cost for an
     * answer that stopped changing.
     */
    let touched = false;
    const waiters = new Set<() => void>();
    const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;
    const noticed = () => {
        if (touched) return;
        touched = true;
        for (const type of GESTURES) window.removeEventListener(type, noticed, true);
        // Copied first: a callback that registers another one must not run
        // inside the loop that is draining them.
        const due = [...waiters];
        waiters.clear();
        for (const run of due) run();
    };
    if (typeof window !== "undefined") {
        for (const type of GESTURES) window.addEventListener(type, noticed, true);
    }

    /** Sleep, but wake early if the era has moved on. */
    const rest = (ms: number, mine: number) => new Promise<void>(resolve => {
        const done = () => {
            clearTimeout(timer);
            clearInterval(poll);
            resolve();
        };
        const timer = setTimeout(done, ms);
        // Checked alongside rather than after, so a hush during a breath is not
        // held up by the breath.
        const poll = setInterval(() => {
            if (mine !== era) done();
        }, 60);
    });

    /** The audio for a line, if it can be had without anybody noticing the wait. */
    const ready = async (line: Speech) => {
        if (!line.voice) return null;
        const wanted: Line = { text: line.text, voice: line.voice };
        const found = voices.lineFor(wanted.text, wanted.voice);
        if (found) return found;
        // Only worth waiting for once the model is loaded. Before that the wait
        // is a download, and a bubble does not hold for a download.
        if (voices.state !== "ready") return null;
        await Promise.race([voices.learn([wanted]), rest(GRACE_MS, era)]);
        return voices.lineFor(wanted.text, wanted.voice);
    };

    const utter = async (line: Speech, turn: Turn, mine: number) => {
        if (turn.dropped?.()) return;
        const spoken = await ready(line);
        if (mine !== era || turn.dropped?.()) return;

        /*
         * Started before the length is known to be usable, because a browser
         * that refuses the play is a browser that refuses it *now* — the
         * promise rejects immediately — and the bubble must not open at the
         * spoken length and then run in silence at that length. A refused line
         * falls back to reading time, same as a line with no audio at all.
         */
        let element: HTMLAudioElement | null = null;
        if (spoken) {
            element = new Audio(spoken.url);
            try {
                await element.play();
            } catch (error) {
                /*
                 * Refused. Silent, and it says so.
                 *
                 * Degrading quietly is right for the person watching — a play
                 * with bubbles and no voices is still a play — and it was
                 * exactly wrong for anybody trying to find out why nothing
                 * could be heard. The symptom of a swallowed rejection here is
                 * a model that loads, a console with nothing in it, and no
                 * audio ever, which is indistinguishable from the feature not
                 * existing. Almost always the autoplay policy, which no amount
                 * of code fixes: a browser will not make a sound on a page
                 * nobody has touched.
                 */
                const why = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
                console.warn(
                    `[speech] "${line.text.slice(0, 40)}" was synthesised but could not be played` +
                    `${touched ? "" : " — the page has not been clicked yet, and browsers refuse audio until it has"}` +
                    `: ${why}`);
                element = null;
            }
        }
        if (mine !== era) {
            element?.pause();
            return;
        }
        playing = element;

        /*
         * The bubble's own length, which is the turn minus the breath that
         * follows it — spokenLength is the authority on the whole turn, so the
         * plan and what actually happens cannot drift apart.
         */
        const whole = element ? spokenLength(voices, line) : null;
        const ms = whole !== null ? whole - BREATH_MS : turn.fallback ?? readingTime(line.text);

        try {
            turn.begin?.(ms, !!element);
            if (element && ms >= DUCK_OVER_MS) duck?.(ms);

            const started = performance.now();
            await new Promise<void>(resolve => {
                const stop = () => {
                    clearInterval(timer);
                    resolve();
                };
                const timer = setInterval(() => {
                    if (mine !== era) return stop();
                    const elapsed = performance.now() - started;
                    if (elapsed >= ms) return stop();
                    turn.show?.(Math.min(1, elapsed / ms / TYPING_SHARE));
                }, TICK_MS);
            });
        } finally {
            /*
             * Released however this ended — finished, hushed, or a callback
             * that threw. An element left playing with nothing pointing at it
             * is the bug audio.ts learned the hard way, and a bubble whose own
             * `begin` threw would otherwise keep its voice going forever with
             * no way left to reach it.
             */
            if (element) {
                element.pause();
                element.src = "";
            }
            if (playing === element) playing = null;
            turn.end?.();
        }
        // Only after a voice. A score already writes its own breath between two
        // speakers, and a silent bubble is timed by a plan that has not been
        // told about this one — so adding it there would make every unvoiced
        // scene run slightly longer than its own timetable says.
        if (whole !== null && mine === era) await rest(BREATH_MS, mine);
    };

    return {
        get busy() {
            return waiting > 0;
        },

        get mute() {
            return voices.state === "off" || voices.state === "unavailable";
        },

        get touched() {
            return touched;
        },

        get generation() {
            return era;
        },

        onTouch(run) {
            if (touched) {
                run();
                return () => {};
            }
            waiters.add(run);
            return () => waiters.delete(run);
        },

        get voices() {
            return voices;
        },

        duckWith(next) {
            duck = next;
        },

        speak(line, turn = {}) {
            const spoken: Speech = { text: line.text.trim(), voice: line.voice ?? null };
            if (!spoken.text) return Promise.resolve();
            // Asking for a line to be SPOKEN is the clearest possible signal
            // that more are coming; the model may as well start arriving now.
            // A silent bubble asks for nothing and must not trigger a download.
            if (spoken.voice) voices.warm();

            const mine = era;
            waiting++;
            const run = chain.then(() => (mine === era ? utter(spoken, turn, mine) : undefined));
            // The chain must never reject, or one bad line stops every line
            // after it for the life of the page. Reported on the way past,
            // though: swallowing it silently is how a broken line becomes an
            // afternoon of wondering why the page went quiet.
            chain = run.then(() => {}, error => {
                console.warn(`[speech] "${spoken.text.slice(0, 40)}" failed while being said:`, error);
            });
            return run.then(() => {}, () => {}).finally(() => {
                waiting--;
            });
        },

        expect(lines) {
            const wanted: Line[] = lines
                .filter((line): line is Speech & { voice: string } => !!line.voice && !!line.text.trim())
                .map(line => ({ text: line.text.trim(), voice: line.voice }));
            if (!wanted.length) return Promise.resolve();
            return voices.learn(wanted);
        },

        hush() {
            era++;
            // `waiting` is NOT reset here. Every queued line still has a promise
            // in flight that will decrement it on its way out, and zeroing it
            // first would send the count negative — after which `busy` would
            // answer false through the next several lines.
            if (playing) {
                playing.pause();
                playing.src = "";
                playing = null;
            }
        },
    };
}

/**
 * The one everybody shares.
 *
 * A module-level singleton rather than something passed down, because the whole
 * point is that three unrelated parts of the page cannot talk at once — and a
 * prompter you have to be handed is a prompter somebody will forget to hand to
 * the fourth place that grows a bubble.
 */
export const prompter: Prompter = createPrompter();
