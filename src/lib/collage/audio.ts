/**
 * Sound: music under a scene, and a noise on a beat.
 *
 * Two kinds, and they behave differently enough to be separate ideas.
 *
 * **Music** belongs to a scene. It starts when the scene does, loops for as
 * long as the scene lasts, and cross-fades into whatever the next scene wants —
 * cutting from one two-minute bed to another is the single most amateur sound a
 * show can make.
 *
 * **Cues** belong to a beat. They fire and finish. Several can overlap, because
 * a laugh landing while a sting is still ringing is fine and stopping the sting
 * to make room is not.
 *
 * Streamed rather than decoded. The music is two minutes a piece and Web Audio
 * would hold every one of them in memory as raw samples — tens of megabytes for
 * something an `<audio>` element streams off disk. Cross-fading needs nothing
 * more than two elements and a volume ramp.
 */
import { SOUNDS, type Sound, type SoundRole } from "./sounds.js";
export { SOUNDS, type Sound, type SoundRole } from "./sounds.js";

const byId = new Map(SOUNDS.map(sound => [sound.id, sound]));

export function findSound(id: string): Sound | null {
    return byId.get(id) ?? null;
}

/** The ids an agent may name in a given role. */
export function soundNames(...roles: SoundRole[]): string[] {
    return SOUNDS.filter(sound => roles.includes(sound.role)).map(sound => sound.id);
}

/**
 * Every id filed under one take, for a caller that wants variety.
 *
 * Takes of a prompt are interchangeable by construction, so anywhere that
 * deals a track at random — the idle page's house music — should ask for the
 * group rather than count it. Counting is how a hardcoded `* 5` outlives the
 * five tracks it was written for and stops reaching the sixth.
 */
export function takeNames(take: string): string[] {
    return SOUNDS.filter(sound => sound.take === take).map(sound => sound.id);
}

/**
 * One line per sound, for an agent choosing between them.
 *
 * The moods and the descriptions are the whole reason to have this: "a bed" is
 * not enough to pick between eight of them, and a list of bare ids makes the
 * choice arbitrary. Alternate takes of one prompt are marked, so an agent that
 * wants variety knows which ones are genuinely different.
 */
export function soundCatalogue(...roles: SoundRole[]): string[] {
    return SOUNDS.filter(sound => roles.includes(sound.role)).map(sound =>
        `${sound.id} — ${sound.description}` +
        `${sound.mood.length ? ` [${sound.mood.join(", ")}]` : ""}` +
        `${sound.take ? ` (one take of "${sound.take}")` : ""}`);
}

/**
 * A sting plays as it was made; the bed sits under it.
 *
 * The two were generated at matched levels, which is the right way to make
 * them and the wrong way to play them: a bed is meant to be under the thing
 * happening, and at parity it competes with the door slam it is supposed to be
 * behind. So the music is pulled down and nothing else is touched — one number,
 * for the one job mixing has here.
 *
 * A third rather than a half, after listening. Under dialogue and under a
 * sting, a bed at half is still the loudest thing in the room; at a third it
 * is the room.
 */
const FULL = 1;
/**
 * Stings and effects sit BELOW full scale now that the cast actually talks:
 * the synthesised voices live well under 1.0 by their own headroom, and a
 * door slam at parity with the mix ceiling flattened every line near it.
 * Playback mix only — the files themselves stay exactly as generated.
 */
const CUE_LEVEL = 0.6;
const MUSIC_LEVEL = 0.32;
/**
 * The editing bed, relative to a scene's.
 *
 * Music under a play is part of the play and belongs at the front of the mix
 * the bed is allowed. Music under somebody arranging stickers is company —
 * it plays for as long as they work, which is far longer than any scene, and
 * a level that is right for two minutes is wearing after twenty. Half.
 */
export const MENU_MUSIC_LEVEL = 0.5;
/** Long enough to be a change of mood rather than a splice. */
const CROSSFADE_MS = 1200;
/**
 * The end of the play is not a scene change, so it does not get a scene
 * change's fade. This one is long enough to be heard ending.
 */
