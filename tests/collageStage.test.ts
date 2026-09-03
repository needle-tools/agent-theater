import { describe, it, expect } from "vitest";
import { Collage, type ImageLayer } from "../src/lib/collage/model.js";
import { castOf, placed, renamedIn, type EntranceName, type Stage } from "../src/lib/collage/stage.js";
import { buildUp, entering, filmed, handOff, sceneBeats } from "../src/lib/collage/show.js";
import { plan as planBeats, type Beat } from "../src/lib/collage/perform.js";
import { SOUNDS, findSound, soundCatalogue, soundNames } from "../src/lib/collage/audio.js";
import { creditLines, creditsFor, performers } from "../src/lib/collage/billboard.js";

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

    it("keeps the whole canvas visible while a scene is up", () => {
        // Scenes live at their own sections of one canvas: showing one places
        // its cast and points the camera, it does not make the world vanish.
        const { collage, layers } = canvasWith(4);
        const stage = collage.addStage({ cast: [{ id: layers[0].id, x: 0, y: 0 }, { id: layers[2].id, x: 50, y: 0 }] });

        expect(collage.list()).toHaveLength(4);
        collage.setActiveStage(stage.id);
        expect(collage.list()).toHaveLength(4);
        // The cast stands where the scene says...
        expect(collage.list().find(l => l.id === layers[2].id)!.x).toBe(50);
        // ...and the bystanders where they always were.
        expect(collage.list().find(l => l.id === layers[1].id)!.x)
            .toBe(collage.own(layers[1].id)!.x);
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

    it("arrives, acts, and does NOT file out at the end", () => {
        // Exits between scenes are gone: every character animating out one
        // after another took longer than the scene and looked like a fire
        // drill. The show fades between scenes instead, so a scene ends on
        // its last real beat and the cast is simply there in the next one —
        // or still standing for the bows.
        const stage = scene([{ id: "a", entrance: "fade" }], [{ id: "a", say: "hello" }]);
        const { beats } = sceneBeats(stage, sizeOf);
        expect(beats.filter(b => !b.camera).map(b => b.do ?? "say"))
            .toEqual(["enter", "say"]);
    });

    it("is just the script, plus a camera, when nobody has an entrance", () => {
        const stage = scene([{ id: "a" }], [{ id: "a", do: "jump" }]);
        const { beats } = sceneBeats(stage, sizeOf);
        expect(beats.filter(b => !b.camera)).toEqual([{ id: "a", do: "jump" }]);
    });

    describe("the camera a scene gets whether or not it asked", () => {
        /**
         * Camera beats existed, stage_script asked for two, and it complained
         * afterwards when a scene had none — and it kept not happening. Advice
         * in a tool description is read once, in a list of twenty, at the
         * moment the agent is deciding something else. So the default moves.
         *
         * The cost is real and is the right way round: a scene that wants one
         * held wide shot now has to say so, and a held shot is a decision where
         * a scene that never moves because nobody thought about it is not.
         */
        it("establishes, then finds whoever speaks first", () => {
            const filmedBeats = filmed([
                { id: "a", do: "walk" },
                { id: "b", say: "Who is there?" },
            ]);
            expect(filmedBeats[0].camera?.on).toBe("all");
            const pushIn = filmedBeats.findIndex(beat => Array.isArray(beat.camera?.on));
            expect(filmedBeats[pushIn].camera?.on).toEqual(["b"]);
            // Immediately before the line it is pushing in on.
            expect(filmedBeats[pushIn + 1].say).toBe("Who is there?");
        });

        it("leaves a scene alone once it has a camera of its own", () => {
            const own = [{ camera: { on: "all" as const } }, { id: "a", say: "Hello" }];
            expect(filmed(own)).toBe(own);
        });

        it("still establishes a scene with no lines in it", () => {
            const filmedBeats = filmed([{ id: "a", do: "nod" }]);
            expect(filmedBeats).toHaveLength(2);
            expect(filmedBeats[0].camera?.on).toBe("all");
        });
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
        // One bed is enough for the split to be real — the count is whatever the
        // manifest currently ships, and asserting a headcount only fails while
        // the library is being replaced.
        expect(soundNames("bed").length).toBeGreaterThan(0);
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

describe("a scene that travels", () => {
    it("follows its cast to their new ids", () => {
        // Opening a file re-mints every layer id, so a scene carried across
        // without rewriting would cast people who do not exist.
        const stage: Stage = {
            id: "s1", name: "the wood", backdrop: "old-trees",
            cast: [{ id: "old-mother", x: 10, y: 20 }, { id: "old-child", x: 90, y: 20 }],
            script: [
                { id: "old-mother", say: "Wait here." },
                { camera: { on: ["old-child"] } },
            ],
        };
        const moved = renamedIn(stage, new Map([
            ["old-mother", "new-mother"], ["old-child", "new-child"], ["old-trees", "new-trees"],
        ]));

        expect(moved.backdrop).toBe("new-trees");
        expect(moved.cast.map(m => m.id)).toEqual(["new-mother", "new-child"]);
        expect(moved.script[0].id).toBe("new-mother");
        expect(moved.script[1].camera?.on).toEqual(["new-child"]);
        // Everything else about the placement survives the move.
        expect(moved.cast[1].x).toBe(90);
    });

    it("drops anybody whose picture did not arrive, and the beats about them", () => {
        // A beat about a layer that is not there cannot happen, and leaving it
        // in would make the scene silently longer than it looks.
        const stage: Stage = {
            id: "s1", name: "half a scene", backdrop: null,
            cast: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 0 }],
            script: [{ id: "a", do: "walk" }, { id: "b", do: "jump" }],
        };
        const moved = renamedIn(stage, new Map([["a", "a2"]]));
        expect(moved.cast.map(m => m.id)).toEqual(["a2"]);
        expect(moved.script).toHaveLength(1);
        expect(moved.script[0].id).toBe("a2");
    });

    it("keeps a camera beat even when it is about the whole scene", () => {
        const stage: Stage = {
            id: "s1", name: "wide", backdrop: null,
            cast: [{ id: "a", x: 0, y: 0 }],
            script: [{ camera: { on: "all" }, duration: 2000 }],
        };
        const moved = renamedIn(stage, new Map([["a", "a2"]]));
        expect(moved.script).toHaveLength(1);
        expect(moved.script[0].camera?.on).toBe("all");
    });
});

describe("the credits", () => {
    const stage = (id: string, cast: { id: string; as?: string }[]): Stage => ({
        id, name: id, backdrop: null,
        cast: cast.map(member => ({ ...member, x: 0, y: 0 })),
        script: [],
    });

    it("names who played whom, in the order they first appeared", () => {
        const credits = creditsFor(
            [stage("s1", [{ id: "a", as: "the grandmother" }, { id: "b", as: "the wolf" }]),
             stage("s2", [{ id: "b" }, { id: "c", as: "the woodsman" }])],
            id => ({ a: "gran.png", b: "wolf.png", c: "axe.png" })[id] ?? null);

        expect(creditLines(credits)).toEqual([
            "the grandmother — played by gran.png",
            "the wolf — played by wolf.png",
            "the woodsman — played by axe.png",
        ]);
    });

    it("credits somebody once, keeping the first role they were given", () => {
        const credits = creditsFor(
            [stage("s1", [{ id: "a", as: "the grandmother" }]), stage("s2", [{ id: "a", as: "a tree" }])],
            () => "gran.png");
        expect(credits).toEqual([{ role: "the grandmother", actor: "gran.png" }]);
    });

    it("falls back to the picture's name when somebody acted but was never named", () => {
        const acted: Stage = {
            ...stage("s1", [{ id: "a" }]),
            script: [{ id: "a", say: "Hello" }],
        };
        expect(creditLines(creditsFor([acted], () => "IMG_4021.jpg"))).toEqual(["IMG_4021.jpg"]);
    });

    it("leaves out a cast member whose picture has been deleted", () => {
        // Not somebody to thank: there is nothing left of them to bow.
        const credits = creditsFor(
            [stage("s1", [{ id: "a", as: "gran" }, { id: "gone", as: "the wolf" }])],
            id => (id === "a" ? "gran.png" : null));
        expect(credits).toHaveLength(1);
    });

    it("credits the cast and not the scenery", () => {
        // The set goes in through stage_cast exactly as the cast does — the
        // house and the bush have a position and a plane like anybody else — so
        // without a rule for this the curtain call had the house take a bow.
        const scene: Stage = {
            id: "s1", name: "outside the cottage", backdrop: "sky",
            cast: [
                { id: "sky", x: 0, y: 0 },
                { id: "gran", x: 0, y: 0, as: "the grandmother" },
                { id: "her", x: 0, y: 0 },
                { id: "house", x: 0, y: 0, plane: "back" },
                { id: "bush", x: 0, y: 0, plane: "front" },
            ],
            script: [{ id: "her", say: "Grandmother?" }],
        };
        const who = creditsFor([scene], id => `${id}.png`).map(credit => credit.actor);
        // She has a role; she spoke. Neither is true of the house or the bush.
        expect(who).toEqual(["gran.png", "her.png"]);
        expect(performers([scene]).has("house")).toBe(false);
        expect(performers([scene]).has("sky")).toBe(false);
    });
});

describe("who is on stage when the scene starts", () => {
    it("keeps everybody with an entrance off until their own beat", () => {
        // The bug this exists to catch: beats run one after another, so the
        // third character to arrive stood in plain view through the first two
        // entrances and then faded in from nothing. The audience saw the whole
        // cast, then watched them appear one at a time.
        const stage: Stage = {
            id: "s1", name: "the wood", backdrop: "trees",
            cast: [
                { id: "trees", x: 0, y: 0 },
                { id: "her", x: 10, y: 0, entrance: "fade" },
                { id: "wolf", x: 90, y: 0, entrance: "left" },
                { id: "rock", x: 40, y: 0, entrance: "none" },
                { id: "bush", x: 60, y: 0 },
            ],
            script: [],
        };
        const hidden = entering(stage);
        expect(hidden).toContain("her");
        expect(hidden).toContain("wolf");
        // Already there: no entrance, or told explicitly not to have one.
        expect(hidden).not.toContain("rock");
        expect(hidden).not.toContain("bush");
        // And the room does not arrive.
        expect(hidden).not.toContain("trees");
    });

    it("carries them through to the plan the player is handed", () => {
        const stage: Stage = {
            id: "s1", name: "the wood", backdrop: null,
            cast: [{ id: "her", x: 0, y: 0, entrance: "grow" }],
            script: [{ id: "her", say: "Hello" }],
        };
        expect(sceneBeats(stage, () => 100).hidden).toEqual(["her"]);
    });
});

describe("facing", () => {
    it("is part of where somebody stands, so it is per scene", () => {
        // The same wolf faces left in the forest and right outside the
        // cottage. If flip lived on the layer alone, turning him in one scene
        // would turn him in all of them.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const wolf = collage.addImage({ src: "w", natural: { width: 100, height: 200 } });
        const stage = collage.addStage({ name: "the wood", cast: [{ id: wolf.id, x: 0, y: 0, flip: true }] });
        collage.setActiveStage(stage.id);
        expect(collage.list().find(l => l.id === wolf.id)?.flip).toBe(true);
        collage.setActiveStage(null);
        expect(collage.list().find(l => l.id === wolf.id)?.flip).toBeUndefined();
    });

    it("routes a flip edit to the placement while a scene is showing", () => {
        // What the turn move commits mid-performance. If this wrote to the
        // layer instead, a turn in scene three would about-face scene one.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const wolf = collage.addImage({ src: "w", natural: { width: 100, height: 200 } });
        const stage = collage.addStage({ name: "the wood", cast: [{ id: wolf.id, x: 0, y: 0 }] });
        collage.setActiveStage(stage.id);
        collage.update(wolf.id, { flip: true });
        expect(collage.getStage(stage.id)?.cast[0].flip).toBe(true);
        collage.setActiveStage(null);
        expect(collage.get(wolf.id)?.flip).toBeUndefined();
    });
});

describe("things holding things", () => {
    it("resolves a held placement as offsets from its holder", () => {
        // While attached, x and y are OFFSETS — so a walk moves both as one
        // and nothing has to keep them in step.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const girl = collage.addImage({ src: "g", natural: { width: 100, height: 200 } });
        const basket = collage.addImage({ src: "b", natural: { width: 50, height: 50 } });
        const stage = collage.addStage({
            name: "the path",
            cast: [
                { id: girl.id, x: 300, y: 100 },
                { id: basket.id, x: 40, y: 60, on: girl.id },
            ],
        });
        collage.setActiveStage(stage.id);
        const seen = collage.list().find(layer => layer.id === basket.id)!;
        expect(seen.x).toBe(340);
        expect(seen.y).toBe(160);
    });

    it("routes a drag of a held thing back into its offset", () => {
        // The canvas edits in world coordinates — it can only see where things
        // ARE — so the door has to translate, or dragging a held basket would
        // teleport it by the holder's whole position.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const girl = collage.addImage({ src: "g", natural: { width: 100, height: 200 } });
        const basket = collage.addImage({ src: "b", natural: { width: 50, height: 50 } });
        const stage = collage.addStage({
            name: "the path",
            cast: [
                { id: girl.id, x: 300, y: 100 },
                { id: basket.id, x: 40, y: 60, on: girl.id },
            ],
        });
        collage.setActiveStage(stage.id);
        collage.update(basket.id, { x: 350, y: 170 });
        const member = collage.getStage(stage.id)!.cast[1];
        expect(member.x).toBe(50);
        expect(member.y).toBe(70);
        expect(member.on).toBe(girl.id);
    });

    it("lets a held thing keep its feet when its holder does not survive a move", () => {
        // renamedIn drops anyone whose picture did not arrive. A held thing
        // whose holder vanished must not keep offsets pretending to be
        // positions — it lands exactly where it stood.
        const stage: Stage = {
            id: "s1", name: "the path", backdrop: null,
            cast: [
                { id: "girl", x: 300, y: 100 },
                { id: "basket", x: 40, y: 60, on: "girl" },
            ],
            script: [],
        };
        const moved = renamedIn(stage, new Map([["basket", "basket2"]]));
        expect(moved.cast).toHaveLength(1);
        expect(moved.cast[0].on).toBeUndefined();
        expect(moved.cast[0].x).toBe(340);
        expect(moved.cast[0].y).toBe(160);
    });

    it("carries the attachment through a rename when both survive", () => {
        const stage: Stage = {
            id: "s1", name: "the path", backdrop: null,
            cast: [
                { id: "girl", x: 300, y: 100 },
                { id: "basket", x: 40, y: 60, on: "girl" },
            ],
            script: [],
        };
        const moved = renamedIn(stage, new Map([["girl", "g2"], ["basket", "b2"]]));
        expect(moved.cast[1].on).toBe("g2");
        expect(moved.cast[1].x).toBe(40);
    });
});
