import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("tied ranks keep creation order through reconnect, history and exports", async ({
  page,
}) => {
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill("Tied priorities");
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tied priorities", exact: true })
  ).toBeVisible();
  const notes = [
    "First created",
    "Second created",
    "Third created",
    "Fourth created",
  ];
  for (const text of notes) {
    await page.getByLabel("Add a note", { exact: true }).first().fill(text);
    await page
      .getByRole("button", { name: "Add to went well", exact: true })
      .click();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  for (const label of ["Reveal and group notes", "Start voting"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("button", {
        name: `Confirm ${label.toLowerCase()}`,
        exact: true,
      })
      .click();
  }
  for (const text of notes.slice(0, 2))
    await page
      .getByRole("button", { name: `Vote for note: ${text}`, exact: true })
      .click();
  await page
    .getByRole("button", { name: "Start discussion", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm start discussion", exact: true })
    .click();
  const priorities = page.getByRole("region", {
    name: "Discussion priorities",
    exact: true,
  });
  async function assertRanks() {
    await expect(
      priorities.getByLabel("Rank 1 (tied)", { exact: true })
    ).toHaveCount(2);
    await expect(
      priorities.getByLabel("Rank 3 (tied)", { exact: true })
    ).toHaveCount(2);
    for (let i = 0; i < notes.length; i++)
      await expect(priorities.locator("article").nth(i)).toContainText(
        notes[i]
      );
  }
  await assertRanks();
  await page.reload();
  await assertRanks();
  await page
    .getByRole("button", { name: "Close retrospective", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm close retrospective", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Previous retrospectives", exact: true })
    .click();
  await page
    .getByText("View saved notes and participants", { exact: true })
    .click();
  await assertRanks();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Markdown", exact: true })
    .click();
  const markdown = await readFile((await (await downloading).path())!, "utf8");
  expect(markdown.match(/Rank 1 \(tied\)/g)).toHaveLength(2);
  expect(markdown.match(/Rank 3 \(tied\)/g)).toHaveLength(2);
  for (let i = 1; i < notes.length; i++)
    expect(markdown.indexOf(notes[i])).toBeGreaterThan(
      markdown.indexOf(notes[i - 1])
    );
});
