# Agent Theater

**Tell an AI agent a story. Watch it stage the play.**

![A witch, a king, a lion, a vampire, an owl, a fairy, a crocodile and a knight, cut from paper](docs/cast.webp)

Open the page and say *"put on a play about a wolf who is afraid of the dark"*. The agent casts the parts from a drawer of paper cut-outs, dresses the stage, writes the script beat by beat, gives every character a voice, and runs the show while narrating it aloud.

You are not watching a chatbot describe a play. The agent is working the actual stage — the same one you can drag pieces around on yourself, at the same time, while it does.

**[Open the theatre →](https://webmcp.needle.tools)** then ask your agent what it can do here.

## Built for agents first

Agent Theater is a [WebMCP](https://github.com/webmachinelearning/webmcp) app. The page hands the agent its own typed tools instead of making it hunt for buttons.

That is the whole difference. An agent automating a website normally works from the outside — read the DOM, find something that looks like a button, click it, hope. Staging a play that way is hopeless: *"walk stage left, look surprised, then speak"* is not a sequence of clicks. Here it is one call with a number in it.

Nothing to install, no API key, no server. The tools are there when the page loads.

**Drive it from:**

| | |
| --- | --- |
| **ChatGPT** — the app and Atlas | Native WebMCP, no flag |
| **Codex** | Connects to the page's tools |
| **Microsoft Edge 147+** | Native |
| **Chrome 149+** | Origin trial — this app ships a token, so it just works |
| Firefox, Safari | Not yet |

## What is in the room

![An oak, a barrel cactus, a campfire, a lighthouse, a teapot, a street lamp, a slice of watermelon and the moon, cut from paper](docs/props.webp)

**615 pieces of art, in 21 packs.** A cast of animals, fairy-tale characters, heroes and villains — and the scenery to put them in: forests, deserts, oceans, streets, kitchens, the night sky. Every piece is a paper cut-out with a name and a description, so an agent picks a mossy boulder on purpose rather than by luck.

**A voice for everyone who speaks.** Voices are synthesised and modulated per character — an actor sounds like its drawing suggests, and anything else gets a stable voice dealt from its own name. Nobody who was written a line goes unheard, and the same character sounds the same way every run.

**168 sounds.** 26 music beds that cross-fade between scenes, 71 stings that land on a beat, 56 effects, and 15 seams — curtain up, drumroll, curtain down.

**Paper that behaves like paper.** Every piece is drawn through a CSS paint worklet, so edges wander and the ink boils slightly, the way a hand-cut shape does. The cursor is cut from paper too.

## How a play gets made

Thirty-four tools, four families. An agent blocks a scene the way a director does:

| | |
| --- | --- |
| `theater_start` | The one to call first. It explains the rest. |
| `stage_create` | A scene, with its own music. |
| `stage_cast` | Who is in it, where they stand, how they arrive. |
| `stage_script` | The beats — *walk here, look surprised, say this, laugh*. |
| `show_play` | Runs it, and returns immediately with the timings so the agent can narrate on the beat. |
| `piece_*` | Add, cut out, arrange, restyle and trace anything on the canvas. |

Shows save, publish and share: `show_save`, `show_publish`, `show_list`, `show_load`. Share URLs are `/p/<id>`.

An agent that cannot draw can still get art: `theater_art_prompt` writes the image-generation prompt in the house style — including the parts a model gets wrong unless told, like the gutters between cells and keeping a character's feet visible so it can walk later.

## The registry

The same page is also the hub for [Needle](https://needle.tools)'s other WebMCP apps — which app can do what, in one place, human-readable and machine-readable in [`registry.json`](registry.json).

| App | What an agent can do there |
| --- | --- |
| **[Needle Documentation](https://engine.needle.tools/docs)** | Search the whole Needle knowledge base — docs, API reference, forum, Discord, source — by semantic search. |
| **[Needle Mesh Baker](https://mesh-baker.needle.tools)** | Load a 3D model, bake it to a triangle budget, compress, compare before/after, publish. On capable machines: generate 3D models from a prompt or an image. |
| **[Needle FastCut](https://fastcut.needle.tools)** | Remove image backgrounds in the browser, split sprite sheets, assemble atlases, export. |
| **[Needle Inspector](https://chromewebstore.google.com/detail/jonplpbnhmanoekkgcepnedhghflblmo)** | Inspect and edit a live three.js or Needle Engine scene: scene graph, materials, performance. |
| **[Needle Cloud](https://cloud.needle.tools)** | Search and inspect hosted 3D assets. |

Apps chain. An agent with two tabs cuts a photo out in FastCut, brings the transparent PNG back, and puts it on the stage. `get_workflow` ships those recipes; `find_tool_for_task` routes a job to the right app.

## The knowledge base, without a browser

The docs search is backed by a public HTTP API — the same knowledge base behind the [Needle MCP Server](https://engine.needle.tools/docs/ai/needle-mcp-server). For agents that are not in a browser:

- `GET https://search.needle.tools/api/semantic-search?q=...` — ranked excerpts with source URLs
- `POST https://search.needle.tools/api/ask` — an answer instead of a list
- Docs: <https://search.needle.tools/api-docs>

Public, unauthenticated, rate-limited per IP.

## Exposing tools from your own page

WebMCP is a plain browser API — no framework needed. [`examples/register-tool.js`](examples/register-tool.js) is a complete, dependency-free example handling both API generations (`document.modelContext.registerTool()` and the older `provideContext()`).

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

The spec is a moving draft — the entry point moved from `navigator` to `document`, bulk registration was removed, and unregistering now aborts an `AbortSignal` passed at registration. The example stays compatible across origin-trial builds.

## Development

A [SvelteKit](https://svelte.dev/docs/kit) project on Vite, using Needle's brand system from [branding.needle.tools](https://branding.needle.tools).

```bash
npm install
npm run dev           # dev server on http://localhost:6277
npm run build         # production Node server build into ./build
npm run build:static  # flat, server-less build into ./dist
npm test              # vitest
```

Content stays out of the code. `npm run troupe` reads every `static/troupe/*/manifest.json` and writes `src/lib/collage/troupe.ts`; `node tools/sounds.mjs` does the same for `static/audio/manifest.json`; `node tools/cursors.mjs` cuts the paper cursors. Adding art, music or a cursor is a folder, a manifest entry and a run of the script — never a code change. `static/troupe/README.md` has the conventions.

### Docker / Coolify

[`Dockerfile`](Dockerfile) builds and runs the SvelteKit Node server on port 3000. In Coolify, create a Dockerfile application from this repository, expose port `3000`, and use `/api/health` as the health-check path.

Copy the names from [`.env.example`](.env.example) into Coolify's environment settings. Set `ORIGIN` to the public application URL, use the managed PostgreSQL connection string for `DATABASE_URL`, and keep the Backblaze application key server-side. `PUBLIC_ASSET_BASE_URL` is the public B2 or Cloudflare asset origin. Do not commit a populated `.env`; all `.env*` files except the example are ignored.

The server creates the `plays` table on first use; the equivalent SQL is in [`migrations/001_plays.sql`](migrations/001_plays.sql). Configure the B2 key with read/write access restricted to the chosen bucket and the `plays/assets/` prefix.

### Needle Cloud

Pushes to `main` deploy automatically via [`deploy-to-needle-cloud-action`](https://github.com/needle-tools/deploy-to-needle-cloud-action) — see [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The token lives in GitHub secrets (`NEEDLE_CLOUD_TOKEN`), never in the repo.

Needle Cloud serves files rather than running a server, so that deployment is the **static** build (`npm run build:static`, into `./dist`). The theatre, the recorder, `/painted` and `/talk` are client-side once loaded and work there unchanged. Absent by design: `/api/*` and the `/p/<id>` share page, which declare `prerender = false`. Saving and publishing therefore work on the Coolify deployment and not on the Needle Cloud one.

Chrome ships WebMCP behind an origin trial. The build bakes a `<meta http-equiv="origin-trial">` token into the page — by default Needle's subdomain-matched token for `needle.tools` (expires 2026-11-17), so the tools work in plain Chrome from any `*.needle.tools` origin. For another origin, [register it for the trial](https://developer.chrome.com/origintrials) and set the repository **variable** `WEBMCP_ORIGIN_TRIAL_TOKEN`. Without a matching token the tools still work in ChatGPT's browser and Edge, and in Chrome with `chrome://flags/#enable-webmcp-testing`.

## Contributing

A Needle app whose tools are missing or out of date here? Open an issue or PR against [`registry.json`](registry.json) — it is the source of truth, and the table above summarizes it.

## License

[MIT](LICENSE). Third-party fonts, vendored code, audio and the Needle brand are listed in [THIRD-PARTY.md](THIRD-PARTY.md), which also names the two things still needing confirmation.
