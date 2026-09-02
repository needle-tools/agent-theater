/**
 * Asking for the artwork.
 *
 * The page can cut a picture up, remove its background and put it on a stage.
 * It cannot draw. So the one thing missing from "an agent can put on a play" is
 * the pictures — and the agent making the play usually cannot draw either; it
 * can only ask something that can.
 *
 * This writes that request. Not a hint or a starting point: the whole prompt,
 * including the parts an image model will get wrong unless told — the gutters,
 * the empty middle of a background, the feet being visible on a character who is
 * going to walk. Those come from what happens to the picture afterwards, which
 * is knowledge this page has and the model being asked does not.
 *
 * Everything here is a pure function of its arguments so the wording can be
 * tested. A prompt that quietly stopped saying "no drop shadows" would show up
 * as sheets that cut badly, three tool calls later, with nothing to point at.
 */

/**
 * What the sheet is for.
 *
 * Three, because a set is built rather than painted. An image model asked for
 * "a forest" returns one beautiful picture with the trunks, the ferns, the
 * light and the path baked together — and a baked picture is a photograph of a
 * set, not a set. Nothing in it can stand in front of anything else, nothing
 * can slide at a different speed when the camera moves, and the whole depth of
 * the scene is a flat card behind the actors.
 *
 * So the backdrop is asked for nearly empty, and the things in front of it are
 * asked for separately, and the scene is assembled here out of both.
 */
export type ArtKind = "actors" | "backgrounds" | "scenery";

/** The shape of one cell, which is the shape of one stage. */
export type ArtShape = "wide" | "square" | "tall";

export interface ArtRequest {
    kind: ArtKind;
    /** What the play is about, in the user's words. */
    topic?: string;
    columns?: number;
    rows?: number;
    shape?: ArtShape;
    /** One line per cell, when the agent already knows what it wants in each. */
    subjects?: string[];
}

export interface ArtPrompt {
    /** The text to hand to an image model. */
    prompt: string;
    columns: number;
    rows: number;
    /** Brand names taken out, so the agent can say so rather than wonder. */
    removed: string[];
    /** What each cell should hold, once defaults have filled the gaps. */
    subjects: string[];
}

/**
 * The house style.
 *
 * One style, not a choice of styles. Everything on the stage has to look like it
 * came from the same box — a painted wolf next to a paper grandmother is not a
 * play, it is a mistake — and the surest way to get that is to stop offering the
 * decision. It is also a style that survives being cut out: flat matte shapes
 * with a clean silhouette are what a background remover is good at, where soft
 * airbrushed edges and drop shadows are what it is bad at.
 *
 * Written mostly in negatives, and stated FIRST in the prompt rather than last.
 * Both of those are scars. An image model asked for "storybook illustration"
 * hears "illustration" and returns a rendered digital painting with volumetric
 * light in it — the word has been used to sell that for twenty years — so the
 * things this must NOT have are worth more words than the things it must. And a
 * style paragraph at the end of a long prompt is the part that gets skimmed,
 * which is exactly how a set of flat paper cut-outs came back as oil paintings.
 */
const STYLE = [
    "STYLE — follow this exactly, it matters more than the subject:",
    "Torn and cut paper collage. Every single shape is a piece of coloured paper that has been",
    "cut with scissors or torn by hand and laid flat on top of the others, with visible torn",
    "deckle edges, paper grain, fibre and a dry speckled gouache texture inside each shape.",
    "Small details — faces, eyes, twigs, stitching — are drawn on top in fine black ink line.",
    "Seen STRAIGHT ON, flat, from the front — the way an audience sees a puppet theatre or a",
    "paper cut-out stage. There is no vanishing point and no perspective anywhere: no path or",
    "road receding into the distance, no ground tilting away from the viewer, no floor drawn",
    "in three-quarter view, no foreshortening. Depth is made only by putting one flat shape in",
    "front of another, never by making things smaller as they go back.",
    "ABSOLUTELY NOT: digital painting, watercolour, gouache painting, concept art, rendered 3D,",
    "airbrushing, photorealism, cinematic lighting, dappled light, volumetric light, glow,",
    "ambient occlusion, depth of field, blur, gradients, soft shading, cast shadows,",
    "reflections, perspective depth, or texture that looks painted rather than papery.",
    "Nothing is lit. Nothing is round. Nothing recedes. Everything is flat.",
    "Shapes are simple, geometric and slightly naive — built from a few pieces, the way a",
    "child's paper cut-out is, not the way an illustrator renders a form.",
    "Palette: muted, warm and mid-century — moss and olive green, deep navy used instead of",
    "black, brick red, cream, dusty rose, mustard, soft pink. Four to six colours in total,",
    "used as large flat areas.",
].join(" ");

