/**
 * Chapters: one world, told a stretch at a time.
 *
 * There is no "stage" that owns positions any more. The canvas is a single
 * continuous world and every piece stands exactly where it stands — where the
 * person arranged it, where the last script's walk left it. A chapter (the
 * type keeps the name Stage, and the tools keep their names, so nothing
 * running mid-conversation breaks) records WHO matters for a stretch of the
 * story and WHAT happens: a cast list of memberships — who they play, which
 * voice, which depth plane, how they arrive — and a script. Never where
 * anybody is. Follow the hero across the paper and chapter two picks her up
 * wherever chapter one left her.
 *
 * The one positional thing a membership may carry is an attachment: `on`
 * plus x/y OFFSETS from the holder, because "the basket is in her hand" is a
 * relation, not a place.
 */
import type { Beat } from "./perform.js";
import type { Layer } from "./model.js";
import type { SubtitleVoice } from "../subtitleVoice/index.js";

/**
 * How far away something is standing.
 *
 * Three, and only three. A real depth value would be a number nobody can
 * picture and every agent would guess differently; "the trees are at the back,
 * the people are in the middle, the bush is right in front of the lens" is how
 * a set is actually described. It decides two things at once — what is painted
 * over what, and how much it slides when the camera moves.
 */
export const PLANES = ["back", "mid", "front"] as const;
export type PlaneName = (typeof PLANES)[number];

/**
 * How much of the camera's movement each plane takes.
 *
 * 1 is "moves exactly with the camera", which is what a flat canvas has always
 * done and therefore what the middle has to be — anything else would make
 * placing somebody in the middle feel like placing them slightly wrong. The
 * back lags and the front overshoots, and the gaps are deliberately modest:
 * parallax that announces itself stops being depth and becomes a slide.
 */
export const PARALLAX: Record<PlaneName, number> = {
    back: 0.6,
    mid: 1,
    front: 1.25,
};

/** Paint order between planes, before anything within a plane is sorted. */
const PLANE_DEPTH: Record<PlaneName, number> = {
    back: -100_000,
    mid: 0,
    front: 100_000,
};

/** How a cast member arrives when a chapter opens. */
export const ENTRANCES = ["fade", "left", "right", "above", "below", "grow", "none"] as const;
export type EntranceName = (typeof ENTRANCES)[number];

/**
 * One layer's membership of a chapter. NOT a position — the layer stands
 * where the world has it. (Old saves carry x/y/width on these; they are
 * ignored except as attachment offsets.)
 */
export interface Placement {
    id: string;
    /**
     * Attachment offsets from `on`, when attached. Meaningless otherwise —
     * a holdover slot from when placements owned positions.
     */
    x?: number;
    y?: number;
    /** Legacy fields old saves may carry. The world's layer wins. */
    width?: number;
    rotation?: number;
    z?: number;
    flip?: boolean;
    entrance?: EntranceName;
    /**
     * Who this layer is playing — "the grandmother", "the wolf".
     *
     * Kept on the membership rather than on the layer because a picture can
     * be cast as one thing in one chapter and another thing later, and
     * because it is the casting that has the character in it: the layer is
     * only ever a photograph of a thing.
     */
    as?: string;
    /**
     * Which voice says this part's lines.
     *
     * On the membership for the same reason `as` is: it belongs to the
     * casting, not to the picture. Absent means silent — not "the default
     * voice". A play where every unnamed part quietly acquired a narrator's
     * voice would be a play nobody chose the sound of.
     */
    voice?: SubtitleVoice;
    /** Which depth plane it stands on. Defaults to the middle. */
    plane?: PlaneName;
    /**
     * Held by, riding on, sitting in: the id of another cast member this one
     * is attached to. While attached, x and y are OFFSETS from that member's
     * layer, so a walk moves both as one and nothing has to keep them in
     * step.
     *
     * Deliberately NOT DOM nesting downstream: a rider must be able to paint
     * on a different plane than the vehicle, and nesting would weld their
     * z-orders together. One level only — a thing held by a held thing is a
     * chain nobody can reason about, and the tools refuse it.
     */
    on?: string;
}

