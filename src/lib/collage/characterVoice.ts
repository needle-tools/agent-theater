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

/** The shipped actor represented by a layer; scenery deliberately returns null. */
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
