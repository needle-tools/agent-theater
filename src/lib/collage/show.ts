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
    /** Who is not on stage yet when it begins. */
    hidden?: string[];
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
        // No handOff exits any more: a scene used to end with every character
        // animating out one after another, which took longer than the scene's
        // own goodbye and looked like a fire drill. The show fades between
        // scenes instead, and the cast is simply there in the next one — or
        // still standing for the bows after the last.
        beats: [...built.beats, ...filmed(stage.script)],
        hidden: entering(stage),
    };
}

/**
 * A script with a camera in it, whether or not anybody wrote one.
 *
 * Camera beats have existed for a while; stage_script asks for two and says so
 * again afterwards when a scene has none. It kept not happening. Advice in a
 * tool description is read once, in a list of twenty, at the moment the agent
 * is deciding something else — so the answer is to stop asking and make the
 * default good instead.
 *
 * The cost of that is real and worth stating: a scene that deliberately holds
 * one fixed wide shot now has to say so, by writing its own camera beats. That
 * is the right way round. A held shot is a decision, and a scene that never
 * moves because nobody thought about it is not.
 *
 * Parallax is the other reason. Three depth planes only mean anything while the
 * view is moving; a set built carefully on three planes and then filmed from a
 * tripod is three flat pictures in a stack.
 */
export function filmed(script: Beat[]): Beat[] {
    if (script.some(beat => beat.camera)) return script;

    // Establish, then find whoever speaks first. Two moves is the minimum that
    // reads as a camera rather than as a glitch.
    const opening: Beat = { camera: { on: "all", tight: 0.95 }, duration: 1600 };
    const firstLine = script.findIndex(beat => beat.say && beat.id);
    if (firstLine < 0) return [opening, ...script];

    const speaker = script[firstLine].id!;
    return [
        opening,
        ...script.slice(0, firstLine),
        // Pushed in a little past snug, so it is closer than the establishing
        // shot without cropping anybody.
        { camera: { on: [speaker], tight: 1.15 }, duration: 1800 },
        ...script.slice(firstLine),
    ];
}

/**
 * Everybody who arrives rather than being there from the start.
 *
 * They have to be hidden until their own entrance plays. The scene runs its
 * beats in order, so the third character to arrive stands in plain view through
 * the first two entrances and then fades in from nothing — the audience sees
 * the whole cast, then watches them appear one at a time.
 *
 * A backdrop is never in this list: it is the room, it does not arrive.
 */
export function entering(stage: Stage): string[] {
    return stage.cast
        .filter(member => member.id !== stage.backdrop)
        .filter(member => member.entrance && member.entrance !== "none")
        .map(member => member.id);
}

/** Seconds a scene waits at the end before the next one begins. */
export const DEFAULT_HOLD = 2;

/**
 * The least time a scene may take, whatever is in it.
 *
 * A scene with nothing scripted in it is still a scene: the set has been built,
 * the camera has found it, and somebody is meant to look at it. Without a floor
 * it lasts as long as its build-up and then cuts, which reads as a bug rather
 * than as a tableau — the audience sees a flash of a forest and the next scene.
 *
 * Four seconds. Long enough to take in a picture and read a caption, short
 * enough that an empty scene does not feel like a hang.
 */
export const MIN_SCENE_MS = 4000;

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
