/**
 * Turn the troupe packs into a module the app can import.
 *
 * Same shape as sounds.mjs, for the same reason: `static/` is outside the
 * TypeScript project, so rather than teach the build about it this writes a
 * plain module beside the code. Adding a pack is a folder, a manifest and a
 * run of this — never a code change.
 *
 *     node tools/troupe.mjs
 *
 * Two kinds of thing are picked up under static/troupe/:
 *  - `<pack>/manifest.json` beside precut webp pieces — the good path, on
 *    stage in seconds;
 *  - loose `<name>.<cols>x<rows>.webp` sheets that still need cutting — the
 *    grid read from the filename, listed so an agent knows to piece_sheet them.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "static/troupe";
// midground and foreground are full-width slices of ONE scene, made to stack
// on a backdrop — a parallax kit, not scenery. The first pack to arrive used
// exactly these words and the validator forced them into "backdrop", which
// was the validator being wrong.
const KINDS = new Set(["backdrop", "midground", "foreground", "scenery", "actor"]);
const FACINGS = new Set(["front", "left", "right"]);

const pieces = [];
const sheets = [];
const packs = [];
const cataloguePath = join(ROOT, "manifest.json");
const catalogue = existsSync(cataloguePath)
    ? JSON.parse(readFileSync(cataloguePath, "utf8").replace(/^﻿/, ""))
    : {};

if (existsSync(ROOT)) {
    for (const entry of readdirSync(ROOT)) {
        const path = join(ROOT, entry);

        // A loose sheet, its grid in its name: woodland-props.5x5.webp
        const sheet = /^(.+)\.(\d+)x(\d+)\.webp$/i.exec(entry);
        if (sheet && statSync(path).isFile()) {
            sheets.push({
                id: sheet[1],
                file: `/troupe/${entry}`,
                columns: Number(sheet[2]),
                rows: Number(sheet[3]),
            });
            continue;
        }

        if (!statSync(path).isDirectory()) continue;
        const manifestPath = join(path, "manifest.json");
        if (!existsSync(manifestPath)) continue;

        const manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^﻿/, ""));

        /*
         * Retired art, kept on disk and out of the drawer.
         *
         * The show moved from painted stages to free objects on bare paper,
         * which left the midground and foreground layers with nothing to do:
         * they are full-width slices of one room, and a room is exactly what
         * stopped being painted. Deleting them would throw away work that is
         * fine in itself and might be wanted again; leaving them in the drawer
         * offers an agent a parallax kit for a show that has no parallax.
         *
         * So: "hidden": true on a pack or a piece keeps the file served and
         * takes the entry out of TROUPE. Reversing it is deleting one word.
         */
        if (manifest.hidden) continue;

        packs.push({
            id: entry,
            description: manifest.description ?? "",
            // The image-generation prompt this pack was made with, if whoever
            // made it wrote it down. It is the only way an agent can generate
            // NEW pieces that match: the style is in the prompt, not in
            // anything the pixels can tell it.
            ...(manifest.stylePrompt ? { stylePrompt: manifest.stylePrompt } : {}),
        });
        for (const [id, piece] of Object.entries(manifest.pieces ?? {})) {
            if (piece.hidden) continue;
            if (!KINDS.has(piece.kind)) {
                // Loudly, at generation time — a typo'd kind that was silently
                // dropped would look like a missing piece three tools later.
                throw new Error(
                    `${entry}/${id}: kind ${JSON.stringify(piece.kind)} is not one of ` +
                    `backdrop | midground | foreground | scenery | actor`);
            }
            const file = join(path, piece.file);
            if (!existsSync(file)) throw new Error(`${entry}/${id}: ${piece.file} does not exist`);
            if (piece.facing != null && !FACINGS.has(piece.facing)) {
                throw new Error(
                    `${entry}/${id}: facing ${JSON.stringify(piece.facing)} is not one of front | left | right`);
            }
            pieces.push({
                id: `${entry}/${id}`,
                pack: entry,
                kind: piece.kind,
                file: `/troupe/${entry}/${piece.file}`,
                mood: piece.mood ?? [],
                description: piece.description ?? "",
                ...(piece.facing ? { facing: piece.facing } : {}),
                ...(piece.take ? { take: `${entry}/${piece.take}` } : {}),
            });
        }
    }
}

