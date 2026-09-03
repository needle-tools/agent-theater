/**
 * A signal that an agent just did something in the room.
 *
 * Deliberately free of any engine import: the Svelte page subscribes to this,
 * and a static import that reached @needle-tools/engine would drag the whole
 * engine out of the hero's lazy chunk and into the main bundle.
 */

export interface AgentActivity {
    tool: string;
    args?: unknown;
    at: number;
}

const callbacks = new Set<(activity: AgentActivity) => void>();
let last: AgentActivity | null = null;

export function notifyAgentActivity(tool: string, args?: unknown) {
    last = { tool, args, at: Date.now() };
    for (const callback of [...callbacks]) callback(last);
}

/** Fires immediately with the most recent activity, if an agent already acted. */
export function onAgentActivity(callback: (activity: AgentActivity) => void): () => void {
    if (last) callback(last);
    callbacks.add(callback);
    return () => { callbacks.delete(callback); };
}
