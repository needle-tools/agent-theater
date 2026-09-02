/**
 * What the agent actually did.
 *
 * Every tool call, in order, with its arguments and what came back. It exists
 * because the interesting failures on this page are not exceptions — they are
 * an agent calling the right tool with plausible arguments and getting a
 * plausible answer that is nonetheless wrong. A cast placed off the backdrop, a
 * sheet cut into one piece, a show played to a hidden tab: none of those throw,
 * and none of them leave a trace anybody can hand over afterwards.
 *
 * The browser console is not that trace. It is gone on reload, it interleaves
 * with everything else on the page, and asking somebody to copy it out is
 * asking them to do the reporting by hand.
 *
 * Arguments are recorded, which means this must be careful about size: a single
 * `piece_add` carries a data: URL of several megabytes, and a hundred of them
 * would be a log nobody can open. Long values are shortened to their shape.
 */

export interface ToolCall {
    seq: number;
    /** Wall clock, so a log lines up with what somebody remembers happening. */
    at: string;
    tool: string;
    /** Milliseconds. Slow calls are most of what is worth noticing here. */
    ms: number;
    ok: boolean;
    args: unknown;
    /** The first part of what the agent was told back. */
    reply: string;
}

/**
 * How many calls are kept.
 *
 * A session that has gone wrong has usually gone wrong within the last few
 * dozen calls, and holding everything forever would make a tab that has been
 * open all day quietly expensive.
 */
const KEEP = 400;

/** Long enough to recognise a value, short enough that a log stays openable. */
const MAX_STRING = 200;
const MAX_REPLY = 600;

const calls: ToolCall[] = [];
let counter = 0;

/**
 * A value with its bulk taken out.
 *
 * Data URLs lose their payload and keep their size, which is the only part
 * anybody reads: "was it a big image or a small one" is answerable, "what were
 * those two million base64 characters" is not.
 */
export function shorten(value: unknown, depth = 0): unknown {
    if (typeof value === "string") {
        const dataUrl = /^data:([^;,]+)[^,]*,/.exec(value);
        if (dataUrl) {
            const bytes = Math.round((value.length - dataUrl[0].length) * 0.75);
            return `data:${dataUrl[1]} … ${(bytes / 1024).toFixed(0)} kB`;
        }
        return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (${value.length} chars)` : value;
    }
    if (Array.isArray(value)) {
        // Deep structures are usually a script or a cast, and the shape matters
        // more than the tail of a long one.
        if (depth > 3) return `[${value.length} items]`;
        return value.length > 40
            ? [...value.slice(0, 40).map(item => shorten(item, depth + 1)), `… ${value.length - 40} more`]
            : value.map(item => shorten(item, depth + 1));
    }
    if (value && typeof value === "object") {
        if (depth > 3) return "{…}";
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) out[key] = shorten(inner, depth + 1);
        return out;
    }
    return value;
}

export function noteCall(entry: {
    tool: string;
    ms: number;
    ok: boolean;
    args: unknown;
    reply: string;
}): void {
    calls.push({
        seq: ++counter,
        at: new Date().toISOString(),
        tool: entry.tool,
        ms: Math.round(entry.ms),
        ok: entry.ok,
        args: shorten(entry.args),
        reply: entry.reply.length > MAX_REPLY
            ? `${entry.reply.slice(0, MAX_REPLY)}… (${entry.reply.length} chars)`
            : entry.reply,
    });
    if (calls.length > KEEP) calls.splice(0, calls.length - KEEP);
}

export function toolCalls(): ToolCall[] {
    return [...calls];
}

export function clearToolCalls(): void {
    calls.length = 0;
    counter = 0;
}

/**
 * The log as a file.
 *
 * JSON rather than lines of prose: the point of downloading this is to hand it
 * to somebody — or to something — that will read the arguments, and prose would
 * mean parsing back out what was already structured. The counts at the top are
 * for the person who opens it first.
 */
export function toolLogFile(extra: Record<string, unknown> = {}): string {
    const failed = calls.filter(call => !call.ok);
    const slowest = [...calls].sort((a, b) => b.ms - a.ms).slice(0, 5);
    return JSON.stringify({
        saved: new Date().toISOString(),
        page: typeof location === "undefined" ? null : location.href,
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
        ...extra,
        calls: calls.length,
        failures: failed.length,
        slowest: slowest.map(call => `${call.tool} — ${call.ms}ms`),
        // Newest last, which is the order they happened in and the order
        // anybody reads a log in.
        log: calls,
    }, null, 2);
}
