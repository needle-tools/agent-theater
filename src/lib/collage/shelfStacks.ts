import { TROUPE, TROUPE_SHELF, type TroupePiece, type TroupeShelfGroup } from "./troupe.js";

export interface ShelfStack {
    id: string;
    label: string;
    pieces: TroupePiece[];
}

/** Five display stacks over the existing shelf categories. No troupe data changes. */
const STACKS = [
    { id: "cast-creatures", label: "Cast & creatures", groups: ["cast", "creatures"] },
    { id: "nature-water", label: "Nature & water", groups: ["nature", "water-sky"] },
    { id: "rooms-props", label: "Rooms & props", groups: ["indoors", "props"] },
    { id: "street-night", label: "Street & night", groups: ["street", "night-space"] },
    { id: "themes-more", label: "Themes & more", groups: [] },
] as const;

const sticker = (piece: TroupePiece) => piece.kind === "actor" || piece.kind === "scenery";
const inGroup = (piece: TroupePiece, group: TroupeShelfGroup) =>
    group.packs.includes(piece.pack) && group.kinds.includes(piece.kind);

export function shelfStacks(
    pieces: TroupePiece[] = TROUPE,
    shelf: { assorted: TroupeShelfGroup[]; themes: TroupeShelfGroup[] } = TROUPE_SHELF,
): ShelfStack[] {
    const groups = [...shelf.assorted, ...shelf.themes];
    const assigned = new Set<string>();
    const available = pieces.filter(sticker);
    return STACKS.map((stack, index) => {
        const selected = stack.groups.map(id => groups.find(group => group.id === id)).filter((group): group is TroupeShelfGroup => !!group);
        const members = available.filter(piece =>
            !assigned.has(piece.id) && (index === STACKS.length - 1 || selected.some(group => inGroup(piece, group))));
        members.forEach(piece => assigned.add(piece.id));
        return { id: stack.id, label: stack.label, pieces: members };
    }).filter(stack => stack.pieces.length);
}
