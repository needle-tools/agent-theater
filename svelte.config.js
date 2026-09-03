import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),
    kit: {
        // A Node server is required for health checks and the upcoming
        // PostgreSQL/Backblaze publishing API. Static routes are still prerendered.
        adapter: adapter(),
    },
};

export default config;
