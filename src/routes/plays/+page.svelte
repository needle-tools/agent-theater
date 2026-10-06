<script lang="ts">
    import type { PageData } from "./$types";
    import { languageName } from "$lib/collage/language";

    let { data }: { data: PageData } = $props();

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
</svelte:head>

<div class="programme">
    <header class="masthead">
        <div class="topline">
            <a class="home" href="/" aria-label="Back to Agent Theater">← <span>Agent Theater</span></a>
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
    <footer><a href="/">Make a play on the stage <span aria-hidden="true">→</span></a></footer>
</div>

<style>
    .programme {
        min-height: 100dvh;
        padding: clamp(24px, 4vw, 68px);
        color: #252a31;
        background: radial-gradient(#dcd5c7 0.8px, transparent 0.8px) 0 0 / 23px 23px, #f6f0e5;
    }
    .masthead, .filters, .play-grid, .pagination, footer, .empty { max-width: 1400px; margin-inline: auto; }
    .topline { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 22px; border-bottom: 1px solid #cfc3ac; }
    .home { color: #213b58; text-decoration: none; font-weight: 750; font-size: 0.95rem; }
    .home span { margin-left: 8px; }
    .home:hover, footer a:hover { text-decoration: underline; text-underline-offset: 4px; }
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
    footer { padding: 48px 0 20px; text-align: center; border-top: 1px solid #cfc3ac; }
    footer a { color: #213b58; font-family: Georgia, serif; font-size: 1.15rem; text-decoration: none; }
    footer span { margin-left: 8px; }
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
    }
    @media (prefers-reduced-motion: reduce) { .play-card { animation: none; } .artwork img, .play-arrow { transition: none; } }
</style>
