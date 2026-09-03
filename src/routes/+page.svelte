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
    import { invitation } from "$lib/collage/invitation";

    let promptCopyState = $state<"idle" | "copied" | "failed">("idle");

    async function copyPrompt() {
        try {
            await navigator.clipboard.writeText(invitation(location.origin));
            promptCopyState = "copied";
        } catch {
            promptCopyState = "failed";
        }
        setTimeout(() => (promptCopyState = "idle"), 2200);
    }
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
        data-hint-click-feedback
        aria-label="Copy the prompt"
        use:hint={promptCopyState === "copied"
            ? "Prompt copied — paste it into your AI agent."
            : promptCopyState === "failed"
                ? "Couldn’t copy the prompt. Please try again."
                : "WebMCP Theater was made by Needle. Click to copy the prompt for your browser’s AI agent."}
        onclick={copyPrompt}
    >
        <img src="/toolbar/questionmark.webp" alt="" draggable="false" />
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

    /* Sits immediately left of the GitHub cut-out. The button stays large for
       touch, but has no visible chrome of its own. */
    .help-trigger {
        position: fixed;
        right: 76px;
        bottom: 12px;
        z-index: 30;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 52px;
        height: 52px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--text-primary);
        cursor: var(--cursor-pointer, pointer);
        transition-property: scale;
        transition-duration: 0.16s;
    }

    .help-trigger:hover {
        scale: 1.05;
    }

    .help-trigger:active {
        scale: 0.96;
    }

    .help-trigger img {
        width: 48px;
        height: 48px;
        object-fit: contain;
        pointer-events: none;
    }

</style>
