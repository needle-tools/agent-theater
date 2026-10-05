import { json } from "@sveltejs/kit";
import { putSheet } from "$lib/server/storage";
import { SHEET_MAX_BYTES, SHEET_TTL_MS, sheetType } from "$lib/server/sheets";

export const prerender = false;

export async function POST({ request }: { request: Request }) {
    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (contentType !== "image/png" && contentType !== "image/webp")
        return json({ error: "Upload a PNG or WebP image." }, { status: 415 });
    const declaredLength = Number(request.headers.get("content-length"));
    if (declaredLength > SHEET_MAX_BYTES)
        return json({ error: "Sheet exceeds the 5 MB limit." }, { status: 413 });

    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Image body is required." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > SHEET_MAX_BYTES) {
                await reader.cancel();
                return json({ error: "Sheet exceeds the 5 MB limit." }, { status: 413 });
            }
            chunks.push(value);
        }
    } catch {
        return json({ error: "Image upload was interrupted." }, { status: 400 });
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const type = sheetType(bytes, contentType);
    if (!type) return json({ error: "Image data does not match a valid PNG or WebP sheet." }, { status: 400 });
    try {
        const id = await putSheet(bytes, type);
        return json({ url: `/api/sheets/${id}`, bytes: size, expiresAt: new Date(Date.now() + SHEET_TTL_MS).toISOString() },
            { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("[sheets] Upload failed", error);
        return json({ error: "Sheet storage is unavailable." }, { status: 503 });
    }
}
