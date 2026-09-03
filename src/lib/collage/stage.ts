/**
 * Stages: the same canvas, seen one scene at a time.
 *
 * A stage does not own its cast. A layer belongs to the canvas; a stage records
 * *where that layer stands while this stage is playing*. One character can
 * therefore appear in scenes one and three at different spots without being
 * duplicated, and editing the character — recolouring it, tracing it, cutting
 * its background again — edits it everywhere it appears.
 *
 * The consequence worth stating: when a stage is active the document presents
 * itself AS that stage. `list()` returns its cast at their stage placements,
 * and an edit to a position writes to the placement rather than to the layer.
 * Everything downstream — the canvas, dragging, arranging, capture, export —
 * becomes stage-aware without knowing that stages exist, which is the only way
 * a feature this broad stays out of every other file.
 */
import type { Beat } from "./perform.js";
import type { Layer } from "./model.js";

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

/** How a cast member arrives when a stage builds up. */
export const ENTRANCES = ["fade", "left", "right", "above", "below", "grow", "none"] as const;
export type EntranceName = (typeof ENTRANCES)[number];

/** Where one layer stands while a stage is playing. */
export interface Placement {
    id: string;
    x: number;
    y: number;
    width?: number;
    rotation?: number;
    /** Paint order within the stage. Falls back to the order given. */
    z?: number;
    entrance?: EntranceName;
    /**
     * Who this layer is playing — "the grandmother", "the wolf".
     *
     * Kept on the placement rather than on the layer because a picture can be
     * cast as one thing in one scene and another thing later, and because it
     * is the casting that has the character in it: the layer is only ever a
     * photograph of a thing.
     */
    as?: string;
    /** Which depth plane it stands on. Defaults to the middle. */
    plane?: PlaneName;
    /** Mirrored, so the same drawing can face either way per scene. */
    flip?: boolean;
}

export interface Stage {
    id: string;
    name: string;
    /**
     * The layer behind everything, which never acts and never enters — it is
     * the room, not somebody in it.
     */
    backdrop: string | null;
    cast: Placement[];
    /**
     * What happens once the scene has built up.
     *
     * Stored rather than played and forgotten: a show runs its scenes one after
     * another and has to know what each of them does. A script that only
     * existed at the moment it was sent could be performed once and never
     * again, which is not a play — it is a rehearsal.
     */
    script: Beat[];
    /** A bed under the whole scene, cross-fading into the next one's. */
    music?: string | null;
    /**
     * What to do if the bed runs out before the scene does: "loop" (the
     * default), "fade", or the name of another piece to blend into.
     */
    musicEnd?: string;
    /**
     * The colour the room around the stage takes while this scene plays.
     *
     * Optional, and usually left alone: the backdrop already knows what colour
     * it is, and the page reads it off the picture. This is for when the mood
     * wants something the picture does not say — a cold blue surround on a warm
     * scene, because the scene is meant to feel exposed.
     */
    tint?: string;
    /** Seconds to hold after the scene before moving on. */
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
    hold?: number;
}

/** A layer as it appears on a stage: the layer, standing where the stage says. */
export function placed(layer: Layer, placement: Placement, order: number): Layer {
    const width = placement.width && placement.width > 0 ? placement.width : layer.width;
    // Height follows width, so a stage can resize a cast member without having
    // to know its aspect ratio.
    const height = layer.width > 0 ? (width / layer.width) * layer.height : layer.height;
    return {
        ...layer,
        x: placement.x,
        y: placement.y,
        width,
        height,
        rotation: placement.rotation ?? layer.rotation,
        flip: placement.flip ?? layer.flip,
        /*
         * The layer's own depth when the stage has no opinion — NOT the index.
         *
         * These two are different scales. A placement that has been reordered
         * carries a real canvas z (a few hundred, say), and one that never has
         * carries nothing; falling back to the position in the array mixed
         * numbers like 0, 1, 2 in with numbers like 340, so a single reorder
         * shoved everybody else behind everything. `order` survives only as a
         * tiebreak, which is all it was ever good for.
         */
        z: PLANE_DEPTH[placement.plane ?? "mid"] + (placement.z ?? layer.z ?? order),
    };
}

