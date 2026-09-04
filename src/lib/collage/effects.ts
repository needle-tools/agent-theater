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
    {
        id: "anger",
        description:
            "Big cut-paper symbols burst over their head — a hash, an at, a star, " +
            "a bang. Comic swearing: fury, a tantrum, being told off, losing an " +
            "argument. Fewer and much larger than the other effects, so it reads " +
            "from across the stage.",
        seconds: 1.3,
        count: 7,
    },
    {
        id: "smoke",
        description:
            "Soft grey paper puffs climb from them and thin out as they go. A chimney, " +
            "a kettle, a snuffed candle, a train pulling away — anything still going " +
            "after the thing that caused it has stopped. The slowest effect here.",
        seconds: 2.8,
        count: 12,
    },
    {
        id: "explosion",
        description:
            "A hard burst of red and mustard shards thrown outward, with dark smoke " +
            "left drifting up behind them. A blast, a crash, a machine giving up, a " +
            "spell going wrong. The loudest thing on the stage — do not use it for " +
            "a surprise, use \"poof\".",
        seconds: 1.6,
        count: 26,
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

/**
 * What a character swears in.
 *
 * No letters, so nothing accidentally spells anything, and nothing a child
 * would read as a real word. Kept to symbols a comic actually uses.
 */
const ANGER_GLYPHS = ["#", "@", "%", "&", "✱", "!"];

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
    shape: "star" | "dot" | "strip" | "heart" | "sliver" | "glyph";
    /**
     * The character a "glyph" particle draws, and only then.
     *
     * Every other bit is a shape cut from coloured paper, which a clip-path
     * can make. A hash is not a shape, it is a letter — a polygon for one
     * would be eight coordinates of guesswork and still wrong at a dozen
     * pixels across. So this one kind of particle carries text and the canvas
     * sets it as the element's content.
     */
    glyph?: string;
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
            case "smoke":
                /*
                 * Rises and spreads, rather than flying outward like the rest.
                 *
                 * Smoke is the one effect here that is not an event — it is a
                 * thing that keeps happening, so the bits leave in a slow
                 * column from one spot rather than bursting from a centre, and
                 * the drift widens as they climb. Long lives and a wide spread
                 * of delays, so there is always something in the air rather
                 * than one puff arriving and leaving together.
                 */
                bits.push({
                    x: 0.42 + Math.random() * 0.16,
                    y: 0.15 + Math.random() * 0.15,
                    dx: (Math.random() - 0.5) * 0.5,
                    dy: -0.7 - Math.random() * 0.5,
                    // Grey-cream puffs, bigger than dust and softer than dots.
                    size: 0.09 + Math.random() * 0.09,
                    delay: Math.random() * 0.75,
                    life: 0.55 + Math.random() * 0.3,
                    spin: (Math.random() - 0.5) * 90,
                    color: Math.random() < 0.55 ? "#d8cdb4" : "#b9b3a3",
                    shape: "dot",
                });
                break;
            case "explosion":
                /*
                 * Two things at once: shards out, smoke up.
                 *
                 * A burst of only shards reads as confetti fired sideways. What
                 * makes it an explosion is what is left behind — so a quarter
                 * of the flock is slow dark smoke rising from the same point
                 * the shards left, and it outlives them.
                 */
                if (i % 4 === 3) {
                    bits.push({
                        x: 0.45 + Math.random() * 0.1,
                        y: 0.4,
                        dx: (Math.random() - 0.5) * 0.4,
                        dy: -0.5 - Math.random() * 0.35,
                        size: 0.08 + Math.random() * 0.07,
                        // Held back: the smoke should still be there when the
                        // shards have gone.
                        delay: 0.15 + Math.random() * 0.3,
                        life: 0.5 + Math.random() * 0.3,
                        spin: (Math.random() - 0.5) * 60,
                        color: Math.random() < 0.5 ? "#6b6455" : "#8d8676",
                        shape: "dot",
                    });
                } else {
                    bits.push({
                        x: 0.5,
                        y: 0.45,
                        // Fast and far — the shards are gone before the smoke
                        // has finished arriving.
                        dx: Math.cos(angle) * (0.5 + Math.random() * 0.5),
                        dy: Math.sin(angle) * (0.45 + Math.random() * 0.45),
                        size: 0.04 + Math.random() * 0.07,
                        delay: Math.random() * 0.06,
                        life: 0.3 + Math.random() * 0.2,
                        spin: (Math.random() - 0.5) * 540,
                        color: Math.random() < 0.55 ? "#c4463c" : "#d9a441",
                        shape: "strip",
                    });
                }
                break;
            case "anger": {
                /*
                 * Grawlix: the comic-strip swear. A hash first because that is
                 * the one everybody reads as swearing on its own, then the
                 * company it usually keeps.
                 *
                 * Weighted rather than uniform. A flock of seven drawn evenly
                 * from six symbols came out looking like a character set, not
                 * like cursing — the hash has to dominate for the joke to land.
                 */
                const glyph = i === 0 || Math.random() < 0.45
                    ? "#"
                    : ANGER_GLYPHS[Math.floor(Math.random() * ANGER_GLYPHS.length)];
                // Above the head and to either side, never over the face: the
                // expression is the other half of the gag.
                const side = i % 2 === 0 ? -1 : 1;
                bits.push({
                    x: 0.5 + side * (0.1 + Math.random() * 0.32),
                    y: -0.05 + Math.random() * 0.3,
                    dx: side * (0.05 + Math.random() * 0.16),
                    dy: -0.18 - Math.random() * 0.22,
                    // Four to eight times a sparkle. "Big" was the whole ask,
                    // and a grawlix that needs looking for is not a grawlix.
                    size: 0.2 + Math.random() * 0.16,
                    delay: Math.random() * 0.3,
                    life: 0.5 + Math.random() * 0.2,
                    // A tilt, not a tumble: these are read, so they must stay
                    // the right way up.
                    spin: (Math.random() - 0.5) * 36,
                    color: Math.random() < 0.65 ? "#c4463c" : "#2b3a67",
                    shape: "glyph",
                    glyph,
                });
                break;
            }
        }
    }
    return bits;
}