/**
 * What the backdrop's flatness means, over and above the house style.
 *
 * The shape budget is a number on purpose. "Almost empty" is a preference and
 * comes back as a beautiful full illustration every time; "at most five shapes
 * in the whole cell" is a rule, and a rule can be followed. The examples are
 * there for the same reason — they say what an acceptable answer looks like,
 * which is a thing no amount of prohibition can convey.
 */
const BACKDROP_STYLE = [
    "The backdrop is the flattest and emptiest thing of all. Hard limit: AT MOST FIVE separate",
    "shapes in the entire cell, on top of one or two plain fields of colour. Any distant shape",
    "is a plain silhouette cut from a single colour with no detail inside it.",
    "Examples of a complete, finished, correct backdrop: a pink sky, a cream paper cloud, and a",
    "band of darker pink along the bottom. Or an olive green field with three navy tree-trunk",
    "silhouettes standing in it. Or a cream wall with one window shape and a brown floor band.",
    "That is the ENTIRE picture — nothing else belongs in it.",
    "The ground is a plain horizontal band across the bottom of the cell. It is NOT a path, a",
    "road or a clearing going away from the viewer, and it has no texture, stones or detail.",
    "No trees in the foreground, no bushes, no plants, no flowers, no furniture, no props, no",
    "leaves overhead, no branches framing the edges: every one of those is drawn on its own",
    "sheet and laid on top afterwards. If it would be nice to look at on its own, it is wrong.",
].join(" ");

/**
 * Brand names, and what to ask for instead.
 *
 * Naming a studio in a prompt asks a model to imitate that studio, which is
 * both the thing image models are asked not to do and a poor way to get what
 * the person actually wanted — "Disney" as a wish nearly always means warm,
 * rounded and expressive rather than any particular film. So the name comes out
 * and the quality it stood for goes in, which is a better prompt as well as a
 * safer one.
 *
 * The agent is told what was swapped rather than having it done silently: it
 * asked for something and got something else, and it should be able to say so.
 */
const BRANDS: Array<{ match: RegExp; instead: string }> = [
    { match: /\bdisney(\s*\+|land|world)?\b/gi, instead: "warm rounded expressive characters with large friendly eyes" },
    { match: /\bpixar\b/gi, instead: "appealing chunky character shapes with a lot of personality" },
    { match: /\b(studio\s+)?ghibli\b/gi, instead: "gentle hand-painted scenery with soft natural light" },
    { match: /\bmiyazaki\b/gi, instead: "gentle hand-painted scenery with soft natural light" },
    { match: /\bdreamworks\b/gi, instead: "bold characterful cartoon shapes" },
    { match: /\bmarvel\b/gi, instead: "heroic comic-book figures" },
    { match: /\bdc\s+comics\b/gi, instead: "heroic comic-book figures" },
    { match: /\bstar\s*wars\b/gi, instead: "a space adventure with robots and desert planets" },
    { match: /\bharry\s*potter\b/gi, instead: "a school of wizards with robes and owls" },
    { match: /\bpok[eé]mon\b/gi, instead: "small collectable creature companions" },
    { match: /\bnintendo\b/gi, instead: "bright playful video-game characters" },
    { match: /\b(super\s*)?mario\b/gi, instead: "a moustachioed plumber in a red cap" },
    { match: /\bminecraft\b/gi, instead: "blocky voxel characters and scenery" },
    { match: /\bbarbie\b/gi, instead: "a fashion doll in bright pink" },
    { match: /\blego\b/gi, instead: "little plastic brick figures" },
    { match: /\bhello\s*kitty\b|\bsanrio\b/gi, instead: "very cute round pastel characters" },
    { match: /\bpaw\s*patrol\b/gi, instead: "a team of rescue puppies in uniform" },
    { match: /\bpeppa\s*pig\b/gi, instead: "a simple cheerful cartoon pig family" },
    { match: /\bbluey\b/gi, instead: "a playful cartoon dog family" },
    { match: /\bsesame\s*street\b|\bmuppets?\b/gi, instead: "colourful friendly puppet characters" },
    { match: /\b(the\s+)?simpsons\b/gi, instead: "yellow-skinned satirical cartoon townsfolk" },
    { match: /\blooney\s*tunes\b|\bwarner\s*bros\.?\b/gi, instead: "rubbery slapstick cartoon animals" },
    { match: /\bfrozen\b/gi, instead: "an icy northern kingdom with snow and long braids" },
    { match: /\bmoana\b/gi, instead: "an island voyage across the open ocean" },
    { match: /\bencanto\b/gi, instead: "a magical family house full of colour" },
];

