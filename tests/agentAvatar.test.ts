import { afterEach, describe, expect, it } from "vitest";
import {
    avatarFrame,
    avatarLookCell,
    avatarLookDirection,
    DEFAULT_AGENT_AVATAR_SHEET,
    onAgentAvatarSheet,
    restoreAgentAvatarSheet,
    setAgentAvatarSheet,
    type AgentAvatarSheet,
} from "../src/lib/collage/agentAvatar.js";

afterEach(() => setAgentAvatarSheet(null));

describe("agent pet spritesheets", () => {
    it("keeps the sheet whole and addresses exact CSS cells", () => {
        const sheet = { columns: 8, rows: 11 };
        expect(avatarFrame(sheet, 0, 0)).toEqual({ x: "0%", y: "0%" });
        expect(avatarFrame(sheet, 7, 10)).toEqual({ x: "100%", y: "100%" });
        expect(avatarFrame(sheet, 0, 6)).toEqual({ x: "0%", y: "60%" });
    });

    it("maps screen directions through both rotation rows in reading order", () => {
        const sheet = { columns: 8, rows: 11 };
        expect(avatarLookCell(sheet, avatarLookDirection(0, 10))).toEqual({ column: 0, row: 10 });
        expect(avatarLookCell(sheet, avatarLookDirection(10, 0))).toEqual({ column: 4, row: 9 });
        expect(avatarLookCell(sheet, avatarLookDirection(0, -10))).toEqual({ column: 0, row: 9 });
        expect(avatarLookCell(sheet, avatarLookDirection(-10, 0))).toEqual({ column: 4, row: 10 });
    });

    it("publishes the selected sheet to the floating avatar", () => {
        const seen: Array<AgentAvatarSheet | null> = [];
        const off = onAgentAvatarSheet(sheet => seen.push(sheet));
        const seedy = {
            src: "data:image/webp;base64,UklGRg==",
            name: "Seedy",
            columns: 8,
            rows: 11,
        };
        setAgentAvatarSheet(seedy);
        off();
        expect(seen).toEqual([DEFAULT_AGENT_AVATAR_SHEET, seedy]);
    });

    it("restores bundled Codey when the outside provides no pet", () => {
        setAgentAvatarSheet({ src: "data:image/webp;base64,eA==", name: "Other", columns: 8, rows: 11 });
        const seen: Array<AgentAvatarSheet | null> = [];
        const off = onAgentAvatarSheet(sheet => seen.push(sheet));
        setAgentAvatarSheet(null);
        off();
        expect(seen.at(-1)).toEqual(DEFAULT_AGENT_AVATAR_SHEET);
    });

    it("restores a selected pet from local storage", () => {
        const values = new Map<string, string>();
        const seedy = {
            src: "data:image/webp;base64,UklGRg==",
            name: "Seedy",
            columns: 8,
            rows: 11,
        };
        values.set("theatre:agent-avatar", JSON.stringify(seedy));
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        };
        setAgentAvatarSheet(seedy, storage);
        expect(values.get("theatre:agent-avatar")).toBe(JSON.stringify(seedy));
        setAgentAvatarSheet(null, null);
        expect(restoreAgentAvatarSheet(storage)).toEqual(seedy);
    });
});
