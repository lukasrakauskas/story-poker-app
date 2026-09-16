import { test, expect, type Page, type Locator } from "@playwright/test";
import { chooseRecoveryHistory } from "./retro-history-test-helpers";

async function beginDrag(page: Page, handle: Locator) {
  await handle.scrollIntoViewIfNeeded();
  const from = (await handle.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 12,
    from.y + from.height / 2,
    {
      steps: 4,
    }
  );
}

async function finishDrag(page: Page, target: Locator) {
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
}

async function drag(page: Page, handle: Locator, target: Locator) {
  await beginDrag(page, handle);
  await finishDrag(page, target);
}

test("stacks notes across live lanes and shares interpolated drag presence", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill("Stacks");
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await chooseRecoveryHistory(page);

  const guestContext = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });
  const guest = await guestContext.newPage();
  await guest.goto(page.url());
  await guest.getByLabel("Your name").fill("Bob");
  await guest
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await chooseRecoveryHistory(guest);

  for (const text of ["First note", "Second note", "Third note"]) {
    await page.getByLabel("Add a note", { exact: true }).first().fill(text);
    await page
      .getByRole("button", { name: "Add to went well", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Reveal and arrange notes", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Confirm reveal and arrange notes",
      exact: true,
    })
    .click();

  const firstHandle = page.getByRole("button", {
    name: "Drag note: First note",
    exact: true,
  });
  await beginDrag(page, firstHandle);
  await expect(
    guest.getByText("Alice is moving this", { exact: true })
  ).toBeVisible();
  const remoteCard = guest
    .getByText("Alice is moving this", { exact: true })
    .locator("xpath=ancestor::article");
  await expect(remoteCard).toHaveCSS("border-style", "solid");
  await finishDrag(page, page.getByText("Second note", { exact: true }));

  await expect(
    page.getByText("2 matching notes", { exact: true })
  ).toBeVisible();
  await expect(
    guest.getByText("2 matching notes", { exact: true })
  ).toBeVisible();
  await expect(
    guest.getByText("Alice is moving this", { exact: true })
  ).toHaveCount(0);

  const stackToggle = page.getByRole("button", {
    name: /Second note.*2 matching notes/,
  });
  await stackToggle.click();
  await expect(page.getByText("First note", { exact: true })).toBeVisible();

  const ideas = page.getByRole("region", { name: "Ideas lane", exact: true });
  await drag(
    page,
    page.getByRole("button", {
      name: "Drag stack: Second note",
      exact: true,
    }),
    ideas
  );
  await expect(
    guest
      .getByRole("region", { name: "Ideas lane", exact: true })
      .getByText("2 matching notes", { exact: true })
  ).toBeVisible();

  // Expanding exposes original messages; dragging one out dissolves a singleton stack.
  await page
    .getByRole("button", { name: /Second note.*2 matching notes/ })
    .click();
  await drag(
    page,
    page.getByRole("button", { name: "Drag note: First note", exact: true }),
    page.getByRole("region", { name: "To improve lane", exact: true })
  );
  await expect(page.getByText("2 matching notes", { exact: true })).toHaveCount(
    0
  );
  await expect(
    guest
      .getByRole("region", { name: "To improve lane", exact: true })
      .getByText("First note", { exact: true })
  ).toBeVisible();

  // Any participant can stack matching messages, not only the moderator.
  await drag(
    guest,
    guest.getByRole("button", { name: "Drag note: Third note", exact: true }),
    guest.getByText("First note", { exact: true })
  );
  await expect(
    page.getByText("2 matching notes", { exact: true })
  ).toBeVisible();

  await page.reload();
  await page
    .getByRole("button", { name: "Continue as Alice", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "To improve lane", exact: true })
      .getByText("2 matching notes", { exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: "Start voting", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm start voting", exact: true })
    .click();
  const groupedTarget = page
    .getByText("2 grouped messages", { exact: true })
    .locator("xpath=ancestor::article");
  await expect(
    groupedTarget.getByText("First note", { exact: true })
  ).toBeVisible();
  await expect(
    groupedTarget.getByText("Third note", { exact: true })
  ).toBeVisible();
  await expect(groupedTarget.getByText("Vote", { exact: true })).toHaveCount(2);
  await groupedTarget.getByText("Vote", { exact: true }).first().click();
  await expect(groupedTarget.getByText("Voted", { exact: true })).toHaveCount(
    1
  );
  await expect(groupedTarget.getByText("Vote", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Vote", { exact: true })).toHaveCount(2);

  await page
    .getByRole("button", { name: "Start discussion", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm start discussion", exact: true })
    .click();
  const discussionGroup = page
    .getByText("2 grouped messages", { exact: true })
    .locator("xpath=ancestor::article");
  await expect(
    discussionGroup.getByText("First note", { exact: true })
  ).toBeVisible();
  await expect(
    discussionGroup.getByText("Third note", { exact: true })
  ).toBeVisible();
  await expect(
    discussionGroup.getByText("1 vote across group", { exact: true })
  ).toBeVisible();
  await guestContext.close();
});
