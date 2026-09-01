<script lang="ts" module>
    export interface Toast {
        id: number;
        text: string;
        tone: "info" | "busy" | "error";
    }

    let nextId = 0;

    /** How long each kind stays. A failure is worth reading twice. */
    const LIFETIME = { info: 3800, error: 7000, busy: 0 } as const;

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
            {/if}
            <span class="text">{toast.text}</span>
        </button>
    {/each}
</div>

<style>
    .stack {
        position: fixed;
        left: 16px;
        bottom: 16px;
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
        /* Big radius with one small corner: the shape reads as speech. */
        border: 0;
        border-radius: 16px 16px 16px 5px;
        background: var(--surface-panel);
        color: var(--text-secondary);
        font: inherit;
        font-size: var(--type-body-muted-size);
        line-height: 1.35;
        text-align: left;
        text-wrap: pretty;
        cursor: pointer;
        pointer-events: auto;
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--border-subtle) 55%, transparent),
            0 1px 2px rgba(34, 44, 32, 0.05),
            0 8px 20px rgba(34, 44, 32, 0.09);
        transition-property: background, scale;
        transition-duration: 0.14s;
    }

    .bubble:hover {
        background: var(--surface-panel-muted);
    }

    .bubble:active {
        scale: 0.96;
    }

    /* The tail. A small square rotated under the bottom-left corner, sharing
       the bubble's own background so it reads as one shape. */
    .bubble::after {
        content: "";
        position: absolute;
        left: 1px;
        bottom: -3px;
        width: 10px;
        height: 10px;
        background: inherit;
        border-bottom-left-radius: 2px;
        clip-path: polygon(0 100%, 100% 0, 100% 100%);
        transform: scaleX(-1);
    }

    .bubble--error {
        background: color-mix(in srgb, var(--accent-error) 9%, var(--surface-panel));
        color: var(--text-primary);
    }

    .bubble--busy {
        color: var(--text-primary);
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
    }
</style>
