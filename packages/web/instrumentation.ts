export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startServer } = await import("./lib/server/startup");
    await startServer();
  }
}
