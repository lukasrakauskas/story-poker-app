import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function proxyPlanningSockets(context: BrowserContext) {
  let socketCount = 0;
  const sentTypes: string[] = [];

  await context.routeWebSocket(/ws:\/\/localhost:4000\/?$/, (socket) => {
    socketCount += 1;
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const payload = JSON.parse(String(message));
      sentTypes.push(payload.event);
      server.send(message);
    });
  });

  return {
    count: () => socketCount,
    sentTypes,
  };
}

async function createRoom(page: Page) {
  await page.goto("/");
  await page.getByLabel("Name", { exact: true }).fill("Alice");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your estimate", exact: true })
  ).toBeVisible();
}

test("resumes the same planning participant after a socket close without replaying commands", async ({
  page,
  context,
}) => {
  const sockets = await proxyPlanningSockets(context);
  await createRoom(page);
  const initialSockets = sockets.count();

  await page.evaluate(() => window.__webSocketClient?.close());
  const status = page.getByTestId("planning-connection-status");
  await expect(status).toContainText(/Reconnecting|Restoring/);
  await expect(status).toHaveCount(0, { timeout: 5_000 });

  expect(sockets.count()).toBe(initialSockets + 1);
  expect(
    sockets.sentTypes.filter((type) => type === "create-room")
  ).toHaveLength(1);
  expect(sockets.sentTypes.filter((type) => type === "reconnect")).toHaveLength(
    1
  );
  await expect(
    page.getByLabel("People in the room").getByRole("listitem")
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Estimate 3", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Estimate 3", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  expect(sockets.sentTypes.filter((type) => type === "cast-vote")).toHaveLength(
    1
  );
});

test("pauses planning recovery offline and replaces stale sockets on foreground", async ({
  page,
  context,
}) => {
  const sockets = await proxyPlanningSockets(context);
  await createRoom(page);
  const initialSockets = sockets.count();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    window.dispatchEvent(new Event("offline"));
  });
  const status = page.getByTestId("planning-connection-status");
  await expect(status).toHaveText("Offline · reconnects when online");
  await page.waitForTimeout(1_200);
  expect(sockets.count()).toBe(initialSockets);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await expect(status).toHaveCount(0, { timeout: 5_000 });
  expect(sockets.count()).toBe(initialSockets + 1);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(status).toHaveCount(0, { timeout: 5_000 });
  expect(sockets.count()).toBe(initialSockets + 2);
  expect(sockets.sentTypes.filter((type) => type === "reconnect")).toHaveLength(
    2
  );
  await expect(
    page.getByLabel("People in the room").getByRole("listitem")
  ).toHaveCount(1);
});
