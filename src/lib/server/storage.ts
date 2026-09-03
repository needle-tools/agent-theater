import { createHash } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "$env/dynamic/private";
// PUBLIC_-prefixed variables live in the public env by SvelteKit's rules —
// the private module types them `never` so they cannot hide there.
import { env as publicEnv } from "$env/dynamic/public";

let client: S3Client | null = null;

function storage() {
    if (!env.B2_ENDPOINT || !env.B2_REGION || !env.B2_BUCKET || !env.B2_KEY_ID || !env.B2_APPLICATION_KEY) {
        throw new Error("Backblaze B2 is not configured.");
    }
    client ??= new S3Client({
        endpoint: env.B2_ENDPOINT,
        region: env.B2_REGION,
        credentials: { accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
    });
    return client;
}

export function assetUrl(sha: string): string {
    const base = publicEnv.PUBLIC_ASSET_BASE_URL?.replace(/\/$/, "");
    if (!base) throw new Error("PUBLIC_ASSET_BASE_URL is not configured.");
    return `${base}/plays/assets/${sha}.webp`;
}

export async function putAsset(bytes: Uint8Array): Promise<string> {
    const sha = createHash("sha256").update(bytes).digest("hex");
    const Key = `plays/assets/${sha}.webp`;
    try {
        await storage().send(new HeadObjectCommand({ Bucket: env.B2_BUCKET, Key }));
    } catch {
        await storage().send(new PutObjectCommand({
            Bucket: env.B2_BUCKET, Key, Body: bytes, ContentType: "image/webp",
            CacheControl: "public, max-age=31536000, immutable",
        }));
    }
    return sha;
}

export function validWebp(bytes: Uint8Array): boolean {
    if (bytes.length < 16) return false;
    const word = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
    const declared = bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24;
    return word(0, 4) === "RIFF" && declared + 8 === bytes.length && word(8, 4) === "WEBP"
        && ["VP8 ", "VP8L", "VP8X"].includes(word(12, 4));
}
