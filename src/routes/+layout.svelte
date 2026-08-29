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

<main>
    {@render children()}
</main>

<!-- Source link pinned to the corner, out of the way of the scene. -->
<a class="github-corner" href="https://github.com/needle-tools/webmcp" target="_blank" rel="noopener"
    aria-label="Source on GitHub" draggable="false">
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
</a>

<style>
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

    :global(.header-pill-button) {
        transition-property: background, border-color, scale;
        transition-duration: 0.16s;
    }

    :global(.header-pill-button:active) {
        scale: 0.96;
    }

    .github-corner {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        border-radius: var(--radius-pill);
        background: var(--surface-panel);
        border: 1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent);
        color: var(--text-primary);
        box-shadow:
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 8px 22px rgba(34, 44, 32, 0.08);
        transition-property: background, border-color, scale;
        transition-duration: 0.16s;
    }

    .github-corner:hover {
        background: var(--surface-panel-muted);
        border-color: var(--border-strong);
    }

    .github-corner:active {
        scale: 0.96;
    }
</style>
