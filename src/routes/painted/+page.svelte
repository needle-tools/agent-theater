<script lang="ts">
    /**
     * The painterly workbench.
     *
     * This began as a static page in `static/`, which was right while the
     * effect was not yet part of anything — it could not break the app because
     * it did not touch it. That is no longer true, and a standalone copy is now
     * the worse option: it would carry its own copy of the filter defs and its
     * own worklet registration, and the day one of those drifted from the real
     * ones this page would be confidently demonstrating something the theatre
     * does not do.
     *
     * So it imports what the theatre imports. The filters come from
     * `boilFilterSvg`, the worklet from `loadPainterly`, the props from the
     * real troupe catalogue. If the effect changes, this page changes with it,
     * and if it breaks, this page breaks — which is the whole point of a page
     * you look at to decide whether something looks right.
     */
    import { onMount } from "svelte";
    import { boilFilterSvg, loadPainterly, PAINTERLY_CSS } from "$lib/collage/painted";
    import { TROUPE } from "$lib/collage/troupe";

    let ready = $state<boolean | null>(null);

    // The knobs. Defaults are the shipped ones, so this page opens showing
    // what a scene actually looks like rather than a tuned demonstration.
    let hold = $state(360);
    let bite = $state(0.55);
    let tooth = $state(0.5);
    let scale = $state(1);
    let angle = $state(-18);
    let shift = $state(0.3);
    let turn = $state(0.3);
    let boil = $state(5);
    let roughBoil = $state(11.5);

    let push = $state(4.5);
    let grainAmount = $state(0.65);
    let grainSize = $state(1.4);
    let grainDensity = $state(2.3);
    let grainContrast = $state(0.3);
    let grainTile = $state(80);
    let grainHold = $state(720);
    let grainMoves = $state(true);
    let grainOn = $state(true);

    let animate = $state(true);

    /*
     * The one control that is an attribute rather than a property.
     *
     * `feDisplacementMap`'s scale is SVG, not CSS, so it cannot be a custom
     * property and cannot be inherited from a wrapper. Writing it here keeps
     * `boilFilterSvg` the single definition of those filters — the alternative
     * was hand-writing the SVG into this page so it could be bound, which is
     * exactly the drift this page exists to avoid.
     */
    $effect(() => {
        for (const i of [0, 1, 2]) {
            document.querySelector(`#paint-boil-${i} feDisplacementMap`)
                ?.setAttribute("scale", String(boil));
            document.querySelector(`#paint-boil-rough-${i} feDisplacementMap`)
                ?.setAttribute("scale", String(roughBoil));
        }
    });

    onMount(async () => {
        ready = await loadPainterly();
    });

    /** A spread across packs, so the shelf is not nine mushrooms. */
    const shelf = TROUPE
        .filter(piece => piece.kind === "scenery" || piece.kind === "actor")
        .filter((piece, index) => index % 7 === 0)
        .slice(0, 18)
        .map((piece, index) => ({
            ...piece,
            // Every third is calm and every third lively, and three are left
            // alone — the argument for a class rather than a global filter is
            // only visible if some of them are not wearing it.
            mode: index % 6 === 5 ? "still" : (["calm", "", "lively", "rough"][index % 4] as string),
        }));

    /** Every backdrop there is — one setting has to hold across all of them. */
    const backdrops = TROUPE.filter(piece => piece.kind === "backdrop");

    const fileOf = (pack: string, kind: string) =>
        TROUPE.find(piece => piece.pack === pack && piece.kind === kind)?.file ?? "";

    /**
     * The three-plane sets, which are the biggest surfaces the grain has to
     * hold. Only the packs that have all three: a pack with a midground and no
     * backdrop — forest-band is one — would otherwise render an <img> with an
     * empty src, which is a broken picture pretending to be a set.
     */
    const sets = [...new Set(TROUPE
        .filter(piece => piece.kind === "midground")
        .map(piece => piece.pack))]
        .filter(pack => ["backdrop", "midground", "foreground"].every(kind => fileOf(pack, kind)));
</script>

<svelte:head>
    <title>Painted — the painterly workbench</title>
    <link rel="stylesheet" href={PAINTERLY_CSS} />
</svelte:head>

<div
    class="workbench"
    style:--paint-hold="{hold}ms"
    style:--paint-bite={bite}
    style:--paint-tooth={tooth}
    style:--paint-scale={scale}
    style:--paint-angle={angle}
    style:--paint-shift="{shift}%"
    style:--paint-turn="{turn}deg"
    style:--grain-amount={grainAmount}
    style:--grain-size={grainSize}
    style:--grain-density={grainDensity}
    style:--grain-contrast={grainContrast}
    style:--grain-tile="{grainTile}px"
    style:--grain-hold="{grainHold}ms"
    style:--push={push}