export const ENDING_FADE_MS = 3500;

/**
 * A cue this long or longer pushes the music down while it plays.
 *
 * Below it, ducking is worse than not: a half-second sting is over before the
 * bed has finished getting out of its way, so all anybody hears is the music
 * lurching. Two seconds is about where a sound stops being a punctuation mark
 * and starts being something you are meant to listen to.
 */
const DUCK_OVER_MS = 2000;

/** How far under the bed goes while something is being listened to. */
const DUCK_TO = 0.35;

/** Fast enough to be out of the way for the sound, slow enough not to be heard. */
const DUCK_MS = 260;

/**
 * How early the next piece of house music starts.
 *
 * Longer than a scene change's cross-fade, and for a reason the files force:
 * every bed fades to silence over its last few seconds no matter what the
 * prompt asked for. Coming in on top of that tail replaces it — start only a
 * second early and the set audibly dips to nothing between tracks.
 */
const PLAYLIST_LEAD_MS = 5000;

/**
 * What happens when a piece of music reaches its end.
 *
 * A bed is about two minutes long and a scene is not, so most of the time the
 * end never arrives and this does not matter. When it does arrive, looping is
 * the safe default but it is not always the right one: a piece with a real
 * ending sounds wrong restarting, and a scene that has changed mood wants to
 * arrive somewhere else. So: loop it, let it fade away, or blend into another.
 */
export type MusicEnd = "loop" | "fade" | (string & {});

export interface Speaker {
    /**
     * Start a bed under the scene, fading out whatever was playing.
     *
     * `end` says what to do when the piece runs out — loop it (the default),
     * fade it away, or name another bed to blend into.
     *
     * `level` scales this bed against every other one — 1 by default, and the
     * editing bed passes MENU_MUSIC_LEVEL. A multiplier rather than a volume,
     * so the one place that decides how loud music sits under everything else
     * stays MUSIC_LEVEL.
     */
    music(id: string | null, end?: MusicEnd, level?: number): void;
    /**
     * House music: deal from a set of beds, and move to a DIFFERENT one each
     * time a piece runs out.
     *
     * Not `music(id, "loop")`, which is what this replaced. Every bed here
     * fades away at its end — the generator does it whatever the prompt says —
     * so looping one plays the fade, then silence, then a hard jump back to the
     * top. Over an editing session that reads as the music being broken.
     *
     * Moving on instead fixes both halves: the next piece is cross-faded in
     * over the tail, which covers the fade, and somebody arranging stickers for
     * an hour hears a set rather than one track forty times.
     */
    playlist(ids: string[], level?: number): void;
    /** Mute or restore music beds without changing cues and sound effects. */
    setMusicMuted(muted: boolean): void;
    /** Fire and forget. Overlapping cues are allowed and expected. */
    cue(id: string): void;
    /**
     * Push the bed down for this long, for something being listened to.
     *
     * The same duck a long cue gets, offered to whoever else needs it — which
     * in practice means dialogue. The prompter plays voices itself, through its
     * own queue, and has no way to reach in here otherwise; without this the
     * music sits at full level under every spoken line and the play is somebody
     * talking through a band.
     */
    duckFor(ms: number): void;
    /**
     * Let the music go, over as long as it takes.
     *
     * Distinct from `music(null)`, which is a scene ending and fades at a
     * scene's pace. The end of the play wants longer than that — a bed that
     * stopped in a second under the credits would read as the tab being
     * closed rather than as the show being over.
     */
    fadeMusic(ms?: number): void;
    /** Silence, for leaving the show. */
    stop(): void;
    /**
     * Try to buy permission to make a noise, from inside a user gesture.
     *
     * Autoplay is refused until the person has interacted with the page, and a
     * show an agent started has had no interaction at all — so a play could run
     * end to end in silence with nothing saying why. Called from the first
     * pointer or key event, where a browser will allow a play that it would
     * refuse a moment later, and cheap enough to call again.
     */
    unlock(): void;
    /**
     * Whether the browser has let us make a sound yet.
     *
     * Autoplay is blocked until the person has interacted with the page, and a
     * show started by an agent has had no interaction at all — so this can be
     * false through an entire performance, and the honest thing is to say so
     * rather than let the silence read as a missing feature.
     */
    readonly allowed: boolean;
    /**
     * Whether a sound has actually been permitted yet.
     *
     * Distinct from `allowed`, which only says nothing has been refused. Before
     * anybody has touched the page both are true and neither means the show
     * will be audible — this is the one that does, and it is what an agent
     * needs to be told before it narrates over music nobody can hear.
     */
    readonly ready: boolean;
}

