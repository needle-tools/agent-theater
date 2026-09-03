/**
 * The painterly worklet: one image, painted again every frame.
 *
 * A cut-out that never changes reads as a sticker. A cut-out that is *repainted*
 * two or three times a second reads as something a person made — because that is
 * what hand-painted animation is: the same drawing, drawn again, never twice the
 * same. Traditional animators call the wobble that results "boil", and they do
 * not try to remove it. It is the tell that a hand was here.
 *
 * We cannot draw the artwork again — we only have one webp. But we can repaint
 * everything *around* the pigment: where the brush ran dry, where the paper
 * tooth showed through, where the wash pooled. Those are generated, not stored,
 * so a new seed is a new take of the same drawing. Three seeds, held at eight
 * frames a second, and one still image boils.
 *
 * Houdini is what makes that affordable. A paint worklet is the only way to run
 * generative drawing code *inside* the CSS box model: the output is a real CSS
 * image, so it can be a `mask-image` on the artwork itself, and the browser
 * repaints it only when an input property changes. Animate one registered
 * integer — `--paint-frame` — through 0, 1, 2 and the worklet is re-run with a
 * different seed each hold. No canvas, no JS per frame, no second asset.
 *
 * Two paints are registered:
 *   painterly-mask — alpha, meant for `mask-image` on the artwork. Bites dry
 *                    brush and paper tooth out of the pigment.
 *   painterly-wash — colour, meant for a `multiply` overlay clipped to the
 *                    silhouette. Tonal brush direction and granulation.
 *
 * Every number that shapes them is a registered custom property, so the whole
 * thing is tunable — and animatable — from a stylesheet.
 */

/**
 * Deterministic randomness, seeded per frame.
 *
 * This has to be seeded rather than `Math.random`: the browser repaints a
 * worklet whenever it feels like it — a resize, a scroll onto screen, a
 * composite — and a random result would mean the artwork visibly reshuffled at
 * moments that have nothing to do with the animation. Seeded, frame 1 is always
 * the same frame 1, and the only thing that changes the picture is the property
 * that is supposed to.
 */
