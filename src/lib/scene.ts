import { onStart, addComponent, ContactShadows, ObjectUtils, OrbitControls, findObjectOfType, Behaviour } from "@needle-tools/engine";
import * as THREE from "three";
import registry from "../../registry.json";

/**
 * One floating shape per app in the registry, arranged in a ring on a plain
 * background that matches the hero panel — no ground, just soft contact
 * shadows, so the 3D blends into the page instead of sitting in a grey box.
 */
onStart(context => {
    const scene = context.scene;

    context.mainCamera.position.set(0, 1.5, 5.4);

    const shapes = ["Cube", "Sphere", "Cylinder"] as const;
    const palette = ["#99CC33", "#0BA398", "#826AED", "#D7DB0A", "#74AF52", "#62D399"];
    const apps = registry.apps;
    // A wide ring of large shapes orbiting the title, which sits at the ring's center.
    const radius = 2.5;
    for (let i = 0; i < apps.length; i++) {
        const angle = (i / apps.length) * Math.PI * 2;
        const size = i % 2 === 0 ? 1 : .75;
        const mesh = ObjectUtils.createPrimitive(shapes[i % shapes.length], {
            scale: [size, size, size],
            position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
            material: new THREE.MeshStandardMaterial({
                color: new THREE.Color(palette[i % palette.length]),
                metalness: .2,
                roughness: .35,
            }),
        });
        mesh.name = apps[i].name;
        addComponent(mesh, FloatAndSpin, { phase: angle, speed: .35 + (i % 3) * .12 });
        scene.add(mesh);
    }

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
});

class FloatAndSpin extends Behaviour {
    phase: number = 0;
    speed: number = .5;
    private _baseY: number = 1;

    start() {
        this._baseY = this.gameObject.position.y;
    }
    update() {
        const t = this.context.time.time;
        this.gameObject.position.y = this._baseY + Math.sin(t * this.speed * 2 + this.phase) * .18;
        this.gameObject.rotateY(this.context.time.deltaTime * this.speed);
    }
}
