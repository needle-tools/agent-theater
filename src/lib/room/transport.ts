/**
 * The seam between the shared world and the network.
 *
 * The world model talks to this interface only, never to Needle's
 * NetworkConnection directly. Two reasons: the engine's exports map blocks deep
 * imports (so a node test would have to pull the entire browser engine), and a
 * narrow seam lets the multiplayer semantics be tested against a fake that
 * implements them exactly.
 *
 * The semantics below are not invented — they mirror what the engine and its
 * server actually do (see engine_networking.js):
 *  - a message is `{key, data}`; listeners receive `data` and nothing else
 *  - a broadcast reaches everyone in the room EXCEPT the sender
 *  - any payload carrying a `guid` is saved in the room's server state and
 *    replayed to whoever joins later, unless it opts out
 *
 * That last point is why every world object is a `RoomModel` with a stable
 * guid: persistence and identity are the same mechanism.
 */

/**
 * A payload the server can persist. The `guid` is the object's identity across
 * every peer — a peer never shares our object instances, so the guid is the
 * only name that exists on both sides.
 */
export interface RoomModel {
    guid: string;
    [key: string]: unknown;
}

export interface SendOptions {
    /** Broadcast but never persist — cursors, pings, transient markers. Maps to `IModel.dontSave`. */
    transient?: boolean;
    /** Drop from room state when the sender disconnects — presence and avatars. Maps to `IModel.deleteOnDisconnect`. */
    untilDisconnect?: boolean;
}

/**
 * NOTE: there is deliberately no sender id on `listen`. The engine hands
 * listeners `message.data` with no envelope, so the network cannot tell us who
 * sent something. Attribution has to be a field inside the model — which is
 * also what makes it survive a reload, since that is what gets persisted.
 */
export interface RoomTransport {
    /** Our own connection id, or null before the server has assigned one. */
    readonly selfId: string | null;
    readonly isInRoom: boolean;

    /** Connection ids currently in the room, including our own. */
    usersInRoom(): string[];

    /** Broadcast to everyone else in the room. Never echoes back to us. */
    send(key: string, model: RoomModel, options?: SendOptions): void;

    /** Subscribe to a message key. Returns an unsubscribe function. */
    listen(key: string, callback: (model: RoomModel) => void): () => void;

    /** The last model seen for a guid, including state replayed on join. */
    getState(guid: string): RoomModel | null;

    /** Remove an object from the room's server state so late joiners never see it. */
    deleteState(guid: string): void;

    /**
     * Take authority over an object before mutating it. Resolves false when
     * somebody else holds it — the caller must surface that, not overwrite.
     */
    requestOwnership(guid: string): Promise<boolean>;
    releaseOwnership(guid: string): void;

    /**
     * Who currently holds an object, or null if nobody does. A refusal has to
     * name the holder to be useful to an agent, and a refused request tells us
     * nothing — production learns this from the ownership broadcasts the server
     * sends everyone (`gained-ownership-broadcast` / `lost-ownership-broadcast`).
     */
    ownerOf(guid: string): string | null;

    onUserJoined(callback: (userId: string) => void): () => void;
    onUserLeft(callback: (userId: string) => void): () => void;
}