/**
 * Take the brand names out of a topic, leaving what was wanted.
 *
 * Returns the rewritten topic and the names removed, in the order they were
 * found, so the caller can report the substitution rather than pretending the
 * request went through untouched.
 */
export function scrubBrands(topic: string): { topic: string; removed: string[] } {
    const removed: string[] = [];
    let out = topic;
    for (const brand of BRANDS) {
        // Fresh regex per pass: these are global and carry lastIndex between
        // calls, which would make every second call miss.
        const finder = new RegExp(brand.match.source, brand.match.flags);
        const hits = out.match(finder);
        if (!hits) continue;
        for (const hit of hits) {
            const word = hit.trim();
            if (!removed.some(seen => seen.toLowerCase() === word.toLowerCase())) removed.push(word);
        }
        out = out.replace(new RegExp(brand.match.source, brand.match.flags), brand.instead);
    }
    // Tidy the seams left by a substitution — "a story about  , with"
    return { topic: out.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim(), removed };
}

const ASPECT: Record<ArtShape, string> = {
    wide: "16:9 landscape",
    square: "1:1 square",
    tall: "9:16 portrait",
};

/**
 * How many cells each kind wants by default, and in what shape.
 *
 * Five by five for anything that gets cut out. Twenty-five pieces from one
 * generation is the difference between a set built in one round trip and a set
 * built in nine, and the things on those sheets are small — a bush, a stool, a
 * character two hundred pixels tall on a stage — so the resolution each cell
 * gets is plenty.
 *
 * Backdrops are the exception, and it is not a preference. A backdrop is the
 * whole stage: it fills the view, the camera pushes into it, and it is the one
 * picture whose pixels are actually looked at. Twenty-five of them on one sheet
 * is twenty-five postage stamps — at a typical generation size each cell would
 * come back a few hundred pixels wide and be soft the moment it was stretched
 * across the stage. Four is what fits, and four scenes is a play.
 */
const DEFAULTS: Record<ArtKind, { columns: number; rows: number; shape: ArtShape }> = {
    backgrounds: { columns: 2, rows: 2, shape: "wide" },
    actors: { columns: 5, rows: 5, shape: "square" },
    scenery: { columns: 5, rows: 5, shape: "square" },
};

/**
 * What to draw when nobody said.
 *
 * Long enough to fill a five by five without repeating, because the lists cycle
 * and a cycled list asks an image model to draw the same tree three times — it
 * will, and then three cells of the sheet are worthless. These are deliberately
 * generic: the topic carries the story, and a fallback that assumed a fairy
 * tale would be wrong for every play that is not one.
 */
