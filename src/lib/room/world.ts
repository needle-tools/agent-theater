/**
 * The shared world: what everyone in the room can see and change.
 *
 * Every object is identified by a guid and nothing else. That is not a style
 * choice — a peer never has our object instances, so the guid is the only name
 * that exists on both sides of the wire, and it is also the key the server
 * persists state under. Identity, replication and persistence are one mechanism.
 *
 * Edits go through this class and nowhere else. Attribution, authority and
 * replication are decided here, at a single point, so a new way to trigger an
 * edit (a button, an agent tool, a keystroke) inherits all three for free.
 */
import type { RoomModel, RoomTransport } from "./transport.js";

/** Upsert of one object. The same key carries replayed room state on join. */
const WORLD_OBJECT_KEY = "world-object";
/**
 * Removal announcement. Deliberately our own key rather than relying on the
 * engine's `delete-state`: that one drops the server's saved copy, but whether
 * the server relays it to the peers already in the room is not something we
 * can read from the client source. Telling peers explicitly costs one transient
 * message and removes the guess.
 */
const WORLD_REMOVED_KEY = "world-removed";

const PALETTE = ["#99CC33", "#0BA398", "#826AED", "#D7DB0A", "#74AF52", "#62D399"];

export const OBJECT_KINDS = ["cube", "sphere", "cylinder"] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/** Whether a human acted directly, or their in-browser agent acted for them. */
export type EditOrigin = "human" | "agent";

export interface Actor {
    userId: string;
    origin: EditOrigin;
}

export interface WorldObject {
    guid: string;
    kind: ObjectKind;
    color: string;
    position: [number, number, number];
    scale: number;
    label: string;
    createdBy: Actor;
    createdAt: number;
}

export interface SpawnSpec {
    kind: ObjectKind;
    color?: string;
    position?: [number, number, number];
    scale?: number;
    label?: string;
}

export interface TransformPatch {
    position?: [number, number, number];
    scale?: number;
}

export type EditFailure = {
    ok: false;
    reason: "not-found" | "held-by-other" | "not-in-room";
    /** Connection id of whoever holds the object, when that is why we failed. */
    heldBy?: string;
    /** Phrased for an agent to relay to a person. */
    message: string;
};

export type EditResult = { ok: true; object: WorldObject } | EditFailure;

export interface SharedWorldOptions {
    newGuid?: () => string;
    now?: () => number;
}

export class SharedWorld {
    /** Insertion-ordered, which is also the order the server replays state in. */
    private readonly objects = new Map<string, WorldObject>();
    private readonly changedCallbacks = new Set<() => void>();
    private readonly disposers: Array<() => void> = [];
    private readonly newGuid: () => string;
    private readonly now: () => number;

    constructor(private readonly transport: RoomTransport, options?: SharedWorldOptions) {
        this.newGuid = options?.newGuid ?? (() => crypto.randomUUID());
        this.now = options?.now ?? (() => Date.now());

        // Must be subscribed before joining: the server replays the whole room
        // state at join time, and a listener attached afterwards misses it.
        this.disposers.push(transport.listen(WORLD_OBJECT_KEY, model => {
            const object = toWorldObject(model);
            if (!object) return;
            this.objects.set(object.guid, object);
            this.emitChanged();
        }));
        this.disposers.push(transport.listen(WORLD_REMOVED_KEY, model => {
            if (this.objects.delete(model.guid)) this.emitChanged();
        }));
    }

    list(): WorldObject[] {
        return [...this.objects.values()];
    }

    get(guid: string): WorldObject | null {
        return this.objects.get(guid) ?? null;
    }

    onChanged(callback: () => void): () => void {
        this.changedCallbacks.add(callback);
        return () => { this.changedCallbacks.delete(callback); };
    }

    async spawn(spec: SpawnSpec, actor: Actor): Promise<EditResult> {
        if (!this.transport.isInRoom) return notInRoom();
        const object: WorldObject = {
            guid: this.newGuid(),
            kind: spec.kind,
            color: spec.color ?? PALETTE[this.objects.size % PALETTE.length],
            position: spec.position ?? freeSpot(this.objects.size),
            scale: spec.scale ?? 0.7,
            label: spec.label ?? `${spec.kind} ${this.objects.size + 1}`,
            createdBy: { ...actor },
            createdAt: this.now(),
        };
        // Nothing to contend for on a fresh guid, so no ownership round trip.
        this.objects.set(object.guid, object);
        this.transport.send(WORLD_OBJECT_KEY, object as unknown as RoomModel);
        this.emitChanged();
        return { ok: true, object };
    }

