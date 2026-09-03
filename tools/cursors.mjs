/**
 * Paper cursors, from the icon sheet.
 *
 * The same drawings serve two jobs. As art they are props a play can use — a
 * pencil, an eraser, a speech bubble. As cursors they say which tool is in
 * hand, which a toolbar button alone does not: the pointer is where the eye
 * already is.
 *
 * Three things a custom cursor needs and an image does not:
 *
 * A HOTSPOT. Without one the browser clicks from the top-left corner of the
 * image, and for a pencil drawn point-down that is a couple of centimetres
 * above the point. Every rule below carries explicit coordinates, and for the
 * pencil they are measured off the alpha rather than guessed.
 *
 * A SMALL IMAGE. Chrome ignores a cursor over 128px, and a cursor that is
 * ignored falls back silently. These ship at 32 with a 64 for 2x screens.
 *
 * PNG. Chrome and Firefox accept webp cursors; Safari historically has not,
 * and the failure is invisible — you get the default arrow and no error.
 *
 *     node tools/cursors.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = process.argv[2] ?? "static/cursors/source";
const DST = "static/cursors";
const MAGICK = "magick";

const ICONS = [
    { file: "normal-cursor.webp", name: "arrow", hot: "top-tip", fallback: "default" },
    { file: "paper-cursors-final_island1.webp", name: "eraser", hot: "bottom-left", fallback: "pointer" },
    { file: "paper-cursors-final_island2.webp", name: "text", hot: "centre", fallback: "text" },
    { file: "paper-cursors-final_island3.webp", name: "comment", hot: "bottom-left", fallback: "pointer" },
    { file: "pencil.webp", name: "pencil", hot: "bottom-tip", fallback: "crosshair" },
    { file: "extra-cursors_island0.webp", name: "point", hot: "top-centre", fallback: "pointer" },
    { file: "extra-cursors_island1.webp", name: "open", hot: "centre", fallback: "grab" },
    { file: "extra-cursors_island2.webp", name: "closed", hot: "centre", fallback: "grabbing" },
    { file: "extra-cursors_island3.webp", name: "move", hot: "centre", fallback: "move" },
    // The supplied arrow slopes /; a bottom-right handle grows on the \ axis.
    { file: "extra-cursors_island4.webp", name: "resize", hot: "centre", fallback: "nwse-resize", flop: true },
    { file: "extra-cursors_island5.webp", name: "forbidden", hot: "centre", fallback: "not-allowed" },
    { file: "ai-agent-states_island0.webp", name: "agent-ready", hot: "centre", fallback: "default" },
    { file: "ai-agent-states_island1.webp", name: "agent-thinking", hot: "centre", fallback: "wait" },
    { file: "ai-agent-states_island2.webp", name: "agent-working", hot: "centre", fallback: "progress" },
];

const run = (args) => execFileSync(MAGICK, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * The lowest opaque row, and the middle of the opaque run in it.
 *
 * For anything drawn point-down that is the point. Measured rather than
 * guessed because a few pixels of error in a cursor hotspot is the difference
 * between drawing where you meant to and drawing slightly off, every time.
 */
