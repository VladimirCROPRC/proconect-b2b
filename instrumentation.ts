export async function register() {
  if (process.env.PROCONECT_SELF_HOSTED !== "1" || process.env.NEXT_RUNTIME !== "nodejs") return;
  const { drainOneDrive, oneDriveConfigured, scheduleReporting } = await import("./app/onedrive-server");
  let running = false;
  async function processBackups() {
    if (running || !oneDriveConfigured()) return;
    running = true;
    try {
      await scheduleReporting();
      await drainOneDrive();
    } catch { console.error("OneDrive background processing requires retry"); }
    finally { running = false; }
  }
  const timer = setInterval(() => { void processBackups(); }, 30000);
  void processBackups();
  timer.unref();
}
