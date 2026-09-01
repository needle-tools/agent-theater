import { describe, it, expect } from "vitest";
import { FakeRoomServer, type FakeRoomClient } from "./fakeRoom.js";
import { SharedWorld, type Actor } from "../src/lib/room/world.js";

/**
 * The shared world is the multiplayer substrate: objects keyed by guid, edits
 * that replicate, attribution that survives the wire, and authority when a
 * human and an agent reach for the same object.
 */

/** Construct the world BEFORE joining — otherwise its listeners miss the state
 *  the server replays on join, which is how a late joiner sees the room. */
function connect(server: FakeRoomServer, room = "workshop") {
    const client = server.connect();
    let n = 0;
    const world = new SharedWorld(client, {
        newGuid: () => `${client.selfId}-obj-${++n}`,
        now: () => 1_000,
    });
    client.joinRoom(room);
    return { client, world };
}

const human = (client: FakeRoomClient): Actor => ({ userId: client.selfId, origin: "human" });
const agent = (client: FakeRoomClient): Actor => ({ userId: client.selfId, origin: "agent" });

describe("SharedWorld replication", () => {
    it("an object spawned by one peer appears for the others", async () => {
        const server = new FakeRoomServer();
        const a = connect(server);
        const b = connect(server);

        const res = await a.world.spawn({ kind: "cube", color: "#99CC33" }, human(a.client));

        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(b.world.get(res.object.guid)?.color).toBe("#99CC33");
    });

    it("a peer joining later receives everything already built", async () => {
        const server = new FakeRoomServer();
        const a = connect(server);
        await a.world.spawn({ kind: "cube" }, human(a.client));
        await a.world.spawn({ kind: "sphere" }, human(a.client));

        // Joins after the fact: everything must arrive as replayed room state.
        const late = connect(server);

        expect(late.world.list()).toHaveLength(2);
        expect(late.world.list().map(o => o.kind).sort()).toEqual(["cube", "sphere"]);
    });

    it("picks up replayed state even when it arrives before the join is acknowledged", async () => {
        // The engine does not specify whether joined-room precedes the state
        // replay. Nothing here may depend on it, so the opposite order has to
        // produce the same world.
        const server = new FakeRoomServer({ stateBeforeJoinAck: true });
        const a = connect(server);
        await a.world.spawn({ kind: "cube", color: "#0BA398" }, human(a.client));

        const late = connect(server);

        expect(late.world.list()).toHaveLength(1);
        expect(late.world.list()[0].color).toBe("#0BA398");
    });

    it("a removed object is gone from room state, so later joiners never see it", async () => {
        const server = new FakeRoomServer();
        const a = connect(server);
        const spawned = await a.world.spawn({ kind: "cube" }, human(a.client));
        if (!spawned.ok) throw new Error("spawn failed");

        await a.world.remove(spawned.object.guid, human(a.client));

        expect(server.savedGuids()).not.toContain(spawned.object.guid);
        const late = connect(server);
        expect(late.world.get(spawned.object.guid)).toBeNull();
        expect(late.world.list()).toHaveLength(0);
    });

    it("does not stack objects when nobody says where to put them", async () => {
        const server = new FakeRoomServer();
        const a = connect(server);

        for (let i = 0; i < 5; i++) await a.world.spawn({ kind: "cube" }, human(a.client));

        const positions = a.world.list().map(o => o.position.join(","));
        expect(new Set(positions).size).toBe(5);
        // and an explicit position still wins
        const placed = await a.world.spawn({ kind: "sphere", position: [2, 1, 3] }, human(a.client));
        if (!placed.ok) throw new Error("spawn failed");
        expect(placed.object.position).toEqual([2, 1, 3]);
    });

    it("a removal reaches the peers who are already in the room", async () => {
        const server = new FakeRoomServer();
        const a = connect(server);
        const b = connect(server);
        const spawned = await a.world.spawn({ kind: "cube" }, human(a.client));
        if (!spawned.ok) throw new Error("spawn failed");
        expect(b.world.get(spawned.object.guid)).not.toBeNull();

        await a.world.remove(spawned.object.guid, human(a.client));

        expect(b.world.get(spawned.object.guid)).toBeNull();
    });

    it("carries attribution across the wire, so a peer can tell agent work from human work", async () => {
        const server = new FakeRoomServer();
        const a = connect(server);
        const b = connect(server);

        const res = await a.world.spawn({ kind: "sphere" }, agent(a.client));
        if (!res.ok) throw new Error("spawn failed");

        expect(b.world.get(res.object.guid)?.createdBy).toEqual({
            userId: a.client.selfId,
            origin: "agent",
        });
    });
});

