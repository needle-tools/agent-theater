import { createHash, randomBytes } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "$env/dynamic/private";
import { sheetExpired, sheetKey, type SheetType } from "./sheets";
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

export async function putSheet(bytes: Uint8Array, type: SheetType): Promise<string> {
    const id = `${randomBytes(16).toString("hex")}.${type}`;
    await storage().send(new PutObjectCommand({
        Bucket: env.B2_BUCKET, Key: sheetKey(id)!, Body: bytes,
        ContentType: `image/${type}`, CacheControl: "private, no-store",
    }));
    return id;
}

export async function getSheet(id: string): Promise<Uint8Array | null> {
    const Key = sheetKey(id);
    if (!Key) return null;
    try {
        const metadata = await storage().send(new HeadObjectCommand({ Bucket: env.B2_BUCKET, Key }));
        if (!metadata.LastModified || sheetExpired(metadata.LastModified)) {
            await storage().send(new DeleteObjectCommand({ Bucket: env.B2_BUCKET, Key }));
            return null;
        }
        const result = await storage().send(new GetObjectCommand({ Bucket: env.B2_BUCKET, Key }));
        return result.Body ? await result.Body.transformToByteArray() : null;
    } catch (error) {
        if (error && typeof error === "object" && "name" in error && ["NoSuchKey", "NotFound"].includes(String(error.name))) return null;
        throw error;
    }
}

/** Remove uploads that have aged out, including sheets nobody requested again. */
export async function cleanExpiredSheets(): Promise<void> {
    let token: string | undefined;
    do {
        const page = await storage().send(new ListObjectsV2Command({
            Bucket: env.B2_BUCKET, Prefix: "plays/sheets/", ContinuationToken: token,
        }));
        for (const object of page.Contents ?? []) {
            if (object.Key && object.LastModified && sheetExpired(object.LastModified)) {
                await storage().send(new DeleteObjectCommand({ Bucket: env.B2_BUCKET, Key: object.Key }));
            }
        }
        token = page.NextContinuationToken;
    } while (token);
}
