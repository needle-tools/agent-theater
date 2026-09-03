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
export function autoVoiceFor(layer: { label: string; src?: string } | null): SubtitleVoice | null {
    if (!layer) return null;
    const actor = actorForLayer(layer);
    if (actor) return voiceForActor(actor);
    // Three independent draws from the name, kept inside the range where the
    // synth sounds like a person rather than a prank: mid-wide age and tone,
    // speed close to 1.
    const name = layer.label.split("#")[0] || "somebody";
    return {
        speed: clampSpeed(0.85 + seedOf(`${name}/speed`) * 0.4),
        age: clamp(0.15 + seedOf(`${name}/age`) * 0.7),
        tone: clamp(0.2 + seedOf(`${name}/tone`) * 0.6),
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
    const variation = seedOf(piece.id) - 0.5;

    let age = 0.5 + variation * 0.12;
    let tone = 0.5 + variation * 0.14;
    let speed = 1 + variation * 0.16;

    if (has("young", "child", "girl", "boy", "prince", "princess", "fairy")) age -= 0.27;
    if (has("old", "wise", "wizard", "witch", "king", "queen", "grandmother")) age += 0.27;
    if (has("large", "heavy", "giant", "ogre", "troll", "elephant", "whale", "crocodile")) tone -= 0.24;
    if (has("bright", "timid", "small", "fairy", "butterfly", "rabbit", "bird")) tone += 0.22;
    if (has("slow", "heavy", "calm")) speed -= 0.34;
    if (has("quick", "springy", "comic", "bright")) speed += 0.2;

    return {
        speed: clampSpeed(speed),
        age: clamp(age),
        tone: clamp(tone),
    };
}

export function greetingForActor(piece: TroupePiece): string {
    const greetings = ["Hi!", "Hello!", "Oh, hello!"];
    return greetings[Math.floor(seedOf(piece.id) * greetings.length) % greetings.length];
}
