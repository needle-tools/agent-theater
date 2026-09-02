import { describe, it, expect } from "vitest";
import { Collage, type ImageLayer } from "../src/lib/collage/model.js";
import { castOf, placed, type EntranceName, type Stage } from "../src/lib/collage/stage.js";
import { buildUp, handOff, sceneBeats } from "../src/lib/collage/show.js";
import { plan as planBeats, type Beat } from "../src/lib/collage/perform.js";
import { SOUNDS, findSound, soundCatalogue, soundNames } from "../src/lib/collage/audio.js";

/**
 * Scenes.
 *
 * The idea the whole feature rests on: a stage does not own its layers, it
 * records where they stand while it plays. So the same character appears in two
 * scenes at different places without being duplicated, and restyling it changes
 * it in both.
 *
 * The consequence that needs testing hardest is that a document with a stage
 * showing *presents itself as that stage* — because everything downstream, the
 * canvas and dragging and arranging and export, relies on that being true
 * rather than on knowing stages exist.
 */

function canvasWith(count: number) {
    let n = 0;
    const collage = new Collage({ newId: prefix => `${prefix}-${++n}` });
    const layers: ImageLayer[] = [];
    for (let i = 0; i < count; i++) {
        layers.push(collage.addImage({
            src: `${i}`, label: `sprite ${i}`,
            natural: { width: 400, height: 400 }, x: i * 100, y: 0, width: 200,
        }));
    }
    return { collage, layers };
}

describe("a stage holds placements, not layers", () => {
    it("puts the same layer in two scenes at different places", () => {
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const one = collage.addStage({ name: "rooftop", cast: [{ id: hero, x: 10, y: 20 }] });
        const two = collage.addStage({ name: "alley", cast: [{ id: hero, x: 900, y: 400 }] });

        collage.setActiveStage(one.id);
        expect(collage.get(hero)).toMatchObject({ x: 10, y: 20 });
        collage.setActiveStage(two.id);
        expect(collage.get(hero)).toMatchObject({ x: 900, y: 400 });
    });

    it("shares everything that is not a position", () => {
        // Recolouring a character in one scene recolours it in the other,
        // which is the whole reason not to duplicate it.
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const one = collage.addStage({ cast: [{ id: hero, x: 0, y: 0 }] });
        const two = collage.addStage({ cast: [{ id: hero, x: 500, y: 0 }] });

        collage.setActiveStage(one.id);
        collage.update(hero, { style: { silhouette: "#222" } });

        collage.setActiveStage(two.id);
        expect((collage.get(hero) as ImageLayer).style.silhouette).toBe("#222");
        expect(collage.get(hero)!.x).toBe(500);
    });

    it("shows only the cast while a scene is up, and everything otherwise", () => {
        const { collage, layers } = canvasWith(4);
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }, { id: layers[2].id, x: 50, y: 0 }] });

        expect(collage.list()).toHaveLength(4);
        collage.setActiveStage(stage.id);
        expect(collage.list().map(l => l.id)).toEqual([layers[0].id, layers[2].id]);
        // ...but the others have not gone anywhere.
        expect(collage.listAll()).toHaveLength(4);
        collage.setActiveStage(null);
        expect(collage.list()).toHaveLength(4);
    });

    it("draws the backdrop behind everyone", () => {
        // A scene with its room painted over its people is not a scene.
        const { collage, layers } = canvasWith(3);
        const stage = collage.addStage({
            backdrop: layers[2].id,
            cast: [{ id: layers[0].id, x: 0, y: 0 }, { id: layers[1].id, x: 10, y: 0 }],
        });
        collage.setActiveStage(stage.id);
        expect(collage.list()[0].id).toBe(layers[2].id);
    });

    it("skips a cast member that has been deleted", () => {
        // A deleted layer should vanish from every scene, not leave a hole with
        // a name in it.
        const { collage, layers } = canvasWith(2);
        const stage = collage.addStage({
            cast: [{ id: layers[0].id, x: 0, y: 0 }, { id: layers[1].id, x: 100, y: 0 }],
        });
        collage.remove(layers[1].id);
        collage.setActiveStage(stage.id);
        expect(collage.list()).toHaveLength(1);
    });

    it("resizes by width, letting height follow the layer's own shape", () => {
        const layer = { width: 200, height: 100 } as ImageLayer;
        expect(placed(layer, { id: "x", x: 0, y: 0, width: 400 }, 0)).toMatchObject({ width: 400, height: 200 });
    });

    it("falls back to the order given when a placement has no z", () => {
        const layers = [
            { id: "a", width: 10, height: 10, z: 99 },
            { id: "b", width: 10, height: 10, z: 1 },
        ] as ImageLayer[];
        const stage = { id: "s", name: "s", backdrop: null, script: [], cast: [{ id: "b", x: 0, y: 0 }, { id: "a", x: 0, y: 0 }] };
        const order = castOf(stage, id => layers.find(l => l.id === id) ?? null).map(l => l.id);
        expect(order).toEqual(["b", "a"]);
    });
});

