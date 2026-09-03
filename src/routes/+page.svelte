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
    import { onMount } from "svelte";
    import Collage from "$lib/collage/Collage.svelte";
    import { briefing, chatgptWith } from "$lib/collage/invitation";

    // The same sentence the empty stage shows. One string, defined once: it is
    // both the description of this page and the thing you paste into an agent,
    // and two copies of it would drift the moment either was reworded.
    let prompt = $state(briefing("https://webmcp.needle.tools"));
    let chatgptUrl = $state("https://chatgpt.com/");
    let copied = $state(false);
    let helpOpen = $state(false);
    let helpPanel: HTMLDivElement | null = $state(null);

    onMount(() => {
        prompt = briefing(location.origin);
        chatgptUrl = chatgptWith(prompt);
    });

    async function copyPrompt() {
        await navigator.clipboard.writeText(prompt);
        copied = true;
        setTimeout(() => (copied = false), 1800);
    }
</script>

<svelte:head>
    <title>Needle × WebMCP Theater — your browser's AI puts on a play</title>
    <meta name="description"
        content="A paper theatre driven by the AI agent in your browser: it decides the story with you, stages ready-cut props on three depth planes, directs camera and music — and you can rearrange the set while it works." />
</svelte:head>

<svelte:window
    onpointerdown={event => {
        if (!helpOpen || !helpPanel) return;
        const target = event.target as HTMLElement;
        if (!helpPanel.contains(target) && !target.closest?.("[data-help-trigger]")) helpOpen = false;
    }}
    onkeydown={event => { if (helpOpen && event.key === "Escape") helpOpen = false; }}
/>

<section class="canvas-shell">
    <Collage />

    <!-- No wordmark. It sat over the top left corner of the stage and was the
         only thing on the page that was about the page rather than about the
         play — and a theatre does not print its own name across the set. The
         title of the piece appears on its own card when the show starts, which
         is where a name belongs. -->

    <button
        class="help-trigger"
        class:help-trigger--open={helpOpen}
        data-help-trigger
        aria-label="What is this?"
        aria-expanded={helpOpen}
        onclick={() => (helpOpen = !helpOpen)}
    >
        <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7.4 7.3a2.7 2.7 0 1 1 3.2 3.1c-.5.2-.8.6-.8 1.1v.5" />
            <circle cx="10" cy="15.1" r="0.85" fill="currentColor" stroke="none" />
        </svg>
    </button>

    {#if helpOpen}
        <div class="help" bind:this={helpPanel} role="dialog" aria-label="About this page">
            <p class="lede">
                Needle web apps hand typed tools to the AI agent in your browser. This one is a
                theatre with a drawer of ready-cut paper props. Your agent decides the story with
                you, builds the set, and directs — moves, lines, music, camera. You watch,
                rearrange anything you like, and press play yourself.
            </p>

            <div class="prompt-box">
                <code>{prompt}</code>
                <button class="copy-button" onclick={copyPrompt} aria-label="Copy prompt">
                    {#if copied}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                        Copied
                    {:else}
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy
                    {/if}
                </button>
            </div>

            <a class="cta" href={chatgptUrl} target="_blank" rel="noopener">Open in ChatGPT</a>
        </div>
    {/if}
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
        cursor: pointer;
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

    .help-trigger--open {
        background: var(--accent-brand);
        border-color: transparent;
        color: #14200f;
    }

    .help-trigger svg {
        width: 19px;
        height: 19px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.75;
        stroke-linecap: round;
    }

    .help {
        position: fixed;
        right: 16px;
        bottom: 70px;
        z-index: 30;
        width: min(30rem, calc(100vw - 32px));
        /* Outer 18 = inner 12 + 6 padding. */
        border-radius: 18px;
        padding: 6px;
        background: var(--surface-panel);
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--border-subtle) 60%, transparent),
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 12px 28px rgba(34, 44, 32, 0.10),
            0 32px 64px rgba(34, 44, 32, 0.10);
        animation: help-in 0.18s cubic-bezier(0.2, 0, 0, 1);
    }

    @keyframes help-in {
        from { opacity: 0; scale: 0.98; translate: 0 6px; }
        to { opacity: 1; scale: 1; translate: 0 0; }
    }

    @media (prefers-reduced-motion: reduce) {
        .help { animation: none; }
    }

    .lede {
        margin: 0;
        padding: 10px 10px 12px;
        color: var(--text-secondary);
        font-size: var(--type-body-muted-size);
        line-height: var(--type-body-muted-line-height);
        text-wrap: pretty;
    }

    .prompt-box {
        display: flex;
        align-items: flex-start;
        gap: 0.6rem;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--surface-code, var(--surface-panel-strong));
    }

    .prompt-box code {
        flex: 1;
        min-width: 0;
        font-family: var(--font-family-code);
        font-size: var(--type-code-block-size);
        line-height: var(--type-code-block-line-height);
        color: var(--text-secondary);
        white-space: pre-wrap;
        word-break: break-word;
    }

    .copy-button {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        min-height: 30px;
        padding: 0 0.6rem;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
        border-radius: 10px;
        background: var(--surface-panel);
        color: var(--text-secondary);
        font: inherit;
        font-size: var(--type-micro-label-size);
        cursor: pointer;
        transition-property: background, border-color, color, scale;
        transition-duration: 0.14s;
    }

    .copy-button:hover {
        border-color: var(--border-strong);
        color: var(--text-primary);
    }

    .copy-button:active {
        scale: 0.96;
    }

    .copy-button svg {
        width: 13px;
        height: 13px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .cta {
        display: block;
        margin: 6px 0 0;
        padding: 10px;
        border-radius: 12px;
        background: var(--accent-brand);
        color: #14200f;
        font-weight: 600;
        font-size: var(--type-body-muted-size);
        text-align: center;
        text-decoration: none;
        transition-property: background, scale;
        transition-duration: 0.14s;
    }

    .cta:hover {
        background: var(--accent-brand-deep, var(--accent-brand));
    }

    .cta:active {
        scale: 0.96;
    }

</style>
