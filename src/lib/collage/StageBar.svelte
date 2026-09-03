<script lang="ts">
    /**
     * The house controls: a playbill in the top-left corner.
     *
     * Everything about the theatre could be driven by the agent, and for a
     * while all of it was — which meant the person who had just spent an hour
     * arranging a scene could not watch it without asking somebody else to
     * press play. That is the wrong way round: the agent is a collaborator
     * here, not the projectionist.
     *
     * It reads as a table of contents, not as a toolbar: chapter names
     * stacked one under another on the bare paper, no panel behind them —
     * the world is the surface, and chrome floating on it should weigh as
     * little as possible. The chapter on screen (or playing) is simply BOLD,
     * the way the current chapter is in any book. Past five chapters the
     * list fades out at its bottom edge and scrolls.
     */
    import type { CollageStudio } from "./studio";

    let { studio }: { studio: CollageStudio } = $props();

    const collage = studio.collage;

    let version = $state(0);
    $effect(() => collage.onChanged(() => version++));

    // The studio is plain TypeScript, so `showing` is a getter that would be
    // read once and never again. A show ending changes nothing in the document
    // either, so this cannot ride on the document's own signal.
    let showing = $state<string | null>(null);
    // Which scene the agent is working on, if any. Same signal as `showing`,
    // since both are studio state that the document's change event knows
    // nothing about.
    let busy = $state<string | null>(null);
    // A held show is lit and standing still, waiting for an agent to write the
    // next chapter. It is not playing, and offering a pause button for it left
    // the person pressing stop to get a play button back.
    let holding = $state(false);
    $effect(() => {
        const read = () => {
            showing = studio.showing;
            busy = studio.busyStage;
            holding = studio.holding;
        };
        read();
        return studio.onShowChanged(read);
    });
    const playing = $derived(!!showing && !holding);

    /** Play from the top. A held show is ended first, so it starts as a show. */
    function play() {
        if (holding) studio.stopShow();
        studio.playShow();
    }

    const stages = $derived.by(() => (version, collage.listStages()));
    const activeId = $derived.by(() => (version, collage.activeStageId));
    /** The chapter to print in bold: the one playing, else the one selected. */
    const current = $derived(showing ?? activeId);

</script>

