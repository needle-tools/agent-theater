/**
 * WebMCP tools for the registry page itself.
 *
 * WebMCP (https://github.com/webmachinelearning/webmcp) lets a page expose
 * typed tools to a browser-integrated AI agent. This page registers four:
 *
 *  - list_needle_webmcp_apps — the registry contents
 *  - find_tool_for_task      — route a task to the right app + tool
 *  - get_workflow            — cross-app recipes the agent can execute across tabs
 *  - search_needle_knowledge_base — semantic search over all Needle content
 *
 * The hero scene registers its own tools on top (see scene.ts) through the
 * shared registerTools() helper.
 *
 * The entry point is `document.modelContext` (`navigator.modelContext` is a
 * deprecated alias kept by Chrome's origin trial); older trial builds only
 * shipped the batch `provideContext()` API, so both paths are handled.
 */

const SEARCH_ENDPOINT = "https://search.needle.tools/api/semantic-search";

export type Registry = {
    name: string;
    description: string;
    apps: Array<{
        id: string;
        name: string;
        url: string;
        description: string;
        tagline?: string;
        status: string;
        tools: Array<{ name: string; description: string }>;
    }>;
    workflows?: Array<{
        id: string;
        title: string;
        goal: string;
        keywords?: string[];
        steps: Array<{ app: string; url: string; tools: string[]; instruction: string }>;
        note?: string;
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

function getModelContext(): ModelContextLike | undefined {
    if (typeof document === "undefined") return undefined;
    return (document as any).modelContext ?? (globalThis.navigator as any)?.modelContext;
}

/** Everything registered so far — old provideContext() builds replace the whole
 *  set on each call, so late registrations (hero tools) must re-provide it all. */
const allTools: any[] = [];

/**
 * Register tools with the browser. Callable more than once (page tools first,
 * hero tools once the 3D scene is up); a no-op where WebMCP is absent.
 */
let warnedAbsent = false;

export async function registerTools(tools: any[]) {
    const modelContext = getModelContext();
    if (!modelContext) {
        // Silence here cost us a debugging session once — say why the tools are missing.
        if (!warnedAbsent) {
            warnedAbsent = true;
            if (!window.isSecureContext) {
                console.info(
                    "[needle-webmcp] WebMCP unavailable: this page is not a secure context " +
                    `(${location.origin}). Use https or localhost — a plain-http LAN IP won't work.`);
            } else {
                console.info(
                    "[needle-webmcp] WebMCP unavailable in this browser. " +
                    "Chrome needs the origin trial token or chrome://flags/#enable-webmcp-testing; " +
                    "see https://developer.chrome.com/docs/ai/webmcp");
            }
        }
        return false;
    }
    const fresh = tools.filter(t => !allTools.some(existing => existing.name === t.name));
    allTools.push(...fresh);
    try {
        if (typeof modelContext.registerTool === "function") {
            for (const tool of fresh) await modelContext.registerTool(tool);
        } else if (typeof modelContext.provideContext === "function") {
            modelContext.provideContext({ tools: allTools });
        } else {
            return false;
        }
        return true;
    } catch (err) {
        // NotAllowedError means the `tools` permission is off for this document — nothing to do about it.
        console.debug("[needle-webmcp] tool registration skipped:", err);
        return false;
    }
}

/** Crude but dependency-free relevance: how many query words hit the haystack. */
function score(query: string, haystack: string): number {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
    const target = haystack.toLowerCase();
    let hits = 0;
    for (const w of words) if (target.includes(w)) hits++;
    return words.length ? hits / words.length : 0;
}

function makeTools(registry: Registry) {
    const listTool = {
        name: "list_needle_webmcp_apps",
        title: "List Needle WebMCP apps",
        annotations: { readOnlyHint: true },
        description:
            "List the Needle web apps that expose WebMCP tools for 3D web development — " +
            "model optimization, background removal, live scene inspection, docs search — " +
            "with the URL of each app and the tools it registers. " +
            "Open an app's URL to use its tools there. " +
            "For multi-app tasks, call get_workflow; to route a single task, call find_tool_for_task.",
        inputSchema: { type: "object", properties: {} },
        async execute() {
            const lines = registry.apps.map(a =>
                `- ${a.name} (${a.status}) — ${a.url}\n  ${a.description}\n  Tools: ${a.tools.map(t => t.name).join(", ")}`);
            return result(`${registry.description}\n\n${lines.join("\n\n")}`, registry);
        },
    };

    const routerTool = {
        name: "find_tool_for_task",
        title: "Find the right Needle tool for a task",
        annotations: { readOnlyHint: true },
        description:
            "Route a 3D-webdev task to the right Needle app and WebMCP tool. " +
            "Pass what the user wants to do (e.g. 'remove the background from this photo', " +
            "'reduce this model to 5000 triangles', 'why is this scene slow') and get back " +
            "ranked matches with the app URL to open and the tool to call there. " +
            "Tools register when the app's page loads — open the URL in a new tab first.",
        inputSchema: {
            type: "object",
            properties: {
                task: { type: "string", description: "What the user wants to accomplish, in plain words." },
            },
            required: ["task"],
        },
        async execute(args: { task?: string }) {
            const task = (args?.task ?? "").trim();
            if (!task) return result("Missing \"task\".", { error: "Missing task" }, true);
            const matches = registry.apps.flatMap(app =>
                app.tools.filter(t => t.name !== "…").map(tool => ({
                    app: app.name,
                    appId: app.id,
                    url: app.url,
                    status: app.status,
                    tool: tool.name,
                    toolDescription: tool.description,
                    relevance: Math.round(100 * (
                        score(task, `${tool.name} ${tool.description}`) * 2 +
                        score(task, `${app.name} ${app.tagline ?? ""} ${app.description}`))) / 100,
                })))
                .filter(m => m.relevance > 0)
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, 5);
            if (!matches.length) {
                return result(
                    `No direct tool match for "${task}". Call list_needle_webmcp_apps for the full registry, ` +
                    `or search_needle_knowledge_base to research how Needle handles it.`,
                    { task, matches: [] });
            }
            const text = matches.map((m, i) =>
                `${i + 1}. ${m.tool} — ${m.app} (${m.url})\n   ${m.toolDescription}`).join("\n");
            return result(
                `Best Needle tools for "${task}" (open the app URL in a new tab, the tool registers when the page loads):\n\n${text}`,
                { task, matches });
        },
    };

    const workflowTool = {
        name: "get_workflow",
        title: "Get a cross-app Needle workflow",
        annotations: { readOnlyHint: true },
        description:
            "Get a step-by-step recipe that chains multiple Needle apps' WebMCP tools to reach a goal — " +
            "e.g. photo → background removal (FastCut) → image-to-3D + bake (Mesh Baker) → publish (Needle Cloud). " +
            "Each step names the app URL to open and the tools to call there, in order. " +
            "WebMCP tools are per-page, so an agent that can use more than one tab can execute the whole pipeline. " +
            "Call without a goal to list all available workflows.",
        inputSchema: {
            type: "object",
            properties: {
                goal: { type: "string", description: "What the user wants to achieve. Omit to list all workflows." },
            },
        },
        async execute(args: { goal?: string }) {
            const workflows = registry.workflows ?? [];
            const goal = (args?.goal ?? "").trim();
            const overview = workflows.map(w => `- ${w.id}: ${w.title} — ${w.goal}`).join("\n");
            if (!goal) {
                return result(`Available Needle workflows:\n\n${overview}\n\nCall again with a goal to get the full steps.`,
                    { workflows: workflows.map(({ id, title, goal }) => ({ id, title, goal })) });
            }
            const ranked = workflows
                .map(w => ({
                    workflow: w,
                    relevance: score(goal, `${w.id} ${w.title} ${w.goal} ${(w.keywords ?? []).join(" ")}`),
                }))
                .sort((a, b) => b.relevance - a.relevance);
            const best = ranked[0];
            if (!best || best.relevance === 0) {
                return result(
                    `No workflow matches "${goal}". Available:\n\n${overview}\n\n` +
                    `find_tool_for_task may still route the task to a single tool.`,
                    { goal, workflows: workflows.map(({ id, title, goal }) => ({ id, title, goal })) });
            }
            const w = best.workflow;
            const steps = w.steps.map((s, i) =>
                `${i + 1}. [${s.app}] ${s.url}\n   Tools: ${s.tools.join(", ")}\n   ${s.instruction}`).join("\n\n");
            return result(
                `Workflow "${w.title}" — ${w.goal}\n\n${steps}${w.note ? `\n\nNote: ${w.note}` : ""}`,
                { goal, workflow: w });
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

    return [listTool, routerTool, workflowTool, searchTool];
}

/** Registers the page's tools with the browser. Safe to call more than once. */
export async function registerWebMcpTools(registry: Registry) {
    await registerTools(makeTools(registry));
}
