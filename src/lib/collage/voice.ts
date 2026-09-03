/**
 * Voices: the cast saying their own lines.
 *
 * A play where the words only ever appear in a bubble is a comic strip. This is
 * the other half of it — Kokoro, an 82-million-parameter text-to-speech model,
 * running inside the page, so a scene can be *heard* without a key, an account,
 * or a round trip to anybody's server. The same reason the tracing and the
 * background cutting happen here: a thing the page can do itself is a thing that
 * still works when the network does not.
 *
 * Three decisions worth stating, because each of them costs something.
 *
 * **The model is fetched, never shipped.** A hundred and fifty megabytes is not
 * something to put in front of somebody who came to move pictures around, so
 * nothing is downloaded until a cast member is actually given a voice. From then
 * on the browser's own cache holds it and every later visit is free.
 *
 * **fp16, which is not the smallest.** The first version of this shipped q8 at
 * 88MB, on the reasoning that the download is what a person actually feels. It
 * was measured, and it was wrong twice over. Int8 kernels barely exist on
 * WebGPU, so most of the graph fell back to the CPU and generation ran at half
 * of real time — a forty-line play would have taken minutes to prepare before
 * the curtain went up. Worse, the output was audibly damaged: recognisably
 * speech, recognisably not English. Measured on the same machine, per four
 * seconds of audio:
 *
 *     q8      88MB   0.5x real time, and mangled
 *     q4f16  147MB   5.9x real time
 *     fp16   156MB   9x real time
 *
 * fp16 costs nine megabytes more than q4f16 and is half again as fast, with less
 * quantisation between the model and what you hear. Sixty-eight megabytes more
 * than the broken one, for the difference between a feature and a rumour of one.
 *
 * **Lines are learned before the show, not during it.** The timetable a
 * narrating agent works from is built out of beat durations, and a spoken line
 * takes exactly as long as it takes. Synthesising at the moment the beat arrives
 * would mean planning against a guess and then playing something else. So every
 * line in the play is spoken into a cache first, and the plan is built from what
 * came back — which is the only version of this where the narration lands on the
 * beat rather than near it.
 */

/** One of the voices Kokoro can speak in. */
export interface Voice {
    id: string;
    name: string;
    /** The two Kokoro was trained on. */
    accent: "american" | "british";
    gender: "female" | "male";
    /**
     * How good it actually is, as its own authors grade it: A down to D.
     *
     * Published rather than hidden, and the poor ones kept rather than dropped.
     * The grade is mostly about how often a voice mangles a word, and a play is
     * not an audiobook — a gravelly D that sounds like a troll is worth having,
     * and the agent choosing it should know which trade it is making.
     */
    grade: string;
    note: string;
}

/**
 * The voices offered, in the order they are worth trying.
 *
 * Not all twenty-eight. Kokoro ships several that are graded D or worse and
 * differ from each other by almost nothing, and a list that long makes the
 * choice arbitrary — the same reason the sound catalogue carries descriptions
 * instead of bare ids. What is here covers the parts a play actually needs: two
 * or three that can carry a lead, a range of ages and weights around them, and
 * a handful with enough character to be somebody in particular.
 *
 * **Every one of them is English**, and that is a property of the list rather
 * than a coincidence. Kokoro names its voices by language: `a` is American, `b`
 * is British, and the model also ships `j` and `z` voices that speak Japanese
 * and Mandarin. None of those are here, and an id outside this list is refused
 * rather than passed through — so a play cannot be cast into a language it did
 * not ask for by a typo.
 *
 * Worth knowing because it has been mistaken for the opposite: a voice from this
 * list speaking something that sounds foreign is not a language setting gone
 * wrong, it is the model being too heavily quantised to form English. See the
 * dtype note at the top.
 */
