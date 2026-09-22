import { test, expect } from "@playwright/test";
import {
  chooseFinalOnlyHistory,
  chooseNoHistory,
  chooseRecoveryHistory,
} from "./retro-history-test-helpers";

function backendRoomUrl(room: string) {
  const backendPort = process.env.PLAYWRIGHT_BACKEND_PORT ?? "4000";
  return `http://localhost:${backendPort}${new URL(room).pathname}`;
}

async function createRoom(
  page: import("@playwright/test").Page,
  title: string,
  mode: "recovery" | "final-only" = "recovery"
) {
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill(title);
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true })
  ).toBeVisible();
  if (mode === "recovery") await chooseRecoveryHistory(page);
  else await chooseFinalOnlyHistory(page);
  return page.url();
}

test("reopens the same identity across tabs and keeps separate cookies and history for multiple rooms", async ({
  page,
  context,
}) => {
  const first = await createRoom(page, "First retrospective");
  const firstCookie = (await context.cookies(backendRoomUrl(first))).find(
    (cookie) => cookie.name.startsWith("retro-session-")
  )!;
  const reopened = await context.newPage();
  await reopened.goto(first);
  await expect(
    reopened.getByRole("button", { name: "Continue as Alice", exact: true })
  ).toBeVisible();
  await reopened
    .getByRole("button", { name: "Continue as Alice", exact: true })
    .click();
  await expect(
    reopened.getByText("Alice (you)", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Your session was resumed in another connection.", {
      exact: true,
    })
  ).toBeVisible();
  // The displaced tab must not delete the rotated cookie now used by the replacement.
  const replacementCookie = (await context.cookies(backendRoomUrl(first))).find(
    (cookie) => cookie.name === firstCookie.name
  )!;
  expect(replacementCookie.value).not.toBe(firstCookie.value);
  await page.close();
  await reopened.reload();
  await expect(
    reopened.getByRole("button", { name: "Continue as Alice", exact: true })
  ).toBeVisible();
  await reopened
    .getByRole("button", { name: "Continue as Alice", exact: true })
    .click();
  await expect(
    reopened.getByRole("button", {
      name: "Reveal and arrange notes",
      exact: true,
    })
  ).toBeEnabled();
  const second = await createRoom(reopened, "Second retrospective");
  expect(second).not.toBe(first);
  expect(
    (await context.cookies(backendRoomUrl(second))).filter((cookie) =>
      cookie.name.startsWith("retro-session-")
    )
  ).toHaveLength(2);
  await reopened.goto("/retro");
  await reopened
    .getByRole("button", { name: "Join a room", exact: true })
    .click();
  await reopened.getByLabel("Your name").fill("Ignored new name");
  await reopened.getByLabel("Room code").fill(first.split("/").pop()!);
  await reopened
    .getByRole("button", { name: "Check room availability", exact: true })
    .click();
  await expect(
    reopened.getByRole("button", {
      name: "Continue as Alice",
      exact: true,
    })
  ).toBeVisible();
  await reopened
    .getByRole("button", {
      name: "Join as someone else / Forget this session",
      exact: true,
    })
    .click();
  const confirmation = reopened.getByRole("alertdialog");
  await confirmation
    .getByRole("button", {
      name: "Forget session and join as someone else",
      exact: true,
    })
    .click();
  await reopened
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(
    reopened.getByText("Ignored new name (you)", { exact: true })
  ).toBeVisible();
  await expect(
    reopened.getByRole("heading", { name: "First retrospective", exact: true })
  ).toBeVisible();
  await reopened
    .getByRole("link", { name: "Previous retrospectives", exact: true })
    .click();
  await expect(
    reopened.getByRole("heading", { name: "First retrospective", exact: true })
  ).toBeVisible();
  await expect(
    reopened.getByRole("heading", { name: "Second retrospective", exact: true })
  ).toBeVisible();
  await expect(
    reopened.getByText(/Last seen in write · may be incomplete/)
  ).toHaveCount(2);
});