function fallbackSubjects(kind: ArtKind, count: number): string[] {
    const lists: Record<ArtKind, string[]> = {
        backgrounds: [
            "a forest, far trees and sky only",
            "the inside of a cottage, back wall and floor only",
            "a village at dusk, distant roofs and sky",
            "an open field under a wide sky",
            "a hillside at dawn, distant hills only",
            "a riverbank, far shore and water",
        ],
        actors: [
            "the main character, full body, standing",
            "the main character again, seen from the side, walking",
            "a second character, full body, standing",
            "a third character, full body, standing",
            "an older character, full body, standing",
            "a child, full body, standing",
            "a very small child, full body, standing",
            "an old man with a stick",
            "an old woman with a shawl",
            "a tall thin character",
            "a short round character",
            "a character in a cloak with the hood up",
            "a character carrying a basket",
            "a character carrying a lantern",
            "a dog, standing, side on",
            "a cat, sitting, side on",
            "a bird with its wings folded",
            "a bird with its wings open",
            "a mouse, side on",
            "a rabbit, side on",
            "a horse, side on",
            "a large wild animal, side on",
            "a fish",
            "a frog",
            "a small creature nobody can name",
        ],
        scenery: [
            "a large leafy tree", "a second, quite different leafy tree", "a tall pine tree",
            "a bare winter tree", "a tree stump",
            "a round bush", "a flowering bush", "a clump of tall grass",
            "a clump of flowers", "a cluster of mushrooms",
            "a large rock", "a small rock", "a pile of stones",
            "a small house", "a wooden door on its own", "a window on its own",
            "a section of wooden fence", "a signpost", "a stone well",
            "a wooden table", "a wooden chair", "a stool",
            "a barrel", "a basket", "a hanging lantern",
        ],
    };
    const list = lists[kind];
    return Array.from({ length: count }, (_, i) => list[i % list.length]);
}

/**
 * Write the request.
 *
 * The two kinds share the style and the sheet mechanics and disagree about
 * everything else, which is why they are one function: the sheet rules are the
 * part that must not drift apart between them, because the same cutter reads
 * both.
 */
