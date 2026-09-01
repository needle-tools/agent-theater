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
    import Toasts, { createToasts } from "$lib/collage/Toasts.svelte";
    import { createStudio } from "$lib/collage/studio";
    import { createCollageTools } from "$lib/collage/tools";
    import { type ImageLayer } from "$lib/collage/model";
    import { LAYOUT_MODES, type LayoutMode } from "$lib/collage/layout";
    import { registerTools } from "$lib/webmcp";

    const studio = createStudio();
    const collage = studio.collage;
    const toasts = createToasts();

    let selectedId = $state<string | null>(null);
    let version = $state(0);
    let toolsRegistered = $state(false);
    let editOpen = $state(false);
    let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
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
        toolsRegistered = await registerTools(createCollageTools(studio));
    });

    async function addFiles(files: FileList | File[]) {
        const images = [...files].filter(f => f.type.startsWith("image/"));
        if (!images.length) return;
        const many = images.length > 1;
        const toast = toasts.push(many ? `Cutting out ${images.length} images…` : "Cutting it out…", "busy");
        let cut = 0;
        let failed: string | null = null;
        try {
            for (const [index, file] of images.entries()) {
                if (many) toast.update(`Cutting out ${index + 1} of ${images.length}…`, "busy");
                const url = await readAsDataUrl(file);
                const { background } = await studio.addImage(url, {
                    label: file.name.replace(/\.[^.]+$/, ""),
                    // The whole point of dropping a photo here is the cut-out.
                    removeBackground: true,
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
            }
            toast.close();
            if (failed) {
                // Short here; the long version is in the tool result an agent
                // reads, and in the console for whoever is debugging it.
                console.warn("[collage] background removal unavailable:", failed);
                toasts.push(
                    `Added ${images.length}, but the background remover is unavailable. Cut them at fastcut.needle.tools.`,
                    "error");
            } else {
                toasts.push(cut
                    ? `${cut === 1 ? "Cut it out" : `Cut out ${cut}`} and added.`
                    : `Added ${images.length}.`);
            }
            if (!collage.list().length || !frames.length) canvas?.fitAll();
        } catch (error) {
            toast.close();
            toasts.push(`Could not read that — ${message(error)}`, "error");
        }
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
        if (event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files);
    }

    function onPaste(event: ClipboardEvent) {
        const files = [...(event.clipboardData?.items ?? [])]
            .filter(item => item.kind === "file")
            .map(item => item.getAsFile())
            .filter((f): f is File => !!f);
        if (files.length) void addFiles(files);
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

    function applyLayout(mode: LayoutMode) {
        if (!collage.list().length) {
            toasts.push("Nothing to arrange yet — drop some photos in.");
            return;
        }
        const count = studio.arrange(pageFrame().id, mode, { seed: Math.floor(Math.random() * 1000) });
        if (count) toasts.push(`Arranged ${count} — ${mode}.`);
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
            toasts.push(copied || format === "png" || format === "print"
                ? EXPORT_DONE[format]
                : "Saved it as a file — it was too big for the clipboard.");
        } catch (error) {
            toast.close();
            toasts.push(`Export failed — ${message(error)}`, "error");
        }
    }

    async function clearCanvas() {
        await studio.clear();
        selectedId = null;
        editOpen = false;
        toasts.push("Cleared.");
    }

    // ── The right-click menu ────────────────────────────────────────────────

    function openMenu(info: { x: number; y: number; layerId: string | null }) {
        const layer = info.layerId ? collage.get(info.layerId) : null;
        menu = {
            x: info.x,
            y: info.y,
            items: layer ? layerMenu(layer.id) : canvasMenu(),
        };
    }

    /** Little diagrams, so a layout is recognised before it is read. */
    const LAYOUT_ICONS = {
        grid: "layout", row: "rows", column: "columns",
        ring: "ring", scatter: "scatter", packed: "packed", collage: "collage",
    } as const;

    function canvasMenu(): MenuItem[] {
        return [
            { label: "Add images…", icon: "image", onSelect: () => fileInput?.click() },
            { label: "Add text", icon: "text", onSelect: () => addText() },
            {
                label: "Arrange",
                icon: "layout",
                disabled: !layers.length,
                separator: true,
                items: LAYOUT_MODES.map(mode => ({
                    label: mode,
                    icon: LAYOUT_ICONS[mode],
                    onSelect: () => applyLayout(mode),
                })),
            },
            { label: "Fit the view", icon: "fit", onSelect: () => canvas?.fitAll() },
        ];
    }

    function layerMenu(id: string): MenuItem[] {
        const layer = collage.get(id);
        if (!layer) return canvasMenu();
        const image = layer.kind === "image" ? (layer as ImageLayer) : null;

        return [
            ...(image
                ? [
                    {
                        label: "Remove the background",
                        icon: "wand" as const,
                        onSelect: () => void recut(id),
                    },
                    {
                        label: "Silhouette",
                        icon: "silhouette" as const,
                        checked: !!image.style.silhouette,
                        separator: true,
                        onSelect: () => collage.update(id, {
                            style: { silhouette: image.style.silhouette ? null : "#222C20" },
                        }),
                    },
                    {
                        label: "Sticker outline",
                        icon: "outline" as const,
                        checked: !!image.style.outline,
                        onSelect: () => collage.update(id, {
                            style: { outline: image.style.outline ? null : { width: 8, color: "#FFFFFF" } },
                        }),
                    },
                    {
                        label: "Drop shadow",
                        icon: "shadow" as const,
                        checked: !!image.style.shadow,
                        onSelect: () => collage.update(id, {
                            style: {
                                shadow: image.style.shadow
                                    ? null
                                    : { x: 0, y: 10, blur: 22, color: "#222C20", opacity: 0.32 },
                            },
                        }),
                    },
                ]
                : []),
            { label: "Bring to front", icon: "front", separator: true, onSelect: () => collage.bringToFront(id) },
            { label: "Send to back", icon: "back", onSelect: () => collage.sendToBack(id) },
            {
                label: "Delete",
                icon: "trash",
                danger: true,
                separator: true,
                hint: "⌫",
                onSelect: () => {
                    collage.remove(id);
                    if (selectedId === id) selectedId = null;
                },
            },
        ];
    }

    async function recut(id: string) {
        const layer = collage.get(id);
        busy = true;
        status = `Cutting out "${layer?.label ?? id}"…`;
        const result = await studio.removeBackgroundFor(id);
        status = result.ok ? `Cut out "${layer?.label ?? id}".` : (result.reason ?? "That did not work.");
        busy = false;
    }

    function addText() {
        const layer = collage.addText({ text: "Double-click to rename", fontSize: 64 });
        selectedId = layer.id;
        status = "Added a text layer.";
    }

    function message(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
</script>

<svelte:head>
    <title>Collage — Needle WebMCP</title>
    <meta name="description" content="Build collages from cut-out images on an infinite canvas, and export them as a print page, an image, or code for your website." />
</svelte:head>

<svelte:window onpaste={onPaste} />

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
        bind:selectedId
        showPage={editOpen}
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
    .page {
        position: relative;
        height: 100svh;
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
        position: fixed;
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