export const VOICES: Voice[] = [
    { id: "af_heart", name: "Heart", accent: "american", gender: "female", grade: "A",
        note: "Warm, easy, the most reliable of the lot. The default, and the right choice for a narrator." },
    { id: "af_bella", name: "Bella", accent: "american", gender: "female", grade: "A-",
        note: "Rich and expressive, with more push than Heart. A lead who wants the scene." },
    { id: "af_nicole", name: "Nicole", accent: "american", gender: "female", grade: "B-",
        note: "Close, soft, almost whispered. A secret, a bedtime story, somebody who does not want to be overheard." },
    { id: "bf_emma", name: "Emma", accent: "british", gender: "female", grade: "B-",
        note: "British, measured, grown-up. Reads as the one who knows what is going on." },
    { id: "am_michael", name: "Michael", accent: "american", gender: "male", grade: "C+",
        note: "Plain and steady. The most neutral man here, which makes him a good straight part." },
    { id: "am_puck", name: "Puck", accent: "american", gender: "male", grade: "C+",
        note: "Light and quick, with a grin in it. Tricksters, sidekicks, anybody enjoying themselves." },
    { id: "am_fenrir", name: "Fenrir", accent: "american", gender: "male", grade: "C+",
        note: "Deeper and rougher. Big animals, giants, whoever the others are worried about." },
    { id: "af_aoede", name: "Aoede", accent: "american", gender: "female", grade: "C+",
        note: "Bright and young. A child, or somebody delighted by the thing that just happened." },
    { id: "af_kore", name: "Kore", accent: "american", gender: "female", grade: "C+",
        note: "Even and unhurried, cooler than Heart. Somebody explaining rather than feeling." },
    { id: "af_sarah", name: "Sarah", accent: "american", gender: "female", grade: "C+",
        note: "Ordinary and friendly, no particular colour. A good second part that will not fight the lead." },
    { id: "bm_fable", name: "Fable", accent: "british", gender: "male", grade: "C",
        note: "British storyteller: unhurried, a little theatrical. Made for reading a tale aloud." },
    { id: "bm_george", name: "George", accent: "british", gender: "male", grade: "C",
        note: "Older British man, dry. Fathers, kings, anybody who has been here longer than you." },
    { id: "bf_isabella", name: "Isabella", accent: "british", gender: "female", grade: "C",
        note: "British and formal, with some height to it. Reads as grand rather than warm." },
    { id: "am_santa", name: "Santa", accent: "american", gender: "male", grade: "D-",
        note: "Old, jolly and unmistakable. Grades badly and does not care — a character part, not a narrator." },
];

const KNOWN = new Map(VOICES.map(voice => [voice.id, voice]));

export function findVoice(id: string): Voice | null {
    return KNOWN.get(id) ?? null;
}

export function voiceNames(): string[] {
    return VOICES.map(voice => voice.id);
}

/**
 * One line per voice, for an agent casting a play.
 *
 * The same shape as the sound catalogue and for the same reason: a bare list of
 * ids gives an agent no way to choose, so it picks the first one every time and
 * the whole cast speaks in one voice.
 */
export function voiceCatalogue(): string[] {
    return VOICES.map(voice =>
        `${voice.id} — ${voice.note} [${voice.accent}, ${voice.gender}, grade ${voice.grade}]`);
}

/** The voice a part gets when nobody has cast one. */
export const DEFAULT_VOICE = "af_heart";

/** A line waiting to be spoken, and who speaks it. */
export interface Line {
    text: string;
    voice: string;
}

/** A line that has been spoken, ready to play. */
export interface Spoken {
    /** An object URL for the audio. Lives until `forget`. */
    url: string;
    seconds: number;
}

export type VoiceState =
    /** Nothing has been asked for yet. */
    | "idle"
    /** Fetching the model, or speaking lines into the cache. */
    | "working"
    | "ready"
    /**
     * Tried and cannot. No WebGPU, a blocked network, a browser too old — all
     * the same from here, and all recoverable in the only way that matters: the
     * show still runs, with bubbles and no voices.
     */
    | "unavailable"
    /**
     * Switched off in this build. Nothing was tried and nothing failed.
     *
     * Kept distinct from "unavailable" because the two want opposite things
     * said about them. Unavailable is a fault worth reporting and possibly
     * worth working around; off is a decision, and reporting it as a failure
     * would send somebody hunting for a broken model that was never asked for.
     */
    | "off";

export interface Voices {
    /**
     * Have every one of these lines ready to play.
     *
     * Loads the model if it is not loaded, skips anything already spoken, and
     * resolves whether or not it worked — a play that refused to start because
     * a voice model would not download is worse than a silent one.
     */
    learn(lines: Line[]): Promise<void>;
    /**
     * How long a learned line takes, in milliseconds, or null if it is not
     * learned. Synchronous on purpose: this is what the planner asks, and the
     * planner is not allowed to wait for anything.
     */
    lengthOf(text: string, voice: string): number | null;
    /** The audio for a learned line. */
    lineFor(text: string, voice: string): Spoken | null;
    /**
     * Begin fetching the model now.
     *
     * Called the moment somebody is first given a voice, which is the earliest
     * honest signal that this play intends to be heard. Waiting until the show
     * starts would put the whole download inside the pause before the first
     * scene, where it is a hundred and fifty megabytes of nothing happening.
     */
    warm(): void;
    /** Drop every spoken line and release its audio. */
    forget(): void;
    readonly state: VoiceState;
    /** Why it is unavailable, in a form worth showing somebody. */
    readonly trouble: string | null;
}

