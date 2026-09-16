import { expect, seedRetroNotes, test } from "./retro-fixtures";

async function socketMarkers(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    window.retroTestSockets.map(
      (socket) =>
        (
          socket as WebSocket & {
            navigationProbe?: number;
          }
        ).navigationProbe ?? null
    )
  );
}

test("keeps the retro session alive across client navigation and browser history", async ({
  retro,
}) => {
  await retro.createRoom("Persistent navigation");
  const page = retro.owner.page;
  await seedRetroNotes(page, [
    { column: "went-well", text: "Before navigation" },
  ]);

  const socketsBeforeNavigation = await page.evaluate(() =>
    window.retroTestSockets.map((socket, index) => {
      Object.assign(socket, { navigationProbe: index + 1 });
      return index + 1;
    })
  );
  expect(socketsBeforeNavigation.length).toBeGreaterThan(0);

  await page
    .getByRole("link", { name: "Previous retrospectives", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Previous retrospectives", exact: true })
  ).toBeVisible();
  expect(await socketMarkers(page)).toEqual(socketsBeforeNavigation);

  await page.goBack();
  await expect(
    page.getByRole("heading", { name: retro.title, exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Alice (you)", { exact: true }).first()
  ).toBeVisible();
  expect(await socketMarkers(page)).toEqual(socketsBeforeNavigation);

  await seedRetroNotes(page, [{ column: "ideas", text: "After navigation" }]);

  await page.reload();
  await page
    .getByRole("button", { name: "Continue as Alice", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: retro.title, exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Alice (you)", { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByText("Before navigation", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("After navigation", { exact: true })
  ).toBeVisible();
});
