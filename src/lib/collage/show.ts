/**
 * Running the scenes one after another.
 *
 * A scene is not just its script. It has to arrive — backdrop first, then the
 * cast, each from wherever it comes in — and leave again before the next one
 * arrives. That build-up is *generated* rather than written, because an agent
 * asked to script it for every scene would write six near-identical scripts,
 * and the seventh would differ for no reason anybody could name.
 *
 * Each scene runs the same three phases:
 *
 *   1. build-up — everyone who has an entrance arrives
 *   2. the script — what the agent actually wrote
 *   3. hand-off — everyone who arrived leaves again
 *
 * All of it comes out as beats, so the whole show speaks one vocabulary and the
 * player learns nothing new.
 */
import type { Beat } from "./perform.js";
import type { EntranceName, Stage } from "./stage.js";

/**
 * How far off stage an arrival starts, as a multiple of the arriver's own size.
 *
 * Proportional, so a small sprite does not have to cross the county to get on
 * stage while a large one steps in from just outside the frame.
 */
const OFF_STAGE = 1.6;

/** An arrival that has to begin somewhere other than where it ends. */
export interface Approach {
    id: string;
    /** Put them here first, relative to their place, then play the beat. */
    dx: number;
    dy: number;
}

export interface BuildUp {
    /** Applied before anything animates: where each arrival starts from. */
    approach: Approach[];
    beats: Beat[];
}

/**
 * The beats that bring a scene in.
 *
 * Anybody with no entrance simply is there, which is right for a scene where
 * most of the cast is already on stage and one person walks in. Making everyone
 * arrive would turn every scene into a parade.
 *
 * A sliding entrance is a walk, and a walk goes *from* where you are — so the
 * arriver is first placed off stage and then walks the same distance back. The
 * alternative is a separate "arrive from" beat that does its own travelling,
 * and then there are two ways to move somebody and they can disagree.
 */
export function buildUp(stage: Stage, sizeOf: (id: string) => number): BuildUp {
    const approach: Approach[] = [];
    const beats: Beat[] = [];

    for (const member of stage.cast) {
        const entrance: EntranceName | undefined = member.entrance;
        if (!entrance || entrance === "none") continue;
        const size = Math.max(1, sizeOf(member.id));
        const away = size * OFF_STAGE;

        switch (entrance) {
            case "left":
            case "right": {
                const dx = entrance === "left" ? -away : away;
                approach.push({ id: member.id, dx, dy: 0 });
                beats.push({ id: member.id, do: "walk", to: { x: -dx } });
                break;
            }
            case "above": {
                approach.push({ id: member.id, dx: 0, dy: -away });
                beats.push({ id: member.id, do: "jump", to: { y: away } });
                break;
            }
            // fade, below and grow are all the same beat: it rises a little and
            // fades in, which covers every "just appear, but nicely" case.
            default:
                beats.push({ id: member.id, do: "enter" });
        }
    }
    return { approach, beats };
}

/**
 * The beats that take a scene away.
 *
 * Only those who arrived leave. Anybody who was simply there when the scene
 * began was not brought on, and removing them would be taking away something
 * the person put there.
 */
export function handOff(stage: Stage): Beat[] {
    return stage.cast
        .filter(member => member.entrance && member.entrance !== "none")
        .map(member => ({ id: member.id, do: "exit" as const }));
}

/** Everything a scene does, in order. */
export function sceneBeats(stage: Stage, sizeOf: (id: string) => number): BuildUp {
    const built = buildUp(stage, sizeOf);
    return {
        approach: built.approach,
        beats: [...built.beats, ...stage.script, ...handOff(stage)],
    };
}

/** Seconds a scene waits at the end before the next one begins. */
export const DEFAULT_HOLD = 1;

/**
 * Where each scene starts, so a narrating agent knows when to say what.
 *
 * Worked out up front rather than reported as it goes: the point of a show is
 * that somebody talks over it, and narration written against timings that
 * arrive halfway through lands late.
 */
export interface ShowTiming {
    stage: string;
    name: string;
    /** Milliseconds from the start of the show. */
    at: number;
    duration: number;
}
