import { onStart, addComponent, ContactShadows, ObjectUtils, OrbitControls, findObjectOfType, Behaviour, Context } from "@needle-tools/engine";
import * as THREE from "three";
import registry from "../../registry.json";
import { registerTools } from "./webmcp.js";

/**
 * The hero scene: one floating shape per app in the registry, arranged in a
 * ring around the title. The scene is itself agent-controllable — it registers
 * WebMCP tools to add shapes, recolor, rearrange and spin, so the first tool
 * call a visitor's agent makes can visibly change the page.
 */

const PALETTE = ["#99CC33", "#0BA398", "#826AED", "#D7DB0A", "#74AF52", "#62D399"];
const SHAPES = ["Cube", "Sphere", "Cylinder"] as const;
type ShapeName = (typeof SHAPES)[number];
const MAX_SHAPES = 24;

type Layout = "ring" | "line" | "grid" | "scatter";

let speedMultiplier = 1;

class FloatAndSpin extends Behaviour {
    phase: number = 0;
    speed: number = .5;
    readonly targetBase = new THREE.Vector3();
    private readonly _base = new THREE.Vector3();

    start() {
        this._base.copy(this.gameObject.position);
        if (this.targetBase.lengthSq() === 0) this.targetBase.copy(this._base);
    }
    update() {
        const dt = this.context.time.deltaTime;
        this._base.lerp(this.targetBase, Math.min(1, dt * 3));
        const t = this.context.time.time * speedMultiplier;
        this.gameObject.position.set(
            this._base.x,
            this._base.y + Math.sin(t * this.speed * 2 + this.phase) * .18,
            this._base.z);
        this.gameObject.rotateY(dt * this.speed * speedMultiplier);
    }
}

type Entry = { mesh: THREE.Object3D; comp: FloatAndSpin; shape: ShapeName; color: string };

const entries: Entry[] = [];
let currentLayout: Layout = "ring";
let sceneRef: THREE.Object3D | null = null;

function makeShape(shape: ShapeName, color: string, size: number, name: string): Entry {
    const mesh = ObjectUtils.createPrimitive(shape, {
        scale: [size, size, size],
        position: [0, 0, 0],
        material: new THREE.MeshStandardMaterial({
            color: new THREE.Color(color),
            metalness: .2,
            roughness: .35,
        }),
    });
    mesh.name = name;
    const comp = addComponent(mesh, FloatAndSpin, {
        phase: Math.random() * Math.PI * 2,
        speed: .35 + Math.random() * .25,
    });
    return { mesh, comp, shape, color };
}

/** Frame the whole arrangement with margin — the hero is a wide, short strip. */
function refitCamera(immediate: boolean) {
    const orbit = findObjectOfType(OrbitControls);
    if (!orbit || !entries.length) return;
    try {
        orbit.fitCamera({
            objects: entries.map(e => e.mesh),
            immediate,
            fitOffset: 1.15,
            fov: 22,
            relativeTargetOffset: { y: .05 },
        });
    } catch (err) {
        console.debug("[needle-webmcp] camera fit skipped:", err);
    }
}

function applyLayout(layout: Layout) {
    currentLayout = layout;
    const n = entries.length;
    entries.forEach((e, i) => {
        const target = e.comp.targetBase;
        switch (layout) {
            case "line": {
                const spread = Math.max(4.5, n * 1.1);
                target.set((i / Math.max(1, n - 1) - .5) * spread, 0, 0);
                break;
            }
            case "grid": {
                const cols = Math.ceil(Math.sqrt(n));
                const rows = Math.ceil(n / cols);
                target.set(
                    ((i % cols) - (cols - 1) / 2) * 1.6,
                    0,
                    (Math.floor(i / cols) - (rows - 1) / 2) * 1.6);
                break;
            }
            case "scatter": {
                target.set((Math.random() - .5) * 6, Math.random() * 1.6, (Math.random() - .5) * 4);
                break;
            }
            case "ring":
            default: {
                const radius = Math.max(2.5, n * .42);
                const angle = (i / n) * Math.PI * 2;
                target.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
            }
        }
    });
}

