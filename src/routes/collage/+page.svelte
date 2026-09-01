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
    import { createStudio } from "$lib/collage/studio";
    import { createCollageTools } from "$lib/collage/tools";
    import { FRAME_PRESETS, type ImageLayer } from "$lib/collage/model";
    import { LAYOUT_MODES, type LayoutMode } from "$lib/collage/layout";
    import { registerTools } from "$lib/webmcp";

    const studio = createStudio();
    const collage = studio.collage;

    let selectedId = $state<string | null>(null);
    let version = $state(0);
    let status = $state("");
    let busy = $state(false);
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
                status = `Restored ${count} layer${count === 1 ? "" : "s"} from your last session.`;
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
        busy = true;
        let cut = 0;
        let failed: string | null = null;
        try {
            for (const [index, file] of images.entries()) {
                status = images.length > 1
                    ? `Cutting out ${index + 1} of ${images.length}…`
                    : `Cutting out ${file.name}…`;
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
                            status = `Downloading the background remover… ${pct}%`;
                        }
                    },
                });
                if (background.ok) cut++;
                else if (!background.skipped && !failed) failed = background.reason ?? null;
            }
            status = failed
                ? `Added ${images.length} image${images.length > 1 ? "s" : ""}. ${failed}`
                : `Added ${images.length} image${images.length > 1 ? "s" : ""}${cut ? `, ${cut} cut out` : ""}.`;
            if (frames.length === 0) canvas?.fitAll();
        } catch (error) {
            status = `Could not read that: ${message(error)}`;
        } finally {
            busy = false;
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

    function addFrame(presetId: string) {
        const frame = studio.addFrame({ presetId }, true);
        status = `Added "${frame.name}".`;
        canvas?.fitAll();
    }

    function applyLayout(mode: LayoutMode) {
        const frame = frames[0];
        if (!frame) return;
        const count = studio.arrange(frame.id, mode, { seed: Math.floor(Math.random() * 1000) });
        status = count ? `Arranged ${count} layers as a ${mode}.` : "Nothing inside the frame yet.";
    }

    async function exportAs(format: "png" | "print" | "html" | "embed") {
        const frame = frames[0];
        if (!frame) return;
        busy = true;
        status = "Exporting…";
        try {
            const output = await studio.exportFrame(frame.id, format, { interactive: true });
            if (output.code && (format === "html" || format === "embed")) {
                await navigator.clipboard.writeText(output.code).catch(() => {});
                status = `${output.summary} Copied to the clipboard.`;
            } else {
                status = output.summary;
            }
        } catch (error) {
            status = `Export failed: ${message(error)}`;
        } finally {
            busy = false;
        }
    }

    async function clearCanvas() {
        await studio.clear();
        selectedId = null;
        editOpen = false;
        status = "Cleared.";
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
        ring: "ring", scatter: "scatter", packed: "packed",
    } as const;

    function canvasMenu(): MenuItem[] {
        return [
            { label: "Add images…", icon: "image", onSelect: () => fileInput?.click() },
            { label: "Add text", icon: "text", onSelect: () => addText() },
            {
                label: "Add frame",
                icon: "frame",
                items: FRAME_PRESETS.map(preset => {
                    const size = preset.physical ?? preset.output ?? { width: 1, height: 1 };
                    return {
                        label: preset.name,
                        // The icon is the paper: a portrait preset draws a tall
                        // rectangle, a social card a wide one. You can pick the
                        // shape you want without reading a single word.
                        iconAspect: size.width / size.height,
                        onSelect: () => addFrame(preset.id),
                    };
                }),
            },
            {
                label: "Arrange",
                icon: "layout",
                disabled: !frames.length || !layers.length,
                items: LAYOUT_MODES.map(mode => ({
                    label: mode,
                    icon: LAYOUT_ICONS[mode],
                    onSelect: () => applyLayout(mode),
                })),
            },
            { label: "Fit the view", icon: "fit", separator: true, onSelect: () => canvas?.fitAll() },
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
    <CollageCanvas bind:this={canvas} {studio} bind:selectedId onContextMenu={openMenu} />

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

    {#if busy}
        <p class="toast" aria-live="polite">{status}</p>
    {:else if status && !editOpen}
        <p class="toast toast--quiet" aria-live="polite">{status}</p>
    {/if}

    <EditPopover
        {studio}
        open={editOpen}
        {status}
        {toolsRegistered}
        onStatus={text => (status = text)}
        onAddFrame={addFrame}
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

    .toast {
        position: fixed;
        left: 50%;
        bottom: 18px;
        z-index: 30;
        translate: -50% 0;
        margin: 0;
        max-width: min(560px, calc(100vw - 32px));
        padding: 9px 14px;
        border-radius: 999px;
        background: var(--surface-panel);
        color: var(--text-secondary);
        font-size: var(--type-body-muted-size);
        text-wrap: pretty;
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--border-subtle) 60%, transparent),
            0 8px 22px rgba(34, 44, 32, 0.10);
        animation: toast-in 0.2s cubic-bezier(0.2, 0, 0, 1);
    }

    /* Softer than the enter, and it does not shout when nothing is happening. */
    .toast--quiet {
        opacity: 0.75;
    }

    @keyframes toast-in {
        from { opacity: 0; translate: -50% 6px; }
        to { opacity: 1; translate: -50% 0; }
    }

    @media (prefers-reduced-motion: reduce) {
        .toast { animation: none; }
    }

    .file {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
    }
</style>