/** A voice box that never speaks, for tests and for anywhere without a DOM. */
export const MUTE: Voices = {
    async learn() {},
    lengthOf: () => null,
    lineFor: () => null,
    warm() {},
    forget() {},
    state: "unavailable",
    trouble: null,
};

/** The same, but saying it was never switched on rather than that it broke. */
const SWITCHED_OFF: Voices = { ...MUTE, state: "off" };

/**
 * Whether this build loads a speech model at all.
 *
 * Off, and off deliberately rather than by neglect. Kokoro works — it
 * synthesises correct English at nine times real time on WebGPU — but it never
 * reached the ear reliably enough to keep switched on, and another speech system
 * is likely to replace it. Rather than delete a working implementation on the
 * strength of "probably", it is turned off here, in one place, with everything
 * around it left standing.
 *
 * What still works with this false: every bubble on the page, sequenced through
 * the one prompter, timed by reading time. That was always the fallback path and
 * it is the only path now. Nothing is downloaded, nothing is inferred, and no
 * console has anything to say about ONNX.
 *
 * To turn it back on, set this true. To put a different engine behind it,
 * implement `Voices` — five methods, all of them small — and return it from
 * `createVoices`; nothing outside this file knows or cares which model is
 * talking. Parts stay cast with their voices in the meantime, so a document
 * saved today speaks when a voice system arrives.
 */
export const SPEECH_ENABLED = false;

/**
 * The model, and the quantisation.
 *
 * v1.0 rather than the original release: it is the one with the fifty-odd voice
 * embeddings baked in, which is where every voice above comes from.
 */
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
/**
 * Half precision. See the note at the top of this file for why not smaller —
 * the smaller ones are slower here, and the smallest one does not speak English.
 */
const DTYPE = "fp16";

/**
 * How many spoken lines to keep before dropping the oldest.
 *
 * Each one is a blob of raw audio held by an object URL, and an object URL is
 * not collected while it exists — so a cache with no bound is a leak with a
 * pleasant name. A play rewritten a dozen times across an afternoon is easily a
 * few hundred lines, and this is generous next to a single scene while still
 * being a few megabytes rather than an open-ended number of them.
 *
 * Oldest first, which is the right order here: a line dropped is a line
 * re-synthesised in a fraction of a second, and the ones being dropped are from
 * drafts of scenes nobody is going to play again.
 */
const KEEP = 240;

/**
 * Lines are spoken one at a time.
 *
 * The model holds one set of buffers and running two generations through it at
 * once corrupts both. There is nothing to be gained from trying anyway: it is
 * the GPU that is busy, and a queue in front of it is what a queue in front of
 * it looks like either way.
 */
