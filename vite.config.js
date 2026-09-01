import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(async ({ command }) => {
    const { needlePlugins, loadConfig } = await import("@needle-tools/engine/vite");
    const needleConfig = await loadConfig();
    return {
        plugins: [
            needlePlugins(command, needleConfig, {
                noPoster: true,
                // dist/assets never exists in this SvelteKit setup (assets live in
                // dist/_app/immutable), so the pipeline waits and then skips with
                // "nothing to compress" (engine fix in 6.0.0-canary...c23278827).
                // Short wait keeps that no-op cheap in CI.
                buildPipeline: { maxWaitDuration: 5000 },
            }),
            sveltekit(),
        ],
        server: {
            // Deliberately not a common dev port (3000/5173 are often blocked or taken).
            port: 6277,
            strictPort: true,
            // Off by default: a reload mid-collage throws away a canvas that
            // took real work to arrange. `HMR=1 npm run dev` puts it back.
            hmr: process.env.HMR === "1",
        },
        build: {
            emptyOutDir: true,
        },
    };
});
