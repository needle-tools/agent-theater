<script lang="ts">
    /**
     * The house controls.
     *
     * Everything about the theatre could be driven by the agent, and for a
     * while all of it was — which meant the person who had just spent an hour
     * arranging a scene could not watch it without asking somebody else to
     * press play. That is the wrong way round: the agent is a collaborator
     * here, not the projectionist.
     *
     * So: the scenes as chips, and one button. It appears only once there is
     * something to play, because a transport control over an empty canvas is a
     * promise the page cannot keep.
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
    $effect(() => {
        showing = studio.showing;
        return studio.onShowChanged(() => (showing = studio.showing));
    });

    const stages = $derived.by(() => (version, collage.listStages()));
    const activeId = $derived.by(() => (version, collage.activeStageId));
</script>

{#if stages.length}
    <div class="bar" class:bar--showing={!!showing} role="group" aria-label="Scenes">
        {#if !showing}
            <div class="scenes">
                {#each stages as stage (stage.id)}
                    <button
                        class="scene"
                        class:scene--active={stage.id === activeId}
                        aria-pressed={stage.id === activeId}
                        onclick={() => collage.setActiveStage(stage.id)}
                    >{stage.name}</button>
                {/each}
            </div>
        {:else}
            <!-- During the show the bar says only what is playing. Naming it
                 matters more than the chips do: the canvas is dimmed and the
                 scene is the only thing left to orient by. -->
            <span class="now">{stages.find(stage => stage.id === showing)?.name ?? "Playing"}</span>
        {/if}

        <button
            class="play"
            class:play--stop={!!showing}
            aria-label={showing ? "Stop the show" : "Play the show"}
            onclick={() => (showing ? studio.stopShow() : studio.playShow())}
        >
            {#if showing}
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
                </svg>
            {:else}
                <!-- Nudged right by a hair. A triangle centred on its bounding
                     box reads as sitting left of centre, because its mass is on
                     the flat side. -->
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9.5 6.8 17.5 12l-8 5.2Z" fill="currentColor" stroke="currentColor"
                        stroke-width="1.6" stroke-linejoin="round" />
                </svg>
            {/if}
        </button>
    </div>
{/if}

<style>
    /*
     * Along the top, in the middle.
     *
     * The whole bottom edge belongs to the browser's agent now: ChatGPT puts
     * its voice control in the middle of it and its activity bubbles at the
     * left, and this bar was underneath both in turn. The top edge is ours —
     * the wordmark takes a corner, the menu button the other, and the span
     * between them is empty.
     */
    .bar {
        position: absolute;
        left: 50%;
        top: 14px;
        z-index: 25;
        translate: -50% 0;
        display: flex;
        align-items: center;
        gap: 6px;
        /* Outer 16 = inner 10 + 6 padding. */
        border-radius: 16px;
        padding: 6px;
        background: var(--surface-panel);
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--border-subtle) 60%, transparent),
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 10px 26px rgba(34, 44, 32, 0.10);
        transition-property: opacity, background, box-shadow;
        transition-duration: 0.4s;
        transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }

    /*
     * Nearly out of the way while the show runs, and back the moment the
     * pointer looks for it. A control that vanished completely would leave no
     * way to stop the thing; one that stayed lit would be the brightest object
     * on a deliberately darkened canvas.
     */
    .bar--showing {
        opacity: 0.35;
        background: color-mix(in srgb, var(--surface-panel) 55%, #10131a);
    }

    .bar--showing:hover,
    .bar--showing:focus-within {
        opacity: 1;
    }

    .scenes {
        display: flex;
        align-items: center;
        gap: 4px;
        max-width: min(38vw, 26rem);
        overflow-x: auto;
        scrollbar-width: none;
    }

    .scenes::-webkit-scrollbar {
        display: none;
    }

    .scene {
        flex: none;
        min-height: 32px;
        padding: 0 0.7rem;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: var(--text-secondary);
        font: inherit;
        font-size: var(--type-micro-label-size);
        white-space: nowrap;
        cursor: pointer;
        transition-property: background, color, scale;
        transition-duration: 0.14s;
    }

    .scene:hover {
        background: var(--surface-panel-muted);
        color: var(--text-primary);
    }

    .scene:active {
        scale: 0.96;
    }

    .scene--active {
        background: var(--surface-panel-strong, var(--surface-panel-muted));
        color: var(--text-primary);
        font-weight: 600;
    }

    .now {
        padding: 0 0.7rem;
        color: var(--text-secondary);
        font-size: var(--type-micro-label-size);
        white-space: nowrap;
    }

    .play {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border: 0;
        border-radius: 10px;
        background: var(--accent-brand);
        color: #14200f;
        cursor: pointer;
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

    .play svg {
        width: 18px;
        height: 18px;
    }

    @media (prefers-reduced-motion: reduce) {
        .bar,
        .scene,
        .play {
            transition-duration: 0s;
        }
    }
</style>
