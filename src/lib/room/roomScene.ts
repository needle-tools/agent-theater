/**
 * Draws the shared room and keeps it in step with the world model.
 *
 * The scene owns no truth. Everything visible here is a projection of
 * SharedWorld, so a change made by a person, by an agent, or by a peer three
 * time zones away all arrive through exactly the same path.
 *
 * The scenery — floor, platform, light — is deliberately NOT networked. It is
 * identical for everyone and belongs to no one, so putting it in room state
 * would only add a race on first join and clutter the thing agents read.
 */
import {
    Behaviour, Context, ContactShadows, ObjectUtils, OrbitControls,
    addComponent, findObjectOfType, onStart,
} from "@needle-tools/engine";
import * as THREE from "three";
import { registerTools } from "../webmcp.js";
import { createRoomTools } from "./tools.js";
import { notifyAgentActivity } from "./activity.js";
import { startRoomSession, type RoomSession } from "./session.js";
import type { ObjectKind, WorldObject } from "./world.js";

/** Our lowercase kinds → the engine's primitive names. */
const PRIMITIVE: Record<ObjectKind, "Cube" | "Sphere" | "Cylinder"> = {
    cube: "Cube",
    sphere: "Sphere",
    cylinder: "Cylinder",
};

const PRESENCE_KEY = "presence";
const MARKER_KEY = "room-marker";
/** Presence is chatty by nature; 10 Hz is smooth enough and cheap. */
const PRESENCE_INTERVAL_MS = 100;
const MARKER_LIFETIME_MS = 4000;
/** Agent-placed objects carry this glow, so authorship is visible in the room. */
const AGENT_ACCENT = "#D7DB0A";

/** Scale-in with a little overshoot, so a spawn is something you notice. */
class SpawnPop extends Behaviour {
    target: number = 1;
    private elapsed = 0;
    private readonly duration = .45;

    start() { this.gameObject.scale.setScalar(0.001); }

    update() {
        if (this.elapsed >= this.duration) return;
        this.elapsed = Math.min(this.duration, this.elapsed + this.context.time.deltaTime);
        const t = this.elapsed / this.duration;
        // Ease out back: overshoots slightly, then settles.
        const s = 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
        this.gameObject.scale.setScalar(Math.max(0.001, this.target * s));
    }

    retarget(scale: number) {
        this.target = scale;
        // A resize after the pop finished should apply straight away.
        if (this.elapsed >= this.duration) this.gameObject.scale.setScalar(scale);
    }
}

/** A stable, pleasant colour per visitor so people are told apart at a glance. */
function colorForPeer(id: string): THREE.Color {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return new THREE.Color().setHSL((hash % 360) / 360, .55, .62);
}

function buildScenery(context: Context) {
    const floor = ObjectUtils.createPrimitive("Quad", {
        scale: [60, 60, 1],
        material: new THREE.MeshStandardMaterial({ color: new THREE.Color("#E7EFE3"), roughness: 1 }),
    });
    floor.rotateX(-Math.PI / 2);
    floor.position.y = -.26;
    floor.name = "floor";
    context.scene.add(floor);

    const grid = new THREE.GridHelper(40, 40, new THREE.Color("#C7D6C0"), new THREE.Color("#DCE7D7"));
    grid.position.y = -.25;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = .5;
    context.scene.add(grid);

    // A platform gives the room a centre and a surface to build on: spawned
    // objects rest at y=0, which is exactly its top face.
    const platform = ObjectUtils.createPrimitive("RoundedCube", {
        scale: [7, .25, 7],
        position: [0, -.125, 0],
        material: new THREE.MeshStandardMaterial({
            color: new THREE.Color("#F7FAF5"), roughness: .75, metalness: .05,
        }),
    });
    platform.name = "platform";
    context.scene.add(platform);

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(4, 8, 5);
    context.scene.add(key);
}

class RoomView {
    private readonly meshes = new Map<string, THREE.Object3D>();
    private readonly pops = new Map<string, SpawnPop>();
    private readonly avatars = new Map<string, THREE.Object3D>();
    private readonly markers = new Map<string, { object: THREE.Object3D; timer: ReturnType<typeof setTimeout> }>();
    private readonly disposers: Array<() => void> = [];

    constructor(private readonly context: Context, private readonly session: RoomSession) {
        this.disposers.push(session.world.onChanged(() => this.syncObjects()));

        this.disposers.push(session.transport.listen(PRESENCE_KEY, model => {
            const id = typeof model.from === "string" ? model.from : null;
            const at = model.at;
            if (!id || id === session.transport.selfId || !Array.isArray(at)) return;
            this.placeAvatar(id, at as number[]);
        }));

        this.disposers.push(session.transport.listen(MARKER_KEY, model => {
            const at = model.position;
            if (Array.isArray(at)) this.showMarker(String(model.guid), at as number[]);
        }));

        this.disposers.push(session.transport.onUserLeft(id => this.removeAvatar(id)));

        const presence = setInterval(() => this.broadcastPresence(), PRESENCE_INTERVAL_MS);
        this.disposers.push(() => clearInterval(presence));

        this.syncObjects();
    }

    dispose() {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
    }

