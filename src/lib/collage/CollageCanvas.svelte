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
     * Hit testing, though, is ours rather than the DOM's. A cut-out's bounding
     * box is mostly empty — the corners of a circle are half its box — and
     * letting the browser decide meant grabbing pictures from the gap between
     * them. So every layer is `pointer-events: none` and picking is done
     * against the alpha, topmost first.
     *
     * The canvas has no bounds. Frames are the only rectangles that mean
     * anything, and they are drawn behind everything as paper laid on a table.
     */
    import { alphaFilters, cssColor, pxUnit, textCss } from "./css.js";
    import { maskHit } from "./imaging.js";
    import { type Frame, type ImageLayer, type Layer, type TextLayer } from "./model.js";
    import type { CollageStudio } from "./studio.js";

    interface Props {
        studio: CollageStudio;
        selectedId?: string | null;
        onContextMenu?: (info: { x: number; y: number; layerId: string | null }) => void;
    }

    let { studio, selectedId = $bindable(null), onContextMenu }: Props = $props();

    /** The document is a plain class; this is the bridge to Svelte's reactivity. */
    let version = $state(0);
    $effect(() => studio.collage.onChanged(() => version++));

    const layers = $derived.by(() => (version, studio.collage.list()));
    const frames = $derived.by(() => (version, studio.collage.listFrames()));

    let view = $state({ x: 0, y: 0, zoom: 0.55 });
    let viewport: HTMLDivElement | null = $state(null);
    let fitted = false;

    type Drag =
        | { mode: "pan"; startX: number; startY: number; originX: number; originY: number }
        | { mode: "move"; id: string; startX: number; startY: number; originX: number; originY: number }
        | { mode: "resize"; id: string; startX: number; originWidth: number }
        | { mode: "frame"; id: string; startX: number; startY: number; originX: number; originY: number };

    let drag: Drag | null = null;
    /** A drag that has not moved yet is a click; used to keep selection sane. */
    let moved = false;

    export function getView() {
        return { ...view };
    }

    export function setView(next: { x: number; y: number; zoom: number }) {
        view = { ...next };
        fitted = true;
    }

    /** Fit the view to everything, or centre on nothing when the canvas is empty. */
    export function fitAll() {
        if (!viewport) return;
        const rects = [
            ...frames.map(f => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
            ...layers.map(layerBounds),
        ];
        if (!rects.length) {
            view = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2, zoom: 0.55 };
            return;
        }
        const minX = Math.min(...rects.map(r => r.x));
        const minY = Math.min(...rects.map(r => r.y));
        const maxX = Math.max(...rects.map(r => r.x + r.width));
        const maxY = Math.max(...rects.map(r => r.y + r.height));
        const margin = 80;
        const zoom = Math.min(
            (viewport.clientWidth - margin * 2) / Math.max(1, maxX - minX),
            (viewport.clientHeight - margin * 2) / Math.max(1, maxY - minY),
            1.5);
        view = {
            zoom,
            x: viewport.clientWidth / 2 - ((minX + maxX) / 2) * zoom,
            y: viewport.clientHeight / 2 - ((minY + maxY) / 2) * zoom,
        };
        fitted = true;
    }

    $effect(() => {
        // First layout only — refitting on every change would yank the view out
        // from under someone who has just panned somewhere on purpose.
        if (viewport && !fitted && (layers.length || frames.length)) fitAll();
    });

    function layerBounds(layer: Layer) {
        if (!layer.rotation) return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
        const radians = (layer.rotation * Math.PI) / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));
        const width = layer.width * cos + layer.height * sin;
        const height = layer.width * sin + layer.height * cos;
        return {
            x: layer.x + layer.width / 2 - width / 2,
            y: layer.y + layer.height / 2 - height / 2,
            width,
            height,
        };
    }

    /** Screen coordinates to canvas units. */
    function toCanvas(clientX: number, clientY: number) {
        const rect = viewport!.getBoundingClientRect();
        return {
            x: (clientX - rect.left - view.x) / view.zoom,
            y: (clientY - rect.top - view.y) / view.zoom,
        };
    }

    /**
     * The topmost layer whose *visible pixels* are under the pointer.
     *
     * Front to back, because that is the order a person sees them in: the thing
     * on top is the thing you meant to grab.
     */
    function layerAt(clientX: number, clientY: number): Layer | null {
        const point = toCanvas(clientX, clientY);
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            // Undo the layer's rotation about its own centre, then work in its
            // local box.
            const dx = point.x - (layer.x + layer.width / 2);
            const dy = point.y - (layer.y + layer.height / 2);
            const radians = (-layer.rotation * Math.PI) / 180;
            const cos = Math.cos(radians);
            const sin = Math.sin(radians);
            const localX = dx * cos - dy * sin + layer.width / 2;
            const localY = dx * sin + dy * cos + layer.height / 2;
            if (localX < 0 || localY < 0 || localX > layer.width || localY > layer.height) continue;

            if (layer.kind === "text") return layer;
            const loaded = studio.images.get(layer.id);
            if (maskHit(loaded?.mask ?? null, layer.crop, localX / layer.width, localY / layer.height)) return layer;
        }
        return null;
    }

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
        if (event.button === 2) return; // The context menu handler deals with it.
        if (event.button !== 0 && event.button !== 1) return;
        // Stops the drag from turning into a text selection, which is what makes
        // panning across a frame label paint it green instead of moving the view.
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        moved = false;

        const target = event.target as HTMLElement;
        if (target.closest("[data-resize]") && selectedId) {
            const layer = studio.collage.get(selectedId);
            if (layer) {
                drag = { mode: "resize", id: selectedId, startX: event.clientX, originWidth: layer.width };
                return;
            }
        }

        const frameId = target.closest<HTMLElement>("[data-frame-handle]")?.dataset.frameHandle;
        if (frameId && event.button === 0) {
            const frame = studio.collage.getFrame(frameId);
            if (frame) {
                selectedId = null;
                drag = { mode: "frame", id: frameId, startX: event.clientX, startY: event.clientY, originX: frame.x, originY: frame.y };
                return;
            }
        }

        const layer = event.button === 0 ? layerAt(event.clientX, event.clientY) : null;
        if (layer) {
            selectedId = layer.id;
            drag = { mode: "move", id: layer.id, startX: event.clientX, startY: event.clientY, originX: layer.x, originY: layer.y };
            return;
        }

        selectedId = null;
        drag = { mode: "pan", startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
    }

    function onPointerMove(event: PointerEvent) {
        if (!drag) {
            // Only show the move cursor over something actually grabbable.
            hovering = !!layerAt(event.clientX, event.clientY);
            return;
        }
        const dx = (event.clientX - (drag as any).startX) / view.zoom;
        const dy = (event.clientY - (drag as any).startY) / view.zoom;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;

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

    let hovering = $state(false);

    function onPointerUp(event: PointerEvent) {
        if (drag?.mode === "pan" || drag?.mode === "move") studio.save(view);
        drag = null;
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    }

    function onContextMenuEvent(event: MouseEvent) {
        event.preventDefault();
        const layer = layerAt(event.clientX, event.clientY);
        if (layer) selectedId = layer.id;
        onContextMenu?.({ x: event.clientX, y: event.clientY, layerId: layer?.id ?? null });
    }

    function onKeyDown(event: KeyboardEvent) {
        const target = event.target as HTMLElement;
        if (target.matches("input, textarea, select, [contenteditable]")) return;
        if (!selectedId) return;

        if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            studio.collage.remove(selectedId);
            selectedId = null;
            return;
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

    const selected = $derived.by(() => (version, selectedId ? studio.collage.get(selectedId) : null));
</script>

<svelte:window onkeydown={onKeyDown} />

<div
    class="viewport"
    class:viewport--over={hovering && !drag}
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
    oncontextmenu={onContextMenuEvent}
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
</div>

<style>
    .viewport {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        touch-action: none;
        cursor: grab;
        /* A drag is a drag, never a text selection. Without this, panning across
           a frame label paints it with the selection colour. */
        user-select: none;
        -webkit-user-select: none;
        background-color: var(--surface-page);
        background-image: radial-gradient(circle, color-mix(in srgb, var(--border-subtle) 80%, transparent) 1px, transparent 1px);
    }

    .viewport:active {
        cursor: grabbing;
    }

    .viewport--over,
    .viewport--over:active {
        cursor: move;
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
        /* Layered rather than a border: it reads as paper on a table, and it
           does not add a pixel to the frame's measured size. */
        box-shadow:
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 10px 24px rgba(34, 44, 32, 0.08),
            0 28px 60px rgba(34, 44, 32, 0.06);
        /* Picking is done in script against the alpha, so the DOM must not
           intercept anything. The label opts back in below. */
        pointer-events: none;
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
        pointer-events: auto;
    }

    .layer {
        position: absolute;
        margin: 0;
        overflow: hidden;
        pointer-events: none;
    }

    .layer > :global(img),
    .layer > :global(span) {
        position: absolute;
        display: block;
        max-width: none;
        -webkit-user-drag: none;
    }

    .layer--text {
        overflow: visible;
        white-space: pre-wrap;
        text-wrap: pretty;
    }

    .layer--selected {
        /* An outline never shifts the layout by a pixel, unlike a border. */
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
</style>