export interface Stage {
    id: string;
    name: string;
    /** Legacy: old saves may name one. Retired — nothing sets it any more. */
    backdrop: string | null;
    cast: Placement[];
    /**
     * What happens once the chapter opens.
     *
     * Stored rather than played and forgotten: a show runs its chapters one
     * after another and has to know what each of them does. A script that
     * only existed at the moment it was sent could be performed once and
     * never again, which is not a play — it is a rehearsal.
     */
    script: Beat[];
    /** A bed under the whole chapter, cross-fading into the next one's. */
    music?: string | null;
    /**
     * What to do if the bed runs out before the chapter does: "loop" (the
     * default), "fade", or the name of another piece to blend into.
     */
    musicEnd?: string;
    /** A mood colour for the surround, rarely used and rarely needed. */
    tint?: string;
    /**
     * The paper's colour while this chapter plays — the scene's own weather.
     * Fades in when the chapter begins and stays (the world is continuous;
     * a story that ends at night leaves the night). "" resets to the house
     * paper.
     */
    background?: string;
    /** Seconds to hold after the chapter before moving on. */
    hold?: number;
}

export interface StageSpec {
    id?: string;
    name?: string;
    backdrop?: string | null;
    cast?: Placement[];
    script?: Beat[];
    music?: string | null;
    musicEnd?: string;
    tint?: string;
    background?: string;
    hold?: number;
}

/** How much of the camera's movement this plane takes. */
export function parallaxOf(plane: PlaneName | undefined): number {
    return PARALLAX[plane ?? "mid"];
}

/**
 * The chapter's members, as layers, in paint order.
 *
 * A chapter changes NOTHING about how a layer stands — no plane lift (depth
 * planes are retired; the world's own stacking is the paint order) and no
 * attachment resolution (holding is world state on the layer, resolved by
 * the document). This is purely "who is in this stretch of the story, as
 * layers". Anything named in the cast that no longer exists is skipped
 * rather than faked: a deleted layer should disappear from every chapter it
 * was in, not leave a hole with a name.
 */
export function castOf(stage: Stage, layerOf: (id: string) => Layer | null): Layer[] {
    void PLANE_DEPTH;
    const out: Layer[] = [];
    const order = new Map<string, number>();
    for (const [at, member] of stage.cast.entries()) {
        const layer = layerOf(member.id);
        if (!layer) continue;
        order.set(member.id, at);
        out.push(layer);
    }
    // Ties break on casting order, so two layers at the same depth keep the
    // order they were put in rather than whichever sort wins today.
    return out.sort((a, b) => a.z - b.z || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Is this layer in this chapter at all? */
export function onStage(stage: Stage, id: string): boolean {
    return stage.backdrop === id || stage.cast.some(member => member.id === id);
}

/**
 * The same chapter, pointed at different layers.
 *
 * A chapter is nothing but layer ids — who is in it and who each beat is
 * about — so a chapter that travels between documents has to have every one
 * rewritten. Opening a saved file re-mints its layer ids (two files made in
 * the same browser can hold the same id for different pictures), and a
 * chapter carried across without this would cast people who do not exist and
 * quietly play to an empty stage.
 *
 * Anyone missing from the map is dropped rather than kept: a beat about a
 * layer that did not arrive is a beat that cannot happen, and leaving it in
 * would make the chapter silently longer than it looks.
 */
export function renamedIn(stage: Stage, ids: Map<string, string>): Stage {
    // Attachment is the LAYER's business now and travels with it; a chapter
    // carries only memberships, which rename or drop.
    const cast = stage.cast
        .filter(member => ids.has(member.id))
        .map(member => ({ ...member, id: ids.get(member.id)! }));
    const present = new Set(cast.map(member => member.id));

    const script = stage.script.flatMap(beat => {
        const camera = beat.camera && Array.isArray(beat.camera.on)
            ? { ...beat.camera, on: beat.camera.on.map(id => ids.get(id) ?? id).filter(id => present.has(id)) }
            : beat.camera;
        // A camera beat is about the view rather than about anybody, so it
        // survives on its own.
        if (!beat.id) return camera ? [{ ...beat, camera }] : [beat];
        const id = ids.get(beat.id);
        if (!id || !present.has(id)) return [];
        return [{ ...beat, id, ...(camera ? { camera } : {}) }];
    });

    const backdrop = stage.backdrop ? ids.get(stage.backdrop) ?? null : null;
    return { ...stage, backdrop, cast, script };
}