    /** Reconcile: add what is new, update what changed, drop what is gone. */
    private syncObjects() {
        const live = new Set<string>();

        for (const object of this.session.world.list()) {
            live.add(object.guid);
            let mesh = this.meshes.get(object.guid);
            if (!mesh) {
                mesh = this.createMesh(object);
                this.meshes.set(object.guid, mesh);
                this.context.scene.add(mesh);
            }
            this.applyTo(mesh, object);
        }

        for (const [guid, mesh] of [...this.meshes]) {
            if (live.has(guid)) continue;
            mesh.removeFromParent();
            this.meshes.delete(guid);
            this.pops.delete(guid);
        }
    }

    private createMesh(object: WorldObject): THREE.Object3D {
        const mesh = ObjectUtils.createPrimitive(PRIMITIVE[object.kind], {
            material: new THREE.MeshStandardMaterial({ metalness: .15, roughness: .35 }),
        });
        mesh.name = object.label;
        this.pops.set(object.guid, addComponent(mesh, SpawnPop, { target: object.scale }));
        return mesh;
    }

    private applyTo(mesh: THREE.Object3D, object: WorldObject) {
        mesh.name = object.label;
        mesh.position.set(object.position[0], object.position[1], object.position[2]);
        // Scale runs through the pop so an arriving object animates in rather
        // than snapping to size on its first frame.
        this.pops.get(object.guid)?.retarget(object.scale);

        const material = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!material?.color) return;
        // An agent may pass any string; an unparseable colour leaves it as it was.
        try { material.color.set(object.color); } catch { /* keep previous */ }
        const byAgent = object.createdBy.origin === "agent";
        material.emissive.set(byAgent ? AGENT_ACCENT : "#000000");
        material.emissiveIntensity = byAgent ? .32 : 0;
    }

    private broadcastPresence() {
        const camera = this.context.mainCamera;
        const self = this.session.transport.selfId;
        if (!camera || !self || !this.session.transport.isInRoom) return;
        this.session.transport.send(
            PRESENCE_KEY,
            {
                guid: `presence-${self}`,
                from: self,
                at: [camera.position.x, camera.position.y, camera.position.z],
            },
            // Vanishes when we do — presence must never outlive the peer.
            { untilDisconnect: true },
        );
    }

    private placeAvatar(id: string, at: number[]) {
        let avatar = this.avatars.get(id);
        if (!avatar) {
            avatar = ObjectUtils.createPrimitive("Sphere", {
                scale: [.34, .34, .34],
                material: new THREE.MeshStandardMaterial({ color: colorForPeer(id), roughness: .35, metalness: .1 }),
            });
            avatar.name = `visitor ${id}`;
            this.avatars.set(id, avatar);
            this.context.scene.add(avatar);
        }
        // Drawn below their eye line: an avatar exactly at the camera would be
        // invisible to the person it represents and clip anyone standing close.
        avatar.position.set(at[0] ?? 0, (at[1] ?? 0) - .55, at[2] ?? 0);
    }

    private removeAvatar(id: string) {
        this.avatars.get(id)?.removeFromParent();
        this.avatars.delete(id);
    }

    private showMarker(guid: string, at: number[]) {
        const existing = this.markers.get(guid);
        if (existing) {
            clearTimeout(existing.timer);
            existing.object.removeFromParent();
        }
        const marker = ObjectUtils.createPrimitive("Sphere", {
            scale: [.18, .18, .18],
            material: new THREE.MeshStandardMaterial({
                color: new THREE.Color(AGENT_ACCENT),
                emissive: new THREE.Color(AGENT_ACCENT),
                emissiveIntensity: .8,
            }),
        });
        marker.position.set(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0);
        this.context.scene.add(marker);
        const timer = setTimeout(() => {
            marker.removeFromParent();
            this.markers.delete(guid);
        }, MARKER_LIFETIME_MS);
        this.markers.set(guid, { object: marker, timer });
    }
}

let setupDone = false;

async function setup(context: Context) {
    if (setupDone) return;
    setupDone = true;

    buildScenery(context);

    // Visitors start on different sides of the room. Identical start positions
    // put every avatar inside every other camera, where nobody can see it.
    const angle = Math.random() * Math.PI * 2;
    context.mainCamera?.position.set(Math.cos(angle) * 7, 2.6, Math.sin(angle) * 7);

    const shadows = ContactShadows.auto();
    shadows.darkness = .45;
    shadows.opacity = .5;

    const orbit = findObjectOfType(OrbitControls);
    if (orbit) {
        orbit.autoRotate = false;
        orbit.enableZoom = true;
        orbit.enablePan = false;
    }

    const session = await startRoomSession(context);
    new RoomView(context, session);

    // Wrapped once, here, rather than in each tool: the page dims its overlay
    // when an agent starts working, and that should not be nine call sites.
    const tools = createRoomTools({
        world: session.world,
        transport: session.transport,
        consent: session.consent,
    }).map(tool => ({
        ...tool,
        execute: async (args: unknown) => {
            notifyAgentActivity(tool.name);
            return tool.execute(args);
        },
    }));

    await registerTools(tools);
}

onStart(context => { void setup(context); });

// onStart only fires for hooks registered before the first frame, and this
// module is imported dynamically — so if the engine is already running, set up
// against the live context instead.
const bootstrap = setInterval(() => {
    if (setupDone) return clearInterval(bootstrap);
    const current = Context.Current;
    if (current?.scene && current.mainCamera) {
        clearInterval(bootstrap);
        void setup(current);
    }
}, 200);
setTimeout(() => clearInterval(bootstrap), 20000);
