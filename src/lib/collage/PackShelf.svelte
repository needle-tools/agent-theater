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
     * Bottom LEFT, not bottom centre: the middle of the bottom edge belongs
     * to the browser agent's own controls (voice button, activity bubbles),
     * and the help button holds the right corner.
     */
    import { TROUPE, TROUPE_PACKS, type TroupePiece } from "./troupe.js";
    import { STAGE_WIDTH, type CollageStudio } from "./studio.js";
    import { idleSet } from "./idleSet.js";

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
    /** A whole pack on its way to the canvas; the button waits it out. */
    let adding = $state(false);

    const packs = TROUPE_PACKS
        .map(pack => ({ ...pack, pieces: TROUPE.filter(piece => piece.pack === pack.id) }))
        .filter(pack => pack.pieces.length);

    /** The pile shows stickers, not stage slices — a backdrop face-down on a
     *  pile of stickers looks like a missing image, being mostly one colour. */
    function stickersOf(pieces: TroupePiece[]): TroupePiece[] {
        return pieces.filter(piece => piece.kind === "scenery" || piece.kind === "actor");
    }

    function widthFor(piece: TroupePiece): number {
        // Stage slices arrive at stage width so they can line up. Everything
        // else is sized against what the person is LOOKING at, not against
        // canvas units: a sticker should land about a sixth of the screen
        // wide whatever the zoom, because "decent size" is a property of the
        // view, not of the sheet.
        if (["backdrop", "midground", "foreground"].includes(piece.kind)) return STAGE_WIDTH;
        // Sized like the strewn props (9–16vmin), so a dragged sticker joins
        // the arrangement as a peer, not as a giant among miniatures.
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

    /**
     * The whole pack, strewn across the middle of the view — spread out
     * rather than piled, because the next thing the person does is arrange
     * them, and a stack must be un-stacked before anything else can happen.
     * Stage slices stay in the drawer: "all the stickers" is not "the scenery
     * of an entire room, at full stage width, five deep".
     */
    async function addAll(packId: string) {
        const pack = packs.find(candidate => candidate.id === packId);
        if (!pack || adding) return;
        adding = true;
        try {
            const stickers = stickersOf(pack.pieces);
            for (const [index, piece] of stickers.entries()) {
                const fx = stickers.length === 1
                    ? 0.5
                    : 0.12 + 0.76 * (index / (stickers.length - 1));
                const fy = 0.35 + 0.3 * ((index % 3) / 2);
                await addPiece(piece, toCanvas(window.innerWidth * fx, window.innerHeight * fy));
            }
        } finally {
            adding = false;
        }
    }

    /** The sticker riding the pointer from the fan to the canvas. */
    let ghost = $state<{ piece: TroupePiece; x: number; y: number; from: { x: number; y: number } } | null>(null);
    let shelf: HTMLElement | null = $state(null);

    function startDrag(event: PointerEvent, piece: TroupePiece) {
        if (event.button !== 0) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
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
    <div class="shelf" class:shelf--away={showing} bind:this={shelf}>
        {#if open}
            {#each packs.filter(pack => pack.id === open) as pack (pack.id)}
                <div class="fan" role="group" aria-label="{pack.id} stickers">
                    <div class="fan__head">
                        <strong class="fan__name">{pack.id}</strong>
                        <button class="fan__all" disabled={adding} onclick={() => addAll(pack.id)}>
                            {adding ? "Dealing…" : "Add all stickers"}
                        </button>
                    </div>
                    <div class="fan__strip">
                        {#each pack.pieces as piece (piece.id)}
                            <div
                                class="fan__sticker"
                                class:fan__sticker--wide={widthFor(piece) === STAGE_WIDTH}
                                role="button"
                                tabindex="0"
                                title={piece.description || piece.id}
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
                    title={pack.description}
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
        left: 16px;
        bottom: 12px;
        z-index: 26;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        max-width: min(560px, calc(100vw - 140px));
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
        gap: 10px;
        max-width: 100%;
        overflow-x: auto;
        padding: 4px;
    }

    .pile {
        flex: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 6px 8px 5px;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent);
        border-radius: 12px;
        background: var(--surface-panel);
        box-shadow:
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 8px 22px rgba(34, 44, 32, 0.08);
        cursor: pointer;
        transition-property: background, border-color, scale;
        transition-duration: 0.16s;
    }

    .pile:hover {
        background: var(--surface-panel-muted);
        border-color: var(--border-strong);
    }

    .pile:active {
        scale: 0.96;
    }

    .pile--open {
        border-color: var(--accent-brand);
        background: color-mix(in srgb, var(--accent-brand) 14%, var(--surface-panel));
    }

    .pile__stack {
        position: relative;
        width: 44px;
        height: 40px;
    }

    .pile__stack img {
        position: absolute;
        inset: 0;
        margin: auto;
        max-width: 38px;
        max-height: 36px;
        rotate: var(--lean, 0deg);
        filter: drop-shadow(0 1px 1.5px rgba(20, 24, 18, 0.35));
    }

    .pile__name {
        font-size: var(--type-micro-label-size, 11px);
        color: var(--text-secondary);
    }

    .fan {
        /* Outer 16 = inner 10 + 6 padding. */
        border-radius: 16px;
        padding: 6px;
        max-width: 100%;
        background: var(--surface-panel);
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--border-subtle) 60%, transparent),
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 12px 28px rgba(34, 44, 32, 0.10);
        animation: fan-in 0.18s cubic-bezier(0.2, 0, 0, 1);
    }

    @keyframes fan-in {
        from { opacity: 0; translate: 0 8px; }
        to { opacity: 1; translate: 0 0; }
    }

    @media (prefers-reduced-motion: reduce) {
        .fan { animation: none; }
    }

    .fan__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 4px 6px 6px;
    }

    .fan__name {
        font-size: var(--type-body-muted-size, 13px);
        color: var(--text-primary);
        text-transform: capitalize;
    }

    .fan__all {
        min-height: 30px;
        padding: 0 0.6rem;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
        border-radius: 10px;
        background: var(--surface-panel);
        color: var(--text-secondary);
        font: inherit;
        font-size: var(--type-micro-label-size, 11px);
        cursor: pointer;
        transition-property: background, border-color, color, scale;
        transition-duration: 0.14s;
    }

    .fan__all:hover:not(:disabled) {
        border-color: var(--border-strong);
        color: var(--text-primary);
    }

    .fan__all:active:not(:disabled) {
        scale: 0.96;
    }

    .fan__all:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .fan__strip {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding: 2px 4px 6px;
    }

    .fan__sticker {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        border-radius: 10px;
        cursor: grab;
        /* The pointer is about to be captured for the drag; the browser must
           not start a native image drag or a scroll instead. */
        touch-action: none;
        transition-property: background, scale;
        transition-duration: 0.14s;
    }

    .fan__sticker:hover {
        background: var(--surface-panel-muted);
    }

    .fan__sticker:active {
        cursor: grabbing;
        scale: 0.96;
    }

    .fan__sticker img {
        max-width: 56px;
        max-height: 56px;
        pointer-events: none;
        filter: drop-shadow(0 1px 2px rgba(20, 24, 18, 0.3));
    }

    /* A stage slice shows as a wide little card rather than a square. */
    .fan__sticker--wide {
        width: 96px;
    }

    .fan__sticker--wide img {
        max-width: 88px;
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
