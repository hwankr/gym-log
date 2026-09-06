import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { createRuntime } from "./runtime.ts";

const production =
  process.argv.includes("--production") ||
  process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 5173);
const { app, pool, appOrigin } = createRuntime({ production, port });
const httpServer = createServer(app);
let closeVite: (() => Promise<void>) | undefined;
if (production) {
  app.use(express.static(resolve("dist"), { index: false }));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(resolve("dist/index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configLoader: "native",
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: "spa",
  });
  app.use(vite.middlewares);
  closeVite = () => vite.close();
}
httpServer.listen(port, process.env.HOST ?? "0.0.0.0", () => {
  console.log(
    `Gym Log: ${appOrigin} (${production ? "production" : "development"})`,
  );
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close();
  await closeVite?.();
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
