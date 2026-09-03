import { estimateSubtitleTextDuration, timeSubtitleTokens, type TimedToken } from "./timing.js";
import { pronounceToken, type ConsonantPhone, type VowelPhone } from "./phonemes.js";
import type { VowelKind } from "./vowels.js";

export const ARTICULATIONS = ["super-coarse", "coarse", "word", "syllable"] as const;
export type Articulation = (typeof ARTICULATIONS)[number];

export interface GibberishVoiceOptions {
    speed: number;
    /** -1 low/masculine, +1 high/feminine. */
    pitch: number;
    /** -1 young/clear, +1 old/rough. */
    age: number;
    /** -1 warm/dark, +1 bright/nasal. */
    timbre: number;
    /** -1 light/small, +1 deep/large. */
    depth: number;
    breathiness: number;
    /** 0 tightly joined, 1 clearly separated words and sentences. */
    pause: number;
    /** 0 even timing, 1 expressive, 2 exaggerated stress timing. */
    rhythm: number;
    /** 0 neutral/flat vowels, 1 natural separation, 2 exaggerated. */
    vowelSpread: number;
    /** 0 original resonances, 3 increasingly focused/non-overlapping formants. */
    smoothing: number;
    /** 0 lean glottal source, 2 dense low/mid harmonic source. */
    fullness: number;
    /** 0 still mouth, 2 exaggerated rhythmic jaw-driven babble. */
    babble: number;
    /** How many mouth/vowel gestures survive inside each word. */
    articulation: Articulation;
    /** High-pass cutoff in Hz. */
    rumbleCut: number;
    /** 0 uncompressed, 1 heavily compressed. */
    compression: number;
    /** Gain applied before compression and limiting. */
    drive: number;
    volume: number;
}

export const DEFAULT_GIBBERISH_VOICE: GibberishVoiceOptions = Object.freeze({
    speed: 1.7,
    pitch: 0,
    age: 0,
    timbre: -1,
    depth: -1,
    breathiness: 1,
    pause: 0.06,
    rhythm: 1.8,
    vowelSpread: 0.2,
    smoothing: 0,
    fullness: 0.65,
    babble: 1,
    articulation: "syllable",
    rumbleCut: 60,
    compression: 0.42,
    drive: 1,
    volume: 0.7,
});

export interface GibberishPlayback {
    readonly duration: number;
    stop(): void;
    finished: Promise<void>;
}

type ContextWithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };

let sharedContext: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function context(): AudioContext {
    if (sharedContext) return sharedContext;
    const Constructor = window.AudioContext ?? (window as ContextWithWebkit).webkitAudioContext;
    if (!Constructor) throw new Error("Web Audio is not available in this browser.");
    sharedContext = new Constructor();
    return sharedContext;
}

function noise(ctx: AudioContext): AudioBuffer {
    if (noiseBuffer?.sampleRate === ctx.sampleRate) return noiseBuffer;
    const length = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index++) {
        // A little correlation keeps this from sounding like a radio fault.
        last = last * 0.18 + (Math.random() * 2 - 1) * 0.82;
        data[index] = last;
    }
    return noiseBuffer;
}

/** Typical adult formant centres, used as a vowel-space rather than speech. */
const FORMANTS: Record<VowelKind, readonly [number, number, number, number]> = {
    // Deliberately use the outer edges of the F1/F2 vowel space. Natural
    // averages overlap too much once a tiny high-pitched source is involved.
    // F3/F4 are intentionally shared: they mostly encode the speaker's vocal
    // tract identity, while F1/F2 carry the vowel. Moving all four bands as
    // vowel targets made /i/, /a/, and /u/ sound like different people.
    i: [250, 2500, 2850, 3600],
    e: [440, 2000, 2850, 3600],
    a: [850, 1250, 2850, 3600],
    o: [550, 800, 2850, 3600],
    u: [260, 600, 2850, 3600],
};

// F1 and F2 carry most vowel identity. Keeping them similarly prominent makes
// the five corners of the vowel space much easier to hear than a bass-heavy mix.
const BAND_GAINS = [0.9, 1.05, 0.3, 0.14] as const;
const BANDWIDTHS = [78, 105, 175, 250] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Formant target exposed for deterministic acoustic checks and visualizers. */
export function vowelFormants(kind: VowelKind): readonly [number, number, number, number] {
    return FORMANTS[kind];
}

const NEUTRAL_VOWEL = [500, 1500, 2850, 3600] as const;

/** Vowel-space interpolation; upper speaker-identity formants never move. */
export function spreadVowelFormants(
    kind: VowelKind,
    amount = DEFAULT_GIBBERISH_VOICE.vowelSpread,
): readonly [number, number, number, number] {
    const strength = clamp(amount, 0, 2);
    const source = FORMANTS[kind];
    const first = clamp(NEUTRAL_VOWEL[0] + (source[0] - NEUTRAL_VOWEL[0]) * strength, 120, 1500);
    const secondTarget = clamp(NEUTRAL_VOWEL[1] + (source[1] - NEUTRAL_VOWEL[1]) * strength, 450, 5000);
    const second = Math.max(first + 180, secondTarget);
    return [first, second, NEUTRAL_VOWEL[2], NEUTRAL_VOWEL[3]];
}

