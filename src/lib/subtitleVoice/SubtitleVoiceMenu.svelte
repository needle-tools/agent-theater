<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import {
        DEFAULT_GIBBERISH_VOICE,
        normalizeGibberishVoice,
        playGibberish,
        type GibberishPlayback,
        type GibberishVoiceOptions,
    } from "./synth.js";

    interface Props {
        text: string;
        /** Stable per character, so one character keeps one sound. */
        voiceKey?: string;
    }

    let { text, voiceKey = "narrator" }: Props = $props();
    const queryEnablesControls = (search: string) => {
        const params = new URLSearchParams(search);
        const flag = params.get("sub");
        return params.has("sub") && !["0", "false", "off"].includes((flag ?? "").toLowerCase());
    };
    // Decide this during client component creation as well as on mount. This
    // avoids leaving an otherwise DOM-less component dormant after hydration.
    let enabled = $state(typeof window !== "undefined" && queryEnablesControls(window.location.search));
    let open = $state(false);
    let root: HTMLDivElement | null = $state(null);
    let profile = $state<GibberishVoiceOptions>({ ...DEFAULT_GIBBERISH_VOICE });
    let playback: GibberishPlayback | null = null;
    let playing = $state(false);
    let liveTimer: ReturnType<typeof setTimeout> | null = null;

    const storageKey = $derived(`subtitle-gibberish:${voiceKey}`);
    const clamp = (value: number) => Math.min(1, Math.max(-1, value));

    function save() {
        try { localStorage.setItem(storageKey, JSON.stringify(profile)); } catch { /* private mode */ }
    }

    function patch(values: Partial<GibberishVoiceOptions>) {
        profile = { ...profile, ...values };
        save();
        if (playing) {
            if (liveTimer) clearTimeout(liveTimer);
            liveTimer = setTimeout(() => void play(), 55);
        }
    }

    async function play() {
        playback?.stop();
        playback = await playGibberish(text, profile);
        const mine = playback;
        playing = true;
        await mine.finished;
        if (playback === mine) {
            playback = null;
            playing = false;
        }
    }

    function stop() {
        if (liveTimer) clearTimeout(liveTimer);
        playback?.stop();
        playback = null;
        playing = false;
    }

    function moveVoice(event: PointerEvent) {
        const pad = event.currentTarget as HTMLElement;
        if (event.type === "pointerdown") pad.setPointerCapture(event.pointerId);
        const rect = pad.getBoundingClientRect();
        patch({
            pitch: clamp(((event.clientX - rect.left) / rect.width) * 2 - 1),
            age: clamp(((event.clientY - rect.top) / rect.height) * 2 - 1),
        });
    }

    onMount(() => {
        enabled = queryEnablesControls(location.search);
        if (!enabled) return;
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
            if (saved && typeof saved === "object") profile = normalizeGibberishVoice(saved);
        } catch { /* keep defaults */ }

        const bubble = root?.parentElement;
        const openFromContext = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            open = true;
        };
        bubble?.addEventListener("contextmenu", openFromContext);
        return () => bubble?.removeEventListener("contextmenu", openFromContext);
    });

    onDestroy(stop);
</script>

<svelte:window
    onpointerdown={event => {
        if (open && root && !root.contains(event.target as Node)) open = false;
    }}
    onkeydown={event => {
        if (open && event.key === "Escape") open = false;
    }}
/>

<!-- Always leave a hidden hydration anchor. Query gating controls visibility,
     while the stable node lets the mount hook attach to its speech bubble. -->
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
    class="subtitle-voice"
    class:subtitle-voice--open={open}
    bind:this={root}
    data-subtitle-voice-controls
    data-said-static
    hidden={!enabled}
    onpointerdown={event => event.stopPropagation()}
    onclick={event => event.stopPropagation()}
    onkeydown={event => event.stopPropagation()}
