<script lang="ts">
    /**
     * The infinite canvas.
     *
     * Layers are DOM, not a `<canvas>`, and that is deliberate: the editor then
     * uses the same mechanism as the HTML export — percentages become pixels,
     * the alpha filters are the same filters — so "what you arranged" and "what
     * you exported" cannot quietly diverge. Panning and zooming is one CSS
     * transform on the world, which the compositor handles for free.
     *
     * Hit testing, though, is ours rather than the DOM's. A cut-out's bounding
     * box is mostly empty — the corners of a circle are half its box — and
     * letting the browser decide meant grabbing pictures from the gap between
     * them. So every layer is `pointer-events: none` and picking is done
     * against the alpha, topmost first.
     *
     * The canvas has no bounds. Frames are the only rectangles that mean
     * anything, and they are drawn behind everything as paper laid on a table.
     */
    import { alphaFilters, cssColor, outlineFilterSvg, pxUnit, textCss } from "./css.js";
    import { boilFilterSvg } from "./painted.js";
    import { findEffect, particlesFor } from "./effects.js";
    import { autoVoiceFor } from "./characterVoice.js";
    import { isSubtitleVoice, normalizeSubtitleVoice } from "../subtitleVoice/index.js";
    import { TROUPE } from "./troupe.js";
    import PaperCursor from "./PaperCursor.svelte";
    import { maskHit } from "./imaging.js";
    import { overlaps, type Frame, type ImageLayer, type Layer, type TextLayer } from "./model.js";
    import { FREE_PAGE, type CollageStudio } from "./studio.js";
    import { readingTime, type Plan } from "./perform.js";
    import { parallaxOf } from "./stage.js";
    import { play, type Playing, type Stagehand } from "./player.js";
    import { createSpeaker } from "./audio.js";
    import { playInteractionSound } from "./interactionSounds.js";
    import { actorForLayer, greetingForActor } from "./characterVoice.js";
    import { clipKeyframes, findClip, recorder, TALK_CLIP } from "./clips.js";
    import { prompter } from "./speech.js";
    import SubtitleVoiceMenu from "../subtitleVoice/SubtitleVoiceMenu.svelte";
    import type { SubtitleVoice } from "../subtitleVoice/index.js";

    interface Props {
        studio: CollageStudio;
        /**
         * Show the export boundary. Off by default — the page is a setting, not
         * something on the canvas, and a sheet of white paper you cannot delete
         * is worse than no indication at all.
         */
        showPage?: boolean;
        /** The eraser is armed: clicking a sticker removes it. */
        erasing?: boolean;
        onContextMenu?: (info: { x: number; y: number; layerId: string | null }) => void;
    }

    let { studio, showPage = false, erasing = false, onContextMenu }: Props = $props();

    /**
     * Selection is the studio's, not this component's. An agent capturing "the
     * three you picked" and a person shift-clicking them have to be talking
     * about the same thing.
     */
    let selectionVersion = $state(0);
    $effect(() => studio.onSelectionChanged(() => selectionVersion++));
    const selectedIds = $derived.by(() => (selectionVersion, studio.selection));
    const isSelected = (id: string) => selectedIds.includes(id);

    /** The document is a plain class; this is the bridge to Svelte's reactivity. */
    let version = $state(0);
    $effect(() => studio.collage.onChanged(() => version++));

    /**
     * Whether a show is running, mirrored into state.
     *
     * The studio is plain TypeScript and its `showing` is a getter, so reading
     * it in a template would be read once and never again. This subscribes.
     */
    const fixedPage = $derived(studio.pagePreset !== FREE_PAGE);

    let showing = $state(false);

    /**
     * Who is currently being drawn as somebody else.
     *
     * A costume change: the part keeps its place, its size and its rotation,
     * and only the picture is swapped. Held here rather than in the document
     * because it is presentational — the same scene played again starts in the
     * first costume, which is what a scene is.
     */
    let worn = $state(new Map<string, string>());
    $effect(() => {
        showing = !!studio.showing;
        return studio.onShowChanged(() => (showing = !!studio.showing));
    });

    /**
     * What colour the room is, while this scene is on.
     *
     * Read off the backdrop rather than asked for. The picture already knows
     * what colour it is — its dominant colour was measured when it loaded, for
     * the quality check — and a scene that had to be told its own colour would
     * be one more thing to get wrong, and one more thing to forget. The agent
     * can still override it when the mood wants something the picture does not
     * say.
     *
     * Mixed well down toward black either way. This is the room, not a second
     * stage: at full strength a pink sky would make the whole window pink and
     * there would be nothing to look at.
     */
    const surround = $derived.by(() => {
        void version;
        const stage = studio.collage.activeStage;
        if (stage?.tint) return stage.tint;
        const backdrop = stage?.backdrop ? studio.images.get(stage.backdrop) : null;
        return backdrop?.colors[0] ?? null;
    });

    /**
     * Where the ACTIVE SCENE'S cast stands — not the whole canvas.
     *
     * `placed` is every layer in the world now, and a camera or a parallax
     * anchored to all of it frames the person's entire universe instead of
     * the scene being played. Only the cast of the stage on screen counts.
     */
    function castBounds(): { x: number; y: number; width: number; height: number } | null {
        const stage = studio.collage.activeStage;
        if (!stage) return null;
        const members = new Set(stage.cast
            .filter(member => member.id !== stage.backdrop)
            .map(member => member.id));
        const boxes = placed.filter(layer => members.has(layer.id)).map(layerBounds);
        if (!boxes.length) return null;
        const minX = Math.min(...boxes.map(box => box.x));
        const minY = Math.min(...boxes.map(box => box.y));
        return {
            x: minX,
            y: minY,
            width: Math.max(...boxes.map(box => box.x + box.width)) - minX,
            height: Math.max(...boxes.map(box => box.y + box.height)) - minY,
        };
    }


    const placed = $derived.by(() => (version, studio.collage.list()));

    /**
     * The cast, slid by depth.
     *
     * Parallax is applied here — to the list everything else reads — rather
     * than as a transform on three containers, because then it is true for
     * every part of the canvas at once: what is drawn, what the pointer hits,
     * where a speech bubble sits, where the handles are. Three transformed
     * containers would have moved the pictures and left the pointer behind.
     *
     * The document is untouched. A layer's real position is where the person
     * put it; this is only where it is standing while the camera is over
     * there. Dragging still commits from `collage.get`, so nothing here can
     * write a parallax offset into the document by accident.
     *
     * Only while a show runs. Parallax on a still camera is nothing, and
     * parallax on a canvas being edited would mean a picture sat somewhere
     * slightly different depending on where the view happened to be.
     */
    /**
     * The cast, wearing whatever they have changed into.
     *
     * The picture is taken from the other layer; everything about where and how
     * big stays with the part. Done before parallax so a swapped costume slides
     * with its plane like anything else.
     */
    const dressed = $derived.by(() => {
        void version;
        if (!worn.size) return placed;
        return placed.map(layer => {
            const other = worn.get(layer.id);
            const wearing = other ? studio.collage.get(other) : null;
            if (!wearing || wearing.kind !== "image" || layer.kind !== "image") return layer;
            // The height follows the new picture's shape at the same width, so
            // a wider costume does not squash: it is the same character,
            // standing where they were.
            const height = wearing.width > 0
                ? (layer.width / wearing.width) * wearing.height
                : layer.height;
            return {
                ...layer,
                src: wearing.src,
                storageKey: wearing.storageKey,
                natural: wearing.natural,
                crop: wearing.crop,
                // Anchored at the feet, so a taller costume grows upward rather
                // than sinking through the floor.
                y: layer.y + layer.height - height,
                height,
            };
        });
    });

    const layers = $derived.by(() => {
        if (!showing || !viewport) return dressed;
        // A scene with no backdrop still has depth: the cast's own bounds
        // stand in as the anchor, so parallax works on the open paper too.
        const floor = stageRect() ?? castBounds();
        if (!floor) return dressed;
        // Measured from the middle of the stage, so a camera framing the scene
        // head-on has every plane exactly where it was placed.
        const anchorX = floor.x + floor.width / 2;
        const anchorY = floor.y + floor.height / 2;
        const cameraX = (viewport.clientWidth / 2 - view.x) / view.zoom;
        const cameraY = (viewport.clientHeight / 2 - view.y) / view.zoom;

        /*
         * The zoom at which the planes agree.
         *
         * Depth needs a neutral point — some zoom at which everything stands
         * exactly where it was placed — and "zoom 1" would be arbitrary. The
         * stage-fit zoom is the natural one: it is roughly where every scene's
         * establishing shot lands, so a scene opens true and only comes apart
         * in depth as the camera pushes in or pulls back from there. Stateless
         * on purpose; a remembered reference would drift across scene changes.
         */
        const restingZoom = Math.min(
            viewport.clientWidth / Math.max(1, floor.width),
            viewport.clientHeight / Math.max(1, floor.height));

        return dressed.map(layer => {
            const share = parallaxOf(studio.collage.planeOf(layer.id));
            if (share === 1) return layer;
            // The offset that makes a plane travel `share` as far across the
            // screen as the middle one does when the camera pans.
            const lag = 1 - share;
            const panX = (cameraX - anchorX) * lag;
            const panY = (cameraY - anchorY) * lag;

            /*
             * And the scale that makes it grow `share` as fast when the camera
             * zooms. A push-in on a real set makes the near bush swell faster
             * than the far trees; a uniform zoom scales all three planes in
             * lockstep and reads as enlarging a photograph. zoom^(share-1) is
             * the plane's growth relative to the middle one — front above 1,
             * back below — applied about the camera's look-point, which is the
             * point a zoom keeps still. Clamped, because a wild zoom should
             * exaggerate the world, not shred it.
             */
            const depth = Math.min(1.8, Math.max(0.55,
                Math.pow(view.zoom / restingZoom, share - 1)));
            const centerX = layer.x + panX + layer.width / 2;
            const centerY = layer.y + panY + layer.height / 2;
            const width = layer.width * depth;
            const height = layer.height * depth;
            return {
                ...layer,
                x: cameraX + (centerX - cameraX) * depth - width / 2,
                y: cameraY + (centerY - cameraY) * depth - height / 2,
                width,
                height,
            };
        });
    });
    const frames = $derived.by(() => (version, studio.collage.listFrames()));

    let view = $state({ x: 0, y: 0, zoom: 0.55 });
    let viewport: HTMLDivElement | null = $state(null);
    let fitted = false;

    type Drag =
        | { mode: "pan"; startX: number; startY: number; originX: number; originY: number }
        /** Every selected layer moves together, each from its own starting point. */
        | { mode: "move"; id: string; startX: number; startY: number; origins: Map<string, { x: number; y: number }> }
        | { mode: "resize"; id: string; originWidth: number; startX: number }
        | { mode: "rotate"; id: string; centre: { x: number; y: number }; startAngle: number; originRotation: number }
        | { mode: "marquee"; startX: number; startY: number; additive: boolean };

    // $state, because the template reads it: the viewport's hover cursor is
    // "and nothing is being dragged". Without it the cursor stayed as it was
    // at the moment a drag began and only caught up on the next unrelated
    // change — the kind of wrongness that reads as the canvas being sticky.
    let drag: Drag | null = $state(null);
    /** The rubber band, in screen coordinates. */
    let marquee = $state<{ x: number; y: number; width: number; height: number } | null>(null);
    /** The text layer being typed into, if any. */
    let editingId = $state<string | null>(null);

    /**
     * On only for the moment after something moves on its own.
     *
     * A permanent transition would put the same easing on a drag, so a layer
     * would trail behind the pointer — the classic way a canvas starts feeling
     * broken. This turns it on for one such move and off again, which is what
     * makes an agent's edits legible: you can see what it changed, instead of
     * finding the picture already different.
     */
    let settling = $state(false);
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const SETTLE_MS = 420;

    $effect(() => studio.onSettle(() => {
        settling = true;
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => (settling = false), SETTLE_MS + 60);
    }));

    /**
     * The scene being played, if any.
     *
     * The browser does the animating: each beat is a keyframe set handed to the
     * Web Animations API, which runs transform and opacity on the compositor —
     * so a beat stays smooth while the main thread is busy, and it demonstrably
     * is. This end only supplies what the player cannot know: which element
     * draws a layer, how big it is, and where to put a speech bubble.
     */
    let scene: Playing | null = null;
    /** Who is speaking and how far through, keyed by layer. */
    let spoken = $state(new Map<string, { line: string; progress: number }>());
    /** Layers that have exited and should stay gone. */
    let gone = $state(new Set<string>());

    /**
     * Who is speaking, and where the bubble goes.
     *
     * Above the speaker and sized against them, so a bubble over a small sprite
     * is a small bubble. It does not follow the beat's motion: the layer is
     * being animated by the compositor and its live position is not readable
     * from here without asking the DOM every frame, which is the one thing
     * handing the animation to the browser was meant to avoid.
     */
    const speaking = $derived.by(() => {
        void version;
        const said: Array<{
            id: string; text: string; shown: string;
            x: number; y: number; size: number; below: boolean;
        }> = [];
        const seen = visibleRect();
        const zoom = view.zoom;

        for (const [id, state] of spoken) {
            const layer = studio.collage.get(id);
            if (!layer || gone.has(id)) continue;

            /*
             * Sized in SCREEN pixels, then converted back to canvas units.
             *
             * The bubble is drawn inside the world, so anything measured in
             * canvas units is multiplied by the zoom before anybody sees it.
             * That made a bubble twice the size when the camera pushed in and
             * a hairline when it pulled back — and worse, the wrap width was
             * being clamped to the *visible* width, which shrinks as you zoom
             * in, so the text got bigger and the column narrower at the same
             * time. Four words a line, in letters an inch tall.
             *
             * A speech bubble is a label, not scenery: it should be the same
             * size on screen wherever the camera is. So everything here is
             * decided in pixels and divided by the zoom on the way out, which
             * is the same trick the selection handles use.
             */
            const onScreenHeight = layer.height * zoom;
            const sizePx = Math.max(15, Math.min(30, onScreenHeight * 0.075));

            /*
             * The box itself is CSS: `width: max-content` up to a `max-width`
             * in ch, which scales with the font by definition. The JS width
             * had already broken once without anyone touching it — removing
             * the ghost layer for stable typing left an absolutely-positioned
             * box inside the zero-width world, which shrinks to min-content:
             * one word per line, in letters an inch tall. max-content ignores
             * the containing block entirely, so that whole class of bug goes.
             *
             * What stays here is only what CSS cannot know: roughly where the
             * edges will land, for the on-screen clamp, and how much headroom
             * the bubble needs. Estimates — 0.55em a character, the same
             * measure the max-width uses — and estimates are fine for clamps.
             */
            const perCharPx = sizePx * 0.55;
            const maxLinePx = sizePx * 0.55 * 34;
            const likelyPx = Math.min(maxLinePx, Math.max(sizePx * 6, state.line.length * perCharPx));
            const lines = Math.max(1, Math.ceil((state.line.length * perCharPx) / maxLinePx));
            const heightPx = lines * sizePx * 1.45 + sizePx * 1.4;

            const size = sizePx / zoom;

            // Kept on the screen, not merely on the stage: the camera is often
            // somewhere other than squarely on the scene, and a bubble
            // obediently inside a half-visible stage is half off the window.
            let x = layer.x + layer.width / 2;
            if (seen) {
                const half = likelyPx / 2 / zoom + size;
                const left = seen.x + half;
                const right = seen.x + seen.width - half;
                x = left <= right ? Math.min(Math.max(x, left), right) : seen.x + seen.width / 2;
            }

            // Below when the whole bubble would not fit above — measured
            // against the real height rather than a guess at one, because a
            // three-line bubble needs three times the headroom of a one-liner
            // and it was the long ones that ran off the top.
            const below = !!seen && layer.y - (heightPx + sizePx) / zoom < seen.y;

            said.push({
                id,
                text: state.line,
                // Revealed as it is spoken. The whole line is in the bubble
                // already, invisible, so it does not grow a word at a time.
                shown: state.line.slice(0, Math.max(1, Math.round(state.line.length * state.progress))),
                x,
                y: below ? layer.y + layer.height : layer.y,
                size,
                below,
            });
        }
        return said;
    });

    /*
     * A clip named "talk", if somebody has recorded one, replaces the
     * programmed talking wobble for every speaker — the whole point of the
     * recorder: perform the imperfection once, and the company inherits it.
     * Runs on `translate`, same as the CSS it replaces, so it never fights a
     * beat's transform; WAAPI outranks the CSS animation, so the class can
     * stay as the fallback for browsers and pages without a recording.
     */
    let talking = new Map<string, Animation>();
    $effect(() => {
        const clip = showing ? findClip(TALK_CLIP) : null;
        const now = new Set(clip ? [...spoken.keys()] : []);
        for (const [id, animation] of talking) {
            if (!now.has(id)) {
                animation.cancel();
                talking.delete(id);
            }
        }
        if (!clip) return;
        for (const id of now) {
            if (talking.has(id)) continue;
            const element = viewport?.querySelector(`[data-layer="${CSS.escape(id)}"]`);
            const layer = studio.collage.get(id);
            if (!element || !layer || typeof element.animate !== "function") continue;
            talking.set(id, element.animate(clipKeyframes(clip, layer.height), {
                duration: clip.seconds * 1000,
                iterations: Infinity,
                easing: "linear",
            }));
        }
    });

    const speaker = createSpeaker();

    /*
     * Let dialogue push the music down.
     *
     * The prompter plays voices through its own queue and knows nothing about
     * beds, so without this the bed sits at full level under every line. The
     * duck is the speaker's, unchanged — the same one a long cue gets.
     */
    $effect(() => {
        prompter.duckWith(ms => speaker.duckFor(ms));
        return () => prompter.duckWith(null);
    });

    /**
     * The voice cast to whoever is speaking, in the scene being played.
     *
     * Read at the moment the line is queued rather than baked into the plan,
     * so re-casting a part between two runs of the same show is heard on the
     * second run. Undefined for anybody not cast with a voice, which the
     * prompter takes as "sequence this bubble but say nothing".
     */
    function voiceFor(id: string) {
        /*
         * The chapter's cast voice first — normalized, because an old save
         * can carry a legacy string id here, and handing that to the synth
         * is a silent play with no error. Failing that, the actor's own
         * automatic voice: the SAME fallback the planner times lines with,
         * so what is planned is what is heard.
         */
        const active = studio.collage.activeStageId;
        const stage = active ? studio.collage.getStage(active) : null;
        const cast = stage?.cast.find(member => member.id === id)?.voice;
        if (isSubtitleVoice(cast)) return normalizeSubtitleVoice(cast);
        return autoVoiceFor(studio.collage.own(id)) ?? undefined;
    }

    /*
     * Buy permission to make a noise, at the first opportunity.
     *
     * A browser refuses audio until the person has interacted with the page,
     * and there is no way to ask in advance — only to try from inside a gesture
     * and see. So every gesture tries, until one is allowed. Capture phase and
     * on the window, because the try has to happen whatever the event was for:
     * pressing Play is a gesture, but so is dragging a picture ten minutes
     * earlier, and by the time a show starts it is too late to ask.
     */
    $effect(() => {
        const ask = () => {
            speaker.unlock();
            if (speaker.ready) stopAsking();
        };
        const stopAsking = () => {
            for (const type of ["pointerdown", "keydown", "touchstart"]) {
                window.removeEventListener(type, ask, true);
            }
        };
        for (const type of ["pointerdown", "keydown", "touchstart"]) {
            window.addEventListener(type, ask, true);
        }
        return stopAsking;
    });

    const stagehand: Stagehand = {
        cue: (id) => speaker.cue(id),
        elementFor: (id) => viewport?.querySelector(`[data-layer="${CSS.escape(id)}"]`) ?? null,
        stateOf(id) {
            const layer = studio.collage.get(id);
            return {
                size: layer?.height ?? 100,
                rotation: layer?.rotation ?? 0,
                opacity: layer && layer.kind === "image" ? layer.style.opacity : 1,
                flip: !!layer?.flip,
            };
        },
        turn(id) {
            const layer = studio.collage.get(id);
            if (layer) studio.collage.update(id, { flip: !layer.flip });
        },
        commit(id, dx, dy) {
            const layer = studio.collage.get(id);
            if (layer) studio.collage.update(id, { x: layer.x + dx, y: layer.y + dy });
        },
        say(id, line, progress) {
            const next = new Map(spoken);
            if (line) next.set(id, { line, progress });
            else next.delete(id);
            spoken = next;
        },
        /*
         * The bubble does not open until the prompter reaches this line.
         *
         * Which is the whole difference: `say` above is drawing, and this is
         * waiting for a turn. Two characters written to speak at the same
         * instant — a `with` beat, a reaction landing on a shout — now take
         * their turns rather than talking over each other, and the bubble
         * follows the voice instead of the beat.
         */
        voice(id, line, ms) {
            return prompter.speak(
                { text: line, voice: voiceFor(id) },
                {
                    fallback: ms,
                    begin: () => stagehand.say(id, line, 0),
                    show: progress => stagehand.say(id, line, progress),
                    end: () => stagehand.say(id, null, 0),
                });
        },
        setGone(id, away) {
            const next = new Set(gone);
            if (away) next.add(id);
            else next.delete(id);
            gone = next;
        },
        camera: (ids, tight, duration) => frame(ids, tight, duration),
        riders(id) {
            // World state: whoever is in this one's hands, chapter or no.
            return studio.collage.listAll()
                .filter(layer => layer.held?.by === id)
                .map(layer => layer.id);
        },
        follow(id, dx, dy, duration) {
            if (!showing || !viewport) return;
            const layer = placed.find(candidate => candidate.id === id);
            if (!layer) return;
            const end = layerBounds(layer);
            end.x += dx;
            end.y += dy;
            const vis = visibleRect();
            if (!vis) return;
            /*
             * Only when the journey actually leaves the frame: a step across
             * the scene needs no camera, and panning for every shuffle would
             * make the audience seasick. When it does leave, the camera pans
             * the same distance at the same zoom — a tracking shot, not a
             * re-framing — so the world visibly travels past.
             */
            const pad = 40 / view.zoom;
            const inside =
                end.x > vis.x + pad && end.x + end.width < vis.x + vis.width - pad &&
                end.y > vis.y + pad && end.y + end.height < vis.y + vis.height - pad;
            if (inside) return;
            void moveTo({
                zoom: view.zoom,
                x: view.x - dx * view.zoom,
                y: view.y - dy * view.zoom,
            }, true, duration);
        },
        effect(id, name, duration) {
            playEffect(id, name);
            // The beat's clock, not the particles': paper riding a line or a
            // move must not stretch the beat, and the flock cleans itself up.
            return new Promise(resolve => setTimeout(resolve, duration));
        },
        take(holder, item, duration) {
            const one = studio.collage.list().find(layer => layer.id === holder);
            const thing = studio.collage.list().find(layer => layer.id === item);
            if (!one || !thing) {
                return new Promise(resolve => setTimeout(resolve, duration));
            }
            /*
             * The hand slot: at the holder's side, half way up — where a
             * carried basket sits. On the flipped side when the holder is
             * flipped, so the thing is in the leading hand, not dragged
             * behind.
             */
            const slotX = one.x + one.width * (one.flip ? -0.18 : 0.68);
            const slotY = one.y + one.height * 0.42 - thing.height / 2;
            return moveThenAttach(item, {
                on: holder,
                x: slotX - one.x,
                y: slotY - one.y,
            }, { x: slotX, y: slotY }, thing, duration, "take");
        },
        drop(holder, item, duration) {
            void holder;
            const thing = studio.collage.list().find(layer => layer.id === item);
            if (!thing) {
                return new Promise(resolve => setTimeout(resolve, duration));
            }
            // Dropped things fall a little before they rest: gravity is the
            // whole meaning of the beat, and on the open paper "the ground"
            // is simply lower than the hand.
            const groundY = thing.y + thing.height * 0.4;
            return moveThenAttach(item, {
                on: undefined,
                x: thing.x,
                y: groundY,
            }, { x: thing.x, y: groundY }, thing, duration, "drop");
        },
        gesture(id, name, duration) {
            const clip = findClip(name);
            const element = viewport?.querySelector(`[data-layer="${CSS.escape(id)}"]`);
            const layer = studio.collage.get(id);
            if (!clip || !element || !layer || typeof element.animate !== "function") {
                // A missing clip still takes its time: narration written
                // against the timetable must not arrive early because a
                // browser had never recorded one.
                return new Promise(resolve => setTimeout(resolve, duration));
            }
            const animation = element.animate(clipKeyframes(clip, layer.height), {
                duration,
                easing: "linear",
                fill: "none",
            });
            gestures.add(animation);
            return animation.finished.then(
                () => void gestures.delete(animation),
                () => void gestures.delete(animation));
        },
        wear(id, becomes) {
            const next = new Map(worn);
            if (becomes) next.set(id, becomes);
            else next.delete(id);
            worn = next;
        },
    };

    /** Speak outside a running show, while keeping its bubble on the same clock. */
    export function greetActor(id: string, voice: SubtitleVoice, greeting: string): Promise<void> {
        return prompter.speak(
            { text: greeting, voice },
            {
                fallback: 900,
                begin: () => stagehand.say(id, greeting, 0),
                show: progress => stagehand.say(id, greeting, progress),
                end: () => stagehand.say(id, null, 0),
            });
    }

    /* Observe every model emission synchronously. Svelte effects batch a new
     * chapter and its first cast into one render, which made that cast look
     * pre-existing and swallowed its greetings. */
    $effect(() => {
        const known = new Map(studio.collage.listStages()
            .map(stage => [stage.id, new Set(stage.cast.map(member => member.id))] as const));
        return studio.collage.onChanged(() => {
            const active = studio.collage.activeStage;
            for (const stage of studio.collage.listStages()) {
                const before = known.get(stage.id) ?? new Set<string>();
                const newcomers = stage.cast.filter(member => !before.has(member.id));
                known.set(stage.id, new Set(stage.cast.map(member => member.id)));
                if (showing || stage.id !== active?.id) continue;
                for (const member of newcomers) {
                    const layer = studio.collage.own(member.id);
                    const actor = layer ? actorForLayer(layer) : null;
                    if (actor && member.voice) {
                        void greetActor(member.id, member.voice, greetingForActor(actor));
                    }
                }
            }
        });
    });

    /**
     * Follow what the agent is doing.
     *
     * An agent working on this canvas is working somewhere, and without this
     * the person watches an empty patch of paper while the set goes up off
     * screen — or, once the agent has sized everything down, watches a scene
     * the size of a stamp because the camera is still framing what it used to
     * be. Both were real: the first thing anybody said about this page was that
     * they could not see what was happening on it.
     *
     * Two different corrections, because they are two different mistakes:
     *
     *  - Something changed that cannot be seen. The view WIDENS to include it,
     *    rather than re-centring on it. Refitting on every change would twitch
     *    the canvas on each of twenty-five pieces from a sheet and drag anybody
     *    off the corner they were looking at; framing the union of what is
     *    already visible with what just moved leaves everything where it is on
     *    screen and only ever pulls back.
     *  - Everything is visible but has become tiny. Then it fits, because at
     *    that point there is nothing on screen worth preserving the framing of.
     *
     * Neither runs during a drag or a show: both of those have a camera of
     * their own, and two things steering it is worse than neither.
     */
    let placedBefore = new Map<string, string>();
    $effect(() => {
        const now = layers;
        // A cheap fingerprint of where everything stands. Rounded, so the
        // sub-pixel drift of an animation settling does not read as an edit.
        const shape = (layer: Layer) =>
            `${Math.round(layer.x)},${Math.round(layer.y)},${Math.round(layer.width)},${Math.round(layer.height)}`;
        const changed = now.filter(layer => placedBefore.get(layer.id) !== shape(layer));
        placedBefore = new Map(now.map(layer => [layer.id, shape(layer)]));

        // `fitted` guards the first paint, where everything is new and fitAll
        // is already about to do a better job than this could.
        if (!changed.length || !fitted || drag || showing || !viewport) return;

        // A moment's wait, so a sheet arriving as twenty-five separate adds —
        // or a batch moving a whole cast — moves the camera once at the end.
        const timer = setTimeout(() => {
            const seen = visibleRect();
            if (!seen) return;

            const boxes = changed.map(layerBounds);
            const hidden = boxes.filter(box => !inside(box, seen));
            if (hidden.length) {
                frameRects([seen, ...hidden], 0.94, true, 700);
                return;
            }

            // Visible, but is any of it big enough to look at? Measured against
            // everything on the canvas rather than against what just moved, so
            // nudging one small prop does not zoom the camera onto it.
            const all = now.map(layerBounds);
            if (!all.length) return;
            const minX = Math.min(...all.map(box => box.x));
            const minY = Math.min(...all.map(box => box.y));
            const maxX = Math.max(...all.map(box => box.x + box.width));
            const maxY = Math.max(...all.map(box => box.y + box.height));
            const share = ((maxX - minX) * (maxY - minY)) / (seen.width * seen.height);
            if (share < 0.22) fitAll({ animate: true, duration: 700 });
        }, 150);
        return () => clearTimeout(timer);
    });

    /**
     * A stable number per layer, for staggering idle motion.
     *
     * Derived from the id rather than random, so a character does not change
     * its rhythm every time the component re-renders — and so two of them never
     * sway in lockstep, which is the thing that makes an idle read as a loop
     * rather than as breathing.
     */
    function layerSeed(id: string): number {
        let hash = 0;
        for (let at = 0; at < id.length; at++) hash = (hash * 31 + id.charCodeAt(at)) | 0;
        return Math.abs(hash);
    }

    /** Is this box wholly within that one? */
    function inside(
        box: { x: number; y: number; width: number; height: number },
        outer: { x: number; y: number; width: number; height: number },
    ): boolean {
        return box.x >= outer.x && box.y >= outer.y &&
            box.x + box.width <= outer.x + outer.width &&
            box.y + box.height <= outer.y + outer.height;
    }

    /**
     * Point the camera at each new scene as the show reaches it.
     *
     * Only while a show is running. Outside one, refitting on a stage change
     * would drag the view away from someone who has just clicked a scene in
     * order to work on a particular corner of it.
     *
     * Reading `showing` and `activeStage` is the whole subscription: the scene
     * changes, the camera follows. The wait is for the stage's own layers to be
     * in the document — framing them a frame earlier frames the scene before.
     */
    $effect(() => {
        void version;
        const stage = showing ? studio.collage.activeStageId : null;
        if (!stage) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            if (!cancelled) frame("all", 1, SCENE_FRAMING_MS, true);
        }, 60);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    });

    /**
     * Long enough to read as the camera finding the scene rather than cutting
     * to it, short enough that it is over before the first beat matters.
     */
    const SCENE_FRAMING_MS = 900;

    // The studio holds the tools' end of this; the clock lives here, where the
    // elements are.
    $effect(() => {
        studio.setPerformer(playScene);
        studio.setStopper(stopScene);
        studio.setSpeaker(speaker);
        return () => {
            studio.setPerformer(null);
            studio.setStopper(null);
            studio.setSpeaker(null);
        };
    });

    export async function playScene(plan: Plan): Promise<void> {
        stopScene();
        scene = play(plan, stagehand);
        await scene.finished;
        scene = null;
    }

    /** Clip animations in flight, cancelled with the scene. */
    const gestures = new Set<Animation>();

    /**
     * Commit an attachment (or a detachment) and animate the seam away.
     *
     * The document changes FIRST — the placement gets its new holder and
     * offsets, so the resolved position jumps to the destination — and the
     * element then animates from where it visually was back to zero. The
     * same commit-then-animate-from-behind trick every travelling beat uses,
     * for the same reason: no frame of flicker, and the document never
     * disagrees with what the audience saw at the end.
     *
     * On the `translate` property, so it cannot fight the transform poses.
     */
    function moveThenAttach(
        item: string,
        placement: { on: string | undefined; x: number; y: number },
        destination: { x: number; y: number },
        was: { x: number; y: number },
        duration: number,
        manner: "take" | "drop",
    ): Promise<void> {
        if (placement.on) {
            // Taken: attachment is WORLD state on the layer, so the lantern
            // is still in the hand when the next chapter opens.
            studio.collage.update(item, {
                held: { by: placement.on, x: placement.x, y: placement.y },
            });
        } else {
            // Dropped: the hand opens, and where it landed is written to the
            // layer, where every position lives.
            studio.collage.update(item, { held: null, x: placement.x, y: placement.y });
        }

        const element = viewport?.querySelector(`[data-layer="${CSS.escape(item)}"]`);
        if (!element || typeof element.animate !== "function") {
            return new Promise(resolve => setTimeout(resolve, duration));
        }
        const fromX = was.x - destination.x;
        const fromY = was.y - destination.y;
        // A reach is one smooth arc; a fall accelerates and lands with the
        // smallest bounce a piece of paper deserves.
        const frames = manner === "take"
            ? [
                { offset: 0, translate: `${fromX.toFixed(1)}px ${fromY.toFixed(1)}px` },
                { offset: 1, translate: "0px 0px" },
            ]
            : [
                { offset: 0, translate: `${fromX.toFixed(1)}px ${fromY.toFixed(1)}px`, easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
                { offset: 0.72, translate: "0px 0px", easing: "ease-out" },
                { offset: 0.86, translate: `0px ${(-Math.abs(fromY) * 0.06 - 4).toFixed(1)}px`, easing: "ease-in" },
                { offset: 1, translate: "0px 0px" },
            ];
        const animation = element.animate(frames, {
            duration,
            easing: manner === "take" ? "cubic-bezier(0.3, 0, 0.2, 1)" : "linear",
            fill: "none",
        });
        gestures.add(animation);
        return animation.finished.then(
            () => void gestures.delete(animation),
            () => void gestures.delete(animation));
    }

    /** The particle flocks in flight, so a stop can sweep the paper up. */
    const flocks = new Set<HTMLElement>();

    /**
     * Throw a canned effect over a cast member: a burst of little paper
     * shapes, choreographed by effects.ts, animated here with WAAPI and
     * swept up when the last bit lands. The flock lives in the world, in
     * canvas units, so it pans and zooms with everything else.
     */
    function playEffect(id: string, name: string) {
        const target = placed.find(layer => layer.id === id);
        const world = viewport?.querySelector(".world");
        const effect = findEffect(name);
        if (!target || !world || !effect) return;

        const flock = document.createElement("div");
        flock.style.cssText =
            `position: absolute; left: ${target.x}px; top: ${target.y}px; ` +
            `width: ${target.width}px; height: ${target.height}px; ` +
            `pointer-events: none; z-index: 1500000;`;
        const total = effect.seconds * 1000;

        for (const bit of particlesFor(name)) {
            const size = Math.max(3, bit.size * target.height);
            const piece = document.createElement("div");
            const shape =
                bit.shape === "star" ? `clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);` :
                // A polygon, not path(): path() clips in raw pixels and these
                // bits are a dozen pixels wide — percentages fit any of them.
                bit.shape === "heart" ? `clip-path: polygon(50% 92%, 12% 55%, 4% 30%, 18% 10%, 38% 12%, 50% 28%, 62% 12%, 82% 10%, 96% 30%, 88% 55%);` :
                bit.shape === "strip" ? "" :
                bit.shape === "sliver" ? "border-radius: 45%;" :
                "border-radius: 50%;";
            const tall = bit.shape === "strip" || bit.shape === "sliver" ? size * 2.4 : size;
            piece.style.cssText =
                `position: absolute; left: ${(bit.x * 100).toFixed(1)}%; top: ${(bit.y * 100).toFixed(1)}%; ` +
                `width: ${size.toFixed(1)}px; height: ${tall.toFixed(1)}px; ` +
                `background: ${bit.color}; opacity: 0; ${shape}`;
            flock.appendChild(piece);
            const dx = bit.dx * target.width;
            const dy = bit.dy * target.height;
            piece.animate([
                { offset: 0, opacity: 0, transform: "translate(0, 0) rotate(0deg) scale(0.4)" },
                { offset: 0.12, opacity: 1, transform:
                    `translate(${(dx * 0.15).toFixed(1)}px, ${(dy * 0.15).toFixed(1)}px) ` +
                    `rotate(${(bit.spin * 0.15).toFixed(0)}deg) scale(1)` },
                { offset: 1, opacity: 0, transform:
                    `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) ` +
                    `rotate(${bit.spin.toFixed(0)}deg) scale(0.7)` },
            ], {
                duration: total * bit.life,
                delay: total * bit.delay,
                easing: "cubic-bezier(0.3, 0, 0.6, 1)",
                fill: "backwards",
            });
        }

        world.appendChild(flock);
        flocks.add(flock);
        setTimeout(() => {
            flock.remove();
            flocks.delete(flock);
        }, total + 80);
    }

    /**
     * Say a page notification the way a CHARACTER says a line.
     *
     * "Picked up where you left off" used to be a chip in a corner — an app
     * talking about itself in app furniture. Here, a random piece on the
     * canvas says it instead, in the exact bubble the cast uses: anchored to
     * the speaker, typed out letter by letter, voiced in the speaker's own
     * automatic voice. Somebody on screen when possible, because a bubble
     * three screens away is a notification nobody gets. Returns false when
     * there is nothing to anchor to, and the caller keeps its corner chip.
     */
    export function announce(text: string): boolean {
        const candidates = placed.filter(layer =>
            layer.kind === "image" && !gone.has(layer.id) && !layer.held);
        if (!candidates.length) return false;
        const seen = visibleRect();
        const onScreen = seen
            ? candidates.filter(layer =>
                layer.x < seen.x + seen.width && layer.x + layer.width > seen.x &&
                layer.y < seen.y + seen.height && layer.y + layer.height > seen.y)
            : [];
        const pool = onScreen.length ? onScreen : candidates;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        void stagehand.voice(pick.id, text, readingTime(text));
        return true;
    }

    export function stopScene() {
        scene?.stop();
        scene = null;
        for (const gesture of [...gestures]) gesture.cancel();
        gestures.clear();
        for (const flock of [...flocks]) flock.remove();
        flocks.clear();
        // The player cancels animations; the prompter is the page's, not the
        // scene's, so it has to be told separately. Without this the lines of
        // an abandoned scene carry on being spoken over an empty stage — and
        // the bubbles cleared on the next line would come back.
        prompter.hush();
        spoken = new Map();
        // Costumes are part of the performance, not of the document: a scene
        // played again starts in the one it opened in.
        worn = new Map();
    }

    /** Layers cut or copied, waiting to be pasted. */
    let clipboard: Layer[] = [];

    /**
     * Commit an edit.
     *
     * The DOM owns the text while it is being typed — Svelte writing to a
     * contenteditable on every keystroke would fight the caret — so the value
     * only comes back into the model here, when editing ends.
     */
    /** New layers open with their placeholder selected; edits do not. */
    let selectOnEdit = false;

    function commitEdit(element: HTMLElement, id: string) {
        if (editingId !== id) return;
        const text = (element.textContent ?? "").trim();
        // Measured before the model changes, in layout pixels — scrollWidth is
        // unaffected by the world's CSS transform, so it is already in canvas
        // units.
        const width = element.scrollWidth;
        const height = element.scrollHeight;
        editingId = null;
        // The caret's own selection would otherwise stay painted on the layer
        // after it stops being editable.
        window.getSelection()?.removeAllRanges();

        const layer = studio.collage.get(id);
        if (!layer) return;
        if (!text) {
            // An empty text layer is invisible and unselectable — nothing but a
            // thing to be confused by later.
            studio.collage.remove(id);
            studio.setSelection([]);
            return;
        }
        if (text !== (layer as TextLayer).text) {
            studio.collage.update(id, { text });
            studio.record("layer-styled", `A person set a text layer to "${text.slice(0, 40)}".`, "human", { id });
        }
        // Hug what it now says, rather than keeping the box the placeholder had.
        studio.collage.fitText(id, width, height);
    }

    /** Focus a freshly editable node, and select its contents if it is new. */
    function focusForEditing(node: HTMLElement) {
        node.focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        // Selecting everything paints the layer with the selection colour, which
        // is only wanted when the content is a placeholder to be typed over.
        if (!selectOnEdit) range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        selectOnEdit = false;
    }

    /** Finish any edit in progress — clicking elsewhere means "done". */
    function stopEditing() {
        if (!editingId) return;
        const node = viewport?.querySelector<HTMLElement>(".layer--editing");
        if (node) commitEdit(node, editingId);
        else editingId = null;
    }

    /**
     * Drop copies of some layers onto the canvas, offset so they are visibly
     * separate from what they came from, and select them — pasting something
     * exactly on top of the original looks like nothing happened.
     */
    function pasteLayers(source: Layer[]) {
        if (!source.length) return;
        const offset = 28;
        const pasted: string[] = [];
        for (const layer of source) {
            const copy = layer.kind === "image"
                ? studio.collage.addImage({
                    src: layer.src,
                    storageKey: layer.storageKey,
                    label: layer.label,
                    natural: layer.natural,
                    crop: layer.crop,
                    x: layer.x + offset,
                    y: layer.y + offset,
                    width: layer.width,
                    rotation: layer.rotation,
                    style: layer.style,
                })
                : studio.collage.addText({
                    text: layer.text,
                    label: layer.label,
                    x: layer.x + offset,
                    y: layer.y + offset,
                    width: layer.width,
                    fontSize: layer.fontSize,
                    fontFamily: layer.fontFamily,
                    fontWeight: layer.fontWeight,
                    align: layer.align,
                    color: layer.color,
                    rotation: layer.rotation,
                });
            // The copy shares the original's bytes in IndexedDB rather than
            // storing them twice; nothing ever rewrites an image in place.
            if (copy.kind === "image") {
                const loaded = studio.images.get(layer.id);
                if (loaded) studio.images.set(copy.id, loaded);
            }
            pasted.push(copy.id);
        }
        studio.setSelection(pasted);
        studio.save();
    }

    function onDoubleClick(event: MouseEvent) {
        const layer = layerAt(event.clientX, event.clientY);
        if (layer?.kind !== "text") return;
        event.preventDefault();
        editingId = layer.id;
    }
    /** A drag that has not moved yet is a click; used to keep selection sane. */
    let moved = false;
    /** The eraser is down and sweeping; ends with the pointer, saves once. */
    let eraseSweep = false;
    let erasedAny = false;

    /**
     * Rub out whatever the pointer is touching, with a little forgiveness.
     *
     * A radius rather than a pixel test, because an eraser is a blunt tool:
     * sweeping along a row of stickers should catch them without having to
     * cross every one dead-centre. The one refinement: deep INSIDE a large
     * piece the mask gets a say, so sweeping across the transparent middle of
     * a backdrop's bounding box does not silently delete the whole room.
     */
    function eraseAt(clientX: number, clientY: number) {
        const point = toCanvas(clientX, clientY);
        const radius = 16 / view.zoom;
        for (const layer of [...layers]) {
            const nearX = Math.max(layer.x, Math.min(point.x, layer.x + layer.width));
            const nearY = Math.max(layer.y, Math.min(point.y, layer.y + layer.height));
            if (Math.hypot(point.x - nearX, point.y - nearY) > radius) continue;
            const inside =
                point.x > layer.x + radius && point.x < layer.x + layer.width - radius &&
                point.y > layer.y + radius && point.y < layer.y + layer.height - radius;
            if (inside && layer.kind === "image") {
                const loaded = studio.images.get(layer.id);
                const hit = maskHit(loaded?.mask ?? null, layer.crop,
                    (point.x - layer.x) / layer.width, (point.y - layer.y) / layer.height);
                if (!hit) continue;
            }
            studio.collage.remove(layer.id);
            erasedAny = true;
        }
        if (erasedAny) studio.setSelection([]);
    }
    /** Last seen pointer position, so a paste can land where you are looking. */
    let pointer: { x: number; y: number } | null = null;

    export function getView() {
        return { ...view };
    }

    /** Screen point to canvas units, for callers placing something where you clicked. */
    export function canvasPoint(clientX: number, clientY: number) {
        return toCanvas(clientX, clientY);
    }

    /**
     * Where something pasted should land: under the pointer if it is over the
     * canvas, otherwise the middle of what is on screen. Pasting into the
     * top-left of an infinite canvas — which is nowhere in particular — is how
     * a paste ends up looking like it did nothing.
     */
    export function pastePoint() {
        if (pointer) return toCanvas(pointer.x, pointer.y);
        if (!viewport) return null;
        const box = viewport.getBoundingClientRect();
        return toCanvas(box.left + box.width / 2, box.top + box.height / 2);
    }

    /**
     * Paste the layers copied inside the app, if there are any.
     *
     * Returns whether it did, so the paste handler can fall back to the system
     * clipboard — the decision needs the clipboard's contents, which only the
     * paste event has.
     */
    export function pasteClipboard(): boolean {
        if (!clipboard.length) return false;
        pasteLayers(clipboard);
        return true;
    }

    /** Put a text layer straight into editing, with its text selected. */
    export function edit(id: string) {
        const layer = studio.collage.get(id);
        if (layer?.kind !== "text") return;
        studio.setSelection([id]);
        // A brand-new layer says "Text"; selecting it means the first keystroke
        // replaces it rather than appending to it.
        selectOnEdit = true;
        editingId = id;
    }

    export function setView(next: { x: number; y: number; zoom: number }) {
        view = { ...next };
        fitted = true;
    }

    /** Fit the view to everything, or centre on nothing when the canvas is empty. */
    export function fitAll(options: { animate?: boolean; duration?: number } = {}) {
        if (!viewport) return;
        const rects = [
            ...frames.map(f => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
            ...layers.map(layerBounds),
        ];
        if (!rects.length) {
            moveTo({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2, zoom: 0.55 }, options.animate);
            return;
        }
        frameRects(rects, 0.82, options.animate ?? false, options.duration);
        fitted = true;
    }

    /**
     * Point the camera at some of the cast, over a length of time the caller
     * chooses.
     *
     * This is what a camera beat comes down to. It takes ids rather than a
     * rectangle because an agent writing a show knows who it wants looked at
     * and does not know where they are standing — and by the time the beat
     * runs they may have walked.
     */
    /**
     * What the camera was last asked to look at.
     *
     * Remembered so a resize can re-ask the same question. The naive fix —
     * refit the whole scene when the window changes — would yank a deliberate
     * close-up back out to a wide shot the moment somebody went fullscreen;
     * re-framing the SAME subjects at the new size keeps the shot the
     * director chose.
     */
    let lastFraming: { ids: string[] | "all"; tight: number; cover: boolean } | null = null;

    export function frame(
        ids: string[] | "all",
        tight = 1,
        duration = 1400,
        cover = false,
    ): Promise<void> {
        if (!viewport) return Promise.resolve();
        lastFraming = { ids, tight, cover };
        const stage = stageRect();

        // "Everything" means the scene, NEVER every layer on the canvas: the
        // world is one open sheet holding every scene and the whole
        // arrangement, and a camera that framed all of it would show the
        // person's universe as a postage-stamp mosaic at every scene change.
        if (ids === "all") {
            /*
             * With no stage rectangle — no page, no backdrop, which is the
             * normal case on the open canvas — the scene IS its cast: frame
             * the active stage's members, loosely. Loose on purpose: a
             * cast-bounds rect hugs the artwork, and a cover-crop of it would
             * take heads off. A touch of air instead, nothing exact — the
             * free camera is framing a place, not measuring it.
             */
            if (!stage) {
                const scene = castBounds();
                if (!scene) return waitOut(duration);
                fitted = true;
                // Roomy on purpose: a cast-bounds rect hugs the artwork, and
                // filling the screen with it reads as pressing your face to
                // the paper. The play breathes when the scene sits in air.
                return frameRects([scene], Math.min(tight, 0.66), true, duration, false);
            }
            /*
             * A cover shot frames the stage alone and lets its edges crop —
             * what a film does, and what kills the dark bars around a 21:9
             * backdrop in a squarer window; including the cast's overhang
             * would zoom out to swallow it and bring the bars back. A
             * containing shot is the opposite deal — everything visible, bars
             * accepted — so it takes the stage AND whoever stands on it, or a
             * figure taller than the backdrop loses their head.
             */
            const rects = cover
                ? [stage]
                : [stage, ...onStageOnly(layers.map(layerBounds), stage)];
            fitted = true;
            return frameRects(rects, tight, true, duration, cover);
        }

        const wanted = onStageOnly(
            layers.filter(layer => ids.includes(layer.id)).map(layerBounds), stage);
        // Nothing to look at is not a reason to lurch somewhere arbitrary; the
        // camera holds where it is and the beat still takes its time.
        if (!wanted.length) return waitOut(duration);
        fitted = true;
        return frameRects(wanted, tight, true, duration);
    }

    /**
     * What counts as "the stage" for the camera.
     *
     * The page, when there is a real one — that is the rectangle everything is
     * composed against and exported to. NOT when the page is free: the free
     * page is a frame around the whole canvas rather than a stage, and framing
     * it pulled the camera back until the scene was a postage stamp in the
     * corner, which is exactly what it looked like.
     *
     * Failing that, the scene's backdrop, which is the most literal answer
     * available — a backdrop IS the stage, painted. Failing that, nothing, and
     * the camera falls back to framing whoever is about.
     */
    function stageRect(): { x: number; y: number; width: number; height: number } | null {
        const page = fixedPage ? frames[0] : null;
        if (page) return { x: page.x, y: page.y, width: page.width, height: page.height };
        const backdrop = studio.collage.activeStage?.backdrop;
        const layer = backdrop ? placed.find(item => item.id === backdrop) : null;
        return layer ? layerBounds(layer) : null;
    }

    /**
     * Drop anything standing off the stage.
     *
     * A layer is off stage when it does not overlap the floor at all — which is
     * exactly how an entrance is staged, so this is the difference between
     * framing the scene and framing the wings. With nothing to measure against
     * every rect counts, because then there is no such thing as off stage.
     */
    function onStageOnly(
        rects: { x: number; y: number; width: number; height: number }[],
        stage: { x: number; y: number; width: number; height: number } | null,
    ) {
        if (!stage) return rects;
        const on = rects.filter(r =>
            r.x < stage.x + stage.width && r.x + r.width > stage.x &&
            r.y < stage.y + stage.height && r.y + r.height > stage.y);
        // Everybody off stage means the scene is off stage, and the honest
        // answer is to look at them rather than at nothing.
        return on.length ? on : rects;
    }

    /**
     * What the camera can actually see, in canvas units.
     *
     * The stage is where things are composed; this is what is on the screen,
     * and they are not the same rectangle whenever the camera is anywhere but
     * squarely on the scene. Anything that must be legible — a speech bubble
     * above all — belongs inside this one.
     */
    function visibleRect() {
        if (!viewport) return null;
        return {
            x: -view.x / view.zoom,
            y: -view.y / view.zoom,
            width: viewport.clientWidth / view.zoom,
            height: viewport.clientHeight / view.zoom,
        };
    }

    function waitOut(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * The shared framing sum.
     *
     * `tight` scales how much of the view the contents fill: 1 is snug inside
     * the margin, below 1 pulls back to leave air, above 1 pushes in past the
     * edges for a close-up that crops.
     */
    function frameRects(
        rects: { x: number; y: number; width: number; height: number }[],
        tight: number,
        animate: boolean,
        duration?: number,
        cover = false,
    ): Promise<void> {
        if (!viewport) return Promise.resolve();
        const minX = Math.min(...rects.map(r => r.x));
        const minY = Math.min(...rects.map(r => r.y));
        const maxX = Math.max(...rects.map(r => r.x + r.width));
        const maxY = Math.max(...rects.map(r => r.y + r.height));
        // Tighter than it was, and allowed to go closer. The old margin and cap
        // were set for editing, where you want to see what is around the thing;
        // watching wants the thing. A cover shot has no margin at all: the
        // point is that nothing but scene reaches the window's edge.
        const margin = cover ? 0 : 48;
        const fit = cover ? Math.max : Math.min;
        const zoom = Math.min(2.6, fit(
            (viewport.clientWidth - margin * 2) / Math.max(1, maxX - minX),
            (viewport.clientHeight - margin * 2) / Math.max(1, maxY - minY),
        )) * Math.max(0.05, tight);
        return moveTo({
            zoom,
            x: viewport.clientWidth / 2 - ((minX + maxX) / 2) * zoom,
            y: viewport.clientHeight / 2 - ((minY + maxY) / 2) * zoom,
        }, animate, duration);
    }

    let flight: number | null = null;

    /**
     * Move the camera, optionally over time.
     *
     * Zoom is interpolated in log space, because zoom is a ratio: stepping
     * linearly from 0.2 to 2 spends most of the flight already zoomed in and
     * lurches at the start. Halving and doubling should take equal time.
     *
     * Any pointer interaction cancels it — a camera that keeps flying while you
     * try to grab something is a camera fighting you.
     */
    function moveTo(
        target: { x: number; y: number; zoom: number },
        animate = false,
        duration = 420,
    ): Promise<void> {
        stopFlight();
        if (!animate || reducedMotion()) {
            view = target;
            return Promise.resolve();
        }
        const from = { ...view };
        const start = performance.now();
        return new Promise(resolve => {
            const step = (now: number) => {
                const t = Math.min(1, (now - start) / duration);
                // The same easing the arrange transition uses, so the canvas has
                // one sense of how things move.
                const eased = 1 - Math.pow(1 - t, 3);
                const zoom = Math.exp(Math.log(from.zoom) + (Math.log(target.zoom) - Math.log(from.zoom)) * eased);
                view = {
                    zoom,
                    x: from.x + (target.x - from.x) * eased,
                    y: from.y + (target.y - from.y) * eased,
                };
                flight = t < 1 ? requestAnimationFrame(step) : null;
                if (t >= 1) {
                    view = target;
                    resolve();
                }
            };
            flight = requestAnimationFrame(step);
        });
    }

    function stopFlight() {
        if (flight === null) return;
        cancelAnimationFrame(flight);
        flight = null;
    }

    function reducedMotion(): boolean {
        return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    $effect(() => {
        // First layout only — refitting on every change would yank the view out
        // from under someone who has just panned somewhere on purpose.
        if (viewport && !fitted && (layers.length || frames.length)) fitAll();
    });

    function layerBounds(layer: Layer) {
        if (!layer.rotation) return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
        const radians = (layer.rotation * Math.PI) / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));
        const width = layer.width * cos + layer.height * sin;
        const height = layer.width * sin + layer.height * cos;
        return {
            x: layer.x + layer.width / 2 - width / 2,
            y: layer.y + layer.height / 2 - height / 2,
            width,
            height,
        };
    }

    /** Degrees from a canvas-space centre to a screen point. */
    function angleTo(centre: { x: number; y: number }, clientX: number, clientY: number): number {
        const point = toCanvas(clientX, clientY);
        return (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI;
    }

    /** Screen coordinates to canvas units. */
    function toCanvas(clientX: number, clientY: number) {
        const rect = viewport!.getBoundingClientRect();
        return {
            x: (clientX - rect.left - view.x) / view.zoom,
            y: (clientY - rect.top - view.y) / view.zoom,
        };
    }

    /**
     * The topmost layer whose *visible pixels* are under the pointer.
     *
     * Front to back, because that is the order a person sees them in: the thing
     * on top is the thing you meant to grab.
     */
    function layerAt(clientX: number, clientY: number): Layer | null {
        const point = toCanvas(clientX, clientY);
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            // Undo the layer's rotation about its own centre, then work in its
            // local box.
            const dx = point.x - (layer.x + layer.width / 2);
            const dy = point.y - (layer.y + layer.height / 2);
            const radians = (-layer.rotation * Math.PI) / 180;
            const cos = Math.cos(radians);
            const sin = Math.sin(radians);
            let localX = dx * cos - dy * sin + layer.width / 2;
            const localY = dx * sin + dy * cos + layer.height / 2;
            // A mirrored layer's pixels are mirrored too, so the hit test has
            // to look at the same side of the mask the eye is looking at.
            if (layer.flip) localX = layer.width - localX;
            if (localX < 0 || localY < 0 || localX > layer.width || localY > layer.height) continue;

            if (layer.kind === "text") return layer;
            const loaded = studio.images.get(layer.id);
            if (maskHit(loaded?.mask ?? null, layer.crop, localX / layer.width, localY / layer.height)) return layer;
        }
        return null;
    }

    function onWheel(event: WheelEvent) {
        // The view is yours even mid-show: the world is one open canvas, and
        // looking around is not touching the play. The camera takes the view
        // back on the next scene it frames.
        event.preventDefault();
        stopFlight();
        const rect = viewport!.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        // Zoom about the cursor: the canvas point under it must not move.
        const factor = Math.exp(-event.deltaY * 0.0015);
        // Bounded like the resizes are: past 2.5× a sticker is a texture
        // study, and below a quarter the world is dust. The camera's own
        // scene framing stays inside this band too.
        const zoom = Math.min(2.5, Math.max(0.25, view.zoom * factor));
        const scale = zoom / view.zoom;
        view = {
            zoom,
            x: pointerX - (pointerX - view.x) * scale,
            y: pointerY - (pointerY - view.y) * scale,
        };
    }

    function onPointerDown(event: PointerEvent) {
        /*
         * Nothing is GRABBABLE during a show — a performance is watched, not
         * handled, and dragging an actor mid-line fights the animation for
         * the same position. But now that shows play on the open canvas, the
         * VIEW is yours even then: the world is one big sheet and you can
         * look wherever you like. The camera keeps directing — it will take
         * the view back on the next scene — but a drag pans, and grabbing
         * nothing else is exactly the difference between moving the camera
         * and moving the play.
         */
        if (showing) {
            if (event.button !== 0 && event.button !== 1) return;
            event.preventDefault();
            try {
                (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            } catch { /* carry on without capture */ }
            stopFlight();
            moved = false;
            drag = { mode: "pan", startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
            return;
        }
        // A stuck sweep must never survive into a fresh gesture: it would eat
        // every pointer move and read as "the canvas will not pan".
        eraseSweep = false;
        stopFlight();
        if (event.button === 2) return; // The context menu handler deals with it.
        if (event.button !== 0 && event.button !== 1) return;

        // A pointer down anywhere but inside the text being typed ends the edit.
        // preventDefault below stops the browser moving focus for us, so this
        // has to be explicit — otherwise the caret and its green selection stay
        // on the layer after you have clicked away.
        if (editingId) {
            const target = event.target;
            const inside = target instanceof Node && (target as Element).closest?.(".layer--editing");
            if (inside) return;
            stopEditing();
        }
        // Stops the drag from turning into a text selection, which is what makes
        // panning across a frame label paint it green instead of moving the view.
        event.preventDefault();
        // Throws if the pointer is not currently down — which a synthetic event
        // never is. Losing capture only costs a drag that ends off the element;
        // letting it throw here would abort the whole gesture.
        try {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch { /* carry on without capture */ }
        moved = false;

        /*
         * The armed eraser owns the whole gesture: press, sweep, release. It
         * never pans and never selects — dragging across the canvas rubs out
         * everything the pointer passes near, like an eraser and not like a
         * scalpel. Panning while armed is middle-mouse or the wheel.
         */
        if (erasing && event.button === 0) {
            eraseSweep = true;
            eraseAt(event.clientX, event.clientY);
            return;
        }

        const target = event.target as HTMLElement;
        if (target.closest("[data-resize]") && selectedIds.length === 1) {
            const layer = studio.collage.get(selectedIds[0]);
            if (layer) {
                drag = { mode: "resize", id: layer.id, startX: event.clientX, originWidth: layer.width };
                return;
            }
        }
        if (target.closest("[data-rotate]") && selectedIds.length === 1) {
            const layer = studio.collage.get(selectedIds[0]);
            if (layer) {
                const centre = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
                drag = {
                    mode: "rotate",
                    id: layer.id,
                    centre,
                    startAngle: angleTo(centre, event.clientX, event.clientY),
                    originRotation: layer.rotation,
                };
                return;
            }
        }

        const layer = event.button === 0 ? layerAt(event.clientX, event.clientY) : null;
        if (layer) {
            if (event.shiftKey) {
                // Toggle, so shift-clicking a picked layer lets it go again.
                studio.setSelection(isSelected(layer.id)
                    ? selectedIds.filter(id => id !== layer.id)
                    : [...selectedIds, layer.id]);
            } else if (!isSelected(layer.id)) {
                studio.setSelection([layer.id]);
            }
            // Dragging any member of a selection drags the whole selection.
            const moving = isSelected(layer.id) ? selectedIds : [layer.id];
            const origins = new Map(moving.map(id => {
                const l = studio.collage.get(id)!;
                return [id, { x: l.x, y: l.y }];
            }));
            drag = { mode: "move", id: layer.id, startX: event.clientX, startY: event.clientY, origins };
            // An armed recorder samples this drag as a performance. Size is
            // the piece's on-screen height, so the gesture is stored relative
            // to the body that made it.
            if (recorder.armed) {
                recorder.samples = [{ at: performance.now(), x: event.clientX, y: event.clientY }];
                recorder.size = layer.height * view.zoom;
            }
            return;
        }

        // Empty space. Plain drag pans, because an infinite canvas with no
        // scrollbars has to stay easy to move around; shift draws a marquee.
        if (event.shiftKey && event.button === 0) {
            drag = { mode: "marquee", startX: event.clientX, startY: event.clientY, additive: event.altKey };
            marquee = { x: event.clientX, y: event.clientY, width: 0, height: 0 };
            return;
        }
        studio.setSelection([]);
        drag = { mode: "pan", startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
    }

    function onPointerMove(event: PointerEvent) {
        pointer = { x: event.clientX, y: event.clientY };
        if (eraseSweep) {
            eraseAt(event.clientX, event.clientY);
            return;
        }
        // A camera still flying while you reach for something is a camera
        // fighting you.
        if (drag) stopFlight();
        if (!drag) {
            // Which layer, not just whether one — it gets outlined.
            hoverId = layerAt(event.clientX, event.clientY)?.id ?? null;
            return;
        }
        const dx = (event.clientX - (drag as any).startX) / view.zoom;
        const dy = (event.clientY - (drag as any).startY) / view.zoom;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            moved = true;
            if (!handlingSound && drag.mode === "move") {
                handlingSound = true;
                playInteractionSound("pickup");
            }
        }

        if (drag.mode === "pan") {
            view = { ...view, x: drag.originX + (event.clientX - drag.startX), y: drag.originY + (event.clientY - drag.startY) };
        } else if (drag.mode === "move") {
            if (recorder.armed && recorder.samples.length) {
                recorder.samples.push({ at: performance.now(), x: event.clientX, y: event.clientY });
            }
            for (const [id, origin] of drag.origins) {
                studio.collage.update(id, { x: origin.x + dx, y: origin.y + dy });
            }
        } else if (drag.mode === "resize") {
            // Half to half-again per grab, same as the agent's tools: a size
            // that wants to change more than that is almost always a slip of
            // the hand, and a deliberate doubling is two short pulls.
            studio.collage.update(drag.id, {
                width: Math.min(drag.originWidth * 1.5,
                    Math.max(Math.max(20, drag.originWidth * 0.5), drag.originWidth + dx)),
            });
        } else if (drag.mode === "rotate") {
            const turned = angleTo(drag.centre, event.clientX, event.clientY) - drag.startAngle;
            let rotation = drag.originRotation + turned;
            // Shift snaps to 15°, which is how anyone gets back to straight.
            if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
            studio.collage.update(drag.id, { rotation });
        } else if (drag.mode === "marquee") {
            marquee = {
                x: Math.min(drag.startX, event.clientX),
                y: Math.min(drag.startY, event.clientY),
                width: Math.abs(event.clientX - drag.startX),
                height: Math.abs(event.clientY - drag.startY),
            };
            const topLeft = toCanvas(marquee.x, marquee.y);
            const bottomRight = toCanvas(marquee.x + marquee.width, marquee.y + marquee.height);
            const box = {
                x: topLeft.x,
                y: topLeft.y,
                width: bottomRight.x - topLeft.x,
                height: bottomRight.y - topLeft.y,
            };
            // Touching, not containing: a band that only caught things wholly
            // inside it is fiddly to use on overlapping cut-outs.
            const caught = layers.filter(layer => overlaps(layerBounds(layer), box)).map(l => l.id);
            studio.setSelection(drag.additive ? [...selectedIds, ...caught] : caught);
        }
    }

    let hoverId = $state<string | null>(null);
    let handlingSound = false;

    /**
     * Dropping a piece onto another attaches it; dragging it off detaches.
     *
     * The rule is the CENTRE of the dragged piece over the target's actual
     * pixels — not any overlap, because pieces on a stage overlap constantly
     * and a rule that attached on touch would weld the whole scene together
     * one accidental nudge at a time. Centre-over-pixels is a gesture you
     * make on purpose.
     */
    function reparentByDrop(dropped: string) {
        const layer = layers.find(candidate => candidate.id === dropped);
        if (!layer) return;
        const holding = studio.collage.own(dropped)?.held ?? null;
        // A holder cannot be handed to somebody else while loaded: one level,
        // no chains, same rule the beats enforce.
        if (studio.collage.listAll().some(candidate => candidate.held?.by === dropped)) return;

        const centreClient = {
            x: (layer.x + layer.width / 2) * view.zoom + view.x,
            y: (layer.y + layer.height / 2) * view.zoom + view.y,
        };
        const box = viewport?.getBoundingClientRect();
        const under = box
            ? layerUnder(centreClient.x + box.left, centreClient.y + box.top, dropped)
            : null;
        // Dropping onto somebody's held basket hands you to the SOMEBODY —
        // one level, no chains, and it is what the gesture meant anyway.
        const holderId = under
            ? (studio.collage.own(under.id)?.held?.by ?? under.id)
            : null;
        const holder = holderId && holderId !== dropped
            ? layers.find(candidate => candidate.id === holderId)
            : null;

        if (holder && holding?.by !== holder.id) {
            // Offsets from the holder's layer — attachment is world state.
            studio.collage.update(dropped, {
                held: { by: holder.id, x: layer.x - holder.x, y: layer.y - holder.y },
            });
            studio.record("layer-moved",
                `"${layer.label}" now rides "${holder.label}".`);
        } else if (!holder && holding) {
            // Dragged clear of everything: let go, and keep its feet.
            studio.collage.update(dropped, { held: null, x: layer.x, y: layer.y });
            studio.record("layer-moved", `"${layer.label}" was set down.`);
        }
    }

    /** The topmost layer whose pixels are under this point, skipping one. */
    function layerUnder(clientX: number, clientY: number, skip: string): Layer | null {
        const point = toCanvas(clientX, clientY);
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            if (layer.id === skip) continue;
            const dx = point.x - (layer.x + layer.width / 2);
            const dy = point.y - (layer.y + layer.height / 2);
            const radians = (-layer.rotation * Math.PI) / 180;
            const cos = Math.cos(radians);
            const sin = Math.sin(radians);
            let localX = dx * cos - dy * sin + layer.width / 2;
            const localY = dx * sin + dy * cos + layer.height / 2;
            if (layer.flip) localX = layer.width - localX;
            if (localX < 0 || localY < 0 || localX > layer.width || localY > layer.height) continue;
            if (layer.kind === "text") return layer;
            const loaded = studio.images.get(layer.id);
            if (maskHit(loaded?.mask ?? null, layer.crop, localX / layer.width, localY / layer.height)) {
                return layer;
            }
        }
        return null;
    }

    function onPointerUp(event: PointerEvent) {
        if (eraseSweep) {
            // One save for the whole sweep, not one per casualty.
            eraseSweep = false;
            if (erasedAny) {
                erasedAny = false;
                studio.save();
            }
            return;
        }
        // A recorded take ends when the hand lets go. Handed to whoever armed
        // the recorder — the menu, which owns naming and keeping it.
        if (recorder.armed && recorder.samples.length > 3) {
            recorder.armed = false;
            recorder.onDone?.([...recorder.samples], recorder.size);
            recorder.samples = [];
        }

        // A watching agent should hear about a move that actually happened, not
        // about every click that selected something.
        // A single piece released after a real drag may have been dropped onto
        // somebody — or carried away from them.
        if (moved && drag && drag.mode === "move" && drag.origins.size === 1) {
            reparentByDrop(drag.id);
        }
        if (handlingSound && drag?.mode === "move") playInteractionSound("putdown");
        handlingSound = false;
        if (moved && drag && (drag.mode === "move" || drag.mode === "resize")) {
            const layer = studio.collage.get(drag.id);
            if (layer) {
                const others = drag.mode === "move" ? drag.origins.size - 1 : 0;
                studio.record(
                    "layer-moved",
                    `A person ${drag.mode === "resize" ? "resized" : "moved"} "${layer.label}"` +
                    `${others > 0 ? ` and ${others} other${others === 1 ? "" : "s"}` : ""}.`,
                    "human",
                    { id: layer.id, x: Math.round(layer.x), y: Math.round(layer.y), width: Math.round(layer.width) });
            }
        }
        if (drag) studio.save(view);
        drag = null;
        marquee = null;
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    }

    function onContextMenuEvent(event: MouseEvent) {
        event.preventDefault();
        const layer = layerAt(event.clientX, event.clientY);
        // Right-clicking outside the selection moves it; right-clicking inside
        // keeps it, so a menu can act on all of them at once.
        if (layer && !isSelected(layer.id)) studio.setSelection([layer.id]);
        onContextMenu?.({ x: event.clientX, y: event.clientY, layerId: layer?.id ?? null });
    }

    /**
     * Going fullscreen mid-show keeps the shot.
     *
     * The camera's position and zoom are in viewport pixels, so a resize —
     * fullscreen most of all, which can double both dimensions at once —
     * leaves the stage sitting small in a corner of the new window. Outside a
     * show the view belongs to the person and is left exactly where they put
     * it; during one, the last framing is asked again at the new size.
     * Debounced, because fullscreen transitions fire a flurry of resizes and
     * the camera should move once, at the end.
     */
    let reframe: ReturnType<typeof setTimeout> | null = null;

    function onViewportResize() {
        if (!showing || !lastFraming) return;
        if (reframe) clearTimeout(reframe);
        reframe = setTimeout(() => {
            if (showing && lastFraming) {
                frame(lastFraming.ids, lastFraming.tight, 350, lastFraming.cover);
            }
        }, 140);
    }

    function onKeyDown(event: KeyboardEvent) {
        // Not every keydown target is an element — it can be the document
        // itself when nothing has focus, and Document has no .matches(). Calling
        // it there throws inside the handler and every shortcut below silently
        // stops working.
        const target = event.target;
        if (target instanceof Element && target.matches("input, textarea, select, [contenteditable]")) return;

        const accel = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();

        if (accel && key === "a") {
            event.preventDefault();
            studio.setSelection(layers.map(l => l.id));
            return;
        }
        if (accel && key === "z") {
            event.preventDefault();
            // Shift+Z redoes, as everywhere; Ctrl+Y too, below.
            if (event.shiftKey ? studio.collage.redo() : studio.collage.undo()) {
                // Ids may have come back or gone away with the step.
                studio.setSelection(studio.selection);
                studio.save();
            }
            return;
        }
        if (accel && key === "y") {
            event.preventDefault();
            if (studio.collage.redo()) {
                studio.setSelection(studio.selection);
                studio.save();
            }
            return;
        }
        if (accel && (key === "c" || key === "x")) {
            if (!selectedIds.length) return;
            event.preventDefault();
            clipboard = selectedIds.map(id => studio.collage.get(id)).filter((l): l is Layer => !!l);
            if (key === "x") {
                for (const layer of clipboard) studio.collage.remove(layer.id);
                studio.setSelection([]);
            }
            return;
        }
        // Ctrl+V is deliberately absent. A keydown cannot see what is on the
        // clipboard, so deciding there meant guessing between our own copied
        // layers and an image from the system — and the guess was wrong in one
        // direction for good: once anything had been copied in the app, an
        // image from outside could never be pasted again. The paste event knows
        // the answer, so the choice is made there. See pasteClipboard.
        if (accel && key === "d") {
            if (!selectedIds.length) return;
            event.preventDefault();
            pasteLayers(selectedIds.map(id => studio.collage.get(id)).filter((l): l is Layer => !!l));
            return;
        }
        // Depth, on the keys every design tool uses for it. These had lived in
        // the right-click menu, which is gone — and ordering is one of the five
        // things a person genuinely does to a picture on a stage, so it needed
        // somewhere to go rather than simply stopping.
        if (accel && (event.key === "]" || event.key === "[")) {
            if (!selectedIds.length) return;
            event.preventDefault();
            for (const id of selectedIds) {
                if (event.key === "]") studio.collage.bringToFront(id);
                else studio.collage.sendToBack(id);
            }
            studio.save();
            return;
        }
        // F for frame, as in every 3D tool. No modifier: it is a view command,
        // it changes nothing, and it is the one people reach for blind.
        if (!accel && key === "f") {
            event.preventDefault();
            fitAll({ animate: true });
            return;
        }
        if (event.key === "Escape") {
            studio.setSelection([]);
            return;
        }
        if (!selectedIds.length) return;

        if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            for (const id of selectedIds) studio.collage.remove(id);
            studio.setSelection([]);
            return;
        }
        const step = event.shiftKey ? 20 : 2;
        const nudge: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
        };
        if (nudge[event.key]) {
            event.preventDefault();
            for (const id of selectedIds) {
                const layer = studio.collage.get(id);
                if (layer) studio.collage.update(id, { x: layer.x + nudge[event.key][0], y: layer.y + nudge[event.key][1] });
            }
        }
    }

    const outlineId = (layer: ImageLayer) => `collage-outline-${layer.id}`;

    /** Layers needing an SVG outline filter, and the markup that defines them. */
    const outlined = $derived.by(() => (version, layers.filter(
        (l): l is ImageLayer => l.kind === "image" && !!l.style.outline && l.style.outline.width > 0)));

    /**
     * Selection and hover are drawn around the picture's own edge rather than
     * around its box. A cut-out's bounding rectangle is mostly empty — boxing
     * a bear tells you about the crop, not the bear — so the same dilate that
     * makes a sticker outline marks what is picked out.
     *
     * These two are shared by every layer rather than generated per layer: with
     * the default userSpaceOnUse primitives the radius is in canvas units, so
     * one filter suits any size. It is divided by the zoom to stay a constant
     * thickness on screen however far in you are.
     */
    const indicatorDefs = $derived.by(() => {
        // Clamped, and that is not cosmetic. feMorphology samples a window of
        // (2r+1)² per pixel, so cost grows with the square of the radius — and
        // dividing by the zoom means zooming out grows it without limit. An
        // uncapped radius froze the renderer outright on the first click.
        const scale = (screenPx: number) => Math.min(6, Math.max(1, screenPx / view.zoom));
        return (
            indicatorFilter("collage-hovered", scale(1.5), "var(--collage-hover-mark)") +
            indicatorFilter("collage-selected", scale(2.5), "var(--collage-select-mark)")
        );
    });

    function indicatorFilter(id: string, radius: number, color: string): string {
        return `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">` +
            `<feMorphology in="SourceAlpha" operator="dilate" radius="${radius.toFixed(3)}" result="spread"/>` +
            `<feFlood flood-color="${color}" result="colour"/>` +
            `<feComposite in="colour" in2="spread" operator="in" result="edge"/>` +
            `<feMerge><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge>` +
            `</filter>`;
    }

    const outlineDefs = $derived(outlined
        .map(l => outlineFilterSvg(outlineId(l), l.style.outline!, l.width, l.height))
        .join(""));

    /** The mark for a layer's state, chained after its own styling. */
    function indicatorFor(id: string): string {
        if (editingId === id) return "";
        if (isSelected(id)) return "url(#collage-selected)";
        // A hovered layer that is already selected keeps the stronger mark.
        return hoverId === id ? "url(#collage-hovered)" : "";
    }

    function imageStyle(layer: ImageLayer): string {
        /*
         * No `filter` here, and that is the performance of the whole theatre.
         *
         * This element is the one that MOVES — the sway, the talk-wobble, the
         * beats' Web Animations all run on it. A url(#…) SVG filter is not
         * compositable, so an element carrying both falls off the compositor
         * entirely: every frame of every animation re-rasterised the full
         * chain — outline dilate, drop shadow, the painterly displacement —
         * on the CPU, per layer. Twelve cut-outs swaying was a slideshow.
         *
         * The filters live on the child instead (filterOf, below), whose own
         * properties change only when the boil steps — so the browser keeps a
         * raster of the filtered artwork and this element just transforms it.
         */
        return [
            `left: ${layer.x}px`,
            `top: ${layer.y}px`,
            `width: ${layer.width}px`,
            `height: ${layer.height}px`,
            `transform: rotate(${layer.rotation}deg)${layer.flip ? " scale(-1, 1)" : ""}`,
            `z-index: ${layer.z}`,
            performedOpacity(layer, layer.style.opacity),
        ].filter(Boolean).join("; ");
    }

    /** The filter chain, for the static child the animated parent transforms. */
    function filterOf(layer: ImageLayer): string {
        const indicator = indicatorFor(layer.id);
        const own = alphaFilters(layer.style, pxUnit, outlineId(layer));
        // Order matters: the indicator dilates whatever the layer already
        // draws, so it wraps a sticker outline rather than hiding under it.
        /*
         * No depth "treatment" here any more. Backdropless scenes briefly
         * dimmed their back plane into silhouettes — and the moment the show
         * started, the person's own arrangement changed colour, which reads
         * as the play repainting their work. Depth in the open comes from
         * paint order and parallax alone; the pieces look the same playing
         * as they do lying on the paper.
         */
        const filters = [own, indicator].filter(Boolean).join(" ");
        return filters ? `filter: ${filters}` : "";
    }

    /**
     * A layer's opacity, or nothing at all once it has left the scene.
     *
     * Only the departure is held here. Everything else about a beat is the
     * animation's business, and writing opacity inline while the Web Animations
     * API is animating it would be two things arguing over one property.
     */
    function performedOpacity(layer: Layer, own: number): string {
        if (gone.has(layer.id)) return "opacity: 0";
        return own !== 1 ? `opacity: ${own}` : "";
    }

    /**
     * The inner element, offset so only the cropped region shows.
     *
     * A silhouette is drawn as a masked, empty element rather than as a
     * background on the image: a background paints *behind* an image's pixels,
     * so the photo would simply cover the colour. Same reason the HTML export
     * emits a <span> in that case.
     */
    /**
     * Which painterly treatment a layer gets, decided by the part it is playing.
     *
     * Nothing is stored for this and no tool sets it, because the document
     * already knows the answer in the only place it could honestly live: the
     * casting. A stage records *who a picture is playing* in `as`, and that —
     * not the file, not the pack, not a flag somebody remembered to set — is
     * what separates an actor from a chair. So the treatment is derived, which
     * means it is right the moment a piece is recast and cannot go stale in a
     * save.
     *
     *   backdrop      the room. Grain, so it survives being stretched, and no
     *                 boil, because a room that wobbles is an earthquake.
     *   cast with `as`  somebody. The full boil — this is the thing the
     *                 audience is meant to read as alive.
     *   cast without  scenery. The same idea, quieter: a bush should breathe,
     *                 not act.
     *
     * Read from every scene, not from the one being shown.
     *
     * The obvious version asked `activeStage`, and it was wrong in the case
     * that matters most: a reloaded document has scenes but no *active* one —
     * the canvas comes back showing everything — so a whole restored play
     * arrived unpainted, and only started breathing once somebody happened to
     * select a scene. Casting is a property of the document, not of what the
     * canvas is currently pointed at, so this asks the document.
     *
     * A picture nothing has cast stays plain, which keeps the line that
     * matters: a free canvas of dropped photographs is not a play, and a
     * hand-painted boil on a photograph reads as a broken decoder.
     *
     * The two treatments land on different elements, and that split is forced:
     * `.painted` rocks `rotate` and `translate`, which is exactly what the sway
     * and the talking bob already do on the figure. Three animations on one
     * element and the most specific rule simply wins — a character would stop
     * breathing the moment it was painted. So the paint goes on the picture
     * inside, one level down, where nothing else is moving, and the grain stays
     * on the figure because it needs a pseudo-element and an <img> cannot have
     * one. Neither is animated, so neither collides.
     */
    function isBackdrop(id: string): boolean {
        return studio.collage.listStages().some(stage => stage.backdrop === id);
    }

    function grainOf(layer: Layer): string {
        void version;
        return isBackdrop(layer.id) ? "grained" : "";
    }

    /*
     * Troupe stickers wear the paint even before any scene casts them. The
     * idle page boils these exact pieces, and the person now drags them onto
     * the canvas by hand — a sticker that was alive on the welcome screen and
     * falls dead the moment it becomes real reads as something breaking.
     * Dropped PHOTOS stay plain (a hand-painted boil on a photograph reads as
     * a broken decoder), and troupe stage slices stay still even uncast — a
     * room that boils is an earthquake. Matched by label, which is the troupe
     * id and survives a save where the src does not.
     */
    const TROUPE_STICKERS = new Set(
        TROUPE.filter(piece => piece.kind === "scenery" || piece.kind === "actor")
            .map(piece => piece.id));

    function paintOf(layer: Layer): string {
        void version;
        if (isBackdrop(layer.id)) return "";
        // The first casting wins. A picture playing somebody in one scene and
        // standing in as furniture in another is still a performer, and the
        // alternative — changing temperament as scenes are selected — would
        // read as the drawing losing interest.
        const parts = studio.collage.listStages()
            .flatMap(stage => stage.cast.filter(part => part.id === layer.id));
        if (!parts.length) {
            if (!TROUPE_STICKERS.has(layer.label)) return "";
            // The same deal the idle page cuts its props: a third calm, a
            // third standard, a third lively, stable per piece — so the
            // canvas between shows looks exactly like the welcome scatter it
            // grew out of, not like a subdued copy of it.
            const temperament = ["painted--calm", "", "painted--lively"][layerSeed(layer.id) % 3];
            return `painted painted--boil ${temperament}`.trim();
        }
        return parts.some(part => part.as)
            ? "painted painted--boil"
            : "painted painted--boil painted--calm";
    }

    function croppedStyle(layer: ImageLayer): string {
        const w = Math.max(0.0001, layer.crop.width);
        const h = Math.max(0.0001, layer.crop.height);
        const base = [
            `width: ${(100 / w).toFixed(3)}%`,
            `height: ${(100 / h).toFixed(3)}%`,
            `left: ${(-layer.crop.x / w * 100).toFixed(3)}%`,
            `top: ${(-layer.crop.y / h * 100).toFixed(3)}%`,
        ];
        if (layer.style.silhouette) {
            const url = `url("${layer.src}")`;
            base.push(
                `background: ${cssColor(layer.style.silhouette)}`,
                `-webkit-mask-image: ${url}`,
                `mask-image: ${url}`,
                `-webkit-mask-size: 100% 100%`,
                `mask-size: 100% 100%`);
        }
        return base.join("; ");
    }

    function textStyle(layer: TextLayer): string {
        // The same dilate traces glyphs, so selecting a headline outlines the
        // letters rather than drawing a rectangle around them.
        const indicator = indicatorFor(layer.id);
        return [
            `left: ${layer.x}px`,
            `top: ${layer.y}px`,
            `width: ${layer.width}px`,
            `font-size: ${layer.fontSize}px`,
            `transform: rotate(${layer.rotation}deg)${layer.flip ? " scale(-1, 1)" : ""}`,
            `z-index: ${layer.z}`,
            indicator ? `filter: ${indicator}` : "",
            performedOpacity(layer, 1),
            ...textCss(layer),
        ].filter(Boolean).join("; ");
    }

    function frameStyle(frame: Frame): string {
        return [
            `left: ${frame.x}px`,
            `top: ${frame.y}px`,
            `width: ${frame.width}px`,
            `height: ${frame.height}px`,
        ].join("; ");
    }

    /**
     * A free page hugs whatever is on the canvas, so drawing it as a sheet says
     * nothing — there is no edge to be surprised by. A chosen paper size is the
     * opposite: it crops, so it is drawn.
     */

    /**
     * Under everything, always — computed rather than assumed.
     *
     * "Send to back" hands out `lowest - 1`, so layer z-indices go negative and
     * keep going. A fixed number on the page would sooner or later be above one
     * of them, and the page would paint over a sticker.
     */
    const pageZ = $derived(Math.min(0, ...layers.map(l => l.z)) - 1);

    /** The resize handle only makes sense on exactly one layer. */
    const single = $derived.by(() =>
        (version, selectedIds.length === 1 ? studio.collage.get(selectedIds[0]) : null));

    const groupBounds = $derived.by(() =>
        (version, selectedIds.length > 1 ? studio.collage.contentBounds(selectedIds) : null));
</script>

<svelte:window onkeydown={onKeyDown} onresize={onViewportResize} />

<!-- The armed eraser, drawn rather than pointed. The real cursor is hidden by
     the rule below; this one boils like everything else made of paper.
     Hotspot near the bottom-left corner: that is the pink end that meets the
     page, and it is what the sweep should rub out. -->
<PaperCursor
    src="/cursors/eraser-64.png"
    hotspot={{ x: 0.16, y: 0.84 }}
    size={46}
    active={erasing && !showing}
/>

<div
    class="viewport"
    class:viewport--over={!!hoverId && !drag}
    class:viewport--showing={showing}
    class:viewport--erasing={erasing && !showing}
    style:--surround={surround
        ? `color-mix(in srgb, ${surround} 22%, #0E1013)`
        : "#14161a"}
    bind:this={viewport}
    role="application"
    aria-label="Theater stage"
    tabindex="-1"
    style:background-position="{view.x}px {view.y}px"
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerleave={() => (pointer = null)}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    oncontextmenu={onContextMenuEvent}
    ondblclick={onDoubleClick}
>
    <div class="world" style:transform="translate({view.x}px, {view.y}px) scale({view.zoom})">
        {#if showPage}
            {#each frames as frame (frame.id)}
                <!-- Drawn as an actual sheet, not just a rule. It is the edge
                     every export is cropped to, so "where does the picture
                     stop" has to be answerable without opening a panel — and a
                     white sheet against the checkerboard is also the only
                     honest preview of the transparent/white choice. -->
                <div
                    class="page"
                    class:page--transparent={fixedPage && frame.background === "transparent"}
                    style={frameStyle(frame)}
                    style:z-index={pageZ}
                    style:border-width="{1.5 / view.zoom}px"
                    style:background-color={fixedPage && frame.background !== "transparent" ? frame.background : undefined}
                    style:background-size="{16 / view.zoom}px {16 / view.zoom}px"
                    style:background-position="0 0, 0 {8 / view.zoom}px, {8 / view.zoom}px {-8 / view.zoom}px, {-8 / view.zoom}px 0"
                >
                    <span class="page__label" style:font-size="{11 / view.zoom}px" style:top="{-20 / view.zoom}px">
                        {frame.name}
                    </span>
                </div>
            {/each}
        {/if}

        {#each layers as layer (layer.id)}
            {#if layer.kind === "image"}
                <figure
                    class="layer {grainOf(layer)}"
                    data-layer={layer.id}
                    class:layer--selected={selectedIds.length > 1 && isSelected(layer.id)}
                    class:layer--settling={settling}
                    class:layer--alive={showing && !gone.has(layer.id)}
                    class:layer--speaking={showing && spoken.has(layer.id)}
                    style:--sway="{(layerSeed(layer.id) % 1400) + 3200}ms"
                    style:--sway-at="-{layerSeed(layer.id) % 2000}ms"
                    style:--paint-seed={layerSeed(layer.id) % 1000}
                    style:--paint-at="-{(layerSeed(layer.id) % 90) / 100}s"
                    style:--grain-seed={layerSeed(layer.id) % 1000}
                    style={imageStyle(layer)}
                >
                    <!-- Cropping and filtering cannot live on the same box:
                         overflow clips a child's drop-shadow to the layer
                         rectangle. Filter the already-cropped artwork from an
                         unclipped wrapper so shadows and selection marks have
                         room to breathe. -->
                    <span class="layer__filter" style={filterOf(layer)}>
                        <span class="layer__crop">
                            {#if layer.style.silhouette}
                                <span class={paintOf(layer)} role="img" aria-label={layer.label} style={croppedStyle(layer)}></span>
                            {:else}
                                <img class={paintOf(layer)} src={layer.src} alt={layer.label} style={croppedStyle(layer)} draggable="false" />
                            {/if}
                        </span>
                    </span>
                </figure>
            {:else}
                <p
                    class="layer layer--text"
                    class:layer--selected={selectedIds.length > 1 && isSelected(layer.id)}
                    class:layer--settling={settling}
                    class:layer--editing={editingId === layer.id}
                    contenteditable={editingId === layer.id ? "plaintext-only" : "false"}
                    data-layer={layer.id}
                    style={textStyle(layer)}
                    {@attach node => { if (editingId === layer.id) focusForEditing(node); }}
                    onblur={event => commitEdit(event.currentTarget as HTMLElement, layer.id)}
                    onkeydown={event => {
                        if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
                            event.preventDefault();
                            (event.currentTarget as HTMLElement).blur();
                        }
                        // Everything else is typing, not a canvas shortcut.
                        event.stopPropagation();
                    }}
                >{layer.text}</p>
            {/if}
        {/each}

        <!-- No box. The selection is drawn around the picture itself, so this
             is only somewhere to hang the handles. -->
        {#if single && editingId !== single.id}
            <div
                class="handles"
                style:left="{single.x}px"
                style:top="{single.y}px"
                style:width="{single.width}px"
                style:height="{single.height}px"
                style:transform="rotate({single.rotation}deg)"
            >
                <!-- Sizes and borders are divided by the zoom because these sit
                     inside the scaled world; a plain 1px border would thin to
                     nothing as you zoom out, which is what made the rotate
                     handle read as a faint ring. -->
                <span class="handle handle--resize" data-resize
                    style:width="{11 / view.zoom}px" style:height="{11 / view.zoom}px"
                    style:border-width="{1.5 / view.zoom}px"
                    style:border-radius="{2 / view.zoom}px"></span>
                <span class="handle handle--rotate" data-rotate
                    style:width="{13 / view.zoom}px" style:height="{13 / view.zoom}px"
                    style:border-width="{2 / view.zoom}px"
                    style:top="{-20 / view.zoom}px"></span>
            </div>
        {/if}

        {#each speaking as line (line.id)}
            <div
                class="bubble"
                class:bubble--below={line.below}
                style:left="{line.x}px"
                style:top="{line.y}px"
                style:font-size="{line.size}px"
            >
                <!-- The full text is present but invisible, so the bubble is
                     the size it will end at and does not grow a word at a time
                     while it is being read. -->
                <!-- One flow of text, laid out once from the whole line; the
                     untyped tail is merely invisible. The old version stacked
                     a hidden full copy under a visible prefix, which fixed the
                     SIZE but not the SHAPE: text-wrap balances line breaks
                     against total content, so the prefix wrapped differently
                     from the finished line and words hopped between lines as
                     they were typed. Invisible-in-place cannot re-wrap,
                     because nothing about the layout ever changes. -->
                <span>{line.shown}</span><span class="bubble__rest" aria-hidden="true">{line.text.slice(line.shown.length)}</span>
                <SubtitleVoiceMenu text={line.text} voiceKey={line.id} />
            </div>
        {/each}
    </div>

    <!-- Filter definitions only; nothing here is drawn. One dilate pass per
         outlined layer, plus the two shared selection and hover marks. -->
    <svg class="defs" aria-hidden="true" focusable="false">{@html indicatorDefs + outlineDefs + boilFilterSvg()}</svg>

    {#if marquee}
        <div
            class="marquee"
            style:left="{marquee.x}px"
            style:top="{marquee.y}px"
            style:width="{marquee.width}px"
            style:height="{marquee.height}px"
        ></div>
    {/if}
</div>

<style>
    /* The marks for hover and selection.
     *
     * Deliberately not the brand green: a sticker outline is a thing you can
     * put ON a picture, and it defaults to green too, so a green selection and
     * a green outline were the same mark meaning two different things. A cool
     * grey reads as chrome — the editor talking about the picture rather than
     * something the picture is wearing — and stays out of the way of a collage
     * that is itself full of colour. Hover is the lighter of the two, so the
     * pair separate by weight as well as by thickness.
     *
     * Declared here because the filter defs live inside .viewport and pick
     * these up through the cascade.
     */
    .viewport {
        --collage-hover-mark: #9DA8B6;
        --collage-select-mark: #6F8098;
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        touch-action: none;
        cursor: var(--cursor-grab, grab);
        /* A drag is a drag, never a text selection. Without this, panning across
           a frame label paints it with the selection colour. */
        user-select: none;
        -webkit-user-select: none;
        background-color: var(--surface-page);
        background-image: radial-gradient(circle, color-mix(in srgb, var(--border-subtle) 80%, transparent) 1px, transparent 1px);
        /*
         * The grid pans but does not zoom.
         *
         * It is painted on the viewport, which sits outside the scaled world,
         * so the spacing had to be multiplied by the zoom to make it appear to
         * scale — and a grid that scales is a grid that claims to measure
         * something. This one does not: it is the texture of the table the work
         * is lying on. Tied to the zoom it dissolved into a grey wash on the way
         * in and spread into stripes on the way out, neither of which told you
         * anything the work itself did not.
         *
         * The position still follows the pan, which is real feedback: the table
         * moves under your hand.
         */
        background-size: 24px 24px;
    }

    /* Lifted on a dark canvas — a mid grey that reads as a mark against white
       paper reads as a shadow against a dark one. */
    :global(:root[data-theme="dark"]) .viewport {
        --collage-hover-mark: #7E8B9B;
        --collage-select-mark: #A9B6C6;
    }

    /*
     * A show does NOT change the room.
     *
     * The play happens on the same open paper the person was just arranging —
     * that is the whole promise of the world-canvas — so the background stays
     * exactly what it was: same colour, same dots. The surround used to go
     * dark like a cinema, and it read as the page being replaced by a
     * different page. Only the editing furniture goes: handles, marquee,
     * page label — hidden below, not unmounted, so nothing rebuilds when the
     * show ends.
     */
    .viewport--showing {
        cursor: var(--cursor-default, default);
    }

    .viewport--showing :is(.handles, .marquee, .page__label) {
        opacity: 0;
    }

    /* The page keeps its fill — it is the floor the scene stands on — but
       loses the outline that says "this is where the export crops". */
    .viewport--showing .page {
        box-shadow: none;
        outline: none;
    }

    .viewport:active {
        cursor: var(--cursor-grabbing, grabbing);
    }

    .viewport--over,
    .viewport--over:active {
        cursor: var(--cursor-move, move);
    }

    /*
     * The armed eraser announces itself on every pixel, hit or miss.
     *
     * The paper eraser rather than a crosshair, because the tool is a thing you
     * hold: a crosshair says "aim", and this tool is rubbing out. The hotspot
     * 3,29 is the leading corner — the pink end that meets the paper — so what
     * disappears is what the corner touched, not what the middle of the picture
     * covered.
     *
     * Two declarations on purpose. The first is the one every browser takes;
     * the second upgrades it to the 2x image where image-set() is understood,
     * and is ignored where it is not. Both end in `crosshair`, so a browser
     * that refuses the PNG still shows the old behaviour rather than an arrow.
     */
    .viewport--erasing,
    .viewport--erasing.viewport--over,
    .viewport--erasing:active {
        /*
         * Hidden, because PaperCursor is drawing it instead — a real cursor
         * cannot boil, and two erasers on screen at once is worse than either.
         *
         * The url() cursor stays as the line above it: if scripting is off or
         * the component has not mounted, `cursor: none` alone would leave a
         * bare pointerless canvas, which is the one outcome worse than a
         * static eraser.
         */
        cursor: url("/cursors/eraser-32.png") 3 29, crosshair;
        cursor: none;
    }

    .world {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: 0 0;
        /* Children are positioned in canvas units; the transform does the rest. */
        will-change: transform;
    }

    /* Just a boundary. No fill, no shadow, nothing to grab — it marks what
       will be exported and is otherwise not there. */
    /* A neutral edge, not the brand green: it was a pale green hairline on a
       pale green canvas, which is how an export came to be cropped by an edge
       nobody could see. */
    .page {
        position: absolute;
        border-style: dashed;
        border-color: color-mix(in srgb, var(--text-muted) 65%, transparent);
        pointer-events: none;
    }

    /* The standard checkerboard, because "transparent" has to look like
       something. Four gradients, no image to load. */
    .page--transparent {
        --a: color-mix(in srgb, var(--text-muted) 16%, transparent);
        background-image:
            linear-gradient(45deg, var(--a) 25%, transparent 25%),
            linear-gradient(-45deg, var(--a) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, var(--a) 75%),
            linear-gradient(-45deg, transparent 75%, var(--a) 75%);
    }

    .page__label {
        position: absolute;
        left: 0;
        color: var(--text-muted);
        font-family: var(--font-family-body);
        white-space: nowrap;
    }

    .layer {
        position: absolute;
        margin: 0;
        overflow: visible;
        pointer-events: none;
    }

    .layer__filter,
    .layer__crop {
        position: absolute;
        display: block;
        inset: 0;
    }

    .layer__filter { overflow: visible; }
    .layer__crop { overflow: hidden; }

    /* Only while a layout settles. Named properties, never `all`: transitioning
       `filter` here would make the selection outline fade in every time. */
    .layer--settling {
        transition-property: left, top, width, height, transform;
        transition-duration: 0.42s;
        transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    }

    @media (prefers-reduced-motion: reduce) {
        .layer--settling {
            transition-duration: 0.01s;
        }
    }

    .layer__crop > :global(img),
    .layer__crop > :global(span) {
        position: absolute;
        display: block;
        max-width: none;
        -webkit-user-drag: none;
    }

    .layer--text {
        overflow: visible;
        white-space: pre-wrap;
        text-wrap: pretty;
    }

    /* Layers are pointer-events: none so hit testing can run against the alpha.
       The one being typed into has to take the pointer back, or there is no
       caret to place. */
    .layer--editing {
        pointer-events: auto;
        user-select: text;
        -webkit-user-select: text;
        cursor: var(--cursor-text, text);
        /* One thin mark. It sits alone — the handles box is suppressed while
           editing — so it does not need to shout. */
        outline: 1px solid var(--accent-brand);
        outline-offset: 3px;
    }

    /* Selection and hover are SVG filters traced around the artwork's own
       edge — see indicatorDefs. Nothing is outlined with a rectangle. */

    /* No border — just somewhere to hang the handles, since the selection
       itself is drawn around the artwork. */
    .handles {
        position: absolute;
        pointer-events: none;
    }

    .defs {
        position: absolute;
        width: 0;
        height: 0;
        pointer-events: none;
    }

    /**
     * A speech bubble, sitting above whoever is speaking.
     *
     * Drawn with a real border and a rotated square for the tail rather than a
     * filter or a triangle of shadows — the same lesson as the toasts: CSS
     * filters chain, so a stack of them is a stack of full-size buffers, and a
     * border is the one way to get a stroke that is the same width all the way
     * round including under the tail.
     */
    .bubble {
        position: absolute;
        z-index: 2147483000;
        translate: -50% calc(-100% - 0.7em);
        /* Sized by its own text: as wide as the line wants, wrapping at a
           reading measure. max-content is load-bearing — an absolute box in
           the zero-width world otherwise shrinks to min-content, one word a
           line. ch scales with the font, so no script has to keep up. */
        width: max-content;
        max-width: 34ch;
        padding: 0.55em 0.8em;
        border: 0.09em solid var(--text-primary);
        border-radius: 0.9em;
        background: var(--surface-page-elevated, #fff);
        color: var(--text-primary);
        font-family: var(--font-family-body);
        line-height: 1.25;
        text-align: center;
        text-wrap: balance;
        pointer-events: none;
        /* Overshoots and settles. A bubble is somebody starting to talk, and
           the small pop is the only cue the canvas gives that it has begun —
           a linear fade would have it simply be there, which reads as a label
           rather than as speech. Scaled from the tail, so it grows out of the
           speaker's head instead of out of its own middle. */
        transform-origin: bottom center;
        animation:
            bubble-in 0.44s cubic-bezier(0.34, 1.56, 0.64, 1),
            bubble-paper 0.42s step-end infinite;
        --paint-wash-strength: 0.14;
        --paint-scale: 1.8;
    }

    :global(html.painterly) .bubble {
        background-image:
            paint(painterly-wash),
            linear-gradient(var(--surface-page-elevated, #fff), var(--surface-page-elevated, #fff));
    }

    @keyframes bubble-paper {
        0%, 100% { --paint-frame: 0; }
        33.333% { --paint-frame: 1; }
        66.666% { --paint-frame: 2; }
    }

    @keyframes bubble-in {
        from { opacity: 0; scale: 0.6; translate: -50% calc(-100% - 0.1em); }
        60% { opacity: 1; }
        to { opacity: 1; scale: 1; translate: -50% calc(-100% - 0.7em); }
    }

    /* Under the speaker, for anybody standing at the top of the stage. The
       tail moves to the top edge with it, or it would point at nothing. */
    .bubble--below {
        translate: -50% 0.7em;
        transform-origin: top center;
        animation-name: bubble-in-below, bubble-paper;
    }

    @keyframes bubble-in-below {
        from { opacity: 0; scale: 0.6; translate: -50% 0.1em; }
        60% { opacity: 1; }
        to { opacity: 1; scale: 1; translate: -50% 0.7em; }
    }

    .bubble--below::after {
        top: -0.31em;
        bottom: auto;
        border: 0.09em solid var(--text-primary);
        border-bottom: 0;
        border-right: 0;
    }

    @media (prefers-reduced-motion: reduce) {
        .bubble { animation: none; }
    }

    /* The tail: a square of the same border, rotated, with its inner two edges
       hidden by the bubble's own background sitting on top of it. */
    .bubble::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -0.31em;
        width: 0.55em;
        height: 0.55em;
        translate: -50% 0;
        rotate: 45deg;
        border: 0.09em solid var(--text-primary);
        border-top: 0;
        border-left: 0;
        background: var(--surface-page-elevated, #fff);
    }

    /* The untyped remainder of the line: present, laid out, invisible. The
       bubble is born at its final size AND its final shape — visibility does
       not participate in layout decisions, so no character can move once the
       line has been set. */
    .bubble__rest {
        visibility: hidden;
    }

    /*
     * Nothing on a stage is ever completely still.
     *
     * Between beats the whole scene held its breath — every character a cut-out
     * with no motion of its own — so a long line played over what was, to the
     * eye, a photograph with text on it. This is the smallest thing that fixes
     * that: a slow rock of about a degree, offset per character so they are
     * never in step, and stopped entirely for anybody who has asked for less
     * motion.
     *
     * Only while the show runs, and only for what is on stage. It must not
     * fight a beat: a beat animates the element itself through the Web
     * Animations API, which replaces `transform` outright — so this rocks a
     * wrapper property that nothing else touches, and the two compose instead
     * of cancelling. (Liveliness OUTSIDE the show is the painterly boil's
     * job, on the picture inside — see paintOf.)
     */
    .layer--alive {
        /*
         * The `rotate` property, not `transform`.
         *
         * The layer's own rotation is a `transform`, and a beat animates
         * `transform` through the Web Animations API — which REPLACES the
         * property outright while it runs. Rocking a different property means
         * the two compose instead of one cancelling the other, so a character
         * keeps breathing through its own walk.
         */
        animation: sway var(--sway, 4s) ease-in-out infinite alternate;
        animation-delay: var(--sway-at, 0ms);
    }

    @keyframes sway {
        from { rotate: -0.55deg; }
        to { rotate: 0.55deg; }
    }

    /*
     * A speaker moves while they talk.
     *
     * A quick small bob on the `translate` property — which composes with the
     * sway on `rotate` and with a beat's own `transform`, so somebody can bob
     * while walking and both read. Percentage translate is relative to the
     * element's own size, so a mouse bobs a mouse-sized amount.
     */
    .layer--speaking {
        animation: talking 0.42s ease-in-out infinite alternate;
    }

    .layer--alive.layer--speaking {
        animation:
            sway var(--sway, 4s) ease-in-out infinite alternate,
            talking 0.42s ease-in-out infinite alternate;
        animation-delay: var(--sway-at, 0ms), 0ms;
    }

    @keyframes talking {
        from { translate: 0 0; }
        to { translate: 0 -0.9%; }
    }

    @media (prefers-reduced-motion: reduce) {
        .layer--alive,
        .layer--speaking { animation: none; }
    }

    /* The rubber band is the act of selecting, so it wears the selection's
       colour rather than the brand's. */
    .marquee {
        position: absolute;
        z-index: 5;
        pointer-events: none;
        border: 1px solid var(--collage-select-mark);
        border-radius: 2px;
        background: color-mix(in srgb, var(--collage-select-mark) 12%, transparent);
    }

    .handle {
        position: absolute;
        border-style: solid;
        pointer-events: auto;
    }

    /* White square, marked edge — reads as "drag this corner". Same colour as
       the outline it belongs to; handles in a different colour from the
       selection they sit on read as two separate things. */
    .handle--resize {
        right: 0;
        bottom: 0;
        translate: 50% 50%;
        background: var(--surface-panel);
        border-color: var(--collage-select-mark);
        cursor: var(--cursor-resize, nwse-resize);
    }

    /* Filled disc with a white ring: a solid dot is legible at any zoom and
       against any picture, where an outlined ring disappeared into both. */
    .handle--rotate {
        left: 50%;
        translate: -50% 0;
        border-radius: 50%;
        background: var(--collage-select-mark);
        border-color: var(--surface-panel);
        cursor: var(--cursor-grab, grab);
    }

    .handle--rotate:active {
        cursor: var(--cursor-grabbing, grabbing);
    }
</style>
