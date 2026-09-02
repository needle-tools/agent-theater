<script lang="ts">
    /**
     * The collage page.
     *
     * Two ways in, one document. A person drops images, drags them around and
     * right-clicks to change them; an agent calls the WebMCP tools. Neither is
     * a wrapper around the other — they both mutate the same `Collage`, so an
     * agent can arrange what a person dropped, and a person can fix what an
     * agent arranged.
     *
     * The page itself is almost nothing: a canvas, a right-click menu, and one
     * button in the corner. Everything that acts on a single picture is at the
     * pointer; everything global is behind the button.
     */
    import { onMount } from "svelte";
    import CollageCanvas from "$lib/collage/CollageCanvas.svelte";
    import ContextMenu, { type MenuItem } from "$lib/collage/ContextMenu.svelte";
    import EditPopover from "$lib/collage/EditPopover.svelte";
    import Toasts, { createToasts, LIFETIME } from "$lib/collage/Toasts.svelte";
    import { createStudio, download, FREE_PAGE } from "$lib/collage/studio";
    import { createCollageTools } from "$lib/collage/tools";
    import { FONTS, type ImageLayer, type TextLayer } from "$lib/collage/model";
    import { loadWebFonts } from "$lib/collage/webfonts";
    import type { LayoutMode } from "$lib/collage/layout";
    import { registerTools } from "$lib/webmcp";

    const studio = createStudio();
    const collage = studio.collage;
    const toasts = createToasts();

    let version = $state(0);
    let toolsRegistered = $state(false);
    let editOpen = $state(false);
    let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
    /**
     * Canvas point the menu was opened at. Whatever the menu adds goes here —
     * "add text" should put the text where you asked for it, not wherever the
     * automatic spiral had got to.
     */
    let menuPoint: { x: number; y: number } | null = null;
    let canvas = $state<CollageCanvas | null>(null);
    let fileInput: HTMLInputElement | null = $state(null);
    let restored = $state(false);

    $effect(() => collage.onChanged(() => version++));

    const layers = $derived.by(() => (version, collage.list()));
    const frames = $derived.by(() => (version, collage.listFrames()));
    const empty = $derived(!layers.length && !frames.length);

    onMount(async () => {
        // Restore before registering tools: an agent that calls describe on the
        // first turn should see the collage the person left, not an empty one.
        try {
            const count = await studio.restore();
            if (count) {
                toasts.push(`Picked up where you left off — ${count} layer${count === 1 ? "" : "s"}.`);
                canvas?.fitAll();
            }
        } catch (error) {
            console.warn("[collage] could not restore the saved collage:", error);
        }
        restored = true;
        // Wrapped once here rather than in each tool: an agent's work should be
        // visible, and that should not be fourteen call sites.
        const { notifyAgentActivity } = await import("$lib/room/activity");
        toolsRegistered = await registerTools(createCollageTools(studio).map(tool => ({
            ...tool,
            execute: (args: unknown, options?: { signal?: AbortSignal }) => {
                notifyAgentActivity(tool.name);
                announceAgent(tool.name);
                return tool.execute(args, options);
            },
        })));
    });

    /**
     * Say what the agent just did, in the same bubbles a person's own actions
     * use — with its own colour, so who did what is legible without reading.
     *
     * Reused rather than stacked: an agent working through a plan fires several
     * calls a second, and a bubble each would bury everything else and never
     * settle. One bubble that keeps updating reads as "still working".
     */
    let agentToast: { update: (text: string, tone?: "agent") => void } | null = null;
    let agentTimer: ReturnType<typeof setTimeout> | null = null;

    function announceAgent(tool: string) {
        const text = `Agent used ${tool}`;
        if (agentToast) agentToast.update(text, "agent");
        else agentToast = toasts.push(text, "agent");
        if (agentTimer) clearTimeout(agentTimer);
        // Let go once the bubble has expired, so the next call starts a new one
        // rather than reviving a dismissed bubble's handle.
        agentTimer = setTimeout(() => (agentToast = null), LIFETIME.agent);
    }

    /** Where the next batch of images should land, if somewhere was pointed at. */
    let dropPoint: { x: number; y: number } | null = null;

    /**
     * Ask for the scene behind the objects as well, when a photo splits.
     *
     * Off by default and deliberately a choice: it downloads a second model of
     * about 28 MB and adds a slow pass, which is not a price to charge someone
     * who only wanted a sticker. For a photo of things on a table it is the
     * difference between one flat picture and a background with things on it.
     */
    let fillBackground = $state(false);

    /** Save the whole collage as a picture that opens again. */
    async function saveToFile() {
        if (!collage.list().length) {
            toasts.push("Nothing to save yet — drop some photos in.");
            return;
        }
        const toast = toasts.push("Packing it up…", "busy");
        try {
            const { blob, filename } = await studio.saveFile();
            download(blob, filename);
            toast.close();
            toasts.push(`Saved ${filename} — drop it back here to keep working.`);
        } catch (error) {
            toast.close();
            toasts.push(`Could not save that — ${message(error)}`, "error");
        }
    }

    /**
     * A dropped file might be a saved collage rather than a picture to add.
     * Checked before anything else, because a collage file is also a valid PNG
     * and would otherwise be pasted in as a flat image of itself.
     */
    async function openCollageFiles(files: File[]): Promise<File[]> {
        const rest: File[] = [];
        for (const file of files) {
            // By extension as well as by type. A file dropped from some
            // filesystems and archives arrives with an empty `type`, and
            // trusting that alone meant a saved collage was silently discarded
            // before anything ever looked inside it.
            const png = file.type === "image/png" || /\.png$/i.test(file.name);
            if (!png) {
                rest.push(file);
                continue;
            }
            let opened = 0;
            try {
                opened = await studio.openFile(file);
            } catch (error) {
                // A file that IS one of ours but will not open has to say so.
                // Swallowing it and adding a flat picture of the collage
                // instead is the most confusing possible outcome.
                toasts.push(`${file.name} looks like a saved collage but could not be opened — ${message(error)}`, "error");
                continue;
            }
            if (!opened) {
                // Named like one of ours but holding no collage: almost always
                // a file that has been through something that re-encodes PNGs
                // and dropped the chunk. Say that, rather than quietly adding a
                // flat picture of the collage it used to be.
                if (/\.collage\.png$/i.test(file.name)) {
                    toasts.push(
                        `${file.name} has no collage inside it any more — something re-saved the image and ` +
                        `stripped it. Adding it as a picture instead.`, "error");
                }
                rest.push(file);
                continue;
            }
            // The pieces arrive at the coordinates they were saved at, which
            // may be nowhere near where the view happens to be looking — and a
            // collage that loaded off-screen is indistinguishable from one that
            // did not load at all.
            canvas?.fitAll();
            toasts.push(`Opened a saved collage — ${opened} pieces.`);
        }
        return rest;
    }

    async function addFiles(files: FileList | File[]) {
        // Collage files are looked at first, and on everything — filtering by
        // MIME type beforehand is how one got thrown away unopened.
        const rest = await openCollageFiles([...files]);
        const images = rest.filter(f => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/i.test(f.name));
        if (!images.length) return;
        const near = dropPoint;
        dropPoint = null;
        const many = images.length > 1;
        const toast = toasts.push(many ? `Cutting out ${images.length} images…` : "Cutting it out…", "busy");
        let cut = 0;
        let separated = 0;
        let healed = false;
        let failed: string | null = null;
        try {
            for (const [index, file] of images.entries()) {
                if (many) toast.update(`Cutting out ${index + 1} of ${images.length}…`, "busy");
                const url = await readAsDataUrl(file);
                const { background, pieces } = await studio.addImage(url, {
                    label: file.name.replace(/\.[^.]+$/, ""),
                    // Land where they were dropped; several fan out from there.
                    near: near ?? undefined,
                    // The whole point of dropping a photo here is the cut-out.
                    removeBackground: true,
                    // A photo of things on a surface becomes the things and
                    // the surface, when asked.
                    heal: fillBackground,
                    onProgress: progress => {
                        // The model is tens of megabytes on first use; silence
                        // would read as a hang.
                        if (progress.total) {
                            const pct = Math.round((progress.loaded ?? 0) / progress.total * 100);
                            toast.update(`Fetching the background remover… ${pct}%`, "busy");
                        }
                    },
                });
                if (background.ok) cut++;
                else if (!background.skipped && !failed) failed = background.reason ?? null;
                // A photo that held several things becomes several layers, and
                // saying "added 1" for six stickers is the kind of small lie
                // that makes people distrust the rest of the message.
                // Not counting the backplate: "6 pieces" for five stickers
                // and a desk is a small lie that makes the rest of the
                // message untrustworthy.
                if (pieces && pieces.length > 1) {
                    separated += pieces.length - (background.backplate ? 1 : 0);
                    if (background.backplate) healed = true;
                }
            }
            toast.close();
            if (failed) {
                console.warn("[collage] background removal unavailable:", failed);
                toasts.push(`Added ${images.length}. ${shortFailure(failed)}`, "error");
            } else {
                toasts.push(separated
                    ? separated === 1
                        ? `Cut it out${healed ? ", and kept the scene behind it" : ""}.`
                        : `Cut out ${separated} separate pieces${healed ? ", and painted in the scene behind them" : ""}.`
                    : cut
                        ? `${cut === 1 ? "Cut it out" : `Cut out ${cut}`} and added.`
                        : `Added ${images.length}.`);
            }
            if (!collage.list().length || !frames.length) canvas?.fitAll();
        } catch (error) {
            toast.close();
            toasts.push(`Could not read that — ${message(error)}`, "error");
        }
    }

    /**
     * One sentence a person can act on.
     *
     * The underlying reasons are written for an agent — they name module URLs
     * and fetch errors so it can route around the problem. Shown to a person
     * they are just a wall of text where a bubble should be.
     */
    function shortFailure(reason: string | null): string {
        if (reason && /could not load|unavailable|fetch/i.test(reason)) {
            return "Background removal is not available right now — the images went in as they are.";
        }
        return "The background could not be removed — the images went in as they are.";
    }

    function readAsDataUrl(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
            reader.readAsDataURL(file);
        });
    }

    function onDrop(event: DragEvent) {
        event.preventDefault();
        dragging = false;
        if (!event.dataTransfer?.files.length) return;
        dropPoint = canvas?.canvasPoint(event.clientX, event.clientY) ?? null;
        void addFiles(event.dataTransfer.files);
    }

    /**
     * One paste, two possible sources — and this is the only place that can
     * tell them apart, because it is the only place the clipboard's contents
     * are readable.
     *
     * An image from outside wins when there is one: putting a screenshot on the
     * clipboard is a deliberate act aimed at this canvas, where copied layers
     * are also reachable through Ctrl+D. Either way it lands where you are
     * looking rather than at the origin of an infinite canvas.
     */
    function onPaste(event: ClipboardEvent) {
        const target = event.target;
        if (target instanceof Element && target.matches("input, textarea, select, [contenteditable]")) return;

        const files = [...(event.clipboardData?.items ?? [])]
            .filter(item => item.kind === "file" && item.type.startsWith("image/"))
            .map(item => item.getAsFile())
            .filter((f): f is File => !!f);

        if (files.length) {
            event.preventDefault();
            dropPoint = canvas?.pastePoint() ?? null;
            void addFiles(files);
            return;
        }
        if (canvas?.pasteClipboard()) event.preventDefault();
    }

    let dragging = $state(false);

    function setPage(presetId: string) {
        studio.setPage(presetId);
        canvas?.fitAll();
    }

    /** The page a layout needs. Created on demand so nobody has to think about it. */
    function pageFrame() {
        return frames[0] ?? studio.setPage(studio.pagePreset);
    }

    /**
     * Turn pictures into vector shapes.
     *
     * Undoable like anything else, because it is not reversible by eye: a
     * traced photo cannot be traced back, and someone who does not like the
     * result needs a way out that is not "drop it in again".
     */
    async function traceLayers(ids: string[]) {
        const toast = toasts.push(ids.length > 1 ? `Tracing ${ids.length}…` : "Tracing…", "busy");
        let shapes = 0;
        let failure: string | null = null;
        for (const id of ids) {
            const result = await studio.traceToSvg(id);
            if (result.ok) shapes += result.paths ?? 0;
            else failure ??= result.reason ?? null;
        }
        toast.close();
        if (shapes) {
            toasts.push(`Traced into ${shapes} shapes — crisp at any size now.`);
            studio.save();
        } else {
            toasts.push(failure ?? "Nothing could be traced.", "error");
        }
    }

    function undo() {
        if (!collage.undo()) return;
        studio.setSelection(studio.selection);
        studio.save();
        toasts.push("Undone.");
    }

    function applyLayout(mode: LayoutMode) {
        if (!collage.list().length) {
            toasts.push("Nothing to arrange yet — drop some photos in.");
            return;
        }
        const count = studio.arrange(pageFrame().id, mode, { seed: Math.floor(Math.random() * 1000) });
        // A control that reports nothing is indistinguishable from a broken one.
        toasts.push(count ? `Arranged ${count} — ${mode}.` : "Nothing moved — try again?", count ? "info" : "error");
    }

    /** Short, human phrasing. The long version goes to agents, not to a toast. */
    const EXPORT_DONE = {
        png: "Saved the PNG.",
        print: "The print dialogue is open — pick “Save as PDF” for a file.",
        html: "Copied the HTML. Paste it into your site.",
        embed: "Copied a whole page. Save it as .html and host it.",
    } as const;

    async function exportAs(format: "png" | "print" | "html" | "embed") {
        if (!collage.list().length) return;
        const toast = toasts.push("Exporting…", "busy");
        try {
            const output = await studio.exportFrame(pageFrame().id, format, { interactive: true });
            let copied = false;
            if (output.code && (format === "html" || format === "embed")) {
                copied = await navigator.clipboard.writeText(output.code).then(() => true, () => false);
            }
            toast.close();
            const done = copied || format === "png" || format === "print"
                ? EXPORT_DONE[format]
                : "Saved it as a file — it was too big for the clipboard.";
            // A crop is the loudest thing that can happen to an export, so it
            // takes over the message rather than being appended to a cheerful one.
            const cropped = Number((output.structured as { cropped?: number })?.cropped ?? 0);
            toasts.push(
                cropped
                    ? `${done} ${cropped} ${cropped === 1 ? "item was" : "items were"} cut off by the page edge.`
                    : done,
                cropped ? "error" : "info");
        } catch (error) {
            toast.close();
            toasts.push(`Export failed — ${message(error)}`, "error");
        }
    }

    async function clearCanvas() {
        await studio.clear();
        studio.setSelection([]);
        editOpen = false;
        toasts.push("Cleared.");
    }

    // ── The right-click menu ────────────────────────────────────────────────

    function openMenu(info: { x: number; y: number; layerId: string | null }) {
        const layer = info.layerId ? collage.get(info.layerId) : null;
        menuPoint = canvas?.canvasPoint(info.x, info.y) ?? null;
        menu = {
            x: info.x,
            y: info.y,
            items: layer ? layerMenu(layer.id) : canvasMenu(),
        };
    }


    function canvasMenu(): MenuItem[] {
        return [
            { label: "Add images…", icon: "image", onSelect: () => { dropPoint = menuPoint; fileInput?.click(); } },
            { label: "Add text", icon: "text", onSelect: () => addText(menuPoint) },
            // One arrange, not a submenu of seven. The other layouts are still
            // there for an agent through collage_arrange; a person wants the
            // collage look and to try it again if they do not like it.
            {
                label: "Arrange",
                icon: "collage",
                disabled: !layers.length,
                separator: true,
                onSelect: () => applyLayout("collage"),
            },
            { label: "Fit the view", icon: "fit", onSelect: () => canvas?.fitAll() },
            {
                label: "Undo",
                icon: "undo",
                separator: true,
                hint: "⌘Z",
                disabled: !collage.canUndo,
                onSelect: () => undo(),
            },
        ];
    }

    function layerMenu(id: string): MenuItem[] {
        const layer = collage.get(id);
        if (!layer) return canvasMenu();
        const image = layer.kind === "image" ? (layer as ImageLayer) : null;
        // Right-clicking inside a selection acts on all of it.
        const ids = studio.selection.includes(id) && studio.selection.length > 1 ? studio.selection : [id];
        const many = ids.length > 1;
        const suffix = many ? ` (${ids.length})` : "";
        const each = (change: (layerId: string) => void) => () => ids.forEach(change);

        // Right-clicking text is the earliest moment we know a font menu is
        // about to exist, and the specimens are only a preview if they arrive
        // before the submenu opens. Deliberately not awaited: the menu shows
        // now and the faces swap in as they land.
        if (layer.kind === "text") void loadWebFonts();

        return [
            ...(layer.kind === "text"
                ? [
                    {
                        label: "Edit text",
                        icon: "text" as const,
                        hint: "dbl",
                        onSelect: () => canvas?.edit(id),
                    },
                    {
                        label: "Font",
                        icon: "font" as const,
                        separator: true,
                        items: FONTS.map(font => ({
                            label: font.name,
                            icon: "font" as const,
                            font: { stack: font.stack, weight: font.weight },
                            // Weight as well as stack: Display and Body share a
                            // family, so comparing the stack alone ticked both.
                            checked: (layer as TextLayer).fontFamily === font.stack
                                && (layer as TextLayer).fontWeight === font.weight,
                            onSelect: each(l => collage.update(l, { fontFamily: font.stack, fontWeight: font.weight })),
                        })),
                    },
                    {
                        label: "Align",
                        icon: "align" as const,
                        items: (["left", "center", "right"] as const).map(align => ({
                            label: align,
                            icon: "align" as const,
                            checked: (layer as TextLayer).align === align,
                            onSelect: each(l => collage.update(l, { align })),
                        })),
                    },
                ]
                : []),
            ...(image
                ? [
                    {
                        label: `Remove the background${suffix}`,
                        icon: "wand" as const,
                        separator: true,
                        onSelect: () => void recut(ids),
                    },
                    {
                        label: "Silhouette",
                        icon: "silhouette" as const,
                        checked: !!image.style.silhouette,
                        separator: true,
                        // The one under the pointer decides on or off, and the
                        // rest follow — a mixed selection then converges rather
                        // than each item flipping its own way.
                        onSelect: each(layerId => collage.update(layerId, {
                            style: { silhouette: image.style.silhouette ? null : "#222C20" },
                        })),
                    },
                    {
                        label: "Sticker outline",
                        icon: "outline" as const,
                        checked: !!image.style.outline,
                        onSelect: each(layerId => collage.update(layerId, {
                            style: { outline: image.style.outline ? null : { width: 8, color: "#FFFFFF" } },
                        })),
                    },
                    {
                        label: `Trace to shapes${suffix}`,
                        icon: "outline" as const,
                        separator: true,
                        onSelect: () => void traceLayers(ids),
                    },
                    {
                        label: "Drop shadow",
                        icon: "shadow" as const,
                        checked: !!image.style.shadow,
                        onSelect: each(layerId => collage.update(layerId, {
                            style: {
                                shadow: image.style.shadow
                                    ? null
                                    : { x: 0, y: 10, blur: 22, color: "#222C20", opacity: 0.32 },
                            },
                        })),
                    },
                ]
                : []),
            {
                label: `Straighten${suffix}`,
                icon: "rotate",
                separator: true,
                disabled: !ids.some(l => (collage.get(l)?.rotation ?? 0) !== 0),
                onSelect: each(l => collage.update(l, { rotation: 0 })),
            },
            { label: `Bring to front${suffix}`, icon: "front", onSelect: each(l => { collage.bringToFront(l); }) },
            { label: `Send to back${suffix}`, icon: "back", onSelect: each(l => { collage.sendToBack(l); }) },
            {
                label: `Delete${suffix}`,
                icon: "trash",
                danger: true,
                separator: true,
                hint: "⌫",
                onSelect: () => {
                    ids.forEach(layerId => collage.remove(layerId));
                    studio.setSelection([]);
                },
            },
        ];
    }

    async function recut(ids: string[]) {
        const toast = toasts.push(ids.length > 1 ? `Cutting out ${ids.length}…` : "Cutting it out…", "busy");
        let done = 0;
        let failed: string | null = null;
        for (const id of ids) {
            const result = await studio.removeBackgroundFor(id);
            if (result.ok) done++;
            else if (!failed) failed = result.reason ?? null;
        }
        toast.close();
        if (done) toasts.push(done > 1 ? `Cut out ${done}.` : "Cut it out.");
        else {
            // A bubble is a sentence, not a stack trace. The reason names URLs
            // and module errors — that belongs in the console.
            if (failed) console.warn("[collage] background removal failed:", failed);
            toasts.push(shortFailure(failed), "error");
        }
    }

    function addText(near?: { x: number; y: number } | null) {
        const layer = collage.addText({ text: "Text", fontSize: 64, near: near ?? undefined });
        // Straight into editing with the word selected, so the first thing you
        // type replaces it. Better than a placeholder telling you what to do.
        canvas?.edit(layer.id);
    }

    function message(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
</script>

<svelte:window
    onpaste={onPaste}
    onkeydown={event => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
        const target = event.target;
        if (target instanceof Element && target.matches("input, textarea, [contenteditable]")) return;
        // Taking over Ctrl+S: the browser's own "save page" produces an HTML
        // file that cannot be opened again, which is the opposite of what the
        // keystroke means here.
        event.preventDefault();
        void saveToFile();
    }}