/** Portion of a token that is guaranteed silent before the following word. */
export function wordReleaseGap(tokenDuration: number, amount = DEFAULT_GIBBERISH_VOICE.pause, punctuation = ""): number {
    const safeDuration = Math.max(0.001, tokenDuration);
    const strength = clamp(amount, 0, 1);
    const punctuationScale = /[.!?]/.test(punctuation) ? 1.55 : /[,;:]/.test(punctuation) ? 1.25 : 1;
    const maximumFraction = Math.min(0.78, (0.12 + strength * 0.48) * punctuationScale);
    return Math.min(strength * 0.22 * punctuationScale, safeDuration * maximumFraction);
}

export function normalizeGibberishVoice(input: Partial<GibberishVoiceOptions> = {}): GibberishVoiceOptions {
    const requestedArticulation = input.articulation
        // Migrate the short-lived boolean saved by the first workbench pass.
        ?? ((input as Partial<GibberishVoiceOptions> & { reduceSyllables?: boolean }).reduceSyllables ? "word" : undefined);
    return {
        speed: clamp(Number(input.speed ?? DEFAULT_GIBBERISH_VOICE.speed), 0.35, 2.5),
        pitch: clamp(Number(input.pitch ?? DEFAULT_GIBBERISH_VOICE.pitch), -1, 1),
        age: clamp(Number(input.age ?? DEFAULT_GIBBERISH_VOICE.age), -1, 1),
        timbre: clamp(Number(input.timbre ?? DEFAULT_GIBBERISH_VOICE.timbre), -1, 1),
        depth: clamp(Number(input.depth ?? DEFAULT_GIBBERISH_VOICE.depth), -1, 1),
        breathiness: clamp(Number(input.breathiness ?? DEFAULT_GIBBERISH_VOICE.breathiness), 0, 1),
        pause: clamp(Number(input.pause ?? DEFAULT_GIBBERISH_VOICE.pause), 0, 1),
        rhythm: clamp(Number(input.rhythm ?? DEFAULT_GIBBERISH_VOICE.rhythm), 0, 2),
        vowelSpread: clamp(Number(input.vowelSpread ?? DEFAULT_GIBBERISH_VOICE.vowelSpread), 0, 2),
        smoothing: clamp(Number(input.smoothing ?? DEFAULT_GIBBERISH_VOICE.smoothing), 0, 3),
        fullness: clamp(Number(input.fullness ?? DEFAULT_GIBBERISH_VOICE.fullness), 0, 2),
        babble: clamp(Number(input.babble ?? DEFAULT_GIBBERISH_VOICE.babble), 0, 2),
        articulation: ARTICULATIONS.includes(requestedArticulation as Articulation)
            ? requestedArticulation as Articulation
            : DEFAULT_GIBBERISH_VOICE.articulation,
        rumbleCut: clamp(Number(input.rumbleCut ?? DEFAULT_GIBBERISH_VOICE.rumbleCut), 60, 600),
        compression: clamp(Number(input.compression ?? DEFAULT_GIBBERISH_VOICE.compression), 0, 1),
        drive: clamp(Number(input.drive ?? DEFAULT_GIBBERISH_VOICE.drive), 0.35, 2),
        volume: clamp(Number(input.volume ?? DEFAULT_GIBBERISH_VOICE.volume), 0, 1),
    };
}

/** Public for the UI visualizer and unit tests. */
export function voiceAcoustics(input: Partial<GibberishVoiceOptions> = {}) {
    const options = normalizeGibberishVoice(input);
    // The pad should span characters, not merely variations of one voice.
    // These are about 2.5x the previous pitch/age excursions in log-frequency.
    const agePitch = options.age < 0 ? -options.age * 0.28 : -options.age * 0.15;
    const fundamental = 145 * Math.pow(2, options.pitch * 1.15 + agePitch);
    // A deeper/older vocal tract lowers all resonances. Raising formants as
    // aggressively as F0 made the upper half of the pad turn thin and sharp;
    // F0 already carries most of that high-voice identity.
    const pitchTract = options.pitch < 0 ? options.pitch * 0.2 : options.pitch * 0.08;
    const tractScale = Math.pow(2, pitchTract - options.depth * 0.13 - options.age * 0.1);
    // A high F0 places much stronger low-numbered harmonics under the formant
    // filters; a low F0 does the opposite. Compensate that source/filter energy
    // shift so moving around the character pad does not act like a volume knob.
    const neutralTractScale = Math.pow(2, -options.depth * 0.13);
    const levelCompensation = clamp(
        Math.pow(145 / fundamental, 0.82) * Math.pow(neutralTractScale / tractScale, 0.3),
        0.42,
        2.2,
    );
    return { fundamental, tractScale, levelCompensation, options };
}

export interface VowelVoiceProfile {
    /** One coherent vocal-tract transform applied to every vowel band. */
    scale: number;
    formants: readonly [number, number, number, number];
    bandwidths: readonly [number, number, number, number];
    gains: readonly [number, number, number, number];
}

