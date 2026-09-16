import { expect, test } from "./retro-fixtures";

const values = ["1", "9", "10", "99"];

type BadgeMeasurements = {
  widths: number[];
  heights: number[];
  centerOffsets: number[];
  largeWidth: number;
  largeClips: boolean;
};

async function measureCountBadges(page: import("@playwright/test").Page) {
  return page.getByTestId("count-badge-cases").evaluate((showcase) => {
    const badges = Array.from(
      showcase.querySelectorAll<HTMLElement>("[data-count-value]")
    );
    const measure = (badge: HTMLElement) => {
      const bounds = badge.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(badge);
      const content = range.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        centerOffset: Math.abs(
          bounds.left + bounds.width / 2 - (content.left + content.width / 2)
        ),
      };
    };
    const regular = badges.slice(0, 4).map(measure);
    const large = badges[4];
    return {
      widths: regular.map(({ width }) => width),
      heights: regular.map(({ height }) => height),
      centerOffsets: regular.map(({ centerOffset }) => centerOffset),
      largeWidth: large.getBoundingClientRect().width,
      largeClips: large.scrollWidth > large.clientWidth,
    } satisfies BadgeMeasurements;
  });
}

function expectStableMeasurements(measurements: BadgeMeasurements) {
  expect(new Set(measurements.widths).size).toBe(1);
  expect(new Set(measurements.heights).size).toBe(1);
  expect(Math.max(...measurements.centerOffsets)).toBeLessThanOrEqual(0.5);
  expect(measurements.largeWidth).toBeGreaterThan(measurements.widths[0]);
  expect(measurements.largeClips).toBe(false);
}

test("count badges stay aligned across digit counts, themes, and mobile", async ({
  retro,
}, testInfo) => {
  await retro.createRoom("Count badge regression");
  const page = retro.owner.page;
  const source = page.locator('[data-slot="badge"][data-size="count"]').first();
  await expect(source).toBeVisible();

  await source.evaluate((badge, badgeValues) => {
    const showcase = document.createElement("section");
    showcase.dataset.testid = "count-badge-cases";
    showcase.setAttribute("aria-label", "Count badge visual cases");
    Object.assign(showcase.style, {
      position: "fixed",
      inset: "1rem auto auto 1rem",
      zIndex: "9999",
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      padding: "1rem",
      border: "1px solid var(--border)",
      borderRadius: "0.75rem",
      background: "var(--background)",
      color: "var(--foreground)",
    });

    for (const value of [...badgeValues, "1000"]) {
      const clone = badge.cloneNode(true) as HTMLElement;
      clone.textContent = value;
      clone.dataset.countValue = value;
      clone.setAttribute("aria-label", `${value} items`);
      showcase.append(clone);
    }
    document.body.append(showcase);
  }, values);

  const showcase = page.getByTestId("count-badge-cases");
  expectStableMeasurements(await measureCountBadges(page));
  await showcase.screenshot({
    path: testInfo.outputPath("count-badges-light.png"),
  });

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expectStableMeasurements(await measureCountBadges(page));
  await showcase.screenshot({
    path: testInfo.outputPath("count-badges-dark.png"),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  expectStableMeasurements(await measureCountBadges(page));
  await expect(showcase).toBeInViewport();
  await showcase.screenshot({
    path: testInfo.outputPath("count-badges-mobile.png"),
  });
});
