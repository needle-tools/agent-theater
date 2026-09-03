<script lang="ts">
    import { onMount } from "svelte";
    import { onAgentActivity, type AgentActivity } from "$lib/room/activity";

    interface Props {
        canvas: HTMLElement | null;
    }

    let { canvas }: Props = $props();
    let visible = $state(false);
    let speaking = $state(false);
    let text = $state("");
    let x = $state(0);
    let y = $state(0);
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let speechTimer: ReturnType<typeof setTimeout> | null = null;

    const WORDS: Record<string, string> = {
        piece_list: "Looking through the pieces…",
        piece_add: "Bringing this onto the stage…",
        theater_add: "Adding this to the stage…",
        theater_clear: "Clearing the stage…",
        stage_describe: "Taking a look at the scene…",
        stage_cast: "Putting the cast in place…",
        stage_create: "Setting the next scene…",
        stage_play: "Starting the show…",
        show_play: "Starting the show…",
        show_watch: "Watching the stage…",
        show_title: "Lettering the title card…",
        show_export: "Preparing the finished play…",
    };

    function words(tool: string): string {
        if (WORDS[tool]) return WORDS[tool];
        const action = tool.replace(/^(piece|stage|show|theater)_/, "").replaceAll("_", " ");
        return `${action.charAt(0).toUpperCase()}${action.slice(1)}…`;
    }

    function strings(value: unknown, found: string[] = []): string[] {
        if (typeof value === "string") found.push(value);
        else if (Array.isArray(value)) value.forEach(item => strings(item, found));
        else if (value && typeof value === "object") Object.values(value).forEach(item => strings(item, found));
        return found;
    }

    function destination(activity: AgentActivity): { x: number; y: number } {
        const bounds = canvas?.getBoundingClientRect();
        if (!bounds) return { x: innerWidth / 2, y: innerHeight / 2 };

        for (const value of strings(activity.args)) {
            const layer = canvas?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(value)}"]`);
            if (!layer) continue;
            const box = layer.getBoundingClientRect();
            return {
                x: Math.max(bounds.left + 42, Math.min(bounds.right - 42, box.left + box.width * 0.72)),
                y: Math.max(bounds.top + 72, Math.min(bounds.bottom - 42, box.top + box.height * 0.45)),
            };
        }

        // Broad actions still happen somewhere tangible. The small hash keeps
        // successive tools from piling the character on one exact pixel.
        const hash = [...activity.tool].reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return {
            x: bounds.left + bounds.width * (0.38 + (hash % 25) / 100),
            y: bounds.top + bounds.height * (0.35 + (hash % 19) / 100),
        };
    }

    function show(activity: AgentActivity) {
        const next = destination(activity);
        x = next.x;
        y = next.y;
        text = words(activity.tool);
        visible = true;
        speaking = true;
        if (hideTimer) clearTimeout(hideTimer);
        if (speechTimer) clearTimeout(speechTimer);
        speechTimer = setTimeout(() => (speaking = false), 3500);
        hideTimer = setTimeout(() => (visible = false), 4300);

        // An add tool creates its target after this notification. Recheck once
        // Svelte has painted so the agent walks the last step to the new piece.
        setTimeout(() => {
            if (!visible) return;
            const later = destination(activity);
            x = later.x;
            y = later.y;
        }, 120);
    }

    onMount(() => {
        const off = onAgentActivity(show);
        return () => {
            off();
            if (hideTimer) clearTimeout(hideTimer);
            if (speechTimer) clearTimeout(speechTimer);
        };
    });
</script>

<div
    class="agent"
    class:agent--visible={visible}
    style:left="{x}px"
    style:top="{y}px"
    aria-live="polite"
>
    <div class="agent__bubble" class:agent__bubble--visible={speaking}>{text}</div>
    <img class="agent__figure" src="/cursors/agent-working-64.png" alt="Agent" />
</div>

<style>
    .agent {
        position: fixed;
        z-index: 34;
        display: grid;
        grid-template-columns: auto 58px;
        align-items: end;
        gap: 8px;
        translate: -50% -55%;
        opacity: 0;
        scale: 0.8;
        pointer-events: none;
        transition-property: left, top, opacity, scale;
        transition-duration: 560ms, 560ms, 160ms, 220ms;
        transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
        will-change: opacity;
    }

    .agent--visible {
        opacity: 1;
        scale: 1;
    }

    .agent__figure {
        width: 58px;
        height: 58px;
        object-fit: contain;
        filter: drop-shadow(0 5px 7px rgba(31, 26, 19, 0.2));
        animation: working 900ms ease-in-out infinite alternate;
    }

    .agent__bubble {
        position: relative;
        max-width: min(250px, 42vw);
        margin-bottom: 37px;
        padding: 9px 13px;
        border: 2px solid color-mix(in srgb, var(--accent-tertiary) 55%, transparent);
        border-radius: 15px;
        background: color-mix(in srgb, var(--accent-tertiary) 11%, var(--surface-panel));
        color: var(--text-primary);
        box-shadow: 0 5px 14px rgba(34, 44, 32, 0.12);
        font-size: var(--type-body-muted-size);
        line-height: 1.3;
        text-wrap: pretty;
        opacity: 0;
        translate: 5px 4px;
        scale: 0.92;
        transform-origin: right bottom;
        transition-property: opacity, translate, scale;
        transition-duration: 160ms;
        transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }

    .agent__bubble::after {
        content: "";
        position: absolute;
        right: -7px;
        bottom: 12px;
        width: 12px;
        height: 12px;
        rotate: -45deg;
        background: inherit;
        border-right: 2px solid color-mix(in srgb, var(--accent-tertiary) 55%, transparent);
        border-bottom: 2px solid color-mix(in srgb, var(--accent-tertiary) 55%, transparent);
        border-bottom-right-radius: 3px;
    }

    .agent__bubble--visible {
        opacity: 1;
        translate: 0 0;
        scale: 1;
    }

    @keyframes working {
        from { translate: 0 0; rotate: -2deg; }
        to { translate: 0 -3px; rotate: 2deg; }
    }

    @media (prefers-reduced-motion: reduce) {
        .agent { transition-duration: 0ms; }
        .agent__figure { animation: none; }
        .agent__bubble { transition-duration: 0ms; }
    }
</style>
