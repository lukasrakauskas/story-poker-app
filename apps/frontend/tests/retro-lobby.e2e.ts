import { test, expect } from "@playwright/test";

test("validates normalized participant names before entering a room", async ({
  browser,
  page,
}) => {
  await page.goto("/retro");
  await expect(page.getByText("Connected · ready to enter")).toBeVisible();

  const name = page.getByLabel("Your name");
  const title = page.getByLabel("Retrospective title");
  const submit = page.getByRole("button", {
    name: "Create retrospective",
    exact: true,
  });
  const error = page.locator("#retro-name-error");
  await title.fill("Name validation");

  await name.fill("abc");
  await name.fill("");
  await expect(submit).toBeDisabled();
  await expect(error).toHaveText(
    "Name must be at least 3 characters after trimming spaces"
  );
  await expect(name).toHaveAttribute("aria-describedby", "retro-name-error");

  await name.fill("  ab  ");
  await expect(submit).toBeDisabled();
  await expect(error).toBeVisible();

  await name.fill("abc");
  await expect(submit).toBeEnabled();
  await name.fill("  Alice  ");
  await expect(submit).toBeEnabled();

  const oversized = ` ${"a".repeat(31)} `;
  await name.fill(oversized);
  await expect(submit).toBeDisabled();
  await expect(error).toHaveText(
    "Name must be at most 30 characters after trimming spaces"
  );
  expect(await name.inputValue()).toBe(oversized);

  await name.fill("  Alice  ");
  await submit.click();
  await expect(
    page.getByRole("heading", { name: "Name validation", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Alice (you)", { exact: true })).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(page.url());
  await expect(guest.getByText("Connected · ready to enter")).toBeVisible();
  const duplicateName = guest.getByLabel("Your name");
  await duplicateName.fill(" Alice ");
  await guest.getByRole("button", { name: "Join a room", exact: true }).click();
  await duplicateName.fill(" Alice ");
  await guest.getByLabel("Room code").fill(page.url().split("/").pop()!);
  await guest
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(
    guest.getByText("That name is already in use. Choose another name.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(duplicateName).toHaveValue(" Alice ");
  await guestContext.close();
});
