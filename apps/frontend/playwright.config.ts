import { defineConfig } from "@playwright/test";

const backendPort = process.env.PLAYWRIGHT_BACKEND_PORT ?? "4000";
const frontendPort = process.env.PLAYWRIGHT_FRONTEND_PORT ?? "3001";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${frontendPort}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: [
    {
      command: `bun run --cwd ../backend build && PORT=${backendPort} RETRO_ALLOWED_ORIGINS=http://localhost:${frontendPort} bun ../backend/dist/main.js`,
      url: `http://localhost:${backendPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `bun run dev -- --port ${frontendPort}`,
      url: `http://localhost:${frontendPort}/retro`,
      env: { NEXT_PUBLIC_WS_URL: `ws://localhost:${backendPort}` },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