describe("editing while a scene is showing", () => {
    it("moves the character in this scene and no other", () => {
        // The trap this design invites: blocking one scene silently re-blocking
        // every other scene the same character is in.
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const one = collage.addStage({ cast: [{ id: hero, x: 0, y: 0 }] });
        const two = collage.addStage({ cast: [{ id: hero, x: 500, y: 0 }] });

        collage.setActiveStage(one.id);
        collage.update(hero, { x: 250, y: 60 });

        expect(collage.get(hero)).toMatchObject({ x: 250, y: 60 });
        collage.setActiveStage(two.id);
        expect(collage.get(hero)).toMatchObject({ x: 500, y: 0 });
        // And the layer's own position is untouched by either.
        collage.setActiveStage(null);
        expect(collage.get(hero)!.x).toBe(0);
    });

    it("sends a style change to the layer even in the same call as a move", () => {
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const stage = collage.addStage({ cast: [{ id: hero, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);

        collage.update(hero, { x: 40, label: "the hero" });

        expect(collage.get(hero)).toMatchObject({ x: 40, label: "the hero" });
        collage.setActiveStage(null);
        expect(collage.get(hero)).toMatchObject({ x: 0, label: "the hero" });
    });

    it("edits the layer itself for someone who is not in the scene", () => {
        const { collage, layers } = canvasWith(2);
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);

        collage.update(layers[1].id, { x: 777 });
        collage.setActiveStage(null);
        expect(collage.get(layers[1].id)!.x).toBe(777);
    });

    it("keeps a height-only resize, folding it into the width the stage stores", () => {
        // A placement holds one dimension, so an edit that gave only a height
        // would otherwise be dropped without a word.
        const { collage, layers } = canvasWith(1);
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);

        const before = collage.get(layers[0].id)!.height;
        collage.update(layers[0].id, { height: before * 2 });
        expect(collage.get(layers[0].id)!.height).toBeCloseTo(before * 2, 3);
    });
});

describe("scenes and history", () => {
    it("undoes a move made inside a scene", () => {
        const { collage, layers } = canvasWith(1);
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);
        collage.update(layers[0].id, { x: 400 });

        collage.undo();
        expect(collage.get(layers[0].id)!.x).toBe(0);
    });

    it("brings a deleted scene back", () => {
        const { collage, layers } = canvasWith(1);
        const stage = collage.addStage({ name: "gone", cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.removeStage(stage.id);
        expect(collage.listStages()).toHaveLength(0);

        collage.undo();
        expect(collage.listStages().map(s => s.name)).toEqual(["gone"]);
    });

    it("stops showing a scene that has been undone out of existence", () => {
        const { collage, layers } = canvasWith(2);
        collage.update(layers[0].id, { x: 5 });
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);

        collage.undo();
        expect(collage.activeStageId).toBeNull();
        expect(collage.list()).toHaveLength(2);
    });

    it("survives a save and restore", () => {
        const { collage, layers } = canvasWith(2);
        const stage = collage.addStage({
            name: "rooftop",
            backdrop: layers[1].id,
            cast: [{ id: layers[0].id, x: 33, y: 44, entrance: "left" }],
        });

        const reopened = new Collage({ newId: p => `${p}-x` });
        reopened.restore(collage.listAll(), collage.listFrames(), collage.listStages());

        const back = reopened.getStage(stage.id)!;
        expect(back.name).toBe("rooftop");
        expect(back.backdrop).toBe(layers[1].id);
        expect(back.cast[0]).toMatchObject({ x: 33, y: 44, entrance: "left" });
    });
});

describe("putting the show on", () => {
    /**
     * A scene is not just its script. It arrives, plays, and leaves — and the
     * arriving and leaving are generated, because an agent asked to write them
     * for every scene would write six near-identical scripts and the seventh
     * would differ for no reason anybody could name.
     */
    const sizeOf = () => 200;

    function scene(cast: Array<{ id: string; entrance?: EntranceName }>, script: Beat[] = []): Stage {
        return {
            id: "s", name: "scene", backdrop: null, script,
            cast: cast.map(m => ({ id: m.id, x: 0, y: 0, ...(m.entrance ? { entrance: m.entrance } : {}) })),
        };
    }

    it("brings on only those with an entrance", () => {
        // Somebody already standing there was not brought on, so making them
        // arrive would turn every scene into a parade.
        const built = buildUp(scene([{ id: "a", entrance: "fade" }, { id: "b" }]), sizeOf);
        expect(built.beats.map(b => b.id)).toEqual(["a"]);
    });

    it("starts a sliding arrival off stage and walks it back", () => {
        // A walk goes from where you are, so the arriver has to be put outside
        // first — and the walk then commits to exactly where the stage says.
        const built = buildUp(scene([{ id: "a", entrance: "left" }]), sizeOf);
        expect(built.approach).toHaveLength(1);
        expect(built.approach[0].dx).toBeLessThan(0);
        expect(built.beats[0]).toMatchObject({ id: "a", do: "walk" });
        expect(built.beats[0].to!.x).toBe(-built.approach[0].dx);
    });

    it("comes in from the right on the other side", () => {
        const built = buildUp(scene([{ id: "a", entrance: "right" }]), sizeOf);
        expect(built.approach[0].dx).toBeGreaterThan(0);
    });

    it("drops in from above", () => {
        const built = buildUp(scene([{ id: "a", entrance: "above" }]), sizeOf);
        expect(built.approach[0].dy).toBeLessThan(0);
        expect(built.beats[0]).toMatchObject({ do: "jump" });
    });

    it("scales the approach to the arriver, not to a fixed distance", () => {
        const small = buildUp(scene([{ id: "a", entrance: "left" }]), () => 50);
        const large = buildUp(scene([{ id: "a", entrance: "left" }]), () => 500);
        expect(Math.abs(large.approach[0].dx)).toBeGreaterThan(Math.abs(small.approach[0].dx) * 5);
    });

    it("takes away only those it brought on", () => {
        const stage = scene([{ id: "a", entrance: "fade" }, { id: "b" }, { id: "c", entrance: "left" }]);
        expect(handOff(stage).map(b => b.id)).toEqual(["a", "c"]);
        expect(handOff(stage).every(b => b.do === "exit")).toBe(true);
    });

    it("puts the script between the arriving and the leaving", () => {
        const stage = scene([{ id: "a", entrance: "fade" }], [{ id: "a", say: "hello" }]);
        const { beats } = sceneBeats(stage, sizeOf);
        expect(beats.map(b => b.do ?? "say")).toEqual(["enter", "say", "exit"]);
    });

    it("is just the script when nobody has an entrance", () => {
        const stage = scene([{ id: "a" }], [{ id: "a", do: "jump" }]);
        expect(sceneBeats(stage, sizeOf).beats).toEqual([{ id: "a", do: "jump" }]);
    });
});

describe("sound", () => {
    /**
     * Levels are set when the audio is generated so the beds and the stings sit
     * together correctly. Nothing here re-balances them; volume is used for
     * fading only, which is a change over time rather than a change of level.
     */
    it("names every sound in the manifest exactly once", () => {
        const ids = SOUNDS.map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(SOUNDS.length).toBeGreaterThan(10);
    });

    it("splits beds from stings, because they are used differently", () => {
        // A bed loops under a whole scene; a sting fires on a beat and finishes.
        expect(soundNames("bed").length).toBeGreaterThan(3);
        expect(soundNames("cue", "sfx").length).toBeGreaterThan(3);
        for (const id of soundNames("bed")) expect(findSound(id)!.seconds).toBeGreaterThan(30);
        for (const id of soundNames("cue", "sfx")) expect(findSound(id)!.seconds).toBeLessThan(30);
    });

    it("says what each one sounds like, so a choice is not a guess", () => {
        // Eight beds with only ids to tell them apart makes the choice arbitrary.
        for (const line of soundCatalogue("bed")) {
            expect(line).toMatch(/ — .+/);
        }
    });

    it("points every sound at a file under the served audio directory", () => {
        for (const sound of SOUNDS) {
            expect(sound.file.startsWith("/audio/")).toBe(true);
            expect(sound.file.endsWith(".opus")).toBe(true);
        }
    });

    it("does not know a sound that is not there", () => {
        expect(findSound("dramatic-chipmunk")).toBeNull();
    });

    it("lets a beat carry a sound with no move and no line", () => {
        // A sting on its own is a legitimate beat, and it takes no time: the
        // scene carries on over it, which is what a sting is.
        const { plan, problems } = planBeats([{ id: "a", sound: "laugh-cute" }]);
        expect(problems).toEqual([]);
        expect(plan.beats[0]).toMatchObject({ sound: "laugh-cute", duration: 0 });
    });

    it("rides a sound along with a move rather than delaying it", () => {
        const { plan } = planBeats([{ id: "a", do: "jump", sound: "laugh-cute" }]);
        expect(plan.beats).toHaveLength(1);
        expect(plan.beats[0].move).toBe("jump");
        expect(plan.beats[0].duration).toBeGreaterThan(100);
    });
});
