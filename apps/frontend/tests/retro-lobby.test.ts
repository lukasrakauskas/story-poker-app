import { test } from "node:test";
import assert from "node:assert/strict";
import {
  participantNameError,
  participantNameSchema,
} from "shared/participant";

const participantNames = [
  ["blank", "", false],
  ["padded short", "  ab  ", false],
  ["exactly three characters", "abc", true],
  ["padded valid", "  Alice  ", true],
  ["oversized", ` ${"a".repeat(31)} `, false],
] as const;

test("retro lobby participant validation uses normalized name lengths", () => {
  for (const [_label, input, valid] of participantNames) {
    const parsed = participantNameSchema.safeParse(input);
    assert.equal(parsed.success, valid, input);
    assert.equal(participantNameError(input) === null, valid, input);
    if (valid) {
      assert.equal(parsed.success && parsed.data, input.trim());
    }
  }
});
