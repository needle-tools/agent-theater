<script lang="ts">
    /**
     * Keeping a play, and getting it back.
     *
     * That is the whole panel. It used to hold everything a collage editor
     * needed — page sizes, layouts, four kinds of export — and none of that is
     * what somebody comes here for now. A play is hours of casting, blocking
     * and scripting, so the thing worth one click is not losing it.
     *
     * Everything else found a better home. What a picture looks like is in the
     * right-click menu next to the picture; playing and switching scenes is on
     * the bar at the bottom of the stage; the stage's own size is whatever the
     * backdrop is, which is what a set is anyway.
     */
    import { onMount } from "svelte";
    import type { CollageStudio } from "./studio.js";
    import { toolCalls, toolLogFile } from "./toolLog.js";
    import {
        canEditPlay,
        listPublicPlays,
        loadPlayOnline,
        savePlayOnline,
        type PublishedPlay,
    } from "./publishing.js";

    const CURRENT_PLAY = "needle-play/current";

    interface Props {
        studio: CollageStudio;
        open: boolean;
        toolsRegistered: boolean;
        /** Pack the whole play into one openable picture and download it. */
        onSave: () => void;
        /** Ask for a saved play, or pictures, from disk. */
        onLoad: () => void;
        onClear: () => void;
        onClose: () => void;
    }

    let { studio, open, toolsRegistered, onSave, onLoad, onClear, onClose }: Props = $props();

    let version = $state(0);
    $effect(() => studio.collage.onChanged(() => version++));

    let panel: HTMLDivElement | null = $state(null);

    const hasLayers = $derived.by(() => (version, studio.collage.listAll().length > 0));

    /*
     * The log of what the agent did.
     *
     * Counted on every open rather than watched, because the count only has to
     * be right at the moment somebody looks at it — and the log is written by
     * tool calls, which do not go through the document's change signal.
     */
    const calls = $derived.by(() => (open, toolCalls().length));

    let copiedLog = $state(false);
    let current = $state<PublishedPlay | null>(null);
    let publicPlays = $state<PublishedPlay[]>([]);
    let onlineOpen = $state(false);
    let browseOpen = $state(false);
    let playUrl = $state("");
    let onlineBusy = $state(false);
    let onlineMessage = $state("");

    onMount(() => {
        try {
            const saved = localStorage.getItem(CURRENT_PLAY);
            if (saved) current = JSON.parse(saved);
        } catch { /* Publishing remains available without remembered state. */ }
    });

    function remember(play: PublishedPlay) {
        current = play;
        try { localStorage.setItem(CURRENT_PLAY, JSON.stringify(play)); } catch { /* optional */ }
    }

    async function saveOnline(published: boolean) {
        onlineBusy = true;
        onlineMessage = published ? "Publishing…" : "Saving online…";
        try {
            const owned = current && canEditPlay(current.id) ? current.id : undefined;
            const play = await savePlayOnline(studio, { published, id: owned });
            remember(play);
            playUrl = play.url;
            onlineMessage = published ? "Published." : "Saved as an unlisted link.";
        } catch (error) {
            onlineMessage = error instanceof Error ? error.message : "Could not save the play.";
        } finally { onlineBusy = false; }
    }

    async function copyShareUrl() {
        if (!current) return;
        await navigator.clipboard.writeText(current.url);
        onlineMessage = "Share link copied.";
    }

    async function loadFromUrl(value = playUrl) {
        onlineBusy = true;
        onlineMessage = "Opening play…";
        try {
            const { play, layers } = await loadPlayOnline(studio, value);
            playUrl = play.url;
            remember(play);
            onlineMessage = `Opened “${play.title}” (${layers} pieces).`;
        } catch (error) {
            onlineMessage = error instanceof Error ? error.message : "Could not open the play.";
        } finally { onlineBusy = false; }
    }

    async function browse() {
        browseOpen = !browseOpen;
        if (!browseOpen || publicPlays.length) return;
        onlineBusy = true;
        onlineMessage = "Loading public plays…";
        try {
            publicPlays = await listPublicPlays();
            onlineMessage = publicPlays.length ? "" : "No public plays yet.";
        } catch (error) {
            onlineMessage = error instanceof Error ? error.message : "Could not load public plays.";
        } finally { onlineBusy = false; }
    }

    async function copyLog() {
        const file = toolLogFile({
            play: studio.collage.billing.title ?? null,
            scenes: studio.collage.listStages().length,
            pieces: studio.collage.listAll().length,
            soundAllowed: studio.speaker.ready,
        });
        // Copied rather than downloaded: this gets pasted into a conversation
        // with whoever is being asked about it, and a file on disk is two more
        // steps between noticing something and being able to show it.
        await navigator.clipboard.writeText(file);
        copiedLog = true;
        setTimeout(() => (copiedLog = false), 1800);
    }
</script>

<svelte:window
    onpointerdown={event => {
        if (!open || !panel) return;
        const target = event.target as Node;
        if (!panel.contains(target) && !(target as HTMLElement).closest?.("[data-edit-trigger]")) onClose();
    }}
    onkeydown={event => { if (open && event.key === "Escape") onClose(); }}
