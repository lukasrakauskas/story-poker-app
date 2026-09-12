import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

declare global {
  interface Window {
    retroTestSocket: WebSocket;
    releaseRetroCommand: () => void;
  }
}

test("collaborates, rejoins with cookies, and saves final retros with Markdown export", async ({
  context,
  browser,
  page: owner,
}, testInfo) => {
  await context.addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        window.retroTestSocket = this;
      }
    };
  });
  // Different participants use separate browser profiles; tabs share rejoin cookies.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  for (const page of [owner, guest]) {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
  }
  await owner.goto("/retro");
  await owner.getByLabel("Your name").fill("Alice");
  await owner.getByLabel("Retrospective title").fill("Browser retrospective");
  await owner
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    owner.getByRole("heading", { name: "Browser retrospective" })
  ).toBeVisible();
  await expect(owner.getByLabel("Room link")).toHaveValue(owner.url());
  const roomUrl = owner.url();
  const cookies = await context.cookies(roomUrl);
  const credential = cookies.find((cookie) =>
    cookie.name.startsWith("retro-session-")
  )!;
  expect(credential).toBeTruthy();
  expect(credential.path).toBe("/retro");
  expect(credential.sameSite).toBe("Lax");
  expect(credential.expires * 1000).toBeGreaterThan(Date.now());
  expect(credential.expires * 1000).toBeLessThanOrEqual(
    Date.now() + 2 * 60 * 60 * 1000
  );
  await guest.goto(roomUrl);
  await guest.getByLabel("Your name").fill("Bobby");
  await guest
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(owner.getByText("Bobby", { exact: true })).toBeVisible();

  // Hold one outgoing mutation while another member broadcasts. That broadcast
  // must not acknowledge our unsent command or erase its draft.
  await owner.evaluate(() => {
    const socket = window.retroTestSocket;
    const send = socket.send.bind(socket);
    socket.send = (data) => {
      if (
        typeof data === "string" &&
        JSON.parse(data).data.type === "add-note"
      ) {
        window.releaseRetroCommand = () => {
          socket.send = send;
          send(data);
        };
      } else send(data);
    };
  });
  await owner
    .getByLabel("Add a note", { exact: true })
    .nth(0)
    .fill("Teamwork was excellent");
  await owner
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();
  await guest
    .getByLabel("Add a note", { exact: true })
    .nth(1)
    .fill("Reduce flaky tests");
  await guest
    .getByRole("button", { name: "Add to to improve", exact: true })
    .click();
  await expect(
    owner.getByText("Reduce flaky tests", { exact: true })
  ).toBeVisible();
  await expect(
    owner.getByLabel("Add a note", { exact: true }).nth(0)
  ).toHaveValue("Teamwork was excellent");
  await expect(
    owner.getByRole("button", { name: "Add to went well", exact: true })
  ).toBeDisabled();
  await owner.evaluate(() => window.releaseRetroCommand());
  await expect(
    guest.getByText("Teamwork was excellent", { exact: true })
  ).toBeVisible();
  await expect(
    owner.getByLabel("Add a note", { exact: true }).nth(0)
  ).toHaveValue("");

  // Ticket controls are tucked into a keyboard-accessible menu, owner-only.
  const noteActions = owner.getByRole("button", {
    name: "Actions for note: Teamwork was excellent",
    exact: true,
  });
  await expect(
    guest.getByRole("button", {
      name: "Actions for note: Teamwork was excellent",
      exact: true,
    })
  ).toHaveCount(0);
  await expect(
    owner.getByRole("menuitem", { name: "Edit", exact: true })
  ).toHaveCount(0);
  await noteActions.focus();
  await owner.keyboard.press("Enter");
  await owner.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(owner.getByLabel("Edit your note")).toBeFocused();
  await owner
    .getByLabel("Edit your note")
    .fill("Teamwork was excellent (edited)");
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    guest.getByText("Teamwork was excellent (edited)", { exact: true })
  ).toBeVisible();
  await owner
    .getByRole("button", {
      name: "Actions for note: Teamwork was excellent (edited)",
      exact: true,
    })
    .click();
  await owner.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await owner.getByLabel("Edit your note").fill("Teamwork was excellent");
  await owner.getByRole("button", { name: "Save", exact: true }).click();

  await noteActions.click();
  await owner.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const confirmation = owner.getByRole("alertdialog");
  await expect(
    confirmation.getByRole("heading", { name: "Delete this note?" })
  ).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(noteActions).toBeFocused();
  await expect(
    guest.getByText("Teamwork was excellent", { exact: true })
  ).toBeVisible();

  await owner
    .getByLabel("Add a note", { exact: true })
    .nth(2)
    .fill("Temporary idea");
  await owner
    .getByRole("button", { name: "Add to ideas", exact: true })
    .click();
  await owner
    .getByRole("button", {
      name: "Actions for note: Temporary idea",
      exact: true,
    })
    .click();
  await owner.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "Delete note", exact: true })
    .click();
  await expect(owner.getByText("Temporary idea", { exact: true })).toHaveCount(
    0
  );
  await expect(guest.getByText("Temporary idea", { exact: true })).toHaveCount(
    0
  );

  await owner.screenshot({
    path: testInfo.outputPath("retro-board.png"),
    fullPage: true,
  });
  await owner.setViewportSize({ width: 390, height: 844 });
  await noteActions.click();
  await expect(
    owner.getByRole("menuitem", { name: "Edit", exact: true })
  ).toBeVisible();
  expect(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await owner.screenshot({
    path: testInfo.outputPath("retro-mobile-menu.png"),
    fullPage: true,
  });
  await owner.keyboard.press("Escape");
  await expect(noteActions).toBeFocused();
  await owner.setViewportSize({ width: 1280, height: 720 });

  await owner.reload();
  await expect(
    owner.getByRole("complementary").getByText("Alice (you)", { exact: true })
  ).toBeVisible();
  await expect(noteActions).toBeVisible();
  await expect(
    owner.getByRole("button", { name: "Start voting", exact: true })
  ).toBeEnabled();
  expect(
    (await context.cookies(roomUrl)).find(
      (cookie) => cookie.name === credential.name
    )?.value
  ).toBe(credential.value);
  await owner.evaluate(() => window.retroTestSocket.close());
  await owner.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    owner.getByText("Connected · changes sync live", { exact: true })
  ).toBeVisible();
  await owner
    .getByRole("button", { name: "Start voting", exact: true })
    .click();
  await expect(
    owner.getByRole("button", { name: /^Actions for note:/ })
  ).toHaveCount(0);
  await guest
    .getByRole("button", {
      name: "Vote for note: Teamwork was excellent",
      exact: true,
    })
    .click();
  await expect(
    guest.getByText("2 of 3 votes remaining", { exact: true })
  ).toBeVisible();
  await owner
    .getByRole("button", { name: "Start discussion", exact: true })
    .click();
  await owner
    .getByLabel("Next step", { exact: true })
    .fill("Pair on flaky tests");
  await owner.getByLabel("Owner (optional)", { exact: true }).fill("Bobby");
  await owner.getByRole("button", { name: "Add action", exact: true }).click();
  await expect(
    guest.getByText("Pair on flaky tests", { exact: true })
  ).toBeVisible();
  await owner
    .getByRole("checkbox", {
      name: "Mark action complete: Pair on flaky tests",
    })
    .click();
  await expect(guest.getByText("Done", { exact: true })).toBeVisible();

  await expect(
    guest.getByRole("button", { name: /^Actions for action:/ })
  ).toHaveCount(0);
  await owner.getByLabel("Next step", { exact: true }).fill("Temporary action");
  await owner.getByRole("button", { name: "Add action", exact: true }).click();
  await owner
    .getByRole("button", {
      name: "Actions for action: Temporary action",
      exact: true,
    })
    .click();
  await owner.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "Delete action", exact: true })
    .click();
  await expect(
    owner.getByText("Temporary action", { exact: true })
  ).toHaveCount(0);
  await expect(
    guest.getByText("Temporary action", { exact: true })
  ).toHaveCount(0);

  const downloading = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Export JSON", exact: true }).click();
  const downloaded = await downloading;
  const exported = JSON.parse(
    await readFile((await downloaded.path())!, "utf8")
  );
  expect(exported.actions[0]).toMatchObject({
    text: "Pair on flaky tests",
    owner: "Bobby",
    done: true,
  });
  expect(JSON.stringify(exported)).not.toContain("token");
  await owner
    .getByRole("button", { name: "Close retrospective", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", {
      name: "Retrospective complete · read-only",
      exact: true,
    })
  ).toBeVisible();
  await expect(owner.getByRole("checkbox")).toHaveCount(0);
  await owner.setViewportSize({ width: 390, height: 844 });
  expect(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await owner.getByRole("button", { name: "Toggle theme" }).click();
  await owner.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect(owner.locator("html")).toHaveClass(/dark/);
  expect(await owner.evaluate(() => sessionStorage.length)).toBe(0);
  const saved = await owner.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("retro-history-v1:")
    )
  );
  expect(saved).toHaveLength(1);
  expect(saved[0][1]).not.toContain(credential.value);
  expect(saved[0][1]).not.toContain('"token"');
  expect(JSON.parse(saved[0][1]).room.phase).toBe("closed");
  await guest.reload();
  await expect(
    guest.getByRole("complementary").getByText("Bobby (you)", { exact: true })
  ).toBeVisible();
  await expect(
    guest.getByRole("heading", {
      name: "Retrospective complete · read-only",
      exact: true,
    })
  ).toBeVisible();

  // Saved history is independent of both the room token and the live server.
  await context.clearCookies();
  await context.routeWebSocket("**/retro", (socket) => socket.close());
  await owner
    .getByRole("link", { name: "Previous retrospectives", exact: true })
    .click();
  await expect(
    owner.getByRole("heading", { name: "Browser retrospective", exact: true })
  ).toBeVisible();
  await expect(
    owner.getByText("Completed · final actions", { exact: false })
  ).toBeVisible();
  await expect(
    owner.getByText("Pair on flaky tests", { exact: true })
  ).toBeVisible();
  await expect(owner.getByText("Done · Bobby", { exact: true })).toBeVisible();
  await owner.reload();
  await expect(
    owner.getByText("Pair on flaky tests", { exact: true })
  ).toBeVisible();
  await owner
    .getByText("View saved notes and participants", { exact: true })
    .click();
  await expect(
    owner.getByText("Teamwork was excellent", { exact: true })
  ).toBeVisible();

  expect(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);

  const markdownDownload = owner.waitForEvent("download");
  await owner
    .getByRole("button", { name: "Export Markdown", exact: true })
    .click();
  const markdownFile = await markdownDownload;
  expect(markdownFile.suggestedFilename()).toMatch(/\.md$/);
  const markdown = await readFile((await markdownFile.path())!, "utf8");
  expect(markdown).toContain("# Browser retrospective");
  expect(markdown).toContain("- [x] Pair on flaky tests");
  expect(markdown).toContain("Bobby");
  expect(markdown).not.toContain(credential.value);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await owner
    .getByRole("button", { name: "Copy Markdown", exact: true })
    .click();
  await expect
    .poll(() => owner.evaluate(() => navigator.clipboard.readText()))
    .toBe(markdown);
  await owner.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: () => Promise.reject(new Error("Blocked")),
    })
  );
  await owner
    .getByRole("button", { name: "Copy Markdown", exact: true })
    .click();
  await expect(owner.getByRole("textbox", { name: /Markdown/i })).toHaveValue(
    markdown
  );
  await owner
    .getByRole("button", { name: "Delete saved retro", exact: true })
    .click();
  await expect(owner.getByText(/No saved retrospectives yet/)).toBeVisible();
  await owner.reload();
  await expect(owner.getByText(/No saved retrospectives yet/)).toBeVisible();
  expect(errors).toEqual([]);
  await guestContext.close();
});