/>

<div
    class="page"
    class:page--dropping={dragging}
    role="region"
    aria-label="Collage editor"
    ondragover={e => { e.preventDefault(); dragging = true; }}
    ondragleave={e => { if (e.currentTarget === e.target) dragging = false; }}
    ondrop={onDrop}
>
    <CollageCanvas
        bind:this={canvas}
        {studio}
        showPage={editOpen || studio.pagePreset !== FREE_PAGE}
        onContextMenu={openMenu}
    />

    {#if empty && restored}
        <div class="empty">
            <h1>Collage</h1>
            <p>Drop photos anywhere — their backgrounds come off on the way in.</p>
            <p class="quiet">Right-click for everything else.</p>
        </div>
    {/if}

    <button
        class="trigger"
        class:trigger--open={editOpen}
        data-edit-trigger
        aria-label="Collage options"
        aria-expanded={editOpen}
        onclick={() => (editOpen = !editOpen)}
    >
        <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 6h12M4 10h12M4 14h7" />
        </svg>
    </button>

    <Toasts items={toasts.items} onDismiss={toasts.dismiss} />

    <EditPopover
        {studio}
        open={editOpen}
        {toolsRegistered}
        onSetPage={setPage}
        onSetBackground={background => {
            studio.setPageBackground(background);
            toasts.push(background === "transparent" ? "Background off." : "Background white.");
        }}
        bind:fillBackground
        onArrange={applyLayout}
        onExport={exportAs}
        onClear={clearCanvas}
        onClose={() => (editOpen = false)}
    />

    {#if menu}
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
    {/if}

    <input
        class="file"
        type="file"
        accept="image/*"
        multiple
        bind:this={fileInput}
        onchange={e => {
            const input = e.currentTarget as HTMLInputElement;
            addFiles(input.files ?? []);
            // Let the same file be chosen twice in a row.
            input.value = "";
        }}
    />
</div>

<style>
    /*
     * Fills whatever it is put in rather than claiming the viewport: it is the
     * front page's hero now, not a page of its own. Its chrome is positioned
     * against this box for the same reason — fixed buttons would still be
     * hanging in the corner once someone scrolls past to the registry.
     */
    .page {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    /* A ring rather than an overlay: it says "this is the target" without
       hiding the thing you are aiming at. */
    .page--dropping::after {
        content: "";
        position: absolute;
        inset: 8px;
        border-radius: 18px;
        outline: 2px dashed var(--accent-brand);
        outline-offset: -2px;
        background: color-mix(in srgb, var(--accent-brand) 6%, transparent);
        pointer-events: none;
    }

    .empty {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        text-align: center;
        pointer-events: none;
    }

    .empty h1 {
        margin: 0 0 6px;
        font-family: var(--font-family-display);
        font-size: var(--type-page-title-size);
        font-weight: var(--type-page-title-weight);
        letter-spacing: var(--type-page-title-tracking);
        text-wrap: balance;
    }

    .empty p {
        margin: 0;
        color: var(--text-muted);
        text-wrap: balance;
    }

    .empty .quiet {
        color: color-mix(in srgb, var(--text-muted) 70%, transparent);
        font-size: var(--type-body-muted-size);
    }

    .trigger {
        position: absolute;
        top: 16px;
        right: 16px;
        z-index: 45;
        display: flex;
        align-items: center;
        justify-content: center;
        /* 42px keeps the whole control inside a comfortable pointer target
           without needing a pseudo-element to pad it out. */
        width: 42px;
        height: 42px;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent);
        border-radius: 999px;
        background: var(--surface-panel);
        color: var(--text-primary);
        box-shadow:
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 8px 22px rgba(34, 44, 32, 0.08);
        cursor: pointer;
        transition-property: background, border-color, color, scale;
        transition-duration: 0.16s;
    }

    .trigger:hover {
        background: var(--surface-panel-muted);
        border-color: var(--border-strong);
    }

    .trigger:active {
        scale: 0.96;
    }

    .trigger--open {
        background: var(--accent-brand);
        border-color: transparent;
        color: #14200f;
    }

    .trigger svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.75;
        stroke-linecap: round;
    }

    .file {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
    }
</style>
