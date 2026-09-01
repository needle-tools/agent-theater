/**
 * The WebMCP tools an agent gets when its person opens the room.
 *
 * Three bands, and the middle one is the point of the whole thing:
 *  - reading the room (`world_describe`, `world_find`)
 *  - changing the room (`world_spawn`, `world_recolor`, `world_transform`,
 *    `world_delete`)
 *  - being present in it alongside people (`world_who_is_here`,
 *    `world_point_at`, `world_say`)
 *
 * Everything here goes through SharedWorld, so replication, attribution and
 * authority are not this file's business. What IS this file's business: never
 * throwing at the browser, and never destroying anything without asking.
 *
 * Descriptions stay short on purpose — tool definitions ride along on every
 * turn of the agent's conversation, so detail belongs in the result text.
 */
import type { RoomModel, RoomTransport } from "./transport.js";
import { OBJECT_KINDS, type Actor, type EditResult, type ObjectKind, type SharedWorld, type WorldObject } from "./world.js";
import type { ConsentGate } from "./consent.js";

/** Broadcast-only gestures. Never persisted — see the `transient` send option. */
const MARKER_KEY = "room-marker";
const SAY_KEY = "room-say";

export interface ToolResult {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: object;
    isError?: boolean;
}

export interface WebMcpToolDef {
    name: string;
    title?: string;
    description: string;
    inputSchema: object;
    annotations?: object;
    execute: (args: any) => Promise<ToolResult>;
}

export interface RoomToolDeps {
    world: SharedWorld;
    transport: RoomTransport;
    consent: ConsentGate;
}

const ok = (text: string, structured?: object): ToolResult => ({
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
});

const fail = (text: string, structured?: object): ToolResult => ({ ...ok(text, structured), isError: true });

