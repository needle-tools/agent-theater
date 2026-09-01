<script lang="ts">
    /**
     * Everything the sidebar used to be, folded into one corner button.
     *
     * A collage page should be mostly collage. These are the things that are
     * genuinely global — what am I making, how should it be laid out, how do I
     * get it out — so they live one click away rather than taking a permanent
     * column. Anything that acts on a single picture belongs in the right-click
     * menu, next to the picture.
     */
    import { FRAME_PRESETS, outputSize } from "./model.js";
    import { LAYOUT_MODES, type LayoutMode } from "./layout.js";
    import { checkFrame } from "./quality.js";
    import { FREE_PAGE, type CollageStudio } from "./studio.js";

    interface Props {
        studio: CollageStudio;
        open: boolean;
        toolsRegistered: boolean;
        onSetPage: (presetId: string) => void;
        onSetBackground: (background: string) => void;
        onArrange: (mode: LayoutMode) => void;
        onExport: (format: "png" | "print" | "html" | "embed") => void;
        onClear: () => void;
        onClose: () => void;
    }

    let { studio, open, toolsRegistered, onSetPage, onSetBackground, onArrange, onExport, onClear, onClose }: Props = $props();

    let version = $state(0);
    $effect(() => studio.collage.onChanged(() => version++));

    let panel: HTMLDivElement | null = $state(null);

    const frames = $derived.by(() => (version, studio.collage.listFrames()));
    const activeFrame = $derived(frames[0] ?? null);
    const page = $derived.by(() => (version, studio.pagePreset));
    const hasLayers = $derived.by(() => (version, studio.collage.list().length > 0));
    const quality = $derived.by(() =>
        (version, activeFrame ? checkFrame(studio.collage.layersIn(activeFrame.id), activeFrame) : null));
    const size = $derived(activeFrame ? outputSize(activeFrame) : null);
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
    <div class="panel" bind:this={panel} role="dialog" aria-label="Collage options">
        <section style:--i="0">
            <h2>Making</h2>
            <select value={page} aria-label="Output size" onchange={e => onSetPage((e.currentTarget as HTMLSelectElement).value)}>
                <option value={FREE_PAGE}>Free canvas — no fixed size</option>
                {#each FRAME_PRESETS as preset (preset.id)}
                    <option value={preset.id}>{preset.name}</option>
                {/each}
            </select>
            <div class="segmented" role="group" aria-label="Background">
                <button
                    class:on={activeFrame?.background === "transparent"}
                    onclick={() => onSetBackground("transparent")}
                >Transparent</button>
                <button
                    class:on={activeFrame?.background !== "transparent"}
                    onclick={() => onSetBackground("#FFFFFF")}
                >White</button>
            </div>
            {#if size}
                <p class="note">
                    Exports at <span class="num">{size.width}×{size.height}</span>px{activeFrame?.physical
                        ? ` — ${activeFrame.physical.width}×${activeFrame.physical.height}mm at 300 dpi`
                        : ""}.
                    {#if page === FREE_PAGE}The outline follows whatever you put on the canvas.{/if}
                </p>
            {/if}
        </section>

        <section style:--i="1">
            <h2>Arrange</h2>
            <div class="chips">
                {#each LAYOUT_MODES as mode (mode)}
                    <button class="chip" disabled={!hasLayers} onclick={() => onArrange(mode)}>{mode}</button>
                {/each}
            </div>
        </section>

        <section style:--i="2">
            <h2>Export</h2>
            <div class="grid">
                <button disabled={!hasLayers} onclick={() => onExport("png")}>PNG</button>
                <button disabled={!hasLayers} onclick={() => onExport("print")}>Print / PDF</button>
                <button disabled={!hasLayers} onclick={() => onExport("html")}>Copy HTML</button>
                <button disabled={!hasLayers} onclick={() => onExport("embed")}>Embed page</button>
            </div>
            {#if quality?.summary}
                <p class="warn">{quality.summary}</p>
            {/if}
        </section>

        <footer style:--i="3">
            <p class="muted">
                {toolsRegistered
                    ? "WebMCP tools are registered — an agent in this tab can build this with you, and can watch what you do."
                    : "WebMCP is off in this browser. The editor works regardless."}
            </p>
            <button class="quiet" onclick={onClear}>Clear the canvas</button>
        </footer>
    </div>
{/if}

<style>
    .panel {
        position: fixed;
        top: 62px;
        right: 16px;
        z-index: 40;
        width: 300px;
        max-height: calc(100svh - 88px);
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
        padding: 10px;
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

    h2 {
        margin: 0 0 8px;
        font-size: var(--type-micro-label-size);
        font-weight: var(--type-micro-label-weight);
        letter-spacing: var(--type-micro-label-tracking);
        text-transform: uppercase;
        color: var(--text-muted);
    }

    select {
        width: 100%;
    }

    /* One track, two segments — the standard shape for a binary choice, and it
       shows the current state without needing a label to explain it. */
    .segmented {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2px;
        margin-top: 6px;
        /* Outer 12 = inner 10 + 2 padding. */
        padding: 2px;
        border-radius: 12px;
        background: var(--surface-panel-strong);
    }

    .segmented button {
        min-height: 28px;
        padding: 0 8px;
        border: 1px solid transparent;
        border-radius: 10px;
        background: none;
        color: var(--text-muted);
        font-size: var(--type-micro-label-size);
    }

    .segmented button:hover:not(.on) {
        background: color-mix(in srgb, var(--surface-panel) 60%, transparent);
        border-color: transparent;
    }

    .segmented button.on {
        background: var(--surface-panel);
        border-color: color-mix(in srgb, var(--border-subtle) 70%, transparent);
        color: var(--text-primary);
        font-weight: 600;
    }

    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }

    select, button {
        min-height: 34px;
        padding: 0 11px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
        background: var(--surface-page-elevated, #fff);
        color: var(--text-primary);
        font: inherit;
        font-size: var(--type-body-muted-size);
        cursor: pointer;
        transition-property: background, border-color, color, scale;
        transition-duration: 0.14s;
    }

    button:hover:not(:disabled), select:hover {
        border-color: var(--border-strong);
        background: var(--surface-panel-muted);
    }

    button:active:not(:disabled) {
        scale: 0.96;
    }

    button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .primary {
        border-color: transparent;
        background: var(--accent-brand);
        color: var(--text-inverse, #14200f);
        font-weight: 600;
    }

    .primary:hover:not(:disabled) {
        background: var(--accent-brand-deep, var(--accent-brand));
        border-color: transparent;
    }

    .chip {
        min-height: 30px;
        padding: 0 10px;
        border-radius: 999px;
    }

    .quiet {
        width: 100%;
        margin-top: 8px;
        border-color: transparent;
        background: none;
        color: var(--text-muted);
    }

    .quiet:hover {
        color: var(--accent-error);
        background: color-mix(in srgb, var(--accent-error) 8%, transparent);
        border-color: transparent;
    }

    .note, .muted, .status {
        margin: 8px 0 0;
        color: var(--text-muted);
        font-size: var(--type-body-muted-size);
        line-height: var(--type-body-muted-line-height);
        text-wrap: pretty;
    }

    .note strong {
        color: var(--text-secondary);
        font-weight: 600;
    }

    .num {
        font-variant-numeric: tabular-nums;
    }

    .status {
        color: var(--text-secondary);
    }

    .warn {
        margin: 8px 0 0;
        padding: 8px 10px;
        /* 12 inner radius matches the buttons above it. */
        border-radius: 12px;
        background: color-mix(in srgb, var(--accent-highlight) 20%, transparent);
        color: var(--text-primary);
        font-size: var(--type-body-muted-size);
        line-height: var(--type-body-muted-line-height);
        text-wrap: pretty;
    }

    footer {
        border-top: 1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent);
    }
</style>