/>

{#if open}
    <div class="panel" bind:this={panel} role="dialog" aria-label="The play">
        <section style:--i="0">
            <div class="grid">
                <button class="strong icon-button" disabled={!hasLayers} onclick={onSave}>
                    <img src="/toolbar/save.webp" alt="" /><span>Download file</span>
                </button>
                <button class="strong icon-button" onclick={onLoad}>
                    <img src="/toolbar/load.webp" alt="" /><span>Open file</span>
                </button>
            </div>
            <p class="note">
                One picture keeps the whole play. <kbd>Ctrl S</kbd> to save.
            </p>
        </section>

        <section style:--i="1">
            <button class="disclosure" aria-expanded={onlineOpen} onclick={() => (onlineOpen = !onlineOpen)}>
                <span class="icon-label"><img src="/toolbar/share.webp" alt="" />Share online</span>
                <span aria-hidden="true">{onlineOpen ? "−" : "+"}</span>
            </button>
            {#if onlineOpen}
                <div class="online">
                    <div class="grid">
                        <button disabled={!hasLayers || onlineBusy} onclick={() => saveOnline(false)}>
                            {current && canEditPlay(current.id) ? "Update link" : "Save link"}
                        </button>
                        <button class="publish icon-button" disabled={!hasLayers || onlineBusy} onclick={() => saveOnline(true)}>
                            <img src="/toolbar/publish.webp" alt="" />
                            <span>{current?.visibility === "public" && canEditPlay(current.id) ? "Update public" : "Publish"}</span>
                        </button>
                    </div>

                    {#if current}
                        <div class="share-row">
                            <a href={current.url} target="_blank" rel="noopener">{current.title}</a>
                            <button class="compact" onclick={copyShareUrl}>Copy link</button>
                        </div>
                        {#if canEditPlay(current.id)}
                            <button class="manage" disabled={onlineBusy} onclick={() => saveOnline(current?.visibility !== "public")}>
                                Make {current.visibility === "public" ? "unlisted" : "public"}
                            </button>
                        {/if}
                    {/if}

                    <form class="url-row" onsubmit={event => { event.preventDefault(); void loadFromUrl(); }}>
                        <input bind:value={playUrl} aria-label="Play URL or id" placeholder="Paste play link or id" />
                        <button class="compact" disabled={!playUrl.trim() || onlineBusy}>Open</button>
                    </form>

                    <button class="browse" disabled={onlineBusy} onclick={browse}>
                        {browseOpen ? "Hide public plays" : "Browse public plays"}
                    </button>
                    {#if browseOpen && publicPlays.length}
                        <ul class="plays">
                            {#each publicPlays as play}
                                <li>
                                    <button disabled={onlineBusy} onclick={() => loadFromUrl(play.id)}>{play.title}</button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                    {#if onlineMessage}<p class="online-message" aria-live="polite">{onlineMessage}</p>{/if}
                </div>
            {/if}
        </section>

        <section style:--i="2">
            <h2>Motion clips</h2>
            <!-- The recorder moved to its own page: recording on the working
                 canvas fought selection, panning and the eraser for the same
                 drag, and eventually lost. A room of its own wins. -->
            <a class="record-link" href="/record">
                <span>Record movements</span>
                <span aria-hidden="true">→</span>
            </a>
            <p class="note">
                Reuse recorded gestures with <code>clip:name</code>.
            </p>
        </section>

        <footer style:--i="3">
            <p class="status" class:status--ready={toolsRegistered}>
                <span class="status__dot" aria-hidden="true"></span>
                {toolsRegistered ? "Agent tools ready" : "Agent tools unavailable"}
            </p>
            <!-- A debug affordance, and deliberately a plain one. The failures
                 worth reporting here are not crashes: they are an agent calling
                 the right tool with plausible arguments and getting a plausible
                 answer that is wrong, which leaves no trace anybody can hand
                 over afterwards. This is that trace. -->
            {#if calls}
                <button class="quiet" onclick={copyLog}>
                    {copiedLog ? "Copied" : `Copy agent log (${calls})`}
                </button>
            {/if}
            <button class="quiet quiet--danger icon-button" onclick={onClear}>
                <img src="/toolbar/clear-stage.webp" alt="" /><span>Clear stage</span>
            </button>
        </footer>
    </div>
{/if}

<style>
    .panel {
        position: absolute;
        top: 62px;
        right: 16px;
        z-index: 40;
        width: 320px;
        max-height: calc(100dvh - 82px);
        overflow-y: auto;
        /* Outer 18 = inner 12 + 6 padding, so the corners stay concentric with
           the controls sitting against them. */
        border-radius: 18px;
        padding: 6px;
        background: var(--surface-panel);
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--border-subtle) 60%, transparent),
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 12px 28px rgba(34, 44, 32, 0.10),
            0 32px 64px rgba(34, 44, 32, 0.10);
        animation: panel-in 0.18s cubic-bezier(0.2, 0, 0, 1);
    }

    @keyframes panel-in {
        from { opacity: 0; scale: 0.98; translate: 0 -6px; }
        to { opacity: 1; scale: 1; translate: 0 0; }
    }

    /* Split and stagger: the panel arrives, then its contents settle. */
    section, footer {
        padding: 10px 12px;
        animation: section-in 0.26s cubic-bezier(0.2, 0, 0, 1) backwards;
        animation-delay: calc(60ms + var(--i) * 40ms);
    }

    @keyframes section-in {
        from { opacity: 0; translate: 0 4px; }
        to { opacity: 1; translate: 0 0; }
    }

    @media (prefers-reduced-motion: reduce) {
        .panel, section, footer { animation: none; }
    }

    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
    }

    button {
        min-height: 38px;
        padding: 0 11px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
        background: var(--surface-page-elevated, #fff);
        color: var(--text-primary);
        font: inherit;
        font-size: var(--type-body-muted-size);
        cursor: var(--cursor-pointer, pointer);
        transition-property: background, border-color, color, scale;
        transition-duration: 0.14s;
    }

    button:hover:not(:disabled) {
        border-color: var(--border-strong);
        background: var(--surface-panel-muted);
    }

    button:active:not(:disabled) {
        scale: 0.96;
    }

    button:disabled {
        opacity: 0.4;
        cursor: var(--cursor-forbidden, not-allowed);
    }

    .strong {
        font-weight: 600;
    }

    .icon-button, .icon-label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
    }

    .icon-button img, .icon-label img {
        width: 24px;
        height: 24px;
        flex: 0 0 auto;
        object-fit: contain;
        pointer-events: none;
    }

    .icon-label {
        justify-content: flex-start;
    }

    .disclosure .icon-label img {
        width: 26px;
        height: 26px;
    }

    .disclosure, .browse, .manage {
        width: 100%;
    }

    .disclosure {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 40px;
        border-color: transparent;
        background: transparent;
        font-weight: 700;
        text-align: left;
    }

    .online {
        display: grid;
        gap: 8px;
        padding-top: 8px;
    }

    .publish {
        border-color: color-mix(in srgb, var(--accent-brand) 55%, var(--border-subtle));
        background: color-mix(in srgb, var(--accent-brand) 16%, var(--surface-page-elevated, #fff));
    }

    .share-row, .url-row {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .share-row {
        min-width: 0;
        padding: 7px 8px 7px 11px;
        border-radius: 12px;
        background: var(--surface-panel-muted);
    }

    .share-row a {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        color: var(--text-primary);
        font-size: var(--type-body-muted-size);
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    input {
        flex: 1;
        min-width: 0;
        height: 40px;
        padding: 0 10px;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
        border-radius: 12px;
        background: var(--surface-page-elevated, #fff);
        color: var(--text-primary);
        font: inherit;
        font-size: var(--type-body-muted-size);
    }

    .compact {
        flex: 0 0 auto;
        min-height: 40px;
        padding-inline: 10px;
    }

    .manage, .browse {
        border-color: transparent;
        background: transparent;
        color: var(--text-muted);
    }

    .plays {
        display: grid;
        gap: 4px;
        max-height: 180px;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        list-style: none;
    }

    .plays button {
        width: 100%;
        overflow: hidden;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .online-message {
        margin: 0;
        color: var(--text-muted);
        font-size: var(--type-micro-label-size);
        line-height: 1.35;
        text-wrap: pretty;
    }

    h2 {
        margin: 0 0 8px;
        font-size: var(--type-body-size);
        line-height: 1.25;
        text-wrap: balance;
    }

    .quiet {
        width: 100%;
        margin-top: 4px;
        min-height: 40px;
        border-color: transparent;
        background: none;
        color: var(--text-muted);
    }

    .quiet--danger:hover {
        /* Fallback because --accent-error only exists in brand.css's dark block. */
        color: var(--accent-error, #D93A62);
        background: color-mix(in srgb, var(--accent-error, #D93A62) 8%, transparent);
        border-color: transparent;
    }

    .note {
        margin: 8px 0 0;
        color: var(--text-muted);
        font-size: var(--type-body-muted-size);
        line-height: var(--type-body-muted-line-height);
        text-wrap: pretty;
    }

    kbd, code {
        padding: 1px 5px;
        border-radius: 5px;
        background: var(--surface-panel-muted);
        color: var(--text-primary);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 0.88em;
        white-space: nowrap;
    }

    footer {
        border-top: 1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent);
    }

    .record-link {
        min-height: 40px;
        padding: 0 12px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
        background: var(--surface-page-elevated, #fff);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-weight: 600;
        font-size: var(--type-body-muted-size);
        text-decoration: none;
        transition-property: background, border-color, scale;
        transition-duration: 0.14s;
    }

    .record-link:hover {
        border-color: var(--border-strong);
        background: var(--surface-panel-muted);
    }

    .record-link:active {
        scale: 0.96;
    }

    .status {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 4px;
        color: var(--text-muted);
        font-size: var(--type-body-muted-size);
    }

    .status__dot {
        width: 7px;
        height: 7px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: var(--text-muted);
        opacity: 0.55;
    }

    .status--ready .status__dot {
        background: #6f8c3a;
        opacity: 1;
    }
</style>
