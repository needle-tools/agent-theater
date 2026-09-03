/**
 * What is strewn on the idle page, for anyone who cannot see it.
 *
 * The strewn props are decoration, deliberately not document — they are in no
 * save, no piece_list, no screenshot the agent takes. That was right until the
 * person could rearrange them: now somebody spends a minute placing a fern
 * just so, asks the agent for a play, and the agent starts by describing an
 * empty canvas. The arrangement they made was real to them and invisible to
 * their collaborator.
 *
 * This is the window: the idle component mirrors its scatter here, and
 * theater_start reads it — as information, not as content. The props stay
 * decorative; the agent is simply told what the room looks like and which
 * troupe pieces would recreate it.
 */
export interface IdleProp {
    /** The troupe piece id, conjure-suffixes stripped — what theater_troupe accepts. */
    piece: string;
    /** Percent of the viewport, from the top left. */
    x: number;
    y: number;
    /** Whether the person has touched it — placed it, and meant it. */
    touched: boolean;
}

export const idleSet = {
    props: [] as IdleProp[],
};
