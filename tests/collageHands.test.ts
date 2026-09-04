import { describe, it, expect } from "vitest";
import { strandedByHand } from "../src/lib/collage/show.js";
import type { Stage } from "../src/lib/collage/stage.js";

/**
 * Whose hold survives the curtain.
 *
 * A person's drag can attach pieces by accident, and an accidental rider on
 * anything the script moves wrecks the blocking. The rule: a hand-made hold
 * touching the cast on either side is set down at curtain-up; a scripted
 * `take` always rides; two bystanders glued together are somebody's
 * arrangement and none of the show's business.
 */

const stage = (cast: string[]): Stage =>
    ({ id: "s", name: "s", backdrop: null, script: [], cast: cast.map(id => ({ id })) });

const held = (id: string, by: string, byHand?: boolean) =>
    ({ id, held: { by, ...(byHand ? { byHand } : {}) } });

describe("hands off the cast", () => {
    it("sets down a hand-held rider whose holder is in the cast", () => {
        // The office: a chair dragged onto the desk, the desk cast and moved
        // by beats — the chair must not swing across the stage with it.
        expect(strandedByHand([held("chair", "desk", true)], [stage(["desk"])]))
            .toEqual(["chair"]);
    });

    it("sets down a cast member welded to furniture by hand", () => {
        expect(strandedByHand([held("gardener", "desk", true)], [stage(["gardener"])]))
            .toEqual(["gardener"]);
    });

    it("lets a scripted take ride, cast or not", () => {
        // No byHand: the script did this on purpose, and the basket belongs
        // in the hand for as long as the script says.
        expect(strandedByHand([held("basket", "red")], [stage(["red", "basket"])]))
            .toEqual([]);
    });

    it("leaves two bystanders glued together alone", () => {
        expect(strandedByHand([held("moss", "rock", true)], [stage(["hero"])]))
            .toEqual([]);
    });

    it("checks every playing chapter, not just the first", () => {
        expect(strandedByHand(
            [held("chair", "desk", true)],
            [stage(["hero"]), stage(["desk"])],
        )).toEqual(["chair"]);
    });
});
