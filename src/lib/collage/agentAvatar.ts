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

const STORAGE_KEY = "theatre:agent-avatar";
const listeners = new Set<(sheet: AgentAvatarSheet | null) => void>();
let selected: AgentAvatarSheet = DEFAULT_AGENT_AVATAR_SHEET;
let browserRestored = false;

export type AgentAvatarStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): AgentAvatarStorage | null {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function savedSheet(value: unknown): AgentAvatarSheet | null {
    if (!value || typeof value !== "object") return null;
    const sheet = value as Partial<AgentAvatarSheet>;
    if (!sheet.src?.match(/^data:image\/[a-z0-9.+-]+;base64,/i) || !sheet.name) return null;
    if (!Number.isInteger(sheet.columns) || !Number.isInteger(sheet.rows)) return null;
    if (sheet.columns! < 1 || sheet.columns! > 16 || sheet.rows! < 5 || sheet.rows! > 24) return null;
    return sheet as AgentAvatarSheet;
}

/** Load a previously selected local pet. Exported so persistence is testable without a browser. */
export function restoreAgentAvatarSheet(storage: AgentAvatarStorage): AgentAvatarSheet {
    try {
        const raw = storage.getItem(STORAGE_KEY);
        const restored = raw ? savedSheet(JSON.parse(raw)) : null;
        if (restored) selected = restored;
    } catch {
        // A malformed or unavailable browser store should leave bundled Codey intact.
    }
    for (const listener of [...listeners]) listener(selected);
    return selected;
}

function ensureBrowserAvatar(): void {
    if (browserRestored) return;
    browserRestored = true;
    const storage = browserStorage();
    if (storage) restoreAgentAvatarSheet(storage);
}

export function setAgentAvatarSheet(
    sheet: AgentAvatarSheet | null,
    storage: AgentAvatarStorage | null = browserStorage(),
): void {
    selected = sheet ?? DEFAULT_AGENT_AVATAR_SHEET;
    if (storage) {
        try {
            if (sheet) storage.setItem(STORAGE_KEY, JSON.stringify(sheet));
            else storage.removeItem(STORAGE_KEY);
        } catch {
            // The pet still works for this visit if storage is full or unavailable.
        }
    }
    for (const listener of [...listeners]) listener(selected);
}

export function onAgentAvatarSheet(listener: (sheet: AgentAvatarSheet | null) => void): () => void {
    ensureBrowserAvatar();
    listener(selected);
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getAgentAvatarSheet(): AgentAvatarSheet {
    ensureBrowserAvatar();
    return selected;
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

/** Which of the two rotation rows faces a point on screen; frame zero faces down/front. */
export function avatarLookDirection(dx: number, dy: number, columns = 8): number {
    const directions = Math.max(2, columns * 2);
    const angle = Math.atan2(dy, dx);
    const step = Math.round(columns / 2 + angle * columns / Math.PI);
    return ((step % directions) + directions) % directions;
}

/** Cell for a direction in the final two rows, in the sheet's actual reading order. */
export function avatarLookCell(
    sheet: Pick<AgentAvatarSheet, "columns" | "rows">,
    direction: number,
): { column: number; row: number } {
    const count = sheet.columns * 2;
    const step = ((Math.round(direction) % count) + count) % count;
    return {
        column: step % sheet.columns,
        row: sheet.rows - 2 + Math.floor(step / sheet.columns),
    };
}