    recolor(guid: string, color: string, actor: Actor): Promise<EditResult> {
        return this.edit(guid, actor, current => ({ ...current, color }));
    }

    transform(guid: string, patch: TransformPatch, actor: Actor): Promise<EditResult> {
        return this.edit(guid, actor, current => ({
            ...current,
            position: patch.position ?? current.position,
            scale: patch.scale ?? current.scale,
        }));
    }

    async remove(guid: string, actor: Actor): Promise<EditResult> {
        return this.withAuthority(guid, actor, current => {
            this.objects.delete(guid);
            // Two things, and both are needed: tell the peers who are here now,
            // and drop the server's saved copy so nobody joining later sees it.
            this.transport.send(WORLD_REMOVED_KEY, { guid } as RoomModel, { transient: true });
            this.transport.deleteState(guid);
            this.emitChanged();
            return { ok: true, object: current };
        });
    }

    dispose() {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.changedCallbacks.clear();
    }

    private edit(guid: string, actor: Actor, mutate: (current: WorldObject) => WorldObject): Promise<EditResult> {
        return this.withAuthority(guid, actor, current => {
            const next = mutate(current);
            this.objects.set(guid, next);
            this.transport.send(WORLD_OBJECT_KEY, next as unknown as RoomModel);
            this.emitChanged();
            return { ok: true, object: next };
        });
    }

    /**
     * Take authority, act, hand it back. Discrete edits release immediately so
     * one agent call cannot lock an object away from the people in the room.
     */
    private async withAuthority(
        guid: string,
        _actor: Actor,
        act: (current: WorldObject) => EditResult,
    ): Promise<EditResult> {
        if (!this.transport.isInRoom) return notInRoom();
        const current = this.objects.get(guid);
        if (!current) {
            return {
                ok: false,
                reason: "not-found",
                message: `There is no object with id "${guid}" in this room. List what is here before editing.`,
            };
        }
        const granted = await this.transport.requestOwnership(guid);
        if (!granted) {
            const heldBy = this.transport.ownerOf(guid) ?? undefined;
            return {
                ok: false,
                reason: "held-by-other",
                heldBy,
                message: heldBy
                    ? `"${current.label}" is being held by ${heldBy} right now. Ask them to let go, or edit something else.`
                    : `"${current.label}" is being held by someone else right now.`,
            };
        }
        try {
            return act(current);
        } finally {
            this.transport.releaseOwnership(guid);
        }
    }

    private emitChanged() {
        for (const callback of [...this.changedCallbacks]) callback();
    }
}

/**
 * Where to put an object nobody gave a position for. A golden-angle spiral
 * keeps successive placements from landing on each other, so "add five cubes"
 * reads as five cubes rather than one — without the agent having to do
 * arithmetic it has no way to check.
 */
function freeSpot(index: number): [number, number, number] {
    const angle = index * 2.399963;
    const radius = 0.6 + 0.38 * Math.sqrt(index);
    return [Math.cos(angle) * radius, 0.35, Math.sin(angle) * radius];
}

function notInRoom(): EditFailure {
    return {
        ok: false,
        reason: "not-in-room",
        message: "Not connected to the room yet. Wait a moment and try again.",
    };
}

/** Incoming models come off the network — shape them or drop them. */
function toWorldObject(model: RoomModel): WorldObject | null {
    const candidate = model as Partial<WorldObject>;
    if (typeof candidate.guid !== "string" || !candidate.guid) return null;
    if (!OBJECT_KINDS.includes(candidate.kind as ObjectKind)) return null;
    const position = candidate.position;
    if (!Array.isArray(position) || position.length !== 3 || position.some(n => typeof n !== "number")) return null;
    const createdBy = candidate.createdBy;
    if (!createdBy || typeof createdBy.userId !== "string") return null;
    return {
        guid: candidate.guid,
        kind: candidate.kind as ObjectKind,
        color: typeof candidate.color === "string" ? candidate.color : PALETTE[0],
        position: [position[0], position[1], position[2]],
        scale: typeof candidate.scale === "number" ? candidate.scale : 0.7,
        label: typeof candidate.label === "string" ? candidate.label : candidate.guid,
        createdBy: {
            userId: createdBy.userId,
            origin: createdBy.origin === "agent" ? "agent" : "human",
        },
        createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
    };
}
