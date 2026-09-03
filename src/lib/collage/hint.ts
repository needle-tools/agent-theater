/**
 * The tooltip, as a thought rather than a system chrome box.
 *
 * `title` is the browser's own tooltip and it is nearly useless here: it waits
 * about a second before appearing, it is styled by the operating system rather
 * than by the page, it cannot be positioned, and on touch it never appears at
 * all. It is also the only tooltip a screen reader announces reliably — so it
 * is not enough to hide it, the text has to be moved somewhere assistive
 * technology still finds it. Hence: `title` is read once, removed from the
 * element, and written to `aria-label` if the element does not already have
 * one. Nothing is lost and the native box never opens.
 *
 * What replaces it is a thinking bubble that follows the pointer with its text
 * typing in — the same conceit as the rest of the room, where a thought is a
 * paper cut-out rather than a UI affordance.
 *
 * One bubble for the whole page, not one per element. Two hundred hinted
 * stickers would otherwise be two hundred idle nodes; this is one, created on
 * first use and reused for every hint after that.
 */

/** How long the pointer may be away before the thought is dropped. */
const GRACE_MS = 500;
/** Per character. Quick: the bubble is a hint, not a reading exercise. */
const TYPE_MS = 9;
/** However long the text, typing is over by this point. */
const TYPE_CAP_MS = 420;

let bubble: HTMLElement | null = null;
let textNode: HTMLElement | null = null;
/** The element the bubble currently belongs to, if any. */
let owner: HTMLElement | null = null;
let hideTimer = 0;
let typeTimer = 0;
let frame = 0;
let pointer = { x: 0, y: 0 };

const reduced = () =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function ensureBubble(): HTMLElement {
    if (bubble) return bubble;
    bubble = document.createElement("div");
    bubble.className = "paper-hint";
    /*
     * Hidden from assistive technology on purpose. The text it shows is
     * already on the element as `aria-label`, and announcing a floating copy
     * of it as well would read the same words twice.
     */
    bubble.setAttribute("aria-hidden", "true");
    textNode = document.createElement("span");
    textNode.className = "paper-hint__text";
    bubble.append(textNode);
    // The two trailing dots that make it a thought rather than speech.
    for (const size of ["paper-hint__dot paper-hint__dot--big", "paper-hint__dot"]) {
        const dot = document.createElement("i");
        dot.className = size;
        bubble.append(dot);
    }
    document.body.append(bubble);
    return bubble;
}

/**
 * Keep the bubble on screen: it is drawn up and to the right of the pointer.
 *
 * The gap is generous on purpose. A thought crowding the pointer covers the
 * thing being pointed at — which for a drawer of overlapping stickers is the
 * one thing it must not do — and the trailing dots need somewhere to trail.
 */
const AWAY_X = 30;
const AWAY_Y = 34;

function place() {
    if (!bubble) return;
    const pad = 14;
    const box = bubble.getBoundingClientRect();
    let x = pointer.x + AWAY_X;
    let y = pointer.y - box.height - AWAY_Y;
    // Flip to the other side rather than let it run off the edge; the dots
    // stay bottom-left either way, which is a small lie about where the
    // thought came from and cheaper than mirroring them.
    if (x + box.width > innerWidth - pad) x = pointer.x - box.width - AWAY_X;
    if (y < pad) y = pointer.y + AWAY_Y;
    bubble.style.translate = `${Math.max(pad, x)}px ${Math.max(pad, y)}px`;
}

function type(text: string) {
    if (!textNode) return;
    clearInterval(typeTimer);
    if (reduced()) { textNode.textContent = text; place(); return; }
    // A fixed number of steps rather than one per character, so a long
    // description does not take four times as long as a short one to land.
    const step = Math.max(1, Math.ceil(text.length / (TYPE_CAP_MS / TYPE_MS)));
    let at = 0;
    textNode.textContent = "";
    typeTimer = window.setInterval(() => {
        at = Math.min(text.length, at + step);
        textNode!.textContent = text.slice(0, at);
        place();
        if (at >= text.length) clearInterval(typeTimer);
    }, TYPE_MS);
}

function show(element: HTMLElement, text: string) {
    clearTimeout(hideTimer);
    const already = owner === element && bubble?.classList.contains("paper-hint--on");
    owner = element;
    const node = ensureBubble();
    node.classList.add("paper-hint--on");
    if (!already) type(text);
    place();
}

function hide(immediately = false) {
    clearTimeout(hideTimer);
    const drop = () => {
        owner = null;
        clearInterval(typeTimer);
        bubble?.classList.remove("paper-hint--on");
    };
    if (immediately) drop();
    // The grace period is what makes a row of stickers feel like one surface:
    // crossing the gap between two of them should move the thought, not blink
    // it out and back.
    else hideTimer = window.setTimeout(drop, GRACE_MS);
}

/**
 * A Svelte action: `<button use:hint>` or `use:hint={"some text"}`.
 *
 * With no argument it takes the element's `title`, or its `aria-label` if
 * there is no title. The title is removed either way — leaving it would mean
 * both tooltips appear, ours immediately and the system's a second later.
 */
export function hint(element: HTMLElement, text?: string) {
    let label = "";

    function read(next?: string) {
        const title = element.getAttribute("title");
        label = (next ?? title ?? element.getAttribute("aria-label") ?? "").trim();
        if (title !== null) {
            element.removeAttribute("title");
            // Only if it has nothing better already: an author-written
            // aria-label is more considered than a title reused as one.
            if (!element.hasAttribute("aria-label") && label) element.setAttribute("aria-label", label);
        }
    }
    read(text);

    const onEnter = (event: PointerEvent) => {
        if (!label || event.pointerType !== "mouse") return;
        pointer = { x: event.clientX, y: event.clientY };
        show(element, label);
    };
    const onMove = (event: PointerEvent) => {
        if (owner !== element) return;
        pointer = { x: event.clientX, y: event.clientY };
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = 0; place(); });
    };
    const onLeave = () => { if (owner === element) hide(); };
    const onDown = () => { if (owner === element) hide(true); };

    element.addEventListener("pointerenter", onEnter);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    element.addEventListener("pointerdown", onDown);

    return {
        update(next?: string) {
            read(next);
            if (owner === element && label) type(label);
        },
        destroy() {
            element.removeEventListener("pointerenter", onEnter);
            element.removeEventListener("pointermove", onMove);
            element.removeEventListener("pointerleave", onLeave);
            element.removeEventListener("pointerdown", onDown);
            // A hinted element can be removed while its thought is up — a
            // sticker dragged out of the drawer, say — and the bubble would
            // otherwise hang there pointing at nothing.
            if (owner === element) hide(true);
            if (frame) { cancelAnimationFrame(frame); frame = 0; }
        },
    };
}
