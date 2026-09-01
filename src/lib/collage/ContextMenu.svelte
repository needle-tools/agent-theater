<script lang="ts" module>
    export interface MenuItem {
        label: string;
        onSelect?: () => void;
        /** Nested items. A parent with `items` never has its own action. */
        items?: MenuItem[];
        /** Name from the icon set below. Every row should have one. */
        icon?: IconName;
        /**
         * Draw the icon as a rectangle of this width/height ratio instead of a
         * fixed glyph — so a paper size shows the shape you are about to make.
         */
        iconAspect?: number;
        /** Shows a tick — for things that are on or off rather than one-shot. */
        checked?: boolean;
        disabled?: boolean;
        danger?: boolean;
        /** Draw a hairline above this item. */
        separator?: boolean;
        /** Right-aligned, dimmed. For a shortcut or a size. */
        hint?: string;
    }

    /**
     * One stroke weight, one 16-unit grid, round joins — so a menu row reads as
     * one line of text with a mark in front of it, rather than as a collection
     * of little pictures.
     */
    interface Icon {
        stroke?: string[];
        fill?: string[];
        dashed?: boolean;
    }

    export type IconName = keyof typeof ICONS;

    export const ICONS = {
        image: { stroke: ["M2.5 3.5h11v9h-11z", "M2.9 11.2 6 8.1l2.4 2.4L10.5 8.4l2.6 2.6"], fill: ["M5.9 6.9a.95.95 0 110-1.9.95.95 0 010 1.9z"] },
        text: { stroke: ["M3.6 4.4V3.4h8.8v1", "M8 3.4v9.2", "M6.2 12.6h3.6"] },
        frame: { stroke: ["M4.6 2.6h6.8v10.8H4.6z"] },
        layout: { stroke: ["M3 3h4.1v4.1H3z", "M8.9 3H13v4.1H8.9z", "M3 8.9h4.1V13H3z", "M8.9 8.9H13V13H8.9z"] },
        fit: { stroke: ["M6.1 2.6H2.6v3.5", "M9.9 2.6h3.5v3.5", "M6.1 13.4H2.6V9.9", "M9.9 13.4h3.5V9.9"] },
        wand: { stroke: ["M2.9 13.1 9.4 6.6"], fill: ["M11.6 2.1l.72 1.77 1.77.72-1.77.72-.72 1.77-.72-1.77-1.77-.72 1.77-.72z"] },
        silhouette: { fill: ["M8 2.7a5.3 5.3 0 110 10.6A5.3 5.3 0 018 2.7z"] },
        outline: { stroke: ["M8 2.7a5.3 5.3 0 110 10.6A5.3 5.3 0 018 2.7z"], dashed: true },
        shadow: { stroke: ["M9.6 5.4a3.7 3.7 0 01-2.5 7"], fill: ["M6.5 3.3a3.7 3.7 0 110 7.4 3.7 3.7 0 010-7.4z"] },
        front: { stroke: ["M3 3h6.4v3.4", "M3 3v6.4h3.4"], fill: ["M6.6 6.6H13V13H6.6z"] },
        back: { stroke: ["M6.6 6.6H13V13H6.6z"], fill: ["M3 3h6.4v6.4H3z"] },
        trash: { stroke: ["M3.2 4.5h9.6", "M6.2 4.5V3.2h3.6v1.3", "M4.7 4.5l.5 8.3h5.6l.5-8.3"] },
        rows: { stroke: ["M3 4.8h2.6v6.4H3z", "M6.7 4.8h2.6v6.4H6.7z", "M10.4 4.8H13v6.4h-2.6z"] },
        columns: { stroke: ["M4.8 3h6.4v2.6H4.8z", "M4.8 6.7h6.4v2.6H4.8z", "M4.8 10.4h6.4V13H4.8z"] },
        ring: { stroke: ["M8 3.1a4.9 4.9 0 110 9.8 4.9 4.9 0 010-9.8z"] },
        scatter: { stroke: ["M3.4 4.2h3v3h-3z", "M9.4 3.4h3.2v3.2H9.4z", "M5.6 9.4h3.6v3.6H5.6z"] },
        packed: { stroke: ["M3 3h4.6v3.6H3z", "M8.9 3H13v3.6H8.9z", "M3 7.9h2.8V13H3z", "M7.1 7.9H13V13H7.1z"] },
        collage: { stroke: ["M2.6 5.4l4.2-1.6 1.6 4.2-4.2 1.6z", "M8.4 7.2l4.4-.9.9 4.4-4.4.9z"] },
        font: { stroke: ["M3.4 12.6 7 3.4h.6l3.6 9.2", "M4.7 9.8h5.4"] },
        align: { stroke: ["M3 4h10", "M3 8h6.5", "M3 12h8.5"] },
        rotate: { stroke: ["M12.6 8a4.6 4.6 0 11-1.5-3.4", "M12.9 2.5v2.6h-2.6"] },
        undo: { stroke: ["M3.4 8a4.6 4.6 0 101.5-3.4", "M3.1 2.5v2.6h2.6"] },
    } satisfies Record<string, Icon>;
