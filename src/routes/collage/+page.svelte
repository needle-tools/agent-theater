<script lang="ts">
    /**
     * The collage page.
     *
     * Two ways in, one document. A person drops images, drags them around and
     * hits export; an agent calls the WebMCP tools. Neither is a wrapper around
     * the other — they both mutate the same `Collage`, so an agent can arrange
     * what a person dropped, and a person can fix what an agent arranged.
     */
    import { onMount } from "svelte";
    import CollageCanvas from "$lib/collage/CollageCanvas.svelte";
    import { createStudio } from "$lib/collage/studio";
    import { createCollageTools } from "$lib/collage/tools";
    import { FRAME_PRESETS, outputSize, type ImageLayer } from "$lib/collage/model";
    import { LAYOUT_MODES, type LayoutMode } from "$lib/collage/layout";
    import { checkFrame } from "$lib/collage/quality";
    import { registerTools } from "$lib/webmcp";

    const studio = createStudio();
    const collage = studio.collage;

    let selectedId = $state<string | null>(null);
    let version = $state(0);
    let presetId = $state("a4-portrait");
    let busy = $state("");
    let status = $state("");
    let toolsRegistered = $state(false);
    let canvas = $state<CollageCanvas | null>(null);

    $effect(() => collage.onChanged(() => version++));

    const frames = $derived.by(() => (version, collage.listFrames()));
    const layers = $derived.by(() => (version, collage.list()));
    const activeFrame = $derived(frames[0] ?? null);
    const selected = $derived.by(() => (version, selectedId ? collage.get(selectedId) : null));
    const selectedImage = $derived(selected?.kind === "image" ? (selected as ImageLayer) : null);
    const quality = $derived.by(() =>
        (version, activeFrame ? checkFrame(collage.layersIn(activeFrame.id), activeFrame) : null));

    onMount(async () => {
        toolsRegistered = await registerTools(createCollageTools(studio));
    });

    async function addFiles(files: FileList | File[]) {
        const images = [...files].filter(f => f.type.startsWith("image/"));
        if (!images.length) return;
        busy = `Reading ${images.length} image${images.length > 1 ? "s" : ""}…`;
        try {
            for (const file of images) {
                const dataUrl = await readAsDataUrl(file);
                await studio.addImage(dataUrl, { label: file.name.replace(/\.[^.]+$/, "") });
            }
            status = `Added ${images.length} image${images.length > 1 ? "s" : ""}.`;
        } catch (error) {
            status = `Could not read that: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
            busy = "";
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
        if (event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files);
    }

    function onPaste(event: ClipboardEvent) {
        const files = [...(event.clipboardData?.items ?? [])]
            .filter(item => item.kind === "file")
            .map(item => item.getAsFile())
            .filter((f): f is File => !!f);
        if (files.length) void addFiles(files);
    }

    function addFrame() {
        const frame = studio.addFrame({ presetId }, true);
        status = `Added "${frame.name}".`;
        canvas?.fitAll();
    }

    function applyLayout(mode: LayoutMode) {
        if (!activeFrame) return;
        const count = studio.arrange(activeFrame.id, mode, { seed: Math.floor(Math.random() * 1000) });
        status = count ? `Arranged ${count} layers as a ${mode}.` : "Nothing inside the frame yet.";
    }

    async function exportAs(format: "png" | "print" | "html" | "embed") {
        if (!activeFrame) return;
        busy = "Exporting…";
        try {
            const output = await studio.exportFrame(activeFrame.id, format, { interactive: true });
            if (output.code && (format === "html" || format === "embed")) {
                await navigator.clipboard.writeText(output.code).catch(() => {});
                status = `${output.summary} Copied to the clipboard.`;
            } else {
                status = output.summary;
            }
        } catch (error) {
            status = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
            busy = "";
        }
    }

    function style(patch: object) {
        if (selectedId) collage.update(selectedId, { style: patch });
    }
</script>

<svelte:head>
    <title>Collage — Needle WebMCP</title>
    <meta name="description" content="Build collages from cut-out images on an infinite canvas, and export them as a print page, an image, or code for your website." />
</svelte:head>

<svelte:window onpaste={onPaste} />

<div class="page" ondragover={e => e.preventDefault()} ondrop={onDrop} role="region" aria-label="Collage editor">
    <aside class="panel">
        <header class="panel__head">
            <h1>Collage</h1>
            <p class="muted">
                Drop cut-outs on the canvas. Add a frame to say what you are making. Export it as
                a page, an image, or code.
            </p>
        </header>

        <section>
            <h2>Images</h2>
            <label class="file">
                <input type="file" accept="image/*" multiple onchange={e => addFiles((e.currentTarget as HTMLInputElement).files ?? [])} />
                <span>Choose images…</span>
            </label>
            <p class="hint">or drop them anywhere, or paste from the clipboard</p>
        </section>

        <section>
            <h2>Frame</h2>
            <div class="row">
                <select bind:value={presetId} aria-label="Frame preset">
                    {#each FRAME_PRESETS as preset (preset.id)}
                        <option value={preset.id}>{preset.name}</option>
                    {/each}
                </select>
                <button onclick={addFrame}>Add</button>
            </div>
            {#if activeFrame}
                {@const size = outputSize(activeFrame)}
                <p class="hint">
                    “{activeFrame.name}” exports at {size.width}×{size.height}px{activeFrame.physical
                        ? ` — ${activeFrame.physical.width}×${activeFrame.physical.height}mm at 300 dpi`
                        : ""}.
                </p>
            {/if}
        </section>

        <section>
            <h2>Arrange</h2>
            <div class="chips">
                {#each LAYOUT_MODES as mode (mode)}
                    <button class="chip" disabled={!activeFrame} onclick={() => applyLayout(mode)}>{mode}</button>
                {/each}
            </div>
        </section>

        {#if selectedImage}
            <section>
                <h2>Selected cut-out</h2>
                <div class="chips">
                    <button class="chip" onclick={() => style({ shadow: selectedImage.style.shadow ? null : { x: 0, y: 10, blur: 22, color: "#222C20", opacity: 0.32 } })}>
                        {selectedImage.style.shadow ? "remove shadow" : "shadow"}
                    </button>
                    <button class="chip" onclick={() => style({ outline: selectedImage.style.outline ? null : { width: 8, color: "#FFFFFF" } })}>
                        {selectedImage.style.outline ? "remove outline" : "sticker outline"}
                    </button>
                    <button class="chip" onclick={() => style({ silhouette: selectedImage.style.silhouette ? null : "#222C20" })}>
                        {selectedImage.style.silhouette ? "show image" : "silhouette"}
                    </button>
                </div>
            </section>
        {/if}

        <section>
            <h2>Export</h2>
            <div class="chips">
                <button class="chip" disabled={!activeFrame} onclick={() => exportAs("png")}>PNG</button>
                <button class="chip" disabled={!activeFrame} onclick={() => exportAs("print")}>Print / PDF</button>
                <button class="chip" disabled={!activeFrame} onclick={() => exportAs("html")}>Copy HTML</button>
                <button class="chip" disabled={!activeFrame} onclick={() => exportAs("embed")}>Embed page</button>
            </div>
            {#if quality?.summary}
                <p class="warn">{quality.summary}</p>
            {/if}
        </section>

        <footer class="panel__foot">
            <p class="hint">
                {#if toolsRegistered}
                    WebMCP tools registered — an agent in this tab can build the collage with you.
                {:else}
                    WebMCP is not available in this browser, so the agent tools are off. The editor works regardless.
                {/if}
            </p>
            <p class="status" aria-live="polite">{busy || status}</p>
        </footer>
    </aside>

    <div class="stage">
        <CollageCanvas bind:this={canvas} {studio} bind:selectedId />
        <p class="count">{layers.length} layer{layers.length === 1 ? "" : "s"}</p>
    </div>
</div>

<style>
    .page {
        display: grid;
        grid-template-columns: 320px 1fr;
        height: 100svh;
    }

    .panel {
        display: flex;
        flex-direction: column;
        gap: var(--space-section-gap, 20px);
        padding: 20px;
        overflow-y: auto;
        background: var(--surface-panel);
        border-right: 1px solid var(--border-subtle);
    }

    .panel__head h1 {
        margin: 0 0 6px;
        font-family: var(--font-family-display);
        font-size: var(--type-page-title-size);
        font-weight: var(--type-page-title-weight);
    }

    .panel__foot {
        margin-top: auto;
    }

    h2 {
        margin: 0 0 8px;
        font-size: var(--type-label-size);
        font-weight: var(--type-label-weight);
        letter-spacing: var(--type-label-tracking);
        text-transform: uppercase;
        color: var(--text-muted);
    }

    .muted, .hint {
        margin: 0;
        color: var(--text-muted);
        font-size: var(--type-body-muted-size);
        line-height: var(--type-body-muted-line-height);
    }

    .hint {
        margin-top: 8px;
    }

    .warn {
        margin: 10px 0 0;
        padding: 8px 10px;
        border-radius: var(--radius-control);
        background: color-mix(in srgb, var(--accent-highlight) 18%, transparent);
        color: var(--text-primary);
        font-size: var(--type-body-muted-size);
    }

    .status {
        margin: 8px 0 0;
        min-height: 1.2em;
        color: var(--text-secondary);
        font-size: var(--type-body-muted-size);
    }

    .row {
        display: flex;
        gap: 8px;
    }

    .row select {
        flex: 1;
        min-width: 0;
    }

    select, button, .file span {
        min-height: 34px;
        padding: 0 12px;
        border-radius: var(--radius-control);
        border: 1px solid var(--border-subtle);
        background: var(--surface-page-elevated, #fff);
        color: var(--text-primary);
        font: inherit;
        font-size: var(--type-body-muted-size);
        cursor: pointer;
        transition: background 0.16s, border-color 0.16s, scale 0.16s;
    }

    button:hover:not(:disabled), .file:hover span {
        border-color: var(--border-strong);
        background: var(--surface-panel-muted);
    }

    button:active:not(:disabled) {
        scale: 0.97;
    }

    button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .chip {
        min-height: 30px;
        padding: 0 10px;
        border-radius: var(--radius-pill);
    }

    .file {
        display: block;
    }

    .file input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
    }

    .file span {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    /* Keyboard users must still see the focus ring the input would have had. */
    .file:focus-within span {
        outline: 2px solid var(--border-focus);
        outline-offset: 2px;
    }

    .stage {
        position: relative;
        min-width: 0;
    }

    .count {
        position: absolute;
        left: 14px;
        bottom: 12px;
        margin: 0;
        color: var(--text-muted);
        font-size: var(--type-micro-label-size);
        pointer-events: none;
    }

    @media (max-width: 760px) {
        .page {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
        }

        .panel {
            border-right: 0;
            border-bottom: 1px solid var(--border-subtle);
            max-height: 45svh;
        }
    }
</style>
