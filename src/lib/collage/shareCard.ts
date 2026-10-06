import type { ImageLayer } from "./model.js";
import type { StoredDoc } from "./persistence.js";

export const UNFURL_WIDTH = 1672;
export const UNFURL_HEIGHT = 941;

const FONT = '"Pantomime Chaos"';
const TITLE_INK = "#29262b";
// Sampled from the seven letters of "Theater" in the original poster.
const TITLE_COLORS = ["#ad262d", "#e39a2a", "#123055", "#5e6336", "#dd735e", "#d48f24", "#113159"];
const TITLE_OUTLINE = "#f8e8c8";
let fontReady: Promise<void> | undefined;

function tintedMask(mask: HTMLCanvasElement, color: string): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = mask.width;
    canvas.height = mask.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

function loadFont(): Promise<void> {
    fontReady ??= (async () => {
        const face = new FontFace("Pantomime Chaos", 'url("/fonts/Pantomime-Chaos.ttf")');
        document.fonts.add(await face.load());
    })();
    return fontReady;
}
// The central pair carries the poster. Supporting actors stay smaller at the
// curtain edges, and a fifth cut-out can stand on the books in front.
const BACK_SLOTS = [
    { x: 425, y: 5, width: 390, height: 440 },
    { x: 850, y: 5, width: 390, height: 440 },
    { x: 280, y: 145, width: 190, height: 245 },
    { x: 1250, y: 155, width: 190, height: 235 },
] as const;
const BOOK_SLOT = { x: 205, y: 570, width: 175, height: 190 };

/** Prefer named parts from the script over set dressing or background layers. */
export function unfurlCharacters(doc: StoredDoc): ImageLayer[] {
    const images = new Map(doc.layers.filter((layer): layer is ImageLayer => layer.kind === "image" && !!layer.src)
        .map(layer => [layer.id, layer]));
    const scored = new Map<string, number>();
    for (const [index, stage] of (doc.stages ?? []).entries()) {
        for (const member of stage.cast) {
            if (!images.has(member.id)) continue;
            const score = (member.as ? 100 : 10) + Math.max(0, 20 - index);
            scored.set(member.id, Math.max(scored.get(member.id) ?? 0, score));
        }
        for (const beat of stage.script) {
            if (beat.id && images.has(beat.id)) scored.set(beat.id, (scored.get(beat.id) ?? 0) + 3);
        }
    }
    return [...images.values()].sort((a, b) => (scored.get(b.id) ?? 0) - (scored.get(a.id) ?? 0));
}

