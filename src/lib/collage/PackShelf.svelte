<script lang="ts">
    /**
     * The sticker drawers, sitting where you can reach them.
     *
     * Each troupe pack is a little pile of stickers at the bottom edge. Click
     * a pile and it shuffles open into a fan of everything in the pack; drag a
     * sticker onto the canvas to add just it, or take the whole pack at once.
     * The pieces arrive as real layers — the same ones theater_troupe deals —
     * so an agent looking at the canvas sees exactly what was arranged.
     *
     * Bottom CENTRE. It began bottom-left, to leave the middle of the edge to
     * the browser agent's own controls — but the drawer is the thing a person
     * reaches for most, and a row of piles pushed into a corner reads as a
     * status bar rather than as a place to take things from. The agent's
     * controls float above it; the help button still holds the right corner.
     *
     * The piles wrap onto a second row rather than scrolling sideways. Twenty
     * packs do not fit across a laptop, and a horizontal scrollbar hides the
     * packs past the edge completely: nobody scrolls a strip they cannot tell
     * continues.
     */
    import { TROUPE, TROUPE_PACKS, type TroupePiece } from "./troupe.js";
    import { STAGE_WIDTH, type CollageStudio } from "./studio.js";
    import { idleSet } from "./idleSet.js";
    import { hint } from "./hint.js";

    interface Props {
        studio: CollageStudio;
        /** Client → canvas coordinates, lent by the canvas component. */
        toCanvas: (clientX: number, clientY: number) => { x: number; y: number } | null;
        /** The current view zoom, so stickers arrive at a sensible SEEN size. */
        zoom: () => number;
    }

    let { studio, toCanvas, zoom }: Props = $props();

    /** Hidden while a show runs — the audience does not see the prop room. */
    let showing = $state(false);
    $effect(() => {
        showing = !!studio.showing;
        return studio.onShowChanged(() => (showing = !!studio.showing));
    });

    /** Which pack's fan is open, if any. */
    let open = $state<string | null>(null);

    const packs = TROUPE_PACKS
        .map(pack => ({ ...pack, pieces: TROUPE.filter(piece => piece.pack === pack.id) }))
        .filter(pack => pack.pieces.length);

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
        await studio.addImage(piece.file, {
            label: piece.id,
            // Cut before it was shipped; a remover pass would only find
            // things to wrongly remove.
            removeBackground: false,
            slice: false,
            width,
            ...(near ? { near: freeSpot(near, width) } : {}),
            by: "human",
        });
        studio.save();
    }

    /** The sticker riding the pointer from the fan to the canvas. */
    let ghost = $state<{ piece: TroupePiece; x: number; y: number; from: { x: number; y: number } } | null>(null);
    let shelf: HTMLElement | null = $state(null);

    function startDrag(event: PointerEvent, piece: TroupePiece) {
        if (event.button !== 0) return;
        event.preventDefault();
        // Throws when the pointer is not genuinely down — synthetic events,
        // some pens. Losing capture costs only a drag that ends off the
        // element; throwing here would silently eat the whole add.
        try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch { /* carry on without capture */ }
        ghost = {
            piece,
            x: event.clientX,
            y: event.clientY,
            from: { x: event.clientX, y: event.clientY },
        };
    }

    function moveDrag(event: PointerEvent) {
        if (!ghost) return;
        ghost = { ...ghost, x: event.clientX, y: event.clientY };
    }

    function endDrag(event: PointerEvent) {
        if (!ghost) return;
        const { piece, from } = ghost;
        const wandered = Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8;
        const overShelf = shelf?.contains(document.elementFromPoint(event.clientX, event.clientY) as Node | null);
        ghost = null;
        if (wandered && !overShelf) {
            // Dropped on the canvas: the sticker lands under the pointer.
            void addPiece(piece, toCanvas(event.clientX, event.clientY));
        } else if (!wandered) {
            // A plain click still means "I want this one" — it lands mid-view,
            // where the eye already is, rather than demanding the drag.
            void addPiece(piece, toCanvas(
                window.innerWidth * (0.42 + Math.random() * 0.16),
                window.innerHeight * (0.4 + Math.random() * 0.2)));
        }
    }
</script>

<svelte:window
    onkeydown={event => { if (open && event.key === "Escape") open = null; }}
    onpointerdown={event => {
        if (!open || !shelf) return;
        if (!shelf.contains(event.target as Node)) open = null;
    }}
/>

