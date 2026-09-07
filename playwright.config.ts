import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pwa",
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:4173",
    ...devices["Desktop Chrome"],
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node tests/pwa/server.mjs",
    url: "http://localhost:4173",
    reuseExistingServer: false,
  },
});
