import { test, expect, type Page } from "@playwright/test";

async function expectFitsViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shell = document.querySelector("#app-content")!;
        const main = document.querySelector(
          'main[aria-label="Planning room"]'
        )!;
        return {
          horizontal: document.documentElement.scrollWidth <= window.innerWidth,
          vertical: document.documentElement.scrollHeight <= window.innerHeight,
          shellOverflow: shell.scrollHeight - shell.clientHeight,
          fillsHeight:
            Math.abs(
              main.getBoundingClientRect().height - shell.clientHeight
            ) <= 1,
          fillsWidth:
            Math.abs(main.getBoundingClientRect().width - shell.clientWidth) <=
            1,
        };
      })
    )
    .toEqual({
      horizontal: true,
      vertical: true,
      shellOverflow: 0,
      fillsHeight: true,
      fillsWidth: true,
    });
}

test("poker voting and results fill the viewport without incidental scrolling", async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Name", { exact: true }).fill("Alice");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your estimate" })
  ).toBeVisible();
  await expect(page.getByLabel("Room link", { exact: true })).toHaveValue(
    page.url()
  );
  await expectFitsViewport(page);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  guest.on("pageerror", (error) => errors.push(error.message));
  try {
    await guest.goto(page.url());
    await guest.getByLabel("Name", { exact: true }).fill("Bobby");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByText("2 online", { exact: true })).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Reveal results", exact: true })
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Estimate 3", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Estimate 3", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      guest.getByLabel("People in the room").getByText("Voted", { exact: true })
    ).toBeVisible();
    await expect(
      guest.getByLabel("People in the room").getByText("3", { exact: true })
    ).toHaveCount(0);
    await guest
      .getByRole("button", { name: "Estimate 5", exact: true })
      .click();
    await expect(
      page.getByText("Ready to reveal", { exact: true })
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("poker-voting.png") });
    await page
      .getByRole("button", { name: "Reveal results", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Round results" })
    ).toBeVisible();
    await expect(
      guest.getByText("2 votes cast", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByLabel("Estimates and vote counts").getByRole("listitem")
    ).toHaveCount(2);
    await expect(page.getByText("Split vote", { exact: true })).toBeVisible();
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 900, height: 600 },
      { width: 1536, height: 864 },
    ]) {
      await page.setViewportSize(viewport);
      await expectFitsViewport(page);
      // A short result list must not need a hidden inner scrollbar either.
      await expect
        .poll(() =>
          page
            .getByLabel("Vote results")
            .evaluate(
              (element) =>
                element.parentElement!.scrollHeight -
                element.parentElement!.clientHeight
            )
        )
        .toBe(0);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: testInfo.outputPath("poker-results.png") });
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath("poker-results-dark.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Start voting", exact: true })
    ).toBeVisible();
    await page
      .getByRole("heading", { name: "Round results" })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.querySelector("#app-content")!.scrollWidth <=
            window.innerWidth
      )
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page
      .getByRole("button", { name: "Start voting", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Estimate 3", exact: true })
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("0 of 2 voted", { exact: true })).toBeVisible();
    await expectFitsViewport(page);
    await page
      .getByRole("button", { name: "Reveal results", exact: true })
      .click();
    await expect(
      page.getByText("No estimates this round", { exact: true })
    ).toBeVisible();
    await expectFitsViewport(page);
    expect(errors).toEqual([]);
  } finally {
    await guestContext.close();
  }
});
