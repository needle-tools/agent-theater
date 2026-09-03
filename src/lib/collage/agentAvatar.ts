/**
 * The artwork used by the little agent moving over the stage.
 *
 * A Codex pet belongs to the person, not this site, so no particular pet is
 * bundled here. An agent that is allowed to read its local configuration can
 * hand the selected pet's real sheet to the page at runtime.
 */

export interface AgentAvatarSheet {
    src: string;
    name: string;
    columns: number;
    rows: number;
}

export const DEFAULT_AGENT_AVATAR_SHEET: Readonly<AgentAvatarSheet> = Object.freeze({
    src: "/pets/codex-spritesheet.webp",
    name: "Codey",
    columns: 8,
    rows: 11,
});

const listeners = new Set<(sheet: AgentAvatarSheet | null) => void>();
let selected: AgentAvatarSheet = DEFAULT_AGENT_AVATAR_SHEET;

export function setAgentAvatarSheet(sheet: AgentAvatarSheet | null): void {
    selected = sheet ?? DEFAULT_AGENT_AVATAR_SHEET;
    for (const listener of [...listeners]) listener(selected);
}

export function onAgentAvatarSheet(listener: (sheet: AgentAvatarSheet | null) => void): () => void {
    listener(selected);
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** CSS background-position for a cell while the source remains one sheet. */
export function avatarFrame(
    sheet: Pick<AgentAvatarSheet, "columns" | "rows">,
    column: number,
    row: number,
): { x: string; y: string } {
    const safeColumn = Math.max(0, Math.min(sheet.columns - 1, column));
    const safeRow = Math.max(0, Math.min(sheet.rows - 1, row));
    const x = sheet.columns <= 1 ? 0 : 100 * safeColumn / (sheet.columns - 1);
    const y = sheet.rows <= 1 ? 0 : 100 * safeRow / (sheet.rows - 1);
    return { x: `${x}%`, y: `${y}%` };
}
