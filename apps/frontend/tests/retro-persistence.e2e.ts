import { test, expect } from "@playwright/test";

async function createRoom(
  page: import("@playwright/test").Page,
  title: string
) {
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill(title);
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true })
  ).toBeVisible();
  return page.url();
}

test("reopens the same identity across tabs and keeps separate cookies and history for multiple rooms", async ({
  page,
  context,
}) => {
  const first = await createRoom(page, "First retrospective");
  const firstCookie = (await context.cookies(first)).find((cookie) =>
    cookie.name.startsWith("retro-session-")
  )!;
  const reopened = await context.newPage();
  await reopened.goto(first);
  await expect(
    reopened.getByRole("button", { name: "Continue as Alice", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Your session was resumed in another connection.", {
      exact: true,
    })
  ).toHaveCount(0);
  // Read-only inspection does not displace the live participant.
  await reopened
    .getByRole("button", { name: "Continue as Alice", exact: true })
    .click();
  await expect(
    page.getByText("Your session was resumed in another connection.", {
      exact: true,
    })
  ).toBeVisible();
  // The displaced tab must not delete the cookie now used by the replacement.
  expect(
    (await context.cookies(first)).find(
      (cookie) => cookie.name === firstCookie.name
    )?.value
  ).toBe(firstCookie.value);
  await page.close();
  await reopened.reload();
  await expect(
    reopened.getByRole("button", { name: "Continue as Alice", exact: true })
  ).toBeVisible();
  await reopened
    .getByRole("button", { name: "Continue as Alice", exact: true })
    .click();
  await expect(
    reopened.getByRole("button", {
      name: "Reveal and group notes",
      exact: true,
    })
  ).toBeEnabled();
  const second = await createRoom(reopened, "Second retrospective");
  expect(second).not.toBe(first);
  expect(
    (await context.cookies(second)).filter((cookie) =>
      cookie.name.startsWith("retro-session-")
    )
  ).toHaveLength(2);
  await reopened.goto("/retro");
  await reopened
    .getByRole("button", { name: "Join a room", exact: true })
    .click();
  await reopened.getByLabel("Your name").fill("Ignored new name");
  await reopened.getByLabel("Room code").fill(first.split("/").pop()!);
  await reopened
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(
    reopened.getByText("Continue as Alice", { exact: true }).first()
  ).toBeVisible();
  await reopened
    .getByRole("button", {
      name: "Join as someone else / Forget this session",
      exact: true,
    })
    .click();
  const forgetConfirmation = reopened.getByRole("alertdialog");
  await expect(
    forgetConfirmation.getByText(/lose.*moderator access/i)
  ).toBeVisible();
  await forgetConfirmation
    .getByRole("button", {
      name: "Forget session and join as someone else",
      exact: true,
    })
    .click();
  await reopened
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(
    reopened.getByText("Ignored new name (you)", { exact: true })
  ).toBeVisible();
  await expect(
    reopened.getByRole("heading", { name: "First retrospective", exact: true })
  ).toBeVisible();
  await reopened
    .getByRole("link", { name: "Previous retrospectives", exact: true })
    .click();
  await expect(
    reopened.getByRole("heading", { name: "First retrospective", exact: true })
  ).toBeVisible();
  await expect(
    reopened.getByRole("heading", { name: "Second retrospective", exact: true })
  ).toBeVisible();
  await expect(
    reopened.getByText(/Last seen in write · may be incomplete/)
  ).toHaveCount(2);
});

test("rejects and clears stale credentials, then allows joining again", async ({
  page,
  context,
}) => {
  const url = await createRoom(page, "Stale cookie retro");
  const cookie = (await context.cookies(url)).find((item) =>
    item.name.startsWith("retro-session-")
  )!;
  await context.addCookies([
    { ...cookie, value: "invalid-token-with-enough-characters" },
  ]);
  await page.reload();
  await expect(
    page.getByText(
      "This saved session could not be verified. Join as someone else.",
      {
        exact: true,
      }
    )
  ).toBeVisible();
  expect(
    (await context.cookies(url)).find((item) => item.name === cookie.name)
  ).toBeUndefined();
  await page
    .getByRole("link", { name: "Rejoin as a new participant", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Bobby");
  await page
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(page.getByText("Bobby (you)", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Reveal and group notes",
      exact: true,
    })
  ).toHaveCount(0);
});

test("storage failures stay in the mobile room status without blocking collaboration", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    Object.defineProperty(document, "cookie", { get: () => "", set: () => {} });
  });
  await createRoom(page, "Storage blocked retro");
  const status = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Room status" });
  await expect(
    status.getByText(/Could not save your rejoin cookie/)
  ).toBeVisible();
  await expect(
    status.getByText(/Could not save this snapshot in browser history/)
  ).toBeVisible();
  await expect(
    status.getByText("Privacy and browser storage", { exact: true })
  ).toBeVisible();
  const statusBox = (await status.boundingBox())!;
  const boardBox = (await page
    .getByLabel("Retrospective notes")
    .boundingBox())!;
  expect(statusBox.y).toBeLessThan(boardBox.y);
  await page
    .getByLabel("Add a note", { exact: true })
    .nth(0)
    .fill("Still works live");
  await page
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();
  await expect(
    page.getByText("Still works live", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Keep the takeaways", { exact: true })
  ).toHaveCount(0);
});

test("shows an expiring warning in the desktop room status", async ({
  page,
}) => {
  await createRoom(page, "Expiring retro");
  await page.evaluate(() => {
    const currentTime = Date.now.bind(Date);
    Date.now = () => currentTime() + 105 * 60 * 1000;
  });
  await page.waitForTimeout(1100);

  const status = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Room status" });
  await expect(status.getByText(/Expires in 15 min/)).toBeVisible();
  await expect(
    status.getByText(/Finish and close soon to make final exports available/)
  ).toBeVisible();
  const statusBox = (await status.boundingBox())!;
  const boardBox = (await page
    .getByLabel("Retrospective notes")
    .boundingBox())!;
  expect(statusBox.x).toBeGreaterThan(boardBox.x);
});

test("keeps lobby connection failures and retry next to the entry form", async ({
  page,
  context,
}) => {
  await context.routeWebSocket("**/retro", (socket) => socket.close());
  await page.goto("/retro");

  const lobby = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Start a fresh conversation" });
  await expect(
    lobby.getByText("Disconnected · room entry is unavailable", { exact: true })
  ).toBeVisible();
  await expect(
    lobby.getByRole("button", { name: "Retry connection", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Room status", { exact: true })).toHaveCount(0);
});
