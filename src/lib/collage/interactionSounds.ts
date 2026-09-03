/** Quiet, low-register handling sounds made without downloaded samples. */
export type InteractionSound = "pickup" | "putdown";

/**
 * How loud handling sounds are while the rest of the sound is off.
 *
 * These are synthesised here rather than played through the Speaker, on their
 * own AudioContext which resumes itself — so when the browser has not let the
 * music and the voices start yet, or the show is running silent, these carry
 * on at full level and become the only thing anybody hears. That is the wrong
 * way round: they are the quietest thing in the mix when everything works.
 *
 * Not silence, though. A click is the only confirmation that a piece was
 * picked up at all, and losing it because the page has not been touched yet
 * would make the drawer feel broken rather than quiet.
 */
const OFF_LEVEL = 0.3;

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    return context ??= new AudioContextClass();
}

function synthesize(ctx: AudioContext, kind: InteractionSound, level: number) {
    const now = ctx.currentTime + 0.008;
    const duration = kind === "pickup" ? 0.25 : 0.29;
    const middle = now + duration * 0.58;
    const end = now + duration;
    const pitches = kind === "pickup" ? [82, 128, 205] : [205, 122, 72];

    const output = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = kind === "pickup" ? 720 : 560;
    filter.Q.value = 0.45;
    // Every point of the envelope scales together, so the shape of the sound
    // is the same quiet and loud — a click that only lost its attack would
    // read as a different, duller sound rather than as the same one further off.
    output.gain.setValueAtTime(0.0001 * level, now);
    output.gain.exponentialRampToValueAtTime(0.018 * level, now + 0.035);
    output.gain.setValueAtTime(0.014 * level, middle);
    output.gain.exponentialRampToValueAtTime(0.0001 * level, end);
    filter.connect(output).connect(ctx.destination);

    for (const [index, mix] of [1, 0.14].entries()) {
        const oscillator = ctx.createOscillator();
        const level = ctx.createGain();
        oscillator.type = index === 0 ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(pitches[0] * (index + 1), now);
        oscillator.frequency.exponentialRampToValueAtTime(pitches[1] * (index + 1), middle);
        oscillator.frequency.exponentialRampToValueAtTime(pitches[2] * (index + 1), end);
        level.gain.value = mix;
        oscillator.connect(level).connect(filter);
        oscillator.start(now);
        oscillator.stop(end + 0.02);
    }
}

/**
 * `soundOn` is the Speaker's own state — pass `speaker.ready`. False drops
 * these to OFF_LEVEL instead of leaving them at full while nothing else in
 * the room can make a noise.
 */
export function playInteractionSound(kind: InteractionSound, soundOn = true): void {
    const ctx = getContext();
    if (!ctx) return;
    const level = soundOn ? 1 : OFF_LEVEL;
    if (ctx.state === "running") return synthesize(ctx, kind, level);
    void ctx.resume().then(() => synthesize(ctx, kind, level), () => {});
}
