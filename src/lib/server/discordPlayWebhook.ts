export interface PublishedPlayNotice {
    id: string;
    title: string;
    url: string;
    chapters: number;
    language: string;
}

/** Only public play details go to Discord. No client address or edit token. */
export function discordPlayPayload(play: PublishedPlayNotice) {
    return {
        allowed_mentions: { parse: [] },
        embeds: [{
            title: play.title.slice(0, 256),
            url: play.url,
            color: 0xe5a627,
            description: "A new Agent Theater play was published.",
            fields: [
                { name: "Scenes", value: String(play.chapters), inline: true },
                { name: "Language", value: play.language, inline: true },
            ],
        }],
    };
}

/** A Discord outage must never undo a successfully published play. */
export async function notifyNewPlayPublished(play: PublishedPlayNotice, configured: string | undefined): Promise<void> {
    configured = configured?.trim();
    if (!configured) return;
    try {
        const webhook = new URL(configured);
        if (webhook.protocol !== "https:"
            || !["discord.com", "discordapp.com"].includes(webhook.hostname)
            || !/^\/api\/(?:v\d+\/)?webhooks\/\d+\/[^/]+$/.test(webhook.pathname)) {
            console.warn("[plays] Discord webhook URL is invalid.");
            return;
        }
        // Discord's wait=false response can succeed even when the message is
        // not saved. wait=true confirms the post before the publish replies.
        webhook.searchParams.set("wait", "true");
        const response = await fetch(webhook, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(discordPlayPayload(play)),
            signal: AbortSignal.timeout(3000),
        });
        if (!response.ok)
            console.warn("[plays] Discord publication notice failed.", { id: play.id, status: response.status });
    } catch (error) {
        // Fetch errors can contain the URL, whose path includes the webhook
        // token. Log only the error class, never the message or URL.
        console.warn("[plays] Discord publication notice failed.", {
            id: play.id, reason: error instanceof Error ? error.name : "unknown",
        });
    }
}
