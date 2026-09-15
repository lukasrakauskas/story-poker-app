import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function snapshot(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(
        Object.entries(localStorage).find(([key]) =>
          key.startsWith("retro-history-v1:")
        )![1]
      ).room
  );
}

async function editAction(page: Page, text: string) {
  await page
    .getByRole("button", { name: `Actions for action: ${text}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  return page.getByRole("form", { name: "Edit action", exact: true });
}

test("edit, reassign, unassign and retain a removed action owner across reconnect and export", async ({
  page,
  browser,
}) => {
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill("Action ownership");
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Action ownership", exact: true })
  ).toBeVisible();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(page.url());
  await guest.getByLabel("Your name").fill("Bobby");
  await guest
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(page.getByText("Bobby", { exact: true })).toBeVisible();
  for (const label of [
    "Reveal and group notes",
    "Start voting",
    "Start discussion",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("button", {
        name: `Confirm ${label.toLowerCase()}`,
        exact: true,
      })
      .click();
  }
  const create = page.getByRole("form", { name: "New action", exact: true });
  await create.getByLabel("Next step", { exact: true }).fill("Initial step");
  await create.getByLabel("Owner (optional)").selectOption({ label: "Bobby" });
  await create.getByRole("button", { name: "Add action", exact: true }).click();
  await page
    .getByRole("checkbox", {
      name: "Mark action complete: Initial step",
      exact: true,
    })
    .check();
  await expect(guest.getByText("Owner: Bobby", { exact: true })).toBeVisible();
  await expect(
    guest.getByRole("button", { name: /^Actions for action:/ })
  ).toHaveCount(0);
  const original = (await snapshot(page)).actions[0];
  let editor = await editAction(page, "Initial step");
  await editor.getByLabel("Edit next step").fill("Corrected step");
  await editor.getByLabel("Owner (optional)").selectOption({ label: "Alice" });
  await editor
    .getByRole("button", { name: "Save action", exact: true })
    .click();
  await expect(guest.getByText("Owner: Alice", { exact: true })).toBeVisible();
  expect((await snapshot(page)).actions[0]).toMatchObject({
    id: original.id,
    done: true,
    text: "Corrected step",
    owner: { kind: "participant", name: "Alice" },
  });
  editor = await editAction(page, "Corrected step");
  await editor.getByLabel("Owner (optional)").selectOption("unassigned");
  await editor
    .getByRole("button", { name: "Save action", exact: true })
    .click();
  await expect(
    page.getByText("Owner: Unassigned", { exact: true })
  ).toBeVisible();
  editor = await editAction(page, "Corrected step");
  await editor.getByLabel("Owner (optional)").selectOption({ label: "Bobby" });
  await editor
    .getByRole("button", { name: "Save action", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove participant Bobby", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove participant", exact: true })
    .click();
  await expect(
    page.getByText("Owner: Bobby (no longer in room)", { exact: true })
  ).toBeVisible();
  editor = await editAction(page, "Corrected step");
  await editor.getByLabel("Edit next step").fill("Final step");
  await editor
    .getByRole("button", { name: "Save action", exact: true })
    .click();
  await expect(page.getByText("Final step", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await snapshot(page)).actions[0].text)
    .toBe("Final step");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue as Alice", exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue as Alice", exact: true })
    .click();
  await expect(
    page.getByText("Owner: Bobby (no longer in room)", { exact: true })
  ).toBeVisible();
  expect((await snapshot(page)).actions[0]).toEqual({
    ...original,
    text: "Final step",
    done: true,
  });
  await page
    .getByRole("button", { name: "Close retrospective", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm close retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: "New action", exact: true })
  ).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const exported = JSON.parse(
    await readFile((await (await downloading).path())!, "utf8")
  );
  expect(exported.actions[0]).toEqual({
    ...original,
    text: "Final step",
    done: true,
  });
  await page
    .getByRole("link", { name: "Previous retrospectives", exact: true })
    .click();
  await expect(page.getByText("Done · Bobby", { exact: true })).toBeVisible();
  const markdownDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Markdown", exact: true })
    .click();
  expect(
    await readFile((await (await markdownDownload).path())!, "utf8")
  ).toContain("Final step — Owner: Bobby");
  await guestContext.close();
});
