<script lang="ts">
    /**
     * The front page is the canvas.
     *
     * Everything else is pinned to an edge and stays out of the way: the
     * wordmark top left, the collage's own controls top right, and the two
     * round buttons bottom right. Nothing floats in the middle, because the
     * middle is where the work happens.
     *
     * The prompt used to be a panel across the centre of the canvas. It is one
     * thing you need once — read it, copy it, open it somewhere — so it lives
     * behind a question mark now.
     */
    import Collage from "$lib/collage/Collage.svelte";
    import { hint } from "$lib/collage/hint";
</script>

<svelte:head>
    <title>Needle × WebMCP Theater — your browser's AI puts on a play</title>
    <meta name="description"
        content="A paper theatre driven by the AI agent in your browser: it decides the story with you, stages ready-cut props on three depth planes, directs camera and music — and you can rearrange the set while it works." />
</svelte:head>

<section class="canvas-shell">
    <Collage />

    <!-- No wordmark. It sat over the top left corner of the stage and was the
         only thing on the page that was about the page rather than about the
         play — and a theatre does not print its own name across the set. The
         title of the piece appears on its own card when the show starts, which
         is where a name belongs. -->

    <button
        type="button"
        class="help-trigger"
        aria-label="What is this?"
        use:hint={"Your browser’s AI can build and direct a paper play with you."}
    >
        <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7.4 7.3a2.7 2.7 0 1 1 3.2 3.1c-.5.2-.8.6-.8 1.1v.5" />
            <circle cx="10" cy="15.1" r="0.85" fill="currentColor" stroke="none" />
        </svg>
    </button>
</section>

<style>
    /*
     * Not 100vw. That includes the scrollbar gutter, so it overflows by the
     * scrollbar's width, and the horizontal bar that appears then steals enough
     * height to summon the vertical one too. The layout's <main> is already
     * full width, so there is nothing to break out of.
     */
    .canvas-shell {
        position: relative;
        width: 100%;
        height: 100dvh;
        overflow: hidden;
        background: var(--surface-page);
    }

    /* Sits immediately left of the layout's GitHub corner (42px wide at 16px). */
    .help-trigger {
        position: fixed;
        right: 66px;
        bottom: 16px;
        z-index: 30;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent);
        border-radius: var(--radius-pill);
        background: var(--surface-panel);
        color: var(--text-primary);
        box-shadow:
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 8px 22px rgba(34, 44, 32, 0.08);
        cursor: var(--cursor-pointer, pointer);
        transition-property: background, border-color, color, scale;
        transition-duration: 0.16s;
    }

    .help-trigger:hover {
        background: var(--surface-panel-muted);
        border-color: var(--border-strong);
    }

    .help-trigger:active {
        scale: 0.96;
    }

    .help-trigger svg {
        width: 19px;
        height: 19px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.75;
        stroke-linecap: round;
    }

</style>
