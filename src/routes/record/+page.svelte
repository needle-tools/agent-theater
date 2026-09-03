<script lang="ts">
    /**
     * The motion recording workbench.
     *
     * Recording lived inside the theatre's menu, armed from a popover and
     * performed on the working canvas — which meant recording a gesture
     * fought everything else the canvas does (selection, panning, the
     * eraser), and eventually lost. Here it has a room of its own, the same
     * way /painted does for the paint: one character on a paddock, a record
     * button, and nothing else to argue with.
     *
     * Clips saved here land in the same localStorage drawer the theatre
     * reads (`clips.ts`), so a gesture recorded on this page is immediately
     * a move every agent can use in a beat: do: "clip:<name>".
     */
    import { onMount } from "svelte";
    import {
        clipExtent, clipFromSamples, clipName, clipPreviewKeyframes, clipToCss,
        deleteClip, listClips, saveClip,
        TALK_CLIP, SWAY_CLIP,
        type Clip, type ClipSample,
    } from "$lib/collage/clips";
    import { TROUPE } from "$lib/collage/troupe";
    import { createSpeaker, MENU_MUSIC_LEVEL, takeNames } from "$lib/collage/audio";
    import { prompter } from "$lib/collage/speech";

    /** A handful of troupe actors to perform the previews. */
    const performers = TROUPE.filter(piece => piece.kind === "actor");
    const performerFor = (at: number) =>
        performers.length ? performers[at % performers.length].file : "";

    /**
     * Who stands in the paddock: re-dealt every time the recorder arms, so
     * each take is danced with somebody new. The clip remembers its partner
     * (`performer`) and the gallery shows the take on exactly that artwork.
     */
    let heroAt = $state(0);
    const redealHero = () => {
        if (performers.length > 1) {
            heroAt = (heroAt + 1 + Math.floor(Math.random() * (performers.length - 1))) % performers.length;
        }
    };

    let clips = $state<Clip[]>([]);
    let armed = $state(false);
    let pending = $state<Clip | null>(null);
    let takeName = $state("");
    let note = $state("");
    const NAME_HINT = `name it — or "talk" / "sway"`;

    onMount(() => {
        clips = listClips();
        // After hydration, so the server and the first client render agree
        // on who stands in the paddock before the deal shuffles them.
        redealHero();
    });

    /**
     * The same house music the theatre plays, in this room too.
     *
     * A workbench is a place somebody sits for a while, so it gets the bed
     * rather than the silence. One speaker, owned by this page and stopped
     * when the page goes — the theatre does the same, and between them that
     * is what keeps a single bed playing across a navigation instead of two.
     */
    const HOUSE_BEDS = takeNames("menu-theatre");
    const speaker = createSpeaker();
    $effect(() => {
        if (!HOUSE_BEDS.length) return;
        const start = () => speaker.playlist(HOUSE_BEDS, MENU_MUSIC_LEVEL);
        // The browser refuses audio before the first gesture, exactly as on
        // the theatre page; wait for it rather than being refused.
        const stopWaiting = prompter.touched ? (start(), null) : prompter.onTouch(start);
        return () => {
            stopWaiting?.();
            speaker.stop();
        };
    });

    /** The demo character being dragged around the paddock. */
    let hero = $state({ x: 120, y: 140 });
    const HOME = { x: 120, y: 140 };
    let heroEl: HTMLElement | null = $state(null);
    let dragging: { fromX: number; fromY: number; heroX: number; heroY: number } | null = null;
    let samples: ClipSample[] = [];

    function down(event: PointerEvent) {
        event.preventDefault();
        // Throws when the pointer is not genuinely down — synthetic events,
        // some pens. Losing capture costs only a drag that ends off the
        // element; throwing here would eat the whole take.
        try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch { /* carry on without capture */ }
        dragging = { fromX: event.clientX, fromY: event.clientY, heroX: hero.x, heroY: hero.y };
        if (armed) samples = [{ at: performance.now(), x: event.clientX, y: event.clientY }];
    }

    function move(event: PointerEvent) {
        if (!dragging) return;
        hero = {
            x: dragging.heroX + (event.clientX - dragging.fromX),
            y: dragging.heroY + (event.clientY - dragging.fromY),
        };
        if (armed) samples.push({ at: performance.now(), x: event.clientX, y: event.clientY });
    }

    function up() {
        if (!dragging) return;
        dragging = null;
        // The gesture is stored relative to the performer's height, so it
        // replays proportionally on a mouse and on an oak.
        const size = heroEl?.getBoundingClientRect().height ?? 120;
        if (armed && samples.length > 3) {
            const clip = clipFromSamples("take", samples, size);
            if (clip) {
                // The take remembers who danced it, so the gallery can show
                // the recording on the artwork it was performed with.
                pending = { ...clip, performer: performerFor(heroAt) };
                takeName = "";
                note = "";
            } else {
                note = "Too short — hold the gesture for at least a third of a second.";
            }
            armed = false;
        }
        samples = [];
        // Drift is removed from the clip anyway; the performer walks home so
        // the next take starts from the same mark.
        hero = { ...HOME };
    }

    function keep() {
        if (!pending) return;
        const name = clipName(takeName || "take");
        saveClip({ ...pending, name });
        pending = null;
        clips = listClips();
        note = name === TALK_CLIP
            ? `Saved as "${TALK_CLIP}" — every speaker in every play now talks with this gesture.`
            : name === SWAY_CLIP
                ? `Saved as "${SWAY_CLIP}" — it replaces the idle sway.`
                : `Saved. Agents can play it with do: "clip:${name}".`;
    }

    function drop(name: string) {
        deleteClip(name);
        clips = listClips();
    }

    /**
     * The confirmation lives in the TOOLTIP: after a copy, the button's
     * title says "Copied!" for a moment, right where the pointer already is.
     */
    let copiedKey = $state("");

    async function copy(text: string, key: string) {
        await navigator.clipboard.writeText(text);
        copiedKey = key;
        setTimeout(() => {
            if (copiedKey === key) copiedKey = "";
        }, 1600);
    }

    /**
     * The whole drawer as one file, for baking recordings into the shipped
     * library (clipLibrary.ts is generated from exactly this export).
     */
    function exportDrawer() {
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(new Blob(
            [JSON.stringify(clips)], { type: "application/json" }));
        anchor.download = "clips-export.json";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        note = `Exported ${clips.length} clips to your downloads.`;
    }

    /**
     * A preview performer looping a clip — the gesture as PERFORMED, travel
     * included (in a play the drift-free form rides a walk instead). When the
     * journey is bigger than the card, the whole motion scales down to fit
     * rather than running out of the box.
     */
    function performs(element: HTMLElement, clip: Clip) {
        let animation: Animation | null = null;
        const start = () => {
            animation?.cancel();
            const rect = element.getBoundingClientRect();
            const room = element.parentElement?.getBoundingClientRect();
            const bounds = clipExtent(clip);
            const spanX = bounds.maxX - bounds.minX;
            const spanY = bounds.maxY - bounds.minY;
            let size = rect.height || 90;
            if (room) {
                if (spanX > 0.01) size = Math.min(size, Math.max(0, room.width - rect.width) / spanX);
                if (spanY > 0.01) size = Math.min(size, Math.max(0, room.height - rect.height) / spanY);
            }
            // The performer starts centred; shift the whole motion so its
            // bounding box is what sits centred instead, and a one-way run
            // uses the full card rather than half of it.
            const origin = {
                dx: -(bounds.minX + bounds.maxX) / 2,
                dy: -(bounds.minY + bounds.maxY) / 2,
            };
            animation = element.animate(clipPreviewKeyframes(clip, size, origin), {
                duration: Math.max(400, clip.seconds * 1000),
                iterations: Infinity,
                easing: "linear",
            });
        };
        // After layout, so the measured height is real. A timeout rather
        // than requestAnimationFrame: rAF never fires in a hidden tab, and a
        // gallery opened in the background would arrive still.
        setTimeout(start, 0);
        return {
            update(next: Clip) {
                clip = next;
                start();
            },
            destroy() {
                animation?.cancel();
            },
        };
    }
