import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

declare global {
  interface Window {
    retroTestSocket: WebSocket;
  }
}

async function trackSockets(context: BrowserContext) {
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(String(url), window.location.href).pathname === "/retro")
          window.retroTestSocket = this;
      }
    } as typeof WebSocket;
  });
}

async function createRoom(page: Page, title: string) {
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill(title);
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true })
  ).toBeVisible();
}

function status(page: Page) {
  return page.locator('[data-slot="card"]').filter({ hasText: "Room status" });
}

test("automatically resumes after repeated transient connection failures", async ({
  page,
  context,
}) => {
  await trackSockets(context);
  let socketCount = 0;
  let failures = 0;
  await context.routeWebSocket("**/retro", (socket) => {
    socketCount += 1;
    if (failures > 0) {
      failures--;
      void socket.close();
    } else socket.connectToServer();
  });
  await createRoom(page, "Transient recovery");
  const initialSockets = socketCount;
  failures = 2;

  await page.evaluate(() => window.retroTestSocket?.close());
  await expect(
    status(page).getByText(/Automatic reconnect scheduled · attempt 1/)
  ).toBeVisible({
    timeout: 4_000,
  });
  await expect(
    status(page).getByText(/Automatic reconnect scheduled · attempt 2/)
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    status(page).getByText("Connected · changes sync live", { exact: true })
  ).toBeVisible({ timeout: 10_000 });
  expect(socketCount).toBe(initialSockets + 3);
  // The resumed socket is server-authoritative; no command is sent while it
  // is catching up.
  await expect(status(page).getByText(/Connected/)).toBeVisible();
});

test("refreshes before recovery and never resends an unacknowledged mutation", async ({
  page,
  context,
}) => {
  await trackSockets(context);
  let blocked = false;
  const sentTypes: string[] = [];
  await context.routeWebSocket("**/retro", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const payload = JSON.parse(String(message));
      sentTypes.push(payload.data?.type);
      if (!blocked && payload.data?.type === "add-note") {
        blocked = true;
        void socket.close();
        return;
      }
      server.send(message);
    });
  });
  await createRoom(page, "Uncertain mutation recovery");

  const draft = page.getByLabel("Add a note", { exact: true }).nth(0);
  await draft.fill("Do not duplicate this thought");
  await page
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();
  await expect(
    status(page).getByText(/Connection lost before confirmation/)
  ).toBeVisible();
  await expect(
    status(page).getByText("Connected · changes sync live", { exact: true })
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    status(page).getByText(/Connection lost before confirmation/)
  ).toBeVisible();
  await expect(draft).toHaveValue("Do not duplicate this thought");

  expect(
    sentTypes.filter((type) => type === "add-note"),
    JSON.stringify(sentTypes)
  ).toHaveLength(1);
  expect(
    sentTypes.filter((type) => type === "resume").length
  ).toBeGreaterThanOrEqual(1);
  await expect(
    page
      .getByLabel("Retrospective notes")
      .locator("article")
      .filter({ hasText: "Do not duplicate this thought" })
  ).toHaveCount(0);
});

test("pauses recovery offline and while hidden, then resumes on browser signals", async ({
  page,
  context,
}) => {
  await trackSockets(context);
  let socketCount = 0;
  await context.routeWebSocket("**/retro", (socket) => {
    socketCount += 1;
    socket.connectToServer();
  });
  await createRoom(page, "Browser signal recovery");
  const initialSockets = socketCount;

  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    window.dispatchEvent(new Event("offline"));
  });
  await expect(
    status(page).getByText("Offline · reconnects when online", { exact: true })
  ).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(socketCount).toBe(initialSockets);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await expect(
    status(page).getByText("Connected · changes sync live", { exact: true })
  ).toBeVisible({ timeout: 5_000 });
  expect(socketCount).toBe(initialSockets + 1);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.retroTestSocket?.close();
  });
  await expect(
    status(page).getByText("Reconnect paused while this tab is hidden", {
      exact: true,
    })
  ).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(socketCount).toBe(initialSockets + 1);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    status(page).getByText("Connected · changes sync live", { exact: true })
  ).toBeVisible({ timeout: 5_000 });
  expect(socketCount).toBe(initialSockets + 2);
});

test("does not retry a replacement close", async ({ page, context }) => {
  await trackSockets(context);
  let socketCount = 0;
  let replaceNext = false;
  await context.routeWebSocket("**/retro", (socket) => {
    socketCount += 1;
    if (replaceNext)
      void socket.close({
        code: 4001,
        reason: "Session replaced",
      });
    else socket.connectToServer();
  });
  await createRoom(page, "Terminal recovery");
  const initialSockets = socketCount;
  replaceNext = true;
  await page.evaluate(() => window.retroTestSocket?.close());
  await expect(
    page.getByText("Your session was resumed in another connection.", {
      exact: true,
    })
  ).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2_000);
  expect(socketCount).toBe(initialSockets + 1);
  await expect(
    status(page).getByRole("button", { name: "Retry connection" })
  ).toHaveCount(0);
});