pieces.sort((a, b) => a.pack.localeCompare(b.pack) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
packs.sort((a, b) => a.id.localeCompare(b.id));
sheets.sort((a, b) => a.id.localeCompare(b.id));

const packIds = new Set(packs.map(pack => pack.id));
const shelf = {
    assorted: (catalogue.shelf?.assorted ?? []).map(group => {
        if (!group.id || !group.label || !Array.isArray(group.packs) || !group.packs.length) {
            throw new Error(`static/troupe/manifest.json: each assorted shelf group needs id, label and packs`);
        }
        for (const pack of group.packs) {
            if (!packIds.has(pack)) throw new Error(`static/troupe/manifest.json: unknown pack ${JSON.stringify(pack)}`);
        }
        const kinds = group.kinds ?? ["actor", "scenery"];
        for (const kind of kinds) {
            if (!KINDS.has(kind)) throw new Error(`static/troupe/manifest.json: unknown kind ${JSON.stringify(kind)}`);
        }
        return { id: group.id, label: group.label, packs: group.packs, kinds };
    }),
    themes: (catalogue.shelf?.themes ?? []).map(theme => {
        if (!theme.pack || !theme.label || !packIds.has(theme.pack)) {
            throw new Error(`static/troupe/manifest.json: each theme needs a label and an installed pack`);
        }
        for (const kind of ["actor", "scenery"]) {
            if (!pieces.some(piece => piece.pack === theme.pack && piece.kind === kind)) {
                throw new Error(
                    `static/troupe/manifest.json: theme ${JSON.stringify(theme.pack)} has no ${kind} pieces`);
            }
        }
        return { id: theme.pack, label: theme.label, packs: [theme.pack], kinds: ["actor", "scenery"] };
    }),
};

const pieceLine = (p) => {
    const parts = [
        `id: ${JSON.stringify(p.id)}`,
        `pack: ${JSON.stringify(p.pack)}`,
        `kind: ${JSON.stringify(p.kind)}`,
        `file: ${JSON.stringify(p.file)}`,
        `mood: ${JSON.stringify(p.mood)}`,
        `description: ${JSON.stringify(p.description)}`,
        ...(p.facing ? [`facing: ${JSON.stringify(p.facing)}`] : []),
        ...(p.take ? [`take: ${JSON.stringify(p.take)}`] : []),
    ];
    return `    { ${parts.join(", ")} },`;
};

const sheetLine = (s) =>
    `    { id: ${JSON.stringify(s.id)}, file: ${JSON.stringify(s.file)}, ` +
    `columns: ${s.columns}, rows: ${s.rows} },`;

writeFileSync("src/lib/collage/troupe.ts", `/**
 * The troupe: ready-made art that ships with the theatre.
 *
 * GENERATED by tools/troupe.mjs from static/troupe/ — do not edit. Adding a
 * pack is a folder, a manifest and a run of that script; see
 * static/troupe/README.md for the conventions.
 */

export type TroupeKind = "backdrop" | "midground" | "foreground" | "scenery" | "actor";

export interface TroupePiece {
    /** "<pack>/<name>" — what an agent asks for. */
    id: string;
    pack: string;
    kind: TroupeKind;
    /** Served from static/, so this is the URL as the page sees it. */
    file: string;
    mood: string[];
    description: string;
    /** Direction drawn into the art. Omitted when the piece has no directional read. */
    facing?: "front" | "left" | "right";
    /** Pieces sharing a take are the same character in another pose. */
    take?: string;
}

/** An uncut sheet, its grid read from its filename. Needs piece_sheet. */
export interface TroupeSheet {
    id: string;
    file: string;
    columns: number;
    rows: number;
}

/** A pack: its blurb, and — when recorded — the prompt that generated it. */
export interface TroupePack {
    id: string;
    description: string;
    stylePrompt?: string;
}

/** A labelled pile on the human-facing shelf, configured in the root manifest. */
export interface TroupeShelfGroup {
    id: string;
    label: string;
    packs: string[];
    kinds: TroupeKind[];
}

export const TROUPE_PACKS: TroupePack[] = [
${packs.map(pack => {
    const parts = [
        `id: ${JSON.stringify(pack.id)}`,
        `description: ${JSON.stringify(pack.description)}`,
        ...(pack.stylePrompt ? [`stylePrompt: ${JSON.stringify(pack.stylePrompt)}`] : []),
    ];
    return `    { ${parts.join(", ")} },`;
}).join("\n") || "    // No packs installed."}
];

export const TROUPE_SHELF: { assorted: TroupeShelfGroup[]; themes: TroupeShelfGroup[] } = ${JSON.stringify(shelf, null, 4)};

export const TROUPE: TroupePiece[] = [
${pieces.map(pieceLine).join("\n") || "    // No packs installed. static/troupe/README.md says how to add one."}
];

export const TROUPE_SHEETS: TroupeSheet[] = [
${sheets.map(sheetLine).join("\n") || "    // No uncut sheets."}
];
`);

console.log(`troupe: ${pieces.length} piece(s) in ${new Set(pieces.map(p => p.pack)).size} pack(s), ${sheets.length} sheet(s)`);
