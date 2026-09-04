/**
 * The picture on the front of a saved play.
 *
 * A saved play is a PNG with the whole document packed into a chunk behind it,
 * and for a long time the pixels were simply the page as it stood. That is an
 * honest thumbnail and a poor poster: a stage at rest is a wide shot with
 * everybody standing at the size their scene needed, which at 1600px across
 * leaves the cast about as prominent as the furniture.
 *
 * So the front is composed rather than captured — the set as it stands, the
 * leads brought forward and enlarged the way a playbill does it, and a torn
 * paper band along the bottom carrying the name of the piece and where a
 * stranger can open it.
 *
 * None of this touches the document, and that is the whole reason it is
 * allowed to exist. The pixels are decoration; the chunk behind them is the
 * play, and `openFile` reads the chunk — so a poster that rearranges the cast
 * still reopens as the set the person actually built. Nothing here writes to a
 * layer: what it lays out are throwaway copies.
 */
import type { Frame, ImageLayer, Layer, Rect } from "./model.js";
import { renderRegion, type ImageSource } from "./render.js";

/**
 * How deep the band along the bottom is.
 *
 * A share of the height, but capped against the WIDTH as well, because
 * everything on the band is sized off its depth and a portrait page is tall
 * enough that a sixth of it is a deep strip of very large type on a narrow
 * sheet — the title would then be shouldered off it entirely by the address
 * and the stamp. Floored too, so a small poster still has a legible band.
 */
const BAND_SHARE = 0.16;
const BAND_OF_WIDTH = 0.13;
const MIN_BAND = 76;

/** The tallest lead, as a share of the picture above the band. */
const LEAD_SHARE = 0.56;
/** The ones either side, relative to the tallest. */
const FLANK_SCALE = 0.8;
/**
 * Space between neighbours, as a share of the tallest lead. Negative: they
 * overlap slightly, because a row of cut-outs with air between each one reads
 * as a file listing and a row that touches reads as a company.
 */
const CAST_GAP = -0.04;
/** How far a flank stands back up the stage, as a share of its own height. */
const FLANK_LIFT = 0.05;
/** Widest the whole row may get, as a share of the picture. */
const CAST_WIDTH = 0.9;
/**
 * How high the torn edge of the band reaches above the band itself, as a share
 * of it — and, with a little added, how much floor the cast is kept clear of
 * so nobody is standing ankle-deep in the paper.
 */
const DECKLE_RISE = 0.035;
const FLOOR = DECKLE_RISE + 0.07;
/** How far each step away from the middle leans, in degrees. */
const LEAN = 3.5;
/** How many come forward. Past three the row is a crowd and nobody is a lead. */
export const POSTER_LEADS = 3;

/** Where the site's own card lives — the same file the page unfurls with. */
export const POSTER_MARK_SRC = "/og.webp";
/** What the band says about where this opens. */
export const POSTER_URL = "Load at theater.needle.tools";

/**
 * How deep the band is on a poster of this size.
 *
 * Its own function because everything printed on the band is sized off this
 * one number, so getting it wrong on one page shape quietly loses the title on
 * that shape and nowhere else.
 */
export function bandDepth(width: number, height: number): number {
    return Math.round(Math.max(MIN_BAND, Math.min(height * BAND_SHARE, width * BAND_OF_WIDTH)));
}

/**
 * Where the leads stand on the poster, in canvas units.
 *
 * `ids` are strongest first — the order `leads()` hands back — and the row is
 * dealt outwards from the middle, so the one the play is most about is the one
 * standing centre and tallest. Everything is returned as copies: the caller
 * draws these and throws them away, and the real layers never learn that any
 * of it happened.
 *
 * Ids that name nothing, or name something that is not a picture, are skipped
 * rather than reserved a gap — a lead whose artwork has been deleted is not a
 * lead any more.
 */
