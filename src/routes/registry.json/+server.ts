import { json } from "@sveltejs/kit";
import registry from "../../../registry.json";

// Prerendered to a static /registry.json in the build output, so the site
// serves the same file that lives at the repository root — one source of truth.
export const prerender = true;

export function GET() {
    return json(registry);
}
