import { attachDatabasePool } from "@vercel/functions";
import { createRuntime } from "../server/runtime.ts";

// Module scope shares one pool across concurrent requests in this instance.
// Vercel closes idle connections before suspending the instance.
const { app, pool } = createRuntime({ production: true });
attachDatabasePool(pool);

export default app;
