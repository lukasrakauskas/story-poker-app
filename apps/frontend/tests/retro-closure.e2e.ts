import { test, expect, type Page } from "@playwright/test";

async function saved(page: Page) {
  return page.evaluate(
    () =>
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("retro-history-v1:")
      )![1]
  );
}

test("closure freezes snapshots and save times across presence, reopen and late visitors", async ({
  page,
  browser,
}) => {
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill("Final record");
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Final record", exact: true })
  ).toBeVisible();
  const url = page.url();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(url);
  await guest.getByLabel("Your name").fill("Bobby");
  await guest
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(page.getByText("Bobby", { exact: true })).toBeVisible();
  for (const label of [
    "Reveal and group notes",
    "Start voting",
    "Start discussion",
    "Close retrospective",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("button", {
        name: `Confirm ${label.toLowerCase()}`,
        exact: true,
      })
      .click();
  }
  await expect(
    guest.getByText("Retrospective complete · read-only", { exact: true })
  ).toBeVisible();
  const originalOwner = await saved(page);
  const originalGuest = await saved(guest);
  expect(JSON.parse(originalOwner).room.closedAt).toEqual(expect.any(Number));
  await expect(
    page.getByText("Final participant record", { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel("Room link", { exact: true })).toHaveCount(0);
  await guest.close();
  const reopened = await guestContext.newPage();
  await reopened.goto(url);
  await expect(
    reopened.getByText("Retrospective complete · read-only", { exact: true })
  ).toBeVisible();
  expect(await saved(reopened)).toBe(originalGuest);
  await page.reload();
  await expect(
    page.getByText("Retrospective complete · read-only", { exact: true })
  ).toBeVisible();
  expect(await saved(page)).toBe(originalOwner);
  const lateContext = await browser.newContext();
  const late = await lateContext.newPage();
  await late.goto(url);
  await expect(
    late.getByText("This room link is expired or does not exist.", {
      exact: false,
    })
  ).toBeVisible();
  await expect(late.getByLabel("Your name")).toHaveCount(0);
  await expect(
    late.getByRole("link", {
      name: "Start or join another room",
      exact: true,
    })
  ).toHaveAttribute("href", "/retro");
  expect(await saved(page)).toBe(originalOwner);
  expect(await saved(reopened)).toBe(originalGuest);
  await page
    .getByRole("link", { name: "Previous retrospectives", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Final record", exact: true })
  ).toBeVisible();
  expect(await saved(page)).toBe(originalOwner);
  await guestContext.close();
  await lateContext.close();
});