export function createVoices(): Voices {
    // Before the window check, so it reads as the decision it is rather than as
    // one more environment that happens not to support speech.
    if (!SPEECH_ENABLED) return SWITCHED_OFF;
    if (typeof window === "undefined") return MUTE;

    const spoken = new Map<string, Spoken>();
    let tts: KokoroLike | null = null;
    let loading: Promise<KokoroLike | null> | null = null;
    let state: VoiceState = "idle";
    let trouble: string | null = null;
    /** The tail of the queue, so generations chain rather than overlap. */
    let queue: Promise<unknown> = Promise.resolve();

    const key = (text: string, voice: string) => `${voice}\n${text}`;

    const load = (): Promise<KokoroLike | null> => {
        if (tts) return Promise.resolve(tts);
        if (loading) return loading;
        state = "working";
        loading = (async () => {
            try {
                // Imported here rather than at the top of the file so the
                // library and its runtime are a chunk nobody fetches until a
                // play has a voice in it.
                const { KokoroTTS } = await import("kokoro-js");
                /*
                 * WebGPU or nothing.
                 *
                 * Asked for properly rather than sniffed: `navigator.gpu`
                 * existing is not the same as an adapter being handed out — a
                 * laptop on a blocklisted driver reports the API and then
                 * refuses the device — so the request IS the detection.
                 *
                 * And no WebAssembly fallback, which is a deliberate removal.
                 * There was one, and measuring it showed it to be a trap: on the
                 * CPU this model runs at under half of real time, so the
                 * "fallback" spends a hundred and fifty megabytes of somebody's
                 * connection to arrive at a play that takes longer to prepare
                 * than to watch. Refusing is the kinder answer, and the show is
                 * built to run silently — bubbles, no voices — without anything
                 * else changing.
                 */
                // Typed here rather than by pulling in @webgpu/types: one
                // optional property and one method is the whole of what this
                // file knows about WebGPU, and a dependency for that would be
                // larger than the thing it describes.
                const gpu = (navigator as Navigator & {
                    gpu?: { requestAdapter(): Promise<unknown | null> };
                }).gpu;
                const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
                if (!adapter) {
                    throw new Error(
                        "this browser has no WebGPU, and on the CPU the voices generate slower than " +
                        "they speak — so the play runs with bubbles and no speech");
                }
                /*
                 * Narrowed to what this file uses, and the voice id widened
                 * back to a string on the way through.
                 *
                 * Kokoro types the voice as a union of its own ids, which is
                 * exactly the wrong shape here: the id arrives from a saved
                 * document or from an agent, so it is a string until something
                 * checks it — and the thing that checks it is `findVoice`, one
                 * call above this. A union at the boundary would only move the
                 * cast, not remove it.
                 */
                tts = await KokoroTTS.from_pretrained(
                    MODEL, { dtype: DTYPE, device: "webgpu" }) as unknown as KokoroLike;
                state = "ready";
                return tts;
            } catch (error) {
                state = "unavailable";
                trouble = error instanceof Error ? error.message : String(error);
                return null;
            } finally {
                loading = null;
            }
        })();
        return loading;
    };

    const say = async (model: KokoroLike, line: Line): Promise<void> => {
        const at = key(line.text, line.voice);
        if (spoken.has(at)) return;
        const voice = findVoice(line.voice) ? line.voice : DEFAULT_VOICE;
        const audio = await model.generate(line.text, { voice });
        // Held as a blob rather than as samples. The player wants a URL an
        // <audio> element can take, and every other sound in the show is
        // already played that way — one path through the speaker, not two.
        const blob = audio.toBlob();
        spoken.set(at, {
            url: URL.createObjectURL(blob),
            seconds: audio.audio.length / audio.sampling_rate,
        });
        // A Map iterates in insertion order, so the first key is the oldest.
        // Revoked as it goes, because deleting the entry alone would drop the
        // only reference to a URL that keeps its blob alive regardless.
        while (spoken.size > KEEP) {
            const oldest = spoken.keys().next();
            if (oldest.done) break;
            URL.revokeObjectURL(spoken.get(oldest.value)!.url);
            spoken.delete(oldest.value);
        }
    };

    return {
        get state() {
            return state;
        },

        get trouble() {
            return trouble;
        },

        warm() {
            if (state === "unavailable") return;
            void load();
        },

        async learn(lines) {
            const wanted = lines.filter(line =>
                line.text.trim() && !spoken.has(key(line.text, line.voice)));
            if (!wanted.length) return;

            const model = await load();
            if (!model) return;

            state = "working";
            // Chained onto whatever is already going, so two overlapping calls
            // to learn — a show started while a scene is still being prepared —
            // do not put two generations through the model at once.
            queue = queue.then(async () => {
                for (const line of wanted) {
                    try {
                        await say(model, line);
                    } catch (error) {
                        // One line that will not synthesise is one line without
                        // a voice, not a play without a soundtrack. It falls
                        // back to reading time and a silent bubble, which is
                        // where every line was a moment ago.
                        //
                        // Said out loud as well as remembered. Inference can
                        // fail per-line long after the model loaded happily —
                        // WebGPU sessions in particular create fine and then
                        // throw on generate — and without this the whole
                        // failure mode is "no audio, no errors, forever".
                        trouble = error instanceof Error ? error.message : String(error);
                        console.warn(
                            `[voice] could not speak "${line.text.slice(0, 40)}" as ${line.voice}:`, error);
                    }
                }
            });
            await queue;
            if (state === "working") state = "ready";
        },

        lengthOf(text, voice) {
            const found = spoken.get(key(text, voice));
            return found ? Math.round(found.seconds * 1000) : null;
        },

        lineFor(text, voice) {
            return spoken.get(key(text, voice)) ?? null;
        },

        forget() {
            for (const line of spoken.values()) URL.revokeObjectURL(line.url);
            spoken.clear();
        },
    };
}

/**
 * As much of Kokoro as this file uses.
 *
 * Written out rather than imported, so the type does not drag the library into
 * the main bundle — a type-only import of a package this size is a build-time
 * fetch of the whole dependency tree, and the point of the dynamic import above
 * is that nobody pays for it until they want it.
 */
interface KokoroLike {
    generate(text: string, options: { voice: string }): Promise<{
        audio: Float32Array;
        sampling_rate: number;
        toBlob(): Blob;
    }>;
}
