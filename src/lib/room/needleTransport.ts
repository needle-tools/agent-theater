/**
 * Binds the shared world to Needle's real networking.
 *
 * This is the one piece the test harness cannot check — the fake room server
 * stands in for everything below this line — so it stays thin and declarative
 * on purpose. Anything with a decision in it belongs in SharedWorld, where it
 * can be tested.
 */
import { NetworkConnection, OwnershipModel, SendQueue } from "@needle-tools/engine";
import type { RoomModel, RoomTransport, SendOptions } from "./transport.js";

interface OwnershipBroadcast { guid: string; owner: string }

export class NeedleRoomTransport implements RoomTransport {
    private readonly ownership = new Map<string, OwnershipModel>();
    /** Mirrors the server's ownership broadcasts so a refusal can name a holder. */
    private readonly owners = new Map<string, string>();
    private readonly disposers: Array<() => void> = [];

    constructor(private readonly connection: NetworkConnection) {
        this.disposers.push(connection.beginListen("gained-ownership-broadcast", (data: OwnershipBroadcast) => {
            if (data?.guid) this.owners.set(data.guid, data.owner);
        }));
        this.disposers.push(connection.beginListen("lost-ownership-broadcast", (data: OwnershipBroadcast) => {
            if (data?.guid) this.owners.delete(data.guid);
        }));
    }

    get selfId() { return this.connection.connectionId; }
    get isInRoom() { return this.connection.isInRoom; }

    usersInRoom() { return [...this.connection.usersInRoom()]; }

    send(key: string, model: RoomModel, options?: SendOptions) {
        const payload = {
            ...model,
            ...(options?.transient ? { dontSave: true } : {}),
            ...(options?.untilDisconnect ? { deleteOnDisconnect: true } : {}),
        };
        // Immediate, not the default queue: send() otherwise buffers until the
        // context flushes once per frame. World edits are discrete events, and
        // a buffered one would sit there until the next frame happened to run.
        this.connection.send(key, payload, SendQueue.Immediate);
    }

    listen(key: string, callback: (model: RoomModel) => void) {
        return this.connection.beginListen(key, (data: unknown) => {
            if (data && typeof data === "object") callback(data as RoomModel);
        });
    }

    getState(guid: string) {
        return (this.connection.tryGetState(guid) as RoomModel | null) ?? null;
    }

    deleteState(guid: string) {
        this.connection.sendDeleteRemoteState(guid);
    }

    async requestOwnership(guid: string) {
        const granted = await this.modelFor(guid).requestOwnership();
        if (granted && this.selfId) this.owners.set(guid, this.selfId);
        return granted;
    }

    releaseOwnership(guid: string) {
        this.ownership.get(guid)?.freeOwnership();
        if (this.owners.get(guid) === this.selfId) this.owners.delete(guid);
    }

    ownerOf(guid: string) {
        return this.owners.get(guid) ?? null;
    }

    onUserJoined(callback: (userId: string) => void) {
        return this.connection.beginListen("user-joined-room", (data: { userId: string }) => callback(data.userId));
    }

    onUserLeft(callback: (userId: string) => void) {
        return this.connection.beginListen("user-left-room", (data: { userId: string }) => callback(data.userId));
    }

    dispose() {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        for (const model of this.ownership.values()) model.destroy();
        this.ownership.clear();
        this.owners.clear();
    }

    private modelFor(guid: string): OwnershipModel {
        let model = this.ownership.get(guid);
        if (!model) this.ownership.set(guid, model = new OwnershipModel(this.connection, guid));
        return model;
    }
}
