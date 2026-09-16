import { expect, test } from "./retro-fixtures";

test("reopens a participant in a replacement tab without losing its cookie", async ({
  retro,
}) => {
  await retro.createRoom("Replacement tab");
  const owner = retro.owner;
  const original = await retro.joinParticipant("Bobby");
  const roomUrl = retro.url;
  const originalCookie = (await original.context.cookies(roomUrl)).find(
    (cookie) => cookie.name.startsWith("retro-session-")
  );
  expect(originalCookie).toBeTruthy();

  const replacement = await retro.newPage(original);
  await replacement.goto(roomUrl);
  await replacement
    .getByRole("button", { name: "Continue as Bobby", exact: true })
    .click();
  await expect(
    replacement.getByText("Bobby (you)", { exact: true })
  ).toBeVisible();
  await original.page.close();
  await replacement.reload();
  await replacement
    .getByRole("button", { name: "Continue as Bobby", exact: true })
    .click();
  await expect(
    replacement.getByRole("button", {
      name: "Mark writing done",
      exact: true,
    })
  ).toBeEnabled();
  expect(
    (await original.context.cookies(roomUrl)).find(
      (cookie) => cookie.name === originalCookie?.name
    )?.value
  ).not.toBe(originalCookie?.value);
  expect(await replacement.evaluate(() => document.cookie)).not.toContain(
    originalCookie!.name
  );
  await expect(owner.page.getByText("Bobby", { exact: true })).toBeVisible();
});

test("recovers moderation and removes a stale participant through the live socket", async ({
  retro,
}) => {
  await retro.createRoom("Moderator recovery");
  const owner = retro.owner;
  const guest = await retro.joinParticipant("Bobby");
  const removed = await retro.joinParticipant("Charlie");

  await owner.page.goto("/retro/history");
  await guest.page
    .getByRole("button", { name: "Claim moderator role", exact: true })
    .click();
  await expect(
    guest.page.getByRole("button", {
      name: "Reveal and group notes",
      exact: true,
    })
  ).toBeEnabled();

  await owner.page.goto(retro.url);
  await owner.page
    .getByRole("button", { name: "Continue as Alice", exact: true })
    .click();
  await expect(
    owner.page.getByText("Connected · changes sync live", { exact: true })
  ).toBeVisible();
  await expect(
    owner.page.getByRole("button", {
      name: "Reveal and group notes",
      exact: true,
    })
  ).toHaveCount(0);
  await guest.page
    .getByRole("button", { name: "Transfer moderator to Alice", exact: true })
    .click();
  await expect(
    owner.page.getByRole("button", {
      name: "Reveal and group notes",
      exact: true,
    })
  ).toBeEnabled();

  await owner.page
    .getByRole("button", { name: "Remove participant Charlie", exact: true })
    .click();
  await owner.page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove participant", exact: true })
    .click();
  await expect(
    removed.page.getByText("A moderator removed you from this retrospective.", {
      exact: true,
    })
  ).toBeVisible();
  // Revocation is authoritative on the server; a displaced socket cannot
  // delete another tab's HttpOnly cookie. Reload must reject the old identity.
  await removed.page.reload();
  await expect(
    removed.page.getByText(
      "This saved session could not be verified. Join as someone else.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    removed.page.getByRole("button", {
      name: "Continue as Charlie",
      exact: true,
    })
  ).toHaveCount(0);
});
