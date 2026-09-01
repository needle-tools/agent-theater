import { describe, it, expect } from "vitest";
import { FakeRoomServer, type FakeRoomClient } from "./fakeRoom.js";
import { SharedWorld } from "../src/lib/room/world.js";
import { ConsentGate } from "../src/lib/room/consent.js";
import { createRoomTools, type WebMcpToolDef } from "../src/lib/room/tools.js";

/**
 * The tools are the agent's whole surface onto the room. They must never throw
 * at the browser, must never mutate on a destructive call without a person
 * agreeing first, and must explain refusals well enough for an agent to relay
 * them to the person sitting there.
 */

function setup(room = "workshop") {
    const server = new FakeRoomServer();
    const build = () => {
        const client = server.connect();
        let n = 0;
        const world = new SharedWorld(client, {
            newGuid: () => `${client.selfId}-obj-${++n}`,
            now: () => 1_000,
        });
        const consent = new ConsentGate({ newId: () => `proposal-${client.selfId}-${++n}` });
        const tools = createRoomTools({ world, transport: client, consent });
        client.joinRoom(room);
        return { client, world, consent, tools, tool: (name: string) => byName(tools, name) };
    };
    return { server, build };
}

function byName(tools: WebMcpToolDef[], name: string): WebMcpToolDef {
    const tool = tools.find(t => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}; have: ${tools.map(t => t.name).join(", ")}`);
    return tool;
}

const textOf = (result: { content: Array<{ text: string }> }) => result.content.map(c => c.text).join("\n");

describe("tool surface", () => {
    it("every tool is MCP-shaped: name, description, object schema", () => {
        const { build } = setup();
        const { tools } = build();

        expect(tools.length).toBeGreaterThan(0);
        for (const tool of tools) {
            expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
            expect(tool.description.length).toBeGreaterThan(20);
            expect((tool.inputSchema as { type?: string }).type).toBe("object");
            expect(typeof tool.execute).toBe("function");
        }
    });

    it("returns a structured error rather than throwing on bad arguments", async () => {
        const { build } = setup();
        const { tool } = build();

        const result = await tool("world_spawn").execute({ kind: "dodecahedron" });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toMatch(/cube|sphere|cylinder/);
    });

    it("describes the room including who built what", async () => {
        const { build } = setup();
        const a = build();
        await a.tool("world_spawn").execute({ kind: "cube", color: "#99CC33" });

        const result = await a.tool("world_describe").execute({});

        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain("cube");
        const structured = result.structuredContent as { objects: Array<{ createdBy: { origin: string } }> };
        expect(structured.objects).toHaveLength(1);
        // Anything an agent does through these tools is agent-attributed.
        expect(structured.objects[0].createdBy.origin).toBe("agent");
    });

    it("spawns into the shared room so other peers see it", async () => {
        const { build } = setup();
        const a = build();
        const b = build();

        await a.tool("world_spawn").execute({ kind: "sphere", color: "hotpink" });

        expect(b.world.list()).toHaveLength(1);
        expect(b.world.list()[0].color).toBe("hotpink");
    });

    it("refuses to edit an object a person is holding, and says who", async () => {
        const { build } = setup();
        const a = build();
        const b = build();
        const spawned = await a.world.spawn({ kind: "cube", color: "#99CC33" }, { userId: a.client.selfId, origin: "human" });
        if (!spawned.ok) throw new Error("spawn failed");
        await b.client.requestOwnership(spawned.object.guid);

        const result = await a.tool("world_recolor").execute({ id: spawned.object.guid, color: "red" });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(b.client.selfId);
        expect(b.world.get(spawned.object.guid)?.color).toBe("#99CC33");
    });

    it("points at a place without leaving anything behind in room state", async () => {
        const { server, build } = setup();
        const a = build();
        const b = build();
        const seen: string[] = [];
        b.client.listen("room-marker", m => seen.push(String(m.label ?? "")));

        const result = await a.tool("world_point_at").execute({ position: [1, 0, 2], label: "over here" });

        expect(result.isError).toBeFalsy();
        expect(seen).toEqual(["over here"]);
        // A marker is a gesture, not furniture — it must not persist for joiners.
        expect(server.savedGuids()).toHaveLength(0);
    });
});

describe("consent gate", () => {
    it("does not delete on the tool call — it asks first", async () => {
        const { build } = setup();
        const a = build();
        const spawned = await a.world.spawn({ kind: "cube" }, { userId: a.client.selfId, origin: "human" });
        if (!spawned.ok) throw new Error("spawn failed");

        const result = await a.tool("world_delete").execute({ id: spawned.object.guid });

        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toMatch(/confirm/i);
        // Still there. Nothing happens until a person agrees.
        expect(a.world.get(spawned.object.guid)).not.toBeNull();
        expect(a.consent.pending()).toHaveLength(1);
    });

    it("carries the deletion out once a person confirms", async () => {
        const { build } = setup();
        const a = build();
        const spawned = await a.world.spawn({ kind: "cube" }, { userId: a.client.selfId, origin: "human" });
        if (!spawned.ok) throw new Error("spawn failed");
        await a.tool("world_delete").execute({ id: spawned.object.guid });

        const [proposal] = a.consent.pending();
        await a.consent.confirm(proposal.id);

        expect(a.world.get(spawned.object.guid)).toBeNull();
        expect(a.consent.pending()).toHaveLength(0);
    });

    it("leaves the object alone when a person rejects", async () => {
        const { build } = setup();
        const a = build();
        const spawned = await a.world.spawn({ kind: "cube" }, { userId: a.client.selfId, origin: "human" });
        if (!spawned.ok) throw new Error("spawn failed");
        await a.tool("world_delete").execute({ id: spawned.object.guid });

        const [proposal] = a.consent.pending();
        a.consent.reject(proposal.id);

        expect(a.world.get(spawned.object.guid)).not.toBeNull();
        expect(a.consent.pending()).toHaveLength(0);
    });

    it("describes what it is about to do, so the prompt is not a blank cheque", async () => {
        const { build } = setup();
        const a = build();
        const spawned = await a.world.spawn({ kind: "cube", label: "the green one" }, { userId: a.client.selfId, origin: "human" });
        if (!spawned.ok) throw new Error("spawn failed");

        await a.tool("world_delete").execute({ id: spawned.object.guid });

        expect(a.consent.pending()[0].summary).toContain("the green one");
    });

    it("refuses to delete something that is not there, without asking a person", async () => {
        const { build } = setup();
        const a = build();

        const result = await a.tool("world_delete").execute({ id: "nope" });

        expect(result.isError).toBe(true);
        expect(a.consent.pending()).toHaveLength(0);
    });
});
