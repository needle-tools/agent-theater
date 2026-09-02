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
    // One sentence. Everything else an agent needs is in theater_start, which
    // is the whole reason that tool exists — a prompt that repeated the guide
    // would be a second copy to keep in step, and a long one is less likely to
    // be pasted at all.
    return `Open ${origin}, load its WebMCP tools and call theater_start — it is a theatre and you are directing.`;
}

/** Where to send somebody who wants to hand it straight to ChatGPT. */
export function chatgptWith(prompt: string): string {
    return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}
