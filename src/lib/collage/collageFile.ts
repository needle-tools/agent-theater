/**
 * A collage you can look at, and open again.
 *
 * The save file *is* the picture. It opens in any image viewer, previews in a
 * file manager, attaches to an email — and dropped back on the canvas it comes
 * apart into the layers it was made of, each with its own bytes, still
 * separately movable.
 *
 * PNG, because the format was designed for exactly this. A decoder that meets
 * a chunk it does not recognise is required to skip it, so an ancillary chunk
 * is a supported place to keep something rather than a trick played on the
 * parser. The type code is `coLg`, and every letter is load-bearing: lower-case
 * first means ancillary (skippable), lower-case second means private (not a
 * registered type), upper-case third is reserved and must be so, lower-case
 * fourth means safe to copy through an editor that does not understand it.
 *
 * What this is not: an archival format. Anything that *re-encodes* the image —
 * a social upload, an image CDN, a well-meaning optimiser — writes a new PNG
 * and the chunk is gone, leaving a perfectly good flat picture and nothing to
 * open. Saving to disk, copying, emailing and syncing all keep it.
 *
 * Everything here is bytes in, bytes out, with no browser in it, so the format
 * can be tested rather than trusted.
 */
import type { StoredDoc } from "./persistence.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHUNK_TYPE = "coLg";
/** Inside the chunk, so a truncated or foreign chunk is rejected on sight. */
const MAGIC = "NDLCLG01";

/**
 * Backed by a plain ArrayBuffer rather than any ArrayBufferLike, so the bytes
 * can go straight into a Blob — a SharedArrayBuffer-backed view cannot.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export interface CollageAsset {
    /** The storageKey the layers refer to. */
    key: string;
    /** MIME type, so the bytes can be given back to the browser as a Blob. */
    type: string;
    data: Bytes;
}

export interface CollagePayload {
    doc: StoredDoc;
    assets: CollageAsset[];
}

// ── CRC ─────────────────────────────────────────────────────────────────────

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
    if (table) return table;
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
}

