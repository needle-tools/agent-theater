import type { ImageLayer } from "../collage/model.js";
import type { StoredDoc } from "../collage/persistence.js";
import { summarize } from "../collage/playSummary.js";

export const DEV_PLAY_ID = "dev-forest-story";

function piece(id: string, label: string, src: string, x: number, y: number, width: number, z: number): ImageLayer {
    return {
        id, kind: "image", label, src, storageKey: null,
        natural: { width: 256, height: 256 },
        crop: { x: 0, y: 0, width: 1, height: 1 },
        x, y, width, height: width, rotation: 0, z,
        style: { silhouette: null, outline: null, shadow: null, opacity: 1 },
    };
}

export const DEV_PLAY_DOC: StoredDoc = {
    version: 1,
    savedAt: 0,
    billing: { title: "The Forest Hello", byline: "A tiny story for trying the theater." },
    layers: [
        piece("tree", "Oak tree", "/troupe/forest/tree-oak.webp", -250, -180, 300, 1),
        piece("owl", "Owl", "/troupe/animals/owl.webp", -70, 60, 160, 2),
        piece("rabbit", "Rabbit", "/troupe/animals/rabbit.webp", 170, 70, 150, 3),
    ],
    frames: [],
    stages: [{
        id: "hello", name: "A Forest Hello", backdrop: null,
        cast: [
            { id: "tree", as: "the oak" },
            { id: "owl", as: "Owl" },
            { id: "rabbit", as: "Rabbit" },
        ],
        script: [
            { id: "owl", do: "wave", say: "Hello, little rabbit!" },
            { id: "rabbit", do: "wave", say: "Hello, Owl! What a lovely day." },
        ],
        hold: 1,
    }],
};

export function devPlay(origin: string) {
    return {
        id: DEV_PLAY_ID, title: "The Forest Hello", visibility: "public" as const,
        ...summarize(DEV_PLAY_DOC), url: `${origin}/p/${DEV_PLAY_ID}`,
        created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
    };
}