>
        <button
            class="trigger"
            aria-label="Gibberish voice controls"
            aria-expanded={open}
            title="Gibberish voice"
            onclick={() => (open = !open)}
        >
            <svg viewBox="0 0 18 18" aria-hidden="true">
                <path d="M2.5 10.5h2.2L7.2 13V5L4.7 7.5H2.5zM10 6.2c1.5 1.4 1.5 4.2 0 5.6M12.3 4.1c2.8 2.7 2.8 7.1 0 9.8" />
            </svg>
        </button>

        {#if open}
            <div class="panel" role="dialog" aria-label="Gibberish voice settings">
                <button class="play" onclick={playing ? stop : play}>
                    {playing ? "Stop" : "Play"}
                    <span>{profile.speed.toFixed(2)}×</span>
                </button>

                <label>
                    <span>Speed</span>
                    <input
                        aria-label="Voice speed"
                        type="range" min="0.35" max="2.5" step="0.05"
                        value={profile.speed}
                        oninput={event => patch({ speed: +(event.currentTarget as HTMLInputElement).value })}
                    />
                </label>

                <label>
                    <span>Pauses</span>
                    <input
                        aria-label="Word and sentence pauses"
                        type="range" min="0" max="2" step="0.01"
                        value={profile.pause}
                        oninput={event => patch({ pause: +(event.currentTarget as HTMLInputElement).value })}
                    />
                </label>

                <label>
                    <span>Rhythm</span>
                    <input
                        aria-label="Voice timing rhythm"
                        type="range" min="0" max="2" step="0.01"
                        value={profile.rhythm}
                        oninput={event => patch({ rhythm: +(event.currentTarget as HTMLInputElement).value })}
                    />
                </label>

                <div class="axis axis--top"><span>Young</span></div>
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
                    onkeydown={event => {
                        const step = event.shiftKey ? 0.2 : 0.06;
                        if (event.key === "ArrowLeft") patch({ pitch: clamp(profile.pitch - step) });
                        else if (event.key === "ArrowRight") patch({ pitch: clamp(profile.pitch + step) });
                        else if (event.key === "ArrowUp") patch({ age: clamp(profile.age - step) });
                        else if (event.key === "ArrowDown") patch({ age: clamp(profile.age + step) });
                        else return;
                        event.preventDefault();
                    }}
                >
                    <span class="cross cross--x"></span><span class="cross cross--y"></span>
                    <span
                        class="dot"
                        style:left={`${(profile.pitch + 1) * 50}%`}
                        style:top={`${(profile.age + 1) * 50}%`}
                    ></span>
                </div>
                <div class="axis axis--bottom"><span>Low</span><span>Old</span><span>High</span></div>

                <div class="compact">
                    <label>
                        <span>Timbre</span>
                        <input aria-label="Voice timbre" type="range" min="-1" max="1" step="0.05"
                            value={profile.timbre}
                            oninput={event => patch({ timbre: +(event.currentTarget as HTMLInputElement).value })} />
                    </label>
                    <label>
                        <span>Depth</span>
                        <input aria-label="Voice depth" type="range" min="-1" max="1" step="0.05"
                            value={profile.depth}
                            oninput={event => patch({ depth: +(event.currentTarget as HTMLInputElement).value })} />
                    </label>
                    <label>
                        <span>Vowels</span>
                        <input aria-label="Voice vowel spread" type="range" min="0" max="2" step="0.01"
                            value={profile.vowelSpread}
                            oninput={event => patch({ vowelSpread: +(event.currentTarget as HTMLInputElement).value })} />
                    </label>
                    <label>
                        <span>Damping</span>
                        <input aria-label="Voice resonance damping" type="range" min="0" max="3" step="0.05"
                            value={profile.smoothing}
                            oninput={event => patch({ smoothing: +(event.currentTarget as HTMLInputElement).value })} />
                    </label>
                    <label>
                        <span>Fullness</span>
                        <input aria-label="Voice harmonic fullness" type="range" min="0" max="2" step="0.01"
                            value={profile.fullness}
                            oninput={event => patch({ fullness: +(event.currentTarget as HTMLInputElement).value })} />
                    </label>
                    <label>
                        <span>Babble</span>
                        <input aria-label="Voice mouth babble" type="range" min="0" max="2" step="0.01"
                            value={profile.babble}
                            oninput={event => patch({ babble: +(event.currentTarget as HTMLInputElement).value })} />
                    </label>
                    <label>
                        <span>Low cut</span>
                        <input aria-label="Voice low-frequency cut" type="range" min="60" max="600" step="10"
                            value={profile.rumbleCut}
                            oninput={event => patch({ rumbleCut: +(event.currentTarget as HTMLInputElement).value })} />
                    </label>
                    <label>
                        <span>Compress</span>
                        <input aria-label="Voice compression" type="range" min="0" max="1" step="0.01"
                            value={profile.compression}
                            oninput={event => patch({ compression: +(event.currentTarget as HTMLInputElement).value })} />
                    </label>
                    <label>
                        <span>Drive</span>
                        <input aria-label="Voice drive" type="range" min="0.35" max="2" step="0.05"
                            value={profile.drive}
                            oninput={event => patch({ drive: +(event.currentTarget as HTMLInputElement).value })} />
                    </label>
                </div>
            </div>
        {/if}
</div>

<style>
    .subtitle-voice {
        position: absolute;
        top: -0.55em;
        right: -0.55em;
        z-index: 20;
        pointer-events: auto;
        font-family: var(--font-family-body, system-ui);
        font-size: 14px;
        font-weight: 500;
        line-height: 1.2;
        text-align: left;
        text-wrap: nowrap;
    }
    .subtitle-voice[hidden] { display: none !important; }

    .trigger {
        display: grid;
        width: 24px;
        height: 24px;
        place-items: center;
        padding: 0;
        border: 1px solid color-mix(in srgb, var(--text-primary) 28%, transparent);
        border-radius: 999px;
        background: var(--surface-page-elevated, white);
        color: var(--text-primary, #222c20);
        box-shadow: 0 2px 7px rgba(20, 30, 18, 0.16);
        cursor: pointer;
    }

    .trigger svg { width: 15px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .trigger:hover, .subtitle-voice--open .trigger { background: var(--brand-primary, #a5ff8f); }

    .panel {
        position: absolute;
        top: 30px;
        right: 0;
        width: 224px;
        padding: 8px;
        border: 1px solid color-mix(in srgb, var(--text-primary) 16%, transparent);
        border-radius: 14px;
        background: var(--surface-page-elevated, white);
        color: var(--text-primary, #222c20);
        box-shadow: 0 14px 36px rgba(20, 30, 18, 0.2);
        animation: voice-menu-in 0.14s ease-out;
    }

    @keyframes voice-menu-in { from { opacity: 0; translate: 0 -3px; scale: 0.98; } }

    button, input { font: inherit; }
    .play {
        display: flex;
        width: 100%;
        min-height: 34px;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px;
        border: 0;
        border-radius: 9px;
        background: var(--brand-primary, #a5ff8f);
        color: #182116;
        font-weight: 700;
        cursor: pointer;
    }
    .play span { opacity: 0.58; font-variant-numeric: tabular-nums; }

    label { display: grid; grid-template-columns: 45px 1fr; align-items: center; gap: 7px; margin-top: 8px; font-size: 11px; }
    input[type="range"] { width: 100%; accent-color: var(--brand-primary, #78d969); }

    .voice-pad {
        position: relative;
        height: 90px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--text-primary) 15%, transparent);
        border-radius: 10px;
        background:
            radial-gradient(circle at 78% 22%, rgba(255, 223, 140, 0.38), transparent 48%),
            linear-gradient(90deg, rgba(82, 105, 160, 0.2), rgba(224, 123, 145, 0.2));
        cursor: crosshair;
        touch-action: none;
    }
    .voice-pad:focus-visible { outline: 2px solid var(--brand-primary, #78d969); outline-offset: 2px; }
    .cross { position: absolute; background: color-mix(in srgb, var(--text-primary) 12%, transparent); pointer-events: none; }
    .cross--x { left: 0; right: 0; top: 50%; height: 1px; }
    .cross--y { top: 0; bottom: 0; left: 50%; width: 1px; }
    .dot { position: absolute; width: 13px; height: 13px; translate: -50% -50%; border: 2px solid white; border-radius: 50%; background: var(--text-primary, #222c20); box-shadow: 0 1px 5px rgba(0,0,0,.28); pointer-events: none; }
    .axis { display: flex; color: var(--text-muted, #667064); font-size: 9px; }
    .axis--top { justify-content: center; margin: 8px 0 3px; }
    .axis--bottom { justify-content: space-between; margin-top: 3px; }
    .compact { padding-top: 2px; }

    @media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
</style>