function profileForVowel(kind: VowelKind, acoustics: ReturnType<typeof voiceAcoustics>): VowelVoiceProfile {
    const { fundamental, tractScale, options } = acoustics;
    // Timbre moves the whole tract a little. The former per-band frequency
    // offsets warped different vowels by different amounts at axis extremes.
    const scale = tractScale * Math.pow(2, options.timbre * 0.035);
    const oldVoiceBroadening = 1 + Math.max(0, options.age) * 0.55;
    const formants = spreadVowelFormants(kind, options.vowelSpread)
        .map(value => value * scale) as unknown as VowelVoiceProfile["formants"];
    const highVoice = Math.max(0, options.pitch);
    const bandwidths = BANDWIDTHS.map(value => Math.max(
        value * scale * oldVoiceBroadening,
        // High/young voices have widely spaced harmonics. A bandwidth at
        // least one F0 wide guarantees that every formant receives a nearby
        // harmonic instead of randomly vanishing between pitch steps.
        // Cover the largest normal intonation lift too; otherwise the
        // spectral envelope changes character during a question arc.
        fundamental * (1.3 + highVoice * 0.38),
    )) as unknown as VowelVoiceProfile["bandwidths"];
    const gains = BAND_GAINS.map((value, band) => (
        value
        * (1 + options.timbre * (band - 1.2) * 0.12)
        // Sparse upper harmonics become isolated whistle-like points at high
        // F0. Tilt them down while returning a little body to F1/F2.
        * (band === 0
            ? 1 + highVoice * 0.08
            : band === 1
                ? 1 + highVoice * 0.05
                : band === 2
                    ? 1 - highVoice * 0.2
                    : 1 - highVoice * 0.36)
    )) as unknown as VowelVoiceProfile["gains"];
    return { scale, formants, bandwidths, gains };
}

/** Complete vowel filter profile for checking or visualizing a voice preset. */
export function vowelVoiceProfile(
    kind: VowelKind,
    input: Partial<GibberishVoiceOptions> = {},
): VowelVoiceProfile {
    return profileForVowel(kind, voiceAcoustics(input));
}

/**
 * Resonance settings for one formant band. In this parallel four-band graph,
 * widening the bands made them overlap and produced the metallic interaction
 * the control was meant to remove. Increasing the control therefore focuses
 * the bands away from one another while gently trimming their peak energy.
 * This does not average vowels, pitch, rhythm, or word boundaries.
 */
export function dampedFormant(
    frequency: number,
    bandwidth: number,
    amount: number,
    band = 0,
): { q: number; gain: number } {
    const damping = clamp(amount, 0, 3);
    const rawQ = frequency / Math.max(1, bandwidth);
    if (damping === 0) return { q: rawQ, gain: 1 };
    const focusedQ = rawQ * (1 + damping * (0.2 + clamp(band, 0, 3) * 0.025));
    return {
        q: clamp(focusedQ, 0.42, 28),
        gain: 1 / (1 + damping * (band < 2 ? 0.045 : 0.075)),
    };
}

/** Jaw/open-close motion used by the Babble control; deliberately noise-free. */
export function babbleMotion(input: Partial<GibberishVoiceOptions> = {}) {
    const options = normalizeGibberishVoice(input);
    const amount = options.babble;
    return {
        amount,
        rateHz: (3.55 + amount * 0.42) * Math.sqrt(options.speed),
        gainDepth: Math.min(0.3, amount * 0.15),
        firstFormantHz: amount * 78,
        secondFormantHz: amount * -42,
    };
}

/** WebAudio processing values derived from the compact UI controls. */
export function voiceProcessing(input: Partial<GibberishVoiceOptions> = {}) {
    const options = normalizeGibberishVoice(input);
    const amount = options.compression;
    return {
        rumbleCut: options.rumbleCut,
        drive: options.drive,
        threshold: -8 - amount * 28,
        knee: 4 + amount * 19,
        ratio: 1 + amount * 26,
        attack: 0.0015 + (1 - amount) * 0.004,
        release: 0.045 + amount * 0.085,
    };
}

/** Relative glottal harmonic amplitude, exposed for acoustic regression tests. */
export function harmonicAmplitude(harmonic: number, softness: number, fullness: number): number {
    const number = Math.max(1, Math.round(harmonic));
    const body = clamp(fullness, 0, 2);
    const tilt = 1.22 + clamp(softness, 0, 1.5) * 0.72 - body * 0.16;
    // Fill harmonics 2–9, which feed the formants, without adding a sub-bass
    // oscillator (and therefore without bringing the old rumble back).
    const lowMidBody = 1 + body * 0.5 * Math.exp(-Math.pow((number - 4.5) / 3.5, 2));
    return lowMidBody / Math.pow(number, tilt);
}

