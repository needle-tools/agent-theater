/**
 * A signal that an agent just did something in the room.
 *
 * Deliberately free of any dependency: the Svelte page subscribes to this, and
 * an import here that reached anything heavy would drag it into the main
 * bundle. It was written to keep the 3D engine out; the engine is gone now and
 * the rule still earns its keep.
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
