/**
 * Compact copy of FastVid's subtitle timing estimator.
 * Source: git/temp/fastvid/src/lib/subtitleTiming.js
 *
 * Kept independent of FastVid's subtitle document model: this module only
 * needs its calibrated word/syllable weights and punctuation pauses.
 */

export interface TimedToken {
    text: string;
    start: number;
    end: number;
    /** Relative conversational emphasis after phrase-level rhythm is applied. */
    prominence?: number;
}

const PROFILE = Object.freeze({
    minLineSeconds: 1.2,
    minWordSeconds: 0.082,
    idealSecondsPerSpeechUnit: 0.21,
    idealSecondsPerPauseUnit: 0.16,
    defaultWordTimingUnit: 1,
    wordTimingPower: 1.05,
    minWordTimingUnits: 0.9,
    maxWordTimingUnits: 4.8,
    baseWordTimingUnits: 0.95,
    syllableTimingUnits: 0.78,
    letterTimingUnits: 0.035,
    uppercaseBoostUnits: 0.28,
    numericBoostUnits: 0.34,
    emphasisBoostUnits: 0.18,
    longWordLetterBoostUnits: 0.06,
    functionWordDiscountUnits: 0.18,
    sentencePauseUnits: 1.45,
    clausePauseUnits: 1.5,
    lightPauseUnits: 0.35,
    abbreviationUnitBoost: 1.2,
    abbreviationUnitExtraBoost: 0.3,
    sectionTailPauseSeconds: 0.28,
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeSubtitleSpeed(value: unknown, fallback = 1): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0.35, number) : fallback;
}

export function splitPreservingSpaces(text: string): string[] {
    return String(text ?? "").match(/\s*\S+/g) ?? [];
}

