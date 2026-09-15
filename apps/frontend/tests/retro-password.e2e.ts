import { expect, test } from "@playwright/test";

test("protects retrospective entry without leaking room content or passwords", async ({
  browser,
  page: owner,
}) => {
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const password = "separate-channel-secret";
  try {
    await owner.goto("/retro");
    await owner.getByLabel("Your name").fill("Alice");
    await owner
      .getByLabel("Retrospective title")
      .fill("Sensitive retrospective");
    await owner.getByLabel("Room password (optional)").fill(password);
    await owner
      .getByRole("button", { name: "Create retrospective", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", {
        name: "Sensitive retrospective",
        exact: true,
      })
    ).toBeVisible();

    const roomUrl = owner.url();
    expect(roomUrl).not.toContain(password);
    await expect(
      owner.getByText("People · 1 online / 1", { exact: true })
    ).toBeVisible();

    await guest.goto(roomUrl);
    await expect(
      guest.getByLabel("Room password (required)", { exact: true })
    ).toBeVisible();
    await expect(
      guest.getByRole("heading", {
        name: "Sensitive retrospective",
        exact: true,
      })
    ).toHaveCount(0);
    await guest.getByLabel("Your name").fill("Bobby");
    await guest.getByLabel("Room password (required)").fill("wrong");
    await guest
      .getByRole("button", { name: "Join retrospective", exact: true })
      .click();
    await expect(
      guest.getByText("Incorrect room password.", {
        exact: true,
      })
    ).toBeVisible();
    await expect(
      guest.getByRole("heading", {
        name: "Sensitive retrospective",
        exact: true,
      })
    ).toHaveCount(0);
    await expect(
      owner.getByText("People · 1 online / 1", { exact: true })
    ).toBeVisible();

    await guest.getByLabel("Room password (required)").fill(password);
    await guest
      .getByRole("button", { name: "Join retrospective", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", {
        name: "Sensitive retrospective",
        exact: true,
      })
    ).toBeVisible();
    await expect(
      owner.getByText("People · 2 online / 2", { exact: true })
    ).toBeVisible();

    const guestStorage = await guest.evaluate(() => ({
      cookies: document.cookie,
      localStorage: JSON.stringify(localStorage),
      url: window.location.href,
    }));
    expect(guestStorage.cookies).not.toContain(password);
    expect(guestStorage.localStorage).not.toContain(password);
    expect(guestStorage.url).not.toContain(password);

    await guest.reload();
    await expect(
      guest.getByRole("heading", {
        name: "Sensitive retrospective",
        exact: true,
      })
    ).toBeVisible();
    await expect(guest.getByLabel("Room password (required)")).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
});

test("keeps unprotected retrospective joins passwordless", async ({
  browser,
  page: owner,
}) => {
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await owner.goto("/retro");
    await owner.getByLabel("Your name").fill("Alice");
    await owner.getByLabel("Retrospective title").fill("Open retrospective");
    await owner
      .getByRole("button", { name: "Create retrospective", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: "Open retrospective", exact: true })
    ).toBeVisible();
    await guest.goto(owner.url());
    await expect(guest.getByLabel(/Room password/)).toHaveCount(0);
    await guest.getByLabel("Your name").fill("Bobby");
    await guest
      .getByRole("button", { name: "Join retrospective", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Open retrospective", exact: true })
    ).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