async function bitmap(src: string): Promise<ImageBitmap> {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Image fetch returned ${response.status}.`);
    return createImageBitmap(await response.blob());
}

function drawCharacter(ctx: CanvasRenderingContext2D, image: ImageBitmap, layer: ImageLayer,
    slot: { x: number; y: number; width: number; height: number }) {
    const crop = layer.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const sx = crop.x * image.width;
    const sy = crop.y * image.height;
    const sw = crop.width * image.width;
    const sh = crop.height * image.height;
    if (sw <= 0 || sh <= 0) return;
    const scale = Math.min(slot.width / sw, slot.height / sh);
    const width = sw * scale;
    const height = sh * scale;
    const x = slot.x + (slot.width - width) / 2;
    const y = slot.y + slot.height - height;
    ctx.save();
    if (layer.flip) { ctx.translate(x + width, 0); ctx.scale(-1, 1); ctx.drawImage(image, sx, sy, sw, sh, 0, y, width, height); }
    else ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
    ctx.restore();
}

function drawTitle(ctx: CanvasRenderingContext2D, title: string) {
    const words = title.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
    type Row = { text: string; y: number; width: number; max: number; colorful: boolean; size: number };
    const layouts = [
        [{ y: 0, width: 850, max: 220, colorful: false },
            { y: 0, width: 850, max: 220, colorful: true }],
        [{ y: 0, width: 850, max: 155, colorful: false },
            { y: 0, width: 850, max: 155, colorful: false },
            { y: 0, width: 850, max: 155, colorful: true }],
    ];
    const fit = (text: string, width: number, maximum: number) => {
        ctx.font = `${maximum}px ${FONT}`;
        const measured = [...text].reduce((sum, char) => sum + ctx.measureText(char).width, 0);
        return Math.max(16, Math.min(maximum, Math.floor(maximum * (width - 90) / Math.max(1, measured))));
    };
    let rows: Row[] = [];
    if (words.length <= 1) {
        const text = words[0] || "Untitled play";
        rows = [{ text, y: 590, width: 970, max: 240, colorful: true, size: fit(text, 970, 240) }];
    } else {
        let bestScore = -Infinity;
        for (const layout of layouts) {
            if (layout.length === 3 && words.length < 6) continue;
            for (let first = layout.length === 3 ? 2 : 1; first < words.length; first++) {
                const lastBreaks = layout.length === 2 ? [words.length] :
                    Array.from({ length: Math.max(0, words.length - first - 3) }, (_, offset) => first + offset + 2);
                for (const second of lastBreaks) {
                    const breaks = layout.length === 2 ? [first, words.length] : [first, second, words.length];
                    let start = 0;
                    const candidate: Row[] = layout.map((row, index) => {
                        const text = words.slice(start, breaks[index]).join(" ");
                        start = breaks[index];
                        return { ...row, text, size: fit(text, row.width, row.max) };
                    });
                    const score = Math.min(...candidate.map(row => row.size)) - (layout.length === 3 ? 12 : 0);
                    if (score > bestScore) { bestScore = score; rows = candidate; }
                }
            }
        }
    }
    if (rows.length > 1) {
        const size = Math.min(...rows.map(row => row.size));
        const spacing = rows.length === 3
            ? Math.min(122, Math.max(96, size * 0.98))
            : Math.min(175, Math.max(155, size * 1.05));
        rows = rows.map((row, index) => ({
            ...row,
            size,
            y: 590 + (index - (rows.length - 1) / 2) * spacing,
            colorful: index === rows.length - 1,
        }));
    }
    ctx.textBaseline = "middle";
    for (const row of rows) {
        ctx.font = `${row.size}px ${FONT}`;
        const glyphs = [...row.text];
        const widths = glyphs.map(char => ctx.measureText(char).width);
        let x = (UNFURL_WIDTH - widths.reduce((sum, width) => sum + width, 0)) / 2;
        const positions = glyphs.map((_, index) => {
            const position = x;
            x += widths[index];
            return position;
        });
        const coloredLetters = glyphs.filter(char => char.trim()).length;
        let colorIndex = 0;
        // Pantomime Chaos is a COLR font: canvas fillStyle and strokeText do
        // not recolor or outline its baked-in glyphs. Use their alpha instead.
        const padding = 36;
        const mask = document.createElement("canvas");
        mask.width = Math.ceil(widths.reduce((sum, width) => sum + width, 0) + padding * 2);
        mask.height = Math.ceil(row.size * 1.8 + padding * 2);
        const maskCtx = mask.getContext("2d")!;
        maskCtx.font = ctx.font;
        maskCtx.textBaseline = "middle";
        const maskX = positions[0] - padding;
        const maskY = row.y - mask.height / 2;
        for (let index = 0; index < glyphs.length; index++) {
            if (glyphs[index].trim()) maskCtx.fillText(glyphs[index], positions[index] - maskX, mask.height / 2);
        }
        const stampOutline = (radius: number, color: string) => {
            const tinted = tintedMask(mask, color);
            for (let step = 0; step < 32; step++) {
                const angle = step * Math.PI / 16;
                ctx.drawImage(tinted, maskX + Math.cos(angle) * radius, maskY + Math.sin(angle) * radius);
            }
            ctx.drawImage(tinted, maskX, maskY);
        };
        stampOutline(14, TITLE_OUTLINE);
        for (let index = 0; index < glyphs.length; index++) {
            const char = glyphs[index];
            if (!char.trim()) continue;
            const paletteIndex = colorIndex === coloredLetters - 1 && coloredLetters > 3
                ? 6 : colorIndex % TITLE_COLORS.length;
            const glyph = document.createElement("canvas");
            glyph.width = Math.ceil(widths[index] + padding * 2);
            glyph.height = mask.height;
            const glyphCtx = glyph.getContext("2d")!;
            glyphCtx.font = ctx.font;
            glyphCtx.textBaseline = "middle";
            glyphCtx.fillText(char, padding, glyph.height / 2);
            const color = row.colorful ? TITLE_COLORS[paletteIndex] : TITLE_INK;
            ctx.drawImage(tintedMask(glyph, color), positions[index] - padding, maskY);
            colorIndex++;
        }
    }
}

/** Build the card from cut-outs; the title stays editable text until rasterized here. */
export async function renderUnfurl(title: string, characters: ImageLayer[]): Promise<HTMLCanvasElement> {
    const featured = characters.slice(0, BACK_SLOTS.length + 1);
    const [template, loaded] = await Promise.all([
        bitmap("/unfurl/theater-template-v2.png"),
        Promise.all(featured.map(character => bitmap(character.src).catch(error => {
            console.warn("[unfurl] Could not draw a character.", error);
            return null;
        }))),
        loadFont(),
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = UNFURL_WIDTH;
    canvas.height = UNFURL_HEIGHT;
    const ctx = canvas.getContext("2d")!;
    for (let index = 0; index < Math.min(featured.length, BACK_SLOTS.length); index++) {
        const image = loaded[index];
        if (!image) continue;
        drawCharacter(ctx, image, featured[index], BACK_SLOTS[index]);
        image.close();
    }
    ctx.drawImage(template, 0, 0, canvas.width, canvas.height);
    template.close();
    const bookCharacter = featured[BACK_SLOTS.length];
    const bookImage = loaded[BACK_SLOTS.length];
    if (bookCharacter && bookImage) {
        drawCharacter(ctx, bookImage, bookCharacter, BOOK_SLOT);
        bookImage.close();
    }
    drawTitle(ctx, title);
    return canvas;
}

export async function unfurlWebp(title: string, characters: ImageLayer[]): Promise<Blob> {
    const canvas = await renderUnfurl(title, characters);
    for (const quality of [0.88, 0.76, 0.64, 0.52]) {
        const result = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not encode the share image.")), "image/webp", quality));
        if (result.size <= 1_048_576) return result;
    }
    throw new Error("Share image exceeds the 1 MB upload limit.");
}
