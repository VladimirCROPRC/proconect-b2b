export async function register() {
  if (process.env.PROCONECT_SELF_HOSTED !== "1" || process.env.NEXT_RUNTIME !== "nodejs") return;
  const { drainOneDrive, oneDriveConfigured } = await import("./app/onedrive-server");
  const timer = setInterval(() => {
    if (oneDriveConfigured()) void drainOneDrive().catch(() => console.error("OneDrive background processing requires retry"));
  }, 30000);
  timer.unref();
}
