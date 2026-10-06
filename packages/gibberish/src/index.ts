export {
    ARTICULATIONS,
    DEFAULT_GIBBERISH_VOICE,
    normalizeGibberishVoice,
    playGibberish,
    recordGibberish,
    wordReleaseGap,
    type Articulation,
    type GibberishPlayback,
    type GibberishRecording,
    type GibberishVoiceOptions,
} from "./synth.js";
export { estimateSubtitleTextDuration, timeSubtitleTokens, type TimedToken } from "./timing.js";
