<script lang="ts">
    import AnimatedCursor from "$lib/collage/AnimatedCursor.svelte";
    import { hint } from "$lib/collage/hint";

    let { children } = $props();

    /**
     * The share card.
     *
     * A crawler cannot run the page, so none of this can be derived from what
     * is on the stage — it is written down once, here, and it describes the
     * app rather than whatever play happens to be loaded.
     */
    const SITE = "https://theater.needle.tools";
    const CARD_TITLE = "Agent Theater — tell an AI agent a story, watch it stage the play";
    const CARD_DESCRIPTION =
        "A paper theatre your browser's AI agent works itself: it casts the parts from a drawer "
        + "of cut-outs, dresses the stage, writes the script beat by beat, gives every character "
        + "a voice, and runs the show while narrating it aloud.";
    const CARD_ALT =
        "A paper-cut-out title card reading Agent Theater, with a king, a robot, a crocodile "
        + "with a megaphone, a bird, a treasure chest and a stage curtain around it.";

    // Chrome ships WebMCP behind an origin trial. This is the needle.tools
    // subdomain-matched token (same one the Mesh Baker ships, expires
    // 2026-11-17) — it only takes effect when the site is served from a
    // *.needle.tools origin. Override with VITE_WEBMCP_ORIGIN_TRIAL_TOKEN.
    const originTrialToken =
        import.meta.env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN ||
        "ArulNF59jmGx6OwxGl6DaZU8g60uiQKkwKLC1ml/1gjTEeNQ1+pB4ujxawuK6rj7RIyCgDOU5YGDT8NxFwDQuAgAAABfeyJvcmlnaW4iOiJodHRwczovL25lZWRsZS50b29sczo0NDMiLCJmZWF0dXJlIjoiV2ViTUNQIiwiZXhwaXJ5IjoxNzk0ODczNjAwLCJpc1N1YmRvbWFpbiI6dHJ1ZX0=";

    // The Needle app directory used to register four tools here —
    // list_needle_webmcp_apps, find_tool_for_task, get_workflow and
    // search_needle_knowledge_base. They are gone from this page.
    //
    // Not because they were broken: because definitions are re-sent on every
    // turn of a conversation, and an agent staging a play reads past "route a
    // 3D-webdev task to the right Needle app" every single message. The
    // registry and registerWebMcpTools are still there for any page that wants
    // them; this one is a theatre.
</script>

<svelte:head>
    <meta http-equiv="origin-trial" content={originTrialToken} />
    <!--
        What a link to this page looks like when somebody pastes it.

        Absolute, because og:image is fetched by a crawler that has no page to
        resolve a relative path against. Set here rather than per route so a
        link to /record or /painted unfurls as the theatre too — the card is
        the show, not the page.
    -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Agent Theater" />
    <meta property="og:url" content={SITE} />
    <meta property="og:title" content={CARD_TITLE} />
    <meta property="og:description" content={CARD_DESCRIPTION} />
    <meta property="og:image" content={`${SITE}/og.webp`} />
    <meta property="og:image:type" content="image/webp" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="800" />
    <meta property="og:image:alt" content={CARD_ALT} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={CARD_TITLE} />
    <meta name="twitter:description" content={CARD_DESCRIPTION} />
    <meta name="twitter:image" content={`${SITE}/og.webp`} />
    <meta name="twitter:image:alt" content={CARD_ALT} />
</svelte:head>

<AnimatedCursor />

<main>
    {@render children()}
</main>

<!-- Source link pinned to the corner, out of the way of the scene. -->
<a class="github-corner" href="https://github.com/needle-tools/agent-theater" target="_blank" rel="noopener"
    aria-label="Source on GitHub" draggable="false" use:hint={"Open the source code on GitHub."}>
    <img src="/toolbar/github.webp" alt="" draggable="false" />
</a>

<style>
    /*
     * A programme, not a control panel.
     *
     * The Needle tokens are built for tools: a cool grey-green paper and a
     * geometric sans, which is right for an inspector and slightly wrong for a
     * theatre. These are the smallest changes that move it — warm the paper
     * toward something you would print on, and set headings in a serif — while
     * leaving the brand's greens, radii, shadows and body face exactly as they
     * are. brand.css is the shared design system and is not edited; this is a
     * page dressing itself, which is what a token is for.
     *
     * The serif is a system stack rather than the brand's --font-family-accent-serif,
     * which ships as an italic-only file: a title card set in it would be
     * italic with no way to be anything else.
     */
    :global(:root) {
        --surface-page: #F5F1E8;
        --surface-page-elevated: #FBF8F2;
        --surface-panel: #FFFDF8;
        --surface-panel-muted: #F6F2E9;
        --surface-panel-strong: #F0EBDF;
        --surface-code: #FBF8F2;
        --border-subtle: #E3DBCC;
        --border-strong: #D3C9B6;
        --font-family-display: Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif;
    }

    /*
     * The dark theme is warmed rather than deepened. It was already dark; the
     * job here is to stop it reading as slate, which is the colour of every
     * developer tool ever made.
     */
    :global(:root[data-theme="dark"]) {
        --surface-page: #16130F;
        --surface-page-elevated: #1B1712;
        --surface-panel: #211C16;
        --surface-panel-muted: #26211A;
        --surface-panel-strong: #2C261E;
        --surface-code: #1B1712;
        --border-subtle: #3A322A;
        --border-strong: #4A4137;
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

    :global(.header-pill-button) {
        transition-property: background, border-color, scale;
        transition-duration: 0.16s;
    }

    :global(.header-pill-button:active) {
        scale: 0.96;
    }

    .github-corner {
        position: fixed;
        right: 12px;
        bottom: 12px;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 52px;
        height: 52px;
        background: transparent;
        border: 0;
        color: var(--text-primary);
        transition-property: scale, opacity;
        transition-duration: 0.16s, 0.4s;
    }

    /* A murmur while a show plays; the theatre posts the state on the root. */
    :global(html.theatre-watching) .github-corner {
        opacity: 0.3;
    }

    :global(html.theatre-watching) .github-corner:hover {
        opacity: 1;
    }

    /* Gone entirely while a billboard holds the screen. */
    :global(html.theatre-card) .github-corner {
        opacity: 0;
        pointer-events: none;
    }

    .github-corner:hover {
        scale: 1.05;
    }

    .github-corner:active {
        scale: 0.96;
    }

    .github-corner img {
        width: 48px;
        height: 48px;
        object-fit: contain;
        pointer-events: none;
    }
</style>
