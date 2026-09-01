<script lang="ts">
    /**
     * The infinite canvas.
     *
     * Layers are DOM, not a `<canvas>`, and that is deliberate: the editor then
     * uses the same mechanism as the HTML export — percentages become pixels,
     * the alpha filters are the same filters — so "what you arranged" and "what
     * you exported" cannot quietly diverge. Panning and zooming is one CSS
     * transform on the world, which the compositor handles for free.
     *
     * The canvas has no bounds. Frames are the only rectangles that mean
     * anything, and they are drawn behind everything as pieces of paper laid on
     * a table.
     */
    import { alphaFilters, cssColor, pxUnit, textCss } from "./css.js";
    import { bounds, type Frame, type ImageLayer, type Layer, type TextLayer } from "./model.js";
    import type { CollageStudio } from "./studio.js";

    interface Props {
        studio: CollageStudio;
        selectedId?: string | null;
    }

    let { studio, selectedId = $bindable(null) }: Props = $props();

    /** The document is a plain class; this is the bridge to Svelte's reactivity. */
    let version = $state(0);
    $effect(() => studio.collage.onChanged(() => version++));

    const layers = $derived.by(() => (version, studio.collage.list()));
    const frames = $derived.by(() => (version, studio.collage.listFrames()));

    let view = $state({ x: 0, y: 0, zoom: 0.55 });
    let viewport: HTMLDivElement | null = $state(null);

    type Drag =
        | { mode: "pan"; startX: number; startY: number; originX: number; originY: number }
        | { mode: "move"; id: string; startX: number; startY: number; originX: number; originY: number }
        | { mode: "resize"; id: string; startX: number; originWidth: number }
        | { mode: "frame"; id: string; startX: number; startY: number; originX: number; originY: number };

    let drag: Drag | null = null;

    /** Fit the view to everything, or to the frames when there is nothing else. */
    export function fitAll() {
        if (!viewport) return;
        const rects = [
            ...frames.map(f => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
            ...layers.map(bounds),
        ];
        if (!rects.length) {
            view = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2, zoom: 0.55 };
            return;
        }
        const minX = Math.min(...rects.map(r => r.x));
        const minY = Math.min(...rects.map(r => r.y));
        const maxX = Math.max(...rects.map(r => r.x + r.width));
        const maxY = Math.max(...rects.map(r => r.y + r.height));
        const margin = 64;
        const zoom = Math.min(
            (viewport.clientWidth - margin * 2) / Math.max(1, maxX - minX),
            (viewport.clientHeight - margin * 2) / Math.max(1, maxY - minY),
            1.5);
        view = {
            zoom,
            x: viewport.clientWidth / 2 - ((minX + maxX) / 2) * zoom,
            y: viewport.clientHeight / 2 - ((minY + maxY) / 2) * zoom,
        };
    }

    $effect(() => {
        // First layout only — refitting on every change would yank the view out
        // from under someone who has just panned somewhere on purpose.
        if (viewport && !view.x && !view.y) fitAll();
    });

    function onWheel(event: WheelEvent) {
        event.preventDefault();
        const rect = viewport!.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        // Zoom about the cursor: the canvas point under it must not move.
        const factor = Math.exp(-event.deltaY * 0.0015);
        const zoom = Math.min(4, Math.max(0.05, view.zoom * factor));
        const scale = zoom / view.zoom;
        view = {
            zoom,
            x: pointerX - (pointerX - view.x) * scale,
            y: pointerY - (pointerY - view.y) * scale,
        };
    }

    function onPointerDown(event: PointerEvent) {
        if (event.button !== 0 && event.button !== 1) return;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        const target = event.target as HTMLElement;
        const layerId = target.closest<HTMLElement>("[data-layer]")?.dataset.layer;
        const frameId = target.closest<HTMLElement>("[data-frame-handle]")?.dataset.frameHandle;
        const resizing = !!target.closest("[data-resize]");

        if (resizing && selectedId) {
            const layer = studio.collage.get(selectedId);
            if (layer) drag = { mode: "resize", id: selectedId, startX: event.clientX, originWidth: layer.width };
            return;
        }
        if (layerId && event.button === 0) {
            const layer = studio.collage.get(layerId);
            if (!layer) return;
            selectedId = layerId;
            drag = { mode: "move", id: layerId, startX: event.clientX, startY: event.clientY, originX: layer.x, originY: layer.y };
            return;
        }
        if (frameId && event.button === 0) {
            const frame = studio.collage.getFrame(frameId);
            if (!frame) return;
            drag = { mode: "frame", id: frameId, startX: event.clientX, startY: event.clientY, originX: frame.x, originY: frame.y };
            return;
        }
        selectedId = null;
        drag = { mode: "pan", startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
    }

    function onPointerMove(event: PointerEvent) {
        if (!drag) return;
        // Screen pixels to canvas units — otherwise dragging while zoomed out
        // moves things much further than the pointer went.
        const dx = (event.clientX - (drag as any).startX) / view.zoom;
        const dy = (event.clientY - (drag as any).startY) / view.zoom;

        if (drag.mode === "pan") {
            view = { ...view, x: drag.originX + (event.clientX - drag.startX), y: drag.originY + (event.clientY - drag.startY) };
        } else if (drag.mode === "move") {
            studio.collage.update(drag.id, { x: drag.originX + dx, y: drag.originY + dy });
        } else if (drag.mode === "frame") {
            studio.collage.updateFrame(drag.id, { x: drag.originX + dx, y: drag.originY + dy });
        } else if (drag.mode === "resize") {
            studio.collage.update(drag.id, { width: Math.max(20, drag.originWidth + dx) });
        }
    }

    function onPointerUp(event: PointerEvent) {
        drag = null;
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    }

    function onKeyDown(event: KeyboardEvent) {
        if (!selectedId) return;
        const target = event.target as HTMLElement;
        if (target.matches("input, textarea")) return;
        if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            studio.collage.remove(selectedId);
            selectedId = null;
        }
        const step = event.shiftKey ? 20 : 2;
        const nudge: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
        };
        if (nudge[event.key]) {
            event.preventDefault();
            const layer = studio.collage.get(selectedId);
            if (layer) studio.collage.update(selectedId, { x: layer.x + nudge[event.key][0], y: layer.y + nudge[event.key][1] });
        }
    }

    function imageStyle(layer: ImageLayer): string {
        const filters = alphaFilters(layer.style, pxUnit);
        return [
            `left: ${layer.x}px`,
            `top: ${layer.y}px`,
            `width: ${layer.width}px`,
            `height: ${layer.height}px`,
            `transform: rotate(${layer.rotation}deg)`,
            `z-index: ${layer.z}`,
            filters ? `filter: ${filters}` : "",
            layer.style.opacity !== 1 ? `opacity: ${layer.style.opacity}` : "",
        ].filter(Boolean).join("; ");
    }

    /**
     * The inner element, offset so only the cropped region shows.
     *
     * A silhouette is drawn as a masked, empty element rather than as a
     * background on the image: a background paints *behind* an image's pixels,
     * so the photo would simply cover the colour. Same reason the HTML export
     * emits a <span> in that case.
     */
    function croppedStyle(layer: ImageLayer): string {
        const w = Math.max(0.0001, layer.crop.width);
        const h = Math.max(0.0001, layer.crop.height);
        const base = [
            `width: ${(100 / w).toFixed(3)}%`,
            `height: ${(100 / h).toFixed(3)}%`,
            `left: ${(-layer.crop.x / w * 100).toFixed(3)}%`,
            `top: ${(-layer.crop.y / h * 100).toFixed(3)}%`,
        ];
        if (layer.style.silhouette) {
            const url = `url("${layer.src}")`;
            base.push(
                `background: ${cssColor(layer.style.silhouette)}`,
                `-webkit-mask-image: ${url}`,
                `mask-image: ${url}`,
                `-webkit-mask-size: 100% 100%`,
                `mask-size: 100% 100%`);
        }
        return base.join("; ");
    }

    function textStyle(layer: TextLayer): string {
        return [
            `left: ${layer.x}px`,
            `top: ${layer.y}px`,
            `width: ${layer.width}px`,
            `font-size: ${layer.fontSize}px`,
            `transform: rotate(${layer.rotation}deg)`,
            `z-index: ${layer.z}`,
            ...textCss(layer),
        ].join("; ");
    }

    function frameStyle(frame: Frame): string {
        return [
            `left: ${frame.x}px`,
            `top: ${frame.y}px`,
            `width: ${frame.width}px`,
            `height: ${frame.height}px`,
            `background: ${cssColor(frame.background)}`,
        ].join("; ");
    }

    const selected = $derived(selectedId ? studio.collage.get(selectedId) : null);
