# Needle × WebMCP

**A registry of [WebMCP](https://github.com/webmachinelearning/webmcp) tools across [Needle](https://needle.tools) web apps — built for 3D web development.**

WebMCP lets a web page hand typed tools to the AI agent in your browser. Instead of scraping the DOM and guessing which button to click, the agent calls the app's own functions: *"bake this model to 6,000 triangles"* is one call with a typed number, not a hunt for a slider.

Needle builds tools for working with 3D on the web — and our apps describe what they can do to the agent in your browser. Nothing to install, no server to run, no API key. If your browser's agent supports WebMCP, the tools are simply there when you open the page.

This repository is the hub: which Needle apps expose which tools, in one place — human-readable (below), machine-readable ([`registry.json`](registry.json)), and as a website that itself registers WebMCP tools (built with [Vite](https://vite.dev) and [Needle Engine](https://needle.tools), deployed to [Needle Cloud](https://cloud.needle.tools)).

## The apps

| App | Where | What an agent can do there |
| --- | --- | --- |
| **[Needle Documentation](https://engine.needle.tools/docs)** | every docs page | Search the entire Needle knowledge base — documentation, API reference, forum posts, Discord threads and source code — via embedding-ranked semantic search. |
| **[Needle Mesh Baker](https://mesh-baker.needle.tools)** | mesh-baker.needle.tools | Load a 3D model (URL, inline, or from Needle Cloud), bake it to a triangle budget, compress it, compare before/after screenshots, download or publish the result. On capable machines: generate 3D models from a text prompt or an image. |
| **[Needle FastCut](https://fastcut.needle.tools)** | fastcut.needle.tools | Remove image backgrounds in the browser, split sprite sheets, assemble grids/atlases, and export — a natural companion to the Mesh Baker's image-to-3D generation. |
| **[Needle Inspector](https://chromewebstore.google.com/detail/jonplpbnhmanoekkgcepnedhghflblmo)** | Chrome extension, works on any three.js / Needle Engine page | Inspect and edit the live 3D scene on the page: scene graph, materials, performance. *"What is making this scene slow?"*, *"list every material using a transparent shader"*. Tools are registered dynamically from the Inspector's command set. |
| **[Needle Cloud](https://cloud.needle.tools)** | cloud.needle.tools | Search and inspect your hosted 3D assets. More tools in development. |

The agent always discovers the current tool set from the page itself, so the reliable move is: open a Needle app and ask your agent what it can do here.

The full tool lists — names, descriptions, status — live in [`registry.json`](registry.json).

## Why tools instead of clicks

An agent automating a website normally works from the outside: read the DOM, find something that looks like a button, click it, hope it did what it looked like it would do. On real 3D workflows — drag a triangle-budget slider, judge a bake result, walk a scene graph — that guesswork fails often.

When the page publishes its own tools, the agent gets **intent instead of pixels**. It keeps working when the UI is redesigned, and it runs inside your tab where you are already signed in, so your data never detours through a third-party service. The Mesh Baker's whole pipeline — including model generation — runs locally in your browser; the agent drives the same in-page machinery a person does.

Apps can also chain: the Mesh Baker's image-to-3D tool points agents at FastCut for background removal — an agent that can open a second tab cuts the photo out there and brings the transparent PNG back.

## Trying it

Two pieces have to line up: a browser that implements WebMCP, and an agent that calls the tools it finds.

| Browser | Status |
| --- | --- |
| ChatGPT Atlas | Native, no flag |
| Microsoft Edge 147+ | Native |
| Chrome 149+ | Origin trial — Needle apps ship a trial token, so it just works. For your own pages, enable `chrome://flags/#enable-webmcp-testing` or get an [origin trial token](https://developer.chrome.com/origintrials). |
| Firefox, Safari | Not yet implemented |

[Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp) tracks the current state of the API and which agents can call page tools.

## The knowledge base, without a browser

The search tool on the docs pages is backed by a public HTTP API — the same embedded knowledge base behind the [Needle MCP Server](https://engine.needle.tools/docs/ai/needle-mcp-server). If you are building an agent that is *not* in a browser, use it directly:

- `GET https://search.needle.tools/api/semantic-search?q=...` — embedding-ranked excerpts with source URLs
- `POST https://search.needle.tools/api/ask` — an answer instead of a result list
- Full endpoint docs: <https://search.needle.tools/api-docs>

Public and unauthenticated, rate-limited per IP.

## Exposing tools from your own page

WebMCP is a plain browser API — no framework required. [`examples/register-tool.js`](examples/register-tool.js) is a complete, dependency-free example: it registers a tool that searches the Needle knowledge base, handling both API generations (`document.modelContext.registerTool()` and the older `provideContext()`).

The short version:

```js
await document.modelContext.registerTool({
  name: 'search-needle-knowledge-base',
  description: 'Search Needle docs, API reference, forum and Discord.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  annotations: { readOnlyHint: true },
  async execute({ query }) {
    const res = await fetch(`https://search.needle.tools/api/semantic-search?q=${encodeURIComponent(query)}`)
    const data = await res.json()
    return { content: [{ type: 'text', text: JSON.stringify(data.results) }] }
  },
})
```

The spec is a moving draft — the entry point moved from `navigator` to `document`, bulk registration was removed, and unregistering is now done by aborting an `AbortSignal` passed at registration. The example shows how to stay compatible across origin-trial builds.

## Related

- [WebMCP specification](https://github.com/webmachinelearning/webmcp) (W3C Web Machine Learning CG)
- [Chrome WebMCP guide](https://developer.chrome.com/docs/ai/webmcp)
- [Needle WebMCP docs](https://engine.needle.tools/docs/ai/webmcp) — the user-facing overview
- [Needle MCP Server](https://engine.needle.tools/docs/ai/needle-mcp-server) — for agents living in your editor instead of your browser

## What this page itself can do

The registry website is a WebMCP app in its own right. It registers:

- **`list_needle_webmcp_apps`** — the registry, machine-readable.
- **`find_tool_for_task`** — route a task ("remove this photo's background") to the right app and tool, with the URL to open.
- **`get_workflow`** — cross-app recipes: WebMCP tools are per-page, but an agent with more than one tab can chain them. `registry.json` ships pipelines like *photo → FastCut cut-out → Mesh Baker image-to-3D → bake → publish to Needle Cloud*, each step naming the app URL and the tools to call there.
- **`search_needle_knowledge_base`** — semantic search over all Needle content.
- **`hero_*`** — the 3D scene at the top of the page is agent-controllable: add shapes, recolor, rearrange into a ring/line/grid/scatter, change the animation speed. Ask your agent to redecorate.

## Development

The website is a [SvelteKit](https://svelte.dev/docs/kit) project on Vite 8, using the latest [Needle Engine](https://engine.needle.tools/docs) (which brings three.js) for the 3D hero scene, and Needle's brand system from [branding.needle.tools](https://branding.needle.tools). The page renders the registry from `registry.json` (also served as [`/registry.json`](https://github.com/needle-tools/webmcp/blob/main/src/routes/registry.json/%2Bserver.ts)) and registers its own WebMCP tools (`src/lib/webmcp.ts`).

```bash
npm install
npm run dev      # dev server on http://localhost:6277
npm run build    # production build into ./dist
```

Pushes to `main` deploy automatically to Needle Cloud via [`deploy-to-needle-cloud-action`](https://github.com/needle-tools/deploy-to-needle-cloud-action) — see [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The deploy token lives in the repository's GitHub secrets (`NEEDLE_CLOUD_TOKEN`), never in the repo.

Chrome ships WebMCP behind an origin trial. To make this page's tools available in plain Chrome (no flag), [register the deployed origin for the WebMCP trial](https://developer.chrome.com/origintrials) and put the token in the repository **variable** `WEBMCP_ORIGIN_TRIAL_TOKEN` — the build bakes it into a `<meta http-equiv="origin-trial">` tag. Without it, the tools still work in ChatGPT's browser and Edge, and in Chrome with `chrome://flags/#enable-webmcp-testing`.

## Contributing

Found a Needle app whose tools are missing or out of date here? Open an issue or PR against [`registry.json`](registry.json) — it is the source of truth, the README table summarizes it.

## License

[MIT](LICENSE)
