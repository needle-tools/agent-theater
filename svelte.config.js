import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),
    kit: {
        // Fully static output — Needle Cloud serves the dist folder as-is.
        adapter: adapter({
            pages: 'dist',
            assets: 'dist',
            fallback: null,
            strict: true,
        }),
    },
};

export default config;
