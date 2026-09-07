import express from "express";
import { readFile } from "node:fs/promises";

// An isolated API fixture: PWA tests never contact a real account or database.
const app = express();
app.use(express.json());
let build = 0;
app.post("/__test/update", (_req, res) => {
  build += 1;
  res.sendStatus(204);
});
app.get("/sw.js", async (_req, res) => {
  res
    .type("js")
    .set("Cache-Control", "no-store")
    .send(`${await readFile("dist/sw.js", "utf8")}\n// test build ${build}`);
});
app.get("/api/auth/get-session", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!req.headers.cookie?.includes("pwa-test-user=1")) return res.json(null);
  res.json({
    session: {
      id: "test-session",
      userId: "test-user",
      token: "test-only-token",
      expiresAt: "2099-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    user: {
      id: "test-user",
      name: "PWA 테스트",
      email: "pwa@example.test",
      emailVerified: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  });
});
app.get("/api/data", (_req, res) =>
  res
    .set("Cache-Control", "no-store")
    .json({ data: { version: 1, workouts: [], routines: [] }, revision: 1 }),
);
app.put("/api/data", (req, res) =>
  res
    .set("Cache-Control", "no-store")
    .json({ data: req.body.data, revision: req.body.revision + 1 }),
);
app.use("/api", (_req, res) => res.set("Cache-Control", "no-store").json(null));
app.use(express.static("dist", { index: false }));
app.get("/{*path}", (_req, res) =>
  res.sendFile("index.html", { root: "dist" }),
);
app.listen(4173, "localhost");
