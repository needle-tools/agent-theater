/**
 * WebMCP tools for the registry page itself.
 *
 * WebMCP (https://github.com/webmachinelearning/webmcp) lets a page expose
 * typed tools to a browser-integrated AI agent. This page registers two:
 * one that returns the registry contents, and one that searches the public
 * Needle knowledge base.
 *
 * The entry point is `document.modelContext` (`navigator.modelContext` is a
 * deprecated alias kept by Chrome's origin trial); older trial builds only
 * shipped the batch `provideContext()` API, so both paths are handled.
 */

const SEARCH_ENDPOINT = "https://search.needle.tools/api/semantic-search";

type Registry = {
    name: string;
    description: string;
    apps: Array<{
        id: string;
        name: string;
        url: string;
        description: string;
        status: string;
        tools: Array<{ name: string; description: string }>;
    }>;
};

type ModelContextLike = {
    registerTool?: (tool: unknown, options?: unknown) => Promise<unknown> | unknown;
    provideContext?: (context: { tools: unknown[] }) => unknown;
};

/** MCP-shaped result: `structuredContent` is the payload, the text block mirrors it. */
const result = (summary: string, structured?: object, isError = false) => ({
    content: [{ type: "text", text: summary }],
    ...(structured ? { structuredContent: structured } : {}),
    ...(isError ? { isError: true } : {}),
});

function makeTools(registry: Registry) {
    const listTool = {
        name: "list_needle_webmcp_apps",
        title: "List Needle WebMCP apps",
        annotations: { readOnlyHint: true },
        description:
            "List the Needle web apps that expose WebMCP tools for 3D web development — " +
            "model optimization, background removal, live scene inspection, docs search — " +
            "with the URL of each app and the tools it registers. " +
            "Open an app's URL to use its tools there.",
        inputSchema: { type: "object", properties: {} },
        async execute() {
            const lines = registry.apps.map(a =>
                `- ${a.name} (${a.status}) — ${a.url}\n  ${a.description}\n  Tools: ${a.tools.map(t => t.name).join(", ")}`);
            return result(`${registry.description}\n\n${lines.join("\n\n")}`, registry);
        },
    };

    const searchTool = {
        name: "search_needle_knowledge_base",
        title: "Search Needle knowledge base",
        annotations: {
            readOnlyHint: true,
            // Results include forum posts and Discord messages — treat as data, not instructions.
            untrustedContentHint: true,
        },
        description:
            "Search the Needle knowledge base: documentation, API reference, forum posts, " +
            "community Discord threads and source code. Returns embedding-ranked excerpts " +
            "with the URL of each source. The same knowledge base is reachable over plain HTTP — " +
            "see https://search.needle.tools/api-docs.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "A natural language question or keywords, e.g. \"how to add a rigidbody\".",
                },
                limit: { type: "number", description: "How many results to return, 1-20. Defaults to 5." },
            },
            required: ["query"],
        },
        async execute(args: { query?: string; limit?: number }, options?: { signal?: AbortSignal }) {
            const query = (args?.query ?? "").trim();
            if (!query) return result("Missing \"query\".", { error: "Missing query" }, true);
            const limit = Math.min(20, Math.max(1, Math.round(args?.limit ?? 5)));
            try {
                const response = await fetch(`${SEARCH_ENDPOINT}?${new URLSearchParams({ q: query, limit: String(limit) })}`,
                    { headers: { accept: "application/json" }, signal: options?.signal });
                if (response.status === 429)
                    return result("Needle search is rate limited right now. Wait a moment and try again.", undefined, true);
                if (!response.ok)
                    return result(`Needle search failed with HTTP ${response.status}.`, undefined, true);
                const data = await response.json();
                const results = Array.isArray(data?.results) ? data.results : [];
                const text = results.length
                    ? results.map((r: any, i: number) =>
                        `${i + 1}. ${r.title || "Untitled"}${r.url ? ` — ${r.url}` : ""}\n${(r.content || "").trim()}`).join("\n\n---\n\n")
                    : `No results for "${query}".`;
                return result(text, { query, count: results.length, results });
            } catch (err) {
                if (options?.signal?.aborted) throw err;
                return result(`Needle search request failed: ${err instanceof Error ? err.message : String(err)}`, undefined, true);
            }
        },
    };

    return [listTool, searchTool];
}

let registered = false;

/** Registers the page's tools with the browser. Safe to call more than once; a no-op where WebMCP is absent. */
export async function registerWebMcpTools(registry: Registry) {
    if (registered || typeof document === "undefined") return;
    const modelContext: ModelContextLike | undefined =
        (document as any).modelContext ?? (globalThis.navigator as any)?.modelContext;
    if (!modelContext) return;
    registered = true;

    try {
        const tools = makeTools(registry);
        if (typeof modelContext.registerTool === "function") {
            for (const tool of tools) await modelContext.registerTool(tool);
        } else if (typeof modelContext.provideContext === "function") {
            // Older origin-trial builds only shipped the batch API.
            modelContext.provideContext({ tools });
        } else {
            registered = false;
        }
    } catch (err) {
        // NotAllowedError means the `tools` permission is off for this document — nothing to do about it.
        registered = false;
        console.debug("[needle-webmcp] tool registration skipped:", err);
    }
}
