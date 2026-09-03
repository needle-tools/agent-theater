<script lang="ts" module>
    export interface Toast {
        id: number;
        text: string;
        tone: "info" | "busy" | "error" | "agent";
    }

    let nextId = 0;

    /** How long each kind stays. A failure is worth reading twice. */
    export const LIFETIME = { info: 3800, error: 7000, busy: 0, agent: 4200 } as const;

    export function createToasts() {
        let items = $state<Toast[]>([]);
        const timers = new Map<number, ReturnType<typeof setTimeout>>();

        function drop(id: number) {
            const timer = timers.get(id);
            if (timer) clearTimeout(timer);
            timers.delete(id);
            items = items.filter(item => item.id !== id);
        }

        return {
            get items() {
                return items;
            },
            /**
             * Say something. Returns a handle so a long job can update its own
             * bubble in place — a progress line that spawned a new bubble per
             * percent would bury everything else.
             */
            push(text: string, tone: Toast["tone"] = "info") {
                const id = ++nextId;
                items = [...items, { id, text, tone }];
                if (LIFETIME[tone]) timers.set(id, setTimeout(() => drop(id), LIFETIME[tone]));
                return {
                    id,
                    update(next: string, nextTone: Toast["tone"] = tone) {
                        items = items.map(item => (item.id === id ? { ...item, text: next, tone: nextTone } : item));
                        const timer = timers.get(id);
                        if (timer) clearTimeout(timer);
                        if (LIFETIME[nextTone]) timers.set(id, setTimeout(() => drop(id), LIFETIME[nextTone]));
                    },
                    close: () => drop(id),
                };
            },
            dismiss: drop,
        };
    }
</script>

<script lang="ts">
    /**
     * Little speech bubbles in the corner.
     *
     * The page used to put whole paragraphs in one wide pill across the bottom
     * of the screen, which read as an error dialogue whatever it said. These
     * are small, they stack, they go away on their own, and they are capped in
     * width so a long message wraps into a bubble shape instead of a banner.
     *
     * Anything that genuinely needs more words belongs in the options panel or
     * in the tool result an agent reads — not shouted across the canvas.
     */
    import { fly } from "svelte/transition";
    import { flip } from "svelte/animate";

    interface Props {
        items: Toast[];
        onDismiss: (id: number) => void;
    }

    let { items, onDismiss }: Props = $props();
</script>

