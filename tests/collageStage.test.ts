import { describe, it, expect } from "vitest";
import { Collage, type ImageLayer } from "../src/lib/collage/model.js";
import { castOf, renamedIn, type EntranceName, type Stage } from "../src/lib/collage/stage.js";
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

describe("a chapter holds memberships, not positions", () => {
    it("never moves anybody: the world is one arrangement", () => {
        // The whole point of the chapter model. Selecting a chapter tells the
        // page who matters; it does not teleport anything anywhere.
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const home = collage.own(hero)!;
        const one = collage.addStage({ name: "rooftop", cast: [{ id: hero }] });
        const two = collage.addStage({ name: "alley", cast: [{ id: hero }] });

        collage.setActiveStage(one.id);
        expect(collage.get(hero)).toMatchObject({ x: home.x, y: home.y });
        collage.setActiveStage(two.id);
        expect(collage.get(hero)).toMatchObject({ x: home.x, y: home.y });
        void one;
        void two;
    });

    it("shares everything, position included", () => {
        // Recolouring a character in one chapter recolours it in the other,
        // and moving it moves it everywhere — there is only one of it.
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const one = collage.addStage({ cast: [{ id: hero }] });
        const two = collage.addStage({ cast: [{ id: hero }] });

        collage.setActiveStage(one.id);
        collage.update(hero, { style: { silhouette: "#222" }, x: 500 });

        collage.setActiveStage(two.id);
        expect((collage.get(hero) as ImageLayer).style.silhouette).toBe("#222");
        expect(collage.get(hero)!.x).toBe(500);
    });

    it("keeps the whole canvas visible while a chapter is up", () => {
        const { collage, layers } = canvasWith(4);
        const stage = collage.addStage({ cast: [{ id: layers[0].id }, { id: layers[2].id }] });

        expect(collage.list()).toHaveLength(4);
        collage.setActiveStage(stage.id);
        expect(collage.list()).toHaveLength(4);
        // Members and bystanders alike stand where they always were.
        expect(collage.list().find(l => l.id === layers[2].id)!.x)
            .toBe(collage.own(layers[2].id)!.x);
        expect(collage.list().find(l => l.id === layers[1].id)!.x)
            .toBe(collage.own(layers[1].id)!.x);
        collage.setActiveStage(null);
        expect(collage.list()).toHaveLength(4);
    });

    it("skips a cast member that has been deleted", () => {
        // A deleted layer should vanish from every chapter, not leave a hole
        // with a name in it.
        const { collage, layers } = canvasWith(2);
        const stage = collage.addStage({
            cast: [{ id: layers[0].id }, { id: layers[1].id }],
        });
        collage.remove(layers[1].id);
        collage.setActiveStage(stage.id);
        expect(collage.list()).toHaveLength(1);
    });

    it("falls back to the order given when a placement has no z", () => {
        const layers = [
            { id: "a", width: 10, height: 10, z: 99 },
            { id: "b", width: 10, height: 10, z: 1 },
        ] as ImageLayer[];
        const stage = { id: "s", name: "s", backdrop: null, script: [], cast: [{ id: "b" }, { id: "a" }] };
        const order = castOf(stage, id => layers.find(l => l.id === id) ?? null).map(l => l.id);
        expect(order).toEqual(["b", "a"]);
    });
});

