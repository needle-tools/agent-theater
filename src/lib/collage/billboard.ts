/**
 * The title card and the credit roll.
 *
 * The two things a show has that are not the show: what it is called, and who
 * was in it. Both are text over a darkened stage, and both are timed rather
 * than clicked through — a title you have to dismiss is a dialog, and a play
 * does not open with a dialog.
 *
 * Kept apart from the player because none of it animates a layer. The player
 * moves the cast; this puts words in front of them.
 */
import type { Stage } from "./stage.js";

/** A cast row in the roll: the artwork itself, beside its credit. */
export interface CreditEntry {
    /** The character, or null when nobody said who this was meant to be. */
    role: string | null;
    /** The picture doing the playing — its label, usually the file it came from. */
    actor: string;
    /** The artwork's src, so the roll can SHOW who bowed. Null if it is gone. */
    src: string | null;
}

/** What is on the screen instead of the scene. */
export type Billboard =
    | { kind: "waiting"; title?: string; duration: number }
    | { kind: "blackout"; duration: number }
    | {
        kind: "title";
        title: string;
        byline?: string;
        /** A few of the cast, fanned under the name like a playbill poster. */
        entries?: CreditEntry[];
        duration: number;
    }
    | {
        kind: "credits";
        title?: string;
        /** The cast, each with their picture — drawn as alternating rows. */
        entries?: CreditEntry[];
        /** Plain lines after the cast: the makers, the thanks. */
        lines: string[];
        duration: number;
    };

/** One line of the roll: who they played, and what picture played them. */
export interface Credit {
    /** The layer that played it, for looking the artwork up. */
    id: string;
    /** The character. Null when nobody said who this was meant to be. */
    role: string | null;
    /** The picture doing the playing — its label, usually the file it came from. */
    actor: string;
}

/**
 * Long enough to read a title and understand that the show has started.
 *
 * A fixed length rather than one scaled to the title: a two-word title and a
 * ten-word one are both read in about the time it takes to settle, and a card
 * that vanished quickly because the name was short would feel like a glitch.
 */
export const TITLE_MS = 3600;

/**
 * How long the show will wait to be let in before giving up and starting.
 *
 * It waits because a browser refuses to make a sound until somebody has
 * touched the page, and a show an agent started has had no touch at all — so
 * without this the music, the stings and half the drama play to nobody, and
 * the person finds out afterwards. One click fixes it, and asking for one
 * click is a fair thing to do at the start of a performance.
 *
 * It gives up because the alternative is a page that hangs forever when nobody
 * is at the keyboard. A silent show is worse than a loud one and better than
 * no show at all.
 */
export const WAIT_FOR_AUDIENCE_MS = 30_000;

/**
 * The fade between scenes, end to end.
 *
 * Darkness rises over the old scene, the set is swapped behind it, and it
 * lifts off the new one. It replaced individual exits — every character
 * animating out one by one took longer than the scene and looked like a
 * fire drill.
 */
export const BLACKOUT_MS = 900;

/** Per credit line, plus a moment at each end to start and finish reading.
 *  Trimmed from the original 900: pictures read faster than sentences, and
 *  the roll now travels its full height, so the same time moves twice the
 *  distance. */
export const CREDIT_LINE_MS = 650;
export const CREDIT_PAD_MS = 1800;

/**
 * The rows the page adds to every roll uninvited: the director's portrait,
 * the house cactus, its line, and the thank-you. They are content like any
 * other and the roll has to travel past them — leaving them out of the
 * duration made real rolls noticeably faster than the ?credits preview,
 * which counted the same rows nobody was counting.
 */
export const CREDIT_HOUSE_ROWS = 4;

/**
 * Who acted, as opposed to who was on stage.
 *
 * A set is cast exactly the way a cast is: the house, the bush and the tree all
 * go in through stage_cast with a position and a plane, because that is how
 * anything gets into a scene. Which means nothing downstream could tell them
 * apart — and the curtain call had the house bow.
 *
 * The rule is the honest one: you acted if you did something. Either the script
 * gives you a beat, or you were cast AS somebody, which is a statement that you
 * are playing a part rather than standing in the background. Scenery does
 * neither, and a backdrop is never in it at all.
 *
 * A silent extra with no role given is not counted, which is the right way for
 * this to fail: leaving somebody out of a bow is a smaller wrong than making
 * the furniture take one.
 */
export function performers(stages: Stage[]): Set<string> {
    const acted = new Set<string>();
    for (const stage of stages) {
        for (const beat of stage.script) {
            if (beat.id) acted.add(beat.id);
        }
        for (const member of stage.cast) {
            if (member.id !== stage.backdrop && member.as?.trim()) acted.add(member.id);
        }
    }
    for (const stage of stages) {
        if (stage.backdrop) acted.delete(stage.backdrop);
    }
    return acted;
}

/**
 * Who was in it, in the order they first appeared.
 *
 * Order of appearance rather than alphabetical or billing order, because it is
 * the only order the document actually knows — and it happens to be the one
 * that reads best, since the audience meets them in that order too.
 *
 * A layer appearing in three scenes is credited once, with the first role it
 * was cast as. Somebody cast as the grandmother in scene one and left
 * unlabelled afterwards is still the grandmother.
 */
export function creditsFor(stages: Stage[], labelOf: (id: string) => string | null): Credit[] {
    const credits: Credit[] = [];
    const seen = new Set<string>();
    // The people, not the furniture. A roll listing "a flowering bush — played
    // by cell 7" is funny once and wrong every time after that.
    const acted = performers(stages);
    for (const stage of stages) {
        for (const member of stage.cast) {
            if (seen.has(member.id) || !acted.has(member.id)) continue;
            const actor = labelOf(member.id);
            // No label means no layer: a cast member whose picture has been
            // deleted is not somebody to thank.
            if (!actor) continue;
            seen.add(member.id);
            credits.push({ id: member.id, role: member.as?.trim() || null, actor });
        }
    }
    return credits;
}

/**
 * The roll itself, one line per credit.
 *
 * "played by" rather than a colon or a dash alone, because the sentence is the
 * joke: these are photographs, and saying a photograph *played* the grandmother
 * is what makes the roll read as a curtain call rather than a file listing.
 */
export function creditLines(credits: Credit[]): string[] {
    return credits.map(credit =>
        credit.role ? `${credit.role} — played by ${credit.actor}` : credit.actor);
}

/**
 * The ending: the roll eases to a stop, the last card holds still for a
 * breath, and then the whole curtain fades. Part of the duration, so the
 * billboard is not snatched away mid-fade.
 */
export const CREDIT_END_HOLD_MS = 2000;
export const CREDIT_FADE_MS = 900;

/** How long a roll of this length needs: travel, then the hold, then the fade. */
export function creditsDuration(lines: number): number {
    return CREDIT_PAD_MS + lines * CREDIT_LINE_MS + CREDIT_END_HOLD_MS + CREDIT_FADE_MS;
}
