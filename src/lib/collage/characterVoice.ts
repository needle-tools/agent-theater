import { TROUPE, type TroupePiece } from "./troupe.js";
import type { SubtitleVoice } from "../subtitleVoice/index.js";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const clampSpeed = (value: number) => Math.max(0, Math.min(2, value));

function seedOf(text: string): number {
    let hash = 2166136261;
    for (const character of text) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0xffffffff;
}

/**
 * The automatic voice for a layer — and EVERY layer gets one.
 *
 * A troupe actor speaks in the voice its artwork suggests. Anything else — a
 * generated octopus, a cut photo, a talking teapot — gets a stable voice
 * dealt from its own name, because a character that was written a line was
 * meant to be HEARD: "no voice cast" must mean "a voice nobody chose", never
 * silence. Seeded, not random: the same character speaks the same way on
 * every run and every machine.
 *
 * THE fallback for every path a line can take — the planner and the player
 * must resolve voices identically, or the plan is timed against a different
 * play than the one performed.
 */
/**
 * Push a draw away from the middle. Uniform draws cluster three characters
 * around 0.5 often enough that a whole page of dealt voices sounded like one
 * cautious person — the exponent thins the centre and fattens the edges, so
 * dealt voices land DIFFERENT: squeaky next to gravelly, hurried next to
 * unhurried. Still seeded, still the same voice every run.
 */
const polarized = (seed: number) =>
    0.5 + Math.sign(seed - 0.5) * Math.pow(Math.abs(seed - 0.5) * 2, 0.55) / 2;

export function autoVoiceFor(layer: { label: string; src?: string } | null): SubtitleVoice | null {
    if (!layer) return null;
    // Actors keep the voice their artwork suggests — deliberately untouched
    // by the aggressive deal below.
    const actor = actorForLayer(layer);
    if (actor) return voiceForActor(actor);
    // Three independent draws from the name, spread WIDE across the synth's
    // range. These are the voices nobody chose, and their job is variety.
    const name = layer.label.split("#")[0] || "somebody";
    return {
        speed: clampSpeed(0.6 + polarized(seedOf(`${name}/speed`))),
        age: clamp(polarized(seedOf(`${name}/age`))),
        tone: clamp(polarized(seedOf(`${name}/tone`))),
    };
}

export function actorForLayer(layer: { label: string; src?: string }): TroupePiece | null {
    const label = layer.label.split("#")[0];
    const piece = TROUPE.find(candidate => candidate.id === label || candidate.file === layer.src);
    return piece?.kind === "actor" ? piece : null;
}

/** A coherent, stable three-knob voice suggested by the character artwork. */
export function voiceForActor(piece: TroupePiece): SubtitleVoice {
    const words = new Set([...piece.mood, ...piece.id.split(/[\/-]/), ...piece.description.toLowerCase().split(/\W+/)]);
    const has = (...choices: string[]) => choices.some(choice => words.has(choice));
    const named = (...choices: string[]) => choices.some(choice => piece.id.includes(choice));
    // Enough variation that a cast is alive, never enough to contradict the
    // obvious character painted on the sticker.
    const variation = (seedOf(piece.id) - 0.5) * 0.08;

    let age = 0.5 + variation;
    let tone = 0.5 + variation;
    let speed = 1 + variation;

    if (named("child")) age = 0.08 + variation;
    else if (named("elder")) age = 0.92 + variation;
    else if (named("wizard")) age = 0.9 + variation;
    else if (named("witch", "king", "queen", "dwarf") || has("wise")) age = 0.76 + variation;
    else if (named("fairy", "elf", "prince", "princess", "maiden")) age = 0.24 + variation;

    if (named("wizard", "giant", "ogre", "troll", "warlord", "whale", "elephant")) tone = 0.14 + variation;
    else if (named("king", "dwarf", "lion", "crocodile", "vampire", "sea-captain", "blacksmith")) tone = 0.28 + variation;
    else if (named("fairy", "butterfly", "rabbit", "bat")) tone = 0.82 + variation;
    else if (named("elf", "princess", "jester", "toucan")) tone = 0.7 + variation;
    else {
        if (has("large", "heavy", "menacing", "bold")) tone -= 0.18;
        if (has("bright", "timid", "eager", "springy")) tone += 0.18;
        if (named("child")) tone += 0.12;
    }

    if (named("wizard")) speed = 0.58 + variation;
    else if (named("giant", "snail", "turtle", "elder")) speed = 0.48 + variation;
    else {
        if (has("slow", "heavy", "calm")) speed -= 0.25;
        if (has("quick", "springy", "comic", "bright", "eager")) speed += 0.2;
        if (named("child")) speed += 0.12;
    }

    return {
        speed: clampSpeed(speed),
        age: clamp(age),
        tone: clamp(tone),
    };
}

const GREETINGS = {
    timid: ["Oh! Hi.", "Um... hello.", "Hello there?", "Oh, it's you!", "Hi... nice to meet you.", "I hope I'm not in the way."],
    grand: ["Greetings.", "Well met!", "Ah, company.", "Welcome, welcome.", "A pleasure to meet you.", "Good day to you."],
    comic: ["Ta-da!", "Oh, hi!", "Well, look who's here!", "Hey there!", "Hello, hello!", "Fancy meeting you here!", "Did someone call?"],
    dark: ["Well, well.", "Who's there?", "Ah... hello.", "So, we meet.", "You found me.", "What have we here?"],
    warm: ["Hi there!", "Hello, friend!", "Lovely to meet you!", "Good to see you!", "Oh, hello there!", "Hi! How are you?", "Welcome!"],
    plain: ["Hi!", "Hello!", "Hey!", "Hello there!", "Good day!", "Hi, everyone!", "Here I am!", "Nice to meet you!"],
} as const;

function greetingsForActor(piece: TroupePiece): readonly string[] {
    const moods = new Set(piece.mood);
    return moods.has("timid") ? GREETINGS.timid
        : moods.has("menacing") || moods.has("cold") || moods.has("sneaky") ? GREETINGS.dark
            : moods.has("proud") || moods.has("wise") || moods.has("storybook") ? GREETINGS.grand
                : moods.has("comic") || moods.has("odd") ? GREETINGS.comic
                    : moods.has("friendly") || moods.has("gentle") || moods.has("kind") ? GREETINGS.warm
                        : GREETINGS.plain;
}

export function greetingForActor(piece: TroupePiece): string {
    const greetings = greetingsForActor(piece);
    return greetings[Math.floor(seedOf(piece.id) * greetings.length) % greetings.length];
}

/** A fresh greeting for any picture: themed for actors, friendly for props. */
export function randomGreetingForLayer(
    layer: { label: string; src?: string },
    random = Math.random,
): string {
    const actor = actorForLayer(layer);
    const greetings = actor ? greetingsForActor(actor) : GREETINGS.plain;
    return greetings[Math.min(greetings.length - 1, Math.floor(random() * greetings.length))];
}
