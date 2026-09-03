/**
 * What a saved document is, in three numbers an agent can filter on.
 *
 * The play library stores whole documents, and a document is not necessarily
 * a play: the same save path takes a canvas somebody arranged and never
 * scripted. An agent asked to find something to load should not have to
 * download twenty of those to discover that none of them perform.
 *
 * So each play carries a summary computed when it is written — how many
 * chapters, how long, and which troupe packs it draws on. Derived rather than
 * declared, because a field somebody fills in by hand is a field that lies.
 */
import type { StoredDoc } from "./persistence.js";
import type { Stage } from "./stage.js";
import { plan } from "./perform.js";

export interface PlaySummary {
    /** Chapters with something in them. Zero means it is a canvas, not a play. */
    chapters: number;
    /** End to end, in whole seconds, holds included. */
    seconds: number;
    /** Troupe packs the cast and scenery come from, for "find me a sea story". */
    themes: string[];
}

/**
 * A chapter counts when it has a cast or a script.
 *
 * Not script alone: a chapter that arranges its cast and holds is a tableau,
 * which is a thin play but is still something to look at. An empty stage with
 * neither is the leftover of a scene somebody started and abandoned, and that
 * is the thing worth filtering out.
 */
const inhabited = (stage: Stage) =>
    (Array.isArray(stage?.cast) && stage.cast.length > 0) ||
    (Array.isArray(stage?.script) && stage.script.length > 0);

export function chaptersOf(doc: StoredDoc): number {
    return (doc?.stages ?? []).filter(inhabited).length;
}

/**
 * How long the whole thing runs.
 *
 * The planner already answers this per script — it is what times the
 * narration — so this asks it once per chapter rather than inventing a second
 * arithmetic that could disagree with the one that plays. Build-up and
 * entrances are not counted: they depend on layer sizes the summary does not
 * have, and they are short next to the scripts.
 */
export function secondsOf(doc: StoredDoc): number {
    let ms = 0;
    for (const stage of doc?.stages ?? []) {
        if (!inhabited(stage)) continue;
        if (Array.isArray(stage.script) && stage.script.length) {
            try {
                ms += plan(stage.script).plan.duration;
            } catch {
                // A script the planner refuses is still a chapter; it just
                // contributes nothing measurable rather than failing the save.
            }
        }
        if (typeof stage.hold === "number" && stage.hold > 0) ms += stage.hold * 1000;
    }
    return Math.round(ms / 1000);
}

/**
 * Which packs the picture is made of, taken from where the artwork came from.
 *
 * `/troupe/<pack>/<piece>.webp` is the whole signal. Generated and uploaded
 * layers have no pack and contribute nothing, which is correct: a play built
 * entirely from conjured art has no theme this can honestly name.
 */
export function themesOf(doc: StoredDoc): string[] {
    const packs = new Set<string>();
    for (const layer of doc?.layers ?? []) {
        const src = (layer as { src?: string }).src;
        const pack = typeof src === "string" ? /^\/troupe\/([a-z0-9-]+)\//i.exec(src)?.[1] : null;
        if (pack) packs.add(pack.toLowerCase());
    }
    return [...packs].sort();
}

export function summarize(doc: StoredDoc): PlaySummary {
    return { chapters: chaptersOf(doc), seconds: secondsOf(doc), themes: themesOf(doc) };
}
