/**
 * Minimal, dependency-free WebMCP example: register a tool that searches the
 * public Needle knowledge base. Drop this on any page as a module script.
 *
 * WebMCP is a draft standard and the API has moved while in Chrome's origin
 * trial, so this handles both generations:
 *  - `document.modelContext.registerTool(tool)` — current (Promise-returning;
 *    `navigator.modelContext` is a deprecated alias)
 *  - `modelContext.provideContext({ tools })` — older origin-trial builds
 *
 * Spec:   https://github.com/webmachinelearning/webmcp
 * Chrome: https://developer.chrome.com/docs/ai/webmcp
 */

const searchTool = {
    name: "search-needle-knowledge-base",
    title: "Search Needle knowledge base",
    description:
        "Search Needle's documentation, API reference, forum posts and Discord threads. " +
        "Returns embedding-ranked excerpts with the URL of each source.",
    annotations: {
        // Pure lookup — nothing on the page or the server changes.
        readOnlyHint: true,
        // Results include user-generated text (forum, Discord): data, not instructions.
        untrustedContentHint: true,
    },
    // JSON Schema, passed as an OBJECT (never stringified).
    inputSchema: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "A natural language question or keywords, e.g. \"export animation from Blender\".",
            },
        },
        required: ["query"],
    },
    async execute({ query }, options) {
        const params = new URLSearchParams({ q: query ?? "", limit: "5" });
        const response = await fetch(`https://search.needle.tools/api/semantic-search?${params}`, {
            headers: { accept: "application/json" },
            signal: options?.signal,
        });
        if (!response.ok) {
            return {
                content: [{ type: "text", text: `Search failed with HTTP ${response.status}.` }],
                isError: true,
            };
        }
        const data = await response.json();
        // MCP convention: a text block for agents that only read text,
        // `structuredContent` for those that can use the real payload.
        return {
            content: [{ type: "text", text: JSON.stringify(data.results, null, 2) }],
            structuredContent: data,
        };
    },
};

const modelContext = document.modelContext ?? navigator.modelContext;

if (modelContext?.registerTool) {
    // A refused registration REJECTS (duplicate name, missing permissions policy, …) —
    // await it so the failure doesn't surface as an unhandled rejection.
    await modelContext.registerTool(searchTool);
} else if (modelContext?.provideContext) {
    modelContext.provideContext({ tools: [searchTool] });
} else {
    // Browser without WebMCP — nothing to do, and nothing breaks.
}
