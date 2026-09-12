import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3001",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: [
    {
      command:
        "bun run --cwd ../backend build && PORT=4000 bun ../backend/dist/main.js",
      url: "http://localhost:4000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "bun run dev -- --port 3001",
      url: "http://localhost:3001/retro",
      env: { NEXT_PUBLIC_WS_URL: "ws://localhost:4000" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
