<script lang="ts">
    import { onMount } from "svelte";
    import { onAgentActivity, type AgentActivity } from "$lib/room/activity";
    import { clipKeyframes, findClip } from "$lib/collage/clips";
    import {
        avatarFrame,
        avatarLookCell,
        avatarLookDirection,
        onAgentAvatarSheet,
        type AgentAvatarSheet,
    } from "$lib/collage/agentAvatar";

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
    let figure = $state<HTMLElement>();
    let motion: Animation | null = null;
    let sleepTimer: ReturnType<typeof setTimeout> | null = null;
    let sheet = $state<AgentAvatarSheet | null>(null);
    let phase = $state<AgentActivity["phase"]>("working");
    let frameColumn = $state(0);
    let frameRow = $state(0);
    let currentActivity: AgentActivity | null = null;
    let speechTimer: ReturnType<typeof setTimeout> | null = null;
    let frameTimer: ReturnType<typeof setInterval> | null = null;

    const frame = $derived(sheet ? avatarFrame(sheet, frameColumn, frameRow) : { x: "0%", y: "0%" });
    const backgroundSize = $derived(sheet ? `${sheet.columns * 100}% ${sheet.rows * 100}%` : "auto");

    const WORDS: Record<string, string[]> = {
        theater_batch: ["One thing at a time…", "Let me sort these out…", "A few little changes…"],
        theater_start: ["Let's see what we have…", "Checking it out…", "Oh, this is nice."],
        theater_clear: ["A fresh start…", "Tidying everything away…", "Clearing some room…"],
        theater_avatar: ["Trying on a new look…", "This feels more like me…"],
        piece_list: ["Let's see what we have…", "Checking it out…", "Taking it all in…"],
        piece_add: ["Here this goes…", "Making room for this…", "This belongs right here…"],
        piece_copy: ["And one more…", "A twin for the stage…", "Making another…"],
        piece_move: ["Just over here…", "A little this way…", "Finding the right spot…"],
        piece_remove: ["Away this goes…", "Tidying this up…", "We won't need this…"],
        piece_text: ["Adding a few words…", "Let's write this down…"],
        piece_set_text: ["A small rewrite…", "That reads better…"],
        piece_style: ["A little finishing touch…", "Making this feel right…"],
        piece_sheet: ["Opening the whole bundle…", "Let's see who's in here…"],
        stage_describe: ["Checking it out…", "This is coming together…", "Having a closer look…"],
        stage_cast: ["Everyone, places…", "Gathering the cast…", "Who's in this scene?"],
        stage_create: ["A new scene…", "Setting the next moment…", "Let's make a place for this…"],
        stage_script: ["Bringing it to life…", "Now, let's make it move…", "This should be fun…"],
        stage_remove: ["Closing this chapter…", "We can let this scene go…"],
        show_play: ["Here we go…", "Curtain up…", "Enjoy the show!"],
        show_stop: ["And, scene…", "Holding right there…"],
        show_watch: ["Let's see what's new…", "Having another look…", "Checking it out…"],
        show_look: ["Taking it all in…", "This is nice…", "Let's have a look…"],
        show_title: ["Every story needs a name…", "Putting a name on it…"],
        show_export: ["Wrapping it up nicely…", "Getting it ready for you…"],
        show_save: ["Keeping this safe…", "Saving our place…"],
        show_publish: ["Sending it out into the world…", "Ready to share…"],
        show_list: ["What shall we watch?", "Looking through the playbill…"],
        show_load: ["Opening the curtain again…", "Let's return to this one…"],
    };

    function words(activity: AgentActivity): string {
        const choices = WORDS[activity.tool] ?? ["Just a moment…", "On it…", "Let's see…"];
        return choices[activity.id % choices.length];
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

    function onScreen(x: number, y: number, width: number, height: number): { x: number; y: number } {
        const side = 48;
        const top = 96;
        return {
            x: Math.max(side, Math.min(Math.max(side, width - side), x)),
            y: Math.max(top, Math.min(Math.max(top, height - side), y)),
        };
    }

    function destination(activity: AgentActivity): { x: number; y: number; look: number } {
        const bounds = canvas?.getBoundingClientRect();
        if (!bounds) return { x: 72, y: 96, look: 8 };

        for (const value of strings(activity.args)) {
            const layer = canvas?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(value)}"]`);
            if (!layer) continue;
            const box = layer.getBoundingClientRect();
            const focusX = box.left - bounds.left + box.width / 2;
            const focusY = box.top - bounds.top + box.height / 2;
            const standRight = focusX < bounds.width / 2;
            const point = onScreen(
                focusX + (standRight ? 1 : -1) * Math.min(54, box.width * 0.38 + 20),
                focusY - 18,
                bounds.width,
                bounds.height,
            );
            const atX = point.x;
            const atY = point.y;
            const look = avatarLookDirection(focusX - atX, focusY - atY, sheet?.columns ?? 8);
            return { x: atX, y: atY, look };
        }

        // Broad actions park at a viewport-fixed inset, like the menu and
        // eraser, rather than following the potentially enormous canvas.
        const hash = [...activity.tool].reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return {
            ...onScreen(bounds.width - 72, 96 + (hash % 3) * 12, bounds.width, bounds.height),
            look: hash % 16,
        };
    }

    function stopFrames() {
        if (frameTimer) clearInterval(frameTimer);
        frameTimer = null;
    }

    function thinkingFrames() {
        stopFrames();
        if (!sheet) return;
        frameRow = Math.max(0, sheet.rows - 5);
        frameColumn = 0;
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const count = Math.min(6, sheet.columns);
        frameTimer = setInterval(() => {
            frameColumn = (frameColumn + 1) % count;
        }, 190);
    }

    function lookingFrame(index: number) {
        stopFrames();
        if (!sheet) return;
        const cell = avatarLookCell(sheet, index);
        frameRow = cell.row;
        frameColumn = cell.column;
    }

    function lookAtPointer(event: PointerEvent) {
        if (!visible || phase === "thinking" || !sheet) return;
        if (event.pointerType && event.pointerType !== "mouse") return;
        const bounds = canvas?.getBoundingClientRect();
        lookingFrame(avatarLookDirection(
            event.clientX - (bounds?.left ?? 0) - x,
            event.clientY - (bounds?.top ?? 0) - y,
            sheet.columns,
        ));
    }

    function show(activity: AgentActivity) {
        currentActivity = activity;
        const firstArrival = !visible;
        const next = destination(activity);
        x = next.x;
        y = next.y;
        phase = activity.phase;
        text = words(activity);
        state = iconState(activity.tool);
        visible = true;
        speaking = true;
        sleeping = false;
        if (sleepTimer) clearTimeout(sleepTimer);
        if (speechTimer) clearTimeout(speechTimer);
        if (activity.phase === "thinking") {
            thinkingFrames();
            requestAnimationFrame(() => fly(firstArrival));
            return;
        }
        lookingFrame(next.look);
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
            lookingFrame(later.look);
        }, 120);
    }

    function keepPositionOnScreen() {
        if (!currentActivity) return;
        const next = destination(currentActivity);
        x = next.x;
        y = next.y;
        if (phase !== "thinking") lookingFrame(next.look);
    }

    onMount(() => {
        const off = onAgentActivity(show);
        const offAvatar = onAgentAvatarSheet(value => {
            sheet = value;
            if (!value) return;
            if (phase === "thinking") thinkingFrames();
            else lookingFrame(0);
        });
        return () => {
            off();
            if (sleepTimer) clearTimeout(sleepTimer);
            offAvatar();
            if (speechTimer) clearTimeout(speechTimer);
            stopFrames();
            motion?.cancel();
        };
    });
