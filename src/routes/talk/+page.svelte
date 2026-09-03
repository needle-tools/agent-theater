<script lang="ts">
    /**
     * The gibberish voice workbench.
     *
     * Like /painted, this page deliberately imports the production module. It
     * has no copy of the oscillator graph, vowel map, timings, or defaults: a
     * sound made here is the same sound a subtitle asks for in the theater.
     */
    import { onDestroy } from "svelte";
    import {
        ARTICULATIONS,
        DEFAULT_GIBBERISH_VOICE,
        playGibberish,
        type GibberishPlayback,
        type GibberishVoiceOptions,
    } from "$lib/subtitleVoice/synth";
    import { estimateSubtitleTextDuration } from "$lib/subtitleVoice/timing";

    let text = $state("Hello there! This little paper theater can talk now.");
    let profile = $state<GibberishVoiceOptions>({ ...DEFAULT_GIBBERISH_VOICE });
    let playback: GibberishPlayback | null = null;
    let playing = $state(false);
    let loop = $state(false);
    let trouble = $state<string | null>(null);
    let run = 0;
    let liveTimer: ReturnType<typeof setTimeout> | null = null;

    const duration = $derived(estimateSubtitleTextDuration(text, profile.speed));
    const clamp = (value: number) => Math.min(1, Math.max(-1, value));

    async function play() {
        const mine = ++run;
        playback?.stop();
        playback = null;
        trouble = null;
        try {
            do {
                const next = await playGibberish(text, profile);
                if (mine !== run) {
                    next.stop();
                    return;
                }
                playback = next;
                playing = true;
                await next.finished;
            } while (mine === run && loop);
            if (mine !== run) return;
            playback = null;
            playing = false;
        } catch (error) {
            if (mine !== run) return;
            trouble = error instanceof Error ? error.message : String(error);
            playback = null;
            playing = false;
        }
    }

    function stop() {
        run++;
        if (liveTimer) clearTimeout(liveTimer);
        playback?.stop();
        playback = null;
        playing = false;
    }

    /** Crossfade into a fresh schedule so every control, including speed, is live. */
    function restartLive() {
        if (!playing) return;
        if (liveTimer) clearTimeout(liveTimer);
        liveTimer = setTimeout(() => void play(), 55);
    }

    function setProfile<K extends keyof GibberishVoiceOptions>(key: K, value: GibberishVoiceOptions[K]) {
        profile[key] = value;
        restartLive();
    }

    function moveVoice(event: PointerEvent) {
        const pad = event.currentTarget as HTMLElement;
        if (event.type === "pointerdown") pad.setPointerCapture(event.pointerId);
        const rect = pad.getBoundingClientRect();
        profile.pitch = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1);
        profile.age = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1);
        restartLive();
    }

    function moveVoiceWithKeys(event: KeyboardEvent) {
        const step = event.shiftKey ? 0.2 : 0.06;
        if (event.key === "ArrowLeft") profile.pitch = clamp(profile.pitch - step);
        else if (event.key === "ArrowRight") profile.pitch = clamp(profile.pitch + step);
        else if (event.key === "ArrowUp") profile.age = clamp(profile.age - step);
        else if (event.key === "ArrowDown") profile.age = clamp(profile.age + step);
        else return;
        event.preventDefault();
        restartLive();
    }

    function reset() {
        stop();
        profile = { ...DEFAULT_GIBBERISH_VOICE };
    }

    onDestroy(stop);
</script>

<svelte:head>
    <title>Talk — gibberish voice workbench</title>
    <meta name="description" content="Test the theater's lightweight multilingual gibberish voice synthesizer." />
</svelte:head>

