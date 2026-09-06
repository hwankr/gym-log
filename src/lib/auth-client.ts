import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthReactAdapter } from "@neondatabase/auth/react/adapters";

export const authClient = createAuthClient(
  new URL("/api/auth", window.location.origin).href,
  { adapter: BetterAuthReactAdapter() },
);
