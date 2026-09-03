import {
    DEFAULT_GIBBERISH_VOICE,
    normalizeGibberishVoice,
    playGibberish,
    wordReleaseGap,
    type GibberishPlayback,
    type GibberishVoiceOptions,
} from "./synth.js";
import { estimateSubtitleTextDuration, timeSubtitleTokens, type TimedToken } from "./timing.js";

/** The complete public character-voice API. */
export interface SubtitleVoice {
    /** 0 → 1× synthesis, 1 → the 1.7× default, 2 → 2× synthesis. */
    speed: number;
    /** 0 young, 0.5 medium, 1 old. */
    age: number;
    /** 0 low, 0.5 medium, 1 high. */
    tone: number;
}

export const DEFAULT_SUBTITLE_VOICE: Readonly<SubtitleVoice> = Object.freeze({
    speed: 1,
    age: 0.5,
    tone: 0.5,
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function normalizeSubtitleVoice(voice: SubtitleVoice): SubtitleVoice {
    return {
        speed: clamp(finite(Number(voice.speed), DEFAULT_SUBTITLE_VOICE.speed), 0, 2),
        age: clamp(finite(Number(voice.age), DEFAULT_SUBTITLE_VOICE.age), 0, 1),
        tone: clamp(finite(Number(voice.tone), DEFAULT_SUBTITLE_VOICE.tone), 0, 1),
    };
}

/** Convert the deliberately tiny public voice into the internal workbench profile. */
export function subtitleVoiceOptions(voice: SubtitleVoice): GibberishVoiceOptions {
    const normalized = normalizeSubtitleVoice(voice);
    const speed = normalized.speed <= 1
        ? 1 + normalized.speed * 0.7
        : 1.7 + (normalized.speed - 1) * 0.3;
    return normalizeGibberishVoice({
        ...DEFAULT_GIBBERISH_VOICE,
        speed,
        age: normalized.age * 2 - 1,
        pitch: normalized.tone * 2 - 1,
    });
}

export interface SubtitleVoiceTiming {
    duration: number;
    tokens: TimedToken[];
    /** End of each audible word, before its scheduled silence. */
    audibleEnds: number[];
}

/** One timing plan shared by sound, bubble reveal, and scene planning. */
export function subtitleVoiceTiming(text: string, voice: SubtitleVoice): SubtitleVoiceTiming {
    const options = subtitleVoiceOptions(voice);
    const tokens = timeSubtitleTokens(text, options.speed, options.rhythm);
    return {
        duration: estimateSubtitleTextDuration(text, options.speed),
        tokens,
        audibleEnds: tokens.map(token => token.end - wordReleaseGap(
            token.end - token.start,
            options.pause,
            token.text,
        )),
    };
}

/** Character count to reveal at this point in the exact audio schedule. */
export function revealedSubtitleLength(text: string, timing: SubtitleVoiceTiming, elapsed: number): number {
    let offset = 0;
    for (const [index, token] of timing.tokens.entries()) {
        const endOffset = Math.min(text.length, offset + token.text.length);
        const audibleEnd = timing.audibleEnds[index] ?? token.end;
        if (elapsed >= audibleEnd) {
            offset = endOffset;
            continue;
        }
        if (elapsed <= token.start) return offset;
        const progress = (elapsed - token.start) / Math.max(0.001, audibleEnd - token.start);
        return Math.min(text.length, offset + Math.round(token.text.length * progress));
    }
    return text.length;
}

export interface SubtitleVoicePlayback extends GibberishPlayback {
    readonly timing: SubtitleVoiceTiming;
}

export async function playSubtitleVoice(text: string, voice: SubtitleVoice, level = 1): Promise<SubtitleVoicePlayback> {
    const timing = subtitleVoiceTiming(text, voice);
    const options = subtitleVoiceOptions(voice);
    const playback = await playGibberish(text, { ...options, volume: options.volume * level });
    return { ...playback, timing };
}

export function isSubtitleVoice(value: unknown): value is SubtitleVoice {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return [candidate.speed, candidate.age, candidate.tone]
        .every(entry => typeof entry === "number" && Number.isFinite(entry));
}
