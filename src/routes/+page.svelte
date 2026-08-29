<script lang="ts">
    import registry from "../../registry.json";
    import NeedleHero from "$lib/NeedleHero.svelte";

    const apps = registry.apps.filter(a => a.id !== "needle-webmcp");
</script>

<svelte:head>
    <title>Needle × WebMCP — tools for 3D web development</title>
    <meta name="description"
        content="A registry of WebMCP tools across Needle web apps. Optimize models, remove backgrounds, inspect live scenes and search the Needle knowledge base — through the AI agent in your browser." />
</svelte:head>

<section class="hero">
    <NeedleHero />
    <div class="hero-copy">
        <h1>Needle × WebMCP</h1>
        <p>
            Needle web apps hand typed tools to the AI agent in your browser. Ask for what you want — the agent calls
            the app's own functions instead of guessing which button to click.
        </p>
        <p class="hero-hint">
            This page registers tools too. If your browser's agent speaks WebMCP, ask it:
            <em>“which Needle apps expose WebMCP tools?”</em>
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
                <span class="tag" class:tag-muted={app.status !== "live"}>
                    {app.status === "live" ? "Live" : "In development"}
                </span>
                <h3><a href={app.url} target="_blank" rel="noopener">{app.name}</a></h3>
                <p>{app.description}</p>
                <details>
                    <summary>{app.tools.length} tool{app.tools.length === 1 ? "" : "s"}</summary>
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
        min-height: min(64vh, 560px);
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    }

    .hero-copy {
        position: relative;
        z-index: 1;
        text-align: center;
        padding: 1.5rem 1.5rem 2.2rem;
        pointer-events: none;
        background: linear-gradient(to bottom, transparent, var(--surface-page-elevated) 85%);
    }

    .hero-copy a,
    .hero-copy em {
        pointer-events: auto;
    }

    .hero-copy h1 {
        margin: 0 0 0.4rem;
        font-family: var(--font-family-display);
        font-size: var(--type-page-title-size);
        font-weight: var(--type-page-title-weight);
        line-height: var(--type-page-title-line-height);
        letter-spacing: var(--type-page-title-tracking);
    }

    .hero-copy p {
        margin: 0.3rem auto;
        max-width: 44rem;
        color: var(--text-secondary);
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
    }

    h2 {
        margin: 1.4rem 0 0.4rem;
        font-size: var(--type-section-title-size);
        font-weight: var(--type-section-title-weight);
        line-height: var(--type-section-title-line-height);
        letter-spacing: var(--type-section-title-tracking);
    }

    .section-intro {
        margin: 0 0 0.6rem;
        color: var(--text-secondary);
    }

    a {
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
        margin-top: 0.8rem;
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
        font-size: 0.93rem;
    }

    .card details {
        font-size: 0.88rem;
    }

    .card summary {
        cursor: pointer;
        color: var(--text-muted);
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
