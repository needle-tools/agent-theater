/**
 * Paint order during a show: whoever stands lower is nearer.
 *
 * Off stage the order is the person's — what they stacked is what they meant.
 * On stage it cannot be, because a walk changes where somebody stands and
 * nothing was changing what they were painted over: an actor could cross
 * behind another and still be drawn in front of them, and the piece added last
 * was in front of the whole company for the whole play.
 *
 * The rule is the one a flat front-on stage already implies: everything stands
 * on the same floor, so the lower its base sits, the nearer it is. A tree
 * whose trunk is downstage of somebody IS in front of them.
 *
 * The exception is a backdrop, and a backdrop is not "a big picture" — it is a
 * picture the others are standing ON TOP OF. So it is found that way rather
 * than by size: a piece whose box holds most of the cast inside it is behind
 * them, whatever its base does. Sizing it by base instead would hang the sky
 * in front of the play.
 */
export interface Standing {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
    held?: { by: string } | null;
}

export function paintOrder<T extends Standing>(list: T[]): T[] {
    if (list.length < 2) return list;

    const holds = (card: T, other: T) => {
        const x = other.x + other.width / 2;
        const y = other.y + other.height / 2;
        return x >= card.x && x <= card.x + card.width
            && y >= card.y && y <= card.y + card.height;
    };
    /** A piece most of the others are standing on top of. */
    const backdrop = (card: T) => {
        const inside = list.filter(other => other.id !== card.id && holds(card, other)).length;
        return inside >= Math.max(2, Math.ceil((list.length - 1) / 2));
    };

    const behind = new Set(list.filter(backdrop).map(card => card.id));
    const area = (layer: T) => layer.width * layer.height;
    const base = (layer: T) => layer.y + layer.height;

    // Ties keep the order they came in, so two pieces on the same line stack
    // the way the person left them.
    const order = new Map(list.map((layer, at) => [layer.id, at]));
    const sorted = [...list].sort((a, b) => {
        const aBack = behind.has(a.id);
        const bBack = behind.has(b.id);
        // Backdrops first, biggest first: the sky before the field before the
        // cast standing on it.
        if (aBack !== bBack) return aBack ? -1 : 1;
        if (aBack && bBack) return area(b) - area(a);
        return base(a) - base(b) || order.get(a.id)! - order.get(b.id)!;
    });

    const z = new Map<string, number>();
    sorted.forEach((layer, at) => z.set(layer.id, at * 10));
    // A held prop rides in its holder's hand, wherever that hand has got to —
    // its own base is meaningless while it is being carried.
    for (const layer of sorted) {
        const holder = layer.held?.by;
        if (holder && z.has(holder)) z.set(layer.id, z.get(holder)! + 1);
    }
    return list.map(layer => ({ ...layer, z: z.get(layer.id) ?? layer.z }));
}
