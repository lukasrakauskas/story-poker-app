import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  clearRetroToken,
  readRetroToken,
  saveRetroToken,
} from "../lib/retro-session";

let cookie = "";
let written = "";
const originals = ["document", "location"].map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
);
beforeEach(() => {
  cookie = "";
  written = "";
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        written = value;
        cookie = value.split(";")[0];
      },
    },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:" },
  });
});
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("cookies are host-only, secure on HTTPS, scoped to retro, and expire with the room", () => {
  const expiresAt = Date.now() + 7200000;
  assert.equal(saveRetroToken("first-room", "secret-token", expiresAt), true);
  assert.match(written, /; Path=\/retro;/);
  assert.match(written, /; SameSite=Lax; Secure$/);
  assert.ok(written.includes(`Expires=${new Date(expiresAt).toUTCString()}`));
  assert.ok(!written.includes("Domain="));
  assert.equal(readRetroToken("first-room"), "secret-token");
  assert.equal(readRetroToken("other-room"), null);
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:" },
  });
  saveRetroToken("first-room", "secret-token", expiresAt);
  assert.ok(!written.includes("Secure"));
  clearRetroToken("first-room");
  assert.match(written, /Max-Age=0/);
  assert.equal(readRetroToken("first-room"), null);
});

test("malformed or oversized cookies are discarded rather than causing repeated failed resumes", () => {
  for (const value of ["%broken", "a".repeat(65), ""]) {
    cookie = `retro-session-first-room=${value}`;
    assert.equal(readRetroToken("first-room"), null);
    assert.match(written, /Max-Age=0/);
  }
  written = "";
  assert.equal(saveRetroToken("bad; Path=/", "token", Date.now()), false);
  assert.equal(written, "");
});

test("blocked cookie access is nonfatal", () => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get cookie() {
        throw new Error("SecurityError");
      },
      set cookie(_value: string) {
        throw new Error("SecurityError");
      },
    },
  });
  assert.equal(readRetroToken("room"), null);
  assert.equal(saveRetroToken("room", "token", Date.now() + 7200000), false);
  assert.doesNotThrow(() => clearRetroToken("room"));
});