export function artPrompt(request: ArtRequest): ArtPrompt {
    const kind: ArtKind = request.kind === "backgrounds" ? "backgrounds"
        : request.kind === "scenery" ? "scenery"
            : "actors";
    const defaults = DEFAULTS[kind];
    const columns = clampCount(request.columns ?? defaults.columns);
    const rows = clampCount(request.rows ?? defaults.rows);
    const shape = request.shape ?? defaults.shape;
    const cells = columns * rows;

    const scrubbed = scrubBrands((request.topic ?? "").trim());
    const given = (request.subjects ?? []).map(s => (s ?? "").trim()).filter(Boolean);
    const subjects = given.length
        ? Array.from({ length: cells }, (_, i) => given[i] ?? fallbackSubjects(kind, cells)[i])
        : fallbackSubjects(kind, cells);

    const about = scrubbed.topic
        ? `The play is about: ${scrubbed.topic}. Everything on the sheet belongs to that story.`
        : `The play is a simple folk tale.`;

    // The rules the cutter depends on. Stated as rules rather than preferences
    // because an image model treats a preference as a suggestion, and a sheet
    // with its subjects touching cannot be cut into separate pieces at all.
    const sheet = [
        `Draw ONE sheet: a ${columns} × ${rows} grid of ${cells} separate pictures.`,
        `Each cell is ${ASPECT[shape]}.`,
        `The cells must be exactly equal in size and evenly spaced, filling the whole image edge to edge,`,
        `in reading order (left to right, then down).`,
        `Leave a clear even gap between cells and keep every subject well inside its own cell —`,
        `nothing may touch or cross a cell edge, and nothing may overlap a neighbour.`,
        `No grid lines, no borders, no frames, no numbers, no captions, no text of any kind,`,
        `no watermark, no signature.`,
    ].join(" ");

    /*
     * Two rules that only matter because this is a SHEET.
     *
     * The white keyline is the expensive one. Every model has been trained on
     * sticker packs, so anything drawn as a cut-out comes back with a white
     * die-cut border around it — and that border survives the background
     * removal, because it is part of the drawing rather than part of the
     * background. The result is a cast with a white halo, which is exactly the
     * thing that had to be turned off as a default. Cheaper to say it three
     * times here than to fix it afterwards on twenty-five pieces.
     *
     * The other is mode collapse. Asked for twenty-five trees, a model draws
     * one tree twenty-five times with the leaves nudged, and two thirds of a
     * sheet is then worthless. Insisting on it is not enough; being made to
     * write the list out first is what actually works, because the repetition
     * becomes visible to the model before it starts drawing.
     */
    const noHalo = kind === "backgrounds" ? "" : [
        `NO WHITE OUTLINES. Do not draw a white keyline, a die-cut sticker border, a stroke or a`,
        `glow around anything. This is not a sticker pack. Each subject sits on the plain`,
        `background with nothing at all between it and the background — the edge of the subject is`,
        `the edge of the paper it is cut from. NO OUTLINES.`,
    ].join(" ");

    const distinct = cells < 4 ? "" : [
        `Before you draw anything, write out all ${cells} descriptions and check them:`,
        `every one must be a COMPLETELY DIFFERENT object, not a variation of its neighbour.`,
        `No two cells may share a shape, a pose, a silhouette or a colour scheme.`,
        `Do not draw ${cells} versions of the same idea with small changes —`,
        `${cells} genuinely different things, or the sheet is wasted.`,
        `Remember: ${cells} unique descriptions, then one picture per description.`,
    ].join(" ");

    const specific = kind === "backgrounds"
        ? [
            `Each cell is the FAR BACKDROP of a stage — the part that never moves and that everything`,
            `else stands in front of. It must be almost empty: sky, distant shapes, a ground plane, and`,
            `nothing else. Put NO trees, bushes, furniture, props or objects in the foreground or the`,
            `middle; those are drawn separately and layered on top afterwards, and a backdrop with them`,
            `already painted in cannot have anything stood in front of it.`,
            `Large flat areas, a simple horizon or floor line in the lower third, detail only near the`,
            `top and the far edges, low contrast, nothing that competes with a figure placed on top.`,
            `No characters and no people. Fill each cell to its edges.`,
        ].join(" ")
        : kind === "scenery"
            ? [
                `Each cell holds ONE piece of scenery — a tree, a bush, a rock, a door, a table — on a`,
                `PLAIN WHITE background, cut-out style, with no shadow, no ground under it, no sky behind`,
                `it and nothing else in the cell. These are the layers a set is built from: they will be`,
                `placed in front of a backdrop, at different depths, and slid past each other as the`,
                `camera moves, so each one must be complete and separate. Draw the whole object, not a`,
                `part of a scene, and do not draw two things in one cell.`,
                `Keep the same scale, the same lighting and the same level of detail across every cell.`,
            ].join(" ")
            : [
                `Each cell holds ONE character on a PLAIN WHITE background, cut-out style, with no shadow,`,
                `no ground, no scenery and no base or platform beneath them.`,
                `Full body, facing the viewer, standing upright with their feet visible and their arms`,
                `clear of their sides — they will be animated walking, jumping and bowing, so nothing may`,
                `be cropped and nothing may merge into the background.`,
                `Keep the same scale, the same lighting and the same level of detail across every cell.`,
            ].join(" ");

    const list = subjects.map((subject, i) => `  ${i + 1}. ${subject}`).join("\n");

    return {
        prompt: [
            // Style before subject, because the end of a long prompt is what
            // gets skimmed and the style is the part that must not be.
            `${STYLE}`,
            ...(kind === "backgrounds" ? [``, BACKDROP_STYLE] : []),
            ``,
            `${sheet}`,
            ``,
            `${about}`,
            ``,
            `${specific}`,
            ...(noHalo ? [``, noHalo] : []),
            ...(distinct ? [``, distinct] : []),
            ``,
            `The ${cells} cells, in order:`,
            list,
            ``,
            `Remember: torn paper, flat colour, no lighting, no rendering` +
            `${noHalo ? ", and no white outlines" : ""}.`,
        ].join("\n"),
        columns,
        rows,
        removed: scrubbed.removed,
        subjects,
    };
}

/** Small enough to draw well, big enough to be worth one sheet. */
function clampCount(value: number): number {
    if (!Number.isFinite(value)) return 2;
    return Math.max(1, Math.min(5, Math.round(value)));
}
