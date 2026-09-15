import { expect, type Page } from "@playwright/test";

export async function chooseRecoveryHistory(page: Page) {
  const choice = page.getByRole("region", {
    name: "Choose browser history for this room",
    exact: true,
  });
  await expect(choice).toBeVisible();
  await choice
    .getByLabel("Save recovery snapshots and completed takeaways", {
      exact: true,
    })
    .check();
  await choice
    .getByRole("button", { name: "Save history preference", exact: true })
    .click();
  await expect(choice).toHaveCount(0);
}

export async function chooseNoHistory(page: Page) {
  const choice = page.getByRole("region", {
    name: "Choose browser history for this room",
    exact: true,
  });
  await expect(choice).toBeVisible();
  await choice
    .getByLabel("Do not save browser history", { exact: true })
    .check();
  await choice
    .getByRole("button", { name: "Save history preference", exact: true })
    .click();
  await expect(choice).toHaveCount(0);
}

export async function chooseFinalOnlyHistory(page: Page) {
  const choice = page.getByRole("region", {
    name: "Choose browser history for this room",
    exact: true,
  });
  await expect(choice).toBeVisible();
  await choice
    .getByLabel("Save completed takeaways only (recommended)", { exact: true })
    .check();
  await choice
    .getByRole("button", { name: "Save history preference", exact: true })
    .click();
  await expect(choice).toHaveCount(0);
}
