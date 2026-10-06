import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyNewPlayPublished } from "../src/lib/server/discordPlayWebhook.js";

const play = {
    id: "example-play",
    title: "The Moon @everyone",
    url: "https://theater.needle.tools/p/example-play",
    chapters: 3,
    language: "en",
};
const webhook = "https://discord.com/api/webhooks/123456789/secret-token";

afterEach(() => vi.restoreAllMocks());

describe("new-play Discord notice", () => {
    it("posts only public play details and waits for Discord to save the message", async () => {
        const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
        await notifyNewPlayPublished(play, webhook);
        expect(send).toHaveBeenCalledOnce();
        const [url, options] = send.mock.calls[0];
        expect(new URL(String(url)).searchParams.get("wait")).toBe("true");
        const payload = JSON.parse(String(options?.body));
        expect(payload.allowed_mentions).toEqual({ parse: [] });
        expect(payload.embeds[0]).toMatchObject({ title: play.title, url: play.url });
        expect(JSON.stringify(payload)).not.toContain("secret-token");
    });

    it("never fails the publication or exposes the webhook token when Discord rejects it", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 500 }));
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        await expect(notifyNewPlayPublished(play, webhook)).resolves.toBeUndefined();
        expect(JSON.stringify(warning.mock.calls)).not.toContain("secret-token");
    });

    it("ignores invalid webhook destinations", async () => {
        const send = vi.spyOn(globalThis, "fetch");
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await notifyNewPlayPublished(play, "https://example.com/api/webhooks/123/token");
        expect(send).not.toHaveBeenCalled();
    });
});
