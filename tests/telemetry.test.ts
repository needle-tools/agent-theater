import { afterEach, describe, expect, it, vi } from "vitest";
import { many, resetTelemetry, sanitise, speed, track } from "../src/lib/telemetry.js";

/**
 * A browser, as far as the counter is concerned: somewhere to look for a
 * hostname, somewhere to remember a choice, and something to hand events to.
 */
function browser(hostname = "theater.needle.tools", search = "") {
    const sent: Array<{ name: string; props: Record<string, string | number> }> = [];
    const store = new Map<string, string>();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("location", { hostname, search });
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
    });
    return { sent, store };
}

afterEach(() => {
    vi.unstubAllGlobals();
    resetTelemetry();
});

describe("what a property is allowed to be", () => {
    it("keeps strings and numbers, spells booleans out, and drops nothing-values", () => {
        expect(sanitise({ tool: "piece_add", ms: 42, ok: true, missing: null, absent: undefined }))
            .toEqual({ tool: "piece_add", ms: 42, ok: "true" });
    });

    it("shortens a long value rather than sending a paragraph", () => {
        const long = sanitise({ control: "x".repeat(500) }).control as string;
        expect(long.length).toBeLessThanOrEqual(81);
        expect(long.endsWith("…")).toBe(true);
    });

    it("collapses whitespace, so a button's markup does not become its name", () => {
        expect(sanitise({ control: "  Play\n   the show  " })).toEqual({ control: "Play the show" });
    });

    it("refuses a value that is not a finite number", () => {
        expect(sanitise({ ms: Number.NaN, other: Number.POSITIVE_INFINITY })).toEqual({});
    });

    it("drops keys from the end until the whole thing fits Rybbit's 2 kB", () => {
        const props = Object.fromEntries(
            Array.from({ length: 60 }, (_, index) => [`key${index}`, "v".repeat(70)]));
        const kept = sanitise(props);
        expect(JSON.stringify(kept).length).toBeLessThanOrEqual(1800);
        expect(Object.keys(kept).length).toBeLessThan(60);
        expect(kept.key0).toBeDefined();
    });
});

describe("buckets", () => {
    it("groups durations by what a person would have felt", () => {
        expect(speed(20)).toBe("instant");
        expect(speed(400)).toBe("fast");
        expect(speed(3000)).toBe("slow");
        expect(speed(30_000)).toBe("over patience");
    });

    it("groups counts so a big session is not a hundred categories", () => {
        expect(many(1)).toBe("1");
        expect(many(3)).toBe("2-3");
        expect(many(200)).toBe("30+");
    });
});

describe("when it counts at all", () => {
    it("is inert with no browser around it — a node test must never send anything", () => {
        expect(() => track("ai_tool_call", { tool: "piece_add" })).not.toThrow();
    });

    it("hands an event to the counter once the script is there", () => {
        const { sent } = browser();
        vi.stubGlobal("rybbit", { event: (name: string, props: Record<string, string | number>) => sent.push({ name, props }) });
        track("ai_tool_call", { tool: "piece_add", ok: true });
        expect(sent).toEqual([{ name: "ai_tool_call", props: { tool: "piece_add", ok: "true" } }]);
    });

    it("holds an early event until the deferred script lands, then deals it", () => {
        const { sent } = browser();
        vi.useFakeTimers();
        try {
            track("play_started", { chapters: 2 });
            expect(sent).toHaveLength(0);
            vi.stubGlobal("rybbit", { event: (name: string, props: Record<string, string | number>) => sent.push({ name, props }) });
            vi.advanceTimersByTime(400);
            expect(sent).toEqual([{ name: "play_started", props: { chapters: 2 } }]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("gives up on a script that never arrives instead of holding events forever", () => {
        const { sent } = browser();
        vi.useFakeTimers();
        try {
            track("play_started", {});
            vi.advanceTimersByTime(11_000);
            vi.stubGlobal("rybbit", { event: (name: string, props: Record<string, string | number>) => sent.push({ name, props }) });
            vi.advanceTimersByTime(2000);
            expect(sent).toHaveLength(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("counts nothing on localhost, so a developer's reloads are not the numbers", () => {
        const { sent } = browser("localhost");
        vi.stubGlobal("rybbit", { event: (name: string, props: Record<string, string | number>) => sent.push({ name, props }) });
        track("ui_click", { control: "Play the show" });
        expect(sent).toHaveLength(0);
    });

    it("counts on localhost when asked to, and remembers being asked", () => {
        const { sent, store } = browser("localhost", "?telemetry=on");
        vi.stubGlobal("rybbit", { event: (name: string, props: Record<string, string | number>) => sent.push({ name, props }) });
        track("ui_click", { control: "Play the show" });
        expect(sent).toHaveLength(1);
        expect(store.get("theater.telemetry")).toBe("on");
    });

    it("stops when Rybbit's own opt-out flag is set, whoever set it", () => {
        const { sent } = browser();
        vi.stubGlobal("__RYBBIT_OPTOUT__", true);
        vi.stubGlobal("rybbit", { event: (name: string, props: Record<string, string | number>) => sent.push({ name, props }) });
        track("ui_click", { control: "Play the show" });
        expect(sent).toHaveLength(0);
    });

    it("stops when a person opts out, wherever the page is served from", () => {
        const { sent } = browser("theater.needle.tools", "?telemetry=off");
        vi.stubGlobal("rybbit", { event: (name: string, props: Record<string, string | number>) => sent.push({ name, props }) });
        track("ui_click", { control: "Play the show" });
        expect(sent).toHaveLength(0);
    });
});
