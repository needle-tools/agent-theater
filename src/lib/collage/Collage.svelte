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
    import EditPopover from "$lib/collage/EditPopover.svelte";
    import ShowOverlay from "$lib/collage/ShowOverlay.svelte";
    import StageBar from "$lib/collage/StageBar.svelte";
    import Toasts, { createToasts, LIFETIME } from "$lib/collage/Toasts.svelte";
    import { createStudio, download, FREE_PAGE } from "$lib/collage/studio";
    import { createCollageTools } from "$lib/collage/tools";
    import { registerTools } from "$lib/webmcp";
    import { invitation } from "$lib/collage/invitation";

    const studio = createStudio();
    const collage = studio.collage;
    const toasts = createToasts();

    let version = $state(0);
    let toolsRegistered = $state(false);
    let editOpen = $state(false);
    let canvas = $state<CollageCanvas | null>(null);
    let fileInput: HTMLInputElement | null = $state(null);
    let restored = $state(false);

    $effect(() => collage.onChanged(() => version++));

    /*
     * Say so when the show is going to be silent.
     *
     * The browser refuses audio until the person has interacted with the page,
     * and an agent can start a show on a page nobody has touched — so the one
     * time this matters is also the one time there is nobody to notice. Said
     * once per page load: a bubble on every scene change would be worse than
     * the silence.
     */
    let warnedSilent = false;
    $effect(() => studio.onShowChanged(() => {
        if (!studio.showing || warnedSilent || studio.speaker.ready) return;
        warnedSilent = true;
        toasts.push("Click anywhere to turn the sound on — the browser keeps it off until you do.");
    }));

    const layers = $derived.by(() => (version, collage.list()));
    const frames = $derived.by(() => (version, collage.listFrames()));
    const empty = $derived(!layers.length && !frames.length);

    onMount(async () => {
        prompt = invitation(location.origin);

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

    // The page's own sentence, shown on the empty stage. Same string the help
    // panel offers, from the same place, so they cannot say different things.
    let prompt = $state(invitation("https://webmcp.needle.tools"));
    let copiedInvite = $state(false);

    async function copyInvitation() {
        await navigator.clipboard.writeText(prompt);
        copiedInvite = true;
        setTimeout(() => (copiedInvite = false), 1800);
    }

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

    /*
     * There is no right-click menu any more.
     *
     * It was the collage editor's: fonts, alignment, tracing to vector, sticker
     * outlines, drop shadows, arranging. Real features, none of them anything to
     * do with putting on a play — and every one of them a thing to read past
     * while looking for the one you wanted.
     *
     * What a person genuinely does to a picture on a stage is move it, resize
     * it, turn it, order it and delete it, and all of those are on the pointer
     * or the keyboard already. See onKeyDown in CollageCanvas.
     */



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
    aria-label="Theater"
    ondragover={e => { e.preventDefault(); dragging = true; }}
    ondragleave={e => { if (e.currentTarget === e.target) dragging = false; }}
    ondrop={onDrop}
>
    <CollageCanvas
        bind:this={canvas}
        {studio}
        showPage={editOpen || studio.pagePreset !== FREE_PAGE}
    />

    <!-- The house lights, before anything is on. Kept mounted and faded rather
         than added and removed, so the first picture dropped in does not make
         the light behind it blink out. -->
    <div class="houselights" class:houselights--off={!empty} aria-hidden="true"></div>

    {#if empty && restored}
        <!-- The description is the instruction. There is nothing on this stage
             until somebody directs it, so the honest thing to say about the
             page is also the thing you hand an agent — printed large enough to
             read and copy rather than hidden behind a button. -->
        <div class="empty">
            <h1>An empty stage</h1>
            <p class="invite">{prompt}</p>
            <div class="empty__actions">
                <button class="empty__cta" onclick={copyInvitation}>
                    {copiedInvite ? "Copied" : "Copy prompt"}
                </button>
            </div>
        </div>
    {/if}

    <button
        class="trigger"
        class:trigger--open={editOpen}
        data-edit-trigger
        aria-label="Theater options"
        aria-expanded={editOpen}
        onclick={() => (editOpen = !editOpen)}
    >
        <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 6h12M4 10h12M4 14h7" />
        </svg>
    </button>

    <!-- The auditorium: vignette, title card, credits. Nothing while the
         canvas is being worked on. -->
    <ShowOverlay {studio} />

    <!-- Only draws itself once there are scenes, so the canvas is a canvas
         until somebody makes it a theatre. -->
    <StageBar {studio} />

    <Toasts items={toasts.items} onDismiss={toasts.dismiss} />

    <EditPopover
        {studio}
        open={editOpen}
        {toolsRegistered}
        onSave={saveToFile}
        onLoad={() => {
            // The same input the canvas uses: a saved play and a photo arrive
            // the same way, and addFiles already tells them apart by looking
            // inside rather than by trusting the extension.
            dropPoint = null;
            fileInput?.click();
        }}
        onClear={clearCanvas}
        onClose={() => (editOpen = false)}
    />

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

    /*
     * A warm pool of light in the middle of an empty stage.
     *
     * The canvas is a wide flat sheet of paper until somebody puts something on
     * it, and a wide flat sheet of paper does not look like a theatre. This is
     * the cheapest thing that does: light falling from above onto the middle of
     * the boards, with the edges going warm and dark the way the sides of a
     * stage do.
     *
     * It goes when the play arrives. A show has its own vignette and its own
     * darkening, and two of them stacked would just be murk.
     */
    .houselights {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background:
            radial-gradient(
                ellipse 62% 52% at 50% 38%,
                color-mix(in srgb, #FFF6E2 85%, transparent) 0%,
                transparent 68%),
            radial-gradient(
                ellipse 96% 90% at 50% 44%,
                transparent 42%,
                color-mix(in srgb, #6B5A44 12%, transparent) 88%,
                color-mix(in srgb, #4A3D2E 20%, transparent) 100%);
        opacity: 1;
        transition: opacity 0.8s cubic-bezier(0.2, 0, 0, 1);
    }

    .houselights--off {
        opacity: 0;
    }

    :global(:root[data-theme="dark"]) .houselights {
        background:
            radial-gradient(
                ellipse 62% 52% at 50% 38%,
                color-mix(in srgb, #FFE3AE 12%, transparent) 0%,
                transparent 66%),
            radial-gradient(
                ellipse 96% 90% at 50% 44%,
                transparent 40%,
                rgba(0, 0, 0, 0.34) 88%,
                rgba(0, 0, 0, 0.52) 100%);
    }

    @media (prefers-reduced-motion: reduce) {
        .houselights { transition-duration: 0s; }
    }

    .empty {
        position: absolute;
        inset: 0;
        z-index: 2;
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
        max-width: 30rem;
        padding: 0 1.5rem;
        color: var(--text-secondary);
        text-wrap: pretty;
    }

    /* The sentence itself: the largest thing after the heading, because it is
       what the page is for. Not selectable, deliberately — it sits in the
       middle of the canvas, and a drag that started on it would highlight text
       instead of panning. The Copy button is how you take it. */
    .empty .invite {
        max-width: 34rem;
        margin-top: 4px;
        color: var(--text-primary);
        font-size: var(--type-body-size);
        line-height: 1.5;
    }

    .empty__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 16px;
        /* The heading and paragraphs above are decoration; these two are not. */
        pointer-events: auto;
    }

    .empty__cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 38px;
        padding: 0 0.9rem;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
        background: var(--surface-panel);
        color: var(--text-primary);
        font: inherit;
        font-size: var(--type-body-muted-size);
        text-decoration: none;
        cursor: pointer;
        transition-property: background, border-color, color, scale;
        transition-duration: 0.14s;
    }

    .empty__cta {
        border-color: transparent;
        background: var(--accent-brand);
        color: #14200f;
        font-weight: 600;
    }

    .empty__cta:hover {
        background: var(--accent-brand-deep, var(--accent-brand));
    }

    .empty__cta:active {
        scale: 0.96;
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
