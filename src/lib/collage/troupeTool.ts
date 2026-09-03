/**
 * The troupe drawer: ready-made art, on stage in seconds.
 *
 * Everything else an agent can do to get pictures — generate a sheet, wait for
 * it, cut it — costs minutes, and those minutes come out of the story's
 * budget. The troupe is the other economics: pieces that were drawn, cut and
 * catalogued before the conversation started, so the first scene can exist
 * before the person has finished saying what the play is about.
 *
 * One tool that both lists and adds, because the two are one errand: an agent
 * that has just read the catalogue should not need a second round trip to act
 * on it. The whole tool unregisters itself when the drawer is empty — a tool
 * surface is paid for on every conversation turn, and a drawer with nothing
 * in it is not worth a single line of it.
 */
import { TROUPE, TROUPE_PACKS, TROUPE_SHEETS, type TroupePiece } from "./troupe.js";
import { STAGE_WIDTH, type CollageStudio } from "./studio.js";
import { arrangementCentre, clearSpot, peerWidth, tamedWidth } from "./placement.js";
import type { ToolResult, WebMcpToolDef } from "./tools.js";

const ok = (text: string, structured?: object): ToolResult => ({
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
});

const fail = (text: string): ToolResult => ({ ...ok(text), isError: true });

/** One line per piece, in the shape the sound catalogue taught. */
function line(piece: TroupePiece): string {
    return `  ${piece.id} — ${piece.description || piece.kind}` +
        `${piece.facing ? ` (faces ${piece.facing})` : ""}` +
        `${piece.mood.length ? ` [${piece.mood.join(", ")}]` : ""}` +
        `${piece.take ? ` (a pose of "${piece.take}")` : ""}`;
}

export function createTroupeTool(studio: CollageStudio): WebMcpToolDef | null {
    /*
     * Backdrop panels and their full-width slices are RETIRED. The play
     * happens on the open paper world; a painted panel replaces that world
     * with a picture of one, and every play staged on a panel came out
     * looking like a diorama in a dark room. The pieces still exist in the
     * generated catalogue (old saves may hold them), but the drawer no
     * longer deals them: not listed, not addable.
     */
    const DEALT = TROUPE.filter(piece =>
        piece.kind === "scenery" || piece.kind === "actor");

    if (!DEALT.length && !TROUPE_SHEETS.length) return null;

    return {
        name: "theater_troupe",
        title: "Ready-made art, already cut",
        description:
            "Pregenerated, precut art that ships with this theatre — no generation, no waiting, no " +
            "cutting. Call with no arguments for the catalogue; pass add: [ids] to put pieces on the " +
            "canvas, ready to cast. CHECK THIS BEFORE GENERATING ART: a pack that fits the story " +
            "saves minutes per sheet, and those minutes belong to the story. Pieces sharing a take " +
            "are the same character in different poses, made for \"becomes\".",
        inputSchema: {
            type: "object",
            properties: {
                add: {
                    type: "array",
                    items: { type: "string" },
                    description: `Piece ids to add, e.g. "woodland/wolf". Omit to see the catalogue.`,
                },
            },
        },
        async execute(args: { add?: string[] }) {
            const wanted = (Array.isArray(args?.add) ? args.add : [])
                .map(id => (typeof id === "string" ? id.trim() : ""))
                .filter(Boolean);

            if (!wanted.length) {
                const kinds: Array<[string, string]> = [
                    ["scenery", "Scenery — trees, props, furniture:"],
                    ["actor", "Actors — full body, ready to cast:"],
                ];
                const styled = TROUPE_PACKS.filter(pack => pack.stylePrompt);
                return ok([
                    `The troupe, by pack:`,
                    ...kinds.flatMap(([kind, heading]) => {
                        const of = DEALT.filter(piece => piece.kind === kind);
                        // A heading may be empty when its kind rides under the
                        // previous one — foreground lists below midground's.
                        return of.length ? [...(heading ? [heading] : []), ...of.map(line)] : [];
                    }),
                    ...(TROUPE_SHEETS.length
                        ? [`Uncut sheets — slower; run through piece_sheet with the grid given:`,
                           ...TROUPE_SHEETS.map(sheet =>
                               `  ${sheet.id} — ${sheet.file}, ${sheet.columns} × ${sheet.rows}`)]
                        : []),
                    `Add pieces with theater_troupe add: ["<id>", …].`,
                    ...(styled.length
                        ? [``,
                           `MATCHING NEW ART TO A PACK: these packs recorded the image prompt they ` +
                           `were generated with. To draw a piece that belongs — a wolf that fits the ` +
                           `forest — start your image prompt from the pack's own and add only the ` +
                           `subject. The style lives in the prompt; nothing else can reproduce it.`,
                           ...styled.map(pack => `  ${pack.id}: ${pack.stylePrompt}`)]
                        : []),
                ].join("\n"), { pieces: TROUPE, sheets: TROUPE_SHEETS, packs: TROUPE_PACKS });
            }

            const unknown = wanted.filter(id => !DEALT.some(piece => piece.id === id));
            if (unknown.length) {
                // All or nothing, for the same reason stage_remove is: a half
                // delivery leaves the caller counting pieces to find out which
                // half arrived.
                return fail(
                    `No troupe piece called ${unknown.map(id => `"${id}"`).join(", ")}. Nothing was ` +
                    `added — call theater_troupe with no arguments for the catalogue.`);
            }

            const added: Array<{ id: string; label: string; kind: string }> = [];
            for (const id of wanted) {
                const piece = DEALT.find(candidate => candidate.id === id)!;
                /*
                 * Arrive as a CITIZEN of the world, not as a delivery: sized
                 * like the pieces already lying on the paper, on a clear
                 * patch near the arrangement. The old way — a fixed width on
                 * an origin-centred spiral — piled every add into one heap
                 * of overlapping stickers that somebody then had to unstack.
                 * Re-read per piece, so each add avoids the one before it.
                 */
                const world = studio.collage.listAll();
                const width = ["backdrop", "midground", "foreground"].includes(piece.kind)
                    ? STAGE_WIDTH
                    : peerWidth(world, 260);
                const spot = clearSpot(world, arrangementCentre(world), width);
                const { layer } = await studio.addImage(piece.file, {
                    label: piece.id,
                    // The whole promise of the drawer: these were cut before
                    // they were shipped, and a remover pass would only find
                    // things in them to wrongly remove.
                    removeBackground: false,
                    slice: false,
                    width,
                    x: spot.x - width / 2,
                    y: spot.y - width / 2,
                    by: "agent",
                });
                // Widths match, heights may not: a pencil at sheep-width is a
                // tower. Rein tall or tiny newcomers toward the peers' height.
                const tamed = tamedWidth(layer, world);
                if (tamed !== null) studio.collage.update(layer.id, { width: tamed });
                added.push({ id: layer.id, label: piece.id, kind: piece.kind });
            }

            return ok(
                `Added ${added.map(piece => `"${piece.label}" [${piece.id}]`).join(", ")} — already ` +
                `cut, nothing to wait for. Cast them with stage_cast (size, at, plane, flip). ` +
                `Look with show_look.`,
                { layers: added });
        },
    };
}