export function posterCast(
    ids: readonly string[],
    layers: readonly Layer[],
    area: Rect,
): ImageLayer[] {
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    const found = ids
        .map(id => byId.get(id))
        .filter((layer): layer is ImageLayer =>
            !!layer && layer.kind === "image" && layer.width > 0 && layer.height > 0);
    if (!found.length || area.width <= 0 || area.height <= 0) return [];

    const tallest = area.height * LEAD_SHARE;
    const sized = found.map((layer, rank) => {
        const height = tallest * (rank === 0 ? 1 : FLANK_SCALE);
        return { layer, rank, height, width: height * (layer.width / layer.height) };
    });

    // Dealt outwards: the lead in the middle, the next to its left, the one
    // after that to its right. A row sorted plainly by weight puts the star at
    // one end, which is a queue rather than a poster.
    const row: typeof sized = [];
    for (const piece of sized) {
        if (piece.rank % 2 === 1) row.unshift(piece);
        else row.push(piece);
    }

    const gap = tallest * CAST_GAP;
    const spread = row.reduce((total, piece) => total + piece.width, 0) + gap * (row.length - 1);
    // Too wide for the stage: shrink the whole row rather than any one of
    // them, so the billing survives the squeeze.
    const squeeze = Math.min(1, (area.width * CAST_WIDTH) / Math.max(1, spread));

    const baseline = area.y + area.height;
    let x = area.x + (area.width - spread * squeeze) / 2;
    return row.map((piece, index) => {
        const width = piece.width * squeeze;
        const height = piece.height * squeeze;
        // Straight in the middle, leaning away from it on either side — the
        // lean a hand gives a stack of cut-outs when it fans them.
        const lean = index - (row.length - 1) / 2;
        const placed: ImageLayer = {
            ...piece.layer,
            x,
            y: baseline - height - (piece.rank === 0 ? 0 : height * FLANK_LIFT),
            width,
            height,
            rotation: lean * LEAN,
            // The middle is nearest the audience, then outwards. Well clear of
            // whatever z the set is using: these are in front of all of it.
            z: 1_000_000 - piece.rank,
            // A hand is a position relative to somebody who is not standing
            // here any more. Let go for the photograph.
            held: undefined,
        };
        x += width + gap * squeeze;
        return placed;
    });
}

/** The site's own card, decoded and ready to stamp. */
export interface PosterMark {
    image: CanvasImageSource;
    width: number;
    height: number;
}

export interface PosterOptions {
    width: number;
    height: number;
    /** The name of the piece. No title, no words on the left of the band. */
    title?: string;
    /** The line under it — "a play in two scenes". */
    byline?: string;
    /** Layer ids of the leads, most of the play first. */
    leads?: readonly string[];
    /** Stamped in the band. Null when it could not be fetched — never fatal. */
    mark?: PosterMark | null;
    /** Where a stranger opens this. */
    url?: string;
}

/**
 * Decode the site's card for the corner of the band.
 *
 * Same-origin, so it does not taint the canvas, and it resolves to null on any
 * failure at all: a saved play that refused to save because a decorative
 * thumbnail was missing would be an absurd way to lose somebody's work.
 */
export async function loadPosterMark(src = POSTER_MARK_SRC): Promise<PosterMark | null> {
    if (typeof Image === "undefined") return null;
    try {
        const image = new Image();
        image.decoding = "async";
        image.src = src;
        await image.decode();
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        return width && height ? { image, width, height } : null;
    } catch {
        return null;
    }
}

