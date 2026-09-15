import { test, expect, type Page, type Locator } from "@playwright/test";
import { chooseRecoveryHistory } from "./retro-history-test-helpers";

async function drag(page: Page, handle: Locator, target: Locator) {
  await handle.scrollIntoViewIfNeeded();
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 10,
    from.y + from.height / 2,
    { steps: 3 }
  );
  await page.mouse.move(to.x + to.width / 2, to.y + 15, { steps: 15 });
  await page.mouse.up();
}

test("drag notes into live stacks, move and ungroup, cancel, and resume", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill("Stacking");
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Stacking", exact: true })
  ).toBeVisible();
  await chooseRecoveryHistory(page);
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(page.url());
  await guest.getByLabel("Your name").fill("Bob");
  await guest
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", { name: "Stacking", exact: true })
  ).toBeVisible();
  await chooseRecoveryHistory(guest);
  for (const text of ["First note", "Second note", "Third note"]) {
    await page.getByLabel("Add a note", { exact: true }).first().fill(text);
    await page
      .getByRole("button", { name: "Add to went well", exact: true })
      .click();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Reveal and group notes", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Confirm reveal and group notes",
      exact: true,
    })
    .click();
  const handle = (text: string) =>
    page.getByRole("button", { name: `Drag note: ${text}`, exact: true });
  await drag(
    page,
    handle("First note"),
    page.getByText("Second note", { exact: true })
  );
  await expect(
    page.getByRole("button", { name: "Create theme from 2 notes", exact: true })
  ).toBeDisabled();
  await expect(page.getByLabel("Theme name", { exact: true })).toBeFocused();
  await page.getByLabel("Theme name", { exact: true }).fill("Delivery");
  await page
    .getByRole("button", { name: "Create theme from 2 notes", exact: true })
    .click();
  const stack = page.getByRole("article", {
    name: "Theme: Delivery",
    exact: true,
  });
  await expect(stack.getByText("2 notes", { exact: true })).toBeVisible();
  await expect(
    guest.getByRole("article", { name: "Theme: Delivery", exact: true })
  ).toBeVisible();
  await expect(guest.getByRole("button", { name: /^Drag note:/ })).toHaveCount(
    0
  );
  await drag(
    page,
    handle("Third note"),
    stack.getByRole("heading", { name: "Delivery", exact: true })
  );
  await expect(stack.getByText("3 notes", { exact: true })).toBeVisible();
  await page.reload();
  await expect(stack.getByText("3 notes", { exact: true })).toBeVisible();
  await handle("Third note").focus();
  await page.keyboard.press("Space");
  await expect(handle("Third note")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(handle("Third note")).not.toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(stack.getByText("3 notes", { exact: true })).toBeVisible();
  await drag(
    page,
    handle("Third note"),
    page.getByRole("heading", { name: "Ungrouped notes", exact: true })
  );
  await expect(stack.getByText("2 notes", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Ungrouped notes", exact: true })
      .getByText("Third note", { exact: true })
  ).toBeVisible();
  // Non-drag controls provide the same operation, including on narrow screens.
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Move note to theme: Third note", { exact: true })
    .selectOption({ label: "Delivery" });
  await expect(stack.getByText("3 notes", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove note from theme: Third note",
      exact: true,
    })
    .click();
  await expect(stack.getByText("2 notes", { exact: true })).toBeVisible();
  await guestContext.close();
});
