<script lang="ts">
    /**
     * The front page is the canvas.
     *
     * Everything else is pinned to an edge and stays out of the way: the
     * wordmark top left, the collage's own controls top right, and the
     * cut-out controls bottom right. Nothing floats in the middle, because the
     * middle is where the work happens.
     *
     * The prompt used to be a panel across the centre of the canvas. It is one
     * thing you need once — read it, copy it, open it somewhere — so it lives
     * behind a question mark now.
     */
    import Collage from "$lib/collage/Collage.svelte";
    import { hint } from "$lib/collage/hint";
    import { briefing } from "$lib/collage/invitation";
    import { copyText } from "$lib/collage/clipboard";

    let promptCopyState = $state<"idle" | "copied" | "failed">("idle");

    async function copyPrompt() {
        promptCopyState = await copyText(briefing(location.origin)) ? "copied" : "failed";
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

    <a
        class="library-trigger"
        href="/plays"
        aria-label="Browse community plays"
        use:hint={"Browse the play library."}
    >
        <img src="/toolbar/community-plays.webp" alt="" draggable="false" />
    </a>

    <button
        type="button"
        class="help-trigger"
        data-hint-click-feedback
        aria-label="Copy this page's ChatGPT prompt"
        use:hint={promptCopyState === "copied"
            ? "Copied. Paste it into ChatGPT to start your interactive play."
            : promptCopyState === "failed"
                ? "Couldn’t copy the prompt. Please try again."
                : "Send this page to ChatGPT for an interactive play. Click to copy the prompt."}
        onclick={copyPrompt}
    >
        <!-- Painted like everything else on the page: the same worklet, the
             same three holds. A cut-out that sits perfectly still next to a
             stage that boils reads as chrome bolted onto the set. `calm`
             because it is a signpost, not a prop — it should breathe, not
             wave. -->
        <img
            class="painted painted--calm painted--boil"
            src="/toolbar/questionmark.webp"
            alt=""
            draggable="false"
        />
    </button>
    <a
        class="record-trigger"
        href="/record"
        aria-label="Open motion recorder"
        use:hint={"Record movements for characters."}
    >
        <img src="/toolbar/record-button.webp" alt="" draggable="false" />
    </a>
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

    /* Corner cut-outs have generous touch targets and no toolbar chrome. */
    .library-trigger,
    .help-trigger,
    .record-trigger {
        position: fixed;
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
        transition-property: scale, opacity;
        transition-duration: 0.16s, 0.4s;
        text-decoration: none;
    }

    /* A murmur while the show plays — posted on the root by the theatre —
       and back at a glance's touch. */
    :global(html.theatre-watching) .library-trigger,
    :global(html.theatre-watching) .help-trigger,
    :global(html.theatre-watching) .record-trigger {
        opacity: 0.3;
    }

    :global(html.theatre-watching) .library-trigger:hover,
    :global(html.theatre-watching) .help-trigger:hover,
    :global(html.theatre-watching) .record-trigger:hover {
        opacity: 1;
    }

    /* Gone entirely while a billboard holds the screen: a title card plays
       to a dark, empty house. */
    :global(html.theatre-card) .library-trigger,
    :global(html.theatre-card) .help-trigger,
    :global(html.theatre-card) .record-trigger {
        opacity: 0;
        pointer-events: none;
    }

    .library-trigger { right: 12px; bottom: 204px; }
    .help-trigger { right: 12px; bottom: 140px; }
    .record-trigger { display: none; }

    .library-trigger:hover,
    .help-trigger:hover,
    .record-trigger:hover {
        scale: 1.05;
    }

    .library-trigger:active,
    .help-trigger:active,
    .record-trigger:active {
        scale: 0.96;
    }

    .library-trigger img,
    .help-trigger img,
    .record-trigger img {
        width: 48px;
        height: 48px;
        object-fit: contain;
        pointer-events: none;
    }

    .library-trigger img { width: 68px; height: 68px; max-width: none; }

    :global(.canvas-shell:has(.page--intro)) .library-trigger {
        animation: intro-corner 0.5s 4.5s both;
    }

    :global(.canvas-shell:has(.page--intro)) .help-trigger {
        animation: intro-corner 0.5s 4.7s both;
    }

    :global(.canvas-shell:has(.page--intro)) .record-trigger {
        animation: intro-corner 0.5s 4.9s both;
    }

    :global(.canvas-shell:has(.page--intro-fast)) .library-trigger {
        animation: none;
    }

    :global(.canvas-shell:has(.page--intro-fast)) .help-trigger {
        animation: none;
    }

    :global(.canvas-shell:has(.page--intro-fast)) .record-trigger {
        animation: none;
    }

    :global(.canvas-shell:has(.page--intro-pending)) .library-trigger,
    :global(.canvas-shell:has(.page--intro-pending)) .help-trigger,
    :global(.canvas-shell:has(.page--intro-pending)) .record-trigger {
        opacity: 0;
        visibility: hidden;
    }

    @keyframes intro-corner {
        from { opacity: 0; visibility: hidden; }
        to { opacity: 1; visibility: visible; }
    }

    /*
     * The brush, sized against a 48px cut-out.
     *
     * The worklet scales its marks to the object, so at the default a mark on
     * something this small lands under a pixel wide — a dry brush that fine is
     * not subtle, it is invisible. Same reasoning, and very nearly the same
     * number, as the paper cursor.
     *
     * The negative `--paint-at` is the other half: the cursor and the props
     * are all stepping through their own copy of the same three-frame loop,
     * and anything that starts at zero ticks in lockstep with them, which
     * reads as a strobe rather than as a hand.
     */
    .help-trigger img {
        --paint-scale: 2.2;
        --paint-seed: 23;
        --paint-at: -0.21s;
    }


</style>
