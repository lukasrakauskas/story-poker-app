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
    reopened.getByText("Alice (you)", { exact: true })
  ).toBeVisible();
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
    reopened.getByRole("button", { name: "Start voting", exact: true })
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
    reopened.getByText("Alice (you)", { exact: true })
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
    page.getByText("This session is no longer available. Join again.", {
      exact: true,
    })
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
    page.getByRole("button", { name: "Start voting", exact: true })
  ).toHaveCount(0);
});

test("storage failures warn without blocking live collaboration", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    Object.defineProperty(document, "cookie", { get: () => "", set: () => {} });
  });
  await createRoom(page, "Storage blocked retro");
  await expect(
    page.getByText(/Could not save your rejoin cookie/)
  ).toBeVisible();
  await expect(
    page.getByText(/Could not save this snapshot in browser history/)
  ).toBeVisible();
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
