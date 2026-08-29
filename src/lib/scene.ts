import { onStart, addComponent, ContactShadows, ObjectUtils, OrbitControls, findObjectOfType, Behaviour } from "@needle-tools/engine";
import * as THREE from "three";
import registry from "../../registry.json";

/** One floating shape per app in the registry, arranged in a ring. Brand palette. */
onStart(context => {
    const scene = context.scene;

    context.mainCamera.position.set(0, 1.6, 6);

    const ground = ObjectUtils.createPrimitive("Cylinder", {
        scale: [3.2, .04, 3.2],
        position: [0, -.02, 0],
        material: new THREE.MeshStandardMaterial({ color: new THREE.Color("#FFFFFF"), metalness: .05, roughness: .55 }),
    });
    scene.add(ground);

    const shapes = ["Cube", "Sphere", "Cylinder"] as const;
    const palette = ["#99CC33", "#0BA398", "#826AED", "#D7DB0A", "#74AF52", "#62D399"];
    const apps = registry.apps;
    const radius = 1.8;
    for (let i = 0; i < apps.length; i++) {
        const angle = (i / apps.length) * Math.PI * 2;
        const mesh = ObjectUtils.createPrimitive(shapes[i % shapes.length], {
            scale: [.45, .45, .45],
            position: [Math.cos(angle) * radius, 1, Math.sin(angle) * radius],
            material: new THREE.MeshStandardMaterial({
                color: new THREE.Color(palette[i % palette.length]),
                metalness: .25,
                roughness: .3,
            }),
        });
        mesh.name = apps[i].name;
        addComponent(mesh, FloatAndSpin, { phase: angle, speed: .4 + (i % 3) * .15 });
        scene.add(mesh);
    }

    const contactshadows = ContactShadows.auto();
    contactshadows.darkness = .6;
    contactshadows.opacity = .7;

    const orbit = findObjectOfType(OrbitControls);
    if (orbit) {
        orbit.autoRotate = true;
        orbit.autoRotateSpeed = .6;
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
        this.gameObject.position.y = this._baseY + Math.sin(t * this.speed * 2 + this.phase) * .12;
        this.gameObject.rotateY(this.context.time.deltaTime * this.speed);
    }
}
