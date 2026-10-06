<script lang="ts">
    import { onMount } from "svelte";
    import { TROUPE } from "$lib/collage/troupe.js";
    import { renderUnfurl } from "$lib/collage/shareCard.js";
    import type { ImageLayer } from "$lib/collage/model.js";

    const titles = [
        "The Ghost Who Stole Halloween", "The Moon Who Ate Tuesday",
        "The Rhino Express and the Runaway Door", "Snow White's Mirror",
        "Department of Impossible Problems", "The Little Dragon's Great Big Secret",
        "A Very Strange Day at the Castle", "The Clock That Forgot Tomorrow",
        "Where Did the King Hide the Cake?", "The Last Bus to the Moon",
        "The Princess and the Paper Storm", "The Curious Case of the Missing Crown",
    ];
    const actors = TROUPE.filter(piece => piece.kind === "actor");

    const DRAFT = 16;
    type Preview = { title: string; url: string; cast: string[]; draft: number };
    let previews = $state<Preview[]>([]);
    let busy = $state(false);
    let error = $state("");

    function shuffle<T>(values: T[]): T[] {
        const copy = [...values];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    async function randomize() {
        if (busy) return;
        busy = true;
        error = "";
        try {
            const chosenTitles = shuffle(titles).slice(0, 3);
            const chosenActors = shuffle(actors);
            const next: Preview[] = [];
            for (let index = 0; index < 3; index++) {
                const cast = chosenActors.slice(index * 5, index * 5 + 5);
                const layers = cast.map(piece => ({
                    id: piece.id, kind: "image", label: piece.description, src: piece.file,
                    crop: { x: 0, y: 0, width: 1, height: 1 }, flip: false,
                })) as ImageLayer[];
                const canvas = await renderUnfurl(chosenTitles[index], layers);
                const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value =>
                    value ? resolve(value) : reject(new Error("Could not make preview.")), "image/png"));
                next.push({ title: chosenTitles[index], url: URL.createObjectURL(blob), cast: cast.map(piece => piece.id), draft: DRAFT });
            }
            previews.forEach(preview => URL.revokeObjectURL(preview.url));
            previews = next;
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        } finally { busy = false; }
    }

    onMount(() => {
        void randomize();
        const refresh = () => { location.reload(); };
        import.meta.hot?.on("vite:afterUpdate", refresh);
        return () => {
            import.meta.hot?.off("vite:afterUpdate", refresh);
            previews.forEach(preview => URL.revokeObjectURL(preview.url));
        };
    });
</script>

<svelte:head>
    <title>Unfurl image review · Agent Theater</title>
</svelte:head>

<div class="lab">
    <header>
        <div>
            <p class="eyebrow">Agent Theater · typography draft 16</p>
            <h1>Share image lab</h1>
            <p>Three random titles and casts. The upper ribbon uses dark ink; the lower ribbon uses colors sampled from the original poster, with a thick cream outline.</p>
        </div>
        <button onclick={randomize} disabled={busy}>{busy ? "Making previews…" : "Randomize 3 images"}</button>
    </header>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="previews">
        {#each previews as preview}
            <article>
                <img src={preview.url} alt="Share preview for {preview.title}" />
                <div class="details">
                    <strong>{preview.title}</strong>
                    <span>Rendered with typography draft {preview.draft}</span>
                    <span>{preview.cast.join(" · ")}</span>
                    <a href={preview.url} download="agent-theater-unfurl.png">Download PNG</a>
                </div>
            </article>
        {/each}
    </div>
</div>

<style>
    .lab { min-height: 100dvh; padding: clamp(20px, 3vw, 50px); background: #f7f1e5; color: #24212a; font-family: system-ui, sans-serif; }
    header { display: flex; justify-content: space-between; align-items: end; gap: 24px; max-width: 1700px; margin: 0 auto 28px; }
    .eyebrow { margin: 0 0 6px; color: #9a5526; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(30px, 3vw, 48px); line-height: 1.1; }
    header p:last-child { margin: 10px 0 0; max-width: 650px; color: #685e62; line-height: 1.45; }
    button { flex: none; padding: 14px 20px; border: 0; border-radius: 11px; background: #142c4a; color: white; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .55; cursor: wait; }
    .previews { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; max-width: 1700px; margin: auto; }
    article { min-width: 0; overflow: hidden; border: 1px solid #d5c9b8; border-radius: 16px; background: #fffaf2; box-shadow: 0 10px 35px #4e3a2620; }
    article img { display: block; width: 100%; aspect-ratio: 1672 / 941; object-fit: contain;
        background-color: #eee9df;
        background-image: linear-gradient(45deg, #dbd4c8 25%, transparent 25%, transparent 75%, #dbd4c8 75%),
            linear-gradient(45deg, #dbd4c8 25%, transparent 25%, transparent 75%, #dbd4c8 75%);
        background-size: 24px 24px; background-position: 0 0, 12px 12px; }
    .details { display: grid; gap: 7px; padding: 14px 16px 18px; }
    .details strong { font-size: 15px; }
    .details span { overflow: hidden; color: #736873; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .details a { width: fit-content; margin-top: 4px; color: #183e6a; font-size: 13px; font-weight: 700; }
    .error { max-width: 1700px; margin: 0 auto 18px; color: #9e2929; }
    @media (max-width: 1100px) { .previews { grid-template-columns: 1fr; } header { align-items: start; flex-direction: column; } }
</style>