</script>

<script lang="ts">
    /**
     * The canvas's right-click menu.
     *
     * A canvas app has no room for a permanent panel of controls — the point is
     * the work, not the chrome — so the controls come to the pointer instead.
     * Which means this has to behave like a real menu, not a styled div:
     * Escape closes it, focus moves with the arrow keys, and it flips rather
     * than running off the edge of the window.
     *
     * Every row is the same three-column grid — icon, label, trailing mark —
     * and submenu rows use it too. That is what keeps a parent row like "Add
     * frame" from sitting a gutter's width to the left of "Add text".
     */
    interface Props {
        x: number;
        y: number;
        items: MenuItem[];
        onClose: () => void;
    }

    let { x, y, items, onClose }: Props = $props();

    let root: HTMLDivElement | null = $state(null);
    let openSubmenu = $state<number | null>(null);
    /** Measured after mount, so the flip is based on the real size. */
    let placement = $state({ left: x, top: y });
    /** Measure exactly once; re-entering would write state the template reads. */
    let placed = false;
    /**
     * The right-click that opened this menu has not finished yet — its own
     * pointerup, and on some platforms its pointerdown, are still in flight.
     * Listening for "a click outside" straight away means catching the tail of
     * the gesture that opened it, and the menu closes on the frame it appears.
     * So the dismiss handler only arms on the next frame.
     */
    let armed = $state(false);

    $effect(() => {
        if (!root || placed) return;
        placed = true;
        const rect = root.getBoundingClientRect();
        const margin = 8;
        placement = {
            left: x + rect.width > window.innerWidth - margin ? Math.max(margin, x - rect.width) : x,
            top: y + rect.height > window.innerHeight - margin ? Math.max(margin, y - rect.height) : y,
        };
        // Focus the menu itself rather than the first item: opening a menu
        // should not look like something is already chosen.
        root.focus({ preventScroll: true });
        const frame = requestAnimationFrame(() => (armed = true));
        return () => cancelAnimationFrame(frame);
    });

    function select(item: MenuItem) {
        if (item.disabled || item.items) return;
        item.onSelect?.();
        onClose();
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const buttons = [...(root?.querySelectorAll<HTMLButtonElement>(".item:not(:disabled)") ?? [])];
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = current < 0
            ? (step > 0 ? 0 : buttons.length - 1)
            : (current + step + buttons.length) % buttons.length;
        buttons[next].focus();
    }

    /** A rectangle of the given aspect, centred and inset in the 16-unit box. */
    function aspectRect(aspect: number) {
        const max = 11;
        const width = aspect >= 1 ? max : max * aspect;
        const height = aspect >= 1 ? max / aspect : max;
        return { x: 8 - width / 2, y: 8 - height / 2, width, height };
    }
</script>

