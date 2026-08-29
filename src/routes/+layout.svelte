<script lang="ts">
    import { onMount } from "svelte";
    import registry from "../../registry.json";
    import { registerWebMcpTools } from "$lib/webmcp";

    let { children } = $props();

    // Chrome ships WebMCP behind an origin trial. This is the needle.tools
    // subdomain-matched token (same one the Mesh Baker ships, expires
    // 2026-11-17) — it only takes effect when the site is served from a
    // *.needle.tools origin. Override with VITE_WEBMCP_ORIGIN_TRIAL_TOKEN.
    const originTrialToken =
        import.meta.env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN ||
        "ArulNF59jmGx6OwxGl6DaZU8g60uiQKkwKLC1ml/1gjTEeNQ1+pB4ujxawuK6rj7RIyCgDOU5YGDT8NxFwDQuAgAAABfeyJvcmlnaW4iOiJodHRwczovL25lZWRsZS50b29sczo0NDMiLCJmZWF0dXJlIjoiV2ViTUNQIiwiZXhwaXJ5IjoxNzk0ODczNjAwLCJpc1N1YmRvbWFpbiI6dHJ1ZX0=";

    onMount(() => {
        registerWebMcpTools(registry);
    });
</script>

<svelte:head>
    <meta http-equiv="origin-trial" content={originTrialToken} />
</svelte:head>

<div class="page">
    <div class="header-pill-shell">
        <header class="header-pill">
            <a class="header-pill-brand" href="/" draggable="false">
                <img class="header-pill-logo" src="/logos/logo_needle_black_no_padding.svg" alt="Needle"
                    draggable="false" />
                <span class="header-pill-brand-label">WebMCP</span>
            </a>
            <nav class="header-pill-nav" aria-label="Main">
                <a class="header-pill-link" href="/#apps" draggable="false">Apps</a>
                <a class="header-pill-link" href="/#try" draggable="false">Try it</a>
                <a class="header-pill-link" href="/registry.json" draggable="false">Registry</a>
            </nav>
            <div class="header-pill-actions">
                <a class="header-pill-button" href="https://github.com/needle-tools/webmcp" target="_blank"
                    rel="noopener" draggable="false">
                    <svg class="button-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"
                        aria-hidden="true">
                        <path
                            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                    GitHub
                </a>
            </div>
        </header>
    </div>

    <main>
        {@render children()}
    </main>

    <footer class="footer-area">
        <div class="footer-area-main">
            <div class="footer-area-brand">
                <img src="/logos/logo_needle_black_no_padding.svg" alt="Needle" />
                <p class="footer-area-summary">
                    Needle builds tools for working with 3D on the web. Our apps describe what they can do to the AI
                    agent in your browser — no install, no server, no API key.
                </p>
            </div>
            <div class="footer-area-column">
                <span class="footer-area-column-title">WebMCP</span>
                <a href="https://github.com/webmachinelearning/webmcp" target="_blank" rel="noopener">Specification</a>
                <a href="https://developer.chrome.com/docs/ai/webmcp" target="_blank" rel="noopener">Chrome guide</a>
                <a href="https://engine.needle.tools/docs/ai/webmcp" target="_blank" rel="noopener">Needle WebMCP docs</a>
            </div>
            <div class="footer-area-column">
                <span class="footer-area-column-title">Needle</span>
                <a href="https://needle.tools" target="_blank" rel="noopener">needle.tools</a>
                <a href="https://cloud.needle.tools" target="_blank" rel="noopener">Needle Cloud</a>
                <a href="https://engine.needle.tools/docs" target="_blank" rel="noopener">Documentation</a>
                <a href="https://discord.needle.tools" target="_blank" rel="noopener">Discord</a>
            </div>
        </div>
        <div class="footer-area-legal">
            <span>Made with <a href="https://needle.tools" target="_blank" rel="noopener">Needle</a> ·
                <a href="https://github.com/needle-tools/webmcp" target="_blank" rel="noopener">Source on GitHub</a> ·
                MIT</span>
        </div>
    </footer>
</div>

<style>
    .page {
        max-width: 72rem;
        margin: 0 auto;
        padding: 0 var(--space-page-padding) var(--space-page-padding);
        display: flex;
        flex-direction: column;
        gap: var(--space-section-gap);
    }

    .footer-area {
        margin-top: 4.5rem;
        border: none;
        border-top: 1px solid var(--border-subtle);
        border-radius: 0;
        background: none;
        padding: 3rem 0 1rem;
        gap: 2.5rem;
    }

    .footer-area-main {
        grid-template-columns: minmax(18rem, 1.6fr) 1fr 1fr;
        gap: 3rem;
    }

    .footer-area-brand {
        max-width: 26rem;
        align-content: start;
    }

    @media (max-width: 980px) {
        .footer-area-main {
            grid-template-columns: 1fr;
        }
    }

    .header-pill-shell {
        position: sticky;
        top: 0;
        z-index: 10;
    }

    :global(body) {
        margin: 0;
        background: var(--surface-page);
        color: var(--text-primary);
        font-family: var(--font-family-body);
        font-size: var(--type-body-size);
        line-height: var(--type-body-line-height);
        -webkit-font-smoothing: antialiased;
    }

    /* Selection, focus and scrollbars follow the Needle Inspector's design
       language: semi-transparent brand green selection, a 2px brand focus
       ring, and thin scrollbars derived from the border colors. */
    :global(::selection) {
        background: color-mix(in srgb, var(--accent-brand) 40%, transparent);
    }

    :global(:focus-visible) {
        outline: 2px solid var(--border-focus);
        outline-offset: 2px;
    }

    :global(html) {
        scrollbar-width: thin;
        scrollbar-color: var(--border-strong) transparent;
    }

    .header-pill {
        padding-left: 1.4rem;
        padding-right: 0.8rem;
    }

    .header-pill-brand {
        text-decoration: none;
    }

    .header-pill-brand-label {
        font-size: 1.1rem;
    }

    .button-icon {
        margin-right: 0.45em;
        flex: none;
    }

    :global(.header-pill-button) {
        transition-property: background, border-color, scale;
        transition-duration: 0.16s;
    }

    :global(.header-pill-button:active) {
        scale: 0.96;
    }
</style>
