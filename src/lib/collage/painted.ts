/**
 * Turning the painterly effect on for a page.
 *
 * The effect itself is entirely CSS — `static/worklets/painterly.css` and the
 * paint worklet next to it. Two things it cannot do for itself live here: the
 * worklet has to be registered before `paint()` resolves to anything, and the
 * three displacement filters have to be in the document before any element
 * claims `.painted--boil`.
 *
 * That second one is not a nicety. A `filter: url(#id)` that resolves to
 * nothing does not degrade to no filter — the element is not rendered at all.
 * So the defs are exported as markup rather than left to the caller to
 * remember, and the same string will be what the HTML export writes out.
 */

/** Where the stylesheet and the worklet are served from. */
export const PAINTERLY_CSS = "/worklets/painterly.css";
const PAINTERLY_WORKLET = "/worklets/painterly.js";

/**
 * How far the outline is allowed to wander, per strength, in pixels.
 *
 * Pixels and deliberately not a fraction of the object: a hand wobbles by
 * about the same amount whatever size the thing is, so five pixels is right on
 * an acorn and right on an oak.
 *
 * There are two sets rather than one knob because this is the only part of the
 * effect that is an SVG attribute instead of a CSS property — it cannot be a
 * custom property, so it cannot be set by a preset the way every other
 * parameter is. A preset that wants a rougher wander has to point at different
 * filters, which is what `--boil-0/1/2` in the stylesheet are for.
 */
const BOIL_STRENGTHS = { "": 5, "-rough": 11.5 };

/**
 * Three takes of the same wander, one per hold, at each strength.
 *
 * The region is generous because a displacement that reaches past its own
 * subregion comes back with a straight edge sliced through the artwork — the
 * one artifact that reads as a bug rather than as a brush.
 */
export function boilFilterSvg(): string {
    return Object.entries(BOIL_STRENGTHS).flatMap(([suffix, scale]) =>
        [11, 12, 13].map((seed, index) =>
            `<filter id="paint-boil${suffix}-${index}" x="-30%" y="-30%" width="160%" height="160%" ` +
            `color-interpolation-filters="sRGB">` +
            `<feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="2" seed="${seed}" result="n"/>` +
            `<feDisplacementMap in="SourceGraphic" in2="n" scale="${scale}" ` +
            `xChannelSelector="R" yChannelSelector="G"/>` +
            `</filter>`)).join("");
}

let loading: Promise<boolean> | null = null;

/**
 * Register the paint worklet, once per page, and open the gate when it lands.
 *
 * The `painterly` class on the root element is what every worklet-dependent
 * rule in the stylesheet hangs off, and setting it here rather than leaving it
 * to callers is the whole point: an unregistered `paint()` is a valid image
 * that draws nothing, so a mask pointing at one hides its element outright.
 * Anything that adds `.painted` before this resolves would blink out and back.
 *
 * Resolves false rather than throwing where there is no paint worklet, because
 * there is nothing to handle — the gate stays shut and the layer keeps the boil
 * and the frame-held wobble without the brush. A caller that wants to know can
 * ask; a caller that does not can ignore it.
 */
export function loadPainterly(): Promise<boolean> {
    if (loading) return loading;
    const worklets = (CSS as unknown as { paintWorklet?: Worklet }).paintWorklet;
    if (!worklets) return (loading = Promise.resolve(false));
    loading = worklets.addModule(PAINTERLY_WORKLET).then(
        () => {
            document.documentElement.classList.add("painterly");
            return true;
        },
        () => false);
    return loading;
}
