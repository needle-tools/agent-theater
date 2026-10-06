import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_PLAY_CHANGED, CURRENT_PLAY_KEY, forgetCurrentPlay, preparePlayAssets, savePlayOnline } from "../src/lib/collage/publishing.js";
import { imageAssetsFor, MissingImageAssetError, type StoredDoc } from "../src/lib/collage/persistence.js";
import { Collage } from "../src/lib/collage/model.js";
import { resetTelemetry } from "../src/lib/telemetry.js";

describe("published play identity", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("forgets the play being edited when a canvas is cleared", () => {
        const removeItem = vi.fn();
        const dispatchEvent = vi.fn();
        vi.stubGlobal("localStorage", { removeItem });
        vi.stubGlobal("window", { dispatchEvent });
        vi.stubGlobal("CustomEvent", class {
            constructor(public type: string, public init: { detail: unknown }) {}
        });

        forgetCurrentPlay();

        expect(removeItem).toHaveBeenCalledWith(CURRENT_PLAY_KEY);
        expect(dispatchEvent).toHaveBeenCalledOnce();
        expect(dispatchEvent.mock.calls[0][0]).toMatchObject({
            type: CURRENT_PLAY_CHANGED,
            init: { detail: null },
        });
    });
});

describe("shareable local images", () => {
    const image = (src: string, storageKey: string | null) => {
        const collage = new Collage();
        return collage.addImage({ src, storageKey, natural: { width: 100, height: 100 } });
    };

    it("recovers a visible browser blob when its older IndexedDB entry is missing", async () => {
        const blob = new Blob(["image"], { type: "image/png" });
        const readStored = vi.fn(async () => null);
        const fetchSource = vi.fn(async () => blob);
        const assets = await imageAssetsFor([image("blob:https://theater.test/cube", "cube")], fetchSource, readStored);
        expect(assets).toEqual([{ key: "cube", blob }]);
        expect(fetchSource).toHaveBeenCalledWith("blob:https://theater.test/cube");
    });

    it("reports a missing image before sending an incomplete asset map", async () => {
        await expect(imageAssetsFor(
            [image("blob:https://theater.test/lost", "lost")],
            async () => null, async () => null,
        )).rejects.toBeInstanceOf(MissingImageAssetError);
    });

    it("packages old browser-only layers for upload without changing the canvas", async () => {
        const source = "blob:https://theater.test/cube";
        const layer = image(source, null);
        const doc: StoredDoc = { version: 1, savedAt: 0, layers: [layer, { ...layer, id: "copy" }], frames: [] };
        const blob = new Blob(["image"], { type: "image/png" });
        const fetchSource = vi.fn(async () => blob);
        const prepared = await preparePlayAssets(doc, [], fetchSource);
        expect(prepared.local).toHaveLength(1);
        expect(prepared.doc.layers).toMatchObject([
            { src: "", storageKey: prepared.local[0].key },
            { src: "", storageKey: prepared.local[0].key },
        ]);
        expect(doc.layers[0]).toMatchObject({ src: source, storageKey: null });
        expect(fetchSource).toHaveBeenCalledTimes(1);
    });

});

describe("save failure telemetry", () => {
    afterEach(() => { vi.unstubAllGlobals(); resetTelemetry(); });

    function spy() {
        resetTelemetry();
        const events: Array<{ name: string; props: Record<string, string | number> }> = [];
        vi.stubGlobal("window", {});
        vi.stubGlobal("document", {});
        vi.stubGlobal("location", { hostname: "theater.needle.tools", search: "" });
        vi.stubGlobal("localStorage", { getItem: () => null });
        vi.stubGlobal("rybbit", { event: (name: string, props: Record<string, string | number>) => events.push({ name, props }) });
        return events;
    }

    const doc: StoredDoc = { version: 1, savedAt: 0, layers: [], frames: [] };
    const studio = (storedAssets: () => Promise<Array<{ key: string; blob: Blob }>>) => ({
        storedDoc: () => doc,
        storedAssets,
        collage: { billing: {}, listStages: () => [], listAll: () => [] },
    }) as never;

    it("reports missing local bytes to Rybbit without image names or URLs", async () => {
        const events = spy();
        await expect(savePlayOnline(studio(async () => { throw new MissingImageAssetError(); })))
            .rejects.toBeInstanceOf(MissingImageAssetError);
        expect(events).toEqual([{ name: "play_save_failed", props: {
            by: "human", published: "true", phase: "collect_assets", reason: "missing_local_image",
        } }]);
    });

    it("reports a rejected play request with its status and phase", async () => {
        const events = spy();
        vi.stubGlobal("fetch", vi.fn(async () => new Response(
            JSON.stringify({ error: "Invalid or incomplete asset map." }),
            { status: 400, headers: { "content-type": "application/json" } },
        )));
        await expect(savePlayOnline(studio(async () => []), {}, "agent"))
            .rejects.toThrow("Invalid or incomplete asset map.");
        expect(events).toEqual([{ name: "play_save_failed", props: {
            by: "agent", published: "true", phase: "save_play", reason: "asset_map_rejected", status: 400,
        } }]);
    });

    it("always publishes a shareable play as public", async () => {
        spy();
        const request = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({
            id: "published-play", title: "A play", visibility: "public", url: "/p/published-play",
        }), { status: 201, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", request);
        vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
        await savePlayOnline(studio(async () => []));
        expect(request).toHaveBeenCalledOnce();
        expect(JSON.parse(String(request.mock.calls[0][1].body))).toMatchObject({ visibility: "public" });
    });
});
