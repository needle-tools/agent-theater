/**
 * Keeping a collage across a reload.
 *
 * Split by what each store is actually good at:
 *
 *  - **localStorage** holds the document — layers, frames, the view. It is a
 *    few kilobytes of JSON, it is synchronous, and reading it before the first
 *    paint is what stops the canvas flashing empty on load.
 *  - **IndexedDB** holds the image bytes. It has no practical size limit and
 *    stores Blobs natively, where localStorage would need base64 and would hit
 *    its ~5 MB ceiling on roughly the second photo.
 *
 * What must never happen is a data: URL in localStorage. It is the obvious
 * shortcut and it breaks on the second image, silently, with a quota error
 * thrown from an unrelated line. So `src` is stripped on save for anything
 * IndexedDB owns, and rebuilt as a blob: URL on load.
 */
import type { Clip } from "./clips.js";
import type { Billing, Frame, Layer, Stage } from "./model.js";

const DOC_KEY = "needle-collage/doc/v1";
const DB_NAME = "needle-collage";
const DB_VERSION = 1;
const IMAGE_STORE = "images";

export interface StoredView {
    x: number;
    y: number;
    zoom: number;
}

export interface StoredDoc {
    version: 1;
    savedAt: number;
    layers: Layer[];
    frames: Frame[];
    /** Scenes, when any have been made. Absent in documents saved before them. */
    stages?: Stage[];
    /** What the show is called, so a title card survives a reload. */
    billing?: Billing;
    /**
     * The recorded gestures this play's scripts perform (do: "clip:x").
     * Carried in the FILE, because a play whose hero limps in a way somebody
     * performed by hand should limp the same way on a machine that never met
     * that hand.
     */
    clips?: Clip[];
    /** The paper's colour, when the play set its own weather. */
    background?: string;
    view?: StoredView;
}

// ── The document ────────────────────────────────────────────────────────────

export function saveDoc(
    layers: Layer[],
    frames: Frame[],
    view?: StoredView,
    stages: Stage[] = [],
    billing: Billing = {},
    background = "",
): boolean {
    if (typeof localStorage === "undefined") return false;
    const doc: StoredDoc = {
        version: 1,
        savedAt: Date.now(),
        // A blob: URL is meaningless in the next session, so it is not written.
        // The storageKey is what survives; the URL is rebuilt from it on load.
        layers: layers.map(layer =>
            layer.kind === "image" && layer.storageKey ? { ...layer, src: "" } : layer),
        frames,
        ...(stages.length ? { stages } : {}),
        ...(billing.title || billing.byline || billing.credits?.length ? { billing } : {}),
        ...(background ? { background } : {}),
        ...(view ? { view } : {}),
    };
    try {
        localStorage.setItem(DOC_KEY, JSON.stringify(doc));
        return true;
    } catch (error) {
        // Quota, private browsing, or a disabled store. Losing the save is
        // survivable; taking the page down with it is not.
        console.warn("[collage] could not save the document:", error);
        return false;
    }
}

export function loadDoc(): StoredDoc | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(DOC_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredDoc;
        if (parsed?.version !== 1 || !Array.isArray(parsed.layers) || !Array.isArray(parsed.frames)) return null;
        return parsed;
    } catch (error) {
        console.warn("[collage] the saved document could not be read:", error);
        return null;
    }
}

export function clearDoc() {
    try { localStorage?.removeItem(DOC_KEY); } catch { /* nothing to do */ }
}

// ── The wings ───────────────────────────────────────────────────────────────

/**
 * Where a struck set waits. Clearing the stage is not deletion any more: the
 * whole document steps into the wings, and theater_restore walks it back on.
 * One set of wings, holding the LAST struck set — a stack would grow into a
 * second undo history nobody can see.
 */
const WINGS_KEY = "needle-collage/wings/v1";

export function stashDoc(
    layers: Layer[],
    frames: Frame[],
    stages: Stage[] = [],
    billing: Billing = {},
    background = "",
): boolean {
    if (typeof localStorage === "undefined") return false;
    const doc: StoredDoc = {
        version: 1,
        savedAt: Date.now(),
        // Same rule as saveDoc: blob URLs mean nothing later; the storageKey
        // is what survives, and the images stay in IndexedDB for it.
        layers: layers.map(layer =>
            layer.kind === "image" && layer.storageKey ? { ...layer, src: "" } : layer),
        frames,
        ...(stages.length ? { stages } : {}),
        ...(billing.title || billing.byline || billing.credits?.length ? { billing } : {}),
        ...(background ? { background } : {}),
    };
    try {
        localStorage.setItem(WINGS_KEY, JSON.stringify(doc));
        return true;
    } catch (error) {
        console.warn("[collage] could not stash the set in the wings:", error);
        return false;
    }
}

export function loadWings(): StoredDoc | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(WINGS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredDoc;
        if (parsed?.version !== 1 || !Array.isArray(parsed.layers)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function clearWings() {
    try { localStorage?.removeItem(WINGS_KEY); } catch { /* nothing to do */ }
}

// ── The images ──────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
        if (typeof indexedDB === "undefined") return resolve(null);
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            return resolve(null);
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        // Private browsing modes reject the open outright. Everything degrades
        // to "this session only", which is better than failing to start.
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
    });
    return dbPromise;
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    return openDb().then(db => {
        if (!db) return null;
        return new Promise<T | null>(resolve => {
            let request: IDBRequest<T>;
            try {
                request = run(db.transaction(IMAGE_STORE, mode).objectStore(IMAGE_STORE));
            } catch {
                return resolve(null);
            }
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
    });
}

export function putImage(key: string, blob: Blob): Promise<unknown> {
    return transact("readwrite", store => store.put(blob, key));
}

export function getImage(key: string): Promise<Blob | null> {
    return transact<Blob>("readonly", store => store.get(key)).then(value =>
        value instanceof Blob ? value : null);
}

export function deleteImage(key: string): Promise<unknown> {
    return transact("readwrite", store => store.delete(key));
}

export function listImageKeys(): Promise<string[]> {
    return transact<IDBValidKey[]>("readonly", store => store.getAllKeys())
        .then(keys => (keys ?? []).map(String));
}

/**
 * Drop stored images no layer refers to any more.
 *
 * Without this, every deleted layer and every background removal leaves its
 * bytes behind for good — the store only ever grows, and the person who
 * notices is the one whose browser starts asking about disk space.
 */
export async function collectGarbage(layers: Layer[]): Promise<number> {
    const live = new Set(
        layers.flatMap(layer => (layer.kind === "image" && layer.storageKey ? [layer.storageKey] : [])));
    const stored = await listImageKeys();
    const orphans = stored.filter(key => !live.has(key));
    await Promise.all(orphans.map(key => deleteImage(key)));
    return orphans.length;
}

export async function clearImages(): Promise<void> {
    await transact("readwrite", store => store.clear());
}

/** A key for a newly stored image. Only has to be unique within this browser. */
export function newImageKey(): string {
    return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