</script>

<svelte:window onkeydown={onKeyDown} />

<div
    class="viewport"
    bind:this={viewport}
    role="application"
    aria-label="Collage canvas"
    tabindex="-1"
    style:background-position="{view.x}px {view.y}px"
    style:background-size="{24 * view.zoom}px {24 * view.zoom}px"
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
>
    <div class="world" style:transform="translate({view.x}px, {view.y}px) scale({view.zoom})">
        {#each frames as frame (frame.id)}
            <div class="frame" style={frameStyle(frame)}>
                <button
                    class="frame__label"
                    data-frame-handle={frame.id}
                    style:font-size="{12 / view.zoom}px"
                    style:top="{-22 / view.zoom}px"
                >{frame.name}</button>
            </div>
        {/each}

        {#each layers as layer (layer.id)}
            {#if layer.kind === "image"}
                <figure
                    class="layer"
                    class:layer--selected={selectedId === layer.id}
                    data-layer={layer.id}
                    style={imageStyle(layer)}
                >
                    {#if layer.style.silhouette}
                        <span role="img" aria-label={layer.label} style={croppedStyle(layer)}></span>
                    {:else}
                        <img src={layer.src} alt={layer.label} style={croppedStyle(layer)} draggable="false" />
                    {/if}
                </figure>
            {:else}
                <p
                    class="layer layer--text"
                    class:layer--selected={selectedId === layer.id}
                    data-layer={layer.id}
                    style={textStyle(layer)}
                >{layer.text}</p>
            {/if}
        {/each}

        {#if selected}
            <div
                class="handles"
                style:left="{selected.x}px"
                style:top="{selected.y}px"
                style:width="{selected.width}px"
                style:height="{selected.height}px"
                style:transform="rotate({selected.rotation}deg)"
                style:border-width="{1 / view.zoom}px"
            >
                <span class="handle" data-resize style:width="{12 / view.zoom}px" style:height="{12 / view.zoom}px"></span>
            </div>
        {/if}
    </div>

    {#if !layers.length && !frames.length}
        <p class="empty">
            Drop images here, or ask your agent to add some.
        </p>
    {/if}
</div>

<style>
    .viewport {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        touch-action: none;
        cursor: grab;
        background-color: var(--surface-page);
        background-image: radial-gradient(circle, color-mix(in srgb, var(--border-subtle) 80%, transparent) 1px, transparent 1px);
    }

    .viewport:active {
        cursor: grabbing;
    }

    .world {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: 0 0;
        /* Children are positioned in canvas units; the transform does the rest. */
        will-change: transform;
    }

    .frame {
        position: absolute;
        box-shadow: 0 1px 2px rgba(34, 44, 32, 0.08), 0 18px 48px rgba(34, 44, 32, 0.12);
        outline: 1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent);
    }

    .frame__label {
        position: absolute;
        left: 0;
        border: 0;
        padding: 0;
        background: none;
        color: var(--text-muted);
        font-family: var(--font-family-body);
        white-space: nowrap;
        cursor: move;
    }

    .layer {
        position: absolute;
        margin: 0;
        overflow: hidden;
        cursor: move;
    }

    .layer > :global(img),
    .layer > :global(span) {
        position: absolute;
        display: block;
        max-width: none;
        user-select: none;
        -webkit-user-drag: none;
    }

    .layer--text {
        overflow: visible;
        white-space: pre-wrap;
    }

    .layer--selected {
        /* Drawn as an outline so it never shifts the layout by a pixel. */
        outline: 1px dashed var(--accent-brand);
        outline-offset: 2px;
    }

    .handles {
        position: absolute;
        pointer-events: none;
        border: solid var(--accent-brand);
    }

    .handle {
        position: absolute;
        right: 0;
        bottom: 0;
        translate: 50% 50%;
        background: var(--surface-panel);
        border: 1px solid var(--accent-brand);
        border-radius: 2px;
        pointer-events: auto;
        cursor: nwse-resize;
    }

    .empty {
        position: absolute;
        inset: auto 0 50% 0;
        text-align: center;
        color: var(--text-muted);
        pointer-events: none;
    }
</style>
