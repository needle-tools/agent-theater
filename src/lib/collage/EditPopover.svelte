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
    import type { CollageStudio } from "./studio.js";
    import { toolCalls, toolLogFile } from "./toolLog.js";

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
                <button class="strong" disabled={!hasLayers} onclick={onSave}>Save play</button>
                <button class="strong" onclick={onLoad}>Load play</button>
            </div>
            <p class="note">
                One picture keeps the whole play. <kbd>Ctrl S</kbd> to save.
            </p>
        </section>

        <section style:--i="1">
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

        <footer style:--i="2">
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
            <button class="quiet quiet--danger" onclick={onClear}>Clear stage</button>
        </footer>
    </div>
{/if}

<style>
    .panel {
        position: absolute;
        top: 62px;
        right: 16px;
        z-index: 40;
        width: 300px;
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

    .num {
        font-variant-numeric: tabular-nums;
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
