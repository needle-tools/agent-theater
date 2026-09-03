import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { StoredDoc } from "$lib/collage/persistence";
import { assetUrl } from "./storage";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const newId = () => randomBytes(12).toString("base64url");

export function owns(token: string, hash: string): boolean {
    const actual = Buffer.from(tokenHash(token));
    const expected = Buffer.from(hash);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateDoc(value: unknown): value is StoredDoc {
    const doc = value as StoredDoc;
    return doc?.version === 1 && Array.isArray(doc.layers) && doc.layers.length <= 300
        && Array.isArray(doc.frames) && doc.frames.length <= 1 && (!doc.stages || doc.stages.length <= 100);
}

export function validateAssets(doc: StoredDoc, value: unknown): value is Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const assets = value as Record<string, unknown>;
    if (Object.keys(assets).length > 40 || Object.values(assets).some(sha =>
        typeof sha !== "string" || !/^[a-f0-9]{64}$/.test(sha))) return false;
    return doc.layers.every(layer => layer.kind !== "image" || !layer.storageKey || typeof assets[layer.storageKey] === "string");
}

export function resolveAssets(doc: StoredDoc, assets: Record<string, string>): StoredDoc {
    return {
        ...doc,
        layers: doc.layers.map(layer => {
            if (layer.kind !== "image" || !layer.storageKey) return layer;
            const sha = assets[layer.storageKey];
            return sha ? { ...layer, src: assetUrl(sha), storageKey: null } : layer;
        }),
    };
}
