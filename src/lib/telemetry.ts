/**
 * What actually happens in the theatre, counted.
 *
 * Two hands work this page — a person's and an agent's — and until now neither
 * left a trace that outlived the tab. The tool log (see collage/toolLog.ts) is
 * for one session going wrong; this is the other question: across everybody,
 * which tools do agents reach for, and which parts of the room do people
 * actually touch.
 *
 * Rybbit is the counter. It is loaded from app.html as a plain <script>, which
 * means it may not be there yet when the first event happens — a page that
 * starts a show from a share link fires before a deferred script has run. So
 * events queue until the counter appears and are dealt then, rather than being
 * dropped for the crime of being early.
 *
 * Three rules the rest of the code relies on:
 *
 *  - Nothing here throws. Analytics that can break the page is worse than no
 *    analytics, and every call site treats this as a no-op it never checks.
 *  - Nothing here sends content. Sticker labels, chapter names, scripts, typed
 *    lines and image data are the person's, not ours — properties carry shapes
 *    and counts ("3 pieces moved", "piece_add took 4s"), never what was said.
 *  - Nothing here runs off a server or in a test. `window` is checked once and
 *    the module is inert without it.
 *
 * Rybbit's limits, which sanitise() keeps to: event names ≤ 256 characters,
 * properties a flat object of strings and numbers, ≤ 2 kB serialised.
 */

export type TrackValue = string | number | boolean | null | undefined;
export type TrackProps = Record<string, TrackValue>;

/** Rybbit's own limit is 256; the names here are short on purpose. */
const MAX_NAME = 120;
/** Long enough to recognise a control, short enough to stay a category. */
const MAX_VALUE = 80;
/** Under Rybbit's 2 kB, with room for its own envelope. */
const MAX_BYTES = 1800;
/**
 * How many events wait for the script.
 *
 * A page that loads the counter in a second gathers a handful; one where it
 * never loads at all — blocked, offline, self-hosted instance down — must not
 * grow a list for the lifetime of the tab.
 */
const MAX_QUEUED = 60;
/** How long to wait for the script before giving up on the queue. */
const WAIT_MS = 10_000;
const POLL_MS = 150;

/** Remembered so a person's choice survives the tab. */
const CHOICE_KEY = "theater.telemetry";

interface RybbitApi {
    event: (name: string, properties?: Record<string, string | number>) => void;
}

function api(): RybbitApi | null {
    const rybbit = (globalThis as { rybbit?: Partial<RybbitApi> }).rybbit;
    return typeof rybbit?.event === "function" ? (rybbit as RybbitApi) : null;
}

/**
 * Whether to count at all.
 *
 * Off on localhost, because a developer reloading the page four hundred times
 * is not a signal and burying the real numbers under it costs more than the
 * measurement is worth. `?telemetry=on` turns it on anyway — the only way to
 * check that an event fires is to fire it from the machine you are editing on
 * — and `?telemetry=off` is the opt-out, both remembered.
 */
let allowed: boolean | null = null;

function decide(): boolean {
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    // Set by the inline script in app.html, which runs the same rules before
    // Rybbit's own page view can happen — and by Rybbit's documented opt-out,
    // which a reader may set for themselves. Either one means no.
    if ((globalThis as { __RYBBIT_OPTOUT__?: unknown }).__RYBBIT_OPTOUT__) return false;

    let choice: string | null = null;
    try {
        const asked = new URLSearchParams(location.search).get("telemetry");
        if (asked === "on" || asked === "off") {
            localStorage.setItem(CHOICE_KEY, asked);
            choice = asked;
        } else {
            choice = localStorage.getItem(CHOICE_KEY);
        }
    } catch {
        // Private mode, blocked storage: fall through to the default.
    }
    if (choice === "on") return true;
    if (choice === "off") return false;

    const host = location.hostname;
    const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]"
        || host.endsWith(".local") || host.endsWith(".localhost");
    return !local;
}

function on(): boolean {
    if (allowed === null) allowed = decide();
    return allowed;
}

/**
 * A value fit to send: a string or a number, short, and never a sentence
 * somebody wrote. Booleans are spelled out because "true" reads better than 1
 * in a dashboard's list of values.
 */
function value(input: TrackValue): string | number | null {
    if (input === null || input === undefined) return null;
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    const text = String(input).replace(/\s+/g, " ").trim();
    if (!text) return null;
    return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

/**
 * The properties, flattened and bounded.
 *
 * Keys are dropped from the end until the whole thing fits, rather than the
 * event being thrown away: an event that arrives with four of its six
 * properties still answers "did this happen, and how often".
 */
export function sanitise(props: TrackProps = {}): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    for (const [key, raw] of Object.entries(props)) {
        const kept = value(raw);
        if (kept === null) continue;
        out[key] = kept;
    }
    let keys = Object.keys(out);
    while (keys.length && JSON.stringify(out).length > MAX_BYTES) {
        delete out[keys[keys.length - 1]];
        keys = Object.keys(out);
    }
    return out;
}

const queued: Array<{ name: string; props: Record<string, string | number> }> = [];
let poll: ReturnType<typeof setInterval> | null = null;
let waitedSince = 0;

function deal(): boolean {
    const rybbit = api();
    if (!rybbit) return false;
    for (const event of queued.splice(0, queued.length)) {
        try {
            rybbit.event(event.name, event.props);
        } catch {
            // A counter that refuses an event is not the page's problem.
        }
    }
    return true;
}

