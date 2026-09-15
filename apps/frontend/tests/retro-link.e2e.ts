import { expect, test } from "@playwright/test";

type RetroCommandLog = { type: string; code?: string };

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
  await page.goto("/retro/missing-room");
  await expect(
    page.getByText("This room link is expired or does not exist.", {
      exact: false,
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
