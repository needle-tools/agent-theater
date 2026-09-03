import { afterEach, describe, expect, it } from "vitest";
import {
    avatarFrame,
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
        expect(seen).toEqual([null, seedy]);
    });
});