<div class="stack" aria-live="polite">
    {#each items as toast (toast.id)}
        <button
            class="bubble bubble--{toast.tone}"
            animate:flip={{ duration: 220 }}
            in:fly={{ y: 10, duration: 200 }}
            out:fly={{ y: 6, duration: 140 }}
            onclick={() => onDismiss(toast.id)}
            title="Dismiss"
        >
            {#if toast.tone === "busy"}
                <span class="spinner" aria-hidden="true"></span>
            {:else if toast.tone === "agent"}
                <span class="pulse" aria-hidden="true"></span>
            {/if}
            <span class="text">{toast.text}</span>
        </button>
    {/each}
</div>

<style>
    /*
     * Top left, under the wordmark.
     *
     * They were bottom left, which is where a browser-integrated agent shows
     * what it is doing — "Agent used piece_list" landed directly on top of
     * them. Two systems narrating themselves in the same corner is a pile,
     * and this is the page's own corner to give up.
     */
    .stack {
        position: absolute;
        left: 16px;
        top: 58px;
        z-index: 35;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        pointer-events: none;
    }

    .bubble {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        /* Narrow enough that a long message wraps into a bubble rather than
           stretching into a banner across the whole canvas. */
        max-width: min(320px, calc(100vw - 32px));
        padding: 9px 13px;
        /*
         * A real border, not a ring of drop-shadows. Chained filters compound —
         * each stamp dilates the result of the last — so the "outline" came out
         * heavy on two sides and thin on the others. A border is the same width
         * everywhere by construction.
         */
        border: 2px solid var(--edge);
        border-radius: 15px;
        /* A whisper of Needle green rather than a plain white chip. */
        background: color-mix(in srgb, var(--accent-brand) 13%, var(--surface-panel));
        color: var(--text-primary);
        font: inherit;
        font-size: var(--type-body-muted-size);
        line-height: 1.35;
        text-align: left;
        text-wrap: pretty;
        cursor: var(--cursor-pointer, pointer);
        pointer-events: auto;
        /*
         * The soft shadow still goes through a filter rather than box-shadow,
         * because a filter traces the rendered silhouette — bubble and beak
         * together — where box-shadow would trace the border box and leave the
         * beak floating without one.
         */
        --edge: color-mix(in srgb, var(--accent-brand-deep) 60%, transparent);
        filter: drop-shadow(0 4px 10px rgba(34, 44, 32, 0.12));
        transition-property: background, scale;
        transition-duration: 0.14s;
    }

    .bubble:hover {
        background: color-mix(in srgb, var(--accent-brand) 22%, var(--surface-panel));
    }

    .bubble:active {
        scale: 0.96;
    }

    /*
     * The beak: a square turned 45° with a border on its two outer sides, so
     * those get exactly the same stroke as the bubble. It sits half outside,
     * and its own opaque background covers the length of the bubble's border it
     * overlaps — which is what joins the two into one outlined shape.
     */
    .bubble::after {
        content: "";
        position: absolute;
        left: -7px;
        /* Centred on the left edge. `translate` and `rotate` are separate
           properties and compose in that order, so the shift is applied about
           the beak's own box before it is turned — which is what keeps it
           centred rather than swinging off. */
        top: 50%;
        translate: 0 -50%;
        rotate: 45deg;
        width: 12px;
        height: 12px;
        background: inherit;
        border-left: 2px solid var(--edge);
        border-bottom: 2px solid var(--edge);
        border-bottom-left-radius: 3px;
    }

    /* Each tone carries its own edge, so the outline belongs to the bubble
       rather than looking painted on.

       --accent-error is declared only in brand.css's dark block, so in light
       mode it resolves to nothing — and an invalid color-mix takes the whole
       declaration with it, which left error bubbles as bare text on the canvas.
       The fallback is the light-mode counterpart of the dark #FF6B8F. */
    .bubble--error {
        --error: var(--accent-error, #D93A62);
        --edge: color-mix(in srgb, var(--error) 55%, transparent);
        background: color-mix(in srgb, var(--error) 13%, var(--surface-panel));
    }

    .bubble--error:hover {
        background: color-mix(in srgb, var(--error) 20%, var(--surface-panel));
    }

    /* A different hue for the agent, so who did what is legible at a glance
       without reading the words. */
    .bubble--agent {
        --edge: color-mix(in srgb, var(--accent-tertiary) 50%, transparent);
        background: color-mix(in srgb, var(--accent-tertiary) 11%, var(--surface-panel));
    }

    .bubble--agent:hover {
        background: color-mix(in srgb, var(--accent-tertiary) 18%, var(--surface-panel));
    }

    .pulse {
        flex: none;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--accent-tertiary);
        animation: pulse 1.6s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
    }

    .bubble--busy {
        --edge: color-mix(in srgb, var(--accent-secondary) 50%, transparent);
        background: color-mix(in srgb, var(--accent-secondary) 12%, var(--surface-panel));
    }

    .bubble--busy:hover {
        background: color-mix(in srgb, var(--accent-secondary) 18%, var(--surface-panel));
    }

    .text {
        min-width: 0;
    }

    .spinner {
        flex: none;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--accent-brand) 30%, transparent);
        border-top-color: var(--accent-brand);
        animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
        to { rotate: 360deg; }
    }

    @media (prefers-reduced-motion: reduce) {
        .spinner { animation-duration: 2s; }
        .pulse { animation: none; }
    }
</style>
