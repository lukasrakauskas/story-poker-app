import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRetroReconnectPolicy,
  reconnectDelay,
} from "../lib/retro-reconnect-policy";

test("reconnect delays grow exponentially, stay bounded, and apply deterministic jitter", () => {
  const random = () => 0;
  const options = {
    initialDelayMs: 100,
    maxDelayMs: 1_000,
    jitterRatio: 0.5,
    random,
  };

  assert.equal(reconnectDelay(1, options), 50);
  assert.equal(reconnectDelay(2, options), 100);
  assert.equal(reconnectDelay(3, options), 200);
  assert.equal(reconnectDelay(4, options), 400);
  assert.equal(reconnectDelay(5, options), 500);
  assert.ok(reconnectDelay(5, { ...options, random: () => 1 }) <= 1_000);
});

test("a policy exposes attempt numbers and resets after stable success", () => {
  const policy = createRetroReconnectPolicy({
    initialDelayMs: 10,
    maxDelayMs: 100,
    jitterRatio: 0,
  });

  assert.deepEqual(policy.next(), { number: 1, delayMs: 10 });
  assert.deepEqual(policy.next(), { number: 2, delayMs: 20 });
  assert.equal(policy.attempt, 2);
  policy.reset();
  assert.equal(policy.attempt, 0);
  assert.deepEqual(policy.next(), { number: 1, delayMs: 10 });
});

test("invalid random samples are clamped to the jitter bounds", () => {
  assert.equal(
    reconnectDelay(1, {
      initialDelayMs: 100,
      maxDelayMs: 100,
      jitterRatio: 1,
      random: () => -1,
    }),
    0
  );
  assert.equal(
    reconnectDelay(1, {
      initialDelayMs: 100,
      maxDelayMs: 100,
      jitterRatio: 1,
      random: () => 2,
    }),
    100
  );
  assert.equal(
    reconnectDelay(1, {
      initialDelayMs: 100,
      maxDelayMs: 100,
      jitterRatio: 1,
      random: () => Number.NaN,
    }),
    100
  );
});
