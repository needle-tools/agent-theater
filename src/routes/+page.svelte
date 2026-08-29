<script lang="ts">
    import { onMount } from "svelte";
    import NeedleHero from "$lib/NeedleHero.svelte";

    // One prompt, two exits: copy it for any AI, or open ChatGPT with it prefilled.
    const promptFor = (origin: string) =>
        `Open ${origin} — it exposes WebMCP tools for 3D web development. ` +
        `List the Needle apps and tools you find, try the 3D scene tools on this page, ` +
        `and call get_workflow to see what we can do together across apps.`;

    let prompt = $state(promptFor("https://webmcp.needle.tools"));
    let chatgptUrl = $state("https://chatgpt.com/");
    let copied = $state(false);

    onMount(() => {
        prompt = promptFor(location.origin);
        chatgptUrl = "https://chatgpt.com/?q=" + encodeURIComponent(prompt);
    });

    async function copyPrompt() {
        await navigator.clipboard.writeText(prompt);
        copied = true;
        setTimeout(() => (copied = false), 1800);
    }
</script>

<svelte:head>
    <title>Needle × WebMCP — tools for 3D web development</title>
    <meta name="description"
        content="Needle web apps hand typed tools to the AI agent in your browser. Optimize models, remove backgrounds, inspect live scenes and search the Needle knowledge base — no install, no server, no API key." />
</svelte:head>

<section class="hero">
    <NeedleHero />
    <div class="hero-copy">
        <h1>Needle <span class="hero-times">×</span> <span class="hero-grad">WebMCP</span></h1>
        <p>Needle web apps hand typed tools to the AI agent in your browser.</p>

        <div class="prompt-box">
            <code>{prompt}</code>
            <button class="copy-button" onclick={copyPrompt} aria-label="Copy prompt">
                {#if copied}
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
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

        <div class="hero-actions">
            <a class="header-pill-button header-pill-button-primary" href={chatgptUrl} target="_blank" rel="noopener">
                Open in ChatGPT
            </a>
        </div>
    </div>
</section>

<style>
    /* One fullscreen act: the 3D scene, the title, one prompt to hand to an agent. */
    .hero {
        position: relative;
        margin-top: 0;
        width: 100vw;
        margin-left: calc(50% - 50vw);
        overflow: hidden;
        background: var(--surface-page-elevated);
        height: 100dvh;
        min-height: 560px;
    }

    .hero-copy {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 3.6rem 1.5rem 1.2rem;
        pointer-events: none;
        background: radial-gradient(ellipse 48% 44% at center,
                color-mix(in srgb, var(--surface-page-elevated) 80%, transparent) 0%,
                color-mix(in srgb, var(--surface-page-elevated) 40%, transparent) 55%,
                transparent 75%);
    }

    /* The overlay itself passes drags through to the 3D scene, but the text
       must receive pointer events or it can't be selected. */
    .hero-copy h1,
    .hero-copy p,
    .hero-copy a,
    .prompt-box {
        pointer-events: auto;
    }

    /* Split + staggered enter: each block rises in on its own beat. */
    .hero-copy > * {
        animation: rise 0.65s cubic-bezier(0.2, 0, 0, 1) both;
    }

    .hero-copy > *:nth-child(2) {
        animation-delay: 0.09s;
    }

    .hero-copy > *:nth-child(3) {
        animation-delay: 0.18s;
    }

    .hero-copy > *:nth-child(4) {
        animation-delay: 0.27s;
    }

    @keyframes rise {
        from {
            opacity: 0;
            translate: 0 14px;
            filter: blur(4px);
        }

        to {
            opacity: 1;
            translate: 0 0;
            filter: blur(0);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .hero-copy > * {
            animation: none;
        }
    }

    .hero-copy h1 {
        margin: 0 0 0.5rem;
        font-family: var(--font-family-display);
        font-size: clamp(2.4rem, 4.5vw, 3.6rem);
        font-weight: var(--type-display-weight);
        /* Roomier than the display default (0.95) — the tight leading can
           shave descenders and gradient glyph bottoms. */
        line-height: 1.08;
        letter-spacing: var(--type-display-tracking);
        text-wrap: balance;
        padding-bottom: 0.06em;
    }

    .hero-times {
        font-weight: 300;
        color: var(--text-muted);
    }

    .hero-grad {
        background: var(--gradient-cta);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
    }

    .hero-copy p {
        margin: 0.3rem auto 1.1rem;
        max-width: 40rem;
        color: var(--text-secondary);
        text-wrap: pretty;
    }

    /* The copy-paste thing: a soft panel holding the prompt and its button. */
    .prompt-box {
        display: flex;
        align-items: stretch;
        gap: 0.6rem;
        max-width: 44rem;
        background: var(--surface-panel);
        border: 1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent);
        border-radius: var(--radius-card);
        box-shadow:
            0 1px 2px rgba(34, 44, 32, 0.04),
            0 6px 18px rgba(34, 44, 32, 0.05);
        padding: 0.8rem 0.8rem 0.8rem 1rem;
        text-align: left;
    }

    .prompt-box code {
        font-family: var(--font-family-code);
        font-size: 0.82rem;
        line-height: 1.5;
        color: var(--text-secondary);
        user-select: all;
    }

    .copy-button {
        display: inline-flex;
        align-items: center;
        gap: 0.4em;
        align-self: center;
        flex: none;
        min-height: 40px;
        padding: 0 0.9rem;
        border-radius: var(--radius-pill);
        border: 1px solid var(--border-subtle);
        background: var(--surface-panel-muted);
        color: var(--text-primary);
        font-family: var(--font-family-body);
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        transition-property: background, border-color, scale;
        transition-duration: 0.16s;
    }

    .copy-button:hover {
        background: var(--surface-panel-strong);
        border-color: var(--border-strong);
    }

    .copy-button:active {
        scale: 0.96;
    }

    .copy-button svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .hero-actions {
        display: flex;
        gap: 0.7rem;
        margin: 1.1rem 0 0;
        pointer-events: auto;
        flex-wrap: wrap;
        justify-content: center;
    }
</style>
