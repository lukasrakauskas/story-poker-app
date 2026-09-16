import { expect, test, seedRetroNotes } from "./retro-fixtures";

test("keeps the room status and note actions usable on desktop and mobile", async ({
  retro,
}, testInfo) => {
  await retro.createRoom("Responsive room");
  const page = retro.owner.page;
  await seedRetroNotes(page, [
    { column: "went-well", text: "Responsive note" },
  ]);
  const status = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Room status" });
  const desktopBoard = page.getByLabel("Retrospective notes", { exact: true });
  const desktopStatusBox = (await status.boundingBox())!;
  const desktopBoardBox = (await desktopBoard.boundingBox())!;
  expect(desktopStatusBox.x).toBeGreaterThan(desktopBoardBox.x);
  await page.screenshot({
    path: testInfo.outputPath("retro-responsive-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileStatusBox = (await status.boundingBox())!;
  const mobileBoardBox = (await desktopBoard.boundingBox())!;
  expect(mobileStatusBox.y).toBeLessThan(mobileBoardBox.y);
  const noteActions = page.getByRole("button", {
    name: "Actions for note: Responsive note",
    exact: true,
  });
  await noteActions.click();
  await expect(
    page.getByRole("menuitem", { name: "Edit", exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("retro-responsive-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(noteActions).toBeFocused();
});
