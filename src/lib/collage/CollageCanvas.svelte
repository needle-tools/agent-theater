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
    import { alphaFilters, cssColor, outlineFilterSvg, pxUnit, textCss } from "./css.js";
    import { maskHit } from "./imaging.js";
    import { overlaps, type Frame, type ImageLayer, type Layer, type TextLayer } from "./model.js";
    import type { CollageStudio } from "./studio.js";

    interface Props {
        studio: CollageStudio;
        /**
         * Show the export boundary. Off by default — the page is a setting, not
         * something on the canvas, and a sheet of white paper you cannot delete
         * is worse than no indication at all.
         */
        showPage?: boolean;
        onContextMenu?: (info: { x: number; y: number; layerId: string | null }) => void;
    }

    let { studio, showPage = false, onContextMenu }: Props = $props();

    /**
     * Selection is the studio's, not this component's. An agent capturing "the
     * three you picked" and a person shift-clicking them have to be talking
     * about the same thing.
     */
    let selectionVersion = $state(0);
    $effect(() => studio.onSelectionChanged(() => selectionVersion++));
    const selectedIds = $derived.by(() => (selectionVersion, studio.selection));
    const isSelected = (id: string) => selectedIds.includes(id);

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
        /** Every selected layer moves together, each from its own starting point. */
        | { mode: "move"; id: string; startX: number; startY: number; origins: Map<string, { x: number; y: number }> }
        | { mode: "resize"; id: string; originWidth: number; startX: number }
        | { mode: "marquee"; startX: number; startY: number; additive: boolean };

    let drag: Drag | null = null;
    /** The rubber band, in screen coordinates. */
    let marquee = $state<{ x: number; y: number; width: number; height: number } | null>(null);
    /** The text layer being typed into, if any. */
    let editingId = $state<string | null>(null);

    /**
     * Commit an edit.
     *
     * The DOM owns the text while it is being typed — Svelte writing to a
     * contenteditable on every keystroke would fight the caret — so the value
     * only comes back into the model here, when editing ends.
     */
    /** New layers open with their placeholder selected; edits do not. */
    let selectOnEdit = false;

    function commitEdit(element: HTMLElement, id: string) {
        if (editingId !== id) return;
        const text = (element.textContent ?? "").trim();
        // Measured before the model changes, in layout pixels — scrollWidth is
        // unaffected by the world's CSS transform, so it is already in canvas
        // units.
        const width = element.scrollWidth;
        const height = element.scrollHeight;
        editingId = null;
        // The caret's own selection would otherwise stay painted on the layer
        // after it stops being editable.
        window.getSelection()?.removeAllRanges();

        const layer = studio.collage.get(id);
        if (!layer) return;
        if (!text) {
            // An empty text layer is invisible and unselectable — nothing but a
            // thing to be confused by later.
            studio.collage.remove(id);
            studio.setSelection([]);
            return;
        }
        if (text !== (layer as TextLayer).text) {
            studio.collage.update(id, { text });
            studio.record("layer-styled", `A person set a text layer to "${text.slice(0, 40)}".`, "human", { id });
        }
        // Hug what it now says, rather than keeping the box the placeholder had.
        studio.collage.fitText(id, width, height);
    }

    /** Focus a freshly editable node, and select its contents if it is new. */
    function focusForEditing(node: HTMLElement) {
        node.focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        // Selecting everything paints the layer with the selection colour, which
        // is only wanted when the content is a placeholder to be typed over.
        if (!selectOnEdit) range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        selectOnEdit = false;
    }

    /** Finish any edit in progress — clicking elsewhere means "done". */
    function stopEditing() {
        if (!editingId) return;
        const node = viewport?.querySelector<HTMLElement>(".layer--editing");
        if (node) commitEdit(node, editingId);
        else editingId = null;
    }

    function onDoubleClick(event: MouseEvent) {
        const layer = layerAt(event.clientX, event.clientY);
        if (layer?.kind !== "text") return;
        event.preventDefault();
        editingId = layer.id;
    }
    /** A drag that has not moved yet is a click; used to keep selection sane. */
    let moved = false;

    export function getView() {
        return { ...view };
    }

    /** Screen point to canvas units, for callers placing something where you clicked. */
    export function canvasPoint(clientX: number, clientY: number) {
        return toCanvas(clientX, clientY);
    }

    /** Put a text layer straight into editing, with its text selected. */
    export function edit(id: string) {
        const layer = studio.collage.get(id);
        if (layer?.kind !== "text") return;
        studio.setSelection([id]);
        // A brand-new layer says "Text"; selecting it means the first keystroke
        // replaces it rather than appending to it.
        selectOnEdit = true;
        editingId = id;
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

        // A pointer down anywhere but inside the text being typed ends the edit.
        // preventDefault below stops the browser moving focus for us, so this
        // has to be explicit — otherwise the caret and its green selection stay
        // on the layer after you have clicked away.
        if (editingId) {
            const target = event.target;
            const inside = target instanceof Node && (target as Element).closest?.(".layer--editing");
            if (inside) return;
            stopEditing();
        }
        // Stops the drag from turning into a text selection, which is what makes
        // panning across a frame label paint it green instead of moving the view.
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        moved = false;

        const target = event.target as HTMLElement;
        if (target.closest("[data-resize]") && selectedIds.length === 1) {
            const layer = studio.collage.get(selectedIds[0]);
            if (layer) {
                drag = { mode: "resize", id: layer.id, startX: event.clientX, originWidth: layer.width };
                return;
            }
        }

        const layer = event.button === 0 ? layerAt(event.clientX, event.clientY) : null;
        if (layer) {
            if (event.shiftKey) {
                // Toggle, so shift-clicking a picked layer lets it go again.
                studio.setSelection(isSelected(layer.id)
                    ? selectedIds.filter(id => id !== layer.id)
                    : [...selectedIds, layer.id]);
            } else if (!isSelected(layer.id)) {
                studio.setSelection([layer.id]);
            }
            // Dragging any member of a selection drags the whole selection.
            const moving = isSelected(layer.id) ? selectedIds : [layer.id];
            const origins = new Map(moving.map(id => {
                const l = studio.collage.get(id)!;
                return [id, { x: l.x, y: l.y }];
            }));
            drag = { mode: "move", id: layer.id, startX: event.clientX, startY: event.clientY, origins };
            return;
        }

        // Empty space. Plain drag pans, because an infinite canvas with no
        // scrollbars has to stay easy to move around; shift draws a marquee.
        if (event.shiftKey && event.button === 0) {
            drag = { mode: "marquee", startX: event.clientX, startY: event.clientY, additive: event.altKey };
            marquee = { x: event.clientX, y: event.clientY, width: 0, height: 0 };
            return;
        }
        studio.setSelection([]);
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
            for (const [id, origin] of drag.origins) {
                studio.collage.update(id, { x: origin.x + dx, y: origin.y + dy });
            }
        } else if (drag.mode === "resize") {
            studio.collage.update(drag.id, { width: Math.max(20, drag.originWidth + dx) });
        } else if (drag.mode === "marquee") {
            marquee = {
                x: Math.min(drag.startX, event.clientX),
                y: Math.min(drag.startY, event.clientY),
                width: Math.abs(event.clientX - drag.startX),
                height: Math.abs(event.clientY - drag.startY),
            };
            const topLeft = toCanvas(marquee.x, marquee.y);
            const bottomRight = toCanvas(marquee.x + marquee.width, marquee.y + marquee.height);
            const box = {
                x: topLeft.x,
                y: topLeft.y,
                width: bottomRight.x - topLeft.x,
                height: bottomRight.y - topLeft.y,
            };
            // Touching, not containing: a band that only caught things wholly
            // inside it is fiddly to use on overlapping cut-outs.
            const caught = layers.filter(layer => overlaps(layerBounds(layer), box)).map(l => l.id);
            studio.setSelection(drag.additive ? [...selectedIds, ...caught] : caught);
        }
    }

    let hovering = $state(false);

    function onPointerUp(event: PointerEvent) {
        // A watching agent should hear about a move that actually happened, not
        // about every click that selected something.
        if (moved && drag && (drag.mode === "move" || drag.mode === "resize")) {
            const layer = studio.collage.get(drag.id);
            if (layer) {
                const others = drag.mode === "move" ? drag.origins.size - 1 : 0;
                studio.record(
                    "layer-moved",
                    `A person ${drag.mode === "resize" ? "resized" : "moved"} "${layer.label}"` +
                    `${others > 0 ? ` and ${others} other${others === 1 ? "" : "s"}` : ""}.`,
                    "human",
                    { id: layer.id, x: Math.round(layer.x), y: Math.round(layer.y), width: Math.round(layer.width) });
            }
        }
        if (drag) studio.save(view);
        drag = null;
        marquee = null;
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    }

    function onContextMenuEvent(event: MouseEvent) {
        event.preventDefault();
        const layer = layerAt(event.clientX, event.clientY);
        // Right-clicking outside the selection moves it; right-clicking inside
        // keeps it, so a menu can act on all of them at once.
        if (layer && !isSelected(layer.id)) studio.setSelection([layer.id]);
        onContextMenu?.({ x: event.clientX, y: event.clientY, layerId: layer?.id ?? null });
    }

    function onKeyDown(event: KeyboardEvent) {
        // Not every keydown target is an element — it can be the document
        // itself when nothing has focus, and Document has no .matches(). Calling
        // it there throws inside the handler and every shortcut below silently
        // stops working.
        const target = event.target;
        if (target instanceof Element && target.matches("input, textarea, select, [contenteditable]")) return;

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
            event.preventDefault();
            studio.setSelection(layers.map(l => l.id));
            return;
        }
        if (event.key === "Escape") {
            studio.setSelection([]);
            return;
        }
        if (!selectedIds.length) return;

        if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            for (const id of selectedIds) studio.collage.remove(id);
            studio.setSelection([]);
            return;
        }
        const step = event.shiftKey ? 20 : 2;
        const nudge: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
        };
        if (nudge[event.key]) {
            event.preventDefault();
            for (const id of selectedIds) {
                const layer = studio.collage.get(id);
                if (layer) studio.collage.update(id, { x: layer.x + nudge[event.key][0], y: layer.y + nudge[event.key][1] });
            }
        }
    }

    const outlineId = (layer: ImageLayer) => `collage-outline-${layer.id}`;

    /** Layers needing an SVG outline filter, and the markup that defines them. */
    const outlined = $derived.by(() => (version, layers.filter(
        (l): l is ImageLayer => l.kind === "image" && !!l.style.outline && l.style.outline.width > 0)));

    const outlineDefs = $derived(outlined
        .map(l => outlineFilterSvg(outlineId(l), l.style.outline!, l.width, l.height))
        .join(""));

    function imageStyle(layer: ImageLayer): string {
        const filters = alphaFilters(layer.style, pxUnit, outlineId(layer));
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
        ].join("; ");
    }

    /** The resize handle only makes sense on exactly one layer. */
    const single = $derived.by(() =>
        (version, selectedIds.length === 1 ? studio.collage.get(selectedIds[0]) : null));

    const groupBounds = $derived.by(() =>
        (version, selectedIds.length > 1 ? studio.collage.contentBounds(selectedIds) : null));
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
    ondblclick={onDoubleClick}
