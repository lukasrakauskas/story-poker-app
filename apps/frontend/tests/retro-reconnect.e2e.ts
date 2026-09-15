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
  await expect(
    replacement.getByText("Bobby (you)", { exact: true })
  ).toBeVisible();
  await original.page.close();
  await replacement.reload();
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
  ).toBe(originalCookie?.value);
  await expect(owner.page.getByText("Bobby", { exact: true })).toBeVisible();
});

test("recovers moderation and removes a stale participant through the live socket", async ({
  retro,
}) => {
  await retro.createRoom("Moderator recovery");
  const owner = retro.owner;
  const guest = await retro.joinParticipant("Bobby");
  const removed = await retro.joinParticipant("Charlie");

  await owner.page.evaluate(() => window.retroTestSockets.at(-1)?.close());
  await expect(
    owner.page.getByText("Disconnected · changes are disabled", { exact: true })
  ).toBeVisible();
  await guest.page
    .getByRole("button", { name: "Claim moderator role", exact: true })
    .click();
  await expect(
    guest.page.getByRole("button", {
      name: "Reveal and group notes",
      exact: true,
    })
  ).toBeEnabled();

  await owner.page.getByRole("button", { name: "Retry connection" }).click();
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
  expect(
    (await removed.context.cookies(retro.url)).some((cookie) =>
      cookie.name.startsWith("retro-session-")
    )
  ).toBe(false);
});
