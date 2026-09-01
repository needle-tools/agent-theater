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
    import { FRAME_PRESETS, findPreset, outputSize, presetAspect } from "./model.js";
    import type { LayoutMode } from "./layout.js";
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

    /**
     * The shapes on offer: the common presets, plus whatever is currently set.
     *
     * That last part is what stops the control going blank. An agent can name
     * any of the eleven presets, and a session saved on another build can
     * restore one this picker does not list — either way the answer is to show
     * it, not to pretend nothing is selected.
     */
    const pages = $derived.by(() => {
        const choices = [
            { id: FREE_PAGE, name: "Free", aspect: 1, title: "Free canvas — no fixed size" },
            ...FRAME_PRESETS.filter(p => p.common).map(p => ({
                id: p.id,
                name: p.short ?? p.name,
                aspect: presetAspect(p),
                title: p.name,
            })),
        ];
        if (choices.some(c => c.id === page)) return choices;
        const current = findPreset(page);
        return current
            ? [...choices, {
                id: current.id,
                name: current.short ?? current.name,
                aspect: presetAspect(current),
                title: current.name,
            }]
            : choices;
    });
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
            <!-- Shapes rather than a list of names. "A4 wide" and "Social card"
                 are the same words to anyone who has not memorised them; the
                 proportions are the actual choice being made. -->
            <div class="pages" role="radiogroup" aria-label="Output size">
                {#each pages as choice (choice.id)}
                    <button
                        class="page"
                        class:page--on={page === choice.id}
                        role="radio"
                        aria-checked={page === choice.id}
                        title={choice.title}
                        onclick={() => onSetPage(choice.id)}
                    >
                        <span class="page__frame" class:page__frame--free={choice.id === FREE_PAGE}>
                            <span class="page__shape" style:aspect-ratio={choice.aspect}></span>
                        </span>
                        <span class="page__name">{choice.name}</span>
                    </button>
                {/each}
            </div>
            <!-- Labelled, because "Transparent / White" on its own does not say
                 what it is the background OF. The page on the canvas shows the
                 choice as you make it. -->
            <h3>Behind the pictures</h3>
            <div class="segmented" role="group" aria-label="Page background">
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
            <!-- One button, run again for a different result. The other layouts
                 remain available to an agent through collage_arrange. -->
            <button class="wide" disabled={!hasLayers} onclick={() => onArrange("collage")}>
                Arrange the collage
            </button>
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
        position: absolute;
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

    h3 {
        margin: 10px 0 4px;
        font-size: var(--type-body-muted-size);
        font-weight: 500;
        color: var(--text-secondary);
    }

    h2 {
        margin: 0 0 8px;
        font-size: var(--type-micro-label-size);
        font-weight: var(--type-micro-label-weight);
        letter-spacing: var(--type-micro-label-tracking);
        text-transform: uppercase;
        color: var(--text-muted);
    }

    .pages {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
    }

    .page {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        /* Outer 10 = inner shape's box plus its padding, so a selected tile's
           corners stay concentric with the preview inside it. */
        min-height: 62px;
        padding: 7px 4px 6px;
        border: 1px solid transparent;
        border-radius: 10px;
        background: none;
    }

    /* A fixed box the shape is drawn inside, so a portrait and a landscape
       preview sit on the same baseline instead of jostling the row. */
    .page__frame {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 30px;
    }

    .page__shape {
        max-width: 100%;
        max-height: 100%;
        /* One of the two has to be set for aspect-ratio to have anything to
           work from; max-* then pulls whichever side is too long back in. */
        width: 34px;
        height: 30px;
        border-radius: 2px;
        background: var(--surface-panel-strong);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border-strong) 60%, transparent);
    }

    /* The free canvas has no shape, so it is drawn as the absence of one. */
    .page__frame--free .page__shape {
        background: none;
        box-shadow: none;
        border: 1px dashed color-mix(in srgb, var(--text-muted) 55%, transparent);
        border-radius: 6px;
    }

    .page__name {
        font-size: var(--type-micro-label-size);
        line-height: 1.1;
        color: var(--text-muted);
        white-space: nowrap;
    }

    .page:hover:not(.page--on) {
        background: var(--surface-panel-muted);
    }

    .page--on {
        border-color: color-mix(in srgb, var(--accent-brand) 55%, transparent);
        background: color-mix(in srgb, var(--accent-brand) 10%, transparent);
    }

    .page--on .page__shape {
        background: var(--surface-page-elevated, #fff);
        box-shadow: inset 0 0 0 1px var(--accent-brand);
    }

    .page--on .page__name {
        color: var(--text-primary);
        font-weight: 600;
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

    .wide {
        width: 100%;
    }

    /* Everything except the page tiles, which are their own shape entirely and
       would otherwise inherit a control's padding and hover. */
    button:not(.page) {
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

    button:not(.page):hover:not(:disabled) {
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




    .quiet {
        width: 100%;
        margin-top: 8px;
        border-color: transparent;
        background: none;
        color: var(--text-muted);
    }

    .quiet:hover {
        /* Fallback because --accent-error only exists in brand.css's dark block. */
        color: var(--accent-error, #D93A62);
        background: color-mix(in srgb, var(--accent-error, #D93A62) 8%, transparent);
        border-color: transparent;
    }

    .note, .muted {
        margin: 8px 0 0;
        color: var(--text-muted);
        font-size: var(--type-body-muted-size);
        line-height: var(--type-body-muted-line-height);
        text-wrap: pretty;
    }


    .num {
        font-variant-numeric: tabular-nums;
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
