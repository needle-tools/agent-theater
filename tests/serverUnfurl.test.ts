import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/server/storage.js", () => ({
    assetUrl: (sha: string) => `https://assets.example/plays/assets/${sha}.webp`,
    getAsset: async () => { throw new Error("Unexpected remote asset in bundled test play."); },
    validWebp: (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF"
        && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP",
}));
import { unfurlCharacters } from "../src/lib/collage/shareCard.js";
import { DEV_PLAY_DOC } from "../src/lib/server/devPlay.js";
import { serverUnfurlWebp } from "../src/lib/server/unfurl.js";
import { validWebp } from "../src/lib/server/storage.js";

describe("server share card", () => {
    it("renders a stored play with the same artwork and font as the browser", async () => {
        const bytes = await serverUnfurlWebp("The Forest Hello", unfurlCharacters(DEV_PLAY_DOC));
        expect(validWebp(bytes)).toBe(true);
        expect(bytes.length).toBeLessThanOrEqual(1_048_576);
    });
});
