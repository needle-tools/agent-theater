<script lang="ts">
    import { onMount } from "svelte";
    import type { PageData } from "./$types";
    import { languageName } from "$lib/collage/language";
    import { loadPainterly, PAINTERLY_CSS } from "$lib/collage/painted";
    import { briefing } from "$lib/collage/invitation";
    import { copyText } from "$lib/collage/clipboard";

    let { data }: { data: PageData } = $props();
    let promptCopyState = $state<"idle" | "copied" | "failed">("idle");

    onMount(() => { void loadPainterly(); });

    async function copyPrompt() {
        promptCopyState = await copyText(briefing(location.origin)) ? "copied" : "failed";
        setTimeout(() => (promptCopyState = "idle"), 2200);
    }

    const pageLink = (page: number) => {
        const query = new URLSearchParams();
        if (data.language) query.set("language", data.language);
        if (page > 1) query.set("page", String(page));
        return `/plays${query.size ? `?${query}` : ""}`;
    };
    const duration = (seconds: number | null) => {
        if (!seconds || seconds < 1) return "A short play";
        if (seconds < 60) return `${seconds} sec`;
        return `${Math.ceil(seconds / 60)} min`;
    };
</script>

<svelte:head>
    <title>{data.card.title}</title>
    <meta name="description" content="Browse every published Agent Theater story. Pick a paper play and watch its stage come to life." />
    <link rel="canonical" href={data.card.url} />
    <link rel="stylesheet" href={PAINTERLY_CSS} />
</svelte:head>

