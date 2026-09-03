<script lang="ts">
    /**
     * The collage page.
     *
     * Two ways in, one document. A person chooses pieces from the troupe,
     * drags them around and right-clicks to change them; an agent calls the
     * WebMCP tools. Neither is a wrapper around the other — they both mutate
     * the same `Collage`, so each can continue what the other arranged.
     *
     * The page itself is almost nothing: a canvas, a right-click menu, and one
     * button in the corner. Everything that acts on a single picture is at the
     * pointer; everything global is behind the button.
     */
    import { onDestroy, onMount } from "svelte";
    import CollageCanvas from "$lib/collage/CollageCanvas.svelte";
    import PackShelf from "$lib/collage/PackShelf.svelte";
    import { playInteractionSound } from "$lib/collage/interactionSounds.js";
    import ShowOverlay from "$lib/collage/ShowOverlay.svelte";
    import StageBar from "$lib/collage/StageBar.svelte";
    import AgentActivity from "$lib/collage/AgentActivity.svelte";
    import Toasts, { createToasts } from "$lib/collage/Toasts.svelte";
    import { createStudio, download, FREE_PAGE } from "$lib/collage/studio";
    import { createCollageTools } from "$lib/collage/tools";
    import { registerTools } from "$lib/webmcp";
    import { briefing, invitation } from "$lib/collage/invitation";
    import { said } from "$lib/collage/typed";
    import { prompter } from "$lib/collage/speech";
    import { boilFilterSvg, loadPainterly, PAINTERLY_CSS } from "$lib/collage/painted";
    import { hint } from "$lib/collage/hint";
    import { TROUPE } from "$lib/collage/troupe";
    import { idleSet } from "$lib/collage/idleSet";
    import { takeNames } from "$lib/collage/audio";
    import { notifyAgentActivity } from "$lib/room/activity";
    import SubtitleVoiceMenu from "$lib/subtitleVoice/SubtitleVoiceMenu.svelte";
    import type { SubtitleVoice } from "$lib/subtitleVoice";

    const studio = createStudio();
    const collage = studio.collage;
    const toasts = createToasts();

    /**
     * Say a page line the way the CAST says lines: a bubble on a random
     * piece in the scene, typed out and voiced. Falls back to a corner chip
     * only when the canvas has nobody to speak it. Errors and progress
     * spinners stay chips — a spinner cannot be a sentence, and an error
     * read aloud by a cheerful mushroom is the wrong messenger.
     */
    function announce(text: string) {
        if (!canvas?.announce(text)) toasts.push(text);
    }

    let version = $state(0);
    /** The eraser is armed: clicking any sticker — canvas or strewn — removes it. */
    let erasing = $state(false);

    /*
     * Picking the eraser up off its shelf.
     *
     * Where the drag started, while the pointer is still down on the sticker.
     * Null the rest of the time, which is also how `armMove` knows the gesture
     * is one it started rather than a pointer wandering across.
     */
    let armFrom: { x: number; y: number } | null = $state(null);
    /** The drag already armed it, so the click that follows must not toggle. */
    let armHandled = false;

    function armDown(event: PointerEvent) {
        if (event.button !== 0 || erasing) return;
        armFrom = { x: event.clientX, y: event.clientY };
    }

    function armMove(event: PointerEvent) {
        if (!armFrom || erasing) return;
        // Far enough that a shaky click is not a drag. Once it is picked up
        // the pointer belongs to the canvas, so nothing is captured here —
        // capturing would send every later move back to a button that is no
        // longer on screen.
        if (Math.hypot(event.clientX - armFrom.x, event.clientY - armFrom.y) < 12) return;
        armFrom = null;
        armHandled = true;
        erasing = true;
    }

    function armUp() {
        armFrom = null;
    }
    let canvas = $state<CollageCanvas | null>(null);
    let fileInput: HTMLInputElement | null = $state(null);
    let restored = $state(false);

    $effect(() => collage.onChanged(() => version++));

    /*
     * Say so when the show is going to be silent.
     *
     * The browser refuses audio until the person has interacted with the page,
     * and an agent can start a show on a page nobody has touched — so the one
     * time this matters is also the one time there is nobody to notice. Said
     * once per page load: a bubble on every scene change would be worse than
     * the silence.
     */
    let warnedSilent = false;
    $effect(() => studio.onShowChanged(() => {
        if (!studio.showing || warnedSilent || studio.speaker.ready) return;
        warnedSilent = true;
        announce("Click anywhere to turn the sound on — the browser keeps it off until you do.");
    }));

    const layers = $derived.by(() => (version, collage.list()));
    const frames = $derived.by(() => (version, collage.listFrames()));
    const empty = $derived(!layers.length && !frames.length);

    /**
     * House music for the idle menu: one of the menu-theatre beds, dealt
     * once per visit so returning does not always open on the same bars.
     * It waits for the first gesture (the browser refuses audio before one),
     * plays only while the stage is idle, and lets itself down the moment
     * real work appears — a show brings its own bed, and somebody arranging
     * stickers deserves the room, not a loop.
     */
    const MENU_BEDS = takeNames("menu-theatre");
    const MENU_BED = MENU_BEDS[Math.floor(Math.random() * MENU_BEDS.length)] ?? null;
    let menuMusic = false;
    $effect(() => {
        if (!restored) return;
        if (empty && !menuMusic && MENU_BED) {
            const start = () => {
                menuMusic = true;
                studio.speaker.music(MENU_BED, "loop");
            };
            if (prompter.touched) start();
            else return prompter.onTouch(start);
        } else if (!empty && menuMusic) {
            menuMusic = false;
            studio.speaker.fadeMusic();
        }
    });

    onMount(async () => {
        prompt = invitation(location.origin);

        // Not awaited: the props are on screen before this resolves, and they
        // are meant to be — the boil arriving a beat late is a picture that
        // starts breathing, where blocking on it would be nine holes.
        loadPainterly();

        // Restore before registering tools: an agent that calls describe on the
        // first turn should see the collage the person left, not an empty one.
        try {
            const count = await studio.restore();
            if (count) {
                announce(`Picked up where you left off — ${count} layer${count === 1 ? "" : "s"}.`);
                canvas?.fitAll();
            }
        } catch (error) {
            console.warn("[collage] could not restore the saved collage:", error);
        }
        const shared = new URL(location.href).searchParams.get("play");
        if (shared) {
            try {
                const response = await fetch(`/api/plays/${encodeURIComponent(shared)}`);
                const play = await response.json();
                if (!response.ok) throw new Error(play.error || "The play could not be loaded.");
                await studio.loadPublished!(play.doc);
                toasts.push(`Opened “${play.title}”.`);
                canvas?.fitAll();
            } catch (error) {
                toasts.push(error instanceof Error ? error.message : "The shared play could not be loaded.", "error");
            }
        }
        restored = true;
        // Only onto a genuinely empty stage, and computed on the client so the
        // arrangement is fresh each visit without upsetting hydration.
        if (!collage.listAll().length && TROUPE.length) {
            scatter = strewn();
        }
        // Always ticking, not only when the page opened empty: the canvas can
        // BECOME empty again (a clear, the agent's theater_clear), and the
        // restock guards itself against a non-empty stage anyway.
        scheduleRestock();
        // Wrapped once here rather than in each tool: an agent's work should be
        // visible, and that should not be fourteen call sites.
        await registerTools(createCollageTools(studio).map(tool => ({
            ...tool,
            execute: (args: unknown, options?: { signal?: AbortSignal }) => {
                notifyAgentActivity(tool.name, args);
                return tool.execute(args, options);
            },
        })));
    });

    // The page's own sentence, shown on the empty stage. Same string the help
    // panel offers, from the same place, so they cannot say different things.
    let prompt = $state(invitation("https://webmcp.needle.tools"));
    /**
     * "Copied" as a little speech bubble at the click, gone a moment later.
     *
     * The whole empty page is the copy button: the prompt is the only thing
     * here to take, so any click that is not a drag, a prop or a control takes
     * it. The feedback appears where the hand is, in the same bubble language
     * everything else on this stage speaks.
     */
    /** The note itself, named rather than written into the markup. */
    const COPIED_NOTE =
        "Copied! Now paste it into ChatGPT — or any AI agent in your browser — and the show begins.";
    const COPIED_VOICE: SubtitleVoice = { speed: 1, age: 0.5, tone: 0.5 };

    /**
     * Three lines, three voices, and they wait for each other.
     *
     * The page is the first thing anybody hears this app do, so it is also
     * where the promise is made: the props talk, one at a time, in voices that
     * are not the same voice. A different one each — the title in a
     * storyteller, the instruction in the warmest of them, the invitation in
     * something light enough to be a prop enjoying itself — because three
     * bubbles in one voice would demonstrate the opposite of what the whole
     * page is claiming.
     *
     * Defined together so each line and its three-parameter voice stay paired.
     */
    const PAGE_LINES: Array<{
        say: string; voice: SubtitleVoice; titleCard?: boolean; band: number; aside: boolean;
    }> = [
        { say: "Agent Theater", voice: { speed: 0.8, age: 0.72, tone: 0.32 }, titleCard: true, band: 25, aside: true },
        {
            // Punctuation is the pause syntax: the typed reveal and the voice
            // both breathe after . — ! ? — so short sentences pace themselves.
            say: "Arrange us however you like. Then hand your browser's AI agent " +
                "the line below — click anywhere to copy it. " +
                "It reads your scene and puts on the show. Have fun!",
            voice: { speed: 1, age: 0.5, tone: 0.58 }, band: 47, aside: true,
        },
        {
            say: "Drag me somewhere! The piles down there deal more of us.",
            voice: { speed: 1.15, age: 0.18, tone: 0.7 }, band: 78, aside: false,
        },
    ];

    let copied = $state<Array<{ id: number; x: number; y: number; tilt: number }>>([]);
    let copiedSeq = 0;
    let pressedAt: { x: number; y: number } | null = null;
    let pageEl: HTMLDivElement | null = $state(null);
    let inviteEl: HTMLParagraphElement | null = $state(null);

    function copyFromPage(event: MouseEvent) {
        if (!empty || !restored || !pageEl) return;
        const target = event.target as HTMLElement;
        if (!pageEl.contains(target)) return;
        // Props are for dragging, controls are for pressing; neither is this.
        if (target.closest(".strewn__prop, button, a, input, [data-edit-trigger], .panel")) return;
        // Only the prompt and a hand's width around it. Click-anywhere turned
        // every stray click into a clipboard write, which is the page grabbing
        // at you; click-the-thing is you taking it.
        if (!inviteEl) return;
        const reach = 48;
        const near = inviteEl.getBoundingClientRect();
        if (event.clientX < near.left - reach || event.clientX > near.right + reach ||
            event.clientY < near.top - reach || event.clientY > near.bottom + reach) return;
        // A pan that happened to end where it started is a click; a real pan
        // is not, and copying at the end of one would be baffling.
        if (pressedAt && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > 6) return;

        // What lands on the clipboard is the full briefing, not the watermark:
        // the short line is for the person glancing, the long one is for the
        // agent it gets pasted into.
        void navigator.clipboard.writeText(briefing(location.origin));
        /*
         * Cut whatever the props were saying.
         *
         * The one place the queue is allowed to be jumped, and it should be:
         * this is an answer to something the person just did, and an answer
         * that waits for a prop to finish its sentence is not an answer. It
         * also removes the only way two of these could overlap — clicking
         * twice — because the second hush kills the first note's line.
         */
        prompter.hush();
        // One stamp per click, each with its own lean and its own clock —
        // clicking three times leaves three notes fading on the paper, which
        // reads as the page enjoying the attention rather than correcting it.
        const box = pageEl.getBoundingClientRect();
        const stamp = {
            id: ++copiedSeq,
            x: event.clientX - box.left,
            y: event.clientY - box.top,
            tilt: (Math.random() - 0.5) * 16,
        };
        copied = [...copied, stamp];
        // Long enough to actually read the instruction in it. The stamp is
        // not a confirmation tick any more; it is the next step.
        setTimeout(() => {
            copied = copied.filter(note => note.id !== stamp.id);
        }, 7000);
    }

    /**
     * Troupe pieces strewn across the empty stage.
     *
     * Decoration, emphatically not document. If these were real layers they
     * would be in every save, every piece_list, and the "NEXT:" guidance would
     * tell the agent to cast them — the empty state would stop being empty
     * without anybody having done anything. So they live only in this
     * component, the agent cannot see them (show_look renders the document,
     * not the DOM), and the first real piece of work fades them out.
     *
     * They also do the empty state's actual job better than text can: the
     * page's claim is "a whole troupe is already waiting", and here is some
     * of it, visibly waiting.
     */
    let scatter = $state<Array<{
        /** Render identity: a new key remounts the prop, which plays its
         *  entrance — how a swapped or conjured piece pops rather than blinks. */
        key: string;
        id: string; file: string; x: number; y: number;
        size: number; tilt: number; drift: number; delay: number;
        /** Which painterly temperament this prop was given, if any. */
        paint?: string;
        paintSeed?: number;
        paintAt?: number;
        /** A line this prop speaks. The page's copy, worn by the scenery. */
        say?: string;
        /** Which voice actually says it out loud. */
        sayVoice?: SubtitleVoice;
        sayTilt?: number;
        /** Position in the entrance queue: bubbles appear one after another. */
        sayOrder?: number;
        /** Seconds per full swing cycle, and where in it this bubble starts. */
        swingCycle?: number;
        swingAt?: number;
        /** The bubble that is the page title rather than an explanation. */
        titleCard?: boolean;
        /** height / width, measured on load — the bubble anchor scales with it. */
        aspect?: number;
        /** ms before this prop makes its entrance. */
        enterAt?: number;
        /**
         * The person has had their hands on this one. A touched prop is an
         * arrangement, not decoration, and the restock must not tidy it away.
         */
        touched?: boolean;
    }>>([]);

    /*
     * Mirror the scatter where the tools can read it. The strewn props are
     * deliberately not document, so without this the agent starts every
     * conversation describing an empty canvas at a person who just spent a
     * minute arranging ferns.
     */
    $effect(() => {
        idleSet.props = empty
            ? scatter.map(prop => ({
                piece: prop.id.split("#")[0],
                x: Math.round(prop.x),
                y: Math.round(prop.y),
                touched: prop.touched ?? false,
            }))
            : [];
    });

    /** The prop being dragged, and where the pointer last was. */
    let heldProp = $state<{ id: string; lastX: number; lastY: number } | null>(null);
    let propSeq = 0;

    /**
     * How big a strewn prop is, everywhere one is made.
     *
     * One function because the size is dealt three times — the opening
     * scatter, the restock, and a conjured piece — and the first version had
     * the same literal in all three, which is how one of them ends up
     * different forever. Sized against the viewport, so the props read as a
     * set on a stage rather than confetti on a desktop monitor, with a floor
     * for phones.
     */
    function propSize(): number {
        /*
         * In vmin, not pixels. A pixel size is frozen at spawn: resize the
         * window and the props stay whatever they were — tiny in fullscreen,
         * crowding a shrunken window. A vmin width is re-resolved by CSS on
         * every layout, so the stickers scale with the page and no resize
         * listener has to exist. The 72px floor lives in the CSS max(),
         * where it belongs.
         *
         * A narrow spread on purpose: these sizes become real layers when the
         * scatter is adopted, and a wide random range read as pieces from
         * different toy boxes rather than one set.
         */
        return 10.5 + Math.random() * 3;
    }

    /**
     * Only things that read as props may be strewn.
     *
     * The pool used to be the whole troupe, which includes backdrops and the
     * full-width scene slices — so a filing cabinet the size of a door or an
     * entire bedroom midground could land on the welcome page. Scenery and
     * actors are the toys; the stages stay in the drawer.
     */
    function propPool() {
        return TROUPE.filter(piece => piece.kind === "scenery" || piece.kind === "actor");
    }

    /**
     * Push overlapping props apart until everybody has room.
     *
     * Plain circle relaxation in pixels: each prop is roughly a disc of half
     * its size, and any pair standing closer than their radii allow is pushed
     * apart along the line between them. Speakers only slide sideways — their
     * height is the reading order, and the one thing this must not do is
     * shuffle the sentences.
     */
    function separate(props: typeof scatter, movable?: Set<string>) {
        if (typeof window === "undefined") return props;
        const w = window.innerWidth;
        const h = window.innerHeight;
        // The same resolution CSS will perform: vmin against the current
        // window, with the same floor.
        const px = (vmin: number) => Math.max(72, (vmin / 100) * Math.min(w, h));
        const out = props.map(prop => ({ ...prop }));
        for (let pass = 0; pass < 40; pass++) {
            let crowded = false;
            for (let a = 0; a < out.length; a++) {
                for (let b = a + 1; b < out.length; b++) {
                    const one = out[a];
                    const two = out[b];
                    const dx = ((two.x - one.x) / 100) * w;
                    const dy = ((two.y - one.y) / 100) * h;
                    const gap = Math.hypot(dx, dy) || 1;
                    const room = ((px(one.size) + px(two.size)) / 2) * 0.92;
                    if (gap >= room) continue;
                    crowded = true;
                    const push = (room - gap) / 2;
                    const ux = dx / gap;
                    const uy = dy / gap;
                    for (const [prop, sign] of [[one, -1], [two, 1]] as const) {
                        if (movable && !movable.has(prop.key)) continue;
                        prop.x = Math.min(94, Math.max(4, prop.x + ((ux * push * sign) / w) * 100));
                        if (!prop.say) {
                            prop.y = Math.min(90, Math.max(6, prop.y + ((uy * push * sign) / h) * 100));
                        }
                    }
                }
            }
            if (!crowded) break;
        }
        return out;
    }

    /**
     * The set slowly restocks itself.
     *
     * Every few seconds one quiet prop — never a speaker, never the one in
     * your hand — is exchanged for a piece that is not on the floor yet. The
     * remount plays the entrance, so the change reads as stagehands tidying
     * between glances rather than pixels flickering. It also quietly shows off
     * the drawer: leave the page open and most of the troupe will have walked
     * across it.
     */
    let restock: ReturnType<typeof setTimeout> | null = null;

    function scheduleRestock() {
        restock = setTimeout(() => {
            swapOneProp();
            scheduleRestock();
        }, 3500 + Math.random() * 2500);
    }

    function swapOneProp() {
        if (!empty || heldProp || !scatter.length) return;
        // Never a prop the person has touched: they put it there, and a page
        // that swaps out something you placed is a page that undoes you.
        const quiet = scatter.filter(prop => !prop.say && !prop.touched);
        if (!quiet.length) return;
        const used = new Set(scatter.map(prop => prop.file));
        const fresh = propPool().filter(piece => !used.has(piece.file));
        if (!fresh.length) return;
        const victim = quiet[Math.floor(Math.random() * quiet.length)];
        const piece = fresh[Math.floor(Math.random() * fresh.length)];
        scatter = scatter.map(prop => prop.id === victim.id
            ? {
                ...prop,
                key: `prop-${++propSeq}`,
                id: piece.id,
                file: piece.file,
                size: propSize(),
                tilt: (Math.random() - 0.5) * 22,
                aspect: undefined,
            }
            : prop);
    }

    /**
     * A double-click conjures a prop out of the drawer, where you clicked.
     *
     * The empty canvas does nothing on double-click otherwise, and a page that
     * hands you toys when you knock on it teaches the one thing the empty
     * state has to teach: this surface is for putting things on.
     */
    function conjureProp(event: MouseEvent) {
        if (!empty || !restored || !pageEl || !TROUPE.length) return;
        const target = event.target as HTMLElement;
        if (!pageEl.contains(target)) return;
        if (target.closest(".strewn__prop, button, a, input, [data-edit-trigger], .panel")) return;
        const box = pageEl.getBoundingClientRect();
        const used = new Set(scatter.map(prop => prop.file));
        const pool = propPool();
        const drawer = pool.filter(piece => !used.has(piece.file));
        const from = drawer.length ? drawer : pool;
        const piece = from[Math.floor(Math.random() * from.length)];
        const key = `prop-${++propSeq}`;
        scatter = separate([...scatter, {
            key,
            id: `${piece.id}#${propSeq}`,
            file: piece.file,
            x: Math.min(97, Math.max(3, ((event.clientX - box.left) / box.width) * 100)),
            y: Math.min(95, Math.max(5, ((event.clientY - box.top) / box.height) * 100)),
            size: propSize(),
            tilt: (Math.random() - 0.5) * 22,
            drift: 5 + Math.random() * 4,
            delay: Math.random() * 6,
            touched: true,
        // Only the newcomer gives way: the pieces already on the floor are
        // where somebody put them, or at least where they have settled.
        }], new Set([key]));
    }

    onDestroy(() => {
        if (restock) clearTimeout(restock);
    });

    function grabProp(event: PointerEvent, id: string) {
        // The canvas underneath pans on this same event; a grabbed prop is not
        // a pan.
        event.stopPropagation();
        event.preventDefault();
        // The armed eraser rubs out strewn props too — one tool, one meaning,
        // whichever kind of sticker is under it.
        if (erasing) {
            scatter = scatter.filter(prop => prop.id !== id);
            return;
        }
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        heldProp = { id, lastX: event.clientX, lastY: event.clientY };
        playInteractionSound("pickup");
        scatter = scatter.map(prop => prop.id === id ? { ...prop, touched: true } : prop);
    }

    function dragProp(event: PointerEvent, id: string) {
        if (!heldProp || heldProp.id !== id) return;
        const host = (event.currentTarget as HTMLElement).parentElement;
        if (!host) return;
        const box = host.getBoundingClientRect();
        const dx = ((event.clientX - heldProp.lastX) / Math.max(1, box.width)) * 100;
        const dy = ((event.clientY - heldProp.lastY) / Math.max(1, box.height)) * 100;
        heldProp = { id, lastX: event.clientX, lastY: event.clientY };
        scatter = scatter.map(prop => prop.id === id
            ? {
                ...prop,
                x: Math.min(97, Math.max(3, prop.x + dx)),
                y: Math.min(95, Math.max(5, prop.y + dy)),
            }
            : prop);
    }

    function dropProp() {
        if (heldProp) playInteractionSound("putdown");
        heldProp = null;
    }

    /**
     * The idle arrangement is a starting point, not a screensaver.
     *
     * The moment real work begins — a sticker dragged from a pack, a photo
     * dropped, the agent's first piece — the strewn props are ADOPTED: each
     * becomes a real layer exactly where it stood, at the size it was seen.
     * Nothing on the page blinks out because somebody started; the scene you
     * were idly looking at IS the first draft of the canvas, and the agent
     * can see it, the eraser can rub it out, and a scene can cast it.
     *
     * The speech bubbles do not come along — they were the page's copy, not
     * the story's.
     *
     * And it must be INVISIBLE. The strewn overlay stays rendered, at full
     * strength, while the twin layers are added underneath it — same spot,
     * same seen size, same tilt — and only once every twin exists does the
     * overlay come off, in one frame. The idle stage does not change when
     * work begins; only the prompt and the intro bubbles go away.
     */
    let adopting = $state(false);

    async function adoptScatter() {
        if (adopting || !scatter.length) return;
        adopting = true;
        const props = scatter;
        try {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const zoom = canvas?.getView().zoom ?? 1;
            for (const prop of props) {
                const centre = canvas?.canvasPoint((prop.x / 100) * w, (prop.y / 100) * h);
                if (!centre) continue;
                // The same resolution the CSS performed: vmin with a 72px floor,
                // then into canvas units so the piece keeps its SEEN size.
                const width = Math.max(72, (prop.size / 100) * Math.min(w, h)) / zoom;
                const height = width * (prop.aspect ?? 1);
                const { layer } = await studio.addImage(prop.file, {
                    label: prop.id.split("#")[0],
                    removeBackground: false,
                    slice: false,
                    x: centre.x - width / 2,
                    y: centre.y - height / 2,
                    width,
                    by: "human",
                });
                // The tilt is part of where it stood. addImage has no
                // rotation option, so it is set the moment the twin exists.
                if (prop.tilt) studio.collage.update(layer.id, { rotation: prop.tilt });
            }
            studio.save();
        } finally {
            // The reveal: overlay off, twins already beneath it.
            scatter = [];
            adopting = false;
        }
    }

    $effect(() => {
        void version;
        if (!empty && restored && scatter.length && !adopting) void adoptScatter();
    });

    /*
     * And the other direction: a canvas that becomes empty again — cleared by
     * the person or by the agent's theater_clear — gets a beat of genuinely
     * bare stage and then a fresh random scatter wanders on. Cleared is not
     * broken; it is the next starting point.
     */
    $effect(() => {
        void version;
        if (!empty || !restored || scatter.length || !TROUPE.length) return;
        const timer = setTimeout(() => {
            if (empty && !scatter.length) scatter = strewn();
        }, 1400);
        return () => clearTimeout(timer);
    });

    function strewn() {
        // A ring around the middle, jittered — the middle belongs to the
        // invitation, and a ring reads as "arranged by someone" where a
        // uniform scatter reads as "spilled".
        /*
         * A cast list, not a lucky dip: mostly scenery with a couple of
         * actors, so the floor reads as a set with characters on it rather
         * than nine unrelated objects from four different worlds.
         */
        const pool = propPool();
        const actors = pool.filter(piece => piece.kind === "actor").sort(() => Math.random() - 0.5);
        const scenery = pool.filter(piece => piece.kind === "scenery").sort(() => Math.random() - 0.5);
        const picked = [...actors.slice(0, 2), ...scenery.slice(0, 7)]
            .sort(() => Math.random() - 0.5)
            .slice(0, 9);
        const clamp = (value: number, low: number, high: number) =>
            Math.min(high, Math.max(low, value));
        const strewn = picked.map((piece, index) => {
            const angle = (index / picked.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
            return {
                key: `prop-${++propSeq}`,
                // One after another, not as a wall: each prop arrives a beat
                // after the last, the way stagehands would actually set a
                // stage. First visit and post-clear alike.
                enterAt: 150 + index * 220,
                id: piece.id,
                file: piece.file,
                x: clamp(50 + Math.cos(angle) * (33 + Math.random() * 11), 5, 90),
                y: clamp(52 + Math.sin(angle) * (27 + Math.random() * 13), 8, 84),
                size: propSize(),
                tilt: (Math.random() - 0.5) * 22,
                drift: 5 + Math.random() * 4,
                delay: Math.random() * 6,
                /*
                 * How hard this one boils, and where in its loop it starts.
                 *
                 * Every third prop is calm and every third is lively, in ring
                 * order, so the pile is not one temperament repeated nine
                 * times — the page's claim is a troupe, and a troupe is not a
                 * chorus line. The negative offset matters more than it looks:
                 * nine cut-outs stepping on the same tick is a strobe, and
                 * nine stepping on their own is a room full of drawings.
                 */
                paint: ["calm", "", "lively"][index % 3],
                paintSeed: Math.floor(Math.random() * 1000),
                paintAt: Math.random() * 0.9,
            };
        });

        /*
         * The page's copy, spoken by the props.
         *
         * A centred block of text over a scattered set read as a website; the
         * same words in speech bubbles read as the set talking, which is what
         * the whole page is about. Three props get lines — spread around the
         * ring by index, pulled down far enough that a bubble pointing up
         * stays on screen — and the rest stay quiet.
         */
        /*
         * Speakers are placed in bands, not left to the ring.
         *
         * The bubbles are read as a page: title, then the explanation, then
         * the prompt in the middle, then the invitation to play. Random
         * placement scrambled that order — the explanation saying "the line
         * below" could land below the line. Each speaker keeps its ring x
         * (nudged off the centre so the prompt stays clear) but is pulled to
         * a fixed height, jittered just enough to stay looking strewn.
         */
        const speakers = [0, Math.floor(strewn.length / 2), strewn.length - 1];
        for (const [which, line] of PAGE_LINES.entries()) {
            const prop = strewn[speakers[which]];
            if (!prop) break;
            prop.y = clamp(line.band + (Math.random() - 0.5) * 6, 12, 88);
            // Flanking the prompt, not exiled to the edges: a speaker parked
            // at 5% read as unrelated to the text in the middle, and the
            // bubbles are the page's actual copy. Off-centre on purpose —
            // pulled toward the middle, never into it.
            prop.x = line.aside
                ? (prop.x < 50 ? 30 + Math.random() * 10 : 60 + Math.random() * 10)
                : clamp(prop.x, 28, 72);
            Object.assign(prop, {
                say: line.say,
                sayVoice: line.voice,
                sayOrder: which,
                ...(line.titleCard ? { titleCard: true } : {}),
                sayTilt: (Math.random() - 0.5) * (line.titleCard ? 6 : 8),
                // Each bubble swings on its own slow clock: the cycle length
                // sets both how long it rests on a side (~40% of it) and how
                // briskly it crosses (~10%), and the offset scatters the
                // moments so no two ever move together.
                swingCycle: 5.5 + Math.random() * 5.5,
                swingAt: Math.random() * 11,
            });
        }
        // Nobody starts on top of anybody: overlap is fine once a person has
        // made it — that is theirs — but at spawn it just reads as a glitch.
        return separate(strewn);
    }



    /** Save the whole collage as a picture that opens again. */
    async function saveToFile() {
        if (!collage.list().length) {
            announce("Nothing to save yet — begin with a troupe piece or ask an agent to stage a story.");
            return;
        }
        const toast = toasts.push("Packing it up…", "busy");
        try {
            const { blob, filename } = await studio.saveFile();
            download(blob, filename);
            toast.close();
            announce(`Saved ${filename} — open it from Theater options to keep working.`);
        } catch (error) {
            toast.close();
            toasts.push(`Could not save that — ${message(error)}`, "error");
        }
    }

    /**
     * A saved play is a PNG that carries the editable document inside it.
     * Ordinary PNGs are not accepted here: artwork comes from the troupe,
     * while this path exists only to restore a whole play.
     */
    async function openCollageFiles(files: File[]): Promise<File[]> {
        const rest: File[] = [];
        for (const file of files) {
            // By extension as well as by type. A file dropped from some
            // filesystems and archives arrives with an empty `type`, and
            // trusting that alone meant a saved collage was silently discarded
            // before anything ever looked inside it.
            const png = file.type === "image/png" || /\.png$/i.test(file.name);
            if (!png) {
                rest.push(file);
                continue;
            }
            let opened = 0;
            try {
                /*
                 * A loaded play replaces the stage WHOLESALE — and that
                 * includes the strewn welcome props. Cleared before the file
                 * opens, or the adoption effect would fold nine random
                 * stickers into somebody's finished story the moment its
                 * first layer arrived. If the file turns out not to be a
                 * play, the idle page simply deals a fresh scatter.
                 */
                scatter = [];
                opened = await studio.openFile(file, { replace: true });
            } catch (error) {
                // A file that IS one of ours but will not open has to say so.
                // Swallowing it and adding a flat picture of the collage
                // instead is the most confusing possible outcome.
                toasts.push(`${file.name} looks like a saved collage but could not be opened — ${message(error)}`, "error");
                continue;
            }
            if (!opened) {
                // Named like one of ours but holding no collage: almost always
                // a file that has been through something that re-encodes PNGs
                // and dropped the chunk. Say that, rather than quietly adding a
                // flat picture of the collage it used to be.
                if (/\.(?:collage|play)\.png$/i.test(file.name)) {
                    toasts.push(
                        `${file.name} has no editable play inside it any more — something re-saved the image and ` +
                        `stripped its story data.`, "error");
                }
                rest.push(file);
                continue;
            }
            // The pieces arrive at the coordinates they were saved at, which
            // may be nowhere near where the view happens to be looking — and a
            // collage that loaded off-screen is indistinguishable from one that
            // did not load at all.
            canvas?.fitAll();
            announce(`Opened a saved play — ${opened} pieces.`);
        }
        return rest;
    }

    async function addFiles(files: FileList | File[]) {
        // Do not filter by MIME type before looking inside: a play is also a
        // perfectly valid PNG, and some filesystems omit its type entirely.
        const rest = await openCollageFiles([...files]);
        if (rest.length) {
            toasts.push("Images cannot be dropped onto the stage. Choose pieces from the troupe instead.", "error");
        }
    }

    function onDrop(event: DragEvent) {
        event.preventDefault();
        if (!event.dataTransfer?.files.length) return;
        void addFiles(event.dataTransfer.files);
    }

    /**
     * One paste, two possible sources — and this is the only place that can
     * tell them apart, because it is the only place the clipboard's contents
     * are readable.
     *
     * Only the theatre's own copied layers are accepted. External images are
     * deliberately not an authoring path; the shared troupe is the art source.
     */
    function onPaste(event: ClipboardEvent) {
        const target = event.target;
        if (target instanceof Element && target.matches("input, textarea, select, [contenteditable]")) return;

        if (canvas?.pasteClipboard()) event.preventDefault();
    }

    function setPage(presetId: string) {
        studio.setPage(presetId);
        canvas?.fitAll();
    }

    /** The page a layout needs. Created on demand so nobody has to think about it. */
    function pageFrame() {
        return frames[0] ?? studio.setPage(studio.pagePreset);
    }

    /**
     * Turn pictures into vector shapes.
     *
     * Undoable like anything else, because it is not reversible by eye: a
     * traced photo cannot be traced back, and someone who does not like the
     * result needs a way out that is not "drop it in again".
     */
    async function traceLayers(ids: string[]) {
        const toast = toasts.push(ids.length > 1 ? `Tracing ${ids.length}…` : "Tracing…", "busy");
        let shapes = 0;
        let failure: string | null = null;
        for (const id of ids) {
            const result = await studio.traceToSvg(id);
            if (result.ok) shapes += result.paths ?? 0;
            else failure ??= result.reason ?? null;
        }
        toast.close();
        if (shapes) {
            announce(`Traced into ${shapes} shapes — crisp at any size now.`);
            studio.save();
        } else {
            toasts.push(failure ?? "Nothing could be traced.", "error");
        }
    }

    function undo() {
        if (!collage.undo()) return;
        studio.setSelection(studio.selection);
        studio.save();
        toasts.push("Undone.");
    }


    /** Short, human phrasing. The long version goes to agents, not to a toast. */
    const EXPORT_DONE = {
        png: "Saved the PNG.",
        print: "The print dialogue is open — pick “Save as PDF” for a file.",
        html: "Copied the HTML. Paste it into your site.",
        embed: "Copied a whole page. Save it as .html and host it.",
    } as const;

    async function exportAs(format: "png" | "print" | "html" | "embed") {
        if (!collage.list().length) return;
        const toast = toasts.push("Exporting…", "busy");
        try {
            const output = await studio.exportFrame(pageFrame().id, format, { interactive: true });
            let copied = false;
            if (output.code && (format === "html" || format === "embed")) {
                copied = await navigator.clipboard.writeText(output.code).then(() => true, () => false);
            }
            toast.close();
            const done = copied || format === "png" || format === "print"
                ? EXPORT_DONE[format]
                : "Saved it as a file — it was too big for the clipboard.";
            // A crop is the loudest thing that can happen to an export, so it
            // takes over the message rather than being appended to a cheerful one.
            const cropped = Number((output.structured as { cropped?: number })?.cropped ?? 0);
            toasts.push(
                cropped
                    ? `${done} ${cropped} ${cropped === 1 ? "item was" : "items were"} cut off by the page edge.`
                    : done,
                cropped ? "error" : "info");
        } catch (error) {
            toast.close();
            toasts.push(`Export failed — ${message(error)}`, "error");
        }
    }

    /*
     * There is no right-click menu any more.
     *
     * It was the collage editor's: fonts, alignment, tracing to vector, sticker
     * outlines, drop shadows, arranging. Real features, none of them anything to
     * do with putting on a play — and every one of them a thing to read past
     * while looking for the one you wanted.
     *
     * What a person genuinely does to a picture on a stage is move it, resize
     * it, turn it, order it and delete it, and all of those are on the pointer
     * or the keyboard already. See onKeyDown in CollageCanvas.
     */



    function message(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
</script>

<!-- A plain stylesheet rather than a component style, because the same rules
     have to reach the collage layers and the exported HTML later, and none of
     those are inside this component's scope. -->
<svelte:head>
    <link rel="stylesheet" href={PAINTERLY_CSS} />
</svelte:head>

<svelte:window
    onpaste={onPaste}
    onpointerdown={event => (pressedAt = { x: event.clientX, y: event.clientY })}
    onclick={copyFromPage}
    ondblclick={conjureProp}
    onkeydown={event => {
        // Escape puts the eraser down — the fastest way out of a mode whose
        // whole behaviour is "clicking deletes things".
        if (event.key === "Escape" && erasing) {
            erasing = false;
            return;
        }
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
        const target = event.target;
        if (target instanceof Element && target.matches("input, textarea, [contenteditable]")) return;
        // Taking over Ctrl+S: the browser's own "save page" produces an HTML
        // file that cannot be opened again, which is the opposite of what the
        // keystroke means here.
        event.preventDefault();
        void saveToFile();
    }}
/>

<div
    class="page"
    bind:this={pageEl}
    role="region"
    aria-label="Theater"
    ondragover={e => e.preventDefault()}
    ondrop={onDrop}
    oncontextmenu={e => e.preventDefault()}
>
    <CollageCanvas
        bind:this={canvas}
        {studio}
        {erasing}
        showPage={studio.pagePreset !== FREE_PAGE}
    />
    <AgentActivity canvas={pageEl} />

    <!-- The house lights, before anything is on. Kept mounted and faded rather
         than added and removed, so the first picture dropped in does not make
         the light behind it blink out. -->
    <div class="houselights" class:houselights--off={!empty} aria-hidden="true"></div>

    {#if scatter.length}
        <!-- Fades with the house lights rather than unmounting, so the first
             dropped picture does not make nine props blink out of existence.
             The props are grabbable — decoration you can fidget with is the
             first taste of a canvas you can rearrange — but they are still
             not document: nothing here survives into a save or a scene. -->
        <!-- The three takes of the wander every painted piece steps through.
             Not optional: a `filter: url()` that resolves to nothing means the
             element is not rendered, so these have to be in the document before
             anything claims them. -->
        <svg class="paint-defs" aria-hidden="true" focusable="false">{@html boilFilterSvg()}</svg>

        <!-- Not faded while adopting: the props must stand at full strength
             until their twin layers are all beneath them, or the handover
             reads as everything blinking. The bubbles below DO fade at once —
             they are the page's copy, and the copy leaving is the point. -->
        <div class="strewn" class:strewn--away={!empty && !adopting}>
            {#each scatter as prop (prop.key)}
                <div
                    class="strewn__prop"
                    class:strewn__prop--held={heldProp?.id === prop.id}
                    role="presentation"
                    style:left="{prop.x}%"
                    style:top="{prop.y}%"
                    style:--tilt="{prop.tilt}deg"
                    style:--drift="{prop.drift}s"
                    style:--drift-at="-{prop.delay}s"
                    style:--enter="{prop.enterAt ?? 0}ms"
                    onpointerdown={event => grabProp(event, prop.id)}
                    onpointermove={event => dragProp(event, prop.id)}
                    onpointerup={dropProp}
                    onpointercancel={dropProp}
                >
                    <!-- Painted on the picture, not on the prop around it. The
                         prop already owns `translate` and `rotate` for its
                         drift and its tilt, and the boil's frame-held shift
                         uses the very same two properties — on one element the
                         later animation simply wins and the drift stops. One
                         level down they compose: the prop breathes, the drawing
                         inside it is repainted.

                         `painted--boil` is deliberately absent: it would set
                         `filter` from the shared sheet, and this component's
                         own scoped rule for the drop shadow is more specific
                         and would win. So the piece reads `--paint-warp`
                         itself, below, and composes the two by hand. -->
                    <img
                        class="strewn__piece painted {prop.paint ? `painted--${prop.paint}` : ''}"
                        src={prop.file}
                        alt=""
                        draggable="false"
                        style:width="max(72px, {prop.size}vmin)"
                        style:--paint-seed={prop.paintSeed ?? 0}
                        style:--paint-at="-{prop.paintAt ?? 0}s"
                        onload={event => {
                            // The RATIO, not the rendered height: a ratio
                            // survives every resize, where a measured pixel
                            // height is stale the moment the window changes.
                            const image = event.currentTarget as HTMLImageElement;
                            if (!image.naturalWidth) return;
                            const aspect = image.naturalHeight / image.naturalWidth;
                            scatter = scatter.map(other =>
                                other.id === prop.id ? { ...other, aspect } : other);
                        }}
                    />
                </div>
            {/each}
        </div>

        <!-- The bubbles, on a layer of their own above every prop. Inside a
             prop they were trapped in its stacking context — translate and
             rotate create one — so whichever prop came later in the DOM could
             sit on the title's face, and did. They follow their prop's
             position from the same state, so dragging carries them along.

             Each one is mounted from the start and invisible until `said`
             marks it spoken. Mounted early rather than late on purpose — a
             bubble that laid itself out in the same frame it popped would pop
             at the wrong size.

             The 700ms ladder is the stagger these have always had, and it is
             what they keep whenever nothing is going to be spoken: three
             bubbles arriving over about two seconds. Where there ARE voices it
             becomes a delay before joining the prompter's queue instead, and
             the queue decides the rest — one line at a time, because two of
             them at once is a noise rather than a page. -->
        <div class="strewn-bubbles" class:strewn--away={!empty}>
            {#each scatter.filter(prop => prop.say) as prop (prop.key)}
                <div
                    class="strewn__bubble"
                    class:strewn__bubble--title={prop.titleCard}
                    style:left="{prop.x}%"
                    style:top="{prop.y}%"
                    style:--rise="calc(max(72px, {prop.size}vmin) * {(prop.aspect ?? 1) / 2} + 14px)"
                    style:--lean="{prop.sayTilt ?? 0}deg"
                    style:--swing-cycle="{prop.swingCycle ?? 8}s"
                    style:--swing-at="-{prop.swingAt ?? 0}s"
                    use:said={{
                        voice: prop.sayVoice,
                        after: (prop.enterAt ?? 0) + 500 + (prop.sayOrder ?? 0) * 700,
                        replay: true,
                    }}
                >
                    {prop.say}
                    <SubtitleVoiceMenu text={prop.say ?? ""} voiceKey={prop.id} />
                </div>
            {/each}
        </div>
    {/if}

    {#if empty && restored}
        <!-- The description is the instruction. There is nothing on this stage
             until somebody directs it, so the honest thing to say about the
             page is also the thing you hand an agent — printed large enough to
             read and copy rather than hidden behind a button. -->
        <div class="empty">
            <!-- Just the prompt: the title and the welcome are spoken by the
                 props around it, and copying is a click anywhere on the page. -->
            <p class="invite" bind:this={inviteEl}>{prompt}</p>
        </div>
    {/if}

    <div class="file-tools" aria-label="Play files">
        <button class="file-tool" disabled={!layers.length} aria-label="Save play" use:hint={"Save this play as a file."} onclick={saveToFile}>
            <img src="/toolbar/save.webp" alt="" draggable="false" />
        </button>
        <button class="file-tool" aria-label="Load play" use:hint={"Load a saved play."} onclick={() => fileInput?.click()}>
            <img src="/toolbar/load.webp" alt="" draggable="false" />
        </button>
    </div>

    <!--
        The eraser, lying beside the menu as a sticker rather than sitting in a
        button. You pick it up off the shelf and it becomes the pointer; put it
        back and it stops. A mode either way, but one you can see in your hand.

        Still a <button> underneath, for all that it does not look like one: a
        div would take the keyboard away from anyone who cannot drag, and the
        drag is a nicer way to do it rather than the only way. Enter arms it,
        as does a plain click.

        While it is armed the sticker is gone from the shelf — it is under the
        pointer, drawn by PaperCursor — and its empty spot is what you drop it
        back onto.
    -->
    <button
        class="eraser"
        class:eraser--armed={erasing}
        aria-label={erasing ? "Put the eraser down" : "Pick up the eraser"}
        aria-pressed={erasing}
        use:hint={erasing
            ? "Rubbing out. Drop me back on my spot // or press Escape"
            : "Drag me onto the paper %wait0.6% and I will rub out whatever I touch"}
        onpointerdown={armDown}
        onpointermove={armMove}
        onpointerup={armUp}
        onpointercancel={() => (armFrom = null)}
        onclick={event => {
            // A drag has already decided; only a real click gets here to
            // toggle. `armUp` clears armFrom when it handled the gesture.
            if (armHandled) { armHandled = false; return; }
            erasing = !erasing;
        }}
    >
        {#if !erasing}
            <img class="eraser__art painted" src="/cursors/eraser-64.png" alt="" draggable="false" />
        {/if}
    </button>

    <!-- Said out loud, in the same voice that gave the instruction in the first
         place: this note is the next sentence of that one, and hearing it in a
         different voice would read as a different speaker interrupting. The
         click already hushed the props, so it has the room to itself. -->
    {#each copied as note (note.id)}
        <div
            class="copied"
            style:left="{note.x}px"
            style:top="{note.y}px"
            style:--lean="{note.tilt}deg"
            use:said={{ strong: "Copied!", voice: COPIED_VOICE }}
        >{COPIED_NOTE}</div>
    {/each}

    <!-- The auditorium: vignette, title card, credits. Nothing while the
         canvas is being worked on. -->
    <ShowOverlay {studio} />

    <!-- Only draws itself once there are scenes, so the canvas is a canvas
         until somebody makes it a theatre. -->
    <StageBar {studio} />

    <!-- The sticker drawers: every pack a little pile, one click from a fan
         of everything in it. -->
    <PackShelf
        {studio}
        toCanvas={(x, y) => canvas?.canvasPoint(x, y) ?? null}
        zoom={() => canvas?.getView().zoom ?? 1}
        onActorPlaced={(id, voice, greeting) => canvas?.greetActor(id, voice, greeting)}
    />

    <Toasts items={toasts.items} onDismiss={toasts.dismiss} />

    <input
        class="file"
        type="file"
        accept=".play.png,.collage.png,image/png"
        bind:this={fileInput}
        onchange={e => {
            const input = e.currentTarget as HTMLInputElement;
            addFiles(input.files ?? []);
            // Let the same file be chosen twice in a row.
            input.value = "";
        }}
    />
</div>

<style>
    /*
     * Fills whatever it is put in rather than claiming the viewport: it is the
     * front page's hero now, not a page of its own. Its chrome is positioned
     * against this box for the same reason — fixed buttons would still be
     * hanging in the corner once someone scrolls past to the registry.
     */
    .page {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    /*
     * A warm pool of light in the middle of an empty stage.
     *
     * The canvas is a wide flat sheet of paper until somebody puts something on
     * it, and a wide flat sheet of paper does not look like a theatre. This is
     * the cheapest thing that does: light falling from above onto the middle of
     * the boards, with the edges going warm and dark the way the sides of a
     * stage do.
     *
     * It goes when the play arrives. A show has its own vignette and its own
     * darkening, and two of them stacked would just be murk.
     */
    .houselights {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background:
            radial-gradient(
                ellipse 62% 52% at 50% 38%,
                color-mix(in srgb, #FFF6E2 85%, transparent) 0%,
                transparent 68%),
            radial-gradient(
                ellipse 96% 90% at 50% 44%,
                transparent 42%,
                color-mix(in srgb, #6B5A44 12%, transparent) 88%,
                color-mix(in srgb, #4A3D2E 20%, transparent) 100%);
        opacity: 1;
        transition: opacity 0.8s cubic-bezier(0.2, 0, 0, 1);
    }

    .houselights--off {
        opacity: 0;
    }

    :global(:root[data-theme="dark"]) .houselights {
        background:
            radial-gradient(
                ellipse 62% 52% at 50% 38%,
                color-mix(in srgb, #FFE3AE 12%, transparent) 0%,
                transparent 66%),
            radial-gradient(
                ellipse 96% 90% at 50% 44%,
                transparent 40%,
                rgba(0, 0, 0, 0.34) 88%,
                rgba(0, 0, 0, 0.52) 100%);
    }

    @media (prefers-reduced-motion: reduce) {
        .houselights { transition-duration: 0s; }
    }

    .paint-defs {
        position: absolute;
        width: 0;
        height: 0;
        pointer-events: none;
    }

    .strewn {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        transition: opacity 0.8s cubic-bezier(0.2, 0, 0, 1);
    }

    .strewn--away {
        opacity: 0;
    }

    .strewn__prop {
        position: absolute;
        translate: -50% -50%;
        rotate: var(--tilt, 0deg);
        /* The parent is pointer-transparent; the props themselves are not.
           Grabbable decoration is the first taste of a canvas you can
           rearrange. */
        pointer-events: auto;
        cursor: var(--cursor-grab, grab);
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        /* Arrive, then live: the pop plays once on mount — which is also how
           a swapped-in or conjured piece announces itself, since a new key
           remounts the prop — and the drift runs forever on its own clock. */
        animation:
            prop-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) backwards,
            strewn-drift var(--drift, 6s) ease-in-out infinite alternate;
        animation-delay: var(--enter, 0ms), var(--drift-at, 0s);
    }

    @keyframes prop-in {
        from { opacity: 0; scale: 0.6; }
    }

    /* Once the lights change, the toys stop being toys: pointer-events on the
       child would win over `none` on the faded parent, and an invisible prop
       that still swallowed a drag would read as a broken canvas. */
    .strewn--away .strewn__prop {
        pointer-events: none;
    }

    .strewn__prop--held {
        cursor: var(--cursor-grabbing, grabbing);
        z-index: 4;
        /* Held things stop breathing — the drift fighting the hand felt like
           the prop trying to escape. */
        animation-play-state: paused;
    }

    .strewn__prop--held .strewn__piece {
        scale: 1.05;
        filter: var(--paint-warp, url("#paint-boil-0"))
            drop-shadow(0 10px 22px rgba(34, 44, 32, 0.26));
    }

    .strewn__piece {
        display: block;
        /*
         * Bigger marks than the default, because these props are small.
         *
         * The worklet sizes its brush against the object, which keeps one
         * setting working on a mushroom and on a backdrop — but a prop 90px
         * across gets marks under a pixel wide, and a sub-pixel dry brush is
         * not subtle, it is absent. Roughly doubling the marks puts them back
         * where the eye can find them without turning the texture coarse.
         *
         * Only the scale. The temperaments set their own bite, and this rule
         * is more specific than they are, so anything else set here would
         * flatten the difference between a calm prop and a lively one.
         */
        --paint-scale: 2.2;
        /*
         * The boil's warp, then the shadow that was always here.
         *
         * `--paint-warp` is swapped between three displacement filters by the
         * `.painted` keyframes; the fallback is the first of them rather than
         * `none`, both because a paused or reduced-motion prop should still be
         * a painting and because `filter: none drop-shadow(...)` is not a valid
         * list — `none` here would silently drop the shadow.
         */
        filter: var(--paint-warp, url("#paint-boil-0"))
            drop-shadow(0 5px 12px rgba(34, 44, 32, 0.16));
        /* Scale only. `filter` changes eight times a second now, and a
           transition on it would try to cross-fade every one of them. */
        transition-property: scale;
        transition-duration: 0.15s;
    }

    /*
     * A prop speaking the page's copy, in the show's own bubble language —
     * white card, ink border, a tail, and a slight tilt so it reads as pinned
     * on rather than typeset. Placeholder wording; the shape is the point.
     */
    .strewn-bubbles {
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
        transition: opacity 0.8s cubic-bezier(0.2, 0, 0, 1);
    }

    .strewn__bubble {
        position: absolute;
        /* Anchored over the prop's measured height, so the tail points at the
           picture rather than at a guess about its aspect ratio. */
        translate: -50% calc(-100% - var(--rise, 60px));
        rotate: var(--lean, 0deg);
        /* Everything pivots on the tail's tip: the swing rocks the bubble
           around the point that touches the prop, and the pop grows out of it
           — a bubble that rotated about its own middle swept its tail from
           side to side like a windscreen wiper. */
        transform-origin: 50% calc(100% + 0.4em);
        /*
         * Nothing until it is spoken.
         *
         * The bubble is in the document from the first frame — it has to be,
         * or it would lay itself out and pop in the same frame and pop at the
         * wrong size — but it is not visible and it is not animating. The
         * `said` action flips the attribute when the prompter reaches this
         * line, which is what starts both motions below.
         */
        opacity: 0;
        width: max-content;
        max-width: min(260px, 56vw);
        padding: 0.5em 0.8em;
        border: 1.5px solid var(--text-primary);
        border-radius: 0.9em;
        background: var(--surface-page-elevated, #fff);
        color: var(--text-primary);
        font-size: clamp(0.9rem, 0.85rem + 0.3vw, 1rem);
        line-height: 1.45;
        text-align: center;
        text-wrap: pretty;
        --paint-wash-strength: 1;
        --paint-scale: 2.2;
    }

    :global(html.painterly) .strewn__bubble {
        background-image:
            paint(painterly-wash),
            linear-gradient(var(--surface-page-elevated, #fff), var(--surface-page-elevated, #fff));
    }

    /*
     * Two motions on separate clocks, both started by being spoken. The pop is
     * the entrance, once. The swing is idle life: rest tilted one way, cross to
     * the other side in under a second, rest again — mostly stillness, because
     * a bubble that never stops moving reads as a loading indicator. Cycle
     * length and phase are per bubble, so no two ever agree.
     */
    /*
     * :global() on the attribute half, and it is load-bearing. `data-said` is
     * set at runtime by the `said` action — it never appears in the template —
     * so Svelte's scoped-CSS pruning decided this selector could match nothing
     * and deleted the whole rule. The compiler was told to reveal the bubbles
     * by an attribute no surviving rule was watching: three bubbles, spoken,
     * flipped to "said", and invisible forever. The warning was in
     * svelte-check's output the entire time, filed under "unused CSS".
     */
    .strewn__bubble:global([data-said="said"]) {
        opacity: 1;
        animation:
            bubble-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) backwards,
            bubble-swing var(--swing-cycle, 8s) ease-in-out infinite,
            bubble-paper 0.42s step-end infinite;
        animation-delay: 0ms, var(--swing-at, 0s), 0ms;
    }

    @keyframes bubble-paper {
        0%, 100% { --paint-frame: 0; }
        33.333% { --paint-frame: 1; }
        66.666% { --paint-frame: 2; }
    }

    .strewn__bubble::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -0.34em;
        width: 0.55em;
        height: 0.55em;
        translate: -50% 0;
        rotate: 45deg;
        border: 1.5px solid var(--text-primary);
        border-top: 0;
        border-left: 0;
        background: var(--surface-page-elevated, #fff);
    }

    @keyframes bubble-pop {
        from { opacity: 0; scale: 0.6; }
    }

    /* Long rests, quick crossings: 40% of the cycle on each side, a tenth of
       it in motion. At 5.5–11s cycles that is 2.2–4.4s of rest and 0.55–1.1s
       of swing — deliberately not symmetrical in time with the pop above. */
    @keyframes bubble-swing {
        0%, 40% { rotate: var(--lean, 0deg); }
        50%, 90% { rotate: calc(var(--lean, 0deg) * -1); }
        100% { rotate: var(--lean, 0deg); }
    }

    .strewn__bubble--title {
        font-family: var(--font-family-display);
        font-size: clamp(1.3rem, 1.1rem + 1vw, 1.8rem);
        font-weight: 600;
        line-height: 1.15;
        text-wrap: balance;
    }

    @keyframes strewn-drift {
        from { translate: -50% -50%; }
        to { translate: -50% calc(-50% - 9px); }
    }

    @media (prefers-reduced-motion: reduce) {
        .strewn,
        .strewn__prop,
        .strewn__piece { animation: none; transition: none; }

        /* No entrance and no idle swing; the base tilt on the `rotate`
           property takes over the moment the animations are gone. */
        .strewn__bubble { animation: none; }
    }

    /* On a phone the ring of props and the text share very little room, so
       the props shrink in place — scale does not disturb their layout — and
       the middle stays legible. */
    /* On a phone the ring of props and the text share very little room: the
       pictures shrink in place — scale does not disturb layout — while the
       bubbles keep their reading size and just get narrower. */
    @media (max-width: 640px) {
        .strewn__piece {
            scale: 0.62;
        }

        .strewn__bubble {
            max-width: 62vw;
        }
    }

    /*
     * Behind the props, in front of the light.
     *
     * The prompt is scenery-level text — a watermark on the paper — so a prop
     * dragged across it should pass in front, and the bubbles doing the real
     * talking sit above everything. The stack, bottom to top: house lights,
     * this, the props, their bubbles, the copied stamps.
     */
    .empty {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        text-align: center;
        pointer-events: none;
    }

    /*
     * The prompt: big, and barely there.
     *
     * It is the most important text on the page and the least interesting to
     * read, so it is set like a watermark — large enough to be found, faded
     * toward the paper so it does not compete with the props doing the actual
     * talking. Not selectable: any click on the page copies it whole, which
     * beats a careful drag-select every time.
     */
    .empty .invite {
        max-width: min(46rem, calc(100vw - 2.5rem));
        padding: 0 1rem;
        /* A warm ink rather than a grey: saturated enough to belong to the
           paper world, mixed far enough into the page to stay a watermark. */
        color: color-mix(in srgb, #8A5A34 52%, var(--surface-page));
        font-size: clamp(1.1rem, 0.95rem + 0.8vw, 1.5rem);
        font-weight: 700;
        line-height: 1.5;
        text-wrap: pretty;
        pointer-events: auto;
        cursor: var(--cursor-pointer, pointer);
        transition: color 0.3s cubic-bezier(0.2, 0, 0, 1);
    }

    /* Found: the watermark wakes fully under the pointer that can take it. */
    .empty .invite:hover {
        color: color-mix(in srgb, #8A5A34 78%, var(--surface-page));
    }

    /* "Copied", in the house bubble style, where the hand is. */
    .copied {
        position: absolute;
        z-index: 30;
        translate: -50% calc(-100% - 12px);
        rotate: var(--lean, -2deg);
        padding: 0.45em 0.75em;
        border: 1.5px solid var(--text-primary);
        border-radius: 0.8em;
        background: var(--surface-page-elevated, #fff);
        color: var(--text-primary);
        max-width: min(280px, 70vw);
        font-size: 0.95rem;
        line-height: 1.4;
        text-align: center;
        text-wrap: pretty;
        pointer-events: none;
        animation:
            copied-in 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
            copied-out 0.4s ease-in 6.3s forwards;
    }

    .copied::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -0.34em;
        width: 0.55em;
        height: 0.55em;
        translate: -50% 0;
        rotate: 45deg;
        border: 1.5px solid var(--text-primary);
        border-top: 0;
        border-left: 0;
        background: var(--surface-page-elevated, #fff);
    }

    @keyframes copied-in {
        from { opacity: 0; scale: 0.7; }
    }

    @keyframes copied-out {
        to { opacity: 0; translate: -50% calc(-100% - 24px); }
    }

    .file-tools {
        position: absolute;
        top: 10px;
        right: 16px;
        z-index: 45;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .file-tool {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 50px;
        height: 50px;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: var(--cursor-pointer, pointer);
        transition-property: translate, scale, opacity;
        transition-duration: 0.16s;
    }

    .file-tool:hover:not(:disabled) {
        translate: 0 -2px;
        scale: 1.06;
    }

    .file-tool:active:not(:disabled) {
        scale: 0.96;
    }

    .file-tool:disabled {
        opacity: 0.38;
        cursor: var(--cursor-forbidden, not-allowed);
    }

    .file-tool img {
        width: 46px;
        height: 46px;
        object-fit: contain;
        pointer-events: none;
    }

    /*
     * A sticker on the shelf, not a button on a bar.
     *
     * No circle, no fill, no border: the drawer below is stickers lying on
     * paper and this is one of them, resting where the tools live. One
     * just left of the two file cut-outs.
     */
    .eraser {
        position: absolute;
        top: 16px;
        right: 128px;
        z-index: 22;
        display: grid;
        place-items: center;
        width: 46px;
        height: 46px;
        padding: 0;
        border: 0;
        border-radius: 12px;
        background: none;
        cursor: grab;
        /* The pointer is about to be dragged off this element; a browser
           starting a native image drag or a scroll instead would eat it. */
        touch-action: none;
        transition-property: scale, translate;
        transition-duration: 0.16s;
    }

    .eraser:hover {
        translate: 0 -2px;
        scale: 1.06;
    }

    .eraser:active {
        cursor: grabbing;
        scale: 0.98;
    }

    .eraser__art {
        width: 38px;
        /* Painted like everything else made of paper; the marks are enlarged
           for the same reason the strewn props enlarge theirs, a 38px drawing
           being far too small for the default brush. */
        --paint-scale: 2.2;
        filter: var(--paint-warp, url("#paint-boil-0"))
            drop-shadow(0 2px 3px rgba(20, 24, 18, 0.34));
        pointer-events: none;
    }

    /*
     * Armed: the sticker is not here, it is under the pointer. What is left is
     * the dent it was lying in — somewhere to aim at to put it back, and the
     * only thing on screen that says the tool is still in hand once the
     * pointer has wandered off.
     */
    .eraser--armed {
        cursor: pointer;
        border: 1.5px dashed color-mix(in srgb, var(--accent-danger, #c4463c) 55%, transparent);
        background: color-mix(in srgb, var(--accent-danger, #c4463c) 8%, transparent);
    }

    .eraser--armed:hover {
        border-color: var(--accent-danger, #c4463c);
        translate: 0;
        scale: 1.04;
    }

    @media (prefers-reduced-motion: reduce) {
        .eraser { transition: none; }
    }

    .file {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
    }
</style>
