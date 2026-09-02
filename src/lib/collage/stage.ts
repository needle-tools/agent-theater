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
    /** Seconds to hold after the scene before moving on. */
    hold?: number;
}

export interface StageSpec {
    id?: string;
    name?: string;
    backdrop?: string | null;
    cast?: Placement[];
    script?: Beat[];
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
        z: placement.z ?? order,
    };
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
    for (const [order, placement] of stage.cast.entries()) {
        if (placement.id === stage.backdrop) continue;
        const layer = layerOf(placement.id);
        if (layer) out.push(placed(layer, placement, order));
    }
    return out.sort((a, b) => a.z - b.z);
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
    patch: { x?: number; y?: number; width?: number; height?: number; rotation?: number; z?: number },
): Placement {
    return {
        ...placement,
        ...(typeof patch.x === "number" ? { x: patch.x } : {}),
        ...(typeof patch.y === "number" ? { y: patch.y } : {}),
        ...(typeof patch.width === "number" ? { width: patch.width } : {}),
        ...(typeof patch.rotation === "number" ? { rotation: patch.rotation } : {}),
        ...(typeof patch.z === "number" ? { z: patch.z } : {}),
    };
}

/** Which parts of an edit a stage can hold. The rest go to the layer itself. */
export function isPlacementEdit(patch: object): boolean {
    return ["x", "y", "width", "height", "rotation", "z"].some(key => key in patch);
}

/** The parts of an edit that are not about where something stands. */
export function withoutPlacement<T extends object>(patch: T): Partial<T> {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
        if (["x", "y", "width", "height", "rotation", "z"].includes(key)) continue;
        rest[key] = value;
    }
    return rest as Partial<T>;
}
