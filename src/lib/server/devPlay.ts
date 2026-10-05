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

const MOON_PLAY_ID = "dev-moonlit-visitor";
const MOON_PLAY_DOC: StoredDoc = {
    version: 1, savedAt: 0,
    billing: { title: "The Moonlit Visitor", byline: "A visitor brings a story from the sky." },
    layers: [
        piece("moon", "Moon", "/troupe/night/moon.webp", -180, -210, 220, 1),
        piece("bat", "Bat", "/troupe/night/bat.webp", -100, 30, 150, 2),
        piece("cat", "Black cat", "/troupe/night/cat-black.webp", 160, 80, 160, 3),
    ],
    frames: [],
    stages: [{
        id: "visitor", name: "A Visitor at Night", backdrop: null,
        cast: [{ id: "moon" }, { id: "bat", as: "Bat" }, { id: "cat", as: "Cat" }],
        script: [
            { id: "bat", do: "wave", say: "May I stay until morning?" },
            { id: "cat", do: "wave", say: "Only if you bring a story from the sky." },
        ],
        hold: 1,
    }],
};

const BUS_PLAY_ID = "dev-bus-stop-story";
const BUS_PLAY_DOC: StoredDoc = {
    version: 1, savedAt: 0,
    billing: { title: "The Next Bus", byline: "Two friends find time for one more adventure." },
    layers: [
        piece("stop", "Bus stop", "/troupe/street/bus-stop-sign.webp", -240, -120, 180, 1),
        piece("bus", "Bus", "/troupe/street/bus.webp", 220, -40, 290, 2),
        piece("rabbit", "Rabbit", "/troupe/animals/rabbit.webp", -60, 90, 145, 3),
        piece("owl", "Owl", "/troupe/animals/owl.webp", 130, 70, 155, 4),
    ],
    frames: [],
    stages: [{
        id: "bus-stop", name: "At the Bus Stop", backdrop: null,
        cast: [{ id: "stop" }, { id: "bus" }, { id: "rabbit", as: "Rabbit" }, { id: "owl", as: "Owl" }],
        script: [
            { id: "rabbit", do: "wave", say: "Did we miss the bus?" },
            { id: "owl", do: "wave", say: "Only the first one. The next is ours." },
        ],
        hold: 1,
    }],
};

export const DEV_PLAY_DOCS: Record<string, StoredDoc> = {
    [DEV_PLAY_ID]: DEV_PLAY_DOC,
    [MOON_PLAY_ID]: MOON_PLAY_DOC,
    [BUS_PLAY_ID]: BUS_PLAY_DOC,
};

export function devPlayDoc(id: string): StoredDoc | null {
    return DEV_PLAY_DOCS[id] ?? null;
}

export function devPlays(origin: string) {
    return Object.entries(DEV_PLAY_DOCS).map(([id, doc]) => ({
        id, title: doc.billing?.title ?? "Untitled story", visibility: "public" as const,
        ...summarize(doc), url: `${origin}/p/${id}`,
        created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
    }));
}
