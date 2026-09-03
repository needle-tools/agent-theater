import { afterEach, describe, expect, it } from "vitest";
import {
    avatarFrame,
    DEFAULT_AGENT_AVATAR_SHEET,
    onAgentAvatarSheet,
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
});
