import { expect, test } from "@playwright/test";

type RetroCommandLog = {
  type: string;
  code?: string;
  requestId?: string;
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
    page.getByText("This room link is expired or does not exist.", {
      exact: false,
    })
  ).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  expect(await page.evaluate(() => window.retroCommands)).toContainEqual({
    type: "inspect",
    code: "missing-room",
    requestId: expect.any(String),
  });
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
    page.getByText("Checking room availability…", { exact: true })
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
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await expect(
    page.getByText("Start or join another room", { exact: true })
  ).toBeVisible();
});

test("shows an unavailable state when a room expires after inspection", async ({
  page,
}) => {
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
      } else if (command?.type === "join") {
        socket.send(
          JSON.stringify({
            event: "retro-error",
            data: {
              code: "room-expired",
              message: "This room has expired. Create a new retrospective.",
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

test("inspects a valid link before asking for a name and resumes saved credentials", async ({
  browser,
  page: owner,
}) => {
  await owner.addInitScript(recordRetroCommands);
  await owner.goto("/retro");
  await owner.getByLabel("Your name").fill("Alice");
  await owner.getByLabel("Retrospective title").fill("Inspection coverage");
  await owner
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    owner.getByRole("heading", { name: "Inspection coverage", exact: true })
  ).toBeVisible();

  const roomUrl = owner.url();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.addInitScript(recordRetroCommands);
  try {
    await guest.goto(roomUrl);
    await expect(guest.getByLabel("Your name")).toBeVisible();
    await expect(
      guest.getByText("Checking room availability…", { exact: true })
    ).toHaveCount(0);
    const inspected = await guest.evaluate(() =>
      window.retroCommands.find((command) => command.type === "inspect")
    );
    expect(inspected).toMatchObject({
      type: "inspect",
      code: new URL(roomUrl).pathname.split("/").pop(),
    });
    await guest.getByLabel("Your name").fill("Bobby");
    await guest
      .getByRole("button", { name: "Join retrospective", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Inspection coverage", exact: true })
    ).toBeVisible();

    await owner.reload();
    await expect(owner.getByText("Alice (you)", { exact: true })).toBeVisible();
    const resumedCommands = await owner.evaluate(() => window.retroCommands);
    expect(resumedCommands.some((command) => command.type === "inspect")).toBe(
      false
    );
    expect(resumedCommands.at(-1)).toMatchObject({ type: "resume" });
  } finally {
    await guestContext.close();
  }
});
