import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(async ({ command }) => {
    const { needlePlugins, loadConfig } = await import("@needle-tools/engine/vite");
    const needleConfig = await loadConfig();
    return {
        plugins: [
            needlePlugins(command, needleConfig, { noPoster: true }),
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