function makeRng(seed) {
    let t = (seed >>> 0) || 0x9e3779b9;
    return function random() {
        t = (t + 0x6d2b79f5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

/** Mixes the frame and the per-object seed into one integer. */
function seedFor(frame, seed, salt) {
    return Math.imul(Math.round(frame) + 1, 0x85ebca6b) ^
        Math.imul(Math.round(seed * 1000) + 1, 0xc2b2ae35) ^
        Math.imul(salt, 0x27d4eb2f);
}

/** A registered property arrives typed; an unregistered one arrives as text. */
function num(props, name, fallback) {
    const value = props.get(name);
    if (value === undefined || value === null) return fallback;
    if (typeof value.value === "number") return value.value;
    const parsed = parseFloat(String(value).trim());
    return Number.isFinite(parsed) ? parsed : fallback;
}

function text(props, name, fallback) {
    const value = props.get(name);
    const string = value === undefined || value === null ? "" : String(value).trim();
    return string || fallback;
}

function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
}

/**
 * One pass of a brush, as a tapered curve rather than a line.
 *
 * Three things separate a brush stroke from a drawn line, and all three are
 * here: it curves slightly (no one draws straight), it is thin at both ends
 * (the brush lands and lifts), and it is not one mark but a handful of bristle
 * tracks that agree with each other. Take any of the three away and the result
 * reads as a marker.
 */
function brush(ctx, rand, from, to, width, color, alpha) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    // The control point sits off to one side of the midpoint: the whole curve
    // is one gentle bow, which is what a wrist does.
    const bow = (rand() - 0.5) * length * 0.16;
    const control = {
        x: (from.x + to.x) / 2 - (dy / length) * bow,
        y: (from.y + to.y) / 2 + (dx / length) * bow,
    };

    // Taper: the gradient runs along the stroke and fades both ends to nothing,
    // so the ink lands and lifts instead of starting and stopping.
    const taper = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    taper.addColorStop(0, "transparent");
    taper.addColorStop(0.12 + rand() * 0.12, color);
    taper.addColorStop(0.72 + rand() * 0.16, color);
    taper.addColorStop(1, "transparent");

    // Five tracks, and the alpha falls away from the middle one. A canvas has
    // no cheap blur — `ctx.filter` would be a full-surface pass several times a
    // second — so softness is built rather than filtered: the faint wide tracks
    // on the outside are the stroke's own feathered edge. Without them each
    // mark is a hard-edged line, and hard-edged pale lines on artwork do not
    // read as dry brush. They read as scratches on the scan.
    const bristles = 5;
    const centre = (bristles - 1) / 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = taper;
    for (let i = 0; i < bristles; i++) {
        const distance = Math.abs(i - centre) / centre;
        const offset = (i - centre) * width * 0.42;
        const ox = (-dy / length) * offset;
        const oy = (dx / length) * offset;
        ctx.globalAlpha = alpha * (1 - distance * 0.72) * (0.6 + rand() * 0.4);
        ctx.lineWidth = width * (0.5 + distance * 0.9);
        ctx.beginPath();
        ctx.moveTo(from.x + ox, from.y + oy);
        ctx.quadraticCurveTo(control.x + ox, control.y + oy, to.x + ox, to.y + oy);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

/** Where a stroke starts and ends, given the angle the brush is being held at. */
function strokeEnds(rand, width, height, angleDeg, lengthScale) {
    const angle = (angleDeg * Math.PI) / 180;
    const diagonal = Math.hypot(width, height);
    const length = diagonal * lengthScale * (0.55 + rand() * 0.75);
    const cx = rand() * width;
    const cy = rand() * height;
    const half = length / 2;
    // A little wander in the angle, or every stroke lies down in lockstep and
    // the surface reads as hatching rather than paint.
    const wobble = angle + (rand() - 0.5) * 0.35;
    const dx = Math.cos(wobble) * half;
    const dy = Math.sin(wobble) * half;
    return [{ x: cx - dx, y: cy - dy }, { x: cx + dx, y: cy + dy }];
}

/**
 * Counts scale with area, not with a fixed number.
 *
 * A stroke count that suits a 200px prop turns a full-width backdrop into a
 * smear, and vice versa. Tie it to the square root of the area — the same
 * "marks per centimetre" a hand would make — and one class works on a mushroom
 * and on a sky. The cap is a promise to the compositor: this worklet runs
 * several times a second on every painted element on the page.
 */
function density(width, height, per1000px, cap) {
    const scale = Math.sqrt(width * height) / 1000;
    return Math.max(2, Math.min(cap, Math.round(per1000px * scale)));
}

/**
 * The mask: what the paint did *not* cover.
 *
 * Painted opaque, then bitten into. The result multiplies with the artwork's
 * own alpha, so the cut-out keeps its silhouette and simply loses pigment where
 * the brush ran dry — which is exactly the relationship real paint has with
 * real paper.
 */
class PainterlyMask {
    static get inputProperties() {
        return [
            "--paint-frame",
            "--paint-seed",
            "--paint-bite",
            "--paint-tooth",
            "--paint-angle",
            "--paint-scale",
        ];
    }

    static get contextOptions() {
        return { alpha: true };
    }

    paint(ctx, size, props) {
        const { width, height } = size;
        if (width <= 0 || height <= 0) return;

        const frame = num(props, "--paint-frame", 0);
        const seed = num(props, "--paint-seed", 7);
        const bite = clamp(num(props, "--paint-bite", 0.5), 0, 2);
        const tooth = clamp(num(props, "--paint-tooth", 0.5), 0, 2);
        const angle = num(props, "--paint-angle", -18);
        const scale = clamp(num(props, "--paint-scale", 1), 0.15, 6);

        // Opaque first: the mask's job is to take away, never to add.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);

        if (bite <= 0 && tooth <= 0) return;

        const rand = makeRng(seedFor(frame, seed, 0x1f));
        const unit = Math.sqrt(width * height) * 0.01 * scale;

        // Everything from here is subtractive.
        ctx.globalCompositeOperation = "destination-out";

        // Pooling: two or three broad, very soft lifts. This is the slow
        // variation that keeps a flat wash from looking printed, and at this
        // alpha it is felt rather than seen.
        const pools = 2 + Math.floor(rand() * 2);
        for (let i = 0; i < pools; i++) {
            const cx = rand() * width;
            const cy = rand() * height;
            const radius = Math.max(width, height) * (0.3 + rand() * 0.4);
            const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            const strength = 0.05 * bite * (0.5 + rand());
            pool.addColorStop(0, `rgba(255,255,255,${strength.toFixed(3)})`);
            pool.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = pool;
            ctx.fillRect(0, 0, width, height);
        }

        // Dry brush: the marks that say a bristle crossed here and did not
        // leave enough pigment behind. Kept short, wide and faint — a mask this
        // one is subtractive, and whatever it takes away shows the backdrop
        // through the artwork. A lift you can name is a hole.
        const strokes = density(width, height, 11 * bite, 28);
        for (let i = 0; i < strokes; i++) {
            const [from, to] = strokeEnds(rand, width, height, angle, 0.22);
            brush(ctx, rand, from, to, unit * (1.4 + rand() * 2.2), "#ffffff", 0.15 * bite * (0.4 + rand()));
        }

        // Paper tooth: the raised grain of the sheet, which paint skips over.
        // Small, many, and low — a speckle you notice only when it is gone.
        const specks = density(width, height, 150 * tooth, 320);
        for (let i = 0; i < specks; i++) {
            const r = unit * (0.14 + rand() * 0.38);
            ctx.globalAlpha = 0.05 + rand() * 0.16 * tooth;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.ellipse(rand() * width, rand() * height, r, r * (0.55 + rand() * 0.9), rand() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

/**
 * The wash: pigment sitting on top, for a `multiply` overlay.
 *
 * The mask alone gets the surface right but leaves the artwork tonally flat —
 * every part of it is still exactly as saturated as the file. This adds the
 * other half of paint: a direction the brush was travelling, and granulation
 * where pigment settled. Kept at alphas that read as a shift in the light
 * rather than as a second drawing.
 */
class PainterlyWash {
    static get inputProperties() {
        return [
            "--paint-frame",
            "--paint-seed",
            "--paint-wash",
            "--paint-wash-strength",
            "--paint-angle",
            "--paint-scale",
        ];
    }

    static get contextOptions() {
        return { alpha: true };
    }

    paint(ctx, size, props) {
        const { width, height } = size;
        if (width <= 0 || height <= 0) return;

        const strength = clamp(num(props, "--paint-wash-strength", 0), 0, 2);
        if (strength <= 0) return;

        const frame = num(props, "--paint-frame", 0);
        const seed = num(props, "--paint-seed", 7);
        const colour = text(props, "--paint-wash", "#2b2118");
        const angle = num(props, "--paint-angle", -18);
        const scale = clamp(num(props, "--paint-scale", 1), 0.15, 6);

        const rand = makeRng(seedFor(frame, seed, 0x7c));
        const unit = Math.sqrt(width * height) * 0.01 * scale;

        const strokes = density(width, height, 12 * strength, 30);
        for (let i = 0; i < strokes; i++) {
            const [from, to] = strokeEnds(rand, width, height, angle, 0.42);
            brush(ctx, rand, from, to, unit * (1.4 + rand() * 2.6), colour, 0.06 * strength * (0.4 + rand()));
        }

        // Granulation: heavy pigment settling into the tooth. The counterpart of
        // the mask's speckle — where one lifts paint, this one pools it.
        const grains = density(width, height, 70 * strength, 180);
        ctx.fillStyle = colour;
        for (let i = 0; i < grains; i++) {
            const r = unit * (0.12 + rand() * 0.34);
            ctx.globalAlpha = 0.04 + rand() * 0.07 * strength;
            ctx.beginPath();
            ctx.ellipse(rand() * width, rand() * height, r, r * (0.6 + rand() * 0.8), rand() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

/**
 * Paper grain, for anything the camera has to stretch.
 *
 * A backdrop is one image blown up to the width of a stage, and then the camera
 * pushes into it. However large the file, at some point it is being magnified,
 * and magnified artwork does not look wrong so much as *empty*: the smoothness
 * where detail used to be is what the eye reads as "low resolution".
 *
 * Grain does not put the detail back — nothing can. It puts back the thing the
 * eye was actually using to judge sharpness, which is high-frequency variation
 * at the scale of the screen rather than at the scale of the image. Fine specks
 * sitting on top of a soft enlargement read as a photograph of a textured
 * surface rather than as a blurry picture, and the whole frame firms up.
 *
 * The scale is the entire trick: this is painted in a tile the browser repeats
 * at a fixed CSS size, so the specks stay the same size on screen no matter how
 * far the backdrop has been stretched or how far the camera has pushed in. Grain
 * that scaled with the artwork would enlarge along with the blur and add
 * nothing.
 *
 * Tiling is also what makes it affordable. Grain fine enough to work is on the
 * order of one speck per ten square pixels; over a 1600px backdrop that is a
 * quarter of a million draw calls. Over a 160px tile it is a few thousand, and
 * the compositor repeats the result for free.
 *
 * `--grain-frame` re-grains the paper. It is deliberately a different clock
 * from the boil: the artwork is not being redrawn, the sheet it is sitting on
 * is, so it wants to be slower and it must not change the *shape* of anything.
 * The cost is one tile repaint per hold — but the browser also re-rasterises
 * the whole overlay it tiles into, and on a stage-width backdrop that is the
 * real expense, which is why the default cadence is half the boil's.
 */
class PainterlyGrain {
    static get inputProperties() {
        return ["--grain-frame", "--grain-seed", "--grain-size", "--grain-density", "--grain-contrast"];
    }

    static get contextOptions() {
        return { alpha: true };
    }

    paint(ctx, size, props) {
        const { width, height } = size;
        if (width <= 0 || height <= 0) return;

        const frame = num(props, "--grain-frame", 0);
        const seed = num(props, "--grain-seed", 4);
        const speck = clamp(num(props, "--grain-size", 1.4), 0.25, 6);
        const density = clamp(num(props, "--grain-density", 2.3), 0, 6);
        const contrast = clamp(num(props, "--grain-contrast", 0.3), 0, 4);

        const rand = makeRng(seedFor(frame, seed, 0xa3));
        // The cap is a runaway guard, not a setting. At the default density it
        // is out of reach until the tile passes about 310px — four times the
        // default tile — and past that the grain quietly thins instead of
        // getting denser, so if a tile that big ever looks wrong, this is why.
        const count = Math.min(20000, Math.round((width * height) / 11 * density));

        // Every speck is drawn wholly inside the tile. A speck clipped at the
        // edge would be half a speck on both sides of every repeat, and a
        // regular grid of half-specks is exactly the seam this is trying to
        // avoid — at grain scale a visible tile edge is worse than no grain.
        const margin = speck * 1.6;
        const spanX = Math.max(1, width - margin * 2);
        const spanY = Math.max(1, height - margin * 2);

        for (let i = 0; i < count; i++) {
            const r = speck * (0.35 + rand() * 0.9);
            // Half dark, half light. Only both together read as grain; either
            // one alone reads as dirt on the lens, or as haze.
            const light = rand() < 0.5;
            const alpha = (0.05 + rand() * 0.16) * contrast;
            ctx.fillStyle = light
                ? `rgba(255,255,255,${alpha.toFixed(3)})`
                : `rgba(0,0,0,${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.ellipse(
                margin + rand() * spanX,
                margin + rand() * spanY,
                r, r * (0.7 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

registerPaint("painterly-mask", PainterlyMask);
registerPaint("painterly-wash", PainterlyWash);
registerPaint("painterly-grain", PainterlyGrain);
