import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_PLAY_CHANGED, CURRENT_PLAY_KEY, forgetCurrentPlay } from "../src/lib/collage/publishing.js";

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
