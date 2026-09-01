/**
 * The room session: one place that owns the world, the consent gate and the
 * network, so the 3D scene and the Svelte UI both talk to the same instance.
 *
 * Boot order is load-bearing. The server replays the whole room state at join
 * time and the engine exposes no way to enumerate what it cached
 * (`tryGetState` takes a single guid, `_state` is private), so a listener
 * attached after joining can never recover the objects it missed. SharedWorld
 * is therefore constructed — and subscribed — before joinRoom is called.
 */
import type { Context } from "@needle-tools/engine";
import { NeedleRoomTransport } from "./needleTransport.js";
import { SharedWorld } from "./world.js";
import { ConsentGate } from "./consent.js";

/** Everyone lands in the same room, so a visitor never arrives somewhere empty. */
const DEFAULT_ROOM = "needle-webmcp-workshop";

export interface SaidMessage {
    from: string;
    text: string;
}

export interface RoomSession {
    world: SharedWorld;
    consent: ConsentGate;
    transport: NeedleRoomTransport;
    roomName: string;
    onSaid(callback: (message: SaidMessage) => void): () => void;
}

let session: RoomSession | null = null;
const readyCallbacks = new Set<(session: RoomSession) => void>();

export function getRoomSession(): RoomSession | null {
    return session;
}

/** Fires immediately if the session already exists. */
export function onRoomSessionReady(callback: (session: RoomSession) => void): () => void {
    if (session) callback(session);
    else readyCallbacks.add(callback);
    return () => { readyCallbacks.delete(callback); };
}

/** A `?room=` override lets two windows be put in separate rooms for testing. */
function roomNameFromUrl(): string {
    if (typeof window === "undefined") return DEFAULT_ROOM;
    const fromQuery = new URL(window.location.href).searchParams.get("room");
    return fromQuery?.trim() || DEFAULT_ROOM;
}

export async function startRoomSession(context: Context): Promise<RoomSession> {
    if (session) return session;

    const transport = new NeedleRoomTransport(context.connection);
    const world = new SharedWorld(transport);
    const consent = new ConsentGate();
    const saidCallbacks = new Set<(message: SaidMessage) => void>();

    transport.listen("room-say", model => {
        const text = typeof model.text === "string" ? model.text : "";
        const from = typeof model.from === "string" ? model.from : "someone";
        if (text) for (const callback of [...saidCallbacks]) callback({ from, text });
    });

    const roomName = roomNameFromUrl();
    session = {
        world,
        consent,
        transport,
        roomName,
        onSaid(callback) {
            saidCallbacks.add(callback);
            return () => { saidCallbacks.delete(callback); };
        },
    };

    // Only now — everything above is subscribed and will catch the replay.
    await context.connection.connect();
    context.connection.joinRoom(roomName);

    for (const callback of [...readyCallbacks]) callback(session);
    readyCallbacks.clear();
    return session;
}
