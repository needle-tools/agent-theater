/**
 * Canned particle effects, the way the sounds are canned music.
 *
 * An agent directing a play cannot animate particles by hand — there is no
 * tool granularity for "forty bits of paper, each on its own arc" — so the
 * effects are predefined here the way the beds and stings are predefined in
 * the sound catalogue: a small named set, described well, triggered from a
 * beat. Everything is bits of PAPER, because everything on this stage is
 * paper: a magic sparkle is a little cut star, rain is torn blue slivers,
 * a puff of smoke is cream confetti. Nothing glows.
 *
 * This module is the catalogue and the choreography (pure data and maths);
 * the canvas owns the DOM. Each particle's flight is expressed relative to
 * the TARGET's box — fractions of its width and height — so the same effect
 * reads right on a mouse and on an oak.
 */

export interface EffectDef {
    id: string;
    /** For the tool schema: when a director would reach for it. */
    description: string;
    /** How long the whole effect plays. */
    seconds: number;
    count: number;
}

export const EFFECTS: EffectDef[] = [
    {
        id: "sparkles",
        description:
            "Little paper stars pop around them and wink out. Magic, a wish granted, " +
            "a potion working, something precious revealed.",
        seconds: 1.4,
        count: 14,
    },
    {
        id: "poof",
        description:
            "A burst of paper dust from their middle, gone in a blink. Appearing, " +
            "vanishing, a transformation landing — pair it with \"becomes\".",
        seconds: 0.9,
        count: 16,
    },
    {
        id: "confetti",
        description:
            "Strips of coloured paper flutter down over them. Celebration, victory, " +
            "a party, the happy ending.",
        seconds: 2.2,
        count: 26,
    },
    {
        id: "hearts",
        description: "Small paper hearts rise from them and fade. Love, gratitude, delight.",
        seconds: 1.8,
        count: 9,
    },
    {
        id: "rain",
        description:
            "Torn blue slivers fall across them. Rain, sadness, a bad day on stage.",
        seconds: 2.4,
        count: 22,
    },
];

export function findEffect(name: string): EffectDef | null {
    return EFFECTS.find(effect => effect.id === name) ?? null;
}

export function effectNames(): string[] {
    return EFFECTS.map(effect => effect.id);
}

/** The paper the bits are torn from — the packs' own palette. */
const PAPER = ["#c4463c", "#2b3a67", "#6a8a4f", "#e9ddc7", "#d9a441", "#c98da4"];

export interface Particle {
    /** Start, as fractions of the target box (0.5, 0.5 is its middle). */
    x: number;
    y: number;
    /** Where it ends up, in the same fractions. */
    dx: number;
    dy: number;
    /** Longest side, as a fraction of the target's height. */
    size: number;
    /** How much of the total run this particle waits before starting. */
    delay: number;
    /** How much of the total run its own flight takes. */
    life: number;
    spin: number;
    color: string;
    shape: "star" | "dot" | "strip" | "heart" | "sliver";
}

/**
 * The whole flock for one effect, randomised fresh per call — an effect that
 * played identically twice would read as a looping GIF, not as paper thrown.
 */
export function particlesFor(name: string): Particle[] {
    const effect = findEffect(name);
    if (!effect) return [];
    const bits: Particle[] = [];
    for (let i = 0; i < effect.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        switch (effect.id) {
            case "sparkles":
                bits.push({
                    x: 0.15 + Math.random() * 0.7,
                    y: 0.05 + Math.random() * 0.7,
                    dx: (Math.random() - 0.5) * 0.25,
                    dy: -0.1 - Math.random() * 0.2,
                    size: 0.05 + Math.random() * 0.05,
                    delay: Math.random() * 0.55,
                    life: 0.45,
                    spin: (Math.random() - 0.5) * 180,
                    color: Math.random() < 0.6 ? "#d9a441" : "#e9ddc7",
                    shape: "star",
                });
                break;
            case "poof":
                bits.push({
                    x: 0.5,
                    y: 0.45,
                    dx: Math.cos(angle) * (0.3 + Math.random() * 0.35),
                    dy: Math.sin(angle) * (0.25 + Math.random() * 0.3),
                    size: 0.045 + Math.random() * 0.06,
                    delay: Math.random() * 0.12,
                    life: 0.8,
                    spin: (Math.random() - 0.5) * 240,
                    color: Math.random() < 0.7 ? "#e9ddc7" : "#d8cdb4",
                    shape: "dot",
                });
                break;
            case "confetti":
                bits.push({
                    x: Math.random(),
                    y: -0.3 - Math.random() * 0.3,
                    dx: (Math.random() - 0.5) * 0.3,
                    dy: 1.1 + Math.random() * 0.5,
                    size: 0.05 + Math.random() * 0.04,
                    delay: Math.random() * 0.4,
                    life: 0.55 + Math.random() * 0.25,
                    spin: (Math.random() - 0.5) * 720,
                    color: PAPER[i % PAPER.length],
                    shape: "strip",
                });
                break;
            case "hearts":
                bits.push({
                    x: 0.3 + Math.random() * 0.4,
                    y: 0.1 + Math.random() * 0.3,
                    dx: (Math.random() - 0.5) * 0.35,
                    dy: -0.4 - Math.random() * 0.35,
                    size: 0.07 + Math.random() * 0.05,
                    delay: Math.random() * 0.5,
                    life: 0.5,
                    spin: (Math.random() - 0.5) * 60,
                    color: Math.random() < 0.7 ? "#c4463c" : "#c98da4",
                    shape: "heart",
                });
                break;
            case "rain":
                bits.push({
                    x: Math.random() * 1.2 - 0.1,
                    y: -0.4 - Math.random() * 0.3,
                    dx: -0.06,
                    dy: 1.3 + Math.random() * 0.4,
                    size: 0.06 + Math.random() * 0.03,
                    delay: Math.random() * 0.5,
                    life: 0.4 + Math.random() * 0.2,
                    spin: 0,
                    color: Math.random() < 0.7 ? "#2b3a67" : "#5a6d94",
                    shape: "sliver",
                });
                break;
        }
    }
    return bits;
}