>
    <h1>Painted</h1>
    <p class="note">
        One image, repainted a few times a second by a Houdini paint worklet.
        The artwork never changes — what changes is where the brush ran dry,
        which way the outline wandered, and which specks of paper are catching
        the light. Everything below is live; the settings read off as custom
        properties.
    </p>

    <div class="panel">
        <span class="badge" class:badge--off={ready === false}>
            {ready === null ? "loading…" : ready ? "paint worklet: on" : "no paint worklet — boil only"}
        </span>
        <label><span>animate</span><input type="checkbox" bind:checked={animate} /></label>
        <label><span>boil {boil}px</span><input type="range" min="0" max="16" step="0.5" bind:value={boil} /></label>
        <label><span>rough boil {roughBoil}px</span><input type="range" min="0" max="24" step="0.5" bind:value={roughBoil} /></label>
        <label><span>hold {hold}ms</span><input type="range" min="120" max="900" step="20" bind:value={hold} /></label>
        <label><span>bite {bite}</span><input type="range" min="0" max="1.5" step="0.05" bind:value={bite} /></label>
        <label><span>tooth {tooth}</span><input type="range" min="0" max="1.5" step="0.05" bind:value={tooth} /></label>
        <label><span>scale {scale}</span><input type="range" min="0.3" max="3" step="0.1" bind:value={scale} /></label>
        <label><span>angle {angle}°</span><input type="range" min="-90" max="90" step="2" bind:value={angle} /></label>
        <label><span>shift {shift}%</span><input type="range" min="0" max="1.5" step="0.05" bind:value={shift} /></label>
        <label><span>turn {turn}°</span><input type="range" min="0" max="1.5" step="0.05" bind:value={turn} /></label>
    </div>

    <h2>Side by side</h2>
    <div class="pair">
        <div class="cell">
            <figure><img src="/troupe/forest/mushroom-toadstool.webp" alt="" /></figure>
            <div class="caption">plain</div>
        </div>
        <div class="cell">
            <figure style="--paint-seed: 3">
                <img
                    class="painted painted--boil"
                    class:paused={!animate}
                    src="/troupe/forest/mushroom-toadstool.webp" alt="" />
            </figure>
            <div class="caption">painted</div>
        </div>
    </div>

    <h2>The four temperaments</h2>
    <p class="note">
        Same drawing, same worklet, four presets. A preset sets its own hold,
        bite, tooth, mark size and brush angle, so the sliders above do not
        reach these — that is what a preset is for. <em>Rough</em> also points
        its three holds at a second set of displacement filters, because the
        wander is an SVG attribute and cannot be a custom property.
    </p>
    <div class="pair four">
        {#each ["calm", "", "lively", "rough"] as mode, i}
            <div class="cell">
                <figure style="--paint-seed: {17 + i * 5}">
                    <img
                        class="painted painted--boil"
                        class:painted--calm={mode === "calm"}
                        class:painted--lively={mode === "lively"}
                        class:painted--rough={mode === "rough"}
                        class:paused={!animate}
                        src="/troupe/people/elder-woman.webp" alt="" />
                </figure>
                <div class="caption">{mode || "default"}</div>
            </div>
        {/each}
    </div>

    <h2>At size</h2>
    <div class="pair big">
        <div class="cell">
            <figure><img src="/troupe/forest/tree-oak.webp" alt="" /></figure>
            <div class="caption">plain</div>
        </div>
        <div class="cell">
            <figure style="--paint-seed: 11">
                <img
                    class="painted painted--boil"
                    class:paused={!animate}
                    src="/troupe/forest/tree-oak.webp" alt="" />
            </figure>
            <div class="caption">painted</div>
        </div>
    </div>

    <h2>On a dark stage</h2>
    <p class="note">
        The dry brush is subtractive — what it lifts shows whatever is behind,
        not white paper. Worth checking here before trusting a setting.
    </p>
    <div class="pair stage">
        <div class="cell">
            <figure><img src="/troupe/forest/lantern.webp" alt="" /></figure>
            <div class="caption">plain</div>
        </div>
        <div class="cell">
            <figure style="--paint-seed: 5">
                <img
                    class="painted painted--boil"
                    class:paused={!animate}
                    src="/troupe/forest/lantern.webp" alt="" />
            </figure>
            <div class="caption">painted</div>
        </div>
    </div>

    <h2>Backdrops, at the size they are actually used</h2>
    <p class="note">
        A backdrop is one image stretched to the width of a stage and then
        pushed into. Grain does not put detail back — nothing can — it puts back
        high-frequency variation at the scale of the screen, which is what the
        eye was using to judge sharpness. These are full width, which is the
        size that matters: at thumbnail size any grain looks fine. All of them
        at once, because a setting that flatters a dark cave wall can bleach a
        pale sky, and you cannot see that one backdrop at a time.
    </p>

    <div class="panel">
        <label><span>grain on</span><input type="checkbox" bind:checked={grainOn} /></label>
        <label><span>grain moves</span><input type="checkbox" bind:checked={grainMoves} /></label>
        <label><span>re-grain {grainHold}ms</span><input type="range" min="200" max="2000" step="40" bind:value={grainHold} /></label>
        <label><span>grain {grainAmount}</span><input type="range" min="0" max="2" step="0.05" bind:value={grainAmount} /></label>
        <label><span>speck {grainSize}px</span><input type="range" min="0.3" max="3" step="0.1" bind:value={grainSize} /></label>
        <label><span>density {grainDensity}</span><input type="range" min="0" max="6" step="0.1" bind:value={grainDensity} /></label>
        <label><span>contrast {grainContrast}</span><input type="range" min="0" max="3" step="0.1" bind:value={grainContrast} /></label>
        <label><span>tile {grainTile}px</span><input type="range" min="60" max="400" step="20" bind:value={grainTile} /></label>
    </div>

    <!-- Every backdrop, not one behind a picker. One setting has to hold
         across a cave, a meadow and a living room — a dark rocky wall and a
         pale flat sky want very different amounts of grain, and a demo that
         shows them one at a time lets you tune happily for the one on screen
         and never notice you have ruined the others. -->
    {#each backdrops as piece}
        <div class="wide">
            <figure
                class="backdrop"
                class:grained={grainOn}
                class:grained--still={!grainMoves}
                style="--grain-seed: {piece.pack.length * 37}"
            >
                <img src={piece.file} alt={piece.id} loading="lazy" />
            </figure>
            <div class="caption">{piece.pack}</div>
        </div>
    {/each}

    <h2>A whole set, three planes deep</h2>
    <p class="note">
        Backdrop, midground and foreground stacked as a stage builds them — the
        largest grained surface the effect has to hold, and the one that decides
        whether the cost is worth it. The camera magnifies all three together.
    </p>
    <div class="panel">
        <label><span>push in {push}×</span><input type="range" min="1" max="6" step="0.25" bind:value={push} /></label>
    </div>
    {#each sets as pack}
        <div class="wide">
            <div class="viewport">
                <div class="dolly">
                    <figure
                        class="backdrop"
                        class:grained={grainOn}
                        class:grained--still={!grainMoves}
                        style="--grain-seed: {pack.length * 37}"
                    >
                        <img src={fileOf(pack, "backdrop")} alt="" loading="lazy" />
                    </figure>
                    <figure class="plane"><img src={fileOf(pack, "midground")} alt="" loading="lazy" /></figure>
                    <figure class="plane"><img src={fileOf(pack, "foreground")} alt="" loading="lazy" /></figure>
                </div>
            </div>
            <div class="caption">{pack}</div>
        </div>
    {/each}

    <h2>Some of them, not all of them</h2>
    <p class="note">
        A scene where three things breathe and the rest hold still has a focus.
        Everything here is painted except the pieces marked <em>still</em>. The
        <em>calm</em> and <em>lively</em> presets set their own hold, so the
        hold slider above does not reach them — that is what a preset is.
    </p>
    <div class="grid">
        {#each shelf as piece, i}
            <div class="cell">
                <figure
                    style="--paint-seed: {i * 7 + 3}; --paint-at: -{(i * 0.07).toFixed(2)}s"
                >
                    <img
                        class:painted={piece.mode !== "still"}
                        class:painted--boil={piece.mode !== "still"}
                        class:painted--calm={piece.mode === "calm"}
                        class:painted--lively={piece.mode === "lively"}
                        class:painted--rough={piece.mode === "rough"}
                        class:paused={!animate}
                        src={piece.file} alt={piece.id} loading="lazy" />
                </figure>
                <div class="caption">
                    {piece.id.split("/")[1]}{piece.mode ? ` · ${piece.mode}` : ""}
                </div>
            </div>
        {/each}
    </div>

    <!-- The same three filters the theatre uses. Not optional: a filter
         reference that resolves to nothing means "do not render". -->
    <svg class="defs" aria-hidden="true" focusable="false">{@html boilFilterSvg()}</svg>
</div>

<style>
    .workbench {
        padding: 2rem clamp(1rem, 4vw, 3rem) 6rem;
        max-width: 1200px;
        margin: 0 auto;
        /* Composed into the filter chain after the boil warp, so a painted
           piece keeps its shadow rather than trading it for the effect. */
        --paint-filter: drop-shadow(0 6px 10px rgba(34, 44, 32, 0.18));
    }

    h1 {
        font-family: var(--font-family-display);
        font-size: 1.6rem;
        margin: 0 0 0.4rem;
    }

    h2 {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.09em;
        opacity: 0.55;
        margin: 3rem 0 0.75rem;
    }

    .note {
        max-width: 68ch;
        opacity: 0.72;
        margin: 0 0 1.5rem;
    }

    .panel {
        display: flex;
        flex-wrap: wrap;
        gap: 0.8rem 1.4rem;
        align-items: center;
        padding: 0.85rem 1.1rem;
        margin-bottom: 1.25rem;
        background: var(--surface-panel);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md, 10px);
    }

    .panel label {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        font-size: 12px;
    }

    .panel label span {
        opacity: 0.62;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    .panel input[type="range"] { width: 110px; }

    .badge {
        font-size: 12px;
        padding: 0.3rem 0.7rem;
        border-radius: var(--radius-pill, 999px);
        background: color-mix(in srgb, var(--accent-brand) 18%, transparent);
    }

    .badge--off {
        background: color-mix(in srgb, #c96 30%, transparent);
    }

    /*
     * A figure that IS the picture's box, with the image filling it exactly.
     * The grain overlay is `inset: 0` on the figure, so a figure larger than
     * its image would smear pigment into the empty space around it.
     */
    .cell {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        min-height: 170px;
    }

    figure {
        margin: 0 auto;
        display: block;
        width: fit-content;
    }

    figure img {
        display: block;
        width: auto;
        max-width: 100%;
        max-height: 170px;
        filter: var(--paint-warp, url("#paint-boil-0")) var(--paint-filter);
    }

    /* Pausing rather than unclassing keeps the mask and the warp, so this
       toggles the motion and leaves the paint. */
    .paused { animation-play-state: paused; }

    .caption {
        font-size: 11px;
        opacity: 0.5;
        text-align: center;
        margin-top: 0.45rem;
    }

    .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
        max-width: 640px;
        background: var(--surface-panel);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md, 12px);
        padding: 1.25rem;
    }

    .pair .cell { min-height: 240px; }
    .pair img { max-height: 240px; }
    .pair .caption { font-weight: 600; opacity: 0.75; }

    .four {
        grid-template-columns: repeat(4, 1fr);
        max-width: 820px;
    }

    .four .cell { min-height: 260px; }
    .four img { max-height: 260px; }

    .big .cell { min-height: 360px; }
    .big img { max-height: 360px; }

    .stage { background: #1d2b33; border-color: #1d2b33; }
    .stage .caption { color: #dfe8ec; }

    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 1.5rem 1rem;
        align-items: end;
    }

    /* Full width, because that is the size a backdrop is actually used at. */
    .wide {
        margin-bottom: 1.5rem;
    }

    .backdrop {
        margin: 0;
        display: block;
        width: 100%;
    }

    .backdrop img,
    .plane img {
        display: block;
        width: 100%;
        height: auto;
        /* The cut-out rules above cap every figure image at prop height and
           hang a shadow on it; a backdrop is neither. */
        max-width: none;
        max-height: none;
        filter: none;
    }

    /* The camera. The dolly is magnified inside a fixed window, and the offset
       is a share of the picture's own size — (push - 1) / (2 · push) — or the
       camera flies off the set. */
    .viewport {
        overflow: hidden;
        border-radius: var(--radius-md, 10px);
        border: 1px solid var(--border-subtle);
        aspect-ratio: 21 / 9;
        position: relative;
    }

    .dolly {
        position: absolute;
        inset: 0;
        width: calc(100% * var(--push, 3));
        translate:
            calc(-50% * (var(--push, 3) - 1) / var(--push, 3))
            calc(-50% * (var(--push, 3) - 1) / var(--push, 3));
    }

    .dolly .backdrop { position: absolute; inset: 0; }

    .plane {
        margin: 0;
        position: absolute;
        inset: 0;
    }

    .defs {
        position: absolute;
        width: 0;
        height: 0;
        pointer-events: none;
    }
</style>