<div class="programme">
    <header class="masthead">
        <div class="topline">
            <a class="home" href="/" aria-label="Back to Agent Theater">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 12H5m7 7-7-7 7-7" />
                </svg>
                <span>Agent Theater</span>
            </a>
            <span class="edition">THE COMMUNITY PROGRAMME</span>
        </div>
        <div class="heading">
            <div>
                <p class="eyebrow">Made on the open paper stage</p>
                <h1>Stories to watch<span class="period">.</span></h1>
                <p class="introduction">A growing shelf of plays staged by people and their AI collaborators. Choose one, then step into its theatre.</p>
            </div>
            <div class="count" aria-label={`${data.total} published plays`}>
                <strong>{data.total}</strong>
                <span>{data.total === 1 ? "published play" : "published plays"}</span>
            </div>
        </div>
    </header>

    <nav class="filters" aria-label="Filter plays by language">
        <span class="filter-label">In the language of the story</span>
        <div class="filter-options">
            <a href="/plays" aria-current={!data.language ? "page" : undefined}>All languages</a>
            {#each data.languages as code}
                <a href={`/plays?language=${encodeURIComponent(code)}`}
                    aria-current={data.language === code ? "page" : undefined}>{languageName(code)}</a>
            {/each}
        </div>
    </nav>

    {#if data.unavailable}
        <div class="empty" role="status">
            <p class="empty-mark">✳</p>
            <h2>The programme is resting.</h2>
            <p>The published play shelf is unavailable right now. Please come back soon.</p>
        </div>
    {:else if !data.plays.length}
        <div class="empty">
            <p class="empty-mark">✳</p>
            <h2>No plays on this page yet.</h2>
            <p>{data.language ? `There are no published stories marked ${languageName(data.language)} yet.` : "The first story has not been published yet."}</p>
            <a href="/plays">See all languages →</a>
        </div>
    {:else}
        <section class="play-grid" aria-label="Published plays">
            {#each data.plays as play, index}
                <a class="play-card" href={play.url} style={`--order:${Math.min(index, 8)}`}>
                    <div class="artwork">
                        <img src={play.image} alt={`Poster for ${play.title}`} loading={index < 3 ? "eager" : "lazy"} />
                        <span class="play-arrow" aria-hidden="true">↗</span>
                    </div>
                    <div class="play-info">
                        <p class="play-meta">
                            <span>{languageName(play.language)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{play.chapters} {play.chapters === 1 ? "chapter" : "chapters"}</span>
                            <span aria-hidden="true">·</span>
                            <span>{duration(play.seconds)}</span>
                        </p>
                        <h2>{play.title}</h2>
                        {#if play.byline}<p class="byline">{play.byline}</p>{/if}
                    </div>
                </a>
            {/each}
        </section>
    {/if}

    {#if data.pages > 1}
        <nav class="pagination" aria-label="Play pages">
            {#if data.page > 1}<a href={pageLink(data.page - 1)}>← Newer plays</a>{:else}<span></span>{/if}
            <span>Page {data.page} of {data.pages}</span>
            {#if data.page < data.pages}<a href={pageLink(data.page + 1)}>Older plays →</a>{:else}<span></span>{/if}
        </nav>
    {/if}
    <section class="make-play" aria-labelledby="make-play-title">
        <div class="make-copy">
            <p class="eyebrow">How to</p>
            <h2 id="make-play-title">Make a play on the stage.</h2>
            <p>Start with a few paper characters or let ChatGPT pick from the theatre’s art. You choose the story; your AI director builds the scenes and plays them with you.</p>
        </div>
        <ol class="how-steps">
            <li><strong>Arrange the pieces</strong><span>Drag stickers onto the stage, or begin with what is already there.</span></li>
            <li><strong>Give ChatGPT the prompt</strong><span>Paste it into ChatGPT so it can open the theatre and pitch a story.</span></li>
            <li><strong>Watch and direct</strong><span>Choose a story, then steer the scenes as your AI director performs them.</span></li>
        </ol>
        <div class="make-actions">
            <button class="make-button make-button--secondary painted grained" type="button" onclick={copyPrompt}>
                <span>{promptCopyState === "copied" ? "Copied!" : promptCopyState === "failed" ? "Try again" : "Copy prompt"}</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="8" y="8" width="11" height="11" rx="2" />
                    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                </svg>
            </button>
            <a class="make-button make-button--primary painted grained" href="/">
                <span>Make your own</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12h14m-7-7 7 7-7 7" />
                </svg>
            </a>
        </div>
        <span class="copy-status" role="status" aria-live="polite">{promptCopyState === "copied" ? "Prompt copied. Paste it into ChatGPT to start." : promptCopyState === "failed" ? "Could not copy the prompt. Please try again." : ""}</span>
    </section>
</div>

<style>
    .programme {
        min-height: 100dvh;
        padding: clamp(24px, 4vw, 68px);
        color: #252a31;
        background: radial-gradient(#dcd5c7 0.8px, transparent 0.8px) 0 0 / 23px 23px, #f6f0e5;
    }
    .masthead, .filters, .play-grid, .pagination, .make-play, .empty { max-width: 1400px; margin-inline: auto; }
    .topline { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 22px; border-bottom: 1px solid #cfc3ac; }
    .home { display: inline-flex; align-items: center; gap: 8px; color: #213b58; text-decoration: none; font-weight: 750; font-size: 0.95rem; }
    .home svg { width: 20px; height: 20px; flex: none; }
    .home:hover { text-decoration: underline; text-underline-offset: 4px; }
    .edition, .eyebrow, .filter-label { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.17em; text-transform: uppercase; }
    .edition { color: #aa5736; }
    .heading { display: flex; justify-content: space-between; align-items: end; gap: 30px; padding: clamp(50px, 8vw, 108px) 0 clamp(40px, 5vw, 68px); }
    .eyebrow { margin: 0 0 16px; color: #9c5033; }
    h1 { margin: 0; font-family: Georgia, 'Iowan Old Style', serif; font-size: clamp(3.4rem, 8vw, 7.8rem); line-height: 0.95; letter-spacing: -0.075em; font-weight: 700; }
    .period { color: #c74837; }
    .introduction { max-width: 550px; margin: 22px 0 0; font-size: clamp(1rem, 1.7vw, 1.2rem); line-height: 1.55; color: #635f57; }
    .count { flex: none; display: grid; text-align: right; padding-bottom: 8px; color: #9d5633; }
    .count strong { font-family: Georgia, serif; font-size: clamp(3rem, 5vw, 5rem); line-height: 0.9; }
    .count span { margin-top: 8px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; }
    .filters { display: flex; align-items: baseline; gap: 20px; padding: 18px 0 22px; border-top: 2px solid #302c2a; border-bottom: 1px solid #cfc3ac; }
    .filter-label { flex: none; color: #7b756c; letter-spacing: 0.1em; }
    .filter-options { display: flex; flex-wrap: wrap; gap: 7px; }
    .filter-options a { display: inline-block; padding: 7px 13px; border-radius: 100px; color: #48433e; text-decoration: none; font-size: 0.84rem; transition: background 150ms ease, color 150ms ease; }
    .filter-options a:hover { background: #e9ddca; }
    .filter-options a[aria-current="page"] { background: #213b58; color: #fffaf1; }
    .play-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(18px, 2vw, 32px); padding-block: 34px 56px; }
    .play-card { display: block; min-width: 0; color: inherit; text-decoration: none; animation: arrive 400ms both; animation-delay: calc(var(--order) * 55ms); }
    .artwork { position: relative; overflow: hidden; aspect-ratio: 1672 / 941; display: grid; place-items: center; border: 1px solid #ddd2c0; border-radius: 5px; background: #e9dfce; box-shadow: 0 13px 26px -24px #3a2c21; }
    .artwork img { width: 100%; height: 100%; object-fit: contain; transition: transform 300ms ease; }
    .play-card:hover .artwork img, .play-card:focus-visible .artwork img { transform: scale(1.045); }
    .play-arrow { position: absolute; right: 13px; bottom: 13px; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; color: #fff; background: #213b58; font-size: 1.2rem; transition: transform 180ms ease; }
    .play-card:hover .play-arrow { transform: translate(2px, -2px); }
    .play-info { padding: 17px 3px 0; }
    .play-meta { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 0 10px; color: #a25436; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.67rem; font-weight: 800; }
    .play-info h2 { margin: 0; font-family: Georgia, 'Iowan Old Style', serif; font-size: clamp(1.4rem, 2vw, 1.9rem); line-height: 1.17; letter-spacing: -0.035em; }
    .byline { margin: 8px 0 0; color: #625c53; font-size: 0.9rem; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pagination { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-top: 1px solid #cfc3ac; padding-top: 22px; font-size: 0.86rem; }
    .pagination a { color: #213b58; font-weight: 750; text-decoration: none; }
    .pagination a:hover { text-decoration: underline; }
    .empty { padding: 100px 20px; text-align: center; }
    .empty-mark { margin: 0; color: #b8613d; font-size: 3rem; }
    .empty h2 { margin: 5px 0 8px; font-family: Georgia, serif; font-size: 2rem; }
    .empty p { color: #665f55; }
    .empty a { color: #213b58; }
    .make-play { display: flex; align-items: center; flex-direction: column; padding: 48px 0 28px; border-top: 1px solid #cfc3ac; text-align: center; }
    .make-copy { max-width: 690px; }
    .make-copy .eyebrow { margin-bottom: 9px; }
    .make-copy h2 { margin: 0; font-family: Georgia, 'Iowan Old Style', serif; font-size: clamp(1.7rem, 3vw, 2.45rem); line-height: 1.12; letter-spacing: -0.035em; }
    .make-copy > p:last-child { margin: 14px 0 0; color: #635f57; line-height: 1.55; }
    .how-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; width: min(100%, 880px); margin: 32px 0 48px; padding: 0; list-style: none; counter-reset: step; text-align: left; }
    .how-steps li { position: relative; display: grid; align-content: start; gap: 7px; padding-left: 40px; counter-increment: step; }
    .how-steps li::before { content: counter(step); position: absolute; top: -2px; left: 0; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #e8c881; color: #213b58; font-size: 0.82rem; font-weight: 900; }
    .how-steps strong { color: #213b58; font-size: 0.94rem; }
    .how-steps span { color: #635f57; font-size: 0.88rem; line-height: 1.45; }
    .make-actions { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 16px; width: 100%; }
    .make-button {
        --grain-size: 1.2;
        --grain-density: 3.6;
        --grain-contrast: 1.25;
        --grain-amount: 0.95;
        --grain-tile: 72px;
        --grain-hold: 0.72s;
        --paint-shift: 0.45%;
        --paint-turn: 0.4deg;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        height: 58px;
        padding: 0 24px;
        overflow: hidden;
        flex: none;
        border: 1px solid transparent;
        border-radius: 999px;
        appearance: none;
        font: inherit;
        font-weight: 800;
        line-height: 1.15;
        text-decoration: none;
        cursor: pointer;
        animation: paint-boil 1.5s step-end infinite, grain-shift var(--grain-hold) step-end infinite;
        animation-delay: var(--paint-at), var(--grain-at);
        transition: transform 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
    }
    .make-button--primary { --paint-at: -0.37s; --grain-at: -0.19s; --grain-seed: 11; --grain-contrast: 1.7; background: #213b58; color: #fff7e8; box-shadow: 0 4px 0 #10253c, 0 10px 17px -10px #152236; }
    .make-button--secondary { --paint-at: -1.07s; --grain-at: -0.48s; --grain-seed: 31; border-color: #aa9375; background: #e8d9bd; color: #213b58; box-shadow: 0 4px 0 #b8a382, 0 10px 17px -10px #715c42; }
    :global(.painterly) .make-button--primary.grained::after { mix-blend-mode: normal; opacity: 1; }
    .make-button span, .make-button svg { position: relative; z-index: 1; }
    .make-button svg { width: 20px; height: 20px; flex: none; transition: translate 150ms ease; }
    .make-button:hover { transform: translateY(-2px); }
    .make-button--primary:hover { background: #294969; box-shadow: 0 6px 0 #10253c, 0 14px 20px -10px #152236; }
    .make-button--secondary:hover { background: #f0e0c2; box-shadow: 0 6px 0 #b8a382, 0 14px 20px -10px #715c42; }
    .make-button:hover svg { translate: 3px 0; }
    .make-button:active { transform: translateY(3px) scale(0.96); }
    .make-button--primary:active { box-shadow: 0 1px 0 #10253c, 0 4px 7px -5px #152236; }
    .make-button--secondary:active { box-shadow: 0 1px 0 #b8a382, 0 4px 7px -5px #715c42; }
    .make-button:focus-visible { outline: 3px solid #b55b3b; outline-offset: 5px; }
    .copy-status { min-height: 1.4em; margin-top: 15px; color: #635f57; font-size: 0.85rem; }
    @keyframes arrive { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 900px) { .play-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 650px) {
        .programme { padding: 22px 18px; }
        .heading { align-items: start; }
        .count { display: none; }
        .filters { display: block; }
        .filter-options { margin-top: 12px; }
        .play-grid { grid-template-columns: 1fr; gap: 36px; }
        .edition { font-size: 0.56rem; }
        .make-play { padding-top: 34px; }
        .how-steps { grid-template-columns: 1fr; gap: 20px; max-width: 400px; margin: 28px 0 42px; }
    }
    @media (prefers-reduced-motion: reduce) { .play-card, .make-button { animation: none; } .artwork img, .play-arrow, .make-button, .make-button svg { transition: none; } }
</style>