{#if packs.length}
    <div
        class="shelf"
        class:shelf--away={showing}
        bind:this={shelf}
        onpointerleave={() => {
            // Leaving the drawer closes the fan — but not mid-drag, when the
            // pointer is on its way to the canvas carrying a sticker.
            if (!ghost) open = null;
        }}
    >
        {#if open}
            {#each packs.filter(pack => pack.id === open) as pack (pack.id)}
                <div class="fan" role="group" aria-label="{pack.id} stickers">
                    <div class="fan__strip">
                        {#each stickersOf(pack.pieces) as piece, at (piece.id)}
                            <div
                                class="fan__sticker"
                                class:fan__sticker--wide={widthFor(piece) === STAGE_WIDTH}
                                style:--tilt="{(((at * 37) % 13) - 6) * 1.4}deg"
                                style:--dx="{(((at * 53) % 11) - 5) * 1.6}px"
                                style:--dy="{(((at * 29) % 15) - 7) * 1.5}px"
                                style:z-index={(at * 7) % 11}
                                role="button"
                                tabindex="0"
                                use:hint={piece.description || piece.id}
                                onpointerdown={event => startDrag(event, piece)}
                                onpointermove={moveDrag}
                                onpointerup={endDrag}
                                onpointercancel={() => (ghost = null)}
                                onkeydown={event => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        void addPiece(piece, toCanvas(
                                            window.innerWidth * 0.5, window.innerHeight * 0.5));
                                    }
                                }}
                            >
                                <img src={piece.file} alt={piece.id} draggable="false" loading="lazy" />
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        {/if}

        <div class="piles">
            {#each packs as pack (pack.id)}
                <button
                    class="pile"
                    class:pile--open={open === pack.id}
                    aria-label="Open the {pack.id} pack"
                    aria-expanded={open === pack.id}
                    use:hint={pack.description}
                    onpointerenter={event => {
                        // Hover fans the pack open — the drawer is for browsing,
                        // and a click per pack to look inside is a click too many.
                        // Only for a real pointer: on touch, pointerenter fires
                        // with the tap and would fight the click below.
                        if (event.pointerType === "mouse") open = pack.id;
                    }}
                    onfocus={() => (open = pack.id)}
                    onclick={() => (open = open === pack.id ? null : pack.id)}
                >
                    <span class="pile__stack" aria-hidden="true">
                        {#each stickersOf(pack.pieces).slice(0, 3) as piece, at (piece.id)}
                            <img src={piece.file} alt="" draggable="false" loading="lazy"
                                style:--lean="{(at - 1) * 9}deg" style:z-index={3 - at} />
                        {/each}
                    </span>
                    <span class="pile__name">{pack.id}</span>
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
        bottom: 12px;
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
        flex-wrap: wrap;
        justify-content: center;
        gap: 4px 10px;
        max-width: 100%;
        padding: 4px;
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
        cursor: pointer;
        transition-property: background, border-color, scale, translate;
        transition-duration: 0.16s;
    }

    /* Hover lifts rather than fills: the fan opening below is the real
       feedback, so the pile itself only needs to say "this one". */
    .pile:hover,
    .pile:focus-visible {
        translate: 0 -2px;
    }

    .pile:active {
        scale: 0.96;
    }

    .pile--open .pile__name {
        color: var(--text-primary);
    }

    .pile--open .pile__stack img {
        filter: drop-shadow(0 2px 3px rgba(20, 24, 18, 0.4));
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
        rotate: var(--lean, 0deg);
        filter: drop-shadow(0 1px 1.5px rgba(20, 24, 18, 0.35));
        transition: filter 0.16s;
    }

    .pile__name {
        font-size: var(--type-body-muted-size, 12px);
        color: var(--text-secondary);
    }

    /*
     * No panel, for the same reason the piles lost theirs: the fan is stickers
     * laid out on the paper, and a card behind them makes it a menu. The
     * stickers carry their own drop shadow and read fine on the dotted paper.
     */
    .fan {
        border-radius: 16px;
        padding: 6px;
        max-width: 100%;
        animation: fan-in 0.18s cubic-bezier(0.2, 0, 0, 1);
    }

    @keyframes fan-in {
        from { opacity: 0; translate: 0 8px; }
        to { opacity: 1; translate: 0 0; }
    }

    @media (prefers-reduced-motion: reduce) {
        .fan { animation: none; }
    }

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
    .fan__strip {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 0;
        max-height: 46vh;
        overflow-y: auto;
        /* Room for the overlap to reach without clipping the outer pieces. */
        padding: 14px 18px 18px;
    }

    /*
     * A fan, not a grid: every sticker sits at its own small angle, set from
     * its index in the pack so a pack leans the same way each time it opens.
     * A tilt that reshuffled on every hover would read as a glitch.
     *
     * No box of any kind — no background, no border, no outline. Pointing at a
     * sticker straightens it and lifts it, which is what a hand of cards does
     * and what a rectangle behind it does not.
     */
    .fan__sticker {
        position: relative;
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 92px;
        height: 92px;
        /* Negative margin is the overlap; the jitter is what stops the overlap
           looking like a deliberate offset repeated. */
        margin: -10px -16px;
        rotate: var(--tilt, 0deg);
        translate: var(--dx, 0) var(--dy, 0);
        cursor: grab;
        /* The pointer is about to be captured for the drag; the browser must
           not start a native image drag or a scroll instead. */
        touch-action: none;
        transition-property: rotate, scale, translate;
        transition-duration: 0.16s;
        transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }

    /* Pointing at one pulls it clear of the pile: straight, bigger, and on
       top of its neighbours — otherwise the sticker you are reaching for is
       the one half-hidden under the next. */
    .fan__sticker:hover,
    .fan__sticker:focus-visible {
        z-index: 20 !important;
        rotate: 0deg;
        scale: 1.14;
        translate: var(--dx, 0) calc(var(--dy, 0px) - 6px);
        outline: none;
    }

    .fan__sticker:hover img,
    .fan__sticker:focus-visible img {
        filter: drop-shadow(0 4px 7px rgba(20, 24, 18, 0.38));
    }

    .fan__sticker:active {
        cursor: grabbing;
        scale: 1;
    }

    .fan__sticker img {
        max-width: 84px;
        max-height: 84px;
        pointer-events: none;
        filter: drop-shadow(0 1px 2px rgba(20, 24, 18, 0.3));
        transition: filter 0.16s;
    }

    /* A stage slice shows as a wide little card rather than a square. */
    .fan__sticker--wide {
        width: 132px;
    }

    .fan__sticker--wide img {
        max-width: 124px;
    }

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
