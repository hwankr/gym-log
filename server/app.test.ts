import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import type { RequestHandler } from "express";
import { createApp, type DataRepository } from "./app.ts";
import { ConflictError, ValidationError } from "./repository.ts";
import { INITIAL_DATA } from "../src/lib/gym.ts";

const origin = "http://localhost:5173";
const calls: { method: string; userId: string; revision?: number }[] = [];
let failure: Error | null = null;
const repository: DataRepository = {
  getData: async (userId) => {
    calls.push({ method: "get", userId });
    if (failure) throw failure;
    return { data: structuredClone(INITIAL_DATA), revision: 2 };
  },
  saveData: async (userId, data, revision) => {
    calls.push({ method: "put", userId, revision });
    if (failure) throw failure;
    return { data, revision: revision + 1 };
  },
};
const requireUser: RequestHandler = (req, res, next) => {
  if (req.headers.authorization !== "Bearer authenticated-alice") {
    res.status(401).json({ error: "로그인이 필요해요." });
    return;
  }
  res.locals.user = {
    id: "alice",
    name: "Alice",
    email: "alice@example.invalid",
  };
  next();
};
let server: Server;
let baseUrl: string;
before(async () => {
  server = createServer(
    createApp({
      repository,
      appOrigin: origin,
      auth: {
        requireUser,
        proxy: (_req, res) => {
          res.status(404).end();
        },
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
const headers = {
  Authorization: "Bearer authenticated-alice",
  Origin: origin,
  "Content-Type": "application/json",
};

test("API refuses unauthenticated read without querying records", async () => {
  const before = calls.length;
  const response = await fetch(`${baseUrl}/api/data`);
  assert.equal(response.status, 401);
  assert.equal(calls.length, before);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("API refuses cross-origin and missing-origin writes before touching records", async () => {
  const before = calls.length;
  for (const originHeader of ["https://other.example", ""]) {
    const response = await fetch(`${baseUrl}/api/data`, {
      method: "PUT",
      headers: { ...headers, Origin: originHeader },
      body: JSON.stringify({ data: INITIAL_DATA, revision: 2 }),
    });
    assert.equal(response.status, 403);
  }
  assert.equal(calls.length, before);
});
test("API always uses the authenticated identity, ignoring user IDs from the request", async () => {
  const response = await fetch(`${baseUrl}/api/data?userId=bob`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ data: INITIAL_DATA, revision: 2, userId: "bob" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), {
    method: "put",
    userId: "alice",
    revision: 2,
  });
  assert.deepEqual(await response.json(), { data: INITIAL_DATA, revision: 3 });
});
test("API rejects invalid data and does not call the repository", async () => {
  const before = calls.length;
  for (const payload of [
    { data: {}, revision: 2 },
    { data: INITIAL_DATA, revision: -1 },
    { data: INITIAL_DATA, revision: "2" },
  ]) {
    const response = await fetch(`${baseUrl}/api/data`, {
      method: "PUT",
      headers,
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, before);
});
test("API exposes revision conflicts and validation errors with retryable status codes", async () => {
  for (const [error, status] of [
    [new ConflictError(), 409],
    [new ValidationError(), 400],
  ] as const) {
    failure = error;
    try {
      const response = await fetch(`${baseUrl}/api/data`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ data: INITIAL_DATA, revision: 2 }),
      });
      assert.equal(response.status, status);
      assert.equal(typeof (await response.json()).error, "string");
    } finally {
      failure = null;
    }
  }
});
test("API does not send internal database error details to the browser", async () => {
  failure = new Error("private-database-details-test");
  try {
    const response = await fetch(`${baseUrl}/api/data`, { headers });
    assert.equal(response.status, 503);
    assert.ok(
      !(await response.text()).includes("private-database-details-test"),
    );
  } finally {
    failure = null;
  }
});
