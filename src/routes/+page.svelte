<script lang="ts">
    import { onMount } from "svelte";
    import registry from "../../registry.json";
    import NeedleHero from "$lib/NeedleHero.svelte";

    const apps = registry.apps.filter(a => a.id !== "needle-webmcp");

    // Deep link into ChatGPT with a prompt pointing at this page — in a
    // WebMCP-capable browser the agent lands here with the tools available.
    let chatgptUrl = $state("https://chatgpt.com/");
    onMount(() => {
        const prompt =
            `Open ${location.origin} — the page exposes WebMCP tools. ` +
            `List the Needle apps you can operate through WebMCP for 3D web development, ` +
            `and suggest what we should try first.`;
        chatgptUrl = "https://chatgpt.com/?q=" + encodeURIComponent(prompt);
    });

    // Lucide-style stroke icons, one per registry app.
    const icons: Record<string, string> = {
        "needle-docs":
            '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
        "mesh-baker":
            '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
        "fastcut":
            '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/>',
        "needle-inspector":
            '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        "needle-cloud":
            '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    };
</script>

<svelte:head>
    <title>Needle × WebMCP — tools for 3D web development</title>
    <meta name="description"
        content="A registry of WebMCP tools across Needle web apps. Optimize models, remove backgrounds, inspect live scenes and search the Needle knowledge base — through the AI agent in your browser." />
</svelte:head>

<section class="hero">
    <NeedleHero />
    <div class="hero-copy">
        <h1>Needle <span class="hero-times">×</span> <span class="hero-grad">WebMCP</span></h1>
        <p>
            Needle web apps hand typed tools to the AI agent in your browser. Ask for what you want — the agent calls
            the app's own functions instead of guessing which button to click.
        </p>
        <div class="hero-actions">
            <a class="header-pill-button header-pill-button-primary" href={chatgptUrl} target="_blank" rel="noopener">
                Try it with ChatGPT
            </a>
            <a class="header-pill-button" href="#apps">See the apps</a>
        </div>
        <p class="hero-hint">
            This page registers tools too — even the scene above is one. If your browser's agent speaks WebMCP, ask it:
            <em>“rearrange the shapes into a grid and make them pink”</em>
        </p>
    </div>
</section>

<section id="apps">
    <h2>The apps</h2>
    <p class="section-intro">
        Every entry registers its tools with <code>document.modelContext</code> — the
        <a href="https://github.com/webmachinelearning/webmcp" target="_blank" rel="noopener">WebMCP</a> browser API.
        Machine-readable version: <a href="/registry.json">registry.json</a>.
    </p>
    <div class="cards">
        {#each apps as app}
            <article class="card">
                <div class="card-head">
                    <span class="card-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            {@html icons[app.id] ?? ""}
                        </svg>
                    </span>
                    <span class="tag" class:tag-muted={app.status !== "live"}>
                        {app.status === "live" ? "Live" : "In development"}
                    </span>
                </div>
                <h3><a href={app.url} target="_blank" rel="noopener">{app.name}</a></h3>
                <p>{app.tagline ?? app.description}</p>
                <details>
                    <summary>{app.tools.some(t => t.name === "…")
                        ? `${app.tools.length - 1}+ tools (dynamic)`
                        : `${app.tools.length} tool${app.tools.length === 1 ? "" : "s"}`}</summary>
                    <ul>
                        {#each app.tools as tool}
                            <li><code>{tool.name}</code> — {tool.description}</li>
                        {/each}
                    </ul>
                </details>
            </article>
        {/each}
    </div>
</section>

<section id="try">
    <h2>Trying it</h2>
    <p class="section-intro">
        Two pieces have to line up: a browser that implements WebMCP, and an agent that calls the tools it finds.
    </p>
    <ul class="support-list">
        <li><strong>ChatGPT Atlas</strong> — native, no flag.</li>
        <li><strong>Microsoft Edge 147+</strong> — native.</li>
        <li>
            <strong>Chrome 149+</strong> — origin trial; Needle apps ship a trial token, so they just work. For your own
            pages, enable <code>chrome://flags/#enable-webmcp-testing</code>.
        </li>
        <li><strong>Firefox, Safari</strong> — not yet implemented.</li>
    </ul>
    <p>
        <a href="https://developer.chrome.com/docs/ai/webmcp" target="_blank" rel="noopener">Chrome's WebMCP guide</a>
        tracks the current state. Not in a browser? The Needle knowledge base is also a public HTTP API:
        <a href="https://search.needle.tools/api-docs" target="_blank" rel="noopener">search.needle.tools/api-docs</a>.
    </p>
</section>

<style>
    .hero {
        position: relative;
        border-radius: var(--radius-panel);
        overflow: hidden;
        background: var(--surface-page-elevated);
        border: 1px solid var(--border-subtle);
        box-shadow: var(--shadow-panel);
        min-height: min(76vh, 680px);
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
        padding: 2rem 1.5rem;
        pointer-events: none;
        background: radial-gradient(ellipse 62% 48% at center,
                color-mix(in srgb, var(--surface-page-elevated) 92%, transparent) 0%,
                color-mix(in srgb, var(--surface-page-elevated) 55%, transparent) 55%,
                transparent 78%);
    }

    /* The overlay itself passes drags through to the 3D scene, but the text
       must receive pointer events or it can't be selected. */
    .hero-copy h1,
    .hero-copy p,
    .hero-copy a,
    .hero-copy em {
        pointer-events: auto;
    }

    .hero-copy h1 {
        margin: 0 0 0.7rem;
        font-family: var(--font-family-display);
        font-size: var(--type-display-size);
        font-weight: var(--type-display-weight);
        line-height: var(--type-display-line-height);
        letter-spacing: var(--type-display-tracking);
        text-wrap: balance;
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
        margin: 0.3rem auto;
        max-width: 40rem;
        color: var(--text-secondary);
        text-wrap: pretty;
    }

    .hero-actions {
        display: flex;
        gap: 0.7rem;
        margin: 1.2rem 0 0.6rem;
        pointer-events: auto;
        flex-wrap: wrap;
        justify-content: center;
    }

    .hero-hint {
        font-size: 0.95rem;
        color: var(--text-muted);
    }

    .hero-hint em {
        font-family: var(--font-family-accent-serif);
        font-style: italic;
    }

    section {
        scroll-margin-top: var(--space-scroll-margin-top);
        margin-top: 4.5rem;
    }

    h2 {
        margin: 0 0 0.6rem;
        font-size: var(--type-page-title-size);
        font-weight: var(--type-page-title-weight);
        line-height: var(--type-page-title-line-height);
        letter-spacing: var(--type-page-title-tracking);
        text-wrap: balance;
    }

    /* Prose stays at a readable measure; only the card grid uses the full page width. */
    .section-intro,
    .support-list,
    section > p {
        max-width: 46rem;
    }

    .section-intro {
        margin: 0 0 0.6rem;
        color: var(--text-secondary);
        text-wrap: pretty;
    }

    p a,
    li a {
        color: var(--text-link);
    }

    code {
        font-family: var(--font-family-code);
        font-size: 0.85em;
        background: var(--surface-code);
        border: 1px solid var(--border-subtle);
        border-radius: 6px;
        padding: 0.08em 0.35em;
    }

    .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
        gap: var(--space-cluster-gap);
        margin-top: 1.6rem;
    }

    .card {
        background: var(--surface-panel);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-subtle);
        padding: var(--space-panel-padding);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        transition-property: box-shadow, translate;
        transition-duration: 0.18s;
        transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }

    .card:hover {
        box-shadow: var(--shadow-panel);
        translate: 0 -2px;
    }

    .card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .card-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 10px;
        color: var(--accent-brand-deep);
        background: var(--surface-panel-muted);
        border: 1px solid var(--border-subtle);
    }

    .card .tag {
        align-self: flex-start;
        font-size: var(--type-micro-label-size);
        font-weight: var(--type-micro-label-weight);
        letter-spacing: var(--type-micro-label-tracking);
        text-transform: uppercase;
        color: var(--text-success);
        background: var(--surface-callout-success);
        border-radius: var(--radius-pill);
        padding: 0.15rem 0.6rem;
    }

    .card .tag-muted {
        color: var(--text-muted);
        background: var(--surface-panel-muted);
    }

    .card h3 {
        margin: 0;
        font-size: var(--type-panel-title-size);
        font-weight: var(--type-panel-title-weight);
    }

    .card h3 a {
        color: var(--text-primary);
        text-decoration: none;
    }

    .card h3 a:hover {
        color: var(--accent-brand-deep);
    }

    .card > p {
        margin: 0;
        flex: 1;
        color: var(--text-secondary);
        font-size: var(--type-body-size);
    }

    .card details {
        font-size: 0.88rem;
        border-radius: 8px;
        padding: 0 0.5rem;
    }

    /* Open state borrows the Inspector's selection language:
       tinted background + subtle brand ring. */
    .card details[open] {
        background: color-mix(in srgb, var(--accent-brand) 7%, transparent);
        outline: 1px solid color-mix(in srgb, var(--accent-brand) 40%, var(--border-subtle));
        padding-bottom: 0.5rem;
    }

    .card summary {
        cursor: pointer;
        color: var(--text-muted);
        padding: 0.4rem 0;
        transition-property: color;
        transition-duration: 0.12s;
    }

    .card summary:hover {
        color: var(--text-primary);
    }

    .card details ul {
        margin: 0.5rem 0 0;
        padding-left: 1.1rem;
        color: var(--text-secondary);
    }

    .support-list {
        margin: 0.4rem 0;
        padding-left: 1.2rem;
        color: var(--text-secondary);
    }

    .support-list li {
        margin: 0.25rem 0;
    }
</style>
