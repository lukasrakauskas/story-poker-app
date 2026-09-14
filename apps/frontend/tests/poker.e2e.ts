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

async function planningLayoutAnchors(page: Page) {
  return page.evaluate(() => {
    const heading = document.querySelector(
      'main[aria-label="Planning room"] h1'
    )!;
    const header = heading.closest('[data-slot="card-header"]')!;
    const people = document.querySelector('[aria-label="People in the room"]')!;
    const sidebar = people.closest('[data-slot="card"]')!;
    const round = (value: number) => Math.round(value * 100) / 100;

    return {
      headerHeight: round(header.getBoundingClientRect().height),
      peopleOffset: round(
        people.getBoundingClientRect().top - sidebar.getBoundingClientRect().top
      ),
    };
  });
}

test("participant names are normalized and validated on create and join", async ({
  page,
  browser,
}) => {
  const validationMessage =
    "Name must be 3 to 30 characters after surrounding spaces are removed.";
  await page.goto("/");
  await page.getByLabel("Name", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(
    page.getByText(validationMessage, { exact: true })
  ).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("  Alice  ");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your estimate", exact: true })
  ).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(page.url());
    await guest.getByLabel("Name", { exact: true }).fill(" x ");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(
      guest.getByText(validationMessage, { exact: true })
    ).toBeVisible();

    await guest.getByLabel("Name", { exact: true }).fill("  Bobby  ");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(
      page.getByLabel("People in the room").getByText("Bobby", { exact: true })
    ).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

test("room controls persist and protect a planning session", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByLabel("Name", { exact: true }).fill("Alice");
  await page.getByLabel("Room password (optional)").fill("secret");
  await page.getByRole("button", { name: "Create room", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Scan to join" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss room QR code" }).click();
  await expect(page.getByRole("heading", { name: "Scan to join" })).toHaveCount(
    0
  );

  await page.getByRole("button", { name: "Estimate 3" }).click();
  await expect(page.getByText("1 of 1 voted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove vote" }).click();
  await expect(page.getByText("0 of 1 voted", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Estimate 3" })
  ).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Change your avatar" }).click();
  await page.getByRole("menuitem", { name: "Use avatar 2" }).click();
  await expect(
    page.getByRole("button", { name: "Change your avatar" }).locator("img")
  ).toHaveAttribute("src", /Amogus\.webp/);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(page.url());
    await guest.getByLabel("Name", { exact: true }).fill("Bobby");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(
      guest.getByText("Incorrect room password", { exact: true })
    ).toBeVisible();
    await guest.getByLabel("Room password (optional)").fill("secret");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByText("2 online", { exact: true })).toBeVisible();
    await expect(
      guest.getByRole("heading", { name: "Scan to join" })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Manage Bobby" }).click();
    await page.getByRole("menuitem", { name: "Make moderator" }).click();
    await expect(
      guest.getByRole("button", { name: "Reveal results", exact: true })
    ).toBeVisible();
    await expect(
      guest.getByRole("heading", { name: "Scan to join" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Estimate 3" }).click();
    await guest.getByRole("button", { name: "Estimate 5" }).click();
    await guest
      .getByRole("button", { name: "Reveal results", exact: true })
      .click();
    await expect(page.getByText("2 votes cast", { exact: true })).toBeVisible();

    await guest.reload();
    await expect(
      guest.getByText("2 votes cast", { exact: true })
    ).toBeVisible();
    await expect(
      guest.getByLabel("People in the room").getByText("5")
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Join room", exact: true })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Manage Bobby" }).click();
    await page.getByRole("menuitem", { name: "Remove from room" }).click();
    await expect(
      guest.getByText("Removed from room", { exact: true })
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Join room", exact: true })
    ).toBeVisible();
    await expect(page.getByText("1 online", { exact: true })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

test("a participant can claim moderator when all moderators are offline", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByLabel("Name", { exact: true }).fill("Alice");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scan to join" })
  ).toBeVisible();

  const roomUrl = page.url();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(roomUrl);
    await guest.getByLabel("Name", { exact: true }).fill("Bobby");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByText("2 online", { exact: true })).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Claim moderator role" })
    ).toHaveCount(0);

    await page.close();
    await expect(
      guest.getByText(
        "All moderators are offline. Claim the role to keep the room moving.",
        { exact: true }
      )
    ).toBeVisible();
    await guest
      .getByRole("button", { name: "Claim moderator role", exact: true })
      .click();

    await expect(
      guest.getByRole("button", { name: "Reveal results", exact: true })
    ).toBeVisible();
    const self = guest
      .getByLabel("People in the room")
      .getByRole("listitem")
      .filter({ hasText: "Bobby (you)" });
    await expect(self.getByText("Moderator", { exact: true })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

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
    const desktopVotingAnchors = await planningLayoutAnchors(page);
    await page.screenshot({ path: testInfo.outputPath("poker-voting.png") });
    await page
      .getByRole("button", { name: "Reveal results", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Round results" })
    ).toBeVisible();
    await expect(
      page.getByText("Results revealed", { exact: true })
    ).toBeVisible();
    expect(await planningLayoutAnchors(page)).toEqual(desktopVotingAnchors);
    await expect(
      guest.getByText("2 votes cast", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByLabel("Estimates and vote counts").getByRole("listitem")
    ).toHaveCount(2);
    await expect(page.getByText("Split vote", { exact: true })).toBeVisible();
    const distribution = page.getByRole("figure", {
      name: "Vote distribution: 3: 1 vote (50%); 5: 1 vote (50%)",
    });
    await expect(distribution).toBeVisible();
    const highlights = page.getByLabel("Result highlights");
    await expect(
      highlights.getByText("Most voted", { exact: true })
    ).toBeVisible();
    await expect(highlights.getByText("3 & 5", { exact: true })).toBeVisible();
    await expect(
      highlights.getByText("Middle ground", { exact: true })
    ).toBeVisible();
    await expect(highlights.getByText("5", { exact: true })).toBeVisible();
    await expect(
      highlights.getByText("Closest card to the average (4)", { exact: true })
    ).toBeVisible();
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 900, height: 600 },
      { width: 1536, height: 864 },
    ]) {
      await page.setViewportSize(viewport);
      await expectFitsViewport(page);
      const chartLayout = await distribution.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        width: element.getBoundingClientRect().width,
        parentWidth: element.parentElement!.getBoundingClientRect().width,
      }));
      expect(chartLayout.height).toBeLessThanOrEqual(viewport.height * 0.6 + 1);
      expect(chartLayout.width / chartLayout.parentWidth).toBeCloseTo(2 / 3, 2);
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
    const mobileResultsAnchors = await planningLayoutAnchors(page);
    await page
      .getByRole("button", { name: "Start voting", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Estimate 3", exact: true })
    ).toHaveAttribute("aria-pressed", "false");
    expect(await planningLayoutAnchors(page)).toEqual(mobileResultsAnchors);
    await page.setViewportSize({ width: 1280, height: 720 });
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
