<script lang="ts">
    import { onMount } from "svelte";
    import PaperCursor from "./PaperCursor.svelte";
    import { boilFilterSvg, loadPainterly, PAINTERLY_CSS } from "./painted.js";

    interface CursorLook {
        src: string;
        hotspot: { x: number; y: number };
        size: number;
    }

    const centre = { x: 0.5, y: 0.5 };
    const LOOKS: Record<string, CursorLook> = {
        arrow: { src: "/cursors/arrow-64.png", hotspot: { x: 5 / 32, y: 0 }, size: 40 },
        point: { src: "/cursors/point-64.png", hotspot: { x: 0.5, y: 1 / 32 }, size: 48 },
        open: { src: "/cursors/open-64.png", hotspot: centre, size: 48 },
        closed: { src: "/cursors/closed-64.png", hotspot: centre, size: 48 },
        move: { src: "/cursors/move-64.png", hotspot: centre, size: 44 },
        resize: { src: "/cursors/resize-64.png", hotspot: centre, size: 44 },
        forbidden: { src: "/cursors/forbidden-64.png", hotspot: centre, size: 44 },
        text: { src: "/cursors/text-64.png", hotspot: centre, size: 42 },
        pencil: { src: "/cursors/pencil-64.png", hotspot: { x: 0.5, y: 31 / 32 }, size: 46 },
        comment: { src: "/cursors/comment-64.png", hotspot: { x: 3 / 32, y: 29 / 32 }, size: 46 },
        "agent-ready": { src: "/cursors/agent-ready-64.png", hotspot: centre, size: 52 },
        "agent-thinking": { src: "/cursors/agent-thinking-64.png", hotspot: centre, size: 52 },
        "agent-working": { src: "/cursors/agent-working-64.png", hotspot: centre, size: 52 },
    };

    let kind = $state("arrow");
    const look = $derived(LOOKS[kind] ?? LOOKS.arrow);

    function choose(event: PointerEvent) {
        if (event.pointerType && event.pointerType !== "mouse") return;
        const target = event.target instanceof Element ? event.target : document.documentElement;
        kind = getComputedStyle(target).getPropertyValue("--paper-cursor-kind").trim() || "arrow";
    }

    onMount(() => {
        document.documentElement.classList.add("paper-cursors-animated");
        void loadPainterly();
        return () => document.documentElement.classList.remove("paper-cursors-animated");
    });
</script>

<svelte:head><link rel="stylesheet" href={PAINTERLY_CSS} /></svelte:head>
<svelte:window onpointermove={choose} onpointerdown={choose} />

<!-- The filters must exist before PaperCursor uses its animated warp. -->
<svg class="cursor-defs" aria-hidden="true" focusable="false">{@html boilFilterSvg()}</svg>
<PaperCursor
    src={look.src}
    hotspot={look.hotspot}
    size={look.size}
    active={kind !== "none"}
    paint="calm"
/>

<style>
    .cursor-defs {
        position: absolute;
        width: 0;
        height: 0;
        overflow: hidden;
    }

    /* JS is mounted and the painted replacement is ready. Static CSS cursor
       images remain the no-script and pre-hydration fallback. */
    :global(html.paper-cursors-animated),
    :global(html.paper-cursors-animated *) {
        cursor: none !important;
    }
</style>