</script>

<svelte:head>
    <title>Motion recorder — Needle × WebMCP Theater</title>
</svelte:head>

<main>
    <header class="top">
        <div>
            <h1>Motion recorder</h1>
            <p class="lede">
                Press record, then drag the character — the drag is the performance.
                Clips are stored relative to the performer's size and land in this browser's
                drawer, where every play can use them the moment they are saved:
                <code>do: "clip:&lt;name&gt;"</code> — an agent directing in another tab
                is told about a new recording in its very next tool reply.
                Two names are special: <code>talk</code> plays on whoever speaks,
                <code>sway</code> replaces the idle breath.
            </p>
        </div>
        <a class="back" href="/">← back to the theatre</a>
    </header>

    <div class="workbench">
        <!-- The recording side: one column, one character, one button. The
             paddock is deliberately NOT the wide part of the page — a gesture
             is performed in a hand's-width of space, and the interesting area
             is the shelf of results next to it. -->
        <div class="side">
        <section class="paddock" class:paddock--armed={armed}>
            {#if performers.length}
                <img
                    class="hero"
                    bind:this={heroEl}
                    src={performerFor(heroAt)}
                    alt="the performer"
                    draggable="false"
                    style:left="{hero.x}px"
                    style:top="{hero.y}px"
                    onpointerdown={down}
                    onpointermove={move}
                    onpointerup={up}
                    onpointercancel={up}
                />
            {:else}
                <p class="empty">No troupe installed — nothing to perform with.</p>
            {/if}
            <button class="record" class:record--armed={armed} onclick={() => {
                armed = !armed;
                if (armed) redealHero();
            }}>
                <img src="/toolbar/record-button.webp" alt="" />
                <span>{armed ? "Armed — drag, release to finish" : "Record a movement"}</span>
            </button>
        </section>
        <button class="export quiet" onclick={exportDrawer}>Export all animations to JSON</button>
        </div>

        <section class="results">
            {#if pending}
                <div class="take">
                    <strong>Got it — {pending.seconds.toFixed(2)}s.</strong>
                    <input
                        placeholder={NAME_HINT}
                        bind:value={takeName}
                        onkeydown={event => event.key === "Enter" && keep()}
                    />
                    <button onclick={keep}>Keep</button>
                    <button class="quiet" onclick={() => (pending = null)}>Discard</button>
                </div>
            {/if}
            {#if note}<p class="note">{note}</p>{/if}

            <div class="gallery">
                {#each clips as clip, at (clip.name)}
                    <article class="card">
                        <div class="stage">
                            <!-- The artwork the take was danced with, when the
                                 clip remembers; the dealt stand-ins otherwise
                                 (shipped clips and old takes predate the memory). -->
                            <img
                                src={clip.performer ?? performerFor(at + 1)}
                                alt=""
                                draggable="false"
                                use:performs={clip}
                            />
                        </div>
                        <footer>
                            <span class="card__name">
                                <strong>{clip.name}</strong>
                                <small>{clip.seconds.toFixed(1)}s</small>
                            </span>
                            <span class="acts">
                                <button
                                    title={copiedKey === `${clip.name}/json` ? "Copied!" : "Copy as JSON"}
                                    onclick={() => copy(JSON.stringify(clip), `${clip.name}/json`)}>JSON</button>
                                <button
                                    title={copiedKey === `${clip.name}/css` ? "Copied!" : "Copy as CSS keyframes"}
                                    onclick={() => copy(clipToCss(clip), `${clip.name}/css`)}>CSS</button>
                                <button class="danger" title="Delete" onclick={() => drop(clip.name)}>✕</button>
                            </span>
                        </footer>
                    </article>
                {:else}
                    <p class="empty">Nothing recorded on this browser yet — arm the recorder and perform something.</p>
                {/each}
            </div>
        </section>
    </div>
</main>

<style>
    main {
        max-width: 78rem;
        margin: 0 auto;
        padding: 2rem 1.5rem 4rem;
    }

    .top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 2rem;
    }

    h1 {
        margin: 0 0 0.4rem;
    }

    .lede {
        max-width: 44rem;
        margin: 0 0 1.2rem;
        color: var(--text-secondary);
        text-wrap: pretty;
    }

    /* Ink, not browser purple: a link on this paper dresses like the rest
       of the page, visited or not. */
    .back,
    .back:visited {
        white-space: nowrap;
        color: var(--text-secondary);
        text-decoration: none;
        border-bottom: 1.5px solid color-mix(in srgb, var(--text-secondary) 40%, transparent);
        transition: color 0.14s, border-color 0.14s;
    }

    .back:hover {
        color: var(--text-primary);
        border-bottom-color: var(--text-primary);
    }

    /*
     * Recording on the left in a hand-sized paddock; the gallery gets the
     * width. The old layout had it backwards — a full-width recording strip
     * over a cramped shelf — and read as a page about the empty box.
     */
    .workbench {
        display: grid;
        grid-template-columns: 340px 1fr;
        gap: 20px;
        align-items: start;
    }

    @media (max-width: 760px) {
        .workbench {
            grid-template-columns: 1fr;
        }
    }

    /* The whole recording column sticks together: paddock, then export. */
    .side {
        position: sticky;
        top: 16px;
        display: grid;
        gap: 10px;
    }

    .paddock {
        position: relative;
        height: 420px;
        border: 1.5px dashed color-mix(in srgb, var(--border-strong, #888) 60%, transparent);
        border-radius: 16px;
        background: var(--surface-page, #f4f1e8);
        overflow: hidden;
        touch-action: none;
    }

    .paddock--armed {
        border-color: #c4463c;
        border-style: solid;
    }

    .hero {
        position: absolute;
        width: 110px;
        cursor: grab;
        user-select: none;
        touch-action: none;
        filter: drop-shadow(0 3px 6px rgba(20, 24, 18, 0.25));
    }

    .hero:active {
        cursor: grabbing;
    }

    .record {
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        padding: 0.55rem 0.9rem;
        border: 1.5px solid var(--text-primary);
        border-radius: 999px;
        background: var(--surface-page-elevated, #fff);
        font: inherit;
        cursor: pointer;
    }

    .record img {
        width: 32px;
        height: 32px;
        object-fit: contain;
        flex: none;
        pointer-events: none;
    }

    .record--armed {
        background: #c4463c;
        border-color: transparent;
        color: #fff;
    }

    .results {
        min-width: 0;
    }

    .take {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.6rem;
        margin: 0 0 0.8rem;
        padding: 10px 12px;
        border: 1.5px solid var(--text-primary);
        border-radius: 12px;
        background: var(--surface-page-elevated, #fff);
    }

    .take input {
        flex: 1;
        min-width: 12rem;
        padding: 0.4rem 0.6rem;
        border: 1.5px solid var(--border-strong, #888);
        border-radius: 8px;
        font: inherit;
    }

    .take button,
    .export {
        padding: 0.35rem 0.7rem;
        border: 1.5px solid var(--text-primary);
        border-radius: 8px;
        background: var(--surface-page-elevated, #fff);
        font: inherit;
        cursor: pointer;
    }

    .quiet {
        border-color: color-mix(in srgb, var(--border-strong, #888) 60%, transparent);
        color: var(--text-secondary);
    }

    .note {
        margin: 0 0 0.8rem;
        color: var(--text-secondary);
    }

    .gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
        gap: 12px;
    }

    .card {
        border: 1.5px solid color-mix(in srgb, var(--border-strong, #888) 45%, transparent);
        border-radius: 14px;
        padding: 8px;
        background: var(--surface-page, #f7f4ec);
    }

    /* A fixed, modest stage per clip: enough air for a hop, no towers. */
    .stage {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 130px;
        overflow: hidden;
        border-radius: 10px;
        background: color-mix(in srgb, var(--surface-page-elevated, #fff) 60%, transparent);
    }

    .stage img {
        width: 64px;
    }

    .card footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-top: 8px;
        min-width: 0;
    }

    .card__name {
        display: flex;
        align-items: baseline;
        gap: 5px;
        min-width: 0;
    }

    .card__name strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .card__name small {
        color: var(--text-secondary);
        white-space: nowrap;
    }

    .acts {
        display: flex;
        flex: none;
        gap: 4px;
    }

    .acts button {
        padding: 0.2rem 0.4rem;
        border: 1.5px solid color-mix(in srgb, var(--border-strong, #888) 55%, transparent);
        border-radius: 7px;
        background: var(--surface-page-elevated, #fff);
        font: inherit;
        font-size: 0.78em;
        cursor: pointer;
    }

    .danger {
        color: #c4463c;
        border-color: #c4463c;
    }


    .empty {
        color: var(--text-secondary);
    }
</style>
