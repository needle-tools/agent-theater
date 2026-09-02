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
    import { FREE_PAGE, type CollageStudio } from "./studio.js";
    import { AT_REST, stateAt, type Playing, type Score } from "./perform.js";

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
        | { mode: "rotate"; id: string; centre: { x: number; y: number }; startAngle: number; originRotation: number }
        | { mode: "marquee"; startX: number; startY: number; additive: boolean };

    let drag: Drag | null = null;
    /** The rubber band, in screen coordinates. */
    let marquee = $state<{ x: number; y: number; width: number; height: number } | null>(null);
    /** The text layer being typed into, if any. */
    let editingId = $state<string | null>(null);

    /**
     * On only for the moment after something moves on its own.
     *
     * A permanent transition would put the same easing on a drag, so a layer
     * would trail behind the pointer — the classic way a canvas starts feeling
     * broken. This turns it on for one such move and off again, which is what
     * makes an agent's edits legible: you can see what it changed, instead of
     * finding the picture already different.
     */
    let settling = $state(false);
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const SETTLE_MS = 420;

    $effect(() => studio.onSettle(() => {
        settling = true;
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => (settling = false), SETTLE_MS + 60);
    }));

    /**
     * The performance, if one is running.
     *
     * An agent hands over a whole score and this plays it, because a tool call
     * is a round trip and a walk cycle is sixty frames a second. Poses are held
     * here rather than written to the document: a three-second walk would
     * otherwise be a hundred and eighty edits through undo and IndexedDB, and
     * undoing it would step back through the animation.
     */
    let cast = $state(new Map<string, Playing>());
    let playing: { score: Score; started: number; frame: number; done: () => void } | null = null;

    // The studio holds the tools' end of this; the clock lives here, where
    // there is a requestAnimationFrame to hang it on.
    $effect(() => {
        studio.setPerformer(perform);
        return () => studio.setPerformer(null);
    });

    export function perform(score: Score): Promise<void> {
        stopPerforming();
        if (!score.cues.length) return Promise.resolve();
        return new Promise(resolve => {
            const tick = (now: number) => {
                if (!playing) return;
                const elapsed = now - playing.started;
                cast = stateAt(playing.score, elapsed, id => studio.collage.get(id)?.height ?? 100);
                if (elapsed < playing.score.duration) {
                    playing.frame = requestAnimationFrame(tick);
                    return;
                }
                // Held on the final frame rather than cleared, so a layer that
                // exited stays gone until something puts it back.
                playing.frame = 0;
                const finish = playing.done;
                playing = null;
                finish();
            };
            playing = { score, started: performance.now(), frame: 0, done: resolve };
            playing.frame = requestAnimationFrame(tick);
        });
    }

    export function stopPerforming() {
        if (!playing) return;
        if (playing.frame) cancelAnimationFrame(playing.frame);
        const finish = playing.done;
        playing = null;
        cast = new Map();
        finish();
    }

    const poseOf = (id: string) => cast.get(id)?.pose ?? AT_REST;

    /**
     * Who is speaking, and where the bubble goes.
     *
     * Above the layer and following whatever it is doing, because a bubble that
     * stays put while its speaker jumps belongs to nobody. Sized against the
     * layer so a bubble over a small sprite is a small bubble.
     */
    const speaking = $derived.by(() => {
        void version;
        const said: Array<{
            id: string; text: string; shown: string; x: number; y: number; size: number;
        }> = [];
        for (const [id, state] of cast) {
            if (!state.say || state.gone) continue;
            const layer = studio.collage.get(id);
            if (!layer) continue;
            // Typed in over the first part of its life, then held: the reveal is
            // the point, but reading time is what the rest of it is for.
            const typed = Math.min(1, state.saying / 0.45);
            const shown = state.say.slice(0, Math.max(1, Math.round(state.say.length * typed)));
            said.push({
                id,
                text: state.say,
                shown,
                x: layer.x + layer.width / 2 + state.pose.dx,
                y: layer.y + state.pose.dy,
                size: Math.max(13, Math.min(34, layer.height * 0.075)),
            });
        }
        return said;
    });

    /** The performed transform, appended to whatever the layer already does. */
    function acting(layer: Layer): string {
        const pose = poseOf(layer.id);
        if (pose === AT_REST) return "";
        const parts: string[] = [];
        if (pose.dx || pose.dy) parts.push(`translate(${pose.dx.toFixed(2)}px, ${pose.dy.toFixed(2)}px)`);
        if (pose.rotate) parts.push(`rotate(${pose.rotate.toFixed(2)}deg)`);
        if (pose.scaleX !== 1 || pose.scaleY !== 1) {
            parts.push(`scale(${pose.scaleX.toFixed(3)}, ${pose.scaleY.toFixed(3)})`);
        }
        return parts.join(" ");
    }

    /** Layers cut or copied, waiting to be pasted. */
    let clipboard: Layer[] = [];

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

    /**
     * Drop copies of some layers onto the canvas, offset so they are visibly
     * separate from what they came from, and select them — pasting something
     * exactly on top of the original looks like nothing happened.
     */
    function pasteLayers(source: Layer[]) {
        if (!source.length) return;
        const offset = 28;
        const pasted: string[] = [];
        for (const layer of source) {
            const copy = layer.kind === "image"
                ? studio.collage.addImage({
                    src: layer.src,
                    storageKey: layer.storageKey,
                    label: layer.label,
                    natural: layer.natural,
                    crop: layer.crop,
                    x: layer.x + offset,
                    y: layer.y + offset,
                    width: layer.width,
                    rotation: layer.rotation,
                    style: layer.style,
                })
                : studio.collage.addText({
                    text: layer.text,
                    label: layer.label,
                    x: layer.x + offset,
                    y: layer.y + offset,
                    width: layer.width,
                    fontSize: layer.fontSize,
                    fontFamily: layer.fontFamily,
                    fontWeight: layer.fontWeight,
                    align: layer.align,
                    color: layer.color,
                    rotation: layer.rotation,
                });
            // The copy shares the original's bytes in IndexedDB rather than
            // storing them twice; nothing ever rewrites an image in place.
            if (copy.kind === "image") {
                const loaded = studio.images.get(layer.id);
                if (loaded) studio.images.set(copy.id, loaded);
            }
            pasted.push(copy.id);
        }
        studio.setSelection(pasted);
        studio.save();
    }

    function onDoubleClick(event: MouseEvent) {
        const layer = layerAt(event.clientX, event.clientY);
        if (layer?.kind !== "text") return;
        event.preventDefault();
        editingId = layer.id;
    }
    /** A drag that has not moved yet is a click; used to keep selection sane. */
    let moved = false;
    /** Last seen pointer position, so a paste can land where you are looking. */
    let pointer: { x: number; y: number } | null = null;

    export function getView() {
        return { ...view };
    }

    /** Screen point to canvas units, for callers placing something where you clicked. */
    export function canvasPoint(clientX: number, clientY: number) {
        return toCanvas(clientX, clientY);
    }

    /**
     * Where something pasted should land: under the pointer if it is over the
     * canvas, otherwise the middle of what is on screen. Pasting into the
     * top-left of an infinite canvas — which is nowhere in particular — is how
     * a paste ends up looking like it did nothing.
     */
    export function pastePoint() {
        if (pointer) return toCanvas(pointer.x, pointer.y);
        if (!viewport) return null;
        const box = viewport.getBoundingClientRect();
        return toCanvas(box.left + box.width / 2, box.top + box.height / 2);
    }

    /**
     * Paste the layers copied inside the app, if there are any.
     *
     * Returns whether it did, so the paste handler can fall back to the system
     * clipboard — the decision needs the clipboard's contents, which only the
     * paste event has.
     */
    export function pasteClipboard(): boolean {
        if (!clipboard.length) return false;
        pasteLayers(clipboard);
        return true;
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
    export function fitAll(options: { animate?: boolean } = {}) {
        if (!viewport) return;
        const rects = [
            ...frames.map(f => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
            ...layers.map(layerBounds),
        ];
        if (!rects.length) {
            moveTo({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2, zoom: 0.55 }, options.animate);
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
        moveTo({
            zoom,
            x: viewport.clientWidth / 2 - ((minX + maxX) / 2) * zoom,
            y: viewport.clientHeight / 2 - ((minY + maxY) / 2) * zoom,
        }, options.animate);
        fitted = true;
    }

    let flight: number | null = null;

    /**
     * Move the camera, optionally over time.
     *
     * Zoom is interpolated in log space, because zoom is a ratio: stepping
     * linearly from 0.2 to 2 spends most of the flight already zoomed in and
     * lurches at the start. Halving and doubling should take equal time.
     *
     * Any pointer interaction cancels it — a camera that keeps flying while you
     * try to grab something is a camera fighting you.
     */
    function moveTo(target: { x: number; y: number; zoom: number }, animate = false) {
        stopFlight();
        if (!animate || reducedMotion()) {
            view = target;
            return;
        }
        const from = { ...view };
        const start = performance.now();
        const duration = 420;
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            // The same easing the arrange transition uses, so the canvas has
            // one sense of how things move.
            const eased = 1 - Math.pow(1 - t, 3);
            const zoom = Math.exp(Math.log(from.zoom) + (Math.log(target.zoom) - Math.log(from.zoom)) * eased);
            view = {
                zoom,
                x: from.x + (target.x - from.x) * eased,
                y: from.y + (target.y - from.y) * eased,
            };
            flight = t < 1 ? requestAnimationFrame(step) : null;
            if (t >= 1) view = target;
        };
        flight = requestAnimationFrame(step);
    }

    function stopFlight() {
        if (flight === null) return;
        cancelAnimationFrame(flight);
        flight = null;
    }

    function reducedMotion(): boolean {
        return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
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

    /** Degrees from a canvas-space centre to a screen point. */
    function angleTo(centre: { x: number; y: number }, clientX: number, clientY: number): number {
        const point = toCanvas(clientX, clientY);
        return (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI;
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
        stopFlight();
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
        stopFlight();
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
        // Throws if the pointer is not currently down — which a synthetic event
        // never is. Losing capture only costs a drag that ends off the element;
        // letting it throw here would abort the whole gesture.
        try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch { /* carry on without capture */ }
        moved = false;

        const target = event.target as HTMLElement;
        if (target.closest("[data-resize]") && selectedIds.length === 1) {
            const layer = studio.collage.get(selectedIds[0]);
            if (layer) {
                drag = { mode: "resize", id: layer.id, startX: event.clientX, originWidth: layer.width };
                return;
            }
        }
        if (target.closest("[data-rotate]") && selectedIds.length === 1) {
            const layer = studio.collage.get(selectedIds[0]);
            if (layer) {
                const centre = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
                drag = {
                    mode: "rotate",
                    id: layer.id,
                    centre,
                    startAngle: angleTo(centre, event.clientX, event.clientY),
                    originRotation: layer.rotation,
                };
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
        pointer = { x: event.clientX, y: event.clientY };
        // A camera still flying while you reach for something is a camera
        // fighting you.
        if (drag) stopFlight();
        if (!drag) {
            // Which layer, not just whether one — it gets outlined.
            hoverId = layerAt(event.clientX, event.clientY)?.id ?? null;
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
        } else if (drag.mode === "rotate") {
            const turned = angleTo(drag.centre, event.clientX, event.clientY) - drag.startAngle;
            let rotation = drag.originRotation + turned;
            // Shift snaps to 15°, which is how anyone gets back to straight.
            if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
            studio.collage.update(drag.id, { rotation });
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

    let hoverId = $state<string | null>(null);

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

        const accel = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();

        if (accel && key === "a") {
            event.preventDefault();
            studio.setSelection(layers.map(l => l.id));
            return;
        }
        if (accel && key === "z") {
            event.preventDefault();
            // Shift+Z redoes, as everywhere; Ctrl+Y too, below.
            if (event.shiftKey ? studio.collage.redo() : studio.collage.undo()) {
                // Ids may have come back or gone away with the step.
                studio.setSelection(studio.selection);
                studio.save();
            }
            return;
        }
        if (accel && key === "y") {
            event.preventDefault();
            if (studio.collage.redo()) {
                studio.setSelection(studio.selection);
                studio.save();
            }
            return;
        }
        if (accel && (key === "c" || key === "x")) {
            if (!selectedIds.length) return;
            event.preventDefault();
            clipboard = selectedIds.map(id => studio.collage.get(id)).filter((l): l is Layer => !!l);
            if (key === "x") {
                for (const layer of clipboard) studio.collage.remove(layer.id);
                studio.setSelection([]);
            }
            return;
        }
        // Ctrl+V is deliberately absent. A keydown cannot see what is on the
        // clipboard, so deciding there meant guessing between our own copied
        // layers and an image from the system — and the guess was wrong in one
        // direction for good: once anything had been copied in the app, an
        // image from outside could never be pasted again. The paste event knows
        // the answer, so the choice is made there. See pasteClipboard.
        if (accel && key === "d") {
            if (!selectedIds.length) return;
            event.preventDefault();
            pasteLayers(selectedIds.map(id => studio.collage.get(id)).filter((l): l is Layer => !!l));
            return;
        }
        // F for frame, as in every 3D tool. No modifier: it is a view command,
        // it changes nothing, and it is the one people reach for blind.
        if (!accel && key === "f") {
            event.preventDefault();
            fitAll({ animate: true });
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

    /**
     * Selection and hover are drawn around the picture's own edge rather than
     * around its box. A cut-out's bounding rectangle is mostly empty — boxing
     * a bear tells you about the crop, not the bear — so the same dilate that
     * makes a sticker outline marks what is picked out.
     *
     * These two are shared by every layer rather than generated per layer: with
     * the default userSpaceOnUse primitives the radius is in canvas units, so
     * one filter suits any size. It is divided by the zoom to stay a constant
     * thickness on screen however far in you are.
     */
    const indicatorDefs = $derived.by(() => {
        // Clamped, and that is not cosmetic. feMorphology samples a window of
        // (2r+1)² per pixel, so cost grows with the square of the radius — and
        // dividing by the zoom means zooming out grows it without limit. An
        // uncapped radius froze the renderer outright on the first click.
        const scale = (screenPx: number) => Math.min(6, Math.max(1, screenPx / view.zoom));
        return (
            indicatorFilter("collage-hovered", scale(1.5), "var(--collage-hover-mark)") +
            indicatorFilter("collage-selected", scale(2.5), "var(--collage-select-mark)")
        );
    });

    function indicatorFilter(id: string, radius: number, color: string): string {
        return `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">` +
            `<feMorphology in="SourceAlpha" operator="dilate" radius="${radius.toFixed(3)}" result="spread"/>` +
            `<feFlood flood-color="${color}" result="colour"/>` +
            `<feComposite in="colour" in2="spread" operator="in" result="edge"/>` +
            `<feMerge><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge>` +
            `</filter>`;
    }

    const outlineDefs = $derived(outlined
        .map(l => outlineFilterSvg(outlineId(l), l.style.outline!, l.width, l.height))
        .join(""));

    /** The mark for a layer's state, chained after its own styling. */
    function indicatorFor(id: string): string {
        if (editingId === id) return "";
        if (isSelected(id)) return "url(#collage-selected)";
        // A hovered layer that is already selected keeps the stronger mark.
        return hoverId === id ? "url(#collage-hovered)" : "";
    }

    function imageStyle(layer: ImageLayer): string {
        const indicator = indicatorFor(layer.id);
        const own = alphaFilters(layer.style, pxUnit, outlineId(layer));
        // Order matters: the indicator dilates whatever the layer already
        // draws, so it wraps a sticker outline rather than hiding under it.
        const filters = [own, indicator].filter(Boolean).join(" ");
        return [
            `left: ${layer.x}px`,
            `top: ${layer.y}px`,
            `width: ${layer.width}px`,
            `height: ${layer.height}px`,
            // The performed transform goes first, so it moves the layer as a
            // whole rather than being applied inside its own rotation.
            `transform: ${[acting(layer), `rotate(${layer.rotation}deg)`].filter(Boolean).join(" ")}`,
            `z-index: ${layer.z}`,
            filters ? `filter: ${filters}` : "",
            performedOpacity(layer, layer.style.opacity),
        ].filter(Boolean).join("; ");
    }

    /** A layer's own opacity, dimmed by whatever it is doing. */
    function performedOpacity(layer: Layer, own: number): string {
        const state = cast.get(layer.id);
        const opacity = (state?.gone ? 0 : state?.pose.opacity ?? 1) * own;
        return opacity !== 1 ? `opacity: ${opacity.toFixed(3)}` : "";
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
        // The same dilate traces glyphs, so selecting a headline outlines the
        // letters rather than drawing a rectangle around them.
        const indicator = indicatorFor(layer.id);
        return [
            `left: ${layer.x}px`,
            `top: ${layer.y}px`,
            `width: ${layer.width}px`,
            `font-size: ${layer.fontSize}px`,
            `transform: ${[acting(layer), `rotate(${layer.rotation}deg)`].filter(Boolean).join(" ")}`,
            `z-index: ${layer.z}`,
            indicator ? `filter: ${indicator}` : "",
            performedOpacity(layer, 1),
            ...textCss(layer),
        ].filter(Boolean).join("; ");
    }

    function frameStyle(frame: Frame): string {
        return [
            `left: ${frame.x}px`,
            `top: ${frame.y}px`,
            `width: ${frame.width}px`,
            `height: ${frame.height}px`,
        ].join("; ");
    }

    /**
     * A free page hugs whatever is on the canvas, so drawing it as a sheet says
     * nothing — there is no edge to be surprised by. A chosen paper size is the
     * opposite: it crops, so it is drawn.
     */
    const fixedPage = $derived(studio.pagePreset !== FREE_PAGE);

    /**
     * Under everything, always — computed rather than assumed.
     *
     * "Send to back" hands out `lowest - 1`, so layer z-indices go negative and
     * keep going. A fixed number on the page would sooner or later be above one
     * of them, and the page would paint over a sticker.
     */
    const pageZ = $derived(Math.min(0, ...layers.map(l => l.z)) - 1);

    /** The resize handle only makes sense on exactly one layer. */
    const single = $derived.by(() =>
        (version, selectedIds.length === 1 ? studio.collage.get(selectedIds[0]) : null));

    const groupBounds = $derived.by(() =>
        (version, selectedIds.length > 1 ? studio.collage.contentBounds(selectedIds) : null));
</script>

<svelte:window onkeydown={onKeyDown} />

<div
    class="viewport"
    class:viewport--over={!!hoverId && !drag}
    bind:this={viewport}
    role="application"
    aria-label="Collage canvas"
    tabindex="-1"
    style:background-position="{view.x}px {view.y}px"
    style:background-size="{24 * view.zoom}px {24 * view.zoom}px"
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerleave={() => (pointer = null)}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    oncontextmenu={onContextMenuEvent}
    ondblclick={onDoubleClick}
>
    <div class="world" style:transform="translate({view.x}px, {view.y}px) scale({view.zoom})">
        {#if showPage}
            {#each frames as frame (frame.id)}
                <!-- Drawn as an actual sheet, not just a rule. It is the edge
                     every export is cropped to, so "where does the picture
                     stop" has to be answerable without opening a panel — and a
                     white sheet against the checkerboard is also the only
                     honest preview of the transparent/white choice. -->
                <div
                    class="page"
                    class:page--transparent={fixedPage && frame.background === "transparent"}
                    style={frameStyle(frame)}
                    style:z-index={pageZ}
                    style:border-width="{1.5 / view.zoom}px"
                    style:background-color={fixedPage && frame.background !== "transparent" ? frame.background : undefined}
                    style:background-size="{16 / view.zoom}px {16 / view.zoom}px"
                    style:background-position="0 0, 0 {8 / view.zoom}px, {8 / view.zoom}px {-8 / view.zoom}px, {-8 / view.zoom}px 0"
                >
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
                    class:layer--settling={settling}
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
                    class:layer--settling={settling}
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

        <!-- No box. The selection is drawn around the picture itself, so this
             is only somewhere to hang the handles. -->
        {#if single && editingId !== single.id}
            <div
                class="handles"
                style:left="{single.x}px"
                style:top="{single.y}px"
                style:width="{single.width}px"
                style:height="{single.height}px"
                style:transform="rotate({single.rotation}deg)"
            >
                <!-- Sizes and borders are divided by the zoom because these sit
                     inside the scaled world; a plain 1px border would thin to
                     nothing as you zoom out, which is what made the rotate
                     handle read as a faint ring. -->
                <span class="handle handle--resize" data-resize
                    style:width="{11 / view.zoom}px" style:height="{11 / view.zoom}px"
                    style:border-width="{1.5 / view.zoom}px"
                    style:border-radius="{2 / view.zoom}px"></span>
                <span class="handle handle--rotate" data-rotate
                    style:width="{13 / view.zoom}px" style:height="{13 / view.zoom}px"
                    style:border-width="{2 / view.zoom}px"
                    style:top="{-20 / view.zoom}px"></span>
            </div>
        {/if}

        {#each speaking as line (line.id)}
            <div
                class="bubble"
                style:left="{line.x}px"
                style:top="{line.y}px"
                style:font-size="{line.size}px"
                style:max-width="{Math.max(220, line.size * 14)}px"
            >
                <!-- The full text is present but invisible, so the bubble is
                     the size it will end at and does not grow a word at a time
                     while it is being read. -->
                <span class="bubble__grow" aria-hidden="true">{line.text}</span>
                <span class="bubble__said">{line.shown}</span>
            </div>
        {/each}
    </div>

    <!-- Filter definitions only; nothing here is drawn. One dilate pass per
         outlined layer, plus the two shared selection and hover marks. -->
    <svg class="defs" aria-hidden="true" focusable="false">{@html indicatorDefs + outlineDefs}</svg>

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
    /* The marks for hover and selection.
     *
     * Deliberately not the brand green: a sticker outline is a thing you can
     * put ON a picture, and it defaults to green too, so a green selection and
     * a green outline were the same mark meaning two different things. A cool
     * grey reads as chrome — the editor talking about the picture rather than
     * something the picture is wearing — and stays out of the way of a collage
     * that is itself full of colour. Hover is the lighter of the two, so the
     * pair separate by weight as well as by thickness.
     *
     * Declared here because the filter defs live inside .viewport and pick
     * these up through the cascade.
     */
    .viewport {
        --collage-hover-mark: #9DA8B6;
        --collage-select-mark: #6F8098;
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

    /* Lifted on a dark canvas — a mid grey that reads as a mark against white
       paper reads as a shadow against a dark one. */
    :global(:root[data-theme="dark"]) .viewport {
        --collage-hover-mark: #7E8B9B;
        --collage-select-mark: #A9B6C6;
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
    /* A neutral edge, not the brand green: it was a pale green hairline on a
       pale green canvas, which is how an export came to be cropped by an edge
       nobody could see. */
    .page {
        position: absolute;
        border-style: dashed;
        border-color: color-mix(in srgb, var(--text-muted) 65%, transparent);
        pointer-events: none;
    }

    /* The standard checkerboard, because "transparent" has to look like
       something. Four gradients, no image to load. */
    .page--transparent {
        --a: color-mix(in srgb, var(--text-muted) 16%, transparent);
        background-image:
            linear-gradient(45deg, var(--a) 25%, transparent 25%),
            linear-gradient(-45deg, var(--a) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, var(--a) 75%),
            linear-gradient(-45deg, transparent 75%, var(--a) 75%);
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

    /* Only while a layout settles. Named properties, never `all`: transitioning
       `filter` here would make the selection outline fade in every time. */
    .layer--settling {
        transition-property: left, top, width, height, transform;
        transition-duration: 0.42s;
        transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }

    @media (prefers-reduced-motion: reduce) {
        .layer--settling {
            transition-duration: 0.01s;
        }
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

    /* Selection and hover are SVG filters traced around the artwork's own
       edge — see indicatorDefs. Nothing is outlined with a rectangle. */

    /* No border — just somewhere to hang the handles, since the selection
       itself is drawn around the artwork. */
    .handles {
        position: absolute;
        pointer-events: none;
    }

    .defs {
        position: absolute;
        width: 0;
        height: 0;
        pointer-events: none;
    }

    /**
     * A speech bubble, sitting above whoever is speaking.
     *
     * Drawn with a real border and a rotated square for the tail rather than a
     * filter or a triangle of shadows — the same lesson as the toasts: CSS
     * filters chain, so a stack of them is a stack of full-size buffers, and a
     * border is the one way to get a stroke that is the same width all the way
     * round including under the tail.
     */
    .bubble {
        position: absolute;
        z-index: 2147483000;
        translate: -50% calc(-100% - 0.7em);
        display: grid;
        padding: 0.55em 0.8em;
        border: 0.09em solid var(--text-primary);
        border-radius: 0.9em;
        background: var(--surface-page-elevated, #fff);
        color: var(--text-primary);
        font-family: var(--font-family-body);
        line-height: 1.25;
        text-align: center;
        text-wrap: balance;
        pointer-events: none;
        animation: bubble-in 0.22s cubic-bezier(0.2, 0, 0, 1);
    }

    @keyframes bubble-in {
        from { opacity: 0; scale: 0.9; translate: -50% calc(-100% - 0.2em); }
        to { opacity: 1; scale: 1; translate: -50% calc(-100% - 0.7em); }
    }

    @media (prefers-reduced-motion: reduce) {
        .bubble { animation: none; }
    }

    /* The tail: a square of the same border, rotated, with its inner two edges
       hidden by the bubble's own background sitting on top of it. */
    .bubble::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -0.31em;
        width: 0.55em;
        height: 0.55em;
        translate: -50% 0;
        rotate: 45deg;
        border: 0.09em solid var(--text-primary);
        border-top: 0;
        border-left: 0;
        background: var(--surface-page-elevated, #fff);
    }

    /* Both texts occupy the same cell, so the bubble is born the size it will
       end at. A bubble that grows a word at a time drags the eye away from the
       words themselves. */
    .bubble__grow,
    .bubble__said {
        grid-area: 1 / 1;
    }

    .bubble__grow {
        visibility: hidden;
    }

    /* The rubber band is the act of selecting, so it wears the selection's
       colour rather than the brand's. */
    .marquee {
        position: absolute;
        z-index: 5;
        pointer-events: none;
        border: 1px solid var(--collage-select-mark);
        border-radius: 2px;
        background: color-mix(in srgb, var(--collage-select-mark) 12%, transparent);
    }

    .handle {
        position: absolute;
        border-style: solid;
        pointer-events: auto;
    }

    /* White square, marked edge — reads as "drag this corner". Same colour as
       the outline it belongs to; handles in a different colour from the
       selection they sit on read as two separate things. */
    .handle--resize {
        right: 0;
        bottom: 0;
        translate: 50% 50%;
        background: var(--surface-panel);
        border-color: var(--collage-select-mark);
        cursor: nwse-resize;
    }

    /* Filled disc with a white ring: a solid dot is legible at any zoom and
       against any picture, where an outlined ring disappeared into both. */
    .handle--rotate {
        left: 50%;
        translate: -50% 0;
        border-radius: 50%;
        background: var(--collage-select-mark);
        border-color: var(--surface-panel);
        cursor: grab;
    }

    .handle--rotate:active {
        cursor: grabbing;
    }
</style>
