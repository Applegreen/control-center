import assert from "node:assert/strict";
import test from "node:test";
import { modelOverrideAfterProviderChange } from "../lib/ai-settings";

test("switching AI providers clears a provider-specific model override", () => {
  assert.equal(
    modelOverrideAfterProviderChange("openai", "anthropic", "gpt-5-mini"),
    "",
  );
  assert.equal(
    modelOverrideAfterProviderChange("anthropic", "anthropic", "claude-sonnet-4-20250514"),
    "claude-sonnet-4-20250514",
  );
});
