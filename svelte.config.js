import node from '@sveltejs/adapter-node';
import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Two targets, one codebase.
 *
 * Coolify runs the theatre as a Node service, because health checks, the
 * PostgreSQL play store and the Backblaze asset proxy all need a server.
 * Needle Cloud serves files and nothing else — its deploy action wants a
 * directory with an `index.html` in it — so the public demo is the same site
 * built flat.
 *
 * Everything under `/api` and the `/p/[id]` share page already declares
 * `prerender = false`, so the static build simply omits them: the theatre,
 * the recorder, /painted and /talk are all client-side once loaded. Sharing a
 * play is the one thing that only works on the Node deployment.
 *
 * `--static` picks the flat build (or `STATIC_BUILD=1`, for a caller that
 * cannot pass an argument). Without it you get the server, which is what
 * `npm run build`, the Dockerfile and local previews all want. A flag rather
 * than only an env var because `FOO=1 cmd` is not a thing in PowerShell, and
 * this has to run on the maintainer's machine as well as on a Linux runner.
 */
const flat = process.argv.includes('--static') || process.env.STATIC_BUILD === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),
    kit: {
        adapter: flat
            ? staticAdapter({
                pages: 'dist',
                assets: 'dist',
                fallback: null,
                // Not strict: the server routes are deliberately absent here,
                // and strict mode treats a route it cannot prerender as a
                // build failure rather than as a choice.
                strict: false,
            })
            : node(),
    },
};

export default config;
