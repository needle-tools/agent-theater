<script lang="ts">
    import { onMount } from "svelte";
    import registry from "../../registry.json";
    import { registerWebMcpTools } from "$lib/webmcp";

    let { children } = $props();

    onMount(() => {
        registerWebMcpTools(registry);
    });
</script>

<div class="page">
    <div class="header-pill-shell">
        <header class="header-pill">
            <a class="header-pill-brand" href="/">
                <img class="header-pill-logo" src="/logos/logo_needle_black_no_padding.svg" alt="Needle" />
                <span class="header-pill-brand-label">WebMCP</span>
            </a>
            <nav class="header-pill-nav" aria-label="Main">
                <a class="header-pill-link" href="/#apps">Apps</a>
                <a class="header-pill-link" href="/#try">Try it</a>
                <a class="header-pill-link" href="/registry.json">Registry</a>
            </nav>
            <div class="header-pill-actions">
                <a class="header-pill-button" href="https://github.com/needle-tools/webmcp" target="_blank"
                    rel="noopener">GitHub</a>
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

    :global(.header-pill-button) {
        transition-property: background, border-color, scale;
        transition-duration: 0.16s;
    }

    :global(.header-pill-button:active) {
        scale: 0.96;
    }
</style>
