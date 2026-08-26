import assert from "node:assert/strict";
import test from "node:test";
import { isManualEditKey } from "../lib/settings-input";

test("settings fields only unlock for deliberate edits, not navigation or password-manager shortcuts", () => {
  for (const key of ["Tab", "Enter", "ArrowDown", "Escape", "Shift"]) assert.equal(isManualEditKey(key), false);
  for (const key of ["a", "@", "Backspace", "Delete", "Process"]) assert.equal(isManualEditKey(key), true);
  assert.equal(isManualEditKey("v", true), true);
  assert.equal(isManualEditKey("x", true), true);
  assert.equal(isManualEditKey("a", true), false);
  assert.equal(isManualEditKey("l", true), false);
});
