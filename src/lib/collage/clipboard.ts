/** Copy from a user gesture, including on local HTTP addresses without Clipboard API access. */
export async function copyText(value: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch {
            // The older selection-based path can still work when Clipboard API is denied.
        }
    }

    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.focus();
    field.select();
    try {
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        field.remove();
        previous?.focus();
    }
}
