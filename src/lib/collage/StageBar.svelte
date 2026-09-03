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
    import { onDestroy } from "svelte";
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
    $effect(() => {
        const read = () => {
            showing = studio.showing;
            busy = studio.busyStage;
        };
        read();
        return studio.onShowChanged(read);
    });

    const stages = $derived.by(() => (version, collage.listStages()));
    const activeId = $derived.by(() => (version, collage.activeStageId));
    /** The chapter to print in bold: the one playing, else the one selected. */
    const current = $derived(showing ?? activeId);

    let clearArmed = $state(false);
    let clearTimer = 0;

    function disarmClear() {
        clearArmed = false;
        if (clearTimer) window.clearTimeout(clearTimer);
        clearTimer = 0;
    }

    async function clearStage() {
        if (!clearArmed) {
            clearArmed = true;
            clearTimer = window.setTimeout(disarmClear, 5000);
            return;
        }
        disarmClear();
        studio.stopShow();
        await studio.clear();
    }

    onDestroy(disarmClear);
</script>

{#if stages.length}
    <div class="bar" class:bar--showing={!!showing} role="group" aria-label="Chapters">
        <div class="controls">
            <button
                class="play"
                class:play--stop={!!showing}
                aria-label={showing ? "Pause the show" : "Play the show"}
                onclick={() => (showing ? studio.stopShow() : studio.playShow())}
            >
                <img src={showing ? "/icons/playback/pause.webp" : "/icons/playback/play.webp"} alt="" />
            </button>

            <button
                class="clear"
                class:clear--armed={clearArmed}
                aria-label={clearArmed ? "Click again to clear the whole stage" : "Clear the stage"}
                onclick={clearStage}
            >
                <img src="/icons/playback/delete-all.webp" alt="" />
                {#if clearArmed}
                    <span class="clear__warning">Click again to clear everything.</span>
                {/if}
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
     * Nearly out of the way while the show runs, and back the moment the
     * pointer looks for it. A control that vanished completely would leave no
     * way to stop the thing.
     */
    .bar--showing {
        opacity: 0.35;
    }

    .bar--showing:hover,
    .bar--showing:focus-within {
        opacity: 1;
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
        color: var(--text-secondary);
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
        color: var(--text-primary);
    }

    .chapter:active {
        scale: 0.96;
    }

    /* The current chapter is bold, the way it is in any book's contents. */
    .chapter--current {
        color: var(--text-primary);
        font-weight: 700;
    }

    .chapter--busy {
        color: var(--text-primary);
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

    .play img,
    .clear img {
        width: 28px;
        height: 28px;
        object-fit: contain;
        pointer-events: none;
    }

    .clear {
        position: relative;
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        padding: 0;
        border: 0;
        border-radius: 12px;
        background: transparent;
        cursor: var(--cursor-pointer, pointer);
        transition-property: background-color, scale;
        transition-duration: 0.14s;
    }

    .clear:hover,
    .clear--armed {
        background: color-mix(in srgb, var(--accent-error, #D93A62) 10%, transparent);
    }

    .clear:active { scale: 0.96; }

    .clear__warning {
        position: absolute;
        left: 0;
        top: calc(100% + 10px);
        width: max-content;
        max-width: min(240px, calc(100vw - 32px));
        padding: 0.55em 0.8em;
        border: 1.5px solid var(--accent-error, #D93A62);
        border-radius: 0.9em;
        background: var(--surface-page-elevated, #fff);
        color: var(--accent-error, #D93A62);
        font: inherit;
        font-size: var(--type-body-muted-size);
        line-height: 1.35;
        text-align: left;
        pointer-events: none;
        filter: drop-shadow(0 4px 10px rgba(34, 44, 32, 0.14));
        animation: warning-in 0.18s cubic-bezier(0.2, 0, 0, 1) both;
    }

    :global(html.painterly) .clear__warning {
        --paint-wash-strength: 1;
        --paint-scale: 2.2;
        background-image:
            paint(painterly-wash),
            linear-gradient(var(--surface-page-elevated, #fff), var(--surface-page-elevated, #fff));
    }

    .clear__warning::before {
        content: "";
        position: absolute;
        top: -6px;
        left: 14px;
        width: 11px;
        height: 11px;
        rotate: 45deg;
        background: inherit;
        border-top: 1.5px solid var(--accent-error, #D93A62);
        border-left: 1.5px solid var(--accent-error, #D93A62);
    }

    @keyframes warning-in {
        from { opacity: 0; translate: 0 -5px; }
    }

    @media (prefers-reduced-motion: reduce) {
        .bar,
        .chapter,
        .play,
        .clear {
            transition-duration: 0s;
        }
        .clear__warning { animation: none; }
    }
</style>
