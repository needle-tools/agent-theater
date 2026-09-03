import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const prerender = false;

export const load: PageServerLoad = ({ params }) => {
    redirect(307, `/?play=${encodeURIComponent(params.id)}`);
}