<div class="workbench">
    <header>
        <a href="/" aria-label="Back to the theater">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5.5 5.5 5.5 5.5M7.5 10H16" /></svg>
        </a>
        <div>
            <h1>Talk</h1>
            <p>The subtitle voice, on its own. Type anything, shape a character, and listen.</p>
        </div>
    </header>

    <section class="card">
        <form onsubmit={event => { event.preventDefault(); void play(); }}>
            <label class="text-label" for="talk-text">What should it say?</label>
            <textarea
                id="talk-text"
                bind:value={text}
                rows="5"
                spellcheck="true"
                oninput={restartLive}
                onkeydown={event => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        void play();
                    }
                }}
            ></textarea>

            <div class="transport">
                <button class="play" type="submit" disabled={!text.trim()}>
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                        {#if playing}<path d="M6 5.5h3v9H6zM11 5.5h3v9h-3z" />{:else}<path d="m7 5 8 5-8 5z" />{/if}
                    </svg>
                    {playing ? "Play again" : "Play"}
                </button>
                {#if playing}<button class="stop" type="button" onclick={stop}>Stop</button>{/if}
                <button
                    class="loop"
                    class:loop--on={loop}
                    type="button"
                    aria-pressed={loop}
                    onclick={() => (loop = !loop)}
                >
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7.2A6 6 0 0 0 5 5.8L3.5 7.3M4.5 12.8A6 6 0 0 0 15 14.2l1.5-1.5M3.5 4.5v2.8h2.8M16.5 15.5v-2.8h-2.8" /></svg>
                    Loop
                </button>
                <span class="duration">about {duration.toFixed(1)}s</span>
            </div>
            {#if trouble}<p class="error" role="alert">{trouble}</p>{/if}
        </form>

        <section class="controls" aria-label="Voice settings">
            <div class="control speed">
                <label for="talk-speed"><span>Speed</span><output>{profile.speed.toFixed(2)}×</output></label>
                <input id="talk-speed" type="range" min="0.35" max="2.5" step="0.05" value={profile.speed}
                    oninput={event => setProfile("speed", +(event.currentTarget as HTMLInputElement).value)} />
            </div>

            <fieldset class="articulation">
                <legend>Articulation</legend>
                <div>
                    {#each ARTICULATIONS as mode}
                        <label>
                            <input type="radio" name="talk-articulation" value={mode}
                                checked={profile.articulation === mode}
                                onchange={() => setProfile("articulation", mode)} />
                            <span>{mode === "super-coarse" ? "Super coarse" : mode === "coarse" ? "Coarse" : mode === "word" ? "Word" : "Syllable"}</span>
                        </label>
                    {/each}
                </div>
                <small>One gesture per sentence, two words, word, or spoken syllable.</small>
            </fieldset>

            <div class="voice-space">
                <div class="axis axis--top">Young</div>
                <div class="axis axis--left">Low</div>
                <div
                    class="voice-pad"
                    role="slider"
                    tabindex="0"
                    aria-label="Voice pitch and age"
                    aria-valuemin="-1"
                    aria-valuemax="1"
                    aria-valuenow={profile.pitch}
                    aria-valuetext={`${profile.pitch < 0 ? "lower" : "higher"} pitch, ${profile.age < 0 ? "younger" : "older"}`}
                    onpointerdown={moveVoice}
                    onpointermove={event => { if (event.buttons) moveVoice(event); }}
                    onkeydown={moveVoiceWithKeys}
                >
                    <span class="cross cross--x"></span><span class="cross cross--y"></span>
                    <span class="dot" style:left={`${(profile.pitch + 1) * 50}%`} style:top={`${(profile.age + 1) * 50}%`}></span>
                </div>
                <div class="axis axis--right">High</div>
                <div class="axis axis--bottom">Old</div>
            </div>

            <div class="sliders">
                <div class="control">
                    <label for="talk-timbre"><span>Timbre</span><output>{profile.timbre.toFixed(2)}</output></label>
                    <input id="talk-timbre" type="range" min="-1" max="1" step="0.05" value={profile.timbre}
                        oninput={event => setProfile("timbre", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>warm</span><span>bright</span></div>
                </div>
                <div class="control">
                    <label for="talk-depth"><span>Depth</span><output>{profile.depth.toFixed(2)}</output></label>
                    <input id="talk-depth" type="range" min="-1" max="1" step="0.05" value={profile.depth}
                        oninput={event => setProfile("depth", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>light</span><span>deep</span></div>
                </div>
                <div class="control">
                    <label for="talk-vowels"><span>Vowel spread</span><output>{profile.vowelSpread.toFixed(2)}×</output></label>
                    <input id="talk-vowels" type="range" min="0" max="2" step="0.01" value={profile.vowelSpread}
                        oninput={event => setProfile("vowelSpread", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>flat</span><span>exaggerated</span></div>
                </div>
                <div class="control">
                    <label for="talk-smoothing"><span>Ring damping</span><output>{profile.smoothing.toFixed(2)}×</output></label>
                    <input id="talk-smoothing" type="range" min="0" max="3" step="0.05" value={profile.smoothing}
                        oninput={event => setProfile("smoothing", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>wide</span><span>focused</span></div>
                </div>
                <div class="control">
                    <label for="talk-fullness"><span>Fullness</span><output>{profile.fullness.toFixed(2)}×</output></label>
                    <input id="talk-fullness" type="range" min="0" max="2" step="0.01" value={profile.fullness}
                        oninput={event => setProfile("fullness", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>lean</span><span>harmonic</span></div>
                </div>
                <div class="control">
                    <label for="talk-babble"><span>Babble</span><output>{profile.babble.toFixed(2)}×</output></label>
                    <input id="talk-babble" type="range" min="0" max="2" step="0.01" value={profile.babble}
                        oninput={event => setProfile("babble", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>still mouth</span><span>animated mouth</span></div>
                </div>
                <div class="control">
                    <label for="talk-breath"><span>Softness</span><output>{profile.breathiness.toFixed(2)}</output></label>
                    <input id="talk-breath" type="range" min="0" max="1" step="0.01" value={profile.breathiness}
                        oninput={event => setProfile("breathiness", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>buzzy</span><span>soft</span></div>
                </div>
                <div class="control">
                    <label for="talk-pause"><span>Pauses</span><output>{Math.round(profile.pause * 100)}%</output></label>
                    <input id="talk-pause" type="range" min="0" max="1" step="0.01" value={profile.pause}
                        oninput={event => setProfile("pause", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>joined</span><span>spaced</span></div>
                </div>
                <div class="control">
                    <label for="talk-rhythm"><span>Rhythm</span><output>{profile.rhythm.toFixed(2)}×</output></label>
                    <input id="talk-rhythm" type="range" min="0" max="2" step="0.01" value={profile.rhythm}
                        oninput={event => setProfile("rhythm", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>even</span><span>expressive</span></div>
                </div>
                <div class="control">
                    <label for="talk-cut"><span>Low cut</span><output>{Math.round(profile.rumbleCut)} Hz</output></label>
                    <input id="talk-cut" type="range" min="60" max="600" step="10" value={profile.rumbleCut}
                        oninput={event => setProfile("rumbleCut", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>full</span><span>thin</span></div>
                </div>
                <div class="control">
                    <label for="talk-compression"><span>Compression</span><output>{Math.round(profile.compression * 100)}%</output></label>
                    <input id="talk-compression" type="range" min="0" max="1" step="0.01" value={profile.compression}
                        oninput={event => setProfile("compression", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>open</span><span>squashed</span></div>
                </div>
                <div class="control">
                    <label for="talk-drive"><span>Drive</span><output>{profile.drive.toFixed(2)}×</output></label>
                    <input id="talk-drive" type="range" min="0.35" max="2" step="0.05" value={profile.drive}
                        oninput={event => setProfile("drive", +(event.currentTarget as HTMLInputElement).value)} />
                    <div class="ends"><span>clean</span><span>pushed</span></div>
                </div>
                <div class="control">
                    <label for="talk-volume"><span>Volume</span><output>{Math.round(profile.volume * 100)}%</output></label>
                    <input id="talk-volume" type="range" min="0" max="1" step="0.01" value={profile.volume}
                        oninput={event => setProfile("volume", +(event.currentTarget as HTMLInputElement).value)} />
                </div>
                <button class="reset" type="button" onclick={reset}>Reset voice</button>
            </div>
        </section>
    </section>

    <p class="footnote">
        This page imports the production subtitle synthesizer directly: the same timing estimator,
        multilingual vowel map, four formant bands, and defaults. Ring damping focuses overlapping resonances;
        Babble animates jaw-like mouth motion without adding noise.
    </p>
</div>

<style>
    .workbench {
        box-sizing: border-box;
        min-height: 100dvh;
        padding: clamp(28px, 6vw, 76px) clamp(18px, 5vw, 64px) 56px;
        background:
            radial-gradient(circle at 76% 16%, color-mix(in srgb, var(--accent-brand) 13%, transparent), transparent 34rem),
            var(--surface-page);
    }

    header, .card, .footnote { width: min(900px, 100%); margin-inline: auto; }
    header { display: flex; align-items: flex-start; gap: 15px; margin-bottom: 24px; }
    header a { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; margin-top: 5px; border: 1px solid var(--border-subtle); border-radius: 50%; background: var(--surface-panel); color: var(--text-primary); }
    header a:hover { border-color: var(--border-strong); background: var(--surface-panel-muted); }
    header svg { width: 19px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    h1 { margin: 0; font-family: var(--font-family-display); font-size: clamp(2.6rem, 7vw, 5.5rem); font-weight: 500; line-height: 0.95; letter-spacing: -0.045em; }
    header p { max-width: 580px; margin: 12px 0 0; color: var(--text-muted); font-size: 1.05rem; text-wrap: balance; }

    .card { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr); gap: 28px; padding: clamp(18px, 3vw, 32px); border: 1px solid var(--border-subtle); border-radius: 24px; background: var(--surface-panel); box-shadow: 0 20px 60px rgba(34, 44, 32, 0.09); }
    form { min-width: 0; }
    .text-label { display: block; margin-bottom: 9px; font-weight: 650; }
    textarea { box-sizing: border-box; width: 100%; min-height: 214px; resize: vertical; padding: 18px; border: 1px solid var(--border-subtle); border-radius: 16px; outline: 0; background: var(--surface-page-elevated); color: var(--text-primary); font: 500 clamp(1.15rem, 2vw, 1.45rem)/1.5 var(--font-family-body); text-wrap: pretty; transition: border-color .15s, box-shadow .15s; }
    textarea:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-brand) 20%, transparent); }

    .transport { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
    button { font: inherit; cursor: pointer; }
    .play, .stop, .loop, .reset { min-height: 40px; border-radius: 12px; }
    .play { display: inline-flex; align-items: center; gap: 7px; padding: 0 17px; border: 0; background: var(--accent-brand); color: #14200f; font-weight: 750; }
    .play:hover:not(:disabled) { filter: brightness(.96); }
    .play:active:not(:disabled) { scale: .97; }
    .play:disabled { opacity: .4; cursor: not-allowed; }
    .play svg { width: 17px; fill: currentColor; }
    .stop { padding: 0 14px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text-primary); }
    .loop { display: inline-flex; align-items: center; gap: 5px; padding: 0 11px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text-muted); }
    .loop:hover { border-color: var(--border-strong); color: var(--text-primary); }
    .loop--on { border-color: transparent; background: color-mix(in srgb, var(--accent-brand) 25%, transparent); color: var(--text-primary); }
    .loop svg { width: 15px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .duration { margin-left: auto; color: var(--text-muted); font-size: .85rem; font-variant-numeric: tabular-nums; }
    .error { margin: 10px 0 0; color: var(--accent-error, #c8324c); font-size: .9rem; }

    .controls { min-width: 0; padding-left: 28px; border-left: 1px solid var(--border-subtle); }
    .control label { display: flex; justify-content: space-between; gap: 10px; font-size: .85rem; font-weight: 650; }
    output { color: var(--text-muted); font-variant-numeric: tabular-nums; font-weight: 500; }
    input[type="range"] { width: 100%; margin: 7px 0 0; accent-color: var(--accent-brand); }
    .speed { margin-bottom: 17px; }
    .articulation { min-width: 0; margin: -3px 0 18px; padding: 0; border: 0; }
    .articulation legend { margin-bottom: 6px; font-size: .82rem; font-weight: 650; }
    .articulation > div { display: grid; grid-template-columns: repeat(4, 1fr); overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 10px; }
    .articulation label { min-width: 0; cursor: pointer; }
    .articulation input { position: absolute; opacity: 0; pointer-events: none; }
    .articulation label span { display: grid; min-height: 36px; place-items: center; padding: 3px; border-left: 1px solid var(--border-subtle); font-size: .67rem; line-height: 1.05; text-align: center; }
    .articulation label:first-child span { border-left: 0; }
    .articulation input:checked + span { background: var(--accent-brand); color: #14200f; font-weight: 750; }
    .articulation input:focus-visible + span { outline: 2px solid var(--text-primary); outline-offset: -2px; }
    .articulation small { display: block; margin-top: 5px; color: var(--text-muted); font-size: .67rem; line-height: 1.3; }

    .voice-space { position: relative; display: grid; grid-template: 15px 150px 15px / 25px 1fr 30px; align-items: center; margin-bottom: 20px; color: var(--text-muted); font-size: .67rem; text-align: center; }
    .voice-pad { position: relative; grid-area: 2 / 2; height: 100%; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 14px; background: radial-gradient(circle at 76% 20%, rgba(255, 216, 125, .45), transparent 50%), linear-gradient(90deg, rgba(80, 105, 166, .24), rgba(226, 124, 146, .25)); cursor: crosshair; touch-action: none; }
    .axis--top { grid-area: 1 / 2; }
    .axis--bottom { grid-area: 3 / 2; }
    .axis--left { grid-area: 2 / 1; }
    .axis--right { grid-area: 2 / 3; }
    .cross { position: absolute; background: color-mix(in srgb, var(--text-primary) 13%, transparent); pointer-events: none; }
    .cross--x { inset: 50% 0 auto; height: 1px; }
    .cross--y { inset: 0 auto 0 50%; width: 1px; }
    .dot { position: absolute; width: 16px; height: 16px; translate: -50% -50%; border: 3px solid var(--surface-panel); border-radius: 50%; background: var(--text-primary); box-shadow: 0 2px 7px rgba(0, 0, 0, .25); pointer-events: none; }

    .sliders { display: grid; gap: 14px; }
    .ends { display: flex; justify-content: space-between; color: var(--text-muted); font-size: .65rem; }
    .reset { width: 100%; margin-top: 2px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text-muted); }
    .reset:hover { border-color: var(--border-strong); background: var(--surface-panel-muted); color: var(--text-primary); }

    .footnote { box-sizing: border-box; margin-top: 18px; padding-inline: 16px; color: var(--text-muted); font-size: .82rem; line-height: 1.5; text-align: center; text-wrap: balance; }

    @media (max-width: 680px) {
        .workbench { padding-top: 28px; }
        .card { grid-template-columns: 1fr; }
        .controls { padding: 24px 0 0; border-top: 1px solid var(--border-subtle); border-left: 0; }
    }
</style>
