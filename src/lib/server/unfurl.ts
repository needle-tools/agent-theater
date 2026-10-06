import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createCanvas, GlobalFonts, loadImage, type Canvas } from "@napi-rs/canvas";
import type { ImageLayer } from "../collage/model.js";
import { renderUnfurlWith, type UnfurlRenderer } from "../collage/shareCard.js";
import { assetUrl, getAsset } from "./storage";

const roots = [resolve("build/client"), resolve("static")];
let fontReady = false;

function bundledFile(pathname: string): string {
    if (!/^\/(troupe|unfurl|fonts)\/[a-zA-Z0-9/_-]+\.(png|webp|ttf)$/.test(pathname)
        || pathname.includes("..")) throw new Error("Image source is not a bundled theater asset.");
    for (const root of roots) {
        const path = join(root, pathname.slice(1));
        if (existsSync(path)) return path;
    }
    throw new Error(`Bundled theater asset is missing: ${pathname}`);
}

/** Legacy plays may still mention short-lived sheet uploads. Skip those when selecting poster actors. */
export function serverRenderableSource(src: string): boolean {
    if (/^\/(troupe|unfurl)\/[a-zA-Z0-9/_-]+\.(png|webp)$/.test(src) && !src.includes("..")) return true;
    const match = /\/plays\/assets\/([a-f0-9]{64})\.webp$/.exec(src);
    if (!match) return false;
    try { return src === assetUrl(match[1]); } catch { return false; }
}

function registerFont() {
    if (fontReady) return;
    if (!GlobalFonts.registerFromPath(bundledFile("/fonts/Pantomime-Chaos.ttf"), "Pantomime Chaos"))
        throw new Error("Could not load the poster font.");
    fontReady = true;
}

async function sourceBytes(src: string): Promise<Uint8Array> {
    const match = /\/plays\/assets\/([a-f0-9]{64})\.webp$/.exec(src);
    if (match && src === assetUrl(match[1])) return getAsset(match[1]);
    if (src.startsWith("/")) return readFileSync(bundledFile(src));
    throw new Error("Image source cannot be rendered on the server.");
}

const renderer: UnfurlRenderer = {
    createCanvas: (width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement,
    loadImage: async src => loadImage(Buffer.from(await sourceBytes(src))) as unknown as { width: number; height: number },
    loadFont: async () => registerFont(),
    skipBrokenImages: false,
};

/** The exact card layout used in the browser, encoded once for immutable storage. */
export async function serverUnfurlWebp(title: string, characters: ImageLayer[]): Promise<Uint8Array> {
    const canvas = await renderUnfurlWith(title, characters, renderer);
    for (const quality of [88, 76, 64, 52]) {
        const bytes = await (canvas as unknown as Canvas).encode("webp", quality);
        if (bytes.length <= 1_048_576) return bytes;
    }
    throw new Error("Share image exceeds the 1 MB storage limit.");
}
