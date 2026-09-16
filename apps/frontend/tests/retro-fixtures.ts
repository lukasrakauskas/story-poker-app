import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { chooseRecoveryHistory } from "./retro-history-test-helpers";
import type { RetroColumn, RetroPhase, RetroRoom } from "shared/retrospective";

// Keep room setup and identity-sensitive browser plumbing here. Each guest gets
// an isolated cookie jar, while the fixture closes every context and tracked
// WebSocket even when a focused scenario fails.
const columnTitles: Record<RetroColumn, string> = {
  "went-well": "went well",
  improve: "to improve",
  ideas: "ideas",
};

const phaseLabels: Record<Exclude<RetroPhase, "write">, string> = {
  group: "Reveal and group notes",
  vote: "Start voting",
  discuss: "Start discussion",
  closed: "Close retrospective",
};

const phaseOrder: Exclude<RetroPhase, "write">[] = [
  "group",
  "vote",
  "discuss",
  "closed",
];

declare global {
  interface Window {
    retroTestSockets: WebSocket[];
    releaseRetroCommand?: () => void;
  }
}

export type RetroParticipant = {
  name: string;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
};

export type NoteSeed = {
  column: RetroColumn;
  text: string;
};

export type RetroHistorySnapshot = {
  room: RetroRoom;
  [key: string]: unknown;
};

type ParticipantOptions = BrowserContextOptions;

function installSocketTracking(context: BrowserContext) {
  return context.addInitScript(() => {
    const sockets: WebSocket[] = [];
    window.retroTestSockets = sockets;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
        this.addEventListener("close", () => {
          const index = sockets.indexOf(this);
          if (index >= 0) sockets.splice(index, 1);
        });
      }
    } as typeof WebSocket;
  });
}

async function closePageSockets(page: Page) {
  await page
    .evaluate(() => {
      for (const socket of window.retroTestSockets ?? []) socket.close();
    })
    .catch(() => undefined);
}

function uniqueTitle(testInfo: TestInfo, title?: string) {
  const suffix = `${testInfo.workerIndex}-${testInfo.testId.replace(/[^a-zA-Z0-9]/g, "").slice(-10)}`;
  return `${title ?? "Browser retrospective"} · ${suffix}`;
}

export class RetroRoomFixture {
  readonly owner: RetroParticipant;
  private readonly browser: Browser;
  private readonly testInfo: TestInfo;
  private readonly guests: RetroParticipant[] = [];
  private readonly extraPages: Page[] = [];
  private readonly ownerSetup: Promise<unknown>;
  private roomTitle = "";
  private roomUrl = "";

  constructor(browser: Browser, ownerPage: Page, testInfo: TestInfo) {
    this.browser = browser;
    this.testInfo = testInfo;
    this.ownerSetup = installSocketTracking(ownerPage.context());
    this.owner = {
      name: "",
      context: ownerPage.context(),
      page: ownerPage,
      close: async () => closePageSockets(ownerPage),
    };
  }

  get url() {
    if (!this.roomUrl)
      throw new Error("Create a retrospective before using its room URL");
    return this.roomUrl;
  }

  get title() {
    if (!this.roomTitle)
      throw new Error("Create a retrospective before reading its title");
    return this.roomTitle;
  }

  async createRoom(title?: string, ownerName = "Alice") {
    if (this.roomUrl) throw new Error("A fixture can create only one room");
    await this.ownerSetup;
    this.roomTitle = uniqueTitle(this.testInfo, title);
    this.owner.name = ownerName;
    const { page } = this.owner;
    await page.goto("/retro");
    await page.getByLabel("Your name", { exact: true }).fill(ownerName);
    await page
      .getByLabel("Retrospective title", { exact: true })
      .fill(this.roomTitle);
    await page
      .getByRole("button", { name: "Create retrospective", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: this.roomTitle, exact: true })
    ).toBeVisible();
    await chooseRecoveryHistory(page);
    this.roomUrl = page.url();
    return this.roomUrl;
  }

  async joinParticipant(
    name: string,
    options: ParticipantOptions = {}
  ): Promise<RetroParticipant> {
    const context = await this.browser.newContext(options);
    await installSocketTracking(context);
    const page = await context.newPage();
    let closed = false;
    const participant: RetroParticipant = {
      name,
      context,
      page,
      close: async () => {
        if (closed) return;
        closed = true;
        await closePageSockets(page);
        await context.close().catch(() => undefined);
      },
    };
    this.guests.push(participant);
    await page.goto(this.url);
    await page.getByLabel("Your name", { exact: true }).fill(name);
    await page
      .getByRole("button", { name: "Join retrospective", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: this.title, exact: true })
    ).toBeVisible();
    await chooseRecoveryHistory(page);
    return participant;
  }

  async newPage(participant: RetroParticipant = this.owner) {
    const page = await participant.context.newPage();
    this.extraPages.push(page);
    return page;
  }

  async dispose() {
    for (const page of [...this.extraPages].reverse()) {
      await closePageSockets(page);
      await page.close().catch(() => undefined);
    }
    for (const guest of [...this.guests].reverse()) await guest.close();
    await this.ownerSetup.catch(() => undefined);
    await this.owner.close();
  }
}

