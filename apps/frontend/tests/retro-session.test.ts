import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { RetroSessionView } from "shared/retrospective";
import {
  establishRetroSession,
  forgetRetroSession,
  inspectRetroSession,
  resumeRetroSession,
  RetroSessionError,
} from "../lib/retro-session";

const originalFetch = globalThis.fetch;
const originalApi = process.env.NEXT_PUBLIC_RETRO_API_URL;
let calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];

const view: RetroSessionView = {
  room: {
    code: "first-room",
    title: "Retro",
    phase: "write",
    expiresAt: Date.now() + 7_200_000,
    closedAt: null,
    members: [],
    notes: [],
    actions: [],
    requiresPassword: false,
  },
  self: { id: "alice" },
};

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_RETRO_API_URL = "https://backend.example";
  globalThis.fetch = async (inputValue, init) => {
    calls.push({ input: inputValue, init });
    const input = String(inputValue);
    if (init?.method === "DELETE") return response({ forgotten: true });
    if (input.endsWith("/first-room"))
      return response({
        code: "first-room",
        name: "Alice",
        moderator: true,
      });
    return response(view);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApi === undefined) delete process.env.NEXT_PUBLIC_RETRO_API_URL;
  else process.env.NEXT_PUBLIC_RETRO_API_URL = originalApi;
});

test("establishment, inspection, rotation, and forget use credentialed HTTP without exposing cookies", async () => {
  assert.deepEqual(
    await establishRetroSession({
      type: "create",
      name: "Alice",
      title: "Retro",
    }),
    view
  );
  assert.equal(calls[0].input, "https://backend.example/retro/session");
  assert.equal(calls[0].init?.credentials, "include");
  assert.equal(calls[0].init?.method, "POST");
  assert.match(String(calls[0].init?.body), /Alice/);
  assert.ok(!String(calls[0].init?.body).includes("token"));

  await inspectRetroSession("first-room");
  await resumeRetroSession("first-room");
  await forgetRetroSession("first-room");
  assert.deepEqual(
    calls.map(({ input, init }) => [input, init?.method, init?.credentials]),
    [
      ["https://backend.example/retro/session", "POST", "include"],
      ["https://backend.example/retro/session/first-room", "GET", "include"],
      [
        "https://backend.example/retro/session/first-room/resume",
        "POST",
        "include",
      ],
      ["https://backend.example/retro/session/first-room", "DELETE", "include"],
    ]
  );
});

test("failed rotations surface a safe error and never attempt JavaScript cookie deletion", async () => {
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return response(
      {
        code: "invalid-session",
        message: "This session is no longer available. Join again.",
      },
      false,
      401
    );
  };
  await assert.rejects(
    () => resumeRetroSession("first-room"),
    (error: unknown) => {
      assert.ok(error instanceof RetroSessionError);
      assert.equal(error.code, "invalid-session");
      assert.equal(error.status, 401);
      return true;
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.credentials, "include");
});

test("rejects nested or secret-bearing HTTP session responses", async () => {
  globalThis.fetch = async () =>
    response({ ...view, room: { ...view.room, members: [{ id: "alice" }] } });
  await assert.rejects(
    () => resumeRetroSession("first-room"),
    /invalid session response/
  );
  globalThis.fetch = async () =>
    response({
      code: "first-room",
      name: "Alice",
      moderator: true,
      token: "must-not-enter-js",
    });
  await assert.rejects(
    () => inspectRetroSession("first-room"),
    /invalid session response/
  );
});

test("serializes same-room cookie-changing requests through their responses", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  globalThis.fetch = async (_url, init) => {
    order.push(init!.method!);
    if (init?.method === "POST") {
      await held;
      return response(view);
    }
    return response({ forgotten: true });
  };
  const rotating = resumeRetroSession("first-room");
  const forgetting = forgetRetroSession("first-room");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["POST"]);
  release();
  await Promise.all([rotating, forgetting]);
  assert.deepEqual(order, ["POST", "DELETE"]);
});

test("invalid room codes are rejected before a request can be sent", () => {
  assert.throws(
    () => inspectRetroSession("bad; Path=/"),
    (error: unknown) =>
      error instanceof RetroSessionError && error.code === "invalid-command"
  );
  assert.equal(calls.length, 0);
});