test("forget revokes the server cookie without using JavaScript cookie access", async ({
  page,
  context,
}) => {
  const url = await createRoom(page, "Forget session retro");
  const roomUrl = backendRoomUrl(url);
  await page.getByText("Privacy and browser storage", { exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Forget this browser session",
      exact: true,
    })
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Forget this browser session",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "This browser session was forgotten. Join again to reconnect.",
      { exact: true }
    )
  ).toBeVisible();
  expect(
    (await context.cookies(roomUrl)).some((item) =>
      item.name.startsWith("retro-session-")
    )
  ).toBe(false);
  await page.reload();
  await expect(page.getByLabel("Room code")).toHaveValue(url.split("/").pop()!);
});

test("rejects stale credentials without clearing them, then allows joining again", async ({
  page,
  context,
}) => {
  const url = await createRoom(page, "Stale cookie retro");
  const cookie = (await context.cookies(backendRoomUrl(url))).find((item) =>
    item.name.startsWith("retro-session-")
  )!;
  await context.addCookies([
    { ...cookie, value: "invalid-token-with-enough-characters" },
  ]);
  await page.reload();
  await expect(
    page.getByText(
      "This saved session could not be verified. Join as someone else.",
      { exact: true }
    )
  ).toBeVisible();
  expect(
    (await context.cookies(backendRoomUrl(url))).find(
      (item) => item.name === cookie.name
    )?.value
  ).toBe("invalid-token-with-enough-characters");
  await page.getByLabel("Your name").fill("Bobby");
  await page
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(page.getByText("Bobby (you)", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Reveal and arrange notes",
      exact: true,
    })
  ).toHaveCount(0);
});

test("storage failures stay in the mobile room status without blocking collaboration", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
  });
  await createRoom(page, "Storage blocked retro");
  const status = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Room status" });
  await expect(
    status.getByText(/Could not save this snapshot in browser history/)
  ).toBeVisible();
  await expect(
    status.getByText("Privacy and browser storage", { exact: true })
  ).toBeVisible();
  const statusBox = (await status.boundingBox())!;
  const boardBox = (await page
    .getByLabel("Retrospective notes")
    .boundingBox())!;
  expect(statusBox.y).toBeLessThan(boardBox.y);
  await page
    .getByLabel("Add a note", { exact: true })
    .nth(0)
    .fill("Still works live");
  await page
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();
  await expect(
    page.getByText("Still works live", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Keep the takeaways", { exact: true })
  ).toHaveCount(0);
});

test("shows an expiring warning in the desktop room status", async ({
  page,
}) => {
  await createRoom(page, "Expiring retro");
  await page.evaluate(() => {
    const currentTime = Date.now.bind(Date);
    Date.now = () => currentTime() + 105 * 60 * 1000;
  });
  await page.waitForTimeout(1100);

  const status = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Room status" });
  await expect(status.getByText(/Expires in 15 min/)).toBeVisible();
  await expect(
    status.getByText(/Finish and close soon to make final exports available/)
  ).toBeVisible();
  const statusBox = (await status.boundingBox())!;
  const boardBox = (await page
    .getByLabel("Retrospective notes")
    .boundingBox())!;
  expect(statusBox.x).toBeGreaterThan(boardBox.x);
});