describe("editing while a chapter is showing", () => {
    it("moves the one and only character, for every chapter at once", () => {
        // There is one world: an edit made while a chapter shows is an edit
        // to the world, and every chapter sees it.
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const one = collage.addStage({ cast: [{ id: hero }] });
        const two = collage.addStage({ cast: [{ id: hero }] });

        collage.setActiveStage(one.id);
        collage.update(hero, { x: 250, y: 60 });

        expect(collage.get(hero)).toMatchObject({ x: 250, y: 60 });
        collage.setActiveStage(two.id);
        expect(collage.get(hero)).toMatchObject({ x: 250, y: 60 });
        collage.setActiveStage(null);
        expect(collage.get(hero)!.x).toBe(250);
    });

    it("sends a whole edit — move and restyle — to the layer in one call", () => {
        const { collage, layers } = canvasWith(1);
        const hero = layers[0].id;
        const stage = collage.addStage({ cast: [{ id: hero }] });
        collage.setActiveStage(stage.id);

        collage.update(hero, { x: 40, label: "the hero" });

        expect(collage.get(hero)).toMatchObject({ x: 40, label: "the hero" });
        collage.setActiveStage(null);
        expect(collage.get(hero)).toMatchObject({ x: 40, label: "the hero" });
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
        /*
         * Length does NOT tell them apart, and this used to pretend it did.
         *
         * The threshold moved three times as the library grew, which is what a
         * wrong proxy does. A music box winding down runs twenty seconds and
         * is a cue: it fires once and finishes. A hurdy-gurdy drone runs
         * sixteen and is a bed: it plays under a scene for as long as the
         * scene lasts. The same twenty seconds, opposite roles — because the
         * difference is what the sound DOES, which is what `role` records and
         * what the speaker branches on.
         *
         * So the bounds are only wide sanity rails: a two-second bed or a
         * minute-long sting would be a mistake in the manifest, and anything
         * between is a judgement the manifest is entitled to make.
         */
        for (const id of soundNames("bed")) expect(findSound(id)!.seconds).toBeGreaterThan(10);
        for (const id of soundNames("cue", "sfx")) expect(findSound(id)!.seconds).toBeLessThan(25);
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
        expect(credits).toEqual([{ id: "a", role: "the grandmother", actor: "gran.png" }]);
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
    it("is world state: the wolf faces the way the story last turned him", () => {
        // One continuous world means one facing. A turn really turns him,
        // and the next chapter meets him the way the last one left him.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const wolf = collage.addImage({ src: "w", natural: { width: 100, height: 200 } });
        const stage = collage.addStage({ name: "the wood", cast: [{ id: wolf.id }] });
        collage.setActiveStage(stage.id);
        collage.update(wolf.id, { flip: true });
        expect(collage.list().find(l => l.id === wolf.id)?.flip).toBe(true);
        collage.setActiveStage(null);
        expect(collage.get(wolf.id)?.flip).toBe(true);
    });
});

describe("things holding things", () => {
    it("resolves a held layer as offsets from its holder's hand", () => {
        // Holding is WORLD state on the layer: no chapter needed, and a
        // lantern taken in chapter one is still in the hand in chapter two.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const girl = collage.addImage({ src: "g", natural: { width: 100, height: 200 }, x: 300, y: 100 });
        const basket = collage.addImage({ src: "b", natural: { width: 50, height: 50 } });
        collage.update(basket.id, { held: { by: girl.id, x: 40, y: 60 } });

        const seen = collage.list().find(layer => layer.id === basket.id)!;
        expect(seen.x).toBe(340);
        expect(seen.y).toBe(160);

        // And it rides through every chapter alike, because there is only
        // one world for it to be held in.
        const stage = collage.addStage({ name: "the path", cast: [{ id: girl.id }] });
        collage.setActiveStage(stage.id);
        expect(collage.get(basket.id)!.x).toBe(340);
    });

    it("routes a drag of a held thing back into its offset", () => {
        // The canvas edits in world coordinates — it can only see where things
        // ARE — so the door has to translate, or dragging a held basket would
        // teleport it by the holder's whole position.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const girl = collage.addImage({ src: "g", natural: { width: 100, height: 200 }, x: 300, y: 100 });
        const basket = collage.addImage({ src: "b", natural: { width: 50, height: 50 } });
        collage.update(basket.id, { held: { by: girl.id, x: 40, y: 60 } });

        collage.update(basket.id, { x: 350, y: 170 });
        const held = collage.own(basket.id)!.held!;
        expect(held.x).toBe(50);
        expect(held.y).toBe(70);
        expect(held.by).toBe(girl.id);
    });

    it("follows the holder wherever the story walks them", () => {
        // The whole point of offsets: move the girl, the basket comes along
        // without anything keeping them in step.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const girl = collage.addImage({ src: "g", natural: { width: 100, height: 200 }, x: 300, y: 100 });
        const basket = collage.addImage({ src: "b", natural: { width: 50, height: 50 } });
        collage.update(basket.id, { held: { by: girl.id, x: 40, y: 60 } });

        collage.update(girl.id, { x: 1300 });
        expect(collage.get(basket.id)!.x).toBe(1340);
    });

    it("keeps its last spot when the holder is deleted", () => {
        // Offsets from nobody are not a position: a vanished holder leaves
        // the held thing standing at its own last committed coordinates.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const girl = collage.addImage({ src: "g", natural: { width: 100, height: 200 }, x: 300, y: 100 });
        const basket = collage.addImage({ src: "b", natural: { width: 50, height: 50 }, x: 20, y: 30 });
        collage.update(basket.id, { held: { by: girl.id, x: 40, y: 60 } });

        collage.remove(girl.id);
        expect(collage.get(basket.id)).toMatchObject({ x: 20, y: 30 });
    });

    it("lets a drop write the landing spot instead of new offsets", () => {
        // A drop passes held:null plus where it landed; routing that spot
        // into offsets from a hand that is opening would obey the old state
        // over the edit.
        const collage = new Collage({ newId: p => `${p}-${Math.random()}` });
        const girl = collage.addImage({ src: "g", natural: { width: 100, height: 200 }, x: 300, y: 100 });
        const basket = collage.addImage({ src: "b", natural: { width: 50, height: 50 } });
        collage.update(basket.id, { held: { by: girl.id, x: 40, y: 60 } });

        collage.update(basket.id, { held: null, x: 500, y: 250 });
        expect(collage.own(basket.id)!.held).toBeUndefined();
        expect(collage.get(basket.id)).toMatchObject({ x: 500, y: 250 });
    });
});
