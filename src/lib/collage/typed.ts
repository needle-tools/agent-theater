/**
 * Text that types itself in, as a Svelte action.
 *
 * The core rule, shared with the show's speech bubbles: the WHOLE line is laid
 * out from the first frame, and the untyped tail is merely invisible. Nothing
 * is appended as it types — characters appear in a layout that already exists,
 * so neither the box nor the line breaks can ever change. The earlier version
 * stacked a hidden full copy under a growing prefix, which held the size but
 * not the shape: `text-wrap: pretty` and `balance` choose breaks from the
 * total content, so the prefix wrapped differently from the finished line and
 * words hopped between lines mid-sentence.
 *
 * Two actions, one mechanism. `typed` owns its own clock, for text that nobody
 * is speaking. `said` hands the clock to the prompter, so the line waits its
 * turn to be heard and then types at the speed it is being said — which is the
 * only way a bubble and a voice can be the same sentence.
 */
import { prompter } from "./speech.js";

/** Characters that earn a breath after they are typed. */
const PAUSE_AFTER = new Set([".", "-", "—", "!", "?"]);

/** How long the next character waits, given the one just typed. */
export function delayAfter(written: string, perChar: number, pause: number): number {
    return perChar + (PAUSE_AFTER.has(written) ? pause : 0);
}

/**
 * Draw the line with only the first `upTo` characters visible.
 *
 * The whole string is in the document every time — the tail is hidden rather
 * than absent — which is what keeps the wrapping from changing under the text
 * as it arrives.
 */
function layOut(node: HTMLElement, full: string, upTo: number, strong: string): void {
    node.textContent = "";
    const split = (parent: HTMLElement, text: string, offset: number) => {
        const shown = Math.max(0, Math.min(text.length, upTo - offset));
        if (shown > 0) parent.append(document.createTextNode(text.slice(0, shown)));
        if (shown < text.length) {
            const rest = document.createElement("span");
            rest.style.visibility = "hidden";
            rest.setAttribute("aria-hidden", "true");
            rest.textContent = text.slice(shown);
            parent.append(rest);
        }
    };
    if (strong) {
        const bold = document.createElement("strong");
        split(bold, strong, 0);
        node.append(bold);
    }
    split(node, full.slice(strong.length), strong.length);
}

/**
 * A leading word can be bold. An option rather than markup, because both
 * actions read textContent — any <strong> in the source is flattened before it
 * arrives — and the bold has to be present from the first frame anyway, or its
 * extra width would shift the layout when it appeared.
 */
function boldOf(full: string, strong: string | undefined): string {
    return strong && full.startsWith(strong) ? strong : "";
}

export function typed(
    node: HTMLElement,
    options: { cps?: number; pause?: number; delay?: number; strong?: string } = {},
) {
    const full = node.textContent ?? "";
    const perChar = 1000 / (options.cps ?? 45);
    const pause = options.pause ?? 300;

    // Only the node's contents are restructured; destroy() puts the plain
    // text back.
    node.setAttribute("aria-label", full);
    const strong = boldOf(full, options.strong);
    layOut(node, full, 0, strong);

    let at = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
        at++;
        layOut(node, full, at, strong);
        if (at >= full.length) return;
        timer = setTimeout(step, delayAfter(full[at - 1], perChar, pause));
    };
    timer = setTimeout(step, options.delay ?? perChar);

    return {
        destroy() {
            clearTimeout(timer);
            node.textContent = full;
        },
    };
}

/**
 * A bubble that waits its turn, then types at the speed it is spoken.
 *
 * The node is marked `data-said="waiting"` until the prompter reaches it and
 * `data-said="said"` from then on, which is where the appearing happens: the
 * component's own CSS hangs its entrance off that attribute. Doing it that way
 * rather than mounting the element late keeps the bubble's position, size and
 * wrapping settled before anybody sees it — a bubble that laid itself out in
 * the same frame it popped would pop at the wrong size.
 *
 * `after` is a delay before it JOINS the queue, not before it is spoken. It is
 * for a bubble whose prop is still flying in: there is no point holding the
 * queue for scenery.
 */
export function said(
    node: HTMLElement,
    options: { voice?: string; strong?: string; after?: number; fallback?: number } = {},
) {
    const full = node.textContent ?? "";
    node.setAttribute("aria-label", full);
    const strong = boldOf(full, options.strong);
    node.dataset.said = "waiting";
    layOut(node, full, 0, strong);

    let gone = false;
    const join = setTimeout(() => {
        if (gone) return;
        void prompter.speak({ text: full, voice: options.voice }, {
            dropped: () => gone,
            begin: () => {
                node.dataset.said = "said";
            },
            show: progress => layOut(node, full, Math.round(full.length * progress), strong),
            // Left standing and complete. These bubbles are not a scene's
            // dialogue — they are the page talking about itself, and the words
            // have to still be there for somebody who looked up late.
            end: () => layOut(node, full, full.length, strong),
            ...(typeof options.fallback === "number" ? { fallback: options.fallback } : {}),
        });
    }, options.after ?? 0);

    return {
        destroy() {
            gone = true;
            clearTimeout(join);
            node.textContent = full;
        },
    };
}