export function renderPoster(
    frame: Frame,
    layers: readonly Layer[],
    images: ImageSource,
    options: PosterOptions,
): HTMLCanvasElement {
    const width = Math.max(1, Math.round(options.width));
    const height = Math.max(1, Math.round(options.height));
    const band = bandDepth(width, height);
    // The poster and the frame are the same shape, so one number converts both
    // axes between canvas units and poster pixels.
    const scale = width / Math.max(1, frame.width);

    const front = new Set(options.leads ?? []);
    const cast = posterCast(options.leads ?? [], layers, {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        // Short of the band by the height of its torn edge and a little more:
        // the strip is laid OVER the picture, so a cast standing exactly on
        // the band's top line has its feet eaten by the tear.
        height: (height - band * (1 + FLOOR)) / scale,
    });

    // The set, minus whoever is about to step forward. Leaving them in as well
    // would print each lead twice, which reads as a mistake rather than as a
    // poster.
    const behind = cast.length ? layers.filter(layer => !front.has(layer.id)) : [...layers];
    const canvas = renderRegion(frame, behind, images, {
        width,
        height,
        background: frame.background && frame.background !== "transparent" ? frame.background : paper(),
    });
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    if (cast.length) {
        // Through the same renderer as everything else, so a lead brought
        // forward keeps its outline, its shadow and the way it is mirrored.
        ctx.drawImage(renderRegion(frame, cast, images, { width, height, background: null }), 0, 0);
    }

    drawBand(ctx, width, height, band, options);
    return canvas;
}

/**
 * The band: a torn strip of paper laid over the bottom of the picture.
 *
 * Laid over rather than butted against — a straight bar with the artwork
 * stopping dead above it looks like a screenshot with a caption bolted on,
 * whereas a strip with a deckle edge and a shadow under it is one more piece
 * of paper on a table full of them, which is what the whole theatre is.
 */
function drawBand(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    band: number,
    options: PosterOptions,
) {
    const top = height - band;
    const ink = token("--text-primary", "#1A1A1A");

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, top + deckle(0, band));
    for (let x = DECKLE_STEP; x < width; x += DECKLE_STEP) ctx.lineTo(x, top + deckle(x, band));
    ctx.lineTo(width, top + deckle(width, band));
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.shadowColor = "rgba(16, 22, 14, 0.3)";
    ctx.shadowBlur = band * 0.18;
    ctx.shadowOffsetY = -band * 0.03;
    ctx.fillStyle = paper();
    ctx.fill();
    ctx.restore();

    const pad = Math.round(band * 0.38);
    // Below the middle of the strip, not of the band: the deckle eats into the
    // top, so text centred on the band sits high.
    const middle = top + band * 0.53;
    const body = token("--font-family-body", "system-ui, sans-serif");
    // The stamp and the address may have this much of the strip and no more.
    // Whose band it is is not in question — it is the play's, and the play's
    // name is on the left.
    const spare = (width - pad * 2) * SIGNATURE_SHARE;
    let edge = width - pad;

    if (options.mark) {
        let markHeight = Math.round(band * 0.5);
        let markWidth = Math.round(markHeight * (options.mark.width / Math.max(1, options.mark.height)));
        if (markWidth > spare * 0.45) {
            markHeight = Math.round(markHeight * ((spare * 0.45) / markWidth));
            markWidth = Math.round(spare * 0.45);
        }
        stamp(ctx, options.mark, edge - markWidth, middle - markHeight / 2, markWidth, markHeight, ink);
        edge -= markWidth + Math.round(band * 0.22);
    }

    if (options.url) {
        // Shrinks to fit what is left of its share, and is dropped outright
        // rather than shrunk past reading — where to open the play is useful,
        // and it is never as useful as what the play is called.
        const room = edge - (width - pad - spare);
        const size = fitFont(ctx, options.url, room, Math.round(band * 0.19), Math.round(band * 0.12), 600, body);
        if (ctx.measureText(options.url).width <= room) {
            ctx.font = `600 ${size}px ${body}`;
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.fillStyle = fade(ink, 0.62);
            ctx.fillText(options.url, edge, middle);
            edge -= Math.ceil(ctx.measureText(options.url).width) + Math.round(band * 0.3);
        }
    }

    const title = options.title?.trim();
    const byline = options.byline?.trim();
    const room = edge - pad;
    // Not enough room left for a name after the stamp and the address; the
    // band is better with only those on it than with a two-letter title.
    if (!title || room < band * 0.8) return;

    const display = token("--font-family-display", body);
    const titleSize = fitFont(ctx, title, room, Math.round(band * 0.44), Math.round(band * 0.24), 600, display);
    const bylineSize = Math.round(band * 0.2);
    const gap = Math.round(band * 0.09);
    const block = titleSize + (byline ? gap + bylineSize : 0);

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let y = middle - block / 2;
    ctx.font = `600 ${titleSize}px ${display}`;
    ctx.fillStyle = ink;
    ctx.fillText(clipText(ctx, title, room), pad, y);

    if (byline) {
        y += titleSize + gap;
        ctx.font = `400 ${bylineSize}px ${body}`;
        ctx.fillStyle = fade(ink, 0.6);
        ctx.fillText(clipText(ctx, byline, room), pad, y);
    }
}

