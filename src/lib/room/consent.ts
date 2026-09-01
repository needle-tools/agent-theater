/**
 * Human consent for destructive agent actions.
 *
 * The room is shared and persistent, so an agent deleting something is not
 * undoable by closing a tab — it is gone for everyone, including people who
 * were not watching. Destructive tools therefore do not act. They register a
 * proposal, describe it in words a person can judge, and wait.
 *
 * The gate deliberately holds a closure rather than a serialized command: the
 * proposal is confirmed within the same session that created it, and keeping
 * the action next to its description means the prompt can never drift from
 * what will actually run.
 */

export interface Proposal {
    id: string;
    /** What will happen, phrased for the person being asked. */
    summary: string;
    run: () => Promise<unknown>;
}

export interface ConsentGateOptions {
    newId?: () => string;
}

export class ConsentGate {
    private readonly proposals = new Map<string, Proposal>();
    private readonly changedCallbacks = new Set<() => void>();
    private readonly newId: () => string;

    constructor(options?: ConsentGateOptions) {
        this.newId = options?.newId ?? (() => crypto.randomUUID());
    }

    propose(summary: string, run: () => Promise<unknown>): Proposal {
        const proposal: Proposal = { id: this.newId(), summary, run };
        this.proposals.set(proposal.id, proposal);
        this.emitChanged();
        return proposal;
    }

    pending(): Proposal[] {
        return [...this.proposals.values()];
    }

    /** Runs the proposal and clears it. Returns null if it is already gone. */
    async confirm(id: string): Promise<unknown> {
        const proposal = this.proposals.get(id);
        if (!proposal) return null;
        // Cleared before running so a slow action cannot be confirmed twice.
        this.proposals.delete(id);
        this.emitChanged();
        return proposal.run();
    }

    reject(id: string): boolean {
        const removed = this.proposals.delete(id);
        if (removed) this.emitChanged();
        return removed;
    }

    onChanged(callback: () => void): () => void {
        this.changedCallbacks.add(callback);
        return () => { this.changedCallbacks.delete(callback); };
    }

    private emitChanged() {
        for (const callback of [...this.changedCallbacks]) callback();
    }
}