const cleanWord = (token: string) => String(token ?? "")
    .replace(/^\s+/, "")
    .replace(/[.,!?;:()[\]{}"']/g, "");

const cleanPronunciationToken = (token: string) => String(token ?? "")
    .replace(/^\s+/, "")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");

/** FastVid's intentionally English-biased syllable estimate. */
function estimateSyllables(word: string): number {
    const normalized = word.toLowerCase()
        .replace(/(?:[^a-z0-9]|_)+/g, "")
        .replace(/(?:'s|’s)$/g, "");
    if (!normalized) return 1;
    if (/\d/.test(normalized)) return Math.max(1, Math.ceil(normalized.length / 3));
    if (normalized.length <= 3) return 1;
    const silentETail = /(?:[^laeiouy]e)$/.test(normalized);
    const leEndingBoost = /[^aeiouy]le$/.test(normalized) ? 1 : 0;
    const groups = normalized.replace(/e$/, "").match(/[aeiouy]+/g) ?? [];
    return Math.max(1, groups.length - (silentETail ? 1 : 0) + leEndingBoost);
}

function pauseUnits(token: string): number {
    if (/[.!?]+["')\]]*$/.test(token)) return PROFILE.sentencePauseUnits;
    if (/[,:;]+["')\]]*$/.test(token)) return PROFILE.clausePauseUnits;
    if (/[-/]+["')\]]*$/.test(token)) return PROFILE.lightPauseUnits;
    return 0;
}

function abbreviationUnits(token: string): number {
    const raw = cleanPronunciationToken(token);
    if (!raw || raw.length < 2 || raw.length > 8) return 0;
    const letters = raw.replace(/[^A-Za-z]/g, "");
    if (letters.length < 2) return 0;
    const uppers = letters.match(/[A-Z]/g) ?? [];
    const dotted = /^(?:[A-Za-z]\.){2,}[A-Za-z]?\.?$/.test(token.trim());
    const allCaps = uppers.length === letters.length && letters.length <= 5;
    const brand = /^[a-z]+[A-Z]{2,}$/.test(raw);
    const titleWithUpperTail = /^[A-Z][a-z]+[A-Z]{2,}$/.test(raw);
    const digit = /\d/.test(raw) && uppers.length >= 1;
    let spoken = dotted || allCaps || brand || digit
        ? letters.length + (raw.match(/\d/g)?.length ?? 0)
        : 0;
    if (titleWithUpperTail) {
        const prefix = raw.match(/^[A-Z][a-z]+/)?.[0] ?? "";
        spoken = estimateSyllables(prefix) + uppers.length - 1;
    }
    if (!spoken) return 0;
    return clamp(
        PROFILE.baseWordTimingUnits
            + spoken * PROFILE.abbreviationUnitBoost
            + Math.max(0, spoken - 2) * PROFILE.abbreviationUnitExtraBoost,
        PROFILE.minWordTimingUnits,
        PROFILE.maxWordTimingUnits,
    );
}

function wordUnits(token: string): number {
    const abbreviation = abbreviationUnits(token);
    if (abbreviation) return abbreviation;
    const word = cleanWord(token);
    const functionDiscount = /^(a|an|and|as|at|for|from|if|in|of|on|or|the|to|vs?|with|you)$/i.test(word)
        ? PROFILE.functionWordDiscountUnits
        : 0;
    return clamp(
        PROFILE.baseWordTimingUnits
            + estimateSyllables(word) * PROFILE.syllableTimingUnits
            + word.length * PROFILE.letterTimingUnits
            + (/[A-Z]{2,}/.test(word) ? PROFILE.uppercaseBoostUnits : 0)
            + (/\d/.test(word) ? PROFILE.numericBoostUnits : 0)
            + (/[!?]/.test(token) ? PROFILE.emphasisBoostUnits : 0)
            + Math.max(0, word.length - 6) * PROFILE.longWordLetterBoostUnits
            - functionDiscount,
        PROFILE.minWordTimingUnits,
        PROFILE.maxWordTimingUnits,
    );
}

function parts(token: string) {
    return {
        speech: Math.max(0, Math.pow(wordUnits(token), PROFILE.wordTimingPower) - PROFILE.defaultWordTimingUnit),
        pause: pauseUnits(token),
    };
}

const RHYTHM_FUNCTION_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do", "does",
    "for", "from", "had", "has", "have", "he", "her", "him", "his", "i", "if", "in", "is", "it", "its",
    "me", "my", "of", "on", "or", "our", "she", "that", "the", "their", "them", "they", "this", "to",
    "us", "was", "we", "were", "will", "with", "would", "you", "your",
]);

const rhythmWord = (token: string) => token.normalize("NFC").toLowerCase()
    .replaceAll("’", "'")
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");

/**
 * Give a FastVid-timed phrase a stress-timed speaking pulse without changing
 * its total duration or its punctuation pauses.
 */
function applySpeechRhythm(tokens: TimedToken[], speed: number, rhythm: number): TimedToken[] {
    const rhythmAmount = clamp(Number.isFinite(rhythm) ? rhythm : 1, 0, 2);
    let phraseStart = 0;
    while (phraseStart < tokens.length) {
        let phraseEnd = tokens.findIndex((token, index) => index >= phraseStart && /[.!?]+["')\]]*$/.test(token.text));
        if (phraseEnd < 0) phraseEnd = tokens.length - 1;
        const phrase = tokens.slice(phraseStart, phraseEnd + 1);
        const words = phrase.map(token => rhythmWord(token.text));
        const contentIndices = words
            .map((word, index) => ({ word, index }))
            .filter(({ word }) => word && !RHYTHM_FUNCTION_WORDS.has(word))
            .map(({ index }) => index);
        const focus = contentIndices.at(-1) ?? phrase.length - 1;
        let contentBeat = 0;

        const prominence = phrase.map((token, index) => {
            const word = words[index];
            const functionWord = RHYTHM_FUNCTION_WORDS.has(word);
            let value = functionWord ? 0.74 : (contentBeat++ % 2 === 0 ? 1.04 : 0.98);
            if (index === focus) value *= 1.34;
            if (index === 0 && /^(how|what|when|where|which|who|why)$/i.test(word)) value *= 1.1;
            if (index === phrase.length - 1 && /[.!?]+["')\]]*$/.test(token.text)) value *= 1.06;
            return 1 + (value - 1) * rhythmAmount;
        });

        const oldDurations = phrase.map(token => token.end - token.start);
        const originalGaps = phrase.slice(0, -1).map((token, index) => phrase[index + 1].start - token.end);
        const originalPhraseEnd = phrase.at(-1)!.end;
        const durationBudget = oldDurations.reduce((sum, duration) => sum + duration, 0);
        const floor = Math.min(0.042 / normalizeSubtitleSpeed(speed), durationBudget / phrase.length * 0.45);
        const flexibleBudget = Math.max(0, durationBudget - floor * phrase.length);
        const weighted = oldDurations.map((duration, index) => Math.max(0.001, duration - floor) * prominence[index]);
        const weightedTotal = weighted.reduce((sum, value) => sum + value, 0);
        let cursor = phrase[0].start;

        phrase.forEach((token, index) => {
            const duration = floor + (weightedTotal ? flexibleBudget * weighted[index] / weightedTotal : 0);
            token.start = cursor;
            token.end = cursor + duration;
            token.prominence = prominence[index];
            cursor = token.end + (originalGaps[index] ?? 0);
        });
        // Avoid accumulated floating-point drift at a phrase boundary.
        phrase.at(-1)!.end = originalPhraseEnd;
        phraseStart = phraseEnd + 1;
    }
    return tokens;
}

export function estimateSubtitleTextDuration(text: string, speed = 1): number {
    const tokens = splitPreservingSpaces(text);
    if (!tokens.length) return PROFILE.minLineSeconds;
    const weights = tokens.map(parts);
    const ideal = tokens.length * PROFILE.minWordSeconds
        + weights.reduce((sum, value) => sum + value.speech, 0) * PROFILE.idealSecondsPerSpeechUnit
        + weights.reduce((sum, value) => sum + value.pause, 0) * PROFILE.idealSecondsPerPauseUnit;
    return Math.max(0.05, Math.max(PROFILE.minLineSeconds, ideal + PROFILE.sectionTailPauseSeconds)
        / normalizeSubtitleSpeed(speed));
}

/** Allocate FastVid's estimated line duration back onto its visible tokens. */
export function timeSubtitleTokens(text: string, speed = 1, rhythm = 1): TimedToken[] {
    const tokens = splitPreservingSpaces(text);
    if (!tokens.length) return [];
    const lineEnd = estimateSubtitleTextDuration(text, speed);
    const cueSeconds = Math.max(0.01, lineEnd);
    const minSpeech = Math.min(cueSeconds, Math.max(0.01, PROFILE.minWordSeconds * tokens.length));
    const tail = Math.min(PROFILE.sectionTailPauseSeconds, Math.max(0, cueSeconds - minSpeech));
    const speechEnd = Math.max(0.01, lineEnd - tail);
    const minimumWord = Math.min(PROFILE.minWordSeconds, speechEnd / tokens.length);
    const remaining = Math.max(0, speechEnd - minimumWord * tokens.length);
    const weights = tokens.map(parts);
    const total = weights.reduce((sum, value) => sum + value.speech + value.pause, 0);
    const secondsPerWeight = total > 0 ? remaining / total : 0;
    let cursor = 0;
    const timed = tokens.map((text, index) => {
        const start = cursor;
        const end = index === tokens.length - 1
            ? speechEnd
            : start + minimumWord + weights[index].speech * secondsPerWeight;
        cursor = end + (index === tokens.length - 1 ? 0 : weights[index].pause * secondsPerWeight);
        return { text, start, end, prominence: 1 };
    });
    return applySpeechRhythm(timed, speed, rhythm);
}
