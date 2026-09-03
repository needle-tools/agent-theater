/**
 * A sticker saying what it is, when you pick it up.
 *
 * Every piece already has a voice — an actor speaks in the one its artwork
 * suggests, and anything else gets a stable voice dealt from its own name, so
 * "no voice cast" means "a voice nobody chose" rather than silence. This uses
 * that same voice to say the one thing a sticker always knows: its name.
 *
 * Additive on purpose. Whatever else a pick-up or a drop already plays keeps
 * playing; this is a second, quieter layer on top, and nothing here touches
 * the Speaker that owns the beds and the cues.
 */
import { autoVoiceFor } from "./characterVoice.js";
import { playSubtitleVoice, type SubtitleVoicePlayback } from "../subtitleVoice/index.js";
import type { TroupePiece } from "./troupe.js";

/**
 * "desert/old-man-cactus" → "old man cactus".
 *
 * The pack is dropped: a person picking up a cactus does not need to be told
 * which drawer it came from, and "desert old man cactus" is a mouthful the
 * synth spends half a second on.
 */
export function nameOf(piece: { id: string; label?: string }): string {
    const id = (piece.label ?? piece.id).split("#")[0];
    return id.split("/").pop()!.replace(/-/g, " ").trim();
}

/**
 * One voice at a time.
 *
 * Picking through a drawer means a name every few hundred milliseconds, and
 * three overlapping gibberish voices is noise rather than speech. The newest
 * name wins — it is the one attached to what the hand is doing now.
 */
let current: SubtitleVoicePlayback | null = null;
let token = 0;

export function sayName(piece: TroupePiece | { id: string; file?: string; label?: string }): void {
    const text = nameOf(piece);
    if (!text) return;
    const voice = autoVoiceFor({
        label: (piece as { label?: string }).label ?? piece.id,
        src: (piece as { file?: string }).file,
    });
    if (!voice) return;

    stopName();
    const mine = ++token;
    void playSubtitleVoice(text, voice).then(playback => {
        // Awaited, so another name may have started while the synth warmed up;
        // that one owns the room now and this playback was never heard.
        if (mine !== token) { playback.stop(); return; }
        current = playback;
        void playback.finished.then(() => { if (current === playback) current = null; });
    }).catch(() => { /* a voice that will not start is not worth a broken drag */ });
}

export function stopName(): void {
    token++;
    current?.stop();
    current = null;
}
