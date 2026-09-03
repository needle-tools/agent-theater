<script lang="ts">
    /**
     * What sits in front of the stage while the show runs.
     *
     * All of it the auditorium rather than the play: the vignette that darkens
     * the corners so the eye falls to the middle, the card that asks to be let
     * in, the title the show opens on, and the credits that roll at the end.
     *
     * None of it is interactive and none of it is timed here — the studio owns
     * the running order, and this draws whatever it says is up. A card that
     * timed itself would drift out of step with the scenes it sits between.
     */
    import type { CollageStudio } from "./studio";
    import { CREDIT_LINE_MS, type Billboard } from "./billboard";

    let { studio }: { studio: CollageStudio } = $props();

    let showing = $state<string | null>(null);
    let billboard = $state<Billboard | null>(null);

    $effect(() => {
        const read = () => {
            showing = studio.showing;
            billboard = studio.billboard;
        };
        read();
        return studio.onShowChanged(read);
    });
</script>

{#if showing || billboard}
    <!-- Pointer-transparent throughout: the canvas underneath stays usable, so
         a person can still grab something mid-show rather than being locked
         out of their own document by a decoration. -->
    <div class="overlay" aria-hidden="true">
        <div class="vignette"></div>

        {#if billboard?.kind === "blackout"}
            <!-- The between-scenes dark: rises, holds while the set is swapped
                 behind it, lifts. The studio holds the billboard for exactly
                 the animation's length, so neither can outlive the other. -->
            <div class="blackout" style:--blackout="{billboard.duration}ms"></div>
        {:else if billboard?.kind === "waiting"}
            <!-- The one card that is asking for something rather than showing
                 something. It says why, because "click to continue" with no
                 reason reads as a nag. -->
            <div class="card">
                {#if billboard.title}
                    <p class="byline">{billboard.title}</p>
                {/if}
                <h2 class="title">Click anywhere to begin</h2>
                <p class="byline">The browser keeps the sound off until you do.</p>
            </div>
        {:else if billboard?.kind === "title"}
            <div class="card">
                <h2 class="title">{billboard.title}</h2>
                {#if billboard.byline}
                    <p class="byline">{billboard.byline}</p>
                {/if}
            </div>
        {:else if billboard?.kind === "credits"}
            <div class="roll" style:--roll="{billboard.duration}ms">
                <div class="roll__inner">
                    {#if billboard.title}
                        <h2 class="roll__title">{billboard.title}</h2>
                    {/if}
                    {#each billboard.lines as line, index (line + index)}
                        <p class="credit" style:animation-delay="{index * CREDIT_LINE_MS * 0.25}ms">{line}</p>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
{/if}

<style>
    .overlay {
        position: absolute;
        inset: 0;
        z-index: 24;
        pointer-events: none;
    }

    /*
     * The corners going dark.
     *
     * A radial gradient rather than an inset box-shadow: a shadow is drawn from
     * the edges inward and always looks like a frame around the picture, where
     * a gradient centred on the middle looks like light falling on it. Screen
     * coordinates on purpose — it is the auditorium, so it does not pan with
     * the canvas.
     */
    .vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(
            ellipse 78% 78% at 50% 48%,
            transparent 40%,
            rgba(8, 10, 14, 0.28) 78%,
            rgba(8, 10, 14, 0.62) 100%);
        opacity: 0;
        animation: lights-down 1.2s cubic-bezier(0.2, 0, 0, 1) forwards;
    }

    @keyframes lights-down {
        to { opacity: 1; }
    }

    /* Both cards sit on their own darkening, over the vignette, because text
       over a scene is unreadable however dark the corners are. */
    .card,
    .roll {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 6vh 8vw;
        background: rgba(8, 10, 14, 0.82);
        color: #f4f2ee;
        text-align: center;
    }

    .card {
        animation: card-in 0.7s cubic-bezier(0.2, 0, 0, 1);
    }

    .blackout {
        position: absolute;
        inset: 0;
        background: #0b0d11;
        animation: blackout var(--blackout, 900ms) ease-in-out forwards;
    }

    @keyframes blackout {
        0% { opacity: 0; }
        45%, 60% { opacity: 1; }
        100% { opacity: 0; }
    }

    @keyframes card-in {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    .title {
        margin: 0;
        font-family: var(--font-family-display);
        font-size: clamp(2rem, 6.5vw, 5rem);
        font-weight: 600;
        line-height: 1.05;
        letter-spacing: -0.02em;
        text-wrap: balance;
        /* Staggered behind the byline: the name lands, then the subtitle
           follows it, which is the order they would be read in anyway. */
        animation: rise 0.9s cubic-bezier(0.2, 0, 0, 1) both;
    }

    .byline {
        margin: 1.1rem 0 0;
        max-width: 40rem;
        color: rgba(244, 242, 238, 0.68);
        font-size: clamp(0.95rem, 1.8vw, 1.3rem);
        line-height: 1.4;
        text-wrap: pretty;
        animation: rise 0.9s cubic-bezier(0.2, 0, 0, 1) 0.22s both;
    }

    @keyframes rise {
        from { opacity: 0; translate: 0 14px; }
        to { opacity: 1; translate: 0 0; }
    }

    /*
     * The roll.
     *
     * Actually rolling — translated up over the whole of its time — because a
     * credit list that simply appeared would be a list. The lines also fade in
     * one after another as they climb, so the eye is given somewhere to start.
     */
    .roll__inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.85rem;
        animation: roll var(--roll, 8s) linear both;
    }

    @keyframes roll {
        from { translate: 0 22%; }
        to { translate: 0 -14%; }
    }

    .roll__title {
        margin: 0 0 1.4rem;
        font-family: var(--font-family-display);
        font-size: clamp(1.3rem, 3vw, 2.2rem);
        font-weight: 600;
        text-wrap: balance;
    }

    .credit {
        margin: 0;
        color: rgba(244, 242, 238, 0.86);
        font-size: clamp(0.95rem, 2vw, 1.35rem);
        line-height: 1.35;
        text-wrap: balance;
        animation: rise 0.6s cubic-bezier(0.2, 0, 0, 1) both;
    }

    /*
     * Reduced motion keeps the darkening and drops the travel. The information
     * is in the words, and none of the movement carries any of it.
     */
    @media (prefers-reduced-motion: reduce) {
        .vignette,
        .card,
        .title,
        .byline,
        .credit {
            animation-duration: 0.01ms;
            animation-delay: 0ms;
        }

        .roll__inner {
            animation: none;
        }
    }
</style>
