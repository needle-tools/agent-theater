/** Quiet, low-register handling sounds made without downloaded samples. */
export type InteractionSound = "pickup" | "putdown";

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    return context ??= new AudioContextClass();
}

function synthesize(ctx: AudioContext, kind: InteractionSound) {
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
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.018, now + 0.035);
    output.gain.setValueAtTime(0.014, middle);
    output.gain.exponentialRampToValueAtTime(0.0001, end);
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

export function playInteractionSound(kind: InteractionSound): void {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "running") return synthesize(ctx, kind);
    void ctx.resume().then(() => synthesize(ctx, kind), () => {});
}
