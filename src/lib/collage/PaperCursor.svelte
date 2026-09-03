<script lang="ts">
    /**
     * A tool cursor that is a drawing rather than an image file.
     *
     * CSS `cursor:` takes a URL and nothing else — no `paint()`, no `filter`,
     * no animation. A cursor that boils like the rest of the paper therefore
     * cannot be a cursor at all: the real one is hidden and this follows the
     * pointer in its place.
     *
     * What that buys, beyond the wobble: the cursor is the same picture as the
     * eraser in the drawer, painted by the same worklet, at any size we like.
     * Chrome refuses a cursor image over 128px; an element has no such ceiling.
     *
     * What it costs, and it is worth being honest about it: a frame of lag.
     * The real pointer is composited by the OS, this one by the page, so on a
     * slow frame it trails. It sits at `translate` on a fixed element so the
     * move never touches layout, which keeps that to the one frame.
     *
     * Two levels on purpose, exactly as the strewn props are built: the outer
     * element owns `translate` for the pointer, and the inner image owns the
     * `.painted` animation — which drives `translate` and `rotate` itself, and
     * on a single element would simply overwrite the position each frame.
     */
    interface Props {
        /** The picture. Any size: it is scaled by `size`, not by the file. */
        src: string;
        /**
         * Where in the picture the click lands, as a fraction of its box —
         * {x: 0.1, y: 0.9} is near the bottom-left corner. A fraction rather
         * than pixels so one number survives a change of `size`.
         */
        hotspot?: { x: number; y: number };
        /** How wide to draw it, in CSS pixels. */
        size?: number;
        /** Off means the real cursor is back and nothing renders. */
        active?: boolean;
        /** A steadier or livelier hand, from the painterly temperaments. */
        paint?: string;
    }

    let {
        src,
        hotspot = { x: 0.5, y: 0.5 },
        size = 44,
        active = false,
        paint = "",
    }: Props = $props();

    let x = $state(0);
    let y = $state(0);
    /**
     * Nothing is drawn until the pointer has actually moved.
     *
     * Otherwise an armed tool paints a cursor at 0,0 — top-left corner, where
     * the pointer is not — until the first move. `seen` also goes false when
     * the pointer leaves the window, so the drawing does not sit frozen at the
     * edge while the mouse is somewhere else entirely.
     */
    let seen = $state(false);

    /*
     * One update per frame.
     *
     * Pointer events fire faster than the screen redraws — a high-rate mouse
     * sends several per frame — and each one would otherwise be a reactive
     * write and a style recalculation for a position nobody ever sees.
     */
    let queued = 0;
    function follow(event: PointerEvent) {
        const nextX = event.clientX;
        const nextY = event.clientY;
        seen = true;
        if (queued) return;
        queued = requestAnimationFrame(() => {
            queued = 0;
            x = nextX;
            y = nextY;
        });
    }

    $effect(() => () => { if (queued) cancelAnimationFrame(queued); });
</script>

<svelte:window
    onpointermove={follow}
    onpointerdown={follow}
    onpointerout={event => { if (!event.relatedTarget) seen = false; }}
    onblur={() => (seen = false)}
/>

{#if active && seen}
    <div
        class="paper-cursor"
        aria-hidden="true"
        style:translate="{x - size * hotspot.x}px {y - size * hotspot.y}px"
        style:width="{size}px"
    >
        <img class="paper-cursor__art painted {paint ? `painted--${paint}` : ''}" {src} alt="" draggable="false" />
    </div>
{/if}

<style>
    .paper-cursor {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 2147483647;
        /* Never a hit target: it sits under the pointer, so anything else
           would mean the tool could only ever click itself. */
        pointer-events: none;
        will-change: translate;
    }

    .paper-cursor__art {
        display: block;
        width: 100%;
        /*
         * Bigger marks than the default, for the same reason the strewn props
         * enlarge theirs: the worklet sizes its brush against the object, and
         * on something 44px across the default lands under a pixel wide — a
         * dry brush that fine is not subtle, it is invisible.
         */
        --paint-scale: 2.2;
        /*
         * The boil's warp and the shadow together, by hand.
         *
         * `.painted--boil` would set `filter` from the shared sheet and this
         * scoped rule is more specific, so it would win and the wander would
         * be lost. Reading `--paint-warp` here composes both. The fallback is
         * the first filter rather than `none`, because `filter: none
         * drop-shadow(...)` is not a valid list and would silently drop the
         * shadow.
         */
        filter: var(--paint-warp, url("#paint-boil-0"))
            drop-shadow(0 2px 3px rgba(20, 24, 18, 0.4));
    }

    @media (prefers-reduced-motion: reduce) {
        .paper-cursor__art { animation: none; }
    }
</style>
