import { defineConfig } from "vitest/config";

// Deliberately standalone: the app's vite.config.js loads the SvelteKit and
// Needle build plugins, none of which a node-side unit test should pull in.
export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
});
