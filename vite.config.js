import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(async ({ command }) => {
    const { needlePlugins, loadConfig } = await import("@needle-tools/engine/vite");
    const needleConfig = await loadConfig();
    return {
        plugins: [
            needlePlugins(command, needleConfig, {
                noPoster: true,
                // The compression pipeline polls for dist/assets, which never exists
                // in this SvelteKit setup (assets live in dist/_app/immutable and
                // adapter-static writes dist after the client build) — so it times
                // out in CI. There are no glTF assets to compress here anyway, and
                // Needle Cloud compresses on deploy.
                buildPipeline: { enabled: false },
            }),
            sveltekit(),
        ],
        server: {
            // Deliberately not a common dev port (3000/5173 are often blocked or taken).
            port: 6277,
            strictPort: true,
        },
        build: {
            emptyOutDir: true,
        },
    };
});