function bottomTip(png) {
    const txt = run([png, "-alpha", "extract", "txt:-"]);
    let maxY = -1, xs = [];
    for (const line of txt.split("\n")) {
        const m = /^(\d+),(\d+): \((\d+)/.exec(line);
        if (!m) continue;
        const [x, y, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (a <= 128) continue;
        if (y > maxY) { maxY = y; xs = [x]; }
        else if (y === maxY) xs.push(x);
    }
    return [Math.round(xs.reduce((s, x) => s + x, 0) / xs.length), maxY];
}

/**
 * The highest opaque row, and the leftmost opaque pixel in it.
 *
 * An arrow points up and to the left, so its tip is the top-left extreme of
 * the drawing rather than its centre — and the tip is the whole contract of a
 * pointer. A couple of pixels out here is a click that lands somewhere the
 * person did not point, every single time.
 */
function topTip(png) {
    const txt = run([png, "-alpha", "extract", "txt:-"]);
    let minY = Infinity, xs = [];
    for (const line of txt.split("\n")) {
        const m = /^(\d+),(\d+): \((\d+)/.exec(line);
        if (!m) continue;
        const [x, y, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (a <= 128) continue;
        if (y < minY) { minY = y; xs = [x]; }
        else if (y === minY) xs.push(x);
    }
    return [Math.min(...xs), minY];
}

mkdirSync(DST, { recursive: true });
const rows = [];
for (const icon of ICONS) {
    const from = join(SRC, icon.file);
    for (const size of [32, 64]) {
        run([from, ...(icon.flop ? ["-flop"] : []), "-trim", "+repage", "-resize", `${size}x${size}`,
            "-background", "none", "-gravity", "center", "-extent", `${size}x${size}`,
            join(DST, `${icon.name}-${size}.png`)]);
    }
    // Hotspots are in CSS pixels, so measure the 32.
    const small = join(DST, `${icon.name}-32.png`);
    const [w, h] = run([small, "-format", "%w %h", "info:"]).split(" ").map(Number);
    const hot = icon.hot === "centre" ? [Math.round(w / 2), Math.round(h / 2)]
        : icon.hot === "top-centre" ? [Math.round(w / 2), 1]
        : icon.hot === "bottom-left" ? [3, h - 3]
            : icon.hot === "top-tip" ? topTip(small)
                : bottomTip(small);
    rows.push({ ...icon, hot });
    console.log(`${icon.name.padEnd(9)} hotspot ${hot[0]},${hot[1]}  (${icon.hot})`);
}

const css = [
    "/*",
    " * Paper cursors. GENERATED by tools/cursors.mjs - do not edit.",
    " *",
    " * One class per tool. Each carries a 1x and a 2x image and an explicit",
    " * hotspot: without one the browser clicks from the top-left corner, which",
    " * for a pencil is well above where the point is.",
    " *",
    " * PNG rather than webp: Safari has historically refused webp cursors, and a",
    " * cursor that falls back silently is a hard bug to notice.",
    " *",
    " * Every rule ends in a real keyword, so a browser that rejects the image -",
    " * or the size - still shows something sensible.",
    " */",
    ":root {",
    "    --paper-cursor-kind: arrow;",
    `    --cursor-default: image-set(url("/cursors/arrow-32.png") 1x, url("/cursors/arrow-64.png") 2x) ${rows[0].hot[0]} ${rows[0].hot[1]}, default;`,
    `    --cursor-text: image-set(url("/cursors/text-32.png") 1x, url("/cursors/text-64.png") 2x) ${rows[2].hot[0]} ${rows[2].hot[1]}, text;`,
    `    --cursor-pointer: image-set(url("/cursors/point-32.png") 1x, url("/cursors/point-64.png") 2x) ${rows[5].hot[0]} ${rows[5].hot[1]}, pointer;`,
    `    --cursor-grab: image-set(url("/cursors/open-32.png") 1x, url("/cursors/open-64.png") 2x) ${rows[6].hot[0]} ${rows[6].hot[1]}, grab;`,
    `    --cursor-grabbing: image-set(url("/cursors/closed-32.png") 1x, url("/cursors/closed-64.png") 2x) ${rows[7].hot[0]} ${rows[7].hot[1]}, grabbing;`,
    `    --cursor-move: image-set(url("/cursors/move-32.png") 1x, url("/cursors/move-64.png") 2x) ${rows[8].hot[0]} ${rows[8].hot[1]}, move;`,
    `    --cursor-resize: image-set(url("/cursors/resize-32.png") 1x, url("/cursors/resize-64.png") 2x) ${rows[9].hot[0]} ${rows[9].hot[1]}, nwse-resize;`,
    `    --cursor-forbidden: image-set(url("/cursors/forbidden-32.png") 1x, url("/cursors/forbidden-64.png") 2x) ${rows[10].hot[0]} ${rows[10].hot[1]}, not-allowed;`,
    "}",
    "",
    "/*",
    " * The arrow is the page's default, not a class you opt into.",
    " *",
    " * :where() so it carries no specificity at all: every element that names",
    " * its own cursor - a button, a text field, the canvas mid-drag - still wins",
    " * without needing to know this rule exists.",
    " */",
    ":where(html) {",
    `    cursor: url("/cursors/arrow-32.png") ${rows[0].hot[0]} ${rows[0].hot[1]}, default;`,
    "    cursor: var(--cursor-default);",
    "}",
    "",
    "/* Native controls otherwise bring the operating-system cursors back. */",
    ":where(a[href], button:not(:disabled), [role=\"button\"], summary, select, label[for]) {",
    "    --paper-cursor-kind: point;",
    "    cursor: var(--cursor-pointer);",
    "}",
    ":where(button:disabled, [aria-disabled=\"true\"]) {",
    "    --paper-cursor-kind: forbidden;",
    "    cursor: var(--cursor-forbidden);",
    "}",
    ":where(input, textarea, [contenteditable=\"true\"]) {",
    "    --paper-cursor-kind: text;",
    "    cursor: var(--cursor-text);",
    "}",
    ":where(.viewport, .fan__sticker, .strewn__prop, .handle--rotate) {",
    "    --paper-cursor-kind: open;",
    "}",
    ":where(.viewport:active, .fan__sticker:active, .strewn__prop--held, .handle--rotate:active) {",
    "    --paper-cursor-kind: closed;",
    "}",
    ":where(.viewport--over, .viewport--over:active) { --paper-cursor-kind: move; }",
    ":where(.handle--resize) { --paper-cursor-kind: resize; }",
    ":where(.viewport--showing) { --paper-cursor-kind: arrow; }",
    "/* CollageCanvas supplies its own animated eraser at this point. */",
    ":where(.viewport--erasing, .viewport--erasing *) { --paper-cursor-kind: none; }",
    ...rows.flatMap(r => [
        "",
        `.cursor-${r.name} {`,
        `    --paper-cursor-kind: ${r.name};`,
        `    cursor: url("/cursors/${r.name}-32.png") ${r.hot[0]} ${r.hot[1]}, ${r.fallback};`,
        `    cursor: image-set(url("/cursors/${r.name}-32.png") 1x, url("/cursors/${r.name}-64.png") 2x) ${r.hot[0]} ${r.hot[1]}, ${r.fallback};`,
        "}",
    ]),
    "",
].join("\n");
writeFileSync(join(DST, "cursors.css"), css, "utf8");

console.log(`\nwrote ${DST}/cursors.css and ${rows.length * 2} png`);
for (const f of readdirSync(DST).sort()) console.log("  " + f);
