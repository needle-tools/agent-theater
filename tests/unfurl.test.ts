import { describe, expect, it } from "vitest";
import { unfurlCharacters } from "../src/lib/collage/shareCard.js";
import type { StoredDoc } from "../src/lib/collage/persistence.js";
import type { ImageLayer } from "../src/lib/collage/model.js";

describe("share image cast", () => {
    it("puts named speaking characters ahead of set pieces", () => {
        const image = (id: string) => ({ id, kind: "image", src: `/troupe/${id}.webp` }) as ImageLayer;
        const doc = {
            version: 1, savedAt: 0, frames: [],
            layers: [image("tree"), image("hero"), image("friend")],
            stages: [{
                id: "scene", name: "A scene", backdrop: null,
                cast: [{ id: "tree" }, { id: "hero", as: "Hero" }, { id: "friend", as: "Friend" }],
                script: [{ id: "hero", say: "Hello!" }],
            }],
        } as StoredDoc;
        expect(unfurlCharacters(doc).map(layer => layer.id)).toEqual(["hero", "friend", "tree"]);
    });
});
