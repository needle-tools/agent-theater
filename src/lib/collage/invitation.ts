/**
 * What the page says it is, which is also what you give an agent.
 *
 * One string, two jobs. It is the description on an empty stage — the thing a
 * person reads to find out what this is — and it is the prompt you paste into
 * an agent to make it happen. Writing those separately was writing the same
 * thing twice, and the copy that nobody was looking at was always the one that
 * went stale.
 *
 * It works as both because the honest description of this page happens to be an
 * instruction: there is nothing here until somebody directs it. So it is
 * written as one — plain enough to read, specific enough to act on, and naming
 * the one tool that explains all the others.
 */
export function invitation(origin: string): string {
    // The version that is READ — a watermark on the stage, for a person, so
    // no tool names and no protocol words. What it must do is say what will
    // happen and how to make it happen, in the time a glance lasts. The
    // technical half lives in briefing(), which is what actually gets copied.
    void origin;
    return (
        `Copy this prompt and give it to the AI agent in your browser. ` +
        `It will ask you for a story, build the set, and put on the show.`
    );
}

/**
 * The version that is COPIED — the full briefing an agent starts from.
 *
 * Longer than what is shown, on purpose: the watermark is for a person
 * glancing at a page, the clipboard is for an agent that arrives mid-thought
 * and, in practice, skips the guide and generates art before asking what the
 * play is about. So the pasted text carries the itinerary itself — the order
 * of the first calls, and the one rule (story before art) that every shallow
 * play broke. theater_start remains the detail; this is the map handed over
 * at the door.
 */
export function briefing(origin: string): string {
    return (
        `Open ${origin} and load its WebMCP tools — it is a theatre and you are directing. ` +
        `Call theater_start first: it says what is already on the stage and what to do next. ` +
        `Then look at theater_troupe (ready-cut art packs) and PITCH me 1–3 stories you could ` +
        `stage with what is there — a line each, naming the pack — so I can pick or redirect; ` +
        `if you can generate images, one pitch may go beyond the packs, and the page will cut ` +
        `whatever you make into pieces. Build only after I choose. ` +
        `Get art from theater_troupe (instant) or theater_art_prompt + piece_sheet, ` +
        `name the piece with show_title, build each scene with stage_create and stage_cast, ` +
        `write it with stage_script — moves, lines, reactions, camera — ` +
        `and play scene by scene with show_play hold:true, narrating as it runs.`
    );
}

/** Where to send somebody who wants to hand it straight to ChatGPT. */
export function chatgptWith(prompt: string): string {
    return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}