/** How often the torn edge is sampled, in poster pixels. */
const DECKLE_STEP = 26;
/** Most of the band the stamp and the address may take between them. */
const SIGNATURE_SHARE = 0.45;

/**
 * The wobble along the top of the band.
 *
 * Two sines rather than a random walk, because the same play saved twice has
 * to come back the same picture — a file whose bytes change when nothing did
 * is a file that looks edited to every tool that ever compares two of them.
 */
function deckle(x: number, band: number): number {
    return (Math.sin(x * 0.11) * 0.6 + Math.sin(x * 0.037 + 1.7) * 0.4) * band * DECKLE_RISE;
}

/** The site's card, as a little paper card of its own. */
function stamp(
    ctx: CanvasRenderingContext2D,
    mark: PosterMark,
    x: number,
    y: number,
    width: number,
    height: number,
    ink: string,
) {
    const radius = Math.min(width, height) * 0.14;
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, width, height, radius);
    else ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.drawImage(mark.image, x, y, width, height);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, width, height, radius);
    else ctx.rect(x, y, width, height);
    // A hairline, so the card has an edge even where its own pixels are the
    // same colour as the paper it is lying on.
    ctx.strokeStyle = fade(ink, 0.22);
    ctx.lineWidth = Math.max(1, height * 0.015);
    ctx.stroke();
    ctx.restore();
}

/** The largest size at which the text still fits, down to a floor. */
function fitFont(
    ctx: CanvasRenderingContext2D,
    text: string,
    room: number,
    start: number,
    floor: number,
    weight: number,
    family: string,
): number {
    for (let size = start; size > floor; size--) {
        ctx.font = `${weight} ${size}px ${family}`;
        if (ctx.measureText(text).width <= room) return size;
    }
    ctx.font = `${weight} ${floor}px ${family}`;
    return floor;
}

/** Cut to fit, once shrinking has run out of room. */
function clipText(ctx: CanvasRenderingContext2D, text: string, room: number): string {
    if (ctx.measureText(text).width <= room) return text;
    let cut = text;
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > room) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
}

/**
 * A brand token, read off the page.
 *
 * The poster is saved by a browser that is already showing the theatre, so its
 * paper and its ink are the ones on screen — including in the dark theme,
 * where a band painted the light colours would be the one thing in the file
 * that did not match the play it is a picture of.
 */
function token(name: string, fallback: string): string {
    if (typeof document === "undefined" || typeof getComputedStyle !== "function") return fallback;
    try {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    } catch {
        return fallback;
    }
}

function paper(): string {
    return token("--surface-page-elevated", "#EFF5EC");
}

/** Canvas has no color-mix, and the tokens are hexes. */
function fade(color: string, alpha: number): string {
    const hex = color.trim();
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!match) return color;
    const digits = match[1].length === 3 ? [...match[1]].map(d => d + d).join("") : match[1];
    const value = parseInt(digits, 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
