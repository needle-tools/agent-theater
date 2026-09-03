# Needle × WebMCP

**Ask the AI agent in your browser to put on a play — and see which [Needle](https://needle.tools) apps it can drive next.**

![A witch, a king, a lion, a vampire, an owl, a fairy, a crocodile and a knight, cut from paper](docs/cast.webp)

This repository is two things that turned out to be one thing.

It is the **registry** of [WebMCP](https://github.com/webmachinelearning/webmcp) tools across Needle's web apps — which app can do what, in one place. And it is a **paper theatre** that proves the point: open the page, tell your agent *"put on a play about a wolf who is afraid of the dark"*, and watch it cast the parts, dress the stage, write the script and run the show. No install, no API key, no server. The tools are simply there when you open the page.

## What WebMCP changes

An agent automating a website normally works from the outside: read the DOM, find something that looks like a button, click it, hope it did what it looked like it would do.

WebMCP lets the page hand the agent its own typed functions instead. *"Bake this model to 6,000 triangles"* becomes one call with a number in it, not a hunt for a slider. The agent gets **intent instead of pixels** — so it keeps working when the UI is redesigned, and it runs inside your tab where you are already signed in. Your data never detours through a third-party service.

## The theatre

![An oak, a barrel cactus, a campfire, a lighthouse, a teapot, a street lamp, a slice of watermelon and the moon, cut from paper](docs/props.webp)

The front page is a stage. Everything on it is a paper cut-out, and everything an agent needs to make a show is already in the room:

- **594 pieces of art** across 21 packs — a cast of animals, fairy-tale characters, heroes and villains, and the scenery to put them in: forests, deserts, oceans, streets, kitchens, the night sky.
- **A voice for every character.** An actor speaks in the voice its drawing suggests; anything else gets a stable voice dealt from its own name. Nobody who was written a line goes unheard.
- **130 sounds** — beds that cross-fade between scenes, stings that land on a beat, and the seams a show is built from: curtain up, drumroll, curtain down.
- **Paper that behaves like paper.** Every piece is drawn by a CSS paint worklet, so edges wander and the ink boils slightly, the way a hand-cut shape does.

An agent writes a play the way a director blocks one: `stage_create` makes a scene, `stage_cast` decides who is in it and where they stand, `stage_script` writes the beats — *walk here, look surprised, say this* — and `show_play` runs it while the agent narrates aloud.

**Try it:** open [webmcp.needle.tools](https://webmcp.needle.tools) and ask your agent *"what can you do on this page?"*

## The apps

| App | Where | What an agent can do there |
| --- | --- | --- |
| **[Needle Theatre](https://webmcp.needle.tools)** | webmcp.needle.tools | Cast a play from the troupe, dress a stage, write a script, run the show, save it and share it. Also: cut a photo out, arrange a collage, export it as a picture or a page. |
| **[Needle Documentation](https://engine.needle.tools/docs)** | every docs page | Search the entire Needle knowledge base — documentation, API reference, forum posts, Discord threads and source — via embedding-ranked semantic search. |
| **[Needle Mesh Baker](https://mesh-baker.needle.tools)** | mesh-baker.needle.tools | Load a 3D model, bake it to a triangle budget, compress it, compare before/after screenshots, download or publish. On capable machines: generate 3D models from a text prompt or an image. |
| **[Needle FastCut](https://fastcut.needle.tools)** | fastcut.needle.tools | Remove image backgrounds in the browser, split sprite sheets, assemble grids and atlases, export. |
| **[Needle Inspector](https://chromewebstore.google.com/detail/jonplpbnhmanoekkgcepnedhghflblmo)** | Chrome extension, any three.js or Needle Engine page | Inspect and edit the live 3D scene: scene graph, materials, performance. *"What is making this scene slow?"* Tools are registered dynamically from the Inspector's command set. |
| **[Needle Cloud](https://cloud.needle.tools)** | cloud.needle.tools | Search and inspect your hosted 3D assets. More tools in development. |

Apps chain, too. The Mesh Baker's image-to-3D tool points agents at FastCut for background removal — an agent with a second tab cuts the photo out there and brings the transparent PNG back.

The agent always discovers the current tool set from the page itself, so the reliable move is: open a Needle app and ask what it can do. The full lists — names, descriptions, status — live in [`registry.json`](registry.json).

## Trying it

Two pieces have to line up: a browser that implements WebMCP, and an agent that calls the tools it finds.

| Browser | Status |
| --- | --- |
| ChatGPT Atlas | Native, no flag |
| Microsoft Edge 147+ | Native |
| Chrome 149+ | Origin trial — Needle apps ship a token, so it just works. For your own pages, enable `chrome://flags/#enable-webmcp-testing` or get an [origin trial token](https://developer.chrome.com/origintrials). |
| Firefox, Safari | Not yet implemented |

[Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp) tracks the state of the API and which agents can call page tools.

## The knowledge base, without a browser

The search tool on the docs pages is backed by a public HTTP API — the same knowledge base behind the [Needle MCP Server](https://engine.needle.tools/docs/ai/needle-mcp-server). Building an agent that is *not* in a browser? Use it directly:

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

## What this page registers

Four registry tools, and the theatre's own set:

- **`list_needle_webmcp_apps`** — the registry, machine-readable.
- **`find_tool_for_task`** — route a task (*"remove this photo's background"*) to the right app and tool, with the URL to open.
- **`get_workflow`** — cross-app recipes. WebMCP tools are per-page, but an agent with more than one tab can chain them: *photo → FastCut cut-out → Mesh Baker image-to-3D → bake → publish to Needle Cloud*.
- **`search_needle_knowledge_base`** — semantic search over all Needle content.
- **`theater_*`, `stage_*`, `show_*`, `piece_*`** — the theatre: start a show, cast it, script it, play it, capture it, publish it. `theater_start` is the one to call first; it explains the rest.

## Development

A [SvelteKit](https://svelte.dev/docs/kit) project on Vite, using Needle's brand system from [branding.needle.tools](https://branding.needle.tools). The page renders the registry from `registry.json` (also served as [`/registry.json`](src/routes/registry.json/+server.ts)) and registers its own WebMCP tools (`src/lib/webmcp.ts`).

```bash
npm install
npm run dev           # dev server on http://localhost:6277
npm run build         # production Node server build into ./build
npm run build:static  # flat, server-less build into ./dist
npm test              # vitest
```

Two generated modules keep content out of the code. `npm run troupe` reads every `static/troupe/*/manifest.json` and writes `src/lib/collage/troupe.ts`; `node tools/sounds.mjs` does the same for `static/audio/manifest.json`. Adding art or music is a folder, a manifest entry and a run of the script — never a code change. `static/troupe/README.md` has the conventions.

### Docker / Coolify

The included [`Dockerfile`](Dockerfile) builds and runs the SvelteKit Node server on port 3000. In Coolify, create a Dockerfile application from this repository, expose port `3000`, and use `/api/health` as its health-check path.

Copy the names from [`.env.example`](.env.example) into Coolify's environment settings. Set `ORIGIN` to the public application URL, use the connection string from the managed PostgreSQL service for `DATABASE_URL`, and keep the Backblaze application key server-side. `PUBLIC_ASSET_BASE_URL` is the public B2 or Cloudflare asset origin. Do not commit a populated `.env` file; all `.env*` files except the example are ignored.

The server creates the `plays` table on first use; the equivalent SQL is kept in [`migrations/001_plays.sql`](migrations/001_plays.sql) for managed migration workflows. `show_save`, `show_publish`, `show_list` and `show_load` provide unlisted saves, public publishing, discovery and loading. Share URLs use `/p/<id>`. Configure the B2 application key with read/write access restricted to the selected bucket and the `plays/assets/` prefix.

### Needle Cloud

Pushes to `main` deploy automatically to Needle Cloud via [`deploy-to-needle-cloud-action`](https://github.com/needle-tools/deploy-to-needle-cloud-action) — see [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The deploy token lives in the repository's GitHub secrets (`NEEDLE_CLOUD_TOKEN`), never in the repo.

Needle Cloud serves files rather than running a server, so that deployment is the **static** build (`npm run build:static`, into `./dist`) and not the Node build Coolify runs. The theatre, the recorder, `/painted` and `/talk` are client-side once loaded and work there unchanged. What is absent by design is everything needing a server: `/api/*` and the `/p/<id>` share page, which already declare `prerender = false`. Saving and publishing a play therefore works on the Coolify deployment and not on the Needle Cloud one.

Chrome ships WebMCP behind an origin trial. The build bakes a `<meta http-equiv="origin-trial">` token into the page — by default Needle's subdomain-matched token for `needle.tools` (expires 2026-11-17), so the tools work in plain Chrome whenever the site is served from a `*.needle.tools` origin. For a different origin, [register it for the WebMCP trial](https://developer.chrome.com/origintrials) and set the repository **variable** `WEBMCP_ORIGIN_TRIAL_TOKEN`. Without a matching token, the tools still work in ChatGPT's browser and Edge, and in Chrome with `chrome://flags/#enable-webmcp-testing`.

## Contributing

Found a Needle app whose tools are missing or out of date here? Open an issue or PR against [`registry.json`](registry.json) — it is the source of truth, and the README table summarizes it.

## License

[MIT](LICENSE). Third-party fonts, vendored code, audio and the Needle brand are listed in [THIRD-PARTY.md](THIRD-PARTY.md), which also names the two things still needing confirmation.