{#snippet glyph(item: MenuItem)}
    <span class="icon" class:icon--on={item.checked} aria-hidden="true">
        {#if item.iconAspect}
            {@const rect = aspectRect(item.iconAspect)}
            <svg viewBox="0 0 16 16">
                <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="0.8" />
            </svg>
        {:else if item.icon}
            {@const icon = ICONS[item.icon]}
            <svg viewBox="0 0 16 16" class:dashed={icon.dashed}>
                {#each icon.fill ?? [] as d}<path {d} class="solid" />{/each}
                {#each icon.stroke ?? [] as d}<path {d} />{/each}
            </svg>
        {/if}
    </span>
{/snippet}

<svelte:window
    onpointerdown={event => {
        if (!armed || !root) return;
        if (!root.contains(event.target as Node)) onClose();
    }}
    onresize={onClose}
/>

<div
    class="menu"
    role="menu"
    tabindex="-1"
    bind:this={root}
    style:left="{placement.left}px"
    style:top="{placement.top}px"
    onkeydown={onKeyDown}
    oncontextmenu={event => event.preventDefault()}
>
    {#each items as item, index (item.label + index)}
        {#if item.separator}
            <hr />
        {/if}
        {#if item.items}
            <div
                class="branch"
                role="none"
                onpointerenter={() => { if (!item.disabled) openSubmenu = index; }}
                onpointerleave={() => (openSubmenu = openSubmenu === index ? null : openSubmenu)}
            >
                <button
                    class="item"
                    role="menuitem"
                    aria-haspopup="true"
                    aria-expanded={openSubmenu === index}
                    disabled={item.disabled}
                    onfocus={() => { if (!item.disabled) openSubmenu = index; }}
                >
                    {@render glyph(item)}
                    <span class="label">{item.label}</span>
                    <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
                </button>
                {#if openSubmenu === index}
                    <div class="submenu" role="menu">
                        {#each item.items as child (child.label)}
                            <button class="item" role="menuitem" disabled={child.disabled} onclick={() => select(child)}>
                                {@render glyph(child)}
                                <span class="label">{child.label}</span>
                                {#if child.hint}<span class="hint">{child.hint}</span>{/if}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {:else}
            <button
                class="item"
                class:item--danger={item.danger}
                role="menuitem"
                aria-checked={item.checked === undefined ? undefined : item.checked}
                disabled={item.disabled}
                onclick={() => select(item)}
            >
                {@render glyph(item)}
                <span class="label">{item.label}</span>
                {#if item.checked}
                    <svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
                {:else if item.hint}
                    <span class="hint">{item.hint}</span>
                {/if}
            </button>
        {/if}
    {/each}
</div>

<style>
    .menu {
        position: fixed;
        z-index: 50;
        min-width: 212px;
        /* Outer radius = inner radius + padding: 8 + 5 keeps the corners
           concentric with the highlighted item inside. */
        border-radius: 13px;
        padding: 5px;
        background: var(--surface-panel);
        /* Layered transparent shadows read as depth on any background; a solid
           border would only ever match one of them. */
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--border-subtle) 60%, transparent),
            0 1px 2px rgba(34, 44, 32, 0.06),
            0 8px 20px rgba(34, 44, 32, 0.10),
            0 24px 48px rgba(34, 44, 32, 0.08);
        animation: menu-in 0.13s cubic-bezier(0.2, 0, 0, 1);
    }

    @keyframes menu-in {
        from { opacity: 0; scale: 0.97; translate: 0 -2px; }
        to { opacity: 1; scale: 1; translate: 0 0; }
    }

    @media (prefers-reduced-motion: reduce) {
        .menu, .submenu { animation: none; }
    }

    .menu:focus-visible {
        outline: none;
    }

    /* One grid for every row in every menu — the reason a parent row and a leaf
       row line up instead of sitting a gutter apart. */
    .item {
        display: grid;
        grid-template-columns: 16px 1fr auto;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 34px;
        padding: 0 10px;
        border: 0;
        border-radius: 8px;
        background: none;
        color: var(--text-primary);
        font: inherit;
        font-size: var(--type-body-muted-size);
        text-align: left;
        cursor: pointer;
        transition-property: background, color;
        transition-duration: 0.12s;
    }

    .item:hover:not(:disabled),
    .item:focus-visible {
        background: var(--surface-panel-muted);
        outline: none;
    }

    .item:active:not(:disabled) {
        scale: 0.96;
    }

    .item:disabled {
        color: var(--text-muted);
        cursor: default;
    }

    .item:disabled .icon {
        opacity: 0.5;
    }

    /* brand.css declares --accent-error in its dark block only, so this needs a
       light-mode fallback or Delete renders in the same colour as everything
       else. */
    .item--danger {
        color: var(--accent-error, #D93A62);
    }

    .label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .hint {
        color: var(--text-muted);
        font-variant-numeric: tabular-nums;
    }

    .icon {
        display: flex;
        color: var(--text-muted);
    }

    /* A style that is currently applied should read as applied at a glance,
       before the tick on the far side is noticed. */
    .icon--on {
        color: var(--accent-brand);
    }

    .icon svg,
    .chevron,
    .tick {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.4;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .icon :global(.solid) {
        fill: currentColor;
        stroke: none;
    }

    .icon .dashed {
        stroke-dasharray: 2.6 2.2;
    }

    .chevron {
        width: 14px;
        height: 14px;
        stroke-width: 1.6;
        color: var(--text-muted);
    }

    .tick {
        width: 14px;
        height: 14px;
        stroke-width: 1.8;
        color: var(--accent-brand);
    }

    hr {
        margin: 4px 6px;
        border: 0;
        border-top: 1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent);
    }

    .branch {
        position: relative;
    }

    .submenu {
        position: absolute;
        top: -5px;
        left: 100%;
        /* Wide enough for the longest preset name — "Social card (og:image)" —
           so the one row that needs it does not end in an ellipsis. */
        min-width: 218px;
        border-radius: 13px;
        padding: 5px;
        background: var(--surface-panel);
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--border-subtle) 60%, transparent),
            0 8px 20px rgba(34, 44, 32, 0.10),
            0 24px 48px rgba(34, 44, 32, 0.08);
        animation: menu-in 0.12s cubic-bezier(0.2, 0, 0, 1);
    }
</style>