test("keeps lobby connection failures and retry next to the entry form", async ({
  page,
  context,
}) => {
  await context.routeWebSocket("**/retro", (socket) => socket.close());
  await page.goto("/retro");

  const lobby = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Start a fresh conversation" });
  await expect(
    lobby.getByText("Disconnected · room entry is unavailable", { exact: true })
  ).toBeVisible();
  await expect(
    lobby.getByRole("button", { name: "Retry connection", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Room status", { exact: true })).toHaveCount(0);
});

test("requires a choice before storing and saves only the final snapshot in final-only mode", async ({
  page,
}) => {
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill("Final-only choice");
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Final-only choice", exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("retro-history-v1:")
        ).length
    )
  ).toBe(0);
  const choice = page.getByRole("region", {
    name: "Choose browser history for this room",
    exact: true,
  });
  await expect(choice.getByText(/browser profile/)).toBeVisible();
  await expect(choice.getByText(/exported Markdown/)).toBeVisible();
  await chooseFinalOnlyHistory(page);
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("retro-history-v1:")
        ).length
    )
  ).toBe(0);

  for (const label of [
    "Reveal and arrange notes",
    "Start voting",
    "Start discussion",
    "Close retrospective",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("button", {
        name: `Confirm ${label.toLowerCase()}`,
        exact: true,
      })
      .click();
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith("retro-history-v1:")
          ).length
      )
    )
    .toBe(1);
  const saved = await page.evaluate(
    () =>
      JSON.parse(
        Object.entries(localStorage).find(([key]) =>
          key.startsWith("retro-history-v1:")
        )![1]
      ).room
  );
  expect(saved.phase).toBe("closed");
});

test("an explicit opt-out keeps room content out of browser history", async ({
  page,
}) => {
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill("No history choice");
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No history choice", exact: true })
  ).toBeVisible();
  await chooseNoHistory(page);
  await page
    .getByLabel("Add a note", { exact: true })
    .first()
    .fill("Never persist this");
  await page
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();
  await expect(
    page.getByText("Never persist this", { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("retro-history-v1:")
        ).length
    )
  ).toBe(0);
  await expect(
    page.getByText("Browser history is disabled for this room", {
      exact: false,
    })
  ).toBeVisible();
});

test("deleting a room history entry suppresses later writes from its live tab", async ({
  page,
  context,
}) => {
  await createRoom(page, "Delete while live");
  await page
    .getByLabel("Add a note", { exact: true })
    .first()
    .fill("Before deletion");
  await page
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();
  const history = await context.newPage();
  await history.goto("/retro/history");
  await expect(
    history.getByRole("heading", { name: "Delete while live", exact: true })
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Delete saved retro", exact: true })
    .click();
  await history
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete saved retro", exact: true })
    .click();
  await expect(history.getByText(/No saved retrospectives yet/)).toBeVisible();
  await page
    .getByLabel("Add a note", { exact: true })
    .first()
    .fill("After deletion");
  await page
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();
  await expect(page.getByText("After deletion", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith("retro-history-v1:")
          ).length
      )
    )
    .toBe(0);
  await history.close();
});

test("Delete all history suppresses a live tab across the browser storage event", async ({
  page,
  context,
}) => {
  await createRoom(page, "Delete all while live");
  const history = await context.newPage();
  await history.goto("/retro/history");
  await expect(
    history.getByRole("heading", { name: "Delete all while live", exact: true })
  ).toBeVisible();
  await history
    .getByRole("button", {
      name: "Delete all retrospective history",
      exact: true,
    })
    .click();
  await history
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete all history", exact: true })
    .click();
  await expect(history.getByText(/No saved retrospectives yet/)).toBeVisible();
  await page
    .getByLabel("Add a note", { exact: true })
    .first()
    .fill("Suppressed update");
  await page
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();
  await expect(
    page.getByText("Suppressed update", { exact: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith("retro-history-v1:")
          ).length
      )
    )
    .toBe(0);
  await history.close();
});

test("removes an expired retained entry when the history page opens", async ({
  page,
}) => {
  await createRoom(page, "Expired history");
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) =>
      item.startsWith("retro-history-v1:")
    );
    if (!key) throw new Error("Expected a recovery archive");
    const archive = JSON.parse(localStorage.getItem(key)!);
    archive.retentionUntil = Date.now() - 1;
    localStorage.setItem(key, JSON.stringify(archive));
  });
  await page.goto("/retro/history");
  await expect(page.getByText(/No saved retrospectives yet/)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("retro-history-v1:")
        ).length
    )
  ).toBe(0);
});