export function createRoomTools({ world, transport, consent }: RoomToolDeps): WebMcpToolDef[] {
    /** Anything reached through these tools was done by an agent, not a person. */
    const actor = (): Actor => ({ userId: transport.selfId ?? "unknown", origin: "agent" });

    const describeObject = (o: WorldObject) =>
        `${o.label} [${o.guid}] — ${o.kind}, ${o.color}, at ${o.position.map(n => n.toFixed(1)).join(", ")}` +
        `, placed by ${o.createdBy.origin === "agent" ? "an agent" : "a person"}`;

    const relay = (result: EditResult, success: (o: WorldObject) => string): ToolResult =>
        result.ok
            ? ok(success(result.object), { object: result.object })
            : fail(result.message, { reason: result.reason, ...(result.heldBy ? { heldBy: result.heldBy } : {}) });

    const requireObject = (id: unknown) => {
        if (typeof id !== "string" || !id) return { error: fail(`Pass the "id" of an object. Call world_describe to see what is here.`) };
        const object = world.get(id);
        if (!object) return { error: fail(`There is no object with id "${id}" in this room. Call world_describe for the current contents.`) };
        return { object };
    };

    const position3 = (value: unknown): [number, number, number] | null => {
        if (!Array.isArray(value) || value.length !== 3) return null;
        if (!value.every(n => typeof n === "number" && Number.isFinite(n))) return null;
        return [value[0], value[1], value[2]];
    };

    return [
        {
            name: "world_describe",
            title: "Describe the shared room",
            annotations: { readOnlyHint: true },
            description: "List everything in this shared 3D room and who is here. Call before changing anything.",
            inputSchema: { type: "object", properties: {} },
            async execute() {
                const objects = world.list();
                const people = transport.usersInRoom();
                const body = objects.length
                    ? objects.map(describeObject).join("\n")
                    : "The room is empty.";
                return ok(
                    `${objects.length} object(s), ${people.length} person/people connected.\n\n${body}`,
                    { objects, people, you: transport.selfId },
                );
            },
        },
        {
            name: "world_find",
            title: "Find objects in the room",
            annotations: { readOnlyHint: true },
            description: "Find objects in the room by name, shape or colour. Returns their ids for editing.",
            inputSchema: {
                type: "object",
                properties: { query: { type: "string", description: "Words to match, e.g. 'green cube'." } },
                required: ["query"],
            },
            async execute(args: { query?: string }) {
                const query = (args?.query ?? "").trim().toLowerCase();
                if (!query) return fail(`Pass a "query" describing what to look for.`);
                const words = query.split(/[^a-z0-9#]+/).filter(Boolean);
                const matches = world.list().filter(o => {
                    const haystack = `${o.label} ${o.kind} ${o.color}`.toLowerCase();
                    return words.some(w => haystack.includes(w));
                });
                if (!matches.length) return ok(`Nothing matches "${query}". Call world_describe to see everything.`, { matches: [] });
                return ok(matches.map(describeObject).join("\n"), { matches });
            },
        },
        {
            name: "world_spawn",
            title: "Put an object into the room",
            description: "Place a cube, sphere or cylinder into the shared room. Everyone present sees it appear.",
            inputSchema: {
                type: "object",
                properties: {
                    kind: { type: "string", enum: [...OBJECT_KINDS], description: "Which shape to place." },
                    color: { type: "string", description: "Any CSS colour. Defaults to the room palette." },
                    position: { type: "array", items: { type: "number" }, description: "[x, y, z]. Defaults to the centre." },
                    scale: { type: "number", description: "Uniform size, 0.2–2. Default 0.7." },
                    label: { type: "string", description: "A name people will see, e.g. 'the tall one'." },
                },
                required: ["kind"],
            },
            async execute(args: { kind?: string; color?: string; position?: unknown; scale?: number; label?: string }) {
                if (!OBJECT_KINDS.includes(args?.kind as ObjectKind))
                    return fail(`"${args?.kind}" is not a shape I can place. Use one of: ${OBJECT_KINDS.join(", ")}.`);
                let position: [number, number, number] | undefined;
                if (args?.position !== undefined) {
                    const parsed = position3(args.position);
                    if (!parsed) return fail(`"position" must be three numbers, like [0, 1, 2].`);
                    position = parsed;
                }
                const scale = typeof args?.scale === "number" ? Math.min(2, Math.max(.2, args.scale)) : undefined;
                const result = await world.spawn(
                    { kind: args!.kind as ObjectKind, color: args?.color, position, scale, label: args?.label },
                    actor(),
                );
                return relay(result, o => `Placed ${o.label} (${o.color}). Everyone in the room can see it. Its id is ${o.guid}.`);
            },
        },
        {
            name: "world_recolor",
            title: "Recolour an object",
            description: "Change the colour of one object in the room, by id.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "The object's id, from world_describe or world_find." },
                    color: { type: "string", description: "Any CSS colour, e.g. '#99CC33' or 'hotpink'." },
                },
                required: ["id", "color"],
            },
            async execute(args: { id?: string; color?: string }) {
                const found = requireObject(args?.id);
                if (found.error) return found.error;
                if (typeof args?.color !== "string" || !args.color) return fail(`Pass a "color", e.g. '#99CC33' or 'hotpink'.`);
                const result = await world.recolor(found.object.guid, args.color, actor());
                return relay(result, o => `${o.label} is now ${o.color}.`);
            },
        },
        {
            name: "world_transform",
            title: "Move or resize an object",
            description: "Move or resize one object in the room, by id. Pass position, scale, or both.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "The object's id." },
                    position: { type: "array", items: { type: "number" }, description: "[x, y, z]." },
                    scale: { type: "number", description: "Uniform size, 0.2–2." },
                },
                required: ["id"],
            },
            async execute(args: { id?: string; position?: unknown; scale?: number }) {
                const found = requireObject(args?.id);
                if (found.error) return found.error;
                let position: [number, number, number] | undefined;
                if (args?.position !== undefined) {
                    const parsed = position3(args.position);
                    if (!parsed) return fail(`"position" must be three numbers, like [0, 1, 2].`);
                    position = parsed;
                }
                const scale = typeof args?.scale === "number" ? Math.min(2, Math.max(.2, args.scale)) : undefined;
                if (position === undefined && scale === undefined)
                    return fail(`Nothing to change — pass "position", "scale", or both.`);
                const result = await world.transform(found.object.guid, { position, scale }, actor());
                return relay(result, o => `Moved ${o.label} to ${o.position.map(n => n.toFixed(1)).join(", ")} at size ${o.scale}.`);
            },
        },
        {
            name: "world_delete",
            title: "Ask to remove an object",
            annotations: { destructiveHint: true },
            description:
                "Ask to remove an object from the shared room. A person in the room must confirm before it happens.",
            inputSchema: {
                type: "object",
                properties: { id: { type: "string", description: "The object's id." } },
                required: ["id"],
            },
            async execute(args: { id?: string }) {
                const found = requireObject(args?.id);
                if (found.error) return found.error;
                const target = found.object;
                // The room is persistent and shared: this is gone for everyone,
                // including people who never saw it happen. So it waits.
                const proposal = consent.propose(
                    `Remove "${target.label}" (${target.kind}, ${target.color}) from the room.`,
                    () => world.remove(target.guid, actor()),
                );
                return ok(
                    `Asked to remove "${target.label}". Someone in the room has to confirm it — ` +
                    `nothing has changed yet. Tell the person you are waiting on their confirmation.`,
                    { awaitingConfirmation: true, proposalId: proposal.id, target },
                );
            },
        },
        {
            name: "world_who_is_here",
            title: "See who is in the room",
            annotations: { readOnlyHint: true },
            description: "List the people currently connected to this shared room.",
            inputSchema: { type: "object", properties: {} },
            async execute() {
                const people = transport.usersInRoom();
                const others = people.filter(id => id !== transport.selfId);
                return ok(
                    others.length
                        ? `${others.length} other person/people here: ${others.join(", ")}. You are with ${transport.selfId}.`
                        : `Nobody else is here right now. You are with ${transport.selfId}.`,
                    { people, you: transport.selfId },
                );
            },
        },
        {
            name: "world_point_at",
            title: "Point at a place in the room",
            description: "Show a temporary marker in the room so the people there can see where you mean.",
            inputSchema: {
                type: "object",
                properties: {
                    position: { type: "array", items: { type: "number" }, description: "[x, y, z] to point at." },
                    label: { type: "string", description: "Short caption shown next to the marker." },
                },
                required: ["position"],
            },
            async execute(args: { position?: unknown; label?: string }) {
                const position = position3(args?.position);
                if (!position) return fail(`"position" must be three numbers, like [0, 1, 2].`);
                const label = (args?.label ?? "here").slice(0, 60);
                transport.send(
                    MARKER_KEY,
                    { guid: `marker-${transport.selfId}`, position, label, from: transport.selfId } as RoomModel,
                    { transient: true },
                );
                return ok(`Pointing at ${position.join(", ")} with the caption "${label}". It fades on its own.`);
            },
        },
        {
            name: "world_say",
            title: "Say something in the room",
            description: "Post a short message into the room for the people there to read.",
            inputSchema: {
                type: "object",
                properties: { text: { type: "string", description: "What to say. Keep it short." } },
                required: ["text"],
            },
            async execute(args: { text?: string }) {
                const text = (args?.text ?? "").trim();
                if (!text) return fail(`Pass some "text" to say.`);
                transport.send(
                    SAY_KEY,
                    { guid: `say-${transport.selfId}`, text: text.slice(0, 280), from: transport.selfId } as RoomModel,
                    { transient: true },
                );
                return ok(`Said: "${text}"`);
            },
        },
    ];
}
