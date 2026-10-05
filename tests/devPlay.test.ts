import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { devPlayDoc, devPlays } from "../src/lib/server/devPlay";

describe("local story fixture", () => {
    it("offers three playable stories with existing troupe art", () => {
        const plays = devPlays("http://localhost:5173");
        expect(plays).toHaveLength(3);
        for (const play of plays) {
            const doc = devPlayDoc(play.id)!;
            expect(doc.version).toBe(1);
            expect(play.chapters).toBe(1);
            expect(doc.stages?.[0].script.length).toBeGreaterThan(0);
            for (const layer of doc.layers) {
                if (layer.kind === "image") {
                    expect(layer.src).toMatch(/^\/troupe\//);
                    expect(existsSync(join(process.cwd(), "static", layer.src.slice(1)))).toBe(true);
                }
            }
        }
    });
});