/** How much of the camera's movement this plane takes. */
export function parallaxOf(plane: PlaneName | undefined): number {
    return PARALLAX[plane ?? "mid"];
}

/**
 * The cast of a stage, in paint order, as layers.
 *
 * The backdrop goes first and furthest back — a scene with its room drawn on
 * top of its people is not a scene. Anything named in the cast that no longer
 * exists is skipped rather than faked: a deleted layer should disappear from
 * every stage it was in, not leave a hole with a name.
 */
export function castOf(stage: Stage, layerOf: (id: string) => Layer | null): Layer[] {
    const out: Layer[] = [];
    if (stage.backdrop) {
        const backdrop = layerOf(stage.backdrop);
        if (backdrop) out.push({ ...backdrop, z: -1_000_000 });
    }
    const order = new Map<string, number>();
    for (const [at, placement] of stage.cast.entries()) {
        if (placement.id === stage.backdrop) continue;
        const layer = layerOf(placement.id);
        if (!layer) continue;
        order.set(placement.id, at);
        out.push(placed(layer, placement, at));
    }
    // Ties break on casting order, so two layers at the same depth keep the
    // order they were put on stage in rather than whichever sort wins today.
    return out.sort((a, b) => a.z - b.z || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Is this layer on this stage at all? Backdrops count. */
export function onStage(stage: Stage, id: string): boolean {
    return stage.backdrop === id || stage.cast.some(member => member.id === id);
}

/**
 * Fold an edit into a placement.
 *
 * Only the geometry: a stage says where somebody stands, not what colour they
 * are. Style, text and source belong to the layer and are shared by every stage
 * it appears on, which is the whole point of not duplicating it.
 */
export function placeWith(
    placement: Placement,
    patch: {
        x?: number; y?: number; width?: number; height?: number;
        rotation?: number; z?: number; flip?: boolean;
    },
): Placement {
    return {
        ...placement,
        ...(typeof patch.x === "number" ? { x: patch.x } : {}),
        ...(typeof patch.y === "number" ? { y: patch.y } : {}),
        ...(typeof patch.width === "number" ? { width: patch.width } : {}),
        ...(typeof patch.rotation === "number" ? { rotation: patch.rotation } : {}),
        ...(typeof patch.z === "number" ? { z: patch.z } : {}),
        ...(typeof patch.flip === "boolean" ? { flip: patch.flip } : {}),
    };
}

/** Which parts of an edit a stage can hold. The rest go to the layer itself. */
export function isPlacementEdit(patch: object): boolean {
    return ["x", "y", "width", "height", "rotation", "z", "flip"].some(key => key in patch);
}

/** The parts of an edit that are not about where something stands. */
export function withoutPlacement<T extends object>(patch: T): Partial<T> {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
        if (["x", "y", "width", "height", "rotation", "z", "flip"].includes(key)) continue;
        rest[key] = value;
    }
    return rest as Partial<T>;
}

/**
 * The same scene, pointed at different layers.
 *
 * A scene is nothing but layer ids — who is in it, who the backdrop is, and who
 * each beat is about — so a scene that travels between documents has to have
 * every one of those rewritten. Opening a saved file re-mints its layer ids
 * (two files made in the same browser can hold the same id for different
 * pictures), and a scene carried across without this would cast people who do
 * not exist and quietly play to an empty stage.
 *
 * Anyone missing from the map is dropped rather than kept: a beat about a layer
 * that did not arrive is a beat that cannot happen, and leaving it in would make
 * the scene silently longer than it looks.
 */
export function renamedIn(stage: Stage, ids: Map<string, string>): Stage {
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
