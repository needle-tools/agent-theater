export const SHEET_MAX_BYTES = 5 * 1024 * 1024;
export const SHEET_TTL_MS = 2 * 60 * 60 * 1000;

export type SheetType = "png" | "webp";

export function sheetType(bytes: Uint8Array, contentType: string): SheetType | null {
    if (contentType === "image/png") {
        if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
        const width = view.getUint32(16);
        const height = view.getUint32(20);
        return width > 0 && height > 0 && width <= 8192 && height <= 8192 ? "png" : null;
    }
    if (contentType === "image/webp") {
        if (bytes.length < 16) return null;
        const word = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return word(0, 4) === "RIFF" && view.getUint32(4, true) + 8 === bytes.length
            && word(8, 4) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(word(12, 4)) ? "webp" : null;
    }
    return null;
}

export function sheetExpired(lastModified: Date, now = Date.now()): boolean {
    return now - lastModified.getTime() >= SHEET_TTL_MS;
}

export function sheetKey(id: string): string | null {
    return /^[0-9a-f]{32}\.(png|webp)$/.test(id) ? `plays/sheets/${id}` : null;
}
