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
 * Not literally the player's code, and on purpose: the player's typing is
 * driven by a beat's duration — the scene owns the clock, and the text has to
 * fill exactly the time the beat was given. This action owns its own clock,
 * because a "Copied!" stamp or a strewn bubble has nobody scheduling it.
 */

/** Characters that earn a breath after they are typed. */
const PAUSE_AFTER = new Set([".", "-", "—", "!", "?"]);

/** How long the next character waits, given the one just typed. */
export function delayAfter(written: string, perChar: number, pause: number): number {
    return perChar + (PAUSE_AFTER.has(written) ? pause : 0);
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

    /*
     * A leading word can be bold. An option rather than markup, because the
     * action reads textContent — any <strong> in the source is flattened
     * before it arrives — and the bold has to be present from the first
     * frame anyway, or its extra width would shift the layout when it
     * appeared.
     */
    const strong = options.strong && full.startsWith(options.strong) ? options.strong : "";

    /** The full text, always: typed as plain runs, untyped as invisible ones. */
    const render = (upTo: number) => {
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
    };
    render(0);

    let at = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
        at++;
        render(at);
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