function periodicWave(ctx: AudioContext, softness: number, fullness: number): PeriodicWave {
    const harmonics = 40;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
        // Rosenberg-ish glottal tilt: a buzz rich enough for the filters to carve.
        // "Breath" changes spectral tilt only. Noise in this path was both
        // unpleasant and counterproductive for vowel recognition.
        imag[harmonic] = harmonicAmplitude(harmonic, softness, fullness);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

let softLimitCurve: Float32Array<ArrayBuffer> | null = null;

function limiterCurve(): Float32Array<ArrayBuffer> {
    if (softLimitCurve) return softLimitCurve;
    const curve = new Float32Array(2049);
    for (let index = 0; index < curve.length; index++) {
        const input = index / (curve.length - 1) * 2 - 1;
        const magnitude = Math.abs(input);
        const limited = magnitude <= 0.76
            ? magnitude
            : 0.76 + 0.24 * Math.tanh((magnitude - 0.76) / 0.24);
        curve[index] = Math.sign(input) * limited;
    }
    softLimitCurve = curve;
    return curve;
}

interface GainSchedule {
    value: number;
    setValueAtTime(value: number, startTime: number): unknown;
}

/** Prevent a future envelope from leaking its default gain before it begins. */
export function beginSilent(gain: GainSchedule, at: number): void {
    gain.value = 0;
    gain.setValueAtTime(0, at);
}

export interface PitchPoint {
    at: number;
    multiplier: number;
}

/**
 * A broad prosody contour inferred from visible sentence structure.
 * Questions lift, statements settle, exclamations peak and resolve, while
 * commas remain open. Longer words receive a small stress arch of their own.
 */
const strongest = (vowels: VowelPhone[]): VowelPhone =>
    vowels.reduce((best, vowel) => vowel.stress > best.stress ? vowel : best);

const broadVowel = (kind: VowelKind): VowelKind => kind === "a" ? "a"
    : kind === "e" || kind === "i" ? "i" : "u";

function articulateNuclei(vowels: VowelPhone[], articulation: Articulation): VowelPhone[] {
    if (!vowels.length || articulation === "syllable") return vowels;
    const first = vowels[0];
    const last = vowels.at(-1)!;
    const kind = articulation === "super-coarse" ? broadVowel(first.kind) : first.kind;
    const finalKind = articulation === "super-coarse"
        ? broadVowel(last.glide ?? last.kind)
        : last.glide ?? last.kind;
    // A reduced word is a single *moving* mouth gesture from its first vowel
    // toward its last, rather than one static dominant resonance stretched
    // across the full word. Static long formants were the metallic ringing in
    // the first implementation.
    return [{
        ...first,
        symbol: articulation === "super-coarse" ? kind.toUpperCase() : first.symbol,
        stress: strongest(vowels).stress,
        kind,
        glide: finalKind === kind ? undefined : finalKind,
    }];
}

export function wordNuclei(token: string, articulation: Articulation = "syllable"): VowelPhone[] {
    const vowels = pronounceToken(token).phones.filter((value): value is VowelPhone => value.type === "vowel");
    return articulateNuclei(vowels, articulation);
}

export interface ArticulationGroup {
    /** Inclusive token index. */
    start: number;
    /** Exclusive token index. */
    end: number;
    nuclei: VowelPhone[];
}

/**
 * Divide a phrase into actual audible gestures. Syllable and word modes keep
 * word boundaries; coarse combines pairs; super-coarse is exactly one gesture
 * per sentence. Groups never cross sentence punctuation.
 */
export function articulationGroups(tokens: readonly string[], articulation: Articulation): ArticulationGroup[] {
    const result: ArticulationGroup[] = [];
    let phraseStart = 0;
    while (phraseStart < tokens.length) {
        const relativeEnd = tokens.slice(phraseStart).findIndex(token => /[.!?]+["')\]]*$/.test(token));
        const phraseEnd = relativeEnd < 0 ? tokens.length - 1 : phraseStart + relativeEnd;
        const groupSize = articulation === "super-coarse"
            ? phraseEnd - phraseStart + 1
            : articulation === "coarse" ? 2 : 1;
        for (let start = phraseStart; start <= phraseEnd; start += groupSize) {
            const end = Math.min(phraseEnd + 1, start + groupSize);
            const vowels = tokens.slice(start, end).flatMap(token => wordNuclei(token));
            result.push({ start, end, nuclei: articulateNuclei(vowels, articulation) });
        }
        phraseStart = phraseEnd + 1;
    }
    return result;
}

export function sentencePitchContour(
    tokens: TimedToken[],
    pause = DEFAULT_GIBBERISH_VOICE.pause,
    articulation: Articulation = "syllable",
): PitchPoint[] {
    if (!tokens.length) return [{ at: 0, multiplier: 1 }];
    if (articulation === "coarse" || articulation === "super-coarse") {
        return articulationGroups(tokens.map(token => token.text), articulation).flatMap(group => {
            const first = tokens[group.start];
            const last = tokens[group.end - 1];
            const lastDuration = Math.max(0.02, last.end - last.start);
            const end = Math.max(first.start + 0.01, last.end - wordReleaseGap(lastDuration, pause, last.text));
            const span = end - first.start;
            const prominence = Math.max(...tokens.slice(group.start, group.end).map(token => token.prominence ?? 1));
            const base = 1.01 + (prominence - 1) * 0.07;
            const finish = /[?]+["')\]]*$/.test(last.text) ? 1.17
                : /[!]+["')\]]*$/.test(last.text) ? 0.93
                    : /[.]+["')\]]*$/.test(last.text) ? 0.86 : base - 0.055;
            // One gesture means one contour: rise once, then resolve once.
            return [
                { at: first.start, multiplier: base - 0.035 },
                { at: first.start + span * 0.43, multiplier: base + 0.105 },
                { at: end, multiplier: finish },
            ];
        });
    }
    const points: PitchPoint[] = [];
    const nucleiByToken = tokens.map(token => wordNuclei(token.text, articulation));
    let sentenceStart = 0;
    let sentenceEndIndex = tokens.findIndex(token => /[.!?]+["')\]]*$/.test(token.text));
    if (sentenceEndIndex < 0) sentenceEndIndex = tokens.length - 1;

    tokens.forEach((token, index) => {
        if (index > sentenceEndIndex) {
            sentenceStart = index;
            const relativeEnd = tokens.slice(index).findIndex(value => /[.!?]+["')\]]*$/.test(value.text));
            sentenceEndIndex = relativeEnd < 0 ? tokens.length - 1 : index + relativeEnd;
        }
        const first = tokens[sentenceStart].start;
        const last = Math.max(first + 0.01, tokens[sentenceEndIndex].end);
        const progress = clamp((token.start - first) / (last - first), 0, 1);
        const tokenDuration = Math.max(0.02, token.end - token.start);
        const voicedEnd = Math.max(token.start + 0.01, token.end - wordReleaseGap(tokenDuration, pause, token.text));
        const voicedDuration = voicedEnd - token.start;
        const vowels = nucleiByToken[index];
        const syllables = vowels.length || 1;
        // Speech tends to gather energy through the middle of a phrase and
        // relax toward its end. The broad arch sits underneath the smaller
        // syllable gestures and punctuation contour below.
        const phraseArc = Math.sin(progress * Math.PI) * 0.052;
        const prominenceLift = ((token.prominence ?? 1) - 1) * 0.085;
        const base = 1.055 + phraseArc - progress * 0.12 + prominenceLift;
        // Stable per-word irregularity avoids a mechanical up/down loop while
        // keeping the same character deterministic on every playback.
        let hash = 0;
        for (const character of token.text) hash = (hash * 31 + character.codePointAt(0)!) | 0;
        const wordLift = ((Math.abs(hash) % 17) - 8) * 0.0035;

        vowels.forEach((vowel, syllable) => {
            const syllableStart = token.start + voicedDuration * (syllable / syllables);
            const syllableEnd = token.start + voicedDuration * ((syllable + 1) / syllables);
            const cadence = syllable % 2 === 0 ? 0.018 : -0.014;
            const stressLift = vowel.stress === 1 ? 0.095 : vowel.stress === 2 ? 0.058 : 0.024;
            const level = base + wordLift + cadence;
            points.push({ at: syllableStart, multiplier: level - 0.025 });
            points.push({ at: syllableStart + (syllableEnd - syllableStart) * 0.42, multiplier: level + stressLift });
            if (syllable < syllables - 1) points.push({ at: syllableEnd, multiplier: level - 0.035 });
        });

        if (/[?]+["')\]]*$/.test(token.text)) {
            points.push({ at: voicedEnd, multiplier: 1.24 });
        } else if (/[!]+["')\]]*$/.test(token.text)) {
            points.push({ at: token.start + voicedDuration * 0.72, multiplier: 1.18 });
            points.push({ at: voicedEnd, multiplier: 0.94 });
        } else if (/[.]+["')\]]*$/.test(token.text)) {
            points.push({ at: voicedEnd, multiplier: 0.82 });
        } else if (/[,;:]+["')\]]*$/.test(token.text)) {
            points.push({ at: voicedEnd, multiplier: 1.065 });
        } else {
            points.push({ at: voicedEnd, multiplier: base + wordLift - 0.028 });
        }
    });
    return points.sort((a, b) => a.at - b.at);
}

function scheduleSyllable(
    ctx: AudioContext,
    destination: AudioNode,
    voicedSource: AudioNode,
    vowel: VowelPhone,
    at: number,
    duration: number,
    index: number,
    acoustics: ReturnType<typeof voiceAcoustics>,
    wordOnset: boolean,
    profile: VowelVoiceProfile,
    jawOscillator: OscillatorNode | null,
) {
    const reduced = acoustics.options.articulation !== "syllable";
    const attack = Math.min(reduced ? 0.038 : 0.022, duration * (reduced ? 0.3 : 0.22));
    const release = Math.min(reduced ? 0.044 : 0.028, duration * (reduced ? 0.32 : 0.24));
    const glideProfile = vowel.glide ? profileForVowel(vowel.glide, acoustics) : null;
    const mouthMotion = babbleMotion(acoustics.options);

    FORMANTS[vowel.kind].forEach((baseFrequency, band) => {
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        const frequency = clamp(profile.formants[band], 100, ctx.sampleRate * 0.45);
        filter.frequency.setValueAtTime(frequency, at);
        const glideFrequency = glideProfile
            ? glideProfile.formants[band]
            : frequency * (1 + Math.sin(index + band) * 0.012);
        // Hold the vowel's identity before moving through a diphthong. A ramp
        // across the entire nucleus left every vowel sounding like the middle.
        filter.frequency.setValueAtTime(frequency, at + duration * (vowel.glide ? 0.52 : 0.72));
        filter.frequency.linearRampToValueAtTime(clamp(glideFrequency, 100, ctx.sampleRate * 0.45), at + duration);
        const resonance = dampedFormant(
            frequency,
            profile.bandwidths[band],
            acoustics.options.smoothing,
            band,
        );
        filter.Q.value = resonance.q;
        if (jawOscillator && band < 2) {
            const jawFormant = ctx.createGain();
            jawFormant.gain.value = band === 0 ? mouthMotion.firstFormantHz : mouthMotion.secondFormantHz;
            jawOscillator.connect(jawFormant).connect(filter.frequency);
        }
        const colour = ctx.createGain();
        // Long, reduced gestures expose the upper resonances much more than
        // short syllables do. A gentle upper-band tilt keeps them vocal rather
        // than bell-like without changing the normal syllable sound.
        const reducedUpperTilt = reduced ? [1, 0.97, 0.82, 0.67][band] : 1;
        const colourGain = profile.gains[band] * resonance.gain * reducedUpperTilt;
        const onsetMix = lowFormantOnsetMix(baseFrequency, wordOnset);
        colour.gain.value = colourGain;
        if (onsetMix < 1) {
            // Closed vowels expose a strong F1/fundamental resonance if their
            // lowest band arrives all at once. Let F2 establish /i/ or /u/
            // first, then blend F1 in behind it.
            colour.gain.setValueAtTime(colourGain * onsetMix, at);
            colour.gain.linearRampToValueAtTime(colourGain, at + Math.min(0.045, duration * 0.38));
        }
        const envelope = ctx.createGain();
        // AudioParams retain their default value before their first scheduled
        // event. Without this assignment, every future vowel leaked at gain 1.
        beginSilent(envelope.gain, at);
        const stressGain = vowel.stress === 1 ? 1.12 : vowel.stress === 2 ? 1.04 : 0.86;
        const peak = (0.64 + Math.sin(index * 1.73) * 0.055) * stressGain;
        envelope.gain.linearRampToValueAtTime(peak, at + attack);
        envelope.gain.setValueAtTime(peak * 0.92, Math.max(at + attack, at + duration - release));
        envelope.gain.linearRampToValueAtTime(0, at + duration);
        voicedSource.connect(filter).connect(colour).connect(envelope).connect(destination);
    });

}

/** Initial mix for the lowest resonance; exported for acoustic regression tests. */
export function lowFormantOnsetMix(baseFrequency: number, wordOnset: boolean): number {
    return wordOnset && baseFrequency < 340 ? 0.16 : 1;
}

/** Relative nucleus lengths for lexical stress within one word. */
export function syllableRhythmWeights(vowels: readonly VowelPhone[], amount = 1): number[] {
    const strength = clamp(amount, 0, 2);
    return vowels.map((vowel, index) => {
        const stress = vowel.stress === 1 ? 1.38 : vowel.stress === 2 ? 1.08 : 0.68;
        // A tiny iambic pulse helps rule-based words whose stress is uncertain.
        const expressive = stress * (index % 2 === 0 ? 0.98 : 1.03);
        return 1 + (expressive - 1) * strength;
    });
}

/** Whether a consonant benefits from an added noise articulation cue. */
export function usesConsonantTexture(consonant: ConsonantPhone): boolean {
    // T is already implied by the following vowel attack. TH/DH noise at a
    // word onset (notably "this") reads as a low, detached rumble instead.
    return consonant.manner !== "nasal"
        && consonant.manner !== "liquid"
        && !/^(T|TH|DH)$/.test(consonant.symbol);
}

function scheduleConsonantNoise(
    ctx: AudioContext,
    destination: AudioNode,
    consonant: ConsonantPhone,
    at: number,
    tokenDuration: number,
    timbre: number,
    sources: AudioScheduledSourceNode[],
) {
    if (!usesConsonantTexture(consonant)) return;
    const source = ctx.createBufferSource();
    source.buffer = noise(ctx);
    const articulationCut = ctx.createBiquadFilter();
    const filter = ctx.createBiquadFilter();
    articulationCut.type = "highpass";
    articulationCut.frequency.value = /^(P|B)$/.test(consonant.symbol) ? 1050 : 720;
    articulationCut.Q.value = 0.58;
    filter.type = "bandpass";
    const hiss = /^(S|Z|SH|ZH|CH|JH)$/.test(consonant.symbol);
    const breathy = /^(F|V|TH|DH|HH)$/.test(consonant.symbol);
    filter.frequency.value = (hiss ? 3900 : breathy ? 1850 : 2550) + timbre * 650;
    filter.Q.value = hiss ? 0.75 : 0.5;
    const gain = ctx.createGain();
    const fraction = consonant.manner === "affricate" ? 0.28 : consonant.manner === "fricative" ? 0.22 : 0.12;
    const end = at + Math.min(consonant.manner === "stop" ? 0.032 : 0.065, tokenDuration * fraction);
    // Consonants are only a hint of articulation. The previous phoneme pass
    // made these louder than the vowel formants and sounded like chopped noise.
    const peak = (consonant.voiced ? 0.0035 : 0.0065) * (hiss ? 1.12 : 1);
    const softenedAttack = Math.min(0.014, (end - at) * 0.4);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(peak, at + softenedAttack);
    gain.gain.linearRampToValueAtTime(0.0001, end);
    source.connect(articulationCut).connect(filter).connect(gain).connect(destination);
    source.start(at);
    source.stop(end + 0.01);
    sources.push(source);
}

export async function playGibberish(
    text: string,
    input: Partial<GibberishVoiceOptions> = {},
): Promise<GibberishPlayback> {
    if (typeof window === "undefined") throw new Error("Gibberish voice playback requires a browser.");
    const ctx = context();
    if (ctx.state === "suspended") await ctx.resume();
    const acoustics = voiceAcoustics(input);
    const processing = voiceProcessing(acoustics.options);
    const tokens = timeSubtitleTokens(text, acoustics.options.speed, acoustics.options.rhythm);
    const duration = estimateSubtitleTextDuration(text, acoustics.options.speed);
    const start = ctx.currentTime + 0.025;
    const master = ctx.createGain();
    const rumbleCut = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    const limiter = ctx.createWaveShaper();
    const fullVolume = acoustics.options.volume * 0.32 * processing.drive * acoustics.levelCompensation;
    beginSilent(master.gain, start - 0.01);
    master.gain.linearRampToValueAtTime(fullVolume, start + 0.035);
    master.gain.setValueAtTime(fullVolume, start + Math.max(0.04, duration - 0.09));
    master.gain.linearRampToValueAtTime(0, start + duration + 0.025);
    compressor.threshold.value = processing.threshold;
    compressor.knee.value = processing.knee;
    compressor.ratio.value = processing.ratio;
    compressor.attack.value = processing.attack;
    compressor.release.value = processing.release;
    limiter.curve = limiterCurve();
    limiter.oversample = "2x";
    rumbleCut.type = "highpass";
    rumbleCut.frequency.value = processing.rumbleCut;
    rumbleCut.Q.value = 0.55;
    master.connect(rumbleCut).connect(compressor).connect(limiter).connect(ctx.destination);
    const highVoiceSoftening = Math.max(0, acoustics.options.pitch) * 0.12;
    const wave = periodicWave(ctx, acoustics.options.breathiness + highVoiceSoftening, acoustics.options.fullness);
    const sources: AudioScheduledSourceNode[] = [];
    const voiceSource = ctx.createOscillator();
    voiceSource.setPeriodicWave(wave);
    const pitch = sentencePitchContour(tokens, acoustics.options.pause, acoustics.options.articulation);
    voiceSource.frequency.setValueAtTime(acoustics.fundamental * (pitch[0]?.multiplier ?? 1), start);
    let lastPitchAt = start;
    for (const point of pitch) {
        const at = Math.max(lastPitchAt + 0.001, start + point.at);
        // Exponential frequency ramps interpolate in perceptual pitch space,
        // producing a connected spoken curve instead of straight Hz sweeps.
        voiceSource.frequency.exponentialRampToValueAtTime(acoustics.fundamental * point.multiplier, at);
        lastPitchAt = at;
    }

    const roughness = ctx.createOscillator();
    const roughGain = ctx.createGain();
    roughness.frequency.value = 19 + Math.max(0, acoustics.options.age) * 15;
    roughGain.gain.value = acoustics.fundamental * (0.001 + Math.max(0, acoustics.options.age) * 0.021);
    roughness.connect(roughGain).connect(voiceSource.frequency);

    // Canonical babbling is dominated by rhythmic jaw open/close frames. One
    // low-frequency oscillator moves mouth loudness and F1/F2 together, so the
    // result reads as mouth articulation rather than added hiss or static.
    const mouthMotion = babbleMotion(acoustics.options);
    // A coarse gesture must have one amplitude shape as well as one pitch
    // shape. The regular babble oscillator would carve a sustained sentence
    // back into several audible pulses and defeat the mode.
    const groupedArticulation = acoustics.options.articulation === "coarse"
        || acoustics.options.articulation === "super-coarse";
    const jawOscillator = mouthMotion.amount > 0 && !groupedArticulation ? ctx.createOscillator() : null;
    const mouthGain = ctx.createGain();
    mouthGain.gain.value = 1;
    voiceSource.connect(mouthGain);
    if (jawOscillator) {
        const jawGain = ctx.createGain();
        jawOscillator.frequency.value = mouthMotion.rateHz;
        jawGain.gain.value = mouthMotion.gainDepth;
        jawOscillator.connect(jawGain).connect(mouthGain.gain);
        jawOscillator.start(start - 0.01);
        jawOscillator.stop(start + duration + 0.06);
        sources.push(jawOscillator);
    }

    voiceSource.start(start - 0.01);
    roughness.start(start - 0.01);
    voiceSource.stop(start + duration + 0.06);
    roughness.stop(start + duration + 0.06);
    sources.push(voiceSource, roughness);
    let syllableIndex = 0;
    const groups = articulationGroups(tokens.map(token => token.text), acoustics.options.articulation);
    for (const group of groups) {
        const groupTokens = tokens.slice(group.start, group.end);
        const firstToken = groupTokens[0];
        const lastToken = groupTokens.at(-1)!;
        const phones = groupTokens.flatMap(token => pronounceToken(token.text).phones);
        const consonants = phones
            .map((value, index) => ({ value, index }))
            .filter((entry): entry is { value: ConsonantPhone; index: number } => entry.value.type === "consonant");
        const lastTokenDuration = Math.max(0.001, lastToken.end - lastToken.start);
        const gestureStart = start + firstToken.start;
        const releaseGap = wordReleaseGap(lastTokenDuration, acoustics.options.pause, lastToken.text);
        const gestureEnd = start + lastToken.end - releaseGap;
        const audibleDuration = gestureEnd - gestureStart;
        const gestureGain = ctx.createGain();
        const peakProminence = Math.max(...groupTokens.map(token => token.prominence ?? 1));
        const gestureLevel = clamp(0.86 + peakProminence * 0.14, 0.9, 1.08);
        const gestureAttack = Math.min(groupedArticulation ? 0.038 : 0.012, audibleDuration * 0.2);
        const gestureRelease = groupedArticulation ? 0.04 : 0.018;
        const holdFloor = 0.012;
        beginSilent(gestureGain.gain, gestureStart - 0.002);
        gestureGain.gain.linearRampToValueAtTime(gestureLevel, gestureStart + gestureAttack);
        gestureGain.gain.setValueAtTime(gestureLevel, Math.max(gestureStart + holdFloor, gestureEnd - gestureRelease));
        gestureGain.gain.linearRampToValueAtTime(0, gestureEnd);
        gestureGain.connect(master);

        // One onset cue plus, at most, a genuinely hissy coda. This preserves
        // the phonetic colour without turning every consonant into a click.
        const consonantCues = consonants.length > 1 && /^(S|Z|SH|ZH|TH)$/.test(consonants.at(-1)?.value.symbol ?? "")
            ? [consonants[0], consonants.at(-1)!]
            : consonants.slice(0, 1);
        consonantCues.forEach(({ value, index }) => scheduleConsonantNoise(
            ctx,
            gestureGain,
            value,
            gestureStart + audibleDuration * 0.72 * (index / Math.max(1, phones.length)),
            audibleDuration,
            acoustics.options.timbre,
            sources,
        ));
        // Fill this gesture once. In the grouped modes its single nucleus
        // spans the whole sentence/pair; word and syllable modes retain their
        // smaller allocations.
        const onsetLead = Math.min(0.01, audibleDuration * 0.08);
        const activeSpan = Math.max(0.001, audibleDuration - onsetLead);
        const nuclei = group.nuclei;
        const nucleusWeights = syllableRhythmWeights(nuclei, acoustics.options.rhythm);
        const totalNucleusWeight = nucleusWeights.reduce((sum, value) => sum + value, 0) || 1;
        let nucleusCursor = 0;
        nuclei.forEach((nucleus, index) => {
            const step = activeSpan * nucleusWeights[index] / totalNucleusWeight;
            const at = gestureStart + onsetLead + nucleusCursor;
            nucleusCursor += step;
            const voicedFor = Math.min(
                Math.max(0.008, gestureEnd - at),
                Math.max(0.018, step * 1.04),
            );
            scheduleSyllable(
                ctx,
                gestureGain,
                mouthGain,
                nucleus,
                at,
                voicedFor,
                syllableIndex++,
                acoustics,
                index === 0,
                profileForVowel(nucleus.kind, acoustics),
                jawOscillator,
            );
        });
    }

    let finishTimer: ReturnType<typeof setTimeout> | null = null;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => (finish = resolve));
    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        if (finishTimer) clearTimeout(finishTimer);
        // The lib types put cancelAndHoldAtTime on every AudioParam, so the
        // guard narrows the else branch to `never` — but Firefox still ships
        // without it at runtime, which is the whole reason the guard exists.
        if ("cancelAndHoldAtTime" in master.gain) master.gain.cancelAndHoldAtTime(ctx.currentTime);
        else (master.gain as AudioParam).cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
        const stopAt = ctx.currentTime + 0.05;
        for (const source of sources) {
            try { source.stop(stopAt); } catch { /* it already ended */ }
        }
        setTimeout(() => {
            master.disconnect();
            finish();
        }, 70);
    };
    finishTimer = setTimeout(() => {
        if (stopped) return;
        stopped = true;
        master.disconnect();
        finish();
    }, (duration + 0.15) * 1000);
    return { duration, stop, finished };
}
