/**
 * An in-memory stand-in for the Needle networking server.
 *
 * The behaviour here is copied from the real implementation
 * (node_modules/@needle-tools/engine/lib/engine/engine_networking.js), not
 * guessed:
 *  - `send` broadcasts to everyone in the room except the sender
 *  - a payload with a `guid` is saved in room state unless it sets `dontSave`
 *  - on join, the server replays the whole saved state, then `room-state-sent`
 *  - `deleteOnDisconnect` payloads are dropped when their sender goes away
 *  - `delete-state` removes one object's saved state
 *
 * Delivery is synchronous so tests are deterministic; the real server is async,
 * so nothing here should be read as a guarantee about ordering under latency.
 */
import type { RoomModel, RoomTransport, SendOptions } from "../src/lib/room/transport.js";

interface SavedEntry {
    key: string;
    model: RoomModel;
    /** Who sent it — needed only to honour untilDisconnect. */
    sender: string;
    untilDisconnect: boolean;
}

export interface FakeRoomServerOptions {
    /**
     * Replay the saved state BEFORE the client counts as being in the room.
     * The engine documents only "state, then room-state-sent" and leaves this
     * order unspecified, so both are exercised — nothing we build may depend
     * on which one the real server picks.
     */
    stateBeforeJoinAck?: boolean;
}

export class FakeRoomServer {
    constructor(private readonly options: FakeRoomServerOptions = {}) { }

    private readonly clients = new Set<FakeRoomClient>();
    /** guid → saved envelope. Insertion-ordered, like the replayed room state. */
    private readonly state = new Map<string, SavedEntry>();
    private readonly owners = new Map<string, string>();
    private nextId = 1;

    /** A client that has connected but not yet joined a room. */
    connect(): FakeRoomClient {
        const client = new FakeRoomClient(this, `user-${this.nextId++}`);
        this.clients.add(client);
        return client;
    }

    /** Objects currently persisted, in replay order. Test-only introspection. */
    savedGuids(): string[] {
        return [...this.state.keys()];
    }

    // #region internals used by the client

    _join(client: FakeRoomClient, room: string) {
        const replay = () => {
            for (const entry of this.state.values()) client._deliver(entry.key, entry.model);
        };
        if (this.options.stateBeforeJoinAck) {
            replay();
            client._room = room;
        } else {
            client._room = room;
            replay();
        }
        client._deliver("room-state-sent", { guid: "" });
        for (const other of this.peers(client)) {
            other._notifyUserJoined(client.selfId);
        }
    }

    _leave(client: FakeRoomClient) {
        const room = client._room;
        client._room = null;
        for (const [guid, entry] of [...this.state]) {
            if (entry.untilDisconnect && entry.sender === client.selfId) this.state.delete(guid);
        }
        for (const [guid, owner] of [...this.owners]) {
            if (owner === client.selfId) this.owners.delete(guid);
        }
        this.clients.delete(client);
        if (room) {
            for (const other of this.clients) {
                if (other._room === room) other._notifyUserLeft(client.selfId);
            }
        }
    }

    _send(client: FakeRoomClient, key: string, model: RoomModel, options?: SendOptions) {
        if (key === "delete-state") {
            this.state.delete(model.guid);
        } else if (model.guid && !options?.transient) {
            this.state.set(model.guid, {
                key,
                model: structuredClone(model),
                sender: client.selfId,
                untilDisconnect: options?.untilDisconnect === true,
            });
        }
        for (const peer of this.peers(client)) peer._deliver(key, model);
    }

    _requestOwnership(client: FakeRoomClient, guid: string): boolean {
        const current = this.owners.get(guid);
        if (current && current !== client.selfId) return false;
        this.owners.set(guid, client.selfId);
        return true;
    }

    _releaseOwnership(client: FakeRoomClient, guid: string) {
        if (this.owners.get(guid) === client.selfId) this.owners.delete(guid);
    }

    _ownerOf(guid: string): string | null {
        return this.owners.get(guid) ?? null;
    }

    _usersInRoom(client: FakeRoomClient): string[] {
        return [...this.clients].filter(c => c._room === client._room).map(c => c.selfId);
    }

    /** Everyone in the same room except the sender. */
    private peers(client: FakeRoomClient): FakeRoomClient[] {
        return [...this.clients].filter(c => c !== client && c._room !== null && c._room === client._room);
    }
}

export class FakeRoomClient implements RoomTransport {
    /** null until joinRoom. */
    _room: string | null = null;

    private readonly listeners = new Map<string, Set<(model: RoomModel) => void>>();
    private readonly cache = new Map<string, RoomModel>();
    private readonly joinedCallbacks = new Set<(id: string) => void>();
    private readonly leftCallbacks = new Set<(id: string) => void>();

    constructor(private readonly server: FakeRoomServer, readonly selfId: string) { }

    get isInRoom() { return this._room !== null; }

    joinRoom(room: string) { this.server._join(this, room); }
    disconnect() { this.server._leave(this); }

    usersInRoom() { return this.server._usersInRoom(this); }

    send(key: string, model: RoomModel, options?: SendOptions) {
        // Mirrors the engine: the sender caches its own model without an echo.
        if (model.guid) this.cache.set(model.guid, structuredClone(model));
        this.server._send(this, key, model, options);
    }

    listen(key: string, callback: (model: RoomModel) => void) {
        let set = this.listeners.get(key);
        if (!set) this.listeners.set(key, set = new Set());
        set.add(callback);
        return () => { set!.delete(callback); };
    }

    getState(guid: string) { return this.cache.get(guid) ?? null; }

    deleteState(guid: string) {
        this.cache.delete(guid);
        this.server._send(this, "delete-state", { guid, dontSave: true });
    }

    async requestOwnership(guid: string) { return this.server._requestOwnership(this, guid); }
    releaseOwnership(guid: string) { this.server._releaseOwnership(this, guid); }
    ownerOf(guid: string) { return this.server._ownerOf(guid); }

    onUserJoined(cb: (id: string) => void) { this.joinedCallbacks.add(cb); return () => { this.joinedCallbacks.delete(cb); }; }
    onUserLeft(cb: (id: string) => void) { this.leftCallbacks.add(cb); return () => { this.leftCallbacks.delete(cb); }; }

    _deliver(key: string, model: RoomModel) {
        // The engine caches any incoming payload that carries a guid — that is
        // what makes replayed room state readable through getState().
        if (model.guid) this.cache.set(model.guid, structuredClone(model));
        if (key === "delete-state") this.cache.delete(model.guid);
        for (const cb of this.listeners.get(key) ?? []) cb(model);
    }

    _notifyUserJoined(id: string) { for (const cb of this.joinedCallbacks) cb(id); }
    _notifyUserLeft(id: string) { for (const cb of this.leftCallbacks) cb(id); }
}