function waitForScript() {
    if (poll) return;
    waitedSince = Date.now();
    poll = setInterval(() => {
        if (deal() || Date.now() - waitedSince > WAIT_MS) {
            clearInterval(poll!);
            poll = null;
            // The script never came. Let the queue go rather than hold a page's
            // worth of events nobody will ever read.
            queued.length = 0;
        }
    }, POLL_MS);
}

/**
 * Count something.
 *
 * Fire and forget: no return value, no promise, and no throw. Names are
 * snake_case and describe what happened, not what was clicked to cause it.
 */
export function track(name: string, props: TrackProps = {}): void {
    if (!on()) return;
    const event = {
        name: name.slice(0, MAX_NAME),
        props: sanitise(props),
    };
    if (api()) {
        queued.push(event);
        deal();
        return;
    }
    if (queued.length >= MAX_QUEUED) return;
    queued.push(event);
    waitForScript();
}

/**
 * A duration as something worth grouping by.
 *
 * Milliseconds are kept too, for anyone querying the table directly, but a
 * dashboard grouping by raw milliseconds shows one bar per call. The buckets
 * are the questions people actually ask of a tool call: did it answer at once,
 * did the person wait, did it fall off the end of the agent's patience.
 */
export function speed(ms: number): string {
    if (ms < 100) return "instant";
    if (ms < 1000) return "fast";
    if (ms < 5000) return "slow";
    if (ms < 20_000) return "very slow";
    return "over patience";
}

/** Counts want grouping too: a session with 200 pieces is not 200 categories. */
export function many(count: number): string {
    if (count <= 1) return "1";
    if (count <= 3) return "2-3";
    if (count <= 10) return "4-10";
    if (count <= 30) return "11-30";
    return "30+";
}

/**
 * Every button on the page, without touching every button on the page.
 *
 * One listener in the capture phase beats an onclick per control: nothing can
 * be added later and quietly go uncounted, and no component has to know that
 * analytics exists. What is sent is the control's `data-track` when it has one,
 * its aria-label otherwise, and its text as a last resort — with `data-track`
 * being the way a control whose label is the PERSON'S words (a chapter they
 * named, a play they titled) says "count me, but not by my name".
 *
 * Returns the way to stop, for a component's cleanup.
 */
export function watchClicks(): () => void {
    if (typeof document === "undefined" || !on()) return () => { };
    /*
     * Where the press began.
     *
     * A sticker dragged off the shelf onto the stage ends with a `click` on the
     * shelf button it came from — the browser is right, and counting it as a
     * button press is not: it was a drag, and the drag already counted itself.
     * Anything that travelled further than a shaky hand is left alone.
     */
    let pressed: { x: number; y: number; at: number } | null = null;
    const onDown = (event: PointerEvent) => {
        pressed = { x: event.clientX, y: event.clientY, at: Date.now() };
    };
    // Forgotten one turn after the hand lets go — a `click` follows its own
    // pointerup immediately, so this runs after it. Without the clearing, a
    // drag that ends in no click at all leaves its start point behind, and the
    // next press is measured against wherever the last gesture began.
    const onUp = () => setTimeout(() => { pressed = null; }, 0);
    const onClick = (event: MouseEvent) => {
        const from = pressed;
        pressed = null;
        // Only a press that belongs to THIS click can veto it. An old one — a
        // gesture that ended somewhere else, a synthetic click with no press of
        // its own — must never be able to make the button quietly uncounted.
        const drag = from
            && Date.now() - from.at < 5000
            && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8;
        if (drag) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const control = target.closest<HTMLElement>(
            "[data-track], button, a[href], summary, [role='button'], [role='menuitem']");
        if (!control) return;
        track("ui_click", {
            control: labelOf(control),
            where: areaOf(control),
        });
    };
    document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    document.addEventListener("pointerup", onUp, { capture: true, passive: true });
    document.addEventListener("click", onClick, { capture: true, passive: true });
    return () => {
        document.removeEventListener("pointerdown", onDown, { capture: true });
        document.removeEventListener("pointerup", onUp, { capture: true });
        document.removeEventListener("click", onClick, { capture: true });
    };
}

function labelOf(control: HTMLElement): string {
    const marked = control.dataset.track;
    if (marked) return marked;
    const label = control.getAttribute("aria-label");
    if (label) return label;
    // Text, but only the element's own — a button wrapping an icon and a name
    // should read as the name, not as the whole subtree of a menu item.
    const text = (control.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) return text;
    return control.tagName.toLowerCase();
}

/**
 * Which part of the room. Groups already carry an aria-label for screen
 * readers — "Play tools", "Chapters", "Sticker packs" — and it is exactly the
 * name a person would give that corner of the page.
 */
function areaOf(control: HTMLElement): string {
    const area = control.closest<HTMLElement>("[data-track-area]");
    if (area?.dataset.trackArea) return area.dataset.trackArea;
    let node: HTMLElement | null = control.parentElement;
    while (node) {
        const label = node.getAttribute("aria-label");
        if (label) return label;
        node = node.parentElement;
    }
    return "page";
}

/** For tests: forget the decision and anything waiting on the script. */
export function resetTelemetry(): void {
    allowed = null;
    queued.length = 0;
    if (poll) clearInterval(poll);
    poll = null;
}
