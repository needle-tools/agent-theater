<script lang="ts">
    /**
     * The sticker drawers, sitting where you can reach them.
     *
     * Each configured shelf group is a little pile of stickers at the bottom
     * edge. Each pile shows the exact sticker a drag will deal; clicking it
     * shuffles that preview. The root manifest owns the order and theme list.
     * The pieces arrive as real layers — the same ones theater_troupe deals —
     * so an agent looking at the canvas sees exactly what was arranged.
     *
     * Bottom CENTRE. It began bottom-left, to leave the middle of the edge to
     * the browser agent's own controls — but the drawer is the thing a person
     * reaches for most, and a row of piles pushed into a corner reads as a
     * status bar rather than as a place to take things from. The agent's
     * controls float above it; the help button still holds the right corner.
     *
     * There are deliberately only a few piles, always in one row. The shelf is
     * a quick source of surprises rather than a catalogue to browse.
     */
    import { TROUPE, TROUPE_SHELF, type TroupePiece } from "./troupe.js";
    import { STAGE_WIDTH, type CollageStudio } from "./studio.js";
    import { idleSet } from "./idleSet.js";
    import { tamedWidth } from "./placement.js";
    import { hint } from "./hint.js";
    import { playInteractionSound } from "./interactionSounds.js";
    import { greetingForActor, voiceForActor } from "./characterVoice.js";
    import type { SubtitleVoice } from "../subtitleVoice/index.js";

    interface Props {
        studio: CollageStudio;
        /** Client → canvas coordinates, lent by the canvas component. */
        toCanvas: (clientX: number, clientY: number) => { x: number; y: number } | null;
        /** The current view zoom, so stickers arrive at a sensible SEEN size. */
        zoom: () => number;
        /** Introduce an actor placed on the open canvas, outside a chapter. */
        onActorPlaced?: (id: string, voice: SubtitleVoice, greeting: string) => void;
    }

    let { studio, toCanvas, zoom, onActorPlaced }: Props = $props();

    /** Hidden while a show runs — the audience does not see the prop room. */
    let showing = $state(false);
    $effect(() => {
        showing = !!studio.showing;
        return studio.onShowChanged(() => (showing = !!studio.showing));
    });

    let shelfMode = $state<"assorted" | "themes">("assorted");
    const packs = $derived.by(() => TROUPE_SHELF[shelfMode]
        .map(group => ({
            ...group,
            pieces: TROUPE.filter(piece =>
                group.packs.includes(piece.pack) && group.kinds.includes(piece.kind)),
        }))
        .filter(group => group.pieces.length));
    let nextByPack = $state<Record<string, string>>({});

    const PACK_THOUGHTS: Record<string, string> = {
        animals: "What if a creature wandered in? %wait5% Maybe it knows the way home... // Or perhaps it has something to say.",
        "fairy-tale": "Perhaps an old spell wakes up... %wait5% Who has been waiting in the tower? // Maybe the crown chose the wrong hero.",
        food: "Maybe the feast hides a surprise... %wait5% Who took the last bite? // Perhaps dinner is about to escape.",
        forest: "What could be waiting in the woods? %wait5% A trail appears where none was before... // Maybe the trees remember everything.",
        home: "A quiet room can hold a big secret... %wait5% Who left the light on? // Perhaps something here is not where it belongs.",
        landscape: "Where might the road lead next? %wait5% A storm could be coming... // Maybe this place has been forgotten.",
        ocean: "Something strange washes ashore... %wait5% What is moving beneath the waves? // Perhaps the tide brought a message.",
        office: "What if today is not an ordinary day? %wait5% Someone left a curious note... // Maybe the smallest job starts the biggest story.",
    };

    /** The pile shows stickers, not stage slices — a backdrop face-down on a
     *  pile of stickers looks like a missing image, being mostly one colour. */
    function stickersOf(pieces: TroupePiece[]): TroupePiece[] {
        return pieces.filter(piece => piece.kind === "scenery" || piece.kind === "actor");
    }

    function widthFor(piece: TroupePiece): number {
        // Stage slices arrive at stage width so they can line up.
        if (["backdrop", "midground", "foreground"].includes(piece.kind)) return STAGE_WIDTH;
        /*
         * Sized like its NEIGHBOURS first. A dropped sticker joins an
         * arrangement, and "the right size" is whatever the other stickers
         * are — the median of what is already lying on the paper. A
         * screen-relative size looked right on an empty canvas and comically
         * large next to pieces that were adopted at another zoom: the view
         * changes, the arrangement does not.
         */
        const peers = studio.collage.listAll()
            .filter(layer => layer.kind === "image" && layer.width < STAGE_WIDTH * 0.6)
            .map(layer => layer.width)
            .sort((a, b) => a - b);
        if (peers.length) return Math.round(peers[Math.floor(peers.length / 2)]);
        // An empty canvas has no peers, so the strewn props' deal stands in:
        // about 13vmin as seen at the current zoom.
        const seen = (Math.min(window.innerWidth, window.innerHeight) * 0.13)
            / Math.max(0.05, zoom());
        return Math.round(Math.min(420, Math.max(72, seen)));
    }

    /**
     * The nearest clear patch of paper to where the sticker was headed.
     *
     * Checked against every layer already on the canvas, stepping outward in
     * rings until there is room — new stickers must not land on top of the
     * arrangement somebody is making, because un-stacking them is exactly the
     * chore the shelf exists to remove.
     */
    function freeSpot(near: { x: number; y: number }, size: number): { x: number; y: number } {
        /*
         * Real layers, plus the strewn idle props: those are about to be
         * adopted as layers the moment this sticker lands, so a drop that
         * ignored them would sit exactly on top of the arrangement it is
         * joining.
         */
        const others = studio.collage.listAll().map(layer => ({
            x: layer.x + layer.width / 2,
            y: layer.y + layer.height / 2,
            girth: Math.min(layer.width, layer.height),
        }));
        const vmin = Math.min(window.innerWidth, window.innerHeight);
        for (const prop of idleSet.props) {
            const centre = toCanvas(
                (prop.x / 100) * window.innerWidth, (prop.y / 100) * window.innerHeight);
            if (centre) {
                // Generous: props are up to 16vmin, and taller than wide.
                others.push({ ...centre, girth: (vmin * 0.16) / Math.max(0.05, zoom()) });
            }
        }
        const clear = (x: number, y: number) =>
            others.every(other =>
                Math.hypot(other.x - x, other.y - y) > (other.girth + size) / 2 * 0.9);
        if (clear(near.x, near.y)) return near;
        for (let ring = 1; ring <= 14; ring++) {
            const reach = ring * size * 0.5;
            for (let step = 0; step < 8; step++) {
                const angle = (step / 8) * Math.PI * 2 + ring * 0.7;
                const x = near.x + Math.cos(angle) * reach;
                const y = near.y + Math.sin(angle) * reach;
                if (clear(x, y)) return { x, y };
            }
        }
        return near;
    }

    async function addPiece(piece: TroupePiece, near?: { x: number; y: number } | null) {
        const width = widthFor(piece);
        const world = studio.collage.listAll();
        const { layer } = await studio.addImage(piece.file, {
            label: piece.id,
            // Cut before it was shipped; a remover pass would only find
            // things to wrongly remove.
            removeBackground: false,
            slice: false,
            width,
            ...(near ? { near: freeSpot(near, width) } : {}),
            by: "human",
        });
        // Widths match, heights may not: a pencil at sheep-width is a tower.
        const tamed = tamedWidth(layer, world);
        if (tamed !== null) studio.collage.update(layer.id, { width: tamed });
        const stage = studio.collage.activeStage;
        if (piece.kind === "actor") {
            const voice = voiceForActor(piece);
            if (stage && !stage.cast.some(member => member.id === layer.id)) {
                studio.collage.updateStage(stage.id, {
                    cast: [...stage.cast, { id: layer.id, voice }],
                });
            } else if (!stage) {
                onActorPlaced?.(layer.id, voice, greetingForActor(piece));
            }
        }
        studio.save();
    }

    type ShelfPack = { id: string; pieces: TroupePiece[] };

    function nextSticker(pack: ShelfPack): TroupePiece {
        const stickers = stickersOf(pack.pieces);
        const selected = stickers.find(piece => piece.id === nextByPack[pack.id]);
        if (selected) return selected;
        const hash = [...pack.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return stickers[hash % stickers.length];
    }

    function randomizeNext(pack: ShelfPack): void {
        const current = nextSticker(pack);
        const alternatives = stickersOf(pack.pieces).filter(piece => piece.id !== current.id);
        const next = alternatives[Math.floor(Math.random() * alternatives.length)] ?? current;
        nextByPack[pack.id] = next.id;
    }

    /** The exact preview sticker riding from its category pile to the canvas. */
    let ghost = $state<{
        piece: TroupePiece;
        packId: string;
        x: number;
        y: number;
        from: { x: number; y: number };
    } | null>(null);
    let shelf: HTMLElement | null = $state(null);

    function startPackDrag(event: PointerEvent, pack: ShelfPack) {
        if (event.button !== 0) return;
        event.preventDefault();
        // Throws when the pointer is not genuinely down — synthetic events,
        // some pens. Losing capture costs only a drag that ends off the
        // element; throwing here would silently eat the whole add.
        try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch { /* carry on without capture */ }
        ghost = {
            piece: nextSticker(pack),
            packId: pack.id,
            x: event.clientX,
            y: event.clientY,
            from: { x: event.clientX, y: event.clientY },
        };
        playInteractionSound("pickup");
    }

    function moveDrag(event: PointerEvent) {
        if (!ghost) return;
        ghost = { ...ghost, x: event.clientX, y: event.clientY };
    }

    function endDrag(event: PointerEvent) {
        if (!ghost) return;
        const { piece, packId, from } = ghost;
        const wandered = Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8;
        const overShelf = shelf?.contains(document.elementFromPoint(event.clientX, event.clientY) as Node | null);
        ghost = null;
        if (wandered && !overShelf) {
            // Dropped on the canvas: consume this preview and deal the next.
            void addPiece(piece, toCanvas(event.clientX, event.clientY));
            const pack = packs.find(candidate => candidate.id === packId);
            if (pack) randomizeNext(pack);
        } else if (!wandered) {
            // Clicking is a shuffle, not an add: show another exact preview.
            const pack = packs.find(candidate => candidate.id === packId);
            if (pack) randomizeNext(pack);
        }
        playInteractionSound("putdown");
    }

    function cancelDrag() {
        if (ghost) playInteractionSound("putdown");
        ghost = null;
    }
</script>

{#if packs.length}
    <div
        class="shelf"
        class:shelf--away={showing}
        bind:this={shelf}
        role="group"
        aria-label="Sticker packs"
    >
        {#if false}
            <div class="shelf__modes" role="group" aria-label="Sort sticker piles">
                <button
                    class:active={shelfMode === "assorted"}
                    aria-pressed={shelfMode === "assorted"}
                    onclick={() => (shelfMode = "assorted")}
                >Assorted</button>
                <button
                    class:active={shelfMode === "themes"}
                    aria-pressed={shelfMode === "themes"}
                    onclick={() => (shelfMode = "themes")}
                >Themes</button>
            </div>
        {/if}
        <div class="piles">
            {#each packs as pack (pack.id)}
                {@const piece = nextSticker(pack)}
                <button
                    class="pile"
                    aria-label="Drag this {pack.label} sticker, or click to see another"
                    use:hint={PACK_THOUGHTS[pack.id] ?? "What story could this begin?"}
                    onpointerdown={event => startPackDrag(event, pack)}
                    onpointermove={moveDrag}
                    onpointerup={endDrag}
                    onpointercancel={cancelDrag}
                    onkeydown={event => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            randomizeNext(pack);
                        }
                    }}
                >
                    <span class="pile__stack" aria-hidden="true">
                        <img src={piece.file} alt="" draggable="false" loading="lazy" />
                    </span>
                </button>
            {/each}
        </div>
    </div>

    {#if ghost}
        <img
            class="ghost"
            src={ghost.piece.file}
            alt=""
            draggable="false"
            style:left="{ghost.x}px"
            style:top="{ghost.y}px"
        />
    {/if}
{/if}

<style>
    .shelf {
        position: absolute;
        /* Centred by margin rather than by translate, because translate is
           already spoken for by the show's fade-away below. */
        left: 0;
        right: 0;
        margin-inline: auto;
        width: fit-content;
        bottom: 62px;
        z-index: 26;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        max-width: min(1180px, calc(100vw - 120px));
        transition-property: opacity, translate;
        transition-duration: 0.4s;
        transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }

    /* The show plays to a clean room. */
    .shelf--away {
        opacity: 0;
        translate: 0 24px;
        pointer-events: none;
    }

    .piles {
        display: flex;
        flex-wrap: nowrap;
        justify-content: center;
        gap: 4px 10px;
        max-width: 100%;
        padding: 4px;
    }

    .shelf__modes {
        display: flex;
        padding: 2px;
        border: 1px solid color-mix(in srgb, var(--text-primary) 14%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--surface-panel) 84%, transparent);
        box-shadow: 0 2px 8px rgba(31, 26, 19, 0.08);
    }

    .shelf__modes button {
        padding: 4px 10px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: var(--text-secondary);
        font: inherit;
        font-size: 11px;
        cursor: var(--cursor-pointer, pointer);
    }

    .shelf__modes button.active {
        background: var(--surface-panel);
        color: var(--text-primary);
        box-shadow: 0 1px 4px rgba(31, 26, 19, 0.13);
    }

    /*
     * No card. The piles are stickers lying on the paper, so a panel behind
     * each one turns a drawer into a toolbar — and twenty little white cards
     * in a row is most of what the eye sees. The stickers carry their own
     * drop shadow, which is all the lift they need.
     */
    .pile {
        flex: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 6px 8px 5px;
        border: 1px solid transparent;
        border-radius: 12px;
        background: none;
        cursor: var(--cursor-pointer, pointer);
        transition-property: background, border-color, scale, translate;
        transition-duration: 0.16s;
    }

    /* A small lift is enough to say "this one" without opening a menu. */
    .pile:hover,
    .pile:focus-visible {
        translate: 0 -2px;
    }

    .pile:active {
        scale: 0.96;
    }

    .pile__stack {
        position: relative;
        width: 62px;
        height: 56px;
    }

    .pile__stack img {
        position: absolute;
        inset: 0;
        margin: auto;
        max-width: 54px;
        max-height: 50px;
        filter: drop-shadow(0 1px 1.5px rgba(20, 24, 18, 0.35));
        transition: filter 0.16s;
    }

    /*
     * No panel, for the same reason the piles lost theirs: the fan is stickers
     * laid out on the paper, and a card behind them makes it a menu. The
     * stickers carry their own drop shadow and read fine on the dotted paper.
     */
    /*
     * Strewn, not shelved.
     *
     * A grid of evenly spaced squares reads as a catalogue; stickers spilled
     * out of a packet overlap and lie at angles, and that is what the drawer
     * is. Done with negative margins rather than absolute positions so the
     * whole thing still wraps and reflows on its own — a measured layout would
     * need the container size, and the container size depends on the layout.
     *
     * Wraps rather than scrolling sideways, for the same reason the piles do,
     * and stones-and-plants has fifty pieces so it needs a ceiling. Vertical
     * overflow is the one scrollbar worth having: a tall spill plainly reads
     * as continuing, where a sideways one does not.
     */
    /*
     * A fan, not a grid: every sticker sits at its own small angle, set from
     * its index in the pack so a pack leans the same way each time it opens.
     * A tilt that reshuffled on every hover would read as a glitch.
     *
     * No box of any kind — no background, no border, no outline. Pointing at a
     * sticker straightens it and lifts it, which is what a hand of cards does
     * and what a rectangle behind it does not.
     */
    /* Pointing at one pulls it clear of the pile: straight, bigger, and on
       top of its neighbours — otherwise the sticker you are reaching for is
       the one half-hidden under the next. */
    /* A stage slice shows as a wide little card rather than a square. */
    .ghost {
        position: fixed;
        z-index: 60;
        width: 84px;
        translate: -50% -50%;
        pointer-events: none;
        filter: drop-shadow(0 6px 14px rgba(20, 24, 18, 0.35));
        opacity: 0.9;
    }
</style>