export type RetroFixtures = {
  retro: RetroRoomFixture;
};

export const test = base.extend<RetroFixtures>({
  retro: async ({ browser, page }, use, testInfo) => {
    const fixture = new RetroRoomFixture(browser, page, testInfo);
    try {
      await use(fixture);
    } finally {
      await fixture.dispose();
    }
  },
});

export { expect };

export async function advanceRetroPhase(
  page: Page,
  label: (typeof phaseLabels)[Exclude<RetroPhase, "write">]
) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", {
      name: `Confirm ${label.toLowerCase()}`,
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
}

export async function advanceRetroTo(
  page: Page,
  phase: Exclude<RetroPhase, "write">
) {
  for (const next of phaseOrder.slice(0, phaseOrder.indexOf(phase) + 1))
    await advanceRetroPhase(page, phaseLabels[next]);
}

export async function seedRetroNotes(page: Page, notes: NoteSeed[]) {
  for (const { column, text } of notes) {
    const columnIndex = Object.keys(columnTitles).indexOf(column);
    await page
      .getByLabel("Add a note", { exact: true })
      .nth(columnIndex)
      .fill(text);
    await page
      .getByRole("button", {
        name: `Add to ${columnTitles[column]}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("article").getByText(text, { exact: true })
    ).toBeVisible();
  }
}

export async function seedRetroAction(
  page: Page,
  text: string,
  ownerName?: string
) {
  const form = page.getByRole("form", { name: "New action", exact: true });
  await form.getByLabel("Next step", { exact: true }).fill(text);
  if (ownerName)
    await form
      .getByLabel("Owner (optional)", { exact: true })
      .selectOption({ label: ownerName });
  await form.getByRole("button", { name: "Add action", exact: true }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
}

export async function createRetroTheme(
  page: Page,
  noteTexts: string[],
  title: string
) {
  for (const text of noteTexts)
    await page.getByLabel(text, { exact: true }).check();
  await page.getByLabel("Theme name", { exact: true }).fill(title);
  await page
    .getByRole("button", {
      name: `Create theme from ${noteTexts.length} notes`,
      exact: true,
    })
    .click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
}

export async function holdNextRetroCommand(page: Page, commandType: string) {
  await page.evaluate((type) => {
    const socket = window.retroTestSockets?.at(-1);
    if (!socket) throw new Error("No tracked retrospective socket");
    const send = socket.send.bind(socket);
    socket.send = ((data: Parameters<WebSocket["send"]>[0]) => {
      if (typeof data === "string") {
        try {
          const command = JSON.parse(data).data;
          if (command?.type === type && !window.releaseRetroCommand) {
            window.releaseRetroCommand = () => {
              window.releaseRetroCommand = undefined;
              send(data);
            };
            return;
          }
        } catch {
          // Let non-JSON WebSocket frames pass through unchanged.
        }
      }
      send(data);
    }) as typeof socket.send;
  }, commandType);
}

export async function releaseHeldRetroCommand(page: Page) {
  await page.evaluate(() => {
    if (!window.releaseRetroCommand)
      throw new Error("No retrospective command is being held");
    window.releaseRetroCommand();
  });
}

export async function readRetroHistorySnapshot(
  page: Page
): Promise<RetroHistorySnapshot> {
  // Recovery persistence coalesces bursts for 250 ms. Wait for that boundary
  // before inspecting the last-seen archive, rather than assuming sync writes.
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const value = Object.entries(localStorage).find(([key]) =>
      key.startsWith("retro-history-v1:")
    )?.[1];
    if (!value) throw new Error("No retrospective history snapshot found");
    return JSON.parse(value) as RetroHistorySnapshot;
  });
}
