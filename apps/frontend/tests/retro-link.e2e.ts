import { expect, test } from "@playwright/test";

type RetroCommandLog = {
  type: string;
  code?: string;
  requestId?: string;
  token?: string;
};

declare global {
  interface Window {
    retroCommands: RetroCommandLog[];
    retroSocketAttempts: number;
  }
}

function recordRetroCommands() {
  const Original = window.WebSocket;
  window.retroCommands = [];
  window.retroSocketAttempts = 0;
  window.WebSocket = class extends Original {
    constructor(url: string | URL, protocols?: string | string[]) {
      const parsed = new URL(url, window.location.href);
      if (parsed.pathname === "/retro") window.retroSocketAttempts += 1;
      super(url, protocols);
    }

    send(data: string) {
      try {
        const message = JSON.parse(data);
        if (message.event === "retro-command")
          window.retroCommands.push(message.data);
      } catch {
        // Let the application handle malformed data as usual.
      }
      super.send(data);
    }
  };
}

test("checks unknown room links without showing participant fields", async ({
  page,
}) => {
  await page.addInitScript(recordRetroCommands);
  await page.goto("/retro/missing-room");
  await expect(
    page.getByText(
      "This room link is expired, closed, full, or does not exist.",
      {
        exact: false,
      }
    )
  ).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  expect(await page.evaluate(() => window.retroCommands)).toContainEqual({
    type: "inspect",
    code: "missing-room",
    requestId: expect.any(String),
  });
  expect(
    (await page.evaluate(() => window.retroCommands)).some(
      (command) => "token" in command
    )
  ).toBe(false);
  await expect(
    page.getByRole("link", { name: "Start or join another room", exact: true })
  ).toHaveAttribute("href", "/retro");
});

test("shows a checking state before an inspection responds", async ({
  page,
}) => {
  await page.routeWebSocket("**/retro", (socket) => {
    socket.onMessage(() => {
      // Keep the inspection pending so the lobby remains in its loading state.
    });
  });
  await page.goto("/retro/loading-room");
  await expect(
    page.locator("output").filter({ hasText: "Checking room availability…" })
  ).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
});

test("keeps protected room inspection metadata opaque", async ({ page }) => {
  await page.routeWebSocket("**/retro", (socket) => {
    socket.onMessage((message) => {
      const request = JSON.parse(
        typeof message === "string" ? message : message.toString()
      );
      if (request.data?.type !== "inspect") return;
      socket.send(
        JSON.stringify({
          event: "retro-room-info",
          data: {
            code: request.data.code,
            available: true,
            requiresPassword: true,
            requestId: request.data.requestId,
          },
        })
      );
    });
  });
  await page.goto("/retro/protected-room");
  await expect(
    page.getByText("Room access required", { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Room password (required)")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /protected-room/i })
  ).toHaveCount(0);
});

test("shows an unavailable state when a room expires after inspection", async ({
  page,
}) => {
  await page.route("**/retro/session", (route) =>
    route.fulfill({
      status: 410,
      json: {
        code: "room-expired",
        message: "This room has expired. Create a new retrospective.",
      },
    })
  );
  await page.routeWebSocket("**/retro", (socket) => {
    socket.onMessage((message) => {
      const request = JSON.parse(
        typeof message === "string" ? message : message.toString()
      );
      const command = request.data;
      if (command?.type === "inspect") {
        socket.send(
          JSON.stringify({
            event: "retro-room-info",
            data: {
              code: command.code,
              available: true,
              requiresPassword: false,
              requestId: command.requestId,
            },
          })
        );
      }
    });
  });
  await page.goto("/retro/expired-room");
  await expect(page.getByLabel("Your name")).toBeVisible();
  await page.getByLabel("Your name").fill("Alice");
  await page
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(
    page.getByText("This room has expired. Create a new retrospective.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Start or join another room", exact: true })
  ).toHaveAttribute("href", "/retro");
});

test("rejects malformed room links before opening a WebSocket", async ({
  page,
}) => {
  await page.addInitScript(recordRetroCommands);
  await page.goto("/retro/not-a-room!");
  await expect(page.getByText(/room link is invalid/i)).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  expect(await page.evaluate(() => window.retroSocketAttempts)).toBe(0);
});