>
    <div class="world" style:transform="translate({view.x}px, {view.y}px) scale({view.zoom})">
        {#if showPage}
            {#each frames as frame (frame.id)}
                <div class="page" style={frameStyle(frame)} style:border-width="{1 / view.zoom}px">
                    <span class="page__label" style:font-size="{11 / view.zoom}px" style:top="{-20 / view.zoom}px">
                        {frame.name}
                    </span>
                </div>
            {/each}
        {/if}

        {#each layers as layer (layer.id)}
            {#if layer.kind === "image"}
                <figure
                    class="layer"
                    class:layer--selected={selectedIds.length > 1 && isSelected(layer.id)}
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
                    class:layer--selected={selectedIds.length > 1 && isSelected(layer.id)}
                    class:layer--editing={editingId === layer.id}
                    contenteditable={editingId === layer.id ? "plaintext-only" : "false"}
                    style={textStyle(layer)}
                    {@attach node => { if (editingId === layer.id) focusForEditing(node); }}
                    onblur={event => commitEdit(event.currentTarget as HTMLElement, layer.id)}
                    onkeydown={event => {
                        if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
                            event.preventDefault();
                            (event.currentTarget as HTMLElement).blur();
                        }
                        // Everything else is typing, not a canvas shortcut.
                        event.stopPropagation();
                    }}
                >{layer.text}</p>
            {/if}
        {/each}

        <!-- Never both: the editing outline is the indicator while typing, and
             a handles box drawn on top of it read as a box inside a box. -->
        {#if single && editingId !== single.id}
            <div
                class="handles"
                style:left="{single.x}px"
                style:top="{single.y}px"
                style:width="{single.width}px"
                style:height="{single.height}px"
                style:transform="rotate({single.rotation}deg)"
                style:border-width="{1 / view.zoom}px"
            >
                <span class="handle" data-resize style:width="{12 / view.zoom}px" style:height="{12 / view.zoom}px"></span>
            </div>
        {:else if groupBounds}
            <!-- What a capture would take, drawn as one box around the lot. -->
            <div
                class="group"
                style:left="{groupBounds.x}px"
                style:top="{groupBounds.y}px"
                style:width="{groupBounds.width}px"
                style:height="{groupBounds.height}px"
                style:border-width="{1 / view.zoom}px"
            ></div>
        {/if}
    </div>

    <!-- Filter definitions only; nothing here is drawn. One dilate pass per
         outlined layer, instead of a chain of drop-shadows per layer. -->
    {#if outlineDefs}
        <svg class="defs" aria-hidden="true" focusable="false">{@html outlineDefs}</svg>
    {/if}

    {#if marquee}
        <div
            class="marquee"
            style:left="{marquee.x}px"
            style:top="{marquee.y}px"
            style:width="{marquee.width}px"
            style:height="{marquee.height}px"
        ></div>
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

    /* Just a boundary. No fill, no shadow, nothing to grab — it marks what
       will be exported and is otherwise not there. */
    .page {
        position: absolute;
        border-style: dashed;
        border-color: color-mix(in srgb, var(--accent-brand) 55%, transparent);
        pointer-events: none;
    }

    .page__label {
        position: absolute;
        left: 0;
        color: var(--text-muted);
        font-family: var(--font-family-body);
        white-space: nowrap;
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

    /* Layers are pointer-events: none so hit testing can run against the alpha.
       The one being typed into has to take the pointer back, or there is no
       caret to place. */
    .layer--editing {
        pointer-events: auto;
        user-select: text;
        -webkit-user-select: text;
        cursor: text;
        /* One thin mark. It sits alone — the handles box is suppressed while
           editing — so it does not need to shout. */
        outline: 1px solid var(--accent-brand);
        outline-offset: 3px;
    }

    /*
     * Only ever one indicator. A single selection gets the handles box below; a
     * multi-selection gets a thin mark per layer plus one dashed box round the
     * lot. Drawing both at once gave a dashed rectangle inside another dashed
     * rectangle, which read as a glitch.
     *
     * An outline never shifts the layout by a pixel, unlike a border.
     */
    .layer--selected {
        outline: 1px solid var(--accent-brand);
        outline-offset: 1px;
    }

    .handles {
        position: absolute;
        pointer-events: none;
        border: solid var(--accent-brand);
    }

    /* One box around a multi-selection: it is exactly what a capture takes. */
    .group {
        position: absolute;
        pointer-events: none;
        border-style: dashed;
        border-color: var(--accent-brand);
        background: color-mix(in srgb, var(--accent-brand) 6%, transparent);
    }

    .defs {
        position: absolute;
        width: 0;
        height: 0;
        pointer-events: none;
    }

    .marquee {
        position: absolute;
        z-index: 5;
        pointer-events: none;
        border: 1px solid var(--accent-brand);
        border-radius: 2px;
        background: color-mix(in srgb, var(--accent-brand) 12%, transparent);
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
