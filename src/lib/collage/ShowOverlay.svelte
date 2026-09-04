<script lang="ts">
    /**
     * What sits in front of the stage while the show runs.
     *
     * All of it the auditorium rather than the play: the vignette that darkens
     * the corners so the eye falls to the middle, the card that asks to be let
     * in, the title the show opens on, and the credits that roll at the end.
     *
     * None of it is interactive and none of it is timed here — the studio owns
     * the running order, and this draws whatever it says is up. A card that
     * timed itself would drift out of step with the scenes it sits between.
     */
    import type { CollageStudio } from "./studio";
    import {
        CREDIT_END_HOLD_MS, CREDIT_FADE_MS, CREDIT_HOUSE_ROWS, CREDIT_LINE_MS,
        creditsDuration, type Billboard,
    } from "./billboard";
    import { TROUPE } from "./troupe.js";
    import { avatarFrame, getAgentAvatarSheet } from "./agentAvatar.js";

    /** Who directed, as a picture: the agent's own pet, front-facing cell. */
    const avatar = getAgentAvatarSheet();
    const avatarPose = avatarFrame(avatar, 0, 0);

    let { studio }: { studio: CollageStudio } = $props();

    let showing = $state<string | null>(null);
    let billboard = $state<Billboard | null>(null);

    /**
     * `?titlecard` (optionally `?titlecard=Some+Title`) pins a title card up
     * and `?credits` pins a slow sample roll — both for styling work: each is
     * otherwise on screen for seconds at a time, which is no way to look at
     * typography.
     */
    const params = typeof location !== "undefined" ? new URL(location.href).searchParams : null;
    const pinned = params?.get("titlecard") ?? null;
    const pinnedRoll = params?.has("credits") ?? false;

    $effect(() => {
        if (pinned !== null) {
            billboard = {
                kind: "title",
                title: pinned || "The Moon Who Ate Tuesday",
                byline: "a pinned card, via ?titlecard",
                entries: TROUPE.filter(piece => piece.kind === "actor").slice(0, 5)
                    .map(piece => ({ role: null, actor: piece.id, src: piece.file })),
                duration: 0,
            };
            return;
        }
        if (pinnedRoll) {
            const actors = TROUPE.filter(piece => piece.kind === "actor").slice(0, 5);
            billboard = {
                kind: "credits",
                title: "The Moon Who Ate Tuesday",
                entries: actors.map((piece, at) => ({
                    role: ["the moon", "the baker", "the night watch", null, "tuesday itself"][at] ?? null,
                    actor: piece.id.split("/").pop() ?? piece.id,
                    src: piece.file,
                })),
                lines: ["directed by a browser agent", "staged with Marcel"],
                // The REAL formula, so tuning the preview tunes the show.
                duration: creditsDuration(5 + 2 + CREDIT_HOUSE_ROWS),
            };
            return;
        }
        const read = () => {
            showing = studio.showing;
            billboard = studio.billboard;
        };
        read();
        return studio.onShowChanged(read);
    });

    /**
     * Where the roll starts and where it stops, measured rather than guessed.
     *
     * It used to travel a fixed 55% of its own height either side of centre,
     * which meant the stopping point was wherever that happened to leave the
     * bottom of a list whose length nobody knows in advance — a long cast
     * parked the house bow low, a short one left it high, and neither is the
     * place a roll is supposed to end.
     *
     * So the end is the one thing that actually matters: the cactus and the
     * name on the centre line, which is where a film puts the studio. The roll
     * is centred in the frame, so the distance from the middle of the list to
     * the middle of the house bow IS the offset that puts one on the other —
     * no need to know how tall the screen is.
     *
     * Measured as the gap between two rectangles inside the same block rather
     * than off `offsetTop`, and that is not fussiness. `offsetTop` is reported
     * against the nearest offsetParent, and which element that turns out to be
     * depends on the animation this is being measured FOR — it came back a
     * screen and a half out. Two rects in one translated subtree differ by the
     * same amount whatever the translate is, because it is a translate.
     *
     * Both ends are set before the first paint, so the roll starts against the
     * right numbers instead of jumping to them.
     */
    function travel(node: HTMLElement) {
        const measure = () => {
            const inner = node.querySelector<HTMLElement>(".roll__inner");
            if (!inner) return;
            const house = node.querySelector<HTMLElement>(".roll__house");
            const middle = inner.offsetHeight / 2;
            let end = -middle * 1.1;
            if (house) {
                // `offsetTop` where it is reported against the list itself,
                // because that is layout: free of the roll's own travel AND of
                // the fourteen pixels the row's entrance is still holding it
                // down by at the moment this runs. Rects where the offsetParent
                // turns out to be something else, which is a hair out and
                // still lands the bow on the middle.
                const top = house.offsetParent === inner
                    ? house.offsetTop
                    : house.getBoundingClientRect().top - inner.getBoundingClientRect().top;
                end = middle - (top + house.offsetHeight / 2);
            }
            node.style.setProperty("--roll-from", `${Math.round(middle * 1.1)}px`);
            node.style.setProperty("--roll-to", `${Math.round(end)}px`);
        };
        measure();
        // A turned phone changes both ends. Re-measuring only re-resolves the
        // keyframes; it does not restart the roll or move it.
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return { destroy: () => observer.disconnect() };
    }

    /*
     * While any billboard is up the page is an auditorium in the dark: every
     * button — playbill, file tools, the corner cut-outs — goes with the
     * lights. Posted on the root element because most of those live in other
     * components; each hides itself when the class is there.
     */
    $effect(() => {
        document.documentElement.classList.toggle("theatre-card", !!billboard);
        return () => document.documentElement.classList.remove("theatre-card");
    });
