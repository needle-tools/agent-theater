<script lang="ts">
    import { onMount } from "svelte";
    import { onAgentActivity, type AgentActivity } from "$lib/room/activity";
    import { clipKeyframes, findClip } from "$lib/collage/clips";

    interface Props {
        canvas: HTMLElement | null;
    }

    let { canvas }: Props = $props();
    let visible = $state(false);
    let speaking = $state(false);
    let sleeping = $state(false);
    let text = $state("");
    let state = $state("working");
    let x = $state(0);
    let y = $state(0);
    let figure: HTMLImageElement;
    let motion: Animation | null = null;
    let sleepTimer: ReturnType<typeof setTimeout> | null = null;
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
        show_save: "Saving the play…",
        show_publish: "Publishing the play…",
        show_list: "Looking through published plays…",
        show_load: "Opening another play…",
    };

    function words(tool: string): string {
        if (WORDS[tool]) return WORDS[tool];
        const action = tool.replace(/^(piece|stage|show|theater)_/, "").replaceAll("_", " ");
        return `${action.charAt(0).toUpperCase()}${action.slice(1)}…`;
    }

    function iconState(tool: string): string {
        if (tool === "piece_list") return "searching";
        if (tool === "stage_describe") return "reading";
        if (tool === "show_title") return "writing";
        if (tool === "theater_clear") return "refreshing";
        if (tool === "stage_cast") return "planning";
        if (tool === "show_watch") return "listening";
        if (tool === "stage_play" || tool === "show_play") return "delighted";
        return "working";
    }

    function fly(firstArrival: boolean) {
        motion?.cancel();
        const clip = findClip(firstArrival ? "agent-flying" : "agent-flying-soft");
        if (!clip || !figure || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        motion = figure.animate(clipKeyframes(clip, 24), {
            duration: clip.seconds * 1000,
            easing: "linear",
            iterations: firstArrival ? 1 : Infinity,
        });
        if (firstArrival) {
            void motion.finished.then(() => {
                if (!sleeping) fly(false);
            }, () => undefined);
        }
    }

    function sleep() {
        sleeping = true;
        motion?.cancel();
        motion = null;
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

        // Broad actions belong at the edge of the stage, not hovering over the
        // actors in the middle of the play. Keep a little vertical variation
        // between tools while giving the speech bubble room on the left.
        const hash = [...activity.tool].reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return {
            x: bounds.right - 54,
            y: bounds.top + Math.min(118, Math.max(82, bounds.height * 0.16 + (hash % 3) * 12)),
        };
    }

    function show(activity: AgentActivity) {
        const firstArrival = !visible;
        const next = destination(activity);
        x = next.x;
        y = next.y;
        text = words(activity.tool);
        state = iconState(activity.tool);
        visible = true;
        speaking = true;
        sleeping = false;
        if (sleepTimer) clearTimeout(sleepTimer);
        if (speechTimer) clearTimeout(speechTimer);
        speechTimer = setTimeout(() => (speaking = false), 3500);
        // Once the agent has arrived it belongs to the stage. After a quiet
        // spell it settles here instead of vanishing; a dedicated sleeping
        // figure can replace the working image when those assets arrive.
        sleepTimer = setTimeout(sleep, 30_000);
        requestAnimationFrame(() => fly(firstArrival));

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
            if (sleepTimer) clearTimeout(sleepTimer);
            if (speechTimer) clearTimeout(speechTimer);
            motion?.cancel();
        };
    });
</script>

<div
    class="agent"
    class:agent--visible={visible}
    class:agent--sleeping={sleeping}
    style:left="{x}px"
    style:top="{y}px"
    aria-live="polite"
>
    <div class="agent__bubble" class:agent__bubble--visible={speaking}>{text}</div>
    <img
        bind:this={figure}
        class="agent__figure"
        src={sleeping ? "/agents/agent-sleeping.png" : `/agents/agent-${state}.png`}
        alt={sleeping ? "Sleeping agent" : "Agent working"}
    />
</div>

<style>
    .agent {
        position: fixed;
        z-index: 34;
        display: grid;
        grid-template-columns: auto 68px;
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
        width: 68px;
        height: 68px;
        object-fit: contain;
        filter: drop-shadow(0 5px 7px rgba(31, 26, 19, 0.2));
        transition: opacity 240ms ease, filter 240ms ease, scale 240ms ease;
    }

    .agent--sleeping .agent__figure {
        opacity: 0.82;
        scale: 0.94;
        filter: grayscale(0.12) drop-shadow(0 4px 6px rgba(31, 26, 19, 0.16));
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

    @media (prefers-reduced-motion: reduce) {
        .agent { transition-duration: 0ms; }
        .agent__bubble { transition-duration: 0ms; }
    }
</style>