{#if stages.length}
    <div class="bar" class:bar--showing={!!showing} role="group" aria-label="Chapters">
        <div class="controls">
            <button
                class="play"
                class:play--stop={playing}
                aria-label={playing ? "Pause the show" : "Play the show"}
                onclick={() => (playing ? studio.stopShow() : play())}
            >
                <img src={playing ? "/icons/playback/pause.webp" : "/icons/playback/play.webp"} alt="" />
            </button>

        </div>

        <!-- The playbill stays up during the show, dimmed and untouchable,
             with the playing chapter bold — it is the audience's place in the
             programme, not a control any more. -->
        <div class="chapters" class:chapters--tall={stages.length > 5} class:chapters--watching={!!showing}>
            {#each stages as stage (stage.id)}
                <button
                    class="chapter"
                    class:chapter--current={stage.id === current}
                    class:chapter--busy={stage.id === busy}
                    aria-pressed={stage.id === current}
                    tabindex={showing ? -1 : 0}
                    onclick={() => {
                        if (!showing) collage.setActiveStage(stage.id);
                    }}
                >
                    <!-- A pulsing dot on whichever chapter the agent is
                         touching. An agent building four chapters edits three
                         of them out of sight, and without this the page
                         either sits still or changes with no clue why. -->
                    {#if stage.id === busy}<span class="pip" aria-label="being worked on"></span>{/if}
                    <img class="chapter__icon" src="/icons/playback/chapter-marker.webp" alt="" />
                    {stage.name}
                </button>
            {/each}
        </div>
    </div>
{/if}

<style>
    /*
     * Top LEFT, stacked. The bottom edge belongs to the sticker shelf and the
     * browser agent's own controls; the top right holds the eraser and the
     * menu. This corner was the empty one, and a vertical list wants a
     * corner, not a centre.
     *
     * No background on purpose: the names sit straight on the paper.
     */
    .bar {
        position: absolute;
        left: 16px;
        top: 16px;
        z-index: 25;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        transition-property: opacity;
        transition-duration: 0.4s;
        transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }

    /*
     * Full strength while the show runs: the pause button and the programme
     * are the audience's two instruments, and dimming them read as "not for
     * you". The rest of the chrome steps back instead — the file tools hide
     * and the corner cut-outs fade, over in Collage and the page shell.
     *
     * The one exception is a billboard: while a title card or the credits
     * hold the screen, even these two go dark with the house.
     */
    :global(html.theatre-card) .bar {
        opacity: 0;
        pointer-events: none;
    }

    /*
     * The programme's ink is derived from the paper, because the agent can
     * recolour the paper (theater_background) and dark ink on midnight blue
     * disappears. The oklch clamp is a step function: paper lighter than
     * L 0.62 gets near-black ink, darker paper gets near-white — with a
     * touch of the paper's own hue so it reads as printed on it, not laid
     * over it. The muted ink is the same flip pulled 20% back toward the
     * paper.
     */
    .bar {
        --playbill-ink: oklch(from var(--paper, var(--surface-page))
            clamp(0.14, (0.62 - l) * 999, 0.96) min(c, 0.03) h);
        --playbill-ink-muted: color-mix(in oklch,
            var(--playbill-ink) 72%, var(--paper, var(--surface-page)));
    }

    .chapters {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
        overflow-y: auto;
        scrollbar-width: none;
    }

    .chapters::-webkit-scrollbar {
        display: none;
    }

    /* Past five chapters the programme fades off its own bottom edge and
       scrolls — the fade says "there is more" better than a scrollbar. */
    .chapters--tall {
        max-height: 158px;
        mask-image: linear-gradient(to bottom, black 65%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, black 65%, transparent 100%);
    }

    .chapters--watching {
        pointer-events: none;
    }

    .controls {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .chapter {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        min-height: 30px;
        max-width: min(34vw, 240px);
        padding: 0 0.2rem;
        border: 0;
        background: transparent;
        color: var(--playbill-ink-muted, var(--text-secondary));
        font: inherit;
        font-size: var(--type-micro-label-size);
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: var(--cursor-pointer, pointer);
        transition-property: color, scale;
        transition-duration: 0.14s;
    }

    .chapter:hover {
        color: var(--playbill-ink, var(--text-primary));
    }

    .chapter:active {
        scale: 0.96;
    }

    /* The current chapter is bold, the way it is in any book's contents. */
    .chapter--current {
        color: var(--playbill-ink, var(--text-primary));
        font-weight: 700;
    }

    .chapter--busy {
        color: var(--playbill-ink, var(--text-primary));
    }

    .pip {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent-secondary, #0BA398);
        animation: pip 1.4s ease-in-out infinite;
    }

    .chapter__icon {
        flex: none;
        width: 20px;
        height: 20px;
        object-fit: contain;
        filter: drop-shadow(0 1px 1px rgba(34, 44, 32, 0.18));
    }

    @keyframes pip {
        0%, 100% { opacity: 0.35; scale: 0.8; }
        50% { opacity: 1; scale: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
        .pip { animation: none; opacity: 1; }
    }

    .play {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border: 0;
        border-radius: 12px;
        background: var(--accent-brand);
        color: #14200f;
        cursor: var(--cursor-pointer, pointer);
        box-shadow:
            0 1px 2px rgba(34, 44, 32, 0.08),
            0 6px 16px rgba(34, 44, 32, 0.10);
        transition-property: background, color, scale;
        transition-duration: 0.14s;
    }

    .play:hover {
        background: var(--accent-brand-deep, var(--accent-brand));
    }

    .play:active {
        scale: 0.96;
    }

    /* Stopping is not the happy path, so it does not wear the happy colour. */
    .play--stop {
        background: var(--surface-panel-muted);
        color: var(--text-primary);
    }

    .play img {
        width: 28px;
        height: 28px;
        object-fit: contain;
        pointer-events: none;
    }

    @media (prefers-reduced-motion: reduce) {
        .bar,
        .chapter,
        .play {
            transition-duration: 0s;
        }
    }

    /* On a phone the playbill is the play button alone — the chapter list
       fights the canvas for a small screen's height, so for now it stays a
       desktop luxury. */
    @media (max-width: 700px) {
        .chapters {
            display: none;
        }
    }
</style>