</script>

{#if showing || billboard}
    <!-- Pointer-transparent throughout: the canvas underneath stays usable, so
         a person can still grab something mid-show rather than being locked
         out of their own document by a decoration. -->
    <div class="overlay" aria-hidden="true">
        <div class="vignette"></div>

        {#if billboard?.kind === "blackout"}
            <!-- The between-scenes dark: rises, holds while the set is swapped
                 behind it, lifts. The studio holds the billboard for exactly
                 the animation's length, so neither can outlive the other. -->
            <div class="blackout" style:--blackout="{billboard.duration}ms"></div>
        {:else if billboard?.kind === "waiting"}
            <!-- The one card that is asking for something rather than showing
                 something. It says why, because "click to continue" with no
                 reason reads as a nag. -->
            <div class="card">
                {#if billboard.title}
                    <p class="byline">{billboard.title}</p>
                {/if}
                <h2 class="title">Click anywhere to begin</h2>
                <p class="byline">The browser keeps the sound off until you do.</p>
            </div>
        {:else if billboard?.kind === "title"}
            <div class="card">
                <h2 class="title">{billboard.title}</h2>
                {#if billboard.byline}
                    <p class="byline">{billboard.byline}</p>
                {/if}
                {#if billboard.entries?.length}
                    <!-- The company, fanned under the name like a playbill
                         poster — each with its dealt lean, arriving a beat
                         after the words. -->
                    <div class="poster">
                        {#each billboard.entries as entry, index (entry.actor + index)}
                            {#if entry.src}
                                <img
                                    class="poster__piece"
                                    src={entry.src}
                                    alt=""
                                    draggable="false"
                                    style:rotate="{((index * 137) % 17) - 8}deg"
                                    style:animation-delay="{380 + index * 140}ms"
                                />
                            {/if}
                        {/each}
                    </div>
                {/if}
            </div>
        {:else if billboard?.kind === "credits"}
            <!-- The travel stops before the duration does: the roll eases in,
                 holds its last card for a breath, and the curtain fades. -->
            <div
                class="roll"
                use:travel
                style:--travel="{Math.max(1500, billboard.duration - CREDIT_END_HOLD_MS - CREDIT_FADE_MS)}ms"
                style:--fade-at="{Math.max(0, billboard.duration - CREDIT_FADE_MS)}ms"
                style:--fade="{CREDIT_FADE_MS}ms"
            >
                <div class="roll__inner">
                    {#if billboard.title}
                        <h2 class="roll__title">{billboard.title}</h2>
                    {/if}
                    <!-- The cast, with their pictures: rows alternating sides —
                         picture left, name right; then name left, picture
                         right — the rhythm of a storybook's cast page. -->
                    {#each billboard.entries ?? [] as entry, index (entry.actor + index)}
                        <div
                            class="credit-row"
                            class:credit-row--flipped={index % 2 === 1}
                            style:animation-delay="{index * CREDIT_LINE_MS * 0.25}ms"
                        >
                            {#if entry.src}
                                <!-- The lean is dealt from the row number, not Math.random,
                                     so the roll tilts the same way every night. -->
                                <img
                                    class="credit-row__art"
                                    src={entry.src}
                                    alt=""
                                    draggable="false"
                                    style:rotate="{((index * 137) % 17) - 8}deg"
                                />
                            {/if}
                            <p class="credit credit-row__text">
                                {#if entry.role}{entry.role} — played by {entry.actor}{:else}{entry.actor}{/if}
                            </p>
                        </div>
                    {/each}
                    {#if billboard.lines.length}
                        <!-- The direction block: the agent's own pet stands
                             over its credit lines, the director taking a bow
                             in person. -->
                        <div
                            class="roll__maker"
                            style:background-image="url({avatar.src})"
                            style:background-size="{avatar.columns * 100}% {avatar.rows * 100}%"
                            style:background-position="{avatarPose.x} {avatarPose.y}"
                            style:animation-delay="{(billboard.entries?.length ?? 0) * CREDIT_LINE_MS * 0.25}ms"
                        ></div>
                    {/if}
                    {#each billboard.lines as line, index (line + index)}
                        <p
                            class="credit"
                            style:animation-delay="{((billboard.entries?.length ?? 0) + index) * CREDIT_LINE_MS * 0.25}ms"
                        >{line}</p>
                    {/each}
                    <!-- The house bow, on every roll: the Needle cactus and the
                         paper it is all cut from. The one clickable thing in the
                         auditorium, and it goes home. -->
                    <a
                        class="roll__house"
                        href="https://needle.tools"
                        target="_blank"
                        rel="noopener"
                        style:animation-delay="{((billboard.entries?.length ?? 0) + billboard.lines.length) * CREDIT_LINE_MS * 0.25}ms"
                    >
                        <img
                            class="roll__sigil"
                            src="/troupe/desert/flowering-cactus.webp"
                            alt=""
                            draggable="false"
                        />
                        <p class="credit">paper &amp; glue — <span class="roll__brand">Needle</span></p>
                    </a>
                    <p
                        class="credit roll__thanks"
                        style:animation-delay="{((billboard.entries?.length ?? 0) + billboard.lines.length + 1) * CREDIT_LINE_MS * 0.25}ms"
                    >Thank you for playing.</p>
                </div>
            </div>
        {/if}
    </div>
{/if}

<style>
    .overlay {
        position: absolute;
        inset: 0;
        z-index: 24;
        pointer-events: none;
    }

    /*
     * The corners going dark.
     *
     * A radial gradient rather than an inset box-shadow: a shadow is drawn from
     * the edges inward and always looks like a frame around the picture, where
     * a gradient centred on the middle looks like light falling on it. Screen
     * coordinates on purpose — it is the auditorium, so it does not pan with
     * the canvas.
     */
    .vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(
            ellipse 78% 78% at 50% 48%,
            transparent 40%,
            rgba(8, 10, 14, 0.28) 78%,
            rgba(8, 10, 14, 0.62) 100%);
        opacity: 0;
        animation: lights-down 1.2s cubic-bezier(0.2, 0, 0, 1) forwards;
    }

    @keyframes lights-down {
        to { opacity: 1; }
    }

    /*
     * Both cards sit on their own veil, over the vignette, because text over
     * a scene is unreadable however dark the corners are. The veil is the
     * PAPER at four-fifths strength rather than a fixed cinema black: a
     * night-blue play gets a night-blue curtain, a cream afternoon a cream
     * one — and the ink flips light or dark to match, same oklch step the
     * playbill uses.
     */
    .card,
    .roll {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 6vh 8vw;
        --card-ink: oklch(from var(--paper, var(--surface-page))
            clamp(0.12, (0.6 - l) * 999, 0.97) min(c, 0.03) h);
        background: color-mix(in srgb, var(--paper, var(--surface-page)) 82%, transparent);
        color: var(--card-ink);
        text-align: center;
        /* A card is a curtain: while one is up, the canvas behind it is not
           for grabbing. The overlay itself stays pointer-transparent so a
           SCENE plays on a grabbable stage — only the cards block. And a
           curtain is not a document: nothing on it drag-selects. */
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
    }

    .card {
        animation: card-in 0.7s cubic-bezier(0.2, 0, 0, 1);
    }

    .blackout {
        position: absolute;
        inset: 0;
        background: #0b0d11;
        animation: blackout var(--blackout, 900ms) ease-in-out forwards;
    }

    @keyframes blackout {
        0% { opacity: 0; }
        45%, 60% { opacity: 1; }
        100% { opacity: 0; }
    }

    @keyframes card-in {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    .title {
        margin: 0;
        font-family: var(--font-family-display);
        font-size: clamp(2rem, 6.5vw, 5rem);
        font-weight: 600;
        line-height: 1.05;
        letter-spacing: -0.02em;
        text-wrap: balance;
        /* Staggered behind the byline: the name lands, then the subtitle
           follows it, which is the order they would be read in anyway. */
        animation: rise 0.9s cubic-bezier(0.2, 0, 0, 1) both;
    }

    .byline {
        margin: 1.1rem 0 0;
        max-width: 40rem;
        color: color-mix(in srgb, var(--card-ink) 68%, transparent);
        font-size: clamp(0.95rem, 1.8vw, 1.3rem);
        line-height: 1.4;
        text-wrap: pretty;
        animation: rise 0.9s cubic-bezier(0.2, 0, 0, 1) 0.22s both;
    }

    @keyframes rise {
        from { opacity: 0; translate: 0 14px; }
        to { opacity: 1; translate: 0 0; }
    }

    /* The company on the poster: a loose row under the byline, each piece
       with its own lean, walking on one after another. */
    .poster {
        display: flex;
        align-items: flex-end;
        justify-content: center;
        gap: 1.6rem;
        margin-top: 3.2rem;
        max-width: min(52rem, 90vw);
        flex-wrap: wrap;
    }

    .poster__piece {
        height: clamp(84px, 15vh, 150px);
        max-width: 22vw;
        object-fit: contain;
        filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
        animation: rise 0.7s cubic-bezier(0.2, 0, 0, 1) both;
    }

    /*
     * The roll.
     *
     * Actually rolling — translated up over the whole of its time — because a
     * credit list that simply appeared would be a list. The lines also fade in
     * one after another as they climb, so the eye is given somewhere to start.
     */
    .roll__inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.85rem;
        /* Near-linear through the middle, easing off at the end — the roll
           slows into its last card rather than stopping dead. */
        animation: roll var(--travel, 8s) cubic-bezier(0.35, 0.35, 0.25, 1) both;
    }

    /* After the hold, the whole curtain — veil, names, cactus — fades. */
    .roll {
        animation: curtain-fade var(--fade, 900ms) ease-in var(--fade-at, 9999s) both;
    }

    @keyframes curtain-fade {
        to { opacity: 0; }
    }

    @keyframes roll {
        from { translate: 0 var(--roll-from, 55%); }
        to { translate: 0 var(--roll-to, -55%); }
    }

    .roll__title {
        margin: 0 0 1.4rem;
        font-family: var(--font-family-display);
        font-size: clamp(1.3rem, 3vw, 2.2rem);
        font-weight: 600;
        text-wrap: balance;
    }

    .credit {
        margin: 0;
        color: color-mix(in srgb, var(--card-ink) 86%, transparent);
        font-size: clamp(0.95rem, 2vw, 1.35rem);
        line-height: 1.35;
        text-wrap: balance;
        animation: rise 0.6s cubic-bezier(0.2, 0, 0, 1) both;
    }

    /*
     * A cast row: the artwork beside the credit, sides alternating down the
     * roll — picture left, name right, then flipped — so the eye zigzags
     * through the company instead of sliding down a list. Fixed art height,
     * because a roll where the wolf towers over the grandmother reads as a
     * size chart.
     */
    .credit-row {
        display: flex;
        align-items: center;
        gap: 1.4rem;
        min-width: min(38rem, 88vw);
        max-width: min(42rem, 92vw);
        /* Air between rows: the pictures grew and lean, and two tilted
           cut-outs touching reads as a pile, not a programme. */
        margin-block: 0.45rem;
        animation: rise 0.6s cubic-bezier(0.2, 0, 0, 1) both;
    }

    .credit-row--flipped {
        flex-direction: row-reverse;
    }

    .credit-row__art {
        flex: none;
        height: clamp(78px, 13.5vh, 126px);
        max-width: 38%;
        object-fit: contain;
        filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.45));
    }

    /* The text takes the rest of the row and leans toward its picture. */
    .credit-row__text {
        flex: 1;
        text-align: left;
        animation: none;
    }

    .credit-row--flipped .credit-row__text {
        text-align: right;
    }

    /* The director's portrait: one front-facing cell of the agent's own
       sprite sheet, standing over its credit lines. */
    .roll__maker {
        width: clamp(64px, 11vh, 96px);
        aspect-ratio: 1;
        margin: 2.8rem 0 0.9rem;
        background-repeat: no-repeat;
        image-rendering: pixelated;
        filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.35));
        animation: rise 0.6s cubic-bezier(0.2, 0, 0, 1) both;
    }

    /* The house bow: the Needle cactus over its line, and the whole block is
       the one clickable thing in the auditorium — it goes home.

       A screen's worth of nothing above it, so the cast has climbed out of
       frame by the time the roll stops and the last thing standing is the
       logo. CREDIT_HOUSE_ROWS pays for the extra travel. */
    .roll__house {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.9rem;
        margin-top: min(52vh, 30rem);
        color: inherit;
        text-decoration: none;
        pointer-events: auto;
        cursor: pointer;
        transition-property: scale;
        transition-duration: 0.16s;
        animation: rise 0.6s cubic-bezier(0.2, 0, 0, 1) both;
    }

    .roll__house:hover {
        scale: 1.04;
    }

    .roll__house:active {
        scale: 0.96;
    }

    .roll__brand {
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .roll__sigil {
        height: clamp(84px, 14vh, 130px);
        object-fit: contain;
        filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.45));
    }

    .roll__thanks {
        margin-top: 2.4rem;
        font-style: italic;
        opacity: 0.85;
        animation: rise 0.6s cubic-bezier(0.2, 0, 0, 1) both;
    }

    /*
     * Reduced motion keeps the darkening and drops the travel. The information
     * is in the words, and none of the movement carries any of it.
     */
    @media (prefers-reduced-motion: reduce) {
        .vignette,
        .card,
        .title,
        .byline,
        .credit,
        .credit-row,
        .roll__maker,
        .roll__house,
        .roll__thanks,
        .poster__piece {
            animation-duration: 0.01ms;
            animation-delay: 0ms;
        }

        .roll__inner {
            animation: none;
        }
    }
</style>
