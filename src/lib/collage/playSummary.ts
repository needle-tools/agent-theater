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

/**
 * The play in a sentence, for the card a pasted link unfurls into.
 *
 * The STORY leads when the play has one to give: the byline is a sentence
 * the author wrote about the piece ("a Moon Magic tale in three scenes"),
 * and a card that opens with it reads as a play rather than an inventory.
 * The numbers still follow — they are recomputed on every save, so that part
 * of the card cannot drift from the play — but the pack list steps aside
 * when a story is present: "set in birthday party, desert and fairy tale"
 * is where the paper came from, not where the story happens.
 *
 * Facts before the pitch either way, because a link preview is read in about
 * a second and gets truncated after that — whoever sees it should learn what
 * this particular play is before they learn what the site is.
 */
export function describePlay(summary: PlaySummary, story = ""): string {
    const telling = story.trim().replace(/[.\s]+$/, "");
    const facts: string[] = [];
    if (summary.chapters > 0) {
        facts.push(summary.chapters === 1 ? "One chapter" : `${summary.chapters} chapters`);
    }
    if (summary.seconds > 0) facts.push(`about ${roughly(summary.seconds)}`);
    if (!telling && summary.themes.length) facts.push(`set in ${listed(summary.themes.slice(0, 3))}`);
    const play = "A paper theatre play — watch it, or take it apart and stage your own.";
    const lead = telling ? `${telling.charAt(0).toUpperCase()}${telling.slice(1)}. ` : "";
    return facts.length ? `${lead}${facts.join(", ")}. ${play}` : `${lead}${play}`;
}

/**
 * A length somebody can picture. Deliberately vague: "1:47" is a fact nobody
 * needs from a preview, and rounding to the nearest five seconds keeps two
 * saves of the same play from advertising different numbers.
 */
function roughly(seconds: number): string {
    // The changeover is at a minute and a quarter rather than at ninety
    // seconds, so that "about a minute" is a thing this can actually say:
    // ninety seconds rounds to two minutes, which left the phrase unreachable
    // and eighty-five seconds reading as "about 85 seconds".
    if (seconds < 75) {
        const rounded = Math.max(5, Math.round(seconds / 5) * 5);
        return `${rounded} seconds`;
    }
    const minutes = Math.round(seconds / 60);
    return minutes === 1 ? "a minute" : `${minutes} minutes`;
}

/** "forest", "forest and animals", "forest, animals and fairy tale". */
function listed(names: string[]): string {
    const words = names.map(name => name.replace(/-/g, " "));
    if (words.length <= 1) return words[0] ?? "";
    return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
