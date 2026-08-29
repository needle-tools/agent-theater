<script lang="ts">
    import { onMount } from "svelte";

    onMount(async () => {
        // No physics in the hero scene — skip the Rapier download entirely.
        (window as any).NEEDLE_USE_RAPIER = false;
        // Importing the scene pulls in @needle-tools/engine and registers the
        // onStart hook before the <needle-engine> element below initializes.
        await import("./scene");
    });
</script>

<!-- https://engine.needle.tools/docs/reference/needle-engine-attributes -->
<needle-engine background-color="#EFF5EC"
    environment-image="https://cdn.needle.tools/static/hdris/photo_studio_01_4k.pmrem.ktx2"
    loading-style="light"></needle-engine>

<style>
    needle-engine {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
    }
</style>
