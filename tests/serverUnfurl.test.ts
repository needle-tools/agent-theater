import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/server/storage.js", () => ({
    assetUrl: (sha: string) => `https://assets.example/plays/assets/${sha}.webp`,
    getAsset: async () => { throw new Error("Unexpected remote asset in bundled test play."); },
    validWebp: (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF"
        && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP",
}));
import { unfurlCharacters } from "../src/lib/collage/shareCard.js";
import { DEV_PLAY_DOC } from "../src/lib/server/devPlay.js";
import { serverRenderableSource, serverUnfurlWebp } from "../src/lib/server/unfurl.js";
import { validWebp } from "../src/lib/server/storage.js";

describe("server share card", () => {
    it("uses durable cutouts and excludes expired sheet URLs", () => {
        expect(serverRenderableSource("/troupe/forest/tree-oak.webp")).toBe(true);
        expect(serverRenderableSource("/api/sheets/b4ce8a368438e914036f2863ce72ba39.webp")).toBe(false);
    });
    it("renders a stored play with the same artwork and font as the browser", async () => {
        const bytes = await serverUnfurlWebp("The Forest Hello", unfurlCharacters(DEV_PLAY_DOC));
        expect(validWebp(bytes)).toBe(true);
        expect(bytes.length).toBeLessThanOrEqual(1_048_576);
    });

    it("fills a legacy poster from durable actors after excluding an expired sheet", async () => {
        const sheet = { ...DEV_PLAY_DOC.layers[0], id: "expired-sheet",
            src: "/api/sheets/b4ce8a368438e914036f2863ce72ba39.webp" };
        const doc = { ...DEV_PLAY_DOC, layers: [sheet, ...DEV_PLAY_DOC.layers] };
        const characters = unfurlCharacters(doc).filter(layer => serverRenderableSource(layer.src));
        expect(characters).toHaveLength(3);
        expect(validWebp(await serverUnfurlWebp("The Forest Hello", characters))).toBe(true);
    });
});
