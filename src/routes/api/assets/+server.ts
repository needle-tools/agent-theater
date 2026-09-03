import { json } from "@sveltejs/kit";
import { putAsset, validWebp } from "$lib/server/storage";
import { env } from "$env/dynamic/private";

export const prerender = false;

export async function POST({ request }: { request: Request }) {
    const maximum = Math.min(1_048_576, Number(env.MAX_ASSET_BYTES) || 1_048_576);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > maximum) return json({ error: "Image exceeds the 1 MB limit." }, { status: 413 });
    if (request.headers.get("content-type")?.split(";")[0] !== "image/webp")
        return json({ error: "Only WebP images are accepted." }, { status: 415 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > maximum) return json({ error: "Image exceeds the 1 MB limit." }, { status: 413 });
    if (!validWebp(bytes)) return json({ error: "The upload is not a valid WebP container." }, { status: 400 });
    try { return json({ sha: await putAsset(bytes), bytes: bytes.length }); }
    catch (error) { console.error(error); return json({ error: "Asset storage is unavailable." }, { status: 503 }); }
}