/** The CRC-32 every PNG chunk carries. Unsigned; JS bit ops are not. */
export function crc32(bytes: Uint8Array): number {
    const t = crcTable();
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// ── Chunks ──────────────────────────────────────────────────────────────────

interface Chunk {
    type: string;
    /** Offset of the length field — the first byte of the whole chunk. */
    start: number;
    /** Offset of the chunk's data. */
    dataStart: number;
    length: number;
    /** Offset just past the CRC — the first byte of the next chunk. */
    end: number;
}

export function isPng(bytes: Uint8Array): boolean {
    return bytes.length > 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Walk the chunks. Stops at anything malformed rather than guessing, because a
 * file that is not the shape we think it is should read as "not one of ours".
 */
function* chunks(bytes: Uint8Array): Generator<Chunk> {
    if (!isPng(bytes)) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 8;
    while (at + 8 <= bytes.length) {
        const length = view.getUint32(at);
        const end = at + 12 + length;
        // A length that runs off the end is corruption, not a chunk.
        if (length > bytes.length || end > bytes.length) return;
        const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
        yield { type, start: at, dataStart: at + 8, length, end };
        if (type === "IEND") return;
        at = end;
    }
}

/** One chunk, ready to splice in: length, type, data, CRC. */
function buildChunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    // The CRC covers the type and the data, but not the length.
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

// ── The payload ─────────────────────────────────────────────────────────────

interface Manifest {
    version: 1;
    doc: StoredDoc;
    assets: { key: string; type: string; bytes: number }[];
}

/**
 * Manifest first, then the asset bytes end to end.
 *
 * The images are already compressed — they are PNGs and WebPs — so they go in
 * raw. Base64 inside a text chunk would have cost a third of the file for
 * nothing, and re-compressing already-compressed bytes costs time to make them
 * very slightly larger.
 */
function encodePayload(payload: CollagePayload): Uint8Array {
    const manifest: Manifest = {
        version: 1,
        doc: payload.doc,
        assets: payload.assets.map(a => ({ key: a.key, type: a.type, bytes: a.data.length })),
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const total = MAGIC.length + 4 + manifestBytes.length
        + payload.assets.reduce((sum, a) => sum + a.data.length, 0);

    const out = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i < MAGIC.length; i++) out[at++] = MAGIC.charCodeAt(i);
    new DataView(out.buffer).setUint32(at, manifestBytes.length);
    at += 4;
    out.set(manifestBytes, at);
    at += manifestBytes.length;
    for (const asset of payload.assets) {
        out.set(asset.data, at);
        at += asset.data.length;
    }
    return out;
}

function decodePayload(data: Uint8Array): CollagePayload | null {
    if (data.length < MAGIC.length + 4) return null;
    for (let i = 0; i < MAGIC.length; i++) {
        if (data[i] !== MAGIC.charCodeAt(i)) return null;
    }
    try {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const manifestLength = view.getUint32(MAGIC.length);
        let at = MAGIC.length + 4;
        if (at + manifestLength > data.length) return null;

        const manifest = JSON.parse(new TextDecoder().decode(data.subarray(at, at + manifestLength))) as Manifest;
        at += manifestLength;
        if (manifest?.version !== 1 || !manifest.doc || !Array.isArray(manifest.assets)) return null;

        const assets: CollageAsset[] = [];
        for (const entry of manifest.assets) {
            if (at + entry.bytes > data.length) return null;
            // Copied rather than shared: the caller gets bytes it can keep even
            // if the file buffer is released, and a buffer a Blob will accept.
            const copy = new Uint8Array(entry.bytes);
            copy.set(data.subarray(at, at + entry.bytes));
            assets.push({ key: entry.key, type: entry.type, data: copy });
            at += entry.bytes;
        }
        return { doc: manifest.doc, assets };
    } catch {
        // Truncated, or written by something else that picked the same type.
        return null;
    }
}

// ── The file ────────────────────────────────────────────────────────────────

/**
 * Put a collage inside a rendered PNG.
 *
 * The chunk goes immediately before IEND, which is where a decoder is
 * guaranteed to still be reading and where nothing else expects to be. Any
 * chunk we wrote earlier is dropped, so re-saving an opened file replaces its
 * document rather than stacking a second one behind it.
 */
export function packCollage(png: Uint8Array, payload: CollagePayload): Bytes {
    const iend = [...chunks(png)].find(c => c.type === "IEND");
    if (!iend) throw new Error("That is not a complete PNG — it has no IEND.");

    const ours = [...chunks(png)].filter(c => c.type === CHUNK_TYPE);
    const chunk = buildChunk(CHUNK_TYPE, encodePayload(payload));

    // Everything up to IEND, minus any previous copy of ours, then the new
    // chunk, then IEND.
    const keep: Uint8Array[] = [];
    let at = 0;
    for (const old of ours) {
        keep.push(png.subarray(at, old.start));
        at = old.end;
    }
    keep.push(png.subarray(at, iend.start), chunk, png.subarray(iend.start));

    const out = new Uint8Array(keep.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of keep) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** The collage inside a file, or null if there isn't one. Never throws. */
export function readCollage(bytes: Uint8Array): CollagePayload | null {
    for (const chunk of chunks(bytes)) {
        if (chunk.type !== CHUNK_TYPE) continue;
        const payload = decodePayload(bytes.subarray(chunk.dataStart, chunk.dataStart + chunk.length));
        if (payload) return payload;
    }
    return null;
}

/**
 * Is this worth reading properly?
 *
 * Cheap enough to run on every dropped file, so a plain photo takes the normal
 * path without the cost of parsing a document out of it.
 */
export function looksLikeCollageFile(bytes: Uint8Array): boolean {
    if (!isPng(bytes)) return false;
    for (const chunk of chunks(bytes)) {
        if (chunk.type === CHUNK_TYPE) return true;
    }
    return false;
}