/** A no-op speaker, for tests and for anywhere without a DOM. */
export const SILENT: Speaker = {
    music() {},
    setMusicMuted() {},
    playlist() {},
    fadeMusic() {},
    unlock() {},
    cue() {},
    duckFor() {},
    stop() {},
    allowed: true,
    ready: true,
};

export function createSpeaker(): Speaker {
    if (typeof document === "undefined") return SILENT;

    /**
     * Everything currently making a noise.
     *
     * Held as a set rather than a single handle because the first version kept
     * only the current bed, and a fade that never finished left its element
     * playing with nothing left pointing at it — unstoppable, and audible under
     * the next two scenes. Several beds ended up going at once.
     */
    const sounding = new Set<HTMLAudioElement>();
    let bed: HTMLAudioElement | null = null;
    let bedId: string | null = null;
    /*
     * What the current bed settles at.
     *
     * The editing bed sits lower than a scene's, so ducking and recovery have
     * to come back to THIS level rather than to MUSIC_LEVEL — otherwise the
     * first long cue would quietly promote the menu music to full scene volume
     * and leave it there for the rest of the session.
     */
    let bedLevel = MUSIC_LEVEL;
    let musicMuted = false;
    let blocked = false;
    /** Whether a play has been allowed at least once. */
    let unlocked = false;

    const release = (element: HTMLAudioElement) => {
        element.pause();
        element.src = "";
        sounding.delete(element);
    };

    /**
     * Ramp a volume, and stop deterministically.
     *
     * The ramp is requestAnimationFrame because it should be smooth; the stop
     * is a timer because it must happen. rAF does not run in a background tab,
     * so a fade-out that relied on it alone would leave the track playing
     * forever the moment somebody switched away mid-show.
     */
    const fadeOut = (element: HTMLAudioElement, ms: number) => {
        const from = element.volume;
        const started = performance.now();
        const step = () => {
            if (!sounding.has(element)) return;
            const t = Math.min(1, (performance.now() - started) / ms);
            element.volume = Math.max(0, from * (1 - t));
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        setTimeout(() => release(element), ms + 50);
    };

    /**
     * Move a volume to a level over a time.
     *
     * The general form of what fadeIn and fadeOut each do a special case of.
     * Same rAF-with-a-timer-backstop shape as those: smooth while the tab is
     * visible, correct even when it is not.
     */
    const rampTo = (element: HTMLAudioElement, to: number, ms: number) => {
        const from = element.volume;
        const started = performance.now();
        const step = () => {
            if (!sounding.has(element)) return;
            const t = Math.min(1, (performance.now() - started) / ms);
            element.volume = Math.max(0, Math.min(1, from + (to - from) * t));
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        setTimeout(() => {
            if (sounding.has(element)) element.volume = Math.max(0, Math.min(1, to));
        }, ms + 50);
    };

    const fadeIn = (element: HTMLAudioElement, ms: number, to: number) => {
        const started = performance.now();
        const step = () => {
            if (!sounding.has(element)) return;
            const t = Math.min(1, (performance.now() - started) / ms);
            element.volume = Math.min(to, to * t);
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        // The backstop matters here too: a bed left at zero because the tab was
        // hidden while it started would be silent for the whole scene.
        setTimeout(() => {
            if (sounding.has(element)) element.volume = to;
        }, ms + 50);
    };

    /**
     * Watch for the end of a piece and act before it arrives.
     *
     * `ended` is too late for anything but silence — by the time it fires the
     * music has already stopped, so a fade would have nothing to fade and a
     * blend would be a gap. Watching the clock instead lets the last seconds of
     * one piece overlap the first seconds of the next, which is the difference
     * between a transition and a join.
     */
    /**
     * The set the house music deals from, and how loud it plays.
     *
     * Held here rather than passed through every call, because the piece that
     * decides what comes next is the one that just ended, and by then the
     * caller that started the set is long gone.
     */
    let house: { ids: string[]; level: number } | null = null;

    /** A different one, whenever there is a different one to be had. */
    const dealFrom = (ids: string[], avoid: string | null): string | null => {
        const others = ids.filter(id => id !== avoid);
        const pool = others.length ? others : ids;
        return pool[Math.floor(Math.random() * pool.length)] ?? null;
    };

    const arrangeEnding = (element: HTMLAudioElement, end: MusicEnd) => {
        if (end === "loop") {
            element.loop = true;
            return;
        }
        let done = false;
        const lead = end === "playlist" ? PLAYLIST_LEAD_MS : CROSSFADE_MS;
        const watch = () => {
            if (done || !sounding.has(element)) return;
            const total = element.duration;
            if (!Number.isFinite(total)) return;
            if (total - element.currentTime > lead / 1000) return;
            done = true;
            if (end === "playlist") {
                const next = house ? dealFrom(house.ids, bedId) : null;
                if (next) speaker.music(next, "playlist", house!.level);
                else fadeOut(element, CROSSFADE_MS);
                return;
            }
            if (end === "fade") {
                fadeOut(element, CROSSFADE_MS);
                if (bed === element) {
                    bed = null;
                    bedId = null;
                }
                return;
            }
            // Blending into another piece is the same operation as a scene
            // change, so it goes through the same door and gets the same fade.
            speaker.music(end);
        };
        element.addEventListener("timeupdate", watch);
    };

    /**
     * Hold the bed down for a while, then let it back up.
     *
     * Counted rather than flagged: two overlapping long cues would otherwise
     * have the first one's recovery undo the second one's duck, and the music
     * would swell back up in the middle of a howl.
     */
    let ducking = 0;
    const duck = (ms: number) => {
        const bed_ = bed;
        if (!bed_) return;
        ducking++;
        rampTo(bed_, musicMuted ? 0 : bedLevel * DUCK_TO, DUCK_MS);
        setTimeout(() => {
            ducking--;
            // Only the last one out turns the lights back on — and only if this
            // is still the same bed, since a scene change replaces it.
            if (ducking === 0 && bed === bed_) rampTo(bed_, musicMuted ? 0 : bedLevel, DUCK_MS * 3);
        }, ms);
    };

    const start = (sound: Sound, loop: boolean, end: MusicEnd = "loop", level = MUSIC_LEVEL): HTMLAudioElement => {
        const element = new Audio(sound.file);
        // A bed fades up; a sting simply starts, because fading in a sting
        // removes its attack and the attack is the sting.
        element.volume = loop ? 0 : CUE_LEVEL;
        sounding.add(element);
        if (loop) arrangeEnding(element, end);
        else element.addEventListener("ended", () => release(element), { once: true });

        const attempt = element.play();
        if (attempt) {
            attempt.catch(() => {
                // Autoplay refused. Remembered rather than retried: it will keep
                // refusing until the person touches the page, and a show that
                // retried on every cue would only fill the console.
                blocked = true;
                release(element);
            });
        }
        if (loop) fadeIn(element, CROSSFADE_MS, musicMuted ? 0 : level);
        return element;
    };

    const speaker: Speaker = {
        get allowed() {
            // Never having been asked is not the same as being allowed, but it
            // is not being blocked either. Only a refusal is a refusal.
            return !blocked;
        },

        get ready() {
            return unlocked;
        },

        music(id, end = "loop", level = 1) {
            // Anything that is not the set continuing itself ends the set: a
            // scene's bed must not be followed by the house music resuming.
            if (end !== "playlist") house = null;
            const wanted = MUSIC_LEVEL * level;
            /*
             * The same piece at a new level is a change of mix, not a change
             * of mood — ride it there rather than cross-fading the bed with
             * itself, which would be audible as a dip and a swell for no
             * reason anybody watching could name.
             */
            if (id === bedId) {
                if (bed && wanted !== bedLevel) {
                    bedLevel = wanted;
                    rampTo(bed, musicMuted ? 0 : wanted, CROSSFADE_MS);
                }
                return;
            }
            bedLevel = wanted;
            const previous = bed;
            bedId = id;
            bed = null;
            // Both play for the length of the fade, which is what makes it a
            // change of mood rather than a splice.
            if (previous) fadeOut(previous, CROSSFADE_MS);
            if (!id) return;
            const sound = findSound(id);
            if (!sound) return;
            bed = start(sound, true, end, bedLevel);
        },

        setMusicMuted(muted) {
            musicMuted = muted;
            if (bed) rampTo(bed, muted ? 0 : bedLevel, 240);
        },

        playlist(ids, level = 1) {
            const pool = ids.filter(id => findSound(id));
            house = pool.length ? { ids: pool, level } : null;
            const first = house ? dealFrom(house.ids, null) : null;
            if (first) speaker.music(first, "playlist", level);
        },

        fadeMusic(ms = ENDING_FADE_MS) {
            house = null;
            if (!bed) return;
            fadeOut(bed, ms);
            bed = null;
            bedId = null;
        },

        cue(id) {
            const sound = findSound(id);
            if (!sound) return;
            start(sound, false);

            /*
             * Get the music out of the way of anything worth hearing.
             *
             * A sting is punctuation and plays over the bed happily. A two
             * second effect is a thing in its own right — a door, a howl, a
             * clock — and at full bed level it arrives as texture rather than
             * as an event. So the bed steps back for exactly as long as the
             * sound lasts and then comes back up.
             *
             * Length comes from the catalogue rather than from the element,
             * because `duration` is not known until the file has loaded and the
             * decision has to be made now, as it starts.
             */
            if (sound.seconds * 1000 < DUCK_OVER_MS) return;
            duck(sound.seconds * 1000);
        },

        duckFor(ms) {
            // No floor here, unlike `cue`. A cue is guessing whether a noise is
            // worth ducking for; a caller naming its own length has already
            // decided, and dialogue is worth ducking for at any length.
            if (ms > 0) duck(ms);
        },

        stop() {
            house = null;
            // Everything, not just the bed. A sting still ringing when the show
            // is stopped is the show still making a noise.
            for (const element of [...sounding]) release(element);
            bed = null;
            bedId = null;
        },

        unlock() {
            if (unlocked) return;
            const probe = new Audio(SILENCE);
            probe.volume = 0;
            const attempt = probe.play();
            if (!attempt) {
                unlocked = true;
                blocked = false;
                return;
            }
            attempt.then(() => {
                unlocked = true;
                blocked = false;
                probe.pause();
            }).catch(() => {
                // Still refused. Left as it was: the next gesture tries again,
                // and claiming permission we do not have would turn a silent
                // show into a silent show nobody was warned about.
            });
        },
    };

    return speaker;
}

/**
 * A tenth of a second of nothing.
 *
 * Playing it is the standard way to ask a browser for permission: inside a
 * gesture the play is allowed, and once one element has played the rest are
 * allowed too. Inline rather than a file, because a request that has to arrive
 * before the gesture is over is a request that sometimes does not.
 */
const SILENCE =
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
