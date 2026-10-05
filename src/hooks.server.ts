import { cleanExpiredSheets } from "$lib/server/storage";

let cleanupRunning = false;
async function cleanup() {
    if (cleanupRunning) return;
    cleanupRunning = true;
    try { await cleanExpiredSheets(); }
    catch (error) { console.error("[sheets] Cleanup failed", error); }
    finally { cleanupRunning = false; }
}

// Run once at server startup, then every 30 minutes. The timer does not keep
// a Node process alive during shutdown.
if (!import.meta.env.DEV) {
    void cleanup();
    setInterval(() => void cleanup(), 30 * 60 * 1000).unref();
}