describe("SharedWorld authority", () => {
    it("refuses to mutate an object another peer is holding, and names the holder", async () => {
        const server = new FakeRoomServer();
        const a = connect(server);
        const b = connect(server);

        const res = await a.world.spawn({ kind: "cube", color: "#99CC33" }, human(a.client));
        if (!res.ok) throw new Error("spawn failed");
        const guid = res.object.guid;

        // b picks it up first — a's agent must not silently overwrite.
        await b.client.requestOwnership(guid);

        const edit = await a.world.recolor(guid, "hotpink", agent(a.client));

        expect(edit.ok).toBe(false);
        if (edit.ok) return;
        expect(edit.reason).toBe("held-by-other");
        expect(edit.heldBy).toBe(b.client.selfId);
        // and the object is untouched everywhere
        expect(b.world.get(guid)?.color).toBe("#99CC33");
    });

    it("allows the mutation once the holder lets go", async () => {
        const server = new FakeRoomServer();
        const a = connect(server);
        const b = connect(server);

        const res = await a.world.spawn({ kind: "cube", color: "#99CC33" }, human(a.client));
        if (!res.ok) throw new Error("spawn failed");
        const guid = res.object.guid;

        await b.client.requestOwnership(guid);
        b.client.releaseOwnership(guid);

        const edit = await a.world.recolor(guid, "hotpink", agent(a.client));

        expect(edit.ok).toBe(true);
        expect(b.world.get(guid)?.color).toBe("hotpink");
    });

    it("reports a missing object instead of inventing one", async () => {
        const server = new FakeRoomServer();
        const a = connect(server);

        const edit = await a.world.recolor("no-such-guid", "red", agent(a.client));

        expect(edit.ok).toBe(false);
        if (edit.ok) return;
        expect(edit.reason).toBe("not-found");
    });
});

describe("transport contract", () => {
    // Pins the semantics the production adapter must reproduce against the real
    // NetworkConnection — presence must not outlive the peer that announced it.
    it("drops untilDisconnect state when its sender leaves", () => {
        const server = new FakeRoomServer();
        const a = server.connect();
        const b = server.connect();
        a.joinRoom("workshop");
        b.joinRoom("workshop");

        a.send("presence", { guid: "presence-a", at: [0, 0, 0] }, { untilDisconnect: true });
        expect(server.savedGuids()).toContain("presence-a");

        a.disconnect();
        expect(server.savedGuids()).not.toContain("presence-a");
    });

    it("keeps built objects when their builder leaves", () => {
        const server = new FakeRoomServer();
        const a = server.connect();
        a.joinRoom("workshop");

        a.send("world-object", { guid: "cube-1", kind: "cube" });
        a.disconnect();

        expect(server.savedGuids()).toContain("cube-1");
    });

    it("never echoes a broadcast back to its sender", () => {
        const server = new FakeRoomServer();
        const a = server.connect();
        a.joinRoom("workshop");
        const seen: string[] = [];
        a.listen("world-object", m => seen.push(m.guid));

        a.send("world-object", { guid: "cube-1", kind: "cube" });

        expect(seen).toEqual([]);
    });

    it("transient payloads reach peers but are never persisted", () => {
        const server = new FakeRoomServer();
        const a = server.connect();
        const b = server.connect();
        a.joinRoom("workshop");
        b.joinRoom("workshop");
        const seen: string[] = [];
        b.listen("marker", m => seen.push(m.guid));

        a.send("marker", { guid: "ping-1", at: [1, 0, 1] }, { transient: true });

        expect(seen).toEqual(["ping-1"]);
        expect(server.savedGuids()).not.toContain("ping-1");
    });
});
