import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(async () => {
    return {
        plugins: [
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
        // Server-only clients stay as Node dependencies rather than being
        // bundled for the browser.
        ssr: {
            external: ["@aws-sdk/client-s3", "postgres"],
        },
    };
});
