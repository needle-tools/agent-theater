import { describe, expect, it } from "vitest";
import { DEV_PLAY_DOC, devPlay } from "../src/lib/server/devPlay";

describe("local story fixture", () => {
    it("is a playable public story whose art exists in the troupe", () => {
        expect(DEV_PLAY_DOC.version).toBe(1);
        expect(devPlay("http://localhost:5173").chapters).toBe(1);
        expect(DEV_PLAY_DOC.stages?.[0].script.length).toBeGreaterThan(0);
        for (const layer of DEV_PLAY_DOC.layers) {
            if (layer.kind === "image") expect(layer.src).toMatch(/^\/troupe\//);
        }
    });
});
