import { test, expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    retroCommandTypes: string[];
  }
}

async function createRoom(page: Page, title: string) {
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill(title);
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true })
  ).toBeVisible();
  return page.url();
}

async function recordCommands(page: Page) {
  await page.addInitScript(() => {
    window.retroCommandTypes = [];
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const send = this.send.bind(this) as (payload: unknown) => void;
        this.send = ((payload: unknown) => {
          if (typeof payload === "string") {
            try {
              const message = JSON.parse(payload);
              if (message.event === "retro-command")
                window.retroCommandTypes.push(message.data.type);
            } catch {
              // The application, rather than this test probe, owns payload validation.
            }
          }
          send(payload);
        }) as typeof this.send;
      }
    } as typeof WebSocket;
  });
}

test("shows remembered moderator identity, then explicitly continues or forgets it", async ({
  page,
  context,
}) => {
  await recordCommands(page);
  const roomUrl = await createRoom(page, "Explicit identity");
  await page
    .getByLabel("Add a note", { exact: true })
    .first()
    .fill("Alice private note");
  await page
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();

  const remembered = await context.newPage();
  await recordCommands(remembered);
  await remembered.goto(roomUrl);
  await expect(
    remembered.getByText("Continue as Alice", { exact: true }).first()
  ).toBeVisible();
  await expect(
    remembered.getByText("Moderator access is saved with this identity.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    remembered.getByRole("button", { name: "Continue as Alice", exact: true })
  ).toBeVisible();
  await expect(remembered.getByLabel("Your name")).toHaveCount(0);
  await expect(
    page.getByText("Your session was resumed in another connection.", {
      exact: true,
    })
  ).toHaveCount(0);
  expect(await remembered.evaluate(() => window.retroCommandTypes)).toEqual([
    "inspect",
  ]);

  await remembered
    .getByRole("button", { name: "Continue as Alice", exact: true })
    .click();
  await expect(
    remembered.getByRole("heading", { name: "Explicit identity", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Your session was resumed in another connection.", {
      exact: true,
    })
  ).toBeVisible();
  expect(await remembered.evaluate(() => window.retroCommandTypes)).toEqual([
    "inspect",
    "resume",
  ]);

  const choosing = await context.newPage();
  await choosing.goto(roomUrl);
  await expect(
    choosing.getByText("Continue as Alice", { exact: true }).first()
  ).toBeVisible();
  await choosing
    .getByRole("button", {
      name: "Join as someone else / Forget this session",
      exact: true,
    })
    .click();
  const confirmation = choosing.getByRole("alertdialog");
  await expect(
    confirmation.getByText(/lose.*ownership.*moderator access/i)
  ).toBeVisible();
  await confirmation
    .getByRole("button", {
      name: "Forget session and join as someone else",
      exact: true,
    })
    .click();
  await expect(choosing.getByLabel("Your name", { exact: true })).toBeVisible();
  await choosing.getByLabel("Your name", { exact: true }).fill("Bobby");
  await choosing
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(
    choosing.getByText("Bobby (you)", { exact: true })
  ).toBeVisible();
  await expect(
    choosing.getByText("Alice private note", { exact: true })
  ).toHaveCount(0);
  await expect(
    remembered.getByText(
      "This session was forgotten. Join as someone else to enter this room.",
      { exact: true }
    )
  ).toBeVisible();
  await context.close();
});

test("rejects one invalid room credential without affecting another room cookie", async ({
  page,
  context,
}) => {
  const first = await createRoom(page, "First identity");
  const firstCookie = (await context.cookies(first)).find((cookie) =>
    cookie.name.startsWith("retro-session-")
  )!;
  const second = await createRoom(page, "Second identity");
  const firstCode = first.split("/").pop()!;
  const secondCode = second.split("/").pop()!;
  const secondCookie = (await context.cookies(second)).find(
    (cookie) => cookie.name === `retro-session-${secondCode}`
  )!;
  expect(firstCookie.name).toBe(`retro-session-${firstCode}`);
  expect(firstCookie.name).not.toBe(secondCookie.name);

  await context.addCookies([
    { ...firstCookie, value: "valid-shaped-but-rejected" },
  ]);
  await page.goto(first);
  await expect(
    page.getByText(
      "This saved session could not be verified. Join as someone else.",
      {
        exact: true,
      }
    )
  ).toBeVisible();
  await expect(
    page.getByText("Continue as Alice", { exact: true })
  ).toHaveCount(0);
  expect(
    (await context.cookies(first)).find(
      (cookie) => cookie.name === firstCookie.name
    )
  ).toBeUndefined();
  expect(
    (await context.cookies(second)).find(
      (cookie) => cookie.name === secondCookie.name
    )?.value
  ).toBe(secondCookie.value);

  await page.getByLabel("Your name", { exact: true }).fill("Bobby");
  await page
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await expect(page.getByText("Bobby (you)", { exact: true })).toBeVisible();
});
