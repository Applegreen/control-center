import assert from "node:assert/strict";
import test from "node:test";
import { isGoogleOAuthClientId } from "../lib/google-oauth";

test("accepts Google OAuth client IDs", () => {
  assert.equal(
    isGoogleOAuthClientId(
      "123456789012-example_Client-ID.apps.googleusercontent.com",
    ),
    true,
  );
});

test("rejects an account email used as the Google OAuth client ID", () => {
  assert.equal(isGoogleOAuthClientId("person@example.com"), false);
});

test("rejects partial and lookalike Google OAuth client IDs", () => {
  assert.equal(isGoogleOAuthClientId("123456789012-example_Client-ID"), false);
  assert.equal(
    isGoogleOAuthClientId(
      "123456789012-example_Client-ID.apps.googleusercontent.com.example.com",
    ),
    false,
  );
});
