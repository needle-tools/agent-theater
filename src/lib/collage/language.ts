/** Language of a play's spoken story. "und" means it has not been specified. */
export function playLanguage(value: unknown): string {
    if (typeof value !== "string") return "und";
    const code = value.trim().replace(/_/g, "-").toLowerCase();
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code) ? code : "und";
}

export function languageName(code: string): string {
    if (code === "und") return "Language unknown";
    try {
        return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
    } catch { return code; }
}
