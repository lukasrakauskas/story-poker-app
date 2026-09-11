import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

declare global {
  interface Window {
    retroTestSocket: WebSocket;
    releaseRetroCommand: () => void;
  }
}

test("collaborates through all phases, reconnects, and keeps sessions memory-only", async ({
  context,
  page: owner,
}) => {
  await context.addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        window.retroTestSocket = this;
      }
    };
  });
  const guest = await context.newPage();
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
  await guest.goto(owner.url());
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

  await owner.evaluate(() => window.retroTestSocket.close());
  await owner.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    owner.getByText("Connected · changes sync live", { exact: true })
  ).toBeVisible();
  await owner
    .getByRole("button", { name: "Start voting", exact: true })
    .click();
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
  expect(
    await owner.evaluate(() =>
      Object.keys(localStorage).filter((key) => key !== "theme")
    )
  ).toEqual([]);
  await guest.reload();
  await expect(
    guest.getByRole("button", { name: "Join retrospective", exact: true })
  ).toBeVisible();
  await expect(guest.getByLabel("Your name")).toHaveValue("");
  expect(errors).toEqual([]);
});
