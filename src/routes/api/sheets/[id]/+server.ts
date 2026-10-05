import { json } from "@sveltejs/kit";
import { getSheet } from "$lib/server/storage";
import { sheetKey } from "$lib/server/sheets";

export const prerender = false;

export async function GET({ params }: { params: { id: string } }) {
    if (!sheetKey(params.id)) return json({ error: "Sheet not found." }, { status: 404 });
    try {
        const bytes = await getSheet(params.id);
        if (!bytes) return json({ error: "Sheet not found or expired." }, { status: 404 });
        const type = params.id.endsWith(".png") ? "image/png" : "image/webp";
        return new Response(new Uint8Array(bytes), { headers: {
            "Content-Type": type,
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        } });
    } catch (error) {
        console.error("[sheets] Read failed", error);
        return json({ error: "Sheet storage is unavailable." }, { status: 503 });
    }
}
