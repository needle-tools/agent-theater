/**
 * The tab icon says whether a play is running.
 *
 * The theatre is a page people leave open in a background tab while an agent
 * works — so the one pixel of it they can still see should carry the one fact
 * that matters. Green circle: the stage is idle. Red badge: a show is on.
 *
 * Two states, chosen to be told apart at sixteen pixels rather than to look
 * best at two hundred. A red square against a green circle differs in colour
 * AND in outline, which survives being drawn the size of a full stop; two
 * variants of the same green disc would not.
 *
 * The images are pre-rendered by ImageMagick into static/favicon/ rather than
 * drawn to a canvas at runtime. A canvas would mean shipping the full-size art
 * and downscaling it in the browser on every state change, with the browser's
 * own scaler; the files are already there, already sharp, and a swap costs one
 * DOM node.
 */

export type FaviconState = "idle" | "play";

const SIZES = [16, 32, 48] as const;

let current: FaviconState | null = null;

/**
 * Whether an icon URL already belongs to a state.
 *
 * Both shapes count: "idle.ico" and "idle-32.png". Exported because the two
 * shapes are exactly what a naive check gets wrong — testing for one prefix
 * alone passes the PNGs and quietly fails the .ico, which puts back the churn
 * this guard exists to prevent. The separator class is the whole point, so it
 * is worth a test of its own.
 */
export function matchesState(href: string, state: FaviconState): boolean {
    return new RegExp(`/favicon/${state}[-.]`).test(href);
}

/**
 * Swap the tab icon, by REPLACING the link elements rather than editing them.
 *
 * Editing `href` in place is the obvious move and browsers ignore it about
 * half the time — the icon is cached against the element, not the URL. Taking
 * the old links out and putting new ones in is what actually redraws the tab.
 */
export function setFavicon(state: FaviconState): void {
    if (typeof document === "undefined" || state === current) return;

    const existing = [...document.querySelectorAll<HTMLLinkElement>("link[data-favicon]")];

    /*
     * The markup already ships the idle icon, so the first call on a quiet
     * page has nothing to do. Without this it tore out four correct links and
     * appended four identical ones — harmless, but it moved them to the end of
     * <head>, which is a confusing thing to find in the elements panel when
     * you go looking for the tags you wrote.
     */
    if (existing.length && existing.every(link => matchesState(link.href, state))) {
        current = state;
        return;
    }

    current = state;
    for (const link of existing) link.remove();

    /*
     * The .ico first, and it matters that it is here at all.
     *
     * Chrome will happily pick the .ico over any number of PNGs, so leaving it
     * pointing at the idle art meant the tab never changed during a show. Every
     * icon candidate has to move together; the one left behind is the one the
     * browser chooses.
     */
    const ico = document.createElement("link");
    ico.rel = "icon";
    ico.type = "image/x-icon";
    ico.setAttribute("data-favicon", "");
    ico.href = `/favicon/${state}.ico`;
    document.head.appendChild(ico);

    for (const size of SIZES) {
        const link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/png";
        link.setAttribute("sizes", `${size}x${size}`);
        link.setAttribute("data-favicon", "");
        link.href = `/favicon/${state}-${size}.png`;
        document.head.appendChild(link);
    }

    const touch = document.createElement("link");
    touch.rel = "apple-touch-icon";
    touch.setAttribute("data-favicon", "");
    touch.href = `/favicon/${state}-180.png`;
    document.head.appendChild(touch);
}