function describe() {
    return {
        layout: currentLayout,
        speed: speedMultiplier,
        shapes: entries.map(e => ({ name: e.mesh.name, shape: e.shape, color: e.color })),
    };
}

const toolResult = (summary: string, structured?: object, isError = false) => ({
    content: [{ type: "text", text: summary }],
    ...(structured ? { structuredContent: structured } : {}),
    ...(isError ? { isError: true } : {}),
});

function parseColor(input: string | undefined, fallback: string): string | null {
    if (!input) return fallback;
    try {
        new THREE.Color(input);
        return input;
    } catch {
        return null;
    }
}

function makeHeroTools() {
    return [
        {
            name: "hero_get_scene",
            title: "Describe the hero 3D scene",
            annotations: { readOnlyHint: true },
            description:
                "The 3D scene at the top of this page, which you can control: current layout, " +
                "animation speed, and every shape with its color. Call this before changing things.",
            inputSchema: { type: "object", properties: {} },
            async execute() {
                const state = describe();
                return toolResult(
                    `Layout: ${state.layout}, speed ×${state.speed}. ${state.shapes.length} shapes: ` +
                    state.shapes.map(s => `${s.name} (${s.shape}, ${s.color})`).join(", "), state);
            },
        },
        {
            name: "hero_add_shape",
            title: "Add a shape to the hero scene",
            description:
                "Add a cube, sphere or cylinder to the 3D scene on this page. " +
                "Pass any CSS color. The scene re-arranges to make room.",
            inputSchema: {
                type: "object",
                properties: {
                    shape: { type: "string", enum: [...SHAPES], description: "Which primitive to add." },
                    color: { type: "string", description: "CSS color, e.g. #99CC33 or 'hotpink'. Defaults to the brand palette." },
                    size: { type: "number", description: "Uniform scale, 0.2–2. Default 0.7." },
                },
                required: ["shape"],
            },
            async execute(args: { shape?: string; color?: string; size?: number }) {
                if (!sceneRef) return toolResult("The scene is not ready yet.", undefined, true);
                if (entries.length >= MAX_SHAPES)
                    return toolResult(`The scene is full (${MAX_SHAPES} shapes). Remove some with hero_reset.`, undefined, true);
                const shape = (SHAPES as readonly string[]).includes(args?.shape ?? "") ? args!.shape as ShapeName : null;
                if (!shape) return toolResult(`Unknown shape "${args?.shape}". Use one of: ${SHAPES.join(", ")}.`, undefined, true);
                const color = parseColor(args?.color, PALETTE[entries.length % PALETTE.length]);
                if (!color) return toolResult(`"${args?.color}" is not a valid CSS color.`, undefined, true);
                const size = Math.min(2, Math.max(.2, args?.size ?? .7));
                const entry = makeShape(shape, color, size, `${shape} ${entries.length + 1}`);
                entries.push(entry);
                sceneRef.add(entry.mesh);
                applyLayout(currentLayout);
                return toolResult(`Added ${entry.mesh.name} in ${color}. The scene now has ${entries.length} shapes.`, describe());
            },
        },
        {
            name: "hero_set_colors",
            title: "Recolor the hero scene",
            description:
                "Recolor the shapes in the 3D scene on this page. Pass one or more CSS colors; " +
                "they are applied in order and repeat across all shapes.",
            inputSchema: {
                type: "object",
                properties: {
                    colors: {
                        type: "array",
                        items: { type: "string" },
                        description: "CSS colors, e.g. [\"#ff6b6b\", \"gold\", \"#4ecdc4\"].",
                    },
                },
                required: ["colors"],
            },
            async execute(args: { colors?: string[] }) {
                const colors = (args?.colors ?? []).map(c => parseColor(c, "")).filter((c): c is string => !!c);
                if (!colors.length) return toolResult("Pass at least one valid CSS color.", undefined, true);
                entries.forEach((e, i) => {
                    const color = colors[i % colors.length];
                    e.color = color;
                    const mat = (e.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
                    mat.color.set(color);
                });
                return toolResult(`Recolored ${entries.length} shapes with ${colors.join(", ")}.`, describe());
            },
        },
        {
            name: "hero_arrange",
            title: "Rearrange the hero scene",
            description: "Rearrange the shapes in the 3D scene on this page: a ring, a line, a grid, or a random scatter.",
            inputSchema: {
                type: "object",
                properties: {
                    layout: { type: "string", enum: ["ring", "line", "grid", "scatter"], description: "Target arrangement." },
                },
                required: ["layout"],
            },
            async execute(args: { layout?: string }) {
                const layout = (["ring", "line", "grid", "scatter"] as const).find(l => l === args?.layout);
                if (!layout) return toolResult(`Unknown layout "${args?.layout}". Use ring, line, grid or scatter.`, undefined, true);
                applyLayout(layout);
                refitCamera(false);
                return toolResult(`Shapes are moving into a ${layout}.`, describe());
            },
        },
        {
            name: "hero_set_speed",
            title: "Set the hero scene speed",
            description: "Speed up or calm down the scene's float and spin. 1 is default, 0 freezes, 5 is frantic.",
            inputSchema: {
                type: "object",
                properties: {
                    multiplier: { type: "number", description: "0–5. Default 1." },
                },
                required: ["multiplier"],
            },
            async execute(args: { multiplier?: number }) {
                const m = args?.multiplier;
                if (typeof m !== "number" || !Number.isFinite(m))
                    return toolResult("Pass a numeric multiplier between 0 and 5.", undefined, true);
                speedMultiplier = Math.min(5, Math.max(0, m));
                return toolResult(`Scene speed set to ×${speedMultiplier}.`, describe());
            },
        },
        {
            name: "hero_reset",
            title: "Reset the hero scene",
            description: "Restore the scene's default state: one brand-colored shape per registry app, in a ring.",
            inputSchema: { type: "object", properties: {} },
            async execute() {
                if (!sceneRef) return toolResult("The scene is not ready yet.", undefined, true);
                for (const e of entries) e.mesh.removeFromParent();
                entries.length = 0;
                speedMultiplier = 1;
                spawnDefaults(sceneRef);
                return toolResult("Scene reset to defaults.", describe());
            },
        },
    ];
}

function spawnDefaults(scene: THREE.Object3D) {
    const apps = registry.apps;
    for (let i = 0; i < apps.length; i++) {
        const size = i % 2 === 0 ? 1 : .75;
        const entry = makeShape(SHAPES[i % SHAPES.length], PALETTE[i % PALETTE.length], size, apps[i].name);
        entries.push(entry);
        scene.add(entry.mesh);
    }
    applyLayout("ring");
    // Defaults start in place — the engine auto-fits the camera to the first
    // frame, and a cluster at the origin would frame far too close. Shapes an
    // agent adds later start at the center and animate out instead.
    for (const e of entries) e.mesh.position.copy(e.comp.targetBase);
}

let setupDone = false;

function setup(context: Context) {
    if (setupDone) return;
    setupDone = true;

    sceneRef = context.scene;
    context.mainCamera.position.set(0, 1.5, 5.4);

    spawnDefaults(context.scene);

    const contactshadows = ContactShadows.auto();
    contactshadows.darkness = .5;
    contactshadows.opacity = .55;

    const orbit = findObjectOfType(OrbitControls);
    if (orbit) {
        orbit.autoRotate = true;
        orbit.autoRotateSpeed = .5;
        orbit.enableZoom = false;
        orbit.enablePan = false;
    }
    refitCamera(true);

    registerTools(makeHeroTools());
}

onStart(context => setup(context));

// onStart only fires for hooks registered before the engine's first frame.
// This module is imported dynamically, so the engine may already be running —
// poll briefly and set up directly against the current context.
const bootstrap = setInterval(() => {
    if (setupDone) return clearInterval(bootstrap);
    const current = Context.Current;
    if (current?.scene && current.mainCamera) {
        clearInterval(bootstrap);
        setup(current);
    }
}, 200);
setTimeout(() => clearInterval(bootstrap), 20000);