</script>

<svelte:window onpointermove={lookAtPointer} onresize={keepPositionOnScreen} />

<div
    class="agent"
    class:agent--visible={visible}
    class:agent--sleeping={sleeping}
    style:left="{x}px"
    style:top="{y}px"
    aria-live="polite"
>
    <div
        class="agent__bubble"
        class:agent__bubble--visible={speaking}
        class:agent__bubble--right={x < 300}
    >{text}</div>
    {#if sheet}
        <div
            bind:this={figure}
            class="agent__figure agent__sprite"
            role="img"
            aria-label={sheet.name}
            style:background-image={`url(${sheet.src})`}
            style:background-size={backgroundSize}
            style:background-position={`${frame.x} ${frame.y}`}
        ></div>
    {:else}
        <img
            bind:this={figure}
            class="agent__figure agent__fallback"
            src={sleeping ? "/agents/agent-sleeping.png" : `/agents/agent-${state}.png`}
            alt={sleeping ? "Sleeping agent" : "Agent working"}
        />
    {/if}
</div>

<style>
    .agent {
        position: absolute;
        z-index: 34;
        width: 68px;
        height: 68px;
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
        filter: drop-shadow(0 5px 7px rgba(31, 26, 19, 0.2));
        transition: opacity 240ms ease, filter 240ms ease, scale 240ms ease;
    }

    .agent--sleeping .agent__figure {
        opacity: 0.82;
        scale: 0.94;
        filter: grayscale(0.12) drop-shadow(0 4px 6px rgba(31, 26, 19, 0.16));
    }

    .agent__sprite {
        aspect-ratio: 12 / 13;
        height: auto;
        background-repeat: no-repeat;
        image-rendering: pixelated;
    }

    .agent__fallback {
        object-fit: contain;
    }

    .agent__bubble {
        position: absolute;
        right: calc(100% + 8px);
        bottom: 31px;
        width: max-content;
        max-width: min(250px, 42vw);
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

    .agent__bubble--right {
        right: auto;
        left: calc(100% + 8px);
        transform-origin: left bottom;
    }

    .agent__bubble--right::after {
        right: auto;
        left: -7px;
        rotate: 135deg;
    }

    @media (prefers-reduced-motion: reduce) {
        .agent { transition-duration: 0ms; }
        .agent__bubble { transition-duration: 0ms; }
    }
</style>
