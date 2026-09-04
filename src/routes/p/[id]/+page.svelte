<script lang="ts">
    /**
     * What a person sees here: nothing, for about a frame.
     *
     * The page exists so a crawler has a <head> to read (see `+page.server.ts`);
     * a browser is sent straight on to the workshop with the play named in the
     * query, which is where the app already knows how to open one.
     *
     * `replaceState` so the share link does not sit in the history as a step to
     * go back to — it is a doorway, not a page. And there is a real link in the
     * markup, so this is not a dead end for anyone whose browser never runs the
     * redirect.
     */
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";

    let { data } = $props();
    const target = $derived(`/?play=${encodeURIComponent(data.id)}`);

    onMount(() => { void goto(target, { replaceState: true }); });
</script>

<div class="opening">
    <p>Opening the play…</p>
    <a href={target}>Continue to the theatre</a>
</div>

<style>
    .opening {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.6rem;
        min-height: 100dvh;
        background: var(--surface-page);
        color: var(--text-primary);
        font-family: var(--font-family-body, system-ui);
        text-align: center;
    }

    p {
        margin: 0;
        opacity: 0.7;
    }
</style>
